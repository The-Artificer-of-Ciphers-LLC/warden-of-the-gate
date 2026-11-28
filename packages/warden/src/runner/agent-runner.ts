import type { ValidateFunction } from 'ajv/dist/2020.js';
import { ajv, ajvMessages } from '../config/schemas.ts';

/** The single thin seam between warden-core and a harness (ADR 0006). No plugin framework, no second adapter in P1. Harness differences
 *  (launching headless sessions, obtaining structured output, pinning tools) live inside an adapter; the core never changes per harness. */
export interface ToolSurface { allow: string[] }                  // named allows over a deny-all start (P0: unlisted names grant nothing; positive-controlled)
export interface Budgets { maxToolCalls: number; maxModelTurns: number; wallTimeMs: number }
/** `workspace`: a directory the session may work in (writable only when asked). Without it the packet directory is the read-only workspace. */
export interface SessionRequest { task: string; item: number; packetDir: string; tools: ToolSurface; resultSchema: object; budgets: Budgets; expectedModel: string; workspace?: { dir: string; writable: boolean }; /** The packet holds a read-only snapshot of the repository under ./repo: the session may read and list it, nothing else. */ repoContext?: boolean }
export interface PreflightReport { ok: boolean; harnessVersion?: string; resolvedModel?: string; isolation?: string; failures: string[] }
/** The harness as a run records it: its name plus the version the preflight observed (e.g. "opencode 2.4.1"). A configured label that already
 *  carries a version keeps it only when nothing was observed; an observed version always replaces it. */
export const harnessLabel = (harness: string, observed?: string) => observed ? `${harness.split(' ')[0]} ${observed}` : harness;
export type SessionOutcome = 'completed' | 'interrupted' | 'budget-exceeded' | 'failed';
export interface SessionResult { outcome: SessionOutcome; structuredOutput?: unknown; transcriptPath?: string; usage: { toolCalls: number; modelTurns: number; wallMs: number }; reason?: string }
export interface AgentRunner {
  /** `pinnedVersion`: the harness version, or range of versions, the adapter accepts (OpenCode: `>=2.2.7 <3.0.0`, ADR 0004). */
  readonly name: string; readonly pinnedVersion: string;
  /** The harness version the last preflight observed, i.e. what this run actually used; recorded with the run's result. */
  readonly observedVersion?: string;
  /** Resolved model + all enabled providers must be local, isolation present, endpoint answering. Any unknown => ok:false (blocks execution). */
  preflight(): Promise<PreflightReport>;
  /** Fresh serial session. MUST honor `signal` (interrupt) and call `monitor.observe` as tool calls/turns happen. */
  run(req: SessionRequest, signal: AbortSignal, monitor: BudgetMonitor): Promise<SessionResult>;
}

/** Runner-enforced budget. P0 finding: the harness step cap bounds model steps only, not tool calls (one step can batch many), so the
 *  runner owns tool-call and wall-clock budgets and aborts the session when exceeded. */
export class BudgetMonitor {
  toolCalls = 0; modelTurns = 0; exceeded: string | null = null; private started: number; private budgets: Budgets; private abort: AbortController; private clock: () => number;
  constructor(budgets: Budgets, abort: AbortController, clock: () => number = Date.now) { this.budgets = budgets; this.abort = abort; this.clock = clock; this.started = clock(); }
  observe(d: { toolCalls?: number; modelTurns?: number }): string | null {
    this.toolCalls += d.toolCalls ?? 0; this.modelTurns += d.modelTurns ?? 0;
    const why = this.toolCalls > this.budgets.maxToolCalls ? `tool-call budget ${this.budgets.maxToolCalls} exceeded`
      : this.modelTurns > this.budgets.maxModelTurns ? `model-turn budget ${this.budgets.maxModelTurns} exceeded`
      : this.clock() - this.started > this.budgets.wallTimeMs ? `wall-time budget ${this.budgets.wallTimeMs}ms exceeded` : null;
    if (why && !this.exceeded) { this.exceeded = why; this.abort.abort(new Error(why)); }
    return this.exceeded;
  }
  usage() { return { toolCalls: this.toolCalls, modelTurns: this.modelTurns, wallMs: this.clock() - this.started }; }
}

export type ValidatedResult = { accepted: true; output: unknown; result: SessionResult } | { accepted: false; reason: string; result?: SessionResult };
/** Runner-side orchestration: preflight (refuses when stopped / unverified), fresh session, budget enforcement, then Ajv re-validation of
 *  the structured output regardless of harness. Validity is necessary, not sufficient: the core still validates scope/identity/effects. */
export async function runValidated(runner: AgentRunner, req: SessionRequest, o: { stopped: () => boolean; signal?: AbortSignal; clock?: () => number }): Promise<ValidatedResult> {
  if (o.stopped()) return { accepted: false, reason: 'stopped: no new local model work' };
  const pf = await runner.preflight().catch((e) => ({ ok: false, failures: [String(e)] } as PreflightReport));
  if (!pf.ok) return { accepted: false, reason: 'preflight failed: ' + pf.failures.join('; ') };
  let validate: ValidateFunction; try { validate = ajv.compile(req.resultSchema); } catch (e) { return { accepted: false, reason: 'result schema invalid: ' + String(e).slice(0, 100) }; }
  const ac = new AbortController(); o.signal?.addEventListener('abort', () => ac.abort(o.signal!.reason));
  const mon = new BudgetMonitor(req.budgets, ac, o.clock);
  const res = await runner.run(req, ac.signal, mon);
  if (mon.exceeded) return { accepted: false, reason: mon.exceeded, result: { ...res, outcome: 'budget-exceeded', usage: mon.usage() } };
  if (res.outcome !== 'completed') return { accepted: false, reason: `session ${res.outcome}${res.reason ? ': ' + res.reason : ''}`, result: res };
  if (!validate(res.structuredOutput)) return { accepted: false, reason: 'structured output rejected: ' + ajvMessages(validate).join('; '), result: res };
  return { accepted: true, output: res.structuredOutput, result: res };
}

/** P1 has no model-backed task: this adapter is the honest "not ready" implementation. It never fabricates a result. */
export class NotReadyRunner implements AgentRunner {
  readonly name = 'not-ready'; readonly pinnedVersion = 'none';
  async preflight(): Promise<PreflightReport> { return { ok: false, failures: ['no harness adapter installed in P1 (OpenCode adapter lands in P3)'] }; }
  async run(): Promise<SessionResult> { return { outcome: 'failed', reason: 'not-ready', usage: { toolCalls: 0, modelTurns: 0, wallMs: 0 } }; }
}
