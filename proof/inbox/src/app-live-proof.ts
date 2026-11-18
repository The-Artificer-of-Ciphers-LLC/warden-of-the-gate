import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID, sign } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { HttpStore } from '../../../packages/warden/src/github/http.ts';
import type { CredentialProvider, Permissions } from '../../../packages/warden/src/credentials/types.ts';
import { readStop } from './control.ts';
import { runScenarios } from './scenarios.ts';
import type { Actor, Env, ScenarioResult } from './scenarios.ts';
import { Faults, sleep } from './util.ts';

const SANDBOX = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox';
const CONTROL = 'The-Artificer-of-Ciphers-LLC/warden-p0-control';
const APP_ID = 5819526;
const INSTALLATION_ID = 183378787;
const APP_LOGIN = 'warden-p0-sandbox-app[bot]';
const SECRET = 'WARDEN_P0_CONTROL_READ_TOKEN';
const WORKFLOW = '.github/workflows/p0-app-proof.yml';
const identity = { name: 'trek-e', email: '4738965+trek-e@users.noreply.github.com' };
const message = (s: string) => `${s}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`;
function gh(args: string[], input?: string) {
  return execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
}
function ghJson<T>(args: string[], body?: unknown): T {
  return JSON.parse(gh(['api', ...args, ...(body === undefined ? [] : ['--input', '-'])], body === undefined ? undefined : JSON.stringify(body))) as T;
}
function disableWorkflow(id: number) {
  const path = `repos/${SANDBOX}/actions/workflows/${id}`;
  if (ghJson<{ state: string }>([path]).state === 'active') gh(['api', '-X', 'PUT', `${path}/disable`]);
  assert.match(ghJson<{ state: string }>([path]).state, /^disabled_/, 'workflow must be confirmed disabled');
}
async function api<T>(token: string, method: string, path: string, body?: unknown, expected = [200]) {
  assert.ok(/^\/(?:app(?:\/|$)|installation(?:\/|$))/.test(path) || [SANDBOX, CONTROL].some((r) => path.startsWith(`/repos/${r}/`)), 'sandbox API guard');
  const response = await fetch(`https://api.github.com${path}`, {
    method, signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!expected.includes(response.status)) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
}
interface Issued { token: string; expires_at: string; repositories: { full_name: string }[]; permissions: Record<string, string> }
interface WorkflowRun { id: number; display_title: string; status: string; conclusion: string | null; html_url: string }
interface ActionResult {
  mode: string; state: { stopped: boolean; unknown: boolean }; writerAuthor: string; writerCommentId: number;
  repoScopedReadStatus: number; crossScopeReadStatus: number; readOnlyWriteStatus: number;
}
const report: {
  at: string; sourceCommit: string; sourceHashes: Record<string, string>; scope: string; appId: number; installationId: number; appLogin: string;
  checks: { name: string; pass: boolean; observed?: unknown }[];
  credentials: { repository: string; expiresAt: string; permissions: Record<string, string> }[];
  scenarios: ScenarioResult[]; actions: (ActionResult & { runUrl: string })[]; cleanupErrors: string[];
  scheduleRuns?: unknown; error?: string; pass?: boolean;
} = { at: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), scope: 'app-and-scenarios',
  sourceHashes: Object.fromEntries(['proof/inbox/src/app-live-proof.ts', 'proof/inbox/src/scenarios.ts', 'proof/inbox/workflows/p0-app-proof.yml', 'packages/warden/src/github/http.ts']
    .map((file) => [file, createHash('sha256').update(readFileSync(new URL('../../../' + file, import.meta.url))).digest('hex')])),
  appId: APP_ID, installationId: INSTALLATION_ID, appLogin: APP_LOGIN, checks: [], credentials: [], scenarios: [], actions: [], cleanupErrors: [] };
