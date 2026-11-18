import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { GitHubAppIssuer } from '../src/credentials/github-app.ts';
import { CredentialController } from '../src/credentials/controller.ts';
import { IssuerError } from '../src/credentials/types.ts';
import type { IssuedCredential } from '../src/credentials/types.ts';
import { cliEnv } from './cli-env.ts';
import { main } from '../src/cli.ts';
import { openBackend } from '../src/commands/common.ts';
import { loadWarden } from '../src/config/load.ts';
import { InstanceStorage } from '../src/storage/instance.ts';
import { HttpStore } from '../src/github/http.ts';

const request = { operation: 'submit' as const, repository: 'acme/widgets', permissions: { issues: 'write' as const, metadata: 'read' as const } };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'warden-app-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPath = join(dir, 'signing.pem');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return { dir, keyPath, publicKey, installation: { appId: 123, installationId: 456, appLogin: 'test-app[bot]', keyPath } };
}
const grant = () => ({ token: 'test-installation-credential', expires_at: new Date(Date.now() + 3600_000).toISOString(),
  permissions: request.permissions, repositories: [{ full_name: request.repository }] });

test('App issuer signs a bounded JWT and requests exactly one repository and the requested permissions', async (t) => {
  const f = fixture(t);
  const issuer = new GitHubAppIssuer(f.installation, async (url, init) => {
    assert.equal(url, 'https://api.github.com/app/installations/456/access_tokens');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), { repositories: ['widgets'], permissions: request.permissions });
    const jwt = new Headers(init.headers).get('authorization')!.slice(7).split('.');
    assert.ok(verify('RSA-SHA256', Buffer.from(jwt.slice(0, 2).join('.')), f.publicKey, Buffer.from(jwt[2], 'base64url')));
    const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
    assert.equal(claims.iss, 123); assert.equal(claims.exp - claims.iat, 600);
    return Response.json(grant(), { status: 201 });
  });
  const c = await issuer.issue(request);
  assert.deepEqual(c.repositories, ['acme/widgets']); assert.deepEqual(c.permissions, request.permissions);
});

test('App issuer refuses loose or symlinked signing keys before contacting GitHub', async (t) => {
  const f = fixture(t); let calls = 0;
  const issuer = new GitHubAppIssuer(f.installation, async () => { calls++; throw new Error('must not fetch'); });
  chmodSync(f.keyPath, 0o644);
  await assert.rejects(issuer.issue(request), /0600/);
  chmodSync(f.keyPath, 0o600);
  const link = join(f.dir, 'link.pem'); symlinkSync(f.keyPath, link);
  await assert.rejects(new GitHubAppIssuer({ ...f.installation, keyPath: link }).issue(request), /0600/);
  assert.equal(calls, 0);
});

test('App issuer rejects and revokes broadened scope and excessive or expired lifetimes', async (t) => {
  const f = fixture(t);
  for (const invalid of [
    { repositories: [{ full_name: 'acme/other' }] },
    { permissions: { ...request.permissions, contents: 'write' } },
    { expires_at: new Date(Date.now() + 7200_000).toISOString() },
    { expires_at: new Date(Date.now() - 1000).toISOString() },
  ]) {
    let revoked = false;
    const issuer = new GitHubAppIssuer(f.installation, async (url, init) => {
      if (String(url).endsWith('/installation/token')) { assert.equal(init?.method, 'DELETE'); revoked = true; return new Response(null, { status: 204 }); }
      return Response.json({ ...grant(), ...invalid }, { status: 201 });
    });
    await assert.rejects(issuer.issue(request), (e) => e instanceof IssuerError && e.kind === 'denied');
    assert.ok(revoked);
  }
});

test('App issuer classifies revocation, provider denial, outage and malformed responses without logging response secrets', async (t) => {
  const f = fixture(t);
  for (const [status, kind] of [[401, 'revoked'], [404, 'revoked'], [403, 'denied'], [422, 'denied'], [429, 'unavailable'], [503, 'unavailable']] as const) {
    const issuer = new GitHubAppIssuer(f.installation, async () => Response.json({ token: 'DO-NOT-LOG' }, { status }));
    await assert.rejects(issuer.issue(request), (e) => e instanceof IssuerError && e.kind === kind && !e.message.includes('DO-NOT-LOG'));
  }
  await assert.rejects(new GitHubAppIssuer(f.installation, async () => new Response('{', { status: 201 })).issue(request), /invalid.*response/);
});

