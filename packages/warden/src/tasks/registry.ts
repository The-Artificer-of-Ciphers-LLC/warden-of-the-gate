import type { Store } from '../github/store.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { WardenConfig } from '../config/load.ts';
import { readOnly } from '../github/store.ts';
import type { Ledger } from '../state/model.ts';

export const TASK_NAMES = ['intake', 'triage', 'claim', 'implement', 'review', 'rework', 'sweep', 'retro'] as const;
export type TaskName = (typeof TASK_NAMES)[number];
/** Which phase owns the real behavior. Anything not implemented returns an explicit unsupported/not-ready outcome, never fabricated success. */
const OWNER: Record<Exclude<TaskName, 'intake'>, string> = { triage: 'P3', claim: 'P2', implement: 'P4', review: 'P3', rework: 'P4', sweep: 'P2', retro: 'P5' };

export interface Proposal { item: number; kind: 'issue' | 'pr'; adopted: boolean; from: string | null; to: string | null; labels: { add: string[]; remove: string[] }; reasons: string[]; effects: string[] }
export type TaskOutcome =
  | { task: string; outcome: 'proposed'; mode: 'dry-run'; proposals: Proposal[]; mutations: 0 }
  | { task: string; outcome: 'unsupported'; reason: string; owner: string }
  | { task: string; outcome: 'blocked'; reason: string }
  | { task: string; outcome: 'unknown-task'; reason: string };

/** Intake dry-run (deterministic, no model). Reads through a READ-ONLY store: a write attempt throws, so "no repository mutation" is enforced. */
export async function intakeDryRun(rawStore: Store, cfg: WardenConfig, o: { items?: number[]; skip?: Set<number> } = {}): Promise<TaskOutcome> {
  const store = readOnly(rawStore);
  const skip = o.skip ?? new Set<number>();
  const issues = o.items?.length ? await Promise.all(o.items.map((n) => store.getIssue(n))) : await store.listIssues({ state: 'open' });
  const proposals: Proposal[] = [];
  for (const it of issues.filter((i) => !skip.has(i.number))) {
    const kind = it.isPr ? 'pr' : 'issue';
    const cs = await store.listComments(it.number);
    const led = cs.filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean) as Ledger | undefined;
    if (led) { proposals.push({ item: it.number, kind, adopted: true, from: led.state, to: null, labels: { add: [], remove: [] }, reasons: ['already has a Warden ledger: intake proposes no transition'], effects: [] }); continue; }
    const reasons: string[] = []; const effects: string[] = [];
    let to: string;
    if (kind === 'pr') {
      to = 'needs-review'; reasons.push('new PR enters review queue');
      if (it.draft && !cfg.drafts.allowed) { reasons.push('draft PR while drafts are disallowed'); effects.push('(P2) close with explanation and ready-for-review return path; not performed in dry-run'); }
    } else if (!it.body.trim() || it.title.trim().length < 5) { to = 'needs-info'; reasons.push('missing required information (empty body or title too short)'); effects.push('(P2) request information from the reporter'); }
    else { to = 'needs-triage'; reasons.push('metadata present; queue semantic triage'); }
    const add = cfg.labels.projection ? [cfg.labels.states[to]].filter(Boolean) : [];
    proposals.push({ item: it.number, kind, adopted: false, from: null, to, labels: { add, remove: [] }, reasons, effects });
  }
  return { task: 'intake', outcome: 'proposed', mode: 'dry-run', proposals, mutations: 0 };
}

export async function runTask(task: string, o: { dryRun: boolean; store: Store; cfg: WardenConfig; items?: number[]; skip?: Set<number> }): Promise<TaskOutcome> {
  if (!(TASK_NAMES as readonly string[]).includes(task)) return { task, outcome: 'unknown-task', reason: `unknown task "${task}"; tasks: ${TASK_NAMES.join(', ')}` };
  if (task === 'intake') {
    if (!o.dryRun) return { task, outcome: 'unsupported', reason: 'live intake runs through the Actions handler and is delivered in P2; use --dry-run', owner: 'P2' };
    return intakeDryRun(o.store, o.cfg, { items: o.items, skip: o.skip });
  }
  return { task, outcome: 'unsupported', reason: `task "${task}" is not implemented yet (owned by ${OWNER[task as Exclude<TaskName, 'intake'>]}); no result was fabricated`, owner: OWNER[task as Exclude<TaskName, 'intake'>] };
}
