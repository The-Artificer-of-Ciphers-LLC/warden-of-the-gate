/** CORE-credentials contract (ADR 0011). The controller sits BEHIND these interfaces; model sessions never see them.
 *  There is deliberately no code path that reads GITHUB_TOKEN, `gh auth token` or any PAT: no broader fallback exists. */
export type Operation = 'submit' | 'write' | 'read-control' | 'publish';
export type PermLevel = 'read' | 'write';
export type Permissions = Record<string, PermLevel>;

export interface CredentialRequest { operation: Operation; repository: string; permissions: Permissions }
export interface IssuedCredential {
  token: string;                 // NEVER logged, journaled, or returned by status
  expiresAt: number;             // ms epoch, from the issuer
  repositories: string[];
  permissions: Permissions;
}
export type IssuerFailureKind = 'unavailable' | 'revoked' | 'denied';
export class IssuerError extends Error {
  kind: IssuerFailureKind;
  constructor(kind: IssuerFailureKind, message: string) { super(message); this.kind = kind; }
}
/** The provider-side issuer (GitHub App installation tokens). Implementations hold key custody OUTSIDE model sessions. */
export interface Issuer { issue(req: CredentialRequest): Promise<IssuedCredential> }

/** Operator-approved maximum delegated authority (protected operator store, never model-controlled). */
export interface AuthorityCeiling {
  repositories: string[];
  controlRepositories?: string[];
  maxPermissions: Permissions;
  /** Explicit operator opt-out of credential automation: nothing is issued. */
  automation: 'enabled' | 'opt-out';
}

export type CredentialState = 'valid' | 'none' | 'renewing' | 'backoff' | 'revoked' | 'opted-out' | 'denied';
export interface CredentialStatus {
  operation: Operation; state: CredentialState; expiresAt?: number; consecutiveFailures: number; nextAttemptAt?: number;
  lastError?: string; revokedAt?: number; suspended: boolean;
}
/** What the rest of Warden uses. `token()` returns a short-lived credential or throws CredentialUnavailable (suspends only the
 *  authenticated operation; callers keep status/queue alive and retry later). */
export interface CredentialProvider {
  token(req: CredentialRequest): Promise<string>;
  status(): CredentialStatus[];
  reportUnauthorized?(req: CredentialRequest): void;
}
export class CredentialUnavailable extends Error {
  state: CredentialState;
  constructor(state: CredentialState, message: string) { super(message); this.state = state; }
}
