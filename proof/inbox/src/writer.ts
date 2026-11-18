import type { Comment, Store } from './store.ts';
import { Anomaly, Crash, Fenced, Faults, NetworkError, Stopped, sleep } from './util.ts';
import { Lease } from './lease.ts';
import { readStop } from './control.ts';
import {
  EFFECT_MARK, INTENT_MARK, LEDGER_MARK, MAX_ATTEMPTS, MAX_LEDGER_OPS, RECEIPT_MARK, encodeLedger, encodeReceipt,
  newLedger, parseIntent, parseLedger, parseReceipt,
} from './protocol.ts';
import type { Effect, Intent, Ledger, OpRec, Receipt } from './protocol.ts';

export interface WriterConfig {
  inboxIssue: number; controlIssue: number; globalControlIssue: number;
  operators: string[];            // may change stop/resume state
  allowedAuthors: string[];       // may submit intents to the inbox
  env: string; holder: string;
  leaseTtlMs: number; leaseWaitMs: number; fenceMarginMs: number;
  maxIntentsPerRun: number; maxPasses: number; causalTimeoutMs: number;
  holdMs?: number;                // TEST ONLY: sleep inside the critical section so concurrent runs really overlap
  assignable: (login: string) => boolean; // may a claimant be assigned on GitHub?
}
export interface Processed { commentId: number; opid?: string; result: string; reason?: string }
export interface DrainReport {
  env: string; holder: string; epoch: number; halted?: 'stop' | 'busy' | 'fenced' | 'anomaly'; haltReason?: string;
  processed: Processed[]; pendingAfter: number[];
}

export class Writer {
  store: Store; cfg: WriterConfig; faults: Faults; lease: Lease;
  constructor(store: Store, cfg: WriterConfig, faults?: Faults) {
    faults = faults ?? (store as unknown as { faults?: Faults }).faults ?? new Faults();
    this.store = store; this.cfg = cfg; this.faults = faults;
    this.lease = new Lease(store, cfg.holder, cfg.leaseTtlMs, faults);
  }

  // ---------- stop control: re-read before every task and every effect; unknown => stopped ----------
  async stopState() {
    const ops = new Set(this.cfg.operators);
    const [inst, glob] = await Promise.all([
      readStop(this.store, this.cfg.controlIssue, ops, 'instance'),
      readStop(this.store, this.cfg.globalControlIssue, ops, 'global'),
    ]);
    return { stopped: inst.stopped || glob.stopped, reasons: [...inst.reasons, ...glob.reasons], marker: `${inst.lastOperatorEvent ?? 0}/${glob.lastOperatorEvent ?? 0}` };
  }
  private async assertRunning() { const s = await this.stopState(); if (s.stopped) throw new Stopped(s.reasons.join('; ')); }
  private async ackStop(marker: string, reasons: string[]) {
    const tag = `<!-- warden-stop-ack env=${this.cfg.env} ev=${marker} -->`;
    const cs = await this.store.listComments(this.cfg.controlIssue);
    if (!cs.some((c) => c.body.includes(tag))) await this.store.createComment(this.cfg.controlIssue, `${tag}\nWarden writer (${this.cfg.env}) observed STOP and halted before any effect. ${reasons.join('; ')}`);
  }

