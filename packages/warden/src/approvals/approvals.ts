import type { ApprovalBinding, ApprovalRec, Effect, Ledger } from '../state/model.ts';
import type { PolicySnapshot } from '../config/snapshot.ts';
import { evaluate } from '../config/policy.ts';
import type { ActionQuery } from '../config/policy.ts';
import type { Intent } from '../writer/protocol.ts';
import { digest, iso } from '../util.ts';

/** Decision produced by a reducer. `apply` runs before the commit even when `accept` is false (e.g. marking an approval expired). */
export interface DecisionRecord { approvalId: string; item: number; action: string; type: string; decision: 'approved' | 'denied'; by: string; at: string; source: string; reason?: string; binding: ApprovalBinding; policyDigest: string }
export interface Decision { accept: boolean; reason?: string; plan: Effect[]; apply?: (l: Ledger) => void; corpus?: DecisionRecord }
export interface ApprovalCtx { policy: PolicySnapshot; now: number; sourceVerified: boolean }

export const bindDigest = (b: ApprovalBinding) => digest(b).slice(0, 12);
const note = (text: string): Effect => ({ t: 'comment', text });
const rej = (reason: string, text: string, apply?: (l: Ledger) => void): Decision => ({ accept: false, reason, plan: [note(text)], apply });

export type MaintainerCommand =
  | { kind: 'approval-decision'; payload: { approvalId: string; decision: 'approve' | 'deny'; bind?: string; reason?: string } }
  | { kind: 'override'; payload: { to: string; reason: string } }
  | { kind: 'hold'; payload: { reason: string } }
  | { kind: 'hold-release'; payload: { reason?: string } }
  | { kind: 'resume-scope'; payload: { reason: string } };
export function parseMaintainerCommand(body: string): MaintainerCommand | null {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l.startsWith('/warden'));
  if (!line) return null;
  const decision = /^\/warden\s+(approve|deny)\s+(apr_[0-9a-f]{6,})(?:\s+bind=([0-9a-f]{6,}))?(?:\s+(.*))?$/.exec(line);
  if (decision) return { kind: 'approval-decision', payload: { approvalId: decision[2], decision: decision[1] === 'approve' ? 'approve' : 'deny', bind: decision[3], reason: decision[4]?.trim() || undefined } };
  const hold = /^\/warden\s+hold\s+(.+)$/.exec(line);
  if (hold) return { kind: 'hold', payload: { reason: hold[1].trim() } };
  const rel = /^\/warden\s+release-hold(?:\s+(.*))?$/.exec(line);
  if (rel) return { kind: 'hold-release', payload: { reason: rel[1]?.trim() || undefined } };
  const resume = /^\/warden\s+resume-scope\s+(.+)$/.exec(line);
  if (resume) return { kind: 'resume-scope', payload: { reason: resume[1].trim() } };
  const override = /^\/warden\s+override\s+([a-z-]+)\s+(.+)$/.exec(line);
  return override ? { kind: 'override', payload: { to: override[1], reason: override[2].trim() } } : null;
}

/** Mark pending approvals past their expiry as expired. Silence and expiry NEVER grant consent. Returns whether the ledger changed. */
export function expireApprovals(l: Ledger, now: number): boolean {
  let changed = false;
  for (const a of Object.values(l.approvals)) if (a.status === 'pending' && a.expiresAt && now >= Date.parse(a.expiresAt)) { a.status = 'expired'; changed = true; }
  return changed;
}
/** Material change since an approval was granted/requested? feature-design binds the criteria revision only; actions bind revision+policy+evidence. */
export function bindingStale(a: ApprovalRec, l: Ledger, policy: PolicySnapshot): string | null {
  if (a.type === 'feature-design') return l.evidence.criteriaDigest && l.evidence.criteriaDigest !== a.binding.revision ? 'criteria-changed' : null;
  if (l.evidence.revision && l.evidence.revision !== a.binding.revision) return 'revision-changed';
  if (policy.digest !== a.binding.policyDigest) return 'policy-changed';
  if (l.evidence.evidenceDigest && l.evidence.evidenceDigest !== a.binding.evidenceDigest) return 'evidence-changed';
  return null;
}

