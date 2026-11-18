import type { Store } from './store.ts';

export const STOP_LABEL = 'warden:stop';
export interface ControlState { stopped: boolean; unknown: boolean; reasons: string[]; lastOperatorEvent?: number }

/** Stop state for ONE control issue. Operator intent is derived from issue *events attributed to authorized actors*:
 *  an unauthorized removal of the label cannot resume the factory (label absent but operator state 'stopped' => stopped).
 *  Any read failure => unknown => stopped (fail closed). */
export async function readStop(store: Store, issue: number, operators: Set<string>, scope: string): Promise<ControlState> {
  try {
    const [st, events] = await Promise.all([store.getIssue(issue), store.listEvents(issue)]);
    const present = st.labels.includes(STOP_LABEL);
    let op: 'running' | 'stopped' = 'running'; let last: number | undefined; const reasons: string[] = [];
    for (const e of events.filter((x) => x.label === STOP_LABEL)) {
      if (operators.has(e.actor)) { op = e.event === 'labeled' ? 'stopped' : 'running'; last = e.id; }
      else reasons.push(`ignored ${e.event} by non-operator ${e.actor}`);
    }
    if (present) reasons.push(`${scope}: stop label present`);
    if (op === 'stopped' && !present) reasons.push(`${scope}: label removed by non-operator; operator stop still in force`);
    return { stopped: present || op === 'stopped', unknown: false, reasons, lastOperatorEvent: last };
  } catch (e) {
    return { stopped: true, unknown: true, reasons: [`${scope}: control state unreadable (${String(e).slice(0, 80)}) => fail closed`] };
  }
}
export async function setStop(store: Store, issue: number, stop: boolean) { if (stop) await store.addLabel(issue, STOP_LABEL); else await store.removeLabel(issue, STOP_LABEL); }
