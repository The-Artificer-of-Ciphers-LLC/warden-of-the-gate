import { sign } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { IssuerError } from './types.ts';
import type { CredentialRequest, IssuedCredential, Issuer, Permissions } from './types.ts';

export interface AppInstallation { appId: number; installationId: number; appLogin: string; keyPath?: string }
type Fetch = typeof globalThis.fetch;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validInstallation(v: unknown): v is AppInstallation {
  return object(v) && Number.isSafeInteger(v.appId) && Number(v.appId) > 0
    && Number.isSafeInteger(v.installationId) && Number(v.installationId) > 0
    && typeof v.appLogin === 'string' && /^[a-z0-9-]+\[bot\]$/i.test(v.appLogin)
    && (v.keyPath === undefined || (typeof v.keyPath === 'string' && isAbsolute(v.keyPath)));
}

function signingKey(path: string): Buffer {
  let fd: number | undefined;
  try {
    if (!isAbsolute(path) || (statSync(dirname(path)).mode & 0o077)) throw new Error();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o777) !== 0o600 || (process.getuid && st.uid !== process.getuid())) throw new Error();
    return readFileSync(fd);
  } catch { throw new IssuerError('unavailable', 'App signing key must be an owner-held regular 0600 file in a protected directory'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Uses only the explicitly provisioned signing key. Neither responses nor signing failures disclose credentials. */
export class GitHubAppIssuer implements Issuer {
  private installation: AppInstallation; private fetcher: Fetch; private now: () => number;
  constructor(installation: AppInstallation, fetcher: Fetch = fetch, now: () => number = Date.now) {
    this.installation = installation; this.fetcher = fetcher; this.now = now;
    if (!validInstallation(installation)) throw new IssuerError('denied', 'invalid App installation configuration');
  }
  async issue(req: CredentialRequest): Promise<IssuedCredential> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(req.repository) || !Object.keys(req.permissions).length
      || Object.values(req.permissions).some((p) => p !== 'read' && p !== 'write')) throw new IssuerError('denied', 'invalid installation-token scope');
    if (!this.installation.keyPath) throw new IssuerError('unavailable', 'no App signing key is provisioned on this host');
    const now = this.now(); const sec = Math.floor(now / 1000);
    const data = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.'
      + Buffer.from(JSON.stringify({ iat: sec - 60, exp: sec + 540, iss: this.installation.appId })).toString('base64url');
    let jwt: string;
    try { jwt = data + '.' + sign('RSA-SHA256', Buffer.from(data), signingKey(this.installation.keyPath)).toString('base64url'); }
    catch (e) { if (e instanceof IssuerError) throw e; throw new IssuerError('unavailable', 'App signing failed; check the provisioned signing key'); }
    let response: Response;
    try {
      response = await this.fetcher(`https://api.github.com/app/installations/${this.installation.installationId}/access_tokens`, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
        body: JSON.stringify({ repositories: [req.repository.split('/')[1]], permissions: req.permissions }),
      });
    } catch { throw new IssuerError('unavailable', 'GitHub App issuer could not be reached'); }
    if (response.status !== 201) {
      const limited = response.status === 429 || response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0';
      const kind = limited || response.status >= 500 ? 'unavailable' : [401, 404].includes(response.status) ? 'revoked' : 'denied';
      throw new IssuerError(kind, `GitHub App issuance refused (HTTP ${response.status})`);
    }
    let value: unknown;
    try { value = await response.json(); } catch { throw new IssuerError('unavailable', 'invalid GitHub App issuance response'); }
    const v = object(value) ? value : {};
    const expiresAt = typeof v.expires_at === 'string' ? Date.parse(v.expires_at) : NaN;
    const permissions = object(v.permissions) ? v.permissions : {};
    const repositories = Array.isArray(v.repositories) ? v.repositories : [];
    const valid = typeof v.token === 'string' && v.token.length > 0 && expiresAt > now && expiresAt <= now + 3660_000
      && repositories.length === 1 && object(repositories[0]) && typeof repositories[0].full_name === 'string'
      && repositories[0].full_name.toLowerCase() === req.repository.toLowerCase()
      && Object.entries(req.permissions).every(([k, p]) => permissions[k] === p)
      && Object.entries(permissions).every(([k, p]) => req.permissions[k] === p || (k === 'metadata' && p === 'read'));
    if (!valid) {
      if (typeof v.token === 'string' && v.token) {
        let revoked: Response;
        try { revoked = await this.fetcher('https://api.github.com/installation/token', { method: 'DELETE', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${v.token}` } }); }
        catch { throw new IssuerError('denied', 'invalid token scope; emergency token revocation could not be confirmed'); }
        if (revoked.status !== 204) throw new IssuerError('denied', 'invalid token scope; emergency token revocation was refused');
      }
      throw new IssuerError('denied', 'GitHub returned an invalid token lifetime or scope; credential rejected');
    }
    return { token: v.token as string, expiresAt, repositories: [req.repository], permissions: permissions as Permissions };
  }
}