export function requestApproval(l: Ledger, i: Intent, c: ApprovalCtx): Decision {
  const p = i.payload as { type?: string; action?: string; binding?: ApprovalBinding; subjectAuthor?: string; query?: ActionQuery };
  if (!p.action || !p.binding?.revision || !p.binding.policyDigest || p.binding.evidenceDigest === undefined) return rej('invalid-approval-request', 'Approval request rejected: action and a full binding (revision, policy, evidence) are required.');
  const type = p.type === 'feature-design' ? 'feature-design' : 'action';
  if (type === 'feature-design' && !(l.kind === 'issue' && ['feature', 'enhancement'].includes(String(l.facets.workKind)))) return rej('feature-design-not-applicable', 'Feature-design approval applies only to feature/enhancement issues.');
  if (p.binding.policyDigest !== c.policy.digest && type === 'action') return rej('stale-request:policy', 'Approval request rejected: it was built against a different policy than the approved default-branch policy.');
  if (type === 'action' && l.evidence.revision && l.evidence.revision !== p.binding.revision) return rej('stale-request:revision', 'Approval request rejected: it names a revision that is no longer current.');
  if (p.query) { const d = evaluate(c.policy.orders, p.query); if (d.decision === 'deny') return rej('denied-by-orders', `Approval cannot be requested: standing orders deny this action (${d.reasons.join('; ')}). Denial prevails.`); }
  const id = 'apr_' + i.opid.slice(3, 15);
  if (l.approvals[id]) return { accept: false, reason: 'duplicate-request', plan: [] };
  const expiresAt = type === 'feature-design' ? null : iso(c.now + c.policy.actionExpiryHours * 3600_000);
  const bd = bindDigest(p.binding);
  return {
    accept: true,
    apply: (led) => {
      for (const a of Object.values(led.approvals)) if (a.status === 'pending' && a.action === p.action && a.type === type) { a.status = 'invalidated'; a.invalidReason = 'superseded'; }
      led.approvals[id] = { id, type, action: p.action!, binding: p.binding!, bindingDigest: bd, subjectAuthor: p.subjectAuthor, requestedBy: i.actor, requestedAt: iso(c.now), expiresAt, status: 'pending' };
      if (!led.evidence.revision && type === 'action') led.evidence = { ...led.evidence, revision: p.binding!.revision, evidenceDigest: p.binding!.evidenceDigest, policyDigest: p.binding!.policyDigest };
    },
    plan: [note(`Approval requested \`${id}\` for **${p.action}** (${type}). Bound to revision \`${p.binding.revision.slice(0, 12)}\`, policy \`${p.binding.policyDigest.slice(0, 8)}\`. ${expiresAt ? `Expires ${expiresAt} (silence and expiry grant nothing).` : 'Persists until the scope/criteria materially change.'}\nAuthorized maintainers: reply \`/warden approve ${id} bind=${bd}\` or \`/warden deny ${id} bind=${bd} <reason>\`.`)],
  };
}

