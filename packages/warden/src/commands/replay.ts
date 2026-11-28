import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadConfigs, modelLimits, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { readLocalStop } from '../control/stop.ts';
import { OpenCodeRunner } from '../runner/opencode.ts';
import { NotReadyRunner } from '../runner/agent-runner.ts';
import type { AgentRunner } from '../runner/agent-runner.ts';
import { runReplay, validateSet } from '../replay/replay.ts';
import type { ReplaySet } from '../replay/replay.ts';

/** `warden replay --set FILE [--runner opencode] [--validate-only] [--split dev|holdout] [--lookup-clone DIR] [--context-chars N]`: replay a maintainer-curated set against the local model in a SIMULATED repository and print a
 *  measured report plus a qualification verdict. It never touches GitHub and never activates anything. */
export async function replay(c: Ctx): Promise<Result> {
  const file = str(c.flags, 'set'); if (!file || !existsSync(file)) return { code: 2, data: {}, text: 'replay: --set FILE (a replay set JSON) is required' };
  let set: ReplaySet; try { set = JSON.parse(readFileSync(file, 'utf8')) as ReplaySet; } catch (e) { return { code: 2, data: {}, text: `replay: the set is not valid JSON: ${(e as Error).message}` }; }
  // `--split dev|holdout`: a stable half of the cases (by hash of the case id) for TUNING. A half never reaches the qualification size, so it can never qualify: the
  // honest number comes only from the untouched holdout, run once after tuning.
  const split = str(c.flags, 'split');
  if (split) {
    if (split !== 'dev' && split !== 'holdout') return { code: 2, data: {}, text: 'replay: --split must be dev or holdout' };
    const half = (id: string) => (createHash('sha256').update(id).digest()[0] & 1) === 0 ? 'dev' : 'holdout';
    set = { ...set, name: `${set.name} [${split}]`, cases: set.cases.filter((x) => half(x.id) === split) };
  }
  const bad = validateSet(set); if (bad) return { code: 2, data: { problem: bad }, text: `replay: invalid set: ${bad}` };
  if (c.flags['validate-only']) return { code: 0, data: { name: set.name, cases: set.cases.length, synthetic: !!set.synthetic }, text: `replay: set "${set.name}" is valid (${set.cases.length} case(s))` };
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'replay: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; let st; try { st = openStorage(c, cfg.repository); } catch (e) { return { code: 4, data: { outcome: 'blocked' }, text: `replay blocked: ${(e as Error).message}` }; }
  const local = readLocalStop(st); if (local.stopped) return { code: 4, data: { outcome: 'blocked', reason: 'local stop in force' }, text: 'replay blocked: local stop in force' };
  // `--lookup-clone DIR`: a local clone holding every case's head commit; each review then gets the repository context pack (docs/adr/0013-code-lookup.md).
  const lookupClone = str(c.flags, 'lookup-clone'); if (lookupClone && !existsSync(lookupClone)) return { code: 2, data: {}, text: `replay: --lookup-clone ${lookupClone} does not exist` };
  const contextChars = str(c.flags, 'context-chars') ? Number(str(c.flags, 'context-chars')) : undefined;
  if (contextChars !== undefined && !(Number.isInteger(contextChars) && contextChars >= 0)) return { code: 2, data: {}, text: 'replay: --context-chars must be a non-negative integer' };
  const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: (str(c.flags, 'model-url') ?? str(c.flags, 'lmstudio-url')), ...modelLimits(c.flags), maxPromptChars: 60_000, ...(str(c.flags, 'compaction') === 'off' ? { autoCompact: false } : {}), ...(str(c.flags, 'window-guard') ? { windowGuard: Number(str(c.flags, 'window-guard')) } : {}), ...(str(c.flags, 'context-limit') ? { contextLimit: Number(str(c.flags, 'context-limit')) } : {}), ...(str(c.flags, 'output-limit') ? { outputLimit: Number(str(c.flags, 'output-limit')) } : {}) }) : new NotReadyRunner();
  // `--context-repo PATH --bases FILE`: a LOCAL git checkout plus {caseId: baseSha}. Each PR case gets a read-only snapshot of that repo at the PR's base (git archive: no network).
  const ctxRepo = str(c.flags, 'context-repo'); const basesFile = str(c.flags, 'bases');
  if (ctxRepo && basesFile) { const bases = JSON.parse(readFileSync(basesFile, 'utf8')) as Record<string, string>; set = { ...set, cases: set.cases.map((x) => (x.kind === 'review' && bases[x.id] ? { ...x, base: bases[x.id] } : x)) }; }
  const contextFor = ctxRepo && basesFile ? (base: string, dest: string) => { if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('bad base'); mkdirSync(dest, { recursive: true }); const tar = execFileSync('git', ['-C', ctxRepo, 'archive', '--format=tar', base], { maxBuffer: 512 * 1024 * 1024 }); execFileSync('tar', ['-x', '-C', dest], { input: tar }); } : undefined;
  const rep = await runReplay(set, { lookupClone, maxContextChars: contextChars, maxPromptChars: 60_000, runner, contextFor, localModels: cfg.runtime.modelPool, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: Number(str(c.flags, 'max-turns') ?? cfg.runtime.budgets.maxModelTurns), wallTimeMs: Number(str(c.flags, 'max-wall-seconds') ?? cfg.runtime.budgets.wallTimeSeconds) * 1000 }, stopped: () => readLocalStop(st).stopped, onCase: (r, done, total) => console.error(`replay ${done}/${total} ${r.id} ${r.outcome}${r.matched !== undefined ? (r.matched ? ' matched' : ' no-match') : r.hits !== undefined ? ` hits ${r.hits}/${r.expected} findings ${r.findings}` : ''}${r.context ? ` context ${r.context.status} ${r.context.items} item(s)` : ''}`) });
  mkdirSync(st.path('replay'), { recursive: true, mode: 0o700 }); const out = st.path('replay', `report-${new Date(c.now()).toISOString().replace(/[:.]/g, '-')}.json`); const harness = runner.observedVersion ? { harnessVersion: runner.observedVersion } : {}; st.writeJson(out, { ...rep, ...harness });   // the OpenCode version this replay actually used (ADR 0004)
  return { code: 0, data: { ...rep, ...harness, reportFile: out } as unknown as Record<string, unknown>, text: `replay "${rep.set}": ${rep.prs} PR / ${rep.issues} issue case(s); qualified: ${rep.qualification.qualified}${rep.qualification.reasons.map((r) => `\n  - ${r}`).join('')}\nactivation: ${rep.activation}` };
}
