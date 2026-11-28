import { cleanFrozen } from '../verify/frozen.ts';
import { cleanProvenance, provenanceText } from '../runner/provenance.ts';
import type { Provenance } from '../runner/provenance.ts';
import type { Effect, Ledger, Obligation, WorkflowState } from '../state/model.ts';
import { canOverride, canTransition, isTerminal } from '../state/model.ts';
import type { PolicySnapshot } from '../config/snapshot.ts';
import type { Intent } from './protocol.ts';
import { decideApproval, requestApproval, revisionUpdate } from '../approvals/approvals.ts';
import type { Decision } from '../approvals/approvals.ts';
import { iso } from '../util.ts';
import { evaluateClock } from '../sweep/clocks.ts';
import type { IssueState, PullInfo } from '../github/store.ts';
import { bindingFor, evaluateMerge } from '../merge/gates.ts';
import { decideIntake } from '../tasks/intake.ts';
import { clockItemFrom, isFresh, type SweepObs } from '../sweep/derive.ts';

export interface ReduceCtx { policy: PolicySnapshot; now: number; sourceVerified: boolean; assignable: (login: string) => boolean; /** Writer-observed GitHub facts for sweep-action, read at decision time (never taken from the intent). */ observed?: SweepObs; /** Current GitHub item read by the writer at decision time (title/body/assignees/...): intake and claim re-check against it. */ item?: IssueState; /** For `submission`: the linked PR as GitHub shows it now. */ linkedPr?: IssueState; /** For `merge-request`: the pull request as GitHub shows it now. */ pull?: PullInfo; /** For `carry-accounting`: the replaced PR's ledger, read by the writer (never taken from the intent). */ replaced?: Ledger }
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
      if (cl?.kind === 'contributor' && !c.sourceVerified) return rej('unverified-source', 'Claim rejected: it must be a real, unedited comment by the claiming GitHub user (`/warden claim`).');
      if (!cl?.id || cl.id !== i.actor) return rej('claimant-actor-mismatch', 'Claim rejected: the requesting identity does not match the claimant.');
      const others = (c.item?.assignees ?? []).filter((a) => a !== cl.id);   // fresh GitHub ownership check, read at decision time
      if (others.length) return rej(`assigned-on-github-to:${others.join(',')}`, `Claim by ${cl.id} rejected: GitHub already shows this item assigned to ${others.join(', ')}.`);
      if (l.state === 'ready' && !l.owner) {
        const plan: Effect[] = [];
        if (cl.kind === 'contributor' && c.assignable(cl.id)) plan.push({ t: 'assign', login: cl.id });
        const refused = cl.kind === 'contributor' && !c.assignable(cl.id);
        plan.push(...project(c.policy, 'ready', 'claimed'), note(`Claim accepted: ${cl.kind} ${cl.id} now owns this item.${refused ? ' GitHub does not let this repository assign them, so the claim is recorded here only and no GitHub assignment was made.' : ''}`));
        return { accept: true, plan, apply: (led) => {
          led.state = 'claimed'; led.owner = { kind: cl.kind, id: cl.id, opid: i.opid };
          // Contributor commitments start at the confirmed assignment decision (not at issue creation or an old comment). Factory claims carry none.
          const hours = c.policy.sweep?.deliveryHours;
          if (cl.kind === 'contributor' && hours) led.obligations = [...led.obligations.filter((x) => x.type !== 'delivery'), { type: 'delivery', startedAt: iso(c.now), dueAt: iso(c.now + hours * 3_600_000), source: 'assignment' }];
        } };
      }
      return rej(`already-owned-by:${l.owner?.id ?? 'n/a'}`, l.owner ? `Claim by ${cl.id} rejected: this item is already owned by ${l.owner.id}.` : `Claim by ${cl.id} rejected: item is ${l.state}, not claimable.`);
    }
    case 'release': {
      if (l.owner && l.owner.id === i.actor) return { accept: true, plan: [...project(c.policy, 'claimed', 'ready'), note(`Released by ${i.actor}.`)], apply: (led) => { led.state = 'ready'; led.owner = null; led.obligations = led.obligations.filter((x) => x.type !== 'delivery'); } };
      return rej('not-owner', `Release by ${i.actor} rejected: not the current owner.`);
    }
    case 'clear-mutant': return clearMutant(l, i, c);
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
    case 'sweep-action': return sweepAction(l, i, c);
    case 'intake': return intake(l, i, c);
    case 'review-round': return reviewRound(l, i, c);
    case 'submission': return submission(l, i, c);
    case 'hold': return hold(l, i, c);
    case 'hold-release': return holdRelease(l, i, c);
    case 'reconcile': return reconcile(l, i, c);
    case 'adopt': return adopt(l, i, c);
    case 'review-record': return reviewRecord(l, i, c);
    case 'review-post': return reviewPost(l, i, c);
    case 'force-review': return forceReview(l, i, c);
    case 'dismiss-finding': return dismissFinding(l, i, c);
    case 'merge-request': return mergeRequest(l, i, c);
    case 'rework-attempt': return reworkAttempt(l, i, c);
    case 'carry-accounting': return carryAccounting(l, i, c);
    case 'critical-escape': return criticalEscape(l, i, c);
    case 'resume-scope': return resumeScope(l, i, c);
    case 'link-pr': return linkPr(l, i, c);
  }
}

/** Deterministic sweep enforcement. The writer RE-EVALUATES the clock against the CURRENT ledger at decision time and accepts only if the
 *  same verdict still holds, so a stale or replayed sweep cannot close or nudge anything (the second of two racing decisions loses).
 *  Observations (keep-open label, author activity) are read by the writer at decision time, not trusted from the intent. Only comments count as author activity (pushes/reviews are not observable through Store yet). */
