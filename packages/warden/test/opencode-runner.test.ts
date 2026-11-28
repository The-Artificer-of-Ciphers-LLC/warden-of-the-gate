import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_LOCAL_PROVIDERS, LOCAL_PROVIDER_ID, OpenCodeRunner, SUPPORTED_OPENCODE, classifyBaseURL, extractJson, judgeRouting, openCodeVersionProblem, parseVersion } from '../src/runner/opencode.ts';

test('classifyBaseURL accepts only loopback literals and rejects lookalike hosts and userinfo tricks', () => {
  assert.equal(classifyBaseURL('http://127.0.0.1:11234/v1').local, true);
  assert.equal(classifyBaseURL('http://localhost:11234/v1').local, true);
  for (const bad of ['https://api.openai.com/v1', 'http://127.0.0.1.evil.example/v1', 'http://user:pw@127.0.0.1:11234/v1', 'file:///etc/passwd', 'not a url', 'http://192.168.1.5:11234/v1']) assert.equal(classifyBaseURL(bad).local, false, bad);
});

test('extractJson handles fenced and bare JSON and reports garbage instead of guessing', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":2} done').value, { a: 2 });
  assert.ok(extractJson('no json here').error);
});

test('preflight fails closed when the harness is missing or the endpoint is not loopback; it never reports ok', async () => {
  const missing = await new OpenCodeRunner({ bin: '/nonexistent/opencode', modelId: 'm' }).preflight();
  assert.equal(missing.ok, false); assert.ok(missing.failures.some((f) => /not runnable/.test(f)));
  const remote = await new OpenCodeRunner({ bin: '/nonexistent/opencode', modelId: 'm', baseURL: 'https://api.example.com/v1' }).preflight();
  assert.equal(remote.ok, false); assert.ok(remote.failures.some((f) => /not loopback/.test(f)));
});

test('parseVersion reads the real `opencode --version` output shape and rejects garbage', () => {
  assert.equal(parseVersion('opencode v2.2.7\n'), '2.2.7'); assert.equal(parseVersion('2.2.7'), '2.2.7'); assert.equal(parseVersion('no version'), undefined);
});

test('OpenCode is accepted as a 2.x range from 2.2.7 (owner ruling 2026-11-27, ADR 0004): 2.4.1 runs, 1.x, 3.x and anything below 2.2.7 are refused', () => {
  assert.equal(SUPPORTED_OPENCODE, '>=2.2.7 <3.0.0');
  for (const ok of ['2.2.7', '2.2.8', '2.4.1', '2.10.0', '2.99.99']) assert.equal(openCodeVersionProblem(ok), undefined, ok);
  for (const bad of ['1.9.9', '1.0.0', '3.0.0', '3.1.4', '10.0.0']) assert.match(String(openCodeVersionProblem(bad)), /outside the supported range >=2\.2\.7 <3\.0\.0/, bad);
  for (const old of ['2.2.6', '2.1.9', '2.0.0']) assert.match(String(openCodeVersionProblem(old)), /older than 2\.2\.7/, old);
  assert.match(String(openCodeVersionProblem('2.4')), /not a version number/);
});

