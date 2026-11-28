/** Triage result contract. Ajv checks SHAPE; warden-core validates outcome-specific completeness separately. kind, severity, risk and quickWin are
 *  independent facets: none is derived from another. The model can recommend `not-actionable` but `wontfix` is a maintainer decision and is not
 *  representable here. A bug is only ever `likely-bug` from model output: confirmation needs trusted executor evidence (verification work). */
import { TRIAGE_LIMITS, TRIAGE_RULES } from './rules.ts';
export const KINDS = ['bug', 'enhancement', 'feature', 'question', 'other'] as const;
export const OUTCOMES = ['likely-bug', 'needs-info', 'feature-proposal', 'escalate', 'not-actionable'] as const;
export type Kind = (typeof KINDS)[number]; export type Outcome = (typeof OUTCOMES)[number];
export interface Proposal { scope: string; acceptance: string[]; approach: string; affectedAreas: string[]; interfaces: string; migration: string; blastRadius: string; alternatives: string[]; unresolved: string[] }
export interface TriageOutput {
  kind: Kind; outcome: Outcome; summary: string; severity?: 'blocker' | 'major' | 'minor' | 'nit'; risk?: 'low' | 'medium' | 'high' | 'uncertain'; quickWin?: boolean;
  evidence?: Array<{ kind: 'reporter-claim' | 'citation' | 'observation'; detail: string }>; questions?: string[]; proposal?: Proposal; escalation?: string;
}
// The limits come from the rule table (ADR 0028), the one place the prompt and the schema both read.
const str = { type: 'string', minLength: 1, maxLength: TRIAGE_LIMITS.field.hard as number } as const;
export const triageResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['kind', 'outcome', 'summary'],
  properties: {
    kind: { enum: [...KINDS] }, outcome: { enum: [...OUTCOMES] }, summary: { type: 'string', minLength: 1, maxLength: TRIAGE_LIMITS.summary.hard as number },
    severity: { enum: ['blocker', 'major', 'minor', 'nit'] }, risk: { enum: ['low', 'medium', 'high', 'uncertain'] }, quickWin: { type: 'boolean' },
    evidence: { type: 'array', maxItems: TRIAGE_LIMITS.evidence.hard as number, items: { type: 'object', additionalProperties: false, required: ['kind', 'detail'], properties: { kind: { enum: ['reporter-claim', 'citation', 'observation'] }, detail: str } } },
    questions: { type: 'array', maxItems: TRIAGE_LIMITS.questions.hard as number, items: str },
    proposal: { type: 'object', additionalProperties: false, required: ['scope', 'acceptance', 'approach', 'affectedAreas', 'interfaces', 'migration', 'blastRadius', 'alternatives', 'unresolved'],
      properties: { scope: str, acceptance: { type: 'array', maxItems: 12, items: str }, approach: str, affectedAreas: { type: 'array', maxItems: 12, items: str }, interfaces: str, migration: str, blastRadius: str, alternatives: { type: 'array', maxItems: 6, items: str }, unresolved: { type: 'array', maxItems: 10, items: str } } },
    escalation: str,
  },
} as const;

/** Outcome-specific completeness. Returns null when complete, else the reason the WHOLE result is rejected. */
export function incomplete(o: TriageOutput): string | null {
  for (const r of TRIAGE_RULES) { if (typeof r.check !== 'function') continue; const why = r.check(o, undefined); if (why) return why; }
  return null;
}
