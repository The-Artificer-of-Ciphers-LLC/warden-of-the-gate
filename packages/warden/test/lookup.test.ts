import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { snapshotFromClone } from '../src/lookup/checkout.ts';
import { CodeLookup } from '../src/lookup/service.ts';
import { lookupProvider } from '../src/lookup/provider.ts';
import { buildContext, parsePatch, renderContext, tokens } from '../src/review/context.ts';
import { FakeWorld } from '../src/github/fake.ts';
import { runReview } from '../src/review/slice.ts';
import type { ReviewConfig, ReviewRecord } from '../src/review/slice.ts';
import { runReplay } from '../src/replay/replay.ts';
import type { AgentRunner, PreflightReport, SessionRequest, SessionResult } from '../src/runner/agent-runner.ts';

/** Offline evidence for the reviewer's code lookup (docs/adr/0013-code-lookup.md): tiers, containment, citations, ranking and budget, and how the review slice and
 *  replay carry the pack. The fixture is a real git repository; no network and no model. */
const g = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
const put = (root: string, rel: string, text: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'warden-lookup-fx-')); g(repo, 'init', '-q', '-b', 'main');
  put(repo, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'commonjs' }, include: ['src/**/*.ts'] }));
  put(repo, 'src/parse.ts', 'export function readCount(raw: string): string {\n  return raw.trim();\n}\n');
  put(repo, 'src/ratchet.ts', "import { readCount } from './parse';\n\nexport function ratchet(raw: string, cur: number): number {\n  const v = readCount(raw);\n  return typeof v === 'number' ? Math.max(v, cur) : cur;\n}\n");
  put(repo, 'src/use.ts', "import { ratchet } from './ratchet';\n\nexport const next = ratchet('5', 3);\n");
  put(repo, 'lib/helpers.cjs', "function cleanupDir(d) {\n  return d;\n}\nfunction legacyGuard(x) {\n  return x;\n}\nmodule.exports = { cleanupDir, legacyGuard };\n");
  put(repo, 'lib/caller.cjs', "const { legacyGuard } = require('./helpers.cjs');\nmodule.exports = () => legacyGuard(1);\n");
  put(repo, 'tests/dir.test.cjs', "const fs = require('node:fs');\nconst { cleanupDir } = require('../lib/helpers.cjs');\nfunction afterEachHook(d) {\n  cleanupDir(d);\n  fs.rmSync(d);\n  return d;\n}\nmodule.exports = { afterEachHook };\n");
  put(repo, 'eslint-rules/no-raw-rmsync-in-tests.cjs', "// Forbids fs.rmSync in tests: use helpers.cleanup so Windows EBUSY is retried.\nmodule.exports = { create: () => ({}) };\n");
  put(repo, 'scripts/gen-registry.cjs', "const built = require('../dist/registry.cjs');\nconsole.log(built);\n");
  put(repo, 'package.json', JSON.stringify({ name: 'fx', scripts: { version: 'node scripts/gen-registry.cjs --write' } }, null, 2) + '\n');
  put(repo, 'docs/flow.md', 'Run with ${TDD_APPLICABLE} set.\n');
  symlinkSync('/etc/hostname', join(repo, 'leak.cjs'));
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'fixture');
  return { repo, head: g(repo, 'rev-parse', 'HEAD'), cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

test('snapshot: one revision, tracked content only, read-only; a revision missing from the clone is reported and nothing is fetched', () => {
  const fx = fixture();
  try {
    const s = snapshotFromClone(fx.repo, fx.head);
    try {
      assert.equal(s.commit, fx.head); assert.ok(!statSync(join(s.dir, 'src/parse.ts')).mode.toString(8).endsWith('6'), 'files are read-only');
      assert.throws(() => statSync(join(s.dir, '.git')), 'no .git in the snapshot');
    } finally { s.dispose(); }
    assert.throws(() => snapshotFromClone(fx.repo, 'f'.repeat(40)), /not in the local clone/);
  } finally { fx.cleanup(); }
});

test('lookup tiers: precise inside the tsconfig, inferred for other JavaScript, text otherwise; symlinks are never read', () => {
  const fx = fixture(); const s = snapshotFromClone(fx.repo, fx.head); const lk = new CodeLookup(s.dir, s.commit);
  try {
    assert.equal(lk.tierOf('src/ratchet.ts'), 'precise'); assert.equal(lk.tierOf('lib/helpers.cjs'), 'inferred'); assert.equal(lk.tierOf('docs/flow.md'), 'text');
    assert.ok(!lk.listFiles().includes('leak.cjs')); assert.equal(lk.text('leak.cjs'), null);
    const src = readFileSync(join(s.dir, 'src/ratchet.ts'), 'utf8'); const d = lk.definitions('src/ratchet.ts', src.indexOf('readCount(raw)'));
    assert.deepEqual(d.map((x) => [x.path, x.line, x.tier]), [['src/parse.ts', 1, 'precise']]);
    const js = readFileSync(join(s.dir, 'lib/caller.cjs'), 'utf8'); const dj = lk.definitions('lib/caller.cjs', js.lastIndexOf('legacyGuard'));
    assert.ok(dj.some((x) => x.tier === 'inferred'), 'CommonJS require resolved by the inferred program');
    const refs = lk.references('src/ratchet.ts', src.indexOf('ratchet('));
    assert.ok(refs.some((r) => r.path === 'src/use.ts' && r.line === 3));
  } finally { lk.dispose(); s.dispose(); fx.cleanup(); }
});

test('context pack: cross-file definition, callers, removed-but-used, named rule files, referenced files; ranked, cited and budgeted', () => {
  const fx = fixture(); const s = snapshotFromClone(fx.repo, fx.head); const lk = new CodeLookup(s.dir, s.commit);
  try {
    const files = [
      { path: 'src/ratchet.ts', status: 'modified', patch: "@@ -3,4 +3,4 @@ export function ratchet(raw: string, cur: number): number {\n   const v = readCount(raw);\n-  return cur;\n+  return typeof v === 'number' ? Math.max(v, cur) : cur;\n }\n" },
      { path: 'tests/dir.test.cjs', status: 'modified', patch: "@@ -3,5 +3,6 @@ const { cleanupDir } = require('../lib/helpers.cjs');\n function afterEachHook(d) {\n   cleanupDir(d);\n+  fs.rmSync(d);\n   return d;\n }\n-function legacyGuard(x) { return x; }\n" },
      { path: 'package.json', status: 'modified', patch: '@@ -1,3 +1,3 @@\n {\n   "name": "fx",\n+  "scripts": { "version": "node scripts/gen-registry.cjs --write" }\n' },
    ];
    const p = buildContext(lk, files, { budgetChars: 20_000 });
    const has = (kind: string, path: string) => p.list.some((c) => c.kind === kind && c.snippet.path === path);
    assert.ok(has('definition', 'src/parse.ts'), 'the definition the added line depends on (returns string)');
    assert.ok(has('caller', 'src/use.ts'), 'a caller of the edited function');
    assert.ok(has('removed-still-used', 'lib/caller.cjs') || has('removed-still-used', 'lib/helpers.cjs'), 'a removed declaration still used elsewhere');
    assert.ok(has('usage', 'eslint-rules/no-raw-rmsync-in-tests.cjs'), 'a rule file named after an API with no in-repo definition');
    assert.ok(has('referenced-file', 'scripts/gen-registry.cjs'), 'a file the change names');
    assert.equal(p.list[0].kind, 'removed-still-used', 'deterministic facts rank first');
    for (const c of p.list) assert.match(c.sha256, /^[0-9a-f]{64}$/);
    assert.equal(p.commit, fx.head); assert.equal(p.cut, 0); assert.equal(p.stale, 0);
    const text = renderContext(p); assert.match(text, /REPOSITORY CONTEXT/); assert.match(text, /\[C1\] removed-still-used/); assert.match(text, /untrusted data/);

    const small = buildContext(lk, files, { budgetChars: 400 });
    assert.ok(small.cut > 0 && small.chars <= 400 && small.status === 'partial'); assert.match(renderContext(small), /left out to fit the budget/);
    const stale = buildContext(lk, files, { verify: () => false });
    assert.equal(stale.items, 0); assert.ok(stale.stale > 0); assert.equal(stale.status, 'partial');
  } finally { lk.dispose(); s.dispose(); fx.cleanup(); }
});

test('patch parsing and token extraction', () => {
  const p = parsePatch('@@ -10,3 +10,4 @@ x\n a\n-b\n+c\n+d\n e\n');
  assert.deepEqual([...p.added.keys()], [11, 12]); assert.deepEqual(p.removed, ['b']); assert.deepEqual(p.ranges, [[10, 13]]);
  const t = tokens(['Run ${TDD_APPLICABLE} via scripts/gen-registry.cjs and plan_head_before']);
  assert.deepEqual(t.slice(0, 2), ['scripts/gen-registry.cjs', 'TDD_APPLICABLE'], 'paths, then template variables, rank first'); assert.ok(t.includes('plan_head_before'));
});

// ---------- review slice and replay carry the pack ----------
const GOOD: PreflightReport = { ok: true, resolvedModel: 'm', isolation: 'seatbelt', failures: [] };
class Scripted implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; prompts: string[] = []; out: unknown;
  constructor(out: unknown) { this.out = out; }
  async preflight() { return GOOD; }
  async run(req: SessionRequest): Promise<SessionResult> { this.prompts.push(readFileSync(join(req.packetDir, 'prompt.txt'), 'utf8')); return { outcome: 'completed', structuredOutput: this.out, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } }; }
}
function pr(head: string) {
  const w = new FakeWorld(); const n = w.addIssue({ isPr: true, title: 't', author: 'c' });
  w.issues.get(n)!.pull = { head, base: 'b'.repeat(40), ci: 'passing', files: [{ path: 'src/ratchet.ts', status: 'modified', patch: "@@ -4,2 +4,2 @@\n   const v = readCount(raw);\n+  return typeof v === 'number' ? Math.max(v, cur) : cur;\n" }] };
  return { store: w.view('operator'), n };
}
const kv = () => { let r: ReviewRecord | null = null; return { read: () => r, write: (_i: number, x: ReviewRecord) => { r = JSON.parse(JSON.stringify(x)); } }; };

