import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWorld } from '../src/github/fake.ts';
import { InstanceStorage } from '../src/storage/instance.ts';
import * as slice from '../src/review/slice.ts';
import { fileKV, runReview } from '../src/review/slice.ts';
import type { ReviewKV, ReviewRecord } from '../src/review/slice.ts';
import type { AgentRunner, PreflightReport, SessionRequest, SessionResult, BudgetMonitor } from '../src/runner/agent-runner.ts';
import type { ReviewOutput } from '../src/review/schema.ts';

/** The prototype's seven walkthroughs, reproduced against the real components (store, runner seam, Ajv, persistence). The "model" is a scripted
 *  fake: this proves Warden's rules, not model quality. The live checkpoint (pinned OpenCode + local model on a disposable PR) is separate. */
const GOOD: PreflightReport = { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] };
const done = (output: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: output, usage: { toolCalls: 1, modelTurns: 1, wallMs: 5 } });
const CLEAN: ReviewOutput = { verdict: 'no findings', findings: [] };
const BLOCKER: ReviewOutput = { verdict: 'changes needed', findings: [{ id: 'f1', severity: 'blocker', path: 'src/auth/refresh.ts', line: 48, rationale: 'Two refreshes can race and reuse a revoked token.', correction: 'Serialize refresh per token.' }] };
const FILES = [{ path: 'src/auth/refresh.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }, { path: 'test/refresh.test.ts', status: 'modified', patch: '' }];

class FakeRunner implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; calls = 0; packets: string[] = [];
  pf: PreflightReport; script: (req: SessionRequest, signal: AbortSignal, mon: BudgetMonitor, n: number) => Promise<SessionResult> | SessionResult;
  constructor(pf: PreflightReport, script: (req: SessionRequest, signal: AbortSignal, mon: BudgetMonitor, n: number) => Promise<SessionResult> | SessionResult) { this.pf = pf; this.script = script; }
  async preflight() { return this.pf; }
  async run(req: SessionRequest, signal: AbortSignal, mon: BudgetMonitor) { this.calls++; this.packets.push(req.packetDir); return this.script(req, signal, mon, this.calls); }
}
const memKV = (): ReviewKV & { rec: () => ReviewRecord | null } => { let s: string | null = null; return { read: () => (s ? JSON.parse(s) : null), write: (_i, r) => { s = JSON.stringify(r); }, rec: () => (s ? JSON.parse(s) : null) }; };

function rig(over: Partial<slice.ReviewConfig> = {}) {
  const world = new FakeWorld(); world.clock = Date.parse('2026-11-18T12:00:00Z');
  const n = world.addIssue({ isPr: true, title: 'Fix token refresh race', author: 'outside-contributor' });
  const pull = world.issues.get(n)!; pull.pull = { head: 'a1b2c3d4e5f6', base: 'base000000aa', ci: 'passing', files: FILES.map((f) => ({ ...f })) };
  const packetRoot = mkdtempSync(join(tmpdir(), 'warden-review-')); const kv = memKV(); let stopped = false;
  const cfg: slice.ReviewConfig = { maxAttempts: 3, budgets: { maxToolCalls: 20, maxModelTurns: 10, wallTimeMs: 60_000 }, localModels: ['local-default'], expectedModel: 'local-default', packetRoot, ...over };
  const store = world.view('operator');
  const scan = (runner: AgentRunner, o: Partial<slice.ReviewOpts> = {}) => runReview({ store, item: n, runner, kv, cfg, stopped: () => stopped, ...o });
  const push = (head: string) => { pull.pull!.head = head; pull.pull!.ci = 'pending'; };
  return { world, n, kv, scan, push, setStopped: (v: boolean) => { stopped = v; }, pull, cleanup: () => rmSync(packetRoot, { recursive: true, force: true }), snapshot: () => JSON.stringify(world.snapshot()) };
}

test('1 one clean review: accepted only at the end, a draft card for the maintainer, nothing written to GitHub, and no way to post/merge/edit', async (t) => {
  const r = rig(); t.after(r.cleanup); const before = r.snapshot();
  const runner = new FakeRunner(GOOD, () => done(CLEAN));
  const o = await r.scan(runner);
  assert.equal(o.kind, 'accepted'); assert.equal(o.marker?.head, 'a1b2c3d4e5f6'); assert.equal(o.card?.posted, false); assert.equal(o.attempts.used, 0);
  assert.equal(r.snapshot(), before, 'the repository world is byte-identical: no comment, label, assignment or close');
  assert.deepEqual(Object.keys(slice).filter((k) => /post|merge|edit|push|comment/i.test(k)), [], 'no write-capable export exists in the review slice');
  await assert.rejects(async () => { const { readOnly } = await import('../src/github/store.ts'); await readOnly(r.world.view('x')).createComment(r.n, 'x'); }, /READ-ONLY/);
});

test('2 model down or wrongly routed: refused, no run started, no attempt consumed, no hosted fallback', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const down = new FakeRunner({ ok: false, resolvedModel: 'local-default', isolation: 'seatbelt', failures: ['endpoint not answering'] }, () => done(CLEAN));
  const a = await r.scan(down); assert.equal(a.kind, 'blocked'); assert.match(a.notice, /unavailable/); assert.equal(down.calls, 0);
  const remote = new FakeRunner({ ok: true, resolvedModel: 'hosted-frontier', isolation: 'seatbelt', failures: [] }, () => done(CLEAN));
  const b = await r.scan(remote); assert.equal(b.kind, 'blocked'); assert.match(b.notice, /not a configured local model/); assert.equal(remote.calls, 0);
  assert.equal(b.attempts.used, 0);
  const back = await r.scan(new FakeRunner(GOOD, () => done(CLEAN))); assert.equal(back.kind, 'accepted');
});

