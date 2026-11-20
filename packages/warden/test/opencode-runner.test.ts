import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeRunner, classifyBaseURL, extractJson, parseVersion } from '../src/runner/opencode.ts';

test('classifyBaseURL accepts only loopback literals and rejects lookalike hosts and userinfo tricks', () => {
  assert.equal(classifyBaseURL('http://127.0.0.1:1235/v1').local, true);
  assert.equal(classifyBaseURL('http://localhost:1235/v1').local, true);
  for (const bad of ['https://api.openai.com/v1', 'http://127.0.0.1.evil.example/v1', 'http://user:pw@127.0.0.1:1235/v1', 'file:///etc/passwd', 'not a url', 'http://192.168.1.5:1235/v1']) assert.equal(classifyBaseURL(bad).local, false, bad);
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

test('the loaded context window is read from the endpoint (read-only GET), not guessed; unreadable keeps the configured fallback', async () => {
  const { createServer } = await import('node:http'); let hits = 0; let path = '';
  const srv = createServer((req, res) => { hits++; path = String(req.url); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'm1', loaded_context_length: 262144 })); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r())); const port = (srv.address() as { port: number }).port;
  try {
    const a = new OpenCodeRunner({ modelId: 'm1', baseURL: `http://127.0.0.1:${port}/v1` }) as unknown as { learnContext(): Promise<void>; o: { contextLimit: number } };
    await a.learnContext(); assert.equal(a.o.contextLimit, 262144); assert.equal(hits, 1); assert.equal(path, '/api/v0/models/m1');
    const b = new OpenCodeRunner({ modelId: 'm1', baseURL: `http://127.0.0.1:${port}/v1`, contextLimit: 8192 }) as unknown as { learnContext(): Promise<void>; o: { contextLimit: number } };
    await b.learnContext(); assert.equal(b.o.contextLimit, 8192); assert.equal(hits, 1, 'an explicit window is never overridden or queried');
  } finally { srv.close(); }
  const c = new OpenCodeRunner({ modelId: 'm1', baseURL: 'http://127.0.0.1:1/v1' }) as unknown as { learnContext(): Promise<void>; o: { contextLimit: number } };
  await c.learnContext(); assert.equal(c.o.contextLimit, 131072);
});
