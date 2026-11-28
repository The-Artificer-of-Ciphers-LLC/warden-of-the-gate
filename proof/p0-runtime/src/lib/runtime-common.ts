// Shared pieces for the OpenCode runtime proof: hardened config, resolved-provider preflight,
// structured-output validation, and completion waiting. Spike code - evidence, not production.
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { Ajv } from 'ajv';
import type { Server } from './oc.ts';

/** The MVP model server is mlx-serve (ddalcu) on loopback (owner rulings 2026-11-24 and 2026-11-28: "we are only using mlx-serve").
 *  Port and model match .github/warden.yml's modelPool; override with WARDEN_PROOF_MODEL_PORT / WARDEN_PROOF_MODEL. */
export const MODEL_PORT = Number(process.env.WARDEN_PROOF_MODEL_PORT ?? 11234);
export const MODEL_BASE_URL = `http://127.0.0.1:${MODEL_PORT}/v1`;
export const LOCAL_MODEL_ID = process.env.WARDEN_PROOF_MODEL ?? 'beamster/Qwen3.8-Flash-Next-Sushi-2bpw';
/** Provider id Warden registers the local endpoint under (same as packages/warden/src/runner/opencode.ts, PR #148). Not "lmstudio":
 *  OpenCode merges a config provider into a built-in provider of the same id, and its built-in lmstudio plugin probes its own path. */
export const LOCAL_PROVIDER_ID = 'mlx-serve';
export const LOCAL_PROVIDER_NAME = 'mlx-serve (local)';
/** OpenCode's built-in local provider plugins; denied so they can never become an enabled provider beside Warden's own. */
export const BUILTIN_LOCAL_PROVIDERS = ['lmstudio', 'ollama'] as const;
/** Context window the proof declares to OpenCode: 32768, or the window mlx-serve reports for the model if that is smaller
 *  (mlx-serve pins the real window at model load). Set by servedModel() before any session is created. */
let servedContext = 32768;
export const proofContextLimit = () => servedContext;

/** Env flags that stop the harness from phoning home / enabling hosted free models / reading repo config. */
export const HARDEN_ENV: Record<string, string> = {
  OPENCODE_DISABLE_MODELS_FETCH: '1', // no models.opencode.ai catalog fetch
  OPENCODE_DISABLE_FREE_MODELS: '1',  // no hosted "free" inference models
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1', // repo-supplied opencode.json / .opencode must not steer the harness
  OPENCODE_FILEWATCHER_DISABLE: '1',
};

export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}

export interface CfgOpts {
  baseURL?: string;
  defaultModel?: string; // provider/model
  outputLimit?: number;
  contextLimit?: number;
  denyHosted?: boolean;
  extraModels?: Record<string, unknown>;
  agents?: Record<string, unknown>;
  toolOutput?: { max_bytes?: number; max_lines?: number };
}

export function cfgFor(o: CfgOpts = {}): Record<string, unknown> {
  return {
    model: o.defaultModel ?? `${LOCAL_PROVIDER_ID}/${LOCAL_MODEL_ID}`,
    providers: {
      [LOCAL_PROVIDER_ID]: {
        name: LOCAL_PROVIDER_NAME,
        package: '@ai-sdk/openai-compatible',
        settings: { baseURL: o.baseURL ?? MODEL_BASE_URL },
        models: {
          [LOCAL_MODEL_ID]: { name: LOCAL_MODEL_ID, limit: { context: o.contextLimit ?? servedContext, output: o.outputLimit ?? 4096 } },
          ...(o.extraModels ?? {}),
        },
      },
    },
    update: 'disable',
    share: 'disabled',
    // Built-in local plugins are always denied (as in the Warden adapter); denyHosted:false only re-enables the hosted "opencode" provider.
    policies: [...(o.denyHosted === false ? [] : ['opencode']), ...BUILTIN_LOCAL_PROVIDERS].map((resource) => ({ action: 'provider.use', resource, effect: 'deny' })),
    ...(o.agents ? { agents: o.agents } : {}),
    ...(o.toolOutput ? { tool_output: o.toolOutput } : {}),
  };
}

