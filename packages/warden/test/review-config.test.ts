import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWardenSchema } from '../src/config/schemas.ts';
import { DEFAULT_WARDEN } from '../src/config/defaults.ts';
import { reviewPostIntent } from '../src/review/record.ts';
import { reviewResultSchema } from '../src/review/schema.ts';
import { ajv } from '../src/config/schemas.ts';
import type { Marker } from '../src/review/slice.ts';

const base = { schemaVersion: 1, repository: 'acme/widgets', maintainers: ['maint1'] };
const ok = (o: unknown) => validateWardenSchema({ ...base, ...(o as object) }) === true;

test('config: the review keys validate; unknown or out-of-range values are refused; the defaults are the documented ones', () => {
  assert.equal(ok({ review: { maxPostedFindings: 3, uncertainFindings: 'drop-below-confidence', minConfidence: 0.7 } }), true);
  assert.equal(ok({ review: { maxPostedFindings: 0 } }), false); assert.equal(ok({ review: { maxPostedFindings: 51 } }), false);
  assert.equal(ok({ review: { uncertainFindings: 'guess' } }), false); assert.equal(ok({ review: { minConfidence: 1.5 } }), false); assert.equal(ok({ review: { surprise: true } }), false);
  assert.deepEqual(DEFAULT_WARDEN.review, { maxPostedFindings: 10, uncertainFindings: 'maintainer-decides', minConfidence: 0.5 });
});

test('a finding may report a confidence between 0 and 1; anything else is refused by the result schema', () => {
  const v = ajv.compile(reviewResultSchema); const f = (c: unknown) => ({ verdict: 'changes needed', findings: [{ id: 'a', severity: 'minor', path: 'x', line: 1, rationale: 'r', correction: 'c', ...(c === undefined ? {} : { confidence: c }) }] });
  assert.equal(v(f(undefined)), true); assert.equal(v(f(0.4)), true); assert.equal(v(f(1.2)), false); assert.equal(v(f('high')), false);
});

const M = (cs: Array<number | undefined>): Marker => ({ head: 'h1', base: 'b1', verdict: 'changes needed', ci: 'passing', acceptedAt: '2026-11-27T10:00:00.000Z',
  findings: cs.map((c, i) => ({ id: 'f' + i, severity: 'minor' as const, path: 'src/a.ts', line: i + 1, rationale: 'r', correction: 'c', fingerprint: String(i).padStart(16, '0'), inline: true, ...(c === undefined ? {} : { confidence: c }) })) });

test('posting: the cap and drop-below-confidence decide what is posted; the recorded review (ledger) keeps every finding', () => {
  const m = M([0.9, 0.2, undefined, 0.6]);
  const all = reviewPostIntent({ repo: 'a/b', item: 1, marker: m }); assert.equal((all.payload.findings as unknown[]).length, 4);
  const capped = reviewPostIntent({ repo: 'a/b', item: 1, marker: m, cap: 2 }); assert.equal((capped.payload.findings as unknown[]).length, 2); assert.equal(capped.payload.omitted, 2);
  const dropped = reviewPostIntent({ repo: 'a/b', item: 1, marker: m, dropBelow: 0.5 }); assert.deepEqual((dropped.payload.findings as Array<{ line: number }>).map((x) => x.line), [1, 3, 4], 'the 0.2 finding is not posted; the one with no reported confidence is kept');
  assert.equal(m.findings.length, 4, 'the marker the ledger is recorded from is untouched');
});
