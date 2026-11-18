import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FakeWorld } from '../src/github/fake.ts';
import { InstanceStorage } from '../src/storage/instance.ts';
import { gatherRetro } from '../src/retro/gather.ts';
import type { RetroPacket } from '../src/retro/gather.ts';
import { prepareRetroBranch, renderRetroReport, runRetro, validateRetro } from '../src/retro/slice.ts';
import type { RetroOutput } from '../src/retro/slice.ts';
import { LocalOutboxPublisher } from '../src/implement/publishers.ts';
import type { AgentRunner, PreflightReport, SessionResult, SessionRequest } from '../src/runner/agent-runner.ts';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const GOOD: PreflightReport = { ok: true, resolvedModel: 'local-default', isolation: 'seatbelt', failures: [] };
const done = (o: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } });
class Runner implements AgentRunner {
  readonly name = 'fake'; readonly pinnedVersion = '0'; calls = 0; out: unknown;
  constructor(out: unknown) { this.out = out; }
  async preflight() { return GOOD; }
  async run(_r: SessionRequest) { this.calls++; return done(this.out); }
}
const packet = (): RetroPacket => ({ window: { from: '2026-10-19T12:00:00Z', to: '2026-11-18T12:00:00Z', days: 30 },
  decisions: [{ id: 'd1', item: 5, decision: 'approved', action: 'merge', by: 'maint', at: '2026-11-10T00:00:00Z', reason: '', approvalId: 'a1' }, { id: 'd2', item: 6, decision: 'denied', action: 'auto-merge', by: 'maint', at: '2026-11-01T00:00:00Z', reason: 'too risky', approvalId: 'a2' }],
  denials: [{ id: 'n2', item: 6, action: 'auto-merge', at: '2026-11-01T00:00:00Z', reason: 'too risky', approvalId: 'a2' }], escapes: [{ id: 'e1', item: 9, reason: 'secret in diff', at: '2026-11-15T00:00:00Z' }],
  outcomes: { reviews: { accepted: 3 }, triage: {}, implement: {}, rework: {}, findingSeverities: { major: 2 } } });
const prop = (o: Partial<RetroOutput['proposals'][number]> = {}) => ({ id: 'p1', category: 'static-check' as const, title: 't', rationale: 'r', evidence: ['d1', 'e1'], example: 'x', validation: 'v', scope: 's', ...o });
const budgets = { maxToolCalls: 1, maxModelTurns: 1, wallTimeMs: 1000 };