function sweepAction(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const pl = i.payload as { expect?: { kind?: string; hours?: number } };
  if (i.origin !== 'deterministic') return rej('sweep-origin', 'Sweep actions are deterministic only.');
  const cfg = c.policy.sweep?.clocks; if (!cfg) return rej('sweep-policy-missing', 'Sweep rejected: no approved clock policy in the snapshot.');
  if (!pl.expect?.kind) return rej('sweep-malformed', 'Sweep rejected: an expectation is required.');
  if (!c.observed) return rej('sweep-unobserved', 'Sweep rejected: the writer could not observe current GitHub state.');
  const due = evaluateClock(clockItemFrom(l, c.observed), { now: iso(c.now), stopped: false, cfg }).due;
  const same = due.kind === pl.expect.kind && (due.kind !== 'nudge' || due.hours === pl.expect.hours) && (due.kind !== 'expire-commitment' || due.commitment === (pl.expect as { commitment?: string }).commitment);
  if (!same) return rej(`stale-sweep:expected-${pl.expect.kind}-found-${due.kind}`, `Sweep rejected: the clock no longer says ${pl.expect.kind}.`);
  if (due.kind === 'nudge') {
    const keep = l.sweep?.since === due.since ? l.sweep.nudgesSent : [];
    const left = due.hours === 48 ? 'about three days remain before a five-day closure' : 'closure follows at five days of silence';
    return { accept: true, plan: [note(`Friendly reminder (${due.hours}h without a response): the author's reply or update is still needed; ${left}. A comment, push or review reply restarts the silence clock.`)],
      apply: (led) => { led.sweep = { since: due.since, nudgesSent: [...new Set([...keep, due.hours])] }; } };
  }
  if (due.kind === 'close-silence' || due.kind === 'close-information') {
    const ok = canTransition(l.kind, l.state, 'closed'); if (!ok.ok) return rej(ok.reason, `Sweep closure rejected: ${ok.reason}.`);
    const from = l.state;
    const retained = l.kind === 'pr' && l.linked.length ? ` Linked issue${l.linked.length > 1 ? 's' : ''} ${l.linked.map((n) => '#' + n).join(', ')} remain open with the partial-work references.` : '';
    const why = due.kind === 'close-silence' ? `no author response since ${due.since}` : `the requested reporter information was not received since ${due.since}`;
    const back = l.kind === 'pr' ? 'You can reopen this PR or open a new one when the requested changes are ready.' : 'Reply with the requested information and a maintainer or the sweep can reopen it.';
    return { accept: true, plan: [...project(c.policy, from, 'closed'), note(`Closing this ${l.kind === 'pr' ? 'PR' : 'issue'} automatically: ${why}.${retained} ${back}`), { t: 'close' }], apply: (led) => moveTo(led, 'closed', undefined, c.now) };
  }
  if (due.kind === 'close-draft') {
    const ok = canTransition(l.kind, l.state, 'closed'); if (!ok.ok) return rej(ok.reason, `Draft closure rejected: ${ok.reason}.`);
    return { accept: true, plan: [...project(c.policy, l.state, 'closed'), note(DRAFT_NOTE(l)), { t: 'close' }], apply: (led) => moveTo(led, 'closed', undefined, c.now) };
  }
  if (due.kind === 'expire-commitment') {
    const refs = l.linked.length ? ` Partial-work references retained: ${l.linked.map((n) => '#' + n).join(', ')}.` : '';
    const from = l.state;
    if (l.kind === 'issue') {
      if (due.commitment !== 'delivery') return rej('commitment-kind-mismatch', 'Expiry rejected: only a delivery commitment applies to an issue claim.');
      const o = l.owner; if (!o || o.kind !== 'contributor') return rej('no-contributor-owner', 'Expiry rejected: there is no contributor claim to release.');
      const ok = canTransition('issue', from, 'ready'); if (!ok.ok) return rej(ok.reason, `Release rejected: ${ok.reason}.`);
      return { accept: true, plan: [{ t: 'unassign', login: o.id }, ...project(c.policy, from, 'ready'), note(`The delivery commitment by ${o.id} expired at ${due.dueAt} without a complete submission, so the claim is released and the issue stays open for others.${refs}`)],
        apply: (led) => { moveTo(led, 'ready', undefined, c.now); led.owner = null; led.obligations = led.obligations.filter((x) => !(x.type === 'delivery' && x.dueAt === due.dueAt)); } };
    }
    if (due.commitment !== 'fix-window') return rej('commitment-kind-mismatch', 'Expiry rejected: only a fix window applies to a PR.');
    const fw = l.obligations.find((x) => x.type === 'fix-window' && x.dueAt === due.dueAt); const fixHours = fw ? Math.round((Date.parse(fw.dueAt) - Date.parse(fw.startedAt)) / 3_600_000) : '?';
    const ok = canTransition('pr', from, 'closed'); if (!ok.ok) return rej(ok.reason, `Closure rejected: ${ok.reason}.`);
    return { accept: true, plan: [...project(c.policy, from, 'closed'), note(`Closing this PR automatically: the ${fixHours}-hour fix window ended at ${due.dueAt} without the requested changes.${refs} The original issue stays open; you can reopen this PR or open a new one when the changes are ready.`), { t: 'close' }],
      apply: (led) => moveTo(led, 'closed', undefined, c.now) };
  }
  return rej(`unsupported-sweep-verdict:${due.kind}`, `Sweep verdict ${due.kind} is not enforceable by the writer yet.`);
}

/** Live intake for ONE explicit item. Only a fresh ledger (no prior operations, owner or obligations, still in its initial state) is eligible:
 *  intake is how NEW items enter, never a way to adopt existing backlog. The writer re-derives the decision from the current GitHub item. */
