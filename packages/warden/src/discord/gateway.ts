import type { Card } from './cards.ts';

/** The only Discord surface Warden uses: post a card, edit a card. No interaction handling exists, so no button press can ever be read as a decision.
 *  Mentions are disabled on every message and the only component is a LINK button to the GitHub item. */
export interface Gateway { post(channelId: string, card: Card): Promise<{ messageId: string }>; edit(channelId: string, messageId: string, card: Card): Promise<void> }

export const payloadFor = (card: Card) => ({
  allowed_mentions: { parse: [] as string[] },
  embeds: [{ title: card.title, description: card.description, color: card.color, fields: card.fields.map((f) => ({ ...f, inline: true })) }],
  components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open on GitHub', url: card.linkUrl }] }],
});
export class DiscordRestGateway implements Gateway {
  private token: () => string; private f: typeof fetch; private base: string;
  constructor(token: () => string, f: typeof fetch = fetch, base = 'https://discord.com/api/v10') { this.token = token; this.f = f; this.base = base; }
  private async call(method: string, path: string, body: unknown): Promise<{ id?: string }> {
    const r = await this.f(`${this.base}${path}`, { method, headers: { authorization: `Bot ${this.token()}`, 'content-type': 'application/json', 'user-agent': 'warden-core' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`discord ${method} ${path.replace(/\/\d+/g, '/:id')} -> ${r.status}`);
    return (await r.json().catch(() => ({}))) as { id?: string };
  }
  async post(channelId: string, card: Card) { const j = await this.call('POST', `/channels/${encodeURIComponent(channelId)}/messages`, payloadFor(card)); if (!j.id) throw new Error('discord returned no message id'); return { messageId: j.id }; }
  async edit(channelId: string, messageId: string, card: Card) { await this.call('PATCH', `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, payloadFor(card)); }
}
export class FakeGateway implements Gateway {
  messages = new Map<string, { channel: string; card: Card }>(); next = 1; down = false;
  async post(channel: string, card: Card) { if (this.down) throw new Error('discord down'); const id = `m${this.next++}`; this.messages.set(id, { channel, card }); return { messageId: id }; }
  async edit(channel: string, id: string, card: Card) { if (this.down) throw new Error('discord down'); const m = this.messages.get(id); if (!m || m.channel !== channel) throw new Error('unknown message'); m.card = card; }
}