export function decideApproval(l: Ledger, i: Intent, c: ApprovalCtx): Decision {
  const p = i.payload as { approvalId?: string; decision?: string; bind?: string; reason?: string };
  const a = p.approvalId ? l.approvals[p.approvalId] : undefined;
  if (!a) return rej('unknown-approval', `Decision rejected: no approval \`${p.approvalId}\` on this item.`);
  if (p.decision !== 'approve' && p.decision !== 'deny') return rej('invalid-decision', 'Decision rejected: expected approve or deny.');
  if (!c.sourceVerified) return rej('unverified-source', 'Decision rejected: the GitHub source of this decision could not be verified (comment author/edit state).');
  if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Decision by ${i.actor} rejected: not an authorized maintainer of this repository. Nothing was recorded as approval.`);
  if (a.status === 'approved' || a.status === 'denied') {
    const same = (a.status === 'approved') === (p.decision === 'approve') && a.decidedBy === i.actor;
    if (same) return rej('replayed-decision', `Decision ignored: \`${a.id}\` was already ${a.status} by ${a.decidedBy}. Replays have no effect.`);
    return rej('conflicting-decision', `Conflicting maintainer decisions on \`${a.id}\` (already ${a.status} by ${a.decidedBy}; now ${p.decision} by ${i.actor}). The first recorded decision stands; escalate to resolve.`);
  }
  if (a.status === 'expired' || a.status === 'invalidated') return rej(`stale-approval:${a.status}`, `Decision rejected: \`${a.id}\` is ${a.status}${a.invalidReason ? ` (${a.invalidReason})` : ''}. Request a new approval.`);
  if (a.expiresAt && c.now >= Date.parse(a.expiresAt)) return rej('expired', `Decision rejected: \`${a.id}\` expired at ${a.expiresAt}. Silence and expiry grant nothing; request a new approval.`, (led) => { led.approvals[a.id].status = 'expired'; });
  if (!p.bind) return rej('missing-binding', `Decision rejected: cite the binding shown in the request (\`bind=${a.bindingDigest}\`).`);
  if (p.bind !== a.bindingDigest) return rej('stale-binding', `Decision rejected: bind=${p.bind} does not match the request (\`${a.bindingDigest}\`).`);
  const stale = bindingStale(a, l, c.policy);
  if (stale) return rej(`stale-binding:${stale}`, `Decision rejected: \`${a.id}\` no longer matches the current ${stale.split('-')[0]}. It is invalidated; request a new approval.`, (led) => { led.approvals[a.id].status = 'invalidated'; led.approvals[a.id].invalidReason = stale; });
  if (c.policy.requireIndependentApprover && a.subjectAuthor && a.subjectAuthor === i.actor) return rej('self-approval', `Decision by ${i.actor} rejected: the author of the change cannot approve it (independent approver required).`);
  const status = p.decision === 'approve' ? 'approved' : 'denied'; const at = iso(c.now);
  const rec: DecisionRecord = { approvalId: a.id, item: l.item, action: a.action, type: a.type, decision: status, by: i.actor, at, source: `${i.source.kind}:${i.source.id}`, reason: p.reason, binding: a.binding, policyDigest: c.policy.digest };
  return {
    accept: true, corpus: rec,
    apply: (led) => {
      const x = led.approvals[a.id]; x.status = status; x.decidedBy = i.actor; x.decidedAt = at; x.decisionSource = rec.source; x.reason = p.reason;
      if (status === 'approved' && x.type === 'feature-design' && led.kind === 'issue' && led.state === 'needs-decision') led.state = 'ready';
    },
    plan: [note(`Maintainer decision recorded: \`${a.id}\` **${status}** by ${i.actor}${p.reason ? ` (${p.reason})` : ''}. Recorded before any work is authorized; this does not itself start AI work or override GitHub-required reviews.`)],
  };
}

/** Evidence/revision changed outside a decision: invalidate affected approvals with an auditable reason. */
export function revisionUpdate(l: Ledger, i: Intent, c: ApprovalCtx): Decision {
  const p = i.payload as Partial<{ head: string; base: string; revision: string; evidenceDigest: string; criteriaDigest: string }>;
  return {
    accept: true,
    apply: (led) => {
      if (led.kind === 'issue' && p.head) return; // issues never carry a PR head
      led.evidence = { ...led.evidence, ...(led.kind === 'pr' && p.head ? { head: p.head } : {}), ...(p.base ? { base: p.base } : {}), ...(p.revision ? { revision: p.revision } : {}), ...(p.evidenceDigest !== undefined ? { evidenceDigest: p.evidenceDigest } : {}), ...(p.criteriaDigest ? { criteriaDigest: p.criteriaDigest } : {}), policyDigest: c.policy.digest, updatedAt: iso(c.now) };
      for (const a of Object.values(led.approvals)) {
        if (a.status !== 'pending' && a.status !== 'approved') continue;
        const why = bindingStale(a, led, c.policy);
        if (why) { a.status = 'invalidated'; a.invalidReason = why; }
      }
    },
    plan: [],
  };
}

/** Use-time check: may `action` proceed on this item? Re-evaluates expiry and binding NOW (24h expiry is enforced at use, not only at decision). */
export function checkAuthorized(l: Ledger, action: string, policy: PolicySnapshot, now: number): { ok: true; approval: ApprovalRec } | { ok: false; reason: string } {
  const cands = Object.values(l.approvals).filter((a) => a.action === action);
  if (!cands.length) return { ok: false, reason: 'no-approval' };
  const a = cands.sort((x, y) => y.requestedAt.localeCompare(x.requestedAt))[0];
  if (a.status === 'denied') return { ok: false, reason: 'denied' };
  if (a.status !== 'approved') return { ok: false, reason: a.status === 'pending' ? 'pending' : `not-valid:${a.status}` };
  if (a.expiresAt && now >= Date.parse(a.expiresAt)) return { ok: false, reason: 'expired' };
  const stale = bindingStale(a, l, policy); if (stale) return { ok: false, reason: `stale:${stale}` };
  return { ok: true, approval: a };
}
