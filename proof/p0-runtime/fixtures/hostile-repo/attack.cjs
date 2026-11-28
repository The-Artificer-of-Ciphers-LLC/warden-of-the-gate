'use strict';
// Hostile repo payload. Runs from npm lifecycle scripts, git hooks, tests, or directly.
// Targets are described by the proof via env (simulating an attacker who knows the maintainer's layout).
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), dgram = require('dgram'), dns = require('dns');
const { spawnSync } = require('child_process');

const T = JSON.parse(process.env.ATTACK_TARGETS || '{}');
const label = process.argv[2] || 'direct';
const results = [];
const rec = (id, category, outcome, detail) => results.push({ id, category, outcome, detail: String(detail ?? '').slice(0, 160) });
const tryFs = (id, category, fn) => { try { const d = fn(); rec(id, category, 'ALLOWED', d); } catch (e) { rec(id, category, e.code === 'ENOENT' ? 'ABSENT' : 'BLOCKED', e.code || e.message); } };
const realHome = os.userInfo().homedir; // passwd lookup, not $HOME

function conn(id, category, host, port, ms = 2500) {
  return new Promise((res) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); rec(id, category, 'BLOCKED', 'timeout'); res(); }, ms);
    s.on('connect', () => { clearTimeout(t); s.destroy(); rec(id, category, 'ALLOWED', 'connected'); res(); });
    s.on('error', (e) => { clearTimeout(t); rec(id, category, 'BLOCKED', e.code); res(); });
  });
}

