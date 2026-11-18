import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

assert.equal(process.argv[2], '--live');
const offPeak = process.argv[3] === '--off-peak';
assert.equal(process.argv.length, offPeak ? 4 : 3);
const repo = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox';
const workflow = `repos/${repo}/actions/workflows/422227724`;
const originalReport = new URL('../results/schedule-2026-11-18.json', import.meta.url);
const file = offPeak ? new URL('../results/schedule-off-peak-2026-11-18.json', import.meta.url) : originalReport;
assert.ok(!existsSync(file), 'preserve previous evidence before rerunning');
if (offPeak) {
  const previous = JSON.parse(readFileSync(originalReport, 'utf8'));
  assert.equal(previous.pass, false, 'do not alter a schedule that passed its original observation');
  assert.ok(previous.finishedAt, 'the original observation must finish first; live disabled state is checked before any edit');
}
function api(path: string, method = 'GET', body?: unknown): string {
  return execFileSync('gh', ['api', '--method', method, path, ...(body ? ['--input', '-'] : [])],
    { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, timeout: offPeak ? 10_000 : 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
}
const report: { startedAt: string; finishedAt?: string; observingAt?: string; run?: unknown; disabled?: boolean; error?: string; pass: boolean;
  experiment?: string; sourceSha256?: string; cronBefore?: string; cronDuring?: string; changeCommit?: string; restoreCommit?: string;
  registeredActor?: string; restored?: boolean; cleanupErrors?: string[] } = { startedAt: new Date().toISOString(), pass: false };
const contents = `repos/${repo}/contents/.github/workflows/p0-writer.yml`;
const originalCron = "    - cron: '*/15 * * * *'";
const diagnosticCron = "    - cron: '7,22,37,52 * * * *'";
const personal = { name: 'trek-e', email: 'trekkie@nomorestars.com' };
let originalSource: string | undefined;
let diagnosticSource: string | undefined;
let editAttempted = false;
function readWorkflow(): { sha: string; source: string } {
  const item = JSON.parse(api(`${contents}?ref=main`));
  return { sha: item.sha, source: Buffer.from(item.content, 'base64').toString('utf8') };
}
function writeWorkflow(source: string, sha: string, message: string): { sha: string; actor: string | null } {
  const result = JSON.parse(api(contents, 'PUT', { message, sha, branch: 'main', content: Buffer.from(source).toString('base64'),
    author: personal, committer: personal }));
  const commit = JSON.parse(api(`repos/${repo}/commits/${result.commit.sha}`));
  return { sha: result.commit.sha, actor: commit.author?.login ?? null };
}
async function waitForState(expected: RegExp) {
  const deadline = Date.now() + 15_000;
  do {
    if (expected.test(JSON.parse(api(workflow)).state)) return;
    await sleep(1000);
  } while (Date.now() < deadline);
  assert.fail(`workflow state did not converge to ${expected} within 15 seconds`);
}
async function waitForSource(expected: string) {
  const deadline = Date.now() + 15_000;
  do {
    if (readWorkflow().source === expected) return;
    await sleep(1000);
  } while (Date.now() < deadline);
  assert.fail('workflow source did not converge within 15 seconds');
}
async function disable() {
  if (JSON.parse(api(workflow)).state === 'active') {
    try { api(`${workflow}/disable`, 'PUT'); }
    catch (e) {
      if (!(e instanceof Error && e.message.includes('Unable to disable a workflow that is not active.'))) throw e;
    }
  }
  await waitForState(/^disabled_/);
}
let finishing: Promise<void> | undefined;
function finish(): Promise<void> {
  if (finishing) return finishing;
  return finishing = (async () => {
    const cleanupErrors: string[] = [];
    try { await disable(); report.disabled = true; }
    catch (e) { cleanupErrors.push(`disable: ${String(e)}`); }
    if (offPeak && editAttempted) {
      try {
        const current = readWorkflow();
        assert.ok(originalSource && diagnosticSource);
        if (current.source !== originalSource) {
          assert.equal(current.source, diagnosticSource, 'concurrent workflow edit; refuse to overwrite it');
          report.restoreCommit = writeWorkflow(originalSource, current.sha, 'p0 proof: restore original cron after bounded diagnostic\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>').sha;
        }
        await waitForSource(originalSource);
        report.restored = true;
      } catch (e) { cleanupErrors.push(`restore: ${String(e)}`); }
      try { await disable(); report.disabled = true; }
      catch (e) { report.disabled = false; cleanupErrors.push(`final disable: ${String(e)}`); }
    }
    if (offPeak) report.cleanupErrors = cleanupErrors;
    if (cleanupErrors.length) { report.error = `${report.error ?? ''} cleanup: ${cleanupErrors.join('; ')}`; report.pass = false; }
    report.finishedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  })();
}
function interrupted() {
  report.error = 'observation interrupted'; report.pass = false;
  void finish().then(() => process.exit(1), (error) => { console.error(error); process.exit(1); });
}
process.once('SIGTERM', interrupted);
process.once('SIGINT', interrupted);
try {
  if (offPeak) {
    assert.equal(JSON.parse(api('user')).login, 'trek-e');
    assert.match(JSON.parse(api(workflow)).state, /^disabled_/);
    const current = readWorkflow(); originalSource = current.source;
    assert.equal(originalSource.split(originalCron).length, 2, 'expected exactly the approved original cron');
    diagnosticSource = originalSource.replace(originalCron, diagnosticCron);
    report.experiment = 'off-peak cron re-registration with verified personal commit identity; both variables change, so success does not isolate a cause';
    report.sourceSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
    report.cronBefore = '*/15 * * * *'; report.cronDuring = '7,22,37,52 * * * *';
    editAttempted = true;
    const changed = writeWorkflow(diagnosticSource, current.sha, 'p0 proof: register off-peak sandbox cron with verified operator\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>');
    report.changeCommit = changed.sha; report.registeredActor = changed.actor ?? undefined;
    assert.equal(changed.actor, 'trek-e', 'the changed cron must have a GitHub-linked personal author');
    await waitForSource(diagnosticSource);
  }
  api(`${workflow}/enable`, 'PUT');
  await waitForState(/^active$/);
  if (offPeak) report.observingAt = new Date().toISOString();
  console.log('Sandbox p0-writer enabled; bounded schedule observation started');
  const deadline = offPeak ? Date.parse(report.startedAt) + 56 * 60_000 : Date.now() + 59 * 60_000;
  while (!finishing && Date.now() < deadline) {
    const runs = JSON.parse(api(`${workflow}/runs?event=schedule&per_page=10`)).workflow_runs as { created_at: string; status: string; conclusion: string; html_url: string; head_sha: string }[];
    const run = runs.find((r) => r.created_at >= report.startedAt && r.status === 'completed');
    if (run) {
      report.run = run;
      assert.equal(run.conclusion, 'success');
      if (offPeak) {
        const executed = JSON.parse(api(`${contents}?ref=${run.head_sha}`));
        assert.equal(Buffer.from(executed.content, 'base64').toString('utf8'), diagnosticSource, 'scheduled run must execute the diagnostic workflow revision');
      }
      report.pass = true; break;
    }
    await sleep(15_000);
  }
  if (!report.pass) report.error = `No successful schedule-triggered run observed within ${offPeak ? 56 : 59} minutes`;
} catch (e) { report.error = String(e); }
finally { await finish(); }
console.log(JSON.stringify(report));
process.exitCode = report.pass && report.disabled ? 0 : 1;
