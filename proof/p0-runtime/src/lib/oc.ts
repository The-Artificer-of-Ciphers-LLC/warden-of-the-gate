// OpenCode (pinned v2.x) headless driver over its local HTTP API. Evidence harness, not production.
// Isolation of harness state: XDG_* dirs + scrubbed env, so the maintainer's own ~/.config/opencode
// (remote providers, MCP servers, plugins) can never influence a proof run.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnContained, type ContainmentSpec } from './seatbelt.ts';

export const PINNED_OPENCODE = '2.2.7';
export const OPENCODE_BIN = '/opt/homebrew/bin/opencode';

export interface ServerOpts {
  config: Record<string, unknown>;
  workdir: string;
  port: number;
  /** extra env (e.g. proxy vars). Secrets must not be passed. */
  env?: Record<string, string>;
  /** wrap the server in a command prefix (e.g. sandbox-exec -f profile) */
  wrap?: string[];
  /** run the whole harness server inside the OS boundary */
  contain?: ContainmentSpec;
  stateDir?: string;
}

export interface Server {
  base: string;
  password: string;
  child: ChildProcess;
  stateDir: string;
  logs: () => string;
  api: (method: string, p: string, body?: unknown, signal?: AbortSignal) => Promise<{ status: number; body: any }>;
  stop: (sig?: NodeJS.Signals) => Promise<void>;
  pid: number;
}

export function harnessEnv(stateDir: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin`,
    HOME: path.join(stateDir, 'home'),
    XDG_CONFIG_HOME: path.join(stateDir, 'config'),
    XDG_DATA_HOME: path.join(stateDir, 'data'),
    XDG_STATE_HOME: path.join(stateDir, 'state'),
    XDG_CACHE_HOME: path.join(stateDir, 'cache'),
    TMPDIR: path.join(stateDir, 'tmp'),
    ...extra,
  };
}

export async function startServer(o: ServerOpts): Promise<Server> {
  const stateDir = o.stateDir ?? realpathSync(mkdtempSync(path.join(os.tmpdir(), 'warden-oc-')));
  for (const d of ['home', 'config/opencode', 'data', 'state', 'cache', 'tmp']) mkdirSync(path.join(stateDir, d), { recursive: true });
  writeFileSync(path.join(stateDir, 'config/opencode/opencode.json'), JSON.stringify(o.config, null, 2));
  const cmd = o.wrap ? o.wrap[0] : OPENCODE_BIN;
  const args = o.wrap ? [...o.wrap.slice(1), OPENCODE_BIN, 'serve', '--hostname', '127.0.0.1', '--port', String(o.port)] : ['serve', '--hostname', '127.0.0.1', '--port', String(o.port)];
  const hEnv = harnessEnv(stateDir, o.env);
  const child = o.contain
    ? spawnContained({ ...o.contain, env: { ...o.contain.env, ...hEnv } }, OPENCODE_BIN, ['serve', '--hostname', '127.0.0.1', '--port', String(o.port)], { cwd: o.workdir })
    : spawn(cmd, args, { cwd: o.workdir, env: hEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout!.on('data', (d) => { log += d; });
  child.stderr!.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${o.port}`;
  let password = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const m = log.match(/server password (\S+)/);
    if (m && log.includes('listening')) { password = m[1]; break; }
    if (child.exitCode !== null) throw new Error(`opencode exited early: ${log.slice(0, 600)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!password) throw new Error(`opencode did not start: ${log.slice(0, 600)}`);
  const auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  const api: Server['api'] = async (method, p, body, signal) => {
    const r = await fetch(base + p, { method, signal, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    let j: any = t; try { j = JSON.parse(t); } catch { /* keep text */ }
    return { status: r.status, body: j };
  };
  return {
    base, password, child, stateDir, pid: child.pid!, api, logs: () => log,
    stop: async (sig = 'SIGTERM') => {
      try { process.kill(-child.pid!, sig); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 400));
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ }
    },
  };
}

export function cleanup(s: Server) { rmSync(s.stateDir, { recursive: true, force: true }); }

export interface SessionOpts {
  model?: { id: string; providerID: string };
  directory: string;
  permissions?: Array<{ action: string; resource: string; effect: 'allow' | 'deny' | 'ask' }>;
  agent?: string;
  title?: string;
}

export async function createSession(s: Server, o: SessionOpts) {
  const r = await s.api('POST', '/api/session', { title: o.title ?? 'warden-proof', model: o.model, agent: o.agent, location: { directory: o.directory }, permissions: o.permissions });
  if (r.status !== 200) throw new Error(`create session ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body.data as { id: string; model: { id: string; providerID: string } };
}

export async function prompt(s: Server, sid: string, text: string) {
  const r = await s.api('POST', `/api/session/${sid}/prompt`, { text });
  if (r.status !== 200) throw new Error(`prompt ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body.data;
}

export async function waitIdle(s: Server, sid: string, timeoutMs: number): Promise<{ timedOut: boolean }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await s.api('POST', `/api/experimental/session/${sid}/wait`, {}, ac.signal);
    return { timedOut: false };
  } catch { return { timedOut: true }; } finally { clearTimeout(timer); }
}

export async function messages(s: Server, sid: string): Promise<any[]> {
  const r = await s.api('GET', `/api/session/${sid}/message`);
  return (r.body.data as any[]) ?? [];
}

/** Extract assistant text + tool parts + final idle outcome from the message list. */
export function summarize(msgs: any[]) {
  const asst = msgs.filter((m) => m.type === 'assistant');
  const text = asst.flatMap((m) => (m.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text)).join('').trim();
  const tools = asst.flatMap((m) => (m.content ?? []).filter((c: any) => c.type !== 'text' && c.type !== 'reasoning'));
  const idle = msgs.find((m) => m.type === 'idle');
  const tokens = asst.reduce((a, m) => ({ input: a.input + (m.tokens?.input ?? 0), output: a.output + (m.tokens?.output ?? 0), reasoning: a.reasoning + (m.tokens?.reasoning ?? 0) }), { input: 0, output: 0, reasoning: 0 });
  return { text, tools, idleOutcome: idle?.outcome as string | undefined, assistantCount: asst.length, finish: asst.at(-1)?.finish as string | undefined, models: [...new Set(asst.map((m) => `${m.model?.providerID}/${m.model?.id}`))], tokens };
}
