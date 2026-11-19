// Seeds a throwaway SIMULATED repository with one pending approval so `warden discord sync` has a card to post. No network, no token.
import { cliEnv } from '../../packages/warden/test/cli-env.ts';
import { newLedger } from '../../packages/warden/src/state/model.ts';
import { encodeLedger } from '../../packages/warden/src/writer/protocol.ts';
import { openSim } from '../../packages/warden/src/github/filesim.ts';
import { loadWarden, loadOrders } from '../../packages/warden/src/config/load.ts';
import { buildPolicy } from '../../packages/warden/src/config/snapshot.ts';
const e = await cliEnv();
const wc = loadWarden(e.repo); const oc = loadOrders(e.repo); const pol = buildPolicy(wc.value!, oc.present ? oc.value! : null);
const w = openSim(e.world, 'warden-writer'); const n = await w.store.createIssue('Discord card proof', 'Seeded issue with one pending approval.');
const led: any = { ...newLedger('acme/widgets', n, 'issue'), state: 'ready' as const, facets: { workKind: 'bug', risk: 'low' }, approvals: { apr_card: { id: 'apr_card', type: 'action', action: 'implement', binding: { revision: 'r', policyDigest: pol.digest, evidenceDigest: '' }, bindingDigest: 'cardproof', requestedBy: 'warden', requestedAt: new Date().toISOString(), expiresAt: null, status: 'pending' } } };
await w.store.createComment(n, encodeLedger(led as never));
console.log(JSON.stringify({ repoDir: e.repo, home: e.home, world: e.world }));
