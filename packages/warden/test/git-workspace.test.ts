import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchFrom, changes, cloneBase, commitAll, copyPaths, git, pushBranch } from '../src/git/workspace.ts';

function origin() {
  const root = mkdtempSync(join(tmpdir(), 'warden-git-')); const bare = join(root, 'origin.git'); const seed = join(root, 'seed');
  git(null, ['init', '-q', '--bare', '-b', 'main', bare]); git(null, ['init', '-q', '-b', 'main', seed]);
  writeFileSync(join(seed, 'a.txt'), 'one\n'); mkdirSync(join(seed, 'test')); writeFileSync(join(seed, 'test/a.test.js'), 'assert(1)\n');
  const id = { GIT_AUTHOR_NAME: 'seed', GIT_AUTHOR_EMAIL: 's@x.io', GIT_COMMITTER_NAME: 'seed', GIT_COMMITTER_EMAIL: 's@x.io' };
  git(seed, ['add', '-A']); git(seed, ['commit', '-q', '-m', 'base'], { env: id }); git(seed, ['push', '-q', bare, 'main']);
  return { root, bare, base: git(seed, ['rev-parse', 'HEAD']).trim(), done: () => rmSync(root, { recursive: true, force: true }) };
}

test('clone checks out exactly the requested base; branch, change listing (incl. new and deleted files), commit with credit trailers and push to a local remote', (t) => {
  const o = origin(); t.after(o.done); const ws = join(o.root, 'ws');
  assert.equal(cloneBase(o.bare, ws, o.base), o.base);
  branchFrom(ws, 'warden/fix-7'); writeFileSync(join(ws, 'a.txt'), 'two\n'); writeFileSync(join(ws, 'new.txt'), 'new\n'); rmSync(join(ws, 'test/a.test.js'));
  const ch = changes(ws, o.base); assert.deepEqual(ch.map((c) => `${c.status}:${c.path}`).sort(), ['A:new.txt', 'D:test/a.test.js', 'M:a.txt']); assert.match(ch.find((c) => c.path === 'a.txt')!.patch, /\+two/);
  const sha = commitAll(ws, 'Fix the thing', { name: 'warden-factory', email: 'f@x.io' }, ['Co-authored-by: Contrib One <c1@x.io>']);
  assert.match(git(ws, ['log', '-1', '--format=%B']), /Co-authored-by: Contrib One/); assert.equal(git(ws, ['log', '-1', '--format=%an']).trim(), 'warden-factory');
  pushBranch(ws, o.bare, 'warden/fix-7'); assert.equal(git(o.bare, ['rev-parse', 'refs/heads/warden/fix-7']).trim(), sha);
  assert.throws(() => commitAll(ws, 'empty', { name: 'a', email: 'a@x.io' }), /nothing to commit/);
  assert.throws(() => cloneBase(o.bare, join(o.root, 'bad'), 'deadbeef'), /git (checkout|clone) failed/);
});

test('repository hooks never run: a hostile pre-commit and post-checkout hook in a clone are ignored', (t) => {
  const o = origin(); t.after(o.done); const ws = join(o.root, 'ws'); cloneBase(o.bare, ws, o.base);
  const marker = join(o.root, 'HOOK-RAN'); for (const h of ['pre-commit', 'post-checkout', 'post-commit']) { writeFileSync(join(ws, '.git/hooks', h), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 }); }
  branchFrom(ws, 'warden/x'); writeFileSync(join(ws, 'b.txt'), 'b\n'); commitAll(ws, 'x', { name: 'a', email: 'a@x.io' });
  assert.equal(existsSync(marker), false, 'no repository hook was executed');
});

test('fail-before staging: copying candidate test files (and deletions) onto a base checkout', (t) => {
  const o = origin(); t.after(o.done); const a = join(o.root, 'cand'); const b = join(o.root, 'base2'); cloneBase(o.bare, a, o.base); cloneBase(o.bare, b, o.base);
  writeFileSync(join(a, 'test/b.test.js'), 'assert(2)\n'); rmSync(join(a, 'test/a.test.js'));
  copyPaths(a, b, ['test/b.test.js', 'test/a.test.js']); assert.equal(readFileSync(join(b, 'test/b.test.js'), 'utf8'), 'assert(2)\n'); assert.equal(existsSync(join(b, 'test/a.test.js')), false);
});
