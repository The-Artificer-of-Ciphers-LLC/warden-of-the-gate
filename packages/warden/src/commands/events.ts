import { Journal } from '../writer/journal.ts';
import { makeIntent } from '../writer/protocol.ts';
import { submit } from '../writer/journal.ts';
import type { IntentCore } from '../writer/protocol.ts';
import { submitIntake, planSweep, submitSweep } from '../tasks/registry.ts';
import type { WardenConfig } from '../config/load.ts';
import { buildPolicy } from '../config/snapshot.ts';
import { openBackend, openStorage } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { iso } from '../util.ts';

/** GitHub event doorbells beyond comments. Each turns ONE event into durable, deterministic intents (never inference), attributed by GitHub's own event
 *  payload (never by text). Missing a doorbell loses nothing: the sweep and claim tasks are the backstop. The writer decides every intent. */
export async function handleOtherEvent(c: Ctx, cfg: WardenConfig, name: string, ev: any): Promise<Result> {
  const be = openBackend(c, cfg); const sub = be.open('submit'); if (!sub) return { code: 4, data: {}, text: `event: cannot submit: ${be.unavailable}` };
  const pol = buildPolicy(cfg, null); let journal: Journal | null = null; try { journal = new Journal(openStorage(c, cfg.repository).journalPath); } catch { /* Actions-side */ }
  const now = c.now(); const done = (what: string, data: Record<string, unknown> = {}): Result => ({ code: 0, data: { handled: name, action: ev.action, what, ...data }, text: `event ${name}/${ev.action}: ${what}` });
  const base = { submitStore: sub, inboxIssue: cfg.inbox.inboxIssue, now, journal };
  const send = async (core: Omit<IntentCore, 'v' | 'repo' | 'origin'> & { origin?: IntentCore['origin'] }) => { const it = makeIntent({ v: 1, repo: cfg.repository, origin: 'deterministic', ...core }); await submit(sub, cfg.inbox.inboxIssue, it, journal, undefined, pol.maxIntentBytes); return it.opid; };
  if (ev.repository?.full_name && String(ev.repository.full_name).toLowerCase() !== cfg.repository.toLowerCase()) return done('ignored: another repository');

  if (name === 'issues' && ['opened', 'reopened'].includes(ev.action)) { const r = await submitIntake(sub, cfg, { ...base, items: [ev.issue.number] }); return done(`intake submitted for #${ev.issue.number}`, r); }
  if (name === 'pull_request') {
    const n = ev.pull_request?.number as number;
    if (['opened', 'reopened', 'ready_for_review'].includes(ev.action)) { const r = await submitIntake(sub, cfg, { ...base, items: [n] }); return done(`intake submitted for PR #${n}`, r); }
    if (ev.action === 'converted_to_draft') { const f = await planSweep(sub, cfg, { now, items: [n] }); const s = await submitSweep(f, { ...base, repo: cfg.repository }); return done(`draft policy evaluated for PR #${n}`, s); }
    if (ev.action === 'synchronize') { const opid = await send({ kind: 'submission', item: n, itemKind: 'pr', source: { kind: 'push', id: `push:${n}:${ev.after ?? ev.pull_request.head?.sha}`, observedAt: iso(now) }, actor: ev.sender?.login ?? 'unknown', payload: {} }); return done(`push recorded for PR #${n} (the writer decides whether it is a timely submission)`, { opid }); }
  }
  if (name === 'pull_request_review' && ev.action === 'submitted') {
    const n = ev.pull_request.number as number; const state = String(ev.review?.state ?? '').toLowerCase();
    if (state === 'changes_requested' && ev.review.user?.login && ev.review.user.login !== ev.pull_request.user?.login) {
      const opid = await send({ kind: 'review-round', item: n, itemKind: 'pr', source: { kind: 'review', id: String(ev.review.id), observedAt: ev.review.submitted_at ?? iso(now) }, actor: ev.review.user.login, payload: { blocking: true } });
      return done(`blocking review recorded for PR #${n}: the author's fix window starts`, { opid });
    }
    return done('review ignored (not a blocking review by someone other than the author)');
  }
  return done('no handler for this event; nothing lost, the sweep and claim tasks observe state');
}
