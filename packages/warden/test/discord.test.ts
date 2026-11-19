import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld } from '../src/github/fake.ts';
import { newLedger } from '../src/state/model.ts';
import type { ApprovalRec } from '../src/state/model.ts';
import { encodeLedger } from '../src/writer/protocol.ts';
import { renderApprovalCard } from '../src/discord/cards.ts';
import { DiscordRestGateway, FakeGateway, payloadFor } from '../src/discord/gateway.ts';
import { syncCards } from '../src/discord/sync.ts';
import type { CardKV } from '../src/discord/sync.ts';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const apr = (o: Partial<ApprovalRec> = {}): ApprovalRec => ({ id: 'apr_abc', type: 'action', action: 'merge', binding: { revision: 'r', policyDigest: 'p', evidenceDigest: 'e' }, bindingDigest: 'bd1234567890', requestedBy: 'warden', requestedAt: '2026-11-18T00:00:00Z', expiresAt: '2026-11-19T00:00:00Z', status: 'pending', ...o } as ApprovalRec);
const card = (a = apr()) => renderApprovalCard(a, { repo: 'acme/widgets', item: 7, itemUrl: 'https://github.com/acme/widgets/pull/7', now: NOW });

test('a card carries the GitHub command and a link, never an approve/deny control; free text is neutralized; expiry shows as expired', () => {
  const c = card(); assert.match(c.description, /decides on GitHub, never here/); assert.match(c.description, /\/warden approve apr_abc bind=bd1234567890/); assert.equal(c.state, 'pending');
  const p = payloadFor(c); assert.deepEqual(p.allowed_mentions.parse, []); assert.equal(p.components[0].components.length, 1); assert.equal(p.components[0].components[0].style, 5, 'the only component is a LINK button'); assert.equal(p.components[0].components[0].url, c.linkUrl);
  assert.doesNotMatch(JSON.stringify(p), /custom_id/, 'no interaction component exists, so no press can be read as a decision');
  assert.match(card(apr({ action: '@everyone `merge` **now**' })).title, /^Approval needed: {0,}.*everyone/); assert.doesNotMatch(card(apr({ action: '@everyone' })).title, /@/);
  assert.equal(card(apr({ expiresAt: '2026-11-18T11:00:00Z' })).state, 'expired'); assert.match(card(apr({ status: 'approved', decidedBy: 'maint' })).description, /decided by maint on GitHub\)\. This card grants nothing/);
});

test('REST gateway: bot token only in the Authorization header, mentions disabled, message id required', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = []; const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ id: '555' }), { status: 200 }); }) as unknown as typeof fetch;
  const g = new DiscordRestGateway(() => 'TOKEN123', f); const m = await g.post('12345', card()); assert.equal(m.messageId, '555'); await g.edit('12345', '555', card());
  assert.equal(seen[0].url, 'https://discord.com/api/v10/channels/12345/messages'); assert.equal((seen[0].init.headers as Record<string, string>).authorization, 'Bot TOKEN123'); assert.equal(seen[1].init.method, 'PATCH');
  assert.ok(!String(seen[0].url).includes('TOKEN123') && !String(seen[0].init.body).includes('TOKEN123'));
  await assert.rejects(new DiscordRestGateway(() => 't', (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch).post('1', card()), /-> 500/);
});

function rig() {
  const world = new FakeWorld(); world.clock = NOW; const writer = world.view('warden-writer'); const gw = new FakeGateway(); let mem: Record<string, { messageId: string; state: string }> = {};
  const kv: CardKV = { read: () => ({ ...mem }), write: (v) => { mem = { ...v }; } };
  const item = async (approvals: Record<string, ApprovalRec>) => { const n = world.addIssue({ title: 'x' }); await writer.createComment(n, encodeLedger({ ...newLedger('acme/widgets', n, 'issue'), approvals })); return n; };
  const sync = (o: Partial<Parameters<typeof syncCards>[0]> = {}) => syncCards({ store: world.view('operator'), gateway: gw, channelId: '12345', repo: 'acme/widgets', kv, now: NOW, ...o });
  return { world, gw, item, sync, writer, mem: () => mem };
}

test('sync: one card per pending approval, edited in place when it resolves, idempotent, bounded, and silent about approvals that were already resolved', async () => {
  const r = rig(); const n = await r.item({ apr_abc: apr(), apr_old: apr({ id: 'apr_old', bindingDigest: 'old', status: 'approved', decidedBy: 'm' }) });
  const a = await r.sync(); assert.equal(a.posted.length, 1); assert.equal(r.gw.messages.size, 1, 'an already-approved approval gets no card');
  const b = await r.sync(); assert.equal(b.posted.length + b.edited.length, 0); assert.equal(b.unchanged, 1);
  const cid = (await r.world.view('operator').listComments(n)).find((c) => c.body.includes('warden-ledger') || true)!.id;
  await r.writer.updateComment(cid, encodeLedger({ ...newLedger('acme/widgets', n, 'issue'), approvals: { apr_abc: apr({ status: 'approved', decidedBy: 'maint' }) } }));
  const c = await r.sync(); assert.equal(c.edited.length, 1); assert.equal(r.gw.messages.size, 1); assert.equal([...r.gw.messages.values()][0].card.state, 'approved');
  const r2 = rig(); await r2.item({ a1: apr({ id: 'a1', bindingDigest: 'b1' }), a2: apr({ id: 'a2', bindingDigest: 'b2' }), a3: apr({ id: 'a3', bindingDigest: 'b3' }) });
  const capped = await r2.sync({ maxPerRun: 2 }); assert.equal(capped.posted.length, 2); assert.equal(capped.capped, 1);
});

test('sync: a Discord outage is reported per card and never blocks or alters anything on GitHub; dry-run posts nothing; the store is read-only', async () => {
  const r = rig(); await r.item({ apr_abc: apr() }); const before = JSON.stringify(r.world.snapshot());
  r.gw.down = true; const down = await r.sync(); assert.equal(down.failed.length, 1); assert.equal(down.posted.length, 0); assert.deepEqual(r.mem(), {});
  r.gw.down = false; const dry = await r.sync({ dryRun: true }); assert.equal(dry.posted.length, 1); assert.equal(r.gw.messages.size, 0, 'dry-run posts nothing');
  assert.equal(JSON.stringify(r.world.snapshot()), before, 'GitHub is untouched');
  assert.equal((await r.sync()).posted.length, 1, 'recovers on the next sync');
});
