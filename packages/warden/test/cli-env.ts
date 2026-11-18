import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.ts';

export interface Env { dir: string; repo: string; home: string; world: string; clock: { now: number }; run: (...a: string[]) => Promise<{ code: number; out: string; err: string }>; json: (...a: string[]) => Promise<{ code: number; data: any; out: string }>; sim: (...a: string[]) => Promise<{ code: number; out: string }>; worldJson: () => any; write: (rel: string, s: string) => void; read: (rel: string) => string; envVars: Record<string, string> }
export async function cliEnv(opts: { configure?: boolean; maintainers?: string } = {}): Promise<Env> {
  const dir = mkdtempSync(join(tmpdir(), 'warden-e2e-')); const repo = join(dir, 'repo'); const home = join(dir, 'home'); const world = join(dir, 'world.json');
  mkdirSync(repo, { recursive: true });
  const clock = { now: Date.now() };
  const envVars: Record<string, string> = {};
  const base = (a: string[]) => [...a, '--repo-dir', repo, '--home', home, '--backend', `sim:${world}`];
  const run = async (...a: string[]) => { let out = ''; let err = ''; const code = await main(base(a), { cwd: dir, env: { ...envVars } as NodeJS.ProcessEnv, out: (s) => (out += s + '\n'), err: (s) => (err += s + '\n'), now: () => clock.now }); return { code, out, err }; };
  const json = async (...a: string[]) => { const r = await run(...a, '--json'); let data: any = null; try { data = JSON.parse(r.out); } catch { /* text */ } return { code: r.code, data, out: r.out + r.err }; };
  const sim = async (...a: string[]) => { let out = ''; const code = await main([...a, '--world', world], { cwd: dir, env: {} as NodeJS.ProcessEnv, out: (s) => (out += s + '\n'), err: (s) => (out += s + '\n') }); return { code, out }; };
  const e: Env = { dir, repo, home, world, clock, run, json, sim, worldJson: () => JSON.parse(readFileSync(world, 'utf8')), write: (rel, s) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), s); }, read: (rel) => readFileSync(join(repo, rel), 'utf8'), envVars };
  await sim('sim', 'init');
  if (opts.configure !== false) {
    await run('setup', '--create-config', '--repo', 'acme/widgets', '--maintainers', opts.maintainers ?? 'maint1,maint2', '--create-orders', '--approve-ceiling', '--create-labels');
  }
  return e;
}
