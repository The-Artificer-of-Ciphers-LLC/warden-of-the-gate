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
