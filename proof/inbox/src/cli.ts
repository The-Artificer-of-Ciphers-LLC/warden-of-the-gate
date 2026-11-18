import { GithubStore } from './github.ts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runProbes } from './probe.ts';
import { readFileSync } from 'node:fs';
import { actionsProof } from './actionsproof.ts';
import { render } from './render.ts';
import { runScenarios } from './scenarios.ts';
import { Writer, defaultConfig } from './writer.ts';
import type { WriterConfig } from './writer.ts';
import { counterInit, counterRead, counterWorker } from './overlap.ts';
import { readStop, setStop } from './control.ts';
import { Faults } from './util.ts';
import { makeIntent } from './protocol.ts';
import { submit } from './journal.ts';
import { INTENT_MARK, parseIntent, parseReceipt } from './protocol.ts';

const here0 = new URL('..', import.meta.url).pathname;
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
if (cmd === 'probe') {
  const gh = new GithubStore();
  const res = await runProbes(gh);
  const rep = { node: process.version, at: new Date().toISOString(), repo: gh.repo, auth: gh.tokenSource, skewMs: gh.skew, apiCalls: gh.stats, results: res };
  const out = flag('out'); if (out) { mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true }); writeFileSync(out, JSON.stringify(rep, null, 2)); }
  console.log(JSON.stringify(rep, null, 2));
}
if (cmd === 'render') { writeFileSync(flag('out', here0 + 'RESULTS.md')!, render(here0 + 'results')); }

if (cmd === 'scenarios') {
  const backend = (flag('backend', 'fake') as 'fake' | 'github');
  const only = flag('only')?.split(',');
  const { env, results } = await runScenarios(backend, only);
  let commit = 'unknown'; try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const report = { proof: 'PROOF-inbox scenarios', backend, repo: backend === 'github' ? new GithubStore().repo : 'in-memory fake', node: process.version, gitCommit: commit, at: new Date().toISOString(), leaseTtlMs: env.ttlMs, summary: { total: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).map((r) => r.id) }, results };
  const out = flag('out');
  if (out) { mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report.summary));
  process.exit(report.summary.failed.length ? 1 : 0);
}

// ---------- operational commands (used by the live Actions proof) ----------
const here = new URL('..', import.meta.url).pathname;
interface ProofConfig { inbox: number; control: number; global: number; item: number; counterIssue: number; holdMs: number; operators: string[]; allowed: string[]; ttlMs: number }
const loadCfg = (): ProofConfig => JSON.parse(readFileSync(here + 'proof-config.json', 'utf8'));
const writerCfg = (pc: ProofConfig, env: string): WriterConfig => defaultConfig({ inboxIssue: pc.inbox, controlIssue: pc.control, globalControlIssue: pc.global, operators: pc.operators, allowedAuthors: pc.allowed,
  env, holder: `${env}-${process.env.GITHUB_RUN_ID ?? process.pid}-${process.env.GITHUB_RUN_ATTEMPT ?? '0'}`, leaseTtlMs: pc.ttlMs, leaseWaitMs: 120_000, fenceMarginMs: 4000, holdMs: Number(flag('hold-ms', String(pc.holdMs))), assignable: (l) => pc.operators.includes(l) });

