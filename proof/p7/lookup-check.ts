// Offline check of the reviewer's code lookup (docs/adr/0013-code-lookup.md) on the P7 gsd-core candidate PRs. No model: it builds the context pack each review
// would get and measures it. Output holds numbers and repository-relative paths only, never third-party file text.
// Usage: node proof/p7/lookup-check.ts --clone /abs/gsd-core-clone --out /abs/report.json [--context-chars 16000]
//   The clone needs each PR head and each later-fix PR head:  git fetch origin '+refs/pull/N/head:refs/remotes/origin/pr/N' ...
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotFromClone } from '../../packages/warden/src/lookup/checkout.ts';
import { CodeLookup } from '../../packages/warden/src/lookup/service.ts';
import { buildContext, DEFAULT_CONTEXT_CHARS, summarize } from '../../packages/warden/src/review/context.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const clone = arg('clone'); const out = arg('out'); if (!clone || !out) throw new Error('--clone and --out are required');
const budget = Number(arg('context-chars') ?? DEFAULT_CONTEXT_CHARS);
const g = (a: string[]) => execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
const tryG = (a: string[]) => { try { return g(a); } catch { return ''; } };
const prs = JSON.parse(readFileSync(new URL('./candidates/prs.json', import.meta.url), 'utf8')) as { repo: string; cases: Array<{ number: number; kind: string; path?: string; lineMin?: number; lineMax?: number; changes: number; fix?: { ref: string } }> };
const half = (id: string) => ((createHash('sha256').update(id).digest()[0] & 1) === 0 ? 'dev' : 'holdout');

/** The PR's own diff, the way GitHub shows it: head against the merge base with the branch it targeted (squash-merged heads are not ancestors; merge-committed heads are). */
function prDiff(n: number) {
  const head = g(['rev-parse', `refs/remotes/origin/pr/${n}`]); let best: { base: string; files: Array<{ path: string; status: string; patch: string }>; changes: number } | undefined;
  for (const branch of ['refs/remotes/origin/next', 'refs/remotes/origin/main']) {
    if (!tryG(['rev-parse', '--verify', '--quiet', branch])) continue;
    let base = tryG(['merge-base', branch, head]);
    if (base === head) { const m = tryG(['log', '--merges', '--ancestry-path', '--format=%H %P', `${head}..${branch}`]).split('\n').map((l) => l.split(' ')).find((p) => p[2] === head); if (!m) continue; base = tryG(['merge-base', m[1], head]); }
    if (!base) continue;
    const names = tryG(['diff', '--name-status', '--no-renames', base, head]).split('\n').filter(Boolean).map((l) => l.split('\t'));
    const files = names.map(([s, p]) => ({ path: p, status: s === 'A' ? 'added' : s === 'D' ? 'removed' : 'modified', patch: tryG(['diff', '--no-renames', '-U3', base, head, '--', p]).split('\n').filter((l, i, a) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(l) || a.slice(0, i).some((x) => x.startsWith('@@'))).join('\n') }));
    const changes = files.reduce((t, f) => t + f.patch.split('\n').filter((l) => /^[+-]/.test(l)).length, 0);
    if (!best || Math.abs(changes) && Math.abs(changes - (best.changes)) >= 0 && files.length && (best.files.length === 0 || changes < best.changes)) best = { base, files, changes };
  }
  return { head, ...best! };
}

const rows: unknown[] = [];
for (const c of prs.cases) {
  const id = `pr-${c.number}`; const t0 = performance.now();
  try {
    const d = prDiff(c.number); const own = new Set(d.files.map((f) => f.path));
    const fixN = Number(c.fix?.ref.match(/pull\/(\d+)/)?.[1] ?? 0); const fixFiles = fixN ? prDiff(fixN).files.map((f) => f.path).filter((p) => !own.has(p)) : [];
    const snap = snapshotFromClone(clone, d.head); const lk = new CodeLookup(snap.dir, snap.commit);
    try {
      const pack = buildContext(lk, d.files, { budgetChars: budget }); const cited = new Set(pack.list.map((x) => x.snippet.path));
      const defect = c.kind === 'mustFind' ? { path: c.path, tier: own.has(c.path!) ? lk.tierOf(c.path!) : 'not-in-diff',
        regionInPack: pack.list.some((x) => x.snippet.path === c.path && x.snippet.startLine <= c.lineMax! && x.snippet.endLine >= c.lineMin!) } : undefined;
      rows.push({ id, half: half(id), kind: c.kind, files: d.files.length, changes: d.changes, changesOnGitHub: c.changes, patchChars: d.files.reduce((t, f) => t + f.patch.length, 0),
        pack: { ...summarize(pack), commit: undefined, coverage: pack.coverage }, citedPaths: [...cited], defect, laterFix: fixN ? { pr: fixN, otherFiles: fixFiles, cited: fixFiles.filter((p) => cited.has(p)) } : undefined,
        wallMs: Math.round(performance.now() - t0) });
    } finally { lk.dispose(); snap.dispose(); }
  } catch (e) { rows.push({ id, half: half(id), kind: c.kind, error: String((e as Error).message).slice(0, 200) }); }
  console.error(`${id} done`);
}
writeFileSync(resolve(out), JSON.stringify({ repo: prs.repo, ranAt: new Date().toISOString(), contextChars: budget, cases: rows }, null, 1));
console.log(resolve(out));
