import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWorld } from '../src/github/fake.ts';
import { runTriage } from '../src/triage/slice.ts';
import type { TriageKV, TriageRecord } from '../src/triage/slice.ts';
import type { TriageOutput } from '../src/triage/schema.ts';
import type { AgentRunner, PreflightReport, SessionResult, SessionRequest } from '../src/runner/agent-runner.ts';

const GOOD: PreflightReport = { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] };
const done = (o: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } });
const BUG: TriageOutput = { kind: 'bug', outcome: 'likely-bug', summary: 'Crash on save', severity: 'major', risk: 'low', quickWin: true, evidence: [{ kind: 'reporter-claim', detail: 'App exits with code 1 when saving an empty document.' }] };
const INFO: TriageOutput = { kind: 'question', outcome: 'needs-info', summary: 'Too vague', questions: ['Which version are you running?', 'What are the exact steps?'] };
const FEATURE: TriageOutput = { kind: 'feature', outcome: 'feature-proposal', summary: 'Dark mode', proposal: { scope: 'Theme toggle in settings', acceptance: ['Toggle persists across restarts'], approach: 'CSS variables', affectedAreas: ['settings', 'styles'], interfaces: 'none', migration: 'none', blastRadius: 'UI only', alternatives: ['Follow system theme only'], unresolved: [] } };
class Runner implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; calls = 0; pf: PreflightReport; script: (n: number) => SessionResult | Promise<SessionResult>;
  constructor(pf: PreflightReport, script: (n: number) => SessionResult | Promise<SessionResult>) { this.pf = pf; this.script = script; }
  async preflight() { return this.pf; }
  async run(_r: SessionRequest) { this.calls++; return this.script(this.calls); }
}
function rig() {
  const world = new FakeWorld(); world.clock = Date.parse('2026-11-18T12:00:00Z'); const n = world.addIssue({ title: 'Saving crashes the app', body: 'Steps: open, save, crash.', author: 'reporter' });
  let rec: TriageRecord | null = null; const kv: TriageKV = { read: () => (rec ? JSON.parse(JSON.stringify(rec)) : null), write: (_i, r) => { rec = JSON.parse(JSON.stringify(r)); } };
  const dir = mkdtempSync(join(tmpdir(), 'warden-triage-')); let stopped = false;
  const cfg = { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 1000 }, localModels: ['local-default'], expectedModel: 'local-default', packetRoot: dir };
  const scan = (runner: AgentRunner, o: Partial<Parameters<typeof runTriage>[0]> = {}) => runTriage({ store: world.view('operator'), item: n, runner, kv, cfg, stopped: () => stopped, ...o });
  return { world, n, scan, rec: () => rec, setStopped: (v: boolean) => { stopped = v; }, cleanup: () => rmSync(dir, { recursive: true, force: true }), snap: () => JSON.stringify(world.snapshot()) };
}

test('triage: an accepted result is a local draft card; nothing is posted, labelled or closed; kind/severity/risk/quickWin stay separate facets', async (t) => {
  const r = rig(); t.after(r.cleanup); const before = r.snap();
  const o = await r.scan(new Runner(GOOD, () => done(BUG)));
  assert.equal(o.kind, 'accepted'); assert.equal(o.card?.posted, false); assert.match(o.card!.text, /needs trusted reproduction before it is confirmed/);
  assert.equal(r.snap(), before); const m = r.rec()!.marker!.output; assert.deepEqual([m.kind, m.severity, m.risk, m.quickWin], ['bug', 'major', 'low', true]);
});

