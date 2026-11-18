// PROOF-lookup: compiler/language-service definitions + references with revision-bound citations,
// a viable SCIP comparison candidate, and which compiler/SDK/deployment-target checks can truly be supported.
// Run: node src/proofs/lookup.ts   -> results/lookup.json   (exit 1 on any required failure)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { fromBinary } from '@bufbuild/protobuf';
import { IndexSchema } from '@scip-code/scip';
import { check, finish, newReport, PROOF_ROOT, sh } from '../lib/report.ts';
import { LookupService, verifyCitation, type Citation } from '../lib/lookup.ts';
import { realpath, runGuarded, type ContainmentSpec } from '../lib/seatbelt.ts';

const FIXTURE = path.join(PROOF_ROOT, 'fixtures', 'lookup-repo');
const G = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@x.invalid', GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@x.invalid' } }).trim();
const tmp = () => realpath(mkdtempSync(path.join(os.tmpdir(), 'warden-lk-')));

/** Ground truth is hand-annotated in the fixture: "expect:<family>:<role>" on every line that binds to the symbol. */
function truthLines(dir: string, family: string): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (n === '.git' || n === 'node_modules') continue;
      if (existsSync(f) && readdirSync(path.dirname(f)).includes(n) && !n.includes('.') ) { try { walk(f); } catch { /* not a dir */ } continue; }
      if (!/\.(ts|js)$/.test(n)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => { for (const m of l.matchAll(/expect:([\w.]+):\w+/g)) if (m[1] === family) out.add(`${path.relative(dir, f)}:${i + 1}`); });
    }
  };
  walk(dir);
  return out;
}
const lineSet = (items: Citation[]) => new Set(items.map((c) => `${c.path}:${c.span.line}`));
const prf = (got: Set<string>, truth: Set<string>) => {
  const tp = [...got].filter((x) => truth.has(x)).length;
  return { precision: got.size ? +(tp / got.size).toFixed(2) : 0, recall: truth.size ? +(tp / truth.size).toFixed(2) : 0, got: got.size, truth: truth.size, falsePositives: [...got].filter((x) => !truth.has(x)).sort(), missed: [...truth].filter((x) => !got.has(x)).sort() };
};
function textGrepBaseline(dir: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => { for (const n of readdirSync(d)) { const f = path.join(d, n); if (n === '.git') continue; try { walk(f); continue; } catch { /* file */ } if (/\.(ts|js)$/.test(n)) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) out.add(`${path.relative(dir, f)}:${i + 1}`); }); } };
  walk(dir);
  return out;
}

