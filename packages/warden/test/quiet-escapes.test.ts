import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWeakening } from '../src/verify/executor.ts';

/** ADR 0016 "quiet escapes": the ways a session can turn the checks green without fixing anything. Heuristic over the patch text, so a finding means a human or the review must look. */
const kinds = (files: Array<{ path: string; patch: string }>, deleted: string[] = []) => detectWeakening(files, deleted).map((w) => w.kind);
const patch = (del: string[], add: string[]) => ['@@ -1 +1 @@', ...del.map((l) => '-' + l), ...add.map((l) => '+' + l)].join('\n');

test('focused tests are flagged in test files only', () => {
  assert.deepEqual(kinds([{ path: 'test/a.test.js', patch: patch([], ["it.only('x', () => {});"]) }]), ['focused-test']);
  assert.deepEqual(kinds([{ path: 'test/a.test.js', patch: patch([], ["fdescribe('x', () => {});"]) }]), ['focused-test']);
  assert.deepEqual(kinds([{ path: 'src/a.js', patch: patch([], ['const only = x.only;']) }]), [], 'not a test file');
});

test('a widened numeric tolerance and a raised timeout or retry count are flagged; a tightened one is not', () => {
  assert.deepEqual(kinds([{ path: 'test/a.test.js', patch: patch(['assert.ok(Math.abs(a - b) < tolerance);', 'const tolerance = 0.001;'], ['assert.ok(Math.abs(a - b) < tolerance);', 'const tolerance = 0.5;']) }]), ['tolerance-widened']);
  assert.deepEqual(kinds([{ path: 'test/a.test.js', patch: patch(['expect(x).toBeCloseTo(1, 0.1)'], ['expect(x).toBeCloseTo(1, 0.01)']) }]), []);
  assert.deepEqual(kinds([{ path: 'test/a.test.js', patch: patch(['jest.setTimeout(5000);', "test('x', fn, timeout: 1000)"], ['jest.setTimeout(500000);', "test('x', fn, timeout: 1000)"]) }]), ['timeout-raised']);
  assert.deepEqual(kinds([{ path: 'jest.config.js', patch: patch(['  retries: 1,'], ['  retries: 9,']) }]).includes('timeout-raised'), true);
});

test('regenerated or bulk-updated snapshots are flagged; a small new snapshot is not', () => {
  assert.deepEqual(kinds([{ path: 'test/__snapshots__/a.snap', patch: patch(['exports[`a 1`] = `1`;'], ['exports[`a 1`] = `2`;']) }]), ['snapshot-changed']);
  assert.deepEqual(kinds([{ path: 'a.snap', patch: patch([], Array.from({ length: 60 }, (_, i) => `line ${i}`)) }]), ['snapshot-changed']);
  assert.deepEqual(kinds([{ path: 'a.snap', patch: patch([], ['exports[`a 1`] = `1`;']) }]), []);
});

test('test-runner include/exclude and mutation configuration changes are flagged; so is a test file moved out of the test paths', () => {
  assert.deepEqual(kinds([{ path: 'jest.config.js', patch: patch(["  testMatch: ['**/*.test.js'],"], ["  testMatch: ['**/*.test.js'],", "  testPathIgnorePatterns: ['/test/slow/'],"]) }]), ['test-config-changed']);
  assert.deepEqual(kinds([{ path: 'stryker.config.json', patch: patch(['"mutate": ["src/**/*.js"]'], ['"mutate": ["src/a.js"]']) }]), ['test-config-changed']);
  assert.deepEqual(kinds([{ path: 'jest.config.js', patch: patch(['  verbose: false,'], ['  verbose: true,']) }]), [], 'an unrelated option');
  assert.deepEqual(detectWeakening([{ path: 'src/sum.js', patch: patch([], ['x']) }], ['test/sum.test.js']).map((w) => w.kind), ['test-removed'], 'a deleted test with no same-named file elsewhere is only a removal');
  assert.ok(detectWeakening([{ path: 'src/legacy/sum.test.js', patch: patch([], ['x']) }], ['test/sum.test.js'], ['test/']).some((w) => w.kind === 'test-moved'), 'test/ is the only test path, so src/legacy/sum.test.js is outside it');
});
