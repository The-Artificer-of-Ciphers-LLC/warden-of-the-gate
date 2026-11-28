import { realpathSync } from 'node:fs';
import { git } from '../git/workspace.ts';
import { workingTree } from './load.ts';
import type { ConfigSource } from './load.ts';
import { HUMAN_GATE_PATHS, matchesAny } from './policy.ts';

/** Trusted-base evaluation (PRD §3, confirmed by the owner on 2026-11-27; ADR 0010). Warden reads `.github/warden.yml`, `.github/ORDERS.yaml`,
 *  its workflows and the rule files it enforces from ONE trusted base revision of the default branch, never from a pull request's head or from an
 *  uncommitted working tree. A pull request that edits one of them therefore cannot change the rules used to review it. */

/** The paths whose content Warden reads as policy or enforces. They are the mandatory human-gate paths: a change to any of them needs a maintainer
 *  decision (config/policy.ts) and a full review, never a delta review (review/slice.ts). */
export const TRUSTED_INPUT_PATHS: readonly string[] = HUMAN_GATE_PATHS;
export const trustedInputsTouched = (paths: readonly string[]): string[] => paths.filter((p) => matchesAny(p, [...TRUSTED_INPUT_PATHS]));

/** The default trusted ref of a local clone: the remote's default branch as `git clone` records it. A stale fetch is still default-branch content. */
export const DEFAULT_TRUSTED_REF = 'refs/remotes/origin/HEAD';

export interface TrustedSource { source: ConfigSource; kind: 'revision' | 'directory'; ref?: string; revision?: string; note: string }
export type TrustedResult = { ok: true; value: TrustedSource } | { ok: false; error: string };

/** Is `dir` the top of a git work tree? A directory nested inside some other repository is not a checkout of the governed repository. */
function workTreeTop(dir: string): boolean {
  const top = git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true }).trim();
  if (!top) return false;
  try { return realpathSync(top) === realpathSync(dir); } catch { return false; }
}

/** Reads files from one commit through git's object store: the working tree, the index and the checked-out branch play no part. */
export function revisionSource(dir: string, revision: string): ConfigSource {
  return {
    describe: (rel) => `${revision.slice(0, 12)}:${rel}`,
    read: (rel) => {
      const spec = `${revision}:${rel}`;
      if (git(dir, ['cat-file', '-t', spec], { allowFail: true }).trim() !== 'blob') return null;
      return git(dir, ['cat-file', 'blob', spec]);
    },
  };
}

/** Choose where policy is read from.
 *  - `dir` is the top of a git work tree: read from the trusted ref (`ref`, else `refs/remotes/origin/HEAD`), resolved to one commit. Unresolvable fails
 *    closed: Warden never falls back to the working tree, because that may be a pull request's head or an uncommitted edit.
 *  - `dir` is not a git checkout (a plain directory, as in Actions-side drains of an extracted tree or the simulated backends): the directory itself,
 *    which the caller asserts holds default-branch content. `ref` given for such a directory is refused, since it cannot be honoured. */
export function trustedSource(dir: string, ref?: string): TrustedResult {
  if (!workTreeTop(dir)) {
    if (ref) return { ok: false, error: `trusted base ref ${ref} was given, but ${dir} is not the top of a git checkout` };
    return { ok: true, value: { source: workingTree(dir), kind: 'directory', note: `policy read from the directory ${dir} (not a git checkout; it must hold default-branch content)` } };
  }
  const want = ref ?? DEFAULT_TRUSTED_REF;
  const revision = git(dir, ['rev-parse', '--verify', '--quiet', `${want}^{commit}`], { allowFail: true }).trim();
  if (!/^[0-9a-f]{40,64}$/.test(revision)) {
    return { ok: false, error: `cannot resolve the trusted base revision ${want} in ${dir}. Policy is read only from the default branch, never from the working tree: run \`git remote set-head origin --auto\`, or pass --trusted-ref (WARDEN_TRUSTED_REF) naming the default branch` };
  }
  return { ok: true, value: { source: revisionSource(dir, revision), kind: 'revision', ref: want, revision, note: `policy read from ${want} at ${revision.slice(0, 12)}` } };
}

/** Policy files whose working-tree copy differs from the trusted revision: shown to the operator so an uncommitted or PR-head edit is visibly NOT in force. */
export function workingTreeDrift(dir: string, t: TrustedSource, files: readonly string[]): string[] {
  if (t.kind !== 'revision') return [];
  const wt = workingTree(dir);
  return files.filter((f) => { let a: string | null = null; try { a = wt.read(f); } catch { a = null; } return a !== t.source.read(f); });
}
