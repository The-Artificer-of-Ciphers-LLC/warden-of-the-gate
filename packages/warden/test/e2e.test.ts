import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { cliEnv } from './cli-env.ts';
import { loadWarden } from '../src/config/load.ts';
import { InstanceStorage } from '../src/storage/instance.ts';

const h = (s: string) => createHash('sha256').update(s).digest('hex');
const worldHash = (e: { world: string }) => h(readFileSync(e.world, 'utf8'));

test('status reports a legacy or foreign ledger explicitly without claiming GitHub is unreachable or adopting it', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  await e.sim('sim', 'issue', '--title', 'Legacy P0 item');
  assert.equal((await e.sim('sim', 'comment', '--issue', '3', '--as', 'warden-writer', '--body',
    '<!-- warden-ledger:v1 -->\n```json\n{"v":1,"item":3,"state":"ready","owner":null,"ops":{},"order":[],"seq":1,"epoch":1}\n```')).code, 0);
  const result = await e.json('status');
  assert.equal(result.data.remote.reachable, true);
  const legacy = result.data.remote.items.find((i: { item: number }) => i.item === 3);
  assert.equal(legacy.state, 'invalid-ledger');
  assert.match(legacy.blocker.reason, /unsupported|malformed|another instance/);
});

test('corrupt local stop state blocks runs and status explicitly', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false });
  for (const file of [st.stopPath, st.globalStopPath]) {
    for (const contents of ['{', 'null', '{}', '{"stopped":"false"}']) {
      writeFileSync(file, contents);
      const run = await e.run('run', '--task', 'intake', '--dry-run');
      assert.equal(run.code, 1, contents); assert.match(run.err, /STORAGE FAILURE/);
      const status = await e.run('status');
      assert.equal(status.code, 1, contents); assert.match(status.err, /STORAGE FAILURE/);
    }
    rmSync(file); mkdirSync(file);
    const unreadable = await e.run('run', '--task', 'intake', '--dry-run');
    assert.equal(unreadable.code, 1); assert.match(unreadable.err, /STORAGE FAILURE/);
    rmSync(file, { recursive: true }); writeFileSync(file, '{"stopped":false}');
  }
});

test('global stop persists local fallback and global resume preserves an independent instance stop', async (t) => {
  const e = await cliEnv(); t.after(() => rmSync(e.dir, { recursive: true, force: true }));
  await e.sim('sim', 'issue', '--title', 'Global control');
  const cfg = loadWarden(e.repo).value!;
  e.write('.github/warden.yml', stringify({ ...cfg, inbox: { ...cfg.inbox, globalControl: { repository: cfg.repository, issue: 3 } } }));
  e.envVars.WARDEN_SIM_DOWN = '1';
  const stopped = await e.json('stop', '--global');
  assert.equal(stopped.code, 2); assert.equal(stopped.data.remote, 'unconfirmed');
  e.envVars.WARDEN_SIM_DOWN = '0';
  assert.equal((await e.run('run', '--task', 'intake', '--dry-run')).code, 4, 'local fallback survives failed propagation');
  const instanceResume = await e.json('resume', '--confirm');
  assert.equal(instanceResume.code, 1); assert.equal(instanceResume.data.local, 'stopped', 'instance resume cannot clear the global fallback');
  assert.equal((await e.run('resume', '--global', '--confirm')).code, 0);
  assert.equal((await e.run('run', '--task', 'intake', '--dry-run')).code, 0);
  await e.run('stop');
  await e.run('stop', '--global');
  const resumed = await e.json('resume', '--global', '--confirm');
  assert.equal(resumed.code, 1); assert.equal(resumed.data.local, 'stopped');
  assert.equal((await e.run('run', '--task', 'intake', '--dry-run')).code, 4, 'global resume cannot clear an instance stop');
  assert.equal((await e.run('resume', '--confirm')).code, 0);
  assert.equal((await e.run('run', '--task', 'intake', '--dry-run')).code, 0);
});

