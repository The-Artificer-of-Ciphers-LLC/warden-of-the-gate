import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWorld } from '../src/github/fake.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeLedger } from '../src/writer/protocol.ts';
import { scanTriage } from '../src/scan/triage-scan.ts';
import type { TriageKV, TriageRecord } from '../src/triage/slice.ts';
import type { AgentRunner, PreflightReport, SessionResult, SessionRequest } from '../src/runner/agent-runner.ts';

const GOOD: PreflightReport = { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] };
const NA = { kind: 'other', outcome: 'not-actionable', summary: 'Nothing to do here' };
const ok = (o: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } });
class Runner implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; items: number[] = []; script: (item: number) => SessionResult;
  constructor(script: (item: number) => SessionResult = () => ok(NA)) { this.script = script; }
  async preflight() { return GOOD; }
  async run(req: SessionRequest) { this.items.push(req.item); return this.script(req.item); }
}
function rig() {
  const world = new FakeWorld(); const T = Date.parse('2026-11-18T12:00:00Z'); world.clock = T; const writer = world.view('warden-writer');
  const kvs = new Map<number, TriageRecord | null>(); const kvFor = (): TriageKV => ({ read: (n) => kvs.get(n) ?? null, write: (n, r) => { kvs.set(n, JSON.parse(JSON.stringify(r))); } });
  const issue = async (ageDays: number, o: { ledger?: boolean; state?: 'needs-triage' | 'ready' } = {}) => { world.clock = T - ageDays * 86_400_000; const n = world.addIssue({ title: `issue ${ageDays}d`, body: 'something', author: 'reporter' });
    if (o.ledger !== false) await writer.createComment(n, encodeLedger({ ...newLedger('acme/widgets', n, 'issue'), state: o.state ?? 'needs-triage' })); world.clock = T; return n; };
  const dir = mkdtempSync(join(tmpdir(), 'warden-tscan-'));
  const run = (runner: AgentRunner, o: Partial<Parameters<typeof scanTriage>[0]> = {}) => scanTriage({ store: world.view('operator'), runner, kvFor, wallTimeMs: 600_000, stopped: () => false, clock: () => world.now(),
    cfg: { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 1000 }, localModels: ['local-default'], expectedModel: 'local-default', packetRoot: dir },
    caps: { maxItems: 2, starveAfterHours: 168, maxFactoryImplementationPrs: 1, openFactoryImplementationPrs: 0 }, ...o });
  return { world, issue, kvs, run, snap: () => JSON.stringify(world.snapshot()), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('triage scan: oldest eligible issues run serially within the item budget; untracked, wrong-state and already-triaged issues are reported, not run; nothing is posted', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const a = await r.issue(1); const b = await r.issue(5); const c = await r.issue(3); const nostate = await r.issue(2, { ledger: false }); const ready = await r.issue(4, { state: 'ready' });
  const before = r.snap(); const runner = new Runner(); const rep = await r.run(runner);
  assert.deepEqual(runner.items, [b, c], 'oldest first, capped at 2'); assert.equal(rep.effectiveMode, 'shadow'); assert.deepEqual(rep.completed.map((x) => x.outcome), ['accepted', 'accepted']);
  assert.deepEqual(rep.pending.map((x) => x.item), [a]); assert.match(rep.pending[0].why, /item budget/);
  assert.deepEqual(rep.skipped.map((x) => x.item).sort(), [nostate, ready].sort()); assert.equal(r.snap(), before, 'a shadow scan changes nothing on GitHub');
  const again = new Runner(); const rep2 = await r.run(again); assert.deepEqual(again.items, [a], 'only the remaining issue runs'); assert.ok(rep2.skipped.some((x) => x.item === b && /already triaged/.test(x.why)));
});

test('triage scan: a stop ends the scan; the wall-time budget leaves the rest pending; exhausted retry budgets are blocked, never retried by a restart', async (t) => {
  const r = rig(); t.after(r.cleanup); const a = await r.issue(5); const b = await r.issue(4);
  const s = await r.run(new Runner(), { stopped: () => true }); assert.equal(s.stoppedEarly, 'stop in force'); assert.deepEqual(s.pending.map((x) => x.item).sort(), [a, b].sort()); assert.equal(s.completed.length, 0);
  const w = await r.run(new Runner(), { wallTimeMs: 0 }); assert.equal(w.stoppedEarly, 'wall-time budget reached'); assert.equal(w.completed.length, 0);
  const bad = new Runner(() => ok({ kind: 'bug', outcome: 'likely-bug', summary: 'x', evidence: [] }));
  for (let i = 0; i < 3; i++) await r.run(bad, { only: [a] });
  const last = await r.run(new Runner(), { only: [a] }); assert.deepEqual(last.blocked.map((x) => x.item), [a]); assert.match(last.blocked[0].why, /retry budget/);
});