test('review: the pack reaches the prompt and the packet; the scope check still rejects findings that cite context files', async () => {
  const fx = fixture(); const root = mkdtempSync(join(tmpdir(), 'warden-ctx-'));
  try {
    const { store, n } = pr(fx.head); const cfg: ReviewConfig = { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 60_000 }, localModels: ['m'], expectedModel: 'm', packetRoot: root, context: lookupProvider(fx.repo, { root }) };
    const ok = new Scripted({ verdict: 'changes needed', findings: [{ id: 'f1', severity: 'major', path: 'src/ratchet.ts', line: 5, rationale: 'readCount returns string (see C1), so the number branch never runs.', correction: 'Parse to a number.' }] });
    const r = await runReview({ store, item: n, runner: ok, kv: kv(), cfg, stopped: () => false });
    assert.equal(r.kind, 'accepted'); assert.equal(r.context?.status, 'complete'); assert.ok((r.context?.items ?? 0) > 0); assert.equal(r.marker?.context?.commit, fx.head);
    assert.match(ok.prompts[0], /REPOSITORY CONTEXT/); assert.match(ok.prompts[0], /src\/parse\.ts/);
    const bad = new Scripted({ verdict: 'changes needed', findings: [{ id: 'f1', severity: 'major', path: 'src/parse.ts', line: 1, rationale: 'x', correction: 'y' }] });
    const { store: s2, n: n2 } = pr(fx.head); const r2 = await runReview({ store: s2, item: n2, runner: bad, kv: kv(), cfg, stopped: () => false });
    assert.equal(r2.kind, 'rejected'); assert.match(r2.reason ?? '', /out-of-scope:src\/parse\.ts/);
  } finally { rmSync(root, { recursive: true, force: true }); fx.cleanup(); }
});

