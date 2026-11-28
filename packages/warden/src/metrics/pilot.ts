import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplayReport } from '../replay/replay.ts';

/** What `warden status` shows of PRD section 10/11 (owner ruling 2026-11-27): the pilot gate, the must-be-zero counters and the measured budgets. Everything here is read from data Warden
 *  already holds (the newest replay report, the inbox, the ledgers); a figure with no source is reported as "not measured", never estimated. The rest of the section 11 tracking list lives in `warden metrics`. */
export interface Ratio { num: number; den: number }
export interface PilotGate { reportFile: string; set: string; synthetic: boolean; curatedBy: string; model: string | null; harnessVersion: string | null; prs: number; issues: number;
  blockingAgreement: Ratio | null; triageAgreement: Ratio | null; blockingFindingsAssessed: number; criticalDetected: Ratio & { missed: string[] };
  qualified: boolean; reasons: string[]; thresholds: { minPrs: number; minIssues: number; minBlockingAgreement: number; minTriageAgreement: number; minBlockingFindings: number } }
export interface TaskBudget { n: number; medianMs: number; p95Ms: number; maxMs: number }
export interface Budgets { source: string | null; model: string | null; tasks: Record<'review' | 'triage', TaskBudget | null>; tokens: 'not measured'; memory: 'not measured'; note: string }
export type StoredReport = ReplayReport & { model?: string; harnessVersion?: string };

/** The newest `report-*.json` in the instance's replay directory (the timestamp in the file name sorts), or null. */
export function latestReplayFile(dir: string): string | null {
  if (!existsSync(dir)) return null; const f = readdirSync(dir).filter((x) => /^report-.*\.json$/.test(x)).sort(); return f.length ? join(dir, f[f.length - 1]) : null;
}
export function pilotGateOf(rep: StoredReport, reportFile: string): PilotGate {
  const m = rep.metrics; const t = rep.qualification.thresholds;
  return { reportFile, set: rep.set, synthetic: rep.synthetic, curatedBy: rep.curatedBy, model: rep.model ?? null, harnessVersion: rep.harnessVersion ?? null, prs: rep.prs, issues: rep.issues,
    blockingAgreement: m.blockingAgreement ?? null, triageAgreement: m.triageAgreement ?? null, blockingFindingsAssessed: m.blockingFindingsAssessed ?? 0, criticalDetected: m.criticalDetected ?? { num: 0, den: 0, missed: [] },
    qualified: rep.qualification.qualified, reasons: rep.qualification.reasons, thresholds: { minPrs: t.minPrs, minIssues: t.minIssues, minBlockingAgreement: t.minBlockingAgreement, minTriageAgreement: t.minTriageAgreement, minBlockingFindings: t.minBlockingFindings } };
}
const pct = (r: Ratio | null) => (r ? `${r.num}/${r.den} (${Math.round((r.num / r.den) * 1000) / 10}%)` : 'none assessed');
export function pilotGateLines(g: PilotGate | null): string[] {
  if (!g) return ['pilot gate: no replay report recorded yet (run `warden replay`); the gate is not met'];
  const th = g.thresholds;
  return [`pilot gate (replay "${g.set}"${g.synthetic ? ', SYNTHETIC set' : ''}, ${g.prs} PR and ${g.issues} issue case(s); needs ${th.minPrs} and ${th.minIssues}; model ${g.model ?? 'not recorded'}): ${g.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'}`,
    `  blocking-finding agreement ${pct(g.blockingAgreement)} (bar ${th.minBlockingAgreement * 100}%); triage agreement ${pct(g.triageAgreement)} (bar ${th.minTriageAgreement * 100}%)`,
    `  blocking findings assessed ${g.blockingFindingsAssessed} (bar ${th.minBlockingFindings}); critical cases detected ${g.criticalDetected.num}/${g.criticalDetected.den}${g.criticalDetected.missed.length ? ` (missed: ${g.criticalDetected.missed.join(', ')})` : ''}`,
    ...(g.qualified ? [] : g.reasons.map((r) => `  - ${r}`))];
}

const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
/** Wall time per task kind from the cases the replay measured. Tokens and memory have no source in a session result, so they are not measured, and saying so is the point. */
export function budgetsOf(rep: StoredReport | null, reportFile = ''): Budgets {
  const task = (kind: 'review' | 'triage'): TaskBudget | null => { const w = (rep?.results ?? []).filter((x) => x.kind === kind && typeof x.wallMs === 'number' && !x.outcome.startsWith('not-run')).map((x) => x.wallMs as number); return w.length ? { n: w.length, medianMs: quantile(w, 0.5), p95Ms: quantile(w, 0.95), maxMs: Math.max(...w) } : null; };
  return { source: rep ? reportFile : null, model: rep?.model ?? null, tasks: { review: task('review'), triage: task('triage') }, tokens: 'not measured', memory: 'not measured',
    note: 'wall time is measured per case in the last replay; the runner reports tool calls, model turns and wall time only, so tokens and memory are not measured' };
}
export function budgetLines(b: Budgets): string[] {
  const t = (k: 'review' | 'triage') => { const x = b.tasks[k]; return x ? `${k} n=${x.n} median ${Math.round(x.medianMs / 100) / 10}s p95 ${Math.round(x.p95Ms / 100) / 10}s max ${Math.round(x.maxMs / 100) / 10}s` : `${k} not measured`; };
  return [`measured budgets (model ${b.model ?? 'not recorded'}, from ${b.source ? 'the last replay' : 'no replay'}): ${t('review')}; ${t('triage')}; tokens ${b.tokens}; memory ${b.memory}`];
}

export interface MustBeZero { observed: true; unauthorizedEffects: { pausedScopes: number; quarantinedIntents: number }; duplicateAcceptedReviews: number; lostStateRecoveryFailures: { invalidLedgers: number }; scope: string }
export type MustBeZeroOrUnknown = MustBeZero | { observed: false; reason: string };
export const MUST_BE_ZERO_SCOPE = 'counted from the open items and the inbox as readable now; a scope closed earlier or an inbox trimmed earlier is not seen';
export function mustBeZeroLines(m: MustBeZeroOrUnknown): string[] {
  if (!m.observed) return [`must-be-zero counters: UNKNOWN (${m.reason})`];
  const nonzero = m.unauthorizedEffects.pausedScopes + m.unauthorizedEffects.quarantinedIntents + m.duplicateAcceptedReviews + m.lostStateRecoveryFailures.invalidLedgers > 0;
  return [`must-be-zero counters${nonzero ? ' (NOT ZERO)' : ''}: unauthorized effects: ${m.unauthorizedEffects.pausedScopes} paused scope(s) after a critical escape, ${m.unauthorizedEffects.quarantinedIntents} quarantined intent(s); duplicate accepted reviews: ${m.duplicateAcceptedReviews}; lost-state recovery failures: ${m.lostStateRecoveryFailures.invalidLedgers} unreadable ledger(s) (${m.scope})`];
}
