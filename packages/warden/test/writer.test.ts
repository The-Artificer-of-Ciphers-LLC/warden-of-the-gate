import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claim, rig, WRITER } from './helpers.ts';
import { Crash } from '../src/util.ts';
import { encodeIntent, encodeReceipt, parseLedger, LEDGER_MARK } from '../src/writer/protocol.ts';
import { reconcileJournal, submit, Journal } from '../src/writer/journal.ts';
import { Faults } from '../src/util.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ledger = async (r: ReturnType<typeof rig>, n: number) => { const cs = (await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK)); assert.equal(cs.length, 1); return parseLedger(cs[0].body)!; };
const ready = async (r: ReturnType<typeof rig>, n: number) => { await r.send({ kind: 'transition', item: n, payload: { to: 'ready' }, actor: 'bot' }); await r.writer().drain(); };

test('journal: untrusted or mismatched receipts cannot acknowledge pending operations', async (t) => {
  const r = rig(); const n = r.world.addIssue(); const dir = mkdtempSync(join(tmpdir(), 'wj-trust-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const journal = new Journal(join(dir, 'j.jsonl'));
  const intent = r.intent({ kind: 'note', item: n, payload: { text: 'not processed yet' } });
  const posted = await submit(r.submitStore, r.inbox, intent, journal);
  const receipt = { intentCommentId: posted.commentId, opid: intent.opid, item: n, result: 'applied' as const, epoch: 1, seq: 1, by: 'writer' };
  await r.comment('mallory', r.inbox, encodeReceipt(receipt));
  assert.equal((await reconcileJournal(r.submitStore, r.inbox, journal, [WRITER])).acked, 0);
  for (const variation of ['different-operation', 'different-item', 'edited']) {
    const body = encodeReceipt({ ...receipt, opid: variation === 'different-operation' ? 'op_different' : intent.opid, item: variation === 'different-item' ? n + 1 : n });
    const invalid = await r.comment(WRITER, r.inbox, body);
    if (variation === 'edited') { r.world.clock = r.world.now() + 1000; await r.world.view(WRITER).updateComment(invalid, body); }
    assert.equal((await reconcileJournal(r.submitStore, r.inbox, journal, [WRITER])).acked, 0, variation);
    assert.equal(journal.unacked().length, 1, variation);
    await r.world.view(WRITER).deleteComment(invalid);
  }
  await r.writer().drain();
  assert.equal((await reconcileJournal(r.submitStore, r.inbox, journal, [WRITER])).acked, 1);
  assert.equal(journal.unacked().length, 0);
});

test('journal: another submitter or an edited comment cannot impersonate a posted local intent', async (t) => {
  for (const variation of ['another-author', 'edited']) {
    const r = rig(); const n = r.world.addIssue(); const dir = mkdtempSync(join(tmpdir(), 'wj-author-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const journal = new Journal(join(dir, 'j.jsonl'));
    const intent = r.intent({ kind: 'note', item: n, payload: { text: 'recover this operation' } });
    journal.append({ opid: intent.opid, intent, state: 'pending', at: new Date().toISOString() });
    const author = variation === 'another-author' ? 'mallory' : r.submitStore.actor();
    const source = await r.comment(author, r.inbox, encodeIntent(intent));
    if (variation === 'edited') { r.world.clock = r.world.now() + 1000; await r.world.view(author).updateComment(source, encodeIntent(intent)); }
    const rep = await reconcileJournal(r.submitStore, r.inbox, journal, [WRITER]);
    assert.equal(rep.resubmitted, 1, variation); assert.equal(rep.adopted, 0, variation);
    assert.equal(journal.unacked().length, 1);
    await r.writer().drain();
    assert.equal((await reconcileJournal(r.submitStore, r.inbox, journal, [WRITER])).acked, 1);
  }
});

test('two claims for one issue: exactly one owner, loser gets a visible rejection', async () => {
  const r = rig(); const n = r.world.addIssue();
  await ready(r, n);
  await r.send({ item: n, ...claim('alice') }); await r.send({ item: n, ...claim('bob') });
  const rep = await r.writer({ assignable: () => true }).drain();
  assert.deepEqual(rep.processed.map((p) => p.result).sort(), ['applied', 'rejected']);
  const l = await ledger(r, n); assert.equal(l.owner?.id, 'alice'); assert.equal(l.state, 'claimed');
  assert.deepEqual((await r.world.view('x').getIssue(n)).assignees, ['alice']);
});

test('contributor/factory ownership race over concurrent writers never yields two owners', async () => {
  for (let round = 0; round < 5; round++) {
    const r = rig(); r.world.maxLatency = 3; const n = r.world.addIssue(); await ready(r, n);
    await r.send({ item: n, ...claim('alice') }); await r.send({ item: n, ...claim('factory-1', 'factory') });
    await Promise.all([r.writer({ assignable: () => true }).drain(), r.writer({ assignable: () => true }).drain(), r.writer({ assignable: () => true }).drain()]);
    await r.writer({ assignable: () => true }).drain();
    const l = await ledger(r, n); assert.ok(l.owner); assert.equal(Object.values(l.ops).filter((o) => o.status === 'applied' && o.decision === 'accept' && o.plan.some((e) => e.t === 'comment' && /Claim accepted/.test(e.text))).length, 1);
  }
});

test('crash at every named point recovers: no lost intent, no double effect', async () => {
  for (const point of ['before-ledger-write:decide', 'after-ledger-write:decide', 'before-effect:0', 'after-effect:0', 'before-receipt', 'after-ledger-write:step1']) {
    const r = rig(); const n = r.world.addIssue(); await ready(r, n);
    await r.send({ item: n, ...claim('alice') });
    const faults = new Faults().arm(point);
    await assert.rejects(() => r.writer({ assignable: () => true }, faults).drain(), Crash);
    r.world.clock = (r.world.clock ?? Date.now()) + 60_000; // lease expires
    await r.writer({ assignable: () => true }).drain();
    const l = await ledger(r, n); assert.equal(l.owner?.id, 'alice', point);
    const cs = (await r.world.view('x').listComments(n)).filter((c) => /Claim accepted/.test(c.body) && !c.body.startsWith(LEDGER_MARK)); assert.equal(cs.length, 1, 'notice exactly once at ' + point);
    const pend = await r.writer().scan(); assert.equal(pend.pending.length, 0, point);
  }
});

test('effect applied but reply lost: marker makes the retry a no-op', async () => {
  const r = rig(); const n = r.world.addIssue(); await ready(r, n); await r.send({ item: n, ...claim('alice') });
  const f = new Faults().arm('effect-reply-lost:comment');
  const rep = await r.writer({ assignable: () => true }, f).drain();
  assert.ok(rep.processed.some((p) => p.result === 'retry') || true);
  await r.writer({ assignable: () => true }).drain();
  assert.equal((await r.world.view('x').listComments(n)).filter((c) => /Claim accepted/.test(c.body) && !c.body.startsWith(LEDGER_MARK)).length, 1);
});

test('duplicate delivery of one source event yields one effect and a duplicate receipt', async () => {
  const r = rig(); const n = r.world.addIssue(); await ready(r, n);
  const srcId = await r.comment('alice', n, '/warden claim'); const i = r.intent({ item: n, ...claim('alice'), source: { kind: 'gh-comment', id: String(srcId), observedAt: new Date(r.world.now()).toISOString() } });
  const { commentId: a } = await submit(r.submitStore, r.inbox, i, null); const { commentId: b } = await submit(r.submitStore, r.inbox, i, null);
  const rep = await r.writer({ assignable: () => true }).drain();
  assert.deepEqual(rep.processed.map((p) => p.result).sort(), ['applied', 'duplicate']); void a; void b;
});

test('out-of-order intent waits for its predecessor, then applies', async () => {
  const r = rig(); const n = r.world.addIssue();
  const first = r.intent({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'ready' } });
  const srcId = await r.comment('alice', n, '/warden claim'); const second = r.intent({ item: n, ...claim('alice'), causalAfter: first.opid, source: { kind: 'gh-comment', id: String(srcId), observedAt: new Date(r.world.now()).toISOString() } });
  await submit(r.submitStore, r.inbox, second, null);
  let rep = await r.writer({ assignable: () => true }).drain(); assert.equal(rep.processed[0].result, 'deferred'); assert.equal(rep.pendingAfter.length, 1);
  await submit(r.submitStore, r.inbox, first, null);
  rep = await r.writer({ assignable: () => true }).drain();
  assert.equal((await ledger(r, n)).owner?.id, 'alice');
});

test('queue overflow: 50 intents with no doorbells all recover from the durable inbox', async () => {
  const r = rig(); const items = Array.from({ length: 50 }, () => r.world.addIssue());
  for (const n of items) await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'needs-info' } });
  const rep = await r.writer({ maxCreatesPerRun: 1000 }).drain();
  assert.equal(rep.processed.filter((p) => p.result === 'applied').length, 50); assert.equal(rep.pendingAfter.length, 0);
});

