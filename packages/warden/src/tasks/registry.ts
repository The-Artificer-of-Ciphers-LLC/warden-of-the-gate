import type { Store } from '../github/store.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { WardenConfig } from '../config/load.ts';
import { readOnly } from '../github/store.ts';
import type { Ledger } from '../state/model.ts';
import { evaluateClock, type Due } from '../sweep/clocks.ts';
import { authorActivity, clockConfigOf, clockItemFrom, type SweepObs } from '../sweep/derive.ts';
import { makeIntent } from '../writer/protocol.ts';
import { submit } from '../writer/journal.ts';
import { iso } from '../util.ts';
import { decideIntake } from './intake.ts';

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
    const { to, reasons, effects } = decideIntake(it, { draftsAllowed: cfg.drafts.allowed });
    const add = cfg.labels.projection ? [cfg.labels.states[to]].filter(Boolean) : [];
    proposals.push({ item: it.number, kind, adopted: false, from: null, to, labels: { add, remove: [] }, reasons, effects });
  }
  return { task: 'intake', outcome: 'proposed', mode: 'dry-run', proposals, mutations: 0 };
}

export interface SweepFinding { item: number; itemKind: 'issue' | 'pr'; state: string; due: Due; obs: SweepObs }
/** Sweep planning (deterministic, read-only: takes a Store that may be a read-only proxy). Items without a Warden ledger are skipped:
 *  adoption (not this slice) is the only way an item gains a ledger and a clock. Only ledger obligations of type response/information are evaluated. */
export async function planSweep(rawStore: Store, cfg: WardenConfig, o: { now: number; items?: number[]; skip?: Set<number> }): Promise<SweepFinding[]> {
  const store = readOnly(rawStore); const skip = o.skip ?? new Set<number>(); const clocks = clockConfigOf(cfg);
  const issues = o.items?.length ? await Promise.all(o.items.map((n) => store.getIssue(n))) : await store.listIssues({ state: 'open' });
  const out: SweepFinding[] = [];
  for (const it of issues.filter((i) => !skip.has(i.number) && i.state === 'open')) {
    const cs = await store.listComments(it.number);
    const l = cs.filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean) as Ledger | undefined;
    if (!l) continue;
    const obs: SweepObs = { keepOpen: it.labels.includes(cfg.labels.keepOpen), draft: !!it.draft, authorLastActivityAt: authorActivity(cs, it.author) };
    const due = evaluateClock(clockItemFrom(l, obs), { now: iso(o.now), stopped: false, cfg: clocks }).due;
    if (due.kind !== 'none') out.push({ item: it.number, itemKind: it.isPr ? 'pr' : 'issue', state: l.state, due, obs });
  }
  return out;
}
const whenOf = (d: Due) => ('since' in d ? d.since : d.kind === 'expire-commitment' ? d.dueAt : '');
const toProposal = (f: SweepFinding): Proposal => {
  const closes = f.due.kind === 'close-silence' || f.due.kind === 'close-information' || (f.due.kind === 'expire-commitment' && f.itemKind === 'pr');
  const releases = f.due.kind === 'expire-commitment' && f.itemKind === 'issue';
  return { item: f.item, kind: f.itemKind, adopted: true, from: f.state, to: closes ? 'closed' : releases ? 'ready' : null, labels: { add: [], remove: [] },
    reasons: [f.due.kind === 'defer' ? `deferred: ${f.due.why}` : f.due.kind === 'nudge' ? `${f.due.hours}h response nudge` : `${f.due.kind} (${f.due.kind === 'expire-commitment' ? 'due' : 'since'} ${whenOf(f.due)})`],
    effects: f.due.kind === 'defer' ? [] : [releases ? 'release claim: unassign, return to ready, explain (through the writer)' : closes ? 'close with explanation (through the writer)' : 'post reminder comment (through the writer)'] };
};
/** Submit live intake for EXPLICIT items only (the event handler passes the new item). Never scans the backlog: intake must not become
 *  blanket adoption of existing issues/PRs. Items that already have a ledger are skipped. */
