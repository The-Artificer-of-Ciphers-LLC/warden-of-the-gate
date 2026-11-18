import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store } from '../github/store.ts';
import { Faults, redactDeep } from '../util.ts';
import { INTENT_MARK, encodeIntent, parseIntent, parseReceipt } from './protocol.ts';
import type { Intent, Receipt } from './protocol.ts';

export interface JournalEntry { opid: string; intent?: Intent; state: 'pending' | 'submitted' | 'acked'; commentId?: number; result?: string; reason?: string; at: string }

/** Protected local write-ahead journal: directory 0700, file 0600, fsync per record, credential-shaped values redacted from the first write.
 *  An intent is durable HERE before any network call. */
export class Journal {
  path: string;
  constructor(path: string) {
    this.path = path; mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600)); else chmodSync(path, 0o600);
  }
  append(e: JournalEntry) { const fd = openSync(this.path, 'a', 0o600); try { writeSync(fd, JSON.stringify(redactDeep(e)) + '\n'); fsyncSync(fd); } finally { closeSync(fd); } }
  entries(): Map<string, JournalEntry> {
    const m = new Map<string, JournalEntry>();
    for (const line of readFileSync(this.path, 'utf8').split('\n').filter(Boolean)) { const e = JSON.parse(line) as JournalEntry; const prev = m.get(e.opid); m.set(e.opid, { ...prev, ...e, intent: e.intent ?? prev?.intent }); }
    return m;
  }
  /** Pending or uncertain = not yet acknowledged by a receipt. */
  unacked(): JournalEntry[] { return [...this.entries().values()].filter((e) => e.state !== 'acked'); }
}

export async function submit(store: Store, inboxIssue: number, intent: Intent, journal: Journal | null, faults = new Faults(), maxBytes?: number): Promise<{ commentId: number }> {
  const body = encodeIntent(intent, maxBytes);       // throws over limit: rejected visibly at the edge, never truncated
  journal?.append({ opid: intent.opid, intent, state: 'pending', at: new Date().toISOString() });
  faults.hit('after-journal-before-post');
  const c = await store.createComment(inboxIssue, body);   // NetworkError here => unknown whether it landed => stays 'pending'
  journal?.append({ opid: intent.opid, state: 'submitted', commentId: c.id, at: new Date().toISOString() });
  return { commentId: c.id };
}

/** Adopt only the submitter's unedited intents; acknowledge only unedited writer receipts matching the operation and item. */
export async function reconcileJournal(store: Store, inboxIssue: number, journal: Journal, writerIdentities: readonly string[], maxBytes?: number) {
  const comments = await store.listComments(inboxIssue);
  const byOpid = new Map<string, number>(); const receipts = new Map<number, Receipt[]>();
  for (const c of comments) {
    if (c.updatedAt !== c.createdAt) continue;
    if (c.author === store.actor() && c.body.startsWith(INTENT_MARK)) { const p = parseIntent(c, maxBytes); if (p.ok && !byOpid.has(p.intent.opid)) byOpid.set(p.intent.opid, c.id); }
    if (writerIdentities.includes(c.author)) {
      const r = parseReceipt(c.body);
      if (r) { const candidates = receipts.get(r.intentCommentId) ?? []; candidates.push(r); receipts.set(r.intentCommentId, candidates); }
    }
  }
  const out = { resubmitted: 0, adopted: 0, acked: 0 };
  for (const e of journal.entries().values()) {
    if (e.state === 'acked') continue;
    let cid = byOpid.get(e.opid);
    if (!cid && e.intent) { cid = (await submit(store, inboxIssue, e.intent, journal, new Faults(), maxBytes)).commentId; out.resubmitted++; }
    else if (cid && e.state === 'pending') { journal.append({ opid: e.opid, state: 'submitted', commentId: cid, at: new Date().toISOString() }); out.adopted++; }
    const res = cid ? receipts.get(cid)?.find((r) => r.opid === e.opid && r.item === e.intent?.item) : undefined;
    if (cid && res) { journal.append({ opid: e.opid, state: 'acked', commentId: cid, result: res.result, reason: res.reason, at: new Date().toISOString() }); out.acked++; }
  }
  return out;
}
