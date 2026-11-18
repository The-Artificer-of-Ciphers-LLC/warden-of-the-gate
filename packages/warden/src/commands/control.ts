import { existsSync, readFileSync } from 'node:fs';
import { requestResume, requestStop } from '../control/stop.ts';
import type { ControlTarget } from '../control/stop.ts';
import { buildPolicy } from '../config/snapshot.ts';
import { loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';

function ctx(c: Ctx) {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { err: { code: 1, data: { errors: cfgs.errors }, text: 'configuration invalid:\n' + cfgs.errors.join('\n') } as Result };
  const cfg = cfgs.warden; const st = openStorage(c, cfg.repository, false); const be = openBackend(c, cfg); const pol = buildPolicy(cfg, cfgs.orders);
  const global = !!c.flags.global;
  let target: ControlTarget | null = null; let note = be.unavailable;
  const s = be.open('operator', global ? cfg.inbox.globalControl?.repository : undefined);
  if (global && !cfg.inbox.globalControl) { note = 'no global control location configured in warden.yml (inbox.globalControl)'; }
  else if (s) target = { store: s, issue: global ? cfg.inbox.globalControl!.issue : cfg.inbox.controlIssue, scope: global ? 'global' : 'instance' };
  return { cfg, st, pol, target, note, actor: str(c.flags, 'as') ?? cfg.maintainers[0] };
}
/** `warden stop`: local first, then shared; reports local vs remotely confirmed; unconfirmed propagation is never reported as success. */
export async function stop(c: Ctx): Promise<Result> {
  const x = ctx(c); if ('err' in x && x.err) return x.err;
  const { cfg, st, pol, target, note, actor } = x as Exclude<typeof x, { err: Result }>;
  // cancel an in-flight local run (new model/verification work is blocked by the local stop file immediately)
  let cancelled: string | null = null; const ar = st.readJson<{ pid: number; task: string }>(st.path('active-run.json'));
  if (ar && ar.pid !== process.pid) { try { process.kill(ar.pid, 0); process.kill(ar.pid, 'SIGTERM'); cancelled = `SIGTERM sent to run pid ${ar.pid} (${ar.task}); it checkpoints and exits`; } catch { cancelled = null; } }
  const rep = await requestStop({ storage: st, target, operators: pol.operators, stopLabel: cfg.inbox.stopLabel, actor, reason: str(c.flags, 'reason') });
  const text = [`local: STOPPED (new local model/verification work is refused)`, cancelled ?? 'no in-flight local run to cancel',
    `remote (${rep.scope}): ${rep.remote.toUpperCase()} - ${rep.remoteDetail}${!target && note ? ` [${note}]` : ''}`,
    `writer acknowledgements: ${rep.acknowledgements.length ? rep.acknowledgements.map((a) => a.env).join(', ') : 'none yet (unconfirmed until a writer acknowledges)'}`,
    rep.remote === 'confirmed' ? 'stop requested and confirmed on GitHub; writers act on it before their next task/effect. Already-accepted external effects are not recalled; they are reconciled.' : 'WARNING: the shared stop is NOT confirmed. Global success is not claimed; writers may continue until the stop propagates.'].join('\n');
  return { code: rep.remote === 'confirmed' ? 0 : 2, data: { ...rep, cancelled }, text };
}
export async function resume(c: Ctx): Promise<Result> {
  const x = ctx(c); if ('err' in x && x.err) return x.err;
  const { cfg, st, pol, target, actor } = x as Exclude<typeof x, { err: Result }>;
  const rep = await requestResume({ storage: st, target, operators: pol.operators, stopLabel: cfg.inbox.stopLabel, actor, confirm: !!c.flags.confirm });
  return { code: rep.resumed ? 0 : 1, data: { ...rep }, text: `${rep.resumed ? 'RESUMED' : 'NOT resumed'}: local ${rep.local}, remote ${rep.remote}${rep.refused ? ` - ${rep.refused}` : ''}\n${rep.notes.join('\n')}` };
}
void existsSync; void readFileSync;
