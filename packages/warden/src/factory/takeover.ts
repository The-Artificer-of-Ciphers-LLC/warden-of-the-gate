/** P4 takeover rules as code: the factory starts from the trusted base, reads abandoned work as DATA (never executing its hooks or scripts), credits the
 *  contributors whose work it ports, and only ever writes to a factory branch, never to the contributor's. */
export interface AbandonedCommit { sha: string; authorLogin: string; authorName: string; authorEmail: string; subject: string; ported: boolean }
export const FACTORY_BRANCH_PREFIX = 'warden/';
export function assertFactoryBranch(target: string, contributorBranch: string, prefix = FACTORY_BRANCH_PREFIX): void {
  if (!target.startsWith(prefix)) throw new Error(`takeover must write to a ${prefix}* branch, not "${target}"`);
  if (target === contributorBranch) throw new Error('takeover never writes to the contributor branch');
}
/** One `Co-authored-by` trailer per distinct contributor whose commits were actually ported; bots and the factory itself are not credited. */
export function creditTrailers(commits: AbandonedCommit[], excludeLogins: string[] = []): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const c of commits.filter((x) => x.ported)) {
    if (excludeLogins.includes(c.authorLogin) || /\[bot\]$/.test(c.authorLogin) || seen.has(c.authorEmail.toLowerCase())) continue;
    seen.add(c.authorEmail.toLowerCase()); out.push(`Co-authored-by: ${c.authorName} <${c.authorEmail}>`);
  }
  return out;
}
/** Paths whose execution would run contributor-controlled code (hooks, scripts, CI definitions): read as text only, never run. */
export const NEVER_EXECUTE = ['.git/hooks/**', '.husky/**', '.github/workflows/**', 'package.json#scripts', 'Makefile', '**/*.sh'];
export const isExecutionSurface = (path: string) => /^(\.husky\/|\.git\/hooks\/|\.github\/workflows\/)/.test(path) || /(^|\/)Makefile$/.test(path) || /\.sh$/.test(path) || path === 'package.json';
