import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, REPO, WRITER } from './helpers.ts';
import type { Rig } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { planClaims, submitClaims } from '../src/tasks/claims.ts';
import { parseMaintainerCommand } from '../src/approvals/approvals.ts';

const ready = async (r: Rig) => { const n = r.world.addIssue({ title: 'a fine title', body: 'body' }); const l = newLedger(REPO, n, 'issue'); l.state = 'ready'; await r.world.view(WRITER).createComment(n, encodeLedger(l)); return n; };
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const w = (r: Rig) => r.writer({ assignable: () => true });
const claimIntent = (r: Rig, n: number, o: { actor: string; claimant?: string; source?: { kind: string; id: string } }) => r.send({ kind: 'claim', item: n, actor: o.actor, payload: { claimant: { kind: 'contributor', id: o.claimant ?? o.actor } }, source: { kind: o.source?.kind ?? 'gh-comment', id: o.source?.id ?? '0', observedAt: new Date(r.world.now()).toISOString() } });

test('the claim command parses only as a whole line; claims by comment are verified against the real comment, its author, its text and its edit state', async () => {
  assert.equal(parseMaintainerCommand('hello\n/warden claim\nthanks')?.kind, 'claim'); assert.equal(parseMaintainerCommand('/warden claim please'), null); assert.equal(parseMaintainerCommand('/warden release')?.kind, 'release');
  const r = rig(); const n = await ready(r);
  const aliceC = await r.comment('alice', n, '/warden claim'); const malloryC = await r.comment('mallory', n, '/warden claim'); const chatter = await r.comment('bob', n, 'I would love to claim this');
  await claimIntent(r, n, { actor: 'mallory', claimant: 'alice', source: { kind: 'gh-comment', id: String(aliceC) } });         // claiming FOR alice, citing alice's comment
  await claimIntent(r, n, { actor: 'bob', source: { kind: 'gh-comment', id: String(chatter) } });                                 // a comment that is not the command
  await claimIntent(r, n, { actor: 'carol', source: { kind: 'gh-comment', id: String(malloryC) } });                              // another author's comment
  await claimIntent(r, n, { actor: 'dave', source: { kind: 'test', id: '1' } });                                                   // not a comment at all
  const edited = await r.comment('erin', n, '/warden claim'); r.world.clock = r.world.now() + 1000; await r.world.view('erin').updateComment(edited, '/warden claim'); await claimIntent(r, n, { actor: 'erin', source: { kind: 'gh-comment', id: String(edited) } });
  const rep = await w(r).drain(); assert.ok(rep.processed.every((p) => p.result !== 'applied'), JSON.stringify(rep.processed)); assert.equal((await ledgerOf(r, n)).owner, null);
  await claimIntent(r, n, { actor: 'alice', source: { kind: 'gh-comment', id: String(aliceC) } }); await w(r).drain();
  const l = await ledgerOf(r, n); assert.equal(l.owner?.id, 'alice'); assert.equal(l.obligations[0]?.type, 'delivery'); assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, ['alice']);
});

test('the claim task submits only the earliest valid volunteer; unrelated commenters cannot claim for an assignee; competing claims leave one confirmed owner', async () => {
  const r = rig(); const n = await ready(r); const assigned = await ready(r); const notReady = r.world.addIssue({ title: 'not ready', body: 'b' });
  await r.comment('alice', n, '/warden claim'); await r.comment('bob', n, '/warden claim'); await r.comment('mallory', assigned, '/warden claim'); await r.world.view('maint1').addAssignee(assigned, 'carol'); await r.comment('zed', notReady, '/warden claim');
  const { found, skipped } = await planClaims(r.opStore, r.cfg, { skip: new Set([r.inbox, r.control]) });
  assert.deepEqual(found.map((f) => [f.item, f.claimant]), [[n, 'alice']]); assert.ok(skipped.some((s) => s.item === assigned && /already assigned/.test(s.why)));
  await submitClaims(found, { submitStore: r.submitStore, repo: REPO, inboxIssue: r.inbox, now: r.world.now() }); await w(r).drain();
  assert.equal((await ledgerOf(r, n)).owner?.id, 'alice'); assert.deepEqual((await r.world.view('x').getIssue(assigned)).assignees, ['carol']);
  const late = await r.comment('bob', n, '/warden claim'); void late;
  assert.deepEqual((await planClaims(r.opStore, r.cfg, { skip: new Set([r.inbox, r.control]) })).found, [], 'once owned, later volunteers are not submitted');
  await claimIntent(r, n, { actor: 'bob', source: { kind: 'gh-comment', id: String(late) } }); const rep = await w(r).drain();
  assert.ok(rep.processed.some((p) => /already-owned-by:alice|assigned-on-github-to:alice/.test(p.reason ?? ''))); assert.equal((await ledgerOf(r, n)).owner?.id, 'alice');
});
