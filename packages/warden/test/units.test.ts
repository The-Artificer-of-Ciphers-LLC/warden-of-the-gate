import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_WARDEN } from '../src/config/defaults.ts';
import { loadOrders, loadWarden } from '../src/config/load.ts';
import { evaluate, validateEffective } from '../src/config/policy.ts';
import { canOverride, canTransition, newLedger, ISSUE_OPEN_STATES } from '../src/state/model.ts';
import { BudgetMonitor, NotReadyRunner, runValidated } from '../src/runner/agent-runner.ts';
import type { AgentRunner, SessionRequest } from '../src/runner/agent-runner.ts';
import { InstanceMismatch, InstanceStorage, instanceIdFor } from '../src/storage/instance.ts';
import { HttpStore } from '../src/github/http.ts';
import { CredentialUnavailable } from '../src/credentials/types.ts';
import { Journal } from '../src/writer/journal.ts';
import { claim, rig, ORDERS, wardenCfg } from './helpers.ts';
import { LEDGER_MARK, parseLedger } from '../src/writer/protocol.ts';
import { Faults } from '../src/util.ts';
import { redact } from '../src/util.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'wu-'));

test('defaults are really materialized (not JSON-Schema defaults) and mandatory limits are fixed', () => {
  const d = tmp(); mkdirSync(join(d, '.github')); writeFileSync(join(d, '.github/warden.yml'), 'schemaVersion: 1\nrepository: a/b\nmaintainers: [m]\n');
  const r = loadWarden(d); assert.ok(r.ok); const v = r.value!;
  assert.equal(v.clocks.initialDeliveryHours, 48); assert.equal(v.clocks.fixWindowHours, 48); assert.deepEqual(v.clocks.responseNudgeHours, [48, 72]); assert.equal(v.clocks.reproductionDays, 14);
  assert.equal(v.approvals.actionExpiryHours, 24); assert.equal(v.retention.transcriptDays, 30); assert.equal(v.gates.nit, true); assert.equal(v.drafts.allowed, false); assert.equal(v.runtime.remoteFallback, false); assert.equal(v.runtime.budgets.maxFactoryImplementationPrs, 1);
  assert.equal(v.mode, 'shadow'); assert.equal(v.labels.states.ready, 'warden:ready');
  writeFileSync(join(d, '.github/warden.yml'), 'schemaVersion: 1\nrepository: a/b\nmaintainers: [m]\nclocks: {initialDeliveryHours: 72}\ngates: {nit: false}\n');
  const o = loadWarden(d).value!; assert.equal(o.clocks.initialDeliveryHours, 72); assert.equal(o.clocks.fixWindowHours, 48, 'unspecified siblings keep defaults'); assert.equal(o.gates.nit, false); assert.equal(o.gates.blocker, true);
  for (const bad of ['gates: {blocker: false}', 'runtime: {remoteFallback: true}', 'runtime: {provider: remote}', 'maintainers: []']) { writeFileSync(join(d, '.github/warden.yml'), `schemaVersion: 1\nrepository: a/b\nmaintainers: [m]\n${bad}\n`); assert.equal(loadWarden(d).ok, false, bad); }
});
test('orders: closed vocabulary, no executable fields, approval gate required', () => {
  const d = tmp(); mkdirSync(join(d, '.github'));
  const t = (y: string) => { writeFileSync(join(d, '.github/ORDERS.yaml'), y); return loadOrders(d); };
  assert.equal(t('schemaVersion: 1\nprograms: []\n').ok, true);
  assert.equal(t('schemaVersion: 1\nprograms:\n  - {name: x, tasks: [merge], decision: allow, run: "rm -rf /"}\n').ok, false);
  assert.equal(t('schemaVersion: 1\nprograms:\n  - {name: x, tasks: [deploy], decision: allow}\n').ok, false);
  assert.equal(t('schemaVersion: 1\nprograms:\n  - {name: x, tasks: [merge], decision: require-approval}\n').ok, false);
  assert.equal(t('schemaVersion: 1\nprograms:\n  - {name: x, tasks: [merge], decision: allow, expr: "a&&b"}\n').ok, false);
  assert.match(t('schemaVersion: 9\nprograms: []\n').errors[0], /unsupported schemaVersion/);
});
test('effective policy: deny > human > allow; mandatory human gates; narrow by default; PR cannot authorize itself', () => {
  const orders = { schemaVersion: 1 as const, programs: [
    { name: 'docs', tasks: ['merge'], decision: 'allow' as const, scope: { kinds: ['documentation'], paths: ['docs/**'] } },
    { name: 'no-docs-secret', tasks: ['merge'], decision: 'deny' as const, scope: { paths: ['docs/secret/**'] } },
    { name: 'deps', tasks: ['merge'], decision: 'require-approval' as const, approvalGate: 'maintainer' as const, scope: { kinds: ['dependency'] } }] };
  assert.equal(evaluate(orders, { task: 'merge', kind: 'documentation', paths: ['docs/a.md'] }).decision, 'allow');
  assert.equal(evaluate(orders, { task: 'merge', kind: 'documentation', paths: ['docs/secret/x.md'] }).decision, 'deny', 'deny prevails over a covering allow');
  assert.equal(evaluate({ ...orders, programs: [{ ...orders.programs[0], scope: { kinds: ['documentation'] } }, orders.programs[1]] }, { task: 'merge', kind: 'documentation', paths: ['docs/secret/x.md'] }).decision, 'deny');
  assert.equal(evaluate(orders, { task: 'merge', kind: 'dependency' }).decision, 'human');
  assert.equal(evaluate(orders, { task: 'merge', kind: 'documentation', paths: ['docs/a.md'], risk: 'high' }).decision, 'human');
  assert.equal(evaluate(orders, { task: 'merge', kind: 'documentation', paths: ['docs/a.md'], wontfix: true }).decision, 'human');
  assert.equal(evaluate(orders, { task: 'review', kind: 'bug' }).decision, 'human', 'no standing order => escalate');
  // a PR that edits ORDERS.yaml / workflows / maintainers can never be auto-authorized, even if a program "allows" everything
  const allowAll = { schemaVersion: 1 as const, programs: [{ name: 'all', tasks: ['merge'], decision: 'allow' as const }] };
  for (const p of ['.github/ORDERS.yaml', '.github/warden.yml', '.github/workflows/ci.yml', 'MAINTAINERS', 'CODEOWNERS']) assert.equal(evaluate(allowAll, { task: 'merge', paths: [p] }).decision, 'human', p);
  assert.ok(validateEffective(wardenCfg(), allowAll).some((f) => f.code === 'orders.broad-allow'));
});
test('state model: issue and PR states are distinct, no head on issues, facets independent, no reopen', () => {
  assert.ok(canTransition('issue', 'needs-triage', 'ready').ok); assert.equal(canTransition('issue', 'needs-triage', 'merge-ready').ok, false); assert.equal(canTransition('pr', 'needs-review', 'ready').ok, false);
  assert.equal(canTransition('issue', 'closed', 'ready').ok, false); assert.equal(canTransition('pr', 'merged', 'needs-review').ok, false); assert.equal(canOverride('pr', 'merged', 'needs-review').ok, false);
  assert.ok(canOverride('issue', 'ready', 'blocked').ok); assert.ok(ISSUE_OPEN_STATES.includes('implementing'));
  const i = newLedger('a/b', 1, 'issue'); const p = newLedger('a/b', 2, 'pr'); assert.equal(i.evidence.head, undefined); assert.equal(i.state, 'needs-triage'); assert.equal(p.state, 'needs-review');
  i.facets = { workKind: 'bug', severity: 'major', risk: 'low', quickWin: true }; assert.equal(i.state, 'needs-triage', 'facets never change workflow state');
  assert.deepEqual(i.attempts, { launchRetries: 0, reworkCycles: 0, contributorFixRounds: 0, review: 0 });
});
test('writer: issues never accept a PR head; maintainer override and blockers go through the writer; terminal items are never reopened', async () => {
  const r = rig(); const n = r.world.addIssue();
  await r.send({ kind: 'revision-update', item: n, actor: 'bot', payload: { head: 'f'.repeat(40) } }); await r.writer().drain();
  const l = parseLedger((await r.world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!.body)!; assert.equal(l.evidence.head, undefined);
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'blocked' } }); const rep = await r.writer().drain(); assert.equal(rep.processed[0].reason, 'blocker-details-required');
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'blocked', blocker: { reason: 'waiting for upstream', resumeTo: 'needs-triage' } } }); await r.writer().drain();
  const cid = await r.comment('maint1', n, '/warden override ready fixed upstream');
  const i = r.intent({ kind: 'override', item: n, origin: 'maintainer', actor: 'maint1', source: { kind: 'gh-comment', id: String(cid), observedAt: '' }, payload: { to: 'ready', reason: 'fixed upstream' } });
  const { submit } = await import('../src/writer/journal.ts'); await submit(r.submitStore, r.inbox, i, null); await r.writer().drain();
  const l2 = parseLedger((await r.world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!.body)!; assert.equal(l2.state, 'ready'); assert.equal(l2.blocker, undefined);
  assert.ok((await r.world.view('x').getIssue(n)).labels.includes('warden:ready'), 'label projection follows the ledger');
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'closed' } }); await r.writer().drain();
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'ready', note: 'stale' } }); const rep2 = await r.writer().drain(); assert.match(rep2.processed[0].reason!, /terminal|item-closed/);
});
test('writer modes: shadow rejects AI effects visibly; global dry-run blocks deterministic housekeeping AND queued effects', async () => {
  const r = rig(); const n = r.world.addIssue();
  await r.send({ kind: 'note', item: n, origin: 'ai', payload: { text: 'ai said hi' } }); let rep = await r.writer().drain();
  assert.equal(rep.processed[0].reason, 'shadow-mode-ai-effects-disabled'); assert.ok(!(await r.world.view('x').listComments(n)).some((c) => /ai said hi/.test(c.body) && !c.body.startsWith(LEDGER_MARK)));
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'needs-info' } });
  await r.opStore.addLabel(r.control, 'warden:dry-run');
  rep = await r.writer().drain(); assert.equal(rep.halted, 'dry-run'); assert.equal(rep.processed.length, 0); assert.equal(rep.pendingAfter.length, 1);
  assert.ok((await r.world.view('x').listComments(r.control)).some((c) => /dryrun-ack/.test(c.body)));
  await r.opStore.removeLabel(r.control, 'warden:dry-run'); rep = await r.writer().drain(); assert.equal(rep.processed[0].result, 'applied');
  const live = rig({ mode: 'live' }); const m = live.world.addIssue(); await live.send({ kind: 'note', item: m, origin: 'ai', payload: { text: 'x' } }); assert.equal((await live.writer().drain()).processed[0].result, 'applied');
});
test('retry bound is persisted in the ledger: cold starts cannot reset it; failure ends visibly as failed', async () => {
  const r = rig(); const n = r.world.addIssue();
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'ready' } }); await r.writer().drain();
  await r.send({ item: n, ...claim('alice') });
  const results: string[] = [];
  for (let k = 0; k < 6; k++) { const f = new Faults().failAlways('effect:assign'); const rep = await r.writer({ assignable: () => true }, f).drain(); results.push(...rep.processed.map((p) => p.result)); }
  assert.deepEqual(results.filter((x) => x === 'retry').length, 4); assert.ok(results.includes('failed'));
  const l = parseLedger((await r.world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!.body)!; assert.equal(Object.values(l.ops).find((o) => o.status === 'failed')!.attempts, 5);
});
test('redelivery older than the dedupe horizon is rejected by the age rule', async () => {
  const r = rig({ inbox: { dedupeHorizon: 16, maxIntentAgeHours: 1 } }); const n = r.world.addIssue();
  const old = r.intent({ kind: 'note', item: n, payload: { text: 'first' } }); const { submit } = await import('../src/writer/journal.ts');
  await submit(r.submitStore, r.inbox, old, null); await r.writer().drain();
  for (let k = 0; k < 20; k++) { await r.send({ kind: 'note', item: n, payload: { text: 'n' + k } }); } await r.writer({ maxCreatesPerRun: 1000 }).drain();
  r.world.clock = r.world.now() + 3 * 3600_000; await submit(r.submitStore, r.inbox, old, null); const rep = await r.writer({ maxCreatesPerRun: 1000 }).drain();
  assert.equal(rep.processed.at(-1)!.reason, 'beyond-dedupe-horizon');
});
test('runner: tool-call budget (not just steps), wall clock, stop, Ajv rejection, not-ready adapter never fabricates', async () => {
  const schema = { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['ok', 'bad'] } } };
  const req: SessionRequest = { task: 'review', item: 1, packetDir: '/x', tools: { allow: ['read'] }, resultSchema: schema, budgets: { maxToolCalls: 5, maxModelTurns: 3, wallTimeMs: 1000 }, expectedModel: 'm' };
  const mk = (fn: (m: BudgetMonitor, sig: AbortSignal) => Promise<unknown>, outcome: 'completed' | 'interrupted' = 'completed'): AgentRunner => ({ name: 't', pinnedVersion: '1', preflight: async () => ({ ok: true, failures: [] }), run: async (_r, sig, m) => { const out = await fn(m, sig); return { outcome: sig.aborted ? 'interrupted' : outcome, structuredOutput: out, usage: m.usage() }; } });
  const ok = await runValidated(mk(async () => ({ verdict: 'ok' })), req, { stopped: () => false }); assert.equal(ok.accepted, true);
  const many = await runValidated(mk(async (m) => { m.observe({ modelTurns: 1, toolCalls: 50 }); return { verdict: 'ok' }; }), req, { stopped: () => false });
  assert.equal(many.accepted, false); assert.match((many as any).reason, /tool-call budget 5 exceeded/, 'one turn batching many tool calls is still bounded');
  let t = 0; const clk = () => t; const slow = await runValidated(mk(async (m) => { t += 5000; m.observe({}); return { verdict: 'ok' }; }), req, { stopped: () => false, clock: clk }); assert.match((slow as any).reason, /wall-time/);
  assert.match((await runValidated(mk(async () => ({ verdict: 'ok' })), req, { stopped: () => true }) as any).reason, /stopped/);
  assert.match((await runValidated(mk(async () => ({ verdict: 'ok', effect: 'merge' })), req, { stopped: () => false }) as any).reason, /rejected/, 'smuggled field rejected');
  assert.match((await runValidated(mk(async () => 'prose'), req, { stopped: () => false }) as any).reason, /rejected/);
  const nr = await runValidated(new NotReadyRunner(), req, { stopped: () => false }); assert.equal(nr.accepted, false); assert.match((nr as any).reason, /preflight failed/);
  const bad = await runValidated({ ...mk(async () => ({})), preflight: async () => ({ ok: false, failures: ['resolved model is remote'] }) }, req, { stopped: () => false }); assert.match((bad as any).reason, /remote/);
});
test('storage: per-instance isolation, 0700/0600 from first write, redaction, retention separation, failure surfaced', () => {
  const home = tmp(); const A = InstanceStorage.open(home, 'acme/one', { create: true }); const B = InstanceStorage.open(home, 'acme/two', { create: true });
  assert.notEqual(A.dir, B.dir); assert.notEqual(instanceIdFor('acme/one'), instanceIdFor('acme/two'));
  A.recordDecision({ approvalId: 'apr_1', decision: 'approved', by: 'm' }); assert.equal(B.decisions().length, 0, 'decisions never cross instances'); assert.equal(A.recordDecision({ approvalId: 'apr_1', decision: 'approved' }), false, 'idempotent');
  A.appendLine(A.path('journal', 'journal.jsonl'), { note: 'tok ghp_' + 'Z'.repeat(36) + ' end' }); assert.ok(!readFileSync(A.path('journal', 'journal.jsonl'), 'utf8').includes('ghp_ZZ'));
  A.writeJson(A.path('x.json'), { password: 'hunter2', n: 1 }); assert.ok(!readFileSync(A.path('x.json'), 'utf8').includes('hunter2'));
  assert.deepEqual(A.permissionProblems(), []); assert.equal(statSync(A.dir).mode & 0o077, 0); assert.equal(statSync(home).mode & 0o077, 0);
  new Journal(A.journalPath); assert.equal(statSync(A.journalPath).mode & 0o077, 0);
  // an instance dir cannot be adopted by another repository
  const meta = join(A.dir, 'instance.json'); const m = JSON.parse(readFileSync(meta, 'utf8')); writeFileSync(meta, JSON.stringify({ ...m, repository: 'acme/two' }));
  assert.throws(() => InstanceStorage.open(home, 'acme/one', { create: true }), InstanceMismatch);
  // retention: transcripts expire at 30d, audit + decisions untouched
  const T = join(B.transcriptsDir, 'old.txt'); writeFileSync(T, 'x'); const old = (Date.now() - 40 * 86400_000) / 1000; utimesSync(T, old, old); writeFileSync(join(B.transcriptsDir, 'new.txt'), 'y');
  B.securityAudit('x'); B.recordDecision({ approvalId: 'apr_9', decision: 'denied' });
  assert.equal(B.pruneTranscripts(30), 1); assert.ok(existsSync(join(B.transcriptsDir, 'new.txt'))); assert.equal(B.decisions().length, 1); assert.ok(readFileSync(B.auditPath, 'utf8').length > 0);
  // storage failure is surfaced, not silently acknowledged
  chmodSync(B.dir, 0o500); try { assert.throws(() => B.writeJson(B.path('y.json'), {}), /STORAGE FAILURE/); } finally { chmodSync(B.dir, 0o700); }
  assert.throws(() => InstanceStorage.open(home, 'acme/none', { create: false }), /not initialized/);
});
test('two instances on one host: intents, ledgers and journals never cross; each has its own state', async () => {
  const a = rig(); const na = a.world.addIssue();
  await a.send({ kind: 'transition', item: na, actor: 'bot', payload: { to: 'ready' } });
  const foreign = a.intent({ kind: 'note', item: na, repo: 'acme/other', payload: { text: 'x' } }); const { submit } = await import('../src/writer/journal.ts'); await submit(a.submitStore, a.inbox, foreign, null);
  const rep = await a.writer().drain(); assert.ok(rep.processed.some((p) => /wrong-instance/.test(p.reason ?? '')));
  // a ledger copied from another repository halts the writer
  const lc = (await a.world.view('x').listComments(na)).find((c) => c.body.startsWith(LEDGER_MARK))!; const L = parseLedger(lc.body)!; L.repository = 'acme/other';
  const { encodeLedger } = await import('../src/writer/protocol.ts'); a.world.comments.get(lc.id)!.c.body = encodeLedger(L);
  await a.send({ kind: 'note', item: na, payload: { text: 'y' } }); const rep2 = await a.writer().drain(); assert.equal(rep2.halted, 'anomaly'); assert.match(rep2.haltReason!, /never share mutable state/);
});
test('HttpStore: uses only controller-issued tokens; credential outage suspends the operation with no request and no env/PAT fallback', async () => {
  const seen: string[] = []; const srv = createServer((req, res) => { seen.push(String(req.headers.authorization)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ number: 7, state: 'open', title: 't', body: '', assignees: [], labels: [], user: { login: 'u' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok)); const port = (srv.address() as { port: number }).port;
  const prev = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'ghp_CANARY_ambient_token_must_never_be_used';
  try {
    let fail = true; const creds = { token: async () => { if (fail) throw new CredentialUnavailable('backoff', 'issuer down'); return 'ghs_issued_short_lived'; }, status: () => [] };
    const s = new HttpStore('acme/widgets', creds, { operation: 'write', repository: 'acme/widgets', permissions: { issues: 'write' } }, 'warden-writer', `http://127.0.0.1:${port}`);
    await assert.rejects(() => s.getIssue(7), CredentialUnavailable); assert.equal(seen.length, 0, 'no request without a controller credential');
    fail = false; assert.equal((await s.getIssue(7)).number, 7); assert.deepEqual(seen, ['Bearer ghs_issued_short_lived']); assert.ok(!seen.join().includes('CANARY'));
  } finally { if (prev === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = prev; srv.close(); }
});
test('redact scrubs credential shapes', () => { assert.equal(redact('x ghs_' + 'a'.repeat(30)), 'x [REDACTED]'); assert.ok(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz').includes('[REDACTED]')); });
void DEFAULT_WARDEN; void ORDERS; void chmodSync;
