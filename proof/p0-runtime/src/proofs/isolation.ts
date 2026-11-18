// PROOF-runtime (f): real OS isolation boundary on Mac (Seatbelt via sandbox-exec).
// Run: node src/proofs/isolation.ts   -> results/isolation.json   (exit 1 on any required failure)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { check, finish, newReport, PROOF_ROOT, sh } from '../lib/report.ts';
import {
  buildProfile, containmentSelfTest, defaultBackend, realpath, runContained, runGuarded, ContainmentUnavailableError,
  type Backend, type ContainmentSpec, type RunResult,
} from '../lib/seatbelt.ts';

const FIXTURE = path.join(PROOF_ROOT, 'fixtures', 'hostile-repo');
const CANARY_TOKEN = 'CANARY-WRITE-TOKEN-' + Math.random().toString(36).slice(2);

interface Attempt { id: string; category: string; outcome: 'ALLOWED' | 'BLOCKED' | 'ABSENT'; detail: string }

function parseAttack(stdout: string): Attempt[] {
  const m = stdout.match(/ATTACK_RESULTS_BEGIN\n([\s\S]*?)\nATTACK_RESULTS_END/g);
  if (!m) return [];
  return m.flatMap((blk) => JSON.parse(blk.replace(/ATTACK_RESULTS_(BEGIN|END)\n?/g, '')).results as Attempt[]);
}
function readAttackFiles(ws: string): Attempt[] {
  return readdirSync(ws).filter((f) => f.startsWith('attack-results.')).flatMap((f) => JSON.parse(readFileSync(path.join(ws, f), 'utf8')).results as Attempt[]);
}

function listen(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((s) => s.destroy());
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
  });
}

const home = realpath(os.homedir());
const CRED_CANDIDATES = [
  '.ssh', '.ssh/id_ed25519', '.ssh/id_rsa', '.config/gh/hosts.yml', '.config/gh', '.aws/credentials', '.netrc', '.npmrc',
  '.gitconfig', '.lmstudio/credentials', '.config/opencode', '.claude', '.claude.json', 'Library/Keychains', '.zsh_history', '.docker',
].map((p) => path.join(home, p)).filter((p) => existsSync(p));

