import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOutgoingLabels, checkOutgoingText, DEFAULT_MAX_OUTGOING_CHARS } from '../src/writer/outgoing.ts';
import { rig } from './helpers.ts';
import { parseReceipt } from '../src/writer/protocol.ts';

const rules = { maxChars: 200, mentionable: new Set(['maint1']), labels: new Set(['warden:needs-triage', 'warden:keep-open']) };

test('outgoing text: plain text and a maintainer mention pass; each rule in PRD section 3 blocks with its own reason', () => {
  assert.equal(checkOutgoingText('Thanks! A maintainer (@maint1) will look. See `@types/node` and user@example.com.', rules), null);
  assert.match(checkOutgoingText('x'.repeat(201), rules)!, /too long: 201 characters, limit 200/);
  assert.match(checkOutgoingText('token ghp_' + 'a'.repeat(30), rules)!, /secret or credential-like/);
  assert.match(checkOutgoingText('ping @someone please', rules)!, /@someone, who is not a configured maintainer/);
  assert.match(checkOutgoingText('ping @acme/core-team', rules)!, /team ping @acme\/core-team/);
  assert.equal(checkOutgoingText('@MAINT1 is allowed regardless of case', rules), null);
  assert.match(checkOutgoingText('![x](https://evil.example/p.png)', rules)!, /external image/);
  assert.match(checkOutgoingText('<img src="//evil.example/p.png">', rules)!, /external image/);
  assert.equal(DEFAULT_MAX_OUTGOING_CHARS < 65_536, true);
});

test('outgoing labels: only allowlisted names may be added or removed', () => {
  assert.equal(checkOutgoingLabels(['warden:needs-triage'], rules), null);
  assert.match(checkOutgoingLabels(['warden:needs-triage', 'bug', 'security'], rules)!, /bug, security/);
});

test('the writer blocks an unsafe comment effect visibly: the operation is rejected with the reason, nothing is posted, nothing is retried', async () => {
  for (const [text, cfg, why] of [['hello there, this is long', { maxOutgoingChars: 5 }, /outgoing-blocked: too long/], ['ping @stranger now', {}, /outgoing-blocked: mentions @stranger/], ['key ghp_' + 'b'.repeat(30), {}, /outgoing-blocked: contains a secret/]] as const) {
    const r = rig(); const n = r.world.addIssue({ title: 'a bug', author: 'reporter1' });
    await r.send({ kind: 'note', item: n, itemKind: 'issue', payload: { text } });
    const rep = await r.writer(cfg).drain();
    const res = rep.processed.find((p) => p.opid !== undefined)!;
    assert.equal(res.result, 'rejected'); assert.match(res.reason ?? '', why);
    const bodies = (await r.world.view('x').listComments(n)).map((c) => c.body);
    assert.equal(bodies.some((b) => b.includes(text)), false, 'the unsafe text was not posted');
    const receipts = (await r.world.view('x').listComments(r.inbox)).map((c) => parseReceipt(c.body)).filter(Boolean);
    assert.ok(receipts.some((x) => x!.result === 'rejected' && /outgoing-blocked/.test(x!.reason ?? '')));
  }
});

test('an ordinary note by the writer is still posted (the check does not get in the way of normal operation)', async () => {
  const r = rig(); const n = r.world.addIssue({ title: 'a bug', author: 'reporter1' });
  await r.send({ kind: 'note', item: n, itemKind: 'issue', payload: { text: 'A maintainer (@maint1) will take a look.' } });
  const rep = await r.writer().drain(); assert.equal(rep.processed.find((p) => p.opid !== undefined)!.result, 'applied');
  assert.ok((await r.world.view('x').listComments(n)).some((c) => c.body.includes('A maintainer (@maint1) will take a look.')));
});
