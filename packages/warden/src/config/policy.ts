import type { Orders, Program, WardenConfig } from './load.ts';
import type { AuthorityCeiling } from '../credentials/types.ts';

/** Paths whose change always needs a maintainer decision (workflow/access/maintainer/standing-order/self-authority). Mandatory, not configurable. */
export const HUMAN_GATE_PATHS = ['.github/workflows/**', '.github/warden.yml', '.github/ORDERS.yaml', '.github/CODEOWNERS', 'MAINTAINERS', 'MAINTAINERS.md', '.github/MAINTAINERS', 'CODEOWNERS'];

export function globToRe(g: string): RegExp {
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp('^' + esc + '$');
}
export const matchesAny = (path: string, globs: string[] = []) => globs.some((g) => globToRe(g).test(path));

export interface ActionQuery { task: string; kind?: string; paths?: string[]; origin?: 'contributor' | 'factory' | 'automation'; risk?: 'low' | 'medium' | 'high' | 'uncertain'; wontfix?: boolean }
export interface PolicyDecision { decision: 'allow' | 'deny' | 'human'; reasons: string[]; matched: string[] }

const covers = (p: Program, q: ActionQuery): boolean => {
  if (!p.tasks.includes(q.task)) return false;
  const s = p.scope;
  if (s?.kinds && (!q.kind || !s.kinds.includes(q.kind))) return false;
  if (s?.origins && (!q.origin || !s.origins.includes(q.origin))) return false;
  if (s?.paths && !(q.paths?.length && q.paths.every((x) => matchesAny(x, s.paths)))) return false;
  if (s?.maxRisk) { const order = ['low', 'medium']; if (!q.risk || !order.includes(q.risk) || order.indexOf(q.risk) > order.indexOf(s.maxRisk)) return false; }
  if (p.exclusions?.kinds && q.kind && p.exclusions.kinds.includes(q.kind)) return false;
  if (p.exclusions?.paths && q.paths?.some((x) => matchesAny(x, p.exclusions!.paths))) return false;
  return true;
};

/** Effective-policy evaluation (ADR 0010). Order: mandatory platform constraints, then the operator ceiling (callers pass only
 *  ceiling-valid tasks), then approved standing orders. Within orders: deny > require-approval > allow. No match => human (narrow by default).
 *  `policySource` must be the DEFAULT BRANCH snapshot: a PR's proposed policy is never evaluated for that PR. */
export function evaluate(orders: Orders, q: ActionQuery): PolicyDecision {
  const reasons: string[] = []; const matched: string[] = [];
  if (q.wontfix) return { decision: 'human', reasons: ['wontfix is a maintainer decision (mandatory)'], matched };
  if (q.risk === 'high' || q.risk === 'uncertain') return { decision: 'human', reasons: [`risk ${q.risk} requires a maintainer (mandatory)`], matched };
  const touched = (q.paths ?? []).filter((p) => matchesAny(p, HUMAN_GATE_PATHS));
  if (touched.length) return { decision: 'human', reasons: [`touches authority/workflow/access paths (${touched.join(', ')}): maintainer required (mandatory; a PR cannot authorize itself)`], matched };
  if (q.kind === 'feature' || q.kind === 'enhancement') { if (q.task === 'implement' || q.task === 'merge') reasons.push('feature/enhancement scope needs approved criteria (checked by approvals)'); }
  const hits = orders.programs.filter((p) => covers(p, q));
  for (const p of hits) matched.push(p.name);
  const deny = hits.find((p) => p.decision === 'deny');
  if (deny) return { decision: 'deny', reasons: [...reasons, `denied by program ${deny.name}`], matched };
  const gate = hits.find((p) => p.decision === 'require-approval' || p.escalate);
  if (gate) return { decision: 'human', reasons: [...reasons, `program ${gate.name} requires maintainer approval`], matched };
  if (hits.some((p) => p.decision === 'allow')) return { decision: 'allow', reasons: [...reasons, 'allowed by standing orders'], matched };
  return { decision: 'human', reasons: [...reasons, 'no standing order covers this action: escalate'], matched };
}

export interface Finding { level: 'error' | 'warning'; code: string; message: string }