async function main() {
  const report = newReport('PROOF-runtime', 'isolation', {
    mechanism: 'macOS Seatbelt via /usr/bin/sandbox-exec, deny-default profile, rebuilt env, per-run scratch HOME',
    fixture: path.relative(PROOF_ROOT, FIXTURE),
    credentialTargetsPresentOnThisMac: CRED_CANDIDATES.map((p) => p.replace(home, '~')),
    note: 'attack payload reads/writes only canaries and records errno; real credential files are never read by the harness itself',
  });
  report.versions = {
    sandboxExec: sh('/usr/bin/sandbox-exec', ['-n', 'no-such-profile']).includes('deprecated') ? 'present' : 'present (deprecated by Apple per man page)',
    macOS: report.host.os,
    node: process.version,
    npm: sh('npm', ['--version']),
    git: sh('git', ['--version']),
    docker: sh('docker', ['--version']) + ' / ' + (sh('docker', ['info', '--format', '{{.ServerVersion}}']).startsWith('unavailable') ? 'daemon NOT running' : 'daemon running'),
    appleContainerCli: existsSync('/usr/local/bin/container') || existsSync('/opt/homebrew/bin/container') ? 'present' : 'not installed',
  };

  const base = mkdtempSync(path.join(realpath(os.tmpdir()), 'warden-iso-'));
  const outsideDir = path.join(base, 'outside');            // "unrelated" dir outside the workspace
  const siblingDir = path.join(base, 'sibling-workspace');  // another workspace; must be unreadable
  mkdirSync(outsideDir); mkdirSync(siblingDir);
  writeFileSync(path.join(siblingDir, 'other-repo-secret.txt'), 'SIBLING-SECRET');
  const canaryDir = path.join(home, `.warden-p0-canary-${process.pid}`);
  mkdirSync(canaryDir);
  const canaryFile = path.join(canaryDir, 'credentials');
  writeFileSync(canaryFile, 'HOME-CREDENTIAL-CANARY');
  const lm = 1235; // real local LM Studio server port on this Mac
  const approved = await listen();
  const denied = await listen();
  process.env.WARDEN_WRITE_TOKEN = CANARY_TOKEN; // present in the maintainer env; must never reach contained code

  const mainCheckout = realpath(path.resolve(PROOF_ROOT, '..', '..', '..', '..', '..')); // unrelated checkout on disk
  const targets = (full: boolean) => ({
    full, canaryFile, canaryDir, outsideDir, siblingSentinel: path.join(siblingDir, 'other-repo-secret.txt'), mainCheckout,
    credPaths: CRED_CANDIDATES, approvedPort: approved.port, deniedPort: denied.port, lmstudioPort: lm,
  });
  const devDir = sh('xcode-select', ['-p']);
  const mkWs = (name: string) => {
    const ws = path.join(base, name, 'ws'); const scratch = path.join(base, name, 'scratch');
    mkdirSync(scratch, { recursive: true }); cpSync(FIXTURE, ws, { recursive: true });
    return { ws, scratch };
  };
  const specFor = (ws: string, scratch: string): ContainmentSpec => ({
    workspace: ws, workspaceWritable: true, scratch, allowTcp: [{ port: approved.port }],
    readonlyPaths: ['/opt/homebrew/bin', ...(existsSync(devDir) ? [devDir] : []), '/Library/Developer'].filter(existsSync),
    env: { ATTACK_TARGETS: JSON.stringify(targets(true)), PATH: [path.join(devDir, 'usr/bin'), '/opt/homebrew/bin', path.dirname(realpath(process.execPath)), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@example.invalid', GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@example.invalid' },
  });

  try {
    // ---------- 0. boundary self-test (canaries) ----------
    const st = await containmentSelfTest();
    check(report, { id: 'F0-selftest', claim: 'containment self-test (canary read/write/net probes) passes before any repo code runs', expected: 'ok=true', observed: st, pass: st.ok });

    // ---------- 1. control: same payload UNCONTAINED proves the attack vectors are real ----------
    {
      const { ws } = mkWs('control');
      const r = spawnSync(process.execPath, ['attack.cjs', 'uncontained'], {
        cwd: ws, encoding: 'utf8', env: { ...process.env, ATTACK_TARGETS: JSON.stringify(targets(false)) }, timeout: 60000,
      });
      const att = parseAttack(r.stdout);
      const need = ['read_canary_in_home', 'list_home_dir', 'read_sibling_sentinel', 'env_has_write_token', 'write_parent_of_workspace', 'write_canary_dir', 'write_outside_tmp', 'symlink_read_canary', 'tcp_unapproved_loopback_port', 'tcp_lmstudio_port'];
      const allowed = need.filter((id) => att.find((a) => a.id === id)?.outcome === 'ALLOWED');
      check(report, { id: 'F1-control-uncontained', claim: 'positive control: with no boundary the same hostile payload reads the home canary, sees the write token, escapes the workspace and reaches unapproved loopback ports', expected: 'all control vectors ALLOWED', observed: { allowed, missing: need.filter((n) => !allowed.includes(n)) }, pass: allowed.length === need.length });
      report.inputs.uncontainedControlOutcomes = Object.fromEntries(att.map((a) => [a.id, a.outcome]));
      // clean control side effects
      rmSync(path.join(home, '.warden-p0-escaped.txt'), { force: true });
      rmSync(path.join(canaryDir, 'planted.txt'), { force: true });
      rmSync(path.join(outsideDir, 'planted.txt'), { force: true });
      rmSync(path.join(outsideDir, 'mv.txt'), { force: true });
      rmSync(path.join(outsideDir, 'via-link.txt'), { force: true });
    }

    // ---------- 2. contained vectors ----------
    const vectors: Array<{ name: string; run: (spec: ContainmentSpec, ws: string) => Promise<RunResult>; setup?: (ws: string) => void }> = [
      { name: 'direct-node', run: (s) => runGuarded(s, process.execPath, ['attack.cjs', 'direct'], { timeoutMs: 120000 }) },
      { name: 'npm-install-lifecycle', run: (s) => runGuarded(s, '/opt/homebrew/bin/npm', ['install', '--offline', '--no-audit', '--no-fund', '--foreground-scripts'], { timeoutMs: 180000 }) },
      { name: 'node-test-runner', run: (s) => runGuarded(s, process.execPath, ['--test', 'test/'], { timeoutMs: 120000 }) },
      {
        name: 'git-hook',
        setup: (ws) => {
          // Prepared OUTSIDE containment (maintainer side); the hook itself executes inside.
          const g = (...a: string[]) => execFileSync('git', a, { cwd: ws, stdio: 'ignore', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
          g('init', '-q'); g('config', 'core.hooksPath', 'hooks'); g('add', '-A');
        },
        run: (s) => runGuarded(s, path.join(devDir, 'usr/bin/git'), ['commit', '-q', '-m', 'hostile', '--allow-empty'], { timeoutMs: 120000 }),
      },
    ];
    const contained: Record<string, Attempt[]> = {};
    for (const v of vectors) {
      const { ws, scratch } = mkWs(v.name);
      v.setup?.(ws);
      const r = await v.run(specFor(ws, scratch), ws);
      const att = [...readAttackFiles(ws), ...parseAttack(r.stdout)];
      const uniq = new Map(att.map((a) => [`${a.category}/${a.id}`, a]));
      contained[v.name] = [...uniq.values()];
      const ran = readdirSync(ws).some((f) => f.startsWith('attack-ran.'));
      check(report, { id: `F2-${v.name}-ran`, claim: `${v.name}: hostile code really executed inside the boundary (workspace write succeeded, positive control)`, expected: 'attack marker present in workspace', observed: { ran, exit: r.code, stderrTail: r.stderr.slice(-200) }, pass: ran });
      const breaches = contained[v.name].filter((a) => a.category !== 'control' && a.outcome === 'ALLOWED');
      const absent = contained[v.name].filter((a) => a.outcome === 'ABSENT').map((a) => a.id);
      const cats = [...new Set(contained[v.name].map((a) => a.category))];
      check(report, { id: `F2-${v.name}-blocked`, claim: `${v.name}: zero breaches across ${contained[v.name].length} attempts (${cats.join(', ')})`, expected: 'no non-control attempt ALLOWED', observed: { breaches, attempts: contained[v.name].length, absentNotEvidence: absent }, pass: breaches.length === 0 && contained[v.name].length > 15 });
      const ctl = contained[v.name].filter((a) => a.category === 'control');
      check(report, { id: `F2-${v.name}-approved-net`, claim: `${v.name}: approved destination is reachable (boundary is selective, not just broken)`, expected: 'tcp_approved_port ALLOWED', observed: ctl, pass: ctl.find((a) => a.id === 'tcp_approved_port')?.outcome === 'ALLOWED' });
      // side effects on the host must not exist
      const leaked = [path.join(home, '.warden-p0-escaped.txt'), path.join(base, v.name, 'escaped.txt'), path.join(canaryDir, 'planted.txt'), path.join(outsideDir, 'planted.txt'), path.join(outsideDir, 'mv.txt'), path.join(outsideDir, 'via-link.txt')].filter(existsSync);
      check(report, { id: `F2-${v.name}-host-effects`, claim: `${v.name}: no files were created outside the workspace on the host`, expected: 'none', observed: leaked, pass: leaked.length === 0 });
    }
    report.inputs.containedOutcomes = Object.fromEntries(Object.entries(contained).map(([k, v]) => [k, Object.fromEntries(v.map((a) => [a.id, a.outcome + (a.detail ? ` (${a.detail.slice(0, 40)})` : '')]))]));
    check(report, { id: 'F2-canary-intact', claim: 'home canary content and mode unchanged after all contained runs', expected: 'content intact', observed: readFileSync(canaryFile, 'utf8'), pass: readFileSync(canaryFile, 'utf8') === 'HOME-CREDENTIAL-CANARY' });

    // ---------- 3. unknown containment blocks execution ----------
    const { ws: gws, scratch: gscratch } = mkWs('guard');
    const gspec = specFor(gws, gscratch);
    const base0 = defaultBackend();
    const broken: Array<[string, Backend]> = [
      ['sandbox-exec missing', { ...base0, sandboxExec: '/nonexistent/sandbox-exec' }],
      ['permissive profile (allow default)', { ...base0, profile: () => '(version 1)\n(allow default)\n' }],
      ['unsupported macOS major', { ...base0, testedMajors: [13] }],
      ['network not enforced', { ...base0, profile: (s) => buildProfile(s).replace('(deny network*)', '(allow network*)') }],
      ['home readable', { ...base0, profile: (s) => buildProfile(s) + `(allow file-read* (subpath ${JSON.stringify(home)}))\n` }],
    ];
    for (const [name, backend] of broken) {
      let blocked = false; let err = '';
      try { await runGuarded(gspec, process.execPath, ['attack.cjs', 'guard'], { backend, timeoutMs: 30000 }); } catch (e) { blocked = e instanceof ContainmentUnavailableError; err = (e as Error).message.slice(0, 200); }
      const ran = readdirSync(gws).some((f) => f.startsWith('attack-ran.guard'));
      check(report, { id: `F3-unknown-containment:${name}`, claim: `unknown/defective containment (${name}) blocks execution; repo code never ran`, expected: 'ContainmentUnavailableError and no marker', observed: { blocked, err, repoCodeRan: ran }, pass: blocked && !ran });
    }

    // ---------- 4. finite resource controls inside the boundary ----------
    {
      const { ws, scratch } = mkWs('limits'); const spec = specFor(ws, scratch);
      writeFileSync(path.join(ws, 'spin.cjs'), 'const {spawn}=require("child_process");spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});setInterval(()=>{},1000)');
      const r = await runGuarded(spec, process.execPath, ['spin.cjs'], { timeoutMs: 2000 });
      await new Promise((res) => setTimeout(res, 500));
      const left = sh('pgrep', ['-f', `${ws}/spin.cjs`]);
      const leftChildren = spawnSync('pgrep', ['-f', 'setInterval\\(\\(\\)=>\\{\\},1000\\)'], { encoding: 'utf8' }).stdout.trim();
      check(report, { id: 'F4-wall-timeout', claim: 'wall-clock limit kills contained process AND its children (process group); no orphans', expected: 'timedOut=true, no surviving pids', observed: { timedOut: r.timedOut, ms: r.durationMs, signal: r.signal, survivors: left.startsWith('unavailable') ? 'none' : left, childSurvivors: leftChildren || 'none' }, pass: r.timedOut && r.durationMs < 5000 && left.startsWith('unavailable') && !leftChildren });
      const cpu = await runGuarded(spec, '/bin/sh', ['-c', `ulimit -t 1; ${process.execPath} -e "for(;;){}"`], { timeoutMs: 15000 });
      check(report, { id: 'F4-cpu-limit', claim: 'ulimit -t (CPU seconds) terminates a busy loop inside the boundary', expected: 'killed by signal before wall timeout', observed: { code: cpu.code, signal: cpu.signal, timedOut: cpu.timedOut, ms: cpu.durationMs }, pass: !cpu.timedOut && cpu.durationMs < 10000 });
      const fsz = await runGuarded(spec, '/bin/sh', ['-c', `ulimit -f 8; ${process.execPath} -e "require('fs').writeFileSync('big.bin', Buffer.alloc(8*1024*1024))"`], { timeoutMs: 15000 });
      const size = existsSync(path.join(ws, 'big.bin')) ? readFileSync(path.join(ws, 'big.bin')).length : 0;
      check(report, { id: 'F4-file-size-limit', claim: 'ulimit -f caps file growth (writes beyond the cap fail)', expected: 'file < 8 MiB', observed: { size, code: fsz.code, signal: fsz.signal }, pass: size < 8 * 1024 * 1024 });
      const mem = await runGuarded(spec, '/bin/sh', ['-c', `ulimit -v 524288 2>&1; echo vlimit_rc=$?; ${process.execPath} -e "const a=[];try{for(let i=0;i<40;i++)a.push(Buffer.alloc(64*1024*1024,1));console.log('allocated-2.5GiB-no-limit')}catch(e){console.log('limited:'+e.message.slice(0,30))}" 2>&1 | tail -1`], { timeoutMs: 30000 });
      check(report, { id: 'F4-memory-limit-ulimit-v', claim: 'UNAVAILABLE GUARANTEE (informational): a per-process memory cap cannot be set on macOS (ulimit -v fails with EINVAL) - memory must be bounded by the model/context budget, the wall-clock kill and host-level monitoring instead', expected: 'informational: documents whether ulimit -v works', observed: mem.stdout.trim().split('\n').slice(-2), pass: true, severity: 'informational' });
    }
  } finally {
    approved.server.close(); denied.server.close();
    rmSync(canaryDir, { recursive: true, force: true });
    rmSync(path.join(home, '.warden-p0-escaped.txt'), { force: true });
    rmSync(base, { recursive: true, force: true });
    delete process.env.WARDEN_WRITE_TOKEN;
  }
  report.notes.push(
    'Boundary = Apple Seatbelt (sandbox-exec). Apple marks the CLI deprecated but the kernel sandbox is what App Sandbox, Chromium and many agent CLIs use; no replacement CLI exists for per-process deny-default profiles.',
    'Docker CLI is installed but no daemon/VM provider (no Docker Desktop/colima/lima/podman/Apple container). Container backend is therefore UNVERIFIED here and not selected.',
    'Seatbelt gives no memory cap (ulimit -v not enforced); CPU/file/wall-time/process-group limits are enforced and measured above.',
    'Contained code can read system dirs and toolchain (/usr, /System, Homebrew node). Treat those as public. Network is loopback-port allowlist only; DNS/mach lookups denied so names cannot resolve.',
    'macOS major versions outside the tested set are treated as unknown containment and block execution.',
  );
  finish(report, 'isolation.json');
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
