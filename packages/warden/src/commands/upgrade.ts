import { planUpgrade } from '../upgrade/changes.ts';
import { loadConfigs, openStorage } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { readFileSync } from 'node:fs';
import { loadWarden, loadOrders } from '../config/load.ts';
import { repoDir } from './common.ts';

/** `warden upgrade --dry-run`: report behavior/config/schema/default changes and unsupported situations. Never applies anything (there is no apply path in this release). */
export async function upgrade(c: Ctx): Promise<Result> {
  if (!c.flags['dry-run']) return { code: 2, data: {}, text: 'upgrade: only --dry-run exists in this release; an approved apply path is added with the packaged release (P6 gate)' };
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'upgrade: configuration invalid:\n' + cfgs.errors.join('\n') };
  let recorded: string | null = null; try { const st = openStorage(c, cfgs.warden.repository); recorded = (JSON.parse(readFileSync(st.path('instance.json'), 'utf8')) as { version?: string }).version ?? null; } catch { recorded = null; }
  const w = loadWarden(repoDir(c)); const o = loadOrders(repoDir(c));
  const plan = planUpgrade(recorded, { warden: (w.raw as { schemaVersion?: number } | undefined)?.schemaVersion ?? 0, orders: o.present ? (o.raw as { schemaVersion?: number } | undefined)?.schemaVersion ?? 0 : null });
  const text = `upgrade (dry-run): ${plan.recorded ?? 'unknown'} -> ${plan.target}: ${plan.supported ? 'supported' : 'NOT supported'}\n` + [...plan.problems.map((p) => `  PROBLEM: ${p}`), ...plan.changes.map((x) => `  [${x.kind}${x.action === 'review' ? ', review' : ''}] ${x.summary}`)].join('\n') + (plan.changes.length || plan.problems.length ? '\n' : '') + plan.note;
  return { code: plan.supported ? 0 : 1, data: plan as unknown as Record<string, unknown>, text };
}
