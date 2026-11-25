// Builds the LOCAL replay set from the maintainer-approved candidate references. The set contains third-party issue and patch text (the source repository has no
// license), so it is written OUTSIDE this repository and never committed; only the references and the curator's decisions live here.
// Usage: node --experimental-strip-types proof/p7/build-set.ts --curated-by LOGIN --out /abs/path/set.json [--decisions decisions.json]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const curatedBy = arg('curated-by'); const out = arg('out'); if (!curatedBy || !out) throw new Error('--curated-by and --out are required');
const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
if (!relative(repoRoot, resolve(out)).startsWith('..')) throw new Error('refusing to write the set inside the repository: it contains third-party text');
const here = (f: string) => new URL(f, import.meta.url);
const issues = JSON.parse(readFileSync(here('./candidates/issues.json'), 'utf8')); const prs = JSON.parse(readFileSync(here('./candidates/prs.json'), 'utf8'));
const dec: { drop?: Array<number | string>; override?: Record<string, unknown> } = arg('decisions') ? JSON.parse(readFileSync(resolve(arg('decisions')!), 'utf8')) : {};
const drop = new Set((dec.drop ?? []).map(String));
const gh = (a: string[]) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const cases: unknown[] = [];
for (const c of issues.cases as Array<{ number: number; expect: unknown }>) {
  if (drop.has(`issue-${c.number}`)) continue; const i = gh(['api', `repos/${issues.repo}/issues/${c.number}`]);
  cases.push({ id: `issue-${c.number}`, kind: 'triage', title: i.title, body: String(i.body ?? '').slice(0, 6000), expect: c.expect });
}
for (const c of prs.cases as Array<{ number: number; kind: string; title: string; path?: string; lineMin?: number; lineMax?: number }>) {
  if (drop.has(`pr-${c.number}`)) continue; const files = gh(['api', `repos/${prs.repo}/pulls/${c.number}/files?per_page=100`]) as Array<{ filename: string; status: string; patch?: string }>;
  // Head and base commits let `warden replay --lookup-clone DIR` build repository context; fetch the heads into that clone with
  // `git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'` (references only; nothing from the clone is committed here).
  const pr = gh(['api', `repos/${prs.repo}/pulls/${c.number}`]) as { head: { sha: string }; base: { sha: string } };
  cases.push({ id: `pr-${c.number}`, kind: 'review', title: c.title, head: pr.head.sha, base: pr.base.sha, files: files.filter((f) => f.patch).map((f) => ({ path: f.filename, status: f.status, patch: f.patch! })),
    expect: c.kind === 'clean' ? { clean: true } : { mustFind: [{ path: c.path!, lineMin: c.lineMin!, lineMax: c.lineMax! }] } });
}
mkdirSync(dirname(resolve(out)), { recursive: true, mode: 0o700 });
writeFileSync(resolve(out), JSON.stringify({ name: 'gsd-core-maintainer-set', curatedBy, synthetic: false, cases }, null, 1), { mode: 0o600 });
console.log(JSON.stringify({ out: resolve(out), prs: cases.filter((c: any) => c.kind === 'review').length, issues: cases.filter((c: any) => c.kind === 'triage').length }));
