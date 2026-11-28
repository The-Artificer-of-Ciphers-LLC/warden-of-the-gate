import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { containmentSelfTest, spawnContained } from './seatbelt.ts';
import type { ContainmentSpec } from './seatbelt.ts';
import type { AgentRunner, BudgetMonitor, PreflightReport, SessionRequest, SessionResult } from './agent-runner.ts';
import { OPENCODE_FLOOR, OPENCODE_MAJOR, SUPPORTED_OPENCODE } from '../version.ts';

/** The OpenCode adapter (ADR 0006), lifted from the P0 runtime proof. One fresh serial session per call: a contained headless server
 *  on a random loopback port, hardened environment and isolated XDG state, a deny-all tool surface, local-only provider. The packet is inlined
 *  into the prompt and the model replies with one JSON object (structured output is prompt-driven, then Ajv-validated by the caller).
 *  The runner, not the harness, enforces tool-call and wall-clock budgets (P0: the harness step cap bounds model steps only). */
export { OPENCODE_FLOOR, OPENCODE_MAJOR, SUPPORTED_OPENCODE };
export const DEFAULT_OPENCODE_BIN = '/opt/homebrew/bin/opencode';
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const HARDEN_ENV: Record<string, string> = {
  OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FREE_MODELS: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_FILEWATCHER_DISABLE: '1',
};
const DENY_ALL = { action: '*', resource: '*', effect: 'deny' as const };

export interface OpenCodeOptions { bin?: string; /** lowest accepted 2.x version; defaults to OPENCODE_FLOOR. */ minVersion?: string; baseURL?: string; modelId: string; contextLimit?: number; outputLimit?: number; /** false turns OpenCode's automatic compaction off (an experiment switch; default is OpenCode's own). */ autoCompact?: boolean; /** share of the loaded window (0..1) at which a session is told to answer now; 0 disables. */ windowGuard?: number; maxPromptChars?: number; startupMs?: number }

