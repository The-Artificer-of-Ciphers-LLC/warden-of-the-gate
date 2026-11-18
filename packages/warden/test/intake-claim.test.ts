import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, REPO, WRITER, claim } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import type { Ledger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { planSweep, submitSweep, submitIntake, runTask } from '../src/tasks/registry.ts';
import { HOUR } from '../src/sweep/clocks.ts';

const T0 = Date.parse('2026-11-01T00:00:00Z');
type Rig = ReturnType<typeof rig>;
const at = (r: Rig, h: number) => { r.world.clock = T0 + h * HOUR; };
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const effects = async (r: Rig, n: number) => (await r.world.view('x').listComments(n)).map((c) => c.body).filter((b) => b.startsWith('<!-- warden-effect'));
const seed = (r: Rig, n: number, kind: 'issue' | 'pr', patch: Partial<Ledger>) => r.world.view(WRITER).createComment(n, encodeLedger({ ...newLedger(REPO, n, kind), ...patch }));
const intake = (r: Rig, items: number[]) => submitIntake(r.opStore, r.cfg, { submitStore: r.submitStore, inboxIssue: r.inbox, now: r.world.now(), items });
const w = (r: Rig) => r.writer({ assignable: () => true });

test('intake: a complete new issue is labelled for triage, with no noise comment and no obligation', async () => {
  const r = rig(); at(r, 0); const n = r.world.addIssue({ title: 'Crash when saving', body: 'Steps: open, save, crash.' });
  assert.deepEqual((await intake(r, [n])).submitted, [n]); await w(r).drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'needs-triage'); assert.deepEqual(l.obligations, []);
  assert.ok((await r.world.view('x').getIssue(n)).labels.includes('warden:needs-triage'));
  assert.deepEqual(await effects(r, n), []);
});

test('intake: missing information asks the reporter, records a 28-day information obligation, and the sweep later closes it with a return path', async () => {
  const r = rig(); at(r, 0); const n = r.world.addIssue({ title: 'broken', body: '' });
  await intake(r, [n]); await w(r).drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'needs-info');
  assert.equal(l.obligations[0].type, 'information'); assert.equal(Date.parse(l.obligations[0].dueAt) - Date.parse(l.obligations[0].startedAt), 28 * 24 * HOUR);
  assert.ok((await effects(r, n))[0].includes('within 28 days'));

  at(r, 28 * 24 + 1);
  const f = await planSweep(r.opStore, r.cfg, { now: r.world.now(), skip: new Set([r.inbox, r.control]) });
  assert.equal(f[0].due.kind, 'close-information');
  await submitSweep(f, { submitStore: r.submitStore, repo: REPO, inboxIssue: r.inbox, now: r.world.now() }); await w(r).drain();
  assert.equal((await r.world.view('x').getIssue(n)).state, 'closed');
  assert.ok((await effects(r, n)).some((b) => b.includes('can reopen it')));
});

test('intake: a PR enters review; a new draft PR is closed with an explanation and return path (drafts are disallowed by default)', async () => {
  const r = rig(); at(r, 0);
  const ok = r.world.addIssue({ isPr: true, title: 'ready pr', body: 'x' });
  const p = r.world.addIssue({ isPr: true, draft: true, title: 'wip', body: 'x' });
  await intake(r, [ok, p]); await w(r).drain();
  assert.equal((await ledgerOf(r, ok)).state, 'needs-review'); assert.equal((await r.world.view('x').getIssue(ok)).state, 'open');
  assert.equal((await r.world.view('x').getIssue(p)).state, 'closed');
  assert.ok((await effects(r, p))[0].includes('draft pull requests are not accepted') && (await effects(r, p))[0].includes('Mark it ready for review'));
});

test('draft policy: drafts allowed => queued and never closed', async () => {
  const r = rig({ drafts: { allowed: true } }); at(r, 0); const p = r.world.addIssue({ isPr: true, draft: true, title: 'wip', body: 'x' });
  await intake(r, [p]); await w(r).drain();
  assert.equal((await r.world.view('x').getIssue(p)).state, 'open');
});

test('draft policy: a PR converted to draft later is closed by the next sweep unless adoption kept it', async () => {
  const r = rig(); at(r, 0);
  const a = r.world.addIssue({ isPr: true, title: 'was ready', body: 'x' }); await seed(r, a, 'pr', { state: 'needs-review' });
  const b = r.world.addIssue({ isPr: true, title: 'kept draft', body: 'x' }); await seed(r, b, 'pr', { state: 'needs-review', draftDecision: 'keep' });
  r.world.issues.get(a)!.draft = true; r.world.issues.get(b)!.draft = true;               // both converted to draft
  const f = await planSweep(r.opStore, r.cfg, { now: r.world.now(), skip: new Set([r.inbox, r.control]) });
  assert.deepEqual(f.map((x) => [x.item, x.due.kind]), [[a, 'close-draft']]);
  await submitSweep(f, { submitStore: r.submitStore, repo: REPO, inboxIssue: r.inbox, now: r.world.now() }); await w(r).drain();
  assert.equal((await r.world.view('x').getIssue(a)).state, 'closed'); assert.equal((await r.world.view('x').getIssue(b)).state, 'open');
});

