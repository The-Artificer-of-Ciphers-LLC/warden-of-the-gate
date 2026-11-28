/** ADR 0028: an output rule is written once. One entry holds the rule's text as the prompt shows it, its hard limit (the JSON Schema is built from it),
 *  a soft target only where the prompt deliberately aims below the hard limit, and its check. The prompt, the schema and the post-schema checks are all
 *  read from the entry, so they cannot disagree. A rule no code can check says so with `judgment`; a rule whose whole check is the schema limit says `schema`.
 *  `R` is what a failing check returns (a reason string, or a reason with the notice the card shows). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Rule<T = any, C = any, R = any> {
  id: string;
  /** As the prompt shows it. A function states the limit (the target if there is one, else the hard limit). `null`: stated by a mode-specific paragraph of the prompt, not as a standalone sentence. */
  text: string | ((limit: number) => string) | null;
  hard?: number; target?: number;
  check: ((out: T, ctx: C) => R | null) | 'schema' | 'judgment';
}
export const limitOf = (r: Pick<Rule, 'hard' | 'target'>): number | undefined => r.target ?? r.hard;
export const stated = (r: Rule): string => typeof r.text === 'function' ? r.text(limitOf(r) as number) : r.text ?? '';
/** The rendered rules, in order, ready for the prompt. Rules stated elsewhere (`text: null`) are left out. */
export const renderRules = (rules: readonly Rule[], sep = '\n'): string => rules.filter((r) => r.text !== null).map(stated).join(sep);

/** Problems with a table, or []. Run by a test, so a rule cannot land without a check or the judgment mark. */
export function auditTable(rules: readonly Rule[]): string[] {
  const bad: string[] = []; const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) bad.push(`duplicate id ${r.id}`); seen.add(r.id);
    if (typeof r.check !== 'function' && r.check !== 'schema' && r.check !== 'judgment') bad.push(`${r.id}: no check (give a check, 'schema' or 'judgment')`);
    if (r.check === 'schema' && r.hard === undefined) bad.push(`${r.id}: marked schema but has no hard limit`);
    if (r.target !== undefined && (r.hard === undefined || r.target > r.hard)) bad.push(`${r.id}: target ${r.target} is above hard ${r.hard}`);
    if (typeof r.text === 'function' && limitOf(r) === undefined) bad.push(`${r.id}: text states a limit but the rule has none`);
  }
  return bad;
}
