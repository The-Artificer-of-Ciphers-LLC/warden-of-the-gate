import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialUnavailable, IssuerError } from './types.ts';
import type { AuthorityCeiling, CredentialProvider, CredentialRequest, CredentialState, CredentialStatus, IssuedCredential, Issuer, Operation, PermLevel, Permissions } from './types.ts';
import { canonical, iso, redact } from '../util.ts';
import { readJsonFile, StorageError } from '../storage/instance.ts';

interface Persisted { failures: number; nextAttemptAt?: number; lastError?: string; state: CredentialState; revokedAt?: number; expiresAt?: number }
export interface Backoff { baseMs: number; maxMs: number; maxConsecutive: number }
export interface AuditEntry { at: string; event: string; operation: string; repository: string; permissions: Permissions; outcome: string; detail?: string }

const lvl = (p?: PermLevel) => (p === 'write' ? 2 : p === 'read' ? 1 : 0);
const keyOf = (r: { operation: Operation; repository: string }) => `${r.operation}@${r.repository}`;
/** Permissions Warden never requests, whatever the ceiling says. `workflows` lets a token change `.github/workflows/`, which would let Warden rewrite
 *  the workflows that constrain it (PRD §3 Actions hardening, confirmed by the owner on 2026-11-27). */
export const NEVER_REQUESTED = ['workflows'];
export function credentialDenial(ceiling: AuthorityCeiling, r: CredentialRequest): string | null {
  const never = Object.keys(r.permissions).filter((k) => NEVER_REQUESTED.includes(k));
  if (never.length) return `permission ${never.join(', ')} is never requested: Warden does not change its own workflows`;
  if (r.operation === 'read-control' && ceiling.controlRepositories?.includes(r.repository)) {
    return Object.entries(r.permissions).every(([k, v]) => ['issues', 'metadata'].includes(k) && v === 'read') ? null : 'control repository grants read access only';
  }
  if (!ceiling.repositories.includes(r.repository)) return `repository ${r.repository} is outside the operator ceiling`;
  for (const [name, level] of Object.entries(r.permissions)) if (lvl(level) > lvl(ceiling.maxPermissions[name])) return `permission ${name}:${level} exceeds the operator ceiling`;
  return null;
}

function validPersisted(value: unknown): value is Persisted {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Partial<Persisted>;
  return typeof p.failures === 'number' && Number.isSafeInteger(p.failures) && p.failures >= 0
    && typeof p.state === 'string' && ['valid', 'none', 'renewing', 'backoff', 'revoked', 'opted-out', 'denied'].includes(p.state)
    && [p.nextAttemptAt, p.revokedAt, p.expiresAt].every((v) => v === undefined || (typeof v === 'number' && Number.isFinite(v)))
    && (p.lastError === undefined || typeof p.lastError === 'string');
}
function readCredentialState(dir: string): Record<string, Persisted> {
  const file = join(dir, 'credentials-state.json'); const value = readJsonFile<unknown>(file);
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new StorageError(`invalid credential state in ${file}`);
  const state: Record<string, Persisted> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!validPersisted(entry)) throw new StorageError(`invalid credential record in ${file}`);
    state[key] = entry;
  }
  return state;
}

/** Trusted credential controller (ADR 0011). Enforces the operator ceiling OUTSIDE any model, issues/renews/rotates/recovers,
 *  persists backoff and revocation so cold starts cannot reset them, never logs a token, and has NO fallback path to a broader credential. */
