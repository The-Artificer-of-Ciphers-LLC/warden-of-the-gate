import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Compiler-backed code lookup (P3 `AI-lookup`), lifted from the P0 lookup proof (`proof/p0-runtime/src/lib/lookup.ts`, ADR 0004 proof record) and widened to
 *  the files a review actually touches. Three tiers, always labeled:
 *  - `precise`: the repository's own tsconfig program in the pinned TypeScript;
 *  - `inferred`: a Warden-built allowJs program over JavaScript the tsconfig does not cover (how editors serve plain JS); compiler-derived but heuristic;
 *  - `text`: bounded exact-token search for everything else (Markdown, YAML, JSON, shell, files outside both programs).
 *  It is static only: no repository code, compiler plugin, lifecycle script or project reference build ever runs, and nothing outside the snapshot is read
 *  (symlinks and paths that resolve outside it are refused). A lookup answer is evidence for a reviewer, never authority. */
export type Tier = 'precise' | 'inferred' | 'text';
export const TS_VERSION = ts.version;
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const JS_EXT = /\.(js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'vendor']);
const MAX_TEXT_FILE = 512 * 1024;

export interface Snippet { path: string; startLine: number; endLine: number; text: string }
export interface Site { path: string; line: number; col: number; tier: Tier }

/** A read-only view of one materialized revision. Paths are repository-relative with forward slashes. */
export class CodeLookup {
  readonly dir: string; readonly commit: string;
  readonly hasTsconfig: boolean; readonly tsconfigSha?: string;
  private files: string[] = [];
  private textCache = new Map<string, string | null>();
  private precise?: { svc: ts.LanguageService; names: Set<string> };
  private inferred?: { svc: ts.LanguageService; names: Set<string> };

  constructor(dir: string, commit: string) {
    this.dir = realpathSync(dir); this.commit = commit;
    this.walk(this.dir);
    const cfgPath = path.join(this.dir, 'tsconfig.json');
    this.hasTsconfig = this.files.includes('tsconfig.json');
    if (this.hasTsconfig) {
      this.tsconfigSha = sha256(readFileSync(cfgPath));
      const raw = ts.readConfigFile(cfgPath, (f) => this.read(f) ?? undefined);
      if (!raw.error) {
        const parsed = ts.parseJsonConfigFileContent(raw.config, this.host(), this.dir);
        // Repository compiler plugins and project references are DATA: never loaded, never built.
        const options: ts.CompilerOptions = { ...parsed.options, plugins: undefined, noEmit: true, composite: false, incremental: false, tsBuildInfoFile: undefined, skipLibCheck: true };
        const names = parsed.fileNames.filter((f) => this.inside(f));
        if (names.length) this.precise = { svc: this.service(options, names), names: new Set(names) };
      }
    }
    const js = this.files.filter((f) => JS_EXT.test(f)).map((f) => path.join(this.dir, f)).filter((f) => !this.precise?.names.has(f));
    if (js.length) {
      const options: ts.CompilerOptions = { allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
        maxNodeModuleJsDepth: 0, skipLibCheck: true, types: [], noResolve: false, resolveJsonModule: false };
      this.inferred = { svc: this.service(options, js), names: new Set(js) };
    }
  }

  /** Every regular file in the snapshot (no symlinks, no skipped directories), repository-relative. */
  listFiles(): readonly string[] { return this.files; }

  /** Which tier can answer for this file. */
  tierOf(rel: string): Tier {
    const abs = path.join(this.dir, rel);
    if (this.precise?.names.has(abs)) return 'precise';
    if (this.inferred?.names.has(abs)) return 'inferred';
    return 'text';
  }

  /** File text, or null when the file is missing, too large, binary, a symlink or outside the snapshot. */
  text(rel: string): string | null { return this.read(path.join(this.dir, rel)); }

  lines(rel: string, start: number, end: number): Snippet | null {
    const t = this.text(rel); if (t === null) return null; const ls = t.split('\n');
    const s = Math.max(1, start); const e = Math.min(ls.length, end); if (s > e) return null;
    return { path: rel, startLine: s, endLine: e, text: ls.slice(s - 1, e).join('\n') };
  }

  contentSha(rel: string): string | null { const t = this.text(rel); return t === null ? null : sha256(t); }

  sourceFile(rel: string): { sf: ts.SourceFile; svc: ts.LanguageService; tier: Tier } | null {
    const abs = path.join(this.dir, rel); const tier = this.tierOf(rel); const prog = tier === 'precise' ? this.precise : tier === 'inferred' ? this.inferred : undefined;
    const sf = prog?.svc.getProgram()?.getSourceFile(abs); return sf && prog ? { sf, svc: prog.svc, tier } : null;
  }

  /** Definitions of the symbol at (line, col) inside the snapshot (library and node_modules declarations are left out). */
  definitions(rel: string, pos: number): Site[] {
    const src = this.sourceFile(rel); if (!src) return [];
    const defs = src.svc.getDefinitionAtPosition(path.join(this.dir, rel), pos) ?? [];
    return defs.flatMap((d) => this.site(d.fileName, d.textSpan.start, src.tier));
  }

