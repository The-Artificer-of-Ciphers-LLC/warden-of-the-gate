import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { main } from '../../../packages/warden/src/cli.ts';
import { CredentialController } from '../../../packages/warden/src/credentials/controller.ts';
import { GitHubAppIssuer, validInstallation } from '../../../packages/warden/src/credentials/github-app.ts';
import { HttpStore } from '../../../packages/warden/src/github/http.ts';
import { InstanceStorage } from '../../../packages/warden/src/storage/instance.ts';
import { redact } from '../../../packages/warden/src/util.ts';

const [mode, originalArg, replacementArg] = process.argv.slice(2);
assert.ok(mode === '--validate-replacement' || mode === '--recover');
assert.ok(originalArg && replacementArg);
const original = resolve(originalArg); const replacement = resolve(replacementArg);
assert.notEqual(original, replacement);
const sandbox = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox';
const app = { appId: 5819526, installationId: 183378787, appLogin: 'warden-p0-sandbox-app[bot]' };
const request = { operation: 'submit' as const, repository: sandbox, permissions: { issues: 'write' as const, metadata: 'read' as const } };
const validation = mode === '--validate-replacement';
const reportFile = new URL(`../results/p1-root-${validation ? 'validation' : 'recovery'}-2026-11-18.json`, import.meta.url);
assert.ok(!existsSync(reportFile), 'preserve earlier evidence before rerunning');
const previousMints = readdirSync(new URL('../results/', import.meta.url))
  .filter((name) => /^p1-root-(?:validation|recovery)-2026-11-18(?:-attempt\d+)?\.json$/.test(name))
  .reduce((n, name) => n + Number(JSON.parse(readFileSync(new URL('../results/' + name, import.meta.url), 'utf8')).minted), 0);
assert.ok(Number.isSafeInteger(previousMints) && previousMints < 6, 'separately approved root-proof token budget');
if (!validation) {
  const validated = JSON.parse(readFileSync(new URL('../results/p1-root-validation-2026-11-18.json', import.meta.url), 'utf8'));
  assert.equal(validated.pass, true, 'replacement must be validated before original-key revocation');
}
const tokens = new Set<string>();
const report: { at: string; mode: string; checks: { name: string; observed: unknown }[]; issuanceStatuses: number[];
  minted: number; revocationReadStatuses: number[]; fingerprints?: Record<string, string>; cleanupErrors: string[]; error?: string; pass: boolean } = {
  at: new Date().toISOString(), mode, checks: [], issuanceStatuses: [], minted: 0, revocationReadStatuses: [], cleanupErrors: [], pass: false };
const tracked: typeof fetch = async (input, init) => {
  const issuing = String(input).endsWith('/access_tokens');
  if (issuing) {
    assert.ok(previousMints + tokens.size < 6, 'separately approved six-token batch ceiling');
    assert.ok(report.issuanceStatuses.length < 6, 'bounded recovery-proof issuance requests');
    assert.deepEqual(JSON.parse(String(init?.body)), { repositories: ['warden-p0-sandbox'], permissions: request.permissions });
  }
  const res = await fetch(input, init);
  if (issuing) {
    report.issuanceStatuses.push(res.status);
    if (res.status === 201) { const grant = await res.clone().json() as { token: string }; tokens.add(grant.token); report.minted = tokens.size; }
  }
  return res;
};
const check = (name: string, observed: unknown = true) => { report.checks.push({ name, observed }); console.log(`PASS ${name}`); };
const fingerprint = (path: string) => 'SHA256:' + createHash('sha256').update(createPublicKey(readFileSync(path)).export({ format: 'der', type: 'spki' })).digest('base64');
const root = mkdtempSync(join(tmpdir(), 'warden-root-proof-'));
const repoDir = join(root, 'repo'); const home = join(root, 'home');
mkdirSync(join(repoDir, '.github'), { recursive: true });
writeFileSync(join(repoDir, '.github/warden.yml'), JSON.stringify({ schemaVersion: 1, repository: sandbox, maintainers: ['trek-e'], mode: 'shadow',
  inbox: { inboxIssue: 86, controlIssue: 87 } }));