const check = (name: string, pass: boolean, observed?: unknown) => {
  report.checks.push({ name, pass, observed }); console.error(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  assert.ok(pass, name);
};
function store(repo: string, login: string, token: string, permissions: Permissions, faults = new Faults()) {
  assert.ok([SANDBOX, CONTROL].includes(repo));
  const provider: CredentialProvider = { token: async (req) => { assert.equal(req.repository, repo); return token; }, status: () => [] };
  return Object.assign(new HttpStore(repo, provider, { operation: 'write', repository: repo, permissions }, login), { faults });
}
const [flag, keyArg, selector] = process.argv.slice(2);
assert.equal(flag, '--live', 'explicit --live and the approved private-key path are required');
assert.ok(selector === undefined || selector === '--actions-only');
const actionsOnly = selector === '--actions-only';
report.scope = actionsOnly ? 'app-actions-only' : 'app-and-scenarios';
const reportFile = new URL('../results/live-app-2026-11-18.json', import.meta.url);
assert.ok(!existsSync(reportFile), 'preserve the existing report under an attempt filename before rerunning');
assert.ok(keyArg);
const keyPath = resolve(keyArg);
assert.ok(keyPath.startsWith(resolve(homedir(), '.warden-p0') + sep), 'key must stay in the approved protected directory');
const keyStat = lstatSync(keyPath);
assert.ok(keyStat.isFile() && !keyStat.isSymbolicLink() && (keyStat.mode & 0o777) === 0o600, 'private key must be a regular mode-600 file');
assert.equal(ghJson<{ login: string }>(['user']).login, 'trek-e');
const operatorToken = gh(['auth', 'token']).trim();
const operator = store(SANDBOX, 'trek-e', operatorToken, { issues: 'write' });
const controlOperator = store(CONTROL, 'trek-e', operatorToken, { issues: 'write' });
const issued: Issued[] = [];
const sandboxIssues: number[] = [];
let controlIssue: number | undefined;
let secretCreated = false;
let workflowSha: string | undefined;
let workflowId: number | undefined;
let revokedControl = false;
let createdControlLabel = false;
let env: Env | undefined;
async function mint(repository: string, issues: 'read' | 'write') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: APP_ID })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), readFileSync(keyPath)).toString('base64url')}`;
  const credential = await api<Issued>(jwt, 'POST', `/app/installations/${INSTALLATION_ID}/access_tokens`, {
    repositories: [repository.split('/')[1]], permissions: { issues, metadata: 'read' },
  }, [201]);
  issued.push(credential);
  assert.deepEqual(credential.repositories.map((r) => r.full_name), [repository]);
  assert.deepEqual(credential.permissions, { issues, metadata: 'read' });
  assert.ok(Date.parse(credential.expires_at) - Date.now() <= 3600_000 + 60_000);
  report.credentials.push({ repository, expiresAt: credential.expires_at, permissions: credential.permissions });
  return credential;
}
async function dispatch(mode: string, writerIssue: number) {
  assert.ok(workflowId);
  const nonce = randomUUID();
  gh(['api', '-X', 'POST', `repos/${SANDBOX}/actions/workflows/${workflowId}/dispatches`, '--input', '-'], JSON.stringify({
    ref: 'main', inputs: { mode, nonce, control_issue: String(controlIssue), writer_issue: String(writerIssue) },
  }));
  console.error(`Actions ${mode}: dispatched; waiting up to five minutes`);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const runs = ghJson<{ workflow_runs: WorkflowRun[] }>([`repos/${SANDBOX}/actions/workflows/${workflowId}/runs?event=workflow_dispatch&per_page=10`]).workflow_runs;
    const run = runs.find((r) => r.display_title.includes(nonce));
    if (!run || run.status !== 'completed') continue;
    const logs = gh(['run', 'view', String(run.id), '-R', SANDBOX, '--log']);
    const match = logs.match(/APP_PROOF_RESULT (\{[^\n]+\})/);
    if (run.conclusion !== 'success' || !match) throw new Error(`Actions ${mode} failed: ${run.html_url}; proof result ${match ? 'present' : 'absent'}`);
    const result = JSON.parse(match[1]) as ActionResult;
    assert.equal(result.mode, mode); report.actions.push({ ...result, runUrl: run.html_url });
    console.error(`PASS Actions ${mode}: ${run.html_url}`);
    return result;
  }
  throw new Error(`Actions ${mode} exceeded the five-minute observation window`);
}
try {
  const install = ghJson<{ installations: { id: number; app_id: number; repository_selection: string; permissions: Record<string, string> }[] }>(['orgs/The-Artificer-of-Ciphers-LLC/installations']).installations.find((i) => i.id === INSTALLATION_ID);
  assert.equal(install?.app_id, APP_ID); assert.equal(install.repository_selection, 'selected');
  assert.deepEqual(install.permissions, { actions: 'read', issues: 'write', metadata: 'read' });
  const secrets = ghJson<{ secrets: { name: string }[] }>([`repos/${SANDBOX}/actions/secrets`]).secrets;
  assert.ok(!secrets.some((s) => s.name === SECRET), 'never overwrite an existing secret');
  const files = ghJson<{ name: string }[]>([`repos/${SANDBOX}/contents/.github/workflows`]);
  assert.ok(!files.some((f) => f.name === 'p0-app-proof.yml'), 'never overwrite an existing workflow');
  const submitCredential = await mint(SANDBOX, 'write');
  const controlCredential = await mint(CONTROL, 'read');
  check('scoped installation tokens minted without persisting or printing their values', issued.length === 2);
  const app = store(SANDBOX, APP_LOGIN, submitCredential.token, { issues: 'write' });
  const controlRead = store(CONTROL, APP_LOGIN, controlCredential.token, { issues: 'read' });
  const writerIssue = await operator.createIssue('[P0 App proof] identity and cross-repo Actions', 'Disposable fixture. No production effects.');
  sandboxIssues.push(writerIssue);
  const comment = await app.createComment(writerIssue, 'App-authored submit identity proof.');
  check('installation token produces the distinct App bot author', comment.author === APP_LOGIN, { author: comment.author, operator: 'trek-e' });
  check('sandbox-only App token cannot read the other private control repository',
    await fetch(`https://api.github.com/repos/${CONTROL}/issues`, { headers: { authorization: `Bearer ${submitCredential.token}` } }).then((r) => [403, 404].includes(r.status)));
  if (!actionsOnly) {
    const scenarioIssues: number[] = [];
    env = {
      backend: 'github', ttlMs: 20_000, scale: { flood: 20, races: 3 }, contributor: 'trek-e',
      operators: ['trek-e'], allowed: ['trek-e', APP_LOGIN], assignable: () => false,
      store: (actor: Actor, faults = new Faults()) => ['contrib', 'operator', 'mallory'].includes(actor)
        ? store(SANDBOX, 'trek-e', operatorToken, { issues: 'write' }, faults)
        : store(SANDBOX, APP_LOGIN, submitCredential.token, { issues: 'write' }, faults),
      newIssue: async (title) => { const n = await operator.createIssue(`[P0 App proof] ${title}`, 'Disposable two-identity proof fixture.'); scenarioIssues.push(n); return n; },
      closeAll: async () => { for (const n of scenarioIssues) await operator.closeIssue(n); },
    };
    const scenarios = await runScenarios('github', ['S02', 'S03', 'S10', 'S11'], env);
    report.scenarios = scenarios.results;
    check('S02/S03/S10/S11 pass with real human and App identities (both scenario writers run locally)',
      scenarios.results.length === 4 && scenarios.results.every((r) => r.pass));
  }
  const stopIssue = await operator.createIssue('[P0 App proof] non-operator stop removal', 'Disposable operator-authority fixture.');
  sandboxIssues.push(stopIssue);
  await operator.addLabel(stopIssue, 'warden:stop'); await app.removeLabel(stopIssue, 'warden:stop');
  const held = await readStop(app, stopIssue, new Set(['trek-e']), 'instance');
  check('App removing the human operator stop cannot resume', held.stopped && !held.unknown, held);
  await operator.addLabel(stopIssue, 'warden:stop'); await operator.removeLabel(stopIssue, 'warden:stop');
  check('explicit human operator resume clears the stop', !(await readStop(app, stopIssue, new Set(['trek-e']), 'instance')).stopped);
  controlIssue = await controlOperator.createIssue('[P0 App proof] global stop control', 'Disposable cross-repository global-control fixture.');
  assert.ok(typeof controlIssue === 'number' && controlIssue > 0);
  createdControlLabel = await controlOperator.createLabel('warden:stop', 'Disposable Warden stop-control proof') !== 'exists';
  await controlOperator.addLabel(controlIssue, 'warden:stop');
  check('Mac App token reads a stopped control in the other private repository', (await readStop(controlRead, controlIssue, new Set(['trek-e']), 'global')).stopped);
  gh(['secret', 'set', SECRET, '-R', SANDBOX], controlCredential.token);
  secretCreated = true;
  workflowSha = ghJson<{ content: { sha: string } }>(['-X', 'PUT', `repos/${SANDBOX}/contents/${WORKFLOW}`], {
    message: message('Install temporary sandbox App proof'), author: identity, committer: identity,
    content: readFileSync(new URL('../workflows/p0-app-proof.yml', import.meta.url)).toString('base64'),
  }).content.sha;
  console.error('Waiting up to 90 seconds for GitHub to register the new workflow');
  const registrationDeadline = Date.now() + 90_000;
  while (Date.now() < registrationDeadline) {
    const workflows = ghJson<{ workflows: { id: number; path: string }[] }>([`repos/${SANDBOX}/actions/workflows?per_page=100`]).workflows;
    workflowId = workflows.find((w) => w.path === WORKFLOW)?.id;
    if (workflowId) break;
    await sleep(2000);
  }
  assert.ok(workflowId, 'temporary workflow was not registered within 90 seconds');
  gh(['api', '-X', 'PUT', `repos/${SANDBOX}/actions/workflows/${workflowId}/enable`]);
  await dispatch('stopped', writerIssue);
  await controlOperator.removeLabel(controlIssue, 'warden:stop');
  await dispatch('running', writerIssue);
  await api(controlCredential.token, 'DELETE', '/installation/token', undefined, [204]); revokedControl = true;
  await dispatch('unknown', writerIssue);
  check('revoked control token fails closed in Actions without falling back to GITHUB_TOKEN', report.actions[2].state.stopped && report.actions[2].state.unknown);
} catch (e) {
  report.error = e instanceof Error ? e.message : 'non-Error proof failure';
  console.error(`PROOF FAILED: ${report.error}`);
} finally {
  const cleanup = async (name: string, action: () => unknown | Promise<unknown>) => {
    try { await action(); console.error(`CLEANUP ${name}`); }
    catch (e) { report.cleanupErrors.push(`${name}: ${e instanceof Error ? e.message : 'unknown failure'}`); }
  };
  if (workflowSha) {
    if (workflowId) await cleanup('disable temporary workflow', () => disableWorkflow(workflowId!));
    await cleanup('remove temporary workflow', () => ghJson(['-X', 'DELETE', `repos/${SANDBOX}/contents/${WORKFLOW}`], {
      message: message('Remove temporary sandbox App proof'), author: identity, committer: identity, sha: workflowSha,
    }));
  }
  if (secretCreated) await cleanup('delete temporary control-read secret', () => gh(['secret', 'delete', SECRET, '-R', SANDBOX]));
  for (const credential of issued) if (!(revokedControl && credential.permissions.issues === 'read'))
    await cleanup('revoke installation token', () => api(credential.token, 'DELETE', '/installation/token', undefined, [204, 401]));
  if (env) await cleanup('close scenario fixtures', () => env!.closeAll());
  for (const n of sandboxIssues) await cleanup(`close sandbox fixture ${n}`, () => operator.closeIssue(n));
  if (controlIssue) await cleanup(`close control fixture ${controlIssue}`, () => controlOperator.closeIssue(controlIssue!));
  if (createdControlLabel) await cleanup('remove temporary control label', () => controlOperator.deleteLabel('warden:stop'));
  await cleanup('record scheduled runs', () => { report.scheduleRuns = ghJson([`repos/${SANDBOX}/actions/workflows/p0-writer.yml/runs?event=schedule&per_page=5`]); });
  await cleanup('disable sandbox writer schedule', () => disableWorkflow(422227724));
  report.pass = !report.error && report.cleanupErrors.length === 0 && report.actions.length === 3
    && report.scenarios.length === (actionsOnly ? 0 : 4) && report.scenarios.every((r) => r.pass);
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pass: report.pass, scope: report.scope, checks: report.checks.length, scenarios: report.scenarios.length, actions: report.actions.length, cleanupErrors: report.cleanupErrors, error: report.error }));
  if (!report.pass) process.exitCode = 1;
}