  // ---------- fenced ledger commit ----------
  private ledgerCommentId = new Map<number, number>();
  private async loadLedger(item: number): Promise<Ledger | null> {
    const cs = (await this.store.listComments(item)).filter((c) => c.body.startsWith(LEDGER_MARK));
    if (cs.length > 1) throw new Anomaly(`item #${item} has ${cs.length} ledger comments (competing ledger) - failing closed`);
    if (!cs.length) return null;
    if (!this.cfg.allowedAuthors.includes(cs[0].author)) throw new Anomaly(`ledger comment authored by unauthorized ${cs[0].author}`);
    this.ledgerCommentId.set(item, cs[0].id);
    const l = parseLedger(cs[0].body); if (!l) throw new Anomaly('ledger unparseable'); return l;
  }
  /** Commit protocol: fence-check, write, read back, fence-check again. Throws Fenced if exclusivity cannot be shown. */
  private async commit(l: Ledger, why: string): Promise<void> {
    await this.lease.assertHeld(this.cfg.fenceMarginMs);
    await this.faults.stall('between-fence-and-write');
    const id = this.ledgerCommentId.get(l.item);
    if (id) {                                                     // optimistic base check: ledger must still be what this writer read
      const cur = parseLedger((await this.store.getComment(id)).body);
      if (!cur || cur.seq !== l.seq) throw new Fenced(`stale base on #${l.item}: expected seq ${l.seq}, found ${cur?.seq}`);
    }
    await this.faults.stall('between-basecheck-and-write');
    this.faults.hit('before-ledger-write:' + why);
    l.epoch = this.lease.epoch; l.seq += 1;
    const body = encodeLedger(l);
    let wrote: Comment;
    if (id) wrote = await this.store.updateComment(id, body);
    else { wrote = await this.store.createComment(l.item, body); this.ledgerCommentId.set(l.item, wrote.id); }
    try {
      const back = parseLedger((await this.store.getComment(wrote.id)).body);
      if (!back || back.seq !== l.seq || back.epoch !== l.epoch) throw new Fenced(`lost update on #${l.item}: wrote seq ${l.seq}/e${l.epoch}, read back ${back?.seq}/e${back?.epoch}`);
      await this.lease.assertHeld(0);
    } catch (e) {
      if (e instanceof Fenced && !id) await this.store.deleteComment(wrote.id).catch(() => {}); // zombie-created ledger: remove, never leave a competing one
      throw e;
    }
    this.faults.hit('after-ledger-write:' + why);
  }

