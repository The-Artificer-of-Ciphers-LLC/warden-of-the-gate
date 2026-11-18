import type { Store } from './store.ts';
import { Fenced, Faults, sleep, jitter } from './util.ts';

const PREFIX = 'warden-lock-epoch-';
const RE = /^warden-lock-epoch-(\d{6})$/;
export interface LeaseDesc { holder: string; expiresAt: number; released: boolean }
export const nameOf = (e: number) => PREFIX + String(e).padStart(6, '0');
// GitHub label descriptions are capped at 100 chars => compact "holder|expiresAtMs|released"
const enc = (d: LeaseDesc) => `${d.holder.slice(0, 50)}|${Math.trunc(d.expiresAt)}|${d.released ? 1 : 0}`;
const dec = (s: string): LeaseDesc => { const [h, e, r] = s.split('|'); const x = Number(e); return Number.isFinite(x) ? { holder: h, expiresAt: x, released: r === '1' } : { holder: '?', expiresAt: Infinity, released: false }; };

/** Writer mutual exclusion built ONLY on atomic create-if-absent of a uniquely named label (VERIFIED atomic;
 *  milestone titles are NOT). Each acquisition creates epoch N+1: exactly one creator can win. The epoch is a monotonic
 *  fencing token that writers re-check immediately before and after every ledger commit. */
export class Lease {
  epoch = 0;
  store: Store; holder: string; ttlMs: number; faults: Faults;
  constructor(store: Store, holder: string, ttlMs: number, faults: Faults) { this.store = store; this.holder = holder; this.ttlMs = ttlMs; this.faults = faults; }

  async top(): Promise<{ epoch: number; d: LeaseDesc } | null> {
    let best: { epoch: number; d: LeaseDesc } | null = null;
    for (const l of await this.store.listLabels()) {
      const m = RE.exec(l.name); if (!m) continue;
      const e = Number(m[1]); if (best && e <= best.epoch) continue;
      best = { epoch: e, d: dec(l.description) }; // unparseable => treated as held (fail closed)
    }
    return best;
  }
  async acquire(waitMs: number): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const top = await this.top(); const now = this.store.now();
      if (!top || top.d.released || top.d.expiresAt <= now) {
        const next = (top?.epoch ?? 0) + 1;
        const r = await this.store.createLabel(nameOf(next), enc({ holder: this.holder, expiresAt: now + this.ttlMs, released: false }));
        if (r !== 'exists') { this.epoch = next; this.faults.hit('after-acquire'); return true; }
      }
      if (Date.now() >= deadline) return false;
      await sleep(120 + jitter(120));
    }
  }
  /** Fence check: still the top epoch and unexpired (renew when inside margin). Throws Fenced otherwise. */
  async assertHeld(marginMs = 0): Promise<void> {
    if (!this.epoch) throw new Fenced('no lease');
    const top = await this.top();
    if (!top || top.epoch !== this.epoch) throw new Fenced(`epoch ${this.epoch} superseded by ${top?.epoch}`);
    if (top.d.expiresAt - this.store.now() <= marginMs) {
      await this.store.updateLabel(nameOf(this.epoch), enc({ holder: this.holder, expiresAt: this.store.now() + this.ttlMs, released: false }));
      const again = await this.top();
      if (!again || again.epoch !== this.epoch) throw new Fenced(`epoch ${this.epoch} superseded during renewal`);
    }
  }
  async release(): Promise<void> {
    if (!this.epoch) return;
    const mine = this.epoch; this.epoch = 0;
    try {
      const top = await this.top();
      if (top && top.epoch === mine) {
        await this.store.updateLabel(nameOf(mine), enc({ holder: this.holder, expiresAt: 0, released: true }));
        for (const l of await this.store.listLabels()) { const m = RE.exec(l.name); if (m && Number(m[1]) < mine - 2) await this.store.deleteLabel(l.name).catch(() => {}); }
      }
    } catch { /* release is best-effort; expiry covers it */ }
  }
}
