import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const mockGh = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.MOCK_GH_STATE;
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
else if (/\\/warden-p0-(sandbox|control)$/.test(path)) result = { default_branch: 'main' };
else if (path.includes('/contents/')) {
  if (method === 'PUT') {
    const body = JSON.parse(fs.readFileSync(0, 'utf8'));
    item.source = Buffer.from(body.content, 'base64').toString('utf8');
    item.active = true; item.writes++;
    result = { content: { sha: 'blob' }, commit: { sha: item.commit } };
    if (state.lostReply) error = 'simulated lost upload reply';
  } else if (method === 'DELETE') { delete item.source; result = {}; }
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

function run(options: { manualFailure?: boolean; lostReply?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'warden-cron-minimal-test-'));
  try {
    const proof = join(root, 'proof/inbox');
    mkdirSync(join(proof, 'src'), { recursive: true }); mkdirSync(join(proof, 'workflows')); mkdirSync(join(proof, 'results'));
    mkdirSync(join(root, 'packages/warden/src'), { recursive: true }); mkdirSync(join(root, 'bin'));
    copyFileSync(new URL('./schedule-minimal-proof.ts', import.meta.url), join(proof, 'src/schedule-minimal-proof.ts'));
    copyFileSync(new URL('../workflows/p1-cron-minimal.yml', import.meta.url), join(proof, 'workflows/p1-cron-minimal.yml'));
    copyFileSync(new URL('../../../packages/warden/src/util.ts', import.meta.url), join(root, 'packages/warden/src/util.ts'));
    writeFileSync(join(root, 'bin/gh'), mockGh, { mode: 0o700 });
    const stateFile = join(root, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ ...options, cases: [
      { id: 101, commit: 'sandbox-revision', active: false, writes: 0 },
      { id: 102, commit: 'control-revision', active: false, writes: 0 },
    ] }));
    const result = spawnSync(process.execPath, [join(proof, 'src/schedule-minimal-proof.ts'), '--live'],
      { encoding: 'utf8', timeout: 20_000, env: { ...process.env, MOCK_GH_STATE: stateFile, PATH: join(root, 'bin') + ':' + process.env.PATH } });
    assert.ifError(result.error);
    return { status: result.status, stderr: result.stderr,
      report: JSON.parse(readFileSync(join(proof, 'results/schedule-minimal-2026-11-18.json'), 'utf8')),
      state: JSON.parse(readFileSync(stateFile, 'utf8')) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('minimal differential proof distinguishes manual and scheduled evidence and removes both workflows', () => {
  const { status, stderr, report, state } = run();
  assert.equal(status, 0, stderr);
  assert.equal(report.pass, true);
  assert.deepEqual(report.cleanupErrors, []);
  for (const item of report.cases) {
    assert.equal(item.manual.event, 'workflow_dispatch');
    assert.equal(item.scheduled.event, 'schedule');
    assert.equal(item.signals.length, 2);
    assert.equal(item.disabled, true);
    assert.equal(item.removed, true);
  }
  for (const item of state.cases) { assert.equal(item.source, undefined); assert.equal(item.active, false); }
});

test('manual baseline failure does not become schedule success and still cleans both repositories', () => {
  const { status, report, state } = run({ manualFailure: true });
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.equal(report.cases[0].manual.conclusion, 'failure');
  for (const item of state.cases) { assert.equal(item.source, undefined); assert.equal(item.active, false); }
});

test('an upload applied before a lost reply is discovered and removed during cleanup', () => {
  const { status, report, state } = run({ lostReply: true });
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.match(report.error, /simulated lost upload reply/);
  assert.equal(report.cases[0].removed, true);
  assert.equal(state.cases[0].source, undefined);
  assert.equal(state.cases[0].active, false);
  assert.equal(state.cases[1].writes, 0);
});
