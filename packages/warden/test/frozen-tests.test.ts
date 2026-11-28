import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TEST_PATHS, freezeTests, isGuardedPath, isTestPath, nonTestChanges, verifyFrozen } from '../src/verify/frozen.ts';

test('test paths: the default globs and the test-runner, lint, coverage and mutation configuration files are recognised; ordinary source is not', () => {
  for (const p of ['test/a.js', 'tests/unit/b.ts', 'src/__tests__/c.ts', 'src/x.test.ts', 'lib/y.spec.cjs', 'test/__snapshots__/a.snap', 'src/x.test.ts.snap']) assert.equal(isTestPath(p, DEFAULT_TEST_PATHS), true, p);
  for (const p of ['src/index.ts', 'lib/testing-utils.ts', 'README.md', 'src/contest.ts']) assert.equal(isTestPath(p, DEFAULT_TEST_PATHS), false, p);
  for (const p of ['jest.config.js', 'vitest.config.ts', '.mocharc.json', 'playwright.config.ts', '.nycrc', '.c8rc.json', 'stryker.conf.json', 'eslint.config.js', '.eslintrc.cjs', 'packages/a/vitest.config.mts']) assert.equal(isGuardedPath(p, DEFAULT_TEST_PATHS), true, p);
  assert.equal(isGuardedPath('src/index.ts', DEFAULT_TEST_PATHS), false);
  assert.equal(isTestPath('spec/x.rb', ['spec/']), true, 'configured globs replace the defaults'); assert.equal(isTestPath('test/a.js', ['spec/']), false);
});

test('a test session may change tests only: any other changed path is named', () => {
  const ch = [{ path: 'test/a.test.js', status: 'A' as const }, { path: 'src/a.js', status: 'M' as const }, { path: 'jest.config.js', status: 'M' as const }];
  assert.deepEqual(nonTestChanges(ch, DEFAULT_TEST_PATHS), ['src/a.js', 'jest.config.js']);   // runner configuration is not a test file: the test session may not touch it
  assert.deepEqual(nonTestChanges([{ path: 'test/a.test.js' }], DEFAULT_TEST_PATHS), []);
});

function ws() { const d = mkdtempSync(join(tmpdir(), 'warden-frozen-')); mkdirSync(join(d, 'test'), { recursive: true }); writeFileSync(join(d, 'test', 'a.test.js'), 'assert(1)'); writeFileSync(join(d, 'test', 'b.test.js'), 'assert(2)'); return d; }

test('freeze and verify: the freeze records path and digest; a changed, deleted or renamed frozen file is a violation; untouched files and new test files are not', () => {
  const d = ws(); try {
    const fz = freezeTests(d, ['test/a.test.js', 'test/b.test.js'], 'base123');
    assert.equal(fz.baseCommit, 'base123'); assert.equal(fz.files.length, 2); assert.match(fz.files[0].sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(verifyFrozen(d, fz), []);
    writeFileSync(join(d, 'test', 'new.test.js'), 'assert(3)'); assert.deepEqual(verifyFrozen(d, fz), [], 'a new test file is an unreviewed addition, not a violation');
    writeFileSync(join(d, 'test', 'a.test.js'), 'assert(true)'); unlinkSync(join(d, 'test', 'b.test.js'));
    assert.deepEqual(verifyFrozen(d, fz).map((v) => [v.path, v.kind]), [['test/a.test.js', 'modified'], ['test/b.test.js', 'deleted']]);
    writeFileSync(join(d, 'test', 'a.test.js'), 'assert(1)'); renameSync(join(d, 'test', 'new.test.js'), join(d, 'test', 'b.test.js'));
    assert.deepEqual(verifyFrozen(d, fz).map((v) => [v.path, v.kind]), [['test/b.test.js', 'modified']], 'a different file moved into a frozen path still has a different digest');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

import { buildProfile, requireContainment, runContained } from '../src/runner/seatbelt.ts';
import { realpathSync } from 'node:fs';

test('the containment profile denies writes to the frozen paths while the rest of the workspace stays writable (profile text)', () => {
  const d = ws(); const scratch = mkdtempSync(join(tmpdir(), 'warden-frozen-s-')); try {
    const p = buildProfile({ workspace: d, workspaceWritable: true, scratch, denyWrite: ['test/a.test.js'] });
    const real = realpathSync(d);
    assert.ok(p.includes(`(allow file-write* (subpath ${JSON.stringify(real)}))`)); assert.ok(p.includes(`(deny file-write* (literal ${JSON.stringify(join(real, 'test/a.test.js'))}))`));
    assert.ok(p.indexOf('(deny file-write* (literal') > p.indexOf('(allow file-write* (subpath'), 'the deny comes after the allow so it wins');
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test('real OS enforcement: inside Seatbelt a process can edit ordinary files but cannot edit, delete or rename a frozen file, by file tool or by script (skipped where containment is unavailable)', async (t) => {
  try { await requireContainment(); } catch { t.skip('containment not available on this host'); return; }
  const d = ws(); const scratch = mkdtempSync(join(tmpdir(), 'warden-frozen-s-')); try {
    const script = "const fs=require('fs');const out={};const t=(k,f)=>{try{f();out[k]='ALLOWED'}catch(e){out[k]=e.code||String(e)}};"
      + "t('edit_frozen',()=>fs.writeFileSync('test/a.test.js','cheat'));t('delete_frozen',()=>fs.unlinkSync('test/a.test.js'));t('rename_frozen',()=>fs.renameSync('test/a.test.js','test/z.js'));"
      + "t('edit_other',()=>fs.writeFileSync('test/b.test.js','fine'));t('add_new',()=>fs.writeFileSync('src.js','new'));console.log(JSON.stringify(out));";
    const r = await runContained({ workspace: d, workspaceWritable: true, scratch, denyWrite: ['test/a.test.js'] }, process.execPath, ['-e', script], { timeoutMs: 20000 });
    const o = JSON.parse(r.stdout.trim());
    for (const k of ['edit_frozen', 'delete_frozen', 'rename_frozen']) assert.ok(o[k] === 'EPERM' || o[k] === 'EACCES', `${k}=${o[k]}`);
    assert.equal(o.edit_other, 'ALLOWED'); assert.equal(o.add_new, 'ALLOWED');
    assert.equal(readFileSync(join(d, 'test', 'a.test.js'), 'utf8'), 'assert(1)', 'the frozen file is untouched on disk');
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});
import { readFileSync } from 'node:fs';
