import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '../github/store.ts';
import { readOnly } from '../github/store.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { InstanceStorage } from '../storage/instance.ts';

/** Retro input, gathered DETERMINISTICALLY from this instance only (never another repository): maintainer decisions and denials, critical escapes, and the
 *  outcomes of the local review, triage, implement and rework work. Every item has an id the proposals must cite. No source code and no transcripts are included. */
export interface RetroPacket {
  window: { from: string; to: string; days: number };
  decisions: Array<{ id: string; item: number; decision: string; action: string; by: string; at: string; reason: string; approvalId: string }>;
  denials: Array<{ id: string; item: number; action: string; at: string; reason: string; approvalId: string }>;
  escapes: Array<{ id: string; item: number; reason: string; at: string }>;
  outcomes: { reviews: Record<string, number>; triage: Record<string, number>; implement: Record<string, number>; rework: Record<string, number>; findingSeverities: Record<string, number> };
}
const readDir = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { log?: Array<{ at: string; event: string; detail?: string }>; marker?: { findings?: Array<{ severity: string }> } }) : []);
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export async function gatherRetro(st: InstanceStorage, store: Store, o: { now: number; windowDays: number }): Promise<RetroPacket> {
  const from = o.now - o.windowDays * 86_400_000; const inWin = (at: string) => Date.parse(at) >= from;
  const decisions: RetroPacket['decisions'] = []; const denials: RetroPacket['denials'] = [];
  if (existsSync(st.decisionsPath)) readFileSync(st.decisionsPath, 'utf8').split('\n').filter(Boolean).forEach((l, i) => {
    const d = JSON.parse(l) as { approvalId: string; item: number; decision: string; action: string; by: string; at: string; reason?: string };
    // denials are preserved across the WHOLE history (even outside the window and even without a reason): a ruling is never silently forgotten
    if (d.decision === 'denied') denials.push({ id: `n${i + 1}`, item: d.item, action: d.action, at: d.at, reason: d.reason ?? '', approvalId: d.approvalId });
    if (inWin(d.at)) decisions.push({ id: `d${i + 1}`, item: d.item, decision: d.decision, action: d.action, by: d.by, at: d.at, reason: d.reason ?? '', approvalId: d.approvalId });
  });
  const escapes: RetroPacket['escapes'] = []; let k = 0;
  for (const it of await readOnly(store).listIssues({ state: 'all' })) {
    const l = (await readOnly(store).listComments(it.number)).filter((c) => c.body.startsWith(LEDGER_MARK)).map((c) => parseLedger(c.body)).find(Boolean);
    if (l?.paused && inWin(l.paused.at)) escapes.push({ id: `e${++k}`, item: it.number, reason: l.paused.reason, at: l.paused.at });
  }
  const outcomes: RetroPacket['outcomes'] = { reviews: {}, triage: {}, implement: {}, rework: {}, findingSeverities: {} };
  for (const [dir, key] of [['review', 'reviews'], ['triage', 'triage'], ['implement', 'implement'], ['rework', 'rework']] as const)
    for (const rec of readDir(st.path(dir))) { for (const e of rec.log ?? []) if (inWin(e.at)) bump(outcomes[key], `${e.event}${e.detail && /^(gate-weakening|diff-too-large|authority-path-touched|insufficient-evidence|checks-failed|no-change)$/.test(e.detail) ? ':' + e.detail : ''}`);
      for (const f of rec.marker?.findings ?? []) bump(outcomes.findingSeverities, f.severity); }
  return { window: { from: new Date(from).toISOString(), to: new Date(o.now).toISOString(), days: o.windowDays }, decisions, denials, escapes, outcomes };
}
export const packetIds = (p: RetroPacket) => new Set([...p.decisions.map((x) => x.id), ...p.denials.map((x) => x.id), ...p.escapes.map((x) => x.id)]);
export const hasEvidence = (p: RetroPacket) => p.decisions.length + p.escapes.length > 0 || Object.values(p.outcomes).some((m) => Object.keys(m).length > 0);