// ---------------- resolved provider/model preflight ----------------
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export function classifyBaseURL(raw: string): { local: boolean; host: string; reason?: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { local: false, host: raw, reason: 'unparseable URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { local: false, host: u.hostname, reason: `protocol ${u.protocol}` };
  if (u.username || u.password) return { local: false, host: u.hostname, reason: 'userinfo present (lookalike host trick)' };
  if (!LOOPBACK_HOSTS.has(u.hostname)) return { local: false, host: u.hostname, reason: `host ${u.hostname} is not a loopback literal` };
  return { local: true, host: u.hostname };
}

export interface Resolved { providerID: string; modelID: string; baseURL: string; host: string }
export interface Preflight { ok: boolean; reasons: string[]; resolved?: Resolved; enabledProviders: Array<{ id: string; baseURL: string }>; endpoint?: { status: number | string; modelListed: boolean } }

/**
 * Asks the RUNNING harness what it actually resolved (not what the config file says).
 * Rejects if the resolved default model, or ANY enabled provider, is not a loopback endpoint.
 * Also probes the local endpoint so local unavailability is detected before a session exists.
 */
export async function preflightResolve(s: Server, opts: { probe?: boolean; expect?: { providerID: string; modelID: string } } = {}): Promise<Preflight> {
  const reasons: string[] = [];
  let prov = await s.api('GET', '/api/provider');
  let def = await s.api('GET', '/api/model/default');
  // OpenCode 2.4.x answers 200 with no providers and no default for a few seconds after "listening". Keep asking while that is
  // all it says (the adapter's judgeRouting `loading` state); anything else is judged at once.
  for (let t0 = Date.now(); Date.now() - t0 < 30000; ) {
    const loading = prov.status === 200 && def.status === 200 && !def.body?.data && !((prov.body?.data ?? []) as any[]).some((p) => p.activation === 'enabled');
    if (!loading) break;
    await new Promise((r) => setTimeout(r, 250));
    [prov, def] = await Promise.all([s.api('GET', '/api/provider'), s.api('GET', '/api/model/default')]);
  }
  const enabledProviders = ((prov.body?.data ?? []) as any[])
    .filter((p) => p.activation === 'enabled')
    .map((p) => ({ id: p.id as string, baseURL: String(p.settings?.baseURL ?? '') }));
  let resolved: Resolved | undefined;
  if (def.status !== 200 || !def.body?.data) reasons.push(`no resolved default model (status ${def.status})`);
  else {
    const d = def.body.data;
    const baseURL = String(d.settings?.baseURL ?? '');
    const c = classifyBaseURL(baseURL);
    resolved = { providerID: d.providerID, modelID: d.modelID ?? d.id, baseURL, host: c.host };
    if (!c.local) reasons.push(`resolved model ${d.providerID}/${d.modelID ?? d.id} routes to non-local endpoint: ${c.reason}`);
    // Resolved != configured: OpenCode silently substitutes another available model when the configured default is unavailable.
    if (opts.expect && (resolved.providerID !== opts.expect.providerID || resolved.modelID !== opts.expect.modelID)) {
      reasons.push(`resolved model ${resolved.providerID}/${resolved.modelID} != expected pool member ${opts.expect.providerID}/${opts.expect.modelID} (silent substitution)`);
    }
  }
  for (const p of enabledProviders) {
    const c = classifyBaseURL(p.baseURL);
    if (!c.local) reasons.push(`enabled provider "${p.id}" is non-local (${c.reason ?? p.baseURL})`);
  }
  let endpoint: Preflight['endpoint'];
  if (opts.probe && resolved && classifyBaseURL(resolved.baseURL).local) {
    try {
      const r = await fetch(resolved.baseURL.replace(/\/$/, '') + '/models', { signal: AbortSignal.timeout(3000) });
      const j: any = await r.json().catch(() => ({}));
      const listed = Array.isArray(j.data) && j.data.some((m: any) => m.id === resolved!.modelID);
      endpoint = { status: r.status, modelListed: listed };
      if (r.status !== 200 || !listed) reasons.push(`local endpoint unhealthy or model not served (status ${r.status}, listed=${listed})`);
    } catch (e) {
      endpoint = { status: (e as Error).name, modelListed: false };
      reasons.push(`local endpoint unreachable: ${(e as Error).name}`);
    }
  }
  return { ok: reasons.length === 0, reasons, resolved, enabledProviders, endpoint };
}

// ---------------- mlx-serve (ddalcu) facts ----------------
/** The /v1/models row for the proof model, straight from mlx-serve (OpenAI-compatible list). */
export interface ServedModel { listed: boolean; status: number | string; row?: { id: string; context_length?: number; max_model_len?: number; owned_by?: string }; ids: string[] }
export async function servedModel(): Promise<ServedModel> {
  try {
    const r = await fetch(`${MODEL_BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
    const j: any = await r.json().catch(() => ({}));
    const rows = (Array.isArray(j.data) ? j.data : []) as any[];
    const m = rows.find((x) => x.id === LOCAL_MODEL_ID);
    const row = m ? { id: m.id, context_length: m.context_length ?? m.meta?.context_length, max_model_len: m.max_model_len, owned_by: m.owned_by } : undefined;
    const win = Number(row?.context_length ?? row?.max_model_len);
    if (Number.isFinite(win) && win > 0 && win < servedContext) servedContext = win;
    return { listed: !!m, status: r.status, row, ids: rows.map((x) => String(x.id)) };
  } catch (e) { return { listed: false, status: (e as Error).name, ids: [] }; }
}

/** Who owns the model port on THIS Mac: lsof's listener rows (command, pid, bound address). A forwarder (ssh, socat, ...) owning the
 *  port would mean the "local" endpoint is a tunnel. Server-declared, like LM Studio's device field was: it shows which program
 *  answers, not where that program forwards (docs/research/MODEL-CONNECTIONS.md, "A loopback URL proves the first hop"). */
export const FORWARDERS = /^(ssh|autossh|socat|nc|ncat|netcat|kubectl|cloudflared|ngrok|tailscaled?|frpc|chisel|gost)$/i;
export interface PortOwner { command: string; pid: number; address: string }
export function modelPortOwners(): PortOwner[] {
  let out = '';
  try { out = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${MODEL_PORT}`, '-sTCP:LISTEN', '-Fpcn'], { encoding: 'utf8' }); } catch { return []; }
  const rows: PortOwner[] = []; let pid = 0; let command = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n')) rows.push({ command, pid, address: line.slice(1) });
  }
  return rows;
}