test('3 bad output until the budget is gone: rejected whole, attempts persist across restart, exhaustion waits for a maintainer', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const bad = [{ nonsense: true }, { verdict: 'changes needed', findings: [{ ...BLOCKER.findings[0], path: 'src/billing/charge.ts' }] }, { verdict: 'no findings', findings: [BLOCKER.findings[0]] }];
  const runner = new FakeRunner(GOOD, (_q, _s, _m, n) => done(bad[n - 1]));
  const a = await r.scan(runner); assert.equal(a.kind, 'rejected'); assert.match(a.reason!, /structured output rejected/); assert.equal(a.attempts.used, 1);
  const kv2 = JSON.parse(JSON.stringify(r.kv.read(r.n)));                                   // simulate a process restart: state comes back from storage
  assert.equal(kv2.attempts.used, 1, 'the attempt is persisted');
  const b = await r.scan(runner); assert.equal(b.kind, 'rejected'); assert.match(b.notice, /src\/billing\/charge\.ts.*not in this pull request/); assert.equal(b.attempts.used, 2);
  const c = await r.scan(runner); assert.equal(c.kind, 'rejected'); assert.match(c.reason!, /verdict-inconsistent/); assert.match(c.notice, /last attempt/);
  const d = await r.scan(runner); assert.equal(d.kind, 'blocked'); assert.equal(d.reason, 'attempts-exhausted'); assert.equal(runner.calls, 3, 'no fourth session ever started');
  assert.equal(r.kv.read(r.n)!.marker, null);
});

test('4 code changes mid-review: stale result rejected, the next scan reviews the new head', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const runner = new FakeRunner(GOOD, (_q, _s, _m, n) => { if (n === 1) r.push('def012def012'); return done(CLEAN); });
  const a = await r.scan(runner); assert.equal(a.kind, 'rejected'); assert.equal(a.reason, 'head-moved'); assert.equal(r.kv.read(r.n)!.marker, null);
  const b = await r.scan(runner); assert.equal(b.kind, 'accepted'); assert.equal(b.marker?.head, 'def012def012'); assert.equal(b.attempts.used, 0);
});

test('5 reuse, checks-only and delta: no model call for unchanged code, delta revalidates earlier findings and rejects an incomplete re-check', async (t) => {
  const r = rig(); t.after(r.cleanup);
  let seenPrior: unknown = null;
  const runner = new FakeRunner(GOOD, (req, _s, _m, n) => {
    if (n === 1) return done(BLOCKER);
    seenPrior = JSON.parse(readFileSync(join(req.packetDir, 'prior-findings.json'), 'utf8'));
    return done(n === 2 ? { verdict: 'no findings', findings: [] } : { verdict: 'no findings', findings: [], revalidated: [{ id: 'f1', status: 'resolved' }] });
  });
  assert.equal((await r.scan(runner)).kind, 'accepted');
  const reuse = await r.scan(runner); assert.equal(reuse.kind, 'reused'); assert.equal(runner.calls, 1);
  r.pull.pull!.ci = 'failing'; const co = await r.scan(runner); assert.equal(co.kind, 'checks-only'); assert.equal(runner.calls, 1); assert.equal(co.marker?.ci, 'failing');
  r.push('789abc789abc');
  const incomplete = await r.scan(runner); assert.equal(incomplete.kind, 'rejected'); assert.equal(incomplete.reason, 'revalidation-incomplete'); assert.equal(incomplete.mode, 'delta');
  assert.deepEqual((seenPrior as Array<{ id: string }>).map((f) => f.id), ['f1'], 'the delta packet carries the earlier findings to re-check');
  const delta = await r.scan(runner); assert.equal(delta.kind, 'accepted'); assert.match(delta.notice, /1 earlier finding\(s\) re-checked: 0 still open/); assert.equal(delta.marker?.head, '789abc789abc');
});

