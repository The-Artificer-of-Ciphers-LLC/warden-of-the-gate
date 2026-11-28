// Runs every runtime/isolation/lookup proof and prints a one-screen summary. Exit 1 if any required check fails.
//   node src/run-all.ts            # full set (≈20-30 min: local-model sessions dominate)
//   node src/run-all.ts --fast     # isolation + lookup only (no model calls, ≈10 s)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROOF_ROOT, RESULTS_DIR } from './lib/report.ts';

const fast = process.argv.includes('--fast');
const steps: Array<[string, string]> = [['isolation', 'src/proofs/isolation.ts'], ['lookup', 'src/proofs/lookup.ts'], ...(fast ? [] : [['runtime', 'src/proofs/runtime.ts'] as [string, string]])];
let bad = 0;
for (const [name, file] of steps) {
  console.log(`\n######## ${name} ########`);
  const r = spawnSync(process.execPath, [file], { cwd: PROOF_ROOT, stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log('\n================ SUMMARY ================');
for (const [name] of steps) {
  const j = JSON.parse(readFileSync(path.join(RESULTS_DIR, `${name}.json`), 'utf8'));
  const req = j.checks.filter((c: any) => (c.severity ?? 'required') === 'required');
  const unv = j.checks.filter((c: any) => c.severity === 'unverified');
  const inf = j.checks.length - req.length - unv.length;
  console.log(`${j.verdict.padEnd(5)} ${name.padEnd(10)} ${req.filter((c: any) => c.pass).length}/${req.length} required  (+${inf} informational${unv.length ? `, ${unv.length} unverified: ${unv.map((c: any) => c.id).join(' ')}` : ''})  ${j.startedAt}`);
}
process.exit(bad ? 1 : 0);
