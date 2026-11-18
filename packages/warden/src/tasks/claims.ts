import type { Store } from '../github/store.ts';
import { readOnly } from '../github/store.ts';
import type { WardenConfig } from '../config/load.ts';
import { INTENT_MARK, LEDGER_MARK, RECEIPT_MARK, makeIntent, parseLedger } from '../writer/protocol.ts';
import { parseMaintainerCommand } from '../approvals/approvals.ts';
import { submit } from '../writer/journal.ts';
import type { Journal } from '../writer/journal.ts';
import type { Ledger } from '../state/model.ts';
import { iso } from '../util.ts';

/** Claim task (deterministic backstop for the `/warden claim` doorbell): find open, ready, unowned issues with an unedited `/warden claim` comment, and submit
 *  the EARLIEST valid one as a claim intent attributed to that comment's author. The writer re-verifies the comment, re-checks ownership against GitHub and
 *  decides; a commenter can never claim for someone else, and an item already assigned on GitHub is skipped. */
export interface ClaimFinding { item: number; claimant: string; commentId: number; at: string }
const machinery = (b: string) => [INTENT_MARK, RECEIPT_MARK, LEDGER_MARK].some((m) => b.startsWith(m)) || b.includes('<!-- warden-effect');
export async function planClaims(rawStore: Store, cfg: WardenConfig, o: { skip?: Set<number>; items?: number[] } = {}): Promise<{ found: ClaimFinding[]; skipped: Array<{ item: number; why: string }> }> {
  const store = readOnly(rawStore); const found: ClaimFinding[] = []; const skipped: Array<{ item: number; why: string }> = [];
  const issues = o.items?.length ? await Promise.all(o.items.map((n) => store.getIssue(n))) : await store.listIssues({ state: 'open' });
  for (const it of issues.filter((i) => !i.isPr && i.state === 'open' && !(o.skip ?? new Set()).has(i.number))) {
    const cs = await store.listComments(it.number); const l = cs.filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean) as Ledger | undefined;
    if (!l || l.state !== 'ready' || l.owner || l.paused) continue;
    const c = cs.filter((x) => !machinery(x.body) && x.updatedAt === x.createdAt && parseMaintainerCommand(x.body)?.kind === 'claim').sort((a, b) => a.id - b.id)[0];
    if (!c) continue;
    if (it.assignees.some((a) => a !== c.author)) { skipped.push({ item: it.number, why: `already assigned on GitHub to ${it.assignees.join(', ')}` }); continue; }
    if (c.author.endsWith('[bot]')) { skipped.push({ item: it.number, why: 'bots cannot claim' }); continue; }
    found.push({ item: it.number, claimant: c.author, commentId: c.id, at: c.createdAt });
  }
  void cfg; return { found, skipped };
}
export async function submitClaims(found: ClaimFinding[], o: { submitStore: Store; repo: string; inboxIssue: number; now: number; journal?: Journal | null }): Promise<number[]> {
  const done: number[] = [];
  for (const f of found) {
    const intent = makeIntent({ v: 1, kind: 'claim', repo: o.repo, item: f.item, itemKind: 'issue', origin: 'deterministic', source: { kind: 'gh-comment', id: String(f.commentId), observedAt: f.at }, actor: f.claimant, payload: { claimant: { kind: 'contributor', id: f.claimant } } });
    await submit(o.submitStore, o.inboxIssue, intent, o.journal ?? null); done.push(f.item);
  }
  void iso; return done;
}
