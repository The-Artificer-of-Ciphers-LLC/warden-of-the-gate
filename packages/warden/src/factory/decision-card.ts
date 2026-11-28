import type { IssueState, PullInfo } from '../github/store.ts';
import type { Ledger } from '../state/model.ts';
import type { Finding } from '../review/schema.ts';
import { boundaryClassesOf, boundaryHits, DEFAULT_BOUNDARY_CLASSES } from '../verify/boundary.ts';
import { detectWeakening } from '../verify/executor.ts';
import { DEFAULT_TEST_PATHS, isTestPath } from '../verify/frozen.ts';
import { provenanceText } from '../runner/provenance.ts';
import type { Provenance } from '../runner/provenance.ts';

/** ADR 0015: what the maintainer reads to decide on implementation work. The contract comes first (the spec, the acceptance criteria, the frozen test diff, the executor's fail-on-base result), then the
 *  scan of the test diff for the known cheats, then risk, findings and evidence. The implementation diff is LINKED, and shown inline only for the files that make it a boundary change. Pure rendering from
 *  facts the caller read; the card is local output and posts nothing. Issue text and patches are untrusted data and are shown fenced and clipped. */
export interface CardInput {
  repo: string; pr: PullInfo; ledger: Ledger; issue?: IssueState; findings?: Finding[]; boundaries?: Record<string, readonly string[]>; testGlobs?: readonly string[];
}
const fence = (text: string, n: number): string => { const body = text.length > n ? text.slice(0, n) + '\n... (clipped)' : text; let f = '```'; while (body.includes(f)) f += '`'; return `${f}\n${body}\n${f}`; };
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

/** Acceptance criteria as the issue states them: checklist lines, or the lines under an "Acceptance criteria" heading. Nothing is invented when it states none. */
export function criteriaOf(body: string): string[] {
  const lines = body.split('\n'); const out: string[] = []; let under = false;
  for (const raw of lines) { const l = raw.trim();
    if (/^#{1,6}\s*acceptance( criteria)?\s*:?$/i.test(l) || /^acceptance criteria:?$/i.test(l)) { under = true; continue; }
    if (under && /^#{1,6}\s/.test(l)) under = false;
    if (/^[-*]\s*\[[ xX]\]\s+\S/.test(l)) out.push(l.replace(/^[-*]\s*\[[ xX]\]\s+/, ''));
    else if (under && /^[-*]\s+\S/.test(l)) out.push(l.replace(/^[-*]\s+/, '')); }
  return out.slice(0, 12).map((x) => clip(x, 200));
}

export function renderDecisionCard(i: CardInput): string {
  const globs = i.testGlobs ?? DEFAULT_TEST_PATHS; const l = i.ledger; const files = i.pr.files;
  const hits = boundaryHits(files, i.boundaries ?? DEFAULT_BOUNDARY_CLASSES); const classes = boundaryClassesOf(hits);
  const url = `https://github.com/${i.repo}/pull/${i.pr.number}`; const out: string[] = [];
  out.push(`# Decision card: PR #${i.pr.number} ${clip(i.pr.title, 100)}`, '', classes.length ? `**One-way door.** This change touches a boundary class (${classes.join(', ')}), so it needs your decision whatever else passes.` : '**Two-way door.** It touches no configured boundary class.', '');
  out.push('## 1. The spec');
  if (i.issue) out.push(`Issue #${i.issue.number}: ${clip(i.issue.title, 140)}`, '', fence(i.issue.body || '(empty)', 1500)); else out.push('No linked issue is recorded for this pull request: there is no spec to read the change against.');
  out.push('', '## 2. Acceptance criteria'); const crit = criteriaOf(i.issue?.body ?? ''); out.push(...(crit.length ? crit.map((c) => `- ${c}`) : ['The issue states none as a checklist or under an "Acceptance criteria" heading, so none are shown. They were not invented.']));
  out.push('', '## 3. The frozen test diff');
  if (l.frozen?.files.length) {
    out.push(`Frozen after the test session at base ${l.frozen.baseCommit.slice(0, 12)}; the fix session could not change these.`);
    for (const f of l.frozen.files) { const p = files.find((x) => x.path === f.path); out.push('', `**${f.path}** (sha256 ${f.sha256.slice(0, 12)})`, p?.patch ? fence(p.patch, 1500) : '(not in this pull request\'s diff at its current head)'); }
  } else out.push('No freeze is recorded for this pull request (opened before the freeze existed, or not a factory pull request): the contract cannot be shown here.');
  out.push('', '## 4. Fail-on-base result');
  out.push(...(l.frozenResult?.length ? [`The frozen tests on the unchanged base: ${l.frozenResult.map((r) => `${r.check} exit ${r.exit}`).join('; ')} (a bug's tests must fail there).`] : ['Not recorded for this pull request.']));
  const testFiles = files.filter((f) => isTestPath(f.path, globs)); const scan = detectWeakening(testFiles.map((f) => ({ path: f.path, patch: f.patch ?? '' })), files.filter((f) => f.status === 'removed' || f.status === 'D').map((f) => f.path), globs);
  out.push('', '## 5. Test-diff scan', ...(scan.length ? scan.map((w) => `- ${w.kind} in ${w.path}: ${clip(w.detail, 120)}`) : [`No hits in ${testFiles.length} test file(s) against the list (deleted or weakened assertions, skips and focus, widened tolerances and timeouts, snapshots, runner configuration, tests moved out of the test paths).`]));
  const r = l.review; const fs = (i.findings ?? []).slice(0, 10);
  out.push('', '## 6. Risk, findings and evidence', `Risk: ${l.facets.risk ?? 'uncertain'}. Work kind: ${String(l.facets.workKind ?? 'unknown')}. Workflow state: ${l.state}.`);
  out.push(r ? `Accepted review of head ${r.head.slice(0, 8)}${r.head === i.pr.head ? '' : ' (OLDER than the current head)'}: ${r.verdict}; open severities: ${r.severities.length ? r.severities.join(', ') : 'none'}.${r.provenance ? ` Reviewer: ${provenanceText(r.provenance as Provenance)}.` : ''}` : 'No accepted review is recorded.');
  if (fs.length) out.push(...fs.map((f) => `- [${f.severity}] ${f.path}:${f.line} ${clip(f.rationale, 200)}`));
  out.push(`Required checks: ${i.pr.ci}.`, '', '## 7. The implementation');
  out.push(`Linked, not inlined: ${url}/files`);
  if (classes.length) { out.push('', 'Shown here because they make it a boundary change:'); for (const h of hits.slice(0, 5)) { const p = files.find((x) => x.path === h.path); out.push('', `**${h.path}** (${h.class}: ${h.why})`, p?.patch ? fence(p.patch, 2000) : '(no patch text)'); } if (hits.length > 5) out.push('', `... and ${hits.length - 5} more boundary file(s) in the diff.`); }
  out.push('', `Decide on GitHub: \`/warden approve <approval id> bind=<digest>\` or \`/warden deny ...\` on ${url}. This card is a local draft and grants nothing.`);
  return out.join('\n');
}
