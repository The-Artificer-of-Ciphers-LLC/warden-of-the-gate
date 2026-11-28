import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotate, capFindings, diffLines, fingerprint, isInlineable, ruleOf } from '../src/review/findings.ts';
import type { Finding } from '../src/review/schema.ts';

const PATCH = '@@ -10,4 +10,6 @@ function f() {\n   const a = 1;\n-  const b = 2;\n+  const b = 3;\n+  const c = 4;\n   return a;\n }\n@@ -40,2 +42,3 @@\n   x();\n+  y();\n   z();';
const FILES = [{ path: 'src/a.ts', status: 'modified', patch: PATCH }];
const F = (o: Partial<Finding>): Finding => ({ id: 'f1', severity: 'major', path: 'src/a.ts', line: 12, rationale: 'r', correction: 'c', ...o });

test('diffLines maps new-file line numbers to text; deleted lines and lines outside the hunks are absent', () => {
  const m = diffLines(PATCH);
  assert.equal(m.get(10), '  const a = 1;'); assert.equal(m.get(11), '  const b = 3;'); assert.equal(m.get(12), '  const c = 4;'); assert.equal(m.get(13), '  return a;');
  assert.equal(m.get(43), '  y();'); assert.equal(m.has(20), false); assert.equal(m.has(9), false); assert.equal(diffLines(undefined).size, 0);
});

test('inline position: only a line the diff shows can be commented on inline', () => {
  assert.equal(isInlineable(F({ line: 12 }), FILES), true); assert.equal(isInlineable(F({ line: 20 }), FILES), false); assert.equal(isInlineable(F({ path: 'other.ts' }), FILES), false);
});

test('fingerprint: stable across a line shift, whitespace changes and a trailing counter in the id; different for different code, path or rule', () => {
  const base = fingerprint(F({}), FILES);
  const shifted = [{ path: 'src/a.ts', status: 'modified', patch: PATCH.replace('@@ -10,4 +10,6', '@@ -30,4 +30,6') }];
  assert.equal(fingerprint(F({ line: 32 }), shifted), base, 'same anchor text at a new line number');
  assert.equal(fingerprint(F({ id: 'F1-2' }), FILES), base, 'rule ignores case and a trailing counter');
  assert.equal(ruleOf('race-condition-3'), 'race-condition');
  assert.notEqual(fingerprint(F({ line: 11 }), FILES), base); assert.notEqual(fingerprint(F({ path: 'src/b.ts' }), FILES), base); assert.notEqual(fingerprint(F({ id: 'other' }), FILES), base);
});

test('annotate: adds fingerprint and inline flag, and collapses a repeated finding to the more severe one', () => {
  const out = annotate([F({ id: 'race-1', severity: 'minor' }), F({ id: 'race-2', severity: 'blocker' }), F({ id: 'edge', line: 43 }), F({ id: 'far', line: 99 })], FILES);
  assert.equal(out.length, 3); assert.equal(out[0].severity, 'blocker'); assert.equal(out[0].inline, true); assert.match(out[0].fingerprint!, /^[0-9a-f]{16}$/);
  assert.equal(out.find((x) => x.id === 'far')!.inline, false);
});

test('capFindings: most severe first, ties keep the model order, the rest are counted as omitted', () => {
  const fs = [F({ id: 'a', severity: 'nit' }), F({ id: 'b', severity: 'major' }), F({ id: 'c', severity: 'blocker' }), F({ id: 'd', severity: 'major' })];
  const r = capFindings(fs, 3); assert.deepEqual(r.shown.map((x) => x.id), ['c', 'b', 'd']); assert.equal(r.omitted, 1);
  assert.deepEqual(capFindings(fs, 0), { shown: [], omitted: 4 }); assert.equal(capFindings(fs).omitted, 0);
});
