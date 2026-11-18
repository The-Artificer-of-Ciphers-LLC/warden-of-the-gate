import type { Ledger } from '../state/model.ts';
import type { WardenConfig } from '../config/load.ts';
import type { Comment } from '../github/store.ts';
import { INTENT_MARK, LEDGER_MARK, RECEIPT_MARK } from '../writer/protocol.ts';
import { HOUR, type ClockConfig, type ClockItem } from './clocks.ts';

/** Approved config -> clock windows. Single place so the CLI, the reducer and tests agree. */
export function clockConfigOf(w: WardenConfig): ClockConfig {
  const c = w.clocks;
  return { nudgeAfterHours: [c.responseNudgeHours[0], c.responseNudgeHours[1]], closeAfterHours: c.responseCloseDays * 24, reproductionDays: c.reproductionDays, otherInformationDays: c.otherInfoDays, draftsEnabled: w.drafts.allowed };
}

/** Facts that come from GitHub rather than the ledger. In a sweep-action intent these are submitter-asserted. */
export interface SweepObs { keepOpen: boolean; draft: boolean; authorLastActivityAt?: string; pendingObservations?: boolean }

/** Latest comment by the item's author that is not Warden machinery. Only comments are observable through Store; pushes/reviews are NOT
 *  seen here (gap: a push-only reply would not reset silence until the reconciler exists). */
export function authorActivity(comments: Comment[], author: string): string | undefined {
  const mine = comments.filter((c) => c.author === author && ![INTENT_MARK, RECEIPT_MARK, LEDGER_MARK].some((m) => c.body.startsWith(m)));
  return mine.length ? mine.map((c) => c.createdAt).sort().at(-1) : undefined;
}

const CONFIRMED = ['ready', 'claimed', 'implementing', 'in-review'];

/** Ledger + observations -> ClockItem. Satisfaction/holds are read from the obligation if present (nothing writes them yet). */
export function clockItemFrom(l: Ledger, o: SweepObs): ClockItem {
  const item: ClockItem = {
    kind: l.kind, keepOpen: o.keepOpen, draft: o.draft, pendingObservations: o.pendingObservations,
    confirmedOrApproved: l.kind === 'issue' && (CONFIRMED.includes(l.state) || Object.values(l.approvals).some((a) => a.status === 'approved')),
    maintainerWait: l.state === 'needs-decision',
    unreviewed: l.kind === 'pr' && l.state === 'needs-review' && l.attempts.review === 0,
  };
  const ob = l.obligations.find((x) => x.type === 'response' || x.type === 'information');
  if (ob) {
    const kind = ob.type === 'response' ? 'pr-response' : ob.source.includes('reproduction') ? 'reproduction' : 'other-information';
    const since = new Date(Math.max(Date.parse(ob.startedAt), o.authorLastActivityAt ? Date.parse(o.authorLastActivityAt) : 0)).toISOString();
    item.response = { kind, requestedAt: ob.startedAt, lastAuthorActivityAt: o.authorLastActivityAt, nudgesSent: l.sweep?.since === since ? l.sweep.nudgesSent : [] };
  }
  const cm = l.obligations.find((x) => x.type === 'delivery' || x.type === 'fix-window');
  if (cm) {
    // An issue with linked work or in review may hold a timely complete submission that no one has assessed yet: never expire it on a guess.
    const maybeSubmitted = l.kind === 'issue' && (l.linked.length > 0 || l.state === 'in-review');
    item.commitment = { type: cm.type as 'delivery' | 'fix-window', startedAt: cm.startedAt, dueAt: cm.dueAt, satisfiedAt: cm.satisfiedAt, hold: cm.hold, completenessUnassessed: cm.completenessUnassessed || maybeSubmitted };
  }
  return item;
}
void HOUR;
