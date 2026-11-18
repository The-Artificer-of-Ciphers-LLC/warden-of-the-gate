import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const original = "name: sandbox\non:\n  schedule:\n    - cron: '*/15 * * * *'\n";
const concurrent = 'name: owner-concurrent-edit\n';
const mockGh = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.MOCK_GH_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const method = args[args.indexOf('--method') + 1];
const path = args[3];
let result;
let denied = false;
if (path === 'user') result = { login: 'trek-e' };
else if (path.includes('/contents/')) {
  if (method === 'PUT') {
    const body = JSON.parse(fs.readFileSync(0, 'utf8'));
    state.writes.push(body);
    state.source = Buffer.from(body.content, 'base64').toString('utf8');
    state.active = true;
    state.version++;
    state.revisions['revision-' + state.version] = state.source;
    result = { commit: { sha: 'revision-' + state.version } };
  } else {
    const ref = path.split('?ref=')[1];
    result = { sha: 'blob-' + state.version, content: Buffer.from(ref === 'main' ? state.source : state.revisions[ref]).toString('base64') };
  }
} else if (path.includes('/commits/')) result = { author: { login: 'trek-e' } };
else if (path.endsWith('/enable')) { state.active = true; result = {}; }
else if (path.endsWith('/disable')) {
  denied = !state.active;
  state.active = false;
  if (!denied) state.staleReads = 1;
  result = {};
} else if (path.includes('/runs?')) {
  if (state.concurrent) state.source = state.concurrent;
  if (state.alreadyDisabled) { state.active = false; state.staleReads = 1; }
  result = { workflow_runs: [{ created_at: new Date().toISOString(), status: 'completed', conclusion: state.conclusion, head_sha: 'revision-1' }] };
} else {
  result = { state: state.staleReads > 0 || state.active ? 'active' : 'disabled_manually' };
  if (state.staleReads > 0) state.staleReads--;
}
fs.writeFileSync(file, JSON.stringify(state));
if (denied) { console.error('Unable to disable a workflow that is not active.'); process.exitCode = 1; }
console.log(JSON.stringify(result));
`;

function run(options: { conclusion?: string; concurrent?: string; alreadyDisabled?: boolean } = {}, rapid = false) {
  const root = mkdtempSync(join(tmpdir(), 'warden-schedule-test-'));
  try {
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'results')); mkdirSync(join(root, 'bin'));
    copyFileSync(new URL('./schedule-proof.ts', import.meta.url), join(root, 'src/schedule-proof.ts'));
    writeFileSync(join(root, 'results/schedule-2026-11-18.json'), JSON.stringify({ pass: false, disabled: false, finishedAt: new Date().toISOString() }));
    writeFileSync(join(root, 'bin/gh'), mockGh, { mode: 0o700 });
    const stateFile = join(root, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ source: original, active: false, staleReads: 0, version: 0, revisions: {}, writes: [],
      conclusion: 'success', ...options }));
    const result = spawnSync(process.execPath, [join(root, 'src/schedule-proof.ts'), '--live', rapid ? '--rapid' : '--off-peak'],
      { encoding: 'utf8', timeout: 20_000, env: { ...process.env, MOCK_GH_STATE: stateFile, PATH: join(root, 'bin') + ':' + process.env.PATH } });
    assert.ifError(result.error);
    return { status: result.status, stderr: result.stderr,
      report: JSON.parse(readFileSync(join(root, `results/schedule-${rapid ? 'rapid' : 'off-peak'}-2026-11-18.json`), 'utf8')),
      state: JSON.parse(readFileSync(stateFile, 'utf8')) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('off-peak observation verifies the executed revision, restores cron and confirms disabled despite stale state', () => {
  const { status, stderr, report, state } = run({ alreadyDisabled: true });
  assert.equal(status, 0, stderr);
  assert.equal(report.pass, true);
  assert.equal(report.registeredActor, 'trek-e');
  assert.equal(report.restored, true);
  assert.equal(report.disabled, true);
  assert.deepEqual(report.cleanupErrors, []);
  assert.equal(state.source, original);
  assert.equal(state.active, false);
  assert.equal(state.writes.length, 2);
  for (const body of state.writes) {
    assert.equal(body.author.email, 'trekkie@nomorestars.com');
    assert.equal(body.committer.name, 'trek-e');
  }
});

test('a failed scheduled run is preserved as failed while restoration and disable still complete', () => {
  const { status, report, state } = run({ conclusion: 'failure' });
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.equal(report.run.conclusion, 'failure');
  assert.equal(report.restored, true);
  assert.equal(report.disabled, true);
  assert.equal(state.source, original);
  assert.equal(state.active, false);
});

test('cleanup refuses to overwrite a concurrent owner edit and still disables the workflow', () => {
  const { status, report, state } = run({ concurrent });
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.match(report.cleanupErrors.join(' '), /concurrent workflow edit/);
  assert.equal(report.disabled, true);
  assert.equal(state.source, concurrent);
  assert.equal(state.writes.length, 1);
  assert.equal(state.active, false);
});

test('rapid capability mode still requires a genuine successful run and restores the original workflow', () => {
  const { status, stderr, report, state } = run({}, true);
  assert.equal(status, 0, stderr);
  assert.equal(report.pass, true);
  assert.equal(report.restored, true);
  assert.equal(report.disabled, true);
  assert.equal(state.source, original);
  assert.equal(state.active, false);
});