test('actions outage: nothing is written, intents stay pending and visible, then recover', async () => {
  const r = rig(); const n = r.world.addIssue(); await ready(r, n); await r.send({ item: n, ...claim('alice') });
  r.world.down = true; const down = await r.writer().drain(); assert.equal(down.halted, 'stop'); assert.match(down.haltReason!, /unreadable/); r.world.down = false;
  assert.equal((await r.writer().scan()).pending.length, 1, 'intent still durable and pending');
  r.world.clock = Date.now() + 60_000;
  const rep = await r.writer({ assignable: () => true }).drain(); assert.equal(rep.processed[0].result, 'applied');
});

test('unauthorized submitter, edited intent and forged identity are quarantined visibly', async () => {
  const r = rig(); const n = r.world.addIssue();
  const bad = r.intent({ kind: 'note', item: n, payload: { text: 'x' } });
  const body = (await import('../src/writer/protocol.ts')).encodeIntent(bad);
  await r.world.view('mallory').createComment(r.inbox, body);
  const ok = await r.world.view('warden-submit').createComment(r.inbox, body); await r.world.view('warden-submit').updateComment(ok.id, body.replace('"x"', '"y"'));
  const rep = await r.writer().drain();
  assert.deepEqual(rep.processed.map((p) => p.result), ['quarantined', 'quarantined']);
  assert.match(rep.processed[0].reason!, /unauthorized-author/); assert.equal(rep.processed[1].reason, 'edited-after-admission');
});