test('triage: incomplete or forbidden results are rejected whole; wontfix and model-side confirmation are not representable', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const bad: unknown[] = [{ ...BUG, evidence: [] }, { ...BUG, severity: undefined }, { ...INFO, questions: [] }, { ...FEATURE, proposal: { ...FEATURE.proposal!, alternatives: [] } },
    { kind: 'other', outcome: 'escalate', summary: 'x' }, { kind: 'bug', outcome: 'wontfix', summary: 'x' }, { kind: 'bug', outcome: 'confirmed-bug', summary: 'x', evidence: [{ kind: 'observation', detail: 'd' }], severity: 'major', risk: 'low' }];
  const runner = new Runner(GOOD, (n) => done(bad[n - 1])); const reasons: string[] = [];
  for (let i = 0; i < 3; i++) { const o = await r.scan(runner); assert.equal(o.kind, 'rejected'); reasons.push(o.reason!); }
  assert.match(reasons[0], /incomplete:a likely bug needs at least one piece of evidence/); assert.match(reasons[1], /severity and risk/); assert.match(reasons[2], /precise question/);
  const exhausted = await r.scan(runner); assert.equal(exhausted.kind, 'blocked'); assert.equal(exhausted.reason, 'attempts-exhausted'); assert.equal(runner.calls, 3);
  const r2 = rig(); t.after(r2.cleanup);
  for (const [i, why] of [[3, /proposal|alternative/], [5, /structured output rejected/], [6, /structured output rejected/]] as const) { const rr = rig(); t.after(rr.cleanup); const o = await rr.scan(new Runner(GOOD, () => done(bad[i]))); assert.equal(o.kind, 'rejected'); assert.match(o.reason!, why); }
  const esc = await r2.scan(new Runner(GOOD, () => done(bad[4]))); assert.match(esc.reason!, /escalate requires a reason/);
});

test('triage: needs-info, feature proposal and escalation produce the right draft cards', async (t) => {
  for (const [out, re] of [[INFO, /2 precise question/], [FEATURE, /nothing is built until scope is approved/], [{ kind: 'other', outcome: 'escalate', summary: 's', escalation: 'touches maintainer policy' }, /maintainer decision \(touches maintainer policy\)/], [{ kind: 'question', outcome: 'not-actionable', summary: 's' }, /remains a maintainer decision/]] as const) {
    const r = rig(); t.after(r.cleanup); const o = await r.scan(new Runner(GOOD, () => done(out))); assert.equal(o.kind, 'accepted'); assert.match(o.card!.text, re);
  }
});

test('triage: unchanged revision is reused with no model call; an edited issue invalidates it; an edit during the run is rejected as stale', async (t) => {
  const r = rig(); t.after(r.cleanup); const runner = new Runner(GOOD, () => done(BUG));
  assert.equal((await r.scan(runner)).kind, 'accepted'); const reuse = await r.scan(runner); assert.equal(reuse.kind, 'reused'); assert.equal(runner.calls, 1);
  r.world.issues.get(r.n)!.body = 'Steps: open, save, crash. Also happens on Linux.';
  const again = await r.scan(runner); assert.equal(again.kind, 'accepted'); assert.match(again.notice, /invalidated: the issue changed since it was triaged/); assert.equal(runner.calls, 2);
  r.world.issues.get(r.n)!.body = 'a different report body';
  const stale = new Runner(GOOD, () => { r.world.issues.get(r.n)!.body = 'edited mid-run'; return done(BUG); });
  const s = await r.scan(stale); assert.equal(s.kind, 'rejected'); assert.equal(s.reason, 'revision-moved');
});

test('triage: PRs, stop, remote routing and missing isolation are refused before any attempt; a changed policy invalidates the accepted triage', async (t) => {
  const r = rig(); t.after(r.cleanup); const pr = r.world.addIssue({ isPr: true, title: 'a pr' });
  assert.equal((await r.scan(new Runner(GOOD, () => done(BUG)), { item: pr })).reason, 'is-pull-request');
  r.setStopped(true); assert.equal((await r.scan(new Runner(GOOD, () => done(BUG)))).reason, 'stopped'); r.setStopped(false);
  assert.match((await r.scan(new Runner({ ok: true, resolvedModel: 'hosted-x', isolation: 'seatbelt', failures: [] }, () => done(BUG)))).notice, /not a configured local model/);
  assert.match((await r.scan(new Runner({ ok: true, resolvedModel: 'local-default', failures: [] }, () => done(BUG)))).notice, /isolation/i);
  assert.equal(r.rec()!.attempts.used, 0);
  const runner = new Runner(GOOD, () => done(BUG)); await r.scan(runner, { policyDigest: 'aaaaaaaaaa' });
  const p = await r.scan(runner, { policyDigest: 'bbbbbbbbbb' }); assert.equal(p.kind, 'accepted'); assert.match(p.notice, /approved policy changed/); assert.equal(runner.calls, 2);
});
