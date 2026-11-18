import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, REPO, WRITER, OPERATOR } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import type { Ledger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { planSweep, submitSweep } from '../src/tasks/registry.ts';
import { HOUR } from '../src/sweep/clocks.ts';

const T0 = Date.parse('2026-11-01T00:00:00Z');
type Rig = ReturnType<typeof rig>;
const at = (r: Rig, h: number) => { r.world.clock = T0 + h * HOUR; };
const iso = (h: number) => new Date(T0 + h * HOUR).toISOString();
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const effects = async (r: Rig, n: number) => (await r.world.view('x').listComments(n)).map((c) => c.body).filter((b) => b.startsWith('<!-- warden-effect'));
const seed = (r: Rig, n: number, kind: 'issue' | 'pr', patch: Partial<Ledger>) => r.world.view(WRITER).createComment(n, encodeLedger({ ...newLedger(REPO, n, kind), ...patch }));
const w = (r: Rig) => r.writer({ assignable: () => true });
const sweep = async (r: Rig) => { const f = await planSweep(r.opStore, r.cfg, { now: r.world.now(), skip: new Set([r.inbox, r.control]) }); await submitSweep(f, { submitStore: r.submitStore, repo: REPO, inboxIssue: r.inbox, now: r.world.now() }); await w(r).drain(); return f; };
const det = { origin: 'deterministic' as const, actor: 'warden-submit' };

async function readyPr(r: Rig, patch: Partial<Ledger> = {}) {
  at(r, 0); const n = r.world.addIssue({ isPr: true, author: 'contrib1', title: 'fix', body: 'x' });
  await seed(r, n, 'pr', { state: 'needs-review', attempts: { launchRetries: 0, reworkCycles: 0, contributorFixRounds: 0, review: 1 }, linked: [9], ...patch }); return n;
}
const round = (r: Rig, n: number, id: string) => r.send({ ...det, kind: 'review-round', item: n, itemKind: 'pr', payload: { blocking: true }, source: { kind: 'review', id, observedAt: new Date(r.world.now()).toISOString() } });

test('a blocking review starts a 48h fix window and a response clock; the sweep then enforces them (expiry beats later silence)', async () => {
  const r = rig(); const n = await readyPr(r);
  await round(r, n, 'rev1'); await w(r).drain();
  let l = await ledgerOf(r, n);
  assert.equal(l.state, 'needs-author'); assert.equal(l.attempts.contributorFixRounds, 1);
  const fw = l.obligations.find((o) => o.type === 'fix-window')!; assert.equal(Date.parse(fw.dueAt) - Date.parse(fw.startedAt), 48 * HOUR);
  assert.ok(l.obligations.some((o) => o.type === 'response'));
  assert.ok((await effects(r, n))[0].includes('48 hours'));
  at(r, 47); assert.deepEqual(await sweep(r), []);
  at(r, 49); const f = await sweep(r); assert.equal(f[0].due.kind, 'expire-commitment');
  assert.equal((await r.world.view('x').getIssue(n)).state, 'closed');
  assert.ok((await effects(r, n)).some((b) => b.includes('48-hour fix window ended') && b.includes('#9')));
});

test('a timely fix submission satisfies the window, clears the response clock and returns the PR to review; a draft or late push does not count', async () => {
  const r = rig(); const n = await readyPr(r);
  await round(r, n, 'rev1'); await w(r).drain();
  r.world.issues.get(n)!.draft = true; at(r, 10);
  await r.send({ ...det, kind: 'submission', item: n, itemKind: 'pr', payload: {}, source: { kind: 'push', id: 'p1', observedAt: iso(10) } }); await w(r).drain();
  assert.equal((await ledgerOf(r, n)).state, 'needs-author', 'a draft is not delivery');
  r.world.issues.get(n)!.draft = false;
  await r.send({ ...det, kind: 'submission', item: n, itemKind: 'pr', payload: {}, source: { kind: 'push', id: 'p2', observedAt: iso(11) } }); await w(r).drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'needs-review'); assert.ok(l.obligations.find((o) => o.type === 'fix-window')!.satisfiedAt); assert.ok(!l.obligations.some((o) => o.type === 'response'));
  at(r, 500); assert.deepEqual(await sweep(r), [], 'delayed review/CI never expires a recorded timely submission');
});

