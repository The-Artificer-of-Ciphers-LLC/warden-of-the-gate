/**
 * P2 sweep clocks: a PURE decision function. No I/O, no GitHub, no model, no wall clock (`now` is an input).
 * It answers "what is due for this item" from explicit timestamps; effects (comment/close/release) are performed
 * elsewhere through the shared writer. Built before the P1 scheduling gate closed (owner waiver recorded in
 * docs/handoff); nothing here is wired to a schedule or enabled.
 *
 * Rules implemented (PRD "Obligation" table + contributor-commitment text):
 *  - delivery / fix-window obligations expire at dueAt unless satisfied or held; holds freeze the unexpired portion
 *  - PR response silence: nudge at 48h and 72h, close at 5 days, only while an author response is owed
 *  - reproduction information 14 days, other reporter information 28 days, only when requested from the reporter
 *  - author activity resets silence only; factory/CI activity is not an input at all
 *  - never act on keep-open, confirmed/approved issues, unreviewed PRs, maintainer waits, designated drafts
 *  - an earlier delivery expiry wins over a silence close
 *  - a stopped Warden does not extend anything: clocks still evaluate, effects are marked deferred
 *  - unreconciled author observations defer enforcement (never a false takeover); nudges/closures are never fabricated
 */
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface ClockConfig {
  nudgeAfterHours: [number, number];
  closeAfterHours: number;
  reproductionDays: number;
  otherInformationDays: number;
  draftsEnabled: boolean;
}
export const DEFAULT_CLOCKS: ClockConfig = { nudgeAfterHours: [48, 72], closeAfterHours: 120, reproductionDays: 14, otherInformationDays: 28, draftsEnabled: false };

export interface Commitment {
  type: 'delivery' | 'fix-window';
  startedAt: string; dueAt: string;
  /** A genuinely complete submission recorded in time satisfies the obligation, even if review later finds defects. */
  satisfiedAt?: string;
  /** Explicit maintainer hold: freezes the unexpired portion. `remainingMs` is fixed at hold start. */
  hold?: { startedAt: string; remainingMs: number; reason: string };
  /** Ambiguous completeness waits for assessment rather than expiring. */
  completenessUnassessed?: boolean;
}
export interface ResponseOwed {
  kind: 'pr-response' | 'reproduction' | 'other-information';
  requestedAt: string;
  /** Latest AUTHOR comment/push/review reply only. Never populate from factory or CI activity. */
  lastAuthorActivityAt?: string;
  /** Highest nudge already published (48 or 72) so a sweep never repeats one. */
  nudgesSent?: Array<48 | 72>;
}
export interface ClockItem {
  kind: 'issue' | 'pr';
  keepOpen?: boolean;
  /** Issue is confirmed or approved for work. */
  confirmedOrApproved?: boolean;
  /** PR has not yet received a published review. */
  unreviewed?: boolean;
  /** Item is waiting on a maintainer decision/review. */
  maintainerWait?: boolean;
  draft?: boolean;
  /** Maintainer-designated draft (exempt only while drafts are enabled). */
  designatedDraft?: boolean;
  commitment?: Commitment;
  response?: ResponseOwed;
  /** Author observations (comment/push) seen by GitHub but not yet reconciled into the ledger. */
  pendingObservations?: boolean;
}
export interface ClockCtx { now: string; stopped: boolean; cfg?: ClockConfig }

export type Due =
  | { kind: 'none'; why: string }
  | { kind: 'defer'; why: 'reconcile-observations' | 'completeness-unassessed' }
  | { kind: 'nudge'; hours: 48 | 72; clock: string; since: string }
  | { kind: 'close-silence'; clock: string; since: string }
  | { kind: 'close-information'; clock: string; since: string }
  | { kind: 'expire-commitment'; commitment: 'delivery' | 'fix-window'; dueAt: string };
/** `effectsDeferred`: stop blocks effects; the clock verdict is still recorded so nothing is silently extended. */
export interface Verdict { due: Due; effectsDeferred: boolean }

const ms = (iso: string) => { const t = Date.parse(iso); if (Number.isNaN(t)) throw new Error(`invalid timestamp: ${iso}`); return t; };

