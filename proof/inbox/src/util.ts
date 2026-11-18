import { createHash } from 'node:crypto';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const jitter = (max: number) => Math.floor(Math.random() * max);

/** Deterministic JSON: sorted keys, no whitespace. Basis of immutable operation identity. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Thrown by fault injection to simulate a process dying at a named point. State survives only in the store. */
export class Crash extends Error { point: string; constructor(point: string) { super('CRASH@' + point); this.point = point; } }
/** Network error where the request MAY have been applied remotely (reply lost). */
export class NetworkError extends Error { constructor(m: string) { super(m); } }
/** Writer lost the lease / a higher epoch exists. */
export class Fenced extends Error { constructor(m: string) { super('FENCED: ' + m); } }
/** Stop control active or unknown. Fail closed. */
export class Stopped extends Error { why: string; constructor(why: string) { super('STOPPED: ' + why); this.why = why; } }
/** Structural anomaly (e.g. two ledger comments). Fail closed, never guess. */
export class Anomaly extends Error { constructor(m: string) { super('ANOMALY: ' + m); } }

export class Faults {
  private armed = new Map<string, number>();
  hits: string[] = [];
  /** Arm a one-shot fault at `point`; fires on the nth (default first) arrival. */
  arm(point: string, nth = 1) { this.armed.set(point, nth); return this; }
  hit(point: string) {
    const n = this.armed.get(point);
    if (n === undefined) return;
    if (n > 1) { this.armed.set(point, n - 1); return; }
    this.armed.delete(point); this.hits.push(point);
    throw new Crash(point);
  }
  private stalls = new Map<string, () => Promise<void>>();
  /** Install a one-shot async stall (simulates a GC pause / VM freeze) at a named point. */
  onStall(point: string, fn: () => Promise<void>) { this.stalls.set(point, fn); return this; }
  async stall(point: string) { const f = this.stalls.get(point); if (f) { this.stalls.delete(point); this.hits.push('stall:' + point); await f(); } }
  private always = new Set<string>();
  /** Persistent failure at `point` (poison effect). */
  failAlways(point: string) { this.always.add(point); return this; }
  fails(point: string) { return this.always.has(point); }
  take(point: string): boolean {
    if (!this.armed.has(point)) return false;
    this.armed.delete(point); this.hits.push(point); return true;
  }
}
export const iso = (ms: number) => new Date(ms).toISOString();
