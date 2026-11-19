import type { Store } from '../github/store.ts';
import { readOnly } from '../github/store.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { Ledger } from '../state/model.ts';
import { renderApprovalCard } from './cards.ts';
import type { Gateway } from './gateway.ts';

/** Idempotent, bounded card sync: one card per approval+binding, edited in place as the approval changes state on GitHub. Reads GitHub only; writes only to Discord
 *  and to its own small local record. A Discord outage never affects approvals (they live on GitHub) and is reported, not retried forever. */
export interface CardKV { read(): Record<string, { messageId: string; state: string }>; write(v: Record<string, { messageId: string; state: string }>): void }
export interface SyncReport { posted: string[]; edited: string[]; unchanged: number; failed: Array<{ key: string; why: string }>; capped: number }
export async function syncCards(o: { store: Store; gateway: Gateway; channelId: string; repo: string; kv: CardKV; now: number; maxPerRun?: number; dryRun?: boolean; itemUrl?: (n: number) => string }): Promise<SyncReport> {
  const ro = readOnly(o.store); const known = o.kv.read(); const rep: SyncReport = { posted: [], edited: [], unchanged: 0, failed: [], capped: 0 }; const max = o.maxPerRun ?? 20; let ops = 0;
  for (const it of await ro.listIssues({ state: 'open' })) {
    const l = (await ro.listComments(it.number)).filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean) as Ledger | undefined; if (!l) continue;
    for (const a of Object.values(l.approvals)) {
      const card = renderApprovalCard(a, { repo: o.repo, item: it.number, itemUrl: o.itemUrl?.(it.number) ?? `https://github.com/${o.repo}/${it.isPr ? 'pull' : 'issues'}/${it.number}`, now: o.now });
      const prev = known[card.key];
      if (prev?.state === card.state) { rep.unchanged++; continue; }
      if (!prev && card.state !== 'pending') continue;   // never announce an approval that was already resolved before a card existed
      if (ops >= max) { rep.capped++; continue; }
      if (o.dryRun) { (prev ? rep.edited : rep.posted).push(card.key); continue; }
      try {
        if (prev) { await o.gateway.edit(o.channelId, prev.messageId, card); known[card.key] = { messageId: prev.messageId, state: card.state }; rep.edited.push(card.key); }
        else { const m = await o.gateway.post(o.channelId, card); known[card.key] = { messageId: m.messageId, state: card.state }; rep.posted.push(card.key); }
        ops++; o.kv.write(known);
      } catch (e) { rep.failed.push({ key: card.key, why: String((e as Error).message).slice(0, 120) }); }
    }
  }
  return rep;
}
