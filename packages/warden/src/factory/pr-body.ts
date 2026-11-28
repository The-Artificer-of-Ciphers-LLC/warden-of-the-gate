/** P4: the PR-opening description a factory PR must carry. Pure rendering plus validation: a PR cannot be opened without scope, approach, evidence,
 *  attribution and Merge Danger, and it never claims review or merge completion. Door semantics: a two-way door is cheap to roll back; a one-way door is
 *  destructive or hard to reverse (data, authority, external services). */
export type Door = 'two-way' | 'one-way';
export interface PrBody { scope: string; approach: string; evidence: string[]; attribution: { aiAssisted: true; model: string; harness: string; credited?: string[] }; danger: { door: Door; blastRadius: string; why: string }; closes?: number[]; /** ADR 0014: the acceptance tests written first and frozen before the fix session; the reviewer reads these separately from the fix. */ frozenTests?: string[]; /** Test files the fix session added after the freeze: unreviewed, never part of the acceptance evidence. */ unreviewedTests?: string[] }
export function validatePrBody(b: PrBody): string | null {
  if (!b.scope.trim()) return 'scope is required'; if (!b.approach.trim()) return 'approach is required';
  if (!b.evidence.length || b.evidence.some((e) => !e.trim())) return 'verification evidence is required';
  if (!b.attribution.aiAssisted || !b.attribution.model.trim() || !b.attribution.harness.trim()) return 'AI attribution (model and harness) is required';
  if (!b.danger.blastRadius.trim() || !b.danger.why.trim()) return 'Merge Danger needs a blast radius and a reason for the door type';
  return null;
}
export function renderPrBody(b: PrBody): string {
  const bad = validatePrBody(b); if (bad) throw new Error(`cannot render PR body: ${bad}`);
  return ['> AI-assisted change proposed by an automated factory. A human or the configured merge gates decide; nothing here claims a review or a merge.', '',
    `**Scope:** ${b.scope}`, '', `**Approach:** ${b.approach}`, '', '**Evidence:**', ...b.evidence.map((e) => `- ${e}`), '',
    ...(b.frozenTests?.length ? ['**Frozen acceptance tests** (written in a separate session before the fix; the fix session could not change them):', ...b.frozenTests.map((t) => `- ${t}`), ''] : []),
    ...(b.unreviewedTests?.length ? ['**Tests added by the fix session** (unreviewed; not part of the acceptance evidence):', ...b.unreviewedTests.map((t) => `- ${t}`), ''] : []),
    `**Merge Danger:** ${b.danger.door} door. ${b.danger.why} Blast radius: ${b.danger.blastRadius}`, '',
    `**Attribution:** model ${b.attribution.model} via ${b.attribution.harness}.${b.attribution.credited?.length ? ` Builds on work by ${b.attribution.credited.map((c) => '@' + c).join(', ')}.` : ''}`,
    ...(b.closes?.length ? ['', ...b.closes.map((n) => `Refs #${n} (the issue is resolved only after the merged scope is confirmed).`)] : [])].join('\n');
}
