import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadConfigs, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { readLocalStop } from '../control/stop.ts';
import { OpenCodeRunner } from '../runner/opencode.ts';
import { NotReadyRunner } from '../runner/agent-runner.ts';
import type { AgentRunner } from '../runner/agent-runner.ts';
import { runReplay, validateSet } from '../replay/replay.ts';
import type { ReplaySet } from '../replay/replay.ts';

/** `warden replay --set FILE [--runner opencode] [--validate-only]`: replay a maintainer-curated set against the local model in a SIMULATED repository and print a
 *  measured report plus a qualification verdict. It never touches GitHub and never activates anything. */
export async function replay(c: Ctx): Promise<Result> {
  const file = str(c.flags, 'set'); if (!file || !existsSync(file)) return { code: 2, data: {}, text: 'replay: --set FILE (a replay set JSON) is required' };
  let set: ReplaySet; try { set = JSON.parse(readFileSync(file, 'utf8')) as ReplaySet; } catch (e) { return { code: 2, data: {}, text: `replay: the set is not valid JSON: ${(e as Error).message}` }; }
  const bad = validateSet(set); if (bad) return { code: 2, data: { problem: bad }, text: `replay: invalid set: ${bad}` };
  if (c.flags['validate-only']) return { code: 0, data: { name: set.name, cases: set.cases.length, synthetic: !!set.synthetic }, text: `replay: set "${set.name}" is valid (${set.cases.length} case(s))` };
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'replay: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; let st; try { st = openStorage(c, cfg.repository); } catch (e) { return { code: 4, data: { outcome: 'blocked' }, text: `replay blocked: ${(e as Error).message}` }; }
  const local = readLocalStop(st); if (local.stopped) return { code: 4, data: { outcome: 'blocked', reason: 'local stop in force' }, text: 'replay blocked: local stop in force' };
  const runner: AgentRunner = str(c.flags, 'runner') === 'opencode' ? new OpenCodeRunner({ modelId: cfg.runtime.modelPool[0], baseURL: str(c.flags, 'lmstudio-url'), maxPromptChars: 60_000 }) : new NotReadyRunner();
  const rep = await runReplay(set, { runner, localModels: cfg.runtime.modelPool, budgets: { maxToolCalls: cfg.runtime.budgets.maxToolCalls, maxModelTurns: cfg.runtime.budgets.maxModelTurns, wallTimeMs: cfg.runtime.budgets.wallTimeSeconds * 1000 }, stopped: () => readLocalStop(st).stopped });
  mkdirSync(st.path('replay'), { recursive: true, mode: 0o700 }); const out = st.path('replay', `report-${new Date(c.now()).toISOString().replace(/[:.]/g, '-')}.json`); st.writeJson(out, rep);
  return { code: 0, data: { ...rep, reportFile: out } as unknown as Record<string, unknown>, text: `replay "${rep.set}": ${rep.prs} PR / ${rep.issues} issue case(s); qualified: ${rep.qualification.qualified}${rep.qualification.reasons.map((r) => `\n  - ${r}`).join('')}\nactivation: ${rep.activation}` };
}
