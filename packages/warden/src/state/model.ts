/** Typed workflow model (PRD section 4). State, facets, ownership, leases and attempts are INDEPENDENT dimensions. Labels are only a
 *  projection of this ledger. Issues have no PR head SHA by construction: `PrEvidence.head` exists only on the PR variant. */
export const ISSUE_OPEN_STATES = ['needs-triage', 'needs-info', 'needs-decision', 'ready', 'claimed', 'implementing', 'in-review', 'blocked'] as const;
export const ISSUE_TERMINAL_STATES = ['resolved', 'closed'] as const;
export const PR_OPEN_STATES = ['needs-review', 'needs-author', 'needs-rework', 'needs-decision', 'waiting-checks', 'merge-ready', 'blocked'] as const;
export const PR_TERMINAL_STATES = ['merged', 'closed'] as const;
export type IssueWorkflowState = (typeof ISSUE_OPEN_STATES)[number] | (typeof ISSUE_TERMINAL_STATES)[number];
export type PrWorkflowState = (typeof PR_OPEN_STATES)[number] | (typeof PR_TERMINAL_STATES)[number];
export type ItemKind = 'issue' | 'pr';
export type WorkflowState = IssueWorkflowState | PrWorkflowState;

export const isTerminal = (kind: ItemKind, s: WorkflowState) => (kind === 'issue' ? (ISSUE_TERMINAL_STATES as readonly string[]) : (PR_TERMINAL_STATES as readonly string[])).includes(s);
export const statesFor = (kind: ItemKind): readonly string[] => (kind === 'issue' ? [...ISSUE_OPEN_STATES, ...ISSUE_TERMINAL_STATES] : [...PR_OPEN_STATES, ...PR_TERMINAL_STATES]);

/** Independent facets: none of these is a workflow state, and a quick win is not a kind. */
export interface Facets {
  workKind?: 'bug' | 'feature' | 'enhancement' | 'dependency' | 'documentation' | string;
  severity?: 'blocker' | 'major' | 'minor' | 'nit';   // highest open finding severity
  risk?: 'low' | 'medium' | 'high' | 'uncertain';      // change risk, assessed independently of severity
  quickWin?: boolean;
}
export type Owner = { kind: 'contributor' | 'factory'; id: string; opid: string };
export interface Blocker { reason: string; resumeTo: WorkflowState; at: string }
/** Processing lease/attempts are separate from workflow state. */
export interface ProcessingLease { holder: string; epoch: number; acquiredAt: string; expiresAt: string }
export interface Attempts { launchRetries: number; reworkCycles: number; contributorFixRounds: number; review: number }
export interface Evidence {
  /** PR only. Issues never carry a head. */
  head?: string;
  base?: string;
  policyDigest?: string;
  evidenceDigest?: string;       // digest of material evidence context (checks, verification, tool/model context)
  criteriaDigest?: string;       // feature/enhancement acceptance criteria revision
  revision?: string;             // the item revision approvals bind to (PR head sha or issue body/criteria revision)
  updatedAt?: string;
}
export interface Obligation { type: 'delivery' | 'fix-window' | 'response' | 'information'; startedAt: string; dueAt: string; source: string }
export type ApprovalType = 'action' | 'feature-design';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'invalidated';
export interface ApprovalBinding { revision: string; policyDigest: string; evidenceDigest: string }
export interface ApprovalRec {
  id: string; type: ApprovalType; action: string;           // e.g. 'merge', 'extra-fix-round', 'feature-scope'
  binding: ApprovalBinding; bindingDigest: string;
  subjectAuthor?: string;                                     // identity that authored the proposal/change (cannot approve own change)
  requestedBy: string; requestedAt: string; expiresAt: string | null;  // null: feature design persists until materially changed
  status: ApprovalStatus; decidedBy?: string; decidedAt?: string; decisionSource?: string; reason?: string; invalidReason?: string;
}

export interface OpRec {
  status: 'applying' | 'applied' | 'rejected' | 'failed'; decision: 'accept' | 'reject'; reason?: string;
  plan: Effect[]; step: number; attempts: number; epoch: number; intentCommentId: number;
}
export type Effect =
  | { t: 'assign'; login: string }
  | { t: 'label'; add?: string[]; remove?: string[] }
  | { t: 'comment'; text: string };

