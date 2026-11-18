import type { Store } from '../github/store.ts';
import { readOnly } from '../github/store.ts';
import type { WardenConfig } from '../config/load.ts';
import { LEDGER_MARK, makeIntent, parseLedger } from '../writer/protocol.ts';
import { isFresh } from '../sweep/derive.ts';
import { submit } from '../writer/journal.ts';
import type { Journal } from '../writer/journal.ts';
import { canonical, iso, sha256 } from '../util.ts';
import { decideIntake } from './intake.ts';

/** Backlog adoption: dry-run INVENTORY, explicit operator SELECTION, auditable RECEIPT. The files are an input and a receipt, never a second
 *  canonical item ledger: the per-item ledger written by the writer is the only state. Syntax is proposed in PRD section 10 (awaiting owner review). */
export interface InventoryItem {
  item: number; kind: 'issue' | 'pr'; title: string; author: string; assignees: string[]; labels: string[]; draft: boolean; createdAt: string;
  proposedState: string; existingOwner: string | null;
  /** An existing draft while drafts are disallowed needs an explicit keep/close decision in the selection (never mass closure). */
  needsDraftDecision: boolean;
}
export interface Inventory { v: 1; repository: string; generatedAt: string; digest: string; items: InventoryItem[]; notes: string[] }
export interface Selection { v: 1; repository: string; inventoryDigest: string; items: Array<{ item: number; draft?: 'keep' | 'close' }> }

export async function inventory(rawStore: Store, cfg: WardenConfig, o: { now: number; skip?: Set<number> }): Promise<Inventory> {
  const store = readOnly(rawStore); const skip = o.skip ?? new Set<number>(); const items: InventoryItem[] = [];
  for (const it of (await store.listIssues({ state: 'open' })).filter((i) => !skip.has(i.number))) {
    const led = (await store.listComments(it.number)).filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean);
    if (led && !isFresh(led)) continue;   // already has Warden state (a ledger left by a rejected early intent does not count)
    const d = decideIntake(it, { draftsAllowed: cfg.drafts.allowed });
    items.push({ item: it.number, kind: it.isPr ? 'pr' : 'issue', title: it.title.slice(0, 120), author: it.author, assignees: it.assignees, labels: it.labels, draft: !!it.draft, createdAt: it.createdAt,
      proposedState: d.to, existingOwner: it.isPr ? null : it.assignees.find((a) => !cfg.maintainers.includes(a)) ?? null, needsDraftDecision: d.closeDraft });
  }
  items.sort((a, b) => a.item - b.item);
  const notes = ['Inventory only: nothing was written. Adoption starts new clocks at the published adoption notice, never at historical dates, and closes nothing for age.',
    'Existing owners are preserved; existing drafts need an explicit keep/close decision in the selection.'];
  return { v: 1, repository: cfg.repository, generatedAt: iso(o.now), digest: sha256(canonical({ repository: cfg.repository, items })).slice(0, 16), items, notes };
}

export type SelectionCheck = { ok: true; chosen: InventoryItem[] } | { ok: false; errors: string[] };
/** The selection must be bound to the CURRENT inventory: a stale inventory, another repository, unknown or duplicate items, and an
 *  undecided existing draft are refused before anything is submitted. */
export function checkSelection(sel: unknown, inv: Inventory): SelectionCheck {
  const errors: string[] = []; const s = sel as Partial<Selection> | null;
  if (!s || s.v !== 1 || !Array.isArray(s.items)) return { ok: false, errors: ['selection must be {"v":1,"repository","inventoryDigest","items":[...]}'] };
  if (s.repository !== inv.repository) errors.push(`selection is for ${String(s.repository)}, not ${inv.repository}`);
  if (s.inventoryDigest !== inv.digest) errors.push(`selection was made against inventory ${String(s.inventoryDigest)} but the current inventory is ${inv.digest}; re-run \`adopt --dry-run\` and re-select`);
  const seen = new Set<number>(); const chosen: InventoryItem[] = [];
  for (const e of s.items) {
    const found = inv.items.find((x) => x.item === e?.item);
    if (!found) { errors.push(`#${String(e?.item)} is not in the inventory (already adopted, closed or unknown)`); continue; }
    if (seen.has(found.item)) { errors.push(`#${found.item} is selected twice`); continue; } seen.add(found.item);
    if (found.needsDraftDecision && e.draft !== 'keep' && e.draft !== 'close') errors.push(`#${found.item} is an existing draft: choose "draft":"keep" or "draft":"close" explicitly`);
    if (e.draft !== undefined && e.draft !== 'keep' && e.draft !== 'close') errors.push(`#${found.item}: draft must be "keep" or "close"`);
    chosen.push(found);
  }
  if (!s.items.length) errors.push('selection is empty');
  return errors.length ? { ok: false, errors } : { ok: true, chosen };
}

export async function submitAdoption(sel: Selection, inv: Inventory, cfg: WardenConfig, o: { submitStore: Store; inboxIssue: number; now: number; operator: string; journal?: Journal | null }) {
  const chk = checkSelection(sel, inv); if (!chk.ok) throw new Error(chk.errors.join('; '));
  const submitted: Array<{ item: number; opid: string; draft?: 'keep' | 'close' }> = [];
  for (const c of chk.chosen) {
    const pick = sel.items.find((x) => x.item === c.item)!;
    const intent = makeIntent({ v: 1, kind: 'adopt', repo: cfg.repository, item: c.item, itemKind: c.kind, origin: 'maintainer', actor: o.operator,
      source: { kind: 'adopt', id: `adopt:${inv.digest}:${c.item}`, observedAt: iso(o.now) }, payload: { expect: c.proposedState === 'needs-info' || c.proposedState === 'needs-triage' || c.proposedState === 'needs-review' ? c.proposedState : 'needs-triage', draft: pick.draft } });
    await submit(o.submitStore, o.inboxIssue, intent, o.journal ?? null); submitted.push({ item: c.item, opid: intent.opid, draft: pick.draft });
  }
  return { receipt: { v: 1, kind: 'adoption-receipt', repository: cfg.repository, operator: o.operator, at: iso(o.now), inventoryDigest: inv.digest, selectionDigest: sha256(canonical(sel)).slice(0, 16), submitted,
    note: 'Receipt of SUBMISSIONS. The writer decides each item and records its own receipt; the per-item ledger is the only canonical state.' } };
}