test('gather: reads this instance only; denials are kept even outside the window; escapes come from paused ledgers; ids are stable', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'warden-retro-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const st = InstanceStorage.open(home, 'acme/widgets', { create: true }); const w = new FakeWorld(); w.clock = NOW;
  writeFileSync(st.decisionsPath, [{ approvalId: 'a0', item: 1, decision: 'denied', action: 'merge', by: 'm', at: '2026-01-01T00:00:00Z', reason: 'old' }, { approvalId: 'a1', item: 5, decision: 'approved', action: 'merge', by: 'm', at: '2026-11-10T00:00:00Z' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const p = await gatherRetro(st, w.view('operator'), { now: NOW, windowDays: 30 });
  assert.equal(p.decisions.length, 1); assert.equal(p.denials.length, 1, 'an old denial stays on the record'); assert.equal(p.denials[0].approvalId, 'a0'); assert.deepEqual(p.escapes, []);
});

test('validation: evidence must exist; a denied action cannot be re-proposed without citing the ruling and NEWER evidence; no-change is valid; both or neither is not', () => {
  const p = packet();
  assert.equal(validateRetro({ proposals: [prop()] }, p), null);
  assert.equal(validateRetro({ noChange: { reason: 'nothing recurs' }, proposals: [] }, p), null);
  assert.match(validateRetro({ proposals: [] }, p)!, /neither/); assert.match(validateRetro({ noChange: { reason: 'x' }, proposals: [prop()] }, p)!, /cannot both/);
  assert.match(validateRetro({ proposals: [prop({ evidence: ['d1', 'zzz'] })] }, p)!, /not in the packet: zzz/);
  assert.match(validateRetro({ proposals: [prop(), prop()] }, p)!, /duplicate/);
  const ex = (reconsideration?: { oldRuling: string; newEvidence: string[] }) => ({ proposals: [prop({ authorityExpansion: { action: 'auto-merge', reconsideration } })] });
  assert.match(validateRetro(ex(), p)!, /denied before/);
  assert.match(validateRetro(ex({ oldRuling: 'nope', newEvidence: ['d1'] }), p)!, /not a denial/);
  assert.match(validateRetro(ex({ oldRuling: 'a2', newEvidence: ['d2'] }), p)!, /newer than the ruling/, 'evidence from before the ruling does not count');
  assert.equal(validateRetro(ex({ oldRuling: 'a2', newEvidence: ['d1'] }), p), null);
  assert.equal(validateRetro({ proposals: [prop({ authorityExpansion: { action: 'something-new' } })] }, p), null, 'a never-denied expansion is allowed as TEXT, flagged for a maintainer');
});

test('runRetro: no evidence makes no model call; a valid result is proposals-only and flags authority expansion; an invalid one is rejected whole; stop and preflight block', async () => {
  const base = { budgets, localModels: ['local-default'], packetRoot: join(tmpdir(), 'warden-retro-packets'), stopped: () => false };
  const empty: RetroPacket = { ...packet(), decisions: [], denials: [], escapes: [], outcomes: { reviews: {}, triage: {}, implement: {}, rework: {}, findingSeverities: {} } };
  const r0 = new Runner({ proposals: [] }); assert.equal((await runRetro({ ...base, packet: empty, runner: r0 })).kind, 'no-data'); assert.equal(r0.calls, 0);
  const ok = await runRetro({ ...base, packet: packet(), runner: new Runner({ proposals: [prop({ authorityExpansion: { action: 'merge' } })] }) }); assert.equal(ok.kind, 'proposed'); assert.deepEqual(ok.needsMaintainer, ['p1']); assert.match(ok.notice, /Nothing was applied/);
  assert.equal((await runRetro({ ...base, packet: packet(), runner: new Runner({ noChange: { reason: 'quiet month' }, proposals: [] }) })).kind, 'no-change');
  assert.equal((await runRetro({ ...base, packet: packet(), runner: new Runner({ proposals: [prop({ evidence: ['made-up'] })] }) })).kind, 'rejected');
  assert.equal((await runRetro({ ...base, packet: packet(), runner: new Runner({ proposals: [{ id: 'x' }] }) })).kind, 'rejected', 'schema violations are rejected');
  assert.equal((await runRetro({ ...base, packet: packet(), runner: new Runner({ proposals: [] }), stopped: () => true })).kind, 'blocked');
});

test('report branch: documentation only, on a warden/retro-* branch in the local outbox; nothing authorizes anything', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'warden-retro-git-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const src = join(d, 'src'); const g = (...a: string[]) => spawnSync('git', a, { cwd: src, encoding: 'utf8' });
  spawnSync('git', ['init', '-q', '-b', 'main', src]); writeFileSync(join(src, 'a.txt'), 'x'); g('add', '.'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'); const sha = g('rev-parse', 'HEAD').stdout.trim();
  const r = await runRetro({ packet: packet(), runner: new Runner({ proposals: [prop()] }), budgets, localModels: ['local-default'], packetRoot: join(d, 'pk'), stopped: () => false });
  const report = renderRetroReport(packet(), r, NOW); assert.match(report, /nothing in this report has been applied/); assert.match(report, /## p1: t \(static-check\)/);
  const out = await prepareRetroBranch({ source: src, baseSha: sha, report, now: NOW, author: { name: 'warden', email: 'w@x.invalid' }, publisher: new LocalOutboxPublisher(join(d, 'outbox.git')), workRoot: join(d, 'work') });
  assert.equal(out.branch, 'warden/retro-2026-11-18'); assert.ok(existsSync(join(d, 'outbox.git')));
  const files = spawnSync('git', ['--git-dir', join(d, 'outbox.git'), 'diff', '--name-only', sha, out.branch], { encoding: 'utf8' }).stdout.trim(); assert.equal(files, 'docs/retro/RETRO-2026-11-18.md');
  assert.match(readFileSync(join(d, 'src/a.txt'), 'utf8'), /x/);
});