export async function submitIntake(rawStore: Store, cfg: WardenConfig, o: { submitStore: Store; inboxIssue: number; now: number; items: number[] }): Promise<{ submitted: number[]; skipped: Array<{ item: number; why: string }> }> {
  if (!o.items.length) throw new Error('live intake requires explicit item numbers; it never scans the backlog (adoption is a separate, deliberate flow)');
  const store = readOnly(rawStore); const submitted: number[] = []; const skipped: Array<{ item: number; why: string }> = [];
  for (const n of o.items) {
    const it = await store.getIssue(n);
    if (it.state !== 'open') { skipped.push({ item: n, why: 'closed' }); continue; }
    const cs = await store.listComments(n);
    if (cs.some((c) => c.body.startsWith(LEDGER_MARK))) { skipped.push({ item: n, why: 'already-has-ledger' }); continue; }
    const d = decideIntake(it, { draftsAllowed: cfg.drafts.allowed });
    const intent = makeIntent({ v: 1, kind: 'intake', repo: cfg.repository, item: n, itemKind: it.isPr ? 'pr' : 'issue', origin: 'deterministic',
      source: { kind: 'intake', id: `intake:${n}`, observedAt: iso(o.now) }, actor: o.submitStore.actor(), payload: { expect: d.to } });
    await submit(o.submitStore, o.inboxIssue, intent, null); submitted.push(n);
  }
  return { submitted, skipped };
}

/** Submit enforceable findings as deterministic intents. `defer` verdicts are never submitted. Same finding => same opid (idempotent). */
export async function submitSweep(findings: SweepFinding[], o: { submitStore: Store; repo: string; inboxIssue: number; now: number }): Promise<{ submitted: number[]; skipped: number[] }> {
  const submitted: number[] = []; const skipped: number[] = [];
  for (const f of findings) {
    if (f.due.kind === 'defer' || f.due.kind === 'none') { skipped.push(f.item); continue; }
    const expect = f.due.kind === 'nudge' ? { kind: 'nudge', hours: f.due.hours } : f.due.kind === 'expire-commitment' ? { kind: f.due.kind, commitment: f.due.commitment } : { kind: f.due.kind };
    const intent = makeIntent({ v: 1, kind: 'sweep-action', repo: o.repo, item: f.item, itemKind: f.itemKind, origin: 'deterministic',
      source: { kind: 'sweep', id: `sweep:${f.item}:${expect.kind}${'hours' in expect ? expect.hours : ''}:${whenOf(f.due)}`, observedAt: iso(o.now) }, actor: o.submitStore.actor(), payload: { expect, obs: f.obs } });
    await submit(o.submitStore, o.inboxIssue, intent, null); submitted.push(f.item);
  }
  return { submitted, skipped };
}

export async function runTask(task: string, o: { dryRun: boolean; store: Store; cfg: WardenConfig; items?: number[]; skip?: Set<number>; now?: number }): Promise<TaskOutcome> {
  if (!(TASK_NAMES as readonly string[]).includes(task)) return { task, outcome: 'unknown-task', reason: `unknown task "${task}"; tasks: ${TASK_NAMES.join(', ')}` };
  if (task === 'intake') {
    if (!o.dryRun) return { task, outcome: 'unsupported', reason: 'live intake runs through the Actions handler and is delivered in P2; use --dry-run', owner: 'P2' };
    return intakeDryRun(o.store, o.cfg, { items: o.items, skip: o.skip });
  }
  if (task === 'sweep') {
    if (!o.dryRun) return { task, outcome: 'unsupported', reason: 'live sweep is submitted by the Actions handler (not built); use --dry-run. Enforcement exists only as writer intents (submitSweep) and is not scheduled', owner: 'P2' };
    return { task, outcome: 'proposed', mode: 'dry-run', proposals: (await planSweep(o.store, o.cfg, { now: o.now ?? o.store.now(), items: o.items, skip: o.skip })).map(toProposal), mutations: 0 };
  }
  return { task, outcome: 'unsupported', reason: `task "${task}" is not implemented yet (owned by ${OWNER[task as Exclude<TaskName, 'intake'>]}); no result was fabricated`, owner: OWNER[task as Exclude<TaskName, 'intake'>] };
}
