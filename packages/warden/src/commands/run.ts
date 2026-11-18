import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { readControls } from '../writer/control.ts';
import { readLocalStop } from '../control/stop.ts';
import { runTask, TASK_NAMES } from '../tasks/registry.ts';
import { loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { buildPolicy } from '../config/snapshot.ts';
import { planReconcile, planSweep, submitIntake, submitReconcile, submitSweep } from '../tasks/registry.ts';
import { Journal } from '../writer/journal.ts';
import { NotReadyRunner } from '../runner/agent-runner.ts';
import type { AgentRunner } from '../runner/agent-runner.ts';
import { OpenCodeRunner } from '../runner/opencode.ts';
import { fileKV, planReview, runReview } from '../review/slice.ts';
import { eligible, scanReviews } from '../scan/review-scan.ts';
import { planTriage, runTriage } from '../triage/slice.ts';
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
  const be = openBackend(c, cfg); const store = be.open('operator');
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
    if (!c.flags['dry-run'] && (task === 'intake' || task === 'sweep')) {
      // Live deterministic housekeeping: SUBMITS intents only. The one serialized writer (`warden writer drain`) decides and applies; nothing is
      // scheduled by this command, and no model or inference is used.
      const sub = be.open('submit'); if (!sub) return { code: 4, data: { task, outcome: 'blocked', reason: be.unavailable }, text: `run blocked: ${be.unavailable}` };
      let journal: Journal | null = null; try { journal = new Journal(st.journalPath); } catch { /* none */ }
      const now = c.now(); const base = { submitStore: sub, inboxIssue: cfg.inbox.inboxIssue, now, journal };
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
    if (task === 'triage') {
      // P3 Triage (shadow): ONE issue per invocation, local only. Nothing is posted, labelled or closed; the result is a draft proposal card.
      const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task triage requires --item N (one issue per invocation)' };
      mkdirSync(st.path('triage'), { recursive: true, mode: 0o700 });
      const tkv: TriageKV = { read: (n) => st.readJson(st.path('triage', `${n}.json`)), write: (n, rec) => st.writeJson(st.path('triage', `${n}.json`), rec) };
      const maxAttempts = 3;
      if (c.flags['dry-run']) { const p = await planTriage(store, item, tkv, maxAttempts); return { code: p.action === 'blocked' ? 4 : 0, data: { task, outcome: 'proposed', mode: 'dry-run', plan: p, mutations: 0 }, text: `task triage (dry-run) #${item}: ${p.action}: ${p.why}; no model call, no repository mutation` }; }
      const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: str(c.flags, 'lmstudio-url') }) : new NotReadyRunner();
      const o = await runTriage({ store, item, runner, kv: tkv, stopped: () => ctl.stopped || local.stopped, signal: abort.signal, policyDigest: pol.digest,
        cfg: { maxAttempts, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, expectedModel: cfg.runtime.modelPool[0], packetRoot: st.path('triage', 'packets') } });
      return { code: o.kind === 'accepted' || o.kind === 'reused' ? 0 : o.kind === 'rejected' ? 1 : 4, data: { task, outcome: o.kind, ...o, runner: runner.name }, text: `task triage #${item}: ${o.kind.toUpperCase()}: ${o.notice}` };
    }
    if (task === 'review') {
      // P3 first checkpoint: ONE read-only shadow review of ONE pull request. Local only: nothing is posted, merged or written to the contributor's branch.
      const maxAttempts = 3;   // the prototype's budget of 3 is a guess to settle with live evidence
      const kvFor = (n: number) => { const k = fileKV(st); return { read: () => k.read(n), write: (_i: number, rec: Parameters<typeof k.write>[1]) => k.write(n, rec) }; };
      const rcfg = { maxAttempts, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, expectedModel: cfg.runtime.modelPool[0], packetRoot: st.path('review', 'packets') };
      const caps = { maxItems: cfg.runtime.budgets.maxItems, starveAfterHours: 168, maxFactoryImplementationPrs: cfg.runtime.budgets.maxFactoryImplementationPrs, openFactoryImplementationPrs: 0 };
      if (!str(c.flags, 'item')) {
        // Bounded scan: finite items and wall time, serial, then exit. Nothing is scheduled, polled or waited on.
        const pick = await eligible(store, { kvFor, cfg: rcfg, only: undefined });
        if (c.flags['dry-run']) { const sel = select(pick.cands, caps); return { code: 0, data: { task, outcome: 'proposed', mode: 'dry-run', run: sel.run.map((x) => x.item), pending: sel.deferred, blocked: sel.blocked, skipped: pick.skipped, mutations: 0 }, text: `task review (dry-run): would run ${sel.run.map((x) => '#' + x.item).join(', ') || 'nothing'}; pending ${sel.deferred.length}, blocked ${sel.blocked.length}, skipped ${pick.skipped.length}; no model call, no repository mutation` }; }
        const scanRunner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: str(c.flags, 'lmstudio-url') }) : new NotReadyRunner();
        const rep = await scanReviews({ store, runner: scanRunner, kvFor, cfg: rcfg, caps, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000, stopped: () => ctl.stopped || local.stopped, signal: abort.signal, policyDigest: pol.digest });
        mkdirSync(st.path('runs'), { recursive: true, mode: 0o700 }); const file = st.path('runs', `review-scan-${rep.startedAt.replace(/[:.]/g, '-')}.json`); st.writeJson(file, rep);
        return { code: rep.completed.some((x) => x.outcome === 'rejected') ? 1 : 0, data: { task, outcome: 'scanned', ...rep, runner: scanRunner.name, reportFile: file }, text: `task review (scan, shadow): ${rep.completed.length} completed (${rep.completed.map((x) => `#${x.item} ${x.outcome}`).join(', ') || 'none'}), ${rep.pending.length} pending, ${rep.blocked.length} blocked, ${rep.skipped.length} skipped${rep.stoppedEarly ? `; ended early: ${rep.stoppedEarly}` : ''}; report ${file}` };
      }
      const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: { task, outcome: 'refused' }, text: 'run --task review: --item must be a pull request number' };
      const kv = fileKV(st);
      if (c.flags['dry-run']) { const p = await planReview(store, item, kv, maxAttempts); return { code: p.action === 'blocked' ? 4 : 0, data: { task, outcome: 'proposed', mode: 'dry-run', plan: p, mutations: 0 }, text: `task review (dry-run) #${item}: ${p.action}: ${p.why} (attempts ${p.attempts.used} of ${p.attempts.max}); no model call, no repository mutation` }; }
      // Live local AI is explicit opt-in (`--runner opencode`): the pinned OpenCode adapter on a loopback-only LM Studio model. Default stays the honest not-ready refusal.
      const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: str(c.flags, 'lmstudio-url') }) : new NotReadyRunner();
      const o = await runReview({ store, item, runner, kv, stopped: () => ctl.stopped || local.stopped, signal: abort.signal, policyDigest: pol.digest,
        cfg: { maxAttempts, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, localModels: cfg.runtime.modelPool, expectedModel: cfg.runtime.modelPool[0], packetRoot: st.path('review', 'packets') } });
      const code = o.kind === 'accepted' || o.kind === 'reused' || o.kind === 'checks-only' ? 0 : o.kind === 'rejected' ? 1 : 4;
      return { code, data: { task, outcome: o.kind, ...o, runner: runner.name }, text: `task review #${item}: ${o.kind.toUpperCase()}: ${o.notice}` };
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
