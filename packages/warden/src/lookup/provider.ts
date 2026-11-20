import { execFileSync } from 'node:child_process';
import type { PullInfo } from '../github/store.ts';
import { buildContext, unavailable } from '../review/context.ts';
import type { ContextPack } from '../review/context.ts';
import { snapshotFromClone } from './checkout.ts';
import { CodeLookup, sha256 } from './service.ts';

/** Review-context provider over a local clone the operator keeps fetched: materialize the pull request HEAD read-only, build the pack, verify every cited file
 *  against `git show <head>:<path>`, then discard the snapshot. Warden never fetches here; a head missing from the clone is reported as unavailable. */
export function lookupProvider(clone: string, o: { root?: string } = {}): (pull: PullInfo, budgetChars: number) => Promise<ContextPack> {
  return async (pull, budgetChars) => {
    const t0 = performance.now(); let snap;
    try { snap = snapshotFromClone(clone, pull.head, o.root); } catch (e) { return unavailable(String((e as Error).message).slice(0, 200), Math.round(performance.now() - t0)); }
    let lk: CodeLookup | undefined;
    try {
      lk = new CodeLookup(snap.dir, snap.commit); const commit = snap.commit; const cache = new Map<string, string | null>();
      const verify = (rel: string, sha: string) => {
        if (!cache.has(rel)) { try { cache.set(rel, sha256(execFileSync('git', ['-C', clone, 'show', `${commit}:${rel}`], { maxBuffer: 64 * 1024 * 1024, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: '/nonexistent' } }).toString('utf8'))); } catch { cache.set(rel, null); } }
        return cache.get(rel) === sha;
      };
      const pack = buildContext(lk, pull.files, { budgetChars, verify }); pack.ms = Math.round(performance.now() - t0); return pack;
    } catch (e) { return unavailable(`lookup failed: ${String((e as Error).message).slice(0, 180)}`, Math.round(performance.now() - t0)); }
    finally { lk?.dispose(); snap.dispose(); }
  };
}
