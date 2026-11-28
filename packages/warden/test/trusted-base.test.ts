import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliEnv } from './cli-env.ts';
import { loadConfigs } from '../src/commands/common.ts';
import { ORDERS_FILE, WARDEN_FILE, loadOrders, policyDigest } from '../src/config/load.ts';
import { evaluate } from '../src/config/policy.ts';
import { TRUSTED_INPUT_PATHS, revisionSource, trustedInputsTouched, trustedSource } from '../src/config/trusted.ts';

/** W-20 (issue #81), PRD §3 trusted base, confirmed by the owner on 2026-11-27: a pull request that edits ORDERS.yaml (or warden.yml) cannot change
 *  the rules used to review that same pull request, even when its head is what is checked out in the repository directory. */
const g = (dir: string, ...a: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', '-C', dir, ...a], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim();
};
const PERMISSIVE = 'schemaVersion: 1\nprograms:\n  - name: let-me-in\n    tasks: [merge, implement, review, triage]\n    decision: allow\n';
const ctxFor = (repo: string, flags: Record<string, string> = {}, env: Record<string, string> = {}) => ({ flags: { 'repo-dir': repo, ...flags }, env: env as NodeJS.ProcessEnv, cwd: repo, now: () => Date.now() });

/** A configured repository whose default branch is on a remote (origin/HEAD set, as `git clone` leaves it), with a pull request's head checked out. */
async function rig() {
  const e = await cliEnv();
  const bare = join(e.dir, 'origin.git');
  g(e.repo, 'init', '-q', '-b', 'main'); g(e.repo, 'add', '-A'); g(e.repo, 'commit', '-qm', 'default branch policy');
  const base = g(e.repo, 'rev-parse', 'HEAD');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  g(e.repo, 'remote', 'add', 'origin', bare); g(e.repo, 'push', '-q', 'origin', 'main'); g(e.repo, 'remote', 'set-head', 'origin', 'main');
  const baseOrders = readFileSync(join(e.repo, ORDERS_FILE), 'utf8');
  // The pull request: it widens the standing orders and adds a maintainer, and its head is what the operator has checked out.
  g(e.repo, 'checkout', '-q', '-b', 'contributor/widen-orders');
  writeFileSync(join(e.repo, ORDERS_FILE), PERMISSIVE);
  writeFileSync(join(e.repo, WARDEN_FILE), readFileSync(join(e.repo, WARDEN_FILE), 'utf8').replace('  - maint2', '  - maint2\n  - outsider'));
  g(e.repo, 'commit', '-qam', 'allow everything');
  return { e, base, baseOrders, cleanup: () => rmSync(e.dir, { recursive: true, force: true }) };
}

test('a pull request that edits ORDERS.yaml and warden.yml cannot change the rules that judge it, even with its head checked out', async (t) => {
  const r = await rig(); t.after(r.cleanup);
  const loaded = loadConfigs(ctxFor(r.e.repo));
  assert.ok('warden' in loaded, JSON.stringify(loaded));
  assert.equal(loaded.trusted.kind, 'revision'); assert.equal(loaded.trusted.revision, r.base, 'policy comes from the default branch commit');
  assert.deepEqual(loaded.orders, loadOrders(revisionSource(r.e.repo, r.base)).value, 'the orders in force are the base commit orders');
  assert.deepEqual(loaded.orders?.programs, [], 'the widened programs are not in force');
  assert.ok(!loaded.warden.maintainers.includes('outsider'), 'a PR cannot add itself a maintainer');
  assert.deepEqual(loaded.trusted.drift.sort(), [ORDERS_FILE, WARDEN_FILE].sort(), 'the operator is told the checked-out copies are not in force');
  // The same rules the base would apply: the PR's own edit to ORDERS.yaml always needs a maintainer.
  const d = evaluate(loaded.orders!, { task: 'merge', kind: 'bug', paths: [ORDERS_FILE], origin: 'contributor', risk: 'low' });
  assert.equal(d.decision, 'human'); assert.match(d.reasons.join(' '), /cannot authorize itself/);
  // The digest that approvals and accepted reviews bind to is the base's, so nothing bound to the PR's policy validates.
  g(r.e.repo, 'checkout', '-q', 'main');
  const onMain = loadConfigs(ctxFor(r.e.repo)); assert.ok('warden' in onMain);
  assert.equal(policyDigest(loaded.warden, loaded.orders!), policyDigest(onMain.warden, onMain.orders!));
  assert.deepEqual(onMain.trusted.drift, []);
});

