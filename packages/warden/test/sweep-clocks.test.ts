import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClock, releaseHold, startHold, HOUR, DAY, type ClockItem } from '../src/sweep/clocks.ts';

const T0 = Date.parse('2026-11-01T00:00:00Z');
const at = (h: number) => new Date(T0 + h * HOUR).toISOString();
const pr = (o: Partial<ClockItem> = {}): ClockItem => ({ kind: 'pr', response: { kind: 'pr-response', requestedAt: at(0) }, ...o });
const issue = (kind: 'reproduction' | 'other-information', o: Partial<ClockItem> = {}): ClockItem => ({ kind: 'issue', response: { kind, requestedAt: at(0) }, ...o });
const ev = (i: ClockItem, h: number, stopped = false) => evaluateClock(i, { now: at(h), stopped });

test('PR silence: nothing before 48h, nudge at 48 and 72, close at five days', () => {
  assert.equal(ev(pr(), 47).due.kind, 'none');
  assert.deepEqual(ev(pr(), 48).due, { kind: 'nudge', hours: 48, clock: 'pr-response', since: at(0) });
  assert.equal((ev(pr(), 72).due as any).hours, 72);
  assert.equal(ev(pr(), 119).due.kind, 'nudge');
  assert.equal(ev(pr(), 120).due.kind, 'close-silence');
});

test('already-sent nudges are not repeated', () => {
  const sent = pr({ response: { kind: 'pr-response', requestedAt: at(0), nudgesSent: [48, 72] } });
  assert.equal(ev(sent, 100).due.kind, 'none');
  assert.equal(ev(sent, 120).due.kind, 'close-silence');
});

test('author activity resets silence; the factory has no input to reset it', () => {
  const replied = pr({ response: { kind: 'pr-response', requestedAt: at(0), lastAuthorActivityAt: at(100) } });
  assert.equal(ev(replied, 119).due.kind, 'none');
  assert.equal(ev(replied, 148).due.kind, 'nudge');
});

test('information windows: reproduction 14d, other 28d; issues only', () => {
  assert.equal(ev(issue('reproduction'), 14 * 24 - 1).due.kind, 'none');
  assert.equal(ev(issue('reproduction'), 14 * 24).due.kind, 'close-information');
  assert.equal(ev(issue('other-information'), 14 * 24).due.kind, 'none');
  assert.equal(ev(issue('other-information'), 28 * 24).due.kind, 'close-information');
  assert.equal(ev({ kind: 'pr', response: { kind: 'reproduction', requestedAt: at(0) } }, 500).due.kind, 'none');
});

test('exemptions: keep-open, confirmed/approved issue, unreviewed PR, maintainer wait, designated draft only when drafts enabled', () => {
  assert.equal((ev(issue('reproduction', { keepOpen: true }), 999).due as any).why, 'keep-open');
  assert.equal((ev(issue('reproduction', { confirmedOrApproved: true }), 999).due as any).why, 'confirmed-or-approved-issue');
  assert.equal((ev(pr({ unreviewed: true }), 999).due as any).why, 'unreviewed-pr');
  assert.equal((ev(pr({ maintainerWait: true }), 999).due as any).why, 'maintainer-wait');
  const d = pr({ draft: true, designatedDraft: true });
  assert.equal(ev(d, 999).due.kind, 'close-draft', 'drafts are disallowed by default, so a draft is closed by policy');
  assert.equal(evaluateClock(d, { now: at(999), stopped: false, cfg: { nudgeAfterHours: [48, 72], closeAfterHours: 120, reproductionDays: 14, otherInformationDays: 28, draftsEnabled: true } }).due.kind, 'none');
});

test('delivery: expires at dueAt, satisfied on-time submission does not, and it beats a later silence close', () => {
  const c = { type: 'delivery' as const, startedAt: at(0), dueAt: at(48) };
  assert.equal(ev({ kind: 'pr', commitment: c }, 47).due.kind, 'none');
  assert.equal(ev({ kind: 'pr', commitment: c }, 48).due.kind, 'expire-commitment');
  assert.equal(ev({ kind: 'pr', commitment: { ...c, satisfiedAt: at(10) } }, 500).due.kind, 'none');
  assert.equal(ev(pr({ commitment: c }), 130).due.kind, 'expire-commitment');
});

test('ambiguous completeness defers rather than expiring', () => {
  const c = { type: 'delivery' as const, startedAt: at(0), dueAt: at(48), completenessUnassessed: true };
  assert.deepEqual(ev({ kind: 'pr', commitment: c }, 60).due, { kind: 'defer', why: 'completeness-unassessed' });
});

test('hold freezes the unexpired portion; release publishes now + remainder; late hold cannot rescue an expired commitment', () => {
  const c = { type: 'delivery' as const, startedAt: at(0), dueAt: at(48) };
  const held = startHold(c, at(30), 'maintainer hold');
  assert.equal(held.hold?.remainingMs, 18 * HOUR);
  assert.equal(ev({ kind: 'pr', commitment: held }, 1000).due.kind, 'none');
  const released = releaseHold(held, at(100));
  assert.equal(released.dueAt, at(118));
  assert.equal(released.hold, undefined);
  assert.equal(ev({ kind: 'pr', commitment: released }, 118).due.kind, 'expire-commitment');
  assert.equal(startHold(c, at(60), 'late'), c);
});

test('stop does not extend anything: verdict is the same, effects are deferred', () => {
  const a = ev(pr(), 120, false); const b = ev(pr(), 120, true);
  assert.deepEqual(a.due, b.due);
  assert.equal(a.effectsDeferred, false); assert.equal(b.effectsDeferred, true);
  assert.equal(ev(pr(), 10, true).effectsDeferred, false);
});

test('unreconciled author observations defer enforcement instead of enforcing', () => {
  assert.deepEqual(ev(pr({ pendingObservations: true }), 130).due, { kind: 'defer', why: 'reconcile-observations' });
  assert.equal(ev(pr({ pendingObservations: true }), 10).due.kind, 'none');
});

test('invalid timestamps throw instead of silently expiring', () => {
  assert.throws(() => evaluateClock(pr({ response: { kind: 'pr-response', requestedAt: 'nope' } }), { now: at(1), stopped: false }));
  assert.ok(DAY === 24 * HOUR);
});

test('a confirmed issue is shielded from stale closure but NOT from a missed delivery commitment; keep-open and maintainer wait shield both', () => {
  const c = { type: 'delivery' as const, startedAt: at(0), dueAt: at(48) };
  const claimed: ClockItem = { kind: 'issue', confirmedOrApproved: true, commitment: c, response: { kind: 'reproduction', requestedAt: at(0) } };
  assert.equal(ev(claimed, 49).due.kind, 'expire-commitment');
  assert.equal(ev({ ...claimed, commitment: undefined }, 999).due.kind, 'none');
  assert.equal(ev({ ...claimed, keepOpen: true }, 999).due.kind, 'none');
  assert.equal(ev({ ...claimed, maintainerWait: true }, 999).due.kind, 'none');
});
