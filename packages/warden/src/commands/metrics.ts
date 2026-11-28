import { readFileSync } from 'node:fs';
import { loadConfigs, openBackend, openStorage } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { latestReplayFile } from '../metrics/pilot.ts';
import type { StoredReport } from '../metrics/pilot.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { Ledger } from '../state/model.ts';
import { redact } from '../util.ts';

/** PRD section 11 (owner ruling 2026-11-27): the on-demand metrics report. `warden status` shows only the pilot gate, the must-be-zero counters and the measured budgets; everything else of the
 *  tracking list is here. Only what Warden actually records is reported; the rest is listed as not tracked, never filled with an estimate. */
export const NOT_TRACKED = ['assignment-to-ready, active execution, review wait, CI wait and fix time separately', 'claim, takeover and extension outcomes', 'auto-merge and human-escalation rates', 'maintainer effort and maintainer decisions per completed item',
  'escapes, reverts and escaped defects after merge', 'duplicate review attempts versus accepted duplicates', 'operation recovery', 'local tokens and resource usage (no source in a session result)', 'code-lookup quality and overhead',
  'time to first response and distinct returning contributors', 'mutation score and survivors, frozen-test violations and test-dispute outcomes, verify-and-continue turns per attempt, holdout results (the loop and frozen tests are built; their counts are not persisted)', 'boundary-change escalations', 'how often review ran on the same model family as the writer'];
const days = (ms: number) => Math.round((ms / 86_400_000) * 10) / 10;

export async function metrics(c: Ctx): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'metrics: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const now = c.now(); let st; try { st = openStorage(c, cfg.repository); } catch (e) { return { code: 1, data: { error: String(e) }, text: `metrics: ${(e as Error).message}` }; }
  const out: Record<string, unknown> = { repository: cfg.repository, at: new Date(now).toISOString() }; const lines = [`warden metrics for ${cfg.repository} (${out.at})`];
  const file = latestReplayFile(st.path('replay')); let rep: StoredReport | null = null; if (file) { try { rep = JSON.parse(readFileSync(file, 'utf8')) as StoredReport; } catch { rep = null; } }
  if (rep) {
    const m = rep.metrics; const misses = rep.results.filter((r) => (r.kind === 'review' && ((r.expected ?? 0) > (r.hits ?? 0) || (r.falsePositives ?? 0) > 0 || r.outcome !== 'accepted')) || (r.kind === 'triage' && !r.matched)).map((r) => ({ id: r.id, kind: r.kind, outcome: r.outcome, ...(r.reason ? { reason: r.reason } : {}) }));
    out.replay = { file, set: rep.set, model: rep.model ?? null, acceptedRate: m.acceptedRate, recall: m.recall, falsePositiveRate: m.falsePositiveRate, triageAccuracy: m.triageAccuracy, misses };
    lines.push(`replay "${rep.set}" (model ${rep.model ?? 'not recorded'}): accepted ${Math.round(m.acceptedRate * 100)}%; recall ${m.recall === null ? 'n/a' : Math.round(m.recall * 100) + '%'}; false-finding rate ${m.falsePositiveRate === null ? 'n/a' : Math.round(m.falsePositiveRate * 100) + '%'}; triage accuracy ${m.triageAccuracy === null ? 'n/a' : Math.round(m.triageAccuracy * 100) + '%'}`, `  misses and disagreements: ${misses.length ? misses.map((x) => `${x.id} (${x.outcome})`).join(', ') : 'none'}`);
  } else { out.replay = null; lines.push('replay: no report recorded yet'); }
  const be = openBackend(c, cfg); const store = be.open('operator');
  if (!store) { out.remote = { reachable: false, reason: be.unavailable }; lines.push(`remote: unreachable (${be.unavailable}); state counts and review provenance are unknown`); }
  else try {
    const states: Record<string, { n: number; oldestDays: number }> = {}; const byModel: Record<string, number> = {}; let reviewed = 0; let unrecorded = 0;
    for (const it of await store.listIssues({ state: 'open' })) {
      if ([cfg.inbox.inboxIssue, cfg.inbox.controlIssue].includes(it.number)) continue;
      const lc = (await store.listComments(it.number)).find((x) => x.body.startsWith(LEDGER_MARK)); const l = lc ? (parseLedger(lc.body) as Ledger | null) : null; if (!l) continue;
      const key = `${l.kind}:${l.state}`; const age = days(now - Date.parse(it.createdAt ?? new Date(now).toISOString())); const s = states[key] ?? { n: 0, oldestDays: 0 }; s.n++; s.oldestDays = Math.max(s.oldestDays, age); states[key] = s;
      if (l.review) { reviewed++; const p = l.review.provenance; if (p) { const k = `${p.model} @ ${p.tier}`; byModel[k] = (byModel[k] ?? 0) + 1; } else unrecorded++; }
    }
    out.remote = { reachable: true, states, reviewsByModelAndTier: byModel, reviewsWithoutProvenance: unrecorded, reviewsRecorded: reviewed };
    lines.push(`open items by state (count, oldest in days): ${Object.entries(states).map(([k, v]) => `${k} ${v.n} (${v.oldestDays}d)`).join('; ') || 'none'}`, `accepted reviews recorded on open items: ${reviewed}; by model and tier: ${Object.entries(byModel).map(([k, v]) => `${k} ${v}`).join('; ') || 'none'}${unrecorded ? `; ${unrecorded} without provenance (recorded before it existed)` : ''}`);
  } catch (e) { out.remote = { reachable: false, reason: redact(String((e as Error).message)).slice(0, 160) }; lines.push('remote: unreachable; state counts and review provenance are unknown'); }
  out.notTracked = NOT_TRACKED; lines.push('not tracked yet (no instrumentation, so no number is shown):', ...NOT_TRACKED.map((x) => `  - ${x}`));
  return { code: 0, data: out, text: lines.join('\n') };
}
