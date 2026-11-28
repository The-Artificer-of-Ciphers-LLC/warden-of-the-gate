#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './commands/common.ts';
import type { Ctx, Result } from './commands/common.ts';
import { CLI_VERSION, ORDERS_SCHEMA_VERSION, WARDEN_SCHEMA_VERSION } from './version.ts';
import { setup } from './commands/setup.ts';
import { configValidate } from './commands/config.ts';
import { run } from './commands/run.ts';
import { status } from './commands/status.ts';
import { resume, stop } from './commands/control.ts';
import { eventHandle, journalReconcile, writerDrain } from './commands/writer.ts';
import { approvals } from './commands/approvals.ts';
import { adopt } from './commands/adopt.ts';
import { data } from './commands/data.ts';
import { upgrade } from './commands/upgrade.ts';
import { replay } from './commands/replay.ts';
import { discord } from './commands/discord.ts';
import { credentials } from './commands/credentials.ts';
import { sim } from './commands/sim.ts';
import { redact } from './util.ts';
import { StorageError, InstanceMismatch } from './storage/instance.ts';
import { CredentialUnavailable } from './credentials/types.ts';

const HELP = `warden ${CLI_VERSION}  (warden.yml schema v${WARDEN_SCHEMA_VERSION}, ORDERS.yaml schema v${ORDERS_SCHEMA_VERSION})
  setup [--create-config --repo o/n --maintainers a,b] [--create-orders] [--create-labels] [--approve-ceiling]
  config validate [--show-effective]
  run --task <intake|triage|claim|implement|review|rework|sweep|retro> [--dry-run] [--item N]
  status [--json]
  stop [--global] [--reason text]          resume --confirm [--global]
  writer drain                              (the one serialized effect path; Actions entry point)
  journal reconcile                         (recover durable local submissions; never acts as the writer)
  event handle --event-path file            (Actions doorbell: /warden approve|deny|override comments)
  adopt --dry-run [--out FILE]              (inventory existing items; read-only)
  adopt --selection FILE --confirm          (adopt ONLY the selected items; never part of setup/run)
  data status | export --scope S --out FILE [--confirm] | purge --scope S [--older-than-days N] [--include-decisions] [--confirm]
  upgrade --dry-run                         (report changes; nothing is applied)
  discord sync --channel ID [--dry-run]     (post/edit approval cards; notifications only, decisions stay on GitHub)
  replay --set FILE [--runner opencode --context-limit N] [--validate-only]   (replay a curated set in a simulated repo; measures and reports, never activates)
  approvals request|list|check --item N ...
  credentials configure --confirm --app-id N --installation-id N --app-login LOGIN [--key-path FILE] [--approve-control-read] [--replace]
  credentials status | ack-revocation --confirm
common flags: --repo-dir DIR --trusted-ref REF --home DIR --backend github|sim:FILE --json
explicit live sources: --operator-auth gh | --writer-auth actions | --submit-auth actions-secret | --control-auth actions-secret
exit codes: 0 ok | 1 invalid/refused | 2 usage or unconfirmed | 3 unsupported task | 4 blocked | 5 writer halted`;

export async function main(argv: string[], io: { env?: NodeJS.ProcessEnv; cwd?: string; out?: (s: string) => void; err?: (s: string) => void; now?: () => number } = {}): Promise<number> {
  const out = io.out ?? ((s: string) => process.stdout.write(s + '\n')); const err = io.err ?? ((s: string) => process.stderr.write(s + '\n'));
  const { cmd, flags } = parseArgs(argv);
  const c: Ctx = { flags, env: io.env ?? process.env, cwd: io.cwd ?? process.cwd(), now: io.now ?? Date.now };
  if (flags.version || cmd[0] === 'version') { out(CLI_VERSION); return 0; }
  if (!cmd.length || flags.help || cmd[0] === 'help') { out(HELP); return cmd.length ? 0 : 2; }
  let r: Result;
  try {
    const [a, b] = cmd;
    if (a === 'setup') r = await setup(c);
    else if (a === 'config' && b === 'validate') r = await configValidate(c);
    else if (a === 'run') r = await run(c);
    else if (a === 'status') r = await status(c);
    else if (a === 'stop') r = await stop(c);
    else if (a === 'resume') r = await resume(c);
    else if (a === 'writer' && b === 'drain') r = await writerDrain(c);
    else if (a === 'journal' && b === 'reconcile') r = await journalReconcile(c);
    else if (a === 'event' && b === 'handle') r = await eventHandle(c);
    else if (a === 'adopt') r = await adopt(c);
    else if (a === 'data') r = await data(c, b ?? '');
    else if (a === 'upgrade') r = await upgrade(c);
    else if (a === 'replay') r = await replay(c);
    else if (a === 'discord') r = await discord(c, b ?? '');
    else if (a === 'approvals') r = await approvals(c, b ?? '');
    else if (a === 'credentials') r = await credentials(c, b ?? '');
    else if (a === 'sim') r = await sim(c, b ?? '');
    else { err(`unknown command: ${cmd.join(' ')}\n${HELP}`); return 2; }
  } catch (e) {
    if (e instanceof CredentialUnavailable) { err(`credential unavailable (${e.state}): ${e.message}`); return 4; }
    if (e instanceof StorageError || e instanceof InstanceMismatch) { err(redact(e.message)); return 1; }
    err('error: ' + redact(String((e as Error).message ?? e))); return 1;
  }
  out(flags.json ? JSON.stringify(r.data, null, 2) : r.text);
  return r.code;
}

const isMain = (() => { try { return !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main(process.argv.slice(2)).then((code) => process.exit(code));
