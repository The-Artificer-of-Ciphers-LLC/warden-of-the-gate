import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliEnv } from './cli-env.ts';
import { InstanceStorage } from '../src/storage/instance.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeIntent, encodeLedger, encodeReceipt, makeIntent, LEDGER_MARK } from '../src/writer/protocol.ts';
import { budgetsOf, pilotGateLines, pilotGateOf } from '../src/metrics/pilot.ts';
import type { StoredReport } from '../src/metrics/pilot.ts';
import { reviewRecordIntent } from '../src/review/record.ts';

/** PRD section 10/11 (owner ruling 2026-11-27): `warden status` shows the pilot gate, the must-be-zero counters and the measured budgets; the rest is `warden metrics`. */
const REPORT = (over: Partial<StoredReport> = {}): StoredReport => ({ set: 'curated-1', curatedBy: 'trek-e', synthetic: false, cases: 3, prs: 2, issues: 1, model: 'beamster/Qwen3.8-Flash-Next-Sushi-2bpw', harnessVersion: '2.2.7',
  results: [{ id: 'r1', kind: 'review', outcome: 'accepted', wallMs: 10_000, hits: 1, expected: 1, findings: 1, falsePositives: 0 }, { id: 'r2', kind: 'review', outcome: 'accepted', wallMs: 30_000, hits: 0, expected: 1, findings: 2, falsePositives: 2 }, { id: 't1', kind: 'triage', outcome: 'accepted', wallMs: 4_000, matched: true }],
  metrics: { acceptedRate: 1, recall: 0.5, falsePositiveRate: 0.67, triageAccuracy: 1, blockingAgreement: { num: 1, den: 4 }, triageAgreement: { num: 1, den: 1 }, blockingFindingsAssessed: 2, criticalDetected: { num: 0, den: 1, missed: ['r2'] } },
  qualification: { qualified: false, reasons: ['too few cases', 'blocking agreement 1/4 below 90%'], thresholds: { minPrs: 20, minIssues: 20, minBlockingAgreement: 0.9, minTriageAgreement: 0.9, minBlockingFindings: 10, minAcceptedRate: 0.9 } }, activation: 'not performed: a separate, explicit owner step', ...over });

const issueOf = async (e: Awaited<ReturnType<typeof cliEnv>>, title: string, pr = false) => Number((await e.sim('sim', 'issue', '--title', title, ...(pr ? ['--pr'] : []))).out.match(/created #(\d+)/)![1]);
const commentOn = async (e: Awaited<ReturnType<typeof cliEnv>>, issue: number, body: string) => Number((await e.sim('sim', 'comment', '--issue', String(issue), '--body', body)).out.match(/comment (\d+) by/)![1]);

test('pure: the pilot gate keeps each number with its denominator and the reasons; budgets are measured per task and tokens and memory are honestly not measured', () => {
  const g = pilotGateOf(REPORT(), 'report-x.json'); const text = pilotGateLines(g).join('\n');
  assert.match(text, /NOT QUALIFIED/); assert.match(text, /blocking-finding agreement 1\/4 \(25%\) \(bar 90%\); triage agreement 1\/1 \(100%\) \(bar 90%\)/); assert.match(text, /blocking findings assessed 2 \(bar 10\); critical cases detected 0\/1 \(missed: r2\)/); assert.match(text, /too few cases/);
  assert.match(pilotGateLines(null)[0], /no replay report recorded/); assert.match(pilotGateLines(pilotGateOf(REPORT({ synthetic: true }), 'x'))[0], /SYNTHETIC/);
  const b = budgetsOf(REPORT(), 'report-x.json'); assert.deepEqual(b.tasks.review, { n: 2, medianMs: 10_000, p95Ms: 30_000, maxMs: 30_000 }); assert.deepEqual(b.tasks.triage, { n: 1, medianMs: 4_000, p95Ms: 4_000, maxMs: 4_000 }); assert.equal(b.tokens, 'not measured'); assert.equal(b.memory, 'not measured');
  assert.equal(budgetsOf(null).tasks.review, null);
});

test('status shows the pilot gate, the must-be-zero counters and the measured budgets; with nothing recorded it says so and the counters read zero', async () => {
  const e = await cliEnv(); const s = await e.json('status'); assert.equal(s.code, 0, s.out);
  assert.equal(s.data.pilotGate.state, 'no replay report recorded'); assert.equal(s.data.pilotGate.qualified, false); assert.equal(s.data.budgets.tokens, 'not measured'); assert.equal(s.data.budgets.tasks.review, null);
  assert.deepEqual(s.data.mustBeZero, { observed: true, unauthorizedEffects: { pausedScopes: 0, quarantinedIntents: 0 }, duplicateAcceptedReviews: 0, lostStateRecoveryFailures: { invalidLedgers: 0 }, scope: s.data.mustBeZero.scope });
  const t = (await e.run('status')).out; assert.match(t, /pilot gate: no replay report recorded/); assert.match(t, /must-be-zero counters: unauthorized effects: 0 paused scope\(s\)[^\n]*duplicate accepted reviews: 0; lost-state recovery failures: 0 unreadable ledger\(s\)/); assert.match(t, /measured budgets \(model not recorded, from no replay\): review not measured; triage not measured; tokens not measured; memory not measured/);
  assert.doesNotMatch(t, /recall|false-finding|accepted rate/i, 'the rest of the section 11 tracking list is not in status');
});

test('status reads the newest replay report from the instance storage; metrics holds the rest (replay detail, state counts, review provenance) and names what is not tracked', async () => {
  const e = await cliEnv(); const first = await e.json('status'); void first;
  const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false }); mkdirSync(st.path('replay'), { recursive: true });
  writeFileSync(st.path('replay', 'report-2026-11-26T10-00-00-000Z.json'), JSON.stringify(REPORT({ set: 'older' }))); writeFileSync(st.path('replay', 'report-2026-11-27T10-00-00-000Z.json'), JSON.stringify(REPORT()));
  const s = await e.json('status'); assert.equal(s.data.pilotGate.set, 'curated-1', 'the newest report'); assert.deepEqual(s.data.pilotGate.blockingAgreement, { num: 1, den: 4 }); assert.deepEqual(s.data.pilotGate.criticalDetected, { num: 0, den: 1, missed: ['r2'] }); assert.equal(s.data.budgets.model, 'beamster/Qwen3.8-Flash-Next-Sushi-2bpw'); assert.equal(s.data.budgets.tasks.review.p95Ms, 30_000);
  await issueOf(e, 'a PR', true);
  const m = await e.json('metrics'); assert.equal(m.code, 0, m.out); assert.equal(m.data.replay.set, 'curated-1'); assert.equal(m.data.replay.recall, 0.5); assert.deepEqual(m.data.replay.misses.map((x: { id: string }) => x.id), ['r2']);
  assert.ok(m.data.notTracked.some((x: string) => /tokens/.test(x))); assert.ok(m.data.remote.reachable); assert.match((await e.run('metrics')).out, /not tracked yet/);
});

