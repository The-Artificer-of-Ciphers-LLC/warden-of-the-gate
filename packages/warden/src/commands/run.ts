import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { readControls } from '../writer/control.ts';
import { readLocalStop } from '../control/stop.ts';
import { runTask, TASK_NAMES } from '../tasks/registry.ts';
import { loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { buildPolicy } from '../config/snapshot.ts';
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
