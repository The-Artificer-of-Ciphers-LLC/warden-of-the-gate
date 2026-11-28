import { sha256 } from '../util.ts';
import type { IntentCore } from '../writer/protocol.ts';
import type { Marker } from './slice.ts';
import { capFindings, DEFAULT_MAX_POSTED_FINDINGS } from './findings.ts';

/** The proposal an ACCEPTED review hands to the serialized writer so the ledger can record it (`review-record`, origin `ai`). It carries severities only, never finding text. The writer already refuses
 *  every AI-origin intent in shadow mode, and the caller only submits in live mode, so a shadow run records nothing remote. Same review, same intent: the identity comes from the head, the base,
 *  the policy digest and the findings' fingerprints, so a repeated submission is recognised as a duplicate. */
export function reviewRecordIntent(o: { repo: string; item: number; marker: Marker; actor?: string }): IntentCore {
  const m = o.marker; const fp = m.findings.map((f) => f.fingerprint ?? `${f.path}:${f.line}:${f.id}`).sort().join(',');
  return { v: 1, kind: 'review-record', repo: o.repo, item: o.item, itemKind: 'pr', origin: 'ai', actor: o.actor ?? 'warden-review',
    source: { kind: 'review-accepted', id: `${m.head}:${sha256([m.base, m.policyDigest ?? '', m.verdict, fp].join('|')).slice(0, 16)}`, observedAt: m.acceptedAt },
    payload: { head: m.head, base: m.base, verdict: m.verdict, severities: m.findings.map((f) => f.severity), ...(m.findings.every((f) => f.fingerprint) ? { fingerprints: m.findings.map((f) => f.fingerprint) } : {}), ...(m.policyDigest ? { policyDigest: m.policyDigest } : {}) } };
}

const clip = (t: string, n: number) => (t.length <= n ? t : t.slice(0, n - 1) + '\u2026');
/** The proposal that carries a recorded review to GitHub (`review-post`): the most severe findings first, capped (the ledger keeps the full list), each clipped so the whole intent stays well inside the
 *  intent size limit. `causalAfter` is the `review-record` it must follow. */
export function reviewPostIntent(o: { repo: string; item: number; marker: Marker; causalAfter?: string; cap?: number; actor?: string }): IntentCore {
  const m = o.marker; const { shown, omitted } = capFindings(m.findings, o.cap ?? DEFAULT_MAX_POSTED_FINDINGS);
  const findings = shown.map((f) => ({ severity: f.severity, path: f.path, line: f.line, inline: f.inline === true, rationale: clip(f.rationale, 280), correction: clip(f.correction, 200), ...(f.fingerprint ? { fingerprint: f.fingerprint } : {}) }));
  const fp = m.findings.map((f) => f.fingerprint ?? `${f.path}:${f.line}:${f.id}`).sort().join(',');
  return { v: 1, kind: 'review-post', repo: o.repo, item: o.item, itemKind: 'pr', origin: 'ai', actor: o.actor ?? 'warden-review', ...(o.causalAfter ? { causalAfter: o.causalAfter } : {}),
    source: { kind: 'review-accepted', id: `${m.head}:${sha256([m.base, m.policyDigest ?? '', m.verdict, fp, 'post'].join('|')).slice(0, 16)}`, observedAt: m.acceptedAt },
    payload: { head: m.head, verdict: m.verdict, omitted, findings } };
}
