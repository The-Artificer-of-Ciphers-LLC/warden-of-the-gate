import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_THRESHOLDS, runReplay } from '../src/replay/replay.ts';
import type { ReplaySet, ReviewCase, TriageCase } from '../src/replay/replay.ts';
import { hunkRanges, sameHunk } from '../src/review/findings.ts';
import type { AgentRunner, SessionRequest, SessionResult } from '../src/runner/agent-runner.ts';

const PATCH = '@@ -10,4 +10,6 @@ f\n a\n-b\n+c\n+d\n e\n g\n@@ -40,2 +42,3 @@\n x\n+y\n z';   // hunk A new lines 10-15, hunk B new lines 42-44
const FILES = [{ path: 'src/a.ts', status: 'modified', patch: PATCH }];
const done = (o: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } });
const review = (id: string, over: Partial<ReviewCase> = {}): ReviewCase => ({ id, kind: 'review', title: `PR ${id}`, files: FILES, expect: { mustFind: [{ path: 'src/a.ts', lineMin: 12, lineMax: 12 }] }, ...over });
const triage = (id: string, kind = 'bug', over: Partial<TriageCase> = {}): TriageCase => ({ id, kind: 'triage', title: `Issue ${id}`, body: 'crash on save', expect: { kind, outcome: 'likely-bug' }, ...over });
const F = (id: string, line: number) => ({ id, severity: 'major', path: 'src/a.ts', line, rationale: 'r', correction: 'c' });
/** A scripted model: for a review it returns the findings registered for that PR's title, for triage a bug verdict. */
const model = (byTitle: Record<string, Array<ReturnType<typeof F>>>): AgentRunner => ({ name: 'fake', pinnedVersion: '0',
  async preflight() { return { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] }; },
  async run(req: SessionRequest): Promise<SessionResult> {
    const text = readFileSync(join(req.packetDir, 'prompt.txt'), 'utf8');
    if (req.task === 'review') { const f = Object.entries(byTitle).find(([t]) => text.includes(`: ${t}\n`))?.[1] ?? [];
      return done({ verdict: f.length ? 'changes needed' : 'no findings', findings: f }); }
    return done({ kind: 'bug', outcome: 'likely-bug', summary: 's', severity: 'major', risk: 'low', quickWin: false, evidence: [{ kind: 'reporter-claim', detail: 'Crashes when saving an empty document.' }] });
  } });
const o = (r: AgentRunner) => ({ runner: r, localModels: ['local-default'], budgets: { maxToolCalls: 1, maxModelTurns: 1, wallTimeMs: 5000 } });

test('hunks: new-file ranges and "same hunk" (a finding on any line of the changed hunk is the same place; another hunk is not)', () => {
  assert.deepEqual(hunkRanges(PATCH), [{ from: 10, to: 15 }, { from: 42, to: 44 }]);
  assert.equal(sameHunk(PATCH, 12, 15), true); assert.equal(sameHunk(PATCH, 12, 43), false); assert.equal(sameHunk(PATCH, 12, 30), false); assert.equal(sameHunk(undefined, 12, 12), false);
});

test('matching: a finding hits the known defect when it is in the same file and the same changed hunk, not only on the exact lines', async () => {
  const set: ReplaySet = { name: 's', curatedBy: 'm', cases: [review('p1'), review('p2'), review('p3')] };
  const rep = await runReplay(set, o(model({ 'PR p1': [F('a', 14)], 'PR p2': [F('b', 43)], 'PR p3': [F('c', 12)] })));
  assert.deepEqual(rep.results.map((r) => [r.hits, r.falsePositives]), [[1, 0], [0, 1], [1, 0]]);
});

test('agreement: blocking-finding agreement is (hits + verified real) over (findings + missed defects) and is published with its denominator; triage agreement likewise', async () => {
  const set: ReplaySet = { name: 's', curatedBy: 'm', cases: [review('p1'), review('p2'), triage('i1'), triage('i2', 'feature')] };
  const rep = await runReplay(set, o(model({ 'PR p1': [F('a', 12), F('x', 43)], 'PR p2': [] })));
  // p1: 1 hit + 1 false finding; p2: 1 missed defect => numerator 1, denominator 2 findings + 1 miss = 3
  assert.deepEqual(rep.metrics.blockingAgreement, { num: 1, den: 3 }); assert.equal(rep.metrics.blockingFindingsAssessed, 2);
  assert.deepEqual(rep.metrics.triageAgreement, { num: 1, den: 2 });
});

test('critical cases: every case flagged critical must be detected, and the report names the misses', async () => {
  const set: ReplaySet = { name: 's', curatedBy: 'm', cases: [review('p1', { critical: true }), review('p2', { critical: true }), triage('i1', 'bug', { critical: true })] };
  const rep = await runReplay(set, o(model({ 'PR p1': [F('a', 12)], 'PR p2': [] })));
  assert.deepEqual(rep.metrics.criticalDetected, { num: 2, den: 3, missed: ['p2'] });
  assert.ok(rep.qualification.reasons.some((x) => /critical case\(s\) missed: p2/.test(x)));
});

function bigSet(nDefects: number, nIssues: number): ReplaySet { return { name: 'real', curatedBy: 'maint', cases: [...Array.from({ length: Math.max(20, nDefects) }, (_, i) => review('p' + i, i < nDefects ? {} : { expect: { clean: true } })), ...Array.from({ length: nIssues }, (_, i) => triage('i' + i))] }; }
const perfect = (n: number) => model(Object.fromEntries(Array.from({ length: n }, (_, i) => ['PR p' + i, [F('a', 12)]])));

test('the bar: 90% agreement on blocking findings and on triage, at least 10 blocking findings assessed; a set that meets it qualifies and the thresholds are the PRD section 11 ones', async () => {
  assert.deepEqual([DEFAULT_THRESHOLDS.minBlockingAgreement, DEFAULT_THRESHOLDS.minTriageAgreement, DEFAULT_THRESHOLDS.minBlockingFindings, DEFAULT_THRESHOLDS.minPrs, DEFAULT_THRESHOLDS.minIssues], [0.9, 0.9, 10, 20, 20]);
  const ok = await runReplay(bigSet(12, 20), o(perfect(12))); assert.equal(ok.qualification.qualified, true, ok.qualification.reasons.join('; '));
  const thin = await runReplay(bigSet(9, 20), o(perfect(9))); assert.ok(thin.qualification.reasons.some((x) => /only 9 blocking finding/.test(x)));
  const noisy = await runReplay(bigSet(12, 20), o(model(Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['PR p' + i, [F('a', 12), F('x', 43), F('y', 44)]]))))); assert.ok(noisy.qualification.reasons.some((x) => /blocking-finding agreement 33% is below 90%/.test(x)));
  const none = await runReplay({ name: 'n', curatedBy: 'm', cases: Array.from({ length: 20 }, (_, i) => review('c' + i, { expect: { clean: true } })).concat(Array.from({ length: 20 }, () => 0).map((_, i) => triage('t' + i) as never)) as never }, o(model({})));
  assert.ok(none.qualification.reasons.some((x) => /no blocking findings were assessed/.test(x)), 'no data can never pass');
});
