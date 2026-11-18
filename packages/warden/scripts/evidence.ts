// Reproducible P1 acceptance transcript against the SIMULATED backend (no network, no credentials).
// Usage: node scripts/evidence.ts  -> writes evidence/acceptance-transcript.md
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.ts';
import { CLI_VERSION } from '../src/version.ts';

const dir = mkdtempSync(join(tmpdir(), 'warden-evidence-')); const repo = join(dir, 'repo'); const home = join(dir, 'home'); const world = join(dir, 'world.json'); mkdirSync(repo);
const clock = { now: Date.now() }; const env: Record<string, string> = {};
let md = `# P1 acceptance transcript\n\nwarden ${CLI_VERSION}, node ${process.version}, backend: **simulated GitHub** (\`sim:\`), generated ${new Date().toISOString()}.\nThis is NOT a live GitHub result. Separate production CLI/App/Actions acceptance evidence and remaining trust-root/scheduled-execution gates are linked from the README.\n`;
const common = ['--repo-dir', repo, '--home', home, '--backend', `sim:${world}`];
async function step(title: string, argv: string[], extra: string[] = common) {
  let out = ''; const code = await main([...argv, ...extra], { cwd: dir, env: env as NodeJS.ProcessEnv, out: (s) => (out += s + '\n'), err: (s) => (out += s + '\n'), now: () => clock.now });
  md += `\n## ${title}\n\n\`\`\`\n$ warden ${argv.join(' ')}\n${out.trimEnd().replaceAll(dir, '<tmp>')}\n[exit ${code}]\n\`\`\`\n`; return { code, out };
}
const sim = (title: string, argv: string[]) => step(title, ['sim', ...argv], ['--world', world]);

await sim('Disposable simulated world (inbox #1, control #2)', ['init']);
await step('setup: report only (nothing approved)', ['setup']);
await step('setup: approved starters, ceiling, labels', ['setup', '--create-config', '--repo', 'acme/widgets', '--maintainers', 'maint1,maint2', '--create-orders', '--approve-ceiling', '--create-labels']);
await step('config validate', ['config', 'validate']);
await sim('seed a bug issue, a feature issue and a PR', ['issue', '--title', 'Crash on save', '--body', 'Steps to reproduce: open, save.']);
await sim('seed PR', ['issue', '--title', 'Fix save crash', '--pr', '--as', 'dev1']);
await step('run --task intake --dry-run (no mutation)', ['run', '--task', 'intake', '--dry-run']);
await step('run --task review --dry-run (explicitly unsupported)', ['run', '--task', 'review', '--dry-run']);
await step('approvals request (merge, bound to revision/policy/evidence)', ['approvals', 'request', '--item', '4', '--item-kind', 'pr', '--action', 'merge', '--revision', 'rev1', '--evidence-digest', 'e1', '--subject-author', 'dev1', '--drain']);
await step('approvals list', ['approvals', 'list', '--item', '4']);
await step('status', ['status']);
await step('stop (local first, then shared, confirmed)', ['stop', '--reason', 'evidence drill', '--as', 'maint1']);
await step('run while stopped (blocked)', ['run', '--task', 'intake', '--dry-run']);
await step('writer drain while stopped (halts before any effect, acknowledges)', ['writer', 'drain']);
await step('status while stopped', ['status']);
await step('resume without confirmation (refused)', ['resume']);
await step('resume --confirm', ['resume', '--confirm', '--as', 'maint1']);
env.WARDEN_SIM_DOWN = '1';
await step('stop while GitHub unreachable (UNCONFIRMED, not global success)', ['stop']);
await step('status while GitHub unreachable', ['status']);
delete env.WARDEN_SIM_DOWN;
writeFileSync(join(process.cwd(), 'evidence', 'acceptance-transcript.md'), md);
console.log('wrote evidence/acceptance-transcript.md');
