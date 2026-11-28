import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store, PullInfo } from '../github/store.ts';
import { readOnly } from '../github/store.ts';
import { runValidated } from '../runner/agent-runner.ts';
import type { AgentRunner } from '../runner/agent-runner.ts';
import { classifyPreflight } from '../review/slice.ts';
import type { ReviewKV } from '../review/slice.ts';
import type { Finding } from '../review/schema.ts';
import type { PolicySnapshot } from '../config/snapshot.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { Ledger } from '../state/model.ts';
import { changes, cloneBase, commitAll, git } from '../git/workspace.ts';
import { DEFAULT_TEST_PATHS, frozenViolations, isGuardedPath, verifyFrozen } from '../verify/frozen.ts';
import { runChecks } from '../verify/executor.ts';
import { vetChanges } from '../factory/vet.ts';
import { assertFactoryBranch } from '../factory/takeover.ts';
import { IMPL_TOOLS } from './slice.ts';
import type { ImplConfig, IntentSink, PrPublisher } from './slice.ts';
import { iso } from '../util.ts';

/** P4 Rework: change a FACTORY branch only, only against the current named findings of an accepted review of the current head, verify with the trusted
 *  executor, push, and return to Review. Cycle accounting lives on the ledger (writer-owned): a completed attempt consumes a cycle even with no progress,
 *  a failed launch uses its own budget, and a replacement PR inherits the counts. Nothing here merges anything or advances the review marker. */
export const reworkResultSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['summary', 'addressed'],
  properties: { summary: { type: 'string', minLength: 1, maxLength: 300 }, addressed: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 60 } },
    /** ADR 0014 `test-dispute`: a frozen test judged wrong is reported, never edited around. */ testDispute: { type: 'object', additionalProperties: false, required: ['path', 'reason'], properties: { path: { type: 'string', minLength: 1, maxLength: 300 }, reason: { type: 'string', minLength: 1, maxLength: 800 } } } } } as const;
export interface ReworkRecord { v: 1; item: number; started: number; log: Array<{ at: string; event: string; detail?: string }> }
export interface ReworkKV { read(item: number): ReworkRecord | null; write(item: number, r: ReworkRecord): void }
export interface ReworkOpts { store: Store; item: number; policy: PolicySnapshot; cfg: ImplConfig & { reworkCycles: number }; runner: AgentRunner; kv: ReworkKV; reviews: ReviewKV; publisher: PrPublisher; intents: IntentSink; stopped: () => boolean | Promise<boolean>; signal?: AbortSignal; clock?: () => number }
export type ReworkKind = 'reworked' | 'no-progress' | 'blocked' | 'rejected' | 'interrupted';
export interface ReworkOutcome { kind: ReworkKind; notice: string; reason?: string; open?: number; cycles?: { used: number; max: number } }

export function buildReworkPrompt(pull: PullInfo, findings: Finding[], frozen: string[] = []): string {
  return ['You are fixing a factory pull request using only your file tools. Address ONLY the named review findings below, in the checked-out branch. Do not refactor, do not touch anything else.',
    'Do not edit CI definitions, workflow files, access or ORDERS/warden configuration, package manifest scripts, lint or type-check settings, and never skip, delete or weaken tests. You have no shell; the checks are run for you.',
    ...(frozen.length ? [`Acceptance tests for this change are FROZEN and so are all existing tests and test configuration: you cannot change them. Frozen acceptance tests: ${frozen.join(', ')}. If a frozen test is wrong, do NOT work around it: reply with "testDispute":{"path","reason"} and change nothing else.`] : []),
    'When done reply with a single JSON object: {"summary","addressed":[finding ids you fixed]}. List an id only if you changed code to fix it.',
    `PULL REQUEST #${pull.number}: ${pull.title}`, `FINDINGS (data): ${JSON.stringify(findings.map((f) => ({ id: f.id, severity: f.severity, path: f.path, line: f.line, rationale: f.rationale, correction: f.correction })))}`].join('\n');
}
const fresh = (item: number): ReworkRecord => ({ v: 1, item, started: 0, log: [] });

