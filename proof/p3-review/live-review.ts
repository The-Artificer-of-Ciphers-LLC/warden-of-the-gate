import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpStore } from '../../packages/warden/src/github/http.ts';
import { OpenCodeRunner } from '../../packages/warden/src/runner/opencode.ts';
import { runReview } from '../../packages/warden/src/review/slice.ts';
import type { ReviewRecord, ReviewKV } from '../../packages/warden/src/review/slice.ts';
import type { CredentialProvider, CredentialRequest } from '../../packages/warden/src/credentials/types.ts';

/** P3 first checkpoint, LIVE: one read-only shadow review of one pull request in the disposable sandbox, by the pinned OpenCode on the local
 *  LM Studio model. Read-only by construction (the store is wrapped read-only inside runReview); this script additionally snapshots the PR's
 *  comments/labels/head/state before and after to PROVE nothing was posted or written. Evidence harness, not a product command. */
const [, , flag, prArg, label] = process.argv; assert.equal(flag, '--live'); const pr = Number(prArg); assert.ok(Number.isInteger(pr) && pr > 0 && label);
const REPO = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox'; const MODEL = 'warden-proof-qwen';
const out = new URL(`./results/live-shadow-review-${label}.json`, import.meta.url); assert.ok(!existsSync(out), 'never overwrite earlier evidence');
const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' }).trim();
const creds: CredentialProvider = { token: async () => token, status: () => [] };
const store = new HttpStore(REPO, creds, { operation: 'submit', repository: REPO, permissions: { issues: 'read', metadata: 'read' } } as CredentialRequest, 'trek-e');
const gh = (a: string[]) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8' }));
const world = () => { const p = gh(['api', `repos/${REPO}/pulls/${pr}`]); const c = gh(['api', `repos/${REPO}/issues/${pr}/comments`]); const rv = gh(['api', `repos/${REPO}/pulls/${pr}/reviews`]);
  return { head: p.head.sha, state: p.state, labels: p.labels.map((l: any) => l.name).sort(), comments: c.length, reviews: rv.length, updatedAt: p.updated_at, commits: p.commits }; };
const before = world();
const dir = mkdtempSync(join(tmpdir(), 'warden-live-review-')); let mem: ReviewRecord | null = null;
const kv: ReviewKV = { read: () => mem, write: (_i, r) => { mem = JSON.parse(JSON.stringify(r)); } };
const runner = new OpenCodeRunner({ modelId: MODEL });
const cfg = { maxAttempts: 3, budgets: { maxToolCalls: 20, maxModelTurns: 10, wallTimeMs: 300_000 }, localModels: [MODEL], expectedModel: MODEL, packetRoot: join(dir, 'packets') };
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), repository: REPO, pull: pr, model: MODEL, harness: `opencode ${runner.pinnedVersion}`, sourceSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), before };
const t0 = Date.now();
report.preflight = await runner.preflight();
const first = await runReview({ store, item: pr, runner, kv, cfg, stopped: () => false });
report.first = { ...first, ms: Date.now() - t0 };
const second = await runReview({ store, item: pr, runner, kv, cfg, stopped: () => false });
report.second = second; report.after = world(); report.nothingWritten = JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...(report.after as object), updatedAt: 0 });
report.finishedAt = new Date().toISOString();
writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ preflightOk: (report.preflight as { ok: boolean }).ok, first: first.kind, notice: first.notice.slice(0, 200), findings: first.marker?.findings, second: second.kind, nothingWritten: report.nothingWritten }, null, 2));
