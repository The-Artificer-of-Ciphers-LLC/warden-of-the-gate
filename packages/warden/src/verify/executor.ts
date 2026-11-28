import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireContainment, runContained } from '../runner/seatbelt.ts';
import type { ContainmentSpec } from '../runner/seatbelt.ts';
import { iso } from '../util.ts';
import { DEFAULT_TEST_PATHS, isGuardedPath, isTestPath } from './frozen.ts';

/** P3 trusted verification executor. The executor, never the model, runs the repository's checks inside the OS boundary and records what happened:
 *  the exact command, the workspace revision, status, bounded output and a digest. Candidate and baseline are run separately so a failure that already
 *  existed on the base stays an explicit baseline failure. Heuristic gate-weakening detection flags a candidate that "passes" by weakening its checks.
 *  Nothing here trusts model-supplied evidence. */
export interface Check { id: string; kind: 'lint' | 'typecheck' | 'test' | 'build'; command: string; args: string[]; timeoutMs?: number }
export interface CheckResult { id: string; kind: Check['kind']; command: string; args: string[]; code: number | null; timedOut: boolean; durationMs: number; outputTail: string; outputSha256: string; revision: string; at: string; contained: true }
export interface ExecutorOpts { workspace: string; revision: string; checks: Check[]; readonlyPaths?: string[]; maxOutputBytes?: number; now?: () => number }

const tail = (s: string, n: number) => (s.length > n ? '...' + s.slice(-n) : s);
/** Runs every check inside Seatbelt with a writable workspace copy, no network and a private HOME/TMPDIR. Containment is verified by canaries first:
 *  an unverified boundary throws and nothing runs. */
