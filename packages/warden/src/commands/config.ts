import { loadOrders, loadWarden } from '../config/load.ts';
import { validateEffective } from '../config/policy.ts';
import { ceilingFor, joinRepo, openStorage } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { ORDERS_SCHEMA_VERSION, WARDEN_SCHEMA_VERSION } from '../version.ts';
import type { AuthorityCeiling } from '../credentials/types.ts';

/** `warden config validate`: both files, schema compatibility, combined effective policy, unsafe defaults, conflicts. Exit 1 on any error. */
export async function configValidate(c: Ctx): Promise<Result> {
  const w = loadWarden(joinRepo(c)); const o = loadOrders(joinRepo(c));
  const errors: string[] = [...w.errors]; const findings: { level: string; code: string; message: string }[] = [];
  if (o.present) errors.push(...o.errors); else findings.push({ level: 'warning', code: 'orders.missing', message: '.github/ORDERS.yaml not found: every action escalates to a maintainer (narrow by default)' });
  if (w.ok) {
    let ceiling: AuthorityCeiling | null = null;
    try { ceiling = ceilingFor(openStorage(c, w.value!.repository), w.value!); } catch { /* not initialized: ceiling checks skipped, reported below */ }
    findings.push(...validateEffective(w.value!, o.ok ? o.value! : null, ceiling).filter((f) => !(f.code === 'orders.missing' && !o.present)));
    if (!ceiling) findings.push({ level: 'warning', code: 'ceiling.absent', message: 'no operator authority ceiling found (run `warden setup --approve-ceiling`): credential issuance has no approved ceiling' });
  }
  const errCount = errors.length + findings.filter((f) => f.level === 'error').length;
  const lines = [...errors.map((e) => `ERROR   ${e}`), ...findings.map((f) => `${f.level === 'error' ? 'ERROR  ' : 'warning'} [${f.code}] ${f.message}`)];
  const text = (lines.length ? lines.join('\n') + '\n' : '') + (errCount ? `\nconfig INVALID: ${errCount} error(s)` : `\nconfig valid (warden.yml schema v${WARDEN_SCHEMA_VERSION}, ORDERS.yaml schema v${ORDERS_SCHEMA_VERSION}); ${findings.length} warning(s)`)
    + (c.flags['show-effective'] && w.ok ? '\n\neffective configuration:\n' + JSON.stringify(w.value, null, 2) : '');
  return { code: errCount ? 1 : 0, data: { valid: errCount === 0, errors, findings, ...(c.flags['show-effective'] && w.ok ? { effective: w.value } : {}) }, text };
}
