import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonical, sha256 } from '../util.ts';
import type { Comment } from '../github/store.ts';
import type { Ledger } from '../state/model.ts';
import type { ItemKind } from '../state/model.ts';

export const DEFAULT_MAX_INTENT_BYTES = 8 * 1024;
export const INTENT_MARK = '<!-- warden-intent:v1 -->';
export const RECEIPT_MARK = '<!-- warden-receipt:v1 -->';
export const LEDGER_MARK = '<!-- warden-ledger:v1 -->';
export const EFFECT_MARK = 'warden-effect';
export const INTENT_KINDS = ['claim', 'release', 'note', 'transition', 'override', 'approval-request', 'approval-decision', 'revision-update', 'sweep-action', 'intake', 'review-round', 'submission', 'hold', 'hold-release', 'reconcile', 'adopt', 'review-record', 'merge-request', 'rework-attempt', 'carry-accounting', 'critical-escape', 'resume-scope', 'link-pr'] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
/** Who produced the proposal: AI results are blocked in shadow mode; maintainer-origin intents need a verified GitHub source. */
export type Origin = 'deterministic' | 'ai' | 'maintainer';

export interface IntentCore {
  v: 1; kind: IntentKind; repo: string; item: number; itemKind: ItemKind; origin: Origin;
  source: { kind: string; id: string; observedAt: string };
  actor: string; payload: Record<string, unknown>; causalAfter?: string;
}
export interface Intent extends IntentCore { opid: string }

/** Immutable operation identity = content hash of the canonical core. Same source event => same opid. */
export const opidOf = (c: IntentCore) => 'op_' + sha256(canonical(c)).slice(0, 32);
export const makeIntent = (c: IntentCore): Intent => ({ ...c, opid: opidOf(c) });

export function encodeIntent(i: Intent, maxBytes = DEFAULT_MAX_INTENT_BYTES): string {
  const json = canonical(i);
  if (Buffer.byteLength(json) > maxBytes) throw new Error(`intent exceeds ${maxBytes} bytes (${Buffer.byteLength(json)}): rejected at submission, never truncated`);
  return `${INTENT_MARK}\n\`\`\`json\n${json}\n\`\`\``;
}
export type Parsed = { ok: true; intent: Intent } | { ok: false; reason: string };
export function parseIntent(c: Comment, maxBytes = DEFAULT_MAX_INTENT_BYTES): Parsed {
  if (!c.body.startsWith(INTENT_MARK)) return { ok: false, reason: 'not-intent' };
  const m = c.body.match(/```json\n([\s\S]*?)\n```/); if (!m) return { ok: false, reason: 'malformed' };
  let i: any; try { i = JSON.parse(m[1]); } catch { return { ok: false, reason: 'malformed-json' }; }
  if (Buffer.byteLength(m[1]) > maxBytes) return { ok: false, reason: 'payload-too-large' };
  if (i?.v !== 1 || !INTENT_KINDS.includes(i.kind) || typeof i.item !== 'number' || typeof i.repo !== 'string' || typeof i.actor !== 'string' || !i.source?.id
    || !['issue', 'pr'].includes(i.itemKind) || !['deterministic', 'ai', 'maintainer'].includes(i.origin) || typeof i.payload !== 'object' || i.payload === null) return { ok: false, reason: 'schema' };
  const { opid, ...core } = i;
  if (opidOf(core as IntentCore) !== opid) return { ok: false, reason: 'identity-mismatch' }; // body edited or forged
  return { ok: true, intent: i as Intent };
}

export interface Receipt {
  intentCommentId: number; opid: string; item: number; post?: { state: string; owner: Ledger['owner'] };
  result: 'applied' | 'rejected' | 'duplicate' | 'failed' | 'quarantined'; reason?: string; epoch: number; seq: number; by: string;
}

/** Ledger integrity: optional HMAC held only by the writer (identity split, ADR 0011/0012). Without a key only author checks + seq/receipt
 *  divergence repair apply, and status says so. */
export const macOf = (l: Ledger, key: string) => createHmac('sha256', key).update(canonical({ ...l, mac: undefined })).digest('hex');
export function macValid(l: Ledger, key: string): boolean {
  if (!l.mac) return false;
  const a = Buffer.from(macOf(l, key), 'hex'); const b = Buffer.from(l.mac, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function encodeLedger(l: Ledger, key?: string): string {
  const out: Ledger = { ...l, mac: undefined }; if (key) out.mac = macOf(l, key);
  const body = `${LEDGER_MARK}\n**Warden item ledger** (machine-owned; ${l.kind} state \`${l.state}\`, owner \`${l.owner ? l.owner.id : 'none'}\`, seq ${l.seq})\n\`\`\`json\n${canonical(out)}\n\`\`\``;
  if (body.length > 60000) throw new Error('ledger exceeds comment capacity');
  return body;
}
export function parseLedger(body: string): Ledger | null {
  if (!body.startsWith(LEDGER_MARK)) return null;
  const m = body.match(/```json\n([\s\S]*?)\n```/); if (!m) return null;
  try { return JSON.parse(m[1]) as Ledger; } catch { return null; }
}
export const encodeReceipt = (r: Receipt) => `${RECEIPT_MARK}\n\`\`\`json\n${canonical(r)}\n\`\`\``;
export function parseReceipt(body: string): Receipt | null {
  if (!body.startsWith(RECEIPT_MARK)) return null;
  const m = body.match(/```json\n([\s\S]*?)\n```/); try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}