export async function runChecks(o: ExecutorOpts): Promise<CheckResult[]> {
  await requireContainment();
  const ws = realpathSync(o.workspace); const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'warden-verify-'))); const out: CheckResult[] = [];
  try {
    for (const c of o.checks) {
      const spec: ContainmentSpec = { workspace: ws, workspaceWritable: true, scratch, readonlyPaths: o.readonlyPaths ?? [] };
      const r = await runContained(spec, c.command, c.args, { cwd: ws, timeoutMs: c.timeoutMs ?? 120_000, maxBytes: o.maxOutputBytes ?? 200_000 });
      const text = (r.stdout + (r.stderr ? '\n' + r.stderr : ''));
      out.push({ id: c.id, kind: c.kind, command: c.command, args: c.args, code: r.code, timedOut: r.timedOut, durationMs: r.durationMs, outputTail: tail(text, 4000), outputSha256: createHash('sha256').update(text).digest('hex'), revision: o.revision, at: iso((o.now ?? Date.now)()), contained: true });
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  return out;
}

export type Relation = 'passes-both' | 'fixed' | 'regression' | 'baseline-failure-persists' | 'baseline-missing';
/** Baseline separation: what the candidate changed relative to the base, per check. A failure that also fails on the base is a baseline failure, never
 *  blamed on the candidate; `fixed` is the fail-before/pass-after evidence a bug fix needs. */
export function compare(base: CheckResult[], cand: CheckResult[]): Array<{ id: string; kind: Check['kind']; base: 'pass' | 'fail' | 'missing'; candidate: 'pass' | 'fail'; relation: Relation }> {
  const ok = (r?: CheckResult) => (r ? (r.code === 0 && !r.timedOut ? 'pass' as const : 'fail' as const) : 'missing' as const);
  return cand.map((c) => { const b = ok(base.find((x) => x.id === c.id)); const n = ok(c) as 'pass' | 'fail';
    const relation: Relation = b === 'missing' ? 'baseline-missing' : b === 'pass' && n === 'pass' ? 'passes-both' : b === 'fail' && n === 'pass' ? 'fixed' : b === 'pass' && n === 'fail' ? 'regression' : 'baseline-failure-persists';
    return { id: c.id, kind: c.kind, base: b, candidate: n, relation }; });
}

export interface PatchFile { path: string; patch: string }
export interface Weakening { path: string; kind: 'skipped-test' | 'removed-assertions' | 'suppression-added' | 'lint-rule-disabled' | 'check-script-changed' | 'ci-changed' | 'strictness-lowered' | 'threshold-lowered' | 'test-removed' | 'focused-test' | 'tolerance-widened' | 'timeout-raised' | 'snapshot-changed' | 'test-config-changed' | 'test-moved'; detail: string }
const isTest = (p: string) => /(^|\/)(test|tests|__tests__|spec)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const ASSERT = /\b(assert(\.\w+)?|expect|should|t\.(is|equal|deepEqual|ok|truthy))\s*\(/;
/** Heuristic, line-based, over the PATCH text. It cannot prove a check was weakened and cannot prove one was not: a finding means "a human or the review must look". */
const firstNumber = (l: string): number | null => { const m = l.match(/(\d+(?:\.\d+)?(?:e-?\d+)?)/i); return m ? Number(m[1]) : null; };
/** A changed line pair (removed, added) that mentions `word` and whose first number went UP. */
const raised = (del: string[], add: string[], word: RegExp): string | null => { for (const a of add) { if (!word.test(a)) continue; const n = firstNumber(a.replace(/^\+/, '')); for (const d of del) { if (!word.test(d)) continue; const m = firstNumber(d.replace(/^-/, '')); if (n !== null && m !== null && n > m) return `${d.slice(1).trim()} -> ${a.slice(1).trim()}`.slice(0, 120); } } return null; };
export function detectWeakening(files: PatchFile[], deleted: string[] = [], testGlobs: readonly string[] = DEFAULT_TEST_PATHS): Weakening[] {
  const out: Weakening[] = [];
  for (const p of deleted) if (isTestPath(p, testGlobs)) { const base = p.split('/').pop(); const moved = files.find((f) => f.path.split('/').pop() === base && !isTestPath(f.path, testGlobs)); if (moved) out.push({ path: p, kind: 'test-moved', detail: `a test file now lives outside the configured test paths: ${moved.path}` }); }
  for (const p of deleted) if (isTest(p)) out.push({ path: p, kind: 'test-removed', detail: 'a test file was deleted' });
  for (const f of files) {
    const lines = f.patch.split('\n'); const add = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')); const del = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
    if (isTest(f.path)) {
      const skip = add.find((l) => /\b(it|test|describe)\.(skip|todo)\b|\bx(it|describe)\s*\(|\bskip\s*:\s*true/.test(l)); if (skip) out.push({ path: f.path, kind: 'skipped-test', detail: skip.slice(1).trim().slice(0, 120) });
      const removed = del.filter((l) => ASSERT.test(l)).length; const added = add.filter((l) => ASSERT.test(l)).length;
      if (removed > added) out.push({ path: f.path, kind: 'removed-assertions', detail: `${removed} assertion line(s) removed, ${added} added` });
      const only = add.find((l) => /\b(it|test|describe|context)\.only\b|\b(fit|fdescribe)\s*\(/.test(l)); if (only) out.push({ path: f.path, kind: 'focused-test', detail: only.slice(1).trim().slice(0, 120) });
      const tol = raised(del, add, /tolerance|delta|epsilon|closeTo|precision|approx/i); if (tol) out.push({ path: f.path, kind: 'tolerance-widened', detail: tol });
    }
    if (isTest(f.path) || /(^|\/)(jest|vitest|playwright|mocha|ava|karma)[^/]*$|\.mocharc/.test(f.path)) { const to = raised(del, add, /timeout|retries|retry|retryTimes/i); if (to) out.push({ path: f.path, kind: 'timeout-raised', detail: to }); }
    if (/\.snap$/.test(f.path) || /(^|\/)__snapshots__\//.test(f.path)) { if (del.length > 0 || add.length > 50) out.push({ path: f.path, kind: 'snapshot-changed', detail: `${del.length} snapshot line(s) removed, ${add.length} added: an existing snapshot was changed or bulk-regenerated` }); }
    if (!isTest(f.path) && isGuardedPath(f.path, testGlobs)) { const cfg = add.concat(del).find((l) => /include|exclude|testMatch|testRegex|testPathIgnore|ignore|mutate|\bfiles\b|\bspec\b/i.test(l)); if (cfg) out.push({ path: f.path, kind: 'test-config-changed', detail: cfg.slice(1).trim().slice(0, 120) }); }
    const sup = add.find((l) => /eslint-disable|Stryker disable|@ts-ignore|@ts-expect-error|\/\/\s*nolint|noqa|#\s*type:\s*ignore/.test(l)); if (sup) out.push({ path: f.path, kind: 'suppression-added', detail: sup.slice(1).trim().slice(0, 120) });
    if (/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|biome\.jsonc?|\.oxlintrc[^/]*)$/.test(f.path)) { const off = add.find((l) => /["']?(off|0)["']?\s*[,}]|"ignorePatterns"|ignores\s*:/.test(l)); if (off) out.push({ path: f.path, kind: 'lint-rule-disabled', detail: off.slice(1).trim().slice(0, 120) }); }
    if (/(^|\/)tsconfig[^/]*\.json$/.test(f.path)) { const lo = add.find((l) => /"(strict|noImplicitAny|strictNullChecks|noUncheckedIndexedAccess)"\s*:\s*false/.test(l)); if (lo) out.push({ path: f.path, kind: 'strictness-lowered', detail: lo.slice(1).trim().slice(0, 120) }); }
    if (/(^|\/)(jest|vitest|c8|\.nycrc)[^/]*$/.test(f.path) || /coverage/i.test(f.path)) { for (const d of del) { const m = d.match(/(\d{2,3})/); const a = add.map((l) => l.match(/(\d{2,3})/)).find(Boolean); if (m && a && Number(a[1]) < Number(m[1]) && /thresh|lines|branches|functions|statements/i.test(d)) { out.push({ path: f.path, kind: 'threshold-lowered', detail: `${m[1]} -> ${a[1]}` }); break; } } }
    if (f.path === 'package.json') { const s = add.concat(del).find((l) => /"(test|lint|typecheck|build|check)"\s*:/.test(l)); if (s) out.push({ path: f.path, kind: 'check-script-changed', detail: s.slice(1).trim().slice(0, 120) }); const t = add.find((l) => /\|\|\s*true|exit 0|--passWithNoTests/.test(l)); if (t) out.push({ path: f.path, kind: 'check-script-changed', detail: 'check made unable to fail: ' + t.slice(1).trim().slice(0, 100) }); }
    if (/^\.github\/workflows\//.test(f.path)) out.push({ path: f.path, kind: 'ci-changed', detail: 'CI definition changed (an authority path: a maintainer decides)' });
  }
  return out;
}

/** Evidence summary used by Implement/Rework/Review: what a bug fix or feature may claim, derived only from executor results. */
export function evidenceFor(kind: 'bug' | 'feature', cmp: ReturnType<typeof compare>, weak: Weakening[]): { sufficient: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (weak.length) reasons.push(`${weak.length} possible gate weakening finding(s) need review`);
  const regress = cmp.filter((c) => c.relation === 'regression'); if (regress.length) reasons.push(`regression in ${regress.map((c) => c.id).join(', ')}`);
  if (kind === 'bug' && !cmp.some((c) => c.kind === 'test' && c.relation === 'fixed')) reasons.push('no test went from failing on the base to passing on the candidate (fail-before/pass-after evidence is required for a bug)');
  if (kind === 'feature' && !cmp.some((c) => c.kind === 'test' && c.candidate === 'pass')) reasons.push('no passing test evidence against the acceptance criteria');
  if (cmp.some((c) => c.relation === 'baseline-missing')) reasons.push('a check has no baseline result');
  return { sufficient: reasons.length === 0, reasons };
}
void existsSync; void mkdirSync;