test('preflight records the OpenCode version it observed and refuses only versions outside 2.x', async (t) => {
  const { chmodSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'warden-oc-ver-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = (v: string) => { const bin = path.join(dir, `opencode-${v}`); writeFileSync(bin, `#!/bin/sh\necho "opencode v${v}"\n`); chmodSync(bin, 0o755); return bin; };
  const versionFailure = (f: string[]) => f.filter((x) => /opencode \d+\.\d+\.\d+ is (outside|older)/.test(x));
  const r241 = new OpenCodeRunner({ bin: fake('2.4.1'), modelId: 'm', contextLimit: 65536, baseURL: 'https://api.example.com/v1' }); const p241 = await r241.preflight();
  assert.equal(p241.harnessVersion, '2.4.1'); assert.equal(r241.observedVersion, '2.4.1', 'the run records the version it actually used'); assert.deepEqual(versionFailure(p241.failures), []);
  assert.equal(r241.pinnedVersion, '>=2.2.7 <3.0.0');
  for (const v of ['1.14.0', '3.0.0']) {
    const r = new OpenCodeRunner({ bin: fake(v), modelId: 'm', contextLimit: 65536, baseURL: 'https://api.example.com/v1' }); const p = await r.preflight();
    assert.equal(p.ok, false); assert.equal(r.observedVersion, v); assert.equal(versionFailure(p.failures).length, 1, p.failures.join('; '));
  }
});

test('the context window is never guessed: preflight refuses without a confirmed window and names the flag', async () => {
  const none = await new OpenCodeRunner({ bin: '/nonexistent/opencode', modelId: 'm' }).preflight();
  assert.equal(none.ok, false); assert.ok(none.failures.some((f) => /context window not confirmed: pass --context-limit/.test(f)), none.failures.join('; '));
  const bad = (o: { contextLimit?: number; outputLimit?: number }) => (new OpenCodeRunner({ modelId: 'm', ...o }) as unknown as { windowProblem(): string | undefined }).windowProblem();
  assert.match(String(bad({ contextLimit: Number.NaN })), /not a whole number of at least 4096/);
  assert.match(String(bad({ contextLimit: 2048 })), /not a whole number of at least 4096/);
  assert.match(String(bad({ contextLimit: 32768, outputLimit: 32768 })), /must be smaller than the context window/);
  assert.match(String(bad({ contextLimit: 65536, outputLimit: 0 })), /output limit 0 is not a positive whole number/);
  assert.equal(bad({ contextLimit: 65536 }), undefined, 'a configured window with the default 32768 output limit is confirmed');
  const ok = await new OpenCodeRunner({ bin: '/nonexistent/opencode', modelId: 'm', contextLimit: 65536 }).preflight();
  assert.ok(!ok.failures.some((f) => /context window|output limit/.test(f)), 'a confirmed window raises no window failure');
});

test('a session without a confirmed window is refused before any model server is started or queried', async () => {
  const { createServer } = await import('node:http'); let hits = 0;
  const srv = createServer((_req, res) => { hits++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'm1', context_length: 262144 }] })); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r())); const port = (srv.address() as { port: number }).port;
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'warden-oc-win-')); writeFileSync(path.join(dir, 'prompt.txt'), 'task');
  try {
    const r = new OpenCodeRunner({ bin: '/nonexistent/opencode', modelId: 'm1', baseURL: `http://127.0.0.1:${port}/v1` });
    const res = await r.run({ packetDir: dir, tools: { allow: [] } } as never, new AbortController().signal, { toolCalls: 0, modelTurns: 0, observe() {}, exceeded: undefined } as never);
    assert.equal(res.outcome, 'failed'); assert.match(String(res.reason), /context window not confirmed/);
    assert.equal(hits, 0, 'server-specific window fields are not read: the window is configuration, not discovery');
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

// Replies as OpenCode 2.4.1 gave them on the owner's Mac (2026-11-28 probe), cut to the fields Warden reads. 2.2.7 answers in the same `{ data }` shape.
const MODEL = 'beamster/Qwen3.8-Flash-Next-Sushi-2bpw'; const LOCAL = 'http://127.0.0.1:11234/v1';
const ok200 = (data: unknown) => ({ status: 200, body: { location: { directory: '/tmp/ws' }, data } });
const provider = (id = LOCAL_PROVIDER_ID, baseURL = LOCAL) => ({ id, integrationID: id, activation: 'enabled', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL, provider: id } });
const model = (id = MODEL, providerID = LOCAL_PROVIDER_ID, baseURL = LOCAL) => ({ id, modelID: id, providerID, settings: { baseURL, provider: providerID }, enabled: true, limit: { context: 1048576, output: 32768 } });

test('judgeRouting: 2.4.1 answers with no providers and a null default just after "listening"; that reads as still loading, not as a pass', () => {
  const early = judgeRouting(ok200([]), ok200(null), MODEL);
  assert.equal(early.loading, true); assert.match(early.reasons.join(';'), /no resolved default model \(status 200\)/);
  const loaded = judgeRouting(ok200([provider()]), ok200(model()), MODEL);
  assert.deepEqual(loaded, { loading: false, resolvedModel: MODEL, reasons: [] }, 'the reply 2.4.1 gave once loaded (and 2.2.7 gives at once) passes');
});