/** Combined validation of both files plus the (optional) operator ceiling. Reports conflicting policy and unsafe effective defaults. */
export function validateEffective(w: WardenConfig, o: Orders | null, ceiling?: AuthorityCeiling | null): Finding[] {
  const f: Finding[] = [];
  const err = (code: string, message: string) => f.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => f.push({ level: 'warning', code, message });
  if (w.gates.blocker !== true) err('gate.blocker', 'blocker findings must always block merge (mandatory)');
  if (w.runtime.remoteFallback) err('runtime.remote-fallback', 'remote fallback is not permitted (ADR 0007)');
  if (w.runtime.provider !== 'local') err('runtime.provider', 'MVP inference is local-only');
  if (w.runtime.isolation === 'none') err('runtime.isolation', 'isolation "none" is unsafe: candidate-code execution needs a real OS/container boundary; the affected tasks will be blocked');
  if (w.approvals.actionExpiryHours > 168) err('approvals.expiry', 'action approval expiry above 7 days is unsafe');
  if (w.approvals.actionExpiryHours > 24) warn('approvals.expiry', `action approval expiry ${w.approvals.actionExpiryHours}h exceeds the 24h default`);
  if (!w.approvals.requireIndependentApprover) warn('approvals.independent', 'independent approver disabled: the author of a change may approve it');
  if (w.mode === 'live') warn('mode.live', 'mode live is a repository default only; live activation requires the separate protected activation step (P7) and never follows from config');
  if (w.maintainers.length === 0) err('maintainers.empty', 'at least one maintainer identity is required');
  if (!w.drafts.allowed) { /* default */ } else warn('drafts.allowed', 'drafts allowed: drafts still can never merge');
  if (w.inbox.globalControl && w.inbox.globalControl.repository === w.repository && w.inbox.globalControl.issue === w.inbox.controlIssue) err('inbox.control-collision', 'global control issue must differ from the instance control issue');
  if (w.inbox.inboxIssue === w.inbox.controlIssue) err('inbox.control-collision', 'inbox issue and control issue must differ');
  if (w.credentials.automation === 'opt-out') warn('credentials.opt-out', 'credential automation opted out: authenticated operations suspend when credentials lapse');
  if (!w.inbox.globalControl) warn('inbox.global-control', 'no global control location configured: global stop is not available to this instance (instance stop only)');
  if (o) {
    const names = new Set<string>();
    for (const p of o.programs) {
      if (names.has(p.name)) err('orders.duplicate', `duplicate program name ${p.name}`); names.add(p.name);
      const paths = [...(p.scope?.paths ?? [])];
      if (p.decision === 'allow') {
        for (const g of paths) {
          const re = globToRe(g);
          const bad = HUMAN_GATE_PATHS.filter((h) => re.test(h) || globToRe(h).test(g));
          if (bad.length) err('orders.self-authority', `program ${p.name} allows paths overlapping mandatory human-gate paths (${bad.join(', ')}); denial/human gates prevail and policy cannot authorize itself`);
        }
        if (!p.scope || (!p.scope.kinds && !p.scope.paths && !p.scope.origins)) warn('orders.broad-allow', `program ${p.name} allows ${p.tasks.join('/')} with no scope: start narrow`);
        if (p.tasks.includes('merge') && p.scope?.kinds?.some((k) => k === 'feature' || k === 'enhancement')) warn('orders.feature-merge', `program ${p.name} allows merge of features: scope/acceptance approval is still required separately`);
      }
    }
    // conflicts: an allow and a deny/approval program with identical task+scope kinds
    for (const a of o.programs.filter((x) => x.decision === 'allow'))
      for (const d of o.programs.filter((x) => x.decision !== 'allow'))
        if (a.tasks.some((t) => d.tasks.includes(t)) && JSON.stringify(a.scope ?? {}) === JSON.stringify(d.scope ?? {}))
          warn('orders.conflict', `programs ${a.name} (allow) and ${d.name} (${d.decision}) overlap; ${d.decision === 'deny' ? 'deny' : 'human approval'} prevails`);
  } else warn('orders.missing', 'no ORDERS.yaml: every action escalates to a maintainer (narrow by default)');
  if (ceiling) {
    if (!ceiling.repositories.includes(w.repository)) err('ceiling.repository', `operator ceiling does not include ${w.repository}`);
  }
  return f;
}
