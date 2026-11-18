// Lifted unchanged from proof/p0-runtime/src/lib/seatbelt.ts (P0 isolation proof: 27/27). macOS Seatbelt containment: profile builder, contained
// spawn, and the self-test whose canaries prove the boundary is enforcing before any repository-derived content reaches a harness.
// macOS Seatbelt (sandbox-exec) containment spike. Evidence harness, not a production module.
// Policy: deny-by-default. Reads limited to system dirs + toolchain + workspace + scratch.
// Writes limited to workspace (optional) + scratch. Network limited to approved loopback TCP ports.
// Environment is rebuilt from an allowlist; nothing is inherited from the maintainer login env.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface ContainmentSpec {
  workspace: string;
  workspaceWritable: boolean;
  /** Private HOME/TMPDIR for the contained process; always writable. */
  scratch: string;
  /** Extra read-only roots (toolchain dirs). Must not contain credentials. */
  readonlyPaths?: string[];
  /** Approved outbound TCP destinations. Loopback only; names are not resolvable (DNS is denied). */
  allowTcp?: Array<{ port: number }>;
  /** Loopback ports the contained process may listen on (e.g. a harness server). */
  listenPorts?: number[];
  /** Extra env passed through (explicit, e.g. PATH additions). Secrets must never be listed here. */
  env?: Record<string, string>;
}

export class ContainmentUnavailableError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`containment unavailable or unverified: ${reasons.join('; ')}`);
    this.reasons = reasons;
  }
}

export const TESTED_MACOS_MAJOR = [27];

/** Injectable so the proof can simulate a missing/permissive/unsupported boundary (negative tests). */
export interface Backend {
  sandboxExec: string;
  testedMajors: number[];
  profile: (spec: ContainmentSpec) => string;
}
export const defaultBackend = (): Backend => ({ sandboxExec: '/usr/bin/sandbox-exec', testedMajors: TESTED_MACOS_MAJOR, profile: (s) => buildProfile(s) });

const q = (s: string) => JSON.stringify(s); // SBPL string literal == JSON string for our paths

export function realpath(p: string): string {
  return realpathSync(p);
}

export function nodeRoots(): string[] {
  const node = realpath(process.execPath);
  const roots = new Set<string>();
  // Homebrew-style layout: Cellar/<formula>/<ver>/bin/node ; libs under /opt/homebrew/{opt,lib}
  roots.add(path.resolve(node, '..', '..')); // .../26.13.0_2
  for (const p of ['/opt/homebrew/opt', '/opt/homebrew/Cellar', '/opt/homebrew/lib']) if (existsSync(p)) roots.add(p);
  // OpenSSL runtime config (non-secret) required by node start-up
  for (const p of ['/opt/homebrew/etc/openssl@3', '/opt/homebrew/etc/openssl@4', '/private/etc/ssl']) if (existsSync(p)) roots.add(p);
  return [...roots];
}

function ancestors(paths: string[]): string[] {
  const out = new Set<string>(['/']);
  for (const p of paths) {
    let cur = path.dirname(p);
    while (cur !== '/' && !out.has(cur)) { out.add(cur); cur = path.dirname(cur); }
  }
  return [...out];
}

export function buildProfile(spec: ContainmentSpec): string {
  const ws = realpath(spec.workspace);
  const scratch = realpath(spec.scratch);
  const ro = (spec.readonlyPaths ?? []).map(realpath);
  const lines: string[] = [
    '(version 1)',
    '(deny default)',
    '(import "system.sb")', // baseline dyld/system-library access only; no user data, no network
    '(allow process-fork)',
    '(allow process-exec)',
    '(allow signal (target self))',
    // stat() (metadata only - no contents, no directory listing) on ancestors of allowed roots: node/npm lstat each path component.
    ...ancestors([...nodeRoots(), ...ro, ws, scratch]).map((p) => `(allow file-read-metadata (literal ${q(p)}))`),
    ...nodeRoots().map((p) => `(allow file-read* (subpath ${q(p)}))`),
    ...ro.map((p) => `(allow file-read* (subpath ${q(p)}))`),
    `(allow file-read* (subpath ${q(ws)}))`,
    spec.workspaceWritable ? `(allow file-write* (subpath ${q(ws)}))` : '',
    `(allow file-read* file-write* (subpath ${q(scratch)}))`,
    '(deny network*)',
    ...(spec.allowTcp ?? []).map((a) => `(allow network-outbound (remote ip "localhost:${a.port}"))`),
    ...(spec.listenPorts ?? []).flatMap((p) => [`(allow network-bind (local ip "localhost:${p}"))`, `(allow network-inbound (local ip "localhost:${p}"))`]),
  ];
  return lines.filter(Boolean).join('\n') + '\n';
}

