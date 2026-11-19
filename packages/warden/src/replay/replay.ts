import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWorld } from '../github/fake.ts';
import { runReview } from '../review/slice.ts';
import type { ReviewRecord } from '../review/slice.ts';
import { runTriage } from '../triage/slice.ts';
import type { TriageRecord } from '../triage/slice.ts';
import type { AgentRunner, Budgets } from '../runner/agent-runner.ts';

/** P7 replay and qualification framework. A maintainer-curated set of historical PRs and issues, each with a known-good expectation, is replayed against the
 *  configured local model in a SIMULATED repository (nothing touches GitHub). The result is a measured report and a qualification VERDICT only: this module can
 *  never turn anything on, a synthetic set can never qualify, and activation is a separate, explicit owner step that does not exist here. */
export interface PullFileCase { path: string; status: string; patch: string }
export interface ReviewCase { id: string; kind: 'review'; title: string; files: PullFileCase[]; expect: { clean: true } | { mustFind: Array<{ path: string; lineMin: number; lineMax: number }> } }
export interface TriageCase { id: string; kind: 'triage'; title: string; body: string; expect: { kind: string; outcome: string } }
export interface ReplaySet { name: string; curatedBy: string; synthetic?: boolean; cases: Array<ReviewCase | TriageCase> }
export interface Thresholds { minPrs: number; minIssues: number; minRecall: number; maxFalsePositiveRate: number; minAcceptedRate: number; minTriageAccuracy: number }
export const DEFAULT_THRESHOLDS: Thresholds = { minPrs: 20, minIssues: 20, minRecall: 0.7, maxFalsePositiveRate: 0.3, minAcceptedRate: 0.9, minTriageAccuracy: 0.7 };

export interface CaseResult { id: string; kind: 'review' | 'triage'; outcome: string; hits?: number; expected?: number; findings?: number; falsePositives?: number; matched?: boolean }
export interface ReplayReport { set: string; curatedBy: string; synthetic: boolean; cases: number; prs: number; issues: number; results: CaseResult[];
  metrics: { acceptedRate: number; recall: number | null; falsePositiveRate: number | null; triageAccuracy: number | null };
  qualification: { qualified: boolean; reasons: string[]; thresholds: Thresholds }; activation: 'not performed: a separate, explicit owner step' }

export function validateSet(s: unknown): string | null {
  const x = s as ReplaySet; if (!x || typeof x !== 'object' || !Array.isArray(x.cases) || typeof x.name !== 'string' || !x.name) return 'a replay set needs a name and a cases array';
  const ids = new Set<string>();
  for (const c of x.cases) { if (!c?.id || ids.has(c.id)) return `case id missing or duplicated: ${c?.id}`; ids.add(c.id);
    if (c.kind === 'review') { if (!c.files?.length || !c.expect) return `review case ${c.id} needs files and an expectation`; if ('mustFind' in c.expect && !c.expect.mustFind.length) return `review case ${c.id}: mustFind is empty (use {clean:true})`; }
    else if (c.kind === 'triage') { if (!c.expect?.kind || !c.expect?.outcome) return `triage case ${c.id} needs expect.kind and expect.outcome`; } else return `unknown case kind in ${(c as { id: string }).id}`; }
  return null;
}

