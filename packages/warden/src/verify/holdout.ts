import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256 } from '../util.ts';
import { runChecks } from './executor.ts';

/** ADR 0016 hidden acceptance checks, a PILOT (owner rulings 2026-11-25 and 2026-11-27, store ruled 2026-11-28). For an approved feature a separate holdout session writes a few acceptance checks from the issue and the
 *  base code only, never the coding session's context. The checks live in the protected operator store (a 0700 directory in the instance home, outside every session's Seatbelt profile), never in the repository. The
 *  executor runs them on the candidate; no session, packet, PR body or comment ever sees their content, only pass or fail per check id. A failure is not a gate: it goes to the maintainer for a verdict (a real defect,
 *  or a wrong check) and the pilot only becomes a gate on the evidence the ADR names. */
export interface HoldoutCfg { enabled: boolean; command: string; args: string[]; timeoutMs: number }
export const DEFAULT_HOLDOUTS: HoldoutCfg = { enabled: false, command: '', args: [], timeoutMs: 120_000 };
export interface HoldoutCheck { id: string; name: string; content: string }
export interface HoldoutResult { id: string; pass: boolean }
/** The pilot's own promotion bar (ADR 0016, ruled 2026-11-27): at least 3 confirmed catches and at least 60 runs with no check the maintainer judged wrong. */
export const PROMOTION = { minCatches: 3, minRuns: 60 };

const safeName = (n: string) => /^[A-Za-z0-9_.\-/]+$/.test(n) && !n.startsWith('/') && !n.split('/').includes('..') && n.length <= 120;
/** Persist checks in the operator store: directory 0700, files 0600. Returns the ids (a short content hash). */
export function saveHoldouts(dir: string, files: ReadonlyArray<{ path: string; content: string }>): string[] {
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); const ids: string[] = [];
  for (const f of files) { if (!safeName(f.path)) continue; const id = sha256(f.path + '\0' + f.content).slice(0, 10); const file = join(dir, `${id}.json`); writeFileSync(file, JSON.stringify({ id, name: f.path, content: f.content }), { mode: 0o600 }); chmodSync(file, 0o600); ids.push(id); }
  return ids;
}
export function loadHoldouts(dir: string): HoldoutCheck[] {
  if (!existsSync(dir)) return []; const out: HoldoutCheck[] = [];
  for (const f of readdirSync(dir).filter((x) => /^[0-9a-f]{10}\.json$/.test(x)).sort()) { try { const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as HoldoutCheck; if (c.id && safeName(c.name) && typeof c.content === 'string') out.push(c); } catch { /* skip an unreadable file */ } }
  return out;
}
/** Run each check on a COPY of the candidate with the check written into it, so the candidate workspace and the store stay untouched. Returns pass or fail per id and nothing else. */
export async function runHoldouts(o: { candidate: string; checks: readonly HoldoutCheck[]; cfg: HoldoutCfg; readonlyPaths?: string[]; now?: () => number }): Promise<HoldoutResult[]> {
  if (!o.cfg.command || !o.checks.length) return [];
  const tmp = mkdtempSync(join(tmpdir(), 'warden-holdout-')); const ws = join(tmp, 'cand');
  try {
    cpSync(o.candidate, ws, { recursive: true });
    const out: HoldoutResult[] = [];
    for (const ck of o.checks) {
      const file = join(ws, ck.name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, ck.content);
      const [r] = await runChecks({ workspace: ws, revision: 'candidate+holdout', checks: [{ id: ck.id, kind: 'test', command: o.cfg.command, args: o.cfg.args.map((a) => a.replace('{file}', ck.name)), timeoutMs: o.cfg.timeoutMs }], readonlyPaths: o.readonlyPaths, now: o.now });
      out.push({ id: ck.id, pass: r.code === 0 && !r.timedOut }); rmSync(file, { force: true });
    }
    return out;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
export function appendTally(file: string, e: { item: number; at: string; total: number; failed: number }): void {
  let runs: Array<typeof e> = []; try { runs = (JSON.parse(readFileSync(file, 'utf8')) as { runs: Array<typeof e> }).runs ?? []; } catch { /* first run */ }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, JSON.stringify({ runs: [...runs, e].slice(-500) }), { mode: 0o600 });
}
export const readTally = (file: string): Array<{ item: number; at: string; total: number; failed: number }> => { try { return (JSON.parse(readFileSync(file, 'utf8')) as { runs: Array<{ item: number; at: string; total: number; failed: number }> }).runs ?? []; } catch { return []; } };
