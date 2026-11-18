import { createHash } from 'node:crypto';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const jitter = (max: number) => Math.floor(Math.random() * max);
export const iso = (ms: number) => new Date(ms).toISOString();

/** Deterministic JSON: sorted keys, no whitespace. Basis of immutable operation identity and digests. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const digest = (v: unknown) => sha256(canonical(v));

/** Simulated process death at a named point (tests). Durable state survives only in the store/journal. */
export class Crash extends Error { point: string; constructor(point: string) { super('CRASH@' + point); this.point = point; } }
/** Network error where the request MAY have been applied remotely (reply lost). */
export class NetworkError extends Error {}
/** Writer lost the lease / a higher epoch exists / stale base. */
export class Fenced extends Error { constructor(m: string) { super('FENCED: ' + m); } }
/** Stop control active or unknown. Fail closed. */
export class Stopped extends Error { why: string; constructor(why: string) { super('STOPPED: ' + why); this.why = why; } }
/** Structural anomaly (competing ledger, unauthorized ledger author). Fail closed, never guess. */
export class Anomaly extends Error { constructor(m: string) { super('ANOMALY: ' + m); } }

export class Faults {
  private armed = new Map<string, number>();
  hits: string[] = [];
  arm(point: string, nth = 1) { this.armed.set(point, nth); return this; }
  hit(point: string) {
    const n = this.armed.get(point);
    if (n === undefined) return;
    if (n > 1) { this.armed.set(point, n - 1); return; }
    this.armed.delete(point); this.hits.push(point);
    throw new Crash(point);
  }
  private stalls = new Map<string, () => Promise<void>>();
  onStall(point: string, fn: () => Promise<void>) { this.stalls.set(point, fn); return this; }
  async stall(point: string) { const f = this.stalls.get(point); if (f) { this.stalls.delete(point); this.hits.push('stall:' + point); await f(); } }
  private always = new Set<string>();
  failAlways(point: string) { this.always.add(point); return this; }
  fails(point: string) { return this.always.has(point); }
  take(point: string): boolean {
    if (!this.armed.has(point)) return false;
    this.armed.delete(point); this.hits.push(point); return true;
  }
}

/** Redact credential-shaped values from any string before it is persisted or printed. */
const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(authorization["':\s]+(?:bearer|token)\s+)[A-Za-z0-9._\-]{8,}/gi, /(bearer\s+)[A-Za-z0-9._\-]{16,}/gi,
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}/g, // JWT
];
export function redact(s: string): string {
  let out = s;
  for (const p of SECRET_PATTERNS) out = out.replace(p, (_m, g1) => (typeof g1 === 'string' ? g1 : '') + '[REDACTED]');
  return out;
}
export function redactDeep<T>(v: T): T {
  if (typeof v === 'string') return redact(v) as unknown as T;
  if (Array.isArray(v)) return v.map(redactDeep) as unknown as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = /token|secret|privateKey|password/i.test(k) && typeof x === 'string' ? '[REDACTED]' : redactDeep(x);
    return o as T;
  }
  return v;
}