test('intake never scans the backlog: it needs explicit items, skips ones that already have a ledger, and rejects an already-adopted item', async () => {
  const r = rig(); at(r, 0);
  await assert.rejects(() => intake(r, []), /explicit item numbers/);
  const had = r.world.addIssue({ title: 'existing item', body: 'b' }); await seed(r, had, 'issue', { state: 'ready' });
  assert.deepEqual((await intake(r, [had])).skipped, [{ item: had, why: 'already-has-ledger' }]);
  const first = r.world.addIssue({ title: 'a fine title', body: 'b' }); await intake(r, [first]); await w(r).drain();
  await r.send({ kind: 'intake', item: first, origin: 'deterministic', actor: 'warden-submit', payload: { expect: 'needs-triage' }, source: { kind: 'intake', id: 'again', observedAt: new Date(T0).toISOString() } });
  const rep = await w(r).drain();
  assert.ok(rep.processed.some((p) => p.result === 'rejected' && p.reason === 'already-adopted'), JSON.stringify(rep.processed));
});

test('intake: a stale plan loses when the item changed before the writer decided', async () => {
  const r = rig(); at(r, 0); const n = r.world.addIssue({ title: 'broken', body: '' });
  await intake(r, [n]);
  r.world.issues.get(n)!.body = 'Now has a full description.';   // reporter edited after planning
  await w(r).drain();
  assert.equal((await ledgerOf(r, n)).state, 'needs-triage');
  assert.deepEqual(await effects(r, n), []);
  assert.ok(!(await r.world.view('x').getIssue(n)).labels.includes('warden:needs-info'));
});

test('claim: contributor volunteering assigns, confirms, and starts a 48h delivery obligation at the decision time; sweep later releases it', async () => {
  const r = rig(); at(r, 0); const n = r.world.addIssue({ title: 'a fine title', body: 'b' }); await seed(r, n, 'issue', { state: 'ready' });
  at(r, 5); await r.send({ ...claim('contrib1'), item: n }); await w(r).drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'claimed'); assert.equal(l.owner?.id, 'contrib1');
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, ['contrib1']);
  const ob = l.obligations.find((o) => o.type === 'delivery')!;
  assert.equal(ob.startedAt, new Date(T0 + 5 * HOUR).toISOString()); assert.equal(Date.parse(ob.dueAt), T0 + 53 * HOUR);

  at(r, 52); assert.deepEqual(await planSweep(r.opStore, r.cfg, { now: r.world.now(), skip: new Set([r.inbox, r.control]) }), []);
  at(r, 54);
  const f = await planSweep(r.opStore, r.cfg, { now: r.world.now(), skip: new Set([r.inbox, r.control]) });
  assert.equal(f[0].due.kind, 'expire-commitment');
  await submitSweep(f, { submitStore: r.submitStore, repo: REPO, inboxIssue: r.inbox, now: r.world.now() }); await w(r).drain();
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, []);
  assert.equal((await ledgerOf(r, n)).state, 'ready');
});

test('claim: competing claims leave exactly one confirmed owner and one obligation; a factory claim carries no contributor commitment', async () => {
  const r = rig(); at(r, 0); const n = r.world.addIssue({ title: 'a fine title', body: 'b' }); await seed(r, n, 'issue', { state: 'ready' });
  await r.send({ ...claim('contrib1'), item: n }); await r.send({ ...claim('contrib2'), item: n }); await w(r).drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.owner?.id, 'contrib1'); assert.equal(l.obligations.filter((o) => o.type === 'delivery').length, 1);
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, ['contrib1']);

  const f = r.world.addIssue({ title: 'another fine title', body: 'b' }); await seed(r, f, 'issue', { state: 'ready' });
  await r.send({ ...claim('warden-factory', 'factory'), item: f }); await w(r).drain();
  assert.equal((await ledgerOf(r, f)).owner?.kind, 'factory'); assert.deepEqual((await ledgerOf(r, f)).obligations, []);
});

test('claim: a fresh GitHub ownership check rejects an item someone else is already assigned to', async () => {
  const r = rig(); at(r, 0); const n = r.world.addIssue({ title: 'a fine title', body: 'b' }); await seed(r, n, 'issue', { state: 'ready' });
  await r.world.view('maint1').addAssignee(n, 'someone-else');           // assigned on GitHub outside Warden
  await r.send({ ...claim('contrib1'), item: n }); await w(r).drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'ready'); assert.equal(l.owner, null);
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, ['someone-else']);
});

test('claim: releasing drops the delivery obligation; live intake via the CLI task stays unsupported', async () => {
  const r = rig(); at(r, 0); const n = r.world.addIssue({ title: 'a fine title', body: 'b' }); await seed(r, n, 'issue', { state: 'ready' });
  await r.send({ ...claim('contrib1'), item: n }); await w(r).drain();
  await r.send({ kind: 'release', item: n, actor: 'contrib1' }); await w(r).drain();
  assert.deepEqual((await ledgerOf(r, n)).obligations, []);
  assert.equal((await runTask('intake', { dryRun: false, store: r.opStore, cfg: r.cfg })).outcome, 'unsupported');
});
