import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runReplay, validateSet } from '../src/replay/replay.ts';
import type { ReplaySet } from '../src/replay/replay.ts';
import type { AgentRunner, PreflightReport, SessionResult, SessionRequest } from '../src/runner/agent-runner.ts';

const GOOD: PreflightReport = { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] };
const done = (o: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } });
class Model implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; calls = 0; fn: (req: SessionRequest) => unknown;
  constructor(fn: (req: SessionRequest) => unknown) { this.fn = fn; }
  async preflight() { return GOOD; }
  async run(r: SessionRequest) { this.calls++; return done(this.fn(r)); }
}
const set = (): ReplaySet => JSON.parse(readFileSync(new URL('../fixtures/replay/synthetic.json', import.meta.url), 'utf8'));
const o = (m: AgentRunner) => ({ runner: m, localModels: ['local-default'], budgets: { maxToolCalls: 1, maxModelTurns: 1, wallTimeMs: 1000 } });
const smart = (r: SessionRequest) => r.task === 'review'
  ? (r.packetDir && /sum\.js|sumTo/.test(JSON.stringify(readPrompt(r))) ? { verdict: 'changes needed', findings: [{ id: 'f1', severity: 'major', path: 'src/sum.js', line: 3, rationale: 'off by one', correction: 'use <=' }] } : { verdict: 'no findings', findings: [] })
  : /crash|Exit code/i.test(JSON.stringify(readPrompt(r))) ? { kind: 'bug', outcome: 'likely-bug', summary: 'crash', severity: 'major', risk: 'low', quickWin: false, evidence: [{ kind: 'reporter-claim', detail: 'Exits with code 1 when saving an empty document.' }] } : { kind: 'question', outcome: 'needs-info', summary: 'vague', questions: ['Which version are you running?', 'What are the exact steps?'] };
import { readFileSync as rf } from 'node:fs';
import { join } from 'node:path';
const readPrompt = (r: SessionRequest) => rf(join(r.packetDir, 'prompt.txt'), 'utf8');

test('replay measures recall, false positives, accepted rate and triage accuracy per case against a simulated repository', async () => {
  const rep = await runReplay(set(), o(new Model(smart)));
  assert.equal(rep.metrics.recall, 1); assert.equal(rep.metrics.falsePositiveRate, 0); assert.equal(rep.metrics.acceptedRate, 1); assert.equal(rep.metrics.triageAccuracy, 1);
  assert.deepEqual(rep.results.map((x) => x.outcome), ['accepted', 'accepted', 'accepted', 'accepted']);
});

test('a synthetic or too-small set can never qualify, however well the model does; activation is never performed', async () => {
  const rep = await runReplay(set(), o(new Model(smart)));
  assert.equal(rep.qualification.qualified, false); assert.match(rep.qualification.reasons.join(' '), /synthetic/); assert.match(rep.qualification.reasons.join(' '), /only 2 PR case/); assert.match(rep.activation, /separate, explicit owner step/);
});

test('a full-size, maintainer-curated set that the model handles well qualifies; thresholds are enforced (a noisy reviewer does not)', async () => {
  const big: ReplaySet = { name: 'real', curatedBy: 'maint', cases: [] };
  const pr = set().cases[0]; const iss = set().cases[2];
  for (let i = 0; i < 20; i++) { big.cases.push({ ...pr, id: `pr${i}` } as never, { ...iss, id: `is${i}` } as never); }
  assert.equal((await runReplay(big, o(new Model(smart)))).qualification.qualified, true);
  const noisy = new Model((r) => r.task === 'review' ? { verdict: 'changes needed', findings: [{ id: 'f1', severity: 'major', path: 'src/sum.js', line: 3, rationale: 'x', correction: 'y' }, { id: 'f2', severity: 'minor', path: 'src/sum.js', line: 99, rationale: 'x', correction: 'y' }, { id: 'f3', severity: 'minor', path: 'src/sum.js', line: 98, rationale: 'x', correction: 'y' }] } : smart(r));
  const bad = await runReplay(big, o(noisy)); assert.equal(bad.qualification.qualified, false); assert.match(bad.qualification.reasons.join(' '), /false-positive rate/);
});

