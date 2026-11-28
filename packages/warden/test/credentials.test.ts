import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialController, readPersistedCredentialStatus } from '../src/credentials/controller.ts';
import { ScriptedIssuer } from '../src/credentials/fake-issuer.ts';
import { CredentialUnavailable } from '../src/credentials/types.ts';
import type { AuthorityCeiling, CredentialRequest } from '../src/credentials/types.ts';

const REQ: CredentialRequest = { operation: 'write', repository: 'acme/widgets', permissions: { issues: 'write' } };
const CEIL: AuthorityCeiling = { repositories: ['acme/widgets'], maxPermissions: { issues: 'write' }, automation: 'enabled' };
function mk(script = [] as ConstructorParameters<typeof ScriptedIssuer>[0], ceiling = CEIL, dir = mkdtempSync(join(tmpdir(), 'cred-'))) {
  const t = { now: 1_000_000 }; const issuer = new ScriptedIssuer(script, () => t.now);
  const make = () => new CredentialController({ issuer, ceiling, stateDir: dir, now: () => t.now, renewBeforeMs: 60_000, backoff: { baseMs: 1000, maxMs: 8000, maxConsecutive: 3 } });
  return { t, issuer, c: make(), make, dir };
}
const state = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof CredentialUnavailable ? e.state : 'other:' + e));

test('corrupt credential state cannot clear revocation or disappear from status', async (t) => {
  const { c, issuer, make, dir } = mk([{ fail: 'revoked' }]);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(await state(c.token(REQ)), 'revoked');
  for (const contents of ['{', 'null', '[]', '{"write@acme/widgets":{"state":"revoked"}}']) {
    writeFileSync(join(dir, 'credentials-state.json'), contents);
    await assert.rejects(() => make().token(REQ), /STORAGE FAILURE/, contents);
    assert.equal(issuer.calls, 1, 'corruption must not reissue credentials');
    assert.throws(() => readPersistedCredentialStatus(dir), /STORAGE FAILURE/, contents);
  }
  rmSync(join(dir, 'credentials-state.json')); mkdirSync(join(dir, 'credentials-state.json'));
  await assert.rejects(() => make().token(REQ), /STORAGE FAILURE/);
  assert.throws(() => readPersistedCredentialStatus(dir), /STORAGE FAILURE/);
  assert.equal(issuer.calls, 1, 'an unreadable state file must not reissue credentials');
});