/** Best-effort numeric snapshot of mlx-serve's /metrics.json (only served with `--metrics`; its keys are not documented).
 *  Recorded as evidence for a reader; no check passes or fails on a guessed key name. */
export async function metricsSnapshot(): Promise<{ status: number | string; numbers?: Record<string, number> }> {
  try {
    const r = await fetch(`http://127.0.0.1:${MODEL_PORT}/metrics.json`, { signal: AbortSignal.timeout(3000) });
    if (r.status !== 200) return { status: r.status };
    const j: any = await r.json().catch(() => undefined);
    const numbers: Record<string, number> = {};
    const walk = (v: any, k: string, depth: number) => {
      if (Object.keys(numbers).length >= 80 || depth > 4) return;
      if (typeof v === 'number' && Number.isFinite(v)) numbers[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [kk, vv] of Object.entries(v)) walk(vv, k ? `${k}.${kk}` : kk, depth + 1);
    };
    walk(j, '', 0);
    return { status: 200, numbers };
  } catch (e) { return { status: (e as Error).name }; }
}

// ---------------- structured output ----------------
export const REVIEW_SCHEMA = {
  $id: 'https://warden.invalid/schemas/shadow-review-result.json',
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings'],
  properties: {
    verdict: { enum: ['approve', 'request_changes', 'comment'] },
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    findings: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', additionalProperties: false, required: ['severity', 'file', 'line', 'claim'],
        properties: {
          severity: { enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string', minLength: 1 },
          line: { type: 'integer', minimum: 1 },
          claim: { type: 'string', minLength: 1, maxLength: 400 },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
export const validateReview = ajv.compile(REVIEW_SCHEMA);

export const REVIEW_PACKET = `File: src/sum.ts (changed lines)
1: export function sumTo(n: number): number {
2:   let total = 0;
3:   for (let i = 0; i <= n; i++) total += i;
4:   return total;
5: }
PR description: "sumTo(n) returns the sum of integers from 1 to n-1 (exclusive of n)."`;

export function reviewPrompt(): string {
  return [
    'You are a code reviewer. Review ONLY the packet below. Reply with a single JSON object and nothing else (no prose, no code fences).',
    'The JSON must conform to this JSON Schema:',
    JSON.stringify(REVIEW_SCHEMA),
    'PACKET:', REVIEW_PACKET,
  ].join('\n');
}

export function extractJson(text: string): { value?: unknown; error?: string } {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  try { return { value: JSON.parse(candidate) }; } catch (e) { return { error: (e as Error).message }; }
}

// ---------------- waiting ----------------
/** Poll the message log until an idle record newer than the prompt message exists (or timeout). */
export async function awaitCompletion(s: Server, sid: string, afterMsgCreated: number, timeoutMs: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await s.api('GET', `/api/session/${sid}/message`);
    const msgs = (r.body?.data ?? []) as any[];
    const idle = msgs.find((m) => m.type === 'idle' && m.time?.created >= afterMsgCreated);
    if (idle) return { timedOut: false, outcome: idle.outcome as string, ms: Date.now() - t0, msgs };
    await new Promise((res) => setTimeout(res, 400));
  }
  const r = await s.api('GET', `/api/session/${sid}/message`);
  return { timedOut: true, outcome: 'timeout', ms: Date.now() - t0, msgs: (r.body?.data ?? []) as any[] };
}
