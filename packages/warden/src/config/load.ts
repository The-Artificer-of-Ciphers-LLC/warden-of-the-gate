import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { DEFAULT_WARDEN, deepMerge } from './defaults.ts';
import { ajvMessages, validateOrdersSchema, validateWardenSchema } from './schemas.ts';
import { ORDERS_SCHEMA_VERSION, WARDEN_SCHEMA_VERSION } from '../version.ts';
import { digest } from '../util.ts';

export type WardenConfig = typeof DEFAULT_WARDEN & { repository: string; maintainers: string[]; inbox: typeof DEFAULT_WARDEN.inbox & { globalControl?: { repository: string; issue: number } } };
export interface Program {
  name: string; description?: string; tasks: string[]; decision: 'allow' | 'deny' | 'require-approval'; approvalGate?: 'maintainer'; escalate?: boolean;
  scope?: { kinds?: string[]; paths?: string[]; origins?: string[]; maxRisk?: 'low' | 'medium' };
  exclusions?: { paths?: string[]; kinds?: string[] };
}
export interface Orders { schemaVersion: 1; programs: Program[] }

export interface Loaded<T> { ok: boolean; value?: T; raw?: unknown; errors: string[]; file: string; present: boolean }
export const WARDEN_FILE = '.github/warden.yml';
export const ORDERS_FILE = '.github/ORDERS.yaml';

function readYaml(path: string): { present: boolean; raw?: unknown; error?: string } {
  if (!existsSync(path)) return { present: false };
  try { return { present: true, raw: parse(readFileSync(path, 'utf8'), { uniqueKeys: true, maxAliasCount: 20 }) }; }
  catch (e) { return { present: true, error: `YAML parse error: ${String((e as Error).message).split('\n')[0]}` }; }
}
function versionError(raw: unknown, want: number, file: string): string | null {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (v === undefined) return `${file}: schemaVersion is required (supported: ${want})`;
  if (v !== want) return `${file}: unsupported schemaVersion ${JSON.stringify(v)} (this Warden supports ${want}; no automatic migration, see upgrade notes)`;
  return null;
}

/** Load .github/warden.yml from a directory that holds the DEFAULT-BRANCH checkout (never a PR head: a PR cannot authorize itself). */
export function loadWarden(root: string): Loaded<WardenConfig> {
  const file = join(root, WARDEN_FILE); const y = readYaml(file);
  if (!y.present) return { ok: false, errors: [`${WARDEN_FILE} not found`], file, present: false };
  if (y.error) return { ok: false, errors: [y.error], file, present: true };
  const ve = versionError(y.raw, WARDEN_SCHEMA_VERSION, WARDEN_FILE); if (ve) return { ok: false, errors: [ve], file, present: true, raw: y.raw };
  const merged = deepMerge(DEFAULT_WARDEN as unknown, y.raw);
  // Explicit user values for keys that the schema validates must validate as the user wrote them too (a user `blocker: false` is an error, not silently defaulted).
  if (!validateWardenSchema(merged)) return { ok: false, errors: ajvMessages(validateWardenSchema).map((m) => `${WARDEN_FILE}: ${m}`), file, present: true, raw: y.raw };
  return { ok: true, value: merged as WardenConfig, raw: y.raw, errors: [], file, present: true };
}
export function loadOrders(root: string): Loaded<Orders> {
  const file = join(root, ORDERS_FILE); const y = readYaml(file);
  if (!y.present) return { ok: false, errors: [`${ORDERS_FILE} not found`], file, present: false };
  if (y.error) return { ok: false, errors: [y.error], file, present: true };
  const ve = versionError(y.raw, ORDERS_SCHEMA_VERSION, ORDERS_FILE); if (ve) return { ok: false, errors: [ve], file, present: true, raw: y.raw };
  if (!validateOrdersSchema(y.raw)) return { ok: false, errors: ajvMessages(validateOrdersSchema).map((m) => `${ORDERS_FILE}: ${m}`), file, present: true, raw: y.raw };
  return { ok: true, value: y.raw as Orders, raw: y.raw, errors: [], file, present: true };
}
/** Digest of the effective policy inputs. Approvals bind to it, so a policy change invalidates them. */
export const policyDigest = (w: WardenConfig, o: Orders) => digest({ w: { gates: w.gates, approvals: w.approvals, maintainers: w.maintainers, mode: w.mode, clocks: w.clocks }, o });
