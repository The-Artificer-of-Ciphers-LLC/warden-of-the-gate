import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWorld } from '../github/fake.ts';
import { sameHunk } from '../review/findings.ts';
import { runReview } from '../review/slice.ts';
import type { ReviewRecord } from '../review/slice.ts';
import { runTriage } from '../triage/slice.ts';
import type { TriageRecord } from '../triage/slice.ts';
import type { AgentRunner, Budgets } from '../runner/agent-runner.ts';
import { lookupProvider } from '../lookup/provider.ts';
import type { ContextSummary } from '../review/context.ts';

/** P7 replay and qualification framework. A maintainer-curated set of historical PRs and issues, each with a known-good expectation, is replayed against the
 *  configured local model in a SIMULATED repository (nothing touches GitHub). The result is a measured report and a qualification VERDICT only: this module can
 *  never turn anything on, a synthetic set can never qualify, and activation is a separate, explicit owner step that does not exist here. */
export interface PullFileCase { path: string; status: string; patch: string }
/** `head`/`base`: the pull request's commits. `base` serves the optional read-only repository snapshot (`contextFor`); `head` serves the context pack (`lookupClone`). */
export interface ReviewCase { id: string; kind: 'review'; title: string; /** A case the maintainer marked critical: the replay must detect it (PRD section 11). */ critical?: boolean; head?: string; base?: string; files: PullFileCase[]; expect: ({ clean: true } | { mustFind: Array<{ path: string; lineMin: number; lineMax: number }> }) & { /** Findings OUTSIDE mustFind that evidence (not the model) showed to be true. They are reported as `realExtras`, not false positives. A finding without such a verdict stays a false positive. */ verifiedReal?: Array<{ path: string; lineMin: number; lineMax: number }> } }
export interface TriageCase { id: string; kind: 'triage'; title: string; critical?: boolean; body: string; expect: { kind: string | string[]; outcome: string | string[] } }
export interface ReplaySet { name: string; curatedBy: string; synthetic?: boolean; cases: Array<ReviewCase | TriageCase> }
/** PRD section 11 (owner ruling 2026-11-27): 90% maintainer agreement separately on blocking findings and on triage outcomes, each with its denominator; at least 10 blocking findings assessed; every curated critical case detected. */
export interface Thresholds { minPrs: number; minIssues: number; minBlockingAgreement: number; minTriageAgreement: number; minBlockingFindings: number; minAcceptedRate: number }
export const DEFAULT_THRESHOLDS: Thresholds = { minPrs: 20, minIssues: 20, minBlockingAgreement: 0.9, minTriageAgreement: 0.9, minBlockingFindings: 10, minAcceptedRate: 0.9 };

export interface CaseResult { id: string; kind: 'review' | 'triage'; outcome: string; context?: ContextSummary; hits?: number; expected?: number; findings?: number; falsePositives?: number; /** Findings outside mustFind that a verified-real entry covers (not counted as false positives). */ realExtras?: number; /** The review's findings as returned, each marked with whether it matched an expected one. */ items?: Array<Record<string, unknown> & { matched: boolean }>; matched?: boolean; reason?: string; got?: { kind: string; outcome: string }; /** Measured wall time of the case in ms. */ wallMs?: number }
export interface ReplayReport { set: string; curatedBy: string; synthetic: boolean; cases: number; prs: number; issues: number; results: CaseResult[];
  metrics: { acceptedRate: number; recall: number | null; falsePositiveRate: number | null; triageAccuracy: number | null;
    /** PRD section 11 gate numbers, each with its denominator. Blocking agreement = (hits + verified real extras) / (findings made + known defects missed); null when nothing was assessed. */
    blockingAgreement: { num: number; den: number } | null; triageAgreement: { num: number; den: number } | null; blockingFindingsAssessed: number; criticalDetected: { num: number; den: number; missed: string[] } };
  qualification: { qualified: boolean; reasons: string[]; thresholds: Thresholds }; activation: 'not performed: a separate, explicit owner step' }

/** A maintainer label can allow several correct answers: an expectation is one value or a non-empty list of acceptable values. */
const oneOf = (want: string | string[], got: string) => (Array.isArray(want) ? want.includes(got) : want === got);
const present = (v: unknown) => (Array.isArray(v) ? v.length > 0 && v.every((x) => typeof x === 'string' && x) : typeof v === 'string' && !!v);
export function validateSet(s: unknown): string | null {
  const x = s as ReplaySet; if (!x || typeof x !== 'object' || !Array.isArray(x.cases) || typeof x.name !== 'string' || !x.name) return 'a replay set needs a name and a cases array';
  const ids = new Set<string>();
  for (const c of x.cases) { if (!c?.id || ids.has(c.id)) return `case id missing or duplicated: ${c?.id}`; ids.add(c.id);
    if (c.kind === 'review') { if (!c.files?.length || !c.expect) return `review case ${c.id} needs files and an expectation`; if ('mustFind' in c.expect && !c.expect.mustFind.length) return `review case ${c.id}: mustFind is empty (use {clean:true})`; }
    else if (c.kind === 'triage') { if (!present(c.expect?.kind) || !present(c.expect?.outcome)) return `triage case ${c.id} needs expect.kind and expect.outcome`; } else return `unknown case kind in ${(c as { id: string }).id}`; }
  return null;
}

