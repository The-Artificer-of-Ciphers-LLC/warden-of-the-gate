import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanProvenance, hostPort, provenanceOf, provenanceText } from '../src/runner/provenance.ts';
import { reviewRecordIntent } from '../src/review/record.ts';
import { runReview } from '../src/review/slice.ts';
import type { Marker, ReviewKV, ReviewRecord } from '../src/review/slice.ts';
import { runTriage } from '../src/triage/slice.ts';
import type { TriageKV, TriageRecord } from '../src/triage/slice.ts';
import { FakeWorld } from '../src/github/fake.ts';
import { newLedger } from '../src/state/model.ts';
import { encodeLedger, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { rig, REPO, WRITER } from './helpers.ts';
import type { AgentRunner, PreflightReport, SessionResult } from '../src/runner/agent-runner.ts';

/** Owner ruling 2026-11-27: every review and auto-merge verdict records its endpoint tier, endpoint and exact model id. */
const PF: PreflightReport = { ok: true, resolvedModel: 'beamster/Qwen3.8-Flash-Next-Sushi-2bpw', isolation: 'seatbelt', harnessVersion: '2.2.7', tier: 'local-unverified', endpoint: '127.0.0.1:11234', failures: [] };
const done = (o: unknown): SessionResult => ({ outcome: 'completed', structuredOutput: o, usage: { toolCalls: 1, modelTurns: 1, wallMs: 5 } });
const runner = (pf: PreflightReport, out: unknown): AgentRunner => ({ name: 'opencode', pinnedVersion: '0', preflight: async () => pf, run: async () => done(out) });

test('provenance is built from what the preflight reported and says unknown for anything it did not, never a guess', () => {
  assert.deepEqual(provenanceOf(PF, 'opencode'), { tier: 'local-unverified', endpoint: '127.0.0.1:11234', model: 'beamster/Qwen3.8-Flash-Next-Sushi-2bpw', harness: 'opencode 2.2.7' });
  assert.deepEqual(provenanceOf({ resolvedModel: 'm' }, 'fake'), { tier: 'unknown', endpoint: 'unknown', model: 'm', harness: 'fake' });
  assert.equal(provenanceOf({ tier: 'made-up', endpoint: 'x', resolvedModel: 'm' }, 'fake').tier, 'unknown', 'a tier outside the vocabulary is not recorded as one');
  assert.match(provenanceText(provenanceOf(PF, 'opencode')), /Sushi-2bpw via opencode 2\.2\.7 on local-unverified endpoint 127\.0\.0\.1:11234/);
});

test('the endpoint is host and port only: userinfo, paths and queries cannot ride along; a payload provenance is validated whole', () => {
  assert.equal(hostPort('http://user:secret@127.0.0.1:11234/v1?key=abc'), '127.0.0.1:11234'); assert.equal(hostPort('127.0.0.1:11234'), '127.0.0.1:11234'); assert.equal(hostPort(''), null);
  const good = { tier: 'local-unverified', endpoint: '127.0.0.1:11234', model: 'm', harness: 'opencode 2.2.7' };
  assert.deepEqual(cleanProvenance(good), good);
  for (const bad of [null, 'x', { ...good, tier: 'cloud' }, { ...good, model: '' }, { ...good, model: 'a\nb' }, { ...good, harness: 'x'.repeat(200) }, { ...good, endpoint: 'a<b>' }, { tier: 'local-unverified' }]) assert.equal(cleanProvenance(bad), null, JSON.stringify(bad));
});

test('an accepted review records its provenance in the marker; an unreporting runner is recorded as unknown', async (t) => {
  const world = new FakeWorld(); world.clock = Date.parse('2026-11-18T12:00:00Z'); const n = world.addIssue({ isPr: true, title: 'p', author: 'outside' });
  world.issues.get(n)!.pull = { head: 'a1b2c3d4e5f6', base: 'base000000aa', ci: 'passing', files: [{ path: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }] };
  const dir = mkdtempSync(join(tmpdir(), 'warden-prov-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mk = () => { let s: string | null = null; const kv: ReviewKV = { read: () => (s ? (JSON.parse(s) as ReviewRecord) : null), write: (_i, r) => { s = JSON.stringify(r); } }; return kv; };
  const cfg = { maxAttempts: 3, budgets: { maxToolCalls: 20, maxModelTurns: 10, wallTimeMs: 60_000 }, localModels: [PF.resolvedModel!], expectedModel: PF.resolvedModel!, packetRoot: dir };
  const o = await runReview({ store: world.view('operator'), item: n, runner: runner(PF, { verdict: 'no findings', findings: [] }), kv: mk(), cfg, stopped: () => false });
  assert.equal(o.kind, 'accepted'); assert.deepEqual(o.marker?.provenance, { tier: 'local-unverified', endpoint: '127.0.0.1:11234', model: PF.resolvedModel, harness: 'opencode 2.2.7' });
  const bare = await runReview({ store: world.view('operator'), item: n, runner: runner({ ok: true, resolvedModel: PF.resolvedModel, isolation: 'seatbelt', failures: [] }, { verdict: 'no findings', findings: [] }), kv: mk(), cfg, stopped: () => false });
  assert.equal(bare.marker?.provenance?.tier, 'unknown'); assert.equal(bare.marker?.provenance?.endpoint, 'unknown'); assert.equal(bare.marker?.provenance?.model, PF.resolvedModel);
});

test('an accepted triage records its provenance too', async (t) => {
  const world = new FakeWorld(); world.clock = Date.parse('2026-11-18T12:00:00Z'); const n = world.addIssue({ title: 'Saving crashes', body: 'Steps: open, save, crash.', author: 'reporter' });
  const dir = mkdtempSync(join(tmpdir(), 'warden-prov-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let rec: TriageRecord | null = null; const kv: TriageKV = { read: () => (rec ? JSON.parse(JSON.stringify(rec)) : null), write: (_i, r) => { rec = JSON.parse(JSON.stringify(r)); } };
  const BUG = { kind: 'bug', outcome: 'likely-bug', summary: 'Crash on save', severity: 'major', risk: 'low', quickWin: true, evidence: [{ kind: 'reporter-claim', detail: 'App exits with code 1 when saving an empty document.' }] };
  const o = await runTriage({ store: world.view('operator'), item: n, runner: runner(PF, BUG), kv, cfg: { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 1000 }, localModels: [PF.resolvedModel!], expectedModel: PF.resolvedModel!, packetRoot: dir }, stopped: () => false });
  assert.equal(o.kind, 'accepted'); assert.equal((o.marker as { provenance?: { model: string; tier: string } }).provenance?.model, PF.resolvedModel); assert.equal((rec as TriageRecord | null)?.marker?.provenance?.tier, 'local-unverified');
});

test('live: the review-record intent carries provenance, the ledger keeps it, a malformed one is dropped (the review still records), and the merge note names the model and tier it rests on', async () => {
  const MARKER = (prov?: Marker['provenance']): Marker => ({ head: 'headaaaa0000', base: 'basebbbb0000', verdict: 'no findings', ci: 'passing', acceptedAt: '2026-11-27T10:00:00.000Z', policyDigest: 'digest1', findings: [], ...(prov ? { provenance: prov } : {}) });
  assert.deepEqual((reviewRecordIntent({ repo: REPO, item: 7, marker: MARKER(provenanceOf(PF, 'opencode')) }).payload as { provenance?: unknown }).provenance, provenanceOf(PF, 'opencode'));
  assert.equal('provenance' in reviewRecordIntent({ repo: REPO, item: 7, marker: MARKER() }).payload, false, 'a marker without provenance sends none: nothing is invented');
  const setup = async () => { const r = rig({ mode: 'live' }); const n = r.world.addIssue({ isPr: true, title: 'docs fix', author: 'contrib1' }); r.world.issues.get(n)!.pull = { head: 'headaaaa0000', base: 'basebbbb0000', ci: 'passing', files: [{ path: 'docs/guide.md', status: 'modified' }] }; await r.world.view('x').addLabel(n, 'warden:merge-ready'); const l = newLedger(REPO, n, 'pr'); l.state = 'merge-ready'; l.facets = { risk: 'low', workKind: 'documentation' }; await r.world.view(WRITER).createComment(n, encodeLedger(l)); return { r, n }; };
  const ledgerOf = async (r: ReturnType<typeof rig>, n: number) => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
  const notes = async (r: ReturnType<typeof rig>, n: number) => (await r.world.view('x').listComments(n)).map((c) => c.body).join('\n');
  const send = (r: ReturnType<typeof rig>, n: number, prov: unknown) => r.send({ kind: 'review-record', item: n, itemKind: 'pr', origin: 'ai', actor: 'warden-reviewer', payload: { head: 'headaaaa0000', base: 'basebbbb0000', verdict: 'no findings', severities: [], policyDigest: r.policy.digest, ...(prov === undefined ? {} : { provenance: prov }) } });
  const merge = (r: ReturnType<typeof rig>, n: number) => r.send({ kind: 'merge-request', item: n, itemKind: 'pr', origin: 'deterministic', actor: 'warden-actions', payload: { expectedHead: 'headaaaa0000' }, source: { kind: 'event', id: 'm1', observedAt: new Date(r.world.now()).toISOString() } });
  const a = await setup(); await send(a.r, a.n, provenanceOf(PF, 'opencode')); await merge(a.r, a.n); await a.r.writer().drain();
  assert.deepEqual((await ledgerOf(a.r, a.n)).review?.provenance, provenanceOf(PF, 'opencode')); assert.match(await notes(a.r, a.n), /review it rests on came from beamster\/Qwen3\.8-Flash-Next-Sushi-2bpw via opencode 2\.2\.7 on local-unverified endpoint 127\.0\.0\.1:11234/);
  const b = await setup(); await send(b.r, b.n, { tier: 'cloud', endpoint: 'x', model: 'm', harness: 'h' }); await merge(b.r, b.n); await b.r.writer().drain();
  assert.equal((await ledgerOf(b.r, b.n)).review?.head, 'headaaaa0000', 'the review still records'); assert.equal((await ledgerOf(b.r, b.n)).review?.provenance, undefined); assert.match(await notes(b.r, b.n), /no recorded provenance/);
});