test('judgeRouting still fails closed at once on non-local routing, a substituted model or a model from another provider', () => {
  const remoteProvider = judgeRouting(ok200([provider(LOCAL_PROVIDER_ID, 'https://api.example.com/v1')]), ok200(null), MODEL);
  assert.equal(remoteProvider.loading, false, 'a non-local provider is never waited out'); assert.match(remoteProvider.reasons.join(';'), /enabled provider "mlx-serve" is non-local/);
  const remoteModel = judgeRouting(ok200([provider()]), ok200(model(MODEL, LOCAL_PROVIDER_ID, 'https://api.example.com/v1')), MODEL);
  assert.match(remoteModel.reasons.join(';'), /routes to a non-local endpoint/);
  const swapped = judgeRouting(ok200([provider()]), ok200(model('openai/gpt-oss-20b')), MODEL);
  assert.equal(swapped.loading, false); assert.match(swapped.reasons.join(';'), /resolved model openai\/gpt-oss-20b != expected .* \(silent substitution\)/);
  const otherProvider = judgeRouting(ok200([provider(), provider('lmstudio')]), ok200(model(MODEL, 'lmstudio')), MODEL);
  assert.match(otherProvider.reasons.join(';'), /comes from provider "lmstudio", not Warden's "mlx-serve"/);
  assert.equal(judgeRouting({ status: 500, body: 'boom' }, { status: 500, body: 'boom' }, MODEL).loading, false, 'an error reply is a failure, not a wait');
});

test('resolve asks again while OpenCode is still loading, and refuses when it never loads within startupMs', async () => {
  type Reply = { status: number; body: unknown };
  const stub = (replies: (n: number) => [Reply, Reply]) => { let n = 0; let pending: Reply | undefined;
    return { calls: () => n, api: async (_m: string, p: string) => { if (p === '/api/provider') { const [a, b] = replies(n++); pending = b; return a; } return pending!; } }; };
  const resolveOf = (r: OpenCodeRunner) => (r as unknown as { resolve(s: unknown): Promise<{ ok: boolean; resolvedModel?: string; reasons: string[] }> }).resolve.bind(r);
  const late = stub((n) => (n < 3 ? [ok200([]), ok200(null)] : [ok200([provider()]), ok200(model())]));
  const r1 = await resolveOf(new OpenCodeRunner({ modelId: MODEL, startupMs: 10_000 }))(late);
  assert.deepEqual(r1, { ok: true, resolvedModel: MODEL, reasons: [] }); assert.equal(late.calls(), 4, 'three loading readings, then the loaded one');
  const never = stub(() => [ok200([]), ok200(null)]);
  const r2 = await resolveOf(new OpenCodeRunner({ modelId: MODEL, startupMs: 600 }))(never);
  assert.equal(r2.ok, false); assert.match(r2.reasons.join(';'), /no resolved default model .*OpenCode had not loaded its providers after \d+s/);
  const wrong = stub(() => [ok200([provider()]), ok200(model('qwen/qwen3-coder-30b'))]);
  const r3 = await resolveOf(new OpenCodeRunner({ modelId: MODEL, startupMs: 10_000 }))(wrong);
  assert.equal(r3.ok, false); assert.equal(wrong.calls(), 1, 'a substitution fails on the first reading, without waiting');
});

test('the generated OpenCode config registers only Warden\'s mlx-serve provider and denies OpenCode\'s own LM Studio and Ollama providers', () => {
  const cfg = (new OpenCodeRunner({ modelId: MODEL, contextLimit: 1048576 }) as unknown as { config(): any }).config();
  assert.equal(LOCAL_PROVIDER_ID, 'mlx-serve'); assert.equal(cfg.model, `mlx-serve/${MODEL}`);
  assert.deepEqual(Object.keys(cfg.providers), ['mlx-serve'], 'no lmstudio provider (owner, 2026-11-28: "drop lmstudio we aren\'t using it")');
  assert.equal(cfg.providers['mlx-serve'].package, '@ai-sdk/openai-compatible', 'still the plain OpenAI-compatible endpoint, whatever serves it');
  assert.deepEqual(cfg.providers['mlx-serve'].settings, { baseURL: LOCAL });
  const denied = cfg.policies.filter((x: any) => x.action === 'provider.use' && x.effect === 'deny').map((x: any) => x.resource);
  assert.deepEqual(denied, ['opencode', ...BUILTIN_LOCAL_PROVIDERS]); assert.deepEqual([...BUILTIN_LOCAL_PROVIDERS], ['lmstudio', 'ollama']);
});