test('6 stop in the middle: the running scan is cancelled and checkpointed; stop blocks new scans; resume starts nothing and resets nothing', async (t) => {
  const r = rig(); t.after(r.cleanup); const ac = new AbortController();
  const runner = new FakeRunner(GOOD, (_q, signal, _m, n) => (n === 1
    ? new Promise<SessionResult>((resolve) => { ac.abort(new Error('maintainer stop')); signal.addEventListener('abort', () => resolve({ outcome: 'interrupted', reason: 'aborted', usage: { toolCalls: 0, modelTurns: 0, wallMs: 1 } })); if (signal.aborted) resolve({ outcome: 'interrupted', reason: 'aborted', usage: { toolCalls: 0, modelTurns: 0, wallMs: 1 } }); })
    : done(CLEAN)));
  const a = await r.scan(runner, { signal: ac.signal }); assert.equal(a.kind, 'interrupted'); assert.equal(a.attempts.used, 1); assert.equal(a.marker, null);
  r.setStopped(true);
  const b = await r.scan(runner); assert.equal(b.kind, 'blocked'); assert.equal(b.reason, 'stopped'); assert.equal(runner.calls, 1);
  r.setStopped(false);
  assert.equal(runner.calls, 1, 'resume itself starts nothing'); assert.equal(r.kv.read(r.n)!.attempts.used, 1, 'resume resets nothing');
  const c = await r.scan(runner); assert.equal(c.kind, 'accepted'); assert.equal(c.attempts.used, 0);
});

test('7 no isolation: refuses to run rather than assume; unknown resolved model also blocks', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const a = new FakeRunner({ ok: true, resolvedModel: 'local-default', failures: [] }, () => done(CLEAN)); const o = await r.scan(a);
  assert.equal(o.kind, 'blocked'); assert.match(o.notice, /isolation/i); assert.equal(a.calls, 0);
  const b = new FakeRunner({ ok: true, isolation: 'seatbelt', failures: [] }, () => done(CLEAN)); assert.match((await r.scan(b)).notice, /unknown/); assert.equal(b.calls, 0);
});

test('runner-enforced budget overrun and a non-PR target are rejected without fabricating a review', async (t) => {
  const r = rig({ budgets: { maxToolCalls: 2, maxModelTurns: 10, wallTimeMs: 60_000 } }); t.after(r.cleanup);
  const hog = new FakeRunner(GOOD, (_q, _s, mon) => { mon.observe({ toolCalls: 5 }); return done(CLEAN); });
  const a = await r.scan(hog); assert.equal(a.kind, 'rejected'); assert.match(a.reason!, /tool-call budget 2 exceeded/); assert.equal(a.marker, null);
  const issue = r.world.addIssue({ title: 'not a pr' });
  const b = await runReview({ store: r.world.view('operator'), item: issue, runner: new FakeRunner(GOOD, () => done(CLEAN)), kv: memKV(), cfg: { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 1000 }, localModels: ['local-default'], expectedModel: 'local-default', packetRoot: tmpdir() }, stopped: () => false });
  assert.equal(b.kind, 'blocked'); assert.equal(b.reason, 'not-a-pull-request');
});

test('persistence: fileKV stores the record under the instance directory with owner-only permissions and survives reopening', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'warden-review-home-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const st = InstanceStorage.open(home, 'acme/widgets', { create: true }); const kv = fileKV(st);
  const rec: ReviewRecord = { v: 1, item: 7, attempts: { used: 2 }, marker: null, card: null, log: [] }; kv.write(7, rec);
  assert.deepEqual(fileKV(InstanceStorage.open(home, 'acme/widgets', { create: false })).read(7), rec);
  assert.equal(statSync(st.path('review', '7.json')).mode & 0o777, 0o600);
});

test('a diff too large for the local reviewer is refused before any attempt is spent (never partially reviewed)', async (t) => {
  const r = rig({ maxPatchChars: 100 }); t.after(r.cleanup); r.pull.pull!.files[0].patch = 'x'.repeat(500);
  const runner = new FakeRunner(GOOD, () => done(CLEAN)); const o = await r.scan(runner);
  assert.equal(o.kind, 'blocked'); assert.equal(o.reason, 'diff-too-large'); assert.match(o.notice, /split it into smaller pull requests/); assert.equal(o.attempts.used, 0); assert.equal(runner.calls, 0);
});
