import { loadConfigs, openBackend, openStorage, str } from './common.ts';
import type { Ctx, Result } from './common.ts';
import { LEDGER_MARK, parseLedger } from '../writer/protocol.ts';
import type { Ledger } from '../state/model.ts';
import { fileKV } from '../review/slice.ts';
import { renderDecisionCard } from '../factory/decision-card.ts';
import { redact } from '../util.ts';

/** `warden decision-card --item N [--json]`: the card a maintainer reads before deciding on implementation work (ADR 0015). Read-only: it reads GitHub and local state, writes nothing and posts nothing. */
export async function decisionCard(c: Ctx): Promise<Result> {
  const item = Number(str(c.flags, 'item')); if (!Number.isInteger(item) || item < 1) return { code: 2, data: {}, text: 'decision-card: --item N (a pull request number) is required' };
  const cfgs = loadConfigs(c); if (!('warden' in cfgs)) return { code: 1, data: { errors: cfgs.errors }, text: 'decision-card: configuration invalid:\n' + cfgs.errors.join('\n') };
  const cfg = cfgs.warden; let st; try { st = openStorage(c, cfg.repository); } catch (e) { return { code: 1, data: { error: String(e) }, text: `decision-card: ${(e as Error).message}` }; }
  const be = openBackend(c, cfg); const store = be.open('operator'); if (!store) return { code: 4, data: { reachable: false }, text: `decision-card: the remote is unreachable (${be.unavailable})` };
  try {
    const pr = await store.getPull(item); const l = (await store.listComments(item)).filter((x) => x.body.startsWith(LEDGER_MARK)).map((x) => parseLedger(x.body)).find(Boolean) as Ledger | undefined;
    if (!l || l.kind !== 'pr') return { code: 4, data: { item }, text: `decision-card: #${item} is not a pull request with Warden state` };
    const issue = l.linked.length ? await store.getIssue(l.linked[0]).catch(() => undefined) : undefined;
    const rec = fileKV(st).read(item); const findings = rec?.marker && rec.marker.head === pr.head ? rec.marker.findings : undefined;
    const text = renderDecisionCard({ repo: cfg.repository, pr, ledger: l, issue, findings, boundaries: cfg.boundaries.classes, testGlobs: cfg.verification.testPaths });
    return { code: 0, data: { item, card: text, posted: false }, text };
  } catch (e) { return { code: 4, data: { item }, text: `decision-card: ${redact(String((e as Error).message)).slice(0, 160)}` }; }
}