export function classifyBaseURL(raw: string): { local: boolean; host: string; port?: number; reason?: string } {
  let u: URL; try { u = new URL(raw); } catch { return { local: false, host: raw, reason: 'unparseable URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { local: false, host: u.hostname, reason: `protocol ${u.protocol}` };
  if (u.username || u.password) return { local: false, host: u.hostname, reason: 'userinfo present (lookalike host trick)' };
  if (!LOOPBACK_HOSTS.has(u.hostname)) return { local: false, host: u.hostname, reason: `host ${u.hostname} is not a loopback literal` };
  return { local: true, host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) };
}

/** `opencode --version` prints e.g. "opencode v2.2.7"; compare only the semantic version. */
export function parseVersion(out: string): string | undefined { return out.match(/(\d+\.\d+\.\d+)/)?.[1]; }

const triple = (v: string) => v.split('.').map(Number);
/** Why an OpenCode version is refused, or undefined when it is accepted: same major as OPENCODE_MAJOR (2) and not below the floor (2.2.7). */
export function openCodeVersionProblem(version: string, floor: string = OPENCODE_FLOOR): string | undefined {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return `opencode version "${version}" is not a version number`;
  const [ma, mi, pa] = triple(version); const [fa, fi, fp] = triple(floor);
  if (ma !== OPENCODE_MAJOR) return `opencode ${version} is outside the supported range ${SUPPORTED_OPENCODE} (major ${ma}, Warden supports ${OPENCODE_MAJOR}.x)`;
  if (ma < fa || (ma === fa && (mi < fi || (mi === fi && pa < fp)))) return `opencode ${version} is older than ${floor}, the lowest supported version (${SUPPORTED_OPENCODE})`;
  return undefined;
}

export function extractJson(text: string): { value?: unknown; error?: string } {
  const t = text.trim(); const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  try { return { value: JSON.parse(candidate) }; } catch (e) { return { error: (e as Error).message }; }
}

const WARDEN_DEBUG_CAP = process.env.WARDEN_RUNNER_DEBUG === 'full' ? 400_000 : 40_000;
const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

interface Server { base: string; child: ChildProcess; stateDir: string; pid: number; logs: () => string; api: (method: string, p: string, body?: unknown, signal?: AbortSignal) => Promise<{ status: number; body: any }>; stop: () => Promise<void> }

export class OpenCodeRunner implements AgentRunner {
  readonly name = 'opencode'; readonly pinnedVersion: string;
  /** The version `opencode --version` reported at the last preflight: what this run actually used. */
  observedVersion?: string;
  private o: Required<Omit<OpenCodeOptions, 'minVersion' | 'autoCompact' | 'windowGuard'>> & { minVersion: string; autoCompact?: boolean; windowGuard: number };
  constructor(o: OpenCodeOptions) {
    this.o = { bin: o.bin ?? DEFAULT_OPENCODE_BIN, minVersion: o.minVersion ?? OPENCODE_FLOOR, baseURL: o.baseURL ?? 'http://127.0.0.1:11234/v1', modelId: o.modelId, contextLimit: o.contextLimit ?? 0, /* no default: the window must be configured (--context-limit), and the run refuses without it (see windowProblem) */
      outputLimit: o.outputLimit ?? 32768, /* a reasoning model spends output tokens thinking: a 4096 cap truncates the JSON answer */ windowGuard: o.windowGuard ?? 0, maxPromptChars: o.maxPromptChars ?? 60_000, startupMs: o.startupMs ?? 60_000, ...(o.autoCompact === false ? { autoCompact: false } : {}) };
    this.pinnedVersion = `>=${this.o.minVersion} <${OPENCODE_MAJOR + 1}.0.0`;   // a range now, not one exact version (ADR 0004)
  }
  /** The context window is never guessed and never read from server-specific fields: the OpenAI spec's `/v1/models` carries no window, so it is a required,
   *  configured value (the owner's "follow the published specs" ruling; see docs/research/MODEL-CONNECTIONS.md). A window that is too large overflows; one that
   *  is too small makes OpenCode compact early and fail. Without a confirmed window the run is refused, rather than handing OpenCode a guess. */
  private windowProblem(): string | undefined {
    const { contextLimit: c, outputLimit: out } = this.o;
    if (c === 0) return 'context window not confirmed: pass --context-limit with the window the model is loaded with on the server (Warden no longer guesses one)';
    if (!Number.isInteger(c) || c < 4096) return `context window ${String(c)} is not a whole number of at least 4096 tokens`;
    if (!Number.isInteger(out) || out < 1) return `output limit ${String(out)} is not a positive whole number`;
    if (out >= c) return `output limit ${out} must be smaller than the context window ${c}`;
    return undefined;
  }

  private config(): Record<string, unknown> {
    return { model: `lmstudio/${this.o.modelId}`,
      providers: { lmstudio: { name: 'Local model server', package: '@ai-sdk/openai-compatible', settings: { baseURL: this.o.baseURL },
        models: { [this.o.modelId]: { name: this.o.modelId, limit: { context: this.o.contextLimit, output: this.o.outputLimit } } } } },
      ...(this.o.autoCompact === false ? { compaction: { auto: false } } : {}),
      update: 'disable', share: 'disabled', policies: [{ action: 'provider.use', resource: 'opencode', effect: 'deny' }] };
  }

  private async start(workspace: string, signal?: AbortSignal, writable = false, denyWrite: string[] = []): Promise<Server> {
    const net0 = classifyBaseURL(this.o.baseURL); if (!net0.local || !net0.port) throw new Error(`provider endpoint is not loopback: ${net0.reason}`);
    const stateDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'warden-oc-')));
    for (const d of ['home', 'config/opencode', 'data', 'state', 'cache', 'tmp']) mkdirSync(path.join(stateDir, d), { recursive: true });
    writeFileSync(path.join(stateDir, 'config/opencode/opencode.json'), JSON.stringify(this.config(), null, 2));
    const port = await freePort();
    const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', HOME: path.join(stateDir, 'home'), XDG_CONFIG_HOME: path.join(stateDir, 'config'), XDG_DATA_HOME: path.join(stateDir, 'data'),
      XDG_STATE_HOME: path.join(stateDir, 'state'), XDG_CACHE_HOME: path.join(stateDir, 'cache'), TMPDIR: path.join(stateDir, 'tmp'), ...HARDEN_ENV };
    const spec: ContainmentSpec = { workspace, workspaceWritable: writable, denyWrite, scratch: stateDir, allowTcp: [{ port: net0.port }], listenPorts: [port], readonlyPaths: ['/opt/homebrew/bin', '/opt/homebrew/Cellar/opencode'], env };
    const child = spawnContained(spec, this.o.bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: workspace });
    let log = ''; child.stdout!.on('data', (d) => { log += d; }); child.stderr!.on('data', (d) => { log += d; });
    const base = `http://127.0.0.1:${port}`; let password = ''; const t0 = Date.now();
    while (Date.now() - t0 < this.o.startupMs && !signal?.aborted) {
      const m = log.match(/server password (\S+)/); if (m && log.includes('listening')) { password = m[1]; break; }
      if (child.exitCode !== null) break; await new Promise((r) => setTimeout(r, 100));
    }
    const stop = async () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ } await new Promise((r) => setTimeout(r, 300)); try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } rmSync(stateDir, { recursive: true, force: true }); };
    if (!password) { await stop(); throw new Error(`opencode did not start inside the boundary: ${log.slice(0, 300)}`); }
    const auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
    const api: Server['api'] = async (method, p, body, sig) => {
      const r = await fetch(base + p, { method, signal: sig, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const t = await r.text(); let j: any = t; try { j = JSON.parse(t); } catch { /* text */ } return { status: r.status, body: j };
    };
    return { base, child, stateDir, pid: child.pid!, logs: () => log, api, stop };
  }

  /** Resolved (not merely configured) routing, read from the live server: every enabled provider and the default model must be loopback, and the
   *  default must be the configured pool member (OpenCode silently substitutes when its default is unavailable). */
  private async resolve(s: Server): Promise<{ ok: boolean; resolvedModel?: string; reasons: string[] }> {
    const reasons: string[] = [];
    const prov = await s.api('GET', '/api/provider'); const def = await s.api('GET', '/api/model/default');
    for (const p of ((prov.body?.data ?? []) as any[]).filter((x) => x.activation === 'enabled')) {
      const c = classifyBaseURL(String(p.settings?.baseURL ?? '')); if (!c.local) reasons.push(`enabled provider "${p.id}" is non-local (${c.reason})`);
    }
    let resolvedModel: string | undefined;
    if (def.status !== 200 || !def.body?.data) reasons.push(`no resolved default model (status ${def.status})`);
    else {
      const d = def.body.data; resolvedModel = String(d.modelID ?? d.id); const c = classifyBaseURL(String(d.settings?.baseURL ?? ''));
      if (!c.local) reasons.push(`resolved model ${d.providerID}/${resolvedModel} routes to a non-local endpoint: ${c.reason}`);
      if (resolvedModel !== this.o.modelId) reasons.push(`resolved model ${resolvedModel} != expected ${this.o.modelId} (silent substitution)`);
    }
    return { ok: reasons.length === 0, resolvedModel, reasons };
  }

  async preflight(): Promise<PreflightReport> {
    const failures: string[] = []; const rep: PreflightReport = { ok: false, failures };
    try { rep.harnessVersion = parseVersion(execFileSync(this.o.bin, ['--version'], { encoding: 'utf8', timeout: 10_000 })); } catch { failures.push(`opencode not runnable at ${this.o.bin}`); }
    this.observedVersion = rep.harnessVersion;
    if (rep.harnessVersion) { const v = openCodeVersionProblem(rep.harnessVersion, this.o.minVersion); if (v) failures.push(v); }
    const st = await containmentSelfTest().catch((e) => ({ ok: false, observed: {}, failures: [String(e)] }));
    if (st.ok) rep.isolation = 'seatbelt'; else failures.push(`containment not verified: ${st.failures.join('; ')}`);
    const w = this.windowProblem(); if (w) failures.push(w);
    const c = classifyBaseURL(this.o.baseURL);
    if (!c.local) failures.push(`provider endpoint is not loopback: ${c.reason}`);
    else {
      try {
        const r = await fetch(this.o.baseURL.replace(/\/$/, '') + '/models', { signal: AbortSignal.timeout(3000) }); const j: any = await r.json().catch(() => ({}));
        if (r.status !== 200 || !(Array.isArray(j.data) && j.data.some((m: any) => m.id === this.o.modelId))) failures.push(`local endpoint unhealthy or model "${this.o.modelId}" not served (status ${r.status})`);
      } catch (e) { failures.push(`local endpoint unreachable: ${(e as Error).name}`); }
    }
    if (failures.length === 0) {
      const ws = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'warden-oc-pf-')));
      try { const s = await this.start(ws); try { const r = await this.resolve(s); rep.resolvedModel = r.resolvedModel; failures.push(...r.reasons); } finally { await s.stop(); } }
      catch (e) { failures.push(String((e as Error).message).slice(0, 200)); } finally { rmSync(ws, { recursive: true, force: true }); }
    }
    rep.ok = failures.length === 0; return rep;
  }

  /** The task writes `prompt.txt` into the read-only packet (task instructions plus untrusted data); the adapter only appends the output contract and
   *  the JSON Schema and enforces the context budget. Contributor content is data: the session has no tools to act on it. */
  private buildPrompt(req: SessionRequest): { text: string } | { error: string } {
    const task = readFileSync(path.join(req.packetDir, 'prompt.txt'), 'utf8');
    const text = [task, (req.repoContext ? 'You may use the read and list tools on the repository snapshot for context, but you must finish with your answer. Think briefly, then reply' : 'No tools are available in this session: everything you need is above, so do not call any tool and do not read files. Think briefly, then reply') + ' with a single JSON object and nothing else (no prose, no code fences). It must conform to this JSON Schema:', JSON.stringify(req.resultSchema)].join('\n');
    return text.length > this.o.maxPromptChars ? { error: `packet is ${text.length} characters, over the ${this.o.maxPromptChars}-character context budget` } : { text };
  }

  async run(req: SessionRequest, signal: AbortSignal, monitor: BudgetMonitor): Promise<SessionResult> {
    const t0 = Date.now(); const usage = () => ({ toolCalls: monitor.toolCalls, modelTurns: monitor.modelTurns, wallMs: Date.now() - t0 });
    const built = this.buildPrompt(req); if ('error' in built) return { outcome: 'failed', reason: built.error, usage: usage() };
    let s: Server | undefined;
    try {
      const wsDir = realpathSync(req.workspace?.dir ?? req.packetDir); const writable = !!req.workspace?.writable;
      const w = this.windowProblem(); if (w) return { outcome: 'failed', reason: w, usage: usage() };
      if (process.env.WARDEN_RUNNER_DEBUG) process.stderr.write(`runner-debug-ctx ${JSON.stringify({ contextLimit: this.o.contextLimit, outputLimit: this.o.outputLimit, windowGuard: this.o.windowGuard })}\n`);
      s = await this.start(wsDir, signal, writable, req.workspace?.denyWrite ?? []);
      const re = await this.resolve(s); if (!re.ok) return { outcome: 'failed', reason: `routing re-check failed at execution time: ${re.reasons.join('; ')}`, usage: usage() };
      const ses = await s.api('POST', '/api/session', { title: 'warden-review', model: { id: this.o.modelId, providerID: 'lmstudio' }, location: { directory: wsDir }, permissions: [DENY_ALL, ...req.tools.allow.map((a) => ({ action: a, resource: '*', effect: 'allow' as const }))] });
      if (ses.status !== 200) return { outcome: 'failed', reason: `create session ${ses.status}`, usage: usage() };
      const sid = ses.body.data.id as string;
      const p = await s.api('POST', `/api/session/${sid}/prompt`, { text: built.text }); if (p.status !== 200) return { outcome: 'failed', reason: `prompt ${p.status}`, usage: usage() };
      let created = (p.body.data.time?.created ?? 0) - 1; let interrupted = false;
      const onAbort = () => { interrupted = true; void s!.api('POST', `/api/session/${sid}/interrupt`, {}).catch(() => undefined); };
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      const seen = new Set<string>(); const key = (m: any) => String(m.id ?? JSON.stringify(m).slice(0, 200));   // messages of earlier rounds, by id (the API's ordering is not relied on)
      // One bounded REPAIR round: a model may end its turn with prose or a tool call that cannot run here (this session has no such tool) instead of the JSON object.
      // It is told once, in the same session, to answer with the object only; the second reply is judged exactly like the first.
      const dbg = (round: number, ms: any[]) => { if (process.env.WARDEN_RUNNER_DEBUG) process.stderr.write(`runner-debug ${JSON.stringify({ wallMs: Date.now() - t0, round, messages: ms.map((m) => { const { content, ...rest } = m; return { ...rest, parts: (content ?? []).map((c: any) => ({ type: c.type, chars: JSON.stringify(c).length, ...(c.type === 'tool' ? { head: JSON.stringify(c).slice(0, 360) } : {}), ...(process.env.WARDEN_RUNNER_DEBUG === 'full' && (c.type === 'reasoning' || c.type === 'text') ? { text: String(c.text ?? '').slice(-6000) } : {}) })) }; }) }).slice(0, WARDEN_DEBUG_CAP)}\n`); };
      let nudged = false; let selfInterrupt = false;
      for (let round = 0; round < 2; round++) {
        let msgs: any[] = []; let idle: any;
        while (!idle) {
          const r = await s.api('GET', `/api/session/${sid}/message`); msgs = (r.body?.data ?? []) as any[];
          const asst = msgs.filter((m) => m.type === 'assistant'); const tools = asst.flatMap((m) => (m.content ?? []).filter((c: any) => c.type !== 'text' && c.type !== 'reasoning')).length;
          monitor.observe({ toolCalls: Math.max(0, tools - monitor.toolCalls), modelTurns: Math.max(0, asst.length - monitor.modelTurns) });
          // Window guard: with compaction off nothing trims the conversation, so once the last turn's prompt passes a share of the loaded window the session is told, once, to stop reading and answer.
          const lastIn = Math.max(0, ...asst.map((m) => Number(m.tokens?.input ?? 0)));
          if (!nudged && this.o.windowGuard > 0 && lastIn > this.o.windowGuard * this.o.contextLimit) { nudged = true; selfInterrupt = true; if (process.env.WARDEN_RUNNER_DEBUG) process.stderr.write(`runner-debug-guard ${JSON.stringify({ lastIn, threshold: this.o.windowGuard * this.o.contextLimit, contextLimit: this.o.contextLimit, wallMs: Date.now() - t0 })}\n`); await s.api('POST', `/api/session/${sid}/interrupt`, {}).catch(() => undefined); }
          if (monitor.exceeded) { dbg(round, msgs); await s.api('POST', `/api/session/${sid}/interrupt`, {}).catch(() => undefined); return { outcome: 'budget-exceeded', reason: monitor.exceeded, usage: usage() }; }
          idle = msgs.find((m) => !seen.has(key(m)) && m.type === 'idle' && (m.time?.created ?? 0) >= created);
          if (!idle) await new Promise((res) => setTimeout(res, 400));
        }
        signal.removeEventListener('abort', onAbort);
        if (selfInterrupt && idle.outcome === 'interrupted' && !interrupted) {   // our own window-guard interrupt: ask for the answer in the same session, judged like any other reply
          selfInterrupt = false; for (const m of msgs) seen.add(key(m));
          const np = await s.api('POST', `/api/session/${sid}/prompt`, { text: 'The context window is nearly full. Do not call any tool now. Reply now with only the single JSON object that conforms to the schema, based on what you have already read.' });
          if (np.status !== 200) return { outcome: 'failed', reason: `window-guard prompt ${np.status}`, usage: usage() };
          created = (np.body.data.time?.created ?? 0) - 1; round--; continue;
        }
        if (interrupted || idle.outcome === 'interrupted') return { outcome: 'interrupted', reason: 'session interrupted', usage: usage() };
        if (idle.outcome !== 'succeeded') return { outcome: 'failed', reason: `session ended ${String(idle.outcome)}: ${JSON.stringify({ idle, errs: msgs.filter((m) => m.error || m.type === 'error').map((m) => m.error ?? m).slice(-2) }).slice(0, 240)}`, usage: usage() };
        dbg(round, msgs);
        const mine = msgs.filter((m) => !seen.has(key(m)) && m.type === 'assistant');
        const text = mine.flatMap((m) => (m.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text)).join('').trim();
        const j = extractJson(text);
        if (!j.error) return { outcome: 'completed', structuredOutput: j.value, usage: usage() };
        if (round === 0) {
          for (const m of msgs) seen.add(key(m));
          const rp = await s.api('POST', `/api/session/${sid}/prompt`, { text: 'Your last reply did not contain the required JSON object. Do not call any tool now. Reply now with only the single JSON object that conforms to the schema.' });
          if (rp.status !== 200) return { outcome: 'failed', reason: `repair prompt ${rp.status}`, usage: usage() };
          created = (rp.body.data.time?.created ?? 0) - 1; if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
          continue;
        }
        // Say what the reply actually contained: an empty final text next to reasoning parts is a different failure from malformed JSON.
        const parts = mine.flatMap((m) => (m.content ?? []) as Array<{ type: string }>); const kinds = new Map<string, number>(); for (const c of parts) kinds.set(c.type, (kinds.get(c.type) ?? 0) + 1);
        const shape = `after one repair round; assistant parts: ${[...kinds].map(([k, n]) => `${k} x${n}`).join(', ') || 'none'}; text chars ${text.length}`;
        return { outcome: 'failed', reason: `reply was not JSON: ${j.error} (${shape})`.slice(0, 300), usage: usage() };
      }
      return { outcome: 'failed', reason: 'no reply', usage: usage() };
    } catch (e) { return { outcome: signal.aborted ? 'interrupted' : 'failed', reason: String((e as Error).message).slice(0, 300), usage: usage() }; }
    finally { await s?.stop(); }
  }
}
void readdirSync;
