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
