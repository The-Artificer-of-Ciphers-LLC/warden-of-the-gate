import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, OPERATOR } from './helpers.ts';
import { parseMaintainerCommand } from '../src/approvals/approvals.ts';
import { reviewPostIntent, reviewRecordIntent } from '../src/review/record.ts';
import { makeIntent, parseLedger, parseReceipt, LEDGER_MARK } from '../src/writer/protocol.ts';
import type { Marker } from '../src/review/slice.ts';

const HEAD = 'a1b2c3d4e5f6';
const FILES = [{ path: 'src/a.ts', status: 'modified', patch: '@@ -1,2 +1,3 @@\n x\n+y\n z' }];
const F = (id: string, severity: 'blocker' | 'major' | 'minor' | 'nit', fingerprint: string) => ({ id, severity, path: 'src/a.ts', line: 2, rationale: 'Because ' + id, correction: 'Fix ' + id, fingerprint, inline: true });
const MARKER = (findings: Marker['findings']): Marker => ({ head: HEAD, base: 'base000000aa', verdict: 'changes needed', ci: 'passing', acceptedAt: '2026-11-27T10:00:00.000Z', policyDigest: 'd', findings });
const ledger = async (r: ReturnType<typeof rig>, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const receipts = async (r: ReturnType<typeof rig>) => (await r.world.view(OPERATOR).listComments(r.inbox)).map((c) => parseReceipt(c.body)).filter(Boolean);

test('the commands parse: /warden review and /warden dismiss <fingerprint> [reason]; a malformed fingerprint is not a command', () => {
  assert.deepEqual(parseMaintainerCommand('/warden review'), { kind: 'force-review', payload: {} });
  assert.deepEqual(parseMaintainerCommand('/warden dismiss aaaa1111bbbb2222 intended behaviour'), { kind: 'dismiss-finding', payload: { fingerprint: 'aaaa1111bbbb2222', reason: 'intended behaviour' } });
  assert.deepEqual(parseMaintainerCommand('/warden dismiss aaaa1111'), { kind: 'dismiss-finding', payload: { fingerprint: 'aaaa1111' } });
  assert.equal(parseMaintainerCommand('/warden dismiss not-hex'), null); assert.equal(parseMaintainerCommand('/warden review now please'), null);
});

async function prWithRecordedReview(findings: Marker['findings']) {
  const r = rig({ mode: 'live' }); const n = r.world.addIssue({ isPr: true, title: 'p', author: 'c1' });
  r.world.issues.get(n)!.pull = { head: HEAD, base: 'base000000aa', ci: 'passing', files: FILES.map((f) => ({ ...f })) };
  const marker = MARKER(findings); const rec = reviewRecordIntent({ repo: 'acme/widgets', item: n, marker });
  await r.send({ ...rec }); await r.writer().drain();
  return { r, n, marker, recId: makeIntent(rec).opid };
}
/** A maintainer command is a real, unedited comment by that GitHub user; the intent points at it. */
async function command(r: ReturnType<typeof rig>, n: number, as: string, text: string, kind: 'force-review' | 'dismiss-finding', payload: Record<string, unknown>) {
  const cid = await r.comment(as, n, text);
  return r.send({ kind, item: n, itemKind: 'pr', origin: 'maintainer', actor: as, payload, source: { kind: 'gh-comment', id: String(cid), observedAt: new Date(r.world.now()).toISOString() } });
}

test('/warden review: only a verified maintainer can force a full review; the request waits in the ledger and is cleared by a review accepted after it', async () => {
  const { r, n, marker } = await prWithRecordedReview([F('race', 'minor', 'aaaa1111bbbb2222')]);
  await command(r, n, 'rando', '/warden review', 'force-review', {}); await r.writer().drain();
  assert.equal((await ledger(r, n)).forceReview, undefined, 'a non-maintainer cannot force a review');
  assert.ok((await receipts(r)).some((x) => x!.result === 'rejected' && /unauthorized-identity/.test(x!.reason ?? '')));
  await command(r, n, OPERATOR, '/warden review', 'force-review', {}); await r.writer().drain();
  assert.equal((await ledger(r, n)).forceReview?.by, OPERATOR);
  r.world.clock = (r.world.clock ?? Date.now()) + 60_000;
  const later = { ...marker, acceptedAt: new Date(r.world.now()).toISOString() };
  await r.send({ ...reviewRecordIntent({ repo: 'acme/widgets', item: n, marker: later }) }); await r.writer().drain();
  assert.equal((await ledger(r, n)).forceReview, undefined, 'the new review satisfies the request');
});

test('/warden dismiss: removes one finding from the recorded severities (so it no longer gates), is never posted again, and only a verified maintainer can do it', async () => {
  const { r, n, marker, recId } = await prWithRecordedReview([F('race', 'blocker', 'aaaa1111bbbb2222'), F('nit', 'nit', 'cccc3333dddd4444')]);
  assert.deepEqual((await ledger(r, n)).review?.severities, ['blocker', 'nit']);
  await command(r, n, 'rando', '/warden dismiss aaaa1111bbbb2222', 'dismiss-finding', { fingerprint: 'aaaa1111bbbb2222' }); await r.writer().drain();
  assert.deepEqual((await ledger(r, n)).review?.severities, ['blocker', 'nit'], 'a non-maintainer dismisses nothing');
  await command(r, n, OPERATOR, '/warden dismiss aaaa1111bbbb2222 intended', 'dismiss-finding', { fingerprint: 'aaaa1111bbbb2222', reason: 'intended' }); await r.writer().drain();
  const l = await ledger(r, n); assert.deepEqual(l.review?.severities, ['nit']); assert.deepEqual(l.review?.fingerprints, ['cccc3333dddd4444']); assert.equal(l.dismissed?.['aaaa1111bbbb2222']?.by, OPERATOR);
  await r.send({ ...reviewPostIntent({ repo: 'acme/widgets', item: n, marker, causalAfter: recId }) }); await r.writer().drain();
  assert.equal(r.world.reviews.length, 1); assert.equal(r.world.reviews[0].comments.length, 1, 'only the finding that was not dismissed is posted'); assert.match(r.world.reviews[0].comments[0].body, /Because nit/);
  await command(r, n, OPERATOR, '/warden dismiss aaaa1111bbbb2222', 'dismiss-finding', { fingerprint: 'aaaa1111bbbb2222' }); await r.writer().drain();
  assert.ok((await receipts(r)).some((x) => /already-dismissed/.test(x!.reason ?? '')));
});

import { mustReviewAgain } from '../src/review/force.ts';
test('a forced review is repeated only when the local accepted review predates the request', () => {
  const led = { forceReview: { by: 'maint1', at: '2026-11-27T12:00:00.000Z' } };
  assert.equal(mustReviewAgain(led, { acceptedAt: '2026-11-27T10:00:00.000Z' }), true);
  assert.equal(mustReviewAgain(led, { acceptedAt: '2026-11-27T13:00:00.000Z' }), false, 'accepted after the request: no loop');
  assert.equal(mustReviewAgain({}, { acceptedAt: '2026-11-27T10:00:00.000Z' }), false); assert.equal(mustReviewAgain(led, null), false); assert.equal(mustReviewAgain(null, { acceptedAt: 'x' }), false);
});
