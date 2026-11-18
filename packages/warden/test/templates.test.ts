import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';

/** The example workflows are inert (`.example`), parse as YAML, and keep the security invariants the design depends on. */
const dir = new URL('../templates/workflows/', import.meta.url);
const files = readdirSync(dir);
test('example workflows: inert, valid, trusted-branch checkout only, minimal permissions, serialized writer, no uncommented schedule while the P1 gate is open', () => {
  assert.deepEqual(files.sort(), ['warden-events.yml.example', 'warden-sweep.yml.example', 'warden-writer.yml.example']);
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8'); const d = parse(text);
    assert.ok(f.endsWith('.example') && /NOT INSTALLED/.test(text), `${f} must be inert`);
    assert.ok(d.jobs && Object.keys(d.jobs).length === 1, f);
    for (const job of Object.values(d.jobs) as Array<{ steps: Array<{ uses?: string; with?: { ref?: string }; run?: string }> }>) {
      const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout'));
      assert.match(String(checkout?.with?.ref), /default_branch/, `${f}: only the default branch is checked out, never a PR head`);
      assert.ok(!job.steps.some((s) => /github\.head_ref|pull_request\.head/.test(JSON.stringify(s))), `${f}: no PR head reference`);
      assert.ok(job.steps.some((s) => /--ignore-scripts/.test(s.run ?? '')), `${f}: dependency install runs no lifecycle scripts`);
    }
    assert.ok(!/contents:\s*write|pull-requests:\s*write|id-token/.test(text), `${f}: no write permission beyond issues`);
  }
  const writer = parse(readFileSync(new URL('warden-writer.yml.example', dir), 'utf8')); assert.equal(writer.concurrency.group, 'warden-writer'); assert.equal(writer.concurrency['cancel-in-progress'], false);
  const sweep = readFileSync(new URL('warden-sweep.yml.example', dir), 'utf8'); assert.ok(!parse(sweep).on.schedule, 'schedule stays commented until a real scheduled run is observed'); assert.match(sweep, /P1 scheduling gate is OPEN/);
  assert.ok(Object.keys(parse(readFileSync(new URL('warden-events.yml.example', dir), 'utf8')).on).includes('pull_request_target'));
});
