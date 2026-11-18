import { resolve } from 'node:path';
import { exportData, inventory, purgeData, SCOPES } from '../data/data.ts';
import type { Scope } from '../data/data.ts';
import { loadConfigs, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';

/** `warden data export|purge`: scoped, redacted, confirmed, receipted; works with no model and no network. */
export async function data(c: Ctx, sub: string): Promise<Result> {
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'data: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; let st; try { st = openStorage(c, cfg.repository); } catch (e) { return { code: 4, data: {}, text: `data blocked: ${(e as Error).message}` }; }
  const ret = { transcriptDays: cfg.retention.transcriptDays, securityAuditDays: cfg.retention.securityAuditDays }; const now = c.now();
  if (!sub || sub === 'status') { const inv = inventory(st, now, ret); return { code: 0, data: { inventory: inv }, text: inv.map((x) => `${x.scope}: ${x.files} file(s), ${x.bytes} bytes${x.expired ? `, ${x.expired} past retention` : ''}${x.protected ? ` (${x.protected})` : ''}`).join('\n') }; }
  const raw = str(c.flags, 'scope'); if (!raw) return { code: 2, data: {}, text: `data ${sub}: --scope <${SCOPES.join('|')}[,..]> is required (an explicit selection, never "everything")` };
  const scopes = raw.split(',') as Scope[]; const bad = scopes.filter((s) => !SCOPES.includes(s)); if (bad.length) return { code: 2, data: {}, text: `data ${sub}: unknown scope ${bad.join(',')}` };
  try {
    if (sub === 'export') {
      const out = str(c.flags, 'out'); if (!out) return { code: 2, data: {}, text: 'data export: --out FILE is required' };
      const r = exportData(st, { scopes, out: resolve(c.cwd, out), now, confirm: !!c.flags.confirm });
      return { code: r.written ? 0 : 2, data: { ...r }, text: r.written ? `exported ${r.files} file(s) (${r.bytes} bytes) to ${out}; credentials are never exported and credential-shaped values are redacted` : `data export (preview): ${r.files} file(s), about ${r.bytes} bytes; re-run with --confirm to write ${out}` };
    }
    if (sub === 'purge') {
      const days = str(c.flags, 'older-than-days'); const r = purgeData(st, { scopes, olderThanDays: days ? Number(days) : undefined, now, confirm: !!c.flags.confirm, retention: ret, includeDecisions: !!c.flags['include-decisions'] });
      return { code: r.executed ? 0 : 2, data: { ...r }, text: r.executed ? `purged: ${(r as { receipt: { deleted: number; trimmedAuditLines: number } }).receipt.deleted} file(s) deleted, ${(r as { receipt: { trimmedAuditLines: number } }).receipt.trimmedAuditLines} audit line(s) trimmed; ${r.kept.length} kept` : `data purge (preview): would remove ${r.plan.length} item(s), keep ${r.kept.length}; re-run with --confirm` };
    }
  } catch (e) { return { code: 1, data: {}, text: `data ${sub} failed: ${(e as Error).message}` }; }
  return { code: 2, data: {}, text: 'data: subcommands: status | export | purge' };
}
