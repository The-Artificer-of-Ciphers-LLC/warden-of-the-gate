import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, REPO, WRITER } from './helpers.ts';
import type { Rig } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { Faults } from '../src/util.ts';

/** P4 merge delivery through the one serialized writer: enqueue is not merge; the merge is bound to the head the requester saw; GitHub must confirm
 *  before the ledger says merged; stale, duplicate and lost-acknowledgement deliveries produce no second accepted merge. Shadow mode never merges. */
const setup = async (over: Record<string, unknown> = { mode: 'live' }) => {
  const r = rig(over); const n = r.world.addIssue({ isPr: true, title: 'docs fix', author: 'contrib1' });
  r.world.issues.get(n)!.pull = { head: 'headaaaa0000', base: 'basebbbb0000', ci: 'passing', files: [{ path: 'docs/guide.md', status: 'modified' }] };
  await r.world.view('x').addLabel(n, 'warden:merge-ready');
  const l = newLedger(REPO, n, 'pr'); l.state = 'merge-ready'; l.facets = { risk: 'low', workKind: 'documentation' };
  await r.world.view(WRITER).createComment(n, encodeLedger(l));
  return { r, n };
};
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const record = (r: Rig, n: number, sev: string[] = []) => r.send({ kind: 'review-record', item: n, itemKind: 'pr', origin: 'ai', actor: 'warden-reviewer', payload: { head: 'headaaaa0000', base: 'basebbbb0000', verdict: sev.length ? 'changes needed' : 'no findings', severities: sev, policyDigest: r.policy.digest } });
const request = (r: Rig, n: number, head = 'headaaaa0000', id = 'm1') => r.send({ kind: 'merge-request', item: n, itemKind: 'pr', origin: 'deterministic', actor: 'warden-actions', payload: { expectedHead: head }, source: { kind: 'event', id, observedAt: new Date(r.world.now()).toISOString() } });
const merged = (r: Rig, n: number) => r.world.issues.get(n)!.pull!.merged === true;

test('shadow mode never merges: the AI review cannot be recorded and a merge request is refused', async () => {
  const { r, n } = await setup({}); await record(r, n); await request(r, n); await r.writer().drain();
  assert.equal(merged(r, n), false); assert.equal((await ledgerOf(r, n)).state, 'merge-ready'); assert.equal((await ledgerOf(r, n)).review, undefined);
});

test('live: an eligible, reviewed PR is merged bound to its head; GitHub confirms before the ledger says merged; the ready label is projected away', async () => {
  const { r, n } = await setup(); await record(r, n); await request(r, n);
  const rep = await r.writer().drain(); assert.ok(rep.processed.every((p) => p.result === 'applied'), JSON.stringify(rep.processed));
  assert.equal(merged(r, n), true); const l = await ledgerOf(r, n); assert.equal(l.state, 'merged');
  assert.ok(!(await r.world.view('x').getIssue(n)).labels.includes('warden:merge-ready'));
});

test('ineligible requests are rejected with no merge: no review, an open blocker, pending checks, a draft, an escalation', async () => {
  for (const [name, prep] of [
    ['no review', async (r: Rig, n: number) => { void r; void n; }],
    ['blocker', async (r: Rig, n: number) => { await record(r, n, ['blocker']); }],
    ['checks pending', async (r: Rig, n: number) => { await record(r, n); r.world.issues.get(n)!.pull!.ci = 'pending'; }],
    ['draft', async (r: Rig, n: number) => { await record(r, n); r.world.issues.get(n)!.draft = true; }],
    ['workflow path', async (r: Rig, n: number) => { await record(r, n); r.world.issues.get(n)!.pull!.files = [{ path: '.github/workflows/ci.yml', status: 'modified' }]; }],
  ] as const) {
    const { r, n } = await setup(); await prep(r, n); await request(r, n);
    const rep = await r.writer().drain(); assert.equal(merged(r, n), false, name); assert.ok(rep.processed.some((p) => p.result === 'rejected' && /^merge-/.test(p.reason ?? '')), name + JSON.stringify(rep.processed));
  }
});

test('stale delivery: a request bound to an old head is rejected; a head that moves between decision and effect is a clean stale-merge rejection with no retry and no merge', async () => {
  const a = await setup(); await record(a.r, a.n); await request(a.r, a.n, 'oldhead00000');
  const ra = await a.r.writer().drain(); assert.ok(ra.processed.some((p) => /stale-request/.test(p.reason ?? ''))); assert.equal(merged(a.r, a.n), false);

  const b = await setup(); await record(b.r, b.n); await request(b.r, b.n);
  const faults = new Faults(); faults.onStall('before-effect:1', async () => { b.r.world.issues.get(b.n)!.pull!.head = 'headmoved000'; });
  const rb = await b.r.writer({}, faults).drain();
  const last = rb.processed.at(-1)!; assert.equal(last.result, 'rejected'); assert.match(last.reason ?? '', /stale-merge:head moved/);
  assert.equal(merged(b.r, b.n), false); assert.equal((await ledgerOf(b.r, b.n)).state, 'merge-ready');
  const led = await ledgerOf(b.r, b.n); assert.equal(led.ops[Object.keys(led.ops).at(-1)!].attempts, 0, 'no retry of a stale merge');
});

test('duplicate delivery and a lost acknowledgement produce exactly one accepted merge', async () => {
  const { r, n } = await setup(); await record(r, n); await request(r, n); await request(r, n);
  const rep = await r.writer().drain(); assert.ok(rep.processed.some((p) => p.result === 'duplicate')); assert.equal(merged(r, n), true);

  const lost = await setup(); await record(lost.r, lost.n); await request(lost.r, lost.n);
  const faults = new Faults(); faults.arm('reply-lost:mergePull');
  const first = await lost.r.writer({}, faults).drain();
  const mine = first.processed.filter((p) => p.opid === first.processed.find((x) => x.result === 'retry')!.opid);
  assert.deepEqual(mine.map((p) => p.result), ['retry', 'applied'], 'the lost reply is retried and resolved against GitHub, not merged twice');
  assert.equal(merged(lost.r, lost.n), true); assert.equal((await ledgerOf(lost.r, lost.n)).state, 'merged');
  const second = await lost.r.writer().drain(); assert.deepEqual(second.processed, [], 'nothing left to do; no second merge effect');
});
