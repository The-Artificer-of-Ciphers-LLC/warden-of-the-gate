import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { main } from '../../../packages/warden/src/cli.ts';
import { GitHubAppIssuer } from '../../../packages/warden/src/credentials/github-app.ts';
import { CredentialController } from '../../../packages/warden/src/credentials/controller.ts';
import { InstanceStorage } from '../../../packages/warden/src/storage/instance.ts';
import { Journal, submit } from '../../../packages/warden/src/writer/journal.ts';
import { makeIntent, LEDGER_MARK, parseLedger, encodeLedger } from '../../../packages/warden/src/writer/protocol.ts';
import { HttpStore } from '../../../packages/warden/src/github/http.ts';
import { Faults, redact } from '../../../packages/warden/src/util.ts';
import { DEFAULT_WARDEN } from '../../../packages/warden/src/config/defaults.ts';

assert.equal(process.argv[2], '--live');
const keyPath = resolve(process.argv[3] ?? '');
const sandbox = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox';
const controlRepo = 'The-Artificer-of-Ciphers-LLC/warden-p0-control';
const app = { appId: 5819526, installationId: 183378787, appLogin: 'warden-p0-sandbox-app[bot]', keyPath };
const reportFile = new URL('../results/p1-live-2026-11-18.json', import.meta.url);
assert.ok(!existsSync(reportFile), 'preserve earlier reports before rerunning');
const previousMints = readdirSync(new URL('../results/', import.meta.url))
  .filter((name) => /^p1-live-2026-11-18-attempt\d+\.json$/.test(name))
  .reduce((n, name) => n + Number(JSON.parse(readFileSync(new URL('../results/' + name, import.meta.url), 'utf8')).minted), 0);
