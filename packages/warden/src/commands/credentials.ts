import { CredentialController, readPersistedCredentialStatus } from '../credentials/controller.ts';
import { IssuerError } from '../credentials/types.ts';
import { ceilingFor, loadConfigs, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';

export async function credentials(c: Ctx, sub: string): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'credentials: configuration invalid' };
  const cfg = cfgs.warden; const st = openStorage(c, cfg.repository);
  if (sub === 'status') { const s = readPersistedCredentialStatus(st.credentialsDir, c.now()); return { code: 0, data: { automation: cfg.credentials.automation, status: s }, text: `automation ${cfg.credentials.automation}\n` + (s.map((x) => `${x.operation}: ${x.state}${x.suspended ? ' (suspended)' : ''}${x.lastError ? ` - ${x.lastError}` : ''}`).join('\n') || 'no credential activity recorded') }; }
  if (sub === 'ack-revocation') {
    if (!c.flags.confirm) return { code: 1, data: {}, text: 'credentials ack-revocation: re-run with --confirm. This only clears the sticky revoked state locally; provider-supported reauthorization is still required to obtain new trust.' };
    const ceiling = ceilingFor(st, cfg); if (!ceiling) return { code: 1, data: {}, text: 'no operator ceiling present' };
    const ctl = new CredentialController({ issuer: { issue: async () => { throw new IssuerError('unavailable', 'no issuer wired in P1'); } }, ceiling, stateDir: st.credentialsDir });
    ctl.operatorAcknowledgeRevocation(str(c.flags, 'as') ?? cfg.maintainers[0]);
    return { code: 0, data: {}, text: 'revocation acknowledged (audited). No credential was minted or restored.' };
  }
  return { code: 2, data: {}, text: 'credentials: status | ack-revocation' };
}
