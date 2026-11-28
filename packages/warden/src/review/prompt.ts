import type { PullInfo } from '../github/store.ts';
import type { Finding } from './schema.ts';
import { stated } from '../rules/table.ts';
import { REVIEW_LIMITS, REVIEW_RULES } from './rules.ts';

/** Task part of the review prompt (the adapter appends the output contract and the JSON Schema). Contributor content is data, never instructions. */
/** `context`: the rendered repository context pack (src/review/context.ts), placed after the patches so the change is read first. */
/** `fullBecause`: a full review of a pull request that already had a review (trusted policy files changed). Earlier findings are still re-checked. */
export function buildReviewPrompt(pull: PullInfo, mode: 'full' | 'delta', since: string | null, prior: Finding[], repo = false, context?: string, fullBecause?: string): string {
  const patches = pull.files.map((f, i) => `=== FILE ${i}: ${f.path} (${f.status}) ===\n${f.patch || '(no patch text available)'}`).join('\n\n');
  const r = (id: string) => stated(REVIEW_RULES.find((x) => x.id === id)!);   // every rule sentence below is read from the table (ADR 0028)
  return [
    r('reviewer-role'), r('real-defects'), r('cite-path-and-line'),
    `${r('method')} ${stated(REVIEW_LIMITS.findings)}`,
    ...(repo ? ['The repository as it was BEFORE this change is under ./repo (read-only). Use the read and list tools there to look at the code around each change: callers, callees, tests, the definitions it relies on. Use them sparingly (a few targeted reads, not a tour), then answer. The patches are also in ./patches. A file marked (added) in the packet is NEW in this change, so it is not in ./repo; never say an added file already exists, is duplicated, or conflicts with the base unless you have just listed its directory under ./repo and seen that exact path there.'] : []),
    `Limits (a reply that breaks them is thrown away): ${[r('line-in-new-file'), stated(REVIEW_LIMITS.rationale), stated(REVIEW_LIMITS.correction)].join('; ')}.`,
    `Rules: ${r('verdict-matches-findings')} ${r('unique-ids')}`,
    mode === 'delta' ? `This is a DELTA review: the pull request changed since ${since}. These earlier findings must each be re-checked: ${JSON.stringify(prior)}. Add a "revalidated" array with one entry {"id","status":"open"|"resolved"} for EVERY earlier finding id, and list still-open ones again in "findings".`
      : fullBecause ? `This is a FULL review of every changed line, not a delta: ${fullBecause}. The pull request changed since ${since}.${prior.length ? ` These earlier findings must also each be re-checked: ${JSON.stringify(prior)}. Add a "revalidated" array with one entry {"id","status":"open"|"resolved"} for EVERY earlier finding id, and list still-open ones again in "findings".` : ''}`
      : 'This is a first review.',
    `PULL REQUEST #${pull.number}: ${pull.title}`, `base ${pull.base} head ${pull.head}`, 'FILES AND PATCHES:', patches,
    ...(context ? ['', context] : []),
  ].join('\n');
}