function intake(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const pl = i.payload as { expect?: string };
  if (i.origin !== 'deterministic') return rej('intake-origin', 'Intake is deterministic only.');
  if (!c.item) return rej('intake-unobserved', 'Intake rejected: the writer could not observe the item.');
  const initial = l.kind === 'issue' ? 'needs-triage' : 'needs-review';
  void initial; if (!isFresh(l)) return { accept: false, reason: 'already-adopted', plan: [] };
  const d = decideIntake({ title: c.item.title, body: c.item.body, isPr: c.item.isPr, draft: c.item.draft }, { draftsAllowed: c.policy.draftsAllowed ?? false });
  if (d.to !== pl.expect) return { accept: false, reason: `stale-intake:expected-${pl.expect}-found-${d.to}`, plan: [] };   // silent: not a contributor-facing event
  const days = c.policy.sweep?.clocks.otherInformationDays;
  if (d.closeDraft) return { accept: true, plan: [note(DRAFT_NOTE(l)), { t: 'close' }], apply: (led) => moveTo(led, 'closed', undefined, c.now) };
  const add = c.policy.labelStates[d.to]; const drop = d.to === initial ? undefined : c.policy.labelStates[initial];   // a brand-new item has no state label yet
  const plan: Effect[] = c.policy.projection && (add || drop) ? [{ t: 'label', add: add ? [add] : [], remove: drop ? [drop] : [] }] : [];
  if (d.needsInfo) plan.push(note(`Thanks for opening this. Some required information is missing (${d.reasons[0].replace('missing required information ', '')}). Please add it${days ? ` within ${days} days` : ''}; if nothing arrives the issue is closed with a note on how to reopen it.`));
  return { accept: true, plan, apply: (led) => {
    if (d.to !== led.state) moveTo(led, d.to, undefined, c.now);
    if (d.needsInfo && days) led.obligations = [{ type: 'information', startedAt: iso(c.now), dueAt: iso(c.now + days * 86_400_000), source: 'metadata' }];
  } };
}

const DRAFT_NOTE = (l: Ledger) => `Closing this PR: draft pull requests are not accepted by this repository's policy. Mark it ready for review when it is complete and reopen it or open a new PR. Nothing was marked ready on your behalf${l.owner ? '; any existing assignment or delivery commitment is unchanged' : ''}.`;
const HOURS = 3_600_000;
const open = (o: Obligation) => (o.type === 'delivery' || o.type === 'fix-window') && !o.satisfiedAt;

/** A published substantive BLOCKING review starts a fresh fix window for the author; waiting on review/CI is never author time.
 *  Beyond the configured number of timely rounds the PR goes to the maintainer (never auto-closed for that reason alone) unless an
 *  `extra-fix-round` approval is in force. The review text itself is a P3 concern: this records the obligation and state only. */
function reviewRound(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const pl = i.payload as { blocking?: boolean };
  if (i.origin !== 'deterministic') return rej('review-round-origin', 'Review rounds are recorded deterministically only.');
  if (l.kind !== 'pr') return rej('review-round-on-issue', 'Review rounds apply to PRs only.');
  const sw = c.policy.sweep; if (!sw) return rej('sweep-policy-missing', 'No approved clock policy in the snapshot.');
  if (pl.blocking !== true) return { accept: true, plan: [] };
  const from = l.state; const rounds = l.attempts.contributorFixRounds + 1;
  const extra = Object.values(l.approvals).some((a) => a.action === 'extra-fix-round' && a.status === 'approved');
  const keep = (led: Ledger) => led.obligations.filter((o) => o.type !== 'fix-window' && o.type !== 'response');
  if (rounds > sw.contributorFixRounds && !extra) {
    const ok = canTransition('pr', from, 'needs-decision'); if (!ok.ok) return rej(ok.reason, `Routing to the maintainer rejected: ${ok.reason}.`);
    return { accept: true, plan: [...project(c.policy, from, 'needs-decision'), note(`Contributor fix rounds are exhausted (${sw.contributorFixRounds} timely rounds). A maintainer decides what happens next; the PR is not closed for this reason alone.`)],
      apply: (led) => { led.attempts.contributorFixRounds = rounds; led.obligations = keep(led); led.sweep = undefined; moveTo(led, 'needs-decision', undefined, c.now); } };
  }
  const to: WorkflowState = 'needs-author'; const ok = from === to ? { ok: true as const } : canTransition('pr', from, to); if (!ok.ok) return rej(ok.reason, `Review round rejected: ${ok.reason}.`);
  const due = iso(c.now + sw.fixWindowHours * HOURS);
  return { accept: true, plan: [...(from === to ? [] : project(c.policy, from, to)), note(`A blocking review was published. You have ${sw.fixWindowHours} hours (until ${due}) to push the requested changes; time spent waiting on review or CI does not count against you. Comments or placeholder pushes do not extend the window.`)],
    apply: (led) => { led.attempts.contributorFixRounds = rounds; led.sweep = undefined; if (from !== to) moveTo(led, to, undefined, c.now);
      led.obligations = [...keep(led), { type: 'fix-window', startedAt: iso(c.now), dueAt: due, source: `blocking-review:${i.source.id}` }, { type: 'response', startedAt: iso(c.now), dueAt: iso(c.now + c.policy.sweep!.clocks.closeAfterHours * HOURS), source: `blocking-review:${i.source.id}` }]; } };
}

/** Record a TIMELY ready-for-review submission BEFORE any semantic assessment, so delayed review/CI/AI cannot falsely expire it.
 *  A draft/placeholder is not delivery. The submission time is the reported observation clamped into [obligation start, decision time];
 *  a late submission is not recorded as timely (the sweep decides the missed commitment). */
