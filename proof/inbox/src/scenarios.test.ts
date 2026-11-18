import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, runScenarios } from './scenarios.ts';

test('S10 exercises a non-final stop boundary when claimants cannot be assigned', async () => {
  const env = makeEnv('fake'); env.assignable = () => false;
  const { results } = await runScenarios('fake', ['S10'], env);
  assert.equal(results.length, 1);
  assert.equal(results[0].pass, true, JSON.stringify(results[0].checks.filter((c) => !c.pass)));
});