test('status reports where the policy came from and which checked-out policy files are not in force', async (t) => {
  const r = await rig(); t.after(r.cleanup);
  const s = await r.e.json('status');
  assert.equal(s.code, 0, s.out);
  assert.equal(s.data.policySource.revision, r.base);
  assert.ok(s.data.policySource.drift.includes(ORDERS_FILE));
  const txt = await r.e.run('status'); assert.match(txt.out, /NOT in force/);
});

test('an uncommitted edit on the default branch is not in force either', async (t) => {
  const r = await rig(); t.after(r.cleanup);
  g(r.e.repo, 'checkout', '-q', 'main');
  writeFileSync(join(r.e.repo, ORDERS_FILE), PERMISSIVE);
  const l = loadConfigs(ctxFor(r.e.repo)); assert.ok('warden' in l);
  assert.deepEqual(l.orders?.programs, []); assert.deepEqual(l.trusted.drift, [ORDERS_FILE]);
});

test('no resolvable trusted base fails closed: the working tree is never used instead', async (t) => {
  const r = await rig(); t.after(r.cleanup);
  g(r.e.repo, 'remote', 'set-head', 'origin', '--delete');
  const l = loadConfigs(ctxFor(r.e.repo));
  assert.ok(!('warden' in l)); assert.match(l.errors.join(' '), /cannot resolve the trusted base revision.*never from the working tree/);
  const viaFlag = loadConfigs(ctxFor(r.e.repo, { 'trusted-ref': 'refs/remotes/origin/main' })); assert.ok('warden' in viaFlag); assert.equal(viaFlag.trusted.revision, r.base);
  const viaEnv = loadConfigs(ctxFor(r.e.repo, {}, { WARDEN_TRUSTED_REF: 'main' })); assert.ok('warden' in viaEnv); assert.equal(viaEnv.trusted.revision, r.base);
  const bad = loadConfigs(ctxFor(r.e.repo, { 'trusted-ref': 'no-such-branch' })); assert.ok(!('warden' in bad));
});

test('a plain directory (not a git checkout) is read as before; a trusted ref for it is refused', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  const l = loadConfigs(ctxFor(e.repo)); assert.ok('warden' in l); assert.equal(l.trusted.kind, 'directory');
  assert.equal(trustedSource(e.repo, 'main').ok, false);
  // A directory nested inside another repository is not a checkout of the governed repository.
  const outer = mkdtempSync(join(tmpdir(), 'warden-outer-')); t.after(() => rmSync(outer, { recursive: true, force: true }));
  g(outer, 'init', '-q', '-b', 'main'); const inner = join(outer, 'sub'); mkdirSync(inner);
  const s = trustedSource(inner); assert.ok(s.ok && s.value.kind === 'directory');
});

test('trusted inputs: policy, workflows, ownership and agent instruction files; ordinary code is not one', () => {
  assert.deepEqual(trustedInputsTouched(['.github/ORDERS.yaml', '.github/warden.yml', '.github/workflows/ci.yml', 'CODEOWNERS', 'docs/AGENTS.md', 'src/a.ts']),
    ['.github/ORDERS.yaml', '.github/warden.yml', '.github/workflows/ci.yml', 'CODEOWNERS', 'docs/AGENTS.md']);
  assert.ok(TRUSTED_INPUT_PATHS.includes('.github/ORDERS.yaml') && TRUSTED_INPUT_PATHS.includes('.github/warden.yml') && TRUSTED_INPUT_PATHS.includes('.github/workflows/**'));
});

test('with no trusted base, warden stop still stops (a stop never widens authority); resume and status still fail closed', async (t) => {
  const r = await rig(); t.after(r.cleanup);
  g(r.e.repo, 'remote', 'set-head', 'origin', '--delete');
  const s = loadConfigs(ctxFor(r.e.repo), { stopping: true });
  assert.ok('warden' in s, JSON.stringify(s)); assert.equal(s.trusted.kind, 'directory'); assert.match(s.trusted.note, /stop only/);
  const stopped = await r.e.run('stop', '--as', 'maint1'); assert.match(stopped.out, /local: STOPPED/, stopped.out + stopped.err);
  const resumed = await r.e.run('resume', '--as', 'maint1', '--confirm'); assert.equal(resumed.code, 1); assert.match(resumed.out + resumed.err, /cannot resolve the trusted base revision/);
  const st = await r.e.run('status'); assert.equal(st.code, 1);
});