async function cli(args: string[], expected = 0) {
  let out = ''; let err = '';
  const code = await main([...args, '--repo-dir', repoDir, '--home', home, '--backend', 'github', '--json'],
    { out: (s) => { out += s; }, err: (s) => { err += s; } });
  assert.equal(code, expected, redact(err || out));
}
async function configure(path: string, replace = false) {
  await cli(['credentials', 'configure', '--app-id', String(app.appId), '--installation-id', String(app.installationId), '--app-login', app.appLogin,
    '--key-path', path, '--confirm', ...(replace ? ['--replace'] : [])]);
}
try {
  if (validation) {
    for (const keyPath of [original, replacement]) {
      const credential = await new GitHubAppIssuer({ ...app, keyPath }, tracked).issue(request);
      assert.deepEqual(credential.repositories, [sandbox]);
      const response = await fetch(`https://api.github.com/repos/${sandbox}/issues/89`, { headers: { authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, 200);
    }
    report.fingerprints = { original: fingerprint(original), replacement: fingerprint(replacement) };
    assert.notEqual(report.fingerprints.original, report.fingerprints.replacement);
    check('both original and replacement authenticate before any original-key revocation', report.fingerprints);
    check('replacement issues only sandbox-scoped one-hour credentials and performs an authorized read');
  } else {
    await cli(['setup', '--approve-ceiling'], 1);
    await configure(original);
    const st = InstanceStorage.open(home, sandbox, { create: false });
    const make = () => {
      const profile = st.readJson<unknown>(st.path('github.json')); assert.ok(validInstallation(profile));
      return new CredentialController({ issuer: new GitHubAppIssuer(profile, tracked), stateDir: st.credentialsDir,
        ceiling: { repositories: [sandbox], maxPermissions: request.permissions, automation: 'enabled' } });
    };
    await assert.rejects(make().token(request), /revoked/);
    assert.deepEqual(report.issuanceStatuses, [401]);
    check('provider rejects the revoked original signing key (HTTP 401), persisting revoked state');
    await configure(replacement, true);
    await assert.rejects(make().token(request), /revoked/);
    assert.equal(report.issuanceStatuses.length, 1, 'replacement configuration cannot silently clear persisted revocation');
    check('cold start and replacement reference alone cannot restore revoked authority');
    await cli(['credentials', 'ack-revocation', '--confirm', '--as', 'trek-e']);
    const recovered = make(); const token = await recovered.token(request);
    const store = new HttpStore(sandbox, recovered, request, app.appLogin);
    assert.equal((await store.getIssue(89)).number, 89);
    check('explicit operator acknowledgement plus validated replacement restores authorized issuance and read');
    const revocation = await fetch('https://api.github.com/installation/token', { method: 'DELETE', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}` } });
    assert.equal(revocation.status, 204);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try { await store.getIssue(89); report.revocationReadStatuses.push(200); }
      catch (e) {
        if (!(e instanceof Error && 'status' in e && e.status === 401)) throw e;
        report.revocationReadStatuses.push(401); break;
      }
      await sleep(2000);
    }
    assert.equal(report.revocationReadStatuses.at(-1), 401, 'token revocation must be observed within one minute; no replacement is issued while observing');
    await assert.rejects(make().token(request), /revoked/);
    assert.equal(report.issuanceStatuses.length, 2);
    check('live revocation of a cached installation token also latches across processes without automatic replacement');
    await cli(['credentials', 'ack-revocation', '--confirm', '--as', 'trek-e']);
    const acknowledged = make();
    assert.equal((await new HttpStore(sandbox, acknowledged, request, app.appLogin).getIssue(89)).number, 89);
    const audit = acknowledged.readAudit().map((e) => e.event);
    assert.deepEqual(audit, ['revoked', 'revocation-acknowledged', 'issued', 'revoked', 'revocation-acknowledged', 'issued']);
    check('explicit second acknowledgement recovers token revocation with a redacted lifecycle audit', audit);
    report.fingerprints = { original: fingerprint(original), replacement: fingerprint(replacement) };
  }
  report.pass = true;
} catch (e) { report.error = redact(String(e)); console.error(report.error); }
finally {
  for (const token of tokens) {
    try {
      const res = await fetch('https://api.github.com/installation/token', { method: 'DELETE', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}` } });
      assert.ok([204, 401].includes(res.status), `token cleanup HTTP ${res.status}`);
    } catch (e) { report.cleanupErrors.push(redact(String(e))); }
  }
  rmSync(root, { recursive: true, force: true });
  report.pass = report.pass && report.cleanupErrors.length === 0;
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ pass: report.pass, minted: report.minted, checks: report.checks.length, cleanupErrors: report.cleanupErrors }));
  process.exitCode = report.pass ? 0 : 1;
}
