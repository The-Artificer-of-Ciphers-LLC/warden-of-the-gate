import { sha256 } from '../util.ts';
import type { IntentCore } from '../writer/protocol.ts';
import type { Marker } from './slice.ts';

/** The proposal an ACCEPTED review hands to the serialized writer so the ledger can record it (`review-record`, origin `ai`). It carries severities only, never finding text. The writer already refuses
 *  every AI-origin intent in shadow mode, and the caller only submits in live mode, so a shadow run records nothing remote. Same review, same intent: the identity comes from the head, the base,
 *  the policy digest and the findings' fingerprints, so a repeated submission is recognised as a duplicate. */
export function reviewRecordIntent(o: { repo: string; item: number; marker: Marker; actor?: string }): IntentCore {
  const m = o.marker; const fp = m.findings.map((f) => f.fingerprint ?? `${f.path}:${f.line}:${f.id}`).sort().join(',');
  return { v: 1, kind: 'review-record', repo: o.repo, item: o.item, itemKind: 'pr', origin: 'ai', actor: o.actor ?? 'warden-review',
    source: { kind: 'review-accepted', id: `${m.head}:${sha256([m.base, m.policyDigest ?? '', m.verdict, fp].join('|')).slice(0, 16)}`, observedAt: m.acceptedAt },
    payload: { head: m.head, base: m.base, verdict: m.verdict, severities: m.findings.map((f) => f.severity), ...(m.policyDigest ? { policyDigest: m.policyDigest } : {}) } };
}