export class CredentialController implements CredentialProvider {
  private issuer: Issuer; private ceiling: AuthorityCeiling; private dir: string; private now: () => number;
  private renewBeforeMs: number; private backoff: Backoff;
  private cache = new Map<string, IssuedCredential>(); private inflight = new Map<string, Promise<string>>();
  private seen = new Map<string, CredentialRequest>();
  constructor(o: { issuer: Issuer; ceiling: AuthorityCeiling; stateDir: string; now?: () => number; renewBeforeMs?: number; backoff?: Backoff }) {
    this.issuer = o.issuer; this.ceiling = o.ceiling; this.dir = o.stateDir; this.now = o.now ?? Date.now;
    this.renewBeforeMs = o.renewBeforeMs ?? 5 * 60_000; this.backoff = o.backoff ?? { baseMs: 5_000, maxMs: 15 * 60_000, maxConsecutive: 8 };
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }
  private get statePath() { return join(this.dir, 'credentials-state.json'); }
  private get auditPath() { return join(this.dir, 'credential-audit.jsonl'); }
  private load(): Record<string, Persisted> { return readCredentialState(this.dir); }
  private save(s: Record<string, Persisted>) { const t = this.statePath + '.tmp'; writeFileSync(t, JSON.stringify(s), { mode: 0o600 }); renameSync(t, this.statePath); chmodSync(this.statePath, 0o600); }
  private patch(k: string, p: Partial<Persisted>) { const s = this.load(); s[k] = { ...({ failures: 0, state: 'none' } as Persisted), ...s[k], ...p }; this.save(s); return s[k]; }
  private audit(event: string, req: CredentialRequest, outcome: string, detail?: string) {
    const e: AuditEntry = { at: iso(this.now()), event, operation: req.operation, repository: req.repository, permissions: req.permissions, outcome, detail: detail ? redact(detail) : undefined };
    appendFileSync(this.auditPath, JSON.stringify(e) + '\n', { mode: 0o600 });
  }
  readAudit(limit = 200): AuditEntry[] {
    if (!existsSync(this.auditPath)) return [];
    return readFileSync(this.auditPath, 'utf8').split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l) as AuditEntry);
  }
  token(req: CredentialRequest): Promise<string> {
    const k = keyOf(req);
    if (this.ceiling.automation === 'opt-out' || credentialDenial(this.ceiling, req)) return this.acquire(req, k);
    const prior = this.seen.get(k);
    if (prior && canonical(prior.permissions) !== canonical(req.permissions)) return Promise.reject(new CredentialUnavailable('denied', 'credential scope cannot change within the same operation'));
    this.seen.set(k, req);
    const running = this.inflight.get(k); if (running) return running;
    const p = this.acquire(req, k).finally(() => this.inflight.delete(k));
    this.inflight.set(k, p); return p;
  }
  private async acquire(req: CredentialRequest, k: string): Promise<string> {
    if (this.ceiling.automation === 'opt-out') { this.audit('opted-out', req, 'refused'); throw new CredentialUnavailable('opted-out', 'credential automation is opted out by the operator'); }
    const over = credentialDenial(this.ceiling, req);
    if (over) { this.audit('ceiling-denied', req, 'refused', over); throw new CredentialUnavailable('denied', over); }
    const st = this.load()[k];
    if (st?.state === 'revoked') { this.cache.delete(k); throw new CredentialUnavailable('revoked', 'credential trust was revoked; operator acknowledgement and provider-supported reauthorization required'); }
    const now = this.now(); const cached = this.cache.get(k);
    if (cached && cached.expiresAt - now > this.renewBeforeMs) return cached.token;
    if (st?.state === 'denied') throw new CredentialUnavailable('denied', st.lastError ?? 'provider denied the requested permissions');
    if (st?.nextAttemptAt && now < st.nextAttemptAt) {
      if (cached && cached.expiresAt > now) return cached.token;       // proactive renewal is in backoff: keep serving the still-valid token
      throw new CredentialUnavailable('backoff', `issuer unavailable; next attempt allowed at ${iso(st.nextAttemptAt)}`);
    }
    try {
      const c = await this.issuer.issue(req);
      if (this.load()[k]?.state === 'revoked') throw new CredentialUnavailable('revoked', 'credential trust was revoked while issuance was in flight; issued credential was not adopted');
      const had = this.cache.get(k); this.cache.set(k, c);
      const recovered = (st?.failures ?? 0) > 0;
      this.patch(k, { failures: 0, nextAttemptAt: undefined, lastError: undefined, state: 'valid', expiresAt: c.expiresAt });
      this.audit(recovered ? 'recovered' : had ? (had.expiresAt > now ? 'rotated' : 'renewed') : 'issued', req, 'ok');
      return c.token;
    } catch (e) {
      if (!(e instanceof IssuerError)) throw e;
      if (this.load()[k]?.state === 'revoked') throw new CredentialUnavailable('revoked', 'credential trust remains revoked; issuer completion cannot restore authority');
      const msg = redact(e.message);
      if (e.kind === 'revoked') { this.cache.delete(k); this.patch(k, { state: 'revoked', revokedAt: now, lastError: msg }); this.audit('revoked', req, 'sticky', msg); throw new CredentialUnavailable('revoked', 'credential trust was revoked'); }
      if (e.kind === 'denied') { this.patch(k, { state: 'denied', lastError: msg }); this.audit('denied', req, 'refused', msg); throw new CredentialUnavailable('denied', msg); }
      const failures = (st?.failures ?? 0) + 1;
      const delay = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** Math.min(failures - 1, 20));
      this.patch(k, { failures, nextAttemptAt: now + delay, lastError: msg, state: 'backoff' });
      this.audit('failed', req, 'unavailable', msg); this.audit('backoff', req, `retry in ${delay}ms`);
      if (cached && cached.expiresAt > now) return cached.token;
      throw new CredentialUnavailable('backoff', `issuer unavailable (${msg}); retrying with bounded backoff`);
    }
  }
  reportUnauthorized(req: CredentialRequest) {
    const k = keyOf(req); this.cache.delete(k);
    this.patch(k, { state: 'revoked', revokedAt: this.now(), lastError: 'GitHub rejected the issued credential (HTTP 401)' });
    this.audit('revoked', req, 'sticky', 'issued credential rejected by GitHub; explicit operator acknowledgement required');
  }
  /** Explicit operator action after deliberate revocation. Does NOT mint anything; the next token() may then try the issuer. */
  operatorAcknowledgeRevocation(actor: string) {
    const s = this.load();
    for (const [k, v] of Object.entries(s)) if (v.state === 'revoked') { s[k] = { failures: 0, state: 'none' }; const r = this.seen.get(k) ?? { operation: k.split('@')[0] as Operation, repository: k.split('@')[1], permissions: {} }; this.audit('revocation-acknowledged', r, `by ${actor}`); }
    this.save(s); this.cache.clear();
  }
  status(): CredentialStatus[] {
    const s = this.load(); const out: CredentialStatus[] = []; const now = this.now();
    for (const k of new Set([...Object.keys(s), ...this.seen.keys()])) {
      const p = s[k]; const [operation, , ] = k.split('@') as [Operation];
      let state: CredentialState = p?.state ?? 'none';
      const exp = this.cache.get(k)?.expiresAt ?? p?.expiresAt;
      if (this.ceiling.automation === 'opt-out') state = 'opted-out'; else if (state === 'valid' && exp && exp <= now) state = 'none';
      out.push({ operation, state, expiresAt: exp, consecutiveFailures: p?.failures ?? 0, nextAttemptAt: p?.nextAttemptAt, lastError: p?.lastError, revokedAt: p?.revokedAt, suspended: ['backoff', 'revoked', 'denied', 'opted-out'].includes(state) && !(state === 'backoff' && (p?.failures ?? 0) < this.backoff.maxConsecutive && !!exp && exp > now) });
    }
    return out;
  }
}
/** Read persisted credential status without constructing a controller (used by `warden status`: no network, no secrets). */
export function readPersistedCredentialStatus(stateDir: string, now = Date.now()): CredentialStatus[] {
  const s = readCredentialState(stateDir);
  return Object.entries(s).map(([k, p]) => ({ operation: k.split('@')[0] as Operation, state: p.state === 'valid' && p.expiresAt && p.expiresAt <= now ? 'none' : p.state, expiresAt: p.expiresAt, consecutiveFailures: p.failures, nextAttemptAt: p.nextAttemptAt, lastError: p.lastError, revokedAt: p.revokedAt, suspended: ['backoff', 'revoked', 'denied'].includes(p.state) }));
}
