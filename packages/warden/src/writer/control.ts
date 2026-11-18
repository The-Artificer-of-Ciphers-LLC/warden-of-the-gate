import type { Store } from '../github/store.ts';

export const DRY_RUN_LABEL = 'warden:dry-run';
export interface ControlState { stopped: boolean; unknown: boolean; reasons: string[]; lastOperatorEvent?: number }

/** State of ONE control label on ONE control issue. Operator intent is derived from issue events attributed to authorized actors:
 *  a non-operator removing the label cannot resume. Any read failure => unknown => treated as ACTIVE (stopped / dry-run), fail closed. */
export async function readLabelControl(store: Store, issue: number, operators: Set<string>, scope: string, label: string): Promise<ControlState> {
  try {
    const [st, events] = await Promise.all([store.getIssue(issue), store.listEvents(issue)]);
    const present = st.labels.includes(label);
    let op: 'off' | 'on' = 'off'; let last: number | undefined; const reasons: string[] = [];
    for (const e of events.filter((x) => x.label === label)) {
      if (operators.has(e.actor)) { op = e.event === 'labeled' ? 'on' : 'off'; last = e.id; }
      else reasons.push(`ignored ${e.event} of ${label} by non-operator ${e.actor}`);
    }
    if (present) reasons.push(`${scope}: ${label} present`);
    if (op === 'on' && !present) reasons.push(`${scope}: ${label} removed by non-operator; operator setting still in force`);
    return { stopped: present || op === 'on', unknown: false, reasons, lastOperatorEvent: last };
  } catch (e) {
    return { stopped: true, unknown: true, reasons: [`${scope}: control state unreadable (${String(e).slice(0, 80)}) => fail closed`] };
  }
}
export const readStop = (s: Store, issue: number, ops: Set<string>, scope: string, label = 'warden:stop') => readLabelControl(s, issue, ops, scope, label);
export const readDryRun = (s: Store, issue: number, ops: Set<string>, scope: string) => readLabelControl(s, issue, ops, scope, DRY_RUN_LABEL);
export async function setLabel(store: Store, issue: number, label: string, on: boolean) { if (on) await store.addLabel(issue, label); else await store.removeLabel(issue, label); }

export interface ControlSnapshot { stopped: boolean; dryRun: boolean; unknown: boolean; reasons: string[]; marker: string }
export interface GlobalControl { store: Store; issue: number }
/** Re-read instance + global scopes. Used before every task and every effect. */
export async function readControls(store: Store, controlIssue: number, global: GlobalControl | null, operators: Set<string>, stopLabel: string): Promise<ControlSnapshot> {
  const parts = await Promise.all([
    readStop(store, controlIssue, operators, 'instance', stopLabel), readDryRun(store, controlIssue, operators, 'instance'),
    global ? readStop(global.store, global.issue, operators, 'global', stopLabel) : Promise.resolve<ControlState>({ stopped: false, unknown: false, reasons: [] }),
    global ? readDryRun(global.store, global.issue, operators, 'global') : Promise.resolve<ControlState>({ stopped: false, unknown: false, reasons: [] }),
  ]);
  const [iStop, iDry, gStop, gDry] = parts;
  return {
    stopped: iStop.stopped || gStop.stopped, dryRun: iDry.stopped || gDry.stopped, unknown: parts.some((p) => p.unknown),
    reasons: parts.flatMap((p) => p.reasons), marker: parts.map((p) => p.lastOperatorEvent ?? 0).join('/'),
  };
}