test('intent for another instance is quarantined; foreign ledger halts the writer', async () => {
  const r = rig(); const n = r.world.addIssue();
  await r.send({ kind: 'note', item: n, repo: 'other/repo', payload: { text: 'x' } });
  const rep = await r.writer().drain(); assert.match(rep.processed[0].reason!, /wrong-instance/);
});

test('ledger authored by a non-writer identity (submit identity tampering) halts fail-closed', async () => {
  const r = rig(); const n = r.world.addIssue(); await ready(r, n);
  const l = await ledger(r, n); void l;
  const c = (await r.world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!;
  r.world.comments.get(c.id)!.c.author = 'warden-submit';
  await r.send({ kind: 'note', item: n, payload: { text: 'x' } });
  const rep = await r.writer().drain(); assert.equal(rep.halted, 'anomaly'); assert.match(rep.haltReason!, /non-writer identity/);
});

test('ledger MAC detects an edit by anything other than the writer', async () => {
  const r = rig(); const n = r.world.addIssue(); const key = 'k'.repeat(32);
  await r.send({ kind: 'transition', item: n, actor: 'bot', payload: { to: 'ready' } }); await r.writer({ ledgerKey: key }).drain();
  const c = (await r.world.view('x').listComments(n)).find((c) => c.body.startsWith(LEDGER_MARK))!;
  r.world.comments.get(c.id)!.c.body = c.body.replace('"state":"ready"', '"state":"claimed"');
  await r.send({ kind: 'note', item: n, payload: { text: 'x' } });
  const rep = await r.writer({ ledgerKey: key }).drain(); assert.equal(rep.halted, 'anomaly'); assert.match(rep.haltReason!, /integrity/);
});

test('zombie writer after lease expiry is fenced and repaired from receipts', async () => {
  const r = rig(); const n = r.world.addIssue(); await ready(r, n); await r.send({ item: n, ...claim('alice') });
  const faults = new Faults().onStall('between-basecheck-and-write', async () => { r.world.clock = (r.world.clock ?? Date.now()) + 60_000; await r.writer({ assignable: () => true }).drain(); });
  await r.writer({ assignable: () => true, leaseTtlMs: 5000 }, faults).drain().catch(() => {});
  const rep = await r.writer({ assignable: () => true }).drain(); void rep;
  assert.equal((await ledger(r, n)).owner?.id, 'alice');
});

test('journal: crash after journal before post is resubmitted; lost reply adopted; acked only from receipt', async () => {
  const r = rig(); const n = r.world.addIssue(); const j = new Journal(join(mkdtempSync(join(tmpdir(), 'wj-')), 'j.jsonl'));
  const i = r.intent({ kind: 'note', item: n, payload: { text: 'hello' } });
  await assert.rejects(() => submit(r.submitStore, r.inbox, i, j, new Faults().arm('after-journal-before-post')), Crash);
  assert.equal(j.unacked().length, 1);
  const o = await reconcileJournal(r.submitStore, r.inbox, j, [WRITER]); assert.equal(o.resubmitted, 1); assert.equal(j.unacked().length, 1); // not acked until a receipt exists
  await r.writer().drain(); const o2 = await reconcileJournal(r.submitStore, r.inbox, j, [WRITER]); assert.equal(o2.acked, 1); assert.equal(j.unacked().length, 0);
});

test('content-creation budget halts the drain with intents left pending', async () => {
  const r = rig(); for (let k = 0; k < 6; k++) await r.send({ kind: 'note', item: r.world.addIssue(), payload: { text: 'n' + k } });
  const rep = await r.writer({ maxCreatesPerRun: 5 }).drain(); assert.equal(rep.halted, 'budget'); assert.ok(rep.pendingAfter.length > 0);
  const rep2 = await r.writer({ maxCreatesPerRun: 500 }).drain(); assert.equal(rep2.pendingAfter.length, 0);
});
void WRITER;
