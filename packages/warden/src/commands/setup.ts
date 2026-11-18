import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_WARDEN } from '../config/defaults.ts';
import { ORDERS_FILE, WARDEN_FILE, loadOrders, loadWarden } from '../config/load.ts';
import { DRY_RUN_LABEL } from '../writer/control.ts';
import { ceilingPath, homeDir, joinRepo, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { InstanceStorage } from '../storage/instance.ts';

const tpl = (n: string) => readFileSync(new URL(`../../templates/${n}`, import.meta.url), 'utf8');
type Check = { name: string; status: 'ok' | 'missing' | 'warn' | 'created' | 'exists-untouched' | 'skipped'; detail: string };

/** `warden setup`: checks prerequisites and creates ONLY explicitly approved missing starter files/labels. Never overwrites, never adopts backlog,
 *  never activates live AI. Each creation is a separate explicit flag. */
export async function setup(c: Ctx): Promise<Result> {
  const checks: Check[] = []; const add = (name: string, status: Check['status'], detail: string) => checks.push({ name, status, detail });
  const major = Number(process.versions.node.split('.')[0]); const minor = Number(process.versions.node.split('.')[1]);
  add('node', major > 22 || (major === 22 && minor >= 18) ? 'ok' : 'missing', `node ${process.versions.node} (needs >=22.18)`);
  add('platform', process.platform === 'darwin' ? 'ok' : 'warn', `${process.platform}: the MVP supports a prepared Mac only`);
  add('isolation', existsSync('/usr/bin/sandbox-exec') ? 'ok' : 'warn', existsSync('/usr/bin/sandbox-exec') ? 'Seatbelt (sandbox-exec) available (P0 selected backend; deprecated CLI, no memory cap)' : 'no Seatbelt: tasks that run candidate code are blocked until a real boundary exists');

  // starter files (never overwrite)
  const wf = joinRepo(c, WARDEN_FILE); const of = joinRepo(c, ORDERS_FILE);
  const repo = str(c.flags, 'repo'); const maint = (str(c.flags, 'maintainers') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const create = (file: string, rel: string, want: boolean, body: () => string) => {
    if (existsSync(file)) { add(rel, 'exists-untouched', 'present; never overwritten'); return; }
    if (!want) { add(rel, 'missing', `not present; re-run with ${rel === WARDEN_FILE ? '--create-config --repo <owner/name> --maintainers <a,b>' : '--create-orders'} to create the starter`); return; }
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body(), { flag: 'wx' }); add(rel, 'created', 'starter written (review and commit it yourself)');
  };
  if (c.flags['create-config'] && (!repo || !maint.length)) return { code: 2, data: { checks }, text: 'setup: --create-config needs --repo <owner/name> and --maintainers <login,login>' };
  create(wf, WARDEN_FILE, !!c.flags['create-config'], () => tpl('warden.yml').replace('{{repository}}', repo!).replace('{{maintainers}}', maint.map((m) => `  - ${m}`).join('\n')));
  create(of, ORDERS_FILE, !!c.flags['create-orders'], () => tpl('ORDERS.yaml'));

  const w = loadWarden(joinRepo(c)); const o = loadOrders(joinRepo(c));
  if (existsSync(wf)) add('config', w.ok ? 'ok' : 'warn', w.ok ? 'warden.yml valid' : w.errors.join('; '));
  if (existsSync(of)) add('orders', o.ok ? 'ok' : 'warn', o.ok ? 'ORDERS.yaml valid' : o.errors.join('; '));

  if (w.ok) {
    const cfg = w.value!; let st: InstanceStorage | null = null;
    try { st = openStorage(c, cfg.repository, true); add('local-state', 'ok', `protected instance directory ${st.dir} (0700; files 0600)`); }
    catch (e) { add('local-state', 'missing', String((e as Error).message)); }
    if (st && c.flags['approve-ceiling'] && !existsSync(ceilingPath(st))) {
      st.writeJson(ceilingPath(st), { repositories: [cfg.repository], maxPermissions: { issues: 'write', metadata: 'read' } }); st.securityAudit('ceiling-approved', { repository: cfg.repository });
      add('authority-ceiling', 'created', 'operator-approved ceiling written: issues:write, metadata:read on this repository only');
    } else if (st) add('authority-ceiling', existsSync(ceilingPath(st)) ? 'ok' : 'missing', existsSync(ceilingPath(st)) ? 'present (protected operator store)' : 're-run with --approve-ceiling to approve the narrow default ceiling (issues:write, metadata:read)');
    const be = openBackend(c, cfg); const store = be.open('operator');
    add('credentials', be.name === 'sim' ? 'warn' : 'missing', be.name === 'sim' ? 'simulated backend (no real credentials involved)' : be.unavailable ?? 'unavailable');
    if (store) {
      for (const [n, label] of [['inbox issue', cfg.inbox.inboxIssue], ['control issue', cfg.inbox.controlIssue]] as const) {
        const ok = await store.getIssue(label).then(() => true, () => false); add(n, ok ? 'ok' : 'missing', ok ? `#${label} exists` : `#${label} not found: create it and set its number in warden.yml (setup does not create issues)`);
      }
      const want = [...Object.values(cfg.labels.states), cfg.inbox.stopLabel, DRY_RUN_LABEL, cfg.labels.keepOpen];
      const have = new Set((await store.listLabels()).map((l) => l.name)); const missing = [...new Set(want)].filter((l) => !have.has(l));
      if (!missing.length) add('labels', 'ok', 'all projection labels exist');
      else if (!c.flags['create-labels']) add('labels', 'missing', `${missing.length} missing (${missing.slice(0, 3).join(', ')}...); re-run with --create-labels to create them`);
      else { for (const l of missing) await store.createLabel(l, 'Warden', '5319e7'); add('labels', 'created', `created ${missing.length} labels`); }
      (store as unknown as { onWrite?: () => void }).onWrite?.();
    } else add('labels', 'skipped', 'no GitHub access: labels not checked');
    void DEFAULT_WARDEN; void homeDir;
  }
  const missingAny = checks.some((x) => x.status === 'missing');
  const text = checks.map((x) => `${{ ok: 'ok     ', missing: 'MISSING', warn: 'warn   ', created: 'CREATED', 'exists-untouched': 'kept   ', skipped: 'skipped' }[x.status]} ${x.name}: ${x.detail}`).join('\n')
    + '\n\nsetup adopted no backlog and activated no live AI. Backlog adoption is a separate explicit step.';
  return { code: missingAny ? 1 : 0, data: { checks, adoptedBacklog: false, liveAiActivated: false }, text };
}