function submission(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (i.origin !== 'deterministic') return rej('submission-origin', 'Submissions are recorded deterministically only.');
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  const want = l.kind === 'issue' ? 'delivery' : 'fix-window';
  const ob = l.obligations.find((o) => o.type === want && open(o)); if (!ob) return silent('no-open-commitment');
  const pr = l.kind === 'issue' ? c.linkedPr : c.item;
  if (!pr || !pr.isPr || pr.state !== 'open') return silent('no-open-pr');
  if (pr.draft) return silent('draft-is-not-delivery');
  const reported = Date.parse(i.source.observedAt); const at = Number.isFinite(reported) ? Math.min(Math.max(reported, Date.parse(ob.startedAt)), c.now) : c.now;
  if (at > Date.parse(ob.dueAt)) return silent('late-submission');
  const prNum = l.kind === 'issue' ? (i.payload as { pr?: number }).pr! : l.item;
  const to: WorkflowState = l.kind === 'issue' ? 'in-review' : 'needs-review';
  const can = l.state === to ? { ok: true as const } : canTransition(l.kind, l.state, to);
  return { accept: true, plan: [...(can.ok && l.state !== to ? project(c.policy, l.state, to) : []), note(`Timely submission recorded at ${iso(at)} (PR #${prNum}). Review will assess completeness; delays in review or CI do not count against the delivery commitment.`)],
    apply: (led) => {
      led.obligations = led.obligations.map((o) => (o.type === ob.type && o.dueAt === ob.dueAt ? { ...o, satisfiedAt: iso(at) } : o)).filter((o) => o.type !== 'response');
      if (led.kind === 'issue' && !led.linked.includes(prNum)) led.linked.push(prNum);
      led.sweep = undefined; if (can.ok && led.state !== to) moveTo(led, to, undefined, c.now);
    } };
}

/** Explicit maintainer hold: freezes the UNEXPIRED portion of open commitments; recorded with reason, start and remaining time. */
function hold(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (!c.sourceVerified) return rej('unverified-source', 'Hold rejected: the GitHub source could not be verified.');
  if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Hold by ${i.actor} rejected: not an authorized maintainer.`);
  const reason = String((i.payload as { reason?: string }).reason ?? '').trim(); if (!reason) return rej('hold-reason-required', 'Hold rejected: a reason is required.');
  const live = l.obligations.filter((o) => open(o) && !o.hold && Date.parse(o.dueAt) > c.now);
  if (!live.length) return rej('nothing-to-hold', 'Hold rejected: there is no unexpired commitment to pause (an expired commitment cannot be rescued by a late hold).');
  const rem = live.map((o) => `${o.type}: ${Math.round((Date.parse(o.dueAt) - c.now) / 60000)} minutes remaining`).join('; ');
  return { accept: true, plan: [note(`Maintainer hold by ${i.actor} (${reason.slice(0, 200)}). Contributor takeover is paused and the unexpired time is frozen (${rem}). A revised deadline is published when the hold is released.`)],
    apply: (led) => { led.obligations = led.obligations.map((o) => (live.some((x) => x.type === o.type && x.dueAt === o.dueAt) ? { ...o, hold: { startedAt: iso(c.now), remainingMs: Date.parse(o.dueAt) - c.now, reason: reason.slice(0, 200) } } : o)); } };
}
function holdRelease(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (!c.sourceVerified) return rej('unverified-source', 'Release rejected: the GitHub source could not be verified.');
  if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Release by ${i.actor} rejected: not an authorized maintainer.`);
  const held = l.obligations.filter((o) => o.hold); if (!held.length) return rej('no-hold', 'Release rejected: nothing is on hold.');
  const revised = held.map((o) => `${o.type} due ${iso(c.now + o.hold!.remainingMs)}`).join('; ');
  return { accept: true, plan: [note(`Hold released by ${i.actor}. Revised deadline${held.length > 1 ? 's' : ''}: ${revised}.`)],
    apply: (led) => { led.obligations = led.obligations.map((o) => { if (!o.hold) return o; const { hold: h, ...rest } = o; return { ...rest, dueAt: iso(c.now + h.remainingMs) }; }); } };
}

/** Reconcile the ledger with what GitHub shows now: externally closed issues, externally changed assignees, missing/mismatched state
 *  labels. Never reopens an intentionally closed item and never invents a PR merge (merged vs closed is not observable through Store). */
function reconcile(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (i.origin !== 'deterministic') return rej('reconcile-origin', 'Reconcile is deterministic only.');
  const it = c.item; const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (!it) return silent('reconcile-unobserved');
  if (isTerminal(l.kind, l.state)) return silent('ledger-terminal-never-reopened');
  if (it.state === 'closed') {
    if (l.kind === 'pr') return silent('pr-closed-externally-merge-status-unknown');
    return { accept: true, plan: [...project(c.policy, l.state, 'closed'), note('This issue was closed outside Warden; the item ledger now matches and no work will be started on it.')],
      apply: (led) => { moveTo(led, 'closed', undefined, c.now); led.owner = null; led.obligations = []; } };
  }
  const plan: Effect[] = []; let release = false;
  if (l.kind === 'issue' && l.owner?.kind === 'contributor' && !it.assignees.includes(l.owner.id) && ['claimed', 'implementing'].includes(l.state)) {
    release = true; plan.push(...project(c.policy, l.state, 'ready'), note(`${l.owner.id} is no longer assigned on GitHub, so the claim is released and the delivery commitment ends. The issue stays open.`));
  }
  const target = release ? 'ready' : l.state; const want = c.policy.projection ? c.policy.labelStates[target] : undefined;
  if (want && !release) {
    const stale = Object.values(c.policy.labelStates).filter((x) => x !== want && it.labels.includes(x)); const missing = !it.labels.includes(want);
    if (missing || stale.length) plan.push({ t: 'label', add: missing ? [want] : [], remove: stale });
  }
  if (!plan.length) return silent('already-consistent');
  return { accept: true, plan, apply: (led) => { if (release) { moveTo(led, 'ready', undefined, c.now); led.owner = null; led.obligations = led.obligations.filter((o) => o.type !== 'delivery'); } } };
}

/** Deliberate adoption of ONE existing item the operator selected. Preserves the existing GitHub owner; new clocks start at this
 *  published adoption notice, never at the historical assignment, so adoption cannot manufacture an expired commitment. */
