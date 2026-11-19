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
