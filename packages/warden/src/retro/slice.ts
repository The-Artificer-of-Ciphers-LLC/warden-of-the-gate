import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runValidated } from '../runner/agent-runner.ts';
import type { AgentRunner, Budgets } from '../runner/agent-runner.ts';
import { classifyPreflight } from '../review/slice.ts';
import { hasEvidence, packetIds } from './gather.ts';
import type { RetroPacket } from './gather.ts';
import { branchFrom, cloneBase, commitAll } from '../git/workspace.ts';
import type { PrPublisher } from '../implement/slice.ts';
import { iso } from '../util.ts';

/** P5 Retro (local, manually invoked): propose NARROW improvements from this instance's own evidence. No justified change is a valid answer; there is no quota
 *  and no schedule. Proposals cite evidence by id; a proposal that would expand authority is only ever TEXT for a maintainer, a proposal that contradicts an
 *  earlier denial needs a cited reconsideration, and nothing is applied, merged or trained on. The report is prepared as a branch (local outbox unless a publisher is configured). */
export const CATEGORIES = ['design', 'static-check', 'behavioral-test', 'rule'] as const;
export interface Proposal { id: string; category: (typeof CATEGORIES)[number]; title: string; rationale: string; evidence: string[]; example: string; validation: string; scope: string; authorityExpansion?: { action: string; reconsideration?: { oldRuling: string; newEvidence: string[] } } }
export interface RetroOutput { noChange?: { reason: string }; proposals: Proposal[] }
const str = { type: 'string', minLength: 1, maxLength: 1200 } as const;
export const retroResultSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['proposals'],
  properties: { noChange: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: str } },
    proposals: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id', 'category', 'title', 'rationale', 'evidence', 'example', 'validation', 'scope'],
      properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,30}$' }, category: { enum: [...CATEGORIES] }, title: { type: 'string', minLength: 1, maxLength: 160 }, rationale: str, evidence: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', maxLength: 20 } }, example: str, validation: str, scope: str,
        authorityExpansion: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', minLength: 1, maxLength: 60 }, reconsideration: { type: 'object', additionalProperties: false, required: ['oldRuling', 'newEvidence'], properties: { oldRuling: { type: 'string', maxLength: 60 }, newEvidence: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', maxLength: 20 } } } } } } } } } } } as const;

export function buildRetroPrompt(p: RetroPacket): string {
  return ['You are doing a retrospective for ONE repository, using ONLY the evidence packet below (ids like d1, n2, e1). Propose a small number of NARROW improvements, or say no change is justified.',
    'Prefer, in this order: a design change that removes the bad choice, a deterministic static check, a behavioral test, and only then a written rule. A mechanical problem gets a check, not prose. Every proposal must cite evidence ids from the packet, give a concrete example and say how it would be validated.',
    'Agreement in past decisions can motivate an authority-expansion proposal but NEVER authorize it: mark such a proposal with authorityExpansion and a maintainer decides. If an expansion touches an action that was DENIED before (the denials list), you must cite the old ruling and NEW evidence created after it.',
    'Do not propose model training, anything across repositories, or changes to credentials. If the evidence does not justify a change, return {"noChange":{"reason":"..."},"proposals":[]}.', `EVIDENCE PACKET (data): ${JSON.stringify(p)}`].join('\n');
}