function adopt(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const pl = i.payload as { expect?: string; draft?: 'keep' | 'close' };
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (i.origin !== 'maintainer') return silent('adopt-origin');
  if (!c.policy.maintainers.includes(i.actor)) return silent('unauthorized-adopter');
  if (!c.item) return silent('adopt-unobserved');
  const initial = l.kind === 'issue' ? 'needs-triage' : 'needs-review';
  void initial; if (!isFresh(l)) return silent('already-adopted');
  const sw = c.policy.sweep; if (!sw) return silent('sweep-policy-missing');
  const d = decideIntake({ title: c.item.title, body: c.item.body, isPr: c.item.isPr, draft: c.item.draft }, { draftsAllowed: c.policy.draftsAllowed ?? false });
  if (d.to !== pl.expect) return silent(`stale-adoption:expected-${pl.expect}-found-${d.to}`);
  const existingDraft = d.closeDraft;
  if (existingDraft && pl.draft !== 'keep' && pl.draft !== 'close') return silent('draft-needs-explicit-decision');
  const owner = l.kind === 'issue' ? c.item.assignees.find((a) => !c.policy.maintainers.includes(a)) : undefined;
  const closeIt = existingDraft && pl.draft === 'close';
  let to: WorkflowState = d.to; if (owner && to === 'needs-triage') to = 'claimed';
  const notice = `Warden adopted this ${l.kind === 'pr' ? 'PR' : 'issue'} on ${iso(c.now)}. ${owner ? `${owner} remains the owner; the ${sw.deliveryHours}-hour delivery window runs from this notice (${iso(c.now + sw.deliveryHours * HOURS)}), not from the earlier assignment.` : 'Any response window runs from this notice, not from earlier activity.'} Nothing is closed because of how old it is.${existingDraft && pl.draft === 'keep' ? ' This existing draft was kept by the maintainer.' : ''}`;
  const plan: Effect[] = [];
  const lab = c.policy.projection ? c.policy.labelStates[to] : undefined; if (lab && !closeIt) plan.push({ t: 'label', add: [lab], remove: [] });
  plan.push(note(closeIt ? `${notice} This draft was closed at the maintainer's decision; mark it ready for review and reopen it, or open a new PR.` : notice));
  if (closeIt) plan.push({ t: 'close' });
  return { accept: true, plan, apply: (led) => {
    led.adoptedAt = iso(c.now); if (existingDraft && pl.draft === 'keep') led.draftDecision = 'keep';
    if (closeIt) { moveTo(led, 'closed', undefined, c.now); return; }
    if (to !== led.state) moveTo(led, to, undefined, c.now);
    if (owner) { led.owner = { kind: 'contributor', id: owner, opid: i.opid }; led.obligations = [{ type: 'delivery', startedAt: iso(c.now), dueAt: iso(c.now + sw.deliveryHours * HOURS), source: 'adoption-notice' }]; }
  } };
}

/** Record the latest ACCEPTED review summary on the item ledger so deterministic Actions-side merge logic can see it (the review itself runs on the
 *  Mac). Origin `ai`: the writer already rejects AI-origin intents in shadow mode, so nothing is recorded, and nothing can merge, before live. */
function reviewRecord(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (i.origin !== 'ai') return silent('review-record-origin');
  if (l.kind !== 'pr') return silent('review-record-on-issue');
  const pl = i.payload as { head?: string; base?: string; verdict?: string; severities?: unknown; fingerprints?: unknown; policyDigest?: string; provenance?: unknown };
  const prov = cleanProvenance(pl.provenance);
  const sev = Array.isArray(pl.severities) ? (pl.severities as unknown[]) : null;
  if (!pl.head || !pl.base || !pl.verdict || !sev || sev.some((s) => !['blocker', 'major', 'minor', 'nit'].includes(String(s)))) return silent('review-record-malformed');
  if (c.item?.isPr !== true) return silent('review-record-unobserved');
  // Findings a maintainer already dismissed (same fingerprint, so the same unchanged code) neither gate a merge nor are recorded again.
  const fpsIn = Array.isArray(pl.fingerprints) && (pl.fingerprints as unknown[]).length === sev.length && (pl.fingerprints as unknown[]).every((x) => typeof x === 'string') ? (pl.fingerprints as string[]) : undefined;
  const keepIdx = sev.map((_, k) => k).filter((k) => !(fpsIn && l.dismissed?.[fpsIn[k]]));
  const sevs = keepIdx.map((k) => sev[k]) as Array<'blocker' | 'major' | 'minor' | 'nit'>; const fpsKept = fpsIn ? keepIdx.map((k) => fpsIn[k]) : undefined; const gates = c.policy.merge?.gates; const gated = sevs.some((s) => s === 'blocker' || (gates ? gates[s] : true));
  const from = l.state; const to: WorkflowState | null = !['needs-review', 'waiting-checks'].includes(from) ? null : gated ? (l.owner?.kind === 'factory' ? 'needs-rework' : null) : 'merge-ready';
  const move = to && canTransition('pr', from, to).ok ? to : null;
  return { accept: true, plan: move ? [...project(c.policy, from, move), ...(move === 'needs-rework' ? [note(`Review found ${sevs.filter((s) => s === 'blocker' || (gates ? gates[s] : true)).length} blocking finding(s); this factory pull request returns to rework (cycle accounting is persisted).`)] : [])] : [], apply: (led) => { if (move) moveTo(led, move, undefined, c.now); led.review = { head: pl.head!, base: pl.base!, verdict: pl.verdict!, severities: sevs, ...(fpsKept ? { fingerprints: fpsKept } : {}), policyDigest: pl.policyDigest, ...(prov ? { provenance: prov } : {}), acceptedAt: iso(c.now) }; if (led.forceReview && Date.parse(i.source.observedAt) >= Date.parse(led.forceReview.at)) delete led.forceReview; } };
}

