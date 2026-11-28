import { createHash } from 'node:crypto';
import { SEVERITIES } from './schema.ts';
import type { Finding, Severity } from './schema.ts';
import type { PullFile } from '../github/store.ts';

/** PRD section 5 Review [R]: each finding gets a stable fingerprint (rule, anchor, normalized location) so a repeated finding is recognised instead of duplicated; findings per review are
 *  capped (configurable) and ranked by severity while the ledger keeps the full list; every inline position is validated against the reviewed diff before anything is posted inline. */
export const DEFAULT_MAX_POSTED_FINDINGS = 10;

/** The new-file line numbers a unified diff shows (context and added lines), mapped to the line's text. Deleted lines have no new-file number. */
export function diffLines(patch: string | undefined): Map<number, string> {
  const out = new Map<number, string>(); if (!patch) return out;
  let n = 0;
  for (const raw of patch.split('\n')) {
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { n = Number(h[1]); continue; }
    if (n === 0) continue;                                   // before the first hunk
    if (raw.startsWith('-') || raw.startsWith('\\')) continue; // deleted line, or "\ No newline at end of file"
    out.set(n, raw.startsWith('+') || raw.startsWith(' ') ? raw.slice(1) : raw); n++;
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** The model's id with every trailing counter removed: "race-1", "race-2" and "race-2-3" are the same rule; an id that is only digits keeps itself. */
export const ruleOf = (id: string) => id.toLowerCase().replace(/([-_]?\d+)+$/, '') || id.toLowerCase();

/** Fingerprint = rule + path + the anchor line's text (whitespace-normalised), not its number: the same finding on the same code survives a line shift. When the line is not in the diff the
 *  anchor is the number itself, so such a finding still gets a stable, if less shift-proof, identity. */
export function fingerprint(f: Pick<Finding, 'id' | 'path' | 'line'>, files: readonly PullFile[]): string {
  const patch = files.find((x) => x.path === f.path)?.patch; const text = diffLines(patch).get(f.line);
  const anchor = text !== undefined && norm(text) ? 'text:' + norm(text) : 'line:' + f.line;
  return createHash('sha256').update([ruleOf(f.id), f.path, anchor].join('\n')).digest('hex').slice(0, 16);
}

/** True when GitHub could place a review comment at this path and line (the line is part of the diff). */
export const isInlineable = (f: Pick<Finding, 'path' | 'line'>, files: readonly PullFile[]): boolean => diffLines(files.find((x) => x.path === f.path)?.patch).has(f.line);

const RANK = new Map<Severity, number>(SEVERITIES.map((s, i) => [s, i]));
/** Fingerprints and inline flags on a review's findings; a second finding with the same fingerprint is the same finding, and the more severe one is kept. The full result stays in the ledger. */
export function annotate(findings: readonly Finding[], files: readonly PullFile[]): Finding[] {
  const byFp = new Map<string, Finding>(); const order: string[] = [];
  for (const f of findings) {
    const fp = fingerprint(f, files); const cur = byFp.get(fp);
    const next: Finding = { ...f, fingerprint: fp, inline: isInlineable(f, files) };
    if (!cur) { byFp.set(fp, next); order.push(fp); } else if ((RANK.get(next.severity) ?? 9) < (RANK.get(cur.severity) ?? 9)) byFp.set(fp, next);
  }
  return order.map((fp) => byFp.get(fp)!);
}

/** What one review shows: the most severe findings first (ties keep the model's order), at most `cap`; `omitted` counts the rest, which stay in the ledger. */
export function capFindings(findings: readonly Finding[], cap = DEFAULT_MAX_POSTED_FINDINGS): { shown: Finding[]; omitted: number } {
  const ranked = findings.map((f, i) => ({ f, i })).sort((a, b) => (RANK.get(a.f.severity)! - RANK.get(b.f.severity)!) || (a.i - b.i)).map((x) => x.f);
  const n = Math.max(0, Math.floor(cap)); return { shown: ranked.slice(0, n), omitted: Math.max(0, ranked.length - n) };
}
