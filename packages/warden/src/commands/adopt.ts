import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Journal } from '../writer/journal.ts';
import { checkSelection, inventory, submitAdoption } from '../tasks/adopt.ts';
import type { Selection } from '../tasks/adopt.ts';
import { loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';

/** `warden adopt --dry-run [--out FILE]` prints an inventory of existing items without Warden state (read-only).
 *  `warden adopt --selection FILE --confirm` submits ONLY the selected items through the writer inbox and writes a receipt.
 *  Adoption is never part of `setup` or `run`. Syntax: PRD section 10 (proposed; awaiting owner review). */
export async function adopt(c: Ctx): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'adopt: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const be = openBackend(c, cfg); const op = be.open('operator');
  if (!op) return { code: 4, data: {}, text: `adopt blocked: ${be.unavailable}` };
  const skip = new Set<number>([cfg.inbox.inboxIssue, cfg.inbox.controlIssue, ...(cfg.inbox.globalControl?.repository === cfg.repository ? [cfg.inbox.globalControl.issue] : [])]);
  const inv = await inventory(op, cfg, { now: c.now(), skip });
  const selFile = str(c.flags, 'selection');
  if (c.flags['dry-run'] || !selFile) {
    if (!c.flags['dry-run']) return { code: 2, data: {}, text: 'adopt: use --dry-run to list the inventory, or --selection FILE --confirm to adopt selected items' };
    const out = str(c.flags, 'out'); if (out) writeFileSync(resolve(c.cwd, out), JSON.stringify(inv, null, 2) + '\n');
    const text = `adopt (dry-run): ${inv.items.length} existing item(s) without Warden state, inventory ${inv.digest}; nothing was written to the repository${out ? `; inventory saved to ${out}` : ''}\n`
      + inv.items.map((i) => `  #${i.item} ${i.kind}${i.draft ? ' (draft)' : ''} -> ${i.proposedState}${i.existingOwner ? `, owner ${i.existingOwner} preserved` : ''}${i.needsDraftDecision ? ' [needs explicit draft keep/close]' : ''}: ${i.title}`).join('\n');
    return { code: 0, data: { ...inv, mutations: 0 }, text };
  }
  const path = resolve(c.cwd, selFile); if (!existsSync(path)) return { code: 2, data: {}, text: `adopt: selection file not found: ${selFile}` };
  let sel: Selection; try { sel = JSON.parse(readFileSync(path, 'utf8')) as Selection; } catch { return { code: 2, data: {}, text: 'adopt: selection file is not valid JSON' }; }
  const chk = checkSelection(sel, inv); if (!chk.ok) return { code: 1, data: { errors: chk.errors }, text: 'adopt refused:\n' + chk.errors.map((e) => '  ' + e).join('\n') };
  if (!c.flags.confirm) return { code: 2, data: { wouldAdopt: chk.chosen.map((i) => i.item) }, text: `adopt: ${chk.chosen.length} item(s) selected (${chk.chosen.map((i) => '#' + i.item).join(', ')}); re-run with --confirm to submit. Each gets a published adoption notice and new clocks from that notice.` };
  const sub = be.open('submit'); if (!sub) return { code: 4, data: {}, text: `adopt blocked: ${be.unavailable}` };
  const operator = str(c.flags, 'as') ?? cfg.operators[0] ?? cfg.maintainers[0];
  let journal: Journal | null = null; let st; try { st = openStorage(c, cfg.repository); journal = new Journal(st.journalPath); } catch { /* Actions-side: no local state */ }
  const { receipt } = await submitAdoption(sel, inv, cfg, { submitStore: sub, inboxIssue: cfg.inbox.inboxIssue, now: c.now(), operator, journal });
  const file = st ? st.path(`adoption-receipt-${receipt.at.replace(/[:.]/g, '-')}.json`) : undefined; if (st && file) st.writeJson(file, receipt);
  return { code: 0, data: { receipt, receiptFile: file }, text: `adopt: ${receipt.submitted.length} item(s) submitted to the writer inbox (inventory ${receipt.inventoryDigest}); the writer decides each and posts the adoption notice${file ? `; receipt saved to ${file}` : ''}. Run \`warden writer drain\` to process.` };
}