/** `/warden review`: a maintainer asks for a full review of this pull request even though the head is unchanged. The writer only records the request; the next review run on the Mac sees it in the ledger
 *  and reviews again. Authorized by the verified source comment's author being a configured maintainer, never by the text. */
function forceReview(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (!c.sourceVerified) return rej('unverified-source', 'Review request rejected: the GitHub source could not be verified.');
  if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Review request by ${i.actor} rejected: not an authorized maintainer.`);
  if (l.kind !== 'pr') return rej('force-review-on-issue', 'A full review applies to pull requests only.');
  return { accept: true, plan: [note(`Full review requested by ${i.actor}. The next review run reviews this head again, whether or not it changed.`)], apply: (led) => { led.forceReview = { by: i.actor, at: iso(c.now) }; } };
}
/** `/warden clear-mutant <id> <reason>`: a maintainer clears ONE surviving mutant as equivalent. Warden never marks a mutant equivalent itself. */
function clearMutant(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (!c.sourceVerified) return rej('unverified-source', 'Clearance rejected: the GitHub source could not be verified.');
  if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Clearance by ${i.actor} rejected: not an authorized maintainer.`);
  const pl = i.payload as { mutant?: string; reason?: string }; const id = String(pl.mutant ?? ''); const reason = String(pl.reason ?? '').trim();
  if (!/^[0-9a-f]{12}$/.test(id) || !reason) return rej('clear-mutant-malformed', 'Clearance rejected: name one mutant id and give a reason.');
  if (l.mutantClearances?.[id]) return rej('already-cleared', `Mutant ${id} is already cleared.`);
  return { accept: true, plan: [note(`Mutant ${id} cleared by ${i.actor} as equivalent (${reason.slice(0, 200)}). The clearance lapses when that code changes.`)], apply: (led) => { led.mutantClearances = { ...(led.mutantClearances ?? {}), [id]: { by: i.actor, at: iso(c.now), reason: reason.slice(0, 200) } }; } };
}
/** `/warden dismiss <fingerprint> [reason]`: a maintainer dismisses ONE finding. It stays dismissed while its code is unchanged (the fingerprint includes the anchor line's text) and is removed from the
 *  recorded severities, so it no longer gates a merge. */
function dismissFinding(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (!c.sourceVerified) return rej('unverified-source', 'Dismissal rejected: the GitHub source could not be verified.');
  if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Dismissal by ${i.actor} rejected: not an authorized maintainer.`);
  if (l.kind !== 'pr') return rej('dismiss-on-issue', 'Findings belong to pull requests.');
  const pl = i.payload as { fingerprint?: string; reason?: string }; const fp = String(pl.fingerprint ?? '');
  if (!/^[0-9a-f]{8,16}$/.test(fp)) return rej('dismiss-malformed', 'Dismissal rejected: give the finding\'s fingerprint.');
  if (l.dismissed?.[fp]) return rej('already-dismissed', `Finding ${fp} is already dismissed.`);
  return { accept: true, plan: [note(`Finding ${fp} dismissed by ${i.actor}${pl.reason ? ` (${pl.reason.slice(0, 200)})` : ''}. It stays dismissed while its code is unchanged and no longer counts toward a merge gate.`)],
    apply: (led) => {
      led.dismissed = { ...(led.dismissed ?? {}), [fp]: { by: i.actor, at: iso(c.now), ...(pl.reason ? { reason: pl.reason.slice(0, 200) } : {}) } };
      const r = led.review; if (r?.fingerprints && r.fingerprints.length === r.severities.length) { const keep = r.fingerprints.map((x, k) => k).filter((k) => r.fingerprints![k] !== fp); led.review = { ...r, severities: keep.map((k) => r.severities[k]), fingerprints: keep.map((k) => r.fingerprints![k]) }; }
    } };
}

/** Post a recorded AI review to GitHub: ONE `COMMENT` review bound to the reviewed head (inline comments only for positions the diff shows, the rest in the body) and ONE Warden check run on that head
 *  (PRD section 5 Review, decided 2026-11-26). It posts only what the ledger already recorded for the same head, only while the pull request still has that head, and never the same review twice. Origin `ai`, so
 *  shadow mode records and posts nothing. A `COMMENT` review cannot approve or request changes: merging stays with the deterministic gates. */
function reviewPost(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (i.origin !== 'ai') return silent('review-post-origin'); if (l.kind !== 'pr') return silent('review-post-on-issue');
  const pl = i.payload as { head?: string; verdict?: string; omitted?: number; findings?: unknown };
  const allFs = Array.isArray(pl.findings) ? (pl.findings as Array<Record<string, unknown>>) : null;
  const fs = allFs ? allFs.filter((f) => !l.dismissed?.[String(f.fingerprint ?? '')]) : null;   // a dismissed finding is never posted again while its code is unchanged
  const sevOk = (s: unknown) => ['blocker', 'major', 'minor', 'nit'].includes(String(s));
  if (!pl.head || !pl.verdict || !fs || (allFs?.length ?? 0) > 50 || fs.some((f) => !sevOk(f.severity) || typeof f.path !== 'string' || !Number.isInteger(f.line) || typeof f.rationale !== 'string' || typeof f.correction !== 'string')) return silent('review-post-malformed');
  if (c.item?.isPr !== true || !c.pull) return silent('review-post-unobserved');
  if (c.pull.head !== pl.head) return silent(`stale-review:reviewed-${pl.head.slice(0, 8)}-found-${c.pull.head.slice(0, 8)}`);
  if (l.review?.head !== pl.head) return silent('review-not-recorded');
  const fps = fs.map((f) => String(f.fingerprint ?? `${f.path}:${f.line}`)).sort();
  if (l.reviewPosted && l.reviewPosted.head === pl.head && l.reviewPosted.fingerprints.join(',') === fps.join(',')) return silent('review-already-posted');
  const gates = c.policy.merge?.gates; const sevs = fs.map((f) => String(f.severity));
  const gated = (s: string) => s === 'blocker' || (gates ? gates[s as 'major' | 'minor' | 'nit'] : true);   // same gates the merge decision uses
  const conclusion = !fs.length ? 'success' as const : sevs.some(gated) ? 'action_required' as const : 'neutral' as const;
  const line = (f: Record<string, unknown>) => `**${String(f.severity)}**: ${String(f.rationale)}\n\nSuggested correction: ${String(f.correction)}`;
  const inline = fs.filter((f) => f.inline === true).map((f) => ({ path: String(f.path), line: Number(f.line), body: line(f) }));
  const rest = fs.filter((f) => f.inline !== true).map((f) => `- \`${String(f.path)}:${String(f.line)}\` ${line(f)}`);
  const omitted = Number.isInteger(pl.omitted) && Number(pl.omitted) > 0 ? Number(pl.omitted) : 0;
  const body = [`AI-assisted review (Warden) of \`${pl.head.slice(0, 8)}\`: ${fs.length ? `${fs.length} finding(s)` : 'no findings'}${omitted ? `, ${omitted} lower-ranked finding(s) are kept in the record and not shown here` : ''}. This is a comment, not an approval or a request for changes; a maintainer decides.`, ...(rest.length ? ['', 'Findings outside the lines this diff shows:', ...rest] : [])].join('\n');
  const summary = fs.length ? `${fs.length} finding(s): ${['blocker', 'major', 'minor', 'nit'].map((s) => [s, sevs.filter((x) => x === s).length] as const).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ')}.` : 'No findings.';
  return { accept: true, plan: [{ t: 'review', commitId: pl.head, body, comments: inline }, { t: 'check-run', headSha: pl.head, conclusion, title: 'Warden review', summary }],
    apply: (led) => { led.reviewPosted = { head: pl.head!, fingerprints: fps, at: iso(c.now) }; } };
}

