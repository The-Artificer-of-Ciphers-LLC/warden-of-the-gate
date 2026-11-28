import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditTable, limitOf, stated } from '../src/rules/table.ts';
import type { Rule } from '../src/rules/table.ts';
import { TRIAGE_LIMITS, TRIAGE_RULES } from '../src/triage/rules.ts';
import { REVIEW_LIMITS, REVIEW_RULES, reviewChecks } from '../src/review/rules.ts';
import { triageResultSchema, incomplete } from '../src/triage/schema.ts';
import type { TriageOutput } from '../src/triage/schema.ts';
import { reviewResultSchema } from '../src/review/schema.ts';
import type { Finding } from '../src/review/schema.ts';
import { buildTriagePrompt } from '../src/triage/slice.ts';
import { buildReviewPrompt } from '../src/review/prompt.ts';
import { DEFAULT_MAX_POSTED_FINDINGS } from '../src/review/findings.ts';
import type { IssueState, PullInfo } from '../src/github/store.ts';

const issue = { number: 7, title: 't', author: 'a', labels: [], body: 'b', state: 'open', isPr: false } as unknown as IssueState;
const pull = { number: 3, title: 't', author: 'a', base: 'b', head: 'h', ci: 'passing', state: 'open', files: [{ path: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n+x' }] } as unknown as PullInfo;
const f = (id: string, path = 'a.ts'): Finding => ({ id, severity: 'minor', path, line: 1, rationale: 'r', correction: 'c' });
// Every number the prompt gives next to a unit must be a limit the table holds: a hand-typed number is a second copy.
const statedLimits = (prompt: string) => [...prompt.matchAll(/(\d+) (?:characters|findings|questions|evidence items)/g)].map((m) => Number(m[1]));
const tableLimits = (rules: Rule[]) => new Set(rules.map(limitOf).filter((n): n is number => n !== undefined));

test('every rule in both tables has a check, the schema, or the judgment mark, and the tables are well formed', (t) => {
  assert.deepEqual(auditTable(TRIAGE_RULES), []); assert.deepEqual(auditTable(REVIEW_RULES), []);
  // The reviewer of a table change reads this list: these rules rest on the model's judgment and nothing checks them.
  for (const [name, rs] of [['triage', TRIAGE_RULES], ['review', REVIEW_RULES]] as const) t.diagnostic(`${name} judgment rules: ${rs.filter((r) => r.check === 'judgment').map((r) => r.id).join(', ')}`);
});

test('the audit names a rule with no check, a target above its hard limit, a duplicate id, a limit text without a limit', () => {
  const bad: Rule[] = [
    { id: 'a', text: 'x', check: undefined as never }, { id: 'b', text: 'x', hard: 5, target: 9, check: 'schema' }, { id: 'b', text: 'x', check: 'judgment' },
    { id: 'c', text: (n) => `at most ${n}`, check: 'judgment' }, { id: 'd', text: 'x', check: 'schema' },
  ];
  const got = auditTable(bad).join('\n');
  for (const re of [/a: no check/, /b: target 9 is above hard 5/, /duplicate id b/, /c: text states a limit but the rule has none/, /d: marked schema but has no hard limit/]) assert.match(got, re);
});

test('the schemas take their limits from the tables, so the two cannot drift', () => {
  const p = triageResultSchema.properties; const q = p.proposal.properties;
  assert.equal(p.summary.maxLength, TRIAGE_LIMITS.summary.hard); assert.equal(p.questions.maxItems, TRIAGE_LIMITS.questions.hard); assert.equal(p.evidence.maxItems, TRIAGE_LIMITS.evidence.hard);
  assert.equal(p.escalation.maxLength, TRIAGE_LIMITS.field.hard); assert.equal(q.scope.maxLength, TRIAGE_LIMITS.field.hard); assert.equal(p.evidence.items.properties.detail.maxLength, TRIAGE_LIMITS.field.hard);
  const r = reviewResultSchema.properties.findings; assert.equal(r.maxItems, REVIEW_LIMITS.findings.hard);
  assert.equal(r.items.properties.rationale.maxLength, REVIEW_LIMITS.rationale.hard); assert.equal(r.items.properties.correction.maxLength, REVIEW_LIMITS.correction.hard);
  assert.equal(DEFAULT_MAX_POSTED_FINDINGS, REVIEW_LIMITS.posted.hard);
});

test('where the prompt aims below the hard limit, both numbers are written down (the 2026-11-28 disagreements, now deliberate)', () => {
  assert.deepEqual([TRIAGE_LIMITS.summary.target, TRIAGE_LIMITS.summary.hard], [400, 600]); assert.deepEqual([TRIAGE_LIMITS.field.target, TRIAGE_LIMITS.field.hard], [400, 1500]);
  assert.deepEqual([REVIEW_LIMITS.rationale.target, REVIEW_LIMITS.rationale.hard], [600, 2000]); assert.deepEqual([REVIEW_LIMITS.correction.target, REVIEW_LIMITS.correction.hard], [600, 2000]);
  assert.deepEqual([REVIEW_LIMITS.findings.target, REVIEW_LIMITS.findings.hard], [5, 50]);
});

test('the triage prompt states every rule of its table and no limit that is not in it', () => {
  const prompt = buildTriagePrompt(issue, []);
  for (const r of TRIAGE_RULES) assert.ok(prompt.includes(stated(r)), `prompt lacks rule ${r.id}`);
  const nums = statedLimits(prompt); assert.ok(nums.length >= 4, 'the limits are stated'); for (const n of nums) assert.ok(tableLimits(TRIAGE_RULES).has(n), `prompt states ${n}, which no table entry holds`);
  assert.doesNotMatch(prompt, /\b600 characters|\b1500 characters/, 'the hard limits are the schema\'s, the prompt states the target');
});

test('the review prompt states every rule of its table and no limit that is not in it', () => {
  const prompt = buildReviewPrompt(pull, 'full', null, []);
  for (const r of REVIEW_RULES) if (r.text !== null) assert.ok(prompt.includes(stated(r)), `prompt lacks rule ${r.id}`);
  const nums = statedLimits(prompt); assert.ok(nums.length >= 3, 'the limits are stated'); for (const n of nums) assert.ok(tableLimits(REVIEW_RULES).has(n), `prompt states ${n}, which no table entry holds`);
});

test('the triage completeness rules reject what incomplete() always rejected, with the same reasons', () => {
  const base: TriageOutput = { kind: 'bug', outcome: 'likely-bug', summary: 's' };
  assert.equal(incomplete(base), 'a likely bug needs at least one piece of evidence');
  assert.equal(incomplete({ ...base, evidence: [{ kind: 'observation', detail: 'd' }] }), 'a likely bug needs severity and risk, assessed separately');
  assert.equal(incomplete({ ...base, kind: 'question' }), 'outcome likely-bug requires kind bug');
  assert.equal(incomplete({ kind: 'other', outcome: 'needs-info', summary: 's' }), 'needs-info requires at least one precise question');
  assert.equal(incomplete({ kind: 'other', outcome: 'escalate', summary: 's' }), 'escalate requires a reason');
  assert.equal(incomplete({ kind: 'other', outcome: 'not-actionable', summary: 's' }), null);
  assert.equal(incomplete({ kind: 'other', outcome: 'feature-proposal', summary: 's' }), 'a feature proposal requires kind feature or enhancement');
});

test('the review checks reject whole, with the reason codes the record and the replay already use', () => {
  const ctx = { inScope: new Set(['a.ts']), prior: [] as Finding[] };
  assert.equal(reviewChecks({ verdict: 'changes needed', findings: [f('x')] }, ctx), null);
  assert.equal(reviewChecks({ verdict: 'changes needed', findings: [f('x', 'z.ts')] }, ctx)?.reason, 'out-of-scope:z.ts');
  assert.equal(reviewChecks({ verdict: 'no findings', findings: [f('x')] }, ctx)?.reason, 'verdict-inconsistent');
  assert.equal(reviewChecks({ verdict: 'changes needed', findings: [] }, ctx)?.reason, 'verdict-inconsistent');
  assert.equal(reviewChecks({ verdict: 'changes needed', findings: [f('x'), f('x')] }, ctx)?.reason, 'duplicate-ids');
  const delta = { ...ctx, prior: [f('old')] };
  assert.equal(reviewChecks({ verdict: 'changes needed', findings: [f('x')] }, delta)?.reason, 'revalidation-incomplete');
  assert.equal(reviewChecks({ verdict: 'changes needed', findings: [f('x')], revalidated: [{ id: 'old', status: 'open' }] }, delta), null);
});
