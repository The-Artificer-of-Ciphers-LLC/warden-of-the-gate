import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

assert.equal(process.argv[2], '--live');
const repo = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox';
const workflow = `repos/${repo}/actions/workflows/422227724`;
const file = new URL('../results/schedule-2026-11-18.json', import.meta.url);
assert.ok(!existsSync(file), 'preserve previous evidence before rerunning');
function api(path: string, method = 'GET'): string {
  return execFileSync('gh', ['api', '--method', method, path], { encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
}
const report: { startedAt: string; finishedAt?: string; run?: unknown; disabled?: boolean; error?: string; pass: boolean } = { startedAt: new Date().toISOString(), pass: false };
let finishing = false;
function finish() {
  if (finishing) return;
  finishing = true;
  try {
    if (JSON.parse(api(workflow)).state === 'active') api(`${workflow}/disable`, 'PUT');
    report.disabled = /^disabled_/.test(JSON.parse(api(workflow)).state);
    assert.ok(report.disabled);
  } catch (e) { report.error = `${report.error ?? ''} cleanup: ${String(e)}`; report.pass = false; }
  report.finishedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
process.once('SIGTERM', () => { report.error = 'observation interrupted'; finish(); process.exit(1); });
process.once('SIGINT', () => { report.error = 'observation interrupted'; finish(); process.exit(1); });
try {
  api(`${workflow}/enable`, 'PUT');
  assert.equal(JSON.parse(api(workflow)).state, 'active');
  console.log('Sandbox p0-writer enabled; bounded schedule observation started');
  const deadline = Date.now() + 59 * 60_000;
  while (Date.now() < deadline) {
    const runs = JSON.parse(api(`${workflow}/runs?event=schedule&per_page=10`)).workflow_runs as { created_at: string; status: string; conclusion: string; html_url: string }[];
    const run = runs.find((r) => r.created_at >= report.startedAt && r.status === 'completed');
    if (run) { report.run = run; assert.equal(run.conclusion, 'success'); report.pass = true; break; }
    await sleep(15_000);
  }
  if (!report.pass) report.error = 'No successful schedule-triggered run observed within 59 minutes';
} catch (e) { report.error = String(e); }
finally { finish(); }
console.log(JSON.stringify(report));
process.exitCode = report.pass && report.disabled ? 0 : 1;
