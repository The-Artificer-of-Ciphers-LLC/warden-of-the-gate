import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './helpers.ts';
import { reviewRecordIntent } from '../src/review/record.ts';
import { makeIntent, parseLedger, LEDGER_MARK, parseReceipt } from '../src/writer/protocol.ts';
import type { Marker } from '../src/review/slice.ts';

const MARKER = (o: Partial<Marker> = {}): Marker => ({ head: 'a1b2c3d4e5f6', base: 'base000000aa', verdict: 'changes needed', ci: 'passing', acceptedAt: '2026-11-27T10:00:00.000Z', policyDigest: 'digest1',
  findings: [{ id: 'f1', severity: 'minor', path: 'src/a.ts', line: 3, rationale: 'r', correction: 'c', fingerprint: 'aaaaaaaaaaaaaaaa', inline: true }], ...o });
const ledger = async (r: ReturnType<typeof rig>, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
const receipts = async (r: ReturnType<typeof rig>) => (await r.world.view('x').listComments(r.inbox)).map((c) => parseReceipt(c.body)).filter(Boolean);

test('the review-record intent carries severities only, no finding text; the same review has the same identity, a new head or finding does not', () => {
  const a = reviewRecordIntent({ repo: 'acme/widgets', item: 7, marker: MARKER() });
  assert.equal(a.kind, 'review-record'); assert.equal(a.origin, 'ai'); assert.equal(a.itemKind, 'pr');
  assert.deepEqual(a.payload, { head: 'a1b2c3d4e5f6', base: 'base000000aa', verdict: 'changes needed', severities: ['minor'], policyDigest: 'digest1' });
  assert.equal(JSON.stringify(a).includes('"rationale"'), false, 'no finding text is copied');
  assert.equal(makeIntent(a).opid, makeIntent(reviewRecordIntent({ repo: 'acme/widgets', item: 7, marker: MARKER() })).opid);
  assert.notEqual(makeIntent(a).opid, makeIntent(reviewRecordIntent({ repo: 'acme/widgets', item: 7, marker: MARKER({ head: 'ffff00000000' }) })).opid);
  assert.notEqual(makeIntent(a).opid, makeIntent(reviewRecordIntent({ repo: 'acme/widgets', item: 7, marker: MARKER({ findings: [] }) })).opid);
});

test('shadow mode: the writer records nothing from an accepted AI review; live mode: the ledger records it and a clean review makes the PR merge-ready', async () => {
  const shadow = rig({ mode: 'shadow' }); const s = shadow.world.addIssue({ isPr: true, title: 'p', author: 'c1' });
  await shadow.send({ ...reviewRecordIntent({ repo: 'acme/widgets', item: s, marker: MARKER() }) });
  await shadow.writer().drain();
  assert.ok((await receipts(shadow)).some((x) => x!.result === 'rejected' && /shadow-mode-ai-effects-disabled/.test(x!.reason ?? '')));

  const live = rig({ mode: 'live' }); const n = live.world.addIssue({ isPr: true, title: 'p', author: 'c1' });
  await live.send({ ...reviewRecordIntent({ repo: 'acme/widgets', item: n, marker: MARKER({ findings: [] , verdict: 'no findings' }) }) });
  await live.writer().drain();
  const l = await ledger(live, n); assert.equal(l.review?.head, 'a1b2c3d4e5f6'); assert.deepEqual(l.review?.severities, []); assert.equal(l.state, 'merge-ready');
});

import { reviewPostIntent } from '../src/review/record.ts';

const FILES = [{ path: 'src/a.ts', status: 'modified', patch: '@@ -1,2 +1,3 @@\n x\n+y\n z' }];
const mk = (n: number, headSha = 'a1b2c3d4e5f6') => { const r = rig({ mode: 'live' }); const item = r.world.addIssue({ isPr: true, title: 'p', author: 'c1' }); r.world.issues.get(item)!.pull = { head: headSha, base: 'base000000aa', ci: 'passing', files: FILES.map((f) => ({ ...f })) }; return { r, item, n }; };
const FIND = (id: string, severity: 'blocker' | 'major' | 'minor' | 'nit', line: number, inline: boolean) => ({ id, severity, path: 'src/a.ts', line, rationale: 'Because ' + id, correction: 'Fix ' + id, fingerprint: id.padEnd(16, '0').slice(0, 16), inline });

test('review-post: a recorded review is posted as ONE COMMENT review on the reviewed head plus a Warden check run, once, and never again for the same review', async () => {
  const { r, item } = mk(1); const marker = MARKER({ findings: [FIND('race', 'major', 2, true), FIND('far', 'minor', 99, false)] });
  const rec = reviewRecordIntent({ repo: 'acme/widgets', item, marker }); const recId = await r.send({ ...rec }); void recId;
  const opid = makeIntent(rec).opid;
  await r.send({ ...reviewPostIntent({ repo: 'acme/widgets', item, marker, causalAfter: opid }) });
  await r.writer().drain(); await r.writer().drain();
  assert.equal(r.world.reviews.length, 1); const rv = r.world.reviews[0];
  assert.equal(rv.commitId, 'a1b2c3d4e5f6'); assert.equal(rv.comments.length, 1); assert.equal(rv.comments[0].line, 2); assert.match(rv.body, /not an approval or a request for changes/); assert.match(rv.body, /src\/a\.ts:99/);
  assert.equal(r.world.checkRuns.length, 1); assert.equal(r.world.checkRuns[0].name, 'Warden review'); assert.equal(r.world.checkRuns[0].headSha, 'a1b2c3d4e5f6'); assert.equal(r.world.checkRuns[0].conclusion, 'action_required');
  assert.equal((await ledger(r, item)).reviewPosted?.head, 'a1b2c3d4e5f6');
  // the same review submitted again changes nothing
  await r.send({ ...reviewPostIntent({ repo: 'acme/widgets', item, marker, causalAfter: opid, actor: 'warden-review-2' }) }); await r.writer().drain();
  assert.equal(r.world.reviews.length, 1); assert.equal(r.world.checkRuns.length, 1);
});

test('review-post: refused when the head moved, when the review was not recorded for that head, and in shadow mode; the intent stays small with a full cap of findings', async () => {
  const marker = MARKER({ findings: [FIND('race', 'minor', 2, true)] });
  { const { r, item } = mk(1, 'newhead000000'); await r.send({ ...reviewRecordIntent({ repo: 'acme/widgets', item, marker }) }); await r.send({ ...reviewPostIntent({ repo: 'acme/widgets', item, marker }) }); await r.writer().drain();
    assert.equal(r.world.reviews.length, 0, 'the pull request moved on: nothing is posted against the old head'); }
  { const { r, item } = mk(1); await r.send({ ...reviewPostIntent({ repo: 'acme/widgets', item, marker }) }); await r.writer().drain();
    assert.equal(r.world.reviews.length, 0, 'not recorded first: nothing is posted'); }
  { const r = rig({ mode: 'shadow' }); const item = r.world.addIssue({ isPr: true, title: 'p', author: 'c1' }); r.world.issues.get(item)!.pull = { head: 'a1b2c3d4e5f6', base: 'b', ci: 'passing', files: FILES.map((f) => ({ ...f })) };
    await r.send({ ...reviewPostIntent({ repo: 'acme/widgets', item, marker }) }); await r.writer().drain(); assert.equal(r.world.reviews.length, 0); }
  const many = Array.from({ length: 30 }, (_, i) => ({ ...FIND('f' + i, 'minor', 2, true), rationale: 'x'.repeat(900), correction: 'y'.repeat(900) }));
  const big = reviewPostIntent({ repo: 'acme/widgets', item: 7, marker: MARKER({ findings: many }) });
  assert.ok(Buffer.byteLength(JSON.stringify(makeIntent(big))) < 8192, 'a full cap of clipped findings fits the intent size limit'); assert.equal((big.payload.findings as unknown[]).length, 10); assert.equal(big.payload.omitted, 20);
});
