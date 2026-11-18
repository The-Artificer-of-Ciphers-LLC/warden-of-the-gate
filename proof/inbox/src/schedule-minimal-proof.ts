import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { redact } from '../../../packages/warden/src/util.ts';

assert.deepEqual(process.argv.slice(2), ['--live']);
const repositories = ['The-Artificer-of-Ciphers-LLC/warden-p0-sandbox', 'The-Artificer-of-Ciphers-LLC/warden-p0-control'];
const workflowPath = '.github/workflows/p1-cron-minimal.yml';
const source = readFileSync(new URL('../workflows/p1-cron-minimal.yml', import.meta.url), 'utf8');
const file = new URL('../results/schedule-minimal-2026-11-18.json', import.meta.url);
assert.ok(!existsSync(file), 'never overwrite earlier evidence');
const identity = { name: 'trek-e', email: 'trekkie@nomorestars.com' };
interface Run { id: number; event: string; status: string; conclusion: string | null; created_at: string; head_sha: string; html_url: string }
interface Case {
  repository: string; workflowId?: number; installAttempted?: boolean; installed?: boolean; installCommit?: string; fileSha?: string;
  manual?: Run; scheduled?: Run; signals: string[]; removed?: boolean; disabled?: boolean;
}
const report: { startedAt: string; finishedAt?: string; sourceSha256: string; observerSha256: string; cases: Case[];
  pass: boolean; symptom?: string; error?: string; cleanupErrors: string[] } = {
  startedAt: new Date().toISOString(), sourceSha256: createHash('sha256').update(source).digest('hex'),
  observerSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  cases: repositories.map((repository) => ({ repository, signals: [] })), pass: false, cleanupErrors: [],
};
function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { input, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] });
}
function api<T>(path: string, method = 'GET', body?: unknown): T {
  const out = gh(['api', '--method', method, path, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined);
  return (out.trim() ? JSON.parse(out) : undefined) as T;
}
function absent(path: string): boolean {
  try { api(path); return false; }
  catch (e) {
    if (e instanceof Error && e.message.includes('(HTTP 404)')) return true;
    throw e;
  }
}
async function registered(item: Case): Promise<number> {
  const path = `repos/${item.repository}/actions/workflows/p1-cron-minimal.yml`;
  const deadline = Date.now() + 45_000;
  do {
    if (!absent(path)) return api<{ id: number }>(path).id;
    await sleep(1000);
  } while (Date.now() < deadline);
  assert.fail('minimal workflow did not register within 45 seconds');
}
function runs(item: Case): Run[] {
  return api<{ workflow_runs: Run[] }>(`repos/${item.repository}/actions/workflows/${item.workflowId}/runs?per_page=20`).workflow_runs;
}
async function disable(item: Case) {
  const path = `repos/${item.repository}/actions/workflows/${item.workflowId}`;
  if (api<{ state: string }>(path).state === 'active') {
    try { api(`${path}/disable`, 'PUT'); }
    catch (e) {
      if (!(e instanceof Error && e.message.includes('Unable to disable a workflow that is not active.'))) throw e;
    }
  }
  const deadline = Date.now() + 15_000;
  do {
    if (/^disabled_/.test(api<{ state: string }>(path).state)) { item.disabled = true; return; }
    await sleep(1000);
  } while (Date.now() < deadline);
  assert.fail('minimal workflow did not confirm disabled');
}
let finishing: Promise<void> | undefined;
function finish(): Promise<void> {
  if (finishing) return finishing;
  return finishing = (async () => {
    for (const item of report.cases) {
      if (!item.installAttempted) continue;
      const path = `repos/${item.repository}/contents/${workflowPath}`;
      try {
        if (!item.installed && absent(`${path}?ref=main`)) { item.removed = true; continue; }
        item.workflowId ??= await registered(item);
        await disable(item);
        for (const run of runs(item).filter((r) => r.status !== 'completed')) {
          try { api(`repos/${item.repository}/actions/runs/${run.id}/cancel`, 'POST'); }
          catch (e) {
            if (api<Run>(`repos/${item.repository}/actions/runs/${run.id}`).status !== 'completed') throw e;
          }
        }
      } catch (e) { report.cleanupErrors.push(redact(`${item.repository} disable/cancel: ${String(e)}`)); }
      try {
        if (absent(`${path}?ref=main`)) { item.removed = true; continue; }
        const current = api<{ sha: string; content: string }>(`${path}?ref=main`);
        assert.equal(Buffer.from(current.content, 'base64').toString('utf8'), source, 'refuse to overwrite a concurrent workflow edit');
        api(path, 'DELETE', { sha: current.sha, branch: 'main', author: identity, committer: identity,
          message: 'Remove bounded minimal cron diagnostic\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>' });
        const deadline = Date.now() + 15_000;
        do {
          if (absent(`${path}?ref=main`)) { item.removed = true; break; }
          await sleep(1000);
        } while (Date.now() < deadline);
        assert.equal(item.removed, true);
      } catch (e) { report.cleanupErrors.push(redact(`${item.repository} remove: ${String(e)}`)); }
    }
    report.finishedAt = new Date().toISOString();
    report.pass = report.pass && !report.error && report.cleanupErrors.length === 0;
    writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  })();
}
function interrupted() {
  report.pass = false; report.error = 'owner interrupted minimal diagnostic';
  void finish().then(() => process.exit(1), (error) => { console.error(redact(String(error))); process.exit(1); });
}
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
try {
  assert.equal(api<{ login: string }>('user').login, 'trek-e');
  for (const id of [422227724, 422227723]) {
    assert.match(api<{ state: string }>(`repos/${repositories[0]}/actions/workflows/${id}`).state, /^disabled_/);
  }
  for (const item of report.cases) {
    assert.equal(api<{ default_branch: string }>(`repos/${item.repository}`).default_branch, 'main');
    assert.ok(absent(`repos/${item.repository}/contents/${workflowPath}?ref=main`), 'never overwrite a pre-existing workflow');
  }
  for (const item of report.cases) {
    assert.ok(!finishing, 'minimal diagnostic interrupted before installation');
    item.installAttempted = true;
    const installed = api<{ content: { sha: string }; commit: { sha: string } }>(`repos/${item.repository}/contents/${workflowPath}`, 'PUT', {
      branch: 'main', author: identity, committer: identity, content: Buffer.from(source).toString('base64'),
      message: 'Install permission-empty minimal cron diagnostic\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
    });
    item.installed = true; item.fileSha = installed.content.sha; item.installCommit = installed.commit.sha;
    item.workflowId = await registered(item);
    assert.ok(!finishing, 'minimal diagnostic interrupted before manual control');
    api(`repos/${item.repository}/actions/workflows/${item.workflowId}/dispatches`, 'POST', { ref: 'main' });
    console.log(`[DEBUG-cron-p1] installed minimal workflow and dispatched one manual control: ${item.repository}`);
  }
  const deadline = Date.parse(report.startedAt) + 10 * 60_000;
  while (!finishing && Date.now() < deadline) {
    for (const item of report.cases) {
      const observed = runs(item).filter((r) => r.head_sha === item.installCommit && r.created_at >= report.startedAt && r.status === 'completed');
      item.manual ??= observed.find((r) => r.event === 'workflow_dispatch');
      item.scheduled ??= observed.find((r) => r.event === 'schedule');
    }
    if (report.cases.every((c) => c.manual?.conclusion === 'success' && c.scheduled?.conclusion === 'success')) break;
    if (report.cases.some((c) => c.manual && c.manual.conclusion !== 'success')) break;
    await sleep(Math.min(10_000, Math.max(0, deadline - Date.now())));
  }
  for (const item of report.cases) {
    for (const run of [item.manual, item.scheduled]) {
      if (!run) continue;
      const logs = gh(['run', 'view', String(run.id), '--repo', item.repository, '--log']);
      item.signals.push(...logs.split('\n').filter((line) => /\[DEBUG-cron-p1\] event=(schedule|workflow_dispatch) schedule=/.test(line)));
    }
  }
  const manual = report.cases.filter((c) => c.manual?.conclusion === 'success').length;
  const scheduled = report.cases.filter((c) => c.scheduled?.conclusion === 'success').length;
  report.symptom = `${manual}/2 manual controls succeeded; ${scheduled}/2 identical minimal workflows observed successful schedule events`;
  report.pass = !report.error && manual === 2 && scheduled === 2;
  console.log(`[DEBUG-cron-p1] ${report.symptom}`);
} catch (e) { report.error = redact(String(e)); }
finally { await finish(); }
console.log(JSON.stringify({ pass: report.pass, symptom: report.symptom, error: report.error, cleanupErrors: report.cleanupErrors }));
process.exitCode = report.pass ? 0 : 1;
