import { authorActivity, type SweepObs } from '../sweep/derive.ts';
import type { Comment, Store } from '../github/store.ts';
import { Anomaly, Crash, Faults, Fenced, NetworkError, Stopped, canonical, sleep } from '../util.ts';
import { Lease } from './lease.ts';
import { readControls } from './control.ts';
import type { GlobalControl } from './control.ts';
import { EFFECT_MARK, INTENT_MARK, LEDGER_MARK, RECEIPT_MARK, encodeLedger, encodeReceipt, macValid, parseIntent, parseLedger, parseReceipt } from './protocol.ts';
import type { Intent, Receipt } from './protocol.ts';
import { newLedger } from '../state/model.ts';
import type { Effect, Ledger, OpRec } from '../state/model.ts';
import { reduce } from './reduce.ts';
import type { PolicySnapshot } from '../config/snapshot.ts';
import { expireApprovals, parseMaintainerCommand } from '../approvals/approvals.ts';
import type { DecisionRecord } from '../approvals/approvals.ts';

export interface WriterConfig {
  repository: string; inboxIssue: number; controlIssue: number; global: GlobalControl | null;
  /** Identity split (ADR 0011/0012 decision): `submitters` may append intents; ONLY `writerIdentities` may author ledgers and receipts. */
  submitters: string[]; writerIdentities: string[];
  policy: PolicySnapshot; env: string; holder: string;
  leaseTtlMs: number; leaseWaitMs: number; fenceMarginMs: number; fenceCacheMs: number;
  maxIntentsPerRun: number; maxPasses: number; causalTimeoutMs: number; maxCreatesPerRun: number;
  ledgerKey?: string; assignable: (login: string) => boolean; holdMs?: number;
}
export interface Processed { commentId: number; opid?: string; result: string; reason?: string }
export interface DrainReport {
  env: string; holder: string; epoch: number; halted?: 'stop' | 'dry-run' | 'busy' | 'fenced' | 'anomaly' | 'budget'; haltReason?: string;
  processed: Processed[]; pendingAfter: number[]; decisions: DecisionRecord[]; repairs: number; creates: number;
}

export class Writer {
  store: Store; cfg: WriterConfig; faults: Faults; lease: Lease;
  repairs = 0; creates = 0; decisions: DecisionRecord[] = [];
  private receipted = new Set<number>();
  constructor(store: Store, cfg: WriterConfig, faults?: Faults) {
    faults = faults ?? (store as unknown as { faults?: Faults }).faults ?? new Faults();
    this.store = store; this.cfg = cfg; this.faults = faults;
    this.lease = new Lease(store, cfg.holder, cfg.leaseTtlMs, faults);
  }

  // ---------- control: re-read before every task and every effect; unknown => stopped ----------
  async controls() { return readControls(this.store, this.cfg.controlIssue, this.cfg.global, new Set(this.cfg.policy.operators), this.cfg.policy.stopLabel); }
  private async assertRunning() {
    const s = await this.controls();
    if (s.stopped) throw new Stopped(s.reasons.join('; '));
    if (s.dryRun) throw new Stopped('dry-run: ' + s.reasons.join('; '));
  }
  private async ackStop(marker: string, reasons: string[], kind: 'stop' | 'dry-run') {
    const tag = `<!-- warden-${kind === 'stop' ? 'stop' : 'dryrun'}-ack env=${this.cfg.env} ev=${marker} -->`;
    const cs = await this.store.listComments(this.cfg.controlIssue);
    if (!cs.some((c) => c.body.includes(tag))) { await this.create(this.cfg.controlIssue, `${tag}\nWarden writer (${this.cfg.env}) observed ${kind.toUpperCase()} and halted before any effect. ${reasons.join('; ')}`); }
  }
  private async create(issue: number, body: string): Promise<Comment> {
    if (this.creates >= this.cfg.maxCreatesPerRun) throw new BudgetExhausted();
    this.creates++; return this.store.createComment(issue, body);
  }

