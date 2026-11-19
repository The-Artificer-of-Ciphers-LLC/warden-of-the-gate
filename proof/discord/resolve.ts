// Marks the seeded approval as approved in the SIMULATED repo so the next `discord sync` edits the card in place.
import { openSim } from '../../packages/warden/src/github/filesim.ts';
import { LEDGER_MARK } from '../../packages/warden/src/writer/protocol.ts';
import { parseLedger } from '../../packages/warden/src/writer/protocol.ts';
import { encodeLedger } from '../../packages/warden/src/writer/protocol.ts';
const world = process.argv[2]; const w = openSim(world, 'warden-writer');
for (const n of [3, 4, 5]) { const cs = await w.store.listComments(n).catch(() => []); const cm = cs.find((c) => c.body.startsWith(LEDGER_MARK)); if (!cm) continue;
  const led: any = parseLedger(cm.body); if (!led?.approvals?.apr_card) continue;
  led.approvals.apr_card = { ...led.approvals.apr_card, status: 'approved', decidedBy: 'maint1', decidedAt: new Date().toISOString() };
  await (w.store as any).updateComment(cm.id, encodeLedger(led)); console.log('resolved on item', n); }
