import { CLI_VERSION, WARDEN_SCHEMA_VERSION, ORDERS_SCHEMA_VERSION } from '../version.ts';

/** `warden upgrade --dry-run` data: what changed between recorded instance versions, listed explicitly so an operator can review before approving. There is
 *  deliberately NO general migration engine: unsupported or unknown versions fail with an actionable message. */
export interface Change { since: string; kind: 'behavior' | 'config' | 'schema' | 'default'; summary: string; action: 'none' | 'review' }
export const CHANGES: Change[] = [
  { since: '0.1.0-p2', kind: 'config', summary: 'warden.yml gains optional `merge.{automationLogins,factoryLogins,requiredApprovals}`; existing files stay valid (defaults: empty lists, 0 approvals).', action: 'none' },
  { since: '0.1.0-p2', kind: 'behavior', summary: 'Draft PRs are closed with an explanation and return path unless `drafts.allowed` is true (default false, as documented). Existing drafts are never closed by this: they need `warden adopt`.', action: 'review' },
  { since: '0.1.0-p2', kind: 'behavior', summary: 'The sweep now closes silent PRs at five days and unanswered information requests at 14/28 days, and releases expired delivery commitments, only for items with Warden state; nothing is scheduled by Warden itself.', action: 'review' },
  { since: '0.1.0-p3', kind: 'behavior', summary: '`run --task review|triage` perform local read-only shadow work when started with `--runner opencode`; nothing is posted, labelled, merged or closed in shadow mode.', action: 'none' },
  { since: '0.1.0-p4', kind: 'behavior', summary: 'Merge delivery is bound to the reviewed head and only exists in live mode; shadow mode never merges.', action: 'none' },
];
const order = (v: string) => { const m = v.match(/^0\.1\.0-p(\d+)$/); return m ? Number(m[1]) : null; };
export function planUpgrade(recorded: string | null, repoSchema: { warden: number; orders: number | null }) {
  const problems: string[] = []; const from = recorded === null ? null : order(recorded); const to = order(CLI_VERSION);
  if (recorded === null) problems.push('no recorded instance version: run `warden setup` to initialize before upgrading');
  else if (from === null) problems.push(`unrecognized recorded version "${recorded}": there is no migration path; export your data and re-run setup`);
  else if (to !== null && from > to) problems.push(`the instance was created by a NEWER Warden (${recorded}) than this one (${CLI_VERSION}): downgrades are unsupported`);
  if (repoSchema.warden !== WARDEN_SCHEMA_VERSION) problems.push(`warden.yml schemaVersion ${repoSchema.warden} is not supported by this Warden (supports ${WARDEN_SCHEMA_VERSION}); no automatic migration`);
  if (repoSchema.orders !== null && repoSchema.orders !== ORDERS_SCHEMA_VERSION) problems.push(`ORDERS.yaml schemaVersion ${repoSchema.orders} is not supported (supports ${ORDERS_SCHEMA_VERSION})`);
  const changes = problems.length || from === null || to === null ? [] : CHANGES.filter((c) => (order(c.since) ?? 0) > from && (order(c.since) ?? 0) <= to);
  return { recorded, target: CLI_VERSION, supported: problems.length === 0, problems, changes, applied: false as const, note: 'Dry run: nothing was changed. An explicitly approved upgrade preserves configuration, authority, checks and clocks, or stops for review.' };
}