  // ---------- fenced ledger commit ----------
  private ledgerCommentId = new Map<number, number>();
  private async loadLedger(item: number): Promise<Ledger | null> {
    const cs = (await this.store.listComments(item)).filter((c) => c.body.startsWith(LEDGER_MARK));
    if (cs.length > 1) throw new Anomaly(`item #${item} has ${cs.length} ledger comments (competing ledger) - failing closed`);
    if (!cs.length) return null;
    if (!this.cfg.writerIdentities.includes(cs[0].author)) throw new Anomaly(`ledger comment authored by non-writer identity ${cs[0].author}`);
    this.ledgerCommentId.set(item, cs[0].id);
    const l = parseLedger(cs[0].body); if (!l) throw new Anomaly('ledger unparseable');
    if (l.repository !== this.cfg.repository) throw new Anomaly(`ledger for ${l.repository} found in instance ${this.cfg.repository}: instances never share mutable state`);
    if (this.cfg.ledgerKey && !macValid(l, this.cfg.ledgerKey)) throw new Anomaly(`ledger #${item} failed integrity check (edited by something other than the writer)`);
    return l;
  }
  private async commit(l: Ledger, why: string): Promise<void> {
    await this.lease.assertHeld(this.cfg.fenceMarginMs, this.cfg.fenceCacheMs);
    await this.faults.stall('between-fence-and-write');
    const id = this.ledgerCommentId.get(l.item);
    if (id) {
      const cur = parseLedger((await this.store.getComment(id)).body);
      if (!cur || cur.seq !== l.seq) throw new Fenced(`stale base on #${l.item}: expected seq ${l.seq}, found ${cur?.seq}`);
    }
    await this.faults.stall('between-basecheck-and-write');
    this.faults.hit('before-ledger-write:' + why);
    l.epoch = this.lease.epoch; l.seq += 1;
    const body = encodeLedger(l, this.cfg.ledgerKey);
    let wrote: Comment;
    if (id) wrote = await this.store.updateComment(id, body);
    else { if (this.creates >= this.cfg.maxCreatesPerRun) throw new BudgetExhausted(); this.creates++; wrote = await this.store.createComment(l.item, body); this.ledgerCommentId.set(l.item, wrote.id); }
    try {
      const back = parseLedger((await this.store.getComment(wrote.id)).body);
      if (!back || back.seq !== l.seq || back.epoch !== l.epoch) throw new Fenced(`lost update on #${l.item}: wrote seq ${l.seq}/e${l.epoch}, read back ${back?.seq}/e${back?.epoch}`);
      await this.lease.assertHeld(0, 0);
    } catch (e) {
      if (e instanceof Fenced && !id) await this.store.deleteComment(wrote.id).catch(() => {});
      throw e;
    }
    this.faults.hit('after-ledger-write:' + why);
  }

  // ---------- drain ----------
  async drain(): Promise<DrainReport> {
    this.repairs = 0; this.creates = 0; this.decisions = [];
    const rep: DrainReport = { env: this.cfg.env, holder: this.cfg.holder, epoch: 0, processed: [], pendingAfter: [], decisions: [], repairs: 0, creates: 0 };
    const finish = async () => { try { rep.pendingAfter = (await this.scan()).pending.map((c) => c.id); } catch { rep.haltReason = (rep.haltReason ?? '') + ' (inbox unreadable: pending state unknown, nothing was written)'; } rep.decisions = this.decisions; rep.repairs = this.repairs; rep.creates = this.creates; return rep; };
    const st = await this.controls();
    if (st.stopped || st.dryRun) {
      const kind = st.stopped ? 'stop' : 'dry-run';
      await this.ackStop(st.marker, st.reasons, kind).catch(() => {});
      rep.halted = kind; rep.haltReason = st.reasons.join('; '); return finish();
    }
    if (!(await this.lease.acquire(this.cfg.leaseWaitMs))) { rep.halted = 'busy'; return finish(); }
    rep.epoch = this.lease.epoch;
    let crashed = false;
    try {
      for (let pass = 0; pass < this.cfg.maxPasses; pass++) {
        const { pending, receipts, all } = await this.scan();
        await this.repairDivergence(receipts, all);
        if (!pending.length) break;
        if (this.cfg.holdMs) await sleep(this.cfg.holdMs);
        let progressed = false;
        for (const c of pending.slice(0, this.cfg.maxIntentsPerRun)) {
          const r = await this.processIntent(c);
          if (r) { rep.processed.push(r); if (r.result !== 'deferred') progressed = true; }
        }
        if (!progressed) break;
      }
    } catch (e) {
      if (e instanceof Crash) { crashed = true; throw e; }
      if (e instanceof Fenced) { rep.halted = 'fenced'; rep.haltReason = e.message; this.lease.epoch = 0; }
      else if (e instanceof Stopped) { rep.halted = e.why.startsWith('dry-run') ? 'dry-run' : 'stop'; rep.haltReason = e.why; const s = await this.controls().catch(() => null); if (s) await this.ackStop(s.marker, s.reasons, rep.halted).catch(() => {}); }
      else if (e instanceof Anomaly) { rep.halted = 'anomaly'; rep.haltReason = e.message; }
      else if (e instanceof BudgetExhausted) { rep.halted = 'budget'; rep.haltReason = `content-creation budget (${this.cfg.maxCreatesPerRun}/run) exhausted; remaining intents stay pending for the next run`; }
      else throw e;
    } finally { if (!crashed) await this.lease.release(); }
    return finish();
  }

