// Compiler-backed lookup spike (TypeScript LanguageService, pinned 6.0.3) with revision-bound citations.
// Evidence harness, not a production module.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface Span { start: number; end: number; line: number; col: number }
export interface Citation {
  repo: string;
  commit: string | null;
  dirty: boolean;
  path: string;
  contentSha256: string;
  span: Span;
  text: string;
  kind: 'definition' | 'reference' | 'implementation';
  precision: 'precise' | 'heuristic';
  compiler: { typescript: string; tsconfigSha256: string; target: string; libs: string[]; allowJs: boolean };
}

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const git = (dir: string, args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();

export function repoRevision(dir: string): { commit: string | null; dirty: boolean } {
  try { return { commit: git(dir, ['rev-parse', 'HEAD']), dirty: git(dir, ['status', '--porcelain']).length > 0 }; } catch { return { commit: null, dirty: true }; }
}

export interface QueryResult { items: Citation[]; coverage: { complete: boolean; outsideProgram: string[] }; ms: number }

export class LookupService {
  readonly dir: string;
  readonly repo: string;
  private svc: ts.LanguageService;
  private cfg: ts.ParsedCommandLine;
  private versions = new Map<string, number>();
  private cache = new Map<string, { v: number; text: string }>();
  readonly rev: { commit: string | null; dirty: boolean };
  readonly tsconfigSha: string;

  constructor(dir: string, repoName: string) {
    this.dir = dir; this.repo = repoName;
    this.rev = repoRevision(dir);
    const cfgPath = path.join(dir, 'tsconfig.json');
    this.tsconfigSha = sha256(readFileSync(cfgPath));
    const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
    this.cfg = ts.parseJsonConfigFileContent(raw.config, ts.sys, dir);
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => this.cfg.options,
      getScriptFileNames: () => this.cfg.fileNames,
      getScriptVersion: (f) => String(this.versions.get(f) ?? 0),
      getScriptSnapshot: (f) => { if (!existsSync(f)) return undefined; return ts.ScriptSnapshot.fromString(readFileSync(f, 'utf8')); },
      getCurrentDirectory: () => dir,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
    };
    this.svc = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  private abs(p: string) { return path.isAbsolute(p) ? p : path.join(this.dir, p); }
  private rel(p: string) { return path.relative(this.dir, p); }
  program() { return this.svc.getProgram()!; }
  inProgram(p: string) { return !!this.program().getSourceFile(this.abs(p)); }

  /** Source files (ts/tsx/js) in the repo that the compiler program does NOT cover - lookups cannot be complete for them. */
  outsideProgram(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules' || n === '.git') continue;
        const f = path.join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(n) && !this.inProgram(f)) out.push(this.rel(f));
      }
    };
    walk(this.dir);
    return out.sort();
  }

  /** Find the Nth identifier named `name` in a file whose parent satisfies `where` (AST, not text). */
  findIdentifier(file: string, name: string, where: (n: ts.Identifier) => boolean = () => true): number {
    const sf = this.program().getSourceFile(this.abs(file));
    if (!sf) throw new Error(`file not in program: ${file}`);
    let pos = -1;
    const visit = (n: ts.Node) => {
      if (pos >= 0) return;
      if (ts.isIdentifier(n) && n.text === name && where(n)) { pos = n.getStart(sf); return; }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (pos < 0) throw new Error(`identifier ${name} not found in ${file}`);
    return pos;
  }

  private cite(file: string, start: number, length: number, kind: Citation['kind']): Citation {
    const abs = this.abs(file);
    const bytes = readFileSync(abs);
    const text = bytes.toString('utf8');
    const lc = ts.getLineAndCharacterOfPosition(ts.createSourceFile(file, text, ts.ScriptTarget.Latest), start);
    return {
      repo: this.repo, commit: this.rev.commit, dirty: this.rev.dirty, path: this.rel(abs), contentSha256: sha256(bytes),
      span: { start, end: start + length, line: lc.line + 1, col: lc.character + 1 }, text: text.slice(start, start + length), kind, precision: 'precise',
      compiler: { typescript: ts.version, tsconfigSha256: this.tsconfigSha, target: ts.ScriptTarget[this.cfg.options.target ?? 0], libs: (this.cfg.options.lib ?? []).map(String), allowJs: !!this.cfg.options.allowJs },
    };
  }

  private done(items: Citation[], t0: number): QueryResult {
    const outside = this.outsideProgram();
    return { items, coverage: { complete: outside.length === 0, outsideProgram: outside }, ms: Math.round(performance.now() - t0) };
  }

  definitions(file: string, pos: number): QueryResult {
    const t0 = performance.now();
    const defs = this.svc.getDefinitionAtPosition(this.abs(file), pos) ?? [];
    return this.done(defs.map((d) => this.cite(d.fileName, d.textSpan.start, d.textSpan.length, 'definition')), t0);
  }
  implementations(file: string, pos: number): QueryResult {
    const t0 = performance.now();
    const impls = this.svc.getImplementationAtPosition(this.abs(file), pos) ?? [];
    return this.done(impls.map((d) => this.cite(d.fileName, d.textSpan.start, d.textSpan.length, 'implementation')), t0);
  }
  references(file: string, pos: number): QueryResult {
    const t0 = performance.now();
    const groups = this.svc.findReferences(this.abs(file), pos) ?? [];
    const items: Citation[] = [];
    for (const g of groups) for (const r of g.references) items.push(this.cite(r.fileName, r.textSpan.start, r.textSpan.length, r.isDefinition ? 'definition' : 'reference'));
    return this.done(items, t0);
  }
  dispose() { this.svc.dispose(); }
}

// ---------- citation verification (consumer side: never trust a citation, re-read the bytes) ----------
export type Verification = { status: 'verified' | 'stale' | 'mismatch' | 'unverifiable'; reason?: string };

/** Re-reads the cited bytes (at the cited commit when given, else the working tree) and checks hash + span text. */
export function verifyCitation(dir: string, c: Citation, against: 'cited-revision' | 'current-worktree'): Verification {
  let bytes: Buffer;
  try {
    bytes = against === 'cited-revision' && c.commit
      ? execFileSync('git', ['show', `${c.commit}:${c.path}`], { cwd: dir, maxBuffer: 64 * 1024 * 1024 })
      : readFileSync(path.join(dir, c.path));
  } catch (e) { return { status: 'unverifiable', reason: `cannot read ${c.path} @ ${against}: ${(e as Error).message.split('\n')[0]}` }; }
  if (sha256(bytes) !== c.contentSha256) return { status: 'stale', reason: `content hash changed for ${c.path}` };
  if (bytes.toString('utf8').slice(c.span.start, c.span.end) !== c.text) return { status: 'mismatch', reason: 'span text differs from cited text' };
  return { status: 'verified' };
}