test('must-be-zero counters count paused scopes, quarantined intents, unreadable ledgers and duplicate accepted reviews from what is observable', async () => {
  const e = await cliEnv();
  const n1 = await issueOf(e, 'paused item'); const paused = newLedger('acme/widgets', n1, 'issue'); paused.paused = { reason: 'escape', at: 'now', evidence: ['e'] };
  await commentOn(e, n1, encodeLedger(paused));
  const n2 = await issueOf(e, 'broken ledger'); await commentOn(e, n2, `${LEDGER_MARK}\n\`\`\`json\n{ not json\n\`\`\``);
  const pr = await issueOf(e, 'reviewed pr', true);
  const marker = { head: 'a1b2c3d4e5f6', base: 'base000000aa', verdict: 'no findings' as const, ci: 'passing' as const, policyDigest: 'd1', findings: [] };
  const intentAt = (at: string) => makeIntent(reviewRecordIntent({ repo: 'acme/widgets', item: pr, marker: { ...marker, acceptedAt: at } }));
  const a = intentAt('2026-11-27T10:00:00.000Z'); const b = intentAt('2026-11-27T11:00:00.000Z'); assert.notEqual(a.opid, b.opid); assert.equal(a.source.id, b.source.id);
  for (const i of [a, b]) { const id = await commentOn(e, 1, encodeIntent(i)); await commentOn(e, 1, encodeReceipt({ intentCommentId: id, opid: i.opid, item: pr, result: 'applied', epoch: 1, seq: 1, by: 'x' })); }
  const q = makeIntent({ ...a, source: { ...a.source, id: 'other' }, payload: {} }); const qid = await commentOn(e, 1, encodeIntent(q)); await commentOn(e, 1, encodeReceipt({ intentCommentId: qid, opid: q.opid, item: pr, result: 'quarantined', epoch: 1, seq: 1, by: 'x' }));
  const s = await e.json('status'); const z = s.data.mustBeZero;
  assert.equal(z.unauthorizedEffects.pausedScopes, 1, JSON.stringify(z)); assert.equal(z.unauthorizedEffects.quarantinedIntents, 1); assert.equal(z.lostStateRecoveryFailures.invalidLedgers, 1); assert.equal(z.duplicateAcceptedReviews, 1);
  assert.match((await e.run('status')).out, /must-be-zero counters \(NOT ZERO\)/);
});