export interface Ledger {
  v: 1; repository: string; item: number; kind: ItemKind; epoch: number; seq: number;
  state: WorkflowState; facets: Facets; owner: Owner | null; blocker?: Blocker;
  lease?: ProcessingLease; attempts: Attempts; evidence: Evidence; obligations: Obligation[];
  approvals: Record<string, ApprovalRec>; linked: number[];
  ops: Record<string, OpRec>; order: string[]; dropped: number; mac?: string;
}
export const newLedger = (repository: string, item: number, kind: ItemKind): Ledger => ({
  v: 1, repository, item, kind, epoch: 0, seq: 0, state: kind === 'issue' ? 'needs-triage' : 'needs-review', facets: {}, owner: null,
  attempts: { launchRetries: 0, reworkCycles: 0, contributorFixRounds: 0, review: 0 }, evidence: {}, obligations: [], approvals: {}, linked: [],
  ops: {}, order: [], dropped: 0,
});

/** Allowed workflow transitions (principal transitions table, PRD section 4). Maintainer override may go further, but never out of a terminal state. */
const ISSUE_T: Record<string, string[]> = {
  'needs-triage': ['needs-info', 'needs-decision', 'ready', 'blocked', 'closed'],
  'needs-info': ['needs-triage', 'closed', 'blocked'],
  'needs-decision': ['ready', 'closed', 'blocked'],
  ready: ['claimed', 'implementing', 'needs-decision', 'blocked', 'closed', 'needs-triage'],
  claimed: ['ready', 'in-review', 'needs-decision', 'blocked', 'closed'],
  implementing: ['in-review', 'ready', 'needs-decision', 'blocked', 'closed'],
  'in-review': ['resolved', 'ready', 'claimed', 'implementing', 'blocked', 'closed'],
  blocked: ['needs-triage', 'needs-info', 'needs-decision', 'ready', 'claimed', 'implementing', 'in-review', 'closed'],
};
const PR_T: Record<string, string[]> = {
  'needs-review': ['needs-author', 'needs-rework', 'waiting-checks', 'merge-ready', 'needs-decision', 'blocked', 'closed'],
  'needs-author': ['needs-review', 'needs-decision', 'blocked', 'closed'],
  'needs-rework': ['needs-review', 'needs-decision', 'blocked', 'closed'],
  'needs-decision': ['needs-review', 'needs-author', 'needs-rework', 'merge-ready', 'blocked', 'closed'],
  'waiting-checks': ['needs-review', 'merge-ready', 'needs-author', 'needs-rework', 'blocked', 'closed'],
  'merge-ready': ['merged', 'needs-review', 'waiting-checks', 'needs-decision', 'blocked', 'closed'],
  blocked: ['needs-review', 'needs-author', 'needs-rework', 'needs-decision', 'waiting-checks', 'closed'],
};
export function canTransition(kind: ItemKind, from: string, to: string): { ok: true } | { ok: false; reason: string } {
  const known = statesFor(kind);
  if (!known.includes(to)) return { ok: false, reason: `unknown-state-for-${kind}:${to}` };
  if (!known.includes(from)) return { ok: false, reason: `unknown-current-state:${from}` };
  if (isTerminal(kind, from as WorkflowState)) return { ok: false, reason: `terminal-state:${from} (never reopen a closed item from a stale operation)` };
  const table = kind === 'issue' ? ISSUE_T : PR_T;
  return (table[from] ?? []).includes(to) ? { ok: true } : { ok: false, reason: `illegal-transition:${from}->${to}` };
}
/** Maintainer override: any non-terminal target, never out of a terminal state. Still passes through the validated writer. */
export function canOverride(kind: ItemKind, from: string, to: string): { ok: true } | { ok: false; reason: string } {
  const known = statesFor(kind);
  if (!known.includes(to)) return { ok: false, reason: `unknown-state-for-${kind}:${to}` };
  if (isTerminal(kind, from as WorkflowState)) return { ok: false, reason: `terminal-state:${from}` };
  return { ok: true };
}
export function stateLabel(labelStates: Record<string, string>, state: string): string | undefined { return labelStates[state]; }