/** `lookupClone`: a local clone of the source repository holding every case's head commit. With it, each review gets the repository context pack built from
 *  that head; without it, reviews run on the patch alone, as before. */
export interface ReplayOpts { lookupClone?: string; maxContextChars?: number; maxPromptChars?: number; onCase?: (r: CaseResult, done: number, total: number) => void; runner: AgentRunner; /** Writes the repository at `base` into `dest` (read-only context for the reviewer). */ contextFor?: (base: string, dest: string) => void; localModels: string[]; budgets: Budgets; thresholds?: Partial<Thresholds>; stopped?: () => boolean | Promise<boolean>; signal?: AbortSignal }
export async function runReplay(set: ReplaySet, o: ReplayOpts): Promise<ReplayReport> {
  const bad = validateSet(set); if (bad) throw new Error(bad);
  const th = { ...DEFAULT_THRESHOLDS, ...o.thresholds }; const dir = mkdtempSync(join(tmpdir(), 'warden-replay-')); const results: CaseResult[] = [];
  try {
    for (const c of set.cases) {
      const t0 = Date.now();
      if (await o.stopped?.() || o.signal?.aborted) { results.push({ id: c.id, kind: c.kind, outcome: 'not-run: stopped' }); continue; }
      const world = new FakeWorld(); world.clock = Date.parse('2026-01-01T00:00:00Z'); const store = world.view('operator');
      const cfg = { maxAttempts: 1, budgets: o.budgets, localModels: o.localModels, expectedModel: o.localModels[0], packetRoot: join(dir, c.id) };   // one packet root PER CASE: every simulated case is item 1 at the same fake head, so a shared root would let a case read the previous case's repo snapshot and patches
      if (c.kind === 'review') {
        const n = world.addIssue({ isPr: true, title: c.title, author: 'contributor' }); world.issues.get(n)!.pull = { head: c.head ?? 'a'.repeat(40), base: c.base ?? 'b'.repeat(40), ci: 'passing', files: c.files.map((f) => ({ ...f })) };
        const rcfg = o.lookupClone ? { ...cfg, context: lookupProvider(o.lookupClone, { root: dir }), maxContextChars: o.maxContextChars, maxPromptChars: o.maxPromptChars } : cfg;
        let rec: ReviewRecord | null = null; const r = await runReview({ store, item: n, runner: o.runner, cfg: rcfg, kv: { read: () => rec, write: (_i, x) => { rec = JSON.parse(JSON.stringify(x)); } }, stopped: () => o.stopped?.() ?? false, signal: o.signal, clock: Date.now, ...(o.contextFor && c.base ? { context: (d: string) => o.contextFor!(c.base!, d) } : {}) });
        const findings = r.marker?.findings ?? []; const must = 'mustFind' in c.expect ? c.expect.mustFind : [];
        // A finding matches a known defect by SAME FILE and SAME CHANGED HUNK (owner ruling 2026-11-27), or by the curated lines themselves.
        const hit = (m: { path: string; lineMin: number; lineMax: number }, f: { path: string; line: number }) => f.path === m.path && ((f.line >= m.lineMin && f.line <= m.lineMax) || sameHunk(c.files.find((x) => x.path === m.path)?.patch, m.lineMin, f.line));
        const hits = must.filter((m) => findings.some((f) => hit(m, f))).length;
        const inR = (rs: Array<{ path: string; lineMin: number; lineMax: number }>, f: { path: string; line: number }) => rs.some((m) => hit(m, f)); const vr = c.expect.verifiedReal ?? [];
        const realExtras = findings.filter((f) => !inR(must, f) && inR(vr, f)).length; const fp = findings.filter((f) => !inR(must, f) && !inR(vr, f)).length;
        results.push({ id: c.id, kind: 'review', outcome: r.kind, hits, expected: must.length, findings: findings.length, falsePositives: fp, ...(realExtras ? { realExtras } : {}), items: findings.map((f) => ({ ...(f as object), matched: inR(must, f) })), ...(r.context ? { context: r.context } : {}), ...(r.reason ? { reason: r.reason } : {}) }); o.onCase?.(results[results.length - 1], results.length, set.cases.length);
      } else {
        const n = world.addIssue({ title: c.title, body: c.body, author: 'reporter' }); let rec: TriageRecord | null = null;
        const r = await runTriage({ store, item: n, runner: o.runner, cfg, kv: { read: () => rec, write: (_i, x) => { rec = JSON.parse(JSON.stringify(x)); } }, stopped: () => o.stopped?.() ?? false, signal: o.signal, clock: Date.now });
        const out = r.marker?.output; results.push({ id: c.id, kind: 'triage', outcome: r.kind, matched: !!out && oneOf(c.expect.kind, out.kind) && oneOf(c.expect.outcome, out.outcome), ...(r.reason ? { reason: r.reason } : {}), ...(out ? { got: { kind: String(out.kind), outcome: String(out.outcome) } } : {}) }); o.onCase?.(results[results.length - 1], results.length, set.cases.length);
      }
      results[results.length - 1]!.wallMs = Date.now() - t0;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const rv = results.filter((x) => x.kind === 'review'); const tr = results.filter((x) => x.kind === 'triage'); const ran = results.filter((x) => !x.outcome.startsWith('not-run'));
  const sum = (a: CaseResult[], k: 'hits' | 'expected' | 'findings' | 'falsePositives') => a.reduce((t, x) => t + (x[k] ?? 0), 0);
  const metrics = { acceptedRate: results.length ? ran.filter((x) => x.outcome === 'accepted').length / results.length : 0, recall: sum(rv, 'expected') ? sum(rv, 'hits') / sum(rv, 'expected') : null,
    falsePositiveRate: sum(rv, 'findings') ? sum(rv, 'falsePositives') / sum(rv, 'findings') : null, triageAccuracy: tr.length ? tr.filter((x) => x.matched).length / tr.length : null,
    ...gateNumbers(set, results) };
  const prs = set.cases.filter((c) => c.kind === 'review').length; const issues = set.cases.filter((c) => c.kind === 'triage').length; const reasons: string[] = [];
  if (set.synthetic) reasons.push('the set is synthetic: a synthetic set can never qualify a model');
  if (!set.curatedBy?.trim()) reasons.push('the set has no named maintainer curator');
  if (prs < th.minPrs) reasons.push(`only ${prs} PR case(s); at least ${th.minPrs} are required`); if (issues < th.minIssues) reasons.push(`only ${issues} issue case(s); at least ${th.minIssues} are required`);
  if (results.some((x) => x.outcome.startsWith('not-run'))) reasons.push('the replay was stopped before every case ran');
  if (metrics.acceptedRate < th.minAcceptedRate) reasons.push(`accepted rate ${pct(metrics.acceptedRate)} is below ${pct(th.minAcceptedRate)}`);
  if (metrics.blockingFindingsAssessed === 0) reasons.push('no blocking findings were assessed: a set with no data can never pass');
  else if (metrics.blockingFindingsAssessed < th.minBlockingFindings) reasons.push(`only ${metrics.blockingFindingsAssessed} blocking finding(s) assessed; at least ${th.minBlockingFindings} are required`);
  const ba = metrics.blockingAgreement; if (ba && ba.num / ba.den < th.minBlockingAgreement) reasons.push(`blocking-finding agreement ${pct(ba.num / ba.den)} is below ${pct(th.minBlockingAgreement)} (${ba.num} of ${ba.den})`);
  const ta = metrics.triageAgreement; if (ta && ta.num / ta.den < th.minTriageAgreement) reasons.push(`triage agreement ${pct(ta.num / ta.den)} is below ${pct(th.minTriageAgreement)} (${ta.num} of ${ta.den})`);
  if (metrics.criticalDetected.missed.length) reasons.push(`critical case(s) missed: ${metrics.criticalDetected.missed.join(', ')}`);
  return { set: set.name, curatedBy: set.curatedBy, synthetic: !!set.synthetic, cases: set.cases.length, prs, issues, results, metrics, qualification: { qualified: reasons.length === 0, reasons, thresholds: th }, activation: 'not performed: a separate, explicit owner step' };
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The PRD section 11 gate numbers. Blocking agreement counts every finding the reviewer made (agreed when it matches a known defect or has verified evidence) plus every known defect it missed; a defect
 *  in a review that was not accepted is a miss. Triage agreement counts every triage case that ran. A critical case counts as detected only when all its expected findings (review) or its label (triage) were met. */
function gateNumbers(set: ReplaySet, results: CaseResult[]) {
  const rv = results.filter((x) => x.kind === 'review'); const tr = results.filter((x) => x.kind === 'triage' && !x.outcome.startsWith('not-run'));
  const findings = rv.reduce((t, x) => t + (x.findings ?? 0), 0); const fps = rv.reduce((t, x) => t + (x.falsePositives ?? 0), 0);
  const misses = rv.reduce((t, x) => t + Math.max(0, (x.expected ?? 0) - (x.hits ?? 0)), 0);
  const den = findings + misses; const crit = set.cases.filter((c) => c.critical); const byId = new Map(results.map((r) => [r.id, r]));
  const detected = (id: string) => { const r = byId.get(id); return !!r && (r.kind === 'triage' ? !!r.matched : r.outcome === 'accepted' && (r.expected ?? 0) > 0 && r.hits === r.expected); };
  const missed = crit.filter((c) => !detected(c.id)).map((c) => c.id);
  return { blockingAgreement: den ? { num: findings - fps, den } : null, triageAgreement: tr.length ? { num: tr.filter((x) => x.matched).length, den: tr.length } : null,
    blockingFindingsAssessed: rv.reduce((t, x) => t + (x.expected ?? 0), 0), criticalDetected: { num: crit.length - missed.length, den: crit.length, missed } };
}