/** Merge request bound to the head the requester saw. Enqueueing is not merging: the effect re-reads, merges only that head, confirms with GitHub,
 *  and only then does `mark-merged` update the ledger. Eligibility is the pure `evaluateMerge`; anything but `merge` is a silent rejection with the reasons. */
function mergeRequest(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (i.origin !== 'deterministic') return silent('merge-origin');
  if (l.kind !== 'pr') return silent('merge-on-issue');
  if (c.policy.mode === 'shadow') return silent('shadow-mode-no-merge');
  const m = c.policy.merge; if (!m) return silent('merge-policy-missing');
  const pull = c.pull; if (!pull) return silent('merge-unobserved');
  const want = (i.payload as { expectedHead?: string }).expectedHead;
  if (want !== pull.head) return silent(`stale-request:expected-${String(want).slice(0, 8)}-found-${pull.head.slice(0, 8)}`);
  const input = { ledger: l, pull, review: l.review ? { head: l.review.head, policyDigest: l.review.policyDigest, severities: l.review.severities } : null, gates: m.gates, policy: c.policy,
    rules: { requiredApprovals: m.requiredApprovals, approvals: pull.approvals.map((login) => ({ login })), factoryLogins: m.factoryLogins }, automationLogins: m.automationLogins, hold: false, stopped: false, now: c.now, policyDigest: c.policy.digest };
  const v = evaluateMerge(input);
  if (v.action !== 'merge') return silent(`merge-${v.action}:${v.reasons.join('; ')}`);
  const b = bindingFor(input, v);
  return { accept: true, plan: [note(`Merge requested for head ${b.expectedHead.slice(0, 8)} (${v.via}${v.approvalId ? ' ' + v.approvalId : ''}). The merge is bound to that head and recorded only after GitHub confirms it. The review it rests on came from ${l.review?.provenance ? provenanceText(l.review.provenance as Provenance) : 'a session with no recorded provenance'}.`), { t: 'merge', expectedHead: b.expectedHead }, ...project(c.policy, 'merge-ready', 'merged'), { t: 'mark-merged' }] };
}

/** Persistent rework accounting (three cycles, configurable). A COMPLETED attempt consumes a cycle even with no progress; a failed LAUNCH consumes the
 *  separate retry budget instead. Success on the last cycle may proceed to Review; unresolved findings after the last cycle escalate to a maintainer.
 *  Counts live on the ledger, so a restart cannot reset them and `carry-accounting` carries them to a replacement PR. */
function reworkAttempt(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (i.origin !== 'deterministic') return silent('rework-origin');
  if (l.kind !== 'pr') return silent('rework-on-issue');
  const sw = c.policy.sweep; if (!sw) return silent('sweep-policy-missing');
  if (l.state !== 'needs-rework') return silent(`not-awaiting-rework:${l.state}`);
  const pl = i.payload as { outcome?: string; openFindings?: number };
  const limit = sw.reworkCycles;
  if (pl.outcome === 'launch-failed') {
    const used = l.attempts.launchRetries + 1;
    if (used >= c.policy.maxAttempts) {
      return { accept: true, plan: [...project(c.policy, 'needs-rework', 'blocked'), note(`Rework could not be launched after ${used} attempts (a separate budget from rework cycles). A maintainer decides what happens next.`)],
        apply: (led) => { led.attempts.launchRetries = used; moveTo(led, 'blocked', { reason: 'rework launch retries exhausted', resumeTo: 'needs-rework' }, c.now); } };
    }
    return { accept: true, plan: [], apply: (led) => { led.attempts.launchRetries = used; } };
  }
  if (pl.outcome !== 'completed' || !Number.isInteger(pl.openFindings) || (pl.openFindings as number) < 0) return silent('rework-malformed');
  const cycles = l.attempts.reworkCycles + 1; const open = pl.openFindings as number;
  if (cycles >= limit && open > 0) {
    return { accept: true, plan: [...project(c.policy, 'needs-rework', 'needs-decision'), note(`Rework cycle ${cycles} of ${limit} finished with ${open} finding(s) still unresolved. A maintainer decides what happens next; nothing is retried automatically.`)],
      apply: (led) => { led.attempts.reworkCycles = cycles; moveTo(led, 'needs-decision', undefined, c.now); } };
  }
  return { accept: true, plan: [...project(c.policy, 'needs-rework', 'needs-review'), note(`Rework cycle ${cycles} of ${limit} finished${open ? ` with ${open} finding(s) still open` : ''}; the pull request returns to Review.`)],
    apply: (led) => { led.attempts.reworkCycles = cycles; moveTo(led, 'needs-review', undefined, c.now); } };
}

