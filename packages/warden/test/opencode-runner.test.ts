import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeRunner, classifyBaseURL, extractJson, parseVersion } from '../src/runner/opencode.ts';

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
