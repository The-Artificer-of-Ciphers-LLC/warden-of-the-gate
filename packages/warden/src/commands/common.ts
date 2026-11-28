import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ORDERS_FILE, WARDEN_FILE, loadOrders, loadWarden, workingTree } from '../config/load.ts';
import { trustedSource, workingTreeDrift } from '../config/trusted.ts';
import type { Orders, WardenConfig } from '../config/load.ts';
import { InstanceStorage, wardenHome } from '../storage/instance.ts';
import { openSim } from '../github/filesim.ts';
import type { Store } from '../github/store.ts';
import type { AuthorityCeiling } from '../credentials/types.ts';
import { CredentialUnavailable } from '../credentials/types.ts';
import type { CredentialProvider, CredentialRequest } from '../credentials/types.ts';
import { CredentialController, credentialDenial } from '../credentials/controller.ts';
import { GitHubAppIssuer, validInstallation } from '../credentials/github-app.ts';
import { HttpStore } from '../github/http.ts';

export type Flags = Record<string, string | boolean>;
export interface Parsed { cmd: string[]; flags: Flags }
const BOOL = new Set(['json', 'dry-run', 'confirm', 'global', 'create-config', 'create-orders', 'create-labels', 'approve-ceiling', 'approve-control-read', 'replace', 'show-effective', 'drain', 'pr', 'draft', 'help', 'version', 'validate-only']);
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
/** `--context-limit` and `--output-limit` for the model runner. A value that is not a number is passed on as NaN so the runner refuses it with a reason. */
export const modelLimits = (f: Flags): { contextLimit?: number; outputLimit?: number } => {
  const n = (k: string) => { const v = str(f, k); return v === undefined ? undefined : Number(v); };
  const c = n('context-limit'); const o = n('output-limit');
  return { ...(c !== undefined ? { contextLimit: c } : {}), ...(o !== undefined ? { outputLimit: o } : {}) };
};

export const SUBMIT_LOGIN = 'warden-submit'; export const WRITER_LOGIN = 'warden-writer';
export const repoDir = (c: Ctx) => resolve(c.cwd, str(c.flags, 'repo-dir') ?? '.');
export const homeDir = (c: Ctx) => resolve(c.cwd, str(c.flags, 'home') ?? wardenHome(c.env));

export interface Loaded { warden: WardenConfig; orders: Orders | null; errors: string[];
  /** Where the policy in force was read from (PRD §3 trusted base), and which policy files in the working tree differ from it (not in force). */
  trusted: { kind: 'revision' | 'directory'; ref?: string; revision?: string; note: string; drift: string[] } }
/** The policy that acts: read from the trusted base revision when `--repo-dir` is a git checkout (`--trusted-ref` / WARDEN_TRUSTED_REF, else
 *  origin's default branch), never from the working tree, so a checked-out pull request cannot change the rules that judge it. Authoring commands
 *  (`setup`, `config validate`, `upgrade`) read the working tree on purpose, to check an edit before it is committed. */
/** `stopping`: only `warden stop` passes it. A stop can never widen authority, so when no trusted base resolves it still reads the working tree to find
 *  the control issue, rather than leave the operator unable to stop. Everything else, `resume` included, fails closed. */
export function loadConfigs(c: Ctx, o: { stopping?: boolean } = {}): Loaded | { errors: string[] } {
  let t = trustedSource(repoDir(c), str(c.flags, 'trusted-ref') ?? (c.env.WARDEN_TRUSTED_REF || undefined));
  if (!t.ok && o.stopping) t = { ok: true, value: { source: workingTree(repoDir(c)), kind: 'directory', note: `stop only: ${t.error}; the working tree was read to find the control issue` } };
  if (!t.ok) return { errors: [t.error] };
  const w = loadWarden(t.value.source); const o = loadOrders(t.value.source);
  const errors = [...w.errors, ...(o.present ? o.errors : [])];
  if (!w.ok || (o.present && !o.ok)) return { errors };
  const v = t.value;
  return { warden: w.value!, orders: o.present ? o.value! : null, errors: [], trusted: { kind: v.kind, ref: v.ref, revision: v.revision, note: v.note, drift: workingTreeDrift(repoDir(c), v, [WARDEN_FILE, ORDERS_FILE]) } };
}

