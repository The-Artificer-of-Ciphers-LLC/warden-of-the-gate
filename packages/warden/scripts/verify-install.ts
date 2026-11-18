import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** P6: pack the release candidate, inspect the tarball, install it into an empty project and drive the INSTALLED executable (not the source tree) through
 *  all eight task names plus setup, config validation, status, stop/resume, adoption, data controls and the upgrade dry-run, against the simulated GitHub.
 *  Offline apart from npm resolving the two runtime dependencies. Publishes nothing. */
const pkgDir = new URL('..', import.meta.url).pathname; const work = mkdtempSync(join(tmpdir(), 'warden-install-'));
const results: Array<{ step: string; ok: boolean; detail?: string }> = []; const step = (s: string, ok: boolean, detail?: string) => { results.push({ step: s, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${s}${detail ? ' - ' + detail : ''}`); };
try {
  const packOut = execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: pkgDir, encoding: 'utf8' });
  const info = JSON.parse(packOut)[0] as { filename: string; files: Array<{ path: string }>; name: string; version: string };
  step('packed', true, `${info.name}@${info.version}, ${info.files.length} files`);
  const names = info.files.map((f) => f.path);
  for (const need of ['dist/cli.js', 'schemas/warden.v1.schema.json', 'schemas/orders.v1.schema.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json']) assert.ok(names.includes(need), `missing ${need}`);
  const forbidden = names.filter((n) => /(^|\/)(test|evidence|scripts|node_modules)\//.test(n) || /\.(pem|key|html)$/.test(n) || /transcript/i.test(n) || n.endsWith('.test.js'));
  step('tarball has the needed files and none of the forbidden ones', forbidden.length === 0, forbidden.join(', ') || undefined);
  const x = join(work, 'x'); mkdirSync(x); execFileSync('tar', ['-xzf', join(work, info.filename), '-C', x]);
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
  const leaks = walk(x).filter((f) => { const t = readFileSync(f, 'utf8'); return /\/Users\/[a-z]/i.test(t) || /ghp_[A-Za-z0-9]{20,}/.test(t) || /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(t); });
  step('no home paths, tokens or private keys inside the tarball', leaks.length === 0, leaks.map((f) => f.slice(x.length)).join(', ') || undefined);
  const proj = join(work, 'proj'); mkdirSync(proj); writeFileSync(join(proj, 'package.json'), '{"name":"consumer","private":true}');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', join(work, info.filename)], { cwd: proj, stdio: 'pipe' });
  const bin = join(proj, 'node_modules/.bin/warden'); step('installed into an empty project', true);
  const repo = join(work, 'repo'); mkdirSync(repo); const world = join(work, 'world.json'); const home = join(work, 'home');
  const run = (args: string[], want: number | number[], label = args.join(' ')) => {
    const r = spawnSync(bin, [...args, '--repo-dir', repo, '--home', home, '--backend', `sim:${world}`, '--json'], { encoding: 'utf8', cwd: work, env: { PATH: process.env.PATH ?? '', HOME: work } });
    const ok = (Array.isArray(want) ? want : [want]).includes(r.status ?? -1); step(`warden ${label} (exit ${r.status})`, ok, ok ? undefined : (r.stdout + r.stderr).slice(0, 200)); return { code: r.status, out: r.stdout };
  };
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8' }); step('--version from the installed executable', version.stdout.trim() === info.version, version.stdout.trim());
  const help = spawnSync(bin, ['--help'], { encoding: 'utf8' }).stdout; step('help lists every command family', ['setup', 'config validate', 'run --task', 'status', 'stop', 'adopt', 'data', 'upgrade', 'writer drain'].every((c) => help.includes(c)));
  execFileSync(bin, ['sim', 'init', '--world', world], { encoding: 'utf8' }); execFileSync(bin, ['sim', 'issue', '--title', 'Saving crashes the app', '--body', 'Steps: open, save, crash.', '--world', world]);
  run(['setup', '--create-config', '--repo', 'acme/widgets', '--maintainers', 'maint1,maint2', '--create-orders', '--approve-ceiling', '--create-labels'], 0);
  run(['config', 'validate'], 0); run(['status'], 0);
  for (const [t, extra, want] of [['intake', [], 0], ['triage', ['--item', '3'], 0], ['claim', [], 3], ['implement', [], 3], ['review', [], 0], ['rework', [], 3], ['sweep', [], 0], ['retro', [], 3]] as const) run(['run', '--task', t, '--dry-run', ...extra], want, `run --task ${t} --dry-run`);
  run(['adopt', '--dry-run'], 0); run(['data', 'status'], 0); run(['upgrade', '--dry-run'], 0);
  run(['stop', '--reason', 'install verification', '--as', 'maint1'], 0); run(['resume', '--confirm', '--as', 'maint1'], 0);
  assert.ok(results.every((r) => r.ok), 'one or more steps failed');
} catch (e) { step('verification aborted', false, String((e as Error).message).slice(0, 300)); }
finally { rmSync(work, { recursive: true, force: true }); }
console.log(JSON.stringify({ pass: results.every((r) => r.ok), steps: results.length, failed: results.filter((r) => !r.ok).map((r) => r.step) }));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
