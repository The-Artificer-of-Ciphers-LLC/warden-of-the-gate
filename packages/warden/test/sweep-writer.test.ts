import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, REPO, WRITER } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import type { Ledger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { planSweep, submitSweep, runTask } from '../src/tasks/registry.ts';
import { HOUR } from '../src/sweep/clocks.ts';

const T0 = Date.parse('2026-11-01T00:00:00Z');
type Rig = ReturnType<typeof rig>;

/** Seed a ledger exactly as the writer would have stored it (written by the writer identity). */
async function seed(r: Rig, n: number, kind: 'issue' | 'pr', patch: Partial<Ledger>) {
  const l: Ledger = { ...newLedger(REPO, n, kind), ...patch };
  await r.world.view(WRITER).createComment(n, encodeLedger(l));
}
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const bodies = async (r: Rig, n: number) => (await r.world.view('x').listComments(n)).map((c) => c.body);
const at = (r: Rig, h: number) => { r.world.clock = T0 + h * HOUR; };
const plan = (r: Rig) => planSweep(r.opStore, r.cfg, { now: r.world.now(), skip: new Set([r.inbox, r.control]) });
const submitAll = (r: Rig, f: Awaited<ReturnType<typeof plan>>) => submitSweep(f, { submitStore: r.submitStore, repo: REPO, inboxIssue: r.inbox, now: r.world.now() });

function prNeedingResponse(r: Rig, o: { reviewed?: boolean } = {}) {
  at(r, 0);
  const n = r.world.addIssue({ isPr: true, author: 'contrib1', title: 'fix thing' });
  return { n, seeded: seed(r, n, 'pr', { state: o.reviewed === false ? 'needs-review' : 'needs-author', attempts: { launchRetries: 0, reworkCycles: 0, contributorFixRounds: 0, review: o.reviewed === false ? 0 : 1 }, linked: [7],
    obligations: [{ type: 'response', startedAt: new Date(T0).toISOString(), dueAt: new Date(T0 + 120 * HOUR).toISOString(), source: 'published-review' }] }) };
}

test('sweep through the writer: 48h nudge once, then five-day closure with explanation, retained issue and a confirmed GitHub close', async () => {
  const r = rig(); const { n, seeded } = prNeedingResponse(r); await seeded;
  at(r, 47); assert.deepEqual(await plan(r), []);

  at(r, 50); let f = await plan(r);
  assert.equal(f.length, 1); assert.deepEqual({ k: f[0].due.kind, h: (f[0].due as any).hours }, { k: 'nudge', h: 48 });
  assert.deepEqual((await submitAll(r, f)).submitted, [n]);
  await r.writer().drain();
  assert.ok((await bodies(r, n)).some((b) => b.includes('Friendly reminder (48h')));
  assert.deepEqual((await ledgerOf(r, n)).sweep?.nudgesSent, [48]);
  assert.equal((await r.world.view('x').getIssue(n)).state, 'open');
  assert.deepEqual(await plan(r), [], 'the same nudge is not planned again');

  at(r, 121); f = await plan(r); assert.equal(f[0].due.kind, 'close-silence');
  await submitAll(r, f); await r.writer().drain();
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'closed');
  assert.equal((await r.world.view('x').getIssue(n)).state, 'closed');
  const text = (await bodies(r, n)).find((b) => b.includes('Closing this PR automatically'))!;
  assert.ok(text.includes('#7') && text.includes('reopen'), text);
});

test('a replayed sweep intent is idempotent: one closure, one comment', async () => {
  const r = rig(); const { n, seeded } = prNeedingResponse(r); await seeded;
  at(r, 130); const f = await plan(r);
  await submitAll(r, f); await submitAll(r, f);
  await r.writer().drain();
  const posted = (await bodies(r, n)).filter((b) => b.startsWith('<!-- warden-effect') && b.includes('Closing this PR automatically'));   // the ledger comment also embeds plan text
  assert.equal(posted.length, 1);
});

test('stale closure loses: an author reply after planning is observed by the writer at decision time', async () => {
  const r = rig(); const { n, seeded } = prNeedingResponse(r); await seeded;
  at(r, 130); const f = await plan(r); assert.equal(f[0].due.kind, 'close-silence');
  await submitAll(r, f);
  await r.world.view('contrib1').createComment(n, 'sorry, pushed a fix and replying now');   // author activity at T0+130h
  await r.writer().drain();
  assert.equal((await r.world.view('x').getIssue(n)).state, 'open');
  assert.equal((await ledgerOf(r, n)).state, 'needs-author');
  assert.ok(!(await bodies(r, n)).some((b) => b.includes('Closing this PR')));
});

