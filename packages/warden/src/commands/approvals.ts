import { Journal, submit } from '../writer/journal.ts';
import { LEDGER_MARK, makeIntent, parseLedger } from '../writer/protocol.ts';
import { checkAuthorized } from '../approvals/approvals.ts';
import { buildPolicy } from '../config/snapshot.ts';
import { SUBMIT_LOGIN, loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { writerDrain } from './writer.ts';
import type { Ledger } from '../state/model.ts';

export async function approvals(c: Ctx, sub: string): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'approvals: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const pol = buildPolicy(cfg, cfgs.orders); const be = openBackend(c, cfg);
  const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: {}, text: 'approvals: --item <number> is required' };
  if (sub === 'request') {
    const action = str(c.flags, 'action'); const revision = str(c.flags, 'revision');
    if (!action || !revision) return { code: 2, data: {}, text: 'approvals request: --action and --revision are required' };
    const s = be.open('submit'); if (!s) return { code: 4, data: {}, text: `approvals: ${be.unavailable}` };
    const type = str(c.flags, 'type') === 'feature-design' ? 'feature-design' : 'action';
    const intent = makeIntent({ v: 1, kind: 'approval-request', repo: cfg.repository, item, itemKind: (str(c.flags, 'item-kind') as 'issue' | 'pr') ?? 'issue', origin: 'deterministic',
      source: { kind: 'cli', id: `approval-request:${item}:${action}:${revision}:${str(c.flags, 'nonce') ?? ''}`, observedAt: new Date(c.now()).toISOString() }, actor: SUBMIT_LOGIN,
      payload: { type, action, subjectAuthor: str(c.flags, 'subject-author'), binding: { revision, policyDigest: str(c.flags, 'policy-digest') ?? pol.digest, evidenceDigest: str(c.flags, 'evidence-digest') ?? '' } } });
    let j: Journal | null = null; try { j = new Journal(openStorage(c, cfg.repository).journalPath); } catch { /* no local state: Actions-side */ }
    const { commentId } = await submit(s, cfg.inbox.inboxIssue, intent, j, undefined, pol.maxIntentBytes);
    const drained = c.flags.drain ? (await writerDrain(c)).data : undefined;
    return { code: 0, data: { opid: intent.opid, approvalId: 'apr_' + intent.opid.slice(3, 15), inboxCommentId: commentId, drained }, text: `approval requested: apr_${intent.opid.slice(3, 15)} (intent ${intent.opid}). Maintainers decide on GitHub with the command the writer posts on #${item}.` };
  }
  if (sub === 'revise') {
    const s = be.open('submit'); if (!s) return { code: 4, data: {}, text: `approvals: ${be.unavailable}` };
    const intent = makeIntent({ v: 1, kind: 'revision-update', repo: cfg.repository, item, itemKind: (str(c.flags, 'item-kind') as 'issue' | 'pr') ?? 'issue', origin: 'deterministic',
      source: { kind: 'cli', id: `revision:${item}:${str(c.flags, 'revision') ?? ''}:${str(c.flags, 'evidence-digest') ?? ''}:${str(c.flags, 'criteria') ?? ''}`, observedAt: new Date(c.now()).toISOString() }, actor: SUBMIT_LOGIN,
      payload: { revision: str(c.flags, 'revision'), head: str(c.flags, 'head'), evidenceDigest: str(c.flags, 'evidence-digest'), criteriaDigest: str(c.flags, 'criteria') } });
    await submit(s, cfg.inbox.inboxIssue, intent, null, undefined, pol.maxIntentBytes);
    const drained = c.flags.drain ? (await writerDrain(c)).data : undefined;
    return { code: 0, data: { opid: intent.opid, drained }, text: `revision/evidence update submitted (${intent.opid}); affected approvals are invalidated by the writer with a recorded reason` };
  }
  const s = be.open('operator'); if (!s) return { code: 4, data: {}, text: `approvals: ${be.unavailable}` };
  const lc = (await s.listComments(item)).find((x) => x.body.startsWith(LEDGER_MARK)); const l = lc ? (parseLedger(lc.body) as Ledger | null) : null;
  if (!l) return { code: 1, data: {}, text: `#${item} has no Warden ledger` };
  const now = s.now();
  if (sub === 'list') {
    const rows = Object.values(l.approvals).map((a) => ({ ...a, effectiveStatus: a.status === 'pending' && a.expiresAt && now >= Date.parse(a.expiresAt) ? 'expired' : a.status }));
    return { code: 0, data: { approvals: rows }, text: rows.map((a) => `${a.id} ${a.type}/${a.action} ${a.effectiveStatus}${a.decidedBy ? ` by ${a.decidedBy}` : ''}${a.expiresAt ? ` expires ${a.expiresAt}` : ' (persists until materially changed)'}`).join('\n') || 'no approvals' };
  }
  if (sub === 'check') {
    const action = str(c.flags, 'action'); if (!action) return { code: 2, data: {}, text: 'approvals check: --action required' };
    const r = checkAuthorized(l, action, pol, now);
    return { code: r.ok ? 0 : 1, data: { ...r }, text: r.ok ? `authorized by ${r.approval.id} (${r.approval.decidedBy})` : `NOT authorized: ${r.reason}` };
  }
  return { code: 2, data: {}, text: 'approvals: subcommands: request | revise | list | check' };
}