  // ---------- drain ----------
  async drain(): Promise<DrainReport> {
    const rep: DrainReport = { env: this.cfg.env, holder: this.cfg.holder, epoch: 0, processed: [], pendingAfter: [] };
    const st = await this.stopState();
    if (st.stopped) { await this.ackStop(st.marker, st.reasons); rep.halted = 'stop'; rep.haltReason = st.reasons.join('; '); rep.pendingAfter = (await this.scan()).pending.map((c) => c.id); return rep; }
    if (!(await this.lease.acquire(this.cfg.leaseWaitMs))) { rep.halted = 'busy'; rep.pendingAfter = (await this.scan()).pending.map((c) => c.id); return rep; }
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
          if (r) { rep.processed.push(r); if (r.result !== 'deferred') progressed = true; }  // 'retry' is bounded by the persisted attempt counter
        }
        if (!progressed) break;
      }
    } catch (e) {
      if (e instanceof Crash) { crashed = true; throw e; }       // a crash does not release the lease
      if (e instanceof Fenced) { rep.halted = 'fenced'; rep.haltReason = e.message; this.lease.epoch = 0; }
      else if (e instanceof Stopped) { rep.halted = 'stop'; rep.haltReason = e.why; const s = await this.stopState().catch(() => null); if (s) await this.ackStop(s.marker, s.reasons).catch(() => {}); }
      else if (e instanceof Anomaly) { rep.halted = 'anomaly'; rep.haltReason = e.message; }
      else throw e;
    } finally { if (!crashed) await this.lease.release(); }
    rep.pendingAfter = (await this.scan()).pending.map((c) => c.id);
    return rep;
  }

  /** Enumerate inbox: authoritative durable record of intents. Pending = intent comment without a receipt. */
  async scan() {
    const all = await this.store.listComments(this.cfg.inboxIssue);
    const receipts = new Map<number, Receipt>();
    for (const c of all) { const r = parseReceipt(c.body); if (r && this.cfg.allowedAuthors.includes(c.author)) receipts.set(r.intentCommentId, r); }
    const pending = all.filter((c) => c.body.startsWith(INTENT_MARK) && !receipts.has(c.id));
    return { all, receipts, pending };
  }

  private async receipt(c: Comment, intent: Intent | undefined, result: Receipt['result'], reason: string | undefined, l: Ledger | null, post?: Receipt['post']) {
    const fresh = await this.store.listComments(this.cfg.inboxIssue);           // idempotent: never post two receipts
    if (fresh.some((x) => { const r = parseReceipt(x.body); return r?.intentCommentId === c.id; })) return;
    this.faults.hit('before-receipt');
    await this.store.createComment(this.cfg.inboxIssue, encodeReceipt({ intentCommentId: c.id, opid: intent?.opid ?? 'none', item: intent?.item ?? 0, post, result, reason, epoch: this.lease.epoch, seq: l?.seq ?? 0, by: this.cfg.holder }));
  }

  private async processIntent(c: Comment): Promise<Processed | null> {
    const p = parseIntent(c);
    const q = async (reason: string): Promise<Processed> => { await this.receipt(c, undefined, 'quarantined', reason, null); return { commentId: c.id, result: 'quarantined', reason }; };
    if (!this.cfg.allowedAuthors.includes(c.author)) return q('unauthorized-author:' + c.author);
    if (c.updatedAt !== c.createdAt) return q('edited-after-admission');
    if (!p.ok) return q(p.reason);
    const intent = p.intent;
    await this.assertRunning();

    let l = await this.loadLedger(intent.item);
    if (!l) { l = newLedger(intent.item); await this.commit(l, 'create'); }
    const known = l.ops[intent.opid];

    if (known && (known.status === 'applied' || known.status === 'rejected' || known.status === 'failed')) {
      const res = known.intentCommentId === c.id ? known.status : 'duplicate';
      await this.receipt(c, intent, res as Receipt['result'], res === 'duplicate' ? `already ${known.status} via comment ${known.intentCommentId}` : known.reason, l, { state: l.state, owner: l.owner });
      return { commentId: c.id, opid: intent.opid, result: res, reason: known.reason };
    }
    if (!known) {
      if (intent.causalAfter) {
        const dep = l.ops[intent.causalAfter];
        if (!dep || dep.status === 'applying') {
          const age = this.store.now() - Date.parse(c.createdAt);
          if (age > this.cfg.causalTimeoutMs) { l.ops[intent.opid] = { status: 'failed', decision: 'reject', reason: 'causal-timeout', plan: [], step: 0, attempts: 0, epoch: 0, intentCommentId: c.id }; l.order.push(intent.opid); await this.commit(l, 'causal-timeout'); await this.receipt(c, intent, 'failed', 'causal-timeout', l); return { commentId: c.id, opid: intent.opid, result: 'failed', reason: 'causal-timeout' }; }
          return { commentId: c.id, opid: intent.opid, result: 'deferred', reason: `waiting for ${intent.causalAfter}` }; // out-of-order: stays pending, visible
        }
        if (dep.status !== 'applied') { l.ops[intent.opid] = { status: 'rejected', decision: 'reject', reason: 'causal-predecessor-' + dep.status, plan: [], step: 0, attempts: 0, epoch: 0, intentCommentId: c.id }; l.order.push(intent.opid); await this.commit(l, 'causal-reject'); await this.receipt(c, intent, 'rejected', 'causal-predecessor-' + dep.status, l); return { commentId: c.id, opid: intent.opid, result: 'rejected', reason: 'causal-predecessor-' + dep.status }; }
      }
      // decide against CURRENT state (serialization alone would just order two overwrites; the check makes the second lose)
      const iss = await this.store.getIssue(intent.item);
      const dec = iss.state === 'closed' ? { accept: false, reason: 'item-closed', plan: [] as Effect[] } : this.decide(intent, l);
      const rec: OpRec = { status: 'applying', decision: dec.accept ? 'accept' : 'reject', reason: dec.reason, plan: dec.plan, step: 0, attempts: 0, epoch: this.lease.epoch, intentCommentId: c.id };
      l.ops[intent.opid] = rec; l.order.push(intent.opid);
      if (dec.accept) this.applyState(intent, l);
      while (l.order.length > MAX_LEDGER_OPS) { const old = l.order.shift()!; delete l.ops[old]; }
      await this.commit(l, 'decide');                    // COMMIT POINT: ownership is decided here, by the fenced writer
    }
    return this.runPlan(c, intent, l);
  }

  private decide(i: Intent, l: Ledger): { accept: boolean; reason?: string; plan: Effect[] } {
    const pl = i.payload as any;
    if (i.kind === 'claim') {
      const cl = pl.claimant as { kind: 'contributor' | 'factory'; id: string };
      if (!cl?.id || cl.id !== i.actor) return { accept: false, reason: 'claimant-actor-mismatch', plan: [{ t: 'comment', text: `Claim rejected: the requesting identity does not match the claimant.` }] };
      if (l.state === 'ready' && !l.owner) {
        const plan: Effect[] = [];
        if (cl.kind === 'contributor' && this.cfg.assignable(cl.id)) plan.push({ t: 'assign', login: cl.id });
        plan.push({ t: 'label', add: ['warden:claimed'], remove: ['warden:ready'] }, { t: 'comment', text: `Claim accepted: ${cl.kind} ${cl.id} now owns this item.` });
        return { accept: true, plan };
      }
      return { accept: false, reason: `already-owned-by:${l.owner?.id}`, plan: [{ t: 'comment', text: `Claim by ${cl.id} rejected: this item is already owned by ${l.owner?.id}.` }] };
    }
    if (i.kind === 'release') {
      if (l.owner && l.owner.id === i.actor) return { accept: true, plan: [{ t: 'label', add: ['warden:ready'], remove: ['warden:claimed'] }, { t: 'comment', text: `Released by ${i.actor}.` }] };
      return { accept: false, reason: 'not-owner', plan: [{ t: 'comment', text: `Release by ${i.actor} rejected: not the current owner.` }] };
    }
    return { accept: true, plan: [{ t: 'comment', text: String((i.payload as any).text ?? 'note') }] };
  }
  private applyState(i: Intent, l: Ledger) {
    if (i.kind === 'claim') { const cl = (i.payload as any).claimant; l.state = 'claimed'; l.owner = { kind: cl.kind, id: cl.id, opid: i.opid }; }
    if (i.kind === 'release') { l.state = 'ready'; l.owner = null; }
  }

  private async runPlan(c: Comment, intent: Intent, l: Ledger): Promise<Processed> {
    const rec = l.ops[intent.opid];
    try {
      for (let i = rec.step; i < rec.plan.length; i++) {
        await this.assertRunning();                                 // stop re-read before EVERY effect
        await this.lease.assertHeld(this.cfg.fenceMarginMs);
        const iss = await this.store.getIssue(intent.item);          // current item state re-read before effect
        if (iss.state === 'closed') { rec.reason = 'item-closed-before-effect'; break; }   // never reopen / act on closed items
        await this.faults.stall(`before-effect:${i}`);
        this.faults.hit(`before-effect:${i}`);
        await this.effect(intent, rec.plan[i], i, iss.assignees);
        this.faults.hit(`after-effect:${i}`);
        rec.step = i + 1; await this.commit(l, `step${i}`);
      }
      rec.status = rec.decision === 'accept' ? 'applied' : 'rejected';
      await this.commit(l, 'final');
      await this.receipt(c, intent, rec.status, rec.reason, l, { state: l.state, owner: l.owner });
      return { commentId: c.id, opid: intent.opid, result: rec.status, reason: rec.reason };
    } catch (e) {
      if (e instanceof Crash || e instanceof Fenced || e instanceof Stopped || e instanceof Anomaly) throw e;
      rec.attempts += 1;                                             // retry bound: persisted, so cold starts cannot reset it
      if (rec.attempts >= MAX_ATTEMPTS) { rec.status = 'failed'; rec.reason = 'retries-exhausted:' + String(e).slice(0, 80); await this.commit(l, 'failed'); await this.receipt(c, intent, 'failed', rec.reason, l); return { commentId: c.id, opid: intent.opid, result: 'failed', reason: rec.reason }; }
      await this.commit(l, 'attempt');
      return { commentId: c.id, opid: intent.opid, result: 'retry', reason: String(e).slice(0, 100) };
    }
  }

  /** Idempotent effects: native idempotence (assign/label) or a marker found before posting (comment). */
  private async effect(i: Intent, e: Effect, idx: number, assignees: string[]) {
    if (this.faults.fails('effect:' + e.t)) throw new Error('injected persistent failure at effect:' + e.t);
    if (e.t === 'assign') {
      if (!assignees.includes(e.login)) await this.store.addAssignee(i.item, e.login);
      const after = await this.store.getIssue(i.item);
      if (!after.assignees.includes(e.login)) throw new Error('assignment not confirmed by GitHub');  // never ack before confirmation
    } else if (e.t === 'label') {
      for (const a of e.add ?? []) await this.store.addLabel(i.item, a);
      for (const r of e.remove ?? []) await this.store.removeLabel(i.item, r);
    } else {
      const tag = `<!-- ${EFFECT_MARK}:${i.opid}:${idx} -->`;
      const cs = await this.store.listComments(i.item);
      if (!cs.some((x) => x.body.includes(tag))) { await this.store.createComment(i.item, `${tag}\n${e.text}`); if (this.faults.take('effect-reply-lost:comment')) throw new NetworkError('reply lost after effect comment'); }
    }
  }

  /** Retention: delete applied/rejected/duplicate intent+receipt pairs older than retentionMs (under the lease).
   *  failed/quarantined pairs are operator-visible evidence and kept 4x longer. Pending intents are NEVER deleted.
   *  Replays after compaction stay harmless because the item ledger keeps applied op ids (dedupe horizon). */
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

  /** Detect a lost update (e.g. zombie write that passed the fence then stalled) by comparing the ledger with receipts,
   *  and repair by folding receipts. Receipts are append-only evidence; the ledger stays the single read authority. */
  async repairDivergence(receipts: Map<number, Receipt>, _all: Comment[]) {
    const byItem = new Map<number, Receipt[]>();
    for (const r of receipts.values()) if ((r.result === 'applied' || r.result === 'rejected') && r.item) { (byItem.get(r.item) ?? byItem.set(r.item, []).get(r.item)!).push(r); }
    for (const [item, rs] of byItem) {
      const l = await this.loadLedger(item); if (!l) continue;
      const missing = rs.filter((r) => l.ops[r.opid]?.status !== r.result);
      if (!missing.length) continue;
      rs.sort((a, b) => a.intentCommentId - b.intentCommentId);
      for (const r of missing) l.ops[r.opid] = { status: r.result as 'applied' | 'rejected', decision: r.result === 'applied' ? 'accept' : 'reject', reason: 'repaired-from-receipt', plan: [], step: 0, attempts: 0, epoch: r.epoch, intentCommentId: r.intentCommentId };
      const lastPost = [...rs].reverse().find((r) => r.post)?.post;
      if (lastPost) { l.state = lastPost.state; l.owner = lastPost.owner; }
      (this as any).repairs = ((this as any).repairs ?? 0) + missing.length;
      await this.commit(l, 'repair');
    }
  }
}

export const defaultConfig = (o: Partial<WriterConfig> & Pick<WriterConfig, 'inboxIssue' | 'controlIssue' | 'globalControlIssue' | 'operators' | 'allowedAuthors'>): WriterConfig => ({
  env: 'mac', holder: 'writer-' + Math.random().toString(36).slice(2, 8), leaseTtlMs: 20000, leaseWaitMs: 30000, fenceMarginMs: 3000,
  maxIntentsPerRun: 200, maxPasses: 3, causalTimeoutMs: 3600_000, assignable: () => false, ...o,
});
void sleep;
