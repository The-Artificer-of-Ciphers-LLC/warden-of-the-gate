import { existsSync, mkdirSync } from 'node:fs';
import { git, pushBranch } from '../git/workspace.ts';
import type { PrPublisher } from './slice.ts';

/** Local-only publication: the finished branch is pushed to a bare repository inside the instance directory and nothing leaves the machine. This is the
 *  default because opening a real PR needs write permissions (contents and pull requests) that the current App ceiling does not grant; granting them is an
 *  explicit owner action. The branch is preserved so a maintainer (or the later GitHub publisher) can publish it. */
export class LocalOutboxPublisher implements PrPublisher {
  dir: string; constructor(dir: string) { this.dir = dir; }
  async update(o: { branch: string; sha: string; workspace: string }) { pushBranch(o.workspace, this.dir, o.branch); if (git(this.dir, ['rev-parse', `refs/heads/${o.branch}`]).trim() !== o.sha) throw new Error('local outbox did not record the update'); }
  async open(o: { branch: string; sha: string; workspace: string }) {
    if (!existsSync(this.dir)) { mkdirSync(this.dir, { recursive: true, mode: 0o700 }); git(null, ['init', '-q', '--bare', this.dir]); }
    pushBranch(o.workspace, this.dir, o.branch);
    if (git(this.dir, ['rev-parse', `refs/heads/${o.branch}`]).trim() !== o.sha) throw new Error('local outbox did not record the branch at the expected commit');
    return { number: null, url: `${this.dir}#${o.branch}@${o.sha.slice(0, 8)}` };
  }
}