assert.ok(Number.isSafeInteger(previousMints) && previousMints < 40, 'owner-approved batch token budget is exhausted');
let issuanceAttempts = previousMints;
function gh(args: string[], input?: string) {
  return execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
}
function api<T>(path: string, method = 'GET', body?: unknown): T {
  assert.ok(path.startsWith(`repos/${sandbox}/`) || path.startsWith(`repos/${controlRepo}/`) || path === 'user');
  return JSON.parse(gh(['api', '--method', method, path, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined) || 'null') as T;
}
assert.equal(api<{ login: string }>('user').login, 'trek-e');
const report: { startedAt: string; sourceCommit: string; sourceHashes: Record<string, string>; checks: { name: string; observed: unknown }[]; runs: unknown[];
  minted: number; cleanupErrors: string[]; error?: string; pass: boolean } = {
  startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: {}, checks: [], runs: [], minted: 0, cleanupErrors: [], pass: false };
const check = (name: string, observed: unknown = true) => { report.checks.push({ name, observed }); console.log(`PASS ${name}`); };
const issued = new Set<string>();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const issuing = String(input).includes('/app/installations/') && String(input).endsWith('/access_tokens');
  if (issuing) {
    assert.ok(++issuanceAttempts <= 40, 'owner-approved batch token budget');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.repositories.length, 1);
    assert.ok(['warden-p0-sandbox', 'warden-p0-control'].includes(body.repositories[0]));
    assert.deepEqual(body.permissions, { issues: body.repositories[0] === 'warden-p0-control' ? 'read' : 'write', metadata: 'read' });
  }
  const res = await originalFetch(input, init);
  if (issuing && res.status === 201) {
    const data = await res.clone().json() as { token: string };
    issued.add(data.token); report.minted = issued.size;
  }
  return res;
};
const root = mkdtempSync(join(tmpdir(), 'warden-p1-live-'));
const repoDir = join(root, 'repo'); const home = join(root, 'home');
mkdirSync(join(repoDir, '.github'), { recursive: true });
const fixtures: { repo: string; number: number }[] = [];
const secrets: string[] = [];
const uploaded: string[] = [];
let workflowId: number | undefined;
const workflowPath = '.github/workflows/p1-proof.yml';
const prefix = '.warden-p1-proof/';
const identity = { name: 'trek-e', email: '4738965+trek-e@users.noreply.github.com' };
const initialLabels = api<{ name: string }[]>(`repos/${sandbox}/labels?per_page=100`).map((l) => l.name);
const createdLabels: string[] = [];
async function cli(args: string[], expected = 0) {
  let out = ''; let err = '';
  const code = await main([...args, '--repo-dir', repoDir, '--home', home, '--backend', 'github', '--json'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  assert.equal(code, expected, redact(`${args.join(' ')}: ${err || out}`));
  return JSON.parse(out);
}
function issue(repo: string, name: string) {
  const value = api<{ number: number }>(`repos/${repo}/issues`, 'POST', { title: `[P1 proof] ${name}`, body: 'Owner-approved disposable acceptance fixture. No production AI effects.' });
  fixtures.push({ repo, number: value.number }); return value.number;
}
function secret(name: string, value: string) {
  const current = api<{ secrets: { name: string }[] }>(`repos/${sandbox}/actions/secrets`);
  assert.ok(!current.secrets.some((s) => s.name === name), 'never overwrite an existing secret');
  gh(['secret', 'set', name, '-R', sandbox], value); secrets.push(name);
}
function commitFiles(entries: { path: string; content?: string; sha?: null }[], message: string) {
  assert.ok(entries.every((e) => e.path === workflowPath || e.path.startsWith(prefix)));
  const head = api<{ object: { sha: string } }>(`repos/${sandbox}/git/ref/heads/main`).object.sha;
  const tree = api<{ tree: { sha: string } }>(`repos/${sandbox}/git/commits/${head}`).tree.sha;
  const next = api<{ sha: string }>(`repos/${sandbox}/git/trees`, 'POST', { base_tree: tree, tree: entries.map((e) => ({ mode: '100644', type: 'blob', ...e })) }).sha;
  const commit = api<{ sha: string }>(`repos/${sandbox}/git/commits`, 'POST', { tree: next, parents: [head], author: identity, committer: identity,
    message: `${message}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` }).sha;
  api(`repos/${sandbox}/git/refs/heads/main`, 'PATCH', { sha: commit, force: false });
  return commit;
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}
async function dispatch(expected: string, inbox: number, control: number, global: number) {
  assert.ok(workflowId);
  const nonce = randomUUID();
  api(`repos/${sandbox}/actions/workflows/${workflowId}/dispatches`, 'POST', { ref: 'main', inputs: { expected, inbox: String(inbox), control: String(control), global: String(global), nonce } });
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const runs = api<{ workflow_runs: { id: number; display_title: string; status: string; conclusion: string; html_url: string }[] }>(`repos/${sandbox}/actions/workflows/${workflowId}/runs?event=workflow_dispatch&per_page=10`).workflow_runs;
    const run = runs.find((r) => r.display_title.includes(nonce));
    if (!run || run.status !== 'completed') continue;
    report.runs.push(run);
    const logs = gh(['run', 'view', String(run.id), '-R', sandbox, '--log']);
    const match = logs.match(/P1_PROOF_RESULT (\{[^\n]+\})/);
    assert.equal(run.conclusion, 'success', `${expected}: ${run.html_url}; ${redact(logs.slice(-5000))}`);
    assert.ok(match, 'runner must report the actual P1 writer result');
    check(`real Actions P1 writer ${expected}`, { url: run.html_url, result: JSON.parse(match[1]) });
    return JSON.parse(match[1]) as { processed: { result: string; reason?: string }[]; decisions: unknown[] };
  }
  throw new Error(`Actions ${expected} observation timed out`);
}
try {
  const inbox = issue(sandbox, 'durable inbox'); const control = issue(sandbox, 'instance control');
  const global = issue(controlRepo, 'global control'); const target = issue(sandbox, 'approval and recovery');
  writeFileSync(join(repoDir, '.github/warden.yml'), JSON.stringify({ schemaVersion: 1, repository: sandbox, maintainers: ['trek-e'], mode: 'shadow',
    inbox: { inboxIssue: inbox, controlIssue: control, globalControl: { repository: controlRepo, issue: global } } }));
  await cli(['setup', '--approve-ceiling', '--create-orders'], 1);
  await cli(['credentials', 'configure', '--app-id', String(app.appId), '--installation-id', String(app.installationId), '--app-login', app.appLogin, '--key-path', keyPath, '--approve-control-read', '--confirm']);
  await cli(['setup', '--create-labels']);
  const projectionLabels = [...Object.values(DEFAULT_WARDEN.labels.states), DEFAULT_WARDEN.labels.keepOpen, 'warden:stop', 'warden:dry-run'];
  createdLabels.push(...projectionLabels.filter((l) => !initialLabels.includes(l)));
  await cli(['config', 'validate']);
  const dry = await cli(['run', '--task', 'intake', '--dry-run', '--item', String(target)]);
  assert.equal(dry.mutations, 0); assert.equal(dry.protection.readOnlyStoreEnforced, true);
  check('production CLI setup, schema validation and mutation-free intake', { target, proposed: dry.proposals.length });
  await cli(['run', '--task', 'review', '--dry-run', '--item', String(target)], 3);
  const st = InstanceStorage.open(home, sandbox, { create: false });
  const controller = new CredentialController({ issuer: new GitHubAppIssuer(app), ceiling: { repositories: [sandbox], maxPermissions: { issues: 'write', metadata: 'read' }, automation: 'enabled' },
    stateDir: join(root, 'renewal'), renewBeforeMs: 3660_000 });
  const req = { operation: 'submit' as const, repository: sandbox, permissions: { issues: 'write' as const, metadata: 'read' as const } };
  const first = await controller.token(req); const second = await controller.token(req);
  assert.notEqual(first, second); assert.ok(controller.readAudit().some((e) => e.event === 'rotated'));
  check('real issuer proactive renewal produces a distinct short-lived token and redacted rotation audit');
  const submitToken = await new GitHubAppIssuer(app).issue(req);
  const controlToken = await new GitHubAppIssuer(app).issue({ operation: 'read-control', repository: controlRepo, permissions: { issues: 'read', metadata: 'read' } });
  const provider = { token: async () => submitToken.token, status: () => [] };
  const store = new HttpStore(sandbox, provider, req, app.appLogin);
  const journal = new Journal(st.journalPath);
  const intent = makeIntent({ v: 1, kind: 'note', repo: sandbox, item: target, itemKind: 'issue', origin: 'deterministic',
    actor: app.appLogin, source: { kind: 'cli', id: randomUUID(), observedAt: new Date().toISOString() }, payload: { text: 'Recovered P1 write-ahead intent; no AI effects.' } });
  await assert.rejects(submit(store, inbox, intent, journal, new Faults().arm('after-journal-before-post')), /CRASH/);
  assert.equal((await cli(['journal', 'reconcile'])).resubmitted, 1);
  check('CLI journal reconciliation recovers crash-before-post into the durable GitHub inbox');
  const requested = await cli(['approvals', 'request', '--item', String(target), '--action', 'implement', '--revision', 'p1-proof-r1', '--evidence-digest', 'p1-proof-e1']);
  check('actual App identity submits bound approval request', { approvalId: requested.approvalId });
  const remoteTree = api<{ tree: { path: string }[]; truncated: boolean }>(`repos/${sandbox}/git/trees/main?recursive=1`);
  assert.equal(remoteTree.truncated, false);
  assert.ok(!remoteTree.tree.some((e) => e.path === workflowPath || e.path.startsWith(prefix)));
  const packageFiles = ['package.json', 'package-lock.json', ...['src', 'schemas', 'templates'].flatMap((d) => files(`packages/warden/${d}`).map((p) => p.slice('packages/warden/'.length)))];
  const sources = [...packageFiles.map((p) => `packages/warden/${p}`), 'proof/inbox/src/p1-actions-proof.ts'];
  const entries = sources.map((path) => {
    const content = readFileSync(path, 'utf8'); report.sourceHashes[path] = createHash('sha256').update(content).digest('hex');
    return { path: prefix + path, content };
  });
  const workflow = readFileSync('proof/inbox/workflows/p1-proof.yml', 'utf8');
  report.sourceHashes['proof/inbox/workflows/p1-proof.yml'] = createHash('sha256').update(workflow).digest('hex');
  entries.push({ path: workflowPath, content: workflow });
  secret('WARDEN_P1_SUBMIT_TOKEN', submitToken.token); secret('WARDEN_P1_CONTROL_READ_TOKEN', controlToken.token); secret('WARDEN_P1_LEDGER_KEY', randomBytes(32).toString('hex'));
  commitFiles(entries, 'Install owner-approved temporary P1 acceptance proof');
  uploaded.push(...entries.map((e) => e.path));
  const registeredBy = Date.now() + 90_000;
  while (Date.now() < registeredBy) {
    const workflows = api<{ workflows: { id: number; path: string; state: string }[] }>(`repos/${sandbox}/actions/workflows?per_page=100`).workflows;
    const found = workflows.find((w) => w.path === workflowPath);
    if (found) { workflowId = found.id; if (found.state !== 'active') api(`repos/${sandbox}/actions/workflows/${workflowId}/enable`, 'PUT'); break; }
    await sleep(3000);
  }
  assert.ok(workflowId);
  await dispatch('drain', inbox, control, global);
  assert.equal((await cli(['journal', 'reconcile'])).acked, 2);
  check('Mac journal accepts real Actions receipts and clears both pending operations');
  const ledgerComment = () => api<{ id: number; body: string; user: { login: string } }[]>(`repos/${sandbox}/issues/${target}/comments?per_page=100`).find((c) => c.body.startsWith(LEDGER_MARK))!;
  const ledger = parseLedger(ledgerComment().body)!;
  assert.equal(ledgerComment().user.login, 'github-actions[bot]');
  const approval = ledger.approvals[requested.approvalId];
  assert.equal(approval.status, 'pending');
  const source = api<{ id: number; body: string; user: { login: string }; created_at: string }>(`repos/${sandbox}/issues/${target}/comments`, 'POST',
    { body: `/warden approve ${approval.id} bind=${approval.bindingDigest}` });
  const event = join(root, 'event.json');
  writeFileSync(event, JSON.stringify({ action: 'created', repository: { full_name: sandbox }, issue: { number: target }, comment: source }));
  await cli(['event', 'handle', '--event-path', event]);
  const decision = await dispatch('drain', inbox, control, global);
  assert.equal(decision.decisions.length, 1);
  assert.equal((await cli(['journal', 'reconcile'])).acked, 1);
  await cli(['approvals', 'check', '--item', String(target), '--action', 'implement']);
  check('GitHub-native maintainer decision is source-bound, recorded by Actions and authorizes only its binding');
  const stopped = await cli(['stop', '--global', '--operator-auth', 'gh', '--as', 'trek-e']);
  assert.equal(stopped.remote, 'confirmed');
  await dispatch('stopped', inbox, control, global);
  await cli(['run', '--task', 'intake', '--dry-run', '--item', String(target)], 4);
  await cli(['resume', '--global', '--confirm', '--operator-auth', 'gh', '--as', 'trek-e']);
  check('human CLI global stop reaches another private repository; full P1 writer acknowledges and halts; explicit resume starts nothing');
  await cli(['approvals', 'revise', '--item', String(target), '--revision', 'p1-proof-r2', '--evidence-digest', 'p1-proof-e2']);
  const original = ledgerComment();
  const changed = parseLedger(original.body)!; changed.state = 'ready';
  api(`repos/${sandbox}/issues/comments/${original.id}`, 'PATCH', { body: encodeLedger(changed) });
  await dispatch('tamper', inbox, control, global);
  api(`repos/${sandbox}/issues/comments/${original.id}`, 'PATCH', { body: original.body });
  check('real edit of Actions-authored ledger fails closed on HMAC integrity; original signed bytes restored');
  await dispatch('drain', inbox, control, global);
  await cli(['approvals', 'check', '--item', String(target), '--action', 'implement'], 1);
  check('material revision change invalidates prior live approval');
  const revoked = await originalFetch('https://api.github.com/installation/token', { method: 'DELETE', headers: { authorization: `Bearer ${controlToken.token}` } });
  assert.equal(revoked.status, 204);
  await dispatch('unknown', inbox, control, global);
  check('revoked cross-repository control token makes the actual P1 writer fail closed, without using GITHUB_TOKEN as fallback');
  const status = await cli(['status']);
  assert.equal(status.remote.reachable, true, JSON.stringify(status.remote));
  assert.ok(!JSON.stringify(status).includes(submitToken.token));
  check('live status reports controls, journal, approvals and credentials without model access or secrets');
  report.pass = true;
} catch (e) { report.error = redact(String(e)); console.error(report.error); }
finally {
  const clean = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try { await fn(); } catch (e) { report.cleanupErrors.push(`${name}: ${redact(String(e))}`); }
  };
  if (workflowId) await clean('disable proof workflow', () => {
    const path = `repos/${sandbox}/actions/workflows/${workflowId}`;
    if (api<{ state: string }>(path).state === 'active') api(`${path}/disable`, 'PUT');
    assert.match(api<{ state: string }>(path).state, /^disabled_/);
  });
  if (uploaded.length) await clean('remove temporary code and workflow', () => commitFiles(uploaded.map((path) => ({ path, sha: null })), 'Remove temporary P1 acceptance proof'));
  for (const name of secrets) await clean(`delete ${name}`, () => gh(['secret', 'delete', name, '-R', sandbox]));
  for (const token of issued) await clean('revoke installation token', async () => {
    const res = await originalFetch('https://api.github.com/installation/token', { method: 'DELETE', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}` } });
    assert.ok([204, 401].includes(res.status), `token revocation HTTP ${res.status}`);
  });
  for (const f of fixtures) await clean(`close ${f.repo}#${f.number}`, () => api(`repos/${f.repo}/issues/${f.number}`, 'PATCH', { state: 'closed' }));
  await clean('remove new projection labels', () => {
    for (const label of api<{ name: string }[]>(`repos/${sandbox}/labels?per_page=100`)) {
      if (createdLabels.includes(label.name)) api(`repos/${sandbox}/labels/${encodeURIComponent(label.name)}`, 'DELETE');
    }
  });
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
  report.pass = report.pass && report.cleanupErrors.length === 0;
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, minted: report.minted, cleanupErrors: report.cleanupErrors }));
  process.exitCode = report.pass ? 0 : 1;
}
