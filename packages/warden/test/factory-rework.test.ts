import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, REPO, WRITER } from './helpers.ts';
import type { Rig } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import type { Ledger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { renderPrBody, validatePrBody } from '../src/factory/pr-body.ts';
import type { PrBody } from '../src/factory/pr-body.ts';
import { assertFactoryBranch, creditTrailers, isExecutionSurface } from '../src/factory/takeover.ts';

const seedPr = async (r: Rig, patch: Partial<Ledger> = {}) => { const n = r.world.addIssue({ isPr: true, title: 'factory pr', author: 'warden-factory' }); await r.world.view(WRITER).createComment(n, encodeLedger({ ...newLedger(REPO, n, 'pr'), state: 'needs-rework', ...patch })); return n; };
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const attempt = (r: Rig, n: number, payload: Record<string, unknown>, id: string) => r.send({ kind: 'rework-attempt', item: n, itemKind: 'pr', origin: 'deterministic', actor: 'warden-runner', payload, source: { kind: 'run', id, observedAt: new Date(r.world.now()).toISOString() } });
const w = (r: Rig) => r.writer({ assignable: () => true });

test('rework accounting: three completed cycles (progress or not) are persisted; success returns to Review; unresolved after the last cycle escalates', async () => {
  const r = rig(); const n = await seedPr(r);
  await attempt(r, n, { outcome: 'completed', openFindings: 2 }, 'a1'); await w(r).drain();
  let l = await ledgerOf(r, n); assert.equal(l.state, 'needs-review'); assert.equal(l.attempts.reworkCycles, 1);
  for (const k of [2, 3]) { l.state = 'needs-rework'; r.world.issues.get(n); await r.world.view(WRITER).updateComment((await r.world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!.id, encodeLedger(l)); await attempt(r, n, { outcome: 'completed', openFindings: 2 }, 'a' + k); r.world.clock = (r.world.clock ?? Date.now()) + 1000; await w(r).drain(); l = await ledgerOf(r, n); }
  assert.equal(l.attempts.reworkCycles, 3); assert.equal(l.state, 'needs-decision', 'unresolved after cycle three escalates, never retried automatically');
  const ok = rig(); const m = await seedPr(ok, { attempts: { launchRetries: 0, reworkCycles: 2, contributorFixRounds: 0, review: 0 } });
  await attempt(ok, m, { outcome: 'completed', openFindings: 0 }, 'z'); await w(ok).drain();
  const s = await ledgerOf(ok, m); assert.equal(s.state, 'needs-review', 'success on cycle three may proceed (Review then gates the merge)'); assert.equal(s.attempts.reworkCycles, 3);
});

test('launch failures use a separate persistent budget, never consume rework cycles, and exhaustion blocks for a maintainer', async () => {
  const r = rig(); const n = await seedPr(r);
  const max = r.policy.maxAttempts;
  for (let k = 0; k < max; k++) { await attempt(r, n, { outcome: 'launch-failed' }, 'f' + k); await w(r).drain(); }
  const l = await ledgerOf(r, n); assert.equal(l.attempts.launchRetries, max); assert.equal(l.attempts.reworkCycles, 0); assert.equal(l.state, 'blocked'); assert.equal(l.blocker?.resumeTo, 'needs-rework');
});

test('a replacement PR inherits the replaced PR accounting (read by the writer, not trusted from the intent); a fresh PR never resets cycles', async () => {
  const r = rig(); const old = await seedPr(r, { attempts: { launchRetries: 2, reworkCycles: 2, contributorFixRounds: 0, review: 0 } });
  const fresh = await seedPr(r, { state: 'needs-review' });
  await r.send({ kind: 'carry-accounting', item: fresh, itemKind: 'pr', origin: 'deterministic', actor: 'warden-runner', payload: { replaces: old, reworkCycles: 0 }, source: { kind: 'run', id: 'c1', observedAt: new Date(r.world.now()).toISOString() } });
  await w(r).drain(); const l = await ledgerOf(r, fresh); assert.deepEqual([l.attempts.reworkCycles, l.attempts.launchRetries], [2, 2]); assert.ok(l.linked.includes(old));
});

test('critical escape pauses the item, preserves evidence, alerts maintainers; only notes and a verified maintainer resume are accepted while paused', async () => {
  const r = rig(); const n = await seedPr(r, { state: 'needs-review' });
  await r.send({ kind: 'critical-escape', item: n, itemKind: 'pr', origin: 'deterministic', actor: 'warden-detector', payload: { summary: 'merged a head that was never reviewed', evidence: ['merge op op_x at head h1', 'review marker head h0'] } });
  await w(r).drain(); let l = await ledgerOf(r, n); assert.equal(l.paused?.evidence.length, 2);
  assert.ok((await r.world.view('x').listComments(n)).some((c) => c.body.includes('CRITICAL') && c.body.includes('@maint1')));
  await r.send({ kind: 'claim', item: n, itemKind: 'pr', actor: 'contrib1', payload: { claimant: { kind: 'contributor', id: 'contrib1' } } });
  const rep = await w(r).drain(); assert.ok(rep.processed.some((p) => p.reason === 'scope-paused'));
  const cid = await r.comment('maint1', n, '/warden resume-scope reviewed the evidence and the remediation');
  await r.send({ kind: 'resume-scope', item: n, itemKind: 'pr', origin: 'maintainer', actor: 'maint1', payload: { reason: 'reviewed the evidence and the remediation' }, source: { kind: 'gh-comment', id: String(cid), observedAt: new Date(r.world.now()).toISOString() } });
  await w(r).drain(); l = await ledgerOf(r, n); assert.equal(l.paused, undefined);
  const forged = await seedPr(r, { paused: { reason: 'x', at: 'now', evidence: ['e'] } });
  await r.send({ kind: 'resume-scope', item: forged, itemKind: 'pr', origin: 'maintainer', actor: 'maint1', payload: { reason: 'forged source' }, source: { kind: 'gh-comment', id: '424242', observedAt: new Date(r.world.now()).toISOString() } });
  await w(r).drain(); assert.ok((await ledgerOf(r, forged)).paused, 'a forged source cannot resume a paused scope');
});

test('PR body: scope, approach, evidence, attribution and Merge Danger are mandatory; it claims no review or merge; takeover credits ported work and writes only to factory branches', () => {
  const body: PrBody = { scope: 'Fix token refresh race', approach: 'Serialize refresh per token', evidence: ['failing test now passes: test/refresh.test.ts'], attribution: { aiAssisted: true, model: 'local-default', harness: 'opencode 2.2.7', credited: ['contrib1'] }, danger: { door: 'two-way', blastRadius: 'auth refresh path only', why: 'No data or interface change; revertable.' }, closes: [12] };
  const text = renderPrBody(body); assert.match(text, /Merge Danger:\*\* two-way door/); assert.match(text, /Builds on work by @contrib1/); assert.match(text, /nothing here claims a review or a merge/); assert.match(text, /resolved only after the merged scope is confirmed/);
  for (const bad of [{ ...body, scope: ' ' }, { ...body, evidence: [] }, { ...body, attribution: { ...body.attribution, model: '' } }, { ...body, danger: { ...body.danger, why: '' } }]) assert.ok(validatePrBody(bad as PrBody));
  assert.throws(() => renderPrBody({ ...body, evidence: [] }), /evidence is required/);
  assert.throws(() => assertFactoryBranch('feature/contrib', 'feature/contrib'), /warden\/\*/); assert.throws(() => assertFactoryBranch('warden/x', 'warden/x'), /never writes to the contributor branch/); assert.doesNotThrow(() => assertFactoryBranch('warden/fix-12', 'feature/contrib'));
  const commits = [{ sha: '1', authorLogin: 'contrib1', authorName: 'Contrib One', authorEmail: 'c1@x.io', subject: 'a', ported: true }, { sha: '2', authorLogin: 'contrib1', authorName: 'Contrib One', authorEmail: 'C1@x.io', subject: 'b', ported: true }, { sha: '3', authorLogin: 'dependabot[bot]', authorName: 'bot', authorEmail: 'b@x.io', subject: 'c', ported: true }, { sha: '4', authorLogin: 'contrib2', authorName: 'Two', authorEmail: 'c2@x.io', subject: 'd', ported: false }];
  assert.deepEqual(creditTrailers(commits), ['Co-authored-by: Contrib One <c1@x.io>']);
  assert.ok(isExecutionSurface('.husky/pre-commit') && isExecutionSurface('package.json') && isExecutionSurface('scripts/x.sh') && !isExecutionSurface('src/a.ts'));
});
