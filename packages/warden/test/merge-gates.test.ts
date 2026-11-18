import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMerge, bindingFor, deliverable, originOf } from '../src/merge/gates.ts';
import type { MergeInput } from '../src/merge/gates.ts';
import { newLedger } from '../src/state/model.ts';
import type { ApprovalRec } from '../src/state/model.ts';
import { buildPolicy } from '../src/config/snapshot.ts';
import { wardenCfg, ORDERS, REPO } from './helpers.ts';
import type { PullInfo } from '../src/github/store.ts';

const cfg = wardenCfg(); const policy = buildPolicy(cfg, ORDERS); const NOW = Date.parse('2026-11-18T12:00:00Z');
const pull = (o: Partial<PullInfo> = {}): PullInfo => ({ merged: false, approvals: [], number: 7, head: 'headaaaa0000', base: 'basebbbb0000', title: 't', author: 'contrib1', draft: false, state: 'open', ci: 'passing', files: [{ path: 'docs/guide.md', status: 'modified' }], ...o });
function input(o: { pull?: Partial<PullInfo>; risk?: 'low' | 'medium' | 'high' | 'uncertain' | null; kind?: string; findings?: Array<'blocker' | 'major' | 'minor' | 'nit'>; state?: string; mutate?: (i: MergeInput) => void } = {}): MergeInput {
  const l = newLedger(REPO, 7, 'pr'); l.state = (o.state ?? 'merge-ready') as typeof l.state; if (o.risk !== null) l.facets.risk = o.risk ?? 'low'; l.facets.workKind = o.kind ?? 'documentation';
  const p = pull(o.pull);
  const i: MergeInput = { ledger: l, pull: p, review: { head: p.head, severities: o.findings ?? [], policyDigest: policy.digest },
    gates: { blocker: true, major: true, minor: true, nit: true }, policy, rules: { requiredApprovals: 0, approvals: [], appLogin: 'warden-app[bot]', factoryLogins: ['warden-factory'] }, automationLogins: ['dependabot[bot]'], hold: false, stopped: false, now: NOW, policyDigest: policy.digest };
  o.mutate?.(i); return i;
}
const approved = (action = 'merge', over: Partial<ApprovalRec> = {}): ApprovalRec => ({ id: 'apr_1', type: 'action', action, binding: { revision: '', policyDigest: policy.digest, evidenceDigest: '' }, bindingDigest: 'x', requestedBy: 'agent', requestedAt: '2026-11-18T10:00:00Z', expiresAt: '2026-11-19T10:00:00Z', status: 'approved', decidedBy: 'maint1', ...over });

test('a clean, low-risk, standing-order-covered PR with passing checks is eligible; the verdict is only a decision, never a merge', () => {
  const v = evaluateMerge(input()); assert.equal(v.action, 'merge'); assert.equal((v as { via: string }).via, 'standing-order');
});

test('blocker always gates; major/minor/nit gates follow configuration; an unreviewed or stale-head review waits; pending checks wait', () => {
  assert.equal(evaluateMerge(input({ findings: ['blocker'], mutate: (i) => { i.gates = { blocker: true, major: false, minor: false, nit: false }; } })).action, 'block');
  assert.equal(evaluateMerge(input({ findings: ['major'], mutate: (i) => { i.gates = { blocker: true, major: false, minor: true, nit: true }; } })).action, 'merge');
  assert.equal(evaluateMerge(input({ findings: ['major'] })).action, 'block');
  assert.equal(evaluateMerge(input({ findings: ['nit'] })).action, 'block'); assert.equal(evaluateMerge(input({ findings: ['nit'], mutate: (i) => { i.gates = { blocker: true, major: true, minor: true, nit: false }; } })).action, 'merge');
  assert.deepEqual((evaluateMerge(input({ mutate: (i) => { i.review = null; } })) as { reasons: string[] }).reasons, ['no accepted review']);
  assert.match((evaluateMerge(input({ mutate: (i) => { i.review!.head = 'oldhead00000'; } })) as { reasons: string[] }).reasons[0], /older head/);
  assert.match((evaluateMerge(input({ mutate: (i) => { i.review!.policyDigest = 'different'; } })) as { reasons: string[] }).reasons[0], /predates the current policy/);
  assert.match((evaluateMerge(input({ pull: { ci: 'pending' } })) as { reasons: string[] }).reasons[0], /required checks are pending/);
});

test('draft, closed, stop, hold and a non-merge-ready state block; they are never weakened by approvals', () => {
  for (const [name, mut] of [['draft', (i: MergeInput) => { i.pull.draft = true; }], ['closed', (i: MergeInput) => { i.pull.state = 'closed'; }], ['stop', (i: MergeInput) => { i.stopped = true; }], ['hold', (i: MergeInput) => { i.hold = true; }]] as const) {
    const v = evaluateMerge(input({ mutate: (i) => { i.ledger.approvals.a = approved('merge'); mut(i); } })); assert.equal(v.action, 'block', name);
  }
  assert.equal(evaluateMerge(input({ state: 'needs-review' })).action, 'block');
  assert.equal(evaluateMerge(input({ mutate: (i) => { i.ledger.obligations.push({ type: 'delivery', startedAt: 'a', dueAt: 'b', source: 's', hold: { startedAt: 'a', remainingMs: 5, reason: 'r' } }); } })).action, 'block');
});

