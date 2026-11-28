/** What `warden status` shows as the last sweep. Written only by a sweep that ran to completion (not one that was cancelled), so "last successful sweep" means what it says (PRD section 12). */
export interface LastSweep { at: string; clockActions: number; deferred: number; reconciles: number }
export const lastSweepRecord = (o: { now: number; clockActions: number; deferred: number; reconciles: number; aborted: boolean }): LastSweep | null =>
  o.aborted ? null : { at: new Date(o.now).toISOString(), clockActions: o.clockActions, deferred: o.deferred, reconciles: o.reconciles };