test('setup: reports prerequisites, creates only explicitly approved missing starters, never overwrites, adopts nothing', async () => {
  const e = await cliEnv({ configure: false });
  let r: any = await e.json('setup'); assert.equal(r.code, 1); assert.ok(r.data.checks.some((c: any) => c.name === '.github/warden.yml' && c.status === 'missing'));
  assert.ok(!existsSync(join(e.repo, '.github/warden.yml')), 'no flag => no file');
  r = await e.json('setup', '--create-config', '--repo', 'acme/widgets', '--maintainers', 'maint1', '--create-orders');
  assert.ok(r.data.checks.some((c: any) => c.name === '.github/warden.yml' && c.status === 'created'));
  e.write('.github/warden.yml', e.read('.github/warden.yml') + '\n# owner edit\n');
  const before = e.read('.github/warden.yml');
  r = await e.json('setup', '--create-config', '--repo', 'other/repo', '--maintainers', 'x', '--create-orders'); assert.equal(e.read('.github/warden.yml'), before, 'existing file untouched');
  assert.ok(r.data.checks.some((c: any) => c.status === 'exists-untouched'));
  assert.equal(r.data.adoptedBacklog, false); assert.equal(r.data.liveAiActivated, false);
  // labels: missing until explicitly approved
  assert.ok(r.data.checks.some((c: any) => c.name === 'labels' && c.status === 'missing'));
  const w0 = e.worldJson().labels.length; r = await e.json('setup', '--create-labels'); assert.ok(e.worldJson().labels.length > w0); r = await e.json('setup', '--create-labels'); assert.ok(r.data.checks.find((c: any) => c.name === 'labels').status === 'ok');
  assert.equal(e.worldJson().issues.length, 2, 'setup creates no issues and adopts nothing');
});

test('config validate: malformed, unsupported version, unknown keys, unsafe defaults, conflicts, self-authorizing policy', async () => {
  const e = await cliEnv();
  assert.equal((await e.run('config', 'validate')).code, 0);
  e.write('.github/warden.yml', 'schemaVersion: 1\nrepository: [unclosed');
  let r: any = await e.run('config', 'validate'); assert.equal(r.code, 1); assert.match(r.out, /YAML parse error/);
  e.write('.github/warden.yml', 'schemaVersion: 2\nrepository: acme/widgets\nmaintainers: [m]\n'); r = await e.run('config', 'validate'); assert.match(r.out, /unsupported schemaVersion 2/);
  e.write('.github/warden.yml', 'schemaVersion: 1\nrepository: acme/widgets\nmaintainers: [m]\nbogus: 1\ngates: {blocker: false}\nruntime: {remoteFallback: true, isolation: none}\napprovals: {actionExpiryHours: 500}\n');
  r = await e.run('config', 'validate'); assert.equal(r.code, 1); assert.match(r.out, /bogus/); assert.match(r.out, /blocker/);
  e.write('.github/warden.yml', 'schemaVersion: 1\nrepository: acme/widgets\nmaintainers: [m]\nruntime: {isolation: none}\napprovals: {actionExpiryHours: 100}\ninbox: {inboxIssue: 5, controlIssue: 5}\n');
  r = await e.json('config', 'validate'); const codes = r.data.findings.map((f: any) => f.code); assert.ok(codes.includes('runtime.isolation')); assert.ok(codes.includes('approvals.expiry')); assert.ok(codes.includes('inbox.control-collision'));
  e.write('.github/warden.yml', 'schemaVersion: 1\nrepository: acme/widgets\nmaintainers: [m]\n');
  e.write('.github/ORDERS.yaml', 'schemaVersion: 1\nprograms:\n  - {name: a, tasks: [merge], decision: allow, scope: {paths: [".github/**"]}}\n  - {name: a, tasks: [review], decision: allow}\n');
  r = await e.json('config', 'validate'); assert.equal(r.code, 1); const c2 = r.data.findings.map((f: any) => f.code); assert.ok(c2.includes('orders.self-authority')); assert.ok(c2.includes('orders.duplicate'));
  e.write('.github/ORDERS.yaml', 'schemaVersion: 1\nprograms:\n  - {name: needs-gate, tasks: [merge], decision: require-approval}\n'); r = await e.run('config', 'validate'); assert.match(r.out, /schema/i);
  const eff = await e.json('config', 'validate', '--show-effective'); assert.equal(eff.data.effective.approvals.actionExpiryHours, 24, 'defaults really materialized');
});

