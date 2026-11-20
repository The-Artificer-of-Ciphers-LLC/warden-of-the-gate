import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git } from '../git/workspace.ts';

/** Materialize ONE revision of a local clone as a plain, read-only directory for lookup. `git archive` writes tracked content only: no `.git`, no hooks,
 *  no checkout filters or lifecycle scripts run, and nothing is fetched (a missing revision is reported, never fetched behind the operator's back). */
export interface Snapshot { dir: string; commit: string; dispose(): void }

export function snapshotFromClone(clone: string, rev: string, root = tmpdir()): Snapshot {
  const commit = git(clone, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`revision ${rev.slice(0, 12)} is not in the local clone ${clone}; fetch it first (for a pull request: git fetch origin pull/N/head)`);
  mkdirSync(root, { recursive: true, mode: 0o700 }); const dir = mkdtempSync(path.join(root, 'warden-lookup-'));
  try {
    const tar = execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-C', clone, 'archive', '--format=tar', commit],
      { maxBuffer: 1024 * 1024 * 1024, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: '/nonexistent' } });
    execFileSync('tar', ['-x', '-f', '-', '-C', dir], { input: tar, maxBuffer: 16 * 1024 * 1024 });
    readOnly(dir);
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw new Error(`could not materialize ${commit.slice(0, 12)}: ${String((e as Error).message).slice(0, 200)}`); }
  return { dir, commit, dispose: () => { writable(dir); rmSync(dir, { recursive: true, force: true }); } };
}

function readOnly(d: string) {
  for (const n of readdirSync(d)) { const f = path.join(d, n); const st = lstatSync(f); if (st.isSymbolicLink()) continue; if (st.isDirectory()) { readOnly(f); chmodSync(f, 0o555); } else chmodSync(f, 0o444); }
}
function writable(d: string) {
  try { chmodSync(d, 0o755); } catch { return; }
  for (const n of readdirSync(d)) { const f = path.join(d, n); const st = lstatSync(f); if (st.isDirectory() && !st.isSymbolicLink()) writable(f); }
}
