import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Git mechanics for factory work. Every command runs with hooks disabled and global/system config ignored: repository-supplied hooks and config are DATA,
 *  never executed. The base is a trusted checkout of a named revision; abandoned or contributor work is only ever read as text. */
const SAFE_ENV = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', HOME: '/nonexistent' };
export function git(dir: string | null, args: string[], o: { env?: Record<string, string>; allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', ...(dir ? ['-C', dir] : []), ...args], { encoding: 'utf8', env: { ...SAFE_ENV, ...o.env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { if (o.allowFail) return ''; throw new Error(`git ${args[0]} failed: ${String((e as { stderr?: string }).stderr ?? e).slice(0, 300)}`); }
}
/** Clone `source` and check out EXACTLY `baseSha` (detached): the trusted base the work starts from. */
export function cloneBase(source: string, dir: string, baseSha: string): string {
  git(null, ['clone', '-q', '--no-checkout', source, dir]); git(dir, ['checkout', '-q', '--detach', baseSha]);
  const head = git(dir, ['rev-parse', 'HEAD']).trim(); if (!head.startsWith(baseSha.slice(0, 7))) throw new Error('base checkout did not land on the requested revision'); return head;
}
export const branchFrom = (dir: string, name: string) => { git(dir, ['checkout', '-q', '-b', name]); };
export interface Change { path: string; status: 'A' | 'M' | 'D' | 'R'; patch: string }
/** Changes of the working tree relative to `baseSha`, including untracked files. Patch text is data for the weakening detector and the reviewer. */
export function changes(dir: string, baseSha: string): Change[] {
  git(dir, ['add', '-A', '-N']);
  const names = git(dir, ['diff', '--name-status', baseSha]).split('\n').filter(Boolean).map((l) => { const [s, ...p] = l.split('\t'); return { status: (s[0] as Change['status']), path: p[p.length - 1] }; });
  return names.map((n) => ({ ...n, patch: git(dir, ['diff', baseSha, '--', n.path], { allowFail: true }) }));
}
export function commitAll(dir: string, message: string, author: { name: string; email: string }, trailers: string[] = []): string {
  git(dir, ['add', '-A']); if (!git(dir, ['status', '--porcelain']).trim()) throw new Error('nothing to commit');
  const body = trailers.length ? `${message}\n\n${trailers.join('\n')}` : message;
  git(dir, ['commit', '-q', '-m', body], { env: { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email } });
  return git(dir, ['rev-parse', 'HEAD']).trim();
}
export const pushBranch = (dir: string, remote: string, branch: string, env: Record<string, string> = {}) => { git(dir, ['push', '-q', remote, `HEAD:refs/heads/${branch}`], { env }); };
/** Copy selected paths from one checkout onto another (fail-before: candidate TESTS applied to the BASE source). Deleted paths are removed. */
export function copyPaths(from: string, to: string, paths: string[]) {
  for (const p of paths) { const src = join(from, p); const dst = join(to, p); if (existsSync(src)) { mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); } else rmSync(dst, { force: true }); }
}
export const realDir = (d: string) => realpathSync(d);
