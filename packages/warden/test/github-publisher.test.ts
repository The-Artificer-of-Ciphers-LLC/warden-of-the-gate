import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FakeWorld } from '../src/github/fake.ts';
import { GitHubPublisher, PathRemote, askpassFor } from '../src/implement/github-publisher.ts';

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'warden-pub-')); const ws = join(d, 'ws'); const bare = join(d, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', bare]); spawnSync('git', ['init', '-q', '-b', 'main', ws]);
  const g = (...a: string[]) => spawnSync('git', ['-C', ws, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  writeFileSync(join(ws, 'a.txt'), 'x'); g('add', '.'); g('commit', '-qm', 'one'); g('checkout', '-qb', 'warden/issue-1'); writeFileSync(join(ws, 'b.txt'), 'y'); g('add', '.'); g('commit', '-qm', 'two');
  return { d, ws, bare, sha: g('rev-parse', 'HEAD').stdout.trim(), g, done: () => rmSync(d, { recursive: true, force: true }) };
}
/** Simulated GitHub: a push records the branch tip, exactly as GitHub would expose it. */
function sim(bare: string) {
  const world = new FakeWorld(); (world as unknown as { branchHeads: Record<string, string> }).branchHeads = {}; const api = world.view('factory-bot');
  const remote = new PathRemote(bare); const recording = { async push(o: { workspace: string; branch: string }) { await remote.push(o); (world as unknown as { branchHeads: Record<string, string> }).branchHeads[o.branch] = spawnSync('git', ['--git-dir', bare, 'rev-parse', `refs/heads/${o.branch}`], { encoding: 'utf8' }).stdout.trim(); } };
  return { world, api, recording };
}

test('publisher: pushes a factory branch fast-forward only, opens a DRAFT pull request bound to the verified commit', async (t) => {
  const r = repo(); t.after(r.done); const s = sim(r.bare); const pub = new GitHubPublisher(s.api, s.recording, 'main');
  const pr = await pub.open({ branch: 'warden/issue-1', sha: r.sha, title: 'Fix #1', body: 'body', workspace: r.ws, baseSha: 'base' });
  const info = await s.world.view('operator').getPull(pr.number); assert.equal(info.draft, true); assert.equal(info.head, r.sha); assert.equal(info.headRef, 'warden/issue-1'); assert.match(pr.url, /pull\//);
  writeFileSync(join(r.ws, 'c.txt'), 'z'); r.g('add', '.'); r.g('commit', '-qm', 'three'); const sha3 = r.g('rev-parse', 'HEAD').stdout.trim();
  await pub.update({ branch: 'warden/issue-1', sha: sha3, workspace: r.ws, prNumber: pr.number }); assert.equal(await s.api.branchHead('warden/issue-1'), sha3);
  r.g('reset', '-q', '--hard', r.sha); writeFileSync(join(r.ws, 'd.txt'), 'rewritten'); r.g('add', '.'); r.g('commit', '-qm', 'diverged'); const diverged = r.g('rev-parse', 'HEAD').stdout.trim();
  await assert.rejects(pub.update({ branch: 'warden/issue-1', sha: diverged, workspace: r.ws, prNumber: pr.number }), /push failed|failed/, 'a non-fast-forward (force) update is refused by the remote and never forced');
});

test('publisher: only warden/* branches; a tip that is not the verified commit is never reported as opened', async (t) => {
  const r = repo(); t.after(r.done); const s = sim(r.bare); const pub = new GitHubPublisher(s.api, s.recording, 'main');
  for (const b of ['main', 'feature/x', 'warden/../main', 'warden/a b', 'contrib/warden/x']) await assert.rejects(pub.open({ branch: b, sha: r.sha, title: 't', body: 'b', workspace: r.ws, baseSha: 'x' }), /factory branches live under warden\//, b);
  await assert.rejects(pub.open({ branch: 'warden/issue-1', sha: 'f'.repeat(40), title: 't', body: 'b', workspace: r.ws, baseSha: 'x' }), /not the verified/);
  assert.equal([...s.world.issues.values()].filter((i) => i.isPr).length, 0, 'no pull request was created');
});

test('the token reaches git only through the child environment (askpass script), is not written to disk beyond the script, and the script is removed', () => {
  const a = askpassFor('ghs_SECRETTOKEN123'); const script = a.env.GIT_ASKPASS; assert.ok(existsSync(script)); assert.ok(!readFileSync(script, 'utf8').includes('SECRETTOKEN'), 'the script reads the token from the environment');
  const out = spawnSync(script, [], { env: { WARDEN_GIT_TOKEN: a.env.WARDEN_GIT_TOKEN }, encoding: 'utf8' }); assert.equal(out.stdout, 'ghs_SECRETTOKEN123'); a.cleanup(); assert.ok(!existsSync(script));
});
