// LIVE publish proof on the DISPOSABLE sandbox only: real App-issued contents+pull-request credential, real model, real push of ONE warden/* branch and ONE draft PR.
// Shortcuts, stated plainly: the issue's ledger comment is seeded by the owner's gh login (the serialized Actions writer is not exercised here), and the PR base is a
// fixture branch (never main). Every issued installation token is revoked at the end. Usage: node --experimental-strip-types proof/p4-publish/live-publish.ts SANDBOX_CLONE_DIR
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { parse, stringify } = createRequire(new URL('../../packages/warden/package.json', import.meta.url))('yaml') as typeof import('yaml');
import { main } from '../../packages/warden/src/cli.ts';
import { loadOrders, loadWarden } from '../../packages/warden/src/config/load.ts';
import { buildPolicy } from '../../packages/warden/src/config/snapshot.ts';
import { newLedger } from '../../packages/warden/src/state/model.ts';
import { encodeLedger } from '../../packages/warden/src/writer/protocol.ts';
import { InstanceStorage } from '../../packages/warden/src/storage/instance.ts';
import { ceilingPath } from '../../packages/warden/src/commands/common.ts';

const SB = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox'; const APP = { appId: 5819526, installationId: 183378787, appLogin: 'warden-p0-sandbox-app[bot]' };
const KEY = join(homedir(), '.warden-p0', 'warden-p0-sandbox-app-2026-11-18-publish.pem'); const OP = 'trek-e';
const clone = process.argv[2]; if (!clone || !existsSync(join(clone, '.git'))) throw new Error('pass the sandbox clone directory');
const out = new URL('./results/live-publish-2026-11-18.json', import.meta.url); if (existsSync(out)) throw new Error('never overwrite earlier evidence');
setTimeout(() => { console.error('watchdog: 30 min'); process.exit(9); }, 30 * 60_000).unref();
const gh = (a: string[], input?: string) => execFileSync('gh', a, { encoding: 'utf8', input });
const api = <T>(p: string, method = 'GET', body?: unknown): T => { const o = gh(['api', '--method', method, p, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined); return (o.trim() ? JSON.parse(o) : undefined) as T; };
const git = (...a: string[]) => { const r = spawnSync('git', ['-C', clone, '-c', `user.name=${OP}`, '-c', 'user.email=4738965+trek-e@users.noreply.github.com', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a[0]}: ${r.stderr.slice(0, 200)}`); return r.stdout.trim(); };

// track and later revoke every installation token this run mints
const tokens: string[] = []; const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => { const res = await realFetch(input, init); if (String(input).includes('/access_tokens') && res.status === 201) { const d = await res.clone().json() as { token: string }; tokens.push(d.token); } return res; }) as typeof fetch;

const res: Record<string, unknown> = { startedAt: new Date().toISOString(), sandbox: SB };
const stamp = Date.now().toString(36); const baseBranch = `fixture/p4-live-base-${stamp}`;
// 1. fixture base branch (NOT main): a one-line bug + a passing test
git('fetch', '-q', 'origin', 'main'); git('checkout', '-q', '-B', baseBranch, 'origin/main');
mkdirSync(join(clone, 'fixture/test'), { recursive: true });
writeFileSync(join(clone, 'fixture/sum.js'), 'exports.sumTo = (n) => { let t = 0; for (let i = 1; i < n; i++) t += i; return t; };\n');
writeFileSync(join(clone, 'fixture/test/sum.test.js'), "const { test } = require('node:test'); const assert = require('node:assert'); const { sumTo } = require('../sum.js'); test('sumTo(1)', () => assert.strictEqual(sumTo(1), 1));\n");
git('add', 'fixture'); git('commit', '-q', '-m', 'Add fixture for the P4 live publish proof'); git('push', '-q', 'origin', `HEAD:refs/heads/${baseBranch}`);
const baseSha = git('rev-parse', 'HEAD'); res.baseBranch = baseBranch; res.baseSha = baseSha;

// 2. throwaway instance (configuration lives outside git; the sandbox default branch is untouched)
const root = join(homedir(), '.warden-p0', `publish-${stamp}`); mkdirSync(root, { recursive: true, mode: 0o700 }); const repoDir = join(root, 'repo'); const home = join(root, 'home'); mkdirSync(repoDir, { recursive: true });
const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' } as NodeJS.ProcessEnv;
const cli = async (...a: string[]) => { let o = ''; let e = ''; const code = await main([...a, '--repo-dir', repoDir, '--home', home, '--backend', 'github', '--json'], { cwd: root, env, out: (s) => (o += s + '\n'), err: (s) => (e += s + '\n'), now: Date.now }); let data: any = null; try { data = JSON.parse(o); } catch { /* text */ } return { code, data, text: (o + e).slice(0, 600) }; };
const s1 = await cli('setup', '--create-config', '--repo', SB, '--maintainers', OP, '--create-orders', '--approve-ceiling'); res.setup = s1.code;   // non-zero is expected here: credentials are configured in the next step
const inboxN = (api<{ number: number }>(`repos/${SB}/issues`, 'POST', { title: '[P4 publish proof] inbox', body: 'Disposable proof inbox.' })).number;
const controlN = (api<{ number: number }>(`repos/${SB}/issues`, 'POST', { title: '[P4 publish proof] control', body: 'Disposable proof control issue.' })).number;
const cfgFile = join(repoDir, '.github/warden.yml'); const y = parse(readFileSync(cfgFile, 'utf8')) as any;
y.defaultBranch = baseBranch; y.runtime = { ...(y.runtime ?? {}), modelPool: ['warden-proof-qwen'] }; y.merge = { ...(y.merge ?? {}), factoryLogins: [APP.appLogin] };
y.inbox = { ...(y.inbox ?? {}), inboxIssue: inboxN, controlIssue: controlN }; y.verify = { checks: [{ id: 'unit', kind: 'test', command: process.execPath, args: ['--test', 'fixture/test/'] }] };
writeFileSync(cfgFile, stringify(y));
const c1 = await cli('credentials', 'configure', '--confirm', '--app-id', String(APP.appId), '--installation-id', String(APP.installationId), '--app-login', APP.appLogin, '--key-path', KEY); res.credentials = c1.code; if (c1.code !== 0) throw new Error('credentials: ' + c1.text);
const st = InstanceStorage.open(home, SB, { create: false });
st.writeJson(ceilingPath(st), { repositories: [SB], maxPermissions: { issues: 'write', metadata: 'read', contents: 'write', pull_requests: 'write' } });   // owner-approved: sandbox only

// 3. the work item: a real issue with a seeded, owner-approved, factory-claimed ledger
const n = (api<{ number: number }>(`repos/${SB}/issues`, 'POST', { title: 'sumTo(n) skips n', body: 'sumTo(3) returns 3 but should return 6 (1+2+3). The loop bound excludes n. The code is in fixture/sum.js.' })).number; res.issue = n;
const wc = loadWarden(repoDir); const oc = loadOrders(repoDir); const pol = buildPolicy(wc.value!, oc.present ? oc.value! : null);
const led: any = { ...newLedger(SB, n, 'issue'), state: 'claimed' as const, owner: { id: APP.appLogin, kind: 'factory', opid: 'op_seed' }, facets: { workKind: 'bug', risk: 'low' },
  approvals: { apr_live: { id: 'apr_live', type: 'action', action: 'implement', binding: { revision: 'r', policyDigest: pol.digest, evidenceDigest: '' }, bindingDigest: 'live', requestedBy: 'warden', requestedAt: new Date().toISOString(), expiresAt: null, status: 'approved', decidedBy: OP, decidedAt: new Date().toISOString() } } };
api(`repos/${SB}/issues/${n}/comments`, 'POST', { body: encodeLedger(led as never) });

// 4. dry run, then LIVE with the real model and the real publisher
const common = ['--item', String(n), '--operator-auth', 'gh', '--as', OP, '--source', clone, '--base-sha', baseSha];
const plan = await cli('run', '--task', 'implement', ...common, '--dry-run'); res.plan = plan.data?.plan ?? plan.text;
const t0 = Date.now();
const live = await cli('run', '--task', 'implement', ...common, '--runner', 'opencode', '--publisher', 'github', '--push-remote', 'github');
res.live = { code: live.code, outcome: live.data?.outcome, notice: live.data?.notice, reason: live.data?.reason, pr: live.data?.pr, ms: Date.now() - t0 };

// 5. independent verification from GitHub itself
try {
  const prs = api<any[]>(`repos/${SB}/pulls?state=open&per_page=50`).filter((p) => p.head.ref.startsWith('warden/'));
  res.pulls = prs.map((p) => ({ number: p.number, draft: p.draft, head: p.head.ref, headSha: p.head.sha, base: p.base.ref, author: p.user.login, url: p.html_url }));
  const pr = (live.data?.pr ?? {}) as { number?: number };
  const mine = prs.find((p) => p.number === pr.number); res.verified = !!mine && mine.draft === true && mine.base.ref === baseBranch && mine.head.ref === `warden/bug-${n}`;
  res.branchTip = mine ? api<any>(`repos/${SB}/git/ref/heads/${mine.head.ref}`).object.sha : null;
  res.mainUntouched = api<any>(`repos/${SB}/git/ref/heads/main`).object.sha === git('rev-parse', 'origin/main');
} catch (e) { res.verifyError = String((e as Error).message).slice(0, 300); }

// 6. revoke every token minted by this run
const revoked: number[] = [];
for (const t of tokens) { const r = await realFetch('https://api.github.com/installation/token', { method: 'DELETE', headers: { authorization: `Bearer ${t}` } }); revoked.push(r.status); }
res.tokens = { minted: tokens.length, revokeStatuses: revoked }; res.finishedAt = new Date().toISOString();
writeFileSync(out, JSON.stringify(res, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ live: res.live, verified: res.verified, tokens: res.tokens, pulls: res.pulls, mainUntouched: res.mainUntouched }, null, 1));
