import type { PullFile } from '../github/store.ts';
import type { Finding } from './schema.ts';
import { diffLines } from './findings.ts';
import { detectWeakening } from '../verify/executor.ts';
import { DEFAULT_TEST_PATHS } from '../verify/frozen.ts';

/** ADR 0015: Review checks the test diff against ONE list (the same detector the decision card uses): deleted or weakened assertions, skips and focus, widened tolerances and timeouts, regenerated snapshots, changed
 *  runner or mutation configuration, tests moved out of the test paths. Each hit is a deterministic finding with a location (owner ruling: `major`, so it gates a merge under the default gates, and a maintainer can
 *  dismiss it like any finding). They are recomputed from the diff on every review and are never asked of the model. */
/** The detector's kinds that belong to ADR 0015's test-diff list; authority-path, lint, type and CI changes are other gates' business. */
const SCAN_KINDS = new Set(['skipped-test', 'removed-assertions', 'test-removed', 'focused-test', 'tolerance-widened', 'timeout-raised', 'snapshot-changed', 'test-config-changed', 'test-moved', 'threshold-lowered']);
export const SCAN_PREFIX = 'test-scan-';
export const MUTATION_PREFIX = 'mutation-';
/** Deterministic findings Warden computes itself (the test-diff scan and surviving mutants): recomputed every review, never asked of the model, never counted in replay's model metrics. */
export const isScanFinding = (f: Pick<Finding, 'id'>): boolean => f.id.startsWith(SCAN_PREFIX) || f.id.startsWith(MUTATION_PREFIX);
export function scanFindings(files: readonly PullFile[], testGlobs: readonly string[] = DEFAULT_TEST_PATHS): Finding[] {
  const removed = files.filter((f) => f.status === 'removed' || f.status === 'D' || f.status === 'deleted').map((f) => f.path);
  const live = files.filter((f) => !removed.includes(f.path));
  const hits = detectWeakening(live.map((f) => ({ path: f.path, patch: f.patch ?? '' })), removed, testGlobs).filter((w) => SCAN_KINDS.has(w.kind));
  const seen = new Map<string, number>();
  return hits.map((w) => {
    const patch = files.find((f) => f.path === w.path)?.patch; const lines = diffLines(patch); const added = patch ? patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')) : [];
    const needle = w.detail.split(' -> ')[0].trim().slice(0, 40); let line = 1; for (const [n, t] of lines) if (needle && t.includes(needle) && added.some((a) => a.slice(1) === t)) { line = n; break; }
    if (line === 1 && lines.size) line = [...lines.keys()][0];
    const k = `${w.kind}`; const idx = (seen.get(k) ?? 0) + 1; seen.set(k, idx);
    return { id: `${SCAN_PREFIX}${w.kind}-${idx}`, severity: 'major' as const, path: w.path, line, rationale: `Test-diff scan (${w.kind}): ${w.detail}`.slice(0, 280), correction: 'Restore the original strength of the test or configuration, or have the issue state why it must change.' };
  });
}
