import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { checkWorkflow } from '../src/config/workflow-check.ts';

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

/** W-20 (issue #81), PRD §3 Actions hardening, confirmed by the owner on 2026-11-27. */
const CO = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const wf = (on: string, steps: string) => `name: t\non:\n${on}\npermissions: { contents: read }\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    steps:\n${steps}`;
const rules = (text: string) => checkWorkflow(text).map((f) => f.rule).sort();

test('every Warden workflow template and this repository\'s own workflow pass the Actions-hardening check', () => {
  for (const f of files) assert.deepEqual(checkWorkflow(readFileSync(new URL(f, dir), 'utf8')), [], f);
  assert.deepEqual(checkWorkflow(readFileSync(new URL('../../../.github/workflows/checks.yml', import.meta.url), 'utf8')), [], 'checks.yml');
  for (const f of files) assert.match(readFileSync(new URL(f, dir), 'utf8'), /WARDEN_TRUSTED_REF: refs\/remotes\/origin\/\$\{\{ github\.event\.repository\.default_branch \}\}/, `${f}: policy comes from the default branch commit`);
});

test('the Actions-hardening check finds a pull_request_target or workflow_run workflow that checks out or fetches the pull request code', () => {
  const safe = `      - uses: ${CO}\n        with: { ref: '\${{ github.event.repository.default_branch }}', persist-credentials: false }\n`;
  assert.deepEqual(rules(wf('  pull_request_target: {}', safe)), [], 'base checkout under pull_request_target is allowed');
  assert.deepEqual(rules(wf('  pull_request_target: {}', `      - uses: ${CO}\n        with: { ref: '\${{ github.event.pull_request.head.sha }}', persist-credentials: false }\n`)), ['pr-head-checkout']);
  assert.deepEqual(rules(wf('  pull_request_target: {}', `      - uses: ${CO}\n        with: { repository: '\${{ github.event.pull_request.head.repo.full_name }}', ref: '\${{ github.head_ref }}', persist-credentials: false }\n`)), ['pr-head-checkout']);
  assert.deepEqual(rules(wf('  pull_request_target: {}', `${safe}      - run: git fetch origin "refs/pull/$NUM/head" && git checkout FETCH_HEAD\n        env: { NUM: '\${{ github.event.number }}' }\n`)), ['pr-head-checkout']);
  assert.deepEqual(rules(wf('  workflow_run: { workflows: [ci], types: [completed] }', `${safe}      - run: gh pr checkout "$N"\n`)), ['pr-head-checkout']);
  assert.deepEqual(rules(wf('  pull_request: {}', `      - uses: ${CO}\n        with: { ref: '\${{ github.event.pull_request.head.sha }}', persist-credentials: false }\n`)), [], 'pull_request runs PR code with a read-only token: not this rule');
});

test('the Actions-hardening check finds event text in scripts, unpinned actions and a persisted checkout token', () => {
  assert.deepEqual(rules(wf('  issues: {}', `      - run: echo "\${{ github.event.issue.title }}"\n`)), ['script-injection']);
  assert.deepEqual(rules(wf('  pull_request: {}', `      - run: echo \${{ github.head_ref }}\n`)), ['script-injection']);
  assert.deepEqual(rules(wf('  workflow_dispatch: { inputs: { x: { type: string } } }', `      - run: ./go \${{ inputs.x }}\n`)), ['script-injection']);
  assert.deepEqual(rules(wf('  issue_comment: {}', `      - uses: actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd\n        with: { script: 'core.info("\${{ github.event.comment.body }}")' }\n`)), ['script-injection']);
  assert.deepEqual(rules(wf('  issues: {}', `      - run: echo "$TITLE"\n        env: { TITLE: '\${{ github.event.issue.title }}' }\n      - run: echo \${{ matrix.n }} \${{ github.run_id }}\n`)), [], 'event text through env, and non-event expressions, are fine');
  assert.deepEqual(rules(wf('  push: {}', `      - uses: actions/setup-node@v4\n      - uses: actions/checkout@main\n        with: { persist-credentials: false }\n      - uses: ./local-action\n      - uses: docker://alpine@sha256:${'a'.repeat(64)}\n`)), ['unpinned-action', 'unpinned-action']);
  assert.deepEqual(rules(wf('  push: {}', `      - uses: ${CO}\n`)), ['persisted-credentials']);
  assert.deepEqual(rules('jobs: ['), ['invalid']);
});

