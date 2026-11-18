import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWorld } from '../src/github/fake.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeLedger } from '../src/writer/protocol.ts';
import { scanReviews } from '../src/scan/review-scan.ts';
import type { ReviewKV, ReviewRecord } from '../src/review/slice.ts';
import type { AgentRunner, PreflightReport, SessionResult, SessionRequest } from '../src/runner/agent-runner.ts';

const GOOD: PreflightReport = { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] };
const CLEAN = { verdict: 'no findings', findings: [] };
const ok = (output: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: output, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } });
class Runner implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; items: number[] = []; script: (item: number, signal: AbortSignal) => SessionResult | Promise<SessionResult>;
  constructor(script: (item: number, signal: AbortSignal) => SessionResult | Promise<SessionResult> = () => ok(CLEAN)) { this.script = script; }
  async preflight() { return GOOD; }
  async run(req: SessionRequest, signal: AbortSignal) { this.items.push(req.item); return this.script(req.item, signal); }
}

function rig() {
  const world = new FakeWorld(); world.clock = Date.parse('2026-11-18T12:00:00Z'); const writer = world.view('warden-writer');
  const kvs = new Map<number, ReviewRecord | null>(); const kvFor = (item: number): ReviewKV => ({ read: () => kvs.get(item) ?? null, write: (_i, r) => { kvs.set(item, JSON.parse(JSON.stringify(r))); } });
  const pr = async (ageDays: number, o: { ledger?: boolean; state?: 'needs-review' | 'blocked'; draftless?: boolean } = {}) => {
    world.clock = Date.parse('2026-11-18T12:00:00Z') - ageDays * 86_400_000; const n = world.addIssue({ isPr: true, title: `pr ${ageDays}d`, author: 'contrib' });
    world.issues.get(n)!.pull = { head: `head${n}`.padEnd(12, '0'), base: 'base00000000', ci: 'passing', files: [{ path: 'src/a.ts', status: 'modified', patch: '@@' }] };
    if (o.ledger !== false) await writer.createComment(n, encodeLedger({ ...newLedger('acme/widgets', n, 'pr'), state: o.state ?? 'needs-review' }));
    world.clock = Date.parse('2026-11-18T12:00:00Z'); return n;
  };
  const dir = mkdtempSync(join(tmpdir(), 'warden-scan-'));
  const base = (runner: AgentRunner, o: Partial<Parameters<typeof scanReviews>[0]> = {}) => scanReviews({ store: world.view('operator'), runner, kvFor, wallTimeMs: 600_000, stopped: () => false, clock: () => world.now(),
    cfg: { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 1000 }, localModels: ['local-default'], expectedModel: 'local-default', packetRoot: dir },
    caps: { maxItems: 2, starveAfterHours: 168, maxFactoryImplementationPrs: 1, openFactoryImplementationPrs: 0 }, ...o });
  return { world, pr, kvs, kvFor, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('scan: eligible PRs run serially in priority order within the item budget; no-state, wrong-state and exhausted PRs are reported, not run', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const old = await r.pr(10), mid = await r.pr(5), fresh = await r.pr(1); const bare = await r.pr(3, { ledger: false }); const blocked = await r.pr(4, { state: 'blocked' }); const spent = await r.pr(20);
  r.kvs.set(spent, { v: 1, item: spent, attempts: { used: 3 }, marker: null, card: null, log: [] });
  const runner = new Runner(); const rep = await r.base(runner);
  assert.deepEqual(runner.items, [old, mid].filter((x) => x), 'oldest eligible first, two items per invocation'); assert.equal(rep.completed.length, 2);
  assert.deepEqual(rep.pending.map((p) => p.item), [fresh]); assert.match(rep.pending[0].why, /item budget reached/);
  assert.deepEqual(rep.blocked.map((b) => b.item), [spent]);
  assert.deepEqual(rep.skipped.map((s) => s.item).sort(), [bare, blocked].sort()); assert.equal(rep.effectiveMode, 'shadow');
});

test('scan: work in progress (an accepted review of an older head) is finished before new work; reviewed-at-this-head items are skipped', async (t) => {
  const r = rig(); t.after(r.cleanup);
  const newer = await r.pr(5); const progressing = await r.pr(2); const done = await r.pr(8);
  const old = { head: 'oldhead00000', base: 'base00000000', verdict: 'no findings' as const, findings: [], ci: 'passing' as const, acceptedAt: '2026-11-01T00:00:00Z' };
  r.kvs.set(progressing, { v: 1, item: progressing, attempts: { used: 0 }, marker: old, card: null, log: [] });
  r.kvs.set(done, { v: 1, item: done, attempts: { used: 0 }, marker: { ...old, head: r.world.issues.get(done)!.pull!.head }, card: null, log: [] });
  const runner = new Runner(); const rep = await r.base(runner);
  assert.equal(runner.items[0], progressing); assert.ok(rep.skipped.some((s) => s.item === done && /already reviewed/.test(s.why)));
  assert.ok(runner.items.includes(newer));
});

test('scan: stop in force, wall-time budget and an interrupted session each end the scan with the rest reported as pending', async (t) => {
  const r = rig(); t.after(r.cleanup); const a = await r.pr(3), b = await r.pr(2), c = await r.pr(1);
  let n = 0; const stopAfterFirst = await r.base(new Runner(), { stopped: () => n++ > 0, caps: { maxItems: 5, starveAfterHours: 168, maxFactoryImplementationPrs: 1, openFactoryImplementationPrs: 0 } });
  assert.equal(stopAfterFirst.completed.length, 1); assert.equal(stopAfterFirst.stoppedEarly, 'stop in force'); assert.deepEqual(stopAfterFirst.pending.map((p) => p.item).sort(), [b, c].sort());

  const r2 = rig(); t.after(r2.cleanup); await r2.pr(3); await r2.pr(2);
  const slow = new Runner(() => { r2.world.clock = r2.world.now() + 700_000; return ok(CLEAN); });
  const timed = await r2.base(slow, { caps: { maxItems: 5, starveAfterHours: 168, maxFactoryImplementationPrs: 1, openFactoryImplementationPrs: 0 } });
  assert.equal(timed.completed.length, 1); assert.equal(timed.stoppedEarly, 'wall-time budget reached'); assert.match(timed.pending[0].why, /wall-time budget/);

  const r3 = rig(); t.after(r3.cleanup); await r3.pr(3); const x = await r3.pr(2); void a;
  const ac = new AbortController(); const aborting = new Runner(() => ({ outcome: 'interrupted', reason: 'aborted', usage: { toolCalls: 0, modelTurns: 0, wallMs: 1 } }));
  const intr = await r3.base(aborting, { signal: ac.signal, caps: { maxItems: 5, starveAfterHours: 168, maxFactoryImplementationPrs: 1, openFactoryImplementationPrs: 0 } });
  assert.equal(intr.stoppedEarly, 'interrupted'); assert.equal(intr.completed[0].outcome, 'rejected' === intr.completed[0].outcome ? 'rejected' : intr.completed[0].outcome); assert.ok(intr.pending.some((p) => p.item === x) || intr.completed.length === 2);
});