/** A replacement PR inherits the replaced PR's accounting (the writer reads the old ledger itself): a fresh PR never resets the cycles. */
function carryAccounting(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (i.origin !== 'deterministic') return silent('carry-origin'); if (l.kind !== 'pr') return silent('carry-on-issue');
  const old = c.replaced; if (!old) return silent('carry-unobserved'); if (old.item === l.item) return silent('carry-self');
  const next = { reworkCycles: Math.max(l.attempts.reworkCycles, old.attempts.reworkCycles), launchRetries: Math.max(l.attempts.launchRetries, old.attempts.launchRetries) };
  if (next.reworkCycles === l.attempts.reworkCycles && next.launchRetries === l.attempts.launchRetries) return silent('carry-nothing-to-do');
  return { accept: true, plan: [note(`This replacement carries the rework accounting of #${old.item}: ${next.reworkCycles} cycle(s) and ${next.launchRetries} launch retr${next.launchRetries === 1 ? 'y' : 'ies'} already used.`)], apply: (led) => { led.attempts.reworkCycles = next.reworkCycles; led.attempts.launchRetries = next.launchRetries; led.linked = [...new Set([...led.linked, old.item])]; } };
}

/** Critical escape / unauthorized effect: pause the affected scope (the item), preserve the evidence in the ledger and alert maintainers. Resuming needs an explicit,
 *  source-verified maintainer command; it never restarts work by itself. */
function criticalEscape(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (i.origin !== 'deterministic') return { accept: false, reason: 'escape-origin', plan: [] };
  const pl = i.payload as { summary?: string; evidence?: unknown };
  const evidence = Array.isArray(pl.evidence) ? (pl.evidence as unknown[]).map((e) => String(e).slice(0, 300)).slice(0, 20) : [];
  if (!pl.summary || !evidence.length) return { accept: false, reason: 'escape-needs-summary-and-evidence', plan: [] };
  if (l.paused) return { accept: false, reason: 'already-paused', plan: [] };
  const who = c.policy.maintainers.map((m) => '@' + m).join(' ');
  return { accept: true, plan: [note(`CRITICAL: ${String(pl.summary).slice(0, 300)}. This item is paused: no further effects are accepted until a maintainer resumes it. Evidence is preserved in the item ledger. ${who}`)],
    apply: (led) => { led.paused = { reason: String(pl.summary).slice(0, 300), at: iso(c.now), evidence }; } };
}
function resumeScope(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  if (!c.sourceVerified) return rej('unverified-source', 'Resume rejected: the GitHub source could not be verified.');
  if (!c.policy.maintainers.includes(i.actor)) return rej('unauthorized-identity', `Resume by ${i.actor} rejected: not an authorized maintainer.`);
  if (!l.paused) return rej('not-paused', 'Resume rejected: this item is not paused.');
  const reason = String((i.payload as { reason?: string }).reason ?? '').trim(); if (!reason) return rej('resume-reason-required', 'Resume rejected: a reason is required.');
  return { accept: true, plan: [note(`Paused scope resumed by ${i.actor} (${reason.slice(0, 200)}). Nothing was restarted automatically; the earlier evidence stays in the ledger history.`)], apply: (led) => { delete led.paused; } };
}

/** Link a factory PR and its issue. On the issue (factory-owned, claimed or implementing) it records the PR and moves the issue to in-review; on the PR it
 *  records the issue it closes. Links are facts the writer checks against the ledger; they never merge or close anything. */
function linkPr(l: Ledger, i: Intent, c: ReduceCtx): Decision {
  const silent = (reason: string): Decision => ({ accept: false, reason, plan: [] });
  if (i.origin !== 'deterministic') return silent('link-origin');
  const pl = i.payload as { pr?: number; issue?: number };
  if (l.kind === 'issue') {
    if (!Number.isInteger(pl.pr) || l.owner?.kind !== 'factory') return silent('link-needs-factory-owned-issue');
    if (!['claimed', 'implementing'].includes(l.state)) return silent(`link-wrong-state:${l.state}`);
    if (l.linked.includes(pl.pr as number)) return silent('already-linked');
    const from = l.state;
    return { accept: true, plan: [...project(c.policy, from, 'in-review'), note(`Factory pull request #${pl.pr} was opened for this issue. It still needs review and the merge gates; nothing is claimed as reviewed or merged.`)], apply: (led) => { led.linked = [...led.linked, pl.pr as number]; moveTo(led, 'in-review', undefined, c.now); } };
  }
  if (!Number.isInteger(pl.issue)) return silent('link-needs-issue');
  if (l.linked.includes(pl.issue as number)) return silent('already-linked');
  const factory = (i.payload as { factory?: boolean }).factory === true; const frozen = factory && !l.frozen ? cleanFrozen((i.payload as { frozen?: unknown }).frozen) : null;
  return { accept: true, plan: [], apply: (led) => { led.linked = [...led.linked, pl.issue as number]; if (factory && !led.owner) led.owner = { kind: 'factory', id: i.actor, opid: i.opid }; if (frozen) led.frozen = frozen; } };
}