test('controller permits only read-control requests on separately approved control repositories', async (t) => {
  const f = fixture(t); let calls = 0;
  const ctl = new CredentialController({ stateDir: f.dir, ceiling: { repositories: ['acme/widgets'], controlRepositories: ['acme/control'], maxPermissions: request.permissions, automation: 'enabled' },
    issuer: { issue: async (req) => { calls++; return { token: 'test-control', expiresAt: Date.now() + 3600_000, repositories: [req.repository], permissions: req.permissions }; } } });
  await assert.rejects(ctl.token({ ...request, repository: 'acme/control' }), /outside/);
  await assert.rejects(ctl.token({ ...request, operation: 'read-control', repository: 'acme/control' }), /read access only/);
  await ctl.token({ ...request, operation: 'read-control', repository: 'acme/control', permissions: { issues: 'read', metadata: 'read' } });
  assert.equal(calls, 1);
});

test('a concurrent or cached request cannot borrow a different permission scope', async (t) => {
  const f = fixture(t);
  const ctl = new CredentialController({ stateDir: f.dir, ceiling: { repositories: ['acme/widgets'], maxPermissions: request.permissions, automation: 'enabled' },
    issuer: { issue: async (req) => ({ token: 'test-scoped', expiresAt: Date.now() + 3600_000, repositories: [req.repository], permissions: req.permissions }) } });
  const pending = ctl.token(request);
  await assert.rejects(ctl.token({ ...request, permissions: { administration: 'write' } }), /ceiling/);
  await pending;
  await assert.rejects(ctl.token({ ...request, permissions: { issues: 'read', metadata: 'read' } }), /scope/);
});

test('provider revocation of a cached installation token stays revoked across cold starts', async (t) => {
  const f = fixture(t); let calls = 0;
  const options = { stateDir: f.dir, ceiling: { repositories: ['acme/widgets'], maxPermissions: request.permissions, automation: 'enabled' as const },
    issuer: { issue: async () => { calls++; return { token: 'test-now-revoked', expiresAt: Date.now() + 3600_000, repositories: [request.repository], permissions: request.permissions }; } } };
  const ctl = new CredentialController(options);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Bad credentials' }, { status: 401 }));
  await assert.rejects(new HttpStore(request.repository, ctl, request, 'test-app[bot]').getIssue(1), /401/);
  await assert.rejects(ctl.token(request), /revoked/);
  await assert.rejects(new CredentialController(options).token(request), /revoked/);
  assert.equal(calls, 1, 'a revoked token must never trigger automatic replacement');
});

test('revocation observed during issuance cannot be overwritten by its later success', async (t) => {
  const f = fixture(t);
  let complete!: (c: IssuedCredential) => void;
  const ctl = new CredentialController({ stateDir: f.dir, ceiling: { repositories: [request.repository], maxPermissions: request.permissions, automation: 'enabled' },
    issuer: { issue: () => new Promise((resolve) => { complete = resolve; }) } });
  const pending = ctl.token(request);
  ctl.reportUnauthorized(request);
  complete({ token: 'test-issued-during-revocation', expiresAt: Date.now() + 3600_000, repositories: [request.repository], permissions: request.permissions });
  await assert.rejects(pending, /revoked/);
  assert.equal(ctl.status()[0].state, 'revoked');
});

test('CLI provisions installation references only with confirmation and refuses replacement without explicit consent', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  const args = ['credentials', 'configure', '--app-id', '123', '--installation-id', '456', '--app-login', 'test-app[bot]'];
  assert.equal((await e.run(...args)).code, 1);
  assert.equal((await e.json(...args, '--confirm')).data.minted, false);
  assert.equal((await e.run(...args, '--confirm')).code, 1);
  assert.equal((await e.run(...args, '--replace', '--confirm')).code, 0);
});

