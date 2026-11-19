import type { Store } from '../github/store.ts';
import { readOnly } from '../github/store.ts';
import type { AgentRunner } from '../runner/agent-runner.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { Ledger } from '../state/model.ts';
import { revisionOf, runTriage } from '../triage/slice.ts';
import type { TriageKV, TriageOutcome } from '../triage/slice.ts';
import type { ReviewConfig } from '../review/slice.ts';
import { select } from './select.ts';
import type { Candidate, SelectCaps } from './select.ts';
import { iso } from '../util.ts';

/** Bounded triage scan (P3): the same discipline as the review scan. Eligible = open ISSUES that Warden already tracks (intake/adopt first), still awaiting
 *  triage, whose current revision has no accepted triage. Deterministic selection, serial, finite item and wall-time budgets, then exit. Shadow only: results
 *  are local draft cards; nothing is posted, labelled or closed. */
export interface TriageScanOpts { store: Store; runner: AgentRunner; kvFor: (item: number) => TriageKV; cfg: ReviewConfig; caps: SelectCaps; wallTimeMs: number; stopped: () => boolean | Promise<boolean>; signal?: AbortSignal; clock?: () => number; policyDigest?: string; skip?: Set<number>; only?: number[] }
export interface TriageScanReport { startedAt: string; finishedAt: string; effectiveMode: 'shadow'; completed: Array<{ item: number; outcome: TriageOutcome['kind']; notice: string }>; pending: Array<{ item: number; why: string }>; blocked: Array<{ item: number; why: string }>; skipped: Array<{ item: number; why: string }>; stoppedEarly?: string }

export async function eligibleIssues(store: Store, o: Pick<TriageScanOpts, 'kvFor' | 'cfg' | 'clock' | 'skip' | 'only'>): Promise<{ cands: Candidate[]; skipped: TriageScanReport['skipped'] }> {
  const ro = readOnly(store); const now = (o.clock ?? Date.now)(); const cands: Candidate[] = []; const skipped: TriageScanReport['skipped'] = [];
  for (const it of (await ro.listIssues({ state: 'open' })).filter((i) => !i.isPr && !o.skip?.has(i.number) && (!o.only || o.only.includes(i.number)))) {
    const comments = await ro.listComments(it.number);
    const l = comments.filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean) as Ledger | undefined;
    if (!l) { skipped.push({ item: it.number, why: 'no Warden state: run intake or adopt first' }); continue; }
    if (l.state !== 'needs-triage') { skipped.push({ item: it.number, why: `state ${l.state} is not awaiting triage` }); continue; }
    const rec = o.kvFor(it.number).read(it.number);
    if (rec?.marker && rec.marker.revision === revisionOf(it, comments)) { skipped.push({ item: it.number, why: 'already triaged at this revision' }); continue; }
    const exhausted = (rec?.attempts.used ?? 0) >= o.cfg.maxAttempts;
    cands.push({ item: it.number, kind: 'issue', ageHours: Math.max(0, (now - Date.parse(it.createdAt)) / 3_600_000), inProgress: (rec?.attempts.used ?? 0) > 0, blockedReason: exhausted ? 'retry budget used up; waits for a maintainer' : undefined });
  }
  return { cands, skipped };
}

export async function scanTriage(o: TriageScanOpts): Promise<TriageScanReport> {
  const now = o.clock ?? Date.now; const t0 = now(); const rep: TriageScanReport = { startedAt: iso(t0), finishedAt: '', effectiveMode: 'shadow', completed: [], pending: [], blocked: [], skipped: [] };
  const { cands, skipped } = await eligibleIssues(o.store, o); rep.skipped = skipped;
  const sel = select(cands, o.caps); rep.blocked = sel.blocked; rep.pending = [...sel.deferred];
  const queue = [...sel.run];
  while (queue.length) {
    const c = queue.shift()!; const rest = (why: string) => queue.map((x) => ({ item: x.item, why }));
    if (await o.stopped()) { rep.stoppedEarly = 'stop in force'; rep.pending.push({ item: c.item, why: 'stopped before it started' }, ...rest('stopped before it started')); break; }
    if (o.signal?.aborted) { rep.stoppedEarly = 'cancelled'; rep.pending.push({ item: c.item, why: 'cancelled before it started' }, ...rest('cancelled before it started')); break; }
    if (now() - t0 >= o.wallTimeMs) { rep.stoppedEarly = 'wall-time budget reached'; rep.pending.push({ item: c.item, why: 'wall-time budget reached; waits for another invocation' }, ...rest('wall-time budget reached; waits for another invocation')); break; }
    const r = await runTriage({ store: o.store, item: c.item, runner: o.runner, kv: o.kvFor(c.item), cfg: o.cfg, stopped: o.stopped, signal: o.signal, clock: o.clock, policyDigest: o.policyDigest });
    rep.completed.push({ item: c.item, outcome: r.kind, notice: r.notice });
    if (r.kind === 'interrupted') { rep.stoppedEarly = 'interrupted'; rep.pending.push(...rest('scan interrupted')); break; }
  }
  rep.finishedAt = iso(now()); return rep;
}
