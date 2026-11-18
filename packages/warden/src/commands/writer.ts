import { existsSync, readFileSync } from 'node:fs';
import { Writer, defaultWriterConfig } from '../writer/writer.ts';
import { Journal, reconcileJournal, submit } from '../writer/journal.ts';
import { makeIntent } from '../writer/protocol.ts';
import type { Origin } from '../writer/protocol.ts';
import { parseMaintainerCommand } from '../approvals/approvals.ts';
import { buildPolicy } from '../config/snapshot.ts';
import { InstanceStorage } from '../storage/instance.ts';
import { SUBMIT_LOGIN, WRITER_LOGIN, homeDir, loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';

function optStorage(c: Ctx, repo: string): InstanceStorage | null { try { return openStorage(c, repo, false); } catch { return null; } }

/** `warden writer drain`: the ONE serialized effect path (Actions entry point; also runnable on the Mac). Authenticates as the WRITER identity. */
export async function writerDrain(c: Ctx): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'writer: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const be = openBackend(c, cfg); const store = be.open('writer');
  if (!store) return { code: 4, data: { halted: 'no-credentials' }, text: `writer cannot run: ${be.unavailable}. Pending intents stay durable in the inbox.` };
  const pol = buildPolicy(cfg, cfgs.orders);
  const global = cfg.inbox.globalControl ? { store: be.open('writer', cfg.inbox.globalControl.repository) ?? store, issue: cfg.inbox.globalControl.issue } : null;
  const keyFile = str(c.flags, 'ledger-key-file'); const ledgerKey = keyFile ? readFileSync(keyFile, 'utf8').trim() : c.env.WARDEN_LEDGER_KEY;
  const w = new Writer(store, defaultWriterConfig({
    repository: cfg.repository, inboxIssue: cfg.inbox.inboxIssue, controlIssue: cfg.inbox.controlIssue, global, policy: pol,
    submitters: (str(c.flags, 'submitters') ?? SUBMIT_LOGIN).split(','), writerIdentities: (str(c.flags, 'writer-identities') ?? WRITER_LOGIN).split(','),
    env: str(c.flags, 'env') ?? 'actions', holder: c.env.GITHUB_RUN_ID ? `run-${c.env.GITHUB_RUN_ID}` : 'writer-' + process.pid, ledgerKey, assignable: () => true,
    leaseTtlMs: 30_000, leaseWaitMs: Number(str(c.flags, 'lease-wait-ms') ?? 20_000), fenceMarginMs: 5000, fenceCacheMs: Number(str(c.flags, 'fence-cache-ms') ?? 0),
  }));
  const rep = await w.drain();
  const st = optStorage(c, cfg.repository); let corpus = 0;
  if (st) {
    for (const d of rep.decisions) if (st.recordDecision(d as never)) corpus++;
    if (existsSync(st.journalPath)) { const sub = be.open('submit'); if (sub) await reconcileJournal(sub, cfg.inbox.inboxIssue, new Journal(st.journalPath), w.cfg.writerIdentities, pol.maxIntentBytes); }
  }
  const counts = rep.processed.reduce<Record<string, number>>((a, p) => ({ ...a, [p.result]: (a[p.result] ?? 0) + 1 }), {});
  const text = `writer ${rep.env}/${rep.holder} epoch ${rep.epoch}: ${rep.processed.length} processed ${JSON.stringify(counts)}; pending after: ${rep.pendingAfter.length}; repairs ${rep.repairs}; creates ${rep.creates}${rep.halted ? `\nHALTED (${rep.halted}): ${rep.haltReason ?? ''}` : ''}${corpus ? `\n${corpus} decision(s) added to the local decision corpus` : ''}`;
  return { code: rep.halted && rep.halted !== 'busy' ? 5 : 0, data: { ...rep, corpusAdded: corpus, backend: be.name }, text };
}

/** `warden event handle`: Actions doorbell. Turns a GitHub `issue_comment` event into a durable INTENT using the GitHub-attributed commenter (never comment text for identity). */
export async function eventHandle(c: Ctx): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'event: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const path = str(c.flags, 'event-path') ?? c.env.GITHUB_EVENT_PATH; const name = str(c.flags, 'event-name') ?? c.env.GITHUB_EVENT_NAME ?? 'issue_comment';
  if (!path || !existsSync(path)) return { code: 2, data: {}, text: 'event: --event-path (or GITHUB_EVENT_PATH) is required' };
  if (name !== 'issue_comment') return { code: 0, data: { ignored: name }, text: `event ${name}: no handler in P1 (intake/claim/sweep handlers land in P2); ignored, nothing lost: the sweep backstop will observe state` };
  const ev = JSON.parse(readFileSync(path, 'utf8')) as { action: string; issue: { number: number; pull_request?: unknown }; comment: { id: number; body: string; user: { login: string }; created_at?: string }; repository?: { full_name: string } };
  if (ev.action !== 'created') return { code: 0, data: { ignored: ev.action }, text: `event: comment ${ev.action} ignored (only newly created comments carry decisions; edits grant nothing)` };
  if (ev.repository && ev.repository.full_name.toLowerCase() !== cfg.repository.toLowerCase()) return { code: 0, data: { ignored: 'wrong-instance' }, text: 'event: for another repository; ignored' };
  const line = ev.comment.body.split('\n').map((l) => l.trim()).find((l) => l.startsWith('/warden'));
  if (!line) return { code: 0, data: { ignored: 'no-command' }, text: 'event: no /warden command in comment' };
  const command = parseMaintainerCommand(ev.comment.body);
  if (!command) return { code: 0, data: { ignored: 'unrecognized-command', line: line.slice(0, 80) }, text: `event: unrecognized /warden command (${line.slice(0, 60)}); ignored` };
  const { kind, payload } = command;
  const be = openBackend(c, cfg); const sub = be.open('submit');
  if (!sub) return { code: 4, data: {}, text: `event: cannot submit: ${be.unavailable}` };
  const itemKind = ev.issue.pull_request ? 'pr' : 'issue';
  const intent = makeIntent({ v: 1, kind, repo: cfg.repository, item: ev.issue.number, itemKind, origin: 'maintainer' as Origin, source: { kind: 'gh-comment', id: String(ev.comment.id), observedAt: ev.comment.created_at ?? new Date(c.now()).toISOString() }, actor: ev.comment.user.login, payload });
  const st = optStorage(c, cfg.repository); const j = st ? new Journal(st.journalPath) : null;
  const { commentId } = await submit(sub, cfg.inbox.inboxIssue, intent, j, undefined, cfg.inbox.maxIntentBytes);
  let drained: unknown;
  if (c.flags.drain) drained = (await writerDrain(c)).data;
  return { code: 0, data: { submitted: true, opid: intent.opid, inboxCommentId: commentId, actor: intent.actor, drained }, text: `event: ${kind} by ${intent.actor} submitted as ${intent.opid} (inbox comment ${commentId}); the writer records it and replies on the item. Authorization is decided by the writer.` };
}
void homeDir;