export function containedEnv(spec: ContainmentSpec): Record<string, string> {
  const scratch = realpath(spec.scratch);
  const tmp = path.join(scratch, 'tmp');
  mkdirSync(tmp, { recursive: true });
  return {
    PATH: [path.dirname(realpath(process.execPath)), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    HOME: scratch,
    TMPDIR: tmp,
    LANG: 'C.UTF-8',
    ...spec.env,
  };
}

export interface RunResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  pid: number | undefined;
}

/** Long-lived contained process (e.g. a harness server). Caller owns lifecycle; kill the process group. */
export function spawnContained(spec: ContainmentSpec, cmd: string, args: string[], opts: { cwd?: string; backend?: Backend } = {}) {
  const backend = opts.backend ?? defaultBackend();
  const profileDir = mkdtempSync(path.join(realpath(os.tmpdir()), 'warden-sb-'));
  const profilePath = path.join(profileDir, 'profile.sb');
  writeFileSync(profilePath, backend.profile(spec), { mode: 0o600 });
  const child = spawn(backend.sandboxExec, ['-f', profilePath, cmd, ...args], {
    cwd: opts.cwd ?? realpath(spec.workspace), env: { ...containedEnv(spec) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  child.on('close', () => rmSync(profileDir, { recursive: true, force: true }));
  return child;
}

export function runContained(
  spec: ContainmentSpec,
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxBytes?: number; backend?: Backend } = {},
): Promise<RunResult> {
  const backend = opts.backend ?? defaultBackend();
  const profileDir = mkdtempSync(path.join(realpath(os.tmpdir()), 'warden-sb-'));
  const profilePath = path.join(profileDir, 'profile.sb');
  writeFileSync(profilePath, backend.profile(spec), { mode: 0o600 });
  const started = Date.now();
  const maxBytes = opts.maxBytes ?? 1_000_000;
  return new Promise((resolve) => {
    const child = spawn(backend.sandboxExec, ['-f', profilePath, cmd, ...args], {
      cwd: opts.cwd ?? realpath(spec.workspace),
      env: containedEnv(spec),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group so the whole tree can be killed on timeout
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { if (stdout.length < maxBytes) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < maxBytes) stderr += d; });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
        }, opts.timeoutMs)
      : undefined;
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      rmSync(profileDir, { recursive: true, force: true });
      resolve({ code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started, pid: child.pid });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Self-test: canaries prove the boundary is actually enforcing BEFORE any repo code runs.
// Anything unexpected = containment unknown = execution blocked.
// ---------------------------------------------------------------------------------------------

const PROBE = String.raw`
const fs=require('fs'),net=require('net');
const [canaryRead,canaryWrite,wsFile,deniedPort,allowedPort]=process.argv.slice(1);
const out={};
const tryFs=(k,f)=>{try{f();out[k]='ALLOWED'}catch(e){out[k]=e.code||String(e)}};
tryFs('read_canary',()=>fs.readFileSync(canaryRead));
tryFs('write_canary',()=>fs.writeFileSync(canaryWrite,'x'));
tryFs('read_workspace',()=>fs.readFileSync(wsFile));
const conn=(k,port)=>new Promise(r=>{const s=net.connect({host:'127.0.0.1',port:+port});const t=setTimeout(()=>{s.destroy();out[k]='TIMEOUT';r()},2000);s.on('connect',()=>{clearTimeout(t);out[k]='ALLOWED';s.destroy();r()});s.on('error',e=>{clearTimeout(t);out[k]=e.code||String(e);r()})});
(async()=>{await conn('net_denied',deniedPort);await conn('net_allowed',allowedPort);console.log(JSON.stringify(out))})();
`;

export interface SelfTestResult {
  ok: boolean;
  observed: Record<string, string>;
  failures: string[];
}

function listen(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((s) => s.destroy());
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
  });
}

export async function containmentSelfTest(backend: Backend = defaultBackend()): Promise<SelfTestResult> {
  const failures: string[] = [];
  const observed: Record<string, string> = {};
  const major = Number(execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).split('.')[0]);
  observed.macos_major = String(major);
  if (!existsSync(backend.sandboxExec)) failures.push(`sandbox-exec missing at ${backend.sandboxExec}`);
  if (!backend.testedMajors.includes(major)) failures.push(`macOS major ${major} not in tested set ${backend.testedMajors}`);
  if (failures.length) return { ok: false, observed, failures };

  const base = mkdtempSync(path.join(realpath(os.tmpdir()), 'warden-selftest-'));
  const ws = path.join(base, 'ws');
  const scratch = path.join(base, 'scratch');
  mkdirSync(ws); mkdirSync(scratch);
  writeFileSync(path.join(ws, 'in.txt'), 'workspace');
  // Canary lives under the REAL home directory (what a hostile repo would target), unreadable by the profile.
  const canaryDir = mkdtempSync(path.join(realpath(os.homedir()), '.warden-p0-canary-'));
  const canaryRead = path.join(canaryDir, 'secret.txt');
  writeFileSync(canaryRead, 'CANARY-SECRET');
  const canaryWrite = path.join(canaryDir, 'written-by-sandbox.txt');
  const denied = await listen();
  const allowed = await listen();
  try {
    const spec: ContainmentSpec = { workspace: ws, workspaceWritable: true, scratch, allowTcp: [{ port: allowed.port }] };
    const r = await runContained(spec, process.execPath, ['-e', PROBE, canaryRead, canaryWrite, path.join(ws, 'in.txt'), String(denied.port), String(allowed.port)], { timeoutMs: 20000, backend });
    let parsed: Record<string, string> = {};
    try { parsed = JSON.parse(r.stdout.trim()); } catch { failures.push(`probe produced no result (code=${r.code} stderr=${r.stderr.slice(0, 200)})`); }
    Object.assign(observed, parsed);
    const want: Record<string, (v: string) => boolean> = {
      read_canary: (v) => v === 'EPERM' || v === 'EACCES',
      write_canary: (v) => v === 'EPERM' || v === 'EACCES',
      read_workspace: (v) => v === 'ALLOWED',
      net_denied: (v) => v !== 'ALLOWED' && v !== 'TIMEOUT',
      net_allowed: (v) => v === 'ALLOWED',
    };
    for (const [k, ok] of Object.entries(want)) if (!(k in parsed) || !ok(parsed[k])) failures.push(`probe ${k}=${parsed[k]}`);
    if (existsSync(canaryWrite)) failures.push('canary file was written from inside the sandbox');
  } finally {
    denied.server.close(); allowed.server.close();
    rmSync(canaryDir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
  return { ok: failures.length === 0, observed, failures };
}

/** Gate: call before executing ANY repo-derived code. Throws unless the boundary is verified. */
export async function requireContainment(backend: Backend = defaultBackend()): Promise<SelfTestResult> {
  const r = await containmentSelfTest(backend);
  if (!r.ok) throw new ContainmentUnavailableError(r.failures);
  return r;
}

/** The only sanctioned way to run repo-derived code: verify the boundary, then execute inside it. */
export async function runGuarded(
  spec: ContainmentSpec,
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxBytes?: number; backend?: Backend } = {},
): Promise<RunResult> {
  await requireContainment(opts.backend ?? defaultBackend());
  return runContained(spec, cmd, args, opts);
}
