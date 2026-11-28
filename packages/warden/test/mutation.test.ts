import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedLines, evaluateReport, mutantId, mutateArg } from '../src/verify/mutation.ts';
import { parseMaintainerCommand } from '../src/approvals/approvals.ts';
import { detectWeakening } from '../src/verify/executor.ts';
import { rig, OPERATOR } from './helpers.ts';
import { parseLedger, parseReceipt, LEDGER_MARK } from '../src/writer/protocol.ts';

/** ADR 0016: mutation evidence on changed code, judged from the report, with maintainer-only clearance of equivalent mutants. */
const patch = (...added: string[]) => `@@ -1,1 +1,${added.length} @@\n${added.map((l) => '+' + l).join('\n')}`;
const change = (path: string, p: string, status: 'A' | 'M' | 'D' = 'M') => ({ path, status, patch: p });
const M = (line: number, status: string, mutator = 'ArithmeticOperator', replacement = 't - i', endLine = line) => ({ id: `${line}${status}`, mutatorName: mutator, replacement, status, location: { start: { line, column: 1 }, end: { line: endLine, column: 9 } } });
const text = (_p: string, line: number) => `line ${line} text`;

test('changed lines are the added lines of non-test files; they become the --mutate ranges', () => {
  const ch = [change('src/a.js', patch('x', 'y', 'z')), change('test/a.test.js', patch('t')), change('src/gone.js', '', 'D'), change('src/b.js', '@@ -1,3 +1,4 @@\n a\n+b\n c\n d\n+e')];
  const m = changedLines(ch); assert.deepEqual([...m.keys()], ['src/a.js', 'src/b.js']); assert.deepEqual(m.get('src/a.js'), [1, 2, 3]); assert.deepEqual(m.get('src/b.js'), [2, 5]);
  assert.equal(mutateArg(m), 'src/a.js:1-3,src/b.js:2,src/b.js:5');
});

test('the report is judged by Warden: killed and timeout are detected, survived and no-coverage and ignored survive, errors are invalid, unchanged lines are not judged', () => {
  const changed = new Map([['src/a.js', [3, 4]]]);
  const report = { files: { 'src/a.js': { mutants: [M(3, 'Killed'), M(3, 'Timeout'), M(4, 'Survived'), M(4, 'NoCoverage', 'ConditionalExpression', 'false'), M(4, 'Ignored', 'StringLiteral', '""'), M(3, 'CompileError'), M(3, 'RuntimeError'), M(9, 'Survived'), M(1, 'Survived', 'X', 'y', 3)] }, 'src/other.js': { mutants: [M(3, 'Survived')] } } };
  const r = evaluateReport(report, changed, text); assert.equal(r.status, 'ok'); if (r.status !== 'ok') return;
  assert.equal(r.total, 6); assert.equal(r.killed, 2); assert.equal(r.invalid, 2); assert.deepEqual(r.survivors.map((s) => `${s.line}:${s.status}`), ['4:Survived', '4:NoCoverage', '4:Ignored', '1:Survived']); assert.equal(r.score, 33.3);
  assert.equal(evaluateReport({}, changed, text).status, 'failed-to-run'); assert.equal(evaluateReport(null, changed, text).status, 'failed-to-run');
});

test('a mutant id covers the mutated line\'s text, so a maintainer clearance lapses when that code changes; a cleared mutant stops blocking', () => {
  assert.equal(mutantId('a.js', 'Op', 'x', '  t += i;'), mutantId('a.js', 'Op', 'x', 't += i;'), 'indentation does not matter');
  assert.notEqual(mutantId('a.js', 'Op', 'x', 't += i;'), mutantId('a.js', 'Op', 'x', 't += i * 2;')); assert.notEqual(mutantId('a.js', 'Op', 'x', 'l'), mutantId('b.js', 'Op', 'x', 'l')); assert.notEqual(mutantId('a.js', 'Op', 'x', 'l'), mutantId('a.js', 'Op', 'y', 'l'));
  const changed = new Map([['a.js', [2]]]); const rep = { files: { 'a.js': { mutants: [M(2, 'Survived')] } } };
  const first = evaluateReport(rep, changed, () => 't += i;'); assert.equal(first.status === 'ok' && first.survivors.length, 1); const id = first.status === 'ok' ? first.survivors[0].id : '';
  const cleared = evaluateReport(rep, changed, () => 't += i;', { [id]: { by: 'm' } }); assert.equal(cleared.status === 'ok' && cleared.survivors.length, 0); assert.equal(cleared.status === 'ok' && cleared.cleared.length, 1);
  const lapsed = evaluateReport(rep, changed, () => 't += i + 1;', { [id]: { by: 'm' } }); assert.equal(lapsed.status === 'ok' && lapsed.survivors.length, 1, 'the code changed, so the old clearance no longer applies');
});

test('/warden clear-mutant needs ONE mutant id and a reason; an inline Stryker disable is a gate weakening', () => {
  assert.deepEqual(parseMaintainerCommand('/warden clear-mutant aaaabbbbcccc the loop bound is symmetric'), { kind: 'clear-mutant', payload: { mutant: 'aaaabbbbcccc', reason: 'the loop bound is symmetric' } });
  for (const bad of ['/warden clear-mutant aaaabbbbcccc', '/warden clear-mutant all because', '/warden clear-mutant aaaa reason', '/warden clear-mutant']) assert.equal(parseMaintainerCommand(bad), null, bad);
  assert.ok(detectWeakening([{ path: 'src/a.js', patch: patch('// Stryker disable next-line all') }]).some((w) => w.kind === 'suppression-added'));
});

test('clear-mutant: only a verified maintainer clears a mutant, once; the clearance lands in the item ledger', async () => {
  const r = rig({ mode: 'live' }); const n = r.world.addIssue({ title: 'bug', author: 'reporter' });
  const send = async (as: string, text: string, payload: Record<string, unknown>) => { const cid = await r.comment(as, n, text); await r.send({ kind: 'clear-mutant', item: n, itemKind: 'issue', origin: 'maintainer', actor: as, payload, source: { kind: 'gh-comment', id: String(cid), observedAt: new Date(r.world.now()).toISOString() } }); await r.writer().drain(); };
  const ledger = async () => parseLedger((await r.world.view('x').listComments(n)).filter((c) => c.body.startsWith(LEDGER_MARK))[0].body)!;
  const receipts = async () => (await r.world.view(OPERATOR).listComments(r.inbox)).map((c) => parseReceipt(c.body)).filter(Boolean);
  await send('rando', '/warden clear-mutant aaaabbbbcccc equivalent', { mutant: 'aaaabbbbcccc', reason: 'equivalent' }); assert.equal((await ledger().catch(() => ({ mutantClearances: undefined }))).mutantClearances, undefined); assert.ok((await receipts()).some((x) => x!.result === 'rejected' && /unauthorized-identity/.test(x!.reason ?? '')));
  await send(OPERATOR, '/warden clear-mutant aaaabbbbcccc equivalent', { mutant: 'aaaabbbbcccc', reason: 'equivalent' }); assert.equal((await ledger()).mutantClearances?.aaaabbbbcccc?.by, OPERATOR);
  await send(OPERATOR, '/warden clear-mutant aaaabbbbcccc again', { mutant: 'aaaabbbbcccc', reason: 'again' }); assert.ok((await receipts()).some((x) => /already-cleared/.test(x!.reason ?? '')));
});
