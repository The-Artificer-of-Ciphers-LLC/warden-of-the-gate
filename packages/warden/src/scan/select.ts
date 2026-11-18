/** Deterministic work selection for a bounded scan (P3): priority, aging and capacity. Pure: same inputs, same order. No model, no clock reads.
 *  Urgency never bypasses authority: `urgent` must come from an authorized source (the caller derives it), and urgent items still respect
 *  the cap on factory implementation PRs. Blocked entries keep their age. Nothing starves: any item older than `starveAfterHours` is promoted. */
export interface Candidate {
  item: number; kind: 'issue' | 'pr'; ageHours: number;
  /** Set only from an authorized source (maintainer decision), never from contributor-controlled text. */
  urgent?: boolean;
  /** Review/rework already in progress (an accepted review of an older head, or attempts spent): finish before starting new work. */
  inProgress?: boolean;
  approvedFeature?: boolean;
  /** Retry budget exhausted or otherwise waiting for a maintainer. */
  blockedReason?: string;
  factoryImplementation?: boolean;
}
export interface SelectCaps { maxItems: number; starveAfterHours: number; maxFactoryImplementationPrs: number; openFactoryImplementationPrs: number }
export interface Selection { run: Candidate[]; deferred: Array<{ item: number; why: string }>; blocked: Array<{ item: number; why: string }> }

const klass = (c: Candidate, starve: number) => (c.urgent ? 0 : c.inProgress ? 1 : c.ageHours >= starve ? 1 : 2);

export function select(cands: Candidate[], caps: SelectCaps): Selection {
  const blocked = cands.filter((c) => c.blockedReason).map((c) => ({ item: c.item, why: c.blockedReason! }));
  const live = cands.filter((c) => !c.blockedReason);
  const order = [...live].sort((a, b) => klass(a, caps.starveAfterHours) - klass(b, caps.starveAfterHours) || b.ageHours - a.ageHours || a.item - b.item);
  const run: Candidate[] = []; const deferred: Selection['deferred'] = []; let factory = caps.openFactoryImplementationPrs;
  for (const c of order) {
    if (c.factoryImplementation && factory >= caps.maxFactoryImplementationPrs) { deferred.push({ item: c.item, why: `factory implementation cap reached (${caps.maxFactoryImplementationPrs})` }); continue; }
    if (run.length >= caps.maxItems) { deferred.push({ item: c.item, why: `item budget reached (${caps.maxItems}); waits for another invocation` }); continue; }
    run.push(c); if (c.factoryImplementation) factory++;
  }
  return { run, deferred, blocked };
}
