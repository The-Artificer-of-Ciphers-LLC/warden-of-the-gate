import { CredentialController, readPersistedCredentialStatus } from '../credentials/controller.ts';
import { IssuerError } from '../credentials/types.ts';
import { ceilingFor, loadConfigs, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { validInstallation } from '../credentials/github-app.ts';
import { resolve } from 'node:path';

export async function credentials(c: Ctx, sub: string): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'credentials: configuration invalid' };
  const cfg = cfgs.warden; const st = openStorage(c, cfg.repository);
  if (sub === 'configure') {
    if (!c.flags.confirm) return { code: 1, data: {}, text: 'credentials configure requires --confirm; provisions metadata only, never creates a key or issues credentials' };
    const installation = { appId: Number(str(c.flags, 'app-id')), installationId: Number(str(c.flags, 'installation-id')), appLogin: str(c.flags, 'app-login'),
      ...(str(c.flags, 'key-path') ? { keyPath: resolve(c.cwd, str(c.flags, 'key-path')!) } : {}) };
    if (!validInstallation(installation)) return { code: 2, data: {}, text: 'credentials configure needs positive --app-id, --installation-id and --app-login ending in [bot]; optional --key-path references a protected local signing key' };
    if (st.readJson(st.path('github.json')) && !c.flags.replace) return { code: 1, data: {}, text: 'existing installation is unchanged; replacement requires --replace --confirm' };
    if (c.flags['approve-control-read']) {
      const ceiling = ceilingFor(st, cfg);
      if (!ceiling || !cfg.inbox.globalControl) return { code: 1, data: {}, text: 'approve-control-read requires an existing ceiling and configured inbox.globalControl' };
      st.writeJson(st.path('ceiling.json'), { ...ceiling, controlRepositories: [...new Set([...(ceiling.controlRepositories ?? []), cfg.inbox.globalControl.repository])] });
    }
    st.writeJson(st.path('github.json'), installation);
    st.securityAudit('app-installation-configured', { appId: installation.appId, installationId: installation.installationId, controlReadApproved: !!c.flags['approve-control-read'] });
    return { code: 0, data: { configured: true, minted: false }, text: 'App installation reference configured in protected instance storage. No credentials were issued; no key was created or uploaded.' };
  }
  if (sub === 'status') { const s = readPersistedCredentialStatus(st.credentialsDir, c.now()); return { code: 0, data: { automation: cfg.credentials.automation, status: s }, text: `automation ${cfg.credentials.automation}\n` + (s.map((x) => `${x.operation}: ${x.state}${x.suspended ? ' (suspended)' : ''}${x.lastError ? ` - ${x.lastError}` : ''}`).join('\n') || 'no credential activity recorded') }; }
  if (sub === 'ack-revocation') {
    if (!c.flags.confirm) return { code: 1, data: {}, text: 'credentials ack-revocation: re-run with --confirm. This only clears the sticky revoked state locally; provider-supported reauthorization is still required to obtain new trust.' };
    const ceiling = ceilingFor(st, cfg); if (!ceiling) return { code: 1, data: {}, text: 'no operator ceiling present' };
    const ctl = new CredentialController({ issuer: { issue: async () => { throw new IssuerError('unavailable', 'no issuer wired in P1'); } }, ceiling, stateDir: st.credentialsDir });
    ctl.operatorAcknowledgeRevocation(str(c.flags, 'as') ?? cfg.maintainers[0]);
    return { code: 0, data: {}, text: 'revocation acknowledged (audited). No credential was minted or restored.' };
  }
  return { code: 2, data: {}, text: 'credentials: configure | status | ack-revocation' };
}
