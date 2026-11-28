import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFrozen, frozenViolations, MAX_FROZEN_FILES, PROPERTY_MARKERS } from '../src/verify/frozen.ts';

/** ADR 0014: the freeze record travels in the factory PR's link and sits in its ledger; it is bounded and exact, and one record is never replaced. */
const good = { baseCommit: 'abc1234', files: [{ path: 'test/a.test.js', sha256: 'a'.repeat(64) }] };
test('cleanFrozen accepts an exact bounded record and refuses anything else', () => {
  assert.deepEqual(cleanFrozen(good), good);
  for (const bad of [null, 'x', {}, { ...good, baseCommit: 'xyz' }, { ...good, files: 'no' }, { ...good, files: [{ path: '/etc/passwd', sha256: 'a'.repeat(64) }] }, { ...good, files: [{ path: '../x.test.js', sha256: 'a'.repeat(64) }] }, { ...good, files: [{ path: 'test/a.test.js', sha256: 'short' }] }, { ...good, files: Array.from({ length: MAX_FROZEN_FILES + 1 }, (_, i) => ({ path: `test/${i}.test.js`, sha256: 'a'.repeat(64) })) }]) assert.equal(cleanFrozen(bad), null, JSON.stringify(bad).slice(0, 60));
});
test('frozenViolations names changed existing tests and added runner configuration, and lets new tests through', () => {
  assert.deepEqual(frozenViolations('/nonexistent', { baseCommit: 'abc1234', files: [] }, [{ path: 'src/a.js', status: 'M' }, { path: 'test/new.test.js', status: 'A' }]), []);
  assert.deepEqual(frozenViolations('/nonexistent', { baseCommit: 'abc1234', files: [] }, [{ path: 'test/old.test.js', status: 'M' }, { path: 'jest.config.js', status: 'A' }]), ['test/old.test.js', 'jest.config.js']);
});
test('property markers cover the common libraries and do not match ordinary words', () => {
  for (const yes of ["const fc = require('fast-check')", 'fc.assert(fc.property(a, f))', '@given(st.integers())', 'from hypothesis import given', 'proptest! { }', 'use quickcheck::QuickCheck', '@Property jqwik']) assert.match(yes, PROPERTY_MARKERS, yes);
  for (const no of ['test("sumTo(4) is 6")', 'a property of the object', 'const given = 1']) assert.doesNotMatch(no, PROPERTY_MARKERS, no);
});