  /** References to the symbol at `pos`, definitions excluded. */
  references(rel: string, pos: number, limit = 50): Site[] {
    const src = this.sourceFile(rel); if (!src) return [];
    const out: Site[] = [];
    for (const g of src.svc.findReferences(path.join(this.dir, rel), pos) ?? []) for (const r of g.references) {
      if (r.isDefinition) continue; out.push(...this.site(r.fileName, r.textSpan.start, src.tier)); if (out.length >= limit) return out;
    }
    return out;
  }

  /** Exact-token search over text files. `exclude` drops files (usually the changed file itself). */
  search(token: string, o: { limit?: number; exclude?: Set<string> } = {}): Site[] {
    const out: Site[] = []; const limit = o.limit ?? 20;
    for (const f of this.files) {
      if (o.exclude?.has(f)) continue; const t = this.text(f); if (t === null) continue;
      let i = t.indexOf(token);
      while (i >= 0) {
        const lc = lineCol(t, i); out.push({ path: f, line: lc.line, col: lc.col, tier: 'text' });
        if (out.length >= limit) return out;
        i = t.indexOf(token, i + token.length); if (out.length && out[out.length - 1].path === f && out.filter((x) => x.path === f).length >= 3) break;   // at most 3 hits per file
      }
    }
    return out;
  }

  dispose() { this.precise?.svc.dispose(); this.inferred?.svc.dispose(); }

  // ---------- internals ----------
  private site(fileName: string, start: number, tier: Tier): Site[] {
    if (!this.inside(fileName)) return []; const rel = path.relative(this.dir, fileName).split(path.sep).join('/');
    if (rel.split('/').some((s) => SKIP_DIRS.has(s))) return [];
    const t = this.text(rel); if (t === null) return []; const lc = lineCol(t, start); return [{ path: rel, line: lc.line, col: lc.col, tier }];
  }

  private inside(p: string): boolean {
    const abs = path.resolve(p); if (abs !== this.dir && !abs.startsWith(this.dir + path.sep)) return false;
    try { if (lstatSync(abs).isSymbolicLink()) return false; return realpathSync(abs).startsWith(this.dir + path.sep); } catch { return false; }
  }

  private read(abs: string): string | null {
    if (this.textCache.has(abs)) return this.textCache.get(abs)!;
    let v: string | null = null;
    if (this.inside(abs)) {
      try { const st = lstatSync(abs); if (st.isFile() && st.size <= MAX_TEXT_FILE) { const b = readFileSync(abs); if (!b.subarray(0, 8000).includes(0)) v = b.toString('utf8'); } } catch { v = null; }
    }
    this.textCache.set(abs, v); return v;
  }

  private walk(d: string) {
    for (const n of readdirSync(d).sort()) {
      if (SKIP_DIRS.has(n)) continue; const f = path.join(d, n); const st = lstatSync(f);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) this.walk(f); else if (st.isFile()) this.files.push(path.relative(this.dir, f).split(path.sep).join('/'));
    }
  }

  private host(): ts.ParseConfigHost {
    return { useCaseSensitiveFileNames: true, readDirectory: (root, ext, exc, inc, depth) => ts.sys.readDirectory(root, ext, exc, inc, depth).filter((f) => this.inside(f)),
      fileExists: (f) => this.inside(f) && this.read(f) !== null, readFile: (f) => this.read(f) ?? undefined };
  }

  private service(options: ts.CompilerOptions, names: string[]): ts.LanguageService {
    const libDir = path.dirname(ts.getDefaultLibFilePath(options));
    const allowed = (f: string) => this.inside(f) || path.resolve(f).startsWith(libDir + path.sep);   // the pinned compiler's own lib files only
    const readAny = (f: string) => (this.inside(f) ? this.read(f) : allowed(f) ? (() => { try { return readFileSync(f, 'utf8'); } catch { return null; } })() : null);
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options, getScriptFileNames: () => names, getScriptVersion: () => '1',
      getScriptSnapshot: (f) => { const t = readAny(f); return t === null ? undefined : ts.ScriptSnapshot.fromString(t); },
      getCurrentDirectory: () => this.dir, getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (f) => allowed(f) && readAny(f) !== null, readFile: (f) => readAny(f) ?? undefined,
      directoryExists: (d) => allowed(d) && ts.sys.directoryExists(d), getDirectories: (d) => (allowed(d) ? ts.sys.getDirectories(d) : []),
      readDirectory: (root, ext, exc, inc, depth) => ts.sys.readDirectory(root, ext, exc, inc, depth).filter(allowed),
    };
    return ts.createLanguageService(host, ts.createDocumentRegistry());
  }
}

export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1, last = -1; for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) { line++; last = i; }
  return { line, col: offset - last };
}
export const isCode = (p: string) => CODE_EXT.test(p);
