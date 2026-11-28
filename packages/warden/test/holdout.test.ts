import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTally, loadHoldouts, readTally, runHoldouts, saveHoldouts } from '../src/verify/holdout.ts';
import { parseMaintainerCommand } from '../src/approvals/approvals.ts';
import { cliEnv } from './cli-env.ts';
import { InstanceStorage } from '../src/storage/instance.ts';

test('the operator store is 0700/0600, skips unsafe names, and round-trips; the tally appends', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'warden-hold-')); t.after(() => rmSync(d, { recursive: true, force: true })); const dir = join(d, 'store', '7');
  const ids = saveHoldouts(dir, [{ path: 'test/a.test.js', content: 'x' }, { path: '../escape.js', content: 'y' }, { path: '/abs.js', content: 'z' }]); assert.equal(ids.length, 1); assert.match(ids[0], /^[0-9a-f]{10}$/);
  assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(join(dir, `${ids[0]}.json`)).mode & 0o777, 0o600); assert.deepEqual(loadHoldouts(dir), [{ id: ids[0], name: 'test/a.test.js', content: 'x' }]); assert.deepEqual(loadHoldouts(join(d, 'none')), []);
  const tally = join(d, 'pilot.json'); appendTally(tally, { item: 1, at: 'a', total: 2, failed: 1 }); appendTally(tally, { item: 2, at: 'b', total: 1, failed: 0 }); assert.equal(readTally(tally).length, 2); assert.deepEqual(readTally(join(d, 'missing.json')), []);
});
test('checks run on a COPY of the candidate: pass or fail per id, the candidate and the store stay untouched, nothing configured runs nothing', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'warden-hold-')); t.after(() => rmSync(d, { recursive: true, force: true })); const cand = join(d, 'cand'); mkdirSync(cand);
  const checks = [{ id: 'aaaaaaaaaa', name: 'holdout/ok.test.js', content: "require('node:test')('ok', () => {});\n" }, { id: 'bbbbbbbbbb', name: 'holdout/bad.test.js', content: "require('node:test')('bad', () => { throw new Error('no'); });\n" }];
  const r = await runHoldouts({ candidate: cand, checks, cfg: { enabled: true, command: process.execPath, args: ['--test', '{file}'], timeoutMs: 60_000 } }); assert.deepEqual(r, [{ id: 'aaaaaaaaaa', pass: true }, { id: 'bbbbbbbbbb', pass: false }]);
  assert.ok(!existsSync(join(cand, 'holdout')), 'the candidate workspace never receives a check'); assert.deepEqual(await runHoldouts({ candidate: cand, checks, cfg: { enabled: true, command: '', args: [], timeoutMs: 1000 } }), []);
});
test('/warden holdout needs one 10-hex check id and defect or wrong-check', () => {
  assert.deepEqual(parseMaintainerCommand('/warden holdout aaaaaaaaaa defect the spec says so'), { kind: 'holdout-verdict', payload: { check: 'aaaaaaaaaa', verdict: 'defect', reason: 'the spec says so' } }); assert.deepEqual(parseMaintainerCommand('/warden holdout aaaaaaaaaa wrong-check'), { kind: 'holdout-verdict', payload: { check: 'aaaaaaaaaa', verdict: 'wrong-check' } });
  for (const bad of ['/warden holdout aaaa defect', '/warden holdout aaaaaaaaaa maybe', '/warden holdout all defect']) assert.equal(parseMaintainerCommand(bad), null, bad);
});
test('metrics shows the pilot evidence against the owner\'s bar: runs from the tally, nothing promoted', async () => {
  const e = await cliEnv(); await e.json('status'); const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false }); for (let k = 0; k < 3; k++) appendTally(st.path('holdouts', 'pilot.json'), { item: k + 1, at: 'x', total: 2, failed: 1 });
  const m = await e.json('metrics'); assert.equal(m.code, 0, m.out); assert.equal(m.data.holdoutPilot.runs, 3); assert.equal(m.data.holdoutPilot.failedChecksRun, 3); assert.equal(m.data.holdoutPilot.barMet, false); assert.deepEqual(m.data.holdoutPilot.bar, { minCatches: 3, minRuns: 60 }); assert.match((await e.run('metrics')).out, /hidden-checks pilot: 3 run\(s\)[^\n]*not met/);
});
void writeFileSync; void readFileSync;
