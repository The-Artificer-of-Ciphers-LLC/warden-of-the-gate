import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

/** ADR 0014: the frozen acceptance tests. Test files are recognised by configured globs (`verification.testPaths`; the defaults below); the test-runner, lint, coverage and mutation configuration
 *  files are guarded with them. After the test session the frozen set (path + content sha256 + the base commit) is recorded; after the fix session the digests are recomputed, and a changed, deleted or
 *  renamed frozen file rejects the attempt. New test files added later are unreviewed additions, never part of the acceptance evidence. */
export const DEFAULT_TEST_PATHS: readonly string[] = ['test/', 'tests/', '__tests__/', '__snapshots__/', '*.test.*', '*.spec.*', '*.snap'];

/** A glob is either a directory name ending in `/` (that directory anywhere in the path) or a file-name glob using `*`. */
function globMatches(glob: string, path: string): boolean {
  const norm = path.split(sep).join('/');
  if (glob.endsWith('/')) return norm.split('/').slice(0, -1).includes(glob.slice(0, -1));
  const re = new RegExp('^' + glob.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  return re.test(basename(norm));
}
export const isTestPath = (path: string, globs: readonly string[] = DEFAULT_TEST_PATHS): boolean => globs.some((g) => globMatches(g, path));

const CONFIG_FILES = [/^(jest|vitest|playwright|cypress|karma|ava|stryker|c8|nyc)\.config\.[cm]?[jt]s$/, /^jest\.config\.json$/, /^\.mocharc(\..+)?$/, /^\.?nycrc(\..+)?$/, /^\.c8rc(\..+)?$/, /^stryker\.conf(ig)?\.(json|[cm]?js)$/, /^\.stryker.*$/, /^eslint\.config\.[cm]?[jt]s$/, /^\.eslintrc(\..+)?$/];
/** The paths the fix session may not write: the tests and the configuration of the tools that judge them. */
export const isGuardedPath = (path: string, globs: readonly string[] = DEFAULT_TEST_PATHS): boolean => isTestPath(path, globs) || CONFIG_FILES.some((r) => r.test(basename(path)));

/** The test session may change tests only: every other changed path (runner configuration included) is returned by name. */
export const nonTestChanges = (changes: ReadonlyArray<{ path: string }>, globs: readonly string[] = DEFAULT_TEST_PATHS): string[] => changes.filter((c) => !isTestPath(c.path, globs)).map((c) => c.path);

export interface FrozenSet { baseCommit: string; files: Array<{ path: string; sha256: string }> }
export interface FrozenViolation { path: string; kind: 'modified' | 'deleted' }
const digest = (file: string): string | null => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null);

export function freezeTests(workspace: string, paths: readonly string[], baseCommit: string): FrozenSet {
  const files = [...new Set(paths)].sort().flatMap((p) => { const d = digest(join(workspace, p)); return d ? [{ path: p, sha256: d }] : []; });
  return { baseCommit, files };
}
/** Recompute every frozen digest in the workspace. A renamed file shows up as deleted at its old path; a different file moved into a frozen path has a different digest. */
export function verifyFrozen(workspace: string, frozen: FrozenSet): FrozenViolation[] {
  const out: FrozenViolation[] = [];
  for (const f of frozen.files) { const d = digest(join(workspace, f.path)); if (d === null) out.push({ path: f.path, kind: 'deleted' }); else if (d !== f.sha256) out.push({ path: f.path, kind: 'modified' }); }
  return out;
}

/** Everything a fix or rework session may not have changed: a frozen file that is modified, deleted or renamed, any existing test or test configuration that is not part of the freeze, and a test-runner configuration it added. */
export function frozenViolations(workspace: string, frozen: FrozenSet, changes: ReadonlyArray<{ path: string; status: string }>, globs: readonly string[] = DEFAULT_TEST_PATHS): string[] {
  const fp = new Set(frozen.files.map((f) => f.path));
  return [...verifyFrozen(workspace, frozen).map((v) => `${v.path} (${v.kind})`), ...changes.filter((x) => isGuardedPath(x.path, globs) && !fp.has(x.path) && (x.status !== 'A' || !isTestPath(x.path, globs))).map((x) => x.path)];
}
/** The freeze record as it travels in an intent payload and sits in the ledger: bounded and exact, or null. */
export const MAX_FROZEN_FILES = 25;
export function cleanFrozen(x: unknown): FrozenSet | null {
  if (!x || typeof x !== 'object') return null; const f = x as { baseCommit?: unknown; files?: unknown };
  if (typeof f.baseCommit !== 'string' || !/^[0-9a-f]{7,64}$/.test(f.baseCommit) || !Array.isArray(f.files) || f.files.length > MAX_FROZEN_FILES) return null;
  const files: FrozenSet['files'] = []; for (const e of f.files as Array<{ path?: unknown; sha256?: unknown }>) { if (!e || typeof e.path !== 'string' || !e.path || e.path.length > 120 || e.path.startsWith('/') || e.path.split('/').includes('..') || typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) return null; files.push({ path: e.path, sha256: e.sha256 }); }
  return { baseCommit: f.baseCommit, files };
}