  /** Pending = intent comment without a receipt from a writer identity. */
  async scan() {
    const all = await this.store.listComments(this.cfg.inboxIssue);
    const receipts = new Map<number, Receipt>();
    for (const c of all) { const r = parseReceipt(c.body); if (r && this.cfg.writerIdentities.includes(c.author)) receipts.set(r.intentCommentId, r); }
    this.receipted = new Set(receipts.keys());
    const pending = all.filter((c) => c.body.startsWith(INTENT_MARK) && !receipts.has(c.id));
    return { all, receipts, pending };
  }

  private async receipt(c: Comment, intent: Intent | undefined, result: Receipt['result'], reason: string | undefined, l: Ledger | null, post?: Receipt['post']) {
    if (this.receipted.has(c.id)) return;
    this.faults.hit('before-receipt');
    try { await this.create(this.cfg.inboxIssue, encodeReceipt({ intentCommentId: c.id, opid: intent?.opid ?? 'none', item: intent?.item ?? 0, post, result, reason, epoch: this.lease.epoch, seq: l?.seq ?? 0, by: this.cfg.holder })); }
    catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      const fresh = await this.store.listComments(this.cfg.inboxIssue);              // reply lost: did it land?
      if (!fresh.some((x) => parseReceipt(x.body)?.intentCommentId === c.id)) throw e;
    }
    this.receipted.add(c.id);
  }

  private async processIntent(c: Comment): Promise<Processed | null> {
    const pol = this.cfg.policy;
    const p = parseIntent(c, pol.maxIntentBytes);
    const q = async (reason: string): Promise<Processed> => { await this.receipt(c, undefined, 'quarantined', reason, null); return { commentId: c.id, result: 'quarantined', reason }; };
    if (!this.cfg.submitters.includes(c.author)) return q('unauthorized-author:' + c.author);
    if (c.updatedAt !== c.createdAt) return q('edited-after-admission');
    if (!p.ok) return q(p.reason);
    const intent = p.intent;
    if (intent.repo !== this.cfg.repository) return q(`wrong-instance:${intent.repo}`);
    await this.assertRunning();

    let iss; try { iss = await this.store.getIssue(intent.item); } catch (e) { if ((e as { status?: number }).status === 404) return this.rejectNow(c, intent, 'item-not-found'); throw e; }
    if ((iss.isPr ? 'pr' : 'issue') !== intent.itemKind) return this.rejectNow(c, intent, `item-kind-mismatch:${iss.isPr ? 'pr' : 'issue'}`);

    let l = await this.loadLedger(intent.item);
    if (!l) { l = newLedger(this.cfg.repository, intent.item, intent.itemKind); await this.commit(l, 'create'); }
    const known = l.ops[intent.opid];

    if (known && (known.status === 'applied' || known.status === 'rejected' || known.status === 'failed')) {
      const res = known.intentCommentId === c.id ? known.status : 'duplicate';
      await this.receipt(c, intent, res as Receipt['result'], res === 'duplicate' ? `already ${known.status} via comment ${known.intentCommentId}` : known.reason, l, { state: l.state, owner: l.owner });
      return { commentId: c.id, opid: intent.opid, result: res, reason: known.reason };
    }
    if (!known) {
      const age = this.store.now() - Date.parse(c.createdAt);
      const observedAge = Number.isFinite(Date.parse(intent.source.observedAt)) ? this.store.now() - Date.parse(intent.source.observedAt) : age;
      if (l.dropped > 0 && Math.max(age, observedAge) > pol.maxIntentAgeMs) {                     // P0 open item: redelivery older than the dedupe horizon cannot be recognized
        return this.finalizeReject(c, intent, l, 'beyond-dedupe-horizon', `Operation rejected: it is older than the replay-protection window (${Math.round(pol.maxIntentAgeMs / 3600_000)}h) and cannot be proven new.`);
      }
      if (intent.causalAfter) {
        const dep = l.ops[intent.causalAfter];
        if (!dep || dep.status === 'applying') {
          if (age > this.cfg.causalTimeoutMs) return this.finalizeReject(c, intent, l, 'causal-timeout', null, 'failed');
          return { commentId: c.id, opid: intent.opid, result: 'deferred', reason: `waiting for ${intent.causalAfter}` };
        }
        if (dep.status !== 'applied') return this.finalizeReject(c, intent, l, 'causal-predecessor-' + dep.status, null);
      }
      expireApprovals(l, this.store.now());
      if (iss.state === 'closed' && intent.kind !== 'note' && intent.kind !== 'reconcile') return this.finalizeReject(c, intent, l, 'item-closed', null);
      let dec;
      if (intent.origin === 'ai' && pol.mode === 'shadow') dec = { accept: false, reason: 'shadow-mode-ai-effects-disabled', plan: [] as Effect[] };
      else {
        const sourceVerified = await this.verifySource(intent);
        const linkedPr = intent.kind === 'submission' && typeof (intent.payload as { pr?: unknown }).pr === 'number' ? await this.store.getIssue((intent.payload as { pr: number }).pr).catch(() => undefined) : undefined;
        const pullObs = intent.kind === 'merge-request' ? await this.store.getPull(intent.item).catch(() => undefined) : undefined;
        const observed = intent.kind === 'sweep-action' ? await this.observeSweep(intent, iss) : undefined;
        dec = reduce(intent, l, { policy: pol, now: this.store.now(), sourceVerified, assignable: this.cfg.assignable, observed, item: iss, linkedPr, pull: pullObs });
      }
      const rec: OpRec = { status: 'applying', decision: dec.accept ? 'accept' : 'reject', reason: dec.reason, plan: dec.plan, step: 0, attempts: 0, epoch: this.lease.epoch, intentCommentId: c.id };
      dec.apply?.(l);
      l.ops[intent.opid] = rec; l.order.push(intent.opid);
      while (l.order.length > pol.dedupeHorizon) { const old = l.order.shift()!; delete l.ops[old]; l.dropped++; }
      await this.commit(l, 'decide');                                      // COMMIT POINT: decided by the fenced writer
      if ('corpus' in dec && dec.corpus) this.decisions.push(dec.corpus);
    }
    return this.runPlan(c, intent, l);
  }

  /** Sweep facts are re-read here, at decision time, so a reply or label added after planning defeats a stale closure. */
  private async observeSweep(i: Intent, iss: { labels: string[]; draft?: boolean; author: string }): Promise<SweepObs | undefined> {
    const keep = this.cfg.policy.sweep?.keepOpenLabel; if (!keep) return undefined;
    return { keepOpen: iss.labels.includes(keep), draft: !!iss.draft, authorLastActivityAt: authorActivity(await this.store.listComments(i.item), iss.author) };
  }
  /** Reconstruct maintainer authority from the target item's source comment, not the submitter's interpretation. */
  private async verifySource(i: Intent): Promise<boolean> {
    if (i.kind !== 'approval-decision' && i.kind !== 'override' && i.kind !== 'hold' && i.kind !== 'hold-release') return true;
    if (i.source.kind !== 'gh-comment') return false;
    const sc = (await this.store.listComments(i.item)).find((c) => c.id === Number(i.source.id));
    if (!sc || sc.author !== i.actor || sc.updatedAt !== sc.createdAt) return false;
    const command = parseMaintainerCommand(sc.body);
    return command !== null && command.kind === i.kind && canonical(command.payload) === canonical(i.payload);
  }
  private async rejectNow(c: Comment, intent: Intent, reason: string): Promise<Processed> {
    await this.receipt(c, intent, 'rejected', reason, null); return { commentId: c.id, opid: intent.opid, result: 'rejected', reason };
  }
  private async finalizeReject(c: Comment, intent: Intent, l: Ledger, reason: string, text: string | null, as: 'rejected' | 'failed' = 'rejected'): Promise<Processed> {
    l.ops[intent.opid] = { status: as === 'failed' ? 'failed' : 'rejected', decision: 'reject', reason, plan: [], step: 0, attempts: 0, epoch: this.lease.epoch, intentCommentId: c.id };
    l.order.push(intent.opid); await this.commit(l, 'reject');
    void text; await this.receipt(c, intent, as, reason, l, { state: l.state, owner: l.owner });
    return { commentId: c.id, opid: intent.opid, result: as, reason };
  }

  private async runPlan(c: Comment, intent: Intent, l: Ledger): Promise<Processed> {
    const rec = l.ops[intent.opid];
    try {
      for (let i = rec.step; i < rec.plan.length; i++) {
        await this.assertRunning();                                          // control re-read before EVERY effect
        await this.lease.assertHeld(this.cfg.fenceMarginMs, this.cfg.fenceCacheMs);
        const iss = await this.store.getIssue(intent.item);                  // current item re-read before effect
        if (iss.state === 'closed' && rec.plan[i].t !== 'comment' && !rec.plan.some((x) => x.t === 'merge')) { rec.reason = (rec.reason ?? '') + ' item-closed-before-effect'; break; }   // a merge plan is exempt: it expects the PR to be closed by its own merge
        await this.faults.stall(`before-effect:${i}`);
        this.faults.hit(`before-effect:${i}`);
        await this.effect(intent, rec.plan[i], i, iss, l);
        this.faults.hit(`after-effect:${i}`);
        rec.step = i + 1; await this.commit(l, `step${i}`);
      }
      rec.status = rec.decision === 'accept' ? 'applied' : 'rejected';
      await this.commit(l, 'final');
      await this.receipt(c, intent, rec.status, rec.reason, l, { state: l.state, owner: l.owner });
      return { commentId: c.id, opid: intent.opid, result: rec.status, reason: rec.reason };
    } catch (e) {
      if (e instanceof StaleMerge) { rec.status = 'rejected'; rec.reason = 'stale-merge:' + e.message; await this.commit(l, 'stale-merge'); await this.receipt(c, intent, 'rejected', rec.reason, l, { state: l.state, owner: l.owner }); return { commentId: c.id, opid: intent.opid, result: 'rejected', reason: rec.reason }; }
      if (e instanceof Crash || e instanceof Fenced || e instanceof Stopped || e instanceof Anomaly || e instanceof BudgetExhausted) throw e;
      rec.attempts += 1;                                                     // persisted retry bound: a cold start cannot reset it
      if (rec.attempts >= this.cfg.policy.maxAttempts) { rec.status = 'failed'; rec.reason = 'retries-exhausted:' + String(e).slice(0, 80); await this.commit(l, 'failed'); await this.receipt(c, intent, 'failed', rec.reason, l); return { commentId: c.id, opid: intent.opid, result: 'failed', reason: rec.reason }; }
      await this.commit(l, 'attempt');
      return { commentId: c.id, opid: intent.opid, result: 'retry', reason: String(e).slice(0, 100) };
    }
  }

  /** Idempotent effects: native idempotence (assign/label) or a marker found before posting (comment). */
  private async effect(i: Intent, e: Effect, idx: number, iss: { assignees: string[]; state: string }, l: Ledger) {
    const assignees = iss.assignees;
    if (this.faults.fails('effect:' + e.t)) throw new Error('injected persistent failure at effect:' + e.t);
    if (e.t === 'assign') {
      if (!assignees.includes(e.login)) await this.store.addAssignee(i.item, e.login);
      const after = await this.store.getIssue(i.item);
      if (!after.assignees.includes(e.login)) throw new Error('assignment not confirmed by GitHub');  // never ack before confirmation
    } else if (e.t === 'unassign') {
      if (assignees.includes(e.login)) await this.store.removeAssignee(i.item, e.login);
      if ((await this.store.getIssue(i.item)).assignees.includes(e.login)) throw new Error('unassignment not confirmed by GitHub');
    } else if (e.t === 'merge') {
      const p0 = await this.store.getPull(i.item);
      if (!p0.merged) {
        if (p0.head !== e.expectedHead) throw new StaleMerge(`head moved ${e.expectedHead.slice(0, 8)} -> ${p0.head.slice(0, 8)}`);
        try { await this.store.mergePull(i.item, e.expectedHead); }
        catch (err) { const st = (err as { status?: number }).status; if (st === 409 || st === 405 || st === 422) { if (!(await this.store.getPull(i.item)).merged) throw new StaleMerge(`GitHub refused the bound merge (${st})`); } else throw err; }
      }
      if (!(await this.store.getPull(i.item)).merged) throw new Error('merge not confirmed by GitHub');   // never record merged before GitHub says so
    } else if (e.t === 'mark-merged') {
      if (!(await this.store.getPull(i.item)).merged) throw new Error('cannot record merged: GitHub does not show it merged');
      l.state = 'merged';
    } else if (e.t === 'close') {
      if (iss.state !== 'closed') await this.store.closeIssue(i.item);
      if ((await this.store.getIssue(i.item)).state !== 'closed') throw new Error('close not confirmed by GitHub');
    } else if (e.t === 'label') {
      for (const a of e.add ?? []) await this.store.addLabel(i.item, a);
      for (const r of e.remove ?? []) await this.store.removeLabel(i.item, r);
    } else {
      const tag = `<!-- ${EFFECT_MARK}:${i.opid}:${idx} -->`;
      const cs = await this.store.listComments(i.item);
      if (!cs.some((x) => x.body.includes(tag))) { await this.create(i.item, `${tag}\n${e.text}`); if (this.faults.take('effect-reply-lost:comment')) throw new NetworkError('reply lost after effect comment'); }
    }
  }

  /** Retention: applied/rejected/duplicate pairs older than retentionMs are deleted; failed/quarantined kept 4x; pending never deleted. */
  async compact(retentionMs: number): Promise<{ deleted: number; kept: number }> {
    if (!(await this.lease.acquire(this.cfg.leaseWaitMs))) return { deleted: 0, kept: -1 };
    try {
      const { all, receipts } = await this.scan(); let deleted = 0, kept = 0; const now = this.store.now();
      const byId = new Map(all.map((c) => [c.id, c]));
      for (const [intentId, r] of receipts) {
        const rc = all.find((c) => parseReceipt(c.body)?.intentCommentId === intentId); if (!rc) continue;
        const keepFor = r.result === 'failed' || r.result === 'quarantined' ? retentionMs * 4 : retentionMs;
        if (now - Date.parse(rc.createdAt) < keepFor) { kept++; continue; }
        await this.lease.assertHeld(this.cfg.fenceMarginMs);
        if (byId.has(intentId)) await this.store.deleteComment(intentId);
        await this.store.deleteComment(rc.id); deleted += 2;
      }
      return { deleted, kept };
    } finally { await this.lease.release(); }
  }

  /** Detect a lost update (zombie write) by comparing ledger with receipts; repair by folding receipts. */
  async repairDivergence(receipts: Map<number, Receipt>, _all: Comment[]) {
    const byItem = new Map<number, Receipt[]>();
    for (const r of receipts.values()) if ((r.result === 'applied' || r.result === 'rejected') && r.item) { (byItem.get(r.item) ?? byItem.set(r.item, []).get(r.item)!).push(r); }
    for (const [item, rs] of byItem) {
      const l = await this.loadLedger(item); if (!l) continue;
      const real = rs.filter((r) => l.ops[r.opid]?.status !== r.result && (l.dropped === 0 || r.seq > l.seq));
      if (!real.length) continue;
      rs.sort((a, b) => a.intentCommentId - b.intentCommentId);
      for (const r of real) l.ops[r.opid] = { status: r.result as 'applied' | 'rejected', decision: r.result === 'applied' ? 'accept' : 'reject', reason: 'repaired-from-receipt', plan: [], step: 0, attempts: 0, epoch: r.epoch, intentCommentId: r.intentCommentId };
      const lastPost = [...rs].reverse().find((r) => r.post)?.post;
      if (lastPost) { l.state = lastPost.state as Ledger['state']; l.owner = lastPost.owner; }
      this.repairs += real.length;
      await this.commit(l, 'repair');
    }
  }
}
class BudgetExhausted extends Error {}
/** A merge bound to a head that is no longer current: a clean rejection, never retried and never redirected to another head. */
class StaleMerge extends Error {}
void RECEIPT_MARK;

export const defaultWriterConfig = (o: Partial<WriterConfig> & Pick<WriterConfig, 'repository' | 'inboxIssue' | 'controlIssue' | 'policy' | 'submitters' | 'writerIdentities'>): WriterConfig => ({
  global: null, env: 'actions', holder: 'writer-' + Math.random().toString(36).slice(2, 8), leaseTtlMs: 20000, leaseWaitMs: 30000, fenceMarginMs: 3000, fenceCacheMs: 0,
  maxIntentsPerRun: 200, maxPasses: 3, causalTimeoutMs: 3600_000, maxCreatesPerRun: 80, assignable: () => false, ...o,
});
