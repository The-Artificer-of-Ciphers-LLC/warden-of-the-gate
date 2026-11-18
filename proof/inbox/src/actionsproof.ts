import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { GithubStore, SANDBOX } from './github.ts';
import { Writer, defaultConfig } from './writer.ts';
import { parseReceipt, INTENT_MARK } from './protocol.ts';
import { sleep } from './util.ts';
import { counterInit, counterRead } from './overlap.ts';

const pexec = promisify(execFile);
const here = new URL('..', import.meta.url).pathname;
const gh = (...a: string[]) => execFileSync('gh', ['-R', SANDBOX, ...a], { encoding: 'utf8' });
interface Run { databaseId: number; status: string; conclusion: string; event: string; createdAt: string; workflowName: string }
const runs = (wf: string, n = 60): Run[] => JSON.parse(gh('run', 'list', '--workflow', wf, '-L', String(n), '--json', 'databaseId,status,conclusion,event,createdAt,workflowName'));
async function waitIdle(wf: string, maxMs = 600_000, settleMs = 8000) {
  const t0 = Date.now(); let quiet = 0;
  while (Date.now() - t0 < maxMs) { const active = runs(wf).filter((r) => r.status !== 'completed').length; quiet = active ? 0 : quiet + 1; if (quiet >= 2) return true; await sleep(active ? 4000 : settleMs / 2); }
  return false;
}
const tally = (rs: Run[]) => rs.reduce((a: Record<string, number>, r) => ((a[r.conclusion || r.status] = (a[r.conclusion || r.status] ?? 0) + 1), a), {});
const jsonLine = (log: string) => { for (const l of log.split('\n').reverse()) { const i = l.indexOf('{"'); if (i >= 0) { try { return JSON.parse(l.slice(i)); } catch { /* next */ } } } return null; };
async function dispatch(wf: string, fields: Record<string, string> = {}) {
  const before = new Set(runs(wf).map((r) => r.databaseId));
  gh('workflow', 'run', wf, ...Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`]));
  for (let i = 0; i < 30; i++) { await sleep(2000); const n = runs(wf).find((r) => !before.has(r.databaseId)); if (n) return n.databaseId; }
  throw new Error('dispatched run did not appear');
}
async function cli(...a: string[]) { const { stdout } = await pexec('node', [here + 'src/cli.ts', ...a], { env: process.env }); return stdout.trim(); }

export async function actionsProof() {
  const pc = JSON.parse(readFileSync(here + 'proof-config.json', 'utf8')); const store = new GithubStore();
  const wcfg = defaultConfig({ inboxIssue: pc.inbox, controlIssue: pc.control, globalControlIssue: pc.global, operators: pc.operators, allowedAuthors: pc.allowed, env: 'mac', holder: 'mac-proof', leaseTtlMs: pc.ttlMs, leaseWaitMs: 60000, fenceMarginMs: 4000 });
  const macWriter = () => new Writer(store, { ...wcfg, holder: 'mac-' + Date.now() });
  const out: any = { proof: 'PROOF-inbox Actions-side', repo: SANDBOX, node: process.version, at: new Date().toISOString(), config: { ...pc }, sections: [] as any[] };
  const section = (id: string, title: string, covers: string) => { const s: any = { id, title, covers, checks: [] as any[], observed: {} }; out.sections.push(s); s.ck = (d: string, p: boolean, o?: unknown) => { s.checks.push({ desc: d, pass: p, observed: o }); console.error(`${p ? '  ok ' : '  XX '}${id} ${d}`); }; return s; };
  const intentCount = async () => (await store.listComments(pc.inbox)).filter((c) => c.body.startsWith(INTENT_MARK)).length;
  const receipts = async () => (await store.listComments(pc.inbox)).map((c) => parseReceipt(c.body)).filter(Boolean) as NonNullable<ReturnType<typeof parseReceipt>>[];
  const itemEffects = async (tag: string) => (await store.listComments(pc.item)).filter((c) => c.body.includes('warden-effect') && c.body.includes(tag)).length;
  await waitIdle('p0-writer.yml');

  // A. Runner facts
  { const s = section('A1', 'Facts established on a real Actions runner', 'actor attribution; variables not usable for stop');
    const id = await dispatch('p0-writer.yml', { mode: 'facts' }); await waitIdle('p0-writer.yml'); const f = jsonLine(gh('run', 'view', String(id), '--log'));
    s.observed = f; s.ck('runner executed the TypeScript proof under Node >= 22 with GITHUB_TOKEN only', !!f && /^v(2[2-9]|[3-9]\d)/.test(f.node) && f.tokenSource === 'env:GITHUB_TOKEN', f);
    s.ck('GITHUB_TOKEN cannot read or write repo Actions variables (so stop is not stored in a variable)', !!f && String(f.variablesReadable).startsWith('HTTP') && String(f.variablesWritable).startsWith('HTTP'), { read: f?.variablesReadable, write: f?.variablesWritable }); }

  // B. flood beyond pending-queue capacity, real Actions concurrency group (1 running + 1 pending)
  { const s = section('B1', 'Real Actions: 12 doorbells vs concurrency queue; every intent still applied', 'triggers exceeding pending-queue capacity');
    const base = new Set(runs('p0-writer.yml').map((r) => r.databaseId)); const tag = 'flood' + Date.now().toString(36); const N = 12;
    const sub = JSON.parse(await cli('submit-notes', '--n', String(N), '--tag', tag)); await waitIdle('p0-writer.yml', 600_000, 20000);
    const mine = runs('p0-writer.yml').filter((r) => !base.has(r.databaseId) && r.event === 'issue_comment'); const t = tally(mine);
    let pend = (await new Writer(store, wcfg).scan()).pending.length; const afterQueue = { runs: mine.length, ...t, pendingIntents: pend };
    if (pend > 0) { await dispatch('p0-writer.yml', { mode: 'drain' }); await waitIdle('p0-writer.yml'); pend = (await new Writer(store, wcfg).scan()).pending.length; }
    const eff = await itemEffects(tag); s.observed = { submitted: sub.submitted, queue: afterQueue, afterBackstop: { pendingIntents: pend, effects: eff } };
    s.ck(`${N} intents submitted; Actions collapsed the doorbells (${mine.length} runs: ${JSON.stringify(t)})`, mine.length >= 1, afterQueue);
    s.ck('queue capacity was genuinely exceeded: GitHub cancelled some of the triggers', (t.cancelled ?? 0) > 0, t);
    s.ck(`all ${N} intents applied exactly once (effects counted by marker) after the surviving runs + one backstop sweep`, pend === 0 && eff === N, { pend, eff }); }

  // C. Actions outage: disable the workflow
  { const s = section('C1', 'Actions outage (workflow disabled): intents durable, visible; recovery by backstop; no local write path', 'Actions outage');
    await waitIdle('p0-writer.yml'); gh('workflow', 'disable', 'p0-writer.yml'); const base = new Set(runs('p0-writer.yml').map((r) => r.databaseId)); const tag = 'outage' + Date.now().toString(36);
    try { await cli('submit-notes', '--n', '5', '--tag', tag); await sleep(25_000);
      const newRuns = runs('p0-writer.yml').filter((r) => !base.has(r.databaseId)).length; const pend = (await new Writer(store, wcfg).scan()).pending.length;
      s.ck('no workflow run happened while disabled (events are not queued by GitHub)', newRuns === 0, { newRuns });
      s.ck('all 5 intents still durable and enumerable', pend >= 5, { pend }); s.ck('no effect was applied during the outage (no unsynchronized local write)', (await itemEffects(tag)) === 0);
    } finally { gh('workflow', 'enable', 'p0-writer.yml'); }
    await dispatch('p0-writer.yml', { mode: 'drain' }); await waitIdle('p0-writer.yml');
    const eff = await itemEffects(tag); s.observed = { effectsAfterRecovery: eff };
    s.ck('after the next trigger (dispatch standing in for the scheduled sweep) all 5 applied exactly once', eff === 5, { eff }); }

  // D. overlap: no concurrency control; Actions matrix + Mac processes at once
  { const s = section('D1', 'Overlap: 4 Actions runners + 2 Mac processes hammer one comment, no Actions concurrency setting', 'ACTUAL serialization across Mac and Actions');
    const pAct = 3; const run = async (mode: 'nolease' | 'lease', withMac: boolean) => {
      const cid = JSON.parse(await cli('counter-init')).commentId; const t0 = Date.now();
      const wfId = await dispatch('p0-overlap.yml', { comment: String(cid), mode, per: String(pAct) });
      const macs = withMac ? await Promise.all([0, 1].map((k) => cli('counter-worker', '--comment', String(cid), '--mode', mode, '--per', String(pAct), '--label', 'mac-' + k))) : [];
      await waitIdle('p0-overlap.yml', 900_000); const r = runs('p0-overlap.yml').find((x) => x.databaseId === wfId);
      const exp = (4 + (withMac ? 2 : 0)) * pAct; const fin = await counterRead(store, cid);
      return { mode, withMac, expected: exp, final: fin.n, lost: exp - fin.n, workflowConclusion: r?.conclusion, seconds: Math.round((Date.now() - t0) / 1000), macWorkers: macs.length }; };
    const ctl = await run('nolease', true); const ls = await run('lease', true); s.observed = { control: ctl, lease: ls };
    s.ck(`control (no lease): concurrent Mac+Actions workers lose updates (${ctl.lost} lost of ${ctl.expected})`, ctl.lost > 0, ctl);
    s.ck(`with lease: ${ls.expected} increments from 4 Actions runners + 2 Mac processes, zero lost`, ls.lost === 0 && ls.workflowConclusion === 'success', ls); }

  // E. stop across Mac and Actions
  { const s = section('E1', 'Stop visibility across Mac and Actions; non-operator tamper ignored; explicit resume', 'global/instance stop visibility');
    await waitIdle('p0-writer.yml'); const tag = 'stop' + Date.now().toString(36);
    await cli('stop'); const stopSub = JSON.parse(await cli('submit-notes', '--n', '2', '--tag', tag)); await waitIdle('p0-writer.yml', 300_000, 15000);
    const macRep = await macWriter().drain(); const st1 = JSON.parse(await cli('status'));
    s.ck('Actions writer (triggered by the inbox comments) halted on stop and the Mac writer halted too', macRep.halted === 'stop' && (await itemEffects(tag)) === 0, { macHalted: macRep.halted });
    s.ck('status shows both environments acknowledged the stop', ['actions', 'mac'].every((e) => st1.stopAcksBy.includes(e)), st1.stopAcksBy);
    const tid = await dispatch('p0-writer.yml', { mode: 'tamper-stop' }); await waitIdle('p0-writer.yml'); const tl = jsonLine(gh('run', 'view', String(tid), '--log'));
    s.observed = { tamper: tl };
    s.ck('github-actions[bot] removing the stop label does not resume: still stopped, tamper recorded', !!tl && tl.afterNonOperatorUnlabel.stopped === true && /non-operator|non-operator github-actions/.test(tl.afterNonOperatorUnlabel.reasons.join(' ')), tl?.afterNonOperatorUnlabel);
    await dispatch('p0-writer.yml', { mode: 'drain' }); await waitIdle('p0-writer.yml'); s.ck('a drain after the tamper still applies nothing', (await itemEffects(tag)) === 0);
    await cli('stop'); await cli('resume'); await dispatch('p0-writer.yml', { mode: 'drain' }); await waitIdle('p0-writer.yml');
    s.ck('explicit operator resume: pending intents applied exactly once by Actions', (await itemEffects(tag)) === stopSub.submitted, { effects: await itemEffects(tag) }); }

  const all = out.sections.flatMap((x: any) => x.checks); out.summary = { checks: all.length, passed: all.filter((c: any) => c.pass).length, failed: all.filter((c: any) => !c.pass).map((c: any) => c.desc) };
  for (const x of out.sections) delete x.ck;
  void counterInit; return out;
}