test('a stop mid-replay means the set is not qualified; malformed sets are rejected before any model call', async () => {
  const m = new Model(smart); let n = 0; const rep = await runReplay(set(), { ...o(m), stopped: () => n++ >= 1 });
  assert.ok(rep.results.some((x) => x.outcome.startsWith('not-run'))); assert.match(rep.qualification.reasons.join(' '), /stopped/);
  for (const bad of [{}, { name: 'x', cases: [{ id: 'a', kind: 'review', files: [], expect: { clean: true } }] }, { name: 'x', cases: [{ id: 'a', kind: 'triage', expect: {} }] }, { name: 'x', cases: [{ id: 'a', kind: 'zzz' }] }]) assert.ok(validateSet(bad));
  const mm = new Model(smart); await assert.rejects(runReplay({ name: 'x', curatedBy: 'm', cases: [{ id: 'a', kind: 'zzz' } as never] }, o(mm))); assert.equal(mm.calls, 0);
});

test('a triage expectation may list several acceptable kinds and outcomes; an empty list is rejected', async () => {
  const { validateSet } = await import('../src/replay/replay.ts');
  assert.equal(validateSet({ name: 'x', curatedBy: 'm', cases: [{ id: 't1', kind: 'triage', title: 't', body: 'b', expect: { kind: ['bug', 'question'], outcome: ['needs-info'] } }] }), null);
  assert.match(String(validateSet({ name: 'x', curatedBy: 'm', cases: [{ id: 't1', kind: 'triage', title: 't', body: 'b', expect: { kind: [], outcome: 'needs-info' } }] })), /needs expect\.kind/);
});

test('replay enforces the wall-time budget with a REAL clock (the fake world clock is frozen and must not disable the cap)', async () => {
  const runner = { name: 'slow', pinnedVersion: '0', async preflight() { return { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] }; },
    async run(_req: unknown, signal: AbortSignal, mon: { observe(d: object): string | null }) { while (!signal.aborted) { mon.observe({}); await new Promise((r) => setTimeout(r, 20)); } return { outcome: 'interrupted' as const, usage: { toolCalls: 0, modelTurns: 0, wallMs: 0 } }; } };
  const set = { name: 's', curatedBy: 'x', synthetic: true, cases: [{ id: 'pr-1', kind: 'review' as const, title: 't', files: [{ path: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }], expect: { clean: true as const } }] };
  const t0 = Date.now();
  const rep = await runReplay(set, { runner: runner as never, localModels: ['local-default'], budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 150 } });
  assert.ok(Date.now() - t0 < 5000, 'the session was cut off by the budget instead of running forever');
  assert.equal(rep.results[0].outcome, 'rejected'); assert.match(rep.results[0].reason ?? '', /wall-time budget/);
});

test('a finding outside mustFind that evidence showed to be real is counted as a real extra, not a false positive; an unverified extra stays one', async () => {
  const base = set(); const pr = base.cases[0]; assert.equal(pr.kind, 'review');
  const noisy = new Model((r) => r.task === 'review' ? { verdict: 'changes needed', findings: [{ id: 'f1', severity: 'major', path: 'src/sum.js', line: 3, rationale: 'x', correction: 'y' }, { id: 'f2', severity: 'minor', path: 'src/sum.js', line: 99, rationale: 'x', correction: 'y' }, { id: 'f3', severity: 'minor', path: 'src/sum.js', line: 98, rationale: 'x', correction: 'y' }] } : smart(r));
  const withVerdict: ReplaySet = { ...base, cases: [{ ...pr, expect: { ...pr.expect, verifiedReal: [{ path: 'src/sum.js', lineMin: 99, lineMax: 99 }] } } as never] };
  const rep = await runReplay(withVerdict, o(noisy)); const r0 = rep.results[0];
  assert.equal(r0.findings, 3); assert.equal(r0.realExtras, 1); assert.equal(r0.falsePositives, 1); assert.ok(Math.abs((rep.metrics.falsePositiveRate ?? 0) - 1 / 3) < 1e-9);
  const without = await runReplay({ ...base, cases: [pr] }, o(noisy)); assert.equal(without.results[0].falsePositives, 2); assert.equal(without.results[0].realExtras, undefined);
});

test('each replay case gets its own packet directory: one case never sees files left by the previous case', async () => {
  const seen: string[] = [];
  const spy = new Model((r) => { seen.push(r.packetDir); return r.task === 'review' ? { verdict: 'no findings', findings: [] } : { kind: 'question', outcome: 'needs-info', summary: 's', questions: ['q1?', 'q2?'] }; });
  const s = set(); const prs = s.cases.filter((c) => c.kind === 'review');
  await runReplay({ ...s, cases: prs }, o(spy));
  assert.equal(new Set(seen).size, prs.length); assert.ok(prs.length >= 2);
});
