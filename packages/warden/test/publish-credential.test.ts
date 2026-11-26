import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { cliEnv } from './cli-env.ts';
import { ceilingPath, openBackend } from '../src/commands/common.ts';
import { loadWarden } from '../src/config/load.ts';
import { InstanceStorage } from '../src/storage/instance.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'warden-pub-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); const keyPath = join(dir, 'signing.pem');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return { installation: { appId: 123, installationId: 456, appLogin: 'test-app[bot]', keyPath } };
}
const PUBLISH = { contents: 'write', pull_requests: 'write', metadata: 'read' } as const;

test('publishing is refused while the protected ceiling lacks contents and pull-request write, and nothing is requested from GitHub', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true })); const f = setup(t);
  const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false }); st.writeJson(st.path('github.json'), f.installation);
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('no network expected'); });
  const be = openBackend({ flags: { home: e.home, backend: 'github' }, cwd: e.dir, env: {}, now: Date.now }, loadWarden(e.repo).value!);
  assert.throws(() => be.publish!(), /outside the operator ceiling/); assert.equal(calls, 0);
});

test('with an owner-approved ceiling the publish credential is exactly contents+pull_requests write on this repository, issued by the App', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true })); const f = setup(t);
  const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false }); st.writeJson(st.path('github.json'), f.installation);
  st.writeJson(ceilingPath(st), { repositories: ['acme/widgets'], maxPermissions: { ...PUBLISH, issues: 'write' } });
  let body: unknown;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/access_tokens$/); body = JSON.parse(String(init!.body));
    return Response.json({ token: 'test-publish-credential', expires_at: new Date(Date.now() + 3600_000).toISOString(), permissions: PUBLISH, repositories: [{ full_name: 'acme/widgets' }] }, { status: 201 });
  });
  const be = openBackend({ flags: { home: e.home, backend: 'github' }, cwd: e.dir, env: { GITHUB_TOKEN: 'must-not-use' }, now: Date.now }, loadWarden(e.repo).value!);
  const pb = be.publish!()!; assert.equal(pb.store.actor(), 'test-app[bot]');
  assert.equal(await pb.token(), 'test-publish-credential');
  assert.deepEqual(body, { repositories: ['widgets'], permissions: PUBLISH });
});

test('--publisher github --push-remote github is refused (publisher-unavailable) on a backend that cannot issue a publish credential', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  const r = await e.json('run', '--task', 'implement', '--item', '1', '--publisher', 'github', '--push-remote', 'github');
  assert.equal(r.code, 4); assert.equal(r.data.reason, 'publisher-unavailable');
});
