import type { PullInfo } from '../github/store.ts';
import type { Ledger } from '../state/model.ts';
import type { PolicySnapshot } from '../config/snapshot.ts';
import { evaluate } from '../config/policy.ts';
import { checkAuthorized } from '../approvals/approvals.ts';

/** P4 merge eligibility: a PURE decision from current facts. It never merges anything: it says merge / wait / escalate / block with reasons.
 *  Mandatory rules (not weakenable by configuration): blocker findings always gate; high or uncertain risk, workflow/access/maintainer/standing-order
 *  paths, wontfix and a PR authorizing itself need a maintainer; a draft never merges; stop and holds block; origin comes from the verified author
 *  identity, never from a label; a second model session is not an independent GitHub identity. */
export interface GatesCfg { blocker: true; major: boolean; minor: boolean; nit: boolean }
export interface BranchRules { requiredApprovals: number; approvals: Array<{ login: string }>; appLogin?: string; factoryLogins?: string[] }
export interface MergeInput {
  ledger: Ledger; pull: PullInfo; review: { head: string; policyDigest?: string; severities: Array<'blocker' | 'major' | 'minor' | 'nit'> } | null; gates: GatesCfg; policy: PolicySnapshot; rules: BranchRules;
  automationLogins: string[]; hold: boolean; stopped: boolean; now: number; policyDigest: string;
  dependency?: { breakingMajor?: boolean; migration?: boolean; verifiedAdvisory?: boolean };
}
export type MergeVerdict = { action: 'merge'; origin: Origin; via: 'standing-order' | 'maintainer-approval'; approvalId?: string } | { action: 'wait' | 'escalate' | 'block'; reasons: string[]; origin: Origin };
export type Origin = 'contributor' | 'factory' | 'automation';

/** Origin from the VERIFIED author identity. Labels and PR text are contributor-controlled and never consulted. */
export function originOf(pull: PullInfo, automationLogins: string[], rules: BranchRules): Origin {
  if ((rules.factoryLogins ?? []).includes(pull.author) || (rules.appLogin && pull.author === rules.appLogin)) return 'factory';
  return automationLogins.includes(pull.author) ? 'automation' : 'contributor';
}

export function evaluateMerge(i: MergeInput): MergeVerdict {
  const origin = originOf(i.pull, i.automationLogins, i.rules); const block: string[] = []; const wait: string[] = []; const esc: string[] = [];
  const { pull, ledger: l, review: m } = i;
  if (pull.state !== 'open') block.push('pull request is not open');
  if (pull.draft) block.push('a draft never merges');
  if (i.stopped) block.push('stop is in force');
  if (i.hold || l.obligations.some((o) => o.hold)) block.push('a maintainer hold is in force');
  if (l.state !== 'merge-ready') block.push(`workflow state is ${l.state}, not merge-ready`);
  if (!m) wait.push('no accepted review');
  else if (m.head !== pull.head) wait.push('the accepted review is for an older head');
  else if (m.policyDigest && m.policyDigest !== i.policyDigest) wait.push('the accepted review predates the current policy');
  if (m && m.head === pull.head) {
    const open = m.severities;
    if (open.includes('blocker')) block.push('an open blocker finding always gates merge');
    for (const sev of ['major', 'minor', 'nit'] as const) if (i.gates[sev] && open.includes(sev)) block.push(`an open ${sev} finding gates merge (configured gate on)`);
  }
  if (pull.ci !== 'passing') wait.push(`required checks are ${pull.ci}`);
  const risk = l.facets.risk ?? 'uncertain';                      // missing risk is uncertain, never low
  const paths = pull.files.map((f) => f.path);
  const kind = (l.facets.workKind as string | undefined) ?? (origin === 'automation' ? 'dependency' : undefined);
  const dep = origin === 'automation' ? i.dependency : undefined;
  if (origin === 'automation' && (dep?.breakingMajor || dep?.migration)) esc.push('breaking major or migration in an automation PR cannot bypass escalation');
  if (origin === 'automation' && kind === 'dependency' && dep && !dep.verifiedAdvisory && !dep.breakingMajor && !dep.migration) { /* ordinary verified-origin dependency update: standing orders decide */ }
  const pol = evaluate(i.policy.orders, { task: 'merge', kind, paths, origin, risk });
  let via: 'standing-order' | 'maintainer-approval' = 'standing-order'; let approvalId: string | undefined;
  if (pol.decision === 'deny') block.push(...pol.reasons);
  else if (pol.decision === 'human' || esc.length) {
    esc.push(...(pol.decision === 'human' ? pol.reasons : []));
    const a = checkAuthorized(l, 'merge', i.policy, i.now);
    if (a.ok && !esc.some((r) => /breaking major|migration/.test(r))) { via = 'maintainer-approval'; approvalId = a.approval.id; esc.length = 0; }
    else esc.push(a.ok ? 'maintainer approval does not cover a breaking major or migration' : `maintainer approval required (${a.reason})`);
  }
  // Independence: a required GitHub approval must come from a human identity other than the author, the App and the factory identities.
  const independent = i.rules.approvals.filter((a) => a.login !== pull.author && a.login !== i.rules.appLogin && !(i.rules.factoryLogins ?? []).includes(a.login));
  if (i.rules.requiredApprovals > independent.length) esc.push(`required GitHub approvals ${i.rules.requiredApprovals}, independent approvals ${independent.length}: a second model session is not an independent identity and branch rules are never bypassed`);
  if (block.length) return { action: 'block', reasons: block, origin };
  if (esc.length) return { action: 'escalate', reasons: esc, origin };
  if (wait.length) return { action: 'wait', reasons: wait, origin };
  return { action: 'merge', origin, via, approvalId };
}

/** What a merge request is BOUND to. Enqueueing is not merging: delivery re-reads the world and compares. */
export interface MergeBinding { item: number; expectedHead: string; policyDigest: string; evidenceDigest?: string; approvalId?: string }
export function bindingFor(i: MergeInput, v: Extract<MergeVerdict, { action: 'merge' }>): MergeBinding {
  return { item: i.ledger.item, expectedHead: i.pull.head, policyDigest: i.policyDigest, evidenceDigest: i.ledger.evidence.evidenceDigest, approvalId: v.approvalId };
}
/** At delivery time: the request is stale if anything it was bound to changed, or the verdict is no longer merge. */
export function deliverable(b: MergeBinding, now: MergeInput): { ok: true } | { ok: false; reason: string } {
  if (now.pull.head !== b.expectedHead) return { ok: false, reason: `stale: head moved ${b.expectedHead.slice(0, 8)} -> ${now.pull.head.slice(0, 8)}` };
  if (now.policyDigest !== b.policyDigest) return { ok: false, reason: 'stale: approved policy changed' };
  if (b.evidenceDigest !== undefined && now.ledger.evidence.evidenceDigest !== b.evidenceDigest) return { ok: false, reason: 'stale: evidence changed' };
  const v = evaluateMerge(now);
  return v.action === 'merge' ? { ok: true } : { ok: false, reason: `no longer eligible: ${v.reasons.join('; ')}` };
}
