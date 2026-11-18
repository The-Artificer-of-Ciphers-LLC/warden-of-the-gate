import { canonical, sha256 } from './util.ts';
import type { Comment } from './store.ts';

export const MAX_INTENT_BYTES = 8 * 1024;       // payload limit: canonical intent JSON
export const MAX_LEDGER_OPS = 256;              // bound of per-item applied-op memory (dedupe horizon)
export const MAX_ATTEMPTS = 5;                  // retry bound per operation before 'failed' (operator-visible)
export const INTENT_MARK = '<!-- warden-intent:v1 -->';
export const RECEIPT_MARK = '<!-- warden-receipt:v1 -->';
export const LEDGER_MARK = '<!-- warden-ledger:v1 -->';
export const EFFECT_MARK = 'warden-effect';

export type Owner = { kind: 'contributor' | 'factory'; id: string; opid: string };
export interface IntentCore {
  v: 1; kind: 'claim' | 'release' | 'note';
  item: number;                                  // issue number (instance == repo, so repo is implicit)
  source: { kind: string; id: string; observedAt: string }; // dedupe key of the originating event/local result
  actor: string;                                 // who the intent says it acts for (claimant / source author)
  payload: Record<string, unknown>;
  causalAfter?: string;                          // opid that must be applied first (out-of-order handling)
}
export interface Intent extends IntentCore { opid: string }

/** Immutable operation identity = content hash of the canonical core. Same source event => same opid. */
export const opidOf = (c: IntentCore) => 'op_' + sha256(canonical(c)).slice(0, 32);
export function makeIntent(c: IntentCore): Intent { return { ...c, opid: opidOf(c) }; }

export function encodeIntent(i: Intent): string {
  const json = canonical(i);
  if (Buffer.byteLength(json) > MAX_INTENT_BYTES) throw new Error(`intent exceeds ${MAX_INTENT_BYTES} bytes (${Buffer.byteLength(json)}): rejected at submission, not truncated`);
  return `${INTENT_MARK}\n\`\`\`json\n${json}\n\`\`\``;
}
export type Parsed = { ok: true; intent: Intent } | { ok: false; reason: string };
export function parseIntent(c: Comment): Parsed {
  if (!c.body.startsWith(INTENT_MARK)) return { ok: false, reason: 'not-intent' };
  const m = c.body.match(/```json\n([\s\S]*?)\n```/); if (!m) return { ok: false, reason: 'malformed' };
  let i: any; try { i = JSON.parse(m[1]); } catch { return { ok: false, reason: 'malformed-json' }; }
  if (Buffer.byteLength(m[1]) > MAX_INTENT_BYTES) return { ok: false, reason: 'payload-too-large' };
  if (i?.v !== 1 || !['claim', 'release', 'note'].includes(i.kind) || typeof i.item !== 'number' || typeof i.actor !== 'string' || !i.source?.id) return { ok: false, reason: 'schema' };
  const { opid, ...core } = i;
  if (opidOf(core as IntentCore) !== opid) return { ok: false, reason: 'identity-mismatch' }; // body edited or forged
  return { ok: true, intent: i as Intent };
}

export type Effect = { t: 'assign'; login: string } | { t: 'label'; add?: string[]; remove?: string[] } | { t: 'comment'; text: string };
export interface OpRec {
  status: 'applying' | 'applied' | 'rejected' | 'failed'; decision: 'accept' | 'reject'; reason?: string;
  plan: Effect[]; step: number; attempts: number; epoch: number; intentCommentId: number;
}
export interface Ledger {
  v: 1; item: number; epoch: number; seq: number; state: 'ready' | 'claimed'; owner: Owner | null;
  ops: Record<string, OpRec>; order: string[];
}
export const newLedger = (item: number): Ledger => ({ v: 1, item, epoch: 0, seq: 0, state: 'ready', owner: null, ops: {}, order: [] });
export function encodeLedger(l: Ledger): string {
  const body = `${LEDGER_MARK}\n**Warden item ledger** (machine-owned; state \`${l.state}\`, owner \`${l.owner ? l.owner.id : 'none'}\`, seq ${l.seq})\n\`\`\`json\n${canonical(l)}\n\`\`\``;
  if (body.length > 60000) throw new Error('ledger exceeds comment capacity');
  return body;
}
export function parseLedger(body: string): Ledger | null {
  if (!body.startsWith(LEDGER_MARK)) return null;
  const m = body.match(/```json\n([\s\S]*?)\n```/); return m ? JSON.parse(m[1]) : null;
}

export interface Receipt { intentCommentId: number; opid: string; item: number; post?: { state: 'ready' | 'claimed'; owner: Owner | null }; result: 'applied' | 'rejected' | 'duplicate' | 'failed' | 'quarantined'; reason?: string; epoch: number; seq: number; by: string }
export const encodeReceipt = (r: Receipt) => `${RECEIPT_MARK}\n\`\`\`json\n${canonical(r)}\n\`\`\``;
export function parseReceipt(body: string): Receipt | null {
  if (!body.startsWith(RECEIPT_MARK)) return null;
  const m = body.match(/```json\n([\s\S]*?)\n```/); try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}
