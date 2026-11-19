// Retry of the live publish against the instance, issue and fixture branch that live-publish.ts already set up (attempt 1 failed with HTTP 422: the installation lacked Contents write).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { main } from '../../packages/warden/src/cli.ts';
const SB = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox'; const OP = 'trek-e';
const [, , root, clone] = process.argv; const prev = JSON.parse(readFileSync(new URL('./results/live-publish-2026-11-18-attempt1-422.json', import.meta.url), 'utf8'));
const out = new URL('./results/live-publish-2026-11-18.json', import.meta.url); if (existsSync(out)) throw new Error('never overwrite earlier evidence');
setTimeout(() => process.exit(9), 30 * 60_000).unref();
const gh = (a: string[]) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8' }));
const tokens: string[] = []; const realFetch = globalThis.fetch;
globalThis.fetch = (async (i: any, init?: any) => { const r = await realFetch(i, init); if (String(i).includes('/access_tokens') && r.status === 201) tokens.push((await r.clone().json() as { token: string }).token); return r; }) as typeof fetch;
const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' } as NodeJS.ProcessEnv;
let o = ''; let e = ''; const t0 = Date.now();
const code = await main(['run', '--task', 'implement', '--item', String(prev.issue), '--operator-auth', 'gh', '--as', OP, '--source', clone, '--base-sha', prev.baseSha, '--runner', 'opencode', '--publisher', 'github', '--push-remote', 'github', '--repo-dir', `${root}/repo`, '--home', `${root}/home`, '--backend', 'github', '--json'], { cwd: root, env, out: (s) => (o += s + '\n'), err: (s) => (e += s + '\n'), now: Date.now });
let data: any = null; try { data = JSON.parse(o); } catch { /* text */ }
const res: Record<string, unknown> = { ...prev, failure: undefined, retriedAfter: 'installation granted Contents write', live: { code, outcome: data?.outcome, notice: data?.notice, reason: data?.reason, pr: data?.pr, evidence: data?.evidence, ms: Date.now() - t0, text: data ? undefined : (o + e).slice(0, 800) } };
try {
  const prs = gh(['api', `repos/${SB}/pulls?state=open&per_page=50`]).filter((p: any) => p.head.ref.startsWith('warden/'));
  res.pulls = prs.map((p: any) => ({ number: p.number, draft: p.draft, head: p.head.ref, headSha: p.head.sha, base: p.base.ref, author: p.user.login, url: p.html_url }));
  const mine = prs.find((p: any) => p.number === data?.pr?.number);
  res.verified = !!mine && mine.draft === true && mine.base.ref === prev.baseBranch && mine.head.ref === `warden/bug-${prev.issue}`;
  res.branchTip = mine ? gh(['api', `repos/${SB}/git/ref/heads/${mine.head.ref}`]).object.sha : null;
  res.mainUnchanged = gh(['api', `repos/${SB}/git/ref/heads/main`]).object.sha;
} catch (x) { res.verifyError = String((x as Error).message).slice(0, 300); }
const revoked: number[] = []; for (const t of tokens) revoked.push((await realFetch('https://api.github.com/installation/token', { method: 'DELETE', headers: { authorization: `Bearer ${t}` } })).status);
res.tokens = { minted: tokens.length, revokeStatuses: revoked }; res.finishedAt = new Date().toISOString();
writeFileSync(out, JSON.stringify(res, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ live: res.live, verified: res.verified, branchTip: res.branchTip, tokens: res.tokens, pulls: res.pulls }, null, 1));
