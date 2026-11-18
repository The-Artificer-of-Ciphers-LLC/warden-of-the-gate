import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openSim } from '../github/filesim.ts';
import type { Ctx, Result } from './common.ts';
import { str } from './common.ts';

/** Simulated GitHub world for tests/evidence ONLY (`--world <file>`). Never a substitute for a live sandbox check. */
export async function sim(c: Ctx, sub: string): Promise<Result> {
  const world = str(c.flags, 'world'); if (!world) return { code: 2, data: {}, text: 'sim: --world <file> required' };
  const path = resolve(c.cwd, world); const { store, world: w, save } = openSim(path, str(c.flags, 'as') ?? 'contributor1');
  if (sub === 'init') {
    if (w.issues.size === 0) { w.addIssue({ title: 'warden-inbox' }); w.addIssue({ title: 'warden-control' }); if (c.flags['global-control']) w.addIssue({ title: 'warden-global-control' }); }
    save(); return { code: 0, data: { issues: [...w.issues.keys()] }, text: `sim world ${path}: inbox #1, control #2${c.flags['global-control'] ? ', global control #3' : ''}` };
  }
  if (sub === 'issue') {
    const n = w.addIssue({ title: str(c.flags, 'title') ?? 'issue', body: str(c.flags, 'body') ?? '', author: str(c.flags, 'as') ?? 'contributor1', isPr: !!c.flags.pr, draft: !!c.flags.draft, head: c.flags.pr ? 'a'.repeat(40) : undefined });
    save(); return { code: 0, data: { number: n }, text: `created #${n}` };
  }
  if (sub === 'comment') {
    const issue = Number(str(c.flags, 'issue')); const cm = await store.createComment(issue, str(c.flags, 'body') ?? '');
    const evOut = str(c.flags, 'event-out');
    if (evOut) { mkdirSync(dirname(resolve(c.cwd, evOut)), { recursive: true }); writeFileSync(resolve(c.cwd, evOut), JSON.stringify({ action: 'created', issue: { number: issue, ...(w.issues.get(issue)?.isPr ? { pull_request: {} } : {}) }, comment: { id: cm.id, body: cm.body, user: { login: cm.author }, created_at: cm.createdAt }, repository: { full_name: str(c.flags, 'repo') ?? '' } })); }
    return { code: 0, data: { commentId: cm.id }, text: `comment ${cm.id} by ${cm.author} on #${issue}` };
  }
  if (sub === 'label') { const n = Number(str(c.flags, 'issue')); const l = str(c.flags, 'label')!; if (str(c.flags, 'remove') === 'true' || c.flags.remove) await store.removeLabel(n, l); else await store.addLabel(n, l); return { code: 0, data: {}, text: `label ${l} ${c.flags.remove ? 'removed' : 'added'} on #${n} by ${store.actor()}` }; }
  if (sub === 'show') {
    const snap = w.snapshot(); const issue = str(c.flags, 'issue');
    const data = issue ? { issue: snap.issues.find((i) => i.number === Number(issue)), comments: snap.comments.filter((x) => x.issue === Number(issue)).map((x) => x.c) } : { issues: snap.issues.map((i) => ({ n: i.number, title: i.title, labels: i.labels, state: i.state })) };
    return { code: 0, data, text: JSON.stringify(data, null, 2) };
  }
  if (sub === 'advance') { w.clock = (w.clock ?? Date.now()) + Number(str(c.flags, 'ms') ?? 0); save(); return { code: 0, data: { clock: w.clock }, text: `sim clock advanced to ${new Date(w.clock).toISOString()}` }; }
  return { code: 2, data: {}, text: 'sim: init | issue | comment | label | show | advance' };
}