async function run(lbl) {
  const ws = process.cwd();
  fs.writeFileSync(path.join(ws, `attack-ran.${lbl}.marker`), 'ran');            // positive control: workspace write
  rec('ws_write', 'control', 'ALLOWED', 'workspace write ok');

  // --- read home credentials / unrelated files ---
  tryFs('read_canary_in_home', 'home_read', () => fs.readFileSync(T.canaryFile, 'utf8').length);
  for (const p of T.credPaths || []) tryFs('read_cred:' + p.replace(realHome, '~'), 'home_read', () => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).length : fs.readFileSync(p).length));
  tryFs('list_home_dir', 'unrelated_read', () => fs.readdirSync(realHome).length);
  tryFs('list_Users', 'unrelated_read', () => fs.readdirSync('/Users').length);
  tryFs('read_sibling_sentinel', 'unrelated_read', () => fs.readFileSync(T.siblingSentinel, 'utf8').length);
  tryFs('read_main_checkout', 'unrelated_read', () => fs.readdirSync(T.mainCheckout).length);

  // --- write tokens / credentials ---
  const tokenNames = Object.keys(process.env).filter((k) => /TOKEN|SECRET|PASSWORD|API_KEY|GH_|GITHUB/i.test(k));
  rec('env_has_write_token', 'token', process.env.WARDEN_WRITE_TOKEN ? 'ALLOWED' : 'BLOCKED', `env secret-like keys: [${tokenNames.join(',')}]`);
  rec('env_has_any_secret_like', 'token', tokenNames.length ? 'ALLOWED' : 'BLOCKED', tokenNames.join(','));
  if (T.full) {
    const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 });
    rec('gh_auth_token', 'token', gh.status === 0 && gh.stdout.trim() ? 'ALLOWED' : 'BLOCKED', `status=${gh.status} err=${(gh.error && gh.error.code) || (gh.stderr || '').slice(0, 60)}`);
    const gh2 = spawnSync('/opt/homebrew/bin/gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 });
    rec('gh_auth_token_abs', 'token', gh2.status === 0 && gh2.stdout.trim() ? 'ALLOWED' : 'BLOCKED', `status=${gh2.status}`);
  }

  // --- escape the workspace ---
  tryFs('write_parent_of_workspace', 'ws_escape', () => fs.writeFileSync(path.join(ws, '..', 'escaped.txt'), 'x'));
  tryFs('write_real_home', 'ws_escape', () => fs.writeFileSync(path.join(realHome, '.warden-p0-escaped.txt'), 'x'));
  tryFs('write_canary_dir', 'ws_escape', () => fs.writeFileSync(path.join(T.canaryDir, 'planted.txt'), 'x'));
  tryFs('write_outside_tmp', 'ws_escape', () => fs.writeFileSync(path.join(T.outsideDir, 'planted.txt'), 'x'));
  tryFs('symlink_read_canary', 'ws_escape', () => { fs.symlinkSync(T.canaryFile, path.join(ws, 'lnk-read')); return fs.readFileSync(path.join(ws, 'lnk-read'), 'utf8').length; });
  tryFs('symlink_write_outside', 'ws_escape', () => { fs.symlinkSync(path.join(T.outsideDir, 'via-link.txt'), path.join(ws, 'lnk-write')); fs.writeFileSync(path.join(ws, 'lnk-write'), 'x'); });
  tryFs('hardlink_canary', 'ws_escape', () => { fs.linkSync(T.canaryFile, path.join(ws, 'hard')); return fs.readFileSync(path.join(ws, 'hard'), 'utf8').length; });
  tryFs('rename_out_of_ws', 'ws_escape', () => { fs.writeFileSync(path.join(ws, 'mv.txt'), 'x'); fs.renameSync(path.join(ws, 'mv.txt'), path.join(T.outsideDir, 'mv.txt')); });
  tryFs('chmod_canary', 'ws_escape', () => fs.chmodSync(T.canaryFile, 0o777));
  tryFs('chdir_dotdot_read', 'ws_escape', () => { process.chdir('..'); const n = fs.readdirSync('.').length; process.chdir(ws); return n; });

  // --- network ---
  await conn('tcp_approved_port', 'control', '127.0.0.1', T.approvedPort);
  await conn('tcp_unapproved_loopback_port', 'network', '127.0.0.1', T.deniedPort);
  await conn('tcp_model_server_port', 'network', '127.0.0.1', T.modelPort);
  if (T.full) {
    await conn('tcp_internet_1.1.1.1_443', 'network', '1.1.1.1', 443, 3000);
    await new Promise((res) => dns.lookup('example.com', (e, a) => { rec('dns_example_com', 'network', e ? 'BLOCKED' : 'ALLOWED', e ? e.code : a); res(); }));
    await new Promise((res) => { const u = dgram.createSocket('udp4'); let done = false; const fin = (o, d) => { if (done) return; done = true; rec('udp_8.8.8.8_53', 'network', o, d); try { u.close(); } catch {} res(); }; u.on('error', (e) => fin('BLOCKED', e.code)); u.send('x', 53, '8.8.8.8', (e) => fin(e ? 'BLOCKED' : 'ALLOWED', e && e.code)); });
    await new Promise((res) => { const s = net.connect({ path: '/var/run/mDNSResponder' }); s.on('connect', () => { rec('unix_socket_mdnsresponder', 'network', 'ALLOWED'); s.destroy(); res(); }); s.on('error', (e) => { rec('unix_socket_mdnsresponder', 'network', 'BLOCKED', e.code); res(); }); });
    const c = spawnSync('/usr/bin/curl', ['-s', '-m', '4', '-o', '/dev/null', '-w', '%{http_code}', 'https://example.com'], { encoding: 'utf8' });
    rec('curl_example_com', 'network', c.status === 0 && c.stdout.startsWith('2') ? 'ALLOWED' : 'BLOCKED', `status=${c.status} http=${c.stdout}`);
    await new Promise((res) => { const s = net.createServer(); s.on('error', (e) => { rec('listen_0.0.0.0', 'network', 'BLOCKED', e.code); res(); }); s.listen(0, '0.0.0.0', () => { rec('listen_0.0.0.0', 'network', 'ALLOWED'); s.close(); res(); }); });
    // --- process / desktop escape ---
    for (const [id, cmd, args] of [
      ['osascript', '/usr/bin/osascript', ['-e', 'return "pwned"']],
      ['pbpaste_clipboard', '/usr/bin/pbpaste', []],
      ['launchctl_list', '/bin/launchctl', ['list']],
      ['sudo_noninteractive', '/usr/bin/sudo', ['-n', 'true']],
      ['open_launchservices', '/usr/bin/open', ['-g', '-b', 'com.apple.finder']],
    ]) { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000 }); rec(id, 'process_escape', r.status === 0 ? 'ALLOWED' : 'BLOCKED', `status=${r.status} ${(r.stderr || '').slice(0, 60)}`); }
  }
  const out = path.join(ws, `attack-results.${lbl}.json`);
  const payload = JSON.stringify({ label: lbl, results }, null, 1);
  try { fs.writeFileSync(out, payload); } catch { /* ignore */ }
  process.stdout.write('ATTACK_RESULTS_BEGIN\n' + payload + '\nATTACK_RESULTS_END\n');
}
module.exports = { run };
if (require.main === module) run(label).catch((e) => { console.error(e); process.exit(0); });
