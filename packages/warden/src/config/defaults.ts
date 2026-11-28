import { DEFAULT_TEST_PATHS } from '../verify/frozen.ts';
import { DEFAULT_BOUNDARY_CLASSES } from '../verify/boundary.ts';
import { DEFAULT_MUTATION } from '../verify/mutation.ts';
import { DEFAULT_HOLDOUTS } from '../verify/holdout.ts';

/** Real default materialization. JSON Schema `default` does NOT populate values (PRD section 10), so defaults live here,
 *  pinned to this package/schema behavior. Changing any value is a reviewed behavior change shown by `upgrade --dry-run`. */
export const DEFAULT_WARDEN = {
  schemaVersion: 1,
  defaultBranch: 'main',
  operators: [] as string[],
  labels: {
    projection: true, prefix: 'warden:',
    states: {
      'needs-triage': 'warden:needs-triage', 'needs-info': 'warden:needs-info', 'needs-decision': 'warden:needs-decision', ready: 'warden:ready',
      claimed: 'warden:claimed', implementing: 'warden:implementing', 'in-review': 'warden:in-review', blocked: 'warden:blocked',
      'needs-review': 'warden:needs-review', 'needs-author': 'warden:needs-author', 'needs-rework': 'warden:needs-rework',
      'waiting-checks': 'warden:waiting-checks', 'merge-ready': 'warden:merge-ready',
    } as Record<string, string>,
    keepOpen: 'keep-open',
    urgent: 'urgent',
  },
  voice: { style: 'neutral', signature: '' },
  /** Closure caps for one sweep run and per calendar day (UTC); excess eligible closures are deferred and reported. */
  sweep: { maxClosuresPerRun: 5, maxClosuresPerDay: 10 },
  /** What one review shows; the ledger keeps every finding either way. */
  review: { maxPostedFindings: 10, uncertainFindings: 'maintainer-decides' as 'maintainer-decides' | 'drop-below-confidence', minConfidence: 0.5 },
  runtime: {
    harness: 'opencode', harnessVersion: '2.x', /* the accepted OpenCode range: any 2.x at or above 2.2.7 (ADR 0004); each run records the version it used */ modelPool: ['local-default'], provider: 'local', remoteFallback: false, isolation: 'seatbelt',
    budgets: { maxItems: 10, maxModelTurns: 40, maxToolCalls: 200, wallTimeSeconds: 1800, maxOperationRetries: 5, maxFactoryImplementationPrs: 1 },
  },
  clocks: {
    initialDeliveryHours: 48, fixWindowHours: 48, responseNudgeHours: [48, 72], responseCloseDays: 5, reproductionDays: 14, otherInfoDays: 28,
    contributorFixRounds: 3, reworkCycles: 3,
  },
  drafts: { allowed: false },
  /** The repository's own checks, run by the trusted executor inside the boundary. Taken from the DEFAULT-BRANCH config only. Empty => Implement refuses (no evidence is possible). */
  verify: { checks: [] as Array<{ id: string; kind: 'lint' | 'typecheck' | 'test' | 'build'; command: string; args: string[]; timeoutMs?: number }> },
  /** ADR 0014: which paths are tests. The test session may change only these; after it they are frozen. Taken from the DEFAULT-BRANCH config only. */
  verification: { testPaths: [...DEFAULT_TEST_PATHS] as string[], loopTurns: 3, holdouts: { ...DEFAULT_HOLDOUTS, args: [...DEFAULT_HOLDOUTS.args] } as { enabled: boolean; command: string; args: string[]; timeoutMs: number }, mutation: { ...DEFAULT_MUTATION, args: [...DEFAULT_MUTATION.args] } as { command: string; args: string[]; reportPath: string; timeoutMs: number } },
  /** ADR 0015: boundary classes as path globs (a change touching one is a one-way door and always a maintainer decision). Taken from the DEFAULT-BRANCH config only. */
  boundaries: { classes: Object.fromEntries(Object.entries(DEFAULT_BOUNDARY_CLASSES).map(([k, v]) => [k, [...v]])) as Record<string, string[]> },
  /** Merge facts the writer cannot read from GitHub: identities by LOGIN (never label), and how many independent GitHub approvals the branch rules require. */
  merge: { automationLogins: [] as string[], factoryLogins: [] as string[], requiredApprovals: 0 },
  gates: { blocker: true, major: true, minor: true, nit: true },
  approvals: { actionExpiryHours: 24, requireIndependentApprover: true },
  notifications: { discord: { enabled: false, userMap: {} as Record<string, string> } },
  retention: { transcriptDays: 30, securityAuditDays: 365 },
  inbox: { inboxIssue: 1, controlIssue: 2, stopLabel: 'warden:stop', maxIntentBytes: 8192, dedupeHorizon: 256, maxIntentAgeHours: 168 },
  mode: 'shadow',
  credentials: { automation: 'enabled' },
};

/** Fields the schema forces to a fixed value or that setup writes into starter files. Mandatory limits (never weakened):
 *  blocker gate on, no remote fallback, local provider only, human gate classes in policy.ts. */
export const MANDATORY = ['gates.blocker=true', 'runtime.remoteFallback=false', 'runtime.provider=local'] as const;

export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return structuredClone(base);
  if (Array.isArray(over) || over === null || typeof over !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) return structuredClone(over) as T;
  const out: Record<string, unknown> = { ...(structuredClone(base) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = k in out ? deepMerge(out[k], v) : structuredClone(v);
  return out as T;
}
