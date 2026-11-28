import { test } from 'node:test';
import assert from 'node:assert/strict';
import { likelyClasses, recommend, renderDesignCard } from '../src/factory/design-card.ts';
import { parseMaintainerCommand } from '../src/approvals/approvals.ts';
import { newLedger } from '../src/state/model.ts';
import type { IssueState } from '../src/github/store.ts';
import { cliEnv } from './cli-env.ts';
import { rig, OPERATOR } from './helpers.ts';
import { parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';

/** ADR 0015 (owner ruling 2026-11-25, MVP fidelity 2026-11-28): a proposed design for work that will cross a boundary class, as a deterministic decision matrix answered with one pick. */
const issue = (title: string, body: string): IssueState => ({ number: 3, title, body, state: 'open', labels: [], assignees: [], author: 'r', isPr: false } as unknown as IssueState);
test('what the issue points at: named files are strong evidence, class keywords weak; ordinary issues point at nothing', () => {
  assert.deepEqual(likelyClasses(issue('Fix off-by-one', 'sumTo(4) should be 6 but returns 10.')), []);
  const l = likelyClasses(issue('Add a table', 'Put the migration in migrations/002_add.sql and change the login flow.')); assert.deepEqual(l.map((x) => [x.class, x.strong.length > 0, x.weak.length > 0]), [['database-schema', true, true], ['auth-secrets', false, true]]);
  assert.deepEqual(likelyClasses(issue('x', 'we should publish a release to production')).map((x) => x.class), ['external-effect']);
  assert.deepEqual(likelyClasses(issue('x', 'edit .github/workflows/ci.yml')).map((x) => x.class), ['verification-ci']);
  assert.deepEqual(recommend(l[0]), 'proceed'); assert.equal(recommend(l[1]), 'narrow'); assert.equal(recommend({ class: 'external-effect', strong: ['Dockerfile'], weak: [] }), 'narrow', 'an external effect is never recommended to proceed unseen');
});
test('the card is one decision matrix per class with the exact one-pick commands; answered classes show the answer; nothing to ask says so', () => {
  const t = renderDesignCard({ repo: 'acme/widgets', issue: issue('Add a table', 'migration in migrations/002_add.sql') });
  assert.match(t, /## Question 1: database-schema/); assert.match(t, /Named in the issue: migrations\/002_add\.sql/); assert.match(t, /\| proceed \(recommended\) \|/); assert.match(t, /\| narrow \|/); assert.match(t, /\| decline \|/); assert.match(t, /\/warden design database-schema proceed/); assert.match(t, /grants nothing/);
  const l = newLedger('acme/widgets', 3, 'issue'); l.designDecisions = { 'database-schema': { pick: 'narrow', by: 'maint1', at: 'now' } }; assert.match(renderDesignCard({ repo: 'acme/widgets', issue: issue('Add a table', 'migration in migrations/002_add.sql'), ledger: l }), /Answered: \*\*narrow\*\* by maint1/);
  assert.match(renderDesignCard({ repo: 'acme/widgets', issue: issue('Fix', 'plain') }), /no design decision is asked/);
});
test('/warden design takes one class and one pick; the writer records it once, from a verified maintainer, for a configured class', async () => {
  assert.deepEqual(parseMaintainerCommand('/warden design database-schema narrow'), { kind: 'design-decision', payload: { class: 'database-schema', pick: 'narrow' } }); for (const bad of ['/warden design database-schema', '/warden design database-schema maybe', '/warden design narrow']) assert.equal(parseMaintainerCommand(bad), null, bad);
  const r = rig({ mode: 'live' }); const n = r.world.addIssue({ title: 'bug', author: 'reporter' });
  const send = async (as: string, cls: string, pick: string) => { const cid = await r.comment(as, n, `/warden design ${cls} ${pick}`); await r.send({ kind: 'design-decision', item: n, itemKind: 'issue', origin: 'maintainer', actor: as, payload: { class: cls, pick }, source: { kind: 'gh-comment', id: String(cid), observedAt: new Date(r.world.now()).toISOString() } }); await r.writer().drain(); };
  const led = async () => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0]?.body ?? '');
  await send('rando', 'database-schema', 'proceed'); assert.equal((await led())?.designDecisions, undefined); await send(OPERATOR, 'made-up-class', 'proceed'); assert.equal((await led())?.designDecisions, undefined);
  await send(OPERATOR, 'database-schema', 'narrow'); assert.equal((await led())?.designDecisions?.['database-schema']?.pick, 'narrow'); await send(OPERATOR, 'database-schema', 'proceed'); assert.equal((await led())?.designDecisions?.['database-schema']?.pick, 'narrow', 'recorded once');
});
test('design-card is read-only and refuses a pull request or a missing item', async () => {
  const e = await cliEnv(); assert.equal((await e.run('design-card')).code, 2);
  const n = Number((await e.sim('sim', 'issue', '--title', 'Add a table', '--body', 'migration in migrations/002.sql')).out.match(/created #(\d+)/)![1]); const r = await e.run('design-card', '--item', String(n)); assert.equal(r.code, 0, r.out + r.err); assert.match(r.out, /Question 1: database-schema/);
  const pr = Number((await e.sim('sim', 'issue', '--title', 'a pr', '--pr')).out.match(/created #(\d+)/)![1]); assert.equal((await e.run('design-card', '--item', String(pr))).code, 4);
});
