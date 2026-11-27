import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, claim, REPO, WRITER } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';

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
});

test('claim: when GitHub refuses the assignee, the claim is recorded in the ledger only, with no assignment attempt and an honest note', async () => {
  const r = rig(); r.world.nonAssignable.add('contrib1'); const n = await readyIssue(r);
  await r.send({ ...claim('contrib1'), item: n }); const rep = await r.writer().drain();
  assert.equal(rep.processed.find((p) => p.opid !== undefined)!.result, 'applied');
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, [], 'no GitHub assignment');
  assert.equal((await ledgerOf(r, n)).owner?.id, 'contrib1', 'the claim is still recorded');
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
