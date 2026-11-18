import { test } from 'node:test';
import assert from 'node:assert/strict';
import { select } from '../src/scan/select.ts';
import type { Candidate } from '../src/scan/select.ts';

const caps = { maxItems: 3, starveAfterHours: 168, maxFactoryImplementationPrs: 1, openFactoryImplementationPrs: 0 };
const c = (item: number, o: Partial<Candidate> = {}): Candidate => ({ item, kind: 'pr', ageHours: 1, ...o });

test('order: authorized urgent, then work in progress, then the rest oldest-first; ties break by item number (deterministic)', () => {
  const s = select([c(5, { ageHours: 100 }), c(6, { ageHours: 50, inProgress: true }), c(7, { ageHours: 2, urgent: true }), c(8, { ageHours: 100 })], { ...caps, maxItems: 10 });
  assert.deepEqual(s.run.map((x) => x.item), [7, 6, 5, 8]);
  assert.deepEqual(select([c(8, { ageHours: 100 }), c(5, { ageHours: 100 })], caps).run.map((x) => x.item), [5, 8]);
});

test('aging prevents starvation: an old approved feature outranks fresher ordinary work once it passes the starvation age', () => {
  const s = select([c(1, { kind: 'issue', approvedFeature: true, ageHours: 200 }), c(2, { ageHours: 150 }), c(3, { ageHours: 160 })], { ...caps, maxItems: 2 });
  assert.equal(s.run[0].item, 1); assert.equal(s.deferred.length, 1);
});

test('capacity: the item budget defers the rest with a reason; the factory implementation cap defers extra factory PRs even when urgent', () => {
  const s = select([c(1), c(2), c(3), c(4)], caps); assert.equal(s.run.length, 3); assert.match(s.deferred[0].why, /item budget reached/);
  const f = select([c(10, { factoryImplementation: true, urgent: true }), c(11, { factoryImplementation: true, urgent: true }), c(12)], { ...caps, maxItems: 5 });
  assert.deepEqual(f.run.map((x) => x.item), [10, 12]); assert.match(f.deferred[0].why, /factory implementation cap/);
  assert.equal(select([c(20, { factoryImplementation: true })], { ...caps, openFactoryImplementationPrs: 1 }).run.length, 0);
});

test('blocked entries are reported, never run, and urgency does not unblock them', () => {
  const s = select([c(1, { urgent: true, blockedReason: 'retry budget used up' }), c(2)], caps);
  assert.deepEqual(s.run.map((x) => x.item), [2]); assert.deepEqual(s.blocked, [{ item: 1, why: 'retry budget used up' }]);
});
