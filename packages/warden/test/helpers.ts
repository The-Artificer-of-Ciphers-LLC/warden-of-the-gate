import { FakeWorld } from '../src/github/fake.ts';
import type { FakeStore } from '../src/github/fake.ts';
import { Writer, defaultWriterConfig } from '../src/writer/writer.ts';
import type { WriterConfig } from '../src/writer/writer.ts';
import { buildPolicy } from '../src/config/snapshot.ts';
import type { PolicySnapshot } from '../src/config/snapshot.ts';
import { DEFAULT_WARDEN, deepMerge } from '../src/config/defaults.ts';
import type { Orders, WardenConfig } from '../src/config/load.ts';
import { makeIntent } from '../src/writer/protocol.ts';
import type { IntentCore } from '../src/writer/protocol.ts';
import { Faults } from '../src/util.ts';
import { submit } from '../src/writer/journal.ts';
import { stateLabelsOf } from './labels.ts';

export const REPO = 'acme/widgets';
export const SUBMIT = 'warden-submit'; export const WRITER = 'warden-writer'; export const OPERATOR = 'maint1';

export function wardenCfg(over: Record<string, unknown> = {}): WardenConfig {
  return deepMerge({ ...DEFAULT_WARDEN, repository: REPO, maintainers: [OPERATOR, 'maint2'] } as unknown as WardenConfig, over);
}
export const ORDERS: Orders = { schemaVersion: 1, programs: [{ name: 'docs-only', tasks: ['merge', 'review'], decision: 'allow', scope: { kinds: ['documentation'], paths: ['docs/**'] } }] };

export interface Rig { world: FakeWorld; inbox: number; control: number; policy: PolicySnapshot; cfg: WardenConfig; writerStore: (faults?: Faults) => FakeStore; submitStore: FakeStore; writer: (o?: Partial<WriterConfig>, faults?: Faults) => Writer; opStore: FakeStore; intent: (c: Partial<IntentCore> & Pick<IntentCore, 'kind' | 'item'>) => ReturnType<typeof makeIntent>; send: (c: Partial<IntentCore> & Pick<IntentCore, 'kind' | 'item'>) => Promise<number>; comment: (as: string, issue: number, body: string) => Promise<number> }
let seq = 0;
export function rig(over: Record<string, unknown> = {}, orders: Orders = ORDERS): Rig {
  const world = new FakeWorld(); const cfg = wardenCfg(over);
  const inbox = world.addIssue({ title: 'warden-inbox' }); const control = world.addIssue({ title: 'warden-control' });
  void stateLabelsOf;
  const policy = buildPolicy(cfg, orders);
  const submitStore = world.view(SUBMIT); const opStore = world.view(OPERATOR);
  const writer = (o: Partial<WriterConfig> = {}, faults = new Faults()) => new Writer(world.view(WRITER, faults), defaultWriterConfig({ repository: REPO, inboxIssue: inbox, controlIssue: control, policy, submitters: [SUBMIT], writerIdentities: [WRITER], leaseTtlMs: 5000, leaseWaitMs: 2000, fenceMarginMs: 500, ...o }), faults);
  const intent = (c: Partial<IntentCore> & Pick<IntentCore, 'kind' | 'item'>) => makeIntent({ v: 1, repo: REPO, itemKind: 'issue', origin: 'deterministic', source: { kind: 'test', id: String(++seq), observedAt: new Date(world.now()).toISOString() }, actor: 'contributor1', payload: {}, ...c });
  const send = async (c: Partial<IntentCore> & Pick<IntentCore, 'kind' | 'item'>) => {
    const cl = (c.payload as { claimant?: { kind?: string } } | undefined)?.claimant;
    if (!c.source && ((c.kind === 'claim' && cl?.kind !== 'factory') || c.kind === 'release') && c.actor) {   // a contributor claim/release arrives as a real, unedited comment by that GitHub user
      const text = c.kind === 'claim' ? '/warden claim' : '/warden release';
      const prior = (await world.view(c.actor).listComments(c.item)).find((x) => x.author === c.actor && x.body === text);   // the same comment is the same source event (idempotent redelivery)
      const cid = prior ? prior.id : (await world.view(c.actor).createComment(c.item, text)).id;
      c = { ...c, source: { kind: 'gh-comment', id: String(cid), observedAt: new Date(world.now()).toISOString() } };
    }
    return (await submit(submitStore, inbox, intent(c), null)).commentId;
  };
  const comment = async (as: string, issue: number, body: string) => (await world.view(as).createComment(issue, body)).id;
  return { world, inbox, control, policy, cfg, writerStore: (f) => world.view(WRITER, f), submitStore, writer, opStore, intent, send, comment };
}
export const claim = (id: string, kind: 'contributor' | 'factory' = 'contributor') => ({ kind: 'claim' as const, actor: id, payload: { claimant: { kind, id } } });
