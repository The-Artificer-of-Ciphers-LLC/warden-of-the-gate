import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store } from './store.ts';
import { Faults } from './util.ts';
import { INTENT_MARK, encodeIntent, parseIntent, parseReceipt } from './protocol.ts';
import type { Intent } from './protocol.ts';

export interface JournalEntry { opid: string; intent?: Intent; state: 'pending' | 'submitted' | 'acked'; commentId?: number; result?: string; at: string }

/** Protected local write-ahead journal (Mac). An intent is durable HERE (fsync, mode 0600) before any network call. */
export class Journal {
  path: string;
  constructor(path: string) { this.path = path; mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600)); }
  append(e: JournalEntry) { const fd = openSync(this.path, 'a', 0o600); try { writeSync(fd, JSON.stringify(e) + '\n'); fsyncSync(fd); } finally { closeSync(fd); } }
  entries(): Map<string, JournalEntry> {
    const m = new Map<string, JournalEntry>();
    for (const line of readFileSync(this.path, 'utf8').split('\n').filter(Boolean)) { const e = JSON.parse(line) as JournalEntry; const prev = m.get(e.opid); m.set(e.opid, { ...prev, ...e, intent: e.intent ?? prev?.intent }); }
    return m;
  }
}
void appendFileSync;

export async function submit(store: Store, inboxIssue: number, intent: Intent, journal: Journal | null, faults = new Faults()): Promise<{ commentId: number }> {
  const body = encodeIntent(intent);                 // throws on payload over limit: rejected visibly at the edge, never truncated
  journal?.append({ opid: intent.opid, intent, state: 'pending', at: new Date().toISOString() });
  faults.hit('after-journal-before-post');
  const c = await store.createComment(inboxIssue, body);   // NetworkError here = unknown whether it landed => stays 'pending'
  journal?.append({ opid: intent.opid, state: 'submitted', commentId: c.id, at: new Date().toISOString() });
  return { commentId: c.id };
}

/** Recovery on the Mac: resubmit what never landed, adopt what did (lost reply), mark acked from receipts. */
export async function reconcileJournal(store: Store, inboxIssue: number, journal: Journal) {
  const comments = await store.listComments(inboxIssue);
  const byOpid = new Map<string, number>(); const receipts = new Map<number, string>();
  for (const c of comments) {
    if (c.body.startsWith(INTENT_MARK)) { const p = parseIntent(c); if (p.ok && !byOpid.has(p.intent.opid)) byOpid.set(p.intent.opid, c.id); }
    const r = parseReceipt(c.body); if (r) receipts.set(r.intentCommentId, r.result);
  }
  const out = { resubmitted: 0, adopted: 0, acked: 0 };
  for (const e of journal.entries().values()) {
    if (e.state === 'acked') continue;
    let cid = byOpid.get(e.opid);
    if (!cid && e.intent) { cid = (await submit(store, inboxIssue, e.intent, journal)).commentId; out.resubmitted++; }
    else if (cid && e.state === 'pending') { journal.append({ opid: e.opid, state: 'submitted', commentId: cid, at: new Date().toISOString() }); out.adopted++; }
    const res = cid ? receipts.get(cid) : undefined;
    if (cid && res) { journal.append({ opid: e.opid, state: 'acked', commentId: cid, result: res, at: new Date().toISOString() }); out.acked++; }
  }
  return out;
}