test('run --task intake --dry-run: proposed transitions, zero mutation; other tasks unsupported; unknown task usage error', async () => {
  const e = await cliEnv();
  await e.sim('sim', 'issue', '--title', 'Crash on save', '--body', 'Steps to reproduce...'); await e.sim('sim', 'issue', '--title', 'x', '--body', '');
  await e.sim('sim', 'issue', '--title', 'Fix typo', '--pr', '--as', 'dev1'); await e.sim('sim', 'issue', '--title', 'WIP thing', '--pr', '--draft');
  const before = worldHash(e);
  const r = await e.json('run', '--task', 'intake', '--dry-run'); assert.equal(r.code, 0);
  assert.equal(r.data.mutations, 0); assert.equal(worldHash(e), before, 'world byte-identical after dry-run');
  const by = Object.fromEntries(r.data.proposals.map((p: any) => [p.item, p.to])); assert.deepEqual(by, { 3: 'needs-triage', 4: 'needs-info', 5: 'needs-review', 6: 'needs-review' });
  assert.ok(r.data.proposals.find((p: any) => p.item === 6).effects[0].includes('close with explanation'));
  assert.equal(r.data.protection.readOnlyStoreEnforced, true);
  for (const t of ['triage', 'claim', 'implement', 'review', 'rework', 'retro']) { const x = await e.json('run', '--task', t, '--dry-run'); assert.equal(x.code, 3, t); assert.equal(x.data.outcome, 'unsupported'); }
  { const x = await e.json('run', '--task', 'sweep', '--dry-run'); assert.equal(x.code, 0, 'sweep dry-run is implemented (P2, offline)'); assert.equal(x.data.outcome, 'proposed'); assert.equal(x.data.mutations, 0); }
  assert.equal((await e.json('run', '--task', 'sweep')).code, 0, 'live sweep only SUBMITS intents (none here: no item has a ledger)');
  assert.equal((await e.json('run', '--task', 'intake')).code, 2, 'live intake never scans the backlog: --item is required');
  assert.equal((await e.run('run', '--task', 'nope', '--dry-run')).code, 2); assert.equal((await e.run('run', '--dry-run')).code, 2);
  assert.equal(worldHash(e), before);
});

test('stop: local first, confirmed remotely, writers halt before effects and acknowledge; unreachable remote is UNCONFIRMED not success; unknown control fails closed', async () => {
  const e = await cliEnv(); const n = 3; await e.sim('sim', 'issue', '--title', 'Item to claim', '--body', 'body body');
  let r = await e.json('stop', '--reason', 'drill', '--as', 'maint1'); assert.equal(r.code, 0); assert.equal(r.data.remote, 'confirmed'); assert.equal(r.data.operatorAttributed, true);
  assert.match((await e.run('run', '--task', 'intake', '--dry-run')).out, /blocked/); assert.equal((await e.run('run', '--task', 'intake', '--dry-run')).code, 4);
  // an intent is waiting; the writer must halt without any effect
  await e.run('approvals', 'request', '--item', String(n), '--action', 'merge', '--revision', 'abc123', '--evidence-digest', 'e1');
  const w0 = worldHash(e); let w = await e.json('writer', 'drain'); assert.equal(w.code, 5); assert.equal(w.data.halted, 'stop'); assert.equal(w.data.processed.length, 0); assert.equal(w.data.pendingAfter.length, 1);
  const st = await e.json('status'); assert.equal(st.data.remote.controls.stopped, true); assert.ok(st.data.remote.stopAcknowledgements.some((a: any) => a.env === 'actions'));
  assert.ok(worldHash(e) !== w0); // only the ack comment was added
  const issue3 = (await e.sim('sim', 'show', '--issue', '3')).out; assert.ok(!/warden-ledger/.test(issue3), 'no ledger or effect written while stopped');
  // non-operator removing the label cannot resume
  await e.sim('sim', 'label', '--issue', '2', '--label', 'warden:stop', '--remove', 'true', '--as', 'mallory');
  w = await e.json('writer', 'drain'); assert.equal(w.data.halted, 'stop'); assert.match(w.data.haltReason, /non-operator mallory/);
  // unreachable remote
  let o = await cliEnv(); o.envVars.WARDEN_SIM_DOWN = '1';
  r = await o.json('stop'); assert.equal(r.code, 2); assert.equal(r.data.remote, 'unconfirmed'); assert.equal(r.data.globalSuccessClaimed, false); assert.match((await o.run('stop')).out, /NOT confirmed/);
  w = await o.json('writer', 'drain'); assert.equal(w.data.halted, 'stop', 'unreadable control => stopped'); assert.ok(w.data.haltReason);
  assert.equal((await o.run('run', '--task', 'intake', '--dry-run')).code, 4, 'local stop persists even with GitHub down');
});

