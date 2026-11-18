import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rig, REPO, WRITER } from './helpers.ts';
import type { Rig } from './helpers.ts';
import { newLedger } from '../src/state/model.ts';
import type { Ledger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import type { IntentCore } from '../src/writer/protocol.ts';
import { git, pushBranch } from '../src/git/workspace.ts';
import { runImplement } from '../src/implement/slice.ts';
import type { ImplConfig, ImplKV, ImplRecord, IntentSink, PrPublisher } from '../src/implement/slice.ts';
import type { AgentRunner, PreflightReport, SessionRequest, SessionResult } from '../src/runner/agent-runner.ts';
import type { Orders } from '../src/config/load.ts';

/** Factory Implement against REAL git (a local bare remote), the REAL trusted executor in the REAL Seatbelt boundary, and the REAL writer. Only the model
 *  and GitHub PR creation are faked: the fake model edits files in the writable workspace exactly as the OpenCode session would. */
const GOOD: PreflightReport = { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] };
const ORDERS: Orders = { schemaVersion: 1, programs: [{ name: 'bugs', tasks: ['implement', 'merge', 'review'], decision: 'allow', scope: { kinds: ['bug'], origins: ['factory'] } }] };
const BUGGY = 'exports.sumTo = (n) => { let t = 0; for (let i = 1; i <= n; i++) t += i; return t; };\n';   // contract: sum of 1..n-1 (exclusive)
const FIXED = 'exports.sumTo = (n) => { let t = 0; for (let i = 1; i < n; i++) t += i; return t; };\n';
const TEST = "const { test } = require('node:test'); const assert = require('node:assert'); const { sumTo } = require('../sum.js'); test('sumTo(4) is 1+2+3', () => assert.strictEqual(sumTo(4), 6));\n";
const RESULT = { summary: 'Fix off-by-one in sumTo', approach: 'Loop below n, with a test that failed before the fix', danger: { door: 'two-way', blastRadius: 'sumTo only', why: 'pure function, revertable' } };
const done = (o: unknown = RESULT): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } });

class Model implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; calls = 0; pf: PreflightReport; edit: (ws: string) => void | Promise<void>; result: unknown;
  constructor(edit: (ws: string) => void | Promise<void>, pf: PreflightReport = GOOD, result: unknown = RESULT) { this.edit = edit; this.pf = pf; this.result = result; }
  async preflight() { return this.pf; }
  async run(req: SessionRequest, signal: AbortSignal): Promise<SessionResult> {
    this.calls++; assert.equal(req.workspace?.writable, true); assert.ok(req.tools.allow.includes('edit') && !req.tools.allow.includes('shell'), 'no shell for the model'); assert.ok(!signal.aborted || true);
    await this.edit(req.workspace!.dir); return done(this.result);
  }
}
const goodEdit = (ws: string) => { mkdirSync(join(ws, 'test'), { recursive: true }); writeFileSync(join(ws, 'test/sum.test.js'), TEST); writeFileSync(join(ws, 'sum.js'), FIXED); };