test('live backend is App-backed by default and never promotes it to the writer or consumes ambient runner tokens', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  const f = fixture(t);
  const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false });
  st.writeJson(st.path('github.json'), f.installation);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    requests++;
    if (String(url).includes('/access_tokens')) return Response.json(grant(), { status: 201 });
    if (String(url).endsWith('/issues/1')) return Response.json({ number: 1, title: 'Inbox', state: 'open', labels: [], assignees: [], user: { login: 'maint1' } });
    throw new Error('unexpected network request: ' + String(url));
  });
  const cfg = loadWarden(e.repo).value!;
  const c = { flags: { home: e.home, backend: 'github' }, cwd: e.dir, env: { GITHUB_TOKEN: 'must-not-use' }, now: Date.now };
  const be = openBackend(c, cfg);
  assert.equal(be.open('writer'), null);
  const store = be.open('submit')!;
  assert.equal(store.actor(), 'test-app[bot]');
  assert.equal((await store.getIssue(1)).number, 1);
  assert.equal(requests, 2);
  let output = '';
  assert.equal(await main(['stop', '--repo-dir', e.repo, '--home', e.home, '--backend', 'github'], { out: (s) => { output += s; }, env: {} }), 2);
  assert.match(output, /operator-auth gh/); assert.equal(requests, 2, 'missing operator selection cannot trigger App-authenticated remote mutation');
});

test('explicit Actions writer source requires the matching runner repository and the delegated permission ceiling', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false });
  st.writeJson(st.path('github.json'), { appId: 123, installationId: 456, appLogin: 'test-app[bot]' });
  const cfg = loadWarden(e.repo).value!;
  const c = { flags: { home: e.home, backend: 'github', 'writer-auth': 'actions' }, cwd: e.dir,
    env: { GITHUB_TOKEN: 'selected-runner-credential', GITHUB_ACTIONS: 'false', GITHUB_REPOSITORY: 'acme/widgets' }, now: Date.now };
  await assert.rejects(openBackend(c, cfg).open('writer')!.getIssue(1), /Actions environment/);
  c.env.GITHUB_ACTIONS = 'true'; c.env.GITHUB_REPOSITORY = 'acme/other';
  await assert.rejects(openBackend(c, cfg).open('writer')!.getIssue(1), /Actions environment/);
  c.env.GITHUB_REPOSITORY = 'acme/widgets';
  st.writeJson(st.path('ceiling.json'), { repositories: ['acme/widgets'], maxPermissions: { issues: 'read', metadata: 'read' } });
  await assert.rejects(openBackend(c, cfg).open('writer')!.getIssue(1), /ceiling/);
  st.writeJson(st.path('ceiling.json'), { repositories: ['acme/widgets'], maxPermissions: request.permissions });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer selected-runner-credential');
    return Response.json({ number: 1, title: 'Inbox', state: 'open', labels: [], assignees: [], user: { login: 'maint1' } });
  });
  const writer = openBackend(c, cfg).open('writer')!;
  assert.equal(writer.actor(), 'github-actions[bot]');
  assert.equal((await writer.getIssue(1)).number, 1);
});

test('CLI journal reconciliation acknowledges serialized-writer receipts without running another writer', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  await e.sim('sim', 'issue', '--title', 'Approval target');
  const requested = await e.json('approvals', 'request', '--item', '3', '--action', 'implement', '--revision', 'r1', '--evidence-digest', 'e1');
  assert.equal(requested.code, 0);
  assert.equal((await e.json('journal', 'reconcile')).data.acked, 0);
  assert.equal(await main(['writer', 'drain', '--repo-dir', e.repo, '--home', join(e.dir, 'separate-runner-home'), '--backend', `sim:${e.world}`],
    { out: () => {}, err: () => {}, env: {} }), 0);
  assert.equal((await e.json('journal', 'reconcile')).data.acked, 1);
  assert.deepEqual((await e.json('journal', 'reconcile')).data, { resubmitted: 0, adopted: 0, acked: 0 });
});
