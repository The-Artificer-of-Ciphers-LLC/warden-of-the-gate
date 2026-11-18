import type { InstanceStorage } from '../storage/instance.ts';
import { StorageError } from '../storage/instance.ts';
import type { Store } from '../github/store.ts';
import { readStop, setLabel } from '../writer/control.ts';
import { iso } from '../util.ts';

export interface LocalStop { stopped: boolean; at?: string; by?: string; reason?: string }
function readStopFile(st: InstanceStorage, file: string): LocalStop {
  const value = st.readJson<unknown>(file);
  if (value === null) return { stopped: false };
  if (typeof value !== 'object' || Array.isArray(value) || !('stopped' in value) || typeof value.stopped !== 'boolean'
    || ['at', 'by', 'reason'].some((key) => key in value && typeof Reflect.get(value, key) !== 'string'))
    throw new StorageError(`invalid stop state in ${file}`);
  return { ...value, stopped: value.stopped };
}
export const readLocalStop = (st: InstanceStorage): LocalStop => {
  const instance = readStopFile(st, st.stopPath); const global = readStopFile(st, st.globalStopPath);
  return instance.stopped ? instance : global;
};
export interface ControlTarget { store: Store; issue: number; scope: 'instance' | 'global' }
export interface StopReport {
  scope: string; local: 'stopped'; remote: 'confirmed' | 'unconfirmed'; remoteDetail: string; operatorAttributed: boolean;
  acknowledgements: { env: string; ev: string }[]; globalSuccessClaimed: false;
}

export async function ackList(store: Store, issue: number): Promise<{ env: string; ev: string }[]> {
  try {
    return (await store.listComments(issue)).flatMap((c) => { const m = /<!-- warden-(?:stop|dryrun)-ack env=(\S+) ev=(\S+) -->/.exec(c.body); return m ? [{ env: m[1], ev: m[2] }] : []; });
  } catch { return []; }
}

/** `warden stop`: (1) local stop FIRST (cancels/blocks new local model and verification work even if GitHub is unreachable),
 *  (2) request the shared stop on GitHub, (3) re-read to CONFIRM. A propagation failure is reported as UNCONFIRMED, never as global success. */
export async function requestStop(o: { storage: InstanceStorage; target: ControlTarget | null; operators: string[]; stopLabel: string; actor: string; reason?: string }): Promise<StopReport> {
  o.storage.writeJson(o.target?.scope === 'global' ? o.storage.globalStopPath : o.storage.stopPath, { stopped: true, at: iso(Date.now()), by: o.actor, reason: o.reason ?? 'operator stop' } satisfies LocalStop);
  o.storage.securityAudit('stop-requested', { actor: o.actor, scope: o.target?.scope ?? 'instance', reason: o.reason });
  const rep: StopReport = { scope: o.target?.scope ?? 'instance', local: 'stopped', remote: 'unconfirmed', remoteDetail: 'no authenticated GitHub access (credentials unavailable); stop NOT propagated', operatorAttributed: false, acknowledgements: [], globalSuccessClaimed: false };
  if (!o.target) return rep;
  try {
    await setLabel(o.target.store, o.target.issue, o.stopLabel, true);
    const s = await readStop(o.target.store, o.target.issue, new Set(o.operators), o.target.scope, o.stopLabel);
    if (s.unknown) rep.remoteDetail = 'label set but control state could not be re-read: unconfirmed';
    else if (!s.stopped) rep.remoteDetail = 'label was set but state does not read as stopped: unconfirmed';
    else { rep.remote = 'confirmed'; rep.operatorAttributed = s.lastOperatorEvent !== undefined; rep.remoteDetail = rep.operatorAttributed ? `stop label in force on #${o.target.issue}, attributed to an operator` : `stop label present on #${o.target.issue} but not operator-attributed (acting identity ${o.target.store.actor()} is not in operators)`; }
    rep.acknowledgements = await ackList(o.target.store, o.target.issue);
  } catch (e) { rep.remoteDetail = `propagation failed: ${String((e as Error).message).slice(0, 120)}`; o.storage.securityAudit('stop-propagation-failed', { scope: rep.scope, error: String((e as Error).message).slice(0, 120) }); }
  return rep;
}

export interface ResumeReport { resumed: boolean; refused?: string; local: 'stopped' | 'running'; remote: 'running' | 'stopped' | 'unknown'; notes: string[] }
/** `warden resume`: explicit operator action only. Removes the shared stop, verifies, THEN clears local. Starts no AI, restores no revoked
 *  authority and touches no persisted retry/rework counters (it writes nothing but the stop controls). */
export async function requestResume(o: { storage: InstanceStorage; target: ControlTarget | null; operators: string[]; stopLabel: string; actor: string; confirm: boolean }): Promise<ResumeReport> {
  const notes = ['resume starts no AI work, restores no revoked authority and resets no retry/rework counts'];
  if (!o.confirm) return { resumed: false, refused: 'resume requires explicit confirmation: re-run with --confirm', local: readLocalStop(o.storage).stopped ? 'stopped' : 'running', remote: 'unknown', notes };
  let remote: ResumeReport['remote'] = 'unknown';
  if (o.target) {
    try {
      await setLabel(o.target.store, o.target.issue, o.stopLabel, false);
      const s = await readStop(o.target.store, o.target.issue, new Set(o.operators), o.target.scope, o.stopLabel);
      remote = s.unknown ? 'unknown' : s.stopped ? 'stopped' : 'running';
      if (s.stopped && !s.unknown) notes.push('stop remains in force: ' + s.reasons.join('; '));
    } catch (e) { notes.push(`could not remove remote stop: ${String((e as Error).message).slice(0, 100)}`); }
  } else notes.push('no authenticated GitHub access: remote stop state unknown, staying stopped');
  if (remote !== 'running') return { resumed: false, refused: 'remote stop not confirmed cleared; staying stopped (fail closed)', local: readLocalStop(o.storage).stopped ? 'stopped' : 'running', remote, notes };
  o.storage.writeJson(o.target?.scope === 'global' ? o.storage.globalStopPath : o.storage.stopPath, { stopped: false, at: iso(Date.now()), by: o.actor } satisfies LocalStop);
  o.storage.securityAudit('resumed', { actor: o.actor, scope: o.target?.scope });
  const local = readLocalStop(o.storage).stopped ? 'stopped' : 'running';
  return { resumed: local === 'running', refused: local === 'stopped' ? 'another local stop remains in force; resume that scope explicitly' : undefined, local, remote, notes };
}
