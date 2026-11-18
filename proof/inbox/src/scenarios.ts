import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWorld } from './fake.ts';
import { GithubStore } from './github.ts';
import type { Store } from './store.ts';
import { Crash, Faults, NetworkError, sleep } from './util.ts';
import { Writer, defaultConfig } from './writer.ts';
import type { DrainReport, WriterConfig } from './writer.ts';
import { INTENT_MARK, MAX_ATTEMPTS, encodeIntent, encodeLedger, makeIntent, parseIntent, parseLedger, parseReceipt } from './protocol.ts';
import type { IntentCore, Ledger } from './protocol.ts';
import { setStop } from './control.ts';
import { Journal, reconcileJournal, submit } from './journal.ts';
import { counterExperiment } from './overlap.ts';

export type Actor = 'bot' | 'contrib' | 'factory' | 'operator' | 'mallory';
export interface Env {
  backend: 'fake' | 'github'; world?: FakeWorld; ttlMs: number; scale: { flood: number; races: number };
  store(a: Actor, f?: Faults): Store; newIssue(t: string): Promise<number>; closeAll(): Promise<void>;
  contributor: string; operators: string[]; allowed: string[]; assignable: (l: string) => boolean;
}
export interface Check { desc: string; pass: boolean; observed?: unknown }
export interface ScenarioResult { id: string; title: string; covers: string; inputs: unknown; log: string[]; checks: Check[]; pass: boolean; ms: number; error?: string }

export function makeEnv(backend: 'fake' | 'github'): Env {
  if (backend === 'fake') {
    const world = new FakeWorld(); const who: Record<Actor, string> = { bot: 'warden-app', contrib: 'alice', factory: 'warden-app', operator: 'maintainer', mallory: 'mallory' };
    return { backend, world, ttlMs: 350, scale: { flood: 60, races: 8 }, store: (a, f) => world.view(who[a], f ?? new Faults()), newIssue: async (t) => new FakeStore0(world).mk(t), closeAll: async () => {},
      contributor: 'alice', operators: ['maintainer'], allowed: ['warden-app', 'alice', 'maintainer'], assignable: () => true };
  }
  const created: number[] = [];
  const probe = new GithubStore(); const me = process.env.WARDEN_P0_LOGIN ?? 'trek-e';
  return { backend, ttlMs: 7000, scale: { flood: 20, races: 3 }, store: (_a, f) => new GithubStore(probe.repo, f ?? new Faults()),
    newIssue: async (t) => { const n = await probe.createIssue(`[P0 proof] ${t}`, 'Disposable proof fixture. Closed automatically.'); created.push(n); return n; },
    closeAll: async () => { for (const n of created) await probe.closeIssue(n).catch(() => {}); },
    contributor: me, operators: [me], allowed: [me], assignable: (l) => l === me };
}
class FakeStore0 { w: FakeWorld; constructor(w: FakeWorld) { this.w = w; } async mk(_t: string) { return this.w.view('x').createIssue(_t, ''); } }

interface Ctx { env: Env; log: string[]; checks: Check[]; ck(desc: string, pass: boolean, observed?: unknown): void }
interface Fixture { inbox: number; control: number; global: number }
const cfgFor = (env: Env, fx: Fixture, o: Partial<WriterConfig> = {}): WriterConfig =>
  defaultConfig({ inboxIssue: fx.inbox, controlIssue: fx.control, globalControlIssue: fx.global, operators: env.operators, allowedAuthors: env.allowed,
    leaseTtlMs: env.ttlMs, leaseWaitMs: env.ttlMs * 6, fenceMarginMs: Math.floor(env.ttlMs / 3), assignable: env.assignable, ...o });
const fixture = async (env: Env, name: string): Promise<Fixture> => ({ inbox: await env.newIssue(name + ' inbox'), control: await env.newIssue(name + ' control'), global: await env.newIssue(name + ' global-control') });
const claimCore = (item: number, kind: 'contributor' | 'factory', id: string, src: string, extra: Partial<IntentCore> = {}): IntentCore =>
  ({ v: 1, kind: 'claim', item, actor: id, source: { kind: 'issue_comment', id: src, observedAt: '2026-11-18T00:00:00Z' }, payload: { claimant: { kind, id } }, ...extra });
const releaseCore = (item: number, id: string, src: string, causalAfter?: string): IntentCore => ({ v: 1, kind: 'release', item, actor: id, source: { kind: 'issue_comment', id: src, observedAt: '2026-11-18T00:01:00Z' }, payload: {}, causalAfter });

async function ledgerOf(s: Store, item: number): Promise<Ledger | null> {
  const ls = (await s.listComments(item)).filter((c) => c.body.startsWith('<!-- warden-ledger:v1 -->'));
  return ls.length ? parseLedger(ls[0].body) : null;
}
async function ledgerCount(s: Store, item: number) { return (await s.listComments(item)).filter((c) => c.body.startsWith('<!-- warden-ledger:v1 -->')).length; }
async function effectComments(s: Store, item: number, needle?: string) { return (await s.listComments(item)).filter((c) => c.body.includes('<!-- warden-effect:') && (!needle || c.body.includes(needle))); }
async function receiptsOf(s: Store, inbox: number) { return (await s.listComments(inbox)).map((c) => ({ c, r: parseReceipt(c.body) })).filter((x) => x.r).map((x) => ({ id: x.c.id, ...x.r! })); }
const drainTolerant = async (w: Writer): Promise<DrainReport | string> => { try { return await w.drain(); } catch (e) { return e instanceof Crash ? 'CRASH@' + e.point : String(e); } };
const sum = (rs: { result: string }[]) => rs.reduce((a: Record<string, number>, r) => ((a[r.result] = (a[r.result] ?? 0) + 1), a), {});

