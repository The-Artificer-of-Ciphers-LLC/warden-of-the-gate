import { mkdirSync } from 'node:fs';
import { loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { DiscordRestGateway } from '../discord/gateway.ts';
import { FakeGateway } from '../discord/gateway.ts';
import { syncCards } from '../discord/sync.ts';
import type { CardKV } from '../discord/sync.ts';

/** `warden discord sync --channel ID [--dry-run]`: post/edit approval CARDS (notifications only; decisions stay on GitHub). The bot token is read from
 *  WARDEN_DISCORD_TOKEN, never printed and never stored. Creating the Discord application and channel is the owner's step; this release never does it. */
export async function discord(c: Ctx, sub: string): Promise<Result> {
  if (sub !== 'sync') return { code: 2, data: {}, text: 'discord: subcommands: sync --channel ID [--dry-run]' };
  const channel = str(c.flags, 'channel'); if (!channel || !/^\d{5,25}$/.test(channel)) return { code: 2, data: {}, text: 'discord sync: --channel must be a Discord channel id (digits)' };
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'discord: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const st = openStorage(c, cfg.repository); const store = openBackend(c, cfg).open('operator');
  if (!store) return { code: 4, data: { outcome: 'blocked' }, text: 'discord sync blocked: no read access to GitHub (select an operator identity)' };
  const dry = !!c.flags['dry-run']; const token = c.env.WARDEN_DISCORD_TOKEN;
  if (!dry && !token) return { code: 4, data: { outcome: 'blocked', reason: 'no-discord-token' }, text: 'discord sync blocked: WARDEN_DISCORD_TOKEN is not set (the owner creates the Discord application and supplies the token; it is never stored)' };
  mkdirSync(st.path('discord'), { recursive: true, mode: 0o700 }); const file = st.path('discord', 'cards.json');
  const kv: CardKV = { read: () => st.readJson<Record<string, { messageId: string; state: string }>>(file) ?? {}, write: (v) => st.writeJson(file, v) };
  const gateway = dry ? new FakeGateway() : new DiscordRestGateway(() => String(token));
  const rep = await syncCards({ store, gateway, channelId: channel, repo: cfg.repository, kv, now: c.now(), dryRun: dry });
  return { code: rep.failed.length ? 1 : 0, data: { ...rep, dryRun: dry } as unknown as Record<string, unknown>, text: `discord sync${dry ? ' (dry-run)' : ''}: ${rep.posted.length} posted, ${rep.edited.length} edited, ${rep.unchanged} unchanged, ${rep.failed.length} failed, ${rep.capped} over the cap` };
}
