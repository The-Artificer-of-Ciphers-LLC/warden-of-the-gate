import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliEnv } from './cli-env.ts';
import { claim, rig, REPO } from './helpers.ts';
import { LEDGER_MARK, makeIntent, parseLedger } from '../src/writer/protocol.ts';
import { submit } from '../src/writer/journal.ts';
import { checkAuthorized } from '../src/approvals/approvals.ts';
import type { Ledger } from '../src/state/model.ts';

const led = async (r: ReturnType<typeof rig>, n: number): Promise<Ledger> => parseLedger((await r.world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!.body)!;
const binding = (r: ReturnType<typeof rig>, revision = 'rev1', evidenceDigest = 'ev1') => ({ revision, policyDigest: r.policy.digest, evidenceDigest });
async function requested(r: ReturnType<typeof rig>, n: number, extra: Record<string, unknown> = {}, itemKind: 'issue' | 'pr' = 'pr') {
  const i = r.intent({ kind: 'approval-request', item: n, itemKind, actor: 'warden-submit', payload: { type: 'action', action: 'merge', binding: binding(r), subjectAuthor: 'dev1', ...extra } });
  await submit(r.submitStore, r.inbox, i, null); await r.writer().drain(); return 'apr_' + i.opid.slice(3, 15);
}
async function decide(r: ReturnType<typeof rig>, n: number, id: string, as: string, decision: string, o: { bind?: string | null; itemKind?: 'issue' | 'pr'; forgeActor?: string } = {}) {
  const cid = await r.comment(as, n, `/warden ${decision} ${id}`);
  const l = await led(r, n); const bind = o.bind === null ? undefined : o.bind ?? l.approvals[id]?.bindingDigest;
  const i = r.intent({ kind: 'approval-decision', item: n, itemKind: o.itemKind ?? 'pr', origin: 'maintainer', actor: o.forgeActor ?? as, source: { kind: 'gh-comment', id: String(cid), observedAt: new Date().toISOString() }, payload: { approvalId: id, decision, bind } });
  await submit(r.submitStore, r.inbox, i, null); const rep = await r.writer().drain();
  return rep.processed.find((p) => p.opid === i.opid)!;
}
const newPr = (r: ReturnType<typeof rig>) => r.world.addIssue({ isPr: true, head: 'a'.repeat(40), author: 'dev1' });

test('approve by authorized maintainer is recorded before work is authorized; decision lands in corpus data', async () => {
  const r = rig(); const n = newPr(r); const id = await requested(r, n);
  assert.deepEqual(checkAuthorized(await led(r, n), 'merge', r.policy, r.world.now()), { ok: false, reason: 'pending' });
  const p = await decide(r, n, id, 'maint1', 'approve'); assert.equal(p.result, 'applied');
  const l = await led(r, n); assert.equal(l.approvals[id].status, 'approved'); assert.equal(l.approvals[id].decidedBy, 'maint1');
  assert.equal(checkAuthorized(l, 'merge', r.policy, r.world.now()).ok, true);
  assert.ok((await r.world.view('x').listComments(n)).some((c) => /Maintainer decision recorded/.test(c.body) && !c.body.startsWith(LEDGER_MARK)));
});
test('unauthorized identity, forged actor, edited comment fail visibly and authorize nothing', async () => {
  const r = rig(); const n = newPr(r); const id = await requested(r, n);
  assert.equal((await decide(r, n, id, 'mallory', 'approve')).reason, 'unauthorized-identity');
  assert.equal((await decide(r, n, id, 'mallory', 'approve', { forgeActor: 'maint1' })).reason, 'unverified-source', 'submitter cannot forge a maintainer');
  const l = await led(r, n); assert.equal(l.approvals[id].status, 'pending'); assert.equal(checkAuthorized(l, 'merge', r.policy, r.world.now()).ok, false);
  assert.ok((await r.world.view('x').listComments(n)).some((c) => /not an authorized maintainer/.test(c.body)));
});
test('replayed, conflicting, wrongly bound and unbound decisions are rejected', async () => {
  const r = rig(); const n = newPr(r); const id = await requested(r, n);
  assert.equal((await decide(r, n, id, 'maint1', 'approve', { bind: null })).reason, 'missing-binding');
  assert.equal((await decide(r, n, id, 'maint1', 'approve', { bind: 'deadbeef0000' })).reason, 'stale-binding');
  assert.equal((await decide(r, n, id, 'maint1', 'approve')).result, 'applied');
  assert.equal((await decide(r, n, id, 'maint1', 'approve')).reason, 'replayed-decision');
  assert.equal((await decide(r, n, id, 'maint2', 'deny')).reason, 'conflicting-decision');
  assert.equal((await led(r, n)).approvals[id].status, 'approved', 'first recorded decision stands');
});
test('24-hour expiry: silence/expiry grants nothing; late approval rejected; use-time check enforces expiry', async () => {
  const r = rig(); const n = newPr(r); const id = await requested(r, n);
  r.world.clock = r.world.now() + 25 * 3600_000;
  assert.match((await decide(r, n, id, 'maint1', 'approve')).reason!, /expired/);
  const l = await led(r, n); assert.equal(l.approvals[id].status, 'expired'); assert.equal(checkAuthorized(l, 'merge', r.policy, r.world.now()).ok, false);
  // approved then expires at use time
  const r2 = rig(); const n2 = newPr(r2); const a = await requested(r2, n2); await decide(r2, n2, a, 'maint1', 'approve');
  assert.equal(checkAuthorized(await led(r2, n2), 'merge', r2.policy, r2.world.now() + 23 * 3600_000).ok, true);
  assert.deepEqual(checkAuthorized(await led(r2, n2), 'merge', r2.policy, r2.world.now() + 25 * 3600_000), { ok: false, reason: 'expired' });
});
test('configurable expiry is honored', async () => {
  const r = rig({ approvals: { actionExpiryHours: 1 } }); const n = newPr(r); const id = await requested(r, n);
  const l = await led(r, n); assert.equal(Date.parse(l.approvals[id].expiresAt!) - Date.parse(l.approvals[id].requestedAt), 3600_000);
});
test('revision/policy/evidence change invalidates; stale approval cannot authorize', async () => {
  const r = rig(); const n = newPr(r); const id = await requested(r, n); await decide(r, n, id, 'maint1', 'approve');
  const upd = r.intent({ kind: 'revision-update', item: n, itemKind: 'pr', actor: 'warden-submit', payload: { revision: 'rev2', head: 'b'.repeat(40) } });
  await submit(r.submitStore, r.inbox, upd, null); await r.writer().drain();
  const l = await led(r, n); assert.equal(l.approvals[id].status, 'invalidated'); assert.equal(l.approvals[id].invalidReason, 'revision-changed'); assert.equal(l.evidence.head, 'b'.repeat(40));
  assert.equal(checkAuthorized(l, 'merge', r.policy, r.world.now()).ok, false);
  // policy change (different digest) invalidates a pending request's decision
  const r2 = rig(); const n2 = newPr(r2); const id2 = await requested(r2, n2);
  const w2 = r2.writer({ policy: { ...r2.policy, digest: 'changedpolicy' } }); const cid = await r2.comment('maint1', n2, 'x');
  const l2 = await led(r2, n2); const i = r2.intent({ kind: 'approval-decision', item: n2, itemKind: 'pr', origin: 'maintainer', actor: 'maint1', source: { kind: 'gh-comment', id: String(cid), observedAt: '' }, payload: { approvalId: id2, decision: 'approve', bind: l2.approvals[id2].bindingDigest } });
  await submit(r2.submitStore, r2.inbox, i, null); const rep = await w2.drain(); assert.equal(rep.processed.find((p) => p.opid === i.opid)!.reason, 'stale-binding:policy-changed');
  assert.equal((await led(r2, n2)).approvals[id2].status, 'invalidated');
});
test('request built against stale revision or different policy is rejected', async () => {
  const r = rig(); const n = newPr(r); await requested(r, n);
  const bad = r.intent({ kind: 'approval-request', item: n, itemKind: 'pr', actor: 'warden-submit', payload: { type: 'action', action: 'merge', binding: { revision: 'old', policyDigest: r.policy.digest, evidenceDigest: 'ev1' } } });
  await submit(r.submitStore, r.inbox, bad, null); let rep = await r.writer().drain(); assert.equal(rep.processed[0].reason, 'stale-request:revision');
  const bad2 = r.intent({ kind: 'approval-request', item: n, itemKind: 'pr', actor: 'warden-submit', payload: { type: 'action', action: 'merge', binding: { revision: 'rev1', policyDigest: 'other', evidenceDigest: 'ev1' } } });
  await submit(r.submitStore, r.inbox, bad2, null); rep = await r.writer().drain(); assert.equal(rep.processed[0].reason, 'stale-request:policy');
});
test('approval-policy conflict: orders deny prevails; independent approver required; PR author cannot approve own change', async () => {
  const r = rig({}, { schemaVersion: 1, programs: [{ name: 'no-deps', tasks: ['merge'], decision: 'deny', scope: { kinds: ['dependency'] } }] });
  const n = newPr(r);
  const i = r.intent({ kind: 'approval-request', item: n, itemKind: 'pr', actor: 'warden-submit', payload: { type: 'action', action: 'merge', binding: binding(r), query: { task: 'merge', kind: 'dependency' } } });
  await submit(r.submitStore, r.inbox, i, null); const rep = await r.writer().drain(); assert.equal(rep.processed[0].reason, 'denied-by-orders');
  const r2 = rig({ maintainers: ['dev1', 'maint1'] }); const n2 = newPr(r2); const id = await requested(r2, n2, { subjectAuthor: 'dev1' });
  assert.equal((await decide(r2, n2, id, 'dev1', 'approve')).reason, 'self-approval');
  assert.equal((await decide(r2, n2, id, 'maint1', 'approve')).result, 'applied');
  const r3 = rig({ maintainers: ['dev1', 'maint1'], approvals: { requireIndependentApprover: false } }); const n3 = newPr(r3); const id3 = await requested(r3, n3, { subjectAuthor: 'dev1' });
  assert.equal((await decide(r3, n3, id3, 'dev1', 'approve')).result, 'applied', 'only when explicitly disabled');
});
test('feature-design approval persists across heads, is invalidated only by a criteria change, and unlocks ready', async () => {
  const r = rig(); const n = r.world.addIssue();
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'needs-decision' } }); await r.writer().drain();
  const ff = r.intent({ kind: 'revision-update', item: n, actor: 'warden-submit', payload: { criteriaDigest: 'crit1' } }); await submit(r.submitStore, r.inbox, ff, null); await r.writer().drain();
  const bad = r.intent({ kind: 'approval-request', item: n, actor: 'warden-submit', payload: { type: 'feature-design', action: 'feature-scope', binding: { revision: 'crit1', policyDigest: r.policy.digest, evidenceDigest: '' } } });
  await submit(r.submitStore, r.inbox, bad, null); let rep = await r.writer().drain(); assert.equal(rep.processed[0].reason, 'feature-design-not-applicable', 'only feature/enhancement kinds');
  // mark workKind through ledger facet via maintainer-free path is P3; set directly to exercise persistence rules
  const world = r.world; const lc = (await world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!; const l0 = parseLedger(lc.body)!; l0.facets.workKind = 'feature';
  const { encodeLedger } = await import('../src/writer/protocol.ts'); world.comments.get(lc.id)!.c.body = encodeLedger(l0);
  const req = r.intent({ kind: 'approval-request', item: n, actor: 'warden-submit', payload: { type: 'feature-design', action: 'feature-scope', binding: { revision: 'crit1', policyDigest: r.policy.digest, evidenceDigest: '' } } });
  await submit(r.submitStore, r.inbox, req, null); await r.writer().drain(); const id = 'apr_' + req.opid.slice(3, 15);
  const l1 = await led(r, n); assert.equal(l1.approvals[id].expiresAt, null);
  assert.equal((await decide(r, n, id, 'maint1', 'approve', { itemKind: 'issue' })).result, 'applied'); assert.equal((await led(r, n)).state, 'ready');
  r.world.clock = r.world.now() + 90 * 24 * 3600_000; const head = r.intent({ kind: 'revision-update', item: n, actor: 'warden-submit', payload: { revision: 'newbody' } }); await submit(r.submitStore, r.inbox, head, null); await r.writer().drain();
  assert.equal(checkAuthorized(await led(r, n), 'feature-scope', r.policy, r.world.now()).ok, true, 'persists: no daily reapproval, no head dependence');
  const crit = r.intent({ kind: 'revision-update', item: n, actor: 'warden-submit', payload: { criteriaDigest: 'crit2' } }); await submit(r.submitStore, r.inbox, crit, null); await r.writer().drain();
  assert.equal(checkAuthorized(await led(r, n), 'feature-scope', r.policy, r.world.now()).ok, false, 'material scope change invalidates');
  void claim; void REPO; void makeIntent;
});

