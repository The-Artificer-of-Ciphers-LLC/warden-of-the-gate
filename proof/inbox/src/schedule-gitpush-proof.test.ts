import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/** Offline safety tests for the git-push comparison harness. `gh`, `git` and `ssh` are mocks on PATH: nothing here touches GitHub. */
const mockGh = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.MOCK_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
if (args[0] === 'run') {
  const event = Number(args[2]) % 10 === 1 ? 'workflow_dispatch' : 'schedule';
  console.log('[DEBUG-cron-p1] event=' + event + ' schedule=' + (event === 'schedule' ? '2/5 * * * *' : ''));
  process.exit(0);
}
const method = args[2], path = args[3], control = path.includes('warden-p0-control');
const item = state.cases[control ? 1 : 0];
let result, error;
if (path === 'user') result = { login: 'trek-e' };
else if (path === 'meta') result = { ssh_keys: ['ssh-ed25519 AAAAmockkey'] };
else if (/\\/warden-p0-(sandbox|control)$/.test(path)) result = { default_branch: 'main' };
else if (path.includes('/commits/')) { if (state.verifyFails) error = 'simulated api failure after push'; else result = { commit: { verification: { verified: true } } }; }
else if (path.includes('/contents/')) {
  if (method !== 'GET') { state.apiWrites = (state.apiWrites || 0) + 1; error = 'Contents API must never be used by the git-push harness'; }
  else if (item.source) result = { sha: 'blob', content: Buffer.from(item.source).toString('base64') };
  else error = 'Not Found (HTTP 404)';
} else if (path.endsWith('/dispatches')) { item.dispatched = true; result = {}; }
else if (path.endsWith('/disable')) { item.active = false; result = {}; }
else if (path.includes('/runs?')) {
  result = { workflow_runs: item.dispatched ? [
    { id: item.id * 10 + 1, event: 'workflow_dispatch', status: 'completed', conclusion: state.manualFailure && !control ? 'failure' : 'success', head_sha: item.commit, created_at: new Date().toISOString() },
    ...(!state.manualFailure ? [{ id: item.id * 10 + 2, event: 'schedule', status: 'completed', conclusion: 'success', head_sha: item.commit, created_at: new Date().toISOString() }] : [])
  ] : [] };
} else if (/42222772[34]$/.test(path)) result = { state: 'disabled_manually' };
else if (item.source) result = { id: item.id, state: item.active ? 'active' : 'disabled_manually' };
else error = 'Not Found (HTTP 404)';
fs.writeFileSync(file, JSON.stringify(state));
if (error) { console.error(error); process.exitCode = 1; }
console.log(JSON.stringify(result || {}));
`;

const mockGit = `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const file = process.env.MOCK_STATE; const state = JSON.parse(fs.readFileSync(file, 'utf8'));
let args = process.argv.slice(2); let dir = null;
if (args[0] === '-C') { dir = args[1]; args = args.slice(2); }
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const wf = (d) => path.join(d, '.github/workflows/p1-cron-minimal.yml');
const repoOf = (d) => fs.readFileSync(path.join(d, '.mockrepo'), 'utf8');
const itemOf = (d) => state.cases[repoOf(d).includes('control') ? 1 : 0];
state.git = state.git || [];
if (args[0] === 'clone') {
  const url = args[args.length - 2], target = args[args.length - 1];
  state.git.push('clone ' + url);
  if (!url.startsWith('ssh://git@ssh.github.com:443/') || !process.env.GIT_SSH_COMMAND.includes('-p 443') || !process.env.GIT_SSH_COMMAND.includes('StrictHostKeyChecking=yes')) { console.error('git harness must use strict SSH over 443'); process.exit(2); }
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, '.mockrepo'), url);
  const it = state.cases[url.includes('control') ? 1 : 0]; if (it.source) { fs.mkdirSync(path.dirname(wf(target)), { recursive: true }); fs.writeFileSync(wf(target), it.source); }
} else if (args[0] === 'config') { /* ok */ }
else if (args[0] === 'add') { /* ok */ }
else if (args[0] === 'rm') { fs.unlinkSync(path.join(dir, args[args.length - 1])); }
else if (args.includes('commit')) {
  const message = args[args.indexOf('-m') + 1]; state.git.push('commit ' + args.filter((a) => a.startsWith('user.')).join(',') + ' | ' + message.replace(/\\n/g, ' / '));
  state.messages = (state.messages || []).concat(message);
  state.userArgs = (state.userArgs || []).concat(args.filter((a) => a.startsWith('user.')));
} else if (args[0] === 'rev-parse') { console.log(itemOf(dir).commit); }
else if (args[0] === 'pull') { /* up to date */ }
else if (args[0] === 'push') {
  state.git.push('push ' + args.slice(1).join(' '));
  if (state.pushHangs && !state.hung) { state.hung = true; save(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); }
  const it = itemOf(dir);
  if (fs.existsSync(wf(dir))) { it.source = fs.readFileSync(wf(dir), 'utf8'); it.active = true; it.writes++; } else { delete it.source; }
} else { console.error('unexpected git ' + args.join(' ')); process.exit(2); }
save();
`;

const mockSsh = (identity: string) => `#!/usr/bin/env node
process.stderr.write('Hi ${identity}! You\\'ve successfully authenticated, but GitHub does not provide shell access.\\n'); process.exit(1);
`;

function run(options: { manualFailure?: boolean; verifyFails?: boolean; sshAs?: string; pushHangs?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'warden-gitpush-test-'));
  try {
    const proof = join(root, 'proof/inbox');
    mkdirSync(join(proof, 'src'), { recursive: true }); mkdirSync(join(proof, 'workflows')); mkdirSync(join(proof, 'results'));
    mkdirSync(join(root, 'packages/warden/src'), { recursive: true }); mkdirSync(join(root, 'bin'));
    copyFileSync(new URL('./schedule-gitpush-proof.ts', import.meta.url), join(proof, 'src/schedule-gitpush-proof.ts'));
    copyFileSync(new URL('../workflows/p1-cron-minimal.yml', import.meta.url), join(proof, 'workflows/p1-cron-minimal.yml'));
    copyFileSync(new URL('../../../packages/warden/src/util.ts', import.meta.url), join(root, 'packages/warden/src/util.ts'));
    writeFileSync(join(root, 'bin/gh'), mockGh, { mode: 0o700 }); writeFileSync(join(root, 'bin/git'), mockGit, { mode: 0o700 });
    writeFileSync(join(root, 'bin/ssh'), mockSsh(options.sshAs ?? 'trek-e'), { mode: 0o700 });
    const stateFile = join(root, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ ...options, cases: [
      { id: 101, commit: 'a'.repeat(40), active: false, writes: 0 }, { id: 102, commit: 'b'.repeat(40), active: false, writes: 0 },
    ] }));
    const result = spawnSync(process.execPath, [join(proof, 'src/schedule-gitpush-proof.ts'), '--live'],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env, GITPUSH_STEP_TIMEOUT_MS: options.pushHangs ? '1500' : '90000', MOCK_STATE: stateFile, PATH: join(root, 'bin') + ':' + process.env.PATH } });
    assert.ifError(result.error);
    return { status: result.status, stderr: result.stderr, report: JSON.parse(readFileSync(join(proof, 'results/schedule-gitpush-2026-11-18.run3.json'), 'utf8')),
      state: JSON.parse(readFileSync(stateFile, 'utf8')) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('git-push harness installs and removes by git push only (never the Contents API), with the owner identity and Copilot trailer', () => {
  const { status, stderr, report, state } = run();
  assert.equal(status, 0, stderr);
  assert.equal(report.pass, true); assert.equal(report.method, 'git-push-ssh-443'); assert.deepEqual(report.cleanupErrors, []);
  assert.equal(report.workflowBlob, '013aaace843aeeabbd069596dbabe846c38f802a');
  assert.equal(state.apiWrites ?? 0, 0, 'no Contents API write may occur');
  assert.ok(state.git.filter((g: string) => g.startsWith('clone ')).every((g: string) => g.includes('ssh://git@ssh.github.com:443/')));
  assert.equal(state.git.filter((g: string) => g.startsWith('push ')).length, 4, 'two installs and two removals');
  assert.ok(state.userArgs.every((a: string) => a === 'user.name=trek-e' || a === 'user.email=trekkie@nomorestars.com'));
  assert.ok(state.messages.every((m: string) => m.includes('Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>')));
  for (const item of report.cases) { assert.equal(item.manual.event, 'workflow_dispatch'); assert.equal(item.scheduled.event, 'schedule'); assert.equal(item.disabled, true); assert.equal(item.removed, true); assert.equal(item.installVerified, true); assert.equal(item.dir, undefined); }
  for (const item of state.cases) { assert.equal(item.source, undefined); assert.equal(item.active, false); }
});

test('wrong ssh identity refuses before any clone or push and leaves both repositories untouched', () => {
  const { status, report, state } = run({ sshAs: 'someone-else' });
  assert.equal(status, 1); assert.equal(report.pass, false); assert.match(report.error, /ssh identity is not trek-e/);
  assert.deepEqual(state.git ?? [], []); for (const item of state.cases) assert.equal(item.writes, 0);
});

test('manual baseline failure does not become schedule success and both repositories are still cleaned', () => {
  const { status, report, state } = run({ manualFailure: true });
  assert.equal(status, 1); assert.equal(report.pass, false); assert.equal(report.cases[0].manual.conclusion, 'failure');
  for (const item of state.cases) { assert.equal(item.source, undefined); assert.equal(item.active, false); }
});

test('a push applied before a later failure is discovered and removed during cleanup', () => {
  const { status, report, state } = run({ verifyFails: true });
  assert.equal(status, 1); assert.equal(report.pass, false); assert.match(report.error, /simulated api failure after push/);
  assert.equal(report.cases[0].removed, true);
  assert.equal(state.cases[0].source, undefined); assert.equal(state.cases[0].active, false); assert.equal(state.cases[1].writes, 0);
});

test('a stalled git push is reported with the step, elapsed time and stderr tail, and cleanup still leaves no workflow behind', () => {
  const { status, report, state } = run({ pushHangs: true });
  assert.equal(status, 1); assert.equal(report.pass, false);
  assert.match(report.error, /git push timed out after \d+ ms/);
  assert.ok(report.gitSteps.some((s: { step: string; timedOut: boolean }) => s.step.startsWith('push') && s.timedOut));
  assert.deepEqual(report.cleanupErrors, []);
  assert.equal(state.cases[1].writes, 0, 'the second repository is never reached after a stall');
});