test('risk is independent of severity and confidence: high, uncertain and missing risk need a maintainer; workflow/access paths always do', () => {
  for (const risk of ['high', 'uncertain', null] as const) assert.equal(evaluateMerge(input({ risk })).action, 'escalate', String(risk));
  const wf = evaluateMerge(input({ pull: { files: [{ path: '.github/workflows/ci.yml', status: 'modified' }] } })); assert.equal(wf.action, 'escalate'); assert.match((wf as { reasons: string[] }).reasons.join(), /authority\/workflow\/access paths/);
  assert.equal(evaluateMerge(input({ pull: { files: [{ path: '.github/ORDERS.yaml', status: 'modified' }] } })).action, 'escalate');
});

test('a maintainer approval can satisfy a human-gated merge, but expiry, binding changes and the mandatory classes still bind', () => {
  const human = (o: Partial<ApprovalRec> = {}, extra?: (i: MergeInput) => void) => evaluateMerge(input({ risk: 'high', mutate: (i) => { i.ledger.approvals.a = approved('merge', o); extra?.(i); } }));
  const ok = human(); assert.equal(ok.action, 'merge'); assert.equal((ok as { via: string }).via, 'maintainer-approval'); assert.equal((ok as { approvalId?: string }).approvalId, 'apr_1');
  assert.equal(human({ expiresAt: '2026-11-18T11:00:00Z' }).action, 'escalate', 'expired at use time');
  assert.equal(human({ binding: { revision: '', policyDigest: 'old', evidenceDigest: '' } }).action, 'escalate', 'policy changed since the approval');
  assert.equal(human({ status: 'denied' }).action, 'escalate'); assert.equal(human({ status: 'pending' }).action, 'escalate');
});

test('origin comes from the verified author identity, never a label or PR text; automation migrations and breaking majors cannot bypass escalation', () => {
  const rules = { requiredApprovals: 0, approvals: [], appLogin: 'warden-app[bot]', factoryLogins: ['warden-factory'] };
  assert.equal(originOf(pull({ author: 'dependabot[bot]' }), ['dependabot[bot]'], rules), 'automation');
  assert.equal(originOf(pull({ author: 'contrib1', title: 'chore(deps): bump x [dependabot]' }), ['dependabot[bot]'], rules), 'contributor', 'spoofed title/label is not an identity');
  assert.equal(originOf(pull({ author: 'warden-factory' }), [], rules), 'factory'); assert.equal(originOf(pull({ author: 'warden-app[bot]' }), [], rules), 'factory');
  for (const dep of [{ breakingMajor: true }, { migration: true }]) {
    const v = evaluateMerge(input({ pull: { author: 'dependabot[bot]' }, kind: 'dependency', mutate: (i) => { i.dependency = dep; i.ledger.approvals.a = approved('merge'); } })); assert.equal(v.action, 'escalate'); assert.match((v as { reasons: string[] }).reasons.join(), /breaking major|migration/);
  }
});

test('independent approvals: the author, the App and the factory identity do not count; a second model session is not an identity', () => {
  const need = (approvals: string[]) => evaluateMerge(input({ mutate: (i) => { i.rules.requiredApprovals = 1; i.rules.approvals = approvals.map((login) => ({ login })); } }));
  assert.equal(need([]).action, 'escalate'); assert.equal(need(['contrib1']).action, 'escalate'); assert.equal(need(['warden-app[bot]', 'warden-factory']).action, 'escalate');
  const v = need(['contrib1']); assert.match((v as { reasons: string[] }).reasons[0], /second model session is not an independent identity/);
  assert.equal(need(['maint2']).action, 'merge');
  const own = evaluateMerge(input({ pull: { author: 'warden-app[bot]' }, mutate: (i) => { i.rules.requiredApprovals = 1; i.rules.approvals = [{ login: 'warden-app[bot]' }]; } })); assert.equal(own.action, 'escalate', "an App's own PR needs another identity");
});

test('delivery binding: a request is stale if the head, policy or evidence moved or the verdict is no longer merge; unchanged delivers', () => {
  const base = input(); const v = evaluateMerge(base) as Extract<ReturnType<typeof evaluateMerge>, { action: 'merge' }>; const b = bindingFor(base, v);
  assert.deepEqual(deliverable(b, input()), { ok: true });
  assert.match((deliverable(b, input({ pull: { head: 'headcccc0000' } })) as { reason: string }).reason, /head moved/);
  assert.match((deliverable(b, input({ mutate: (i) => { i.policyDigest = 'new'; } })) as { reason: string }).reason, /policy changed/);
  assert.match((deliverable({ ...b, evidenceDigest: 'e1' }, input()) as { reason: string }).reason, /evidence changed/);
  assert.match((deliverable(b, input({ mutate: (i) => { i.stopped = true; } })) as { reason: string }).reason, /no longer eligible: stop is in force/);
});
