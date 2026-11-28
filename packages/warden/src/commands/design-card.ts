import { loadConfigs, openBackend, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { Ledger } from '../state/model.ts';
import { renderDesignCard } from '../factory/design-card.ts';
import { redact } from '../util.ts';

/** `warden design-card --item N [--json]`: the proposed design a maintainer answers before Warden builds work that crosses a boundary class (ADR 0015). Read-only: reads GitHub, posts and writes nothing. */
export async function designCard(c: Ctx): Promise<Result> {
  const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: {}, text: 'design-card: --item N (an issue number) is required' };
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'design-card: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; const be = openBackend(c, cfg); const store = be.open('operator'); if (!store) return { code: 4, data: { reachable: false }, text: `design-card: the remote is unreachable (${be.unavailable})` };
  try {
    const issue = await store.getIssue(item); if (issue.isPr) return { code: 4, data: { item }, text: `design-card: #${item} is a pull request; a design card is for an issue` };
    const l = (await store.listComments(item)).filter((x) => x.body.startsWith(LEDGER_MARK)).map((x) => parseLedger(x.body)).find(Boolean) as Ledger | undefined;
    const text = renderDesignCard({ repo: cfg.repository, issue, ledger: l, classes: cfg.boundaries.classes }); return { code: 0, data: { item, card: text, posted: false }, text };
  } catch (e) { return { code: 4, data: { item }, text: `design-card: ${redact(String((e as Error).message)).slice(0, 160)}` }; }
}