if (cmd === 'setup') {
  const gh = new GithubStore(); const me = flag('login', 'trek-e')!;
  const cfg: ProofConfig = { inbox: await gh.createIssue('warden-inbox (P0 proof)', 'Durable intent log. Machine-written; do not edit comments.'), control: await gh.createIssue('warden-control: instance (P0 proof)', 'Stop control. Label `warden:stop` set/removed by an operator.'),
    global: await gh.createIssue('warden-control: global (P0 proof)', 'Global stop control (same-repo stand-in; cross-repo read is unverified).'), item: await gh.createIssue('proof item', 'Item whose ledger the writer owns.'),
    counterIssue: await gh.createIssue('overlap counter', 'Shared counter comment for overlap experiment.'), holdMs: 12000, operators: [me], allowed: [me, 'github-actions[bot]'], ttlMs: 20000 };
  const { writeFileSync } = await import('node:fs'); writeFileSync(here + 'proof-config.json', JSON.stringify(cfg, null, 2) + '\n'); console.log(JSON.stringify(cfg));
}
if (cmd === 'drain') {
  const pc = loadCfg(); const gh = new GithubStore(); const w = new Writer(gh, writerCfg(pc, flag('env', process.env.GITHUB_ACTIONS ? 'actions' : 'mac')!));
  const rep = await w.drain(); console.log(JSON.stringify({ node: process.version, runId: process.env.GITHUB_RUN_ID ?? null, event: process.env.GITHUB_EVENT_NAME ?? null, actor: process.env.GITHUB_ACTOR ?? null, ...rep, api: gh.stats }));
}
if (cmd === 'submit-notes') {
  const pc = loadCfg(); const n = Number(flag('n', '5')); const tag = flag('tag', 'n' + Date.now().toString(36))!; const gh = new GithubStore(); const ids: number[] = [];
  for (let k = 0; k < n; k++) ids.push((await submit(gh, pc.inbox, makeIntent({ v: 1, kind: 'note', item: pc.item, actor: 'factory', source: { kind: 'local-result', id: `${tag}-${k}`, observedAt: new Date().toISOString() }, payload: { text: `${tag} #${k}` } }), null)).commentId);
  console.log(JSON.stringify({ tag, submitted: n, commentIds: ids }));
}
if (cmd === 'status') {
  const pc = loadCfg(); const gh = new GithubStore(); const w = new Writer(gh, writerCfg(pc, 'mac')); const sc = await w.scan(); const now = gh.now();
  const st = await w.stopState(); const top = await w.lease.top(); const byResult: Record<string, number> = {};
  for (const r of sc.receipts.values()) byResult[r.result] = (byResult[r.result] ?? 0) + 1;
  const stopAcks = (await gh.listComments(pc.control)).filter((c) => c.body.includes('warden-stop-ack')).map((c) => c.body.match(/env=(\S+)/)?.[1]);
  console.log(JSON.stringify({ inbox: pc.inbox, pending: sc.pending.length, oldestPendingAgeSec: sc.pending.length ? Math.round((now - Date.parse(sc.pending[0].createdAt)) / 1000) : 0, receipts: byResult, lease: top && { epoch: top.epoch, holder: top.d.holder, released: top.d.released, expiresInMs: top.d.expiresAt - now }, stop: st, stopAcksBy: stopAcks, apiCalls: gh.stats }, null, 1));
}
if (cmd === 'stop' || cmd === 'resume') { const pc = loadCfg(); const gh = new GithubStore(); await setStop(gh, flag('scope') === 'global' ? pc.global : pc.control, cmd === 'stop'); console.log(JSON.stringify(await readStop(gh, pc.control, new Set(pc.operators), 'instance'))); }
if (cmd === 'tamper-stop') {
  const pc = loadCfg(); const gh = new GithubStore(); await gh.removeLabel(pc.control, 'warden:stop');
  console.log(JSON.stringify({ actor: process.env.GITHUB_ACTOR ?? 'local', afterNonOperatorUnlabel: await readStop(gh, pc.control, new Set(pc.operators), 'instance') }));
}
if (cmd === 'counter-init') { const pc = loadCfg(); const gh = new GithubStore(); console.log(JSON.stringify({ commentId: await counterInit(gh, pc.counterIssue) })); }
if (cmd === 'counter-worker') {
  const gh = new GithubStore(); const e = await counterWorker(gh, Number(flag('comment')), { mode: flag('mode', 'lease') as 'lease' | 'nolease', perWorker: Number(flag('per', '3')), ttlMs: Number(flag('ttl', '20000')), label: flag('label', 'w')! });
  console.log(JSON.stringify({ label: flag('label'), epochs: e }));
}
if (cmd === 'counter-read') { const gh = new GithubStore(); const c = await counterRead(gh, Number(flag('comment'))); console.log(JSON.stringify({ n: c.n, historyLen: c.history.length, expected: Number(flag('expected', '0')) })); }
if (cmd === 'actions-facts') {
  // facts only an Actions runner can establish
  const gh = new GithubStore(); const out: Record<string, unknown> = { actor: process.env.GITHUB_ACTOR, event: process.env.GITHUB_EVENT_NAME, runner: process.env.RUNNER_OS, node: process.version, tokenSource: gh.tokenSource };
  try { const r = await gh.req('GET', '/actions/variables'); out.variablesReadable = r.status; } catch (e: any) { out.variablesReadable = 'HTTP ' + e.status; }
  try { await gh.req('POST', '/actions/variables', { name: 'WARDEN_P0_PROBE', value: '1' }); out.variablesWritable = true; await gh.req('DELETE', '/actions/variables/WARDEN_P0_PROBE'); } catch (e: any) { out.variablesWritable = 'HTTP ' + e.status; }
  console.log(JSON.stringify(out));
}
void Faults; void INTENT_MARK; void parseIntent; void parseReceipt;

if (cmd === 'actions-proof') {
  const out = await actionsProof(); const f = flag('out');
  if (f) { mkdirSync(f.replace(/\/[^/]*$/, ''), { recursive: true }); writeFileSync(f, JSON.stringify(out, null, 2)); }
  console.log(JSON.stringify(out.summary)); process.exit(out.summary.failed.length ? 1 : 0);
}
