import type { Effect, Ledger, WorkflowState } from '../state/model.ts';
import { canOverride, canTransition } from '../state/model.ts';
import type { PolicySnapshot } from '../config/snapshot.ts';
import type { Intent } from './protocol.ts';
import { decideApproval, requestApproval, revisionUpdate } from '../approvals/approvals.ts';
import type { Decision } from '../approvals/approvals.ts';
import { iso } from '../util.ts';

export interface ReduceCtx { policy: PolicySnapshot; now: number; sourceVerified: boolean; assignable: (login: string) => boolean }
const note = (text: string): Effect => ({ t: 'comment', text });
const rej = (reason: string, text: string): Decision => ({ accept: false, reason, plan: [note(text)] });

function project(policy: PolicySnapshot, from: string, to: string): Effect[] {
  if (!policy.projection) return [];
  const add = policy.labelStates[to]; const remove = policy.labelStates[from];
  return add || remove ? [{ t: 'label', add: add && add !== remove ? [add] : [], remove: remove && remove !== add ? [remove] : [] }] : [];
}
function moveTo(l: Ledger, to: WorkflowState, blocker?: { reason: string; resumeTo: WorkflowState }, now?: number) {
  if (l.state === 'blocked' && to !== 'blocked') delete l.blocker;
  l.state = to;
  if (to === 'blocked' && blocker) l.blocker = { ...blocker, at: iso(now ?? 0) };
}

/** Pure decision for one intent against CURRENT ledger state (serialization alone would only order two overwrites; these checks make the second lose). */
export function reduce(i: Intent, l: Ledger, c: ReduceCtx): Decision {
  const pl = i.payload as any;
  switch (i.kind) {
    case 'claim': {
      const cl = pl.claimant as { kind: 'contributor' | 'factory'; id: string } | undefined;
      if (l.kind !== 'issue') return rej('claim-on-pr', 'Claims apply to issues only.');
      if (!cl?.id || cl.id !== i.actor) return rej('claimant-actor-mismatch', 'Claim rejected: the requesting identity does not match the claimant.');
      if (l.state === 'ready' && !l.owner) {
        const plan: Effect[] = [];
        if (cl.kind === 'contributor' && c.assignable(cl.id)) plan.push({ t: 'assign', login: cl.id });
        plan.push(...project(c.policy, 'ready', 'claimed'), note(`Claim accepted: ${cl.kind} ${cl.id} now owns this item.`));
        return { accept: true, plan, apply: (led) => { led.state = 'claimed'; led.owner = { kind: cl.kind, id: cl.id, opid: i.opid }; } };
      }
      return rej(`already-owned-by:${l.owner?.id ?? 'n/a'}`, l.owner ? `Claim by ${cl.id} rejected: this item is already owned by ${l.owner.id}.` : `Claim by ${cl.id} rejected: item is ${l.state}, not claimable.`);
    }
    case 'release': {
      if (l.owner && l.owner.id === i.actor) return { accept: true, plan: [...project(c.policy, 'claimed', 'ready'), note(`Released by ${i.actor}.`)], apply: (led) => { led.state = 'ready'; led.owner = null; } };
      return rej('not-owner', `Release by ${i.actor} rejected: not the current owner.`);
    }
    case 'note': return { accept: true, plan: [note(String(pl.text ?? 'note'))] };
    case 'transition': {
      const to = String(pl.to ?? ''); const from = l.state;
      if (pl.expectFrom && pl.expectFrom !== from) return rej(`stale-transition:expected-${pl.expectFrom}-found-${from}`, `Transition rejected: item is now \`${from}\`, not \`${pl.expectFrom}\`.`);
      const ok = canTransition(l.kind, from, to); if (!ok.ok) return rej(ok.reason, `Transition to \`${to}\` rejected: ${ok.reason}.`);
      if (to === 'merged' && pl.reconciled !== true) return rej('merge-not-reconciled', '`merged` is recorded only after GitHub confirms the merge (reconciliation); enqueue is not merge.');
      if (to === 'blocked' && !(pl.blocker?.reason && pl.blocker?.resumeTo)) return rej('blocker-details-required', 'Blocked requires a reason and intended resumption state.');
      return { accept: true, plan: [...project(c.policy, from, to), note(`Workflow state: \`${from}\` -> \`${to}\`${pl.reason ? ` (${String(pl.reason).slice(0, 200)})` : ''}.`)], apply: (led) => moveTo(led, to as WorkflowState, pl.blocker, c.now) };
    }
    case 'override': {
      if (!c.sourceVerified) return rej('unverified-source', 'Override rejected: the GitHub source could not be verified.');
      if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Override by ${i.actor} rejected: not an authorized maintainer.`);
      const to = String(pl.to ?? ''); const ok = canOverride(l.kind, l.state, to); if (!ok.ok) return rej(ok.reason, `Override rejected: ${ok.reason}.`);
      if (!pl.reason) return rej('override-reason-required', 'Override rejected: a reason is required for the audit record.');
      const from = l.state;
      return { accept: true, plan: [...project(c.policy, from, to), note(`Maintainer override by ${i.actor}: \`${from}\` -> \`${to}\` (${String(pl.reason).slice(0, 200)}).`)], apply: (led) => moveTo(led, to as WorkflowState, pl.blocker ?? (to === 'blocked' ? { reason: String(pl.reason), resumeTo: from } : undefined), c.now) };
    }
    case 'approval-request': return requestApproval(l, i, c);
    case 'approval-decision': return decideApproval(l, i, c);
    case 'revision-update': return revisionUpdate(l, i, c);
  }
}
