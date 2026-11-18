import type { Orders, WardenConfig } from './load.ts';
import { policyDigest } from './load.ts';
import type { ClockConfig } from '../sweep/clocks.ts';
import { clockConfigOf } from '../sweep/derive.ts';

/** Immutable snapshot of the APPROVED policy (default-branch config). The writer evaluates only this, never a PR's proposed policy. */
export interface PolicySnapshot {
  repository: string; digest: string; maintainers: string[]; operators: string[]; submitters?: string[];
  requireIndependentApprover: boolean; actionExpiryHours: number; mode: 'shadow' | 'live';
  orders: Orders; labelStates: Record<string, string>; projection: boolean; stopLabel: string;
  maxAttempts: number; dedupeHorizon: number; maxIntentAgeMs: number; maxIntentBytes: number;
  /** P2 sweep windows from approved config. Absent => sweep actions are rejected (fail closed). */
  sweep?: { clocks: ClockConfig; keepOpenLabel: string };
}
export function buildPolicy(w: WardenConfig, o: Orders | null): PolicySnapshot {
  const orders: Orders = o ?? { schemaVersion: 1, programs: [] };
  return {
    repository: w.repository, digest: policyDigest(w, orders), maintainers: [...w.maintainers], operators: [...new Set([...w.maintainers, ...(w.operators ?? [])])],
    requireIndependentApprover: w.approvals.requireIndependentApprover, actionExpiryHours: w.approvals.actionExpiryHours, mode: w.mode as 'shadow' | 'live', orders,
    labelStates: w.labels.projection ? w.labels.states : {}, projection: w.labels.projection, stopLabel: w.inbox.stopLabel,
    maxAttempts: w.runtime.budgets.maxOperationRetries, dedupeHorizon: w.inbox.dedupeHorizon, maxIntentAgeMs: w.inbox.maxIntentAgeHours * 3600_000, maxIntentBytes: w.inbox.maxIntentBytes,
    sweep: { clocks: clockConfigOf(w), keepOpenLabel: w.labels.keepOpen },
  };
}
