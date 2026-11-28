import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../util.ts';
import { parsePatch } from '../review/context.ts';
import { runChecks } from './executor.ts';
import { isTestPath } from './frozen.ts';
import type { Change } from '../git/workspace.ts';

/** ADR 0016 test-quality evidence: mutation score on CHANGED code, run by the executor (never the model) on the candidate inside the boundary. Warden does not rely on the tool's exit code (Stryker's
 *  `thresholds.break` defaults to never failing): it reads the mutation report (mutation-testing-elements JSON) and fails on any surviving mutant whose location is a changed line. A timeout counts as
 *  detected; a compile or runtime error is invalid; a mutant no test covers is a survivor. An equivalent mutant can never be killed, so only a maintainer clears it, by naming that one mutant with a reason
 *  (`/warden clear-mutant <id> <reason>`); the id includes the mutated line's text, so a clearance lapses when that code changes. A language with no configured tool is reported as unsupported, never as a pass. */
export interface MutationCfg { command: string; args: string[]; reportPath: string; timeoutMs: number }
export const DEFAULT_MUTATION: MutationCfg = { command: '', args: [], reportPath: 'reports/mutation/mutation.json', timeoutMs: 600_000 };
export interface Survivor { id: string; path: string; line: number; mutator: string; replacement: string; status: string }
export type MutationResult =
  | { status: 'unsupported'; note: string }
  | { status: 'failed-to-run'; note: string }
  | { status: 'ok'; total: number; killed: number; invalid: number; score: number | null; survivors: Survivor[]; cleared: Survivor[]; note: string };

/** Changed (added) lines of the non-test files a change touches: the only code the mutation check judges. */
export function changedLines(changes: readonly Change[], testGlobs?: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const c of changes) { if (c.status === 'D' || isTestPath(c.path, testGlobs)) continue; const lines = [...parsePatch(c.patch).added.keys()].sort((a, b) => a - b); if (lines.length) out.set(c.path, lines); }
  return out;
}
const rangesOf = (lines: number[]): string[] => { const r: string[] = []; let a = lines[0]; let b = a; for (const n of lines.slice(1)) { if (n === b + 1) b = n; else { r.push(a === b ? `${a}` : `${a}-${b}`); a = b = n; } } r.push(a === b ? `${a}` : `${a}-${b}`); return r; };
/** `{mutate}` in the configured args becomes the comma-separated `file:start-end` list Stryker's `--mutate` accepts. */
export const mutateArg = (lines: Map<string, number[]>): string => [...lines].flatMap(([p, ls]) => rangesOf(ls).map((r) => `${p}:${r}`)).join(',');
export const mutantId = (path: string, mutator: string, replacement: string, anchorLine: string): string => sha256([path, mutator, replacement, anchorLine.trim()].join('\0')).slice(0, 12);

interface RawMutant { id?: string | number; mutatorName?: string; replacement?: string; status?: string; location?: { start?: { line?: number }; end?: { line?: number } } }
/** Pure: judge a mutation report against the changed lines and the maintainer's clearances. `lineText(path, line)` gives the candidate's text of a line (for the mutant id). */
export function evaluateReport(report: unknown, changed: Map<string, number[]>, lineText: (path: string, line: number) => string, cleared: Record<string, unknown> = {}): MutationResult {
  const files = (report as { files?: Record<string, { mutants?: RawMutant[] }> } | null)?.files; if (!files || typeof files !== 'object') return { status: 'failed-to-run', note: 'the mutation report has no files section' };
  let total = 0; let killed = 0; let invalid = 0; const survivors: Survivor[] = []; const clearedOut: Survivor[] = [];
  for (const [path, f] of Object.entries(files)) {
    const lines = changed.get(path); if (!lines) continue; const set = new Set(lines);
    for (const m of f.mutants ?? []) {
      const s = m.location?.start?.line; const e = m.location?.end?.line ?? s; if (typeof s !== 'number' || typeof e !== 'number') continue;
      if (![...Array(e - s + 1).keys()].some((k) => set.has(s + k))) continue;   // not on a changed line
      const st = m.status ?? '';
      if (st === 'Killed' || st === 'Timeout') { total++; killed++; continue; }
      if (st === 'CompileError' || st === 'RuntimeError') { invalid++; continue; }
      // Survived, NoCoverage, and Ignored (an inline disable comment counts as weakening) are survivors.
      total++; const sv: Survivor = { id: mutantId(path, m.mutatorName ?? 'unknown', m.replacement ?? '', lineText(path, s)), path, line: s, mutator: m.mutatorName ?? 'unknown', replacement: String(m.replacement ?? '').slice(0, 80), status: st || 'Survived' };
      (cleared[sv.id] ? clearedOut : survivors).push(sv);
    }
  }
  return { status: 'ok', total, killed, invalid, score: total ? Math.round((killed / total) * 1000) / 10 : null, survivors, cleared: clearedOut, note: `${killed} of ${total} mutant(s) on changed lines detected${invalid ? `, ${invalid} invalid` : ''}` };
}

/** Run the configured tool once on the candidate (inside the boundary) and judge its report. No tool configured => unsupported. */
export async function runMutation(o: { workspace: string; changes: readonly Change[]; cfg: MutationCfg; cleared?: Record<string, unknown>; testGlobs?: readonly string[]; readonlyPaths?: string[]; now?: () => number }): Promise<MutationResult> {
  if (!o.cfg.command) return { status: 'unsupported', note: 'no mutation tool is configured for this repository (verification.mutation): unsupported, and unsupported is not a pass' };
  const changed = changedLines(o.changes, o.testGlobs); if (!changed.size) return { status: 'ok', total: 0, killed: 0, invalid: 0, score: null, survivors: [], cleared: [], note: 'no changed non-test lines to mutate' };
  const args = o.cfg.args.map((a) => a.replace('{mutate}', mutateArg(changed)));
  const [res] = await runChecks({ workspace: o.workspace, revision: 'candidate', checks: [{ id: 'mutation', kind: 'test', command: o.cfg.command, args, timeoutMs: o.cfg.timeoutMs }], readonlyPaths: o.readonlyPaths, now: o.now });
  const file = join(o.workspace, o.cfg.reportPath);
  if (res.timedOut || !existsSync(file)) return { status: 'failed-to-run', note: `the mutation tool ${res.timedOut ? 'timed out' : `wrote no report at ${o.cfg.reportPath}`} (exit ${res.code}): ${res.outputTail.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}` };
  let report: unknown; try { report = JSON.parse(readFileSync(file, 'utf8')); } catch { return { status: 'failed-to-run', note: 'the mutation report is not valid JSON' }; }
  const text = (p: string, line: number) => { try { return readFileSync(join(o.workspace, p), 'utf8').split('\n')[line - 1] ?? ''; } catch { return ''; } };
  return evaluateReport(report, changed, text, o.cleared);
}
