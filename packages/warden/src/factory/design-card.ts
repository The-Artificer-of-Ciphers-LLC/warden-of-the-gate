import type { IssueState } from '../github/store.ts';
import type { Ledger } from '../state/model.ts';
import { boundaryHits, DEFAULT_BOUNDARY_CLASSES } from '../verify/boundary.ts';

/** ADR 0015 owner ruling 2026-11-25: when planned work will cross a boundary class, Warden brings a PROPOSED DESIGN to the maintainer before building, and builds on the answers. MVP fidelity (ruled 2026-11-28):
 *  one local card, a deterministic decision matrix (a few options side by side with their trade-offs and Warden's recommendation, each answerable with one pick), no model session and so no new budget. What the work
 *  will cross is read from the issue text only: file paths it names that fall in a boundary class (strong evidence) and class keywords (weak evidence). It is a heuristic by design: a wrong guess costs one pick. */
export interface Likely { class: string; strong: string[]; weak: string[] }
export const DESIGN_PICKS = ['proceed', 'narrow', 'decline'] as const;
export type DesignPick = (typeof DESIGN_PICKS)[number];
const KEYWORDS: Record<string, RegExp> = {
  'public-interface': /\b(public api|api contract|endpoint|openapi|swagger|graphql|protobuf|breaking change|exported (function|interface|type))\b/i,
  'database-schema': /\b(migration|database schema|db schema|alter table|new table|drop table|column)\b/i,
  'auth-secrets': /\b(authentication|authorization|login|password|secret|credential|api key|token|permission|oauth)\b/i,
  dependency: /\b(new dependency|add (a |the )?(library|package|dependency)|upgrade (to )?(v|version )?\d|major version|bump)\b/i,
  'verification-ci': /\b(ci workflow|github actions|test runner|jest config|lint(er)? config|coverage threshold|stryker)\b/i,
  'external-effect': /\b(release|publish(ing)?|deploy(ment)?|docker image|npm publish|tag a version|production)\b/i,
};
const PATHISH = /(?:[\w.\-]+\/)*[\w.\-]+\.[A-Za-z0-9]{1,8}\b|(?:[\w.\-]+\/)+/g;

export function likelyClasses(issue: Pick<IssueState, 'title' | 'body'>, classes: Readonly<Record<string, readonly string[]>> = DEFAULT_BOUNDARY_CLASSES): Likely[] {
  const text = `${issue.title}\n${issue.body ?? ''}`; const paths = [...new Set(text.match(PATHISH) ?? [])].slice(0, 60);
  const strong = new Map<string, string[]>(); for (const h of boundaryHits(paths.map((p) => ({ path: p, status: 'modified' })), Object.fromEntries(Object.entries(classes).filter(([k]) => k !== 'file-removal')))) strong.set(h.class, [...new Set([...(strong.get(h.class) ?? []), h.path])]);
  const out: Likely[] = [];
  for (const k of Object.keys(classes)) { if (k === 'file-removal' || k === 'shared-component') { const s = strong.get(k); if (s) out.push({ class: k, strong: s.slice(0, 4), weak: [] }); continue; }
    const m = text.match(KEYWORDS[k] ?? /$^/); const s = strong.get(k) ?? []; if (s.length || m) out.push({ class: k, strong: s.slice(0, 4), weak: m ? [m[0].toLowerCase()] : [] }); }
  return out;
}

/** The recommendation is a fixed rule, not a judgment: named files in a class => proceed through the maintainer gate (the work plainly crosses it); keyword-only => narrow (the scope probably can avoid it);
 *  an external effect is never recommended to proceed unseen. */
export function recommend(l: Likely): DesignPick { return l.class === 'external-effect' ? 'narrow' : l.strong.length ? 'proceed' : 'narrow'; }

export function renderDesignCard(o: { repo: string; issue: IssueState; ledger?: Ledger; classes?: Readonly<Record<string, readonly string[]>> }): string {
  const likely = likelyClasses(o.issue, o.classes); const done = o.ledger?.designDecisions ?? {}; const url = `https://github.com/${o.repo}/issues/${o.issue.number}`; const out: string[] = [];
  out.push(`# Proposed design: issue #${o.issue.number} ${o.issue.title.slice(0, 100)}`, '');
  if (!likely.length) return out.concat(['Nothing in the issue points at a boundary class, so no design decision is asked. If the work turns out to cross one, the merge gate still stops at your decision.']).join('\n');
  out.push(`The issue's text points at ${likely.length} boundary class(es). Decide each with one pick on GitHub (${url}); Warden builds on your answers and does not start this work until each is answered.`, '', '> Read from the issue text only, by fixed rules: a wrong guess costs you one pick.', '');
  likely.forEach((l, n) => {
    const rec = recommend(l); const d = done[l.class];
    out.push(`## Question ${n + 1}: ${l.class}`, l.strong.length ? `Named in the issue: ${l.strong.join(', ')}.` : `Mentioned in the issue: "${l.weak.join('", "')}" (no file named).`, '',
      '| Pick | What happens | Trade-off |', '|---|---|---|',
      `| proceed${rec === 'proceed' ? ' (recommended)' : ''} | Warden builds the change as designed. It is a one-way door: it still needs your approval before merge. | Fastest; the change may touch ${l.class} for real. |`,
      `| narrow${rec === 'narrow' ? ' (recommended)' : ''} | Warden builds but is told to stay out of ${l.class}; a change that touches it anyway is rejected. | Safer; the issue may not be fully solvable inside that limit. |`,
      '| decline | Warden does not build this issue. | Nothing risked; the issue waits for a person. |', '',
      d ? `Answered: **${d.pick}** by ${d.by}.` : `Answer with: \`/warden design ${l.class} proceed\`, \`/warden design ${l.class} narrow\` or \`/warden design ${l.class} decline\``, '');
  });
  out.push('This card is a local draft and grants nothing.'); return out.join('\n');
}