export async function runRework(o: ReworkOpts): Promise<ReworkOutcome> {
  const store = readOnly(o.store); const now = o.clock ?? Date.now; const c = o.cfg; const rec = o.kv.read(o.item) ?? fresh(o.item); const me = c.factoryLogins[0];
  const note = (event: string, detail?: string) => { rec.log.push({ at: iso(now()), event, detail }); o.kv.write(o.item, rec); };
  const blocked = (notice: string, reason: string): ReworkOutcome => { note('blocked', reason); return { kind: 'blocked', notice, reason }; };
  const send = (kind: 'rework-attempt', payload: Record<string, unknown>, id: string) => o.intents.submit({ v: 1, kind, repo: c.repository, item: o.item, itemKind: 'pr', origin: 'deterministic', source: { kind: 'rework', id, observedAt: iso(now()) }, actor: me, payload });
  if (await o.stopped()) return blocked('Stopped. No new model or verification work starts until a maintainer resumes.', 'stopped');
  let pull: PullInfo; try { pull = await store.getPull(o.item); } catch { return blocked(`#${o.item} is not a readable pull request.`, 'not-a-pull-request'); }
  if (pull.state !== 'open' || pull.draft) return blocked('Only open, non-draft pull requests are reworked.', 'not-open');
  const comments = await store.listComments(o.item); const l = comments.filter((x) => x.body.startsWith(LEDGER_MARK)).map((x) => parseLedger(x.body)).find(Boolean) as Ledger | undefined;
  if (!l) return blocked('This pull request has no Warden state.', 'no-ledger'); if (l.paused) return blocked('This item is paused after a critical escape.', 'paused');
  if (l.state !== 'needs-rework') return blocked(`Not awaiting rework: state ${l.state}.`, 'not-awaiting-rework');
  if (l.owner?.kind !== 'factory' || l.owner.id !== me) return blocked('Rework changes FACTORY branches only; this pull request is not factory-owned.', 'not-factory-owned');
  if (!pull.headRef) return blocked('The head branch name is unknown.', 'no-head-ref'); try { assertFactoryBranch(pull.headRef, '(contributor)'); } catch { return blocked(`Branch ${pull.headRef} is not a factory branch: Warden never edits other branches.`, 'not-a-factory-branch'); }
  if (!c.checks.length) return blocked('No repository checks are configured: no evidence is possible.', 'no-checks-configured');
  if (l.attempts.reworkCycles >= c.reworkCycles) return blocked(`All ${c.reworkCycles} rework cycles are used; a maintainer decides.`, 'cycles-exhausted');
  if (l.attempts.launchRetries >= c.maxLaunchRetries) return blocked('Launch retries are used up; a maintainer decides.', 'launch-retries-exhausted');
  if (rec.started - (l.attempts.reworkCycles + l.attempts.launchRetries) > c.maxLaunchRetries) return blocked('Repeated crashes before an attempt was recorded; a maintainer decides.', 'crash-loop');
  const rv = o.reviews.read(o.item)?.marker; if (!rv || rv.head !== pull.head) return blocked('There is no accepted review of the current head to name findings from: run Review first.', 'no-current-review');
  const gates = o.policy.merge?.gates; const findings = rv.findings.filter((f) => f.severity === 'blocker' || (gates ? gates[f.severity] : true)); if (!findings.length) return blocked('The accepted review has no blocking findings to rework.', 'nothing-to-rework');
  const pf = await o.runner.preflight().catch((e) => ({ ok: false, failures: [String(e)] })); const refusal = classifyPreflight(pf, c.localModels);
  if (refusal) { await send('rework-attempt', { outcome: 'launch-failed' }, `launch-failed:${o.item}:${l.attempts.launchRetries}`); return blocked(refusal, 'preflight'); }   // failed LAUNCH: its own persistent budget

  rec.started++; note('attempt-started', `cycle ${l.attempts.reworkCycles + 1}/${c.reworkCycles}`);
  const root = c.workRoot ?? tmpdir(); mkdirSync(root, { recursive: true }); const work = mkdtempSync(join(root, `warden-rework-${o.item}-`)); const ws = join(work, 'cand'); const packet = join(work, 'packet'); mkdirSync(packet);
  const cycleId = `completed:${o.item}:${l.attempts.reworkCycles}`;
  try {
    cloneBase(c.source, ws, pull.head);
    // ADR 0014: Rework keeps the freeze recorded on the PR's ledger when the factory opened it. A head whose frozen tests no longer match was changed outside Warden: no session starts and no cycle is spent.
    const globs = c.testPaths?.length ? c.testPaths : DEFAULT_TEST_PATHS; const fz = l.frozen ?? { baseCommit: pull.head, files: [] };
    const drift = verifyFrozen(ws, fz); if (drift.length) { rec.started--; return blocked(`The frozen acceptance tests on this branch no longer match the freeze recorded when it was opened (${drift.slice(0, 4).map((d) => `${d.path} ${d.kind}`).join(', ')}): the branch was changed outside Warden, so a maintainer decides. No session was started.`, 'frozen-drift'); }
    const deny = [...new Set([...fz.files.map((f) => f.path), ...git(ws, ['ls-files']).split('\n').filter((p) => p && isGuardedPath(p, globs))])];
    writeFileSync(join(packet, 'prompt.txt'), buildReworkPrompt(pull, findings, fz.files.map((f) => f.path)));
    const res = await runValidated(o.runner, { task: 'rework', item: o.item, packetDir: packet, workspace: { dir: ws, writable: true, denyWrite: deny }, tools: { allow: IMPL_TOOLS }, resultSchema: reworkResultSchema, budgets: c.budgets, expectedModel: c.localModels[0] }, { stopped: () => false, signal: o.signal, clock: o.clock });
    if (!res.accepted) { if (o.signal?.aborted || res.result?.outcome === 'interrupted') { note('interrupted', res.reason); return { kind: 'interrupted', notice: 'The rework session was cancelled and checkpointed; nothing was pushed.', reason: res.reason }; }
      await send('rework-attempt', { outcome: 'completed', openFindings: findings.length }, cycleId); return { kind: 'no-progress', notice: `The session did not complete (${res.reason}); this consumes a rework cycle.`, reason: res.reason, open: findings.length }; }
    const out = res.output as { summary: string; addressed: string[]; testDispute?: { path: string; reason: string } }; const ch = changes(ws, pull.head);
    if (out.testDispute) { note('test-dispute', `${out.testDispute.path}: ${out.testDispute.reason}`.slice(0, 300)); await send('rework-attempt', { outcome: 'completed', openFindings: findings.length }, cycleId); return { kind: 'rejected', notice: `The rework session disputes a frozen test (${out.testDispute.path}: ${out.testDispute.reason.slice(0, 200)}). Nothing was pushed, this consumes a rework cycle, and a maintainer decides which is right.`, reason: 'test-dispute', open: findings.length }; }
    const bad = frozenViolations(ws, fz, ch, globs);
    if (bad.length) { note('frozen-test-modified', bad.slice(0, 6).join(', ')); await send('rework-attempt', { outcome: 'completed', openFindings: findings.length }, cycleId); return { kind: 'rejected', notice: `The rework session changed tests or test configuration that were frozen (${bad.slice(0, 6).join(', ')}). Nothing was pushed and this consumes a rework cycle.`, reason: 'frozen-test-modified', open: findings.length }; }
    const vet = vetChanges({ changes: ch, policy: o.policy, task: 'rework', kind: String(l.facets.workKind ?? 'bug'), risk: l.facets.risk, maxFiles: c.maxFiles, maxPatchChars: c.maxPatchChars });
    if (!vet.ok) { note(vet.reason, vet.notice); await send('rework-attempt', { outcome: 'completed', openFindings: findings.length }, cycleId); return { kind: vet.reason === 'no-change' ? 'no-progress' : 'rejected', notice: `${vet.notice} This consumes a rework cycle: nothing was pushed.`, reason: vet.reason, open: findings.length }; }
    const cand = await runChecks({ workspace: ws, revision: 'rework-candidate', checks: c.checks, readonlyPaths: c.readonlyPaths, now });
    if (cand.some((r) => r.code !== 0 || r.timedOut)) { note('checks-failed', cand.filter((r) => r.code !== 0).map((r) => r.id).join()); await send('rework-attempt', { outcome: 'completed', openFindings: findings.length }, cycleId); return { kind: 'no-progress', notice: `The reworked branch fails its checks (${cand.filter((r) => r.code !== 0 || r.timedOut).map((r) => r.id).join(', ')}); it is not pushed and this consumes a rework cycle.`, reason: 'checks-failed', open: findings.length }; }
    const open = findings.filter((f) => !out.addressed.includes(f.id)).length;
    const sha = commitAll(ws, `Rework #${o.item}: ${out.summary}`, c.factoryAuthor);
    if (!o.publisher.update) throw new Error('publisher cannot update an existing branch');
    await o.publisher.update({ branch: pull.headRef, sha, workspace: ws, prNumber: o.item });
    await send('rework-attempt', { outcome: 'completed', openFindings: open }, cycleId); note('reworked', `${open} open`);
    return { kind: 'reworked', notice: `Pushed ${sha.slice(0, 8)} to ${pull.headRef}; ${findings.length - open} of ${findings.length} finding(s) addressed. The pull request returns to Review: Rework claims neither review nor merge.`, open };
  } finally { rmSync(work, { recursive: true, force: true }); }
}
