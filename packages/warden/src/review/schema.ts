/** Structured result the review session must return. Ajv checks SHAPE only; scope, head binding and verdict consistency are validated
 *  separately by warden-core (validity is necessary, never sufficient). */
import { REVIEW_LIMITS } from './rules.ts';
export const SEVERITIES =['blocker', 'major', 'minor', 'nit'] as const;
export type Severity = (typeof SEVERITIES)[number];
export interface Finding { id: string; severity: Severity; path: string; line: number; rationale: string; correction: string; /** Set by warden-core after validation, never by the model (the result schema forbids extra fields). */ fingerprint?: string; inline?: boolean; /** Optional, model-supplied, 0..1: used only by `review.uncertainFindings: drop-below-confidence`. */ confidence?: number }
export interface ReviewOutput { verdict: 'no findings' | 'changes needed'; findings: Finding[]; revalidated?: Array<{ id: string; status: 'open' | 'resolved' }> }

export const reviewResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object', additionalProperties: false, required: ['verdict', 'findings'],
  properties: {
    verdict: { enum: ['no findings', 'changes needed'] },
    findings: { type: 'array', maxItems: REVIEW_LIMITS.findings.hard as number, items: {
      type: 'object', additionalProperties: false, required: ['id', 'severity', 'path', 'line', 'rationale', 'correction'],
      properties: {
        id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' }, severity: { enum: [...SEVERITIES] }, path: { type: 'string', minLength: 1, maxLength: 300 },
        line: { type: 'integer', minimum: 1 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, rationale: { type: 'string', minLength: 1, maxLength: REVIEW_LIMITS.rationale.hard as number }, correction: { type: 'string', minLength: 1, maxLength: REVIEW_LIMITS.correction.hard as number },
      } } },
    revalidated: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['id', 'status'],
      properties: { id: { type: 'string' }, status: { enum: ['open', 'resolved'] } } } },
  },
} as const;
