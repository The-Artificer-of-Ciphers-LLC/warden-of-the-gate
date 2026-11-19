// LIVE Implement evidence (local only): the real pinned OpenCode + the local LM Studio model inside Seatbelt, a REAL git fixture repository, the REAL
// trusted executor, the simulated GitHub, and the LOCAL outbox. Nothing here touches GitHub or any network beyond loopback.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliEnv } from '../../packages/warden/test/cli-env.ts';
import { newLedger } from '../../packages/warden/src/state/model.ts';
import { encodeLedger } from '../../packages/warden/src/writer/protocol.ts';
import { FakeWorld } from '../../packages/warden/src/github/fake.ts';
import { openSim } from '../../packages/warden/src/github/filesim.ts';
import { loadWarden, loadOrders } from '../../packages/warden/src/config/load.ts';
import { buildPolicy } from '../../packages/warden/src/config/snapshot.ts';

const out = new URL('./results/live-implement-2026-11-18.json', import.meta.url);
console.error('step: cliEnv');const e = await cliEnv();e.envVars.PATH = process.env.PATH ?? ''; e.envVars.HOME = process.env.HOME ?? ''; e.envVars.TMPDIR = process.env.TMPDIR ?? '/tmp'; setTimeout(() => { console.error('watchdog: 25 min, giving up'); process.exit(9); }, 25 * 60_000).unref();setInterval(() => { e.clock.now += 1000; }, 1000).unref();console.error('step: env ready');
const src = join(tmpdir(), `warden-live-src-${process.pid}`); mkdirSync(join(src, 'test'), { recursive: true });
const g = (...a: string[]) => spawnSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
spawnSync('git', ['init', '-q', '-b', 'main', src]);
writeFileSync(join(src, 'sum.js'), 'exports.sumTo = (n) => { let t = 0; for (let i = 1; i < n; i++) t += i; return t; };\n');
writeFileSync(join(src, 'test/sum.test.js'), "const { test } = require('node:test'); const assert = require('node:assert'); const { sumTo } = require('../sum.js'); test('sumTo(1)', () => assert.strictEqual(sumTo(1), 1));\n");
g('add', '.'); g('commit', '-qm', 'init'); const base = g('rev-parse', 'HEAD').stdout.trim();
const cfgPath = '.github/warden.yml'; let y = e.read(cfgPath);
y += `\nruntime:\n  modelPool: [warden-proof-qwen]\nmerge:\n  factoryLogins: [warden-factory]\nverify:\n  checks:\n    - {id: unit, kind: test, command: ${process.execPath}, args: ["--test", "test/"]}\n`; e.write(cfgPath, y);
const res: Record<string, unknown> = { base, started: new Date().toISOString() };
console.error('step: config');const cfg = await e.json('config', 'validate'); res.configValid = cfg.code;
// a tracked, ready issue describing the bug (state seeded directly: the live subject here is Implement, not the writer)
const wc = loadWarden(e.repo); const oc = loadOrders(e.repo); const pol = buildPolicy(wc.value!, oc.present ? oc.value! : null);
const w = openSim(e.world, 'warden-writer'); const n = await w.store.createIssue('sumTo(n) skips n', 'sumTo(3) returns 3 but should return 6 (1+2+3). The loop bound excludes n.');
const led: any = { ...newLedger('acme/widgets', n, 'issue'), state: 'claimed' as const, owner: { id: 'warden-factory', kind: 'factory', opid: 'op_seed' }, facets: { workKind: 'bug', risk: 'low' }, approvals: { apr_live: { id: 'apr_live', type: 'action', action: 'implement', binding: { revision: 'r', policyDigest: pol.digest, evidenceDigest: '' }, bindingDigest: 'live', requestedBy: 'warden', requestedAt: '2026-11-18T00:00:00Z', expiresAt: null, status: 'approved', decidedBy: 'maint1', decidedAt: '2026-11-18T00:01:00Z' } } };
await w.store.createComment(n, encodeLedger(led as never));
console.error('step: dry-run');res.plan = (await e.json('run', '--task', 'implement', '--item', String(n), '--dry-run', '--source', src, '--base-sha', base)).data;
console.error('step: LIVE');const t0 = Date.now(); const live = await e.json('run', '--task', 'implement', '--item', String(n), '--runner', 'opencode', '--drain', '--source', src, '--base-sha', base);
res.live = { code: live.code, outcome: live.data?.outcome, notice: live.data?.notice, reason: live.data?.reason, runner: live.data?.runner, ms: Date.now() - t0, raw: live.data };
void FakeWorld; void existsSync; void readFileSync;
writeFileSync(out, JSON.stringify(res, null, 2)); console.log(JSON.stringify({ plan: (res.plan as { plan?: unknown })?.plan ?? res.plan, live: (res.live as { outcome?: string; notice?: string; reason?: string; code?: number }) }, null, 1).slice(0, 3000));
