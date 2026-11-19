import type { ApprovalRec } from '../state/model.ts';

/** Discord approval CARDS are notifications, never decisions. A decision is accepted only from a verified maintainer comment on GitHub (the writer verifies the
 *  comment's author and edit state). A card therefore carries the exact command to paste on GitHub and a link button, and NEVER an approve/deny button: nothing
 *  that happens in Discord can record, imply or replace a decision. */
export interface Card { key: string; state: ApprovalRec['status']; title: string; description: string; fields: Array<{ name: string; value: string }>; linkUrl: string; color: number }
const COLORS: Record<string, number> = { pending: 0xf0b232, approved: 0x23a55a, denied: 0xda373c, expired: 0x80848e, invalidated: 0x80848e };
const safe = (s: string, n: number) => s.replace(/[`*_~|>@#\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function renderApprovalCard(a: ApprovalRec, o: { repo: string; item: number; itemUrl: string; now: number }): Card {
  const expired = a.status === 'pending' && !!a.expiresAt && o.now >= Date.parse(a.expiresAt); const state = expired ? 'expired' : a.status;
  const live = state === 'pending';
  const cmd = `/warden approve ${a.id} bind=${a.bindingDigest}`; const deny = `/warden deny ${a.id} bind=${a.bindingDigest}`;
  return {
    key: `${a.id}:${a.bindingDigest}`, state, color: COLORS[state] ?? 0x80848e, linkUrl: o.itemUrl,
    title: `${state === 'pending' ? 'Approval needed' : `Approval ${state}`}: ${safe(a.action, 60)} on #${o.item}`,
    description: live
      ? `A maintainer decides on GitHub, never here. Comment on ${o.repo}#${o.item}:\n\`${cmd}\`\nor \`${deny}\`. Silence and expiry grant nothing.`
      : `This approval is ${state}${a.decidedBy ? ` (decided by ${safe(a.decidedBy, 40)} on GitHub)` : ''}${a.invalidReason ? `: ${safe(a.invalidReason, 60)}` : ''}. This card grants nothing.`,
    fields: [{ name: 'Type', value: safe(a.type, 40) }, { name: 'Binding', value: `\`${a.bindingDigest}\`` }, { name: 'Expires', value: a.expiresAt ?? 'persists until materially changed' }],
  };
}
