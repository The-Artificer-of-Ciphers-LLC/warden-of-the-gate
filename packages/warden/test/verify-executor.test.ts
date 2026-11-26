import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, detectWeakening, evidenceFor, runChecks } from '../src/verify/executor.ts';
import type { Check } from '../src/verify/executor.ts';

/** The executor runs REAL commands inside the REAL Seatbelt boundary (macOS). Fixtures are tiny node:test projects. */
const proj = (testBody: string) => { const d = mkdtempSync(join(tmpdir(), 'warden-ex-')); mkdirSync(join(d, 'test')); writeFileSync(join(d, 'sum.js'), 'exports.sumTo = (n) => { let t = 0; for (let i = 1; i < n; i++) t += i; return t; };\n'); writeFileSync(join(d, 'test/sum.test.js'), testBody); return d; };
const BUG_TEST = "const { test } = require('node:test'); const assert = require('node:assert'); const { sumTo } = require('../sum.js'); test('sumTo(3) is 1+2', () => assert.strictEqual(sumTo(3), 3)); test('sumTo(4) is 1+2+3', () => assert.strictEqual(sumTo(4), 7));\n";
const checks: Check[] = [{ id: 'unit', kind: 'test', command: process.execPath, args: ['--test', 'test/sum.test.js'], timeoutMs: 60_000 }];

test('the executor runs checks inside the boundary, records command/revision/status/digest, and cannot reach the home directory or the network', async (t) => {
  const d = proj(BUG_TEST); t.after(() => rmSync(d, { recursive: true, force: true }));
  const [r] = await runChecks({ workspace: d, revision: 'cand123', checks });
  assert.equal(r.code, 1, 'the buggy fixture fails sumTo(4)'); assert.equal(r.revision, 'cand123'); assert.equal(r.contained, true); assert.match(r.outputSha256, /^[0-9a-f]{64}$/); assert.match(r.outputTail, /sumTo\(4\)|not ok|fail/);
  const escape = join(process.env.HOME ?? '/Users/nobody', '.warden-verify-escape-test');
  const [e] = await runChecks({ workspace: d, revision: 'x', checks: [{ id: 'esc', kind: 'build', command: process.execPath, args: ['-e', `try{require('fs').writeFileSync(${JSON.stringify(escape)},'x');console.log('WROTE')}catch(e){console.log('DENIED '+e.code)}; require('net').connect({host:'1.1.1.1',port:80}).on('error',e=>console.log('NET '+e.code)).on('connect',()=>console.log('NETOPEN'))`] }] });
  assert.ok(!existsSync(escape), 'nothing was written outside the workspace'); assert.match(e.outputTail, /DENIED/); assert.doesNotMatch(e.outputTail, /WROTE|NETOPEN/);
});

test('baseline separation: fail-before/pass-after is `fixed`; a failure present on the base stays a baseline failure; a new failure is a regression', async (t) => {
  const base = proj(BUG_TEST); t.after(() => rmSync(base, { recursive: true, force: true }));
  const fixed = proj(BUG_TEST); t.after(() => rmSync(fixed, { recursive: true, force: true })); writeFileSync(join(fixed, 'sum.js'), 'exports.sumTo = (n) => { let t = 0; for (let i = 1; i < n; i++) t += i; return t; };\n'.replace('i < n', 'i <= n').replace('1; i <= n', '1; i <= n'));
  // base: sumTo(3)=3, sumTo(4)=6 => the second assertion (7) fails. fixed: i<=n gives sumTo(3)=6 => the first assertion fails: change the tests to a matching contract instead
  writeFileSync(join(fixed, 'sum.js'), 'exports.sumTo = (n) => { let t = 0; for (let i = 1; i < n; i++) t += i; return t + (n > 3 ? 1 : 0); };\n');
  const b = await runChecks({ workspace: base, revision: 'base', checks }); const c = await runChecks({ workspace: fixed, revision: 'cand', checks });
  assert.equal(b[0].code, 1); assert.equal(c[0].code, 0);
  assert.equal(compare(b, c)[0].relation, 'fixed');
  assert.equal(compare(b, b)[0].relation, 'baseline-failure-persists'); assert.equal(compare(c, b)[0].relation, 'regression'); assert.equal(compare(c, c)[0].relation, 'passes-both'); assert.equal(compare([], c)[0].relation, 'baseline-missing');
  assert.equal(evidenceFor('bug', compare(b, c), []).sufficient, true);
  assert.equal(evidenceFor('bug', compare(c, c), []).sufficient, false, 'a bug fix with no failing-before test is not evidence');
  assert.equal(evidenceFor('bug', compare(b, c), [{ path: 'x', kind: 'skipped-test', detail: 'd' }]).sufficient, false, 'possible gate weakening blocks sufficiency');
  assert.equal(evidenceFor('feature', compare(c, c), []).sufficient, true); assert.equal(evidenceFor('bug', compare(c, b), []).sufficient, false);
});

test('a timeout is a failure with timedOut recorded, never a pass', async (t) => {
  const d = proj(BUG_TEST); t.after(() => rmSync(d, { recursive: true, force: true }));
  const [r] = await runChecks({ workspace: d, revision: 'x', checks: [{ id: 'hang', kind: 'test', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 1500 }] });
  assert.equal(r.timedOut, true); assert.notEqual(r.code, 0); assert.equal(compare([r], [r])[0].candidate, 'fail');
});

test('gate-weakening detection flags skipped tests, removed assertions, suppressions, disabled lint rules, lowered strictness and thresholds, changed check scripts, CI edits and deleted tests; ordinary changes pass clean', () => {
  const f = (path: string, patch: string) => ({ path, patch });
  const w = detectWeakening([
    f('test/a.test.js', "-  assert.strictEqual(a, 1);\n-  assert.ok(b);\n+  it.skip('later', () => {});"),
    f('src/x.ts', '+  // eslint-disable-next-line no-explicit-any\n+  const y = z as any;'),
    f('.eslintrc.json', '-  "no-eval": "error"\n+  "no-eval": "off",'),
    f('tsconfig.json', '-  "strict": true\n+  "strict": false'),
    f('package.json', '-  "test": "node --test"\n+  "test": "node --test || true"'),
    f('jest.config.js', '-  lines: 90\n+  lines: 60'),
    f('.github/workflows/ci.yml', '+  - run: echo skip'),
  ], ['test/old.test.js']);
  const kinds = new Set(w.map((x) => x.kind));
  for (const k of ['skipped-test', 'removed-assertions', 'suppression-added', 'lint-rule-disabled', 'strictness-lowered', 'check-script-changed', 'threshold-lowered', 'ci-changed', 'test-removed']) assert.ok(kinds.has(k as never), k);
  assert.deepEqual(detectWeakening([f('src/feature.ts', '+export const a = 1;\n-export const a = 0;'), f('test/feature.test.js', "+  assert.strictEqual(a, 1);\n+  assert.strictEqual(b, 2);")]), []);
});
