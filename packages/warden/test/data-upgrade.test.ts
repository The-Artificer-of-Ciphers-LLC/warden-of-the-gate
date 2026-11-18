import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceStorage } from '../src/storage/instance.ts';
import { exportData, inventory, purgeData } from '../src/data/data.ts';
import { planUpgrade } from '../src/upgrade/changes.ts';
import { cliEnv } from './cli-env.ts';

const NOW = Date.parse('2026-11-18T12:00:00Z'); const RET = { transcriptDays: 30, securityAuditDays: 365 };
function inst() {
  const home = mkdtempSync(join(tmpdir(), 'warden-data-')); const st = InstanceStorage.open(home, 'acme/widgets', { create: true });
  const old = (f: string, days: number) => { const t = (NOW - days * 86_400_000) / 1000; utimesSync(f, t, t); };
  writeFileSync(join(st.transcriptsDir, 'old.txt'), 'old transcript token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD'); old(join(st.transcriptsDir, 'old.txt'), 45);
  writeFileSync(join(st.transcriptsDir, 'new.txt'), 'recent transcript'); old(join(st.transcriptsDir, 'new.txt'), 2);
  writeFileSync(st.decisionsPath, JSON.stringify({ approvalId: 'a', decision: 'approve' }) + '\n');
  writeFileSync(st.auditPath, JSON.stringify({ at: '2024-01-01T00:00:00Z', event: 'ancient' }) + '\n' + JSON.stringify({ at: '2026-11-01T00:00:00Z', event: 'recent' }) + '\n');
  mkdirSync(st.path('review'), { recursive: true }); writeFileSync(st.path('review', '7.json'), '{}'); old(st.path('review', '7.json'), 90);
  writeFileSync(st.path('review', '8.json'), '{}'); old(st.path('review', '8.json'), 90);
  return { home, st, done: () => rmSync(home, { recursive: true, force: true }) };
}

test('export is scoped, redacted and needs --confirm; it never exports credentials and never overwrites an earlier export', (t) => {
  const { home, st, done } = inst(); t.after(done); writeFileSync(join(st.credentialsDir, 'secret.json'), '{"key":"PRIVATE"}');
  const preview = exportData(st, { scopes: ['transcripts'], out: join(home, 'out/x.json'), now: NOW, confirm: false }); assert.equal(preview.written, false); assert.equal(existsSync(join(home, 'out/x.json')), false);
  const r = exportData(st, { scopes: ['transcripts', 'decisions'], out: join(home, 'out/x.json'), now: NOW, confirm: true }); assert.equal(r.written, true);
  const text = readFileSync(join(home, 'out/x.json'), 'utf8'); assert.ok(!text.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD'), 'credential-shaped values are redacted'); assert.ok(!text.includes('PRIVATE')); assert.ok(text.includes('approvalId'));
  assert.throws(() => exportData(st, { scopes: ['transcripts'], out: join(home, 'out/x.json'), now: NOW, confirm: true }));
});

test('purge: preview by default; transcripts expire at the configured retention; audit trims only entries past its own retention; decisions are protected without explicit confirmation; pending recovery items are kept', (t) => {
  const { st, done } = inst(); t.after(done);
  const prev = purgeData(st, { scopes: ['transcripts', 'audit', 'reviews'], now: NOW, confirm: false, retention: RET, olderThanDays: 30, pendingItems: new Set([8]) }); assert.equal(prev.executed, false);
  assert.ok(existsSync(join(st.transcriptsDir, 'old.txt')), 'preview deletes nothing');
  const r = purgeData(st, { scopes: ['transcripts', 'audit', 'reviews'], now: NOW, confirm: true, retention: RET, olderThanDays: 30, pendingItems: new Set([8]) });
  assert.equal(r.executed, true); assert.equal(existsSync(join(st.transcriptsDir, 'old.txt')), false); assert.equal(existsSync(join(st.transcriptsDir, 'new.txt')), true);
  assert.equal(existsSync(st.path('review', '7.json')), false); assert.equal(existsSync(st.path('review', '8.json')), true, 'a pending-recovery item is never purged');
  assert.ok(r.kept.some((k) => /8\.json \(pending recovery\)/.test(k)));
  assert.equal(readFileSync(st.auditPath, 'utf8').includes('ancient'), false, 'older than the audit window is trimmed'); assert.ok(readFileSync(st.auditPath, 'utf8').includes('recent'));
  assert.ok(readFileSync(st.auditPath, 'utf8').includes('data-purge'), 'the purge itself is receipted');
  assert.throws(() => purgeData(st, { scopes: ['decisions'], now: NOW, confirm: true, retention: RET }), /protected/);
  assert.ok(existsSync(st.decisionsPath)); purgeData(st, { scopes: ['decisions'], now: NOW, confirm: true, retention: RET, includeDecisions: true }); assert.equal(existsSync(st.decisionsPath), false);
});

test('inventory reports sizes, expiry and protection without a model; purge without --older-than purges only what is past its retention', (t) => {
  const { st, done } = inst(); t.after(done);
  const inv = Object.fromEntries(inventory(st, NOW, RET).map((x) => [x.scope, x])); assert.equal(inv.transcripts.expired, 1); assert.equal(inv.decisions.protected, 'kept until explicit removal');
  const r = purgeData(st, { scopes: ['transcripts'], now: NOW, confirm: true, retention: RET }); assert.equal(r.executed, true); assert.ok(existsSync(join(st.transcriptsDir, 'new.txt')) && !existsSync(join(st.transcriptsDir, 'old.txt')));
});

test('upgrade planning: lists changes since the recorded version, fails actionably for unknown, newer or unsupported-schema situations, and never applies anything', () => {
  const ok = planUpgrade('0.1.0-p1', { warden: 1, orders: 1 }); assert.equal(ok.supported, true); assert.ok(ok.changes.length >= 4); assert.equal(ok.applied, false); assert.ok(ok.changes.some((c) => c.action === 'review'));
  assert.equal(planUpgrade('0.1.0-p4', { warden: 1, orders: null }).changes.length, 0);
  for (const [v, w, re] of [[null, 1, /no recorded instance version/], ['9.9.9', 1, /no migration path/], ['0.1.0-p9', 1, /NEWER Warden/], ['0.1.0-p1', 2, /schemaVersion 2 is not supported/]] as const) { const p = planUpgrade(v, { warden: w, orders: null }); assert.equal(p.supported, false); assert.match(p.problems.join(), re); assert.deepEqual(p.changes, []); }
});

test('CLI: data status/export/purge and upgrade --dry-run behave as documented, with no model', async () => {
  const e = await cliEnv(); assert.equal((await e.json('status')).code, 0);
  assert.equal((await e.json('data', 'export')).code, 2, 'an explicit scope is required, never everything');
  const inv = await e.json('data', 'status'); assert.equal(inv.code, 0); assert.ok(inv.data.inventory.some((x: { scope: string }) => x.scope === 'decisions'));
  assert.equal((await e.json('data', 'purge', '--scope', 'decisions', '--confirm')).code, 1, 'decisions need --include-decisions');
  assert.equal((await e.json('data', 'purge', '--scope', 'transcripts')).code, 2, 'purge previews without --confirm');
  const up = await e.json('upgrade', '--dry-run'); assert.equal(up.code, 0); assert.equal(up.data.applied, false);
  assert.equal((await e.json('upgrade')).code, 2);
});