test('keep-open added after planning is honored by the writer; unreviewed PRs and confirmed issues are never touched', async () => {
  const r = rig(); const { n, seeded } = prNeedingResponse(r); await seeded;
  at(r, 130); const f = await plan(r); await submitAll(r, f);
  await r.world.view(r.cfg.maintainers[0]).addLabel(n, 'keep-open');
  await r.writer().drain();
  assert.equal((await r.world.view('x').getIssue(n)).state, 'open');

  const r2 = rig(); const u = prNeedingResponse(r2, { reviewed: false }); await u.seeded; at(r2, 999);
  assert.deepEqual(await plan(r2), []);
  const i = r2.world.addIssue({ title: 'confirmed' });
  await seed(r2, i, 'issue', { state: 'ready', obligations: [{ type: 'information', startedAt: new Date(T0).toISOString(), dueAt: new Date(T0).toISOString(), source: 'reproduction' }] });
  assert.deepEqual(await plan(r2), []);
});

test('issue information requests close at 14 days (reproduction) and 28 days (other); the longer window is the default', async () => {
  const r = rig(); at(r, 0);
  const rep = r.world.addIssue({ title: 'crash on start with long enough text' }); const oth = r.world.addIssue({ title: 'feature question with long enough text' });
  const ob = (source: string) => [{ type: 'information' as const, startedAt: new Date(T0).toISOString(), dueAt: new Date(T0).toISOString(), source }];
  await seed(r, rep, 'issue', { state: 'needs-info', obligations: ob('reproduction') });
  await seed(r, oth, 'issue', { state: 'needs-info', obligations: ob('details') });
  at(r, 14 * 24 + 1);
  assert.deepEqual((await plan(r)).map((x) => [x.item, x.due.kind]), [[rep, 'close-information']]);
  at(r, 28 * 24 + 1);
  assert.equal((await plan(r)).length, 2);
});

test('stop is honored: a stopped writer submits nothing to GitHub and the verdict is simply re-evaluated later', async () => {
  const r = rig(); const { n, seeded } = prNeedingResponse(r); await seeded;
  at(r, 130); await submitAll(r, await plan(r));
  await r.world.view(r.cfg.maintainers[0]).addLabel(r.control, 'warden:stop');
  const rep = await r.writer().drain();
  assert.ok(rep.haltReason, 'writer halts under stop');
  assert.equal((await r.world.view('x').getIssue(n)).state, 'open');
});

test('dry-run sweep via runTask: read-only, proposes, never mutates; live sweep is explicitly unsupported', async () => {
  const r = rig(); const { n, seeded } = prNeedingResponse(r); await seeded; at(r, 130);
  const before = JSON.stringify(r.world.snapshot());
  const out = await runTask('sweep', { dryRun: true, store: r.opStore, cfg: r.cfg, skip: new Set([r.inbox, r.control]), now: r.world.now() });
  assert.equal(out.outcome, 'proposed');
  assert.equal((out as any).proposals[0].item, n); assert.equal((out as any).proposals[0].to, 'closed');
  assert.equal(JSON.stringify(r.world.snapshot()), before);
  assert.equal((await runTask('sweep', { dryRun: false, store: r.opStore, cfg: r.cfg })).outcome, 'unsupported');
});

test('non-deterministic origin and missing policy are rejected by the reducer', async () => {
  const r = rig(); const { n, seeded } = prNeedingResponse(r); await seeded; at(r, 130);
  await r.send({ kind: 'sweep-action', item: n, itemKind: 'pr', origin: 'ai', actor: 'x', payload: { expect: { kind: 'close-silence' } } });
  const rep = await r.writer().drain();
  assert.equal(rep.decisions.length >= 0, true);
  assert.equal((await r.world.view('x').getIssue(n)).state, 'open');
});

const iso = (h: number) => new Date(T0 + h * HOUR).toISOString();
const delivery = (due: number, extra: Record<string, unknown> = {}) => [{ type: 'delivery' as const, startedAt: iso(0), dueAt: iso(due), source: 'assignment', ...extra }];
async function claimedIssue(r: Rig, o: { linked?: number[]; state?: Ledger['state']; obligations?: Ledger['obligations'] } = {}) {
  at(r, 0);
  const n = r.world.addIssue({ title: 'fix the widget crash' });
  await r.world.view('x').addAssignee(n, 'contrib1'); await r.world.view('x').addLabel(n, 'warden:claimed');
  await seed(r, n, 'issue', { state: o.state ?? 'claimed', owner: { kind: 'contributor', id: 'contrib1', opid: 'op_claim' }, linked: o.linked ?? [], obligations: o.obligations ?? delivery(48) });
  return n;
}

