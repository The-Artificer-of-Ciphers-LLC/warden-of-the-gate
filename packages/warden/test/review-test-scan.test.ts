import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isScanFinding, scanFindings } from '../src/review/test-scan.ts';
import { runReview } from '../src/review/slice.ts';
import type { ReviewKV, ReviewRecord } from '../src/review/slice.ts';
import { FakeWorld } from '../src/github/fake.ts';
import type { AgentRunner, PreflightReport, SessionResult } from '../src/runner/agent-runner.ts';

/** ADR 0015: Review runs the test-diff scan itself. Hits are deterministic `major` findings with a location, never asked of the model. */
const patch = (...added: string[]) => `@@ -1,1 +1,${added.length} @@\n${added.map((l) => '+' + l).join('\n')}`;
test('scan hits become major findings with a path and a line; non-test and clean changes produce none', () => {
  const f = scanFindings([{ path: 'test/a.test.js', status: 'modified', patch: patch("it('keeps', () => {});", "it.only('x', () => {});") }, { path: 'src/a.js', status: 'modified', patch: patch('// eslint-disable-next-line') }, { path: 'test/b.test.js', status: 'removed' }]);
  assert.deepEqual(f.map((x) => [x.id, x.severity, x.path]), [['test-scan-test-removed-1', 'major', 'test/b.test.js'], ['test-scan-focused-test-1', 'major', 'test/a.test.js']]);
  assert.equal(f[1].line, 2); assert.match(f[1].rationale, /Test-diff scan \(focused-test\)/); assert.ok(f.every(isScanFinding));
  assert.deepEqual(scanFindings([{ path: 'src/a.js', status: 'modified', patch: patch('const x = 1;') }, { path: 'test/a.test.js', status: 'added', patch: patch("it('x', () => {});") }]), []);
  assert.deepEqual(scanFindings([{ path: 'src/legacy/a.test.js', status: 'added', patch: patch('x') }], ['test/'] ).length, 0);
});

