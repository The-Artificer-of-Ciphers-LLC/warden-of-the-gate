import { IssuerError } from './types.ts';
import type { CredentialRequest, IssuedCredential, Issuer, IssuerFailureKind } from './types.ts';

export type Outcome = { ok: number } | { fail: IssuerFailureKind; message?: string };
/** Scripted issuer for tests. Tokens look like installation tokens but are random and fake. */
export class ScriptedIssuer implements Issuer {
  calls = 0; script: Outcome[]; default: Outcome; now: () => number;
  constructor(script: Outcome[] = [], now: () => number = Date.now, def: Outcome = { ok: 3600_000 }) { this.script = script; this.now = now; this.default = def; }
  async issue(req: CredentialRequest): Promise<IssuedCredential> {
    this.calls++; const o = this.script.shift() ?? this.default;
    if ('fail' in o) throw new IssuerError(o.fail, o.message ?? `scripted ${o.fail}`);
    return { token: 'ghs_fake' + Math.random().toString(36).slice(2).padEnd(30, 'x'), expiresAt: this.now() + o.ok, repositories: [req.repository], permissions: req.permissions };
  }
}
