import { budgetLines, budgetsOf, latestReplayFile, MUST_BE_ZERO_SCOPE, mustBeZeroLines, pilotGateLines, pilotGateOf } from '../metrics/pilot.ts';
import type { MustBeZeroOrUnknown, StoredReport } from '../metrics/pilot.ts';
import { readFileSync } from 'node:fs';
import { readLocalStop, ackList } from '../control/stop.ts';
import { readControls } from '../writer/control.ts';
import { Journal } from '../writer/journal.ts';
import { INTENT_MARK, LEDGER_MARK, parseIntent, parseLedger, parseReceipt } from '../writer/protocol.ts';
import { readPersistedCredentialStatus } from '../credentials/controller.ts';
import { buildPolicy } from '../config/snapshot.ts';
import { loadConfigs, openBackend, openStorage } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { redact } from '../util.ts';
import { existsSync } from 'node:fs';
import { CLI_VERSION } from '../version.ts';
import type { Ledger } from '../state/model.ts';

/** `warden status`: works with no model and no secrets. Local state is always shown; remote parts degrade to explicit `unreachable/unknown`. */
export async function status(c: Ctx): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'status: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const now = c.now();
  let st; try { st = openStorage(c, cfg.repository); } catch (e) { return { code: 1, data: { error: String(e) }, text: `status: ${(e as Error).message}` }; }
  const out: Record<string, unknown> = { cliVersion: CLI_VERSION, repository: cfg.repository, instance: st.id, mode: cfg.mode };
  out.policySource = cfgs.trusted;   // PRD §3 trusted base: where the policy in force came from, and policy files whose working-tree copy is NOT in force
  const local = readLocalStop(st); out.localStop = local;
  out.credentials = { automation: cfg.credentials.automation, controller: readPersistedCredentialStatus(st.credentialsDir, now), ceiling: existsSync(st.path('ceiling.json')) ? 'present' : 'absent' };
  const j = existsSync(st.journalPath) ? new Journal(st.journalPath) : null;
  out.journal = { unacked: j ? j.unacked().map((e) => ({ opid: e.opid, state: e.state, since: e.at })) : [] };
  out.decisionsRecorded = st.decisions().length;
  out.storage = { permissionProblems: st.permissionProblems() };
  out.lastSweep = st.readJson(st.path('last-sweep.json')) ?? { state: 'none recorded (sweep lands in P2)' };
  // PRD section 10/11: `status` shows the pilot gate, the must-be-zero counters and the measured budgets, and nothing else of the section 11 tracking list (that is `warden metrics`).
  let replayRep: StoredReport | null = null; const replayFile = latestReplayFile(st.path('replay')); if (replayFile) { try { replayRep = JSON.parse(readFileSync(replayFile, 'utf8')) as StoredReport; } catch { replayRep = null; } }
  out.pilotGate = replayRep && replayFile ? pilotGateOf(replayRep, replayFile) : { state: 'no replay report recorded', qualified: false };
  out.budgets = budgetsOf(replayRep, replayFile ?? '');
  let mustBeZero: MustBeZeroOrUnknown = { observed: false, reason: 'the remote is unreachable or not configured' }; out.mustBeZero = mustBeZero;
  const be = openBackend(c, cfg); const store = be.open('operator');
  const lines: string[] = [];
  if (!store) out.remote = { reachable: false, reason: be.unavailable };
  else try {
    const pol = buildPolicy(cfg, cfgs.orders);
    const global = cfg.inbox.globalControl ? { store: be.open('operator', cfg.inbox.globalControl.repository) ?? store, issue: cfg.inbox.globalControl.issue } : null;
    const ctl = await readControls(store, cfg.inbox.controlIssue, global, new Set(pol.operators), cfg.inbox.stopLabel);
    const acks = await ackList(store, cfg.inbox.controlIssue);
    const inbox = await store.listComments(cfg.inbox.inboxIssue);
    const receipts = new Map<number, string>(); for (const x of inbox) { const r = parseReceipt(x.body); if (r) receipts.set(r.intentCommentId, r.result); }
    const pending = inbox.filter((x) => x.body.startsWith(INTENT_MARK) && !receipts.has(x.id));
    const badReceipts = [...receipts.values()].filter((r) => r === 'failed' || r === 'quarantined').length;
    const items: Record<string, unknown>[] = []; let pausedScopes = 0; let invalidLedgers = 0;
    for (const it of await store.listIssues({ state: 'open' })) {
      if ([cfg.inbox.inboxIssue, cfg.inbox.controlIssue].includes(it.number)) continue;
      const lc = (await store.listComments(it.number)).find((x) => x.body.startsWith(LEDGER_MARK)); const l = lc ? (parseLedger(lc.body) as Ledger | null) : null;
      if (lc && (!l || l.repository !== cfg.repository || l.item !== it.number || l.kind !== (it.isPr ? 'pr' : 'issue')
        || !l.approvals || typeof l.approvals !== 'object' || Array.isArray(l.approvals) || !l.evidence || typeof l.evidence !== 'object'
        || Object.values(l.approvals).some((a) => !a || typeof a !== 'object' || typeof a.status !== 'string'))) {
        invalidLedgers++; items.push({ item: it.number, kind: it.isPr ? 'pr' : 'issue', state: 'invalid-ledger', blocker: { reason: 'ledger is malformed, unsupported or belongs to another instance; not adopted' } });
        continue;
      }
      if (!l) { items.push({ item: it.number, kind: it.isPr ? 'pr' : 'issue', state: 'not-adopted' }); continue; }
      if (l.paused) pausedScopes++;
      const appr = Object.values(l.approvals).map((a) => ({ id: a.id, action: a.action, status: a.status === 'pending' && a.expiresAt && now >= Date.parse(a.expiresAt) ? 'expired' : a.status, expiresAt: a.expiresAt }));
      items.push({ item: it.number, kind: l.kind, state: l.state, owner: l.owner?.id ?? null, facets: l.facets, blocker: l.blocker ?? null, attempts: l.attempts, obligations: l.obligations, approvals: appr,
        evidence: { revision: l.evidence.revision ?? null, updatedAt: l.evidence.updatedAt ?? null, ageHours: l.evidence.updatedAt ? Math.round((now - Date.parse(l.evidence.updatedAt)) / 3600_000 * 10) / 10 : null, fresh: l.evidence.updatedAt ? now - Date.parse(l.evidence.updatedAt) < 24 * 3600_000 : false } });
    }
    // duplicate accepted reviews: more than one APPLIED review-record for the same item and the same review identity (the intent's source id is head + policy + verdict + findings)
    const appliedReviews = new Map<string, number>(); for (const x of inbox) { const r = parseReceipt(x.body); if (!r || r.result !== 'applied') continue; const orig = inbox.find((y) => y.id === r.intentCommentId); const p = orig ? parseIntent(orig) : null; if (p && p.ok && p.intent.kind === 'review-record') { const k = `${p.intent.item}:${p.intent.source.id}`; appliedReviews.set(k, (appliedReviews.get(k) ?? 0) + 1); } }
    mustBeZero = { observed: true, unauthorizedEffects: { pausedScopes, quarantinedIntents: [...receipts.values()].filter((r) => r === 'quarantined').length }, duplicateAcceptedReviews: [...appliedReviews.values()].filter((n) => n > 1).length, lostStateRecoveryFailures: { invalidLedgers }, scope: MUST_BE_ZERO_SCOPE }; out.mustBeZero = mustBeZero;
    out.remote = { reachable: true, backend: be.name, controls: { stopped: ctl.stopped, unknown: ctl.unknown, globalDryRun: ctl.dryRun, reasons: ctl.reasons }, stopAcknowledgements: acks,
      inbox: { pending: pending.length, oldestPendingAgeMinutes: pending.length ? Math.round((now - Date.parse(pending[0].createdAt)) / 60000) : null, failedOrQuarantined: badReceipts, uncertain: pending.filter((x) => parseIntent(x).ok === false).length }, items };
    const mark = (s: string) => lines.push(s);
    mark(`remote: ${be.name}; stop ${ctl.unknown ? 'UNKNOWN (treated as stopped)' : ctl.stopped ? 'IN FORCE' : 'off'}; global dry-run ${ctl.dryRun ? 'ON' : 'off'}; ack envs: ${acks.map((a) => a.env).join(', ') || 'none'}`);
    mark(`inbox: ${pending.length} pending, ${badReceipts} failed/quarantined`);
    for (const it of items) mark(`  #${it.item} ${it.kind} ${it.state}${it.owner ? ` owner ${it.owner}` : ''}${(it.approvals as unknown[] | undefined)?.length ? ` approvals ${(it.approvals as { id: string; status: string }[]).map((a) => `${a.id}:${a.status}`).join(',')}` : ''}${it.blocker ? ` blocked(${(it.blocker as { reason: string }).reason})` : ''}`);
  } catch (e) { out.remote = { reachable: false, reason: redact(String((e as Error).message)).slice(0, 160) }; }
  const cs = (out.credentials as { controller: { operation: string; state: string }[] }).controller;
  const text = [`warden ${CLI_VERSION} status for ${cfg.repository} (instance ${st.id}, mode ${cfg.mode})`,
    `policy: ${cfgs.trusted.note}${cfgs.trusted.drift.length ? `; NOT in force (working tree differs from the trusted base): ${cfgs.trusted.drift.join(', ')}` : ''}`,
    `local stop: ${local.stopped ? `STOPPED since ${local.at} by ${local.by}` : 'running'}`,
    `credentials: automation ${cfg.credentials.automation}; ${cs.length ? cs.map((x) => `${x.operation}=${x.state}`).join(', ') : 'none issued yet'}; ceiling ${(out.credentials as { ceiling: string }).ceiling}`,
    `journal: ${(out.journal as { unacked: unknown[] }).unacked.length} unacknowledged local operation(s)`, `decisions recorded locally: ${out.decisionsRecorded}`,
    ...(out.remote && (out.remote as { reachable: boolean }).reachable === false ? [`remote: UNREACHABLE (${(out.remote as { reason: string }).reason}); remote stop/pending state is UNKNOWN`] : lines),
    `last sweep: ${JSON.stringify(out.lastSweep)}`,
    ...pilotGateLines(replayRep && replayFile ? pilotGateOf(replayRep, replayFile) : null), ...mustBeZeroLines(mustBeZero), ...budgetLines(out.budgets as ReturnType<typeof budgetsOf>)].join('\n');
  return { code: 0, data: out, text };
}
