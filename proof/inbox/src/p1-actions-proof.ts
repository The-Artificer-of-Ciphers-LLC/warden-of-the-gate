import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../packages/warden/src/cli.ts';

const repo = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox';
assert.equal(process.env.GITHUB_REPOSITORY, repo);
const root = mkdtempSync(join(tmpdir(), 'warden-p1-actions-'));
const repoDir = join(root, 'repo'); const home = join(root, 'home');
mkdirSync(join(repoDir, '.github'), { recursive: true });
function number(name: string) { const n = Number(process.env[name]); assert.ok(Number.isSafeInteger(n) && n > 0); return n; }
const cfg = { schemaVersion: 1, repository: repo, maintainers: ['trek-e'], mode: 'shadow',
  inbox: { inboxIssue: number('INBOX'), controlIssue: number('CONTROL'), globalControl: { repository: 'The-Artificer-of-Ciphers-LLC/warden-p0-control', issue: number('GLOBAL') } } };
writeFileSync(join(repoDir, '.github/warden.yml'), JSON.stringify(cfg));
async function cli(args: string[], expected = 0) {
  let out = ''; let err = '';
  const code = await main([...args, '--repo-dir', repoDir, '--home', home, '--backend', 'github', '--submit-auth', 'actions-secret', '--control-auth', 'actions-secret', '--writer-auth', 'actions', '--json'],
    { out: (s) => { out += s; }, err: (s) => { err += s; } });
  assert.equal(code, expected, `${args[0]}: ${err || out}`);
  return JSON.parse(out);
}
try {
  await cli(['setup', '--approve-ceiling'], 1);
  await cli(['credentials', 'configure', '--app-id', '5819526', '--installation-id', '183378787', '--app-login', 'warden-p0-sandbox-app[bot]', '--confirm', '--approve-control-read']);
  const expected = process.env.EXPECTED;
  assert.ok(['drain', 'stopped', 'unknown', 'tamper'].includes(expected ?? ''));
  const result = await cli(['writer', 'drain'], expected === 'drain' ? 0 : 5);
  if (expected === 'drain') {
    assert.ok(result.processed.length > 0);
    assert.ok(result.processed.every((p: { result: string }) => ['applied', 'rejected', 'duplicate', 'quarantined'].includes(p.result)));
    assert.equal(result.halted, undefined);
  } else {
    assert.equal(result.halted, expected === 'tamper' ? 'anomaly' : 'stop');
    assert.equal(result.processed.length, 0);
    if (expected === 'unknown') assert.match(result.haltReason, /unknown|unreadable|unreachable/i);
    if (expected === 'tamper') assert.match(result.haltReason, /integrity|non-writer|ledger/i);
  }
  console.log('P1_PROOF_RESULT ' + JSON.stringify({ expected, ...result }));
} finally { rmSync(root, { recursive: true, force: true }); }