test('GitHub-native path from the CLI: request -> maintainer comment event -> writer decision, end to end', async () => {
  const e = await cliEnv(); await e.sim('sim', 'issue', '--title', 'Add widget', '--pr', '--as', 'dev1');
  const rq = await e.json('approvals', 'request', '--item', '3', '--item-kind', 'pr', '--action', 'merge', '--revision', 'rev1', '--evidence-digest', 'e1', '--subject-author', 'dev1', '--drain'); assert.equal(rq.code, 0);
  const id = rq.data.approvalId as string; const list = await e.json('approvals', 'list', '--item', '3'); const bind = list.data.approvals[0].bindingDigest;
  const ev = join(e.dir, 'ev.json'); const evSim = async (as: string, body: string) => { await e.sim('sim', 'comment', '--issue', '3', '--as', as, '--body', body, '--event-out', ev, '--repo', 'acme/widgets'); return e.json('event', 'handle', '--event-path', ev, '--drain'); };
  let r = await evSim('mallory', `/warden approve ${id} bind=${bind}`); assert.equal(r.code, 0); assert.equal((await e.json('approvals', 'check', '--item', '3', '--action', 'merge')).code, 1);
  assert.ok(e.worldJson().comments.some((c: any) => /not an authorized maintainer/.test(c.c.body)));
  r = await evSim('maint1', `/warden approve ${id} bind=${bind}`); assert.equal(r.data.drained.processed[0].result, 'applied');
  assert.equal((await e.json('approvals', 'check', '--item', '3', '--action', 'merge')).code, 0);
  assert.equal((await e.json('status')).data.decisionsRecorded, 1, 'decision corpus entry written once');
  r = await evSim('maint1', `/warden approve ${id} bind=${bind}`); assert.equal(r.data.drained.processed[0].reason, 'replayed-decision'); assert.equal((await e.json('status')).data.decisionsRecorded, 1);
  await e.run('approvals', 'revise', '--item', '3', '--item-kind', 'pr', '--revision', 'rev2', '--head', 'c'.repeat(40), '--drain');
  assert.equal((await e.json('approvals', 'check', '--item', '3', '--action', 'merge')).code, 1, 'stale after revision change');
  assert.match((await e.run('approvals', 'list', '--item', '3')).out, /invalidated/);
  e.clock.now += 0; await e.sim('sim', 'advance', '--ms', String(25 * 3600_000));
  const rq2 = await e.json('approvals', 'request', '--item', '3', '--item-kind', 'pr', '--action', 'extra-fix-round', '--revision', 'rev2', '--evidence-digest', 'e1', '--drain'); void rq2; assert.equal(JSON.parse(readFileSync(e.world, 'utf8')).clock > 0, true);
  // unrelated comment and non-command are ignored without effect
  const n = await evSim('maint1', 'looks fine to me'); assert.equal(n.data.ignored, 'no-command');
});
