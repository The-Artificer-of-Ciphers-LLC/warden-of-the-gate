import { evaluate } from '../config/policy.ts';
import type { PolicySnapshot } from '../config/snapshot.ts';
import type { Change } from '../git/workspace.ts';
import { detectWeakening } from '../verify/executor.ts';
import type { Weakening } from '../verify/executor.ts';

/** Refusals shared by Implement and Rework: the model's change is vetted by deterministic rules BEFORE any evidence is gathered or anything is published.
 *  A pull request can never authorize its own edits to authority paths; weakened gates and oversize diffs are refused whole. */
export interface VetOpts { changes: Change[]; policy: PolicySnapshot; task: 'implement' | 'rework'; kind: string; risk?: 'low' | 'medium' | 'high' | 'uncertain'; maxFiles?: number; maxPatchChars?: number }
export type Vet = { ok: true } | { ok: false; reason: 'no-change' | 'diff-too-large' | 'authority-path-touched' | 'gate-weakening'; notice: string; weakening?: Weakening[] };
export function vetChanges(o: VetOpts): Vet {
  const ch = o.changes; if (!ch.length) return { ok: false, reason: 'no-change', notice: 'The session changed nothing.' };
  if (ch.length > (o.maxFiles ?? 40) || ch.reduce((a, x) => a + x.patch.length, 0) > (o.maxPatchChars ?? 200_000)) return { ok: false, reason: 'diff-too-large', notice: 'The change is larger than the factory may open as one pull request: it must be split.' };
  const auth = evaluate(o.policy.orders, { task: o.task, kind: o.kind, paths: ch.map((x) => x.path), origin: 'factory', risk: o.risk ?? 'uncertain' }).reasons.find((r) => /authority\/workflow\/access paths/.test(r));
  if (auth) return { ok: false, reason: 'authority-path-touched', notice: `The change touches authority, workflow or access paths, which a pull request can never authorize for itself: ${auth}` };
  const weak = detectWeakening(ch.filter((x) => x.status !== 'D').map((x) => ({ path: x.path, patch: x.patch })), ch.filter((x) => x.status === 'D').map((x) => x.path));
  if (weak.length) return { ok: false, reason: 'gate-weakening', notice: `Possible gate weakening was detected: ${weak.map((w) => `${w.kind} in ${w.path}`).join('; ')}.`, weakening: weak };
  return { ok: true };
}
