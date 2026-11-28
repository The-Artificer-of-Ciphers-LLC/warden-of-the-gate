import type { IssueState, Store } from '../github/store.ts';

/** `urgent` for the scan's selection comes ONLY from a configured maintainer's decision: the item carries the urgent label and the most recent label event for it is a `labeled` by a configured maintainer
 *  (never a contributor, never text). Removing the label, or a contributor adding it, makes the item ordinary again. Urgency only orders work: it bypasses no authority, verification or cap (PRD section 12). */
export async function authorizedUrgent(store: Pick<Store, 'listEvents'>, item: Pick<IssueState, 'number' | 'labels'>, o: { label?: string; maintainers: readonly string[] }): Promise<boolean> {
  if (!o.label || !item.labels.includes(o.label)) return false;
  let events; try { events = await store.listEvents(item.number); } catch { return false; }   // cannot prove who applied it: not urgent
  const last = [...events].reverse().find((e) => e.label === o.label && (e.event === 'labeled' || e.event === 'unlabeled'));
  return !!last && last.event === 'labeled' && o.maintainers.some((m) => m.toLowerCase() === last.actor.toLowerCase());
}
