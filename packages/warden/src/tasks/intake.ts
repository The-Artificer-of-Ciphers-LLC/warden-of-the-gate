/** Deterministic intake decision. Pure: the same function feeds the dry-run proposal AND the writer's decision-time re-check, so a
 *  planned intake cannot drift from what the writer enforces. It checks metadata only: similarity/duplicates and templates are NOT
 *  decided here (a flag is never a semantic duplicate, and template/route checks are unbuilt: see handoff). */
export interface IntakeItem { title: string; body: string; isPr: boolean; draft?: boolean }
export interface IntakeDecision { to: 'needs-triage' | 'needs-info' | 'needs-review'; reasons: string[]; effects: string[]; needsInfo: boolean }

export function decideIntake(it: IntakeItem, o: { draftsAllowed: boolean }): IntakeDecision {
  const reasons: string[] = []; const effects: string[] = [];
  if (it.isPr) {
    reasons.push('new PR enters review queue');
    if (it.draft && !o.draftsAllowed) { reasons.push('draft PR while drafts are disallowed'); effects.push('(P2) close with explanation and ready-for-review return path; not performed in dry-run'); }
    return { to: 'needs-review', reasons, effects, needsInfo: false };
  }
  if (!it.body.trim() || it.title.trim().length < 5) { reasons.push('missing required information (empty body or title too short)'); effects.push('(P2) request information from the reporter'); return { to: 'needs-info', reasons, effects, needsInfo: true }; }
  reasons.push('metadata present; queue semantic triage');
  return { to: 'needs-triage', reasons, effects, needsInfo: false };
}
