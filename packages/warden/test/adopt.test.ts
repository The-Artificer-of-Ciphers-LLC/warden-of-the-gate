import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, REPO, OPERATOR } from './helpers.ts';
import { parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { inventory, checkSelection, submitAdoption } from '../src/tasks/adopt.ts';
import type { Selection } from '../src/tasks/adopt.ts';
import { planSweep } from '../src/tasks/registry.ts';
import { HOUR } from '../src/sweep/clocks.ts';

const T0 = Date.parse('2026-11-01T00:00:00Z');
type Rig = ReturnType<typeof rig>;
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const effects = async (r: Rig, n: number) => (await r.world.view('x').listComments(n)).map((c) => c.body).filter((b) => b.startsWith('<!-- warden-effect'));
const inv = (r: Rig) => inventory(r.opStore, r.cfg, { now: r.world.now(), skip: new Set([r.inbox, r.control]) });
const adopt = async (r: Rig, sel: Selection, operator = OPERATOR) => { const i = await inv(r); const out = await submitAdoption(sel, i, r.cfg, { submitStore: r.submitStore, inboxIssue: r.inbox, now: r.world.now(), operator }); await r.writer({ assignable: () => true }).drain(); return out; };
const selection = async (r: Rig, items: Selection['items']): Promise<Selection> => ({ v: 1, repository: REPO, inventoryDigest: (await inv(r)).digest, items });

test('adoption preserves the existing owner and starts the delivery window at the adoption notice, never at the historical assignment', async () => {
  const r = rig(); r.world.clock = T0 - 90 * 24 * HOUR;                         // issue assigned 90 days ago
  const n = r.world.addIssue({ title: 'old claimed issue', body: 'b' }); await r.world.view('x').addAssignee(n, 'contrib1');
  r.world.clock = T0;
  await adopt(r, await selection(r, [{ item: n }]));
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'claimed'); assert.equal(l.owner?.id, 'contrib1');
  const ob = l.obligations[0]; assert.equal(ob.startedAt, new Date(T0).toISOString()); assert.equal(ob.dueAt, new Date(T0 + 48 * HOUR).toISOString()); assert.equal(ob.source, 'adoption-notice');
  assert.ok((await effects(r, n))[0].includes('not from the earlier assignment'));
  assert.deepEqual(await planSweep(r.opStore, r.cfg, { now: T0 + 47 * HOUR, skip: new Set([r.inbox, r.control]) }), [], 'adoption cannot manufacture an already-expired commitment');
  assert.equal((await r.world.view('x').getIssue(n)).state, 'open');
});

test('existing drafts need an explicit decision; keep survives later sweeps, close closes with the return path', async () => {
  const r = rig(); r.world.clock = T0;
  const a = r.world.addIssue({ isPr: true, draft: true, title: 'old draft kept', body: 'x' }); const b = r.world.addIssue({ isPr: true, draft: true, title: 'old draft closed', body: 'x' });
  const i = await inv(r); assert.ok(i.items.every((x) => x.needsDraftDecision));
  const undecided = checkSelection({ v: 1, repository: REPO, inventoryDigest: i.digest, items: [{ item: a }] }, i); assert.equal(undecided.ok, false);
  await adopt(r, await selection(r, [{ item: a, draft: 'keep' }, { item: b, draft: 'close' }]));
  assert.equal((await r.world.view('x').getIssue(a)).state, 'open'); assert.equal((await ledgerOf(r, a)).draftDecision, 'keep');
  assert.equal((await r.world.view('x').getIssue(b)).state, 'closed'); assert.ok((await effects(r, b))[0].includes('reopen'));
  assert.deepEqual(await planSweep(r.opStore, r.cfg, { now: T0 + 999 * HOUR, skip: new Set([r.inbox, r.control]) }), [], 'a kept draft is not closed by policy');
});

test('selection safety: stale inventory, other repository, unknown/duplicate items are refused; a non-maintainer adopter is rejected by the writer', async () => {
  const r = rig(); r.world.clock = T0; const n = r.world.addIssue({ title: 'old issue', body: 'b' }); const i = await inv(r);
  assert.equal(checkSelection({ v: 1, repository: REPO, inventoryDigest: 'stale', items: [{ item: n }] }, i).ok, false);
  assert.equal(checkSelection({ v: 1, repository: 'other/repo', inventoryDigest: i.digest, items: [{ item: n }] }, i).ok, false);
  assert.equal(checkSelection({ v: 1, repository: REPO, inventoryDigest: i.digest, items: [{ item: 99 }, { item: n }, { item: n }] }, i).ok, false);
  assert.equal(checkSelection({ v: 1, repository: REPO, inventoryDigest: i.digest, items: [] }, i).ok, false);
  await adopt(r, await selection(r, [{ item: n }]), 'random-user');
  assert.equal((await r.world.view('x').listComments(n)).some((c) => c.body.startsWith(LEDGER_MARK) && parseLedger(c.body)!.adoptedAt), false);
  await adopt(r, await selection(r, [{ item: n }]));
  assert.ok((await ledgerOf(r, n)).adoptedAt);
  assert.equal((await inv(r)).items.length, 0, 'adopted items leave the inventory; closing nothing for age');
});
