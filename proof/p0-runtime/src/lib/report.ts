// Proof report: every proof emits inputs, versions, observed effects and pass/fail.
// Not production code - evidence harness only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Check {
  id: string;
  claim: string;
  expected: string;
  observed: unknown;
  pass: boolean;
  /** 'blocked' = a required guarantee is unavailable (stop dependent work). */
  severity?: 'required' | 'informational';
}

export interface Report {
  proof: string; // PROOF-runtime | PROOF-lookup
  area: string;
  startedAt: string;
  finishedAt?: string;
  host: Record<string, string>;
  versions: Record<string, string>;
  inputs: Record<string, unknown>;
  checks: Check[];
  notes: string[];
  verdict?: 'PASS' | 'FAIL';
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROOF_ROOT = path.resolve(here, '..', '..');
export const RESULTS_DIR = path.join(PROOF_ROOT, 'results');

export function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return `unavailable: ${(e as Error).message.split('\n')[0]}`;
  }
}

export function newReport(proof: string, area: string, inputs: Record<string, unknown>): Report {
  return {
    proof,
    area,
    startedAt: new Date().toISOString(),
    host: {
      os: `${sh('sw_vers', ['-productName'])} ${sh('sw_vers', ['-productVersion'])} (${sh('sw_vers', ['-buildVersion'])})`,
      arch: os.arch(),
      node: process.version,
      cpus: String(os.cpus().length),
      memGiB: String(Math.round(os.totalmem() / 2 ** 30)),
    },
    versions: {},
    inputs,
    checks: [],
    notes: [],
  };
}

export function check(r: Report, c: Omit<Check, 'severity'> & { severity?: Check['severity'] }): boolean {
  r.checks.push({ severity: 'required', ...c });
  const tag = c.pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${c.id}: ${c.claim}`);
  if (!c.pass) console.log(`        expected: ${c.expected}\n        observed: ${JSON.stringify(c.observed)?.slice(0, 600)}`);
  return c.pass;
}

export function finish(r: Report, file: string): Report {
  r.finishedAt = new Date().toISOString();
  r.verdict = r.checks.filter((c) => c.severity !== 'informational').every((c) => c.pass) ? 'PASS' : 'FAIL';
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, file), JSON.stringify(r, null, 2) + '\n');
  const p = r.checks.filter((c) => c.pass).length;
  console.log(`\n${r.area}: ${r.verdict} (${p}/${r.checks.length} checks) -> results/${file}`);
  return r;
}
