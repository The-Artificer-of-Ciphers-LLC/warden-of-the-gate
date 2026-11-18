import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact, iso } from '../util.ts';
import type { InstanceStorage } from '../storage/instance.ts';

/** P5 data controls: scoped export and purge of the per-instance local state, with redaction, explicit confirmation and honest receipts. Works without a model.
 *  Never touched: credentials. Preserved always: pending recovery data (unacknowledged journal entries). Decisions are kept until explicit removal. A failed
 *  write or delete throws: durability or removal is never acknowledged when it did not happen. */
export const SCOPES = ['transcripts', 'reviews', 'triage', 'runs', 'audit', 'decisions'] as const;
export type Scope = (typeof SCOPES)[number];
export interface Retention { transcriptDays: number; securityAuditDays: number }

const files = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(dir, e.name)) : []);
const age = (f: string, now: number) => (now - statSync(f).mtimeMs) / 86_400_000;
export function pathsFor(st: InstanceStorage, s: Scope): string[] {
  switch (s) {
    case 'transcripts': return files(st.transcriptsDir);
    case 'reviews': return [...files(st.path('review')), ...files(st.path('review', 'packets'))];
    case 'triage': return [...files(st.path('triage')), ...files(st.path('triage', 'packets'))];
    case 'runs': return files(st.path('runs'));
    case 'audit': return existsSync(st.auditPath) ? [st.auditPath] : [];
    case 'decisions': return existsSync(st.decisionsPath) ? [st.decisionsPath] : [];
  }
}
const jsonl = (f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean);

export function inventory(st: InstanceStorage, now: number, ret: Retention) {
  return SCOPES.map((s) => { const fs = pathsFor(st, s); const days = s === 'transcripts' ? ret.transcriptDays : s === 'audit' ? ret.securityAuditDays : undefined;
    return { scope: s, files: fs.length, bytes: fs.reduce((a, f) => a + statSync(f).size, 0), expired: days === undefined ? 0 : fs.filter((f) => age(f, now) > days).length, retentionDays: days ?? null, protected: s === 'decisions' ? 'kept until explicit removal' : null }; });
}

export function exportData(st: InstanceStorage, o: { scopes: Scope[]; out: string; now: number; confirm: boolean }) {
  const bundle: Record<string, unknown> = { v: 1, kind: 'warden-data-export', repository: st.repository, at: iso(o.now), scopes: o.scopes, note: 'Credentials are never exported; values that look like credentials are redacted.', data: {} as Record<string, unknown> };
  for (const s of o.scopes) {
    const entries = pathsFor(st, s).map((f) => ({ file: f.slice(st.dir.length + 1), content: redact(readFileSync(f, 'utf8')) }));
    (bundle.data as Record<string, unknown>)[s] = entries;
  }
  const count = Object.values(bundle.data as Record<string, unknown[]>).reduce((a, e) => a + e.length, 0);
  if (!o.confirm) return { written: false as const, files: count, bytes: Buffer.byteLength(JSON.stringify(bundle)) };
  mkdirSync(join(o.out, '..'), { recursive: true });
  writeFileSync(o.out, JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600, flag: 'wx' });   // wx: never silently overwrite an earlier export
  const receipt = { at: iso(o.now), action: 'export', scopes: o.scopes, files: count, out: o.out }; st.securityAudit('data-export', receipt);
  return { written: true as const, files: count, bytes: statSync(o.out).size, receipt };
}

export interface PurgeOpts { scopes: Scope[]; olderThanDays?: number; now: number; confirm: boolean; retention: Retention; includeDecisions?: boolean; pendingItems?: Set<number> }
/** `olderThanDays` narrows (never widens) the configured retention; with no value, scopes with a retention purge only expired data and scopes without one purge nothing unless explicit. */
export function purgeData(st: InstanceStorage, o: PurgeOpts) {
  if (o.scopes.includes('decisions') && !o.includeDecisions) throw new Error('decisions are protected: removing them needs the explicit --include-decisions confirmation');
  const plan: Array<{ scope: Scope; file: string; action: 'delete' | 'trim'; lines?: number }> = []; const kept: string[] = [];
  for (const s of o.scopes) {
    const days = s === 'transcripts' ? Math.min(o.retention.transcriptDays, o.olderThanDays ?? Infinity) : s === 'audit' ? Math.min(o.retention.securityAuditDays, o.olderThanDays ?? Infinity) : o.olderThanDays;
    for (const f of pathsFor(st, s)) {
      if (s === 'audit') {   // rewrite: drop only entries older than the audit retention
        const cutoff = o.now - (days ?? Infinity) * 86_400_000; const keep = jsonl(f).filter((l) => { try { return Date.parse((JSON.parse(l) as { at?: string }).at ?? '') >= cutoff; } catch { return true; } });
        const drop = jsonl(f).length - keep.length; if (drop > 0) plan.push({ scope: s, file: f, action: 'trim', lines: drop }); continue;
      }
      if (s === 'decisions') { plan.push({ scope: s, file: f, action: 'delete' }); continue; }
      const item = Number((f.match(/(?:review|triage)\/(\d+)\.json$/) ?? [])[1] ?? NaN);
      if (o.pendingItems?.has(item)) { kept.push(f.slice(st.dir.length + 1) + ' (pending recovery)'); continue; }
      if (days === undefined || !(age(f, o.now) > days)) { kept.push(f.slice(st.dir.length + 1)); continue; }
      plan.push({ scope: s, file: f, action: 'delete' });
    }
  }
  if (!o.confirm) return { executed: false as const, plan: plan.map((p) => ({ ...p, file: p.file.slice(st.dir.length + 1) })), kept };
  for (const p of plan) {
    if (p.action === 'delete') rmSync(p.file, { force: false });
    else { const cutoff = o.now - Math.min(o.retention.securityAuditDays, o.olderThanDays ?? Infinity) * 86_400_000; writeFileSync(p.file, jsonl(p.file).filter((l) => { try { return Date.parse((JSON.parse(l) as { at?: string }).at ?? '') >= cutoff; } catch { return true; } }).map((l) => l + '\n').join(''), { mode: 0o600 }); }
    if (p.action === 'delete' && existsSync(p.file)) throw new Error(`removal of ${p.file} was not confirmed`);
  }
  const receipt = { at: iso(o.now), action: 'purge', scopes: o.scopes, deleted: plan.filter((p) => p.action === 'delete').length, trimmedAuditLines: plan.filter((p) => p.action === 'trim').reduce((a, p) => a + (p.lines ?? 0), 0), kept: kept.length };
  st.securityAudit('data-purge', receipt);
  return { executed: true as const, plan: plan.map((p) => ({ ...p, file: p.file.slice(st.dir.length + 1) })), kept, receipt };
}