test('review: an unavailable lookup costs no attempt, is labeled on the record and the card, and the review still runs on the patch', async () => {
  const fx = fixture(); const root = mkdtempSync(join(tmpdir(), 'warden-ctx-'));
  try {
    const { store, n } = pr('c'.repeat(40)); const k = kv();
    const cfg: ReviewConfig = { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 60_000 }, localModels: ['m'], expectedModel: 'm', packetRoot: root, context: lookupProvider(fx.repo, { root }) };
    const run = new Scripted({ verdict: 'no findings', findings: [] });
    const r = await runReview({ store, item: n, runner: run, kv: k, cfg, stopped: () => false });
    assert.equal(r.kind, 'accepted'); assert.equal(r.context?.status, 'unavailable'); assert.match(r.context?.reason ?? '', /not in the local clone/);
    const log = k.read()!.log.map((x) => x.event); assert.ok(log.indexOf('context') >= 0 && log.indexOf('context') < log.indexOf('scan-started'), 'the lookup runs before an attempt is counted');
    assert.match(r.card?.text ?? '', /Repository context: unavailable/); assert.match(run.prompts[0], /REPOSITORY CONTEXT: unavailable/);
    const thrower: ReviewConfig = { ...cfg, context: async () => { throw new Error('boom'); } };
    const { store: s2, n: n2 } = pr('d'.repeat(40)); const r2 = await runReview({ store: s2, item: n2, runner: run, kv: kv(), cfg: thrower, stopped: () => false });
    assert.equal(r2.kind, 'accepted'); assert.equal(r2.context?.reason, 'boom');
  } finally { rmSync(root, { recursive: true, force: true }); fx.cleanup(); }
});

test('replay: with a lookup clone each review case reports its context; without one, nothing changes', async () => {
  const fx = fixture();
  try {
    const set = { name: 'fx', curatedBy: 'trek-e', cases: [{ id: 'pr-1', kind: 'review' as const, title: 't', head: fx.head, files: [{ path: 'src/ratchet.ts', status: 'modified', patch: "@@ -4,2 +4,2 @@\n   const v = readCount(raw);\n+  return typeof v === 'number' ? Math.max(v, cur) : cur;\n" }], expect: { mustFind: [{ path: 'src/ratchet.ts', lineMin: 5, lineMax: 5 }] } }] };
    const runner = new Scripted({ verdict: 'changes needed', findings: [{ id: 'f1', severity: 'major', path: 'src/ratchet.ts', line: 5, rationale: 'r', correction: 'c' }] });
    const withCtx = await runReplay(set, { runner, localModels: ['m'], budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 60_000 }, lookupClone: fx.repo });
    assert.equal(withCtx.results[0].hits, 1); assert.equal(withCtx.results[0].context?.status, 'complete'); assert.ok(typeof withCtx.results[0].wallMs === 'number');
    const without = await runReplay(set, { runner, localModels: ['m'], budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 60_000 } });
    assert.equal(without.results[0].context, undefined); assert.doesNotMatch(runner.prompts[runner.prompts.length - 1], /REPOSITORY CONTEXT/);
  } finally { fx.cleanup(); }
});
