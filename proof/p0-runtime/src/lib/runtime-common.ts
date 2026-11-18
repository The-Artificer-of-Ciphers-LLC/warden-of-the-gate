// Shared pieces for the OpenCode runtime proof: hardened config, resolved-provider preflight,
// structured-output validation, and completion waiting. Spike code - evidence, not production.
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { Ajv } from 'ajv';
import type { Server } from './oc.ts';

export const LMSTUDIO_PORT = 1235;
export const LOCAL_MODEL_ID = 'warden-proof-qwen'; // identifier given to the loaded LM Studio model
export const LOCAL_MODEL_KEY = 'qwen3.8-27b';

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
    model: o.defaultModel ?? `lmstudio/${LOCAL_MODEL_ID}`,
    providers: {
      lmstudio: {
        name: 'LM Studio (local)',
        package: '@ai-sdk/openai-compatible',
        settings: { baseURL: o.baseURL ?? `http://127.0.0.1:${LMSTUDIO_PORT}/v1` },
        models: {
          [LOCAL_MODEL_ID]: { name: LOCAL_MODEL_ID, limit: { context: o.contextLimit ?? 32768, output: o.outputLimit ?? 4096 } },
          ...(o.extraModels ?? {}),
        },
      },
    },
    update: 'disable',
    share: 'disabled',
    ...(o.denyHosted === false ? {} : { policies: [{ action: 'provider.use', resource: 'opencode', effect: 'deny' }] }),
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
  const prov = await s.api('GET', '/api/provider');
  const def = await s.api('GET', '/api/model/default');
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

export interface LmsModel { identifier: string; status: string; device: string; sizeGB: number }
export function lmsLoaded(): LmsModel[] {
  const j = JSON.parse(execFileSync('lms', ['ps', '--json'], { encoding: 'utf8' })) as any[];
  return j.map((m) => ({ identifier: m.identifier, status: m.status, device: m.deviceIdentifier ?? m.device ?? 'Local', sizeGB: Math.round((m.sizeBytes ?? 0) / 1e8) / 10 }));
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