/** Release a hold: the revised deadline is now + the frozen remainder (published to the contributor by the caller). */
export function releaseHold(c: Commitment, now: string): Commitment {
  if (!c.hold) return c;
  const { hold: _h, ...rest } = c;
  return { ...rest, dueAt: new Date(ms(now) + c.hold.remainingMs).toISOString() };
}
/** Start a hold: record the unexpired portion. Already-expired commitments cannot be rescued by a late hold. */
export function startHold(c: Commitment, now: string, reason: string): Commitment {
  const remaining = ms(c.dueAt) - ms(now);
  if (remaining <= 0 || c.satisfiedAt || c.hold) return c;
  return { ...c, hold: { startedAt: now, remainingMs: remaining, reason } };
}

function exempt(i: ClockItem, cfg: ClockConfig): string | null {
  if (i.keepOpen) return 'keep-open';
  if (i.maintainerWait) return 'maintainer-wait';
  if (i.kind === 'issue' && i.confirmedOrApproved) return 'confirmed-or-approved-issue';
  if (i.kind === 'pr' && i.unreviewed) return 'unreviewed-pr';
  if (i.kind === 'pr' && i.draft && i.designatedDraft && cfg.draftsEnabled) return 'designated-draft';
  return null;
}

/** Commitments (a missed delivery/fix-window) are not stale-closure: confirmed/approved issues and unreviewed PRs are exactly the items that carry
 *  them, so only keep-open, maintainer waits and enabled designated drafts shield a commitment (a hold or satisfaction is handled on the commitment). */
function exemptCommitment(i: ClockItem, cfg: ClockConfig): string | null {
  if (i.keepOpen) return 'keep-open';
  if (i.maintainerWait) return 'maintainer-wait';
  if (i.kind === 'pr' && i.draft && i.designatedDraft && cfg.draftsEnabled) return 'designated-draft';
  return null;
}

export function evaluateClock(i: ClockItem, ctx: ClockCtx): Verdict {
  const cfg = ctx.cfg ?? DEFAULT_CLOCKS; const now = ms(ctx.now);
  const done = (due: Due): Verdict => ({ due, effectsDeferred: ctx.stopped && due.kind !== 'none' });
  const ex = exempt(i, cfg); const exC = exemptCommitment(i, cfg);
  if (ex && exC) return done({ kind: 'none', why: ex });

  // 1. Commitment expiry (delivery / fix window). Earlier than any silence closure by construction.
  const c = i.commitment; let expiry: Due | null = null;
  if (c && !exC && !c.satisfiedAt && !c.hold && now >= ms(c.dueAt)) {
    expiry = c.completenessUnassessed ? { kind: 'defer', why: 'completeness-unassessed' } : { kind: 'expire-commitment', commitment: c.type, dueAt: c.dueAt };
  }
  // 2. Response/information silence.
  let silence: Due | null = null;
  const r = i.response;
  if (r && !ex) {
    const since = Math.max(ms(r.requestedAt), r.lastAuthorActivityAt ? ms(r.lastAuthorActivityAt) : 0);
    const age = now - since; const sinceIso = new Date(since).toISOString();
    if (r.kind === 'pr-response') {
      if (i.kind !== 'pr') return done({ kind: 'none', why: 'pr-response-on-issue' });
      if (age >= cfg.closeAfterHours * HOUR) silence = { kind: 'close-silence', clock: 'pr-response', since: sinceIso };
      else {
        const sent = new Set(r.nudgesSent ?? []);
        const [n1, n2] = cfg.nudgeAfterHours;
        if (age >= n2 * HOUR && !sent.has(72)) silence = { kind: 'nudge', hours: 72, clock: 'pr-response', since: sinceIso };
        else if (age >= n1 * HOUR && age < n2 * HOUR && !sent.has(48)) silence = { kind: 'nudge', hours: 48, clock: 'pr-response', since: sinceIso };
      }
    } else {
      if (i.kind !== 'issue') return done({ kind: 'none', why: 'information-request-on-pr' });
      const days = r.kind === 'reproduction' ? cfg.reproductionDays : cfg.otherInformationDays;
      if (age >= days * DAY) silence = { kind: 'close-information', clock: r.kind, since: sinceIso };
    }
  }

  const chosen = expiry ?? silence;   // an earlier delivery deadline wins over silence
  if (!chosen) return done({ kind: 'none', why: ex ?? 'nothing-due' });
  // Unreconciled author observations could contradict the verdict: defer instead of enforcing (nudges are harmless but also deferred for accuracy).
  if (i.pendingObservations && chosen.kind !== 'defer') return done({ kind: 'defer', why: 'reconcile-observations' });
  return done(chosen);
}