export interface ReplayOpts { runner: AgentRunner; localModels: string[]; budgets: Budgets; thresholds?: Partial<Thresholds>; stopped?: () => boolean | Promise<boolean>; signal?: AbortSignal }
export async function runReplay(set: ReplaySet, o: ReplayOpts): Promise<ReplayReport> {
  const bad = validateSet(set); if (bad) throw new Error(bad);
  const th = { ...DEFAULT_THRESHOLDS, ...o.thresholds }; const dir = mkdtempSync(join(tmpdir(), 'warden-replay-')); const results: CaseResult[] = [];
  try {
    for (const c of set.cases) {
      if (await o.stopped?.() || o.signal?.aborted) { results.push({ id: c.id, kind: c.kind, outcome: 'not-run: stopped' }); continue; }
      const world = new FakeWorld(); world.clock = Date.parse('2026-01-01T00:00:00Z'); const store = world.view('operator');
      const cfg = { maxAttempts: 1, budgets: o.budgets, localModels: o.localModels, expectedModel: o.localModels[0], packetRoot: dir };
      if (c.kind === 'review') {
        const n = world.addIssue({ isPr: true, title: c.title, author: 'contributor' }); world.issues.get(n)!.pull = { head: 'a'.repeat(40), base: 'b'.repeat(40), ci: 'passing', files: c.files.map((f) => ({ ...f })) };
        let rec: ReviewRecord | null = null; const r = await runReview({ store, item: n, runner: o.runner, cfg, kv: { read: () => rec, write: (_i, x) => { rec = JSON.parse(JSON.stringify(x)); } }, stopped: () => o.stopped?.() ?? false, signal: o.signal, clock: () => world.now() });
        const findings = r.marker?.findings ?? []; const must = 'mustFind' in c.expect ? c.expect.mustFind : [];
        const hits = must.filter((m) => findings.some((f) => f.path === m.path && f.line >= m.lineMin && f.line <= m.lineMax)).length;
        const fp = findings.filter((f) => !must.some((m) => f.path === m.path && f.line >= m.lineMin && f.line <= m.lineMax)).length;
        results.push({ id: c.id, kind: 'review', outcome: r.kind, hits, expected: must.length, findings: findings.length, falsePositives: fp });
      } else {
        const n = world.addIssue({ title: c.title, body: c.body, author: 'reporter' }); let rec: TriageRecord | null = null;
        const r = await runTriage({ store, item: n, runner: o.runner, cfg, kv: { read: () => rec, write: (_i, x) => { rec = JSON.parse(JSON.stringify(x)); } }, stopped: () => o.stopped?.() ?? false, signal: o.signal, clock: () => world.now() });
        const out = r.marker?.output; results.push({ id: c.id, kind: 'triage', outcome: r.kind, matched: !!out && out.kind === c.expect.kind && out.outcome === c.expect.outcome });
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const rv = results.filter((x) => x.kind === 'review'); const tr = results.filter((x) => x.kind === 'triage'); const ran = results.filter((x) => !x.outcome.startsWith('not-run'));
  const sum = (a: CaseResult[], k: 'hits' | 'expected' | 'findings' | 'falsePositives') => a.reduce((t, x) => t + (x[k] ?? 0), 0);
  const metrics = { acceptedRate: results.length ? ran.filter((x) => x.outcome === 'accepted').length / results.length : 0, recall: sum(rv, 'expected') ? sum(rv, 'hits') / sum(rv, 'expected') : null,
    falsePositiveRate: sum(rv, 'findings') ? sum(rv, 'falsePositives') / sum(rv, 'findings') : null, triageAccuracy: tr.length ? tr.filter((x) => x.matched).length / tr.length : null };
  const prs = set.cases.filter((c) => c.kind === 'review').length; const issues = set.cases.filter((c) => c.kind === 'triage').length; const reasons: string[] = [];
  if (set.synthetic) reasons.push('the set is synthetic: a synthetic set can never qualify a model');
  if (!set.curatedBy?.trim()) reasons.push('the set has no named maintainer curator');
  if (prs < th.minPrs) reasons.push(`only ${prs} PR case(s); at least ${th.minPrs} are required`); if (issues < th.minIssues) reasons.push(`only ${issues} issue case(s); at least ${th.minIssues} are required`);
  if (results.some((x) => x.outcome.startsWith('not-run'))) reasons.push('the replay was stopped before every case ran');
  if (metrics.acceptedRate < th.minAcceptedRate) reasons.push(`accepted rate ${pct(metrics.acceptedRate)} is below ${pct(th.minAcceptedRate)}`);
  if (metrics.recall !== null && metrics.recall < th.minRecall) reasons.push(`recall ${pct(metrics.recall)} is below ${pct(th.minRecall)}`);
  if (metrics.falsePositiveRate !== null && metrics.falsePositiveRate > th.maxFalsePositiveRate) reasons.push(`false-positive rate ${pct(metrics.falsePositiveRate)} is above ${pct(th.maxFalsePositiveRate)}`);
  if (metrics.triageAccuracy !== null && metrics.triageAccuracy < th.minTriageAccuracy) reasons.push(`triage accuracy ${pct(metrics.triageAccuracy)} is below ${pct(th.minTriageAccuracy)}`);
  return { set: set.name, curatedBy: set.curatedBy, synthetic: !!set.synthetic, cases: set.cases.length, prs, issues, results, metrics, qualification: { qualified: reasons.length === 0, reasons, thresholds: th }, activation: 'not performed: a separate, explicit owner step' };
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
