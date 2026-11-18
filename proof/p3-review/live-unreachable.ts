import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpStore } from '../../packages/warden/src/github/http.ts';
import { InstanceStorage } from '../../packages/warden/src/storage/instance.ts';
import { OpenCodeRunner } from '../../packages/warden/src/runner/opencode.ts';
import { fileKV, runReview } from '../../packages/warden/src/review/slice.ts';
import type { CredentialProvider, CredentialRequest } from '../../packages/warden/src/credentials/types.ts';

/** Live walkthrough D done properly: the earlier harness ran it when the head was unchanged, so reuse (correctly) answered before preflight. Here a NEW
 *  head needs review, the model endpoint is unreachable, and the scan must refuse at preflight with no attempt spent and nothing written. */
const [, , flag, prArg, label] = process.argv; assert.equal(flag, '--live'); const pr = Number(prArg);
const REPO = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox'; const MODEL = 'warden-proof-qwen'; const BRANCH = 'review-fixture/sum-off-by-one';
const out = new URL(`./results/live-unreachable-${label}.json`, import.meta.url); assert.ok(!existsSync(out));
const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' }).trim();
const creds: CredentialProvider = { token: async () => token, status: () => [] };
const store = new HttpStore(REPO, creds, { operation: 'submit', repository: REPO, permissions: { issues: 'read', metadata: 'read' } } as CredentialRequest, 'trek-e');
const gh = (a: string[], input?: string) => execFileSync('gh', a, { encoding: 'utf8', input });
const sha = JSON.parse(gh(['api', `repos/${REPO}/contents/README.md?ref=${BRANCH}`])).sha;
const pushed = JSON.parse(gh(['api', '--method', 'PUT', `repos/${REPO}/contents/README.md`, '--input', '-'], JSON.stringify({ message: 'Touch README for the unreachable-model walkthrough\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>', branch: BRANCH, sha, content: Buffer.from('# sum fixture\nunreachable-model walkthrough\n').toString('base64') }))).commit.sha.slice(0, 8);
const home = mkdtempSync(join(tmpdir(), 'warden-live-un-')); const kv = fileKV(InstanceStorage.open(home, REPO, { create: true }));
const before = JSON.parse(gh(['api', `repos/${REPO}/issues/${pr}/comments`])).length;
const r = await runReview({ store, item: pr, runner: new OpenCodeRunner({ modelId: MODEL, baseURL: 'http://127.0.0.1:59999/v1' }), kv, stopped: () => false,
  cfg: { maxAttempts: 3, budgets: { maxToolCalls: 5, maxModelTurns: 5, wallTimeMs: 60_000 }, localModels: [MODEL], expectedModel: MODEL, packetRoot: join(home, 'p') } });
const after = JSON.parse(gh(['api', `repos/${REPO}/issues/${pr}/comments`])).length;
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), repository: REPO, pull: pr, contributorPushed: pushed, result: { kind: r.kind, reason: r.reason, notice: r.notice, attempts: r.attempts }, commentsBefore: before, commentsAfter: after }, null, 2) + '\n', { flag: 'wx' });
rmSync(home, { recursive: true, force: true }); console.log(JSON.stringify({ kind: r.kind, reason: r.reason, notice: r.notice, attempts: r.attempts, pushed }));
