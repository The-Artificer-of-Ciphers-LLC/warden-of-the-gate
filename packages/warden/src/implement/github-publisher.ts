import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, pushBranch } from '../git/workspace.ts';
import type { PrPublisher } from './slice.ts';

/** P4 GitHub publisher for FACTORY work. It is never the default: `run` selects it only when the owner passes `--publisher github`, and it needs a GitHub
 *  identity with contents and pull-request WRITE permission, which the issues-only App ceiling does not grant. Safety rules enforced here, not promised:
 *  only `warden/*` branches are ever pushed; pushes are fast-forward only (never forced); the PR is always opened as a DRAFT; and after pushing, the branch tip
 *  that GitHub reports must equal the commit the executor verified, otherwise nothing is reported as opened. */
export interface PullWriter { createPull(o: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<{ number: number; url: string; headSha: string }>; branchHead(branch: string): Promise<string> }
export interface GitRemote { push(o: { workspace: string; branch: string }): Promise<void> }

const FACTORY_PREFIX = 'warden/';
export class GitHubPublisher implements PrPublisher {
  private pulls: PullWriter; private remote: GitRemote; private base: string;
  constructor(pulls: PullWriter, remote: GitRemote, defaultBranch: string) { this.pulls = pulls; this.remote = remote; this.base = defaultBranch; }
  private guard(branch: string) { if (!branch.startsWith(FACTORY_PREFIX) || /\.\.|\s|[~^:?*[\\]/.test(branch) || branch === this.base) throw new Error(`refusing to publish "${branch}": factory branches live under ${FACTORY_PREFIX} only`); }
  async open(o: { branch: string; sha: string; title: string; body: string; workspace: string; baseSha: string }) {
    this.guard(o.branch); await this.remote.push({ workspace: o.workspace, branch: o.branch });
    const tip = await this.pulls.branchHead(o.branch); if (tip !== o.sha) throw new Error(`GitHub reports ${o.branch} at ${tip.slice(0, 8)}, not the verified ${o.sha.slice(0, 8)}: nothing is reported as opened`);
    const pr = await this.pulls.createPull({ head: o.branch, base: this.base, title: o.title, body: o.body, draft: true });
    if (pr.headSha !== o.sha) throw new Error(`the pull request head ${pr.headSha.slice(0, 8)} is not the verified ${o.sha.slice(0, 8)}`);
    return { number: pr.number, url: pr.url };
  }
  async update(o: { branch: string; sha: string; workspace: string; prNumber: number }) {
    this.guard(o.branch); await this.remote.push({ workspace: o.workspace, branch: o.branch });
    const tip = await this.pulls.branchHead(o.branch); if (tip !== o.sha) throw new Error(`GitHub reports ${o.branch} at ${tip.slice(0, 8)}, not the verified ${o.sha.slice(0, 8)}`);
  }
}

/** The token reaches git only through the environment of one child process (GIT_ASKPASS script reading it), never argv, URL, config or disk. */
export function askpassFor(token: string): { env: Record<string, string>; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'warden-askpass-')); const script = join(dir, 'askpass.sh'); writeFileSync(script, '#!/bin/sh\nprintf %s "$WARDEN_GIT_TOKEN"\n', { mode: 0o700 }); chmodSync(script, 0o700);
  return { env: { GIT_ASKPASS: script, WARDEN_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
export class HttpsGitRemote implements GitRemote {
  private repoUrl: string; private token: () => Promise<string>;
  constructor(repository: string, token: () => Promise<string>, host = 'github.com') { this.repoUrl = `https://x-access-token@${host}/${repository}.git`; this.token = token; }
  async push(o: { workspace: string; branch: string }) { const a = askpassFor(await this.token()); try { git(o.workspace, ['push', '-q', this.repoUrl, `HEAD:refs/heads/${o.branch}`], { env: a.env }); } finally { a.cleanup(); } }
}
/** Test/offline remote: pushes to a bare repository path. */
export class PathRemote implements GitRemote { private dir: string; constructor(dir: string) { this.dir = dir; } async push(o: { workspace: string; branch: string }) { pushBranch(o.workspace, this.dir, o.branch); } }