export type Role = 'operator' | 'submit' | 'writer';
export interface Backend { name: string; open(role: Role, repository?: string): Store | null; unavailable?: string; submitLogin?: string;
  /** Factory publishing access (contents + pull-request write on THIS repository only), issued by the App through the controller and bounded by the protected ceiling; never a PAT or the operator token. */
  publish?(): { store: Store; token: () => Promise<string> } | null }
/** Each live credential source is explicitly selected; App failure never selects a human or runner credential. */
export function openBackend(c: Ctx, cfg: WardenConfig): Backend {
  const spec = str(c.flags, 'backend') ?? c.env.WARDEN_BACKEND ?? 'github';
  if (spec.startsWith('sim:')) {
    const path = resolve(c.cwd, spec.slice(4));
    const op = str(c.flags, 'as') ?? cfg.operators[0] ?? cfg.maintainers[0];
    return { name: 'sim', open: (role) => openSim(path, role === 'operator' ? op : role === 'submit' ? SUBMIT_LOGIN : WRITER_LOGIN, c.env.WARDEN_SIM_DOWN === '1').store };
  }
  if (spec !== 'github') throw new Error(`unknown backend: ${spec}`);
  for (const [flag, expected] of [['operator-auth', 'gh'], ['writer-auth', 'actions'], ['submit-auth', 'actions-secret'], ['control-auth', 'actions-secret']]) {
    if (str(c.flags, flag) && str(c.flags, flag) !== expected) throw new CredentialUnavailable('denied', `unknown credential source for --${flag}`);
  }
  const be: Backend = { name: 'github', unavailable: 'GitHub backend unavailable: configure an App installation and protected operator ceiling; no ambient/PAT fallback is used', open };
  let controller: CredentialController | undefined;
  let operatorToken: string | undefined;
  const source = (get: (r: CredentialRequest) => Promise<string>): CredentialProvider => ({ token: get, status: () => [] });
  function open(role: Role, repository = cfg.repository): Store | null {
    if (repository !== cfg.repository && repository !== cfg.inbox.globalControl?.repository) throw new CredentialUnavailable('denied', 'repository is outside this instance');
    const control = repository !== cfg.repository;
    const req: CredentialRequest = { operation: control ? 'read-control' : role === 'writer' ? 'write' : 'submit', repository,
      permissions: { issues: control ? 'read' : 'write', metadata: 'read' } };
    if (role === 'operator' && str(c.flags, 'operator-auth') === 'gh') {
      const provider = source(async () => {
        if (!operatorToken) {
          const env = { ...process.env, ...c.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined };
          const gh = (args: string[]) => {
            try { return execFileSync('gh', args, { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 }).trim(); }
            catch { throw new CredentialUnavailable('denied', 'explicit operator gh authentication failed; no alternate credential was tried'); }
          };
          const actor = gh(['api', '--hostname', 'github.com', 'user', '--jq', '.login']);
          if (![...cfg.maintainers, ...cfg.operators].includes(actor) || actor !== (str(c.flags, 'as') ?? cfg.maintainers[0])) throw new CredentialUnavailable('denied', 'authenticated GitHub login is not the selected configured operator; select the actual operator with --as');
          operatorToken = gh(['auth', 'token', '--hostname', 'github.com', '--user', actor]);
        }
        return operatorToken;
      });
      return new HttpStore(repository, provider, req, str(c.flags, 'as') ?? cfg.maintainers[0]);
    }
    if (str(c.flags, 'operator-auth') && str(c.flags, 'operator-auth') !== 'gh') throw new CredentialUnavailable('denied', 'unknown operator authentication source');
    const st = openStorage(c, cfg.repository);
    const installation = st.readJson<unknown>(st.path('github.json'));
    if (!installation) return null;
    if (!validInstallation(installation)) throw new CredentialUnavailable('denied', 'invalid protected App installation configuration');
    be.submitLogin = installation.appLogin;
    const secretName = control ? 'WARDEN_CONTROL_READ_TOKEN' : role === 'writer' ? 'GITHUB_TOKEN' : 'WARDEN_SUBMIT_TOKEN';
    const supplied = control ? str(c.flags, 'control-auth') === 'actions-secret' : role === 'writer'
      ? str(c.flags, 'writer-auth') === 'actions' : str(c.flags, 'submit-auth') === 'actions-secret';
    if (supplied) {
      const provider = source(async () => {
        if (c.env.GITHUB_ACTIONS !== 'true' || c.env.GITHUB_REPOSITORY?.toLowerCase() !== cfg.repository.toLowerCase()) throw new CredentialUnavailable('denied', "explicit runner credentials require this repository's Actions environment");
        const ceiling = ceilingFor(st, cfg);
        if (!ceiling || credentialDenial(ceiling, req) || cfg.credentials.automation === 'opt-out') throw new CredentialUnavailable('denied', 'runner credentials are outside the approved ceiling or automation is opted out');
        if (!c.env[secretName]) throw new CredentialUnavailable('none', `explicit runner credential ${secretName} is missing`);
        return c.env[secretName];
      });
      return new HttpStore(repository, provider, req, !control && role === 'writer' ? 'github-actions[bot]' : installation.appLogin);
    }
    if (role === 'writer' && !control) { be.unavailable = 'writer requires explicit --writer-auth actions; the App submit identity cannot become the writer'; return null; }
    if (!controller) {
      const ceiling = ceilingFor(st, cfg);
      if (!ceiling) return null;
      controller = new CredentialController({ issuer: new GitHubAppIssuer(installation), ceiling, stateDir: st.credentialsDir, now: c.now });
    }
    return new HttpStore(repository, controller, req, installation.appLogin);
  }
  be.publish = () => {
    const st = openStorage(c, cfg.repository); const installation = st.readJson<unknown>(st.path('github.json'));
    if (!installation) return null;
    if (!validInstallation(installation)) throw new CredentialUnavailable('denied', 'invalid protected App installation configuration');
    const ceiling = ceilingFor(st, cfg); if (!ceiling) return null;
    const req: CredentialRequest = { operation: 'publish', repository: cfg.repository, permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } };
    const denied = cfg.credentials.automation === 'opt-out' ? 'credential automation is opted out' : credentialDenial(ceiling, req);
    if (denied) throw new CredentialUnavailable('denied', `publishing is outside the operator ceiling: ${denied}`);
    controller ??= new CredentialController({ issuer: new GitHubAppIssuer(installation), ceiling, stateDir: st.credentialsDir, now: c.now });
    const ctl = controller;
    return { store: new HttpStore(cfg.repository, ctl, req, installation.appLogin), token: () => ctl.token(req) };
  };
  return be;
}

export function ceilingFor(st: InstanceStorage, cfg: WardenConfig): AuthorityCeiling | null {
  const f = st.path('ceiling.json'); if (!existsSync(f)) return null;
  const j = st.readJson<AuthorityCeiling>(f);
  if (!j || !Array.isArray(j.repositories) || !j.repositories.every((r) => typeof r === 'string') || !j.maxPermissions || typeof j.maxPermissions !== 'object'
    || Object.values(j.maxPermissions).some((p) => p !== 'read' && p !== 'write') || (j.controlRepositories !== undefined && (!Array.isArray(j.controlRepositories) || !j.controlRepositories.every((r) => typeof r === 'string')))) throw new CredentialUnavailable('denied', 'invalid protected authority ceiling');
  return { ...j, automation: cfg.credentials.automation as AuthorityCeiling['automation'] };
}
export const ceilingPath = (st: InstanceStorage) => st.path('ceiling.json');
export const openStorage = (c: Ctx, repository: string, create = false) => InstanceStorage.open(homeDir(c), repository, { create });
export const joinRepo = (c: Ctx, ...p: string[]) => join(repoDir(c), ...p);
