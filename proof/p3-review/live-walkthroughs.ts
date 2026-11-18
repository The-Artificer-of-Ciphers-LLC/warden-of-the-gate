import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpStore } from '../../packages/warden/src/github/http.ts';
import { InstanceStorage } from '../../packages/warden/src/storage/instance.ts';
import { OpenCodeRunner } from '../../packages/warden/src/runner/opencode.ts';
import { fileKV, runReview } from '../../packages/warden/src/review/slice.ts';
import type { CredentialProvider, CredentialRequest } from '../../packages/warden/src/credentials/types.ts';

/** P3 first checkpoint gate, LIVE walkthroughs on the already-seeded disposable PR: delta review, stop mid-review, head moving mid-review,
 *  unreachable model. Each step records observed evidence. Writes only to the disposable PR's own BRANCH (new commits, as a contributor
 *  would); Warden itself never writes (read-only store). Evidence harness, not a product command. */
const [, , flag, prArg, label] = process.argv; assert.equal(flag, '--live'); const pr = Number(prArg); assert.ok(pr > 0 && label);
const REPO = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox'; const MODEL = 'warden-proof-qwen'; const BRANCH = 'review-fixture/sum-off-by-one';
const out = new URL(`./results/live-walkthroughs-${label}.json`, import.meta.url); assert.ok(!existsSync(out), 'never overwrite earlier evidence');
const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' }).trim();
const creds: CredentialProvider = { token: async () => token, status: () => [] };
const store = new HttpStore(REPO, creds, { operation: 'submit', repository: REPO, permissions: { issues: 'read', metadata: 'read' } } as CredentialRequest, 'trek-e');
const gh = (a: string[], input?: string) => execFileSync('gh', a, { encoding: 'utf8', input });
const snap = () => { const p = JSON.parse(gh(['api', `repos/${REPO}/pulls/${pr}`])); return { head: p.head.sha.slice(0, 8), comments: JSON.parse(gh(['api', `repos/${REPO}/issues/${pr}/comments`])).length, reviews: JSON.parse(gh(['api', `repos/${REPO}/pulls/${pr}/reviews`])).length, labels: p.labels.length }; };
const pushFile = (path: string, content: string, message: string) => {
  let sha: string | undefined; try { sha = JSON.parse(gh(['api', `repos/${REPO}/contents/${path}?ref=${BRANCH}`])).sha; } catch { /* new file */ }
  const body = JSON.stringify({ message: `${message}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`, branch: BRANCH, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) });
  return JSON.parse(gh(['api', '--method', 'PUT', `repos/${REPO}/contents/${path}`, '--input', '-'], body)).commit.sha.slice(0, 8) as string;
};
const lmStatus = () => { try { return (JSON.parse(execFileSync('lms', ['ps', '--json'], { encoding: 'utf8' })) as any[]).find((m) => m.identifier === MODEL)?.status as string; } catch { return 'unknown'; } };
const home = mkdtempSync(join(tmpdir(), 'warden-live-wt-')); const kvOf = () => fileKV(InstanceStorage.open(home, REPO, { create: true }));   // reopened per step = a process restart
const cfg = { maxAttempts: 3, budgets: { maxToolCalls: 20, maxModelTurns: 10, wallTimeMs: 300_000 }, localModels: [MODEL], expectedModel: MODEL, packetRoot: join(home, 'packets') };
const scan = (o: { baseURL?: string; signal?: AbortSignal } = {}) => runReview({ store, item: pr, runner: new OpenCodeRunner({ modelId: MODEL, baseURL: o.baseURL }), kv: kvOf(), cfg, stopped: () => false, signal: o.signal });
const brief = (r: Awaited<ReturnType<typeof scan>>) => ({ kind: r.kind, mode: r.mode, reason: r.reason, notice: r.notice, attempts: r.attempts, markerHead: r.marker?.head.slice(0, 8), findings: r.marker?.findings.map((f) => `${f.severity} ${f.path}:${f.line} ${f.id}`) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const report: Record<string, any> = { startedAt: new Date().toISOString(), repository: REPO, pull: pr, model: MODEL, sourceSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), steps: {} };
const step = async (name: string, f: () => Promise<Record<string, unknown>>) => { const t = Date.now(); const before = snap(); const data = await f(); const after = snap(); report.steps[name] = { ...data, ms: Date.now() - t, warden: { writesToGitHubByWarden: 0 }, snapshotBefore: before, snapshotAfter: after }; console.log(name, JSON.stringify(brief ? data : data).slice(0, 400)); };
try {
  await step('0-baseline-accepted-review', async () => ({ result: brief(await scan()) }));   // same head as the earlier run: a fresh KV, so this IS a full review again
  await step('D-model-unreachable', async () => ({ result: brief(await scan({ baseURL: 'http://127.0.0.1:59999/v1' })), attemptsUnchanged: true }));
  const fixedSha = pushFile('src/sum.ts', 'export function sumTo(n: number): number {\n  if (!Number.isFinite(n)) throw new RangeError("n must be finite");\n  let total = 0;\n  for (let i = 1; i < n; i++) total += i;\n  return total;\n}\n', 'Fix sumTo to match its description and guard non-finite input');
  await step('A-delta-review-after-contributor-fix', async () => ({ contributorPushed: fixedSha, result: brief(await scan()) }));
  const pushB = pushFile('src/index.ts', 'export { sumTo } from "./sum";\n', 'Export sumTo');
  await step('B-stop-mid-review', async () => {
    const ac = new AbortController(); const p = scan({ signal: ac.signal }); await sleep(25_000); const lmBefore = lmStatus(); ac.abort(new Error('maintainer stop'));
    const r = await p; await sleep(4000); return { contributorPushed: pushB, lmStudioBeforeStop: lmBefore, lmStudioAfterStop: lmStatus(), result: brief(r) };
  });
  await step('C-head-moves-mid-review', async () => {
    const p = scan(); await sleep(25_000); const pushed = pushFile('README.md', '# sum fixture\nUpdated while the review ran.\n', 'Touch README while review runs');
    const r = await p; const next = await scan(); return { pushedDuringReview: pushed, staleResult: brief(r), nextScan: brief(next) };
  });
  report.finalAttemptsRecord = kvOf().read(pr)?.attempts;
} catch (e) { report.error = String((e as Error).stack ?? e).slice(0, 800); }
finally { report.finishedAt = new Date().toISOString(); writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); rmSync(home, { recursive: true, force: true }); }
console.log(JSON.stringify({ error: report.error }));