test('resume: explicit only, starts no AI, resets no counters, restores no revoked authority', async () => {
  const e = await cliEnv(); await e.sim('sim', 'issue', '--title', 'Item', '--body', 'b');
  await e.json('stop', '--as', 'maint1');
  assert.equal((await e.run('resume')).code, 1, 'no --confirm'); assert.match((await e.run('resume')).out, /--confirm/);
  assert.match((await e.run('run', '--task', 'intake', '--dry-run')).out, /blocked/);
  // persisted credential revocation + a persisted attempt counter must survive resume
  const { InstanceStorage } = await import('../src/storage/instance.ts');
  const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false });
  st.writeJson(join(st.credentialsDir, 'credentials-state.json'), { 'write@acme/widgets': { failures: 0, state: 'revoked', revokedAt: 1 } });
  const r = await e.json('resume', '--confirm', '--as', 'maint1'); assert.equal(r.code, 0); assert.equal(r.data.resumed, true);
  assert.match(r.data.notes.join(' '), /starts no AI/);
  assert.equal(readFileSync(join(st.credentialsDir, 'credentials-state.json'), 'utf8').includes('revoked'), true, 'revoked authority not restored');
  assert.equal((await e.json('run', '--task', 'intake', '--dry-run')).code, 0);
  assert.equal(existsSync(st.path('active-run.json')), false, 'resume starts no run');
  // non-operator cannot resume a remote stop
  await e.json('stop', '--as', 'maint1');
  const bad = await e.json('resume', '--confirm', '--as', 'mallory'); assert.equal(bad.code, 1); assert.equal(bad.data.resumed, false); // mallory is not an operator: label removal is ignored, resume refused
  assert.equal((await e.run('run', '--task', 'intake', '--dry-run')).code, 4, 'stop still in force after non-operator removal');
});

test('status: no model, no secrets, shows state/ownership/approvals/credentials/stop acks/pending/evidence', async () => {
  const e = await cliEnv(); const n = 3; await e.sim('sim', 'issue', '--title', 'Item', '--body', 'b');
  const { InstanceStorage } = await import('../src/storage/instance.ts'); const st = InstanceStorage.open(e.home, 'acme/widgets', { create: false });
  const secret = 'ghp_' + 'A'.repeat(36); st.appendLine(join(st.path('journal'), 'journal.jsonl'), { opid: 'op_x', state: 'pending', at: new Date().toISOString(), note: secret });
  await e.run('approvals', 'request', '--item', String(n), '--action', 'merge', '--revision', 'rev1', '--evidence-digest', 'e1', '--drain');
  const r = await e.json('status'); assert.equal(r.code, 0);
  const item = r.data.remote.items.find((i: any) => i.item === n); assert.equal(item.approvals.length, 1); assert.equal(item.approvals[0].status, 'pending'); assert.ok(item.approvals[0].expiresAt);
  assert.equal(r.data.remote.inbox.pending, 0); assert.ok('automation' in r.data.credentials); assert.ok(Array.isArray(r.data.credentials.controller));
  assert.equal(JSON.stringify(r.data).includes(secret), false, 'no secrets in status output'); assert.ok(r.data.journal.unacked.length >= 1);
  const txt = await e.run('status'); assert.match(txt.out, /local stop: running/); assert.match(txt.out, /last sweep/);
  // GitHub unreachable: status still works locally and says remote is unknown
  e.envVars.WARDEN_SIM_DOWN = '1'; const d = await e.run('status'); assert.equal(d.code, 0); assert.match(d.out, /UNREACHABLE|unknown/i);
});


test('live intake via the CLI submits only the named item, the writer applies it, and adopt inventories/adopts only the selected existing items', async () => {
  const e = await cliEnv();
  await e.sim('sim', 'issue', '--title', 'Old backlog issue', '--body', 'existing body');     // #3 existing, never touched by intake
  await e.sim('sim', 'issue', '--title', 'Brand new report', '--body', 'fresh body');          // #4 new
  await e.sim('sim', 'issue', '--title', 'Another old issue', '--body', 'old body');          // #5 existing
  const live = await e.json('run', '--task', 'intake', '--item', '4'); assert.equal(live.code, 0); assert.deepEqual(live.data.submitted, [4]);
  assert.equal((await e.json('writer', 'drain')).code, 0);
  const inv = await e.json('adopt', '--dry-run'); assert.equal(inv.code, 0);
  assert.deepEqual(inv.data.items.map((i: any) => i.item), [3, 5], 'item 4 already has Warden state; 3 and 5 are inventoried, not adopted');
  assert.equal((await e.json('status')).code, 0);
  e.write('sel.json', JSON.stringify({ v: 1, repository: 'acme/widgets', inventoryDigest: 'stale', items: [{ item: 3 }] }));
  assert.equal((await e.json('adopt', '--selection', 'repo/sel.json', '--confirm')).code, 1, 'stale inventory digest is refused');
  e.write('sel.json', JSON.stringify({ v: 1, repository: 'acme/widgets', inventoryDigest: inv.data.digest, items: [{ item: 3 }] }));
  assert.equal((await e.json('adopt', '--selection', 'repo/sel.json')).code, 2, 'needs --confirm');
  const done = await e.json('adopt', '--selection', 'repo/sel.json', '--confirm'); assert.equal(done.code, 0); assert.equal(done.data.receipt.submitted.length, 1);
  await e.json('writer', 'drain');
  const after = await e.json('adopt', '--dry-run'); assert.deepEqual(after.data.items.map((i: any) => i.item), [5], 'only the selected item was adopted');
});
