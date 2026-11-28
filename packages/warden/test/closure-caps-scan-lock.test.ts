import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireScanLock, ScanLocked } from '../src/storage/scan-lock.ts';
import { rig } from './helpers.ts';
import { submitSweep } from '../src/tasks/registry.ts';
import { DEFAULT_WARDEN } from '../src/config/defaults.ts';
import { validateWardenSchema } from '../src/config/schemas.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'warden-lock-'));

test('scan lock: a second scan is refused while the first holds it; the holder is named; releasing frees it and only the owner releases', () => {
  const d = dir(); const p = join(d, 'scan.lock'); try {
    const release = acquireScanLock(p, { pid: 111, task: 'review', now: '2026-11-27T10:00:00Z' }, () => true);
    assert.throws(() => acquireScanLock(p, { pid: 222, task: 'triage', now: '2026-11-27T10:01:00Z' }, () => true), (e: unknown) => e instanceof ScanLocked && e.holder.pid === 111 && e.holder.task === 'review' && /another scan is already running/.test((e as Error).message));
    release(); assert.equal(existsSync(p), false, 'released');
    const r2 = acquireScanLock(p, { pid: 222, task: 'triage', now: '2026-11-27T10:02:00Z' }, () => true); r2();
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('scan lock: a lock left by a process that no longer exists is reclaimed; a corrupt lock file does not block forever; a stale release never deletes a newer lock', () => {
  const d = dir(); const p = join(d, 'scan.lock'); try {
    writeFileSync(p, JSON.stringify({ pid: 999999, task: 'review', since: '2026-11-26T00:00:00Z' }));
    const r = acquireScanLock(p, { pid: 333, task: 'review', now: '2026-11-27T10:00:00Z' }, () => false); assert.equal(JSON.parse(readFileSync(p, 'utf8')).pid, 333);
    writeFileSync(p, '{not json'); const r2 = acquireScanLock(p, { pid: 444, task: 'review', now: '2026-11-27T11:00:00Z' }, () => true); assert.equal(JSON.parse(readFileSync(p, 'utf8')).pid, 444);
    r(); assert.equal(existsSync(p), true, 'the first (stale) owner cannot delete the second owner\'s lock'); r2(); assert.equal(existsSync(p), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

const finding = (item: number) => ({ item, itemKind: 'issue' as const, state: 'needs-info', due: { kind: 'close-information' as const, since: '2026-10-01T00:00:00.000Z' }, obs: { keepOpen: false, draft: false, authorLastActivityAt: null } as never });
const nudge = (item: number) => ({ item, itemKind: 'issue' as const, state: 'needs-info', due: { kind: 'nudge' as const, hours: 48 as const, since: '2026-10-01T00:00:00.000Z' } as never, obs: { keepOpen: false, draft: false, authorLastActivityAt: null } as never });

test('closure caps: at most `perRun` closures are submitted, the day allowance is honoured, excess closures are deferred and reported, and non-closing actions are not capped', async () => {
  const r = rig(); const n = [1, 2, 3, 4].map(() => r.world.addIssue({ title: 'x' }));
  const o = { submitStore: r.submitStore, repo: 'acme/widgets', inboxIssue: r.inbox, now: r.world.now() };
  const a = await submitSweep([...n.slice(0, 3).map(finding), nudge(n[3])], { ...o, caps: { perRun: 2, remainingToday: 10 } });
  assert.equal(a.closures, 2); assert.deepEqual(a.deferredClosures, [n[2]]); assert.ok(a.submitted.includes(n[3]), 'the nudge is not a closure and is not capped');
  const r2 = rig(); const m = r2.world.addIssue({ title: 'y' });
  const b = await submitSweep([finding(m)], { submitStore: r2.submitStore, repo: 'acme/widgets', inboxIssue: r2.inbox, now: r2.world.now(), caps: { perRun: 5, remainingToday: 0 } });
  assert.equal(b.closures, 0); assert.deepEqual(b.deferredClosures, [m]); assert.deepEqual(b.submitted, []);
  const c = await submitSweep([finding(m)], { submitStore: r2.submitStore, repo: 'acme/widgets', inboxIssue: r2.inbox, now: r2.world.now() });
  assert.equal(c.closures, 1, 'no caps given: unchanged behaviour');
});

test('config: the closure cap keys validate and default to 5 per run and 10 per day', () => {
  assert.deepEqual(DEFAULT_WARDEN.sweep, { maxClosuresPerRun: 5, maxClosuresPerDay: 10 });
  const ok = (o: unknown) => validateWardenSchema({ schemaVersion: 1, repository: 'a/b', maintainers: ['m'], ...(o as object) }) === true;
  assert.equal(ok({ sweep: { maxClosuresPerRun: 0, maxClosuresPerDay: 3 } }), true); assert.equal(ok({ sweep: { maxClosuresPerRun: -1 } }), false); assert.equal(ok({ sweep: { other: 1 } }), false);
});