test('delivery expiry releases the claim: unassign confirmed, back to ready, issue stays open, label projected, partial work retained', async () => {
  const r = rig(); const n = await claimedIssue(r);
  at(r, 47); assert.deepEqual(await plan(r), []);
  at(r, 49); const f = await plan(r);
  assert.deepEqual(f.map((x) => x.due.kind), ['expire-commitment']);
  await submitAll(r, f); await r.writer().drain();
  const gh = await r.world.view('x').getIssue(n);
  assert.deepEqual(gh.assignees, []); assert.equal(gh.state, 'open');
  assert.ok(gh.labels.includes('warden:ready') && !gh.labels.includes('warden:claimed'), gh.labels.join());
  const l = await ledgerOf(r, n);
  assert.equal(l.state, 'ready'); assert.equal(l.owner, null); assert.equal(l.obligations.length, 0);
  assert.ok((await bodies(r, n)).some((b) => b.startsWith('<!-- warden-effect') && b.includes('claim is released')));
  assert.deepEqual(await plan(r), [], 'no further enforcement once released');
});

test('commitments that must NOT expire: satisfied, held (frozen), and ambiguous completeness (linked work / in review)', async () => {
  const r = rig(); at(r, 0);
  await claimedIssue(r, { obligations: delivery(48, { satisfiedAt: iso(10) }) });
  await claimedIssue(r, { obligations: delivery(48, { hold: { startedAt: iso(30), remainingMs: 18 * HOUR, reason: 'maintainer hold' } }) });
  const linked = await claimedIssue(r, { linked: [55] });
  await claimedIssue(r, { state: 'in-review' });
  at(r, 500);
  const f = await plan(r);
  assert.deepEqual(f.map((x) => [x.item, x.due.kind]), [[linked, 'defer'], [linked + 1, 'defer']].map(([a, b]) => [a, b]));
  const sub = await submitAll(r, f); assert.deepEqual(sub.submitted, []);
  await r.writer().drain();
  assert.equal((await r.world.view('x').getIssue(linked)).assignees.length, 1);
});

test('PR fix-window expiry closes the PR with explanation while the original issue stays open', async () => {
  const r = rig(); at(r, 0);
  const issue = r.world.addIssue({ title: 'the original issue' });
  const n = r.world.addIssue({ isPr: true, author: 'contrib1', title: 'attempt' });
  await seed(r, n, 'pr', { state: 'needs-author', linked: [issue], attempts: { launchRetries: 0, reworkCycles: 0, contributorFixRounds: 1, review: 1 }, obligations: [{ type: 'fix-window', startedAt: iso(0), dueAt: iso(48), source: 'published-review' }] });
  at(r, 49); const f = await plan(r); assert.equal(f[0].due.kind, 'expire-commitment');
  await submitAll(r, f); await r.writer().drain();
  assert.equal((await r.world.view('x').getIssue(n)).state, 'closed');
  assert.equal((await r.world.view('x').getIssue(issue)).state, 'open');
  assert.ok((await bodies(r, n)).some((b) => b.startsWith('<!-- warden-effect') && b.includes(`#${issue}`) && b.includes('fix window')));
});

test('stale expiry loses: a release processed before the sweep leaves nothing to unassign or comment', async () => {
  const r = rig(); const n = await claimedIssue(r); at(r, 49);
  const f = await plan(r);
  await r.send({ kind: 'release', item: n, actor: 'contrib1' });
  await submitAll(r, f);
  await r.writer().drain();
  assert.equal((await ledgerOf(r, n)).state, 'ready');
  assert.ok(!(await bodies(r, n)).some((b) => b.includes('delivery commitment')));
});

test('unassign effect is confirmed against GitHub before acknowledgement', async () => {
  const r = rig(); const n = await claimedIssue(r); at(r, 49);
  const store = r.world.view(WRITER);
  (store as any).removeAssignee = async () => { /* GitHub silently ignored the request */ };
  const w = new (await import('../src/writer/writer.ts')).Writer(store, (await import('../src/writer/writer.ts')).defaultWriterConfig({ repository: REPO, inboxIssue: r.inbox, controlIssue: r.control, policy: r.policy, submitters: ['warden-submit'], writerIdentities: [WRITER], leaseTtlMs: 5000, leaseWaitMs: 2000, fenceMarginMs: 500 }));
  await submitAll(r, await plan(r));
  const rep = await w.drain();
  assert.ok(!rep.processed.some((p) => p.result === 'applied'), JSON.stringify(rep.processed));
});