test('late submission is not recorded as timely', async () => {
  const r = rig(); const n = await readyPr(r);
  await round(r, n, 'rev1'); await w(r).drain(); at(r, 60);
  await r.send({ ...det, kind: 'submission', item: n, itemKind: 'pr', payload: {}, source: { kind: 'push', id: 'late', observedAt: iso(55) } }); await w(r).drain();
  assert.ok(!(await ledgerOf(r, n)).obligations.find((o) => o.type === 'fix-window')!.satisfiedAt);
});

test('issue delivery: a ready linked PR satisfies the delivery commitment before assessment', async () => {
  const r = rig(); at(r, 0);
  const issue = r.world.addIssue({ title: 'a fine title', body: 'b' }); const pr = r.world.addIssue({ isPr: true, title: 'fix', body: 'x' });
  await seed(r, issue, 'issue', { state: 'claimed', owner: { kind: 'contributor', id: 'contrib1', opid: 'op' }, obligations: [{ type: 'delivery', startedAt: iso(0), dueAt: iso(48), source: 'assignment' }] });
  at(r, 20); await r.send({ ...det, kind: 'submission', item: issue, itemKind: 'issue', payload: { pr }, source: { kind: 'pr-opened', id: 'o1', observedAt: iso(20) } }); await w(r).drain();
  const l = await ledgerOf(r, issue);
  assert.equal(l.state, 'in-review'); assert.deepEqual(l.linked, [pr]); assert.ok(l.obligations[0].satisfiedAt);
  at(r, 300); assert.deepEqual(await sweep(r), []);
});

test('fix-round exhaustion routes to the maintainer, never to closure; an approved extra round continues', async () => {
  const r = rig(); const n = await readyPr(r, { attempts: { launchRetries: 0, reworkCycles: 0, contributorFixRounds: 3, review: 4 } });
  await round(r, n, 'rev4'); await w(r).drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'needs-decision'); assert.equal((await r.world.view('x').getIssue(n)).state, 'open');
  assert.ok(!l.obligations.some((o) => o.type === 'fix-window'));
  at(r, 9999); assert.deepEqual(await sweep(r), [], 'maintainer wait is never swept');

  const r2 = rig(); const m = await readyPr(r2, { attempts: { launchRetries: 0, reworkCycles: 0, contributorFixRounds: 3, review: 4 },
    approvals: { a1: { id: 'a1', type: 'action', action: 'extra-fix-round', binding: { revision: 'r', policyDigest: 'd', evidenceDigest: 'e' }, bindingDigest: 'x', requestedBy: 'm', requestedAt: iso(0), expiresAt: null, status: 'approved', decidedBy: 'maint1' } } });
  await round(r2, m, 'rev4'); await w(r2).drain();
  assert.equal((await ledgerOf(r2, m)).state, 'needs-author');
});

async function command(r: Rig, n: number, kind: 'hold' | 'hold-release', as: string, text: string, payload: Record<string, unknown>, itemKind: 'issue' | 'pr' = 'issue') {
  const cid = await r.comment(as, n, text);
  await r.send({ kind, item: n, itemKind, origin: 'maintainer', actor: as, payload, source: { kind: 'gh-comment', id: String(cid), observedAt: new Date(r.world.now()).toISOString() } });
}
async function claimedIssue(r: Rig) {
  at(r, 0); const n = r.world.addIssue({ title: 'a fine title', body: 'b' });
  await r.world.view('x').addAssignee(n, 'contrib1');
  await seed(r, n, 'issue', { state: 'claimed', owner: { kind: 'contributor', id: 'contrib1', opid: 'op' }, obligations: [{ type: 'delivery', startedAt: iso(0), dueAt: iso(48), source: 'assignment' }] }); return n;
}

