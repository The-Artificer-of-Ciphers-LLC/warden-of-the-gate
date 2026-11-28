import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, claim, REPO, WRITER } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { planReconcile } from '../src/tasks/registry.ts';

async function readyIssue(r: ReturnType<typeof rig>) {
  const n = r.world.addIssue({ title: 'a bug', author: 'reporter1' });
  await r.world.view(WRITER).createComment(n, encodeLedger({ ...newLedger(REPO, n, 'issue'), state: 'ready' }));
  return n;
}
const ledgerOf = async (r: ReturnType<typeof rig>, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;

test('claim: an assignable contributor is assigned on GitHub and owns the item', async () => {
  const r = rig(); const n = await readyIssue(r);
  await r.send({ ...claim('contrib1'), item: n }); await r.writer().drain();
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, ['contrib1']);
  assert.equal((await ledgerOf(r, n)).owner?.id, 'contrib1');
  assert.equal((await ledgerOf(r, n)).owner?.ledgerOnly, undefined, 'an assigned claim is not marked ledger-only');
});

test('claim: when GitHub refuses the assignee, the claim is recorded in the ledger only, with no assignment attempt and an honest note', async () => {
  const r = rig(); r.world.nonAssignable.add('contrib1'); const n = await readyIssue(r);
  await r.send({ ...claim('contrib1'), item: n }); const rep = await r.writer().drain();
  assert.equal(rep.processed.find((p) => p.opid !== undefined)!.result, 'applied');
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, [], 'no GitHub assignment');
  assert.equal((await ledgerOf(r, n)).owner?.id, 'contrib1', 'the claim is still recorded');
  assert.equal((await ledgerOf(r, n)).owner?.ledgerOnly, true, 'the ledger says the claim was never a GitHub assignment');
  const bodies = (await r.world.view('x').listComments(n)).map((c) => c.body);
  assert.ok(bodies.some((b) => /recorded here only and no GitHub assignment was made/.test(b)));
});

test('claim: an outage during the assignability lookup retries later; it is never decided on a guess', async () => {
  const r = rig(); const n = await readyIssue(r);
  await r.send({ ...claim('contrib1'), item: n });
  r.world.down = true; await r.writer().drain().catch(() => undefined); r.world.down = false;
  assert.equal((await ledgerOf(r, n)).owner, null, 'nothing was decided during the outage');
  await r.writer().drain();
  assert.equal((await ledgerOf(r, n)).owner?.id, 'contrib1', 'the claim is decided once GitHub answers');
});

const reconcile = (r: ReturnType<typeof rig>, n: number) => r.send({ kind: 'reconcile', item: n, itemKind: 'issue', origin: 'deterministic', actor: 'warden-submit', payload: { why: 'owner-no-longer-assigned' }, source: { kind: 'sweep', id: `rec:${n}`, observedAt: new Date(r.world.now()).toISOString() } });

test('claim: a ledger-only claim survives the next GitHub reconcile, as an assigned claim would (owner ruling 2026-11-26)', async () => {
  const r = rig(); r.world.nonAssignable.add('contrib1'); const n = await readyIssue(r);
  await r.send({ ...claim('contrib1'), item: n }); await r.writer().drain();
  const delivery = (await ledgerOf(r, n)).obligations.find((o) => o.type === 'delivery');
  assert.ok(delivery, 'the delivery window started at the claim');
  const plan = await planReconcile(r.world.view('x'), r.cfg);
  assert.ok(!plan.some((p) => p.item === n && p.why === 'owner-no-longer-assigned'), 'reconcile planning does not treat the missing assignment as drift');
  await reconcile(r, n); await r.writer().drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'claimed'); assert.equal(l.owner?.id, 'contrib1');
  assert.deepEqual(l.obligations.find((o) => o.type === 'delivery'), delivery, 'the delivery commitment is unchanged');
  const bodies = (await r.world.view('x').listComments(n)).map((c) => c.body);
  assert.ok(!bodies.some((b) => /no longer assigned on GitHub/.test(b)), 'no release note was posted');
});

test('claim: a ledger-only claim ends when GitHub shows the issue assigned to someone else', async () => {
  const r = rig(); r.world.nonAssignable.add('contrib1'); const n = await readyIssue(r);
  await r.send({ ...claim('contrib1'), item: n }); await r.writer().drain();
  await r.world.view('x').addAssignee(n, 'other1');
  assert.ok((await planReconcile(r.world.view('x'), r.cfg)).some((p) => p.item === n && p.why === 'owner-no-longer-assigned'));
  await reconcile(r, n); await r.writer().drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'ready'); assert.equal(l.owner, null);
  assert.ok(!l.obligations.some((o) => o.type === 'delivery'), 'the delivery commitment ends');
  const bodies = (await r.world.view('x').listComments(n)).map((c) => c.body);
  assert.ok(bodies.some((b) => /assigned to other1, so contrib1's claim \(recorded here only/.test(b)));
});
