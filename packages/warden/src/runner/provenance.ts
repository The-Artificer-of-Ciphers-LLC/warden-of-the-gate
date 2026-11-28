import { harnessLabel } from './agent-runner.ts';
import type { PreflightReport } from './agent-runner.ts';

/** Owner ruling 2026-11-27 (PRD §9, §12): every review and auto-merge verdict records the endpoint tier, the endpoint and the exact model id that produced it, so per-model and per-tier
 *  statistics are possible and a verdict can never be passed off as coming from somewhere it did not. The tier vocabulary is MODEL-CONNECTIONS': only `local-enforced` may say
 *  "stayed on this Mac". Today's OpenCode runner reaches a loopback server whose own egress Warden does not enforce, so it reports `local-unverified`. Anything the preflight did not
 *  report is recorded as `unknown`, never guessed. The endpoint is host and port only: no scheme path, no userinfo, no query, so nothing secret can ride along. */
export const TIERS = ['local-enforced', 'local-unverified', 'self-hosted-remote', 'vendor-remote', 'frontier', 'attested-remote', 'unknown'] as const;
export type Tier = (typeof TIERS)[number];
export interface Provenance { tier: Tier; endpoint: string; model: string; harness: string }

export function provenanceOf(pf: Partial<PreflightReport>, harnessName: string): Provenance {
  return { tier: (TIERS as readonly string[]).includes(pf.tier ?? '') ? (pf.tier as Tier) : 'unknown', endpoint: hostPort(pf.endpoint) ?? 'unknown', model: pf.resolvedModel?.trim() || 'unknown', harness: harnessLabel(harnessName, pf.harnessVersion) };
}
/** `127.0.0.1:11234` from a host:port or a URL; anything with userinfo, a path or a query is reduced to host:port, anything unparsable is null. */
export function hostPort(e?: string): string | null {
  if (!e) return null; try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? e : `http://${e}`); return u.host || null; } catch { return null; }
}
/** Validates a provenance arriving in an intent payload: exact shape, bounded strings, known tier. Returns null for anything else (never partially trusted). */
export function cleanProvenance(x: unknown): Provenance | null {
  if (!x || typeof x !== 'object') return null; const p = x as Record<string, unknown>;
  const ok = (v: unknown, n: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= n && !/[\r\n`<>]/.test(v);
  if (!ok(p.tier, 40) || !(TIERS as readonly string[]).includes(p.tier) || !ok(p.endpoint, 120) || !ok(p.model, 200) || !ok(p.harness, 80)) return null;
  return { tier: p.tier as Tier, endpoint: p.endpoint, model: p.model, harness: p.harness };
}
export const provenanceText = (p: Provenance): string => `${p.model} via ${p.harness} on ${p.tier} endpoint ${p.endpoint}`;