test('maintainer hold freezes the unexpired time and release publishes a revised deadline; the sweep respects both', async () => {
  const r = rig(); const n = await claimedIssue(r);
  at(r, 30); await command(r, n, 'hold', OPERATOR, '/warden hold waiting on design decision', { reason: 'waiting on design decision' }); await w(r).drain();
  let l = await ledgerOf(r, n); assert.equal(l.obligations[0].hold?.remainingMs, 18 * HOUR);
  at(r, 1000); assert.deepEqual(await sweep(r), [], 'held commitments never expire');
  await command(r, n, 'hold-release', OPERATOR, '/warden release-hold', {}); await w(r).drain();
  l = await ledgerOf(r, n); assert.equal(l.obligations[0].hold, undefined); assert.equal(l.obligations[0].dueAt, iso(1018));
  assert.ok((await effects(r, n)).some((b) => b.includes('Revised deadline') && b.includes(iso(1018))));
  at(r, 1019); assert.equal((await sweep(r))[0].due.kind, 'expire-commitment');
});

test('hold authority: a non-maintainer, a forged source and an already-expired commitment are all rejected', async () => {
  const r = rig(); const n = await claimedIssue(r); at(r, 30);
  await command(r, n, 'hold', 'random-user', '/warden hold please', { reason: 'please' }); await w(r).drain();
  assert.equal((await ledgerOf(r, n)).obligations[0].hold, undefined);
  await r.send({ kind: 'hold', item: n, itemKind: 'issue', origin: 'maintainer', actor: OPERATOR, payload: { reason: 'forged' }, source: { kind: 'gh-comment', id: '99999', observedAt: iso(30) } }); await w(r).drain();
  assert.equal((await ledgerOf(r, n)).obligations[0].hold, undefined);
  at(r, 60); await command(r, n, 'hold', OPERATOR, '/warden hold too late', { reason: 'too late' }); await w(r).drain();
  assert.equal((await ledgerOf(r, n)).obligations[0].hold, undefined, 'a late hold cannot rescue an expired commitment');
});

test('reconcile: externally closed issue is mirrored without reopening; externally unassigned claim is released; labels are repaired', async () => {
  const r = rig(); at(r, 0);
  const closed = r.world.addIssue({ title: 'closed outside', body: 'b' }); await seed(r, closed, 'issue', { state: 'ready' }); await r.world.view('x').closeIssue(closed);
  const un = r.world.addIssue({ title: 'unassigned outside', body: 'b' });
  await seed(r, un, 'issue', { state: 'claimed', owner: { kind: 'contributor', id: 'contrib1', opid: 'op' }, obligations: [{ type: 'delivery', startedAt: iso(0), dueAt: iso(48), source: 'assignment' }] });
  const lab = r.world.addIssue({ title: 'label deleted', body: 'b' }); await seed(r, lab, 'issue', { state: 'ready' }); await r.world.view('x').addLabel(lab, 'warden:needs-info');
  const done = r.world.addIssue({ title: 'ledger closed', body: 'b' }); await seed(r, done, 'issue', { state: 'closed' });
  for (const [item, itemKind] of [[closed, 'issue'], [un, 'issue'], [lab, 'issue'], [done, 'issue']] as const) await r.send({ ...det, kind: 'reconcile', item, itemKind, payload: {}, source: { kind: 'sweep', id: 'rec:' + item, observedAt: iso(0) } });
  await w(r).drain();
  assert.equal((await ledgerOf(r, closed)).state, 'closed');
  const u = await ledgerOf(r, un); assert.equal(u.state, 'ready'); assert.equal(u.owner, null); assert.equal(u.obligations.length, 0);
  const li = await r.world.view('x').getIssue(lab); assert.ok(li.labels.includes('warden:ready') && !li.labels.includes('warden:needs-info'), li.labels.join());
  assert.equal((await r.world.view('x').getIssue(done)).state, 'open', 'a closed ledger never reopens the item');
});