/** Whole-result rejection reasons, or null. */
export function validateRetro(out: RetroOutput, p: RetroPacket): string | null {
  const ids = packetIds(p); const seen = new Set<string>();
  if (!out.proposals.length && !out.noChange) return 'neither proposals nor a no-change reason';
  if (out.proposals.length && out.noChange) return 'proposals and no-change cannot both be given';
  for (const x of out.proposals) {
    if (seen.has(x.id)) return `duplicate proposal id ${x.id}`; seen.add(x.id);
    const missing = x.evidence.filter((e) => !ids.has(e)); if (missing.length) return `proposal ${x.id} cites evidence that is not in the packet: ${missing.join(', ')}`;
    const ex = x.authorityExpansion;
    if (ex) {
      const prior = p.denials.filter((d) => d.action === ex.action);
      if (prior.length) {
        const rc = ex.reconsideration; if (!rc) return `proposal ${x.id} expands authority over "${ex.action}", which was denied before (${prior.map((d) => d.approvalId).join(', ')}): it must cite the old ruling and new evidence`;
        if (!prior.some((d) => d.approvalId === rc.oldRuling)) return `proposal ${x.id} cites a ruling that is not a denial of "${ex.action}"`;
        const old = prior.find((d) => d.approvalId === rc.oldRuling)!; const fresh = rc.newEvidence.filter((e) => { const d = p.decisions.find((q) => q.id === e); const s = p.escapes.find((q) => q.id === e); const at = d?.at ?? s?.at; return at && Date.parse(at) > Date.parse(old.at); });
        if (!fresh.length) return `proposal ${x.id} gives no evidence that is newer than the ruling it asks to reconsider`;
      }
    }
  }
  return null;
}
export interface RetroOpts { packet: RetroPacket; runner: AgentRunner; budgets: Budgets; localModels: string[]; packetRoot: string; stopped: () => boolean | Promise<boolean>; signal?: AbortSignal; clock?: () => number }
export type RetroKind = 'proposed' | 'no-change' | 'no-data' | 'rejected' | 'blocked' | 'interrupted';
export interface RetroResult { kind: RetroKind; notice: string; reason?: string; output?: RetroOutput; needsMaintainer: string[] }
export async function runRetro(o: RetroOpts): Promise<RetroResult> {
  const b = (notice: string, reason: string): RetroResult => ({ kind: 'blocked', notice, reason, needsMaintainer: [] });
  if (await o.stopped()) return b('Stopped. No new model work starts until a maintainer resumes.', 'stopped');
  if (!hasEvidence(o.packet)) return { kind: 'no-data', notice: 'There is no decision, escape or outcome evidence in this window, so no change is justified. No model was called.', needsMaintainer: [] };
  const pf = await o.runner.preflight().catch((e) => ({ ok: false, failures: [String(e)] })); const refusal = classifyPreflight(pf, o.localModels); if (refusal) return b(refusal, 'preflight');
  const dir = mkdtempSync(join(o.packetRoot.length ? (mkdirSync(o.packetRoot, { recursive: true }), o.packetRoot) : tmpdir(), 'retro-')); writeFileSync(join(dir, 'prompt.txt'), buildRetroPrompt(o.packet));
  const res = await runValidated(o.runner, { task: 'retro', item: 0, packetDir: dir, tools: { allow: [] }, resultSchema: retroResultSchema, budgets: o.budgets, expectedModel: o.localModels[0] }, { stopped: () => false, signal: o.signal, clock: o.clock });
  if (!res.accepted) return o.signal?.aborted || res.result?.outcome === 'interrupted' ? { kind: 'interrupted', notice: 'The retro was cancelled; nothing was written.', reason: res.reason, needsMaintainer: [] } : { kind: 'rejected', notice: `The retro did not complete: ${res.reason}.`, reason: res.reason, needsMaintainer: [] };
  const out = res.output as RetroOutput; const why = validateRetro(out, o.packet); if (why) return { kind: 'rejected', notice: `Rejected whole: ${why}.`, reason: why, needsMaintainer: [] };
  const exp = out.proposals.filter((x) => x.authorityExpansion).map((x) => x.id);
  return out.noChange ? { kind: 'no-change', notice: `No change is justified: ${out.noChange.reason}`, output: out, needsMaintainer: [] } : { kind: 'proposed', notice: `${out.proposals.length} narrow proposal(s)${exp.length ? `; ${exp.join(', ')} would expand authority and need an explicit maintainer decision` : ''}. Nothing was applied.`, output: out, needsMaintainer: exp };
}
export function renderRetroReport(p: RetroPacket, r: RetroResult, now: number): string {
  const out = r.output; const lines = [`# Warden retro ${iso(now).slice(0, 10)}`, '', `Window: ${p.window.from} to ${p.window.to}. Evidence: ${p.decisions.length} decision(s), ${p.denials.length} denial(s) on record, ${p.escapes.length} escape(s). Generated locally; **nothing in this report has been applied** and nothing authorizes anything: a maintainer decides.`, ''];
  if (!out) return lines.concat([r.notice]).join('\n') + '\n';
  if (out.noChange) return lines.concat([`**No change is justified.** ${out.noChange.reason}`]).join('\n') + '\n';
  for (const x of out.proposals) lines.push(`## ${x.id}: ${x.title} (${x.category})`, '', x.rationale, '', `- Evidence: ${x.evidence.join(', ')}`, `- Scope: ${x.scope}`, `- Example: ${x.example}`, `- Validation: ${x.validation}`, ...(x.authorityExpansion ? [`- **Authority expansion over \`${x.authorityExpansion.action}\`: needs an explicit maintainer decision; history never authorizes it.**`] : []), '');
  return lines.join('\n');
}
/** Prepare the report as a branch (a PR when a publisher can open one). Documentation only: applying any proposal is a separate, reviewed change. */
export async function prepareRetroBranch(o: { source: string; baseSha: string; report: string; now: number; author: { name: string; email: string }; publisher: PrPublisher; workRoot?: string }) {
  const root = o.workRoot ?? tmpdir(); mkdirSync(root, { recursive: true }); const work = mkdtempSync(join(root, 'warden-retro-')); const ws = join(work, 'ws');
  try { cloneBase(o.source, ws, o.baseSha); const branch = `warden/retro-${iso(o.now).slice(0, 10)}`; branchFrom(ws, branch); mkdirSync(join(ws, 'docs/retro'), { recursive: true }); writeFileSync(join(ws, 'docs/retro', `RETRO-${iso(o.now).slice(0, 10)}.md`), o.report);
    const sha = commitAll(ws, `Retro report ${iso(o.now).slice(0, 10)} (proposals only)`, o.author); return { branch, sha, pr: await o.publisher.open({ branch, sha, title: `Warden retro ${iso(o.now).slice(0, 10)}: proposals only`, body: o.report, workspace: ws, baseSha: o.baseSha }) };
  } finally { rmSync(work, { recursive: true, force: true }); }
}
