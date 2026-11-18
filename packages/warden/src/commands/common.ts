import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadOrders, loadWarden } from '../config/load.ts';
import type { Orders, WardenConfig } from '../config/load.ts';
import { InstanceStorage, wardenHome } from '../storage/instance.ts';
import { openSim } from '../github/filesim.ts';
import type { Store } from '../github/store.ts';
import type { AuthorityCeiling } from '../credentials/types.ts';

export type Flags = Record<string, string | boolean>;
export interface Parsed { cmd: string[]; flags: Flags }
const BOOL = new Set(['json', 'dry-run', 'confirm', 'global', 'create-config', 'create-orders', 'create-labels', 'approve-ceiling', 'show-effective', 'drain', 'pr', 'draft', 'help', 'version']);
export function parseArgs(argv: string[]): Parsed {
  const cmd: string[] = []; const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split(/=(.*)/s, 2); if (v !== undefined) flags[k] = v; else if (BOOL.has(k)) flags[k] = true; else { flags[k] = argv[++i] ?? ''; } }
    else cmd.push(a);
  }
  return { cmd, flags };
}
export interface Ctx { flags: Flags; env: NodeJS.ProcessEnv; cwd: string; now: () => number }
export interface Result { code: number; data: Record<string, unknown>; text: string }
export const str = (f: Flags, k: string): string | undefined => (typeof f[k] === 'string' ? (f[k] as string) : undefined);

export const SUBMIT_LOGIN = 'warden-submit'; export const WRITER_LOGIN = 'warden-writer';
export const repoDir = (c: Ctx) => resolve(c.cwd, str(c.flags, 'repo-dir') ?? '.');
export const homeDir = (c: Ctx) => resolve(c.cwd, str(c.flags, 'home') ?? wardenHome(c.env));

export interface Loaded { warden: WardenConfig; orders: Orders | null; errors: string[] }
export function loadConfigs(c: Ctx): Loaded | { errors: string[] } {
  const w = loadWarden(repoDir(c)); const o = loadOrders(repoDir(c));
  const errors = [...w.errors, ...(o.present ? o.errors : [])];
  if (!w.ok || (o.present && !o.ok)) return { errors };
  return { warden: w.value!, orders: o.present ? o.value! : null, errors: [] };
}

export type Role = 'operator' | 'submit' | 'writer';
export interface Backend { name: string; open(role: Role, repository?: string): Store | null; unavailable?: string }
/** Backend selection. `sim:<file>` is a SIMULATED GitHub for tests/evidence. The `github` backend requires a credential provider whose issuer is not
 *  wired in P1 (GitHub App proof pending): it reports unavailable instead of falling back to any ambient token. */
export function openBackend(c: Ctx, cfg: WardenConfig): Backend {
  const spec = str(c.flags, 'backend') ?? c.env.WARDEN_BACKEND ?? 'github';
  if (spec.startsWith('sim:')) {
    const path = resolve(c.cwd, spec.slice(4));
    const op = str(c.flags, 'as') ?? cfg.operators[0] ?? cfg.maintainers[0];
    return { name: 'sim', open: (role) => openSim(path, role === 'operator' ? op : role === 'submit' ? SUBMIT_LOGIN : WRITER_LOGIN, c.env.WARDEN_SIM_DOWN === '1').store };
  }
  return { name: 'github', open: () => null, unavailable: 'GitHub backend unavailable: no credential issuer is configured (GitHub App issuance is gated on the P0 credential proofs; no ambient/PAT fallback is used)' };
}

export function ceilingFor(st: InstanceStorage, cfg: WardenConfig): AuthorityCeiling | null {
  const f = st.path('ceiling.json'); if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8')) as AuthorityCeiling;
  return { ...j, automation: cfg.credentials.automation as AuthorityCeiling['automation'] };
}
export const ceilingPath = (st: InstanceStorage) => st.path('ceiling.json');
export const openStorage = (c: Ctx, repository: string, create = false) => InstanceStorage.open(homeDir(c), repository, { create });
export const joinRepo = (c: Ctx, ...p: string[]) => join(repoDir(c), ...p);
