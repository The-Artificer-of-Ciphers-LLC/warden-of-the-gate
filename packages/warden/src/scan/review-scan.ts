import { authorizedUrgent } from './urgency.ts';
import type { Store } from '../github/store.ts';
import { readOnly } from '../github/store.ts';
import type { AgentRunner } from '../runner/agent-runner.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { Ledger } from '../state/model.ts';
import { runReview } from '../review/slice.ts';
import type { ReviewConfig, ReviewKV, ReviewOutcome } from '../review/slice.ts';
import { select } from './select.ts';
import type { Candidate, SelectCaps } from './select.ts';
import { iso } from '../util.ts';

/** Bounded review scan (P3): select eligible PRs deterministically, run them serially within finite item and wall-time budgets, report
 *  completed / pending / blocked / deferred, and exit. No polling, no waiting for humans or CI, no scheduling. A stop or abort between items
 *  ends the scan; per-item attempts are persisted by the review slice so a cold start cannot reset them. */
export interface ScanOpts {
  maintainers?: readonly string[]; urgentLabel?: string;
  store: Store; runner: AgentRunner; kvFor: (item: number) => ReviewKV; cfg: ReviewConfig; caps: SelectCaps; wallTimeMs: number;
  stopped: () => boolean | Promise<boolean>; signal?: AbortSignal; clock?: () => number; policyDigest?: string; only?: number[];
}
export interface ScanReport { startedAt: string; finishedAt: string; effectiveMode: 'shadow'; completed: Array<{ item: number; outcome: ReviewOutcome['kind']; notice: string }>; pending: Array<{ item: number; why: string }>; blocked: Array<{ item: number; why: string }>; skipped: Array<{ item: number; why: string }>; stoppedEarly?: string }

export async function eligible(store: Store, o: Pick<ScanOpts, 'kvFor' | 'cfg' | 'clock' | 'only'> & { maintainers?: readonly string[]; urgentLabel?: string }): Promise<{ cands: Candidate[]; skipped: ScanReport['skipped'] }> {
  const ro = readOnly(store); const now = (o.clock ?? Date.now)(); const cands: Candidate[] = []; const skipped: ScanReport['skipped'] = [];
  for (const it of (await ro.listIssues({ state: 'open' })).filter((i) => i.isPr && (!o.only || o.only.includes(i.number)))) {
    const l = (await ro.listComments(it.number)).filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean) as Ledger | undefined;
    if (!l) { skipped.push({ item: it.number, why: 'no Warden state: run intake or adopt first' }); continue; }
    if (l.state !== 'needs-review') { skipped.push({ item: it.number, why: `state ${l.state} is not awaiting review` }); continue; }
    const rec = o.kvFor(it.number).read(it.number);
    let head: string | undefined; try { head = (await ro.getPull(it.number)).head; } catch { skipped.push({ item: it.number, why: 'not a readable pull request' }); continue; }
    if (rec?.marker && rec.marker.head === head) { skipped.push({ item: it.number, why: 'already reviewed at this head (checks-only/reuse is resolved by a direct scan)' }); continue; }
    const exhausted = (rec?.attempts.used ?? 0) >= o.cfg.maxAttempts;
    cands.push({ item: it.number, kind: 'pr', urgent: await authorizedUrgent(ro, it, { label: o.urgentLabel, maintainers: o.maintainers ?? [] }), ageHours: Math.max(0, (now - Date.parse(it.createdAt)) / 3_600_000), inProgress: !!rec?.marker || (rec?.attempts.used ?? 0) > 0, blockedReason: exhausted ? 'retry budget used up; waits for a maintainer' : undefined });
  }
  return { cands, skipped };
}

export async function scanReviews(o: ScanOpts): Promise<ScanReport> {
  const now = o.clock ?? Date.now; const t0 = now(); const rep: ScanReport = { startedAt: iso(t0), finishedAt: '', effectiveMode: 'shadow', completed: [], pending: [], blocked: [], skipped: [] };
  const { cands, skipped } = await eligible(o.store, o); rep.skipped = skipped;
  const sel = select(cands, o.caps); rep.blocked = sel.blocked; rep.pending = [...sel.deferred];
  const queue = [...sel.run];
  while (queue.length) {
    const c = queue.shift()!;
    if (await o.stopped()) { rep.stoppedEarly = 'stop in force'; rep.pending.push(...[c, ...queue].map((x) => ({ item: x.item, why: 'stopped before it started' }))); break; }
    if (o.signal?.aborted) { rep.stoppedEarly = 'cancelled'; rep.pending.push(...[c, ...queue].map((x) => ({ item: x.item, why: 'cancelled before it started' }))); break; }
    if (now() - t0 >= o.wallTimeMs) { rep.stoppedEarly = 'wall-time budget reached'; rep.pending.push(...[c, ...queue].map((x) => ({ item: x.item, why: 'wall-time budget reached; waits for another invocation' }))); break; }
    const r = await runReview({ store: o.store, item: c.item, runner: o.runner, kv: o.kvFor(c.item), cfg: o.cfg, stopped: o.stopped, signal: o.signal, clock: o.clock, policyDigest: o.policyDigest });
    rep.completed.push({ item: c.item, outcome: r.kind, notice: r.notice });
    if (r.kind === 'interrupted') { rep.stoppedEarly = 'interrupted'; rep.pending.push(...queue.map((x) => ({ item: x.item, why: 'scan interrupted' }))); break; }
  }
  rep.finishedAt = iso(now()); return rep;
}