async function main() {
  const report = newReport('PROOF-lookup', 'lookup', {
    fixture: path.relative(PROOF_ROOT, FIXTURE),
    baseline: 'TypeScript LanguageService (stable JS API), pinned',
    candidates: 'scip-typescript (run + decoded), CodeGraphContext (identified), GSD Atlas (identified, pinned)',
    groundTruth: 'hand-annotated "expect:<family>:<role>" tags in fixture source (independent of any tool)',
  });
  report.versions = {
    typescript: ts.version,
    typescriptNativeLatest: '7.0.2 exists; its programmatic API is "unstable/*" - not adopted for the P3 baseline',
    scipTypescript: JSON.parse(readFileSync(path.join(PROOF_ROOT, 'node_modules/@sourcegraph/scip-typescript/package.json'), 'utf8')).version,
    scipBindings: JSON.parse(readFileSync(path.join(PROOF_ROOT, 'node_modules/@scip-code/scip/package.json'), 'utf8')).version,
    swiftc: sh('swiftc', ['--version']).split('\n')[0],
    xcodeSdk: sh('xcrun', ['--show-sdk-version']),
    node: process.version,
  };

  const base = tmp();
  const repo = path.join(base, 'repo');
  cpSync(FIXTURE, repo, { recursive: true });
  G(repo, 'init', '-q'); G(repo, 'add', '-A'); G(repo, 'commit', '-qm', 'r1');
  const R1 = G(repo, 'rev-parse', 'HEAD');

  // ---------------------------------------------------------------- definitions / references
  const t0 = performance.now();
  const svc = new LookupService(repo, 'warden-fixture/core');
  const buildMs = Math.round(performance.now() - t0);
  const ifaceAppend = svc.findIdentifier('src/ledger.ts', 'append', (n) => ts.isMethodSignature(n.parent));
  const refs = svc.references('src/ledger.ts', ifaceAppend);
  const truthAppend = truthLines(repo, 'LedgerStore.append');
  const compilerAppend = prf(lineSet(refs.items), truthAppend);
  const grepAppend = prf(textGrepBaseline(repo, /\bappend\b/), truthAppend);
  check(report, { id: 'G1-references-precise', claim: 'findReferences(LedgerStore.append) matches the hand-annotated ground truth exactly within the program (interface decl, 2 implementations, 2 call sites); same-named unrelated functions, comments and strings excluded', expected: 'precision 1.0, recall 1.0 over files in the program', observed: { compiler: compilerAppend, textGrepBaseline: { precision: grepAppend.precision, recall: grepAppend.recall, falsePositives: grepAppend.falsePositives } }, pass: compilerAppend.precision === 1 && compilerAppend.recall === 1 });
  check(report, { id: 'G2-text-search-is-not-enough', claim: 'text search baseline over the same repo is measurably worse (false positives from decoys) - justifies compiler-backed lookup', expected: 'grep precision < 1', observed: { grepPrecision: grepAppend.precision, grepFalsePositives: grepAppend.falsePositives.length }, pass: grepAppend.precision < 1 });
  // honesty: ground truth includes generated/stale.ts? it is outside the program -> must be labelled
  check(report, { id: 'G3-coverage-gap-labelled', claim: 'files outside the compiler program (generated/stale.ts, which also implements LedgerStore) are reported as coverage gaps so the reference set is labelled incomplete rather than silently trusted', expected: 'coverage.complete=false listing generated/stale.ts', observed: refs.coverage, pass: !refs.coverage.complete && refs.coverage.outsideProgram.includes('generated/stale.ts') });
  let unsupportedThrown = false;
  try { svc.findIdentifier('generated/stale.ts', 'append'); } catch { unsupportedThrown = true; }
  check(report, { id: 'G3b-unsupported-file-refused', claim: 'asking for lookup inside a file outside the program is refused (unsupported), not answered heuristically as if precise', expected: 'refusal', observed: { refused: unsupportedThrown }, pass: unsupportedThrown });

  const callRec = svc.findIdentifier('src/ledger.ts', 'append', (n) => ts.isPropertyAccessExpression(n.parent) && ts.isAwaitExpression(n.parent.parent.parent));
  const defAtCall = svc.definitions('src/ledger.ts', callRec);
  const callCli = svc.findIdentifier('src/cli.ts', 'append', (n) => ts.isPropertyAccessExpression(n.parent));
  const defAtCli = svc.definitions('src/cli.ts', callCli);
  const impls = svc.implementations('src/ledger.ts', ifaceAppend);
  const implLines = [...lineSet(impls.items)].sort();
  const truthImpl = [...truthLines(repo, 'LedgerStore.append')].filter(() => true);
  // Expected lines come from the fixture's hand-written tags (def / impl roles), asserted here so they cannot silently drift.
  const expectDefAtCall = ['src/ledger.ts:5'];
  const expectDefAtCli = ['src/ledger.ts:11'];
  const tagsOk = [...expectDefAtCall, ...expectDefAtCli, 'src/ledger.ts:19'].every((l) => truthAppend.has(l));
  check(report, { id: 'G3c-truth-tags-consistent', claim: 'hand-annotated ground-truth tags cover the lines used as expectations (self-check of the fixture)', expected: 'tags present', observed: { tagsOk, truthImpl }, pass: tagsOk });
  check(report, { id: 'G4-definition-at-call-sites', claim: 'definition from `store.append(...)` (interface-typed) resolves to the interface member; from `ledger.append(...)` (MemoryLedger-typed, in another file) resolves to MemoryLedger.append - not to the unrelated local append() or legacy/util.js', expected: `${expectDefAtCall} and ${expectDefAtCli}`, observed: { interfaceTyped: [...lineSet(defAtCall.items)], concreteTyped: [...lineSet(defAtCli.items)] }, pass: JSON.stringify([...lineSet(defAtCall.items)]) === JSON.stringify(expectDefAtCall) && JSON.stringify([...lineSet(defAtCli.items)]) === JSON.stringify(expectDefAtCli) });
  check(report, { id: 'G5-implementations', claim: 'getImplementation on the interface member returns exactly MemoryLedger.append and FileLedger.append (the generated/stale.ts one is outside the program and labelled by G3)', expected: 'src/ledger.ts:11, src/ledger.ts:19', observed: implLines, pass: JSON.stringify(implLines) === JSON.stringify(['src/ledger.ts:11', 'src/ledger.ts:19']) });
  const entryPos = svc.findIdentifier('src/types.ts', 'Entry', (n) => ts.isInterfaceDeclaration(n.parent));
  const entryRefs = svc.references('src/types.ts', entryPos);
  const entryScore = prf(lineSet(entryRefs.items), truthLines(repo, 'Entry'));
  check(report, { id: 'G6-type-references-across-files', claim: 'type references to the Entry interface across imports, re-exports and annotations match ground truth (precision and recall 1.0)', expected: '1.0 / 1.0', observed: entryScore, pass: entryScore.precision === 1 && entryScore.recall === 1 });

  // ---------------------------------------------------------------- revision binding
  const all = [...refs.items, ...defAtCall.items, ...defAtCli.items, ...impls.items, ...entryRefs.items];
  const atRev = all.map((c) => verifyCitation(repo, c, 'cited-revision'));
  const complete = all.every((c) => c.commit === R1 && !c.dirty && c.contentSha256.length === 64 && c.span.end > c.span.start && c.compiler.typescript === ts.version);
  check(report, { id: 'G7-citations-carry-revision', claim: `all ${all.length} citations carry repo, commit ${R1.slice(0, 10)}, content sha256, span, compiler version, tsconfig hash and precision label`, expected: 'every field present, commit = R1, clean tree', observed: { sample: all[0], count: all.length }, pass: complete });
  check(report, { id: 'G8-citations-verify-at-cited-revision', claim: 'a consumer re-reads each citation from `git show <commit>:<path>` and the hash and span text verify (independent of the tool that produced them)', expected: 'all verified', observed: atRev.reduce((a, v) => ({ ...a, [v.status]: (a[v.status] ?? 0) + 1 }), {} as Record<string, number>), pass: atRev.every((v) => v.status === 'verified') });

  // new revision: edit ledger.ts (shift lines + add a call site), commit, re-verify OLD citations against the NEW tree
  const ledgerPath = path.join(repo, 'src/ledger.ts');
  writeFileSync(ledgerPath, '// header added in r2\n' + readFileSync(ledgerPath, 'utf8') + '\nexport async function again(s: LedgerStore, e: Entry) { await s.append(e); }\n');
  const dirtySvc = new LookupService(repo, 'warden-fixture/core');
  const dirtyRefs = dirtySvc.references('src/ledger.ts', dirtySvc.findIdentifier('src/ledger.ts', 'append', (n) => ts.isMethodSignature(n.parent)));
  check(report, { id: 'G9-dirty-tree-flagged', claim: 'lookup on an uncommitted working tree is flagged dirty=true (citations are bound to content hash, not a clean commit)', expected: 'dirty=true on all', observed: { dirty: dirtyRefs.items.every((c) => c.dirty), commit: dirtyRefs.items[0].commit?.slice(0, 10) }, pass: dirtyRefs.items.every((c) => c.dirty) });
  dirtySvc.dispose();
  G(repo, 'add', '-A'); G(repo, 'commit', '-qm', 'r2');
  const R2 = G(repo, 'rev-parse', 'HEAD');
  const vs = all.map((c) => ({ file: c.path, v: verifyCitation(repo, c, 'current-worktree') }));
  const staleFiles = [...new Set(vs.filter((x) => x.v.status === 'stale').map((x) => x.file))].sort();
  const okFiles = [...new Set(vs.filter((x) => x.v.status === 'verified').map((x) => x.file))].sort();
  check(report, { id: 'G10-stale-detection', claim: 'after a new revision, old citations into the edited file are detected STALE by content hash while citations into untouched files still verify', expected: 'stale: src/ledger.ts ; verified: src/cli.ts, src/types.ts', observed: { staleFiles, okFiles }, pass: staleFiles.length === 1 && staleFiles[0] === 'src/ledger.ts' && okFiles.includes('src/cli.ts') && okFiles.includes('src/types.ts') });
  const svc2 = new LookupService(repo, 'warden-fixture/core');
  const refs2 = svc2.references('src/ledger.ts', svc2.findIdentifier('src/ledger.ts', 'append', (n) => ts.isMethodSignature(n.parent)));
  const v2 = refs2.items.map((c) => verifyCitation(repo, c, 'cited-revision'));
  check(report, { id: 'G11-rebinding-to-new-revision', claim: 'a fresh lookup at r2 is bound to commit r2, includes the new call site and the shifted line numbers, and verifies', expected: 'commit=R2, reference count +1, all verified', observed: { commit: refs2.items[0].commit?.slice(0, 10), r2: R2.slice(0, 10), refsBefore: refs.items.length, refsAfter: refs2.items.length, verify: v2.map((v) => v.status) }, pass: refs2.items.every((c) => c.commit === R2) && refs2.items.length === refs.items.length + 1 && v2.every((v) => v.status === 'verified') });
  check(report, { id: 'G12-latency-and-memory', claim: 'INFORMATIONAL: measured cost on this Mac', expected: 'informational', observed: { programBuildMs: buildMs, referencesMs: refs.ms, definitionMs: defAtCall.ms, rssMB: Math.round(process.memoryUsage().rss / 2 ** 20), files: svc.program().getSourceFiles().filter((f) => !f.fileName.includes('/node_modules/') && !/lib\..*\.d\.ts$/.test(f.fileName)).length }, pass: true, severity: 'informational' });
  svc.dispose(); svc2.dispose();

  // ---------------------------------------------------------------- SCIP comparison candidate (run contained)
  {
    const ws = path.join(base, 'scip-ws'); mkdirSync(ws);
    const scratch = path.join(base, 'scip-scratch'); mkdirSync(scratch);
    cpSync(FIXTURE, path.join(ws, 'repo'), { recursive: true });
    const spec: ContainmentSpec = { workspace: ws, workspaceWritable: true, scratch, readonlyPaths: [path.join(PROOF_ROOT, 'node_modules')] };
    const t1 = performance.now();
    let r;
    try {
      r = await runGuarded(spec, process.execPath, [path.join(PROOF_ROOT, 'node_modules/@sourcegraph/scip-typescript/dist/src/main.js'), 'index', '--cwd', path.join(ws, 'repo'), '--output', path.join(ws, 'index.scip'), '--no-progress-bar'], { timeoutMs: 120000 });
    } catch (e) { r = { code: -1, stdout: '', stderr: String(e), timedOut: false, durationMs: 0 } as any; }
    const scipMs = Math.round(performance.now() - t1);
    const idxFile = path.join(ws, 'index.scip');
    let decoded: any = null;
    if (existsSync(idxFile)) decoded = fromBinary(IndexSchema, readFileSync(idxFile));
    const docs = decoded?.documents?.map((d: any) => d.relativePath).sort() ?? [];
    // A consumer joins SCIP "implementation" relationships to build the same family the compiler walks natively.
    const iface = (decoded?.documents ?? []).flatMap((d: any) => d.symbols).find((s: any) => /LedgerStore#append\(\)\.$/.test(s.symbol))?.symbol as string | undefined;
    const appendSyms = new Set<string>(iface ? [iface] : []);
    for (const d of decoded?.documents ?? []) for (const s of d.symbols) if (s.relationships?.some((rel: any) => rel.isImplementation && rel.symbol === iface)) appendSyms.add(s.symbol);
    const occLines: string[] = [];
    for (const d of decoded?.documents ?? []) for (const o of d.occurrences) if (appendSyms.has(o.symbol)) occLines.push(`${d.relativePath}:${o.range[0] + 1}`);
    const scipScore = prf(new Set(occLines), truthLines(FIXTURE, 'LedgerStore.append')); /* index was built from the pristine fixture (r1 line numbers) */
    check(report, { id: 'G13-scip-candidate-runs-contained', claim: 'scip-typescript (pinned) indexes the fixture INSIDE the Seatbelt boundary (no network, read-only toolchain) and the SCIP index decodes with the published bindings', expected: 'exit 0, index decodes, documents listed', observed: { exit: r.code, ms: scipMs, documents: docs, stderr: r.stderr.slice(0, 200) }, pass: r.code === 0 && docs.includes('src/ledger.ts') && docs.includes('src/cli.ts') });
    check(report, { id: 'G14-scip-symbol-occurrences', claim: 'SCIP occurrences for the LedgerStore#append() symbol are extracted (a query consumer is feasible); compared with the same ground truth - INFORMATIONAL for the P3 comparison, not an endorsement', expected: 'informational', observed: { symbols: [...appendSyms], occurrences: scipScore, note: 'SCIP symbol for the interface member and each implementation differ; reference-through-implementation needs a consumer that joins relationships' }, pass: appendSyms.size > 0, severity: 'informational' });
  }
  report.inputs.comparisonCandidates = {
    compilerBaseline: `typescript@${ts.version} LanguageService - measured above`,
    scip: `@sourcegraph/scip-typescript@${report.versions.scipTypescript} + @scip-code/scip@${report.versions.scipBindings} (Apache-2.0) - ran contained, decoded`,
    codeGraphContext: 'codegraphcontext 0.6.13 on PyPI (MIT, Python>=3.10) - IDENTIFIED ONLY: not installed or run (Python/graph-DB footprint; tree-sitter derived => label heuristic). Unverified.',
    atlas: (() => { try { return `@opengsd/gsd-atlas ${JSON.parse(readFileSync(path.join(os.homedir(), 'projects/gsd-atlas/package.json'), 'utf8')).version} @ ${sh('git', ['-C', path.join(os.homedir(), 'projects/gsd-atlas'), 'rev-parse', '--short', 'HEAD'])} (open-gsd/gsd-atlas) - IDENTIFIED/PINNED ONLY: not run in P0 (full comparison is P3)`; } catch { return 'gsd-atlas checkout not found'; } })(),
  };

  // ---------------------------------------------------------------- compiler/SDK/deployment-target checks
  const matrix: Array<{ check: string; language: string; status: 'supported' | 'unsupported' | 'unverified'; evidence: unknown }> = [];

  // TS: lib/target floor
  const sdkDir = path.join(base, 'sdk-ts'); mkdirSync(path.join(sdkDir, 'src'), { recursive: true });
  writeFileSync(path.join(sdkDir, 'src/a.ts'), 'export const sorted = [3, 1, 2].toSorted();\n');
  const diag = (cfg: ts.CompilerOptions, files: string[]) => {
    const p = ts.createProgram(files, cfg);
    return ts.getPreEmitDiagnostics(p).map((d) => ({ code: d.code, text: ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 110) }));
  };
  const base23 = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, types: [] as string[], skipLibCheck: true };
  const dLow = diag({ ...base23, lib: ['lib.es2022.d.ts'] }, [path.join(sdkDir, 'src/a.ts')]);
  const dHigh = diag({ ...base23, lib: ['lib.es2023.d.ts'] }, [path.join(sdkDir, 'src/a.ts')]);
  const libOk = dLow.some((d) => d.code === 2550) && dHigh.length === 0;
  check(report, { id: 'G15-ts-lib-floor', claim: 'TypeScript enforces a runtime-API floor via compiler lib: Array.prototype.toSorted is rejected under lib ES2022 (TS2550) and accepted under ES2023', expected: 'ES2022 -> TS2550, ES2023 -> 0 diagnostics', observed: { es2022: dLow, es2023: dHigh }, pass: libOk });
  matrix.push({ check: 'runtime API floor via tsconfig lib/target', language: 'TypeScript/JavaScript(checkJs)', status: libOk ? 'supported' : 'unverified', evidence: 'G15' });

  // TS: Node engine floor via @types/node major (installed with --ignore-scripts, types only)
  const nodeFloor = (v: string) => {
    const d = path.join(base, `sdk-node${v}`); mkdirSync(path.join(d, 'src'), { recursive: true });
    writeFileSync(path.join(d, 'package.json'), '{"name":"x","private":true,"type":"module"}');
    const inst = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--silent', `@types/node@${v}`], { cwd: d, encoding: 'utf8', timeout: 120000 });
    writeFileSync(path.join(d, 'src/g.ts'), "import { glob } from 'node:fs';\nexport const g = glob;\n");
    const cfg: ts.CompilerOptions = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, lib: ['lib.es2022.d.ts'], types: ['node'], typeRoots: [path.join(d, 'node_modules', '@types')], skipLibCheck: true };
    return { install: inst.status, diags: diag(cfg, [path.join(d, 'src/g.ts')]) };
  };
  const n18 = nodeFloor('18.19.130'); const n26 = nodeFloor('26.6.6');
  const nodeOk = n18.install === 0 && n26.install === 0 && n18.diags.length > 0 && n26.diags.length === 0;
  check(report, { id: 'G16-node-engine-floor', claim: 'deployment-target check for Node: node:fs.glob (Node ≥22) fails type-check against @types/node@18 (engines floor 18) and passes against @types/node@26', expected: '18 -> diagnostics, 26 -> none', observed: { node18: n18, node26: n26 }, pass: nodeOk });
  matrix.push({ check: 'Node API availability vs engines floor via matching @types/node', language: 'TypeScript', status: nodeOk ? 'supported' : 'unverified', evidence: 'G16 (requires installing a types package: do it outside repo code, --ignore-scripts, pinned)' });

  // TS: deprecated API usage
  const depDir = path.join(base, 'sdk-dep'); mkdirSync(depDir, { recursive: true });
  writeFileSync(path.join(depDir, 'sdk.d.ts'), '/** @deprecated use newThing */ export declare function oldThing(): void;\nexport declare function newThing(): void;\n');
  writeFileSync(path.join(depDir, 'use.ts'), "import { oldThing } from './sdk';\noldThing();\n");
  const depProg = ts.createProgram([path.join(depDir, 'use.ts')], { noEmit: true, strict: true, types: [] });
  const sugg = ts.createLanguageService({ getCompilationSettings: () => ({ noEmit: true, strict: true, types: [] }), getScriptFileNames: () => [path.join(depDir, 'use.ts')], getScriptVersion: () => '1', getScriptSnapshot: (f) => existsSync(f) ? ts.ScriptSnapshot.fromString(readFileSync(f, 'utf8')) : undefined, getCurrentDirectory: () => depDir, getDefaultLibFileName: ts.getDefaultLibFilePath, fileExists: ts.sys.fileExists, readFile: ts.sys.readFile }).getSuggestionDiagnostics(path.join(depDir, 'use.ts')).map((d) => ({ code: d.code, text: ts.flattenDiagnosticMessageText(d.messageText, ' ') }));
  void depProg;
  check(report, { id: 'G17-ts-deprecated-api', claim: 'use of an SDK API marked @deprecated is detected as a compiler suggestion diagnostic (TS6385)', expected: 'code 6385', observed: sugg, pass: sugg.some((d) => d.code === 6385) });
  matrix.push({ check: 'deprecated SDK API usage (@deprecated)', language: 'TypeScript', status: sugg.some((d) => d.code === 6385) ? 'supported' : 'unverified', evidence: 'G17' });

  // Swift: deployment target vs SDK availability, compiled INSIDE the boundary
  {
    const ws = path.join(base, 'swift-ws'); mkdirSync(ws);
    const scratch = path.join(base, 'swift-scratch'); mkdirSync(scratch);
    writeFileSync(path.join(ws, 'a.swift'), 'let r = try! Regex("a+")\nprint(r)\n');
    const dev = sh('xcode-select', ['-p']);
    const sdk = sh('xcrun', ['--show-sdk-path']);
    const spec: ContainmentSpec = { workspace: ws, workspaceWritable: true, scratch, readonlyPaths: [path.resolve(dev, '..', '..'), '/Library/Developer', '/Library/Apple'].filter(existsSync), /* Xcode.app toolchain + frameworks, read-only */ env: { DEVELOPER_DIR: dev, SDKROOT: sdk, PATH: `${dev}/usr/bin:/usr/bin:/bin`, CLANG_MODULE_CACHE_PATH: path.join(scratch, 'mc'), SWIFT_MODULE_CACHE_PATH: path.join(scratch, 'mc') } };
    const swiftc = sh('xcrun', ['--find', 'swiftc']);
    const run = async (target: string) => runGuarded(spec, swiftc, ['-typecheck', '-sdk', sdk, '-target', target, '-module-cache-path', path.join(scratch, 'mc'), 'a.swift'], { timeoutMs: 180000 });
    let low: any, high: any;
    try { low = await run('arm64-apple-macos12.0'); high = await run('arm64-apple-macos14.0'); } catch (e) { low = high = { code: -1, stderr: String(e), stdout: '' }; }
    const lowMsg = (low.stderr + low.stdout).split('\n').find((l: string) => /only available in macOS/.test(l)) ?? (low.stderr + low.stdout).slice(0, 200);
    const swiftOk = low.code !== 0 && /only available in macOS 13/.test(lowMsg) && high.code === 0;
    check(report, { id: 'G18-swift-deployment-target', claim: 'Apple deployment-target check: swiftc -typecheck (run inside the boundary) rejects Regex (macOS 13+) with -target macos12 and accepts it with macos14', expected: 'macos12 -> "only available in macOS 13.0", macos14 -> exit 0', observed: { macos12: { exit: low.code, msg: lowMsg.slice(0, 160) }, macos14: { exit: high.code, stderr: (high.stderr ?? '').slice(0, 160) } }, pass: swiftOk });
    matrix.push({ check: 'Apple SDK availability vs deployment target (swiftc -typecheck -target)', language: 'Swift (no macro plugins)', status: swiftOk ? 'supported' : 'unverified', evidence: 'G18; Swift macros/plugins execute code and were not proven under nested sandboxing' });
  }
  for (const [lang, why] of [
    ['Python', 'no checker proven (mypy/pyright not run); no deployment-target model'],
    ['Go / Rust / Kotlin / Java / C#', 'toolchains not installed or exercised in P0'],
    ['Swift macros / SwiftPM plugins / Xcode build phases', 'execute arbitrary code; nested Seatbelt not proven; blocked until proven'],
    ['TypeScript compiler plugins (tsconfig "plugins", ts-patch) and repo-supplied TypeScript versions', 'would run repo code; must never be loaded - pinned compiler only (this proof uses the pinned compiler)'],
    ['Lookup through SCIP/CodeGraphContext/Atlas as authority', 'comparison is P3; retrieval never grants authority or a passing verification gate'],
  ] as const) matrix.push({ check: 'mandatory verification', language: lang, status: 'unsupported', evidence: why });
  report.inputs.supportMatrix = matrix;
  check(report, { id: 'G19-unsupported-is-explicit', claim: 'the support matrix names unsupported/unverified languages and checks explicitly (unsupported mandatory checks must block, never pass implicitly)', expected: 'matrix has supported and unsupported rows', observed: { supported: matrix.filter((m) => m.status === 'supported').length, unsupported: matrix.filter((m) => m.status === 'unsupported').length }, pass: matrix.some((m) => m.status === 'supported') && matrix.some((m) => m.status === 'unsupported') });

  rmSync(base, { recursive: true, force: true });
  finish(report, 'lookup.json');
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