const GOOD: PreflightReport = { ok: true, resolvedModel: 'm', isolation: 'seatbelt', failures: [] };
const done = (o: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 1, modelTurns: 1, wallMs: 5 } });
test('a clean model verdict still becomes changes needed when the test diff has a hit; the next delta review does not ask the model about scan findings', async (t) => {
  const world = new FakeWorld(); world.clock = Date.parse('2026-11-18T12:00:00Z'); const n = world.addIssue({ isPr: true, title: 'p', author: 'outside' });
  const pr = world.issues.get(n)!; pr.pull = { head: 'a1b2c3d4e5f6', base: 'base000000aa', ci: 'passing', files: [{ path: 'test/a.test.js', status: 'modified', patch: patch("test.skip('x', () => {});") }, { path: 'src/a.js', status: 'modified', patch: patch('x') }] };
  const dir = mkdtempSync(join(tmpdir(), 'warden-scan-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let s: string | null = null; const kv: ReviewKV = { read: () => (s ? (JSON.parse(s) as ReviewRecord) : null), write: (_i, r) => { s = JSON.stringify(r); } };
  const cfg = { maxAttempts: 3, budgets: { maxToolCalls: 20, maxModelTurns: 10, wallTimeMs: 60_000 }, localModels: ['m'], expectedModel: 'm', packetRoot: dir };
  let asked: unknown = null; const runner = (out: unknown): AgentRunner => ({ name: 'fake', pinnedVersion: '0', preflight: async () => GOOD, run: async (req) => { asked = JSON.parse(require_('node:fs').readFileSync(join(req.packetDir, 'prior-findings.json'), 'utf8')); return done(out); } });
  const o = await runReview({ store: world.view('operator'), item: n, runner: runner({ verdict: 'no findings', findings: [] }), kv, cfg, stopped: () => false });
  assert.equal(o.kind, 'accepted', JSON.stringify(o)); assert.equal(o.marker?.verdict, 'changes needed'); assert.deepEqual(o.marker?.findings.map((f) => [f.id, f.severity]), [['test-scan-skipped-test-1', 'major']]); assert.ok(o.marker?.findings[0].fingerprint);
  pr.pull!.head = 'ffff00000000'; pr.pull!.ci = 'pending';   // a new push: a delta review of the same hit
  const o2 = await runReview({ store: world.view('operator'), item: n, runner: runner({ verdict: 'no findings', findings: [], revalidated: [] }), kv, cfg, stopped: () => false });
  assert.equal(o2.kind, 'accepted', JSON.stringify(o2)); assert.deepEqual(asked, [], 'the model is not asked to re-check a scan finding'); assert.equal(o2.marker?.findings.length, 1);
  pr.pull!.files = [{ path: 'test/a.test.js', status: 'modified', patch: patch("test('x', () => {});") }, { path: 'src/a.js', status: 'modified', patch: patch('x') }]; pr.pull!.head = 'eeee00000000'; pr.pull!.ci = 'pending';
  const o3 = await runReview({ store: world.view('operator'), item: n, runner: runner({ verdict: 'no findings', findings: [], revalidated: [] }), kv, cfg, stopped: () => false });
  assert.equal(o3.marker?.verdict, 'no findings', 'fixed in the diff, so the finding is gone'); assert.equal(o3.marker?.findings.length, 0);
});
test('ADR 0016 on a contributor PR (opt-in): a surviving mutant is a major finding with its location; clean, unsupported, failed and throwing runs add no finding and are said on the card; nothing runs unless configured', async (t) => {
  const mk = async (check?: (p: unknown) => Promise<unknown>) => {
    const world = new FakeWorld(); world.clock = Date.parse('2026-11-18T12:00:00Z'); const n = world.addIssue({ isPr: true, title: 'p', author: 'outside' });
    world.issues.get(n)!.pull = { head: 'a1b2c3d4e5f6', base: 'base000000aa', ci: 'passing', files: [{ path: 'src/a.js', status: 'modified', patch: '@@ -1,1 +1,2 @@\n x\n+y' }] };
    const dir = mkdtempSync(join(tmpdir(), 'warden-mut-')); t.after(() => rmSync(dir, { recursive: true, force: true })); let s: string | null = null; const kv: ReviewKV = { read: () => (s ? (JSON.parse(s) as ReviewRecord) : null), write: (_i, r) => { s = JSON.stringify(r); } };
    const cfg = { maxAttempts: 3, budgets: { maxToolCalls: 20, maxModelTurns: 10, wallTimeMs: 60_000 }, localModels: ['m'], expectedModel: 'm', packetRoot: dir, ...(check ? { mutationCheck: check as never } : {}) };
    const runner: AgentRunner = { name: 'fake', pinnedVersion: '0', preflight: async () => GOOD, run: async () => done({ verdict: 'no findings', findings: [] }) };
    return runReview({ store: world.view('operator'), item: n, runner, kv, cfg, stopped: () => false });
  };
  let called = 0; const none = await mk(); assert.equal(none.marker?.verdict, 'no findings'); assert.equal(called, 0);
  const surv = await mk(async () => { called++; return { status: 'ok', total: 2, killed: 1, invalid: 0, score: 50, cleared: [], note: '1 of 2 mutant(s) on changed lines detected', survivors: [{ id: 'abc123def456', path: 'src/a.js', line: 2, mutator: 'ArithmeticOperator', replacement: 'a - b', status: 'Survived' }] }; });
  assert.equal(called, 1); assert.equal(surv.marker?.verdict, 'changes needed'); assert.deepEqual(surv.marker?.findings.map((f) => [f.id, f.severity, f.path, f.line]), [['mutation-abc123def456', 'major', 'src/a.js', 2]]); assert.match(surv.marker!.findings[0].rationale, /Mutant abc123def456/); assert.match(surv.card!.text, /Mutation testing: 1 of 2 mutant\(s\)/); assert.ok(isScanFinding(surv.marker!.findings[0]));
  const clean = await mk(async () => ({ status: 'ok', total: 1, killed: 1, invalid: 0, score: 100, cleared: [], survivors: [], note: '1 of 1 mutant(s) on changed lines detected' })); assert.equal(clean.marker?.verdict, 'no findings'); assert.match(clean.card!.text, /Mutation testing: 1 of 1/);
  const unsup = await mk(async () => ({ status: 'unsupported', note: 'no mutation tool is configured' })); assert.equal(unsup.marker?.findings.length, 0); assert.match(unsup.card!.text, /Mutation testing: no mutation tool is configured/);
  const thrown = await mk(async () => { throw new Error('checkout failed'); }); assert.equal(thrown.kind, 'accepted'); assert.match(thrown.card!.text, /Mutation testing: checkout failed/);
});
const require_ = (m: string) => (process as unknown as { getBuiltinModule: (n: string) => typeof import('node:fs') }).getBuiltinModule(m);
