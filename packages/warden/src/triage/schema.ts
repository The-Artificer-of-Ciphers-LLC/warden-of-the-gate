/** Triage result contract. Ajv checks SHAPE; warden-core validates outcome-specific completeness separately. kind, severity, risk and quickWin are
 *  independent facets: none is derived from another. The model can recommend `not-actionable` but `wontfix` is a maintainer decision and is not
 *  representable here. A bug is only ever `likely-bug` from model output: confirmation needs trusted executor evidence (verification work). */
export const KINDS = ['bug', 'enhancement', 'feature', 'question', 'other'] as const;
export const OUTCOMES = ['likely-bug', 'needs-info', 'feature-proposal', 'escalate', 'not-actionable'] as const;
export type Kind = (typeof KINDS)[number]; export type Outcome = (typeof OUTCOMES)[number];
export interface Proposal { scope: string; acceptance: string[]; approach: string; affectedAreas: string[]; interfaces: string; migration: string; blastRadius: string; alternatives: string[]; unresolved: string[] }
export interface TriageOutput {
  kind: Kind; outcome: Outcome; summary: string; severity?: 'blocker' | 'major' | 'minor' | 'nit'; risk?: 'low' | 'medium' | 'high' | 'uncertain'; quickWin?: boolean;
  evidence?: Array<{ kind: 'reporter-claim' | 'citation' | 'observation'; detail: string }>; questions?: string[]; proposal?: Proposal; escalation?: string;
}
const str = { type: 'string', minLength: 1, maxLength: 1500 } as const;
export const triageResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['kind', 'outcome', 'summary'],
  properties: {
    kind: { enum: [...KINDS] }, outcome: { enum: [...OUTCOMES] }, summary: { type: 'string', minLength: 1, maxLength: 600 },
    severity: { enum: ['blocker', 'major', 'minor', 'nit'] }, risk: { enum: ['low', 'medium', 'high', 'uncertain'] }, quickWin: { type: 'boolean' },
    evidence: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['kind', 'detail'], properties: { kind: { enum: ['reporter-claim', 'citation', 'observation'] }, detail: str } } },
    questions: { type: 'array', maxItems: 5, items: str },
    proposal: { type: 'object', additionalProperties: false, required: ['scope', 'acceptance', 'approach', 'affectedAreas', 'interfaces', 'migration', 'blastRadius', 'alternatives', 'unresolved'],
      properties: { scope: str, acceptance: { type: 'array', maxItems: 12, items: str }, approach: str, affectedAreas: { type: 'array', maxItems: 12, items: str }, interfaces: str, migration: str, blastRadius: str, alternatives: { type: 'array', maxItems: 6, items: str }, unresolved: { type: 'array', maxItems: 10, items: str } } },
    escalation: str,
  },
} as const;

/** Outcome-specific completeness. Returns null when complete, else the reason the WHOLE result is rejected. */
export function incomplete(o: TriageOutput): string | null {
  switch (o.outcome) {
    case 'likely-bug':
      if (o.kind !== 'bug') return 'outcome likely-bug requires kind bug';
      if (!o.evidence?.length) return 'a likely bug needs at least one piece of evidence';
      if (!o.severity || !o.risk) return 'a likely bug needs severity and risk, assessed separately';
      return null;
    case 'needs-info': return o.questions?.length ? null : 'needs-info requires at least one precise question';
    case 'feature-proposal': {
      if (o.kind !== 'feature' && o.kind !== 'enhancement') return 'a feature proposal requires kind feature or enhancement';
      const p = o.proposal; if (!p) return 'a feature proposal requires the design/acceptance/migration/alternatives fields';
      if (!p.acceptance.length) return 'proposal needs observable acceptance criteria'; if (!p.alternatives.length) return 'proposal needs at least one considered alternative';
      return null;
    }
    case 'escalate': return o.escalation ? null : 'escalate requires a reason';
    case 'not-actionable': return null;
  }
}