async function setup(o: { orders?: Orders; ledger?: (l: Ledger) => void; over?: Record<string, unknown>; issueState?: boolean } = {}) {
  const r = rig(o.over ?? {}, o.orders ?? ORDERS); const root = mkdtempSync(join(tmpdir(), 'warden-impl-t-')); const bare = join(root, 'origin.git'); const seed = join(root, 'seed');
  git(null, ['init', '-q', '--bare', '-b', 'main', bare]); git(null, ['init', '-q', '-b', 'main', seed]); writeFileSync(join(seed, 'sum.js'), BUGGY);
  const id = { GIT_AUTHOR_NAME: 's', GIT_AUTHOR_EMAIL: 's@x.io', GIT_COMMITTER_NAME: 's', GIT_COMMITTER_EMAIL: 's@x.io' }; git(seed, ['add', '-A']); git(seed, ['commit', '-q', '-m', 'base'], { env: id }); git(seed, ['push', '-q', bare, 'main']);
  const baseSha = git(seed, ['rev-parse', 'HEAD']).trim();
  const n = r.world.addIssue({ title: 'sumTo includes n', body: 'sumTo(4) should be 6 (1+2+3) but returns 10.', author: 'reporter' });
  const l = newLedger(REPO, n, 'issue'); l.state = 'ready'; l.facets = { workKind: 'bug', risk: 'low' }; o.ledger?.(l); await r.world.view(WRITER).createComment(n, encodeLedger(l));
  let rec: ImplRecord | null = null; const kv: ImplKV = { read: () => (rec ? JSON.parse(JSON.stringify(rec)) : null), write: (_i, x) => { rec = JSON.parse(JSON.stringify(x)); } };
  const published: Array<{ branch: string; sha: string; body: string; number: number }> = [];
  const publisher: PrPublisher = { async open(p) { pushBranch(p.workspace, bare, p.branch); const num = r.world.addIssue({ isPr: true, title: p.title, body: p.body, author: 'warden-factory' }); r.world.issues.get(num)!.pull = { head: p.sha, base: p.baseSha, ci: 'passing', files: [] }; published.push({ branch: p.branch, sha: p.sha, body: p.body, number: num }); return { number: num, url: `https://example.test/pull/${num}` }; } };
  const intents: IntentSink = { async submit(i: IntentCore) { const { opid } = i as unknown as { opid?: string }; await r.send({ kind: i.kind, item: i.item, itemKind: i.itemKind, origin: i.origin, actor: i.actor, payload: i.payload, source: i.source }); await r.writer({ assignable: () => true }).drain(); return { opid: opid ?? '' }; },
    async confirmClaim(item) { const led = await ledgerOf(r, item); return led.owner?.kind === 'factory'; } };
  let stopped = false;
  const cfg: ImplConfig = { repository: REPO, source: bare, baseSha, factoryLogins: ['warden-factory'], factoryAuthor: { name: 'warden-factory', email: 'f@x.io' }, model: 'local-default', harness: 'opencode 2.2.7', maxFactoryPrs: 1, maxAttempts: 3, maxLaunchRetries: 3,
    budgets: { maxToolCalls: 20, maxModelTurns: 10, wallTimeMs: 60_000 }, localModels: ['local-default'], workRoot: join(root, 'work'), checks: [{ id: 'unit', kind: 'test', command: process.execPath, args: ['--test', 'test/'], timeoutMs: 60_000 }] };
  const run = (runner: AgentRunner, over: Partial<Parameters<typeof runImplement>[0]> = {}) => runImplement({ store: r.world.view('operator'), item: n, policy: r.policy, cfg, runner, kv, publisher, intents, stopped: () => stopped, ...over });
  return { r, n, bare, root, run, kv, rec: () => rec, published, setStopped: (v: boolean) => { stopped = v; }, cleanup: () => rmSync(root, { recursive: true, force: true }), cfg };
}
const ledgerOf = async (r: Rig, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;

test('a bug is fixed end to end: claim, trusted base checkout, model edits, executor fail-before/pass-after, PR with door/attribution/evidence, ledgers linked, no review or merge claimed', async (t) => {
  const s = await setup(); t.after(s.cleanup); const model = new Model(goodEdit);
  const o = await s.run(model); assert.equal(o.kind, 'opened', JSON.stringify(o)); assert.equal(model.calls, 1); assert.equal(s.published.length, 1);
  const p = s.published[0]; assert.equal(p.branch, `warden/bug-${s.n}`); assert.equal(git(s.bare, ['rev-parse', `refs/heads/${p.branch}`]).trim(), p.sha, 'the branch really reached the remote');
  assert.match(p.body, /Merge Danger:\*\* two-way door/); assert.match(p.body, /model local-default via opencode 2\.2\.7/); assert.match(p.body, /unit: base fail, candidate pass \(fixed\)/); assert.match(p.body, /nothing here claims a review or a merge/);
  const issue = await ledgerOf(s.r, s.n); assert.equal(issue.owner?.kind, 'factory'); assert.equal(issue.state, 'in-review'); assert.deepEqual(issue.linked, [p.number]);
  const prl = await ledgerOf(s.r, p.number); assert.equal(prl.state, 'needs-review'); assert.deepEqual(prl.linked, [s.n]); assert.equal(prl.review, undefined, 'Implement never advances or records a review');
  assert.equal(git(s.bare, ['log', '-1', '--format=%an', `refs/heads/${p.branch}`]).trim(), 'warden-factory');
});

test('a bug fix without a failing-before test is NOT opened: the evidence comes from the executor, not the model; the attempt is consumed', async (t) => {
  const s = await setup(); t.after(s.cleanup);
  const o = await s.run(new Model((ws) => writeFileSync(join(ws, 'sum.js'), FIXED)));
  assert.equal(o.kind, 'insufficient-evidence'); assert.match(o.notice, /no test went from failing on the base to passing on the candidate|no passing test/); assert.equal(s.published.length, 0); assert.equal(s.rec()!.attempts.completed, 1);
});

test('weakened gates, edits to authority paths and oversize diffs are refused whole, with no PR', async (t) => {
  const cases: Array<[string, (ws: string) => void, string]> = [
    ['skipped test', (ws) => { goodEdit(ws); writeFileSync(join(ws, 'test/extra.test.js'), "const { test } = require('node:test'); test.skip('later', () => {});\nit.skip('x', () => {});\n"); }, 'gate-weakening'],
    ['workflow edit', (ws) => { goodEdit(ws); mkdirSync(join(ws, '.github/workflows'), { recursive: true }); writeFileSync(join(ws, '.github/workflows/ci.yml'), 'name: ci\n'); }, 'authority-path-touched'],
    ['too large', (ws) => { goodEdit(ws); for (let i = 0; i < 45; i++) writeFileSync(join(ws, `gen${i}.js`), 'x\n'); }, 'diff-too-large'],
    ['no change', () => undefined, 'no-change'],
  ];
  for (const [name, edit, reason] of cases) { const s = await setup(); t.after(s.cleanup); const o = await s.run(new Model(edit)); assert.equal(o.kind, 'rejected', name); assert.equal(o.reason, reason, name); assert.equal(s.published.length, 0, name); }
});

test('the one-way door floor is deterministic: touching a migration forces one-way even if the model says two-way', async (t) => {
  const s = await setup(); t.after(s.cleanup);
  const o = await s.run(new Model((ws) => { goodEdit(ws); mkdirSync(join(ws, 'migrations'), { recursive: true }); writeFileSync(join(ws, 'migrations/001.sql'), 'select 1;\n'); }));
  assert.equal(o.kind, 'opened'); assert.match(s.published[0].body, /Merge Danger:\*\* one-way door\. Forced one-way/);
});

test('eligibility: no ledger, not ready, owned, no work kind, unapproved feature, standing orders silent or denying, factory cap, stop, remote model and paused scope are all refused before any session', async (t) => {
  const model = () => new Model(goodEdit);
  const refused = async (name: string, reason: string, o: Parameters<typeof setup>[0] = {}, runnerOver?: AgentRunner, tweak?: (s: Awaited<ReturnType<typeof setup>>) => void | Promise<void>) => {
    const s = await setup(o); t.after(s.cleanup); await tweak?.(s); const m = runnerOver ?? model(); const out = await s.run(m); assert.equal(out.kind, 'blocked', name); assert.equal(out.reason, reason, name + ': ' + out.notice); if (m instanceof Model) assert.equal(m.calls, 0, name); assert.equal(s.published.length, 0, name);
  };
  await refused('not ready', 'not-claimable', { ledger: (l) => { l.state = 'needs-triage'; } });
  await refused('owned', 'not-claimable', { ledger: (l) => { l.owner = { kind: 'contributor', id: 'c1', opid: 'op' }; l.state = 'claimed'; } });
  await refused('no work kind', 'no-work-kind', { ledger: (l) => { l.facets = {}; } });
  await refused('unapproved feature', 'feature-not-approved', { ledger: (l) => { l.facets = { workKind: 'feature', risk: 'low' }; }, orders: { schemaVersion: 1, programs: [{ name: 'f', tasks: ['implement'], decision: 'allow', scope: { kinds: ['feature'], origins: ['factory'] } }] } });
  await refused('standing orders silent', 'needs-maintainer', { orders: { schemaVersion: 1, programs: [] } });
  await refused('standing orders deny', 'denied', { orders: { schemaVersion: 1, programs: [{ name: 'no', tasks: ['implement'], decision: 'deny', scope: { kinds: ['bug'] } }] } });
  await refused('high risk', 'needs-maintainer', { ledger: (l) => { l.facets = { workKind: 'bug', risk: 'high' }; } });
  await refused('paused', 'paused', { ledger: (l) => { l.paused = { reason: 'escape', at: 'now', evidence: ['e'] }; } });
  await refused('remote model', 'preflight', {}, new Model(goodEdit, { ok: true, resolvedModel: 'hosted-x', isolation: 'seatbelt', failures: [] }));
  await refused('no isolation', 'preflight', {}, new Model(goodEdit, { ok: true, resolvedModel: 'local-default', failures: [] }));
  await refused('stopped', 'stopped', {}, undefined, (s) => s.setStopped(true));
  await refused('factory cap', 'factory-cap', {}, undefined, (s) => { const p = s.r.world.addIssue({ isPr: true, title: 'existing factory pr', author: 'warden-factory' }); void p; });
  { const s = await setup(); t.after(s.cleanup); const bare = s.r.world.addIssue({ title: 'bare issue' }); const out = await s.run(model(), { item: bare }); assert.equal(out.reason, 'no-ledger'); }
});

test('attempts persist: exhausted attempts block without another session; launch failures use a separate budget; an abort is an interruption with the attempt counted and nothing published', async (t) => {
  const s = await setup(); t.after(s.cleanup); const bad = new Model((ws) => writeFileSync(join(ws, 'sum.js'), FIXED));
  for (let k = 0; k < 3; k++) { const o = await s.run(bad); assert.equal(o.kind, 'insufficient-evidence'); if (k < 2) { const led = await ledgerOf(s.r, s.n); assert.equal(led.owner?.kind, 'factory'); } }
  const again = await s.run(bad); assert.equal(again.kind, 'blocked'); assert.equal(again.reason, 'attempts-exhausted'); assert.equal(bad.calls, 3);
  const rel = await ledgerOf(s.r, s.n); assert.equal(rel.state, 'ready'); assert.equal(rel.owner, null, 'an exhausted claim is released, not held');
  const s2 = await setup(); t.after(s2.cleanup); const remote = new Model(goodEdit, { ok: false, resolvedModel: 'local-default', isolation: 'seatbelt', failures: ['endpoint down'] });
  await s2.run(remote); await s2.run(remote); assert.equal(s2.rec()!.attempts.launchRetries, 2); assert.equal(s2.rec()!.attempts.completed, 0, 'a failed launch never consumes implementation attempts');
  const s3 = await setup(); t.after(s3.cleanup); const ac = new AbortController();
  const hang: AgentRunner = { name: 'h', pinnedVersion: '0', preflight: async () => GOOD, run: (_r, sig) => new Promise<SessionResult>((resolve) => { ac.abort(new Error('stop')); sig.addEventListener('abort', () => resolve({ outcome: 'interrupted', usage: { toolCalls: 0, modelTurns: 0, wallMs: 1 } })); if (sig.aborted) resolve({ outcome: 'interrupted', usage: { toolCalls: 0, modelTurns: 0, wallMs: 1 } }); }) };
  const o = await s3.run(hang, { signal: ac.signal }); assert.equal(o.kind, 'interrupted'); assert.equal(s3.rec()!.attempts.completed, 1); assert.equal(s3.published.length, 0);
});

void readFileSync;

test('no configured checks means no possible evidence: Implement refuses; the local outbox keeps a prepared branch when no PR can be opened', async (t) => {
  const s = await setup(); t.after(s.cleanup); const model = new Model(goodEdit);
  const none = await s.run(model, { cfg: { ...s.cfg, checks: [] } }); assert.equal(none.reason, 'no-checks-configured'); assert.equal(model.calls, 0);
  const { LocalOutboxPublisher } = await import('../src/implement/publishers.ts'); const outbox = join(s.root, 'outbox.git');
  const o = await s.run(new Model(goodEdit), { publisher: new LocalOutboxPublisher(outbox) });
  assert.equal(o.kind, 'prepared', JSON.stringify(o)); assert.equal(o.pr?.number, null); assert.match(git(outbox, ['log', '-1', '--format=%an', `refs/heads/warden/bug-${s.n}`]), /warden-factory/);
  assert.equal((await ledgerOf(s.r, s.n)).linked.length, 0, 'nothing was linked or announced: no PR exists');
});