const defer = () => { let res!: () => void; const promise = new Promise<void>((r) => { res = r; }); return { promise, res }; };
/** Deterministic pause: the victim writer freezes at `point` until `release()`; `reached` resolves when it arrives. */
const freeze = (f: Faults, point: string) => { const reached = defer(), release = defer(); f.onStall(point, async () => { reached.res(); await release.promise; }); return { reached: reached.promise, release: release.res }; };

type Scenario = { id: string; title: string; covers: string; run: (c: Ctx) => Promise<unknown> };

const SCENARIOS: Scenario[] = [
  { id: 'S01', title: 'Baseline claim end to end (admission, decision, effects, receipt)', covers: 'request admission; immutable identity; acknowledgements', run: async (c) => {
    const fx = await fixture(c.env, 'S01'); const item = await c.env.newIssue('S01 item'); const bot = c.env.store('bot');
    const intent = makeIntent(claimCore(item, 'contributor', c.env.contributor, 'cmt-1'));
    await submit(c.env.store('contrib'), fx.inbox, intent, null);
    const rep = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport; c.log.push(JSON.stringify(rep.processed));
    const l = await ledgerOf(bot, item); const iss = await bot.getIssue(item); const rc = await receiptsOf(bot, fx.inbox);
    c.ck('claim applied exactly once', rep.processed.length === 1 && rep.processed[0].result === 'applied', rep.processed);
    c.ck('ledger records single owner and op', l?.owner?.id === c.env.contributor && l.ops[intent.opid]?.status === 'applied', l?.owner);
    c.ck('GitHub assignment confirmed (assignable claimant)', !c.env.assignable(c.env.contributor) || iss.assignees.includes(c.env.contributor), iss.assignees);
    c.ck('projection label applied', iss.labels.includes('warden:claimed'), iss.labels);
    c.ck('one receipt keyed to the intent comment', rc.length === 1 && rc[0].opid === intent.opid && rc[0].result === 'applied', rc);
    c.ck('exactly one ledger comment (no competing ledger)', (await ledgerCount(bot, item)) === 1);
    c.ck('operation identity is content-derived and stable', makeIntent(claimCore(item, 'contributor', c.env.contributor, 'cmt-1')).opid === intent.opid);
  } },

  { id: 'S02', title: 'Two claims for one issue, concurrent submitters, two concurrent writers (Mac + Actions)', covers: 'two claims; serialization; no acknowledged claim with two owners', run: async (c) => {
    const fx = await fixture(c.env, 'S02'); const item = await c.env.newIssue('S02 item'); const bot = c.env.store('bot');
    const a = makeIntent(claimCore(item, 'contributor', c.env.contributor, 'cmt-A')); const b = makeIntent(claimCore(item, 'factory', 'factory', 'start-B'));
    await Promise.all([submit(c.env.store('contrib'), fx.inbox, a, null), submit(c.env.store('factory'), fx.inbox, b, null)]);
    const reps = await Promise.all([new Writer(c.env.store('bot'), cfgFor(c.env, fx, { env: 'mac', holder: 'mac-1' })).drain(), new Writer(c.env.store('bot'), cfgFor(c.env, fx, { env: 'actions', holder: 'actions-1' })).drain()]);
    const rc = await receiptsOf(bot, fx.inbox); const l = await ledgerOf(bot, item);
    const winners = Object.values(l?.ops ?? {}).filter((o) => o.decision === 'accept');
    c.ck('exactly one accepted, one rejected', winners.length === 1 && rc.filter((r) => r.result === 'rejected').length === 1, sum(rc));
    c.ck('ledger has exactly one owner and it is the accepted op', !!l?.owner && l.owner.opid === Object.keys(l.ops).find((k) => l.ops[k].decision === 'accept'), l?.owner);
    c.ck('only one "Claim accepted" notice was ever posted', (await effectComments(bot, item, 'Claim accepted')).length === 1);
    c.ck('loser was told why (explanatory comment)', (await effectComments(bot, item, 'rejected')).length === 1);
    c.ck('receipt epochs never decrease by receipt order (no overlapping writers)', rc.every((r, i) => i === 0 || r.epoch >= rc[i - 1].epoch), rc.map((r) => r.epoch));
    c.ck('both writers ran without error; one processed, the other idle or sequential', reps.every((r) => !r.halted || r.halted === 'busy'), reps.map((r) => ({ env: r.env, epoch: r.epoch, n: r.processed.length, halted: r.halted })));
  } },

  { id: 'S03', title: 'Contributor vs factory ownership race (repeated rounds)', covers: 'contributor/factory ownership race', run: async (c) => {
    const fx = await fixture(c.env, 'S03'); const bot = c.env.store('bot'); const rounds: unknown[] = []; let allOne = true;
    for (let r = 0; r < c.env.scale.races; r++) {
      const item = await c.env.newIssue(`S03 item ${r}`);
      const a = makeIntent(claimCore(item, 'contributor', c.env.contributor, `c${r}`)); const b = makeIntent(claimCore(item, 'factory', 'factory', `f${r}`));
      await Promise.all(r % 2 ? [submit(c.env.store('contrib'), fx.inbox, a, null), submit(c.env.store('factory'), fx.inbox, b, null)] : [submit(c.env.store('factory'), fx.inbox, b, null), submit(c.env.store('contrib'), fx.inbox, a, null)]);
      await Promise.all([new Writer(c.env.store('bot'), cfgFor(c.env, fx, { env: 'mac', holder: `m${r}` })).drain(), new Writer(c.env.store('bot'), cfgFor(c.env, fx, { env: 'actions', holder: `a${r}` })).drain()]);
      const l = await ledgerOf(bot, item); const iss = await bot.getIssue(item);
      const owners = Object.values(l!.ops).filter((o) => o.decision === 'accept').length; const notices = (await effectComments(bot, item, 'Claim accepted')).length;
      const assignedContributor = iss.assignees.includes(c.env.contributor) && c.env.assignable(c.env.contributor);
      const consistent = owners === 1 && notices === 1 && (assignedContributor ? l!.owner!.kind === 'contributor' : !iss.assignees.length || l!.owner!.kind === 'contributor');
      allOne = allOne && consistent; rounds.push({ item, winner: l!.owner?.id, owners, notices, assignees: iss.assignees, consistent });
    }
    c.ck(`each of ${c.env.scale.races} rounds has exactly one confirmed owner, one notice, GitHub assignment consistent with ledger`, allOne, rounds);
  } },

  { id: 'S04', title: 'Crash before an effect, then recovery by a new writer after lease expiry', covers: 'crash before effect; lease takeover', run: async (c) => {
    const fx = await fixture(c.env, 'S04'); const item = await c.env.newIssue('S04 item'); const bot = c.env.store('bot');
    const i = makeIntent(claimCore(item, 'factory', 'factory', 'start-1')); await submit(c.env.store('factory'), fx.inbox, i, null);
    const f = new Faults().arm('before-effect:0');
    const r1 = await drainTolerant(new Writer(c.env.store('bot', f), cfgFor(c.env, fx, { holder: 'w-crash' })));
    const mid = await ledgerOf(bot, item); const pend = (await new Writer(bot, cfgFor(c.env, fx)).scan()).pending.length;
    c.ck('writer crashed before the first effect (and held the lease)', r1 === 'CRASH@before-effect:0', r1);
    c.ck('decision already durable in ledger (applying, step 0) and intent still pending', mid?.ops[i.opid]?.status === 'applying' && mid.ops[i.opid].step === 0 && pend === 1, { st: mid?.ops[i.opid], pend });
    c.ck('no external effect leaked before the crash', (await effectComments(bot, item)).length === 0 && !(await bot.getIssue(item)).labels.includes('warden:claimed'));
    const r2 = await new Writer(c.env.store('bot'), cfgFor(c.env, fx, { holder: 'w-recover' })).drain() as DrainReport;
    const l = await ledgerOf(bot, item);
    c.ck('new writer waited out the dead lease, took a higher epoch, resumed the op', r2.epoch >= 2 && r2.processed[0]?.result === 'applied', { epoch: r2.epoch, p: r2.processed });
    c.ck('each effect applied exactly once', (await effectComments(bot, item, 'Claim accepted')).length === 1 && l?.owner?.id === 'factory');
  } },

  { id: 'S05', title: 'Effect applied but reply lost / crash after effect before progress recorded', covers: 'effect applied reply lost', run: async (c) => {
    const fx = await fixture(c.env, 'S05'); const item = await c.env.newIssue('S05 item'); const bot = c.env.store('bot');
    const i = makeIntent(claimCore(item, 'factory', 'factory', 'start-1')); await submit(c.env.store('factory'), fx.inbox, i, null);
    // (a) reply lost after the notice comment was posted: writer sees an error, retries, finds its marker
    const fl = new Faults(); fl.arm('effect-reply-lost:comment');
    const r1 = await new Writer(c.env.store('bot', fl), cfgFor(c.env, fx, { maxPasses: 3 })).drain() as DrainReport;
    const l = await ledgerOf(bot, item); const n = (await effectComments(bot, item, 'Claim accepted')).length;
    c.ck('reply loss surfaced as a retry (attempt counted), not a duplicate or a silent success', r1.processed.some((p) => p.result === 'retry') && r1.processed.some((p) => p.result === 'applied'), r1.processed);
    c.ck('notice posted exactly once despite the retry (marker reconciliation)', n === 1, n);
    c.ck('attempt counter persisted in ledger', (l?.ops[i.opid]?.attempts ?? 0) === 1, l?.ops[i.opid]?.attempts);
    // (b) crash between effect and recording progress
    const item2 = await c.env.newIssue('S05 item2'); const j = makeIntent(claimCore(item2, 'factory', 'factory', 'start-2')); await submit(c.env.store('factory'), fx.inbox, j, null);
    const f2 = new Faults().arm('after-effect:1');   // notice comment posted, step not recorded
    const rr = await drainTolerant(new Writer(c.env.store('bot', f2), cfgFor(c.env, fx, { holder: 'w-x' })));
    const before = (await effectComments(bot, item2)).length;
    await new Writer(c.env.store('bot'), cfgFor(c.env, fx, { holder: 'w-y' })).drain();
    const after = (await effectComments(bot, item2)).length; const l2 = await ledgerOf(bot, item2);
    c.ck('crash after effect/before progress record left the effect applied and the op unfinished', rr === 'CRASH@after-effect:1' && before === 1 && l2?.ops[j.opid]?.status === 'applied', { rr, before });
    c.ck('recovery did not repeat the already-applied effect', after === 1, after);
  } },

  { id: 'S06', title: 'Duplicate and out-of-order triggers', covers: 'duplicate/out-of-order triggers; immutable identity', run: async (c) => {
    const fx = await fixture(c.env, 'S06'); const item = await c.env.newIssue('S06 item'); const bot = c.env.store('bot');
    const claim = makeIntent(claimCore(item, 'factory', 'factory', 'start-1')); const rel = makeIntent(releaseCore(item, 'factory', 'rel-1', claim.opid));
    await submit(c.env.store('factory'), fx.inbox, rel, null);                         // out of order: release arrives first
    const r1 = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport;
    const l1 = await ledgerOf(bot, item);
    c.ck('out-of-order release is deferred (stays pending, visible), not applied or dropped', r1.processed.some((p) => p.result === 'deferred') && r1.pendingAfter.length === 1 && l1?.state === 'ready' && !l1.owner, r1.processed);
    await Promise.all([submit(c.env.store('factory'), fx.inbox, claim, null), submit(c.env.store('factory'), fx.inbox, claim, null), submit(c.env.store('factory'), fx.inbox, claim, null)]);
    const r2 = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport; const rc = await receiptsOf(bot, fx.inbox); const l = await ledgerOf(bot, item);
    c.log.push(JSON.stringify(sum(rc)));
    c.ck('three identical claim deliveries => one applied, two duplicates', rc.filter((r) => r.opid === claim.opid && r.result === 'applied').length === 1 && rc.filter((r) => r.opid === claim.opid && r.result === 'duplicate').length === 2, sum(rc));
    c.ck('deferred release applied after its predecessor within the same drain', rc.some((r) => r.opid === rel.opid && r.result === 'applied') && l?.state === 'ready' && l.owner === null, { state: l?.state, owner: l?.owner });
    c.ck('claim notice posted once', (await effectComments(bot, item, 'Claim accepted')).length === 1);
    c.ck('nothing left pending', r2.pendingAfter.length === 0, r2.pendingAfter);
  } },

  { id: 'S07', title: 'Interrupted multi-effect application (3 effects, crash after the second)', covers: 'interrupted multi-effect application', run: async (c) => {
    const fx = await fixture(c.env, 'S07'); const item = await c.env.newIssue('S07 item'); const bot = c.env.store('bot');
    const i = makeIntent(claimCore(item, 'contributor', c.env.contributor, 'cmt-1')); await submit(c.env.store('contrib'), fx.inbox, i, null);
    const planLen = c.env.assignable(c.env.contributor) ? 3 : 2; const crashAt = planLen - 2; // crash after the label step, before the notice comment
    const f = new Faults().arm(`after-effect:${crashAt}`);
    const r1 = await drainTolerant(new Writer(c.env.store('bot', f), cfgFor(c.env, fx, { holder: 'w1' })));
    const mid = await ledgerOf(bot, item); const midIss = await bot.getIssue(item);
    c.ck('crashed mid-plan: earlier effects visible, ledger step lags at most one', String(r1).startsWith('CRASH') && midIss.labels.includes('warden:claimed') && (mid?.ops[i.opid]?.step ?? 99) <= crashAt + 1, { r1, step: mid?.ops[i.opid]?.step });
    c.ck('no acknowledgement (receipt) existed before completion', (await receiptsOf(bot, fx.inbox)).length === 0);
    await new Writer(c.env.store('bot'), cfgFor(c.env, fx, { holder: 'w2' })).drain();
    const l = await ledgerOf(bot, item); const iss = await bot.getIssue(item);
    c.ck('resumed to completion: all effects present exactly once', l?.ops[i.opid]?.status === 'applied' && (await effectComments(bot, item, 'Claim accepted')).length === 1 && iss.labels.filter((x) => x === 'warden:claimed').length === 1 && (!c.env.assignable(c.env.contributor) || iss.assignees.length === 1), { assignees: iss.assignees, labels: iss.labels });
    c.ck('receipt posted only after completion', (await receiptsOf(bot, fx.inbox)).length === 1);
  } },

  { id: 'S08', title: 'Actions outage: intents accepted and visible while no writer runs; no local mutation fallback', covers: 'Actions outage; failure visibility', run: async (c) => {
    const fx = await fixture(c.env, 'S08'); const item = await c.env.newIssue('S08 item'); const bot = c.env.store('bot');
    const intents = [1, 2, 3, 4, 5].map((n) => makeIntent({ v: 1, kind: 'note', item, actor: 'factory', source: { kind: 'local-result', id: 'r' + n, observedAt: '2026-11-18T00:00:00Z' }, payload: { text: 'result ' + n } }));
    const j = new Journal(join(mkdtempSync(join(tmpdir(), 'warden-j-')), 'journal.jsonl'));
    for (const i of intents) await submit(c.env.store('factory'), fx.inbox, i, j);               // Mac side, Actions "down": nothing drains
    const st = await new Writer(bot, cfgFor(c.env, fx)).scan();
    c.ck('all 5 intents durable on GitHub and enumerable while the writer is down', st.pending.length === 5, st.pending.length);
    c.ck('no ledger or item mutation occurred (no unsynchronized local write path)', (await ledgerCount(bot, item)) === 0 && (await effectComments(bot, item)).length === 0);
    c.ck('local journal agrees: 5 submitted, 0 acked => status shows 5 uncertain/pending', [...j.entries().values()].filter((e) => e.state === 'submitted').length === 5);
    const rep = await new Writer(bot, cfgFor(c.env, fx, { env: 'actions' })).drain() as DrainReport;      // Actions recovers
    const rec = await reconcileJournal(c.env.store('factory'), fx.inbox, j);
    c.ck('after recovery all 5 applied exactly once, in inbox order', rep.processed.length === 5 && rep.processed.every((p) => p.result === 'applied') && (await effectComments(bot, item)).length === 5, rep.processed.map((p) => p.result));
    c.ck('Mac journal reconciled all 5 to acked from receipts', rec.acked === 5 && [...j.entries().values()].every((e) => e.state === 'acked'), rec);
  } },

  { id: 'S09', title: `Trigger flood beyond pending-queue capacity (doorbells collapse to 2 runs; every intent still applied)`, covers: 'triggers exceeding pending-queue capacity', run: async (c) => {
    const n = c.env.scale.flood; const fx = await fixture(c.env, 'S09'); const item = await c.env.newIssue('S09 item'); const bot = c.env.store('bot');
    const intents = Array.from({ length: n }, (_, k) => makeIntent({ v: 1, kind: 'note', item, actor: 'factory', source: { kind: 'issue_comment', id: 'e' + k, observedAt: '2026-11-18T00:00:00Z' }, payload: { text: 'event ' + k } }));
    for (const i of intents) await submit(c.env.store('factory'), fx.inbox, i, null);
    // Model of Actions concurrency group (default queue): 1 running + 1 pending, the other n-2 triggers are cancelled.
    const ran = [await new Writer(bot, cfgFor(c.env, fx, { maxIntentsPerRun: Math.ceil(n / 2), maxPasses: 1, env: 'actions', holder: 'run-1' })).drain() as DrainReport];
    ran.push(await new Writer(bot, cfgFor(c.env, fx, { maxIntentsPerRun: Math.ceil(n / 2), maxPasses: 1, env: 'actions', holder: 'run-2' })).drain() as DrainReport);
    const rc = await receiptsOf(bot, fx.inbox);
    c.ck(`${n} triggers, only 2 runs survived (model), yet all ${n} intents were applied (durable inbox, not queue, carries the work)`, rc.filter((r) => r.result === 'applied').length === n && (await effectComments(bot, item)).length === n, { receipts: sum(rc), effects: (await effectComments(bot, item)).length });
    c.ck('per-run cap respected (second run needed to finish)', ran[0].processed.length <= Math.ceil(n / 2), ran.map((r) => r.processed.length));
    c.ck('nothing pending after the surviving runs', ran[1].pendingAfter.length === 0);
  } },

  { id: 'S10', title: 'Stop: global/instance, before and during application, operator authority, fail closed', covers: 'global/instance stop visibility; stop during effect; resume', run: async (c) => {
    const fx = await fixture(c.env, 'S10'); const item = await c.env.newIssue('S10 item'); const bot = c.env.store('bot'); const op = c.env.store('operator');
    const i = makeIntent(claimCore(item, 'contributor', c.env.contributor, 'cmt-1')); await submit(c.env.store('contrib'), fx.inbox, i, null);
    await setStop(op, fx.control, true);
    const r1 = await new Writer(bot, cfgFor(c.env, fx, { env: 'actions' })).drain() as DrainReport;
    c.ck('instance stop: writer halts before any effect, intent stays pending, stop-ack posted', r1.halted === 'stop' && r1.pendingAfter.length === 1 && (await ledgerCount(bot, item)) === 0 && (await bot.listComments(fx.control)).some((x) => x.body.includes('warden-stop-ack env=actions')), r1.haltReason);
    if (c.env.backend === 'fake') {
      await setStop(c.env.store('mallory'), fx.control, false);                     // non-operator removes the label
      const r2 = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport;
      c.ck('non-operator removing the stop label does NOT resume (derived from operator-attributed events)', r2.halted === 'stop' && r2.pendingAfter.length === 1, r2.haltReason);
    } else c.log.push('non-operator unlabel check runs in the Actions-side proof (actor github-actions[bot]); single gh identity here');
    await setStop(op, fx.control, false); await setStop(op, fx.control, true); await setStop(op, fx.control, false);   // explicit operator resume
    await setStop(op, fx.global, true);
    const r3 = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport;
    c.ck('global stop (separate control scope) halts a running-instance writer', r3.halted === 'stop' && /global/.test(r3.haltReason ?? ''), r3.haltReason);
    await setStop(op, fx.global, false);
    // stop during multi-effect: operator stops right before effect #1
    const f = new Faults().onStall('before-effect:1', async () => { await setStop(op, fx.control, true); });
    const r4 = await new Writer(c.env.store('bot', f), cfgFor(c.env, fx, { holder: 'w-stop' })).drain() as DrainReport;
    const mid = await ledgerOf(bot, item);
    c.ck('stop mid-plan: halted between effects; op remains applying (recoverable), no receipt', r4.halted === 'stop' && mid?.ops[i.opid]?.status === 'applying' && (await receiptsOf(bot, fx.inbox)).length === 0, { halted: r4.halted, st: mid?.ops[i.opid] });
    await setStop(op, fx.control, false);
    const r5 = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport;
    c.ck('explicit resume completes the interrupted op exactly once', r5.processed[0]?.result === 'applied' && (await effectComments(bot, item, 'Claim accepted')).length === 1, r5.processed);
    // unreadable control => unknown => stopped
    const i2 = makeIntent(claimCore(await c.env.newIssue('S10 item2'), 'factory', 'factory', 'x')); await submit(c.env.store('factory'), fx.inbox, i2, null);
    const broken = new Proxy(c.env.store('bot'), { get: (t: any, k) => (k === 'listEvents' ? async (n: number) => { if (n === fx.control) throw new NetworkError('control unreadable'); return t.listEvents(n); } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }) as Store;
    const r6 = await new Writer(broken, cfgFor(c.env, fx)).drain() as DrainReport;
    c.ck('unreadable stop control => fail closed (no effects), reported as unknown', r6.halted === 'stop' && /unreadable/.test(r6.haltReason ?? '') && r6.pendingAfter.length === 1, r6.haltReason);
  } },

  { id: 'S11', title: 'Admission: authorization, edits, forged identity, oversize, malformed', covers: 'request admission; authorization; payload limits; failure visibility', run: async (c) => {
    const fx = await fixture(c.env, 'S11'); const item = await c.env.newIssue('S11 item'); const bot = c.env.store('bot');
    const good = makeIntent(claimCore(item, 'factory', 'factory', 'ok-1')); await submit(c.env.store('factory'), fx.inbox, good, null);
    const forged = makeIntent(claimCore(item, 'factory', 'factory', 'forged')); const fb = encodeIntent(forged).replace('"factory","kind"', '"mallory-ish","kind"').replace('claimant":{"id":"factory"', 'claimant":{"id":"evil"');
    await bot.createComment(fx.inbox, fb.includes('evil') ? fb : encodeIntent(forged).replace('forged', 'forgedX'));            // body no longer matches its opid
    await bot.createComment(fx.inbox, `${INTENT_MARK}\n\`\`\`json\n{"v":1,"kind":"claim"\n\`\`\``);                              // malformed json
    const huge = { v: 1, kind: 'note', item, actor: 'factory', source: { kind: 'x', id: 'big', observedAt: 't' }, payload: { text: 'A'.repeat(9000) } };
    let rejectedAtEdge = false; try { encodeIntent(makeIntent(huge as IntentCore)); } catch { rejectedAtEdge = true; }
    await bot.createComment(fx.inbox, `${INTENT_MARK}\n\`\`\`json\n${JSON.stringify({ ...huge, opid: 'op_x' })}\n\`\`\``);                 // oversize bypassing the client
    const edited = makeIntent(claimCore(item, 'factory', 'factory', 'edited')); const ec = await bot.createComment(fx.inbox, encodeIntent(edited)); await sleep(1100); await bot.updateComment(ec.id, encodeIntent(edited) + '\n');
    const rep = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport; const rc = await receiptsOf(bot, fx.inbox); const reasons = rc.filter((r) => r.result === 'quarantined').map((r) => r.reason);
    c.ck('oversize intent rejected at the submission edge (never truncated)', rejectedAtEdge);
    c.ck('forged identity, malformed, oversize, edited => all quarantined with a visible receipt (none silently ignored)', rc.filter((r) => r.result === 'quarantined').length === 4, reasons);
    c.ck('the one valid intent still applied', rc.some((r) => r.opid === good.opid && r.result === 'applied'), sum(rc));
    c.ck('quarantined intents produced no ledger op', Object.keys((await ledgerOf(bot, item))?.ops ?? {}).length === 1);
    const intruder = makeIntent(claimCore(item, 'factory', 'factory', 'authz')); await submit(c.env.store('mallory'), fx.inbox, intruder, null);
    const strict = await new Writer(bot, cfgFor(c.env, fx, { allowedAuthors: c.env.backend === 'fake' ? ['warden-app'] : ['somebody-else'] })).drain() as DrainReport;
    const rc2 = await receiptsOf(bot, fx.inbox);
    c.ck('intent from a non-allow-listed author is quarantined, never applied', rc2.some((r) => r.opid === 'none' && /unauthorized-author/.test(r.reason ?? '')) || strict.processed.some((p) => /unauthorized/.test(p.reason ?? '')), strict.processed.map((p) => p.reason));
    void rep;
  } },

  { id: 'S12', title: 'Retry bound: poison effect becomes visible failure, never an infinite loop', covers: 'retry bounds; failure visibility', run: async (c) => {
    const fx = await fixture(c.env, 'S12'); const item = await c.env.newIssue('S12 item'); const bot = c.env.store('bot');
    const i = makeIntent(claimCore(item, 'factory', 'factory', 'poison')); await submit(c.env.store('factory'), fx.inbox, i, null);
    const f = new Faults().failAlways('effect:label'); const w = new Writer(c.env.store('bot', f), cfgFor(c.env, fx, { maxPasses: MAX_ATTEMPTS + 2 }));
    const rep = await w.drain() as DrainReport; const l = await ledgerOf(bot, item); const rc = await receiptsOf(bot, fx.inbox);
    c.ck(`op fails permanently after exactly ${MAX_ATTEMPTS} attempts with a visible 'failed' receipt`, l?.ops[i.opid]?.status === 'failed' && l.ops[i.opid].attempts === MAX_ATTEMPTS && rc[0]?.result === 'failed', { attempts: l?.ops[i.opid]?.attempts, rc: rc.map((r) => r.result) });
    c.ck('attempt budget is persisted: a cold-start writer cannot reset it', (await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport).processed.length === 0);
    void rep;
  } },

  { id: 'S13', title: 'Zombie writer: stalls past lease expiry; fenced; stale write detected and repaired from receipts', covers: 'actual serialization under pause; no acknowledged claim with two owners', run: async (c) => {
    const fx = await fixture(c.env, 'S13'); const item = await c.env.newIssue('S13 item'); const bot = c.env.store('bot');
    // seed: ledger exists (so the zombie takes the update path)
    await submit(c.env.store('factory'), fx.inbox, makeIntent({ v: 1, kind: 'note', item, actor: 'factory', source: { kind: 's', id: 'seed', observedAt: 't' }, payload: { text: 'seed' } }), null);
    await new Writer(bot, cfgFor(c.env, fx)).drain();
    const X = makeIntent(claimCore(item, 'contributor', c.env.contributor, 'cmt-X')); const R = makeIntent(releaseCore(item, c.env.contributor, 'rel-X', X.opid));
    await submit(c.env.store('contrib'), fx.inbox, X, null); await submit(c.env.store('contrib'), fx.inbox, R, null);
    // (a) stall at the earliest point: zombie is stopped by the base check; writes nothing
    const fa = new Faults(); const ga = freeze(fa, 'between-fence-and-write');
    const zombieA = new Writer(c.env.store('bot', fa), cfgFor(c.env, fx, { holder: 'zombie-A', leaseWaitMs: 0 }));
    const pa = zombieA.drain();
    await ga.reached;                                                                // zombie is frozen holding an unrenewed lease
    const rb = await new Writer(c.env.store('bot'), cfgFor(c.env, fx, { holder: 'taker-B' })).drain() as DrainReport;   // waits out the TTL, takes epoch+1
    ga.release(); const ra = await pa;
    const l = await ledgerOf(bot, item);
    c.ck('taker B ran at a higher epoch and applied claim then release', rb.epoch > (ra as DrainReport).epoch && rb.processed.filter((p) => p.result === 'applied').length >= 2, { zombie: (ra as DrainReport).epoch, taker: rb.epoch });
    c.ck('(a) zombie woke, base check failed, it wrote nothing and halted fenced', (ra as DrainReport).halted === 'fenced' && l?.state === 'ready' && l.owner === null, (ra as DrainReport).haltReason);
    // (b) worst case: stall AFTER the last pre-write check; stale write lands, post-write fence detects it
    const item2 = await c.env.newIssue('S13 item2');
    await submit(c.env.store('factory'), fx.inbox, makeIntent({ v: 1, kind: 'note', item: item2, actor: 'factory', source: { kind: 's', id: 'seed2', observedAt: 't' }, payload: { text: 'seed' } }), null);
    await new Writer(bot, cfgFor(c.env, fx)).drain();
    const X2 = makeIntent(claimCore(item2, 'contributor', c.env.contributor, 'cmt-X2')); const R2 = makeIntent(releaseCore(item2, c.env.contributor, 'rel-X2', X2.opid));
    await submit(c.env.store('contrib'), fx.inbox, X2, null); await submit(c.env.store('contrib'), fx.inbox, R2, null);
    const fb = new Faults(); const gb = freeze(fb, 'between-basecheck-and-write');
    const zb = new Writer(c.env.store('bot', fb), cfgFor(c.env, fx, { holder: 'zombie-B', leaseWaitMs: 0 })); const pb = zb.drain();
    await gb.reached;
    const taker = new Writer(c.env.store('bot'), cfgFor(c.env, fx, { holder: 'taker-C' })); const rc = await taker.drain() as DrainReport;
    const preZombie = await ledgerOf(bot, item2);
    gb.release(); const rz = await pb as DrainReport;
    const stale = await ledgerOf(bot, item2); const receipts = await receiptsOf(bot, fx.inbox);
    const effectsAfterZombie = (await effectComments(bot, item2, 'Claim accepted')).length;
    c.ck('(b) stale write DID land (honest residual window): ledger regressed from ready to claimed, detected by the post-write fence', rz.halted === 'fenced' && preZombie?.state === 'ready' && stale?.state === 'claimed' && (stale.seq < (preZombie?.seq ?? 0)), { zombie: rz.haltReason, before: { state: preZombie?.state, seq: preZombie?.seq }, afterZombie: { state: stale?.state, owner: stale?.owner?.id, seq: stale?.seq } });
    c.ck('zombie performed no externally visible effect (effects only follow a verified commit)', effectsAfterZombie === 1 && receipts.filter((r) => r.item === item2 && r.result === 'applied').length >= 2, { effectsAfterZombie });
    const rep = new Writer(bot, cfgFor(c.env, fx, { holder: 'auditor' })); const rr = await rep.drain() as DrainReport; const fixed = await ledgerOf(bot, item2);
    c.ck('(b) next drain detects ledger/receipt divergence and repairs: owner resurrected by zombie is cleared', fixed?.state === 'ready' && fixed.owner === null && (rep as any).repairs >= 1, { before: { state: stale?.state, owner: stale?.owner?.id }, after: { state: fixed?.state, owner: fixed?.owner?.id }, repairs: (rep as any).repairs });
    c.ck('no acknowledged claim ever had two owners: only one claim notice for the item', effectsAfterZombie === 1);
    void rc; void rr;
  } },

  { id: 'S14', title: 'Zombie creating a ledger concurrently is fenced and removes its own duplicate ledger', covers: 'one item-ledger authority; no competing ledger', run: async (c) => {
    const fx = await fixture(c.env, 'S14'); const item = await c.env.newIssue('S14 item'); const bot = c.env.store('bot');
    const X = makeIntent(claimCore(item, 'factory', 'factory', 'x')); await submit(c.env.store('factory'), fx.inbox, X, null);
    const fa = new Faults(); const ga = freeze(fa, 'between-fence-and-write');
    const pa = new Writer(c.env.store('bot', fa), cfgFor(c.env, fx, { holder: 'zombie', leaseWaitMs: 0 })).drain();
    await ga.reached;
    await new Writer(c.env.store('bot'), cfgFor(c.env, fx, { holder: 'taker' })).drain();
    ga.release(); const ra = await pa as DrainReport;
    c.ck('zombie fenced at ledger creation', ra.halted === 'fenced', ra.haltReason);
    c.ck('exactly one ledger comment exists afterwards', (await ledgerCount(bot, item)) === 1, await ledgerCount(bot, item));
    // fail-closed on a genuine competing ledger
    await bot.createComment(item, encodeLedger({ v: 1, item, epoch: 99, seq: 99, state: 'claimed', owner: null, ops: {}, order: [] }));
    const itemB = makeIntent({ v: 1, kind: 'note', item, actor: 'factory', source: { kind: 's', id: 'n', observedAt: 't' }, payload: { text: 'n' } }); await submit(c.env.store('factory'), fx.inbox, itemB, null);
    const rr = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport;
    c.ck('a competing second ledger comment halts the writer (fail closed, visible), no guess about which is canonical', rr.halted === 'anomaly' && rr.pendingAfter.length === 1, rr.haltReason);
  } },

  { id: 'S15', title: 'Mac write-ahead journal: crash before post, lost reply after post, reconcile', covers: 'durable local intent; acknowledgements; enumeration/recovery', run: async (c) => {
    const fx = await fixture(c.env, 'S15'); const item = await c.env.newIssue('S15 item'); const bot = c.env.store('bot');
    const j = new Journal(join(mkdtempSync(join(tmpdir(), 'warden-j-')), 'journal.jsonl'));
    const mk = (n: number) => makeIntent({ v: 1, kind: 'note', item, actor: 'factory', source: { kind: 'local', id: 'L' + n, observedAt: 't' }, payload: { text: 'local result ' + n } });
    const a = mk(1), b = mk(2);
    let e1: unknown; try { await submit(c.env.store('factory'), fx.inbox, a, j, new Faults().arm('after-journal-before-post')); } catch (e) { e1 = e; }      // crash after journal, before network
    const lost = new Faults().arm('reply-lost:createComment'); let e2: unknown; try { await submit(c.env.store('factory', lost), fx.inbox, b, j); } catch (e) { e2 = e; }  // posted, reply lost
    c.ck('crash before post left a durable pending journal entry and nothing on GitHub for it', e1 instanceof Crash && j.entries().get(a.opid)?.state === 'pending' && (await new Writer(bot, cfgFor(c.env, fx)).scan()).pending.length === 1 /* only b */);
    c.ck('lost reply: the entry is still "pending" locally though GitHub has it', e2 instanceof NetworkError && j.entries().get(b.opid)?.state === 'pending');
    const rec1 = await reconcileJournal(c.env.store('factory'), fx.inbox, j);
    const inboxIntents = (await bot.listComments(fx.inbox)).filter((x) => x.body.startsWith(INTENT_MARK)).length;
    c.ck('reconcile resubmits the never-posted intent and adopts the posted one (no duplicate post)', rec1.resubmitted === 1 && rec1.adopted === 1 && inboxIntents === 2, { rec1, inboxIntents });
    await new Writer(bot, cfgFor(c.env, fx)).drain(); const rec2 = await reconcileJournal(c.env.store('factory'), fx.inbox, j);
    c.ck('after the writer acknowledges, journal entries become acked from receipts', rec2.acked === 2 && [...j.entries().values()].every((x) => x.state === 'acked'), rec2);
  } },

  { id: 'S17', title: 'Retention/compaction: terminal pairs expire, pending and failed are kept, replays stay harmless', covers: 'retention; dedupe horizon', run: async (c) => {
    const fx = await fixture(c.env, 'S17'); const item = await c.env.newIssue('S17 item'); const bot = c.env.store('bot');
    const mk = (n: number) => makeIntent({ v: 1, kind: 'note', item, actor: 'factory', source: { kind: 'x', id: 'k' + n, observedAt: 't' }, payload: { text: 'k' + n } });
    const [a, b] = [mk(1), mk(2)]; for (const i of [a, b]) await submit(c.env.store('factory'), fx.inbox, i, null);
    await new Writer(bot, cfgFor(c.env, fx)).drain();
    await bot.createComment(fx.inbox, `${INTENT_MARK}\n\`\`\`json\n{"v":1,"kind":"claim"\n\`\`\``);   // malformed => quarantined receipt (kept 4x)
    await new Writer(bot, cfgFor(c.env, fx)).drain();
    const pendingLater = mk(3); await submit(c.env.store('factory'), fx.inbox, pendingLater, null);                 // never drained
    await sleep(1100);
    const qr = (await bot.listComments(fx.inbox)).find((x) => parseReceipt(x.body)?.result === 'quarantined')!;
    const ret = Math.max(500, Math.floor((bot.now() - Date.parse(qr.createdAt)) / 2));   // applied pairs are older than ret; the quarantined pair is younger than 4*ret
    c.log.push('retention used (ms): ' + ret);
    const w = new Writer(bot, cfgFor(c.env, fx)); const r = await w.compact(ret);
    const left = await bot.listComments(fx.inbox);
    c.ck('applied intent+receipt pairs deleted after retention', r.deleted === 4, r);
    c.ck('quarantined pair kept (4x retention), pending intent never deleted', left.some((x) => x.body.includes('quarantined')) && left.some((x) => parseIntent(x).ok && (parseIntent(x) as any).intent.opid === pendingLater.opid), left.length);
    await submit(c.env.store('factory'), fx.inbox, a, null);                                                       // late duplicate redelivery of a compacted op
    const rep = await new Writer(bot, cfgFor(c.env, fx)).drain() as DrainReport; const notes = (await effectComments(bot, item)).length;
    c.ck('late redelivery of a compacted op is a duplicate (ledger dedupe horizon), no second effect', rep.processed.some((p) => p.opid === a.opid && p.result === 'duplicate') && notes === 3, { notes, p: rep.processed.map((p) => p.result) });
  } },

  { id: 'S16', title: 'Overlap proof: lost updates without the lease, none with it; non-atomic primitive control', covers: 'ACTUAL serialization (not a concurrency setting or revision number)', run: async (c) => {
    const issue = await c.env.newIssue('S16 counter'); const w = c.env.backend === 'fake' ? 6 : 4; const per = c.env.backend === 'fake' ? 5 : 3;
    const mk = () => c.env.store('bot');
    const none = await counterExperiment(mk, issue, { mode: 'nolease', workers: w, perWorker: per, ttlMs: c.env.ttlMs, label: 'none' });
    const lease = await counterExperiment(mk, issue, { mode: 'lease', workers: w, perWorker: per, ttlMs: c.env.ttlMs * 6, label: 'lease' });
    c.log.push(JSON.stringify({ none, lease }));
    c.ck('control: without mutual exclusion concurrent read-modify-write LOSES updates (test can detect overlap)', none.lostUpdates > 0, none);
    c.ck('with the lease: zero lost updates, every increment under a distinct epoch', lease.lostUpdates === 0 && lease.epochsStrictlyDistinctPerIncrement === true, lease);
    if (c.env.backend === 'fake') {
      c.env.world!.nonAtomicCreate = true; const issue2 = await c.env.newIssue('S16 counter2');
      const bad = await counterExperiment(mk, issue2, { mode: 'lease', workers: w, perWorker: per, ttlMs: c.env.ttlMs * 6, label: 'bad' }).catch((e) => ({ error: String(e), lostUpdates: -1 }));
      c.env.world!.nonAtomicCreate = false;
      c.ck('negative control: the SAME lease over a non-atomic create primitive (like GitHub milestones) loses updates', (bad as any).lostUpdates !== 0, bad);
    }
  } },
];

export async function runScenarios(backend: 'fake' | 'github', only?: string[]) {
  const env = makeEnv(backend); const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    if (only?.length && !only.includes(s.id)) continue;
    const t0 = Date.now(); const ctx: Ctx = { env, log: [], checks: [], ck: (desc, pass, observed) => { ctx.checks.push({ desc, pass, observed }); } };
    let error: string | undefined;
    try { await s.run(ctx); } catch (e: any) { error = String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '); }
    const pass = !error && ctx.checks.length > 0 && ctx.checks.every((c) => c.pass);
    results.push({ id: s.id, title: s.title, covers: s.covers, inputs: { backend, leaseTtlMs: env.ttlMs, scale: env.scale }, log: ctx.log, checks: ctx.checks, pass, ms: Date.now() - t0, error });
    console.error(`${pass ? 'PASS' : 'FAIL'} ${s.id} ${s.title} (${Date.now() - t0}ms)${error ? '\n   ERROR ' + error : ''}${pass ? '' : '\n' + ctx.checks.filter((c) => !c.pass).map((c) => '   x ' + c.desc + ' :: ' + JSON.stringify(c.observed)?.slice(0, 300)).join('\n')}`);
  }
  await env.closeAll();
  return { env, results };
}
