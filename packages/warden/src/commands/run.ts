import { reviewRecordIntent } from '../review/record.ts';
import { GitHubPublisher, HttpsGitRemote, PathRemote } from '../implement/github-publisher.ts';
import type { PullWriter } from '../implement/github-publisher.ts';
import type { PrPublisher } from '../implement/slice.ts';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { readControls } from '../writer/control.ts';
import { readLocalStop } from '../control/stop.ts';
import { runTask, TASK_NAMES } from '../tasks/registry.ts';
import { loadConfigs, modelLimits, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { buildPolicy } from '../config/snapshot.ts';
import { planReconcile, planSweep, submitIntake, submitReconcile, submitSweep } from '../tasks/registry.ts';
import { Journal } from '../writer/journal.ts';
import { NotReadyRunner } from '../runner/agent-runner.ts';
import type { AgentRunner } from '../runner/agent-runner.ts';
import { OpenCodeRunner } from '../runner/opencode.ts';
import { fileKV, planReview, runReview } from '../review/slice.ts';
import { lookupProvider } from '../lookup/provider.ts';
import { eligible, scanReviews } from '../scan/review-scan.ts';
import { planTriage, runTriage } from '../triage/slice.ts';
import { planImplement, runImplement } from '../implement/slice.ts';
import { runRework } from '../implement/rework.ts';
import type { ReworkKV } from '../implement/rework.ts';
import type { ImplKV, IntentSink } from '../implement/slice.ts';
import { LocalOutboxPublisher } from '../implement/publishers.ts';
import { makeIntent, parseLedger as parseLed2 } from '../writer/protocol.ts';
import { submit as submitIntent } from '../writer/journal.ts';
import { writerDrain } from './writer.ts';
import type { TriageKV } from '../triage/slice.ts';
import { select } from '../scan/select.ts';
import { mkdirSync } from 'node:fs';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';

/** `warden run --task <name> [--dry-run]`. Preflight refuses when stopped (local or shared) or when control state is unknown (fail closed).
 *  Dry-run reads through a read-only store, so no repository mutation can occur; unimplemented tasks return `unsupported`, never success. */
export async function run(c: Ctx): Promise<Result> {
  const task = str(c.flags, 'task');
  if (!task) return { code: 2, data: {}, text: `run: --task <${TASK_NAMES.join('|')}> is required (a bounded all-task scan arrives with P3)` };
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'run: configuration invalid:\n' + cfgs.errors.join('\n') };
  const { warden: cfg } = cfgs;
  if (!(TASK_NAMES as readonly string[]).includes(task)) return { code: 2, data: { task, outcome: 'unknown-task' }, text: `run: unknown task "${task}"; tasks: ${TASK_NAMES.join(', ')}` };
  let st; try { st = openStorage(c, cfg.repository); } catch (e) { return { code: 4, data: { outcome: 'blocked' }, text: `run blocked: ${(e as Error).message}` }; }
  const local = readLocalStop(st);
  if (local.stopped) return { code: 4, data: { task, outcome: 'blocked', reason: 'local stop in force' }, text: `run blocked: local stop in force (since ${local.at}, by ${local.by}). No model or verification work starts. Use \`warden resume --confirm\`.` };
  const be = openBackend(c, cfg); const store = be.open('operator') ?? (str(c.flags, 'submit-auth') ? be.open('submit') : null);   // in Actions the read-only reads use the submit identity
  if (!store) return { code: 4, data: { task, outcome: 'blocked', reason: be.unavailable }, text: `run blocked: ${be.unavailable}` };
  const pol = buildPolicy(cfg, cfgs.orders);
  const global = cfg.inbox.globalControl ? { store: be.open('operator', cfg.inbox.globalControl.repository) ?? store, issue: cfg.inbox.globalControl.issue } : null;
  const ctl = await readControls(store, cfg.inbox.controlIssue, global, new Set(pol.operators), cfg.inbox.stopLabel);
  if (ctl.stopped) return { code: 4, data: { task, outcome: 'blocked', reason: ctl.unknown ? 'control state unknown (fail closed)' : 'shared stop in force', reasons: ctl.reasons }, text: `run blocked: ${ctl.unknown ? 'control state unknown => treated as stopped' : 'shared stop in force'}\n${ctl.reasons.join('\n')}` };
  // register active run so `warden stop` can request cancellation
  const marker = st.path('active-run.json'); st.writeJson(marker, { pid: process.pid, task, startedAt: new Date(c.now()).toISOString() });
  const abort = new AbortController(); const onTerm = () => abort.abort(); process.once('SIGTERM', onTerm);
  try {
    const skip = new Set<number>([cfg.inbox.inboxIssue, cfg.inbox.controlIssue, ...(cfg.inbox.globalControl?.repository === cfg.repository ? [cfg.inbox.globalControl.issue] : [])]);
    if (!c.flags['dry-run'] && (task === 'intake' || task === 'sweep' || task === 'claim')) {
      // Live deterministic housekeeping: SUBMITS intents only. The one serialized writer (`warden writer drain`) decides and applies; nothing is
      // scheduled by this command, and no model or inference is used.
      const sub = be.open('submit'); if (!sub) return { code: 4, data: { task, outcome: 'blocked', reason: be.unavailable }, text: `run blocked: ${be.unavailable}` };
      let journal: Journal | null = null; try { journal = new Journal(st.journalPath); } catch { /* none */ }
      const now = c.now(); const base = { submitStore: sub, inboxIssue: cfg.inbox.inboxIssue, now, journal };
      if (task === 'claim') {
        const { planClaims: plan, } = await import('../tasks/claims.ts'); const { submitClaims } = await import('../tasks/claims.ts');
        const { found, skipped } = await plan(store, cfg, { skip }); const done = await submitClaims(found, { submitStore: sub, repo: cfg.repository, inboxIssue: cfg.inbox.inboxIssue, now, journal });
        return { code: 0, data: { task, outcome: 'submitted', submitted: done, skipped, aborted: abort.signal.aborted }, text: `task claim: ${done.length} volunteer claim(s) submitted, ${skipped.length} skipped; run \`warden writer drain\` to apply (the writer re-verifies each comment and ownership)` };
      }
      if (task === 'intake') {
        const items = str(c.flags, 'item') ? String(str(c.flags, 'item')).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
        if (!items.length) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task intake (live) requires --item N[,N]: intake never scans the backlog; use `warden adopt` for existing items' };
        const r = await submitIntake(store, cfg, { ...base, items });
        return { code: 0, data: { task, outcome: 'submitted', ...r, aborted: abort.signal.aborted }, text: `task intake: ${r.submitted.length} submitted, ${r.skipped.length} skipped${r.skipped.map((x) => ` (#${x.item}: ${x.why})`).join('')}; run \`warden writer drain\` to apply` };
      }
      const findings = await planSweep(store, cfg, { now, skip });
      const sw = await submitSweep(findings, { ...base, repo: cfg.repository });
      const rec = await submitReconcile(await planReconcile(store, cfg, { skip }), { ...base, repo: cfg.repository });
      return { code: 0, data: { task, outcome: 'submitted', sweep: sw, reconcile: rec, aborted: abort.signal.aborted }, text: `task sweep: ${sw.submitted.length} clock action(s) and ${rec.length} reconcile(s) submitted, ${sw.skipped.length} deferred; run \`warden writer drain\` to apply` };
    }
    const makeSink = (): IntentSink => {
      const sub = be.open('submit'); let journal: Journal | null = null; try { journal = new Journal(st.journalPath); } catch { /* none */ }
      return { async submit(i) { if (!sub) throw new Error('submit identity unavailable'); const it = makeIntent(i); await submitIntent(sub, cfg.inbox.inboxIssue, it, journal, undefined, pol.maxIntentBytes); if (c.flags.drain) await writerDrain(c); return { opid: it.opid }; },
        async confirmClaim(n) { const deadline = c.now() + Number(str(c.flags, 'claim-wait-seconds') ?? 90) * 1000; do { const cm = (await store.listComments(n)).find((x) => x.body.startsWith(LEDGER_MARK)); const led = cm ? parseLed2(cm.body) : null; if (led?.owner) return led.owner.kind === 'factory'; await new Promise((r) => setTimeout(r, 1500)); } while (c.now() < deadline); return false; } };
    };
    // Publisher selection: the LOCAL outbox is the default. `--publisher github` needs pull-request write permission the issues-only App ceiling does not grant,
    // a store that can create pull requests, and an explicit push remote; there is no publish credential in this release, so a real https push stays blocked.
    const pubr = ((): { publisher?: PrPublisher; refusal?: Result } => {
      if (str(c.flags, 'publisher') !== 'github') return { publisher: new LocalOutboxPublisher(st.path('outbox.git')) };
      const remote = str(c.flags, 'push-remote');
      if (remote === 'github') {
        // Real publish to THIS instance's repository: App-issued contents + pull-request write, only inside the protected ceiling, never the operator token.
        try {
          const pb = be.publish?.();
          if (!pb) return { refusal: { code: 4, data: { task, outcome: 'blocked', reason: 'publisher-unavailable' }, text: 'run --publisher github --push-remote github is blocked: no App installation or protected ceiling is configured for publishing (the owner must grant contents and pull-request write and approve the ceiling)' } };
          return { publisher: new GitHubPublisher(pb.store as unknown as PullWriter, new HttpsGitRemote(cfg.repository, pb.token), cfg.defaultBranch) };
        } catch (e) { return { refusal: { code: 4, data: { task, outcome: 'blocked', reason: 'publisher-unavailable' }, text: `run --publisher github is blocked: ${(e as Error).message}` } }; }
      }
      const pw = store as unknown as Partial<PullWriter>;
      const why = typeof pw.createPull !== 'function' ? 'this backend cannot create pull requests' : !remote ? 'no --push-remote was given and this release has no publish credential for https pushes (the App ceiling grants no contents or pull-request write)' : null;
      if (why) return { refusal: { code: 4, data: { task, outcome: 'blocked', reason: 'publisher-unavailable' }, text: `run --publisher github is blocked: ${why}. Omit --publisher to use the local outbox.` } };
      return { publisher: new GitHubPublisher(pw as PullWriter, new PathRemote(String(remote)), cfg.defaultBranch) };
    })();
    if ((task === 'implement' || task === 'rework') && pubr.refusal) return pubr.refusal;
    if (task === 'retro') {
      // P5 Retro (manual, local): narrow PROPOSALS from this instance's own evidence. Nothing is applied, merged, posted or trained on.
      const { gatherRetro } = await import('../retro/gather.ts'); const rs = await import('../retro/slice.ts');
      const days = Number(str(c.flags, 'window-days') ?? 30); if (!Number.isInteger(days) || days < 1 || days > 365) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task retro: --window-days must be 1..365' };
      const packet = await gatherRetro(st, store, { now: c.now(), windowDays: days });
      if (c.flags['dry-run']) return { code: 0, data: { task, outcome: 'proposed', mode: 'dry-run', packet: { decisions: packet.decisions.length, denials: packet.denials.length, escapes: packet.escapes.length, outcomes: packet.outcomes }, mutations: 0 }, text: `task retro (dry-run): ${packet.decisions.length} decision(s), ${packet.denials.length} denial(s), ${packet.escapes.length} escape(s) in the last ${days} day(s); no model call, nothing written` };
      const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags), maxPromptChars: 60_000 }) : new NotReadyRunner();
      const r = await rs.runRetro({ packet, runner, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, packetRoot: st.path('retro', 'packets'), stopped: () => ctl.stopped || local.stopped, signal: abort.signal, clock: c.now });
      let branch: unknown = null;
      if ((r.kind === 'proposed' || r.kind === 'no-change') && str(c.flags, 'source')) {
        const baseSha = str(c.flags, 'base-sha') ?? await store.getBranchHead(cfg.defaultBranch).catch(() => ''); if (baseSha) branch = await rs.prepareRetroBranch({ source: String(str(c.flags, 'source')), baseSha, report: rs.renderRetroReport(packet, r, c.now()), now: c.now(), author: { name: 'warden', email: 'warden@users.noreply.invalid' }, publisher: new LocalOutboxPublisher(st.path('outbox.git')), workRoot: st.path('retro', 'work') });
      }
      if (r.kind === 'proposed' || r.kind === 'no-change') { mkdirSync(st.path('retro'), { recursive: true, mode: 0o700 }); st.writeJson(st.path('retro', `report-${new Date(c.now()).toISOString().slice(0, 10)}.json`), { packet, result: r }); }
      return { code: r.kind === 'proposed' || r.kind === 'no-change' || r.kind === 'no-data' ? 0 : r.kind === 'rejected' ? 1 : 4, data: { task, outcome: r.kind, ...r, branch, runner: runner.name }, text: `task retro: ${r.kind.toUpperCase()}: ${r.notice}` };
    }
    if (task === 'implement') {
      // P4 Implement (factory): ONE issue, a trusted checkout of the default-branch tip, a writable-only-there session with no shell, trusted-executor evidence.
      // The result is published to a LOCAL outbox unless a GitHub publisher is explicitly configured; this release never pushes or opens a PR by itself.
      const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task implement requires --item N (one issue per invocation)' };
      if (!cfg.merge.factoryLogins.length) return { code: 4, data: { task, outcome: 'blocked', reason: 'no-factory-identity' }, text: 'run --task implement is blocked: set merge.factoryLogins in warden.yml (the identity that owns factory work)' };
      mkdirSync(st.path('implement'), { recursive: true, mode: 0o700 });
      const ikv: ImplKV = { read: (n) => st.readJson(st.path('implement', `${n}.json`)), write: (n, rec) => st.writeJson(st.path('implement', `${n}.json`), rec) };
      const intents = makeSink();
      const baseSha = str(c.flags, 'base-sha') ?? (c.flags['dry-run'] ? 'dry-run' : await store.getBranchHead(cfg.defaultBranch).catch(() => ''));
      if (!baseSha) return { code: 2, data: { task, outcome: 'refused' }, text: `run --task implement could not resolve the ${cfg.defaultBranch} tip; pass --base-sha SHA` };
      const implCfg = { repository: cfg.repository, source: str(c.flags, 'source') ?? `https://github.com/${cfg.repository}.git`, baseSha, factoryLogins: cfg.merge.factoryLogins, factoryAuthor: { name: cfg.merge.factoryLogins[0], email: `${cfg.merge.factoryLogins[0]}@users.noreply.invalid` },
        model: cfg.runtime.modelPool[0], harness: 'opencode 2.2.7', maxFactoryPrs: cfg.runtime.budgets.maxFactoryImplementationPrs, maxAttempts: 3, maxLaunchRetries: cfg.runtime.budgets.maxOperationRetries,
        budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, workRoot: st.path('implement', 'work'), checks: cfg.verify.checks };
      if (c.flags['dry-run']) { const p = await planImplement({ store, item, policy: pol, cfg: implCfg, kv: ikv, stopped: () => ctl.stopped || local.stopped, intents }); return { code: p.eligible ? 0 : 4, data: { task, outcome: 'proposed', mode: 'dry-run', plan: p, mutations: 0 }, text: `task implement (dry-run) #${item}: ${p.eligible ? `eligible (${p.kind}${p.resume ? ', resuming own claim' : ''})` : `blocked: ${p.notice}`}; no claim, no session, no repository mutation` }; }
      const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags), maxPromptChars: 60_000 }) : new NotReadyRunner();
      const o = await runImplement({ store, item, policy: pol, cfg: implCfg, runner, kv: ikv, publisher: pubr.publisher!, intents, stopped: () => ctl.stopped || local.stopped, signal: abort.signal });
      return { code: o.kind === 'opened' || o.kind === 'prepared' ? 0 : o.kind === 'blocked' || o.kind === 'interrupted' ? 4 : 1, data: { task, outcome: o.kind, ...o, runner: runner.name }, text: `task implement #${item}: ${o.kind.toUpperCase()}: ${o.notice}` };
    }
    if (task === 'rework') {
      // P4 Rework: FACTORY branches only, against the named findings of the accepted review of the current head; cycle accounting is writer-owned.
      const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task rework requires --item N (one pull request per invocation)' };
      if (!cfg.merge.factoryLogins.length) return { code: 4, data: { task, outcome: 'blocked', reason: 'no-factory-identity' }, text: 'run --task rework is blocked: set merge.factoryLogins in warden.yml' };
      if (c.flags['dry-run']) return { code: 0, data: { task, outcome: 'proposed', mode: 'dry-run', mutations: 0 }, text: `task rework (dry-run) #${item}: would rework only if the ledger is needs-rework, factory-owned, on a factory branch, with an accepted review of the current head; no session, no repository mutation` };
      mkdirSync(st.path('rework'), { recursive: true, mode: 0o700 });
      const wkv: ReworkKV = { read: (n) => st.readJson(st.path('rework', `${n}.json`)), write: (n, rec) => st.writeJson(st.path('rework', `${n}.json`), rec) };
      const rk = fileKV(st); const reviews = { read: () => rk.read(item), write: (_i: number, rec: Parameters<typeof rk.write>[1]) => rk.write(item, rec) };
      const implCfg = { repository: cfg.repository, source: str(c.flags, 'source') ?? `https://github.com/${cfg.repository}.git`, baseSha: '', factoryLogins: cfg.merge.factoryLogins, factoryAuthor: { name: cfg.merge.factoryLogins[0], email: `${cfg.merge.factoryLogins[0]}@users.noreply.invalid` },
        model: cfg.runtime.modelPool[0], harness: 'opencode 2.2.7', maxFactoryPrs: cfg.runtime.budgets.maxFactoryImplementationPrs, maxAttempts: 3, maxLaunchRetries: cfg.runtime.budgets.maxOperationRetries, reworkCycles: cfg.clocks.reworkCycles,
        budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, workRoot: st.path('rework', 'work'), checks: cfg.verify.checks };
      const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags) }) : new NotReadyRunner();
      const o = await runRework({ store, item, policy: pol, cfg: implCfg, runner, kv: wkv, reviews, publisher: pubr.publisher!, intents: makeSink(), stopped: () => ctl.stopped || local.stopped, signal: abort.signal });
      return { code: o.kind === 'reworked' ? 0 : o.kind === 'blocked' || o.kind === 'interrupted' ? 4 : 1, data: { task, outcome: o.kind, ...o, runner: runner.name }, text: `task rework #${item}: ${o.kind.toUpperCase()}: ${o.notice}` };
    }
    if (task === 'triage') {
      // P3 Triage (shadow): ONE issue per invocation, local only. Nothing is posted, labelled or closed; the result is a draft proposal card.
      mkdirSync(st.path('triage'), { recursive: true, mode: 0o700 });
      const tkv: TriageKV = { read: (n) => st.readJson(st.path('triage', `${n}.json`)), write: (n, rec) => st.writeJson(st.path('triage', `${n}.json`), rec) };
      const maxAttempts = 3;
      if (!str(c.flags, 'item')) {
        // Bounded scan over tracked issues awaiting triage: finite items and wall time, serial, then exit. Shadow only; nothing is scheduled.
        const ts = await import('../scan/triage-scan.ts'); const tcfg = { maxAttempts, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, expectedModel: cfg.runtime.modelPool[0], packetRoot: st.path('triage', 'packets') };
        const tcaps = { maxItems: cfg.runtime.budgets.maxItems, starveAfterHours: 168, maxFactoryImplementationPrs: cfg.runtime.budgets.maxFactoryImplementationPrs, openFactoryImplementationPrs: 0 };
        if (c.flags['dry-run']) { const pick = await ts.eligibleIssues(store, { kvFor: () => tkv, cfg: tcfg, skip }); const sel = select(pick.cands, tcaps); return { code: 0, data: { task, outcome: 'proposed', mode: 'dry-run', run: sel.run.map((x) => x.item), pending: sel.deferred, blocked: sel.blocked, skipped: pick.skipped, mutations: 0 }, text: `task triage (dry-run): would triage ${sel.run.length} issue(s) (${sel.deferred.length} deferred, ${sel.blocked.length} blocked, ${pick.skipped.length} skipped); no model call, no writes` }; }
        const sRunner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags) }) : new NotReadyRunner();
        const rep = await ts.scanTriage({ store, runner: sRunner, kvFor: () => tkv, cfg: tcfg, caps: tcaps, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000, stopped: () => ctl.stopped || local.stopped, signal: abort.signal, policyDigest: pol.digest, skip });
        mkdirSync(st.path('runs'), { recursive: true, mode: 0o700 }); const file = st.path('runs', `triage-scan-${rep.startedAt.replace(/[:.]/g, '-')}.json`); st.writeJson(file, rep);
        return { code: rep.completed.some((x) => x.outcome === 'rejected') ? 1 : rep.completed.length || !rep.pending.length ? 0 : 4, data: { task, outcome: 'scanned', ...rep, runner: sRunner.name, reportFile: file }, text: `task triage (scan, shadow): ${rep.completed.length} completed (${rep.completed.map((x) => `#${x.item} ${x.outcome}`).join(', ') || 'none'}), ${rep.pending.length} pending, ${rep.blocked.length} blocked, ${rep.skipped.length} skipped${rep.stoppedEarly ? `; stopped early: ${rep.stoppedEarly}` : ''}` };
      }
      const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task triage: --item must be an issue number' };
      if (c.flags['dry-run']) { const p = await planTriage(store, item, tkv, maxAttempts); return { code: p.action === 'blocked' ? 4 : 0, data: { task, outcome: 'proposed', mode: 'dry-run', plan: p, mutations: 0 }, text: `task triage (dry-run) #${item}: ${p.action}: ${p.why}; no model call, no repository mutation` }; }
      const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags) }) : new NotReadyRunner();
      const o = await runTriage({ store, item, runner, kv: tkv, stopped: () => ctl.stopped || local.stopped, signal: abort.signal, policyDigest: pol.digest,
        cfg: { maxAttempts, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, expectedModel: cfg.runtime.modelPool[0], packetRoot: st.path('triage', 'packets') } });
      return { code: o.kind === 'accepted' || o.kind === 'reused' ? 0 : o.kind === 'rejected' ? 1 : 4, data: { task, outcome: o.kind, ...o, runner: runner.name }, text: `task triage #${item}: ${o.kind.toUpperCase()}: ${o.notice}` };
    }
    /** Live mode only: an accepted review is handed to the writer as a `review-record` intent. Shadow mode submits nothing (and the writer would refuse an AI-origin intent anyway). */
    const recordAccepted = async (item: number, marker: Parameters<typeof reviewRecordIntent>[0]['marker']): Promise<{ opid: string } | { error: string } | undefined> => {
      if (pol.mode !== 'live') return undefined;
      try { return await makeSink().submit(reviewRecordIntent({ repo: cfg.repository, item, marker })); } catch (e) { return { error: String((e as Error).message).slice(0, 160) }; }
    };
    if (task === 'review') {
      // P3 first checkpoint: ONE read-only shadow review of ONE pull request. Local only: nothing is posted, merged or written to the contributor's branch.
      const maxAttempts = 3;   // the prototype's budget of 3 is a guess to settle with live evidence
      const kvFor = (n: number) => { const k = fileKV(st); return { read: () => k.read(n), write: (_i: number, rec: Parameters<typeof k.write>[1]) => k.write(n, rec) }; };
      // `--lookup-clone DIR`: a local clone the operator keeps fetched (Warden fetches nothing); reviews then get the repository context pack for the PR head.
      const lookupClone = str(c.flags, 'lookup-clone'); if (lookupClone && !existsSync(lookupClone)) return { code: 2, data: { task, outcome: 'refused' }, text: `run --task review: --lookup-clone ${lookupClone} does not exist` };
      const lookupCfg = lookupClone ? { context: lookupProvider(lookupClone, { root: st.path('review', 'packets') }), maxPromptChars: 60_000 } : {};
      const rcfg = { ...lookupCfg, maxAttempts, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, expectedModel: cfg.runtime.modelPool[0], packetRoot: st.path('review', 'packets') };
      const caps = { maxItems: cfg.runtime.budgets.maxItems, starveAfterHours: 168, maxFactoryImplementationPrs: cfg.runtime.budgets.maxFactoryImplementationPrs, openFactoryImplementationPrs: 0 };
      if (!str(c.flags, 'item')) {
        // Bounded scan: finite items and wall time, serial, then exit. Nothing is scheduled, polled or waited on.
        const pick = await eligible(store, { kvFor, cfg: rcfg, only: undefined });
        if (c.flags['dry-run']) { const sel = select(pick.cands, caps); return { code: 0, data: { task, outcome: 'proposed', mode: 'dry-run', run: sel.run.map((x) => x.item), pending: sel.deferred, blocked: sel.blocked, skipped: pick.skipped, mutations: 0 }, text: `task review (dry-run): would run ${sel.run.map((x) => '#' + x.item).join(', ') || 'nothing'}; pending ${sel.deferred.length}, blocked ${sel.blocked.length}, skipped ${pick.skipped.length}; no model call, no repository mutation` }; }
        const scanRunner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags) }) : new NotReadyRunner();
        const rep = await scanReviews({ store, runner: scanRunner, kvFor, cfg: rcfg, caps, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000, stopped: () => ctl.stopped || local.stopped, signal: abort.signal, policyDigest: pol.digest });
        const recordedItems: Record<number, unknown> = {}; for (const x of rep.completed) if (x.outcome === 'accepted') { const mk = kvFor(x.item).read()?.marker; if (mk) recordedItems[x.item] = await recordAccepted(x.item, mk); }
        mkdirSync(st.path('runs'), { recursive: true, mode: 0o700 }); const file = st.path('runs', `review-scan-${rep.startedAt.replace(/[:.]/g, '-')}.json`); st.writeJson(file, rep);
        return { code: rep.completed.some((x) => x.outcome === 'rejected') ? 1 : 0, data: { task, outcome: 'scanned', ...rep, ...(Object.keys(recordedItems).length ? { recorded: recordedItems } : {}), runner: scanRunner.name, reportFile: file }, text: `task review (scan, shadow): ${rep.completed.length} completed (${rep.completed.map((x) => `#${x.item} ${x.outcome}`).join(', ') || 'none'}), ${rep.pending.length} pending, ${rep.blocked.length} blocked, ${rep.skipped.length} skipped${rep.stoppedEarly ? `; ended early: ${rep.stoppedEarly}` : ''}; report ${file}` };
      }
      const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task review: --item must be a pull request number' };
      const kv = fileKV(st);
      if (c.flags['dry-run']) { const p = await planReview(store, item, kv, maxAttempts); return { code: p.action === 'blocked' ? 4 : 0, data: { task, outcome: 'proposed', mode: 'dry-run', plan: p, mutations: 0 }, text: `task review (dry-run) #${item}: ${p.action}: ${p.why} (attempts ${p.attempts.used} of ${p.attempts.max}); no model call, no repository mutation` }; }
      // Live local AI is explicit opt-in (`--runner opencode`): the pinned OpenCode adapter on a loopback-only LM Studio model. Default stays the honest not-ready refusal.
      const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags) }) : new NotReadyRunner();
      const o = await runReview({ store, item, runner, kv, stopped: () => ctl.stopped || local.stopped, signal: abort.signal, policyDigest: pol.digest,
        cfg: { maxAttempts, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, expectedModel: cfg.runtime.modelPool[0], packetRoot: st.path('review', 'packets'), ...lookupCfg } });
      const code = o.kind === 'accepted' || o.kind === 'reused' || o.kind === 'checks-only' ? 0 : o.kind === 'rejected' ? 1 : 4;
      const recorded = o.kind === 'accepted' && o.marker ? await recordAccepted(item, o.marker) : undefined;
      return { code, data: { task, outcome: o.kind, ...o, ...(recorded ? { recorded } : {}), runner: runner.name }, text: `task review #${item}: ${o.kind.toUpperCase()}: ${o.notice}${recorded ? ` Recorded for the writer (${'opid' in recorded ? recorded.opid : 'not submitted: ' + recorded.error}); run \`warden writer drain\` to apply.` : ''}` };
    }
    const out = await runTask(task, { dryRun: !!c.flags['dry-run'], store, cfg, items: str(c.flags, 'item') ? String(str(c.flags, 'item')).split(',').map(Number) : undefined, skip });
    const protection = { readOnlyStoreEnforced: !!c.flags['dry-run'], globalDryRun: ctl.dryRun ? 'present' : ctl.unknown ? 'unknown' : 'absent', backend: be.name };
    const code = out.outcome === 'proposed' ? 0 : out.outcome === 'unsupported' ? 3 : out.outcome === 'blocked' ? 4 : 2;
    const text = out.outcome === 'proposed'
      ? `task ${out.task} (dry-run): ${out.proposals.length} proposed transition(s), repository mutations: 0\n` + out.proposals.map((p) => `  #${p.item} ${p.kind}: ${p.adopted ? `already adopted (${p.from})` : `(new) -> ${p.to}`} - ${p.reasons.join('; ')}${p.effects.length ? ` [${p.effects.join('; ')}]` : ''}`).join('\n')
        + `\nmutation protection: read-only store enforced; global dry-run control: ${protection.globalDryRun}; backend ${be.name}`
      : `task ${out.task}: ${out.outcome.toUpperCase()}: ${'reason' in out ? out.reason : ''}`;
    return { code, data: { ...out, protection, aborted: abort.signal.aborted }, text };
  } finally { process.removeListener('SIGTERM', onTerm); try { if (existsSync(marker) && JSON.parse(readFileSync(marker, 'utf8')).pid === process.pid) unlinkSync(marker); } catch { /* ignore */ } }
}
void writeFileSync; void LEDGER_MARK; void parseLedger;