test('ceiling is enforced outside the model; issuer never called', async () => {
  const { c, issuer } = mk();
  assert.equal(await state(c.token({ ...REQ, repository: 'acme/other' })), 'denied');
  assert.equal(await state(c.token({ ...REQ, permissions: { contents: 'write' } })), 'denied');
  assert.equal(await state(c.token({ ...REQ, permissions: { issues: 'write', administration: 'read' } })), 'denied');
  assert.equal(issuer.calls, 0);
});
test('explicit opt-out issues nothing', async () => {
  const { c, issuer } = mk([], { ...CEIL, automation: 'opt-out' });
  assert.equal(await state(c.token(REQ)), 'opted-out'); assert.equal(issuer.calls, 0); assert.equal(c.status()[0]?.state ?? 'opted-out', 'opted-out');
});
test('issue, cache, proactive renewal, rotation audit; token never persisted or logged', async () => {
  const { c, t, issuer, dir } = mk();
  const a = await c.token(REQ); assert.equal(await c.token(REQ), a); assert.equal(issuer.calls, 1);
  t.now += 3600_000 - 30_000; const b = await c.token(REQ); assert.notEqual(a, b); assert.equal(issuer.calls, 2);
  const events = c.readAudit().map((e) => e.event); assert.deepEqual(events, ['issued', 'rotated']);
  for (const f of readdirSync(dir)) { const txt = readFileSync(join(dir, f), 'utf8'); assert.ok(!txt.includes(a) && !txt.includes(b), f); assert.equal(statSync(join(dir, f)).mode & 0o077, 0, f + ' must be 0600'); }
  assert.ok(!JSON.stringify(c.status()).includes('ghs_'));
});
test('issuer outage: bounded persisted backoff survives cold start; cached token served until expiry; recovery audited', async () => {
  const { c, t, issuer, make } = mk([{ ok: 120_000 }, { fail: 'unavailable', message: 'boom ghp_abcdefghijklmnopqrstuvwxyz0123' }, { fail: 'unavailable' }]);
  const a = await c.token(REQ);
  t.now += 100_000;                                    // inside renewal window, issuer fails: keep serving cached
  assert.equal(await c.token(REQ), a); assert.equal(issuer.calls, 2);
  assert.equal(await c.token(REQ), a); assert.equal(issuer.calls, 2, 'in backoff: issuer not called');
  const c2 = make();                                   // cold start: backoff state persisted
  assert.equal(await c2.token(REQ).catch((e) => e.state), 'backoff'); assert.equal(issuer.calls, 2);
  t.now += 30_000;                                     // cached token expired, backoff elapsed => retry fails again => unavailable
  assert.equal(await state(c2.token(REQ)), 'backoff'); assert.equal(issuer.calls, 3);
  assert.equal(c2.status()[0].consecutiveFailures, 2);
  t.now += 20_000; await c2.token(REQ);                // issuer recovers
  const ev = c2.readAudit().map((e) => e.event); assert.ok(ev.includes('recovered')); assert.equal(c2.status()[0].consecutiveFailures, 0);
  assert.ok(!JSON.stringify(c2.readAudit()).includes('ghp_abcdef'), 'secrets redacted from audit');
});
test('suspended flag after max consecutive failures; bounded delay', async () => {
  const { c, t } = mk([{ fail: 'unavailable' }, { fail: 'unavailable' }, { fail: 'unavailable' }, { fail: 'unavailable' }]);
  for (let i = 0; i < 4; i++) { await state(c.token(REQ)); t.now += 20_000; }
  const s = c.status()[0]; assert.equal(s.suspended, true); assert.ok(s.nextAttemptAt! - (t.now - 20_000) <= 8000);
});
test('revocation is sticky across processes until explicit operator acknowledgement; never auto-recovers', async () => {
  const { c, issuer, make, t } = mk([{ ok: 1000_000 }, { fail: 'revoked' }]);
  await c.token(REQ); t.now += 990_000;
  assert.equal(await state(c.token(REQ)), 'revoked'); const calls = issuer.calls;
  t.now += 10_000_000; const c2 = make();
  assert.equal(await state(c2.token(REQ)), 'revoked'); assert.equal(issuer.calls, calls);
  c2.operatorAcknowledgeRevocation('maint1'); assert.equal(await state(c2.token(REQ)), 'ok');
  assert.ok(c2.readAudit().some((e) => e.event === 'revocation-acknowledged'));
});
test('provider denial is final for that operation: no retry loop, no broader fallback', async () => {
  const { c, issuer } = mk([{ fail: 'denied', message: 'permission not granted' }]);
  assert.equal(await state(c.token(REQ)), 'denied'); assert.equal(await state(c.token(REQ)), 'denied'); assert.equal(issuer.calls, 1);
});
test('single-flight: concurrent requests make one issuer call', async () => {
  const { c, issuer } = mk(); await Promise.all([c.token(REQ), c.token(REQ), c.token(REQ)]); assert.equal(issuer.calls, 1);
});
test('no PAT fallback path exists in credential sources', () => {
  const dir = new URL('../src/credentials/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const txt = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.includes('NEVER') && !/^\s*\/\*\*/.test(l)).join('\n');
    assert.ok(!/process\.env\.GITHUB_TOKEN|gh auth token|child_process|execFile/.test(txt), f);
  }
});

/** W-20 (issue #81), PRD §3 Actions hardening, confirmed by the owner on 2026-11-27: the App never gets the `workflows` permission. */
test('the workflows permission is never requested, even when the operator ceiling would allow it; the issuer is never called', async () => {
  const { c, issuer } = mk([], { ...CEIL, maxPermissions: { issues: 'write', workflows: 'write', contents: 'write' } });
  for (const level of ['write', 'read'] as const) {
    await assert.rejects(() => c.token({ ...REQ, permissions: { contents: 'write', workflows: level } }), (e: unknown) => e instanceof CredentialUnavailable && e.state === 'denied' && /workflows is never requested/.test(e.message));
  }
  assert.equal(issuer.calls, 0);
  assert.equal(c.readAudit().filter((a) => a.event === 'ceiling-denied').length, 2, 'each refusal is audited');
});
