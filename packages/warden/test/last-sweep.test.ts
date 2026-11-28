import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSweepRecord } from '../src/sweep/last.ts';
test('the last-sweep record is written only for a sweep that ran to completion', () => {
  assert.deepEqual(lastSweepRecord({ now: Date.parse('2026-11-27T10:00:00Z'), clockActions: 2, deferred: 1, reconciles: 3, aborted: false }), { at: '2026-11-27T10:00:00.000Z', clockActions: 2, deferred: 1, reconciles: 3 });
  assert.equal(lastSweepRecord({ now: 1, clockActions: 0, deferred: 0, reconciles: 0, aborted: true }), null);
});
