import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact, redactDeep, sha256, iso } from '../util.ts';
import { CLI_VERSION } from '../version.ts';

export const wardenHome = (env: NodeJS.ProcessEnv = process.env) => resolve(env.WARDEN_HOME ?? join(homedir(), '.warden'));
export const instanceIdFor = (repository: string) => repository.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + sha256(repository.toLowerCase()).slice(0, 8);
export class InstanceMismatch extends Error { constructor(m: string) { super('INSTANCE MISMATCH: ' + m); } }
export class StorageError extends Error { constructor(m: string) { super('STORAGE FAILURE: ' + m); } }

export function readJsonFile<T>(file: string): T | null {
  let text: string;
  try { text = readFileSync(file, 'utf8'); }
  catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
    throw new StorageError(`cannot read ${file}`);
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value === null) throw new StorageError(`null state in ${file}`);
    return value as T;
  } catch (e) {
    if (e instanceof SyntaxError) throw new StorageError(`invalid JSON in ${file}`);
    throw e;
  }
}

/** Per-instance protected local state (CORE-instances, CORE-storage). One directory per configured repository: 0700 dirs, 0600 files,
 *  credential-shaped values redacted from the FIRST write. An instance directory records its repository and refuses to open for another,
 *  so two instances on one host cannot exchange mutable state, authority or decisions. Failed writes throw: durability is never assumed. */
export class InstanceStorage {
  readonly dir: string; readonly repository: string; readonly id: string;
  private constructor(dir: string, repository: string, id: string) { this.dir = dir; this.repository = repository; this.id = id; }
  static open(home: string, repository: string, o: { create: boolean }): InstanceStorage {
    const id = instanceIdFor(repository); const dir = join(home, 'instances', id); const meta = join(dir, 'instance.json');
    if (!existsSync(meta)) {
      if (!o.create) throw new StorageError(`instance ${repository} is not initialized (run \`warden setup\`)`);
      try { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(home, 0o700); chmodSync(dir, 0o700); writeFileSync(meta, JSON.stringify({ repository, id, createdAt: iso(Date.now()), version: CLI_VERSION }), { mode: 0o600 }); }
      catch (e) { throw new StorageError(`cannot create ${dir}: ${(e as Error).message}`); }
    }
    const m = JSON.parse(readFileSync(meta, 'utf8')) as { repository: string };
    if (m.repository !== repository) throw new InstanceMismatch(`${dir} belongs to ${m.repository}, not ${repository}`);
    const s = new InstanceStorage(dir, repository, id);
    for (const sub of ['credentials', 'journal', 'transcripts']) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
    return s;
  }
  path(...p: string[]) { return join(this.dir, ...p); }
  get journalPath() { return this.path('journal', 'journal.jsonl'); }
  get credentialsDir() { return this.path('credentials'); }
  get stopPath() { return this.path('stop.json'); }
  get globalStopPath() { return this.path('global-stop.json'); }
  get decisionsPath() { return this.path('decisions.jsonl'); }
  get auditPath() { return this.path('security-audit.jsonl'); }
  get transcriptsDir() { return this.path('transcripts'); }

  writeJson(file: string, v: unknown) {
    try { const t = file + '.tmp'; writeFileSync(t, JSON.stringify(redactDeep(v)), { mode: 0o600 }); renameSync(t, file); chmodSync(file, 0o600); }
    catch (e) { throw new StorageError(`write ${file}: ${(e as Error).message}`); }
  }
  readJson<T>(file: string): T | null { return readJsonFile<T>(file); }
  appendLine(file: string, v: unknown) {
    try { appendFileSync(file, redact(JSON.stringify(v)) + '\n', { mode: 0o600 }); chmodSync(file, 0o600); }
    catch (e) { throw new StorageError(`append ${file}: ${(e as Error).message}`); }
  }
  securityAudit(event: string, detail: Record<string, unknown> = {}) { this.appendLine(this.auditPath, { at: iso(Date.now()), event, ...detail }); }
  /** Decision corpus: durable, scoped to this instance, never purged by transcript retention. Idempotent per approval+decision. */
  recordDecision(d: { approvalId: string; decision: string; [k: string]: unknown }): boolean {
    if (existsSync(this.decisionsPath) && readFileSync(this.decisionsPath, 'utf8').split('\n').some((l) => l && (JSON.parse(l) as typeof d).approvalId === d.approvalId && (JSON.parse(l) as typeof d).decision === d.decision)) return false;
    this.appendLine(this.decisionsPath, d); return true;
  }
  decisions(): Record<string, unknown>[] { return existsSync(this.decisionsPath) ? readFileSync(this.decisionsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; }
  /** Transcript retention (default 30d) is separate from security-audit retention and never touches decisions or pending recovery data. */
  pruneTranscripts(days: number, now = Date.now()): number {
    let n = 0; for (const f of existsSync(this.transcriptsDir) ? readdirSync(this.transcriptsDir) : []) { const p = join(this.transcriptsDir, f); if (now - statSync(p).mtimeMs > days * 86400_000) { unlinkSync(p); n++; } } return n;
  }
  /** Report any state file looser than 0600 / dir looser than 0700. */
  permissionProblems(): string[] {
    const bad: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); const m = statSync(p).mode & 0o777; if (f.isDirectory()) { if (m & 0o077) bad.push(`${p} mode ${m.toString(8)}`); walk(p); } else if (m & 0o077) bad.push(`${p} mode ${m.toString(8)}`); } };
    walk(this.dir); return bad;
  }
}
