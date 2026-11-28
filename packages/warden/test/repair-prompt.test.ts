import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairPrompt, runValidated } from '../src/runner/agent-runner.ts';
import type { AgentRunner, SessionRequest } from '../src/runner/agent-runner.ts';

const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string', minLength: 1 } } };
const req = (): SessionRequest => ({ task: 't', item: 1, packetDir: '/x', tools: { allow: [] }, resultSchema: schema, budgets: { maxToolCalls: 1, maxModelTurns: 1, wallTimeMs: 1000 }, expectedModel: 'm' });
const runner = (seen: { check?: (v: unknown) => string | null }, out: unknown): AgentRunner => ({
  name: 'fake', pinnedVersion: '0', preflight: async () => ({ ok: true, failures: [] }),
  run: async (r) => { seen.check = r.check; return { outcome: 'completed', structuredOutput: out, usage: { toolCalls: 0, modelTurns: 1, wallMs: 1 } }; },
});

test('the repair prompt names the validator\'s problem for a schema misfit and stays generic for unparseable text', () => {
  assert.match(repairPrompt('/a must be string'), /did not conform to the schema: \/a must be string/);
  assert.doesNotMatch(repairPrompt(), /did not conform/); assert.match(repairPrompt(), /did not contain the required JSON/);
  assert.ok(repairPrompt('x'.repeat(5000)).length < 900, 'the validator message is bounded');
});

test('runValidated hands the harness a check that reports the schema problem, and still rejects a misfit itself', async () => {
  const seen: { check?: (v: unknown) => string | null } = {};
  const bad = await runValidated(runner(seen, { a: '', extra: 1 }), req(), { stopped: () => false });
  assert.equal(bad.accepted, false); assert.match((bad as { reason: string }).reason, /structured output rejected/);
  assert.ok(seen.check, 'the harness receives the check'); assert.equal(seen.check!({ a: 'ok' }), null); assert.match(seen.check!({ a: '' }) ?? '', /fewer than 1/);
  const good = await runValidated(runner(seen, { a: 'ok' }), req(), { stopped: () => false }); assert.equal(good.accepted, true);
});
