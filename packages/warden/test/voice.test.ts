import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiced } from '../src/writer/voice.ts';
import { rig } from './helpers.ts';
import { LEDGER_MARK } from '../src/writer/protocol.ts';
const posts = async (r: ReturnType<typeof rig>, n: number) => (await r.world.view('x').listComments(n)).map((c) => c.body).filter((b) => !b.startsWith(LEDGER_MARK));

test('voice: deterministic and AI-assisted text are told apart in each style; the signature closes the message; no vendor or personal maintainer is claimed', () => {
  assert.match(voiced('Hello.', 'deterministic', { style: 'neutral', signature: '' }), /^_Automated notice from Warden\._\n\nHello\.$/);
  assert.match(voiced('Hello.', 'ai', { style: 'neutral', signature: '' }), /AI-assisted note from Warden, drafted by a model under the maintainers' rules/);
  assert.match(voiced('Hi', 'maintainer', { style: 'friendly', signature: '' }), /^_Hi, this is an automated notice from Warden\._/);
  assert.match(voiced('x', 'ai', { style: 'terse', signature: '' }), /^_\[Warden: AI-assisted\]_/);
  assert.match(voiced('x', 'deterministic', { style: 'neutral', signature: '  The GSD maintainers  ' }), /\n\nThe GSD maintainers$/);
  assert.equal(/claude|gpt|anthropic|openai/i.test(['neutral', 'friendly', 'terse'].flatMap((s) => [voiced('x', 'ai', { style: s as 'neutral', signature: '' }), voiced('x', 'deterministic', { style: s as 'neutral', signature: '' })]).join(' ')), false);
});

test('the writer posts comments in the configured voice, and a comment that becomes unsafe once voiced (a mention in the signature) is blocked', async () => {
  const r = rig({ voice: { style: 'terse', signature: 'The maintainers' } }); const n = r.world.addIssue({ title: 'a bug', author: 'reporter1' });
  await r.send({ kind: 'note', item: n, itemKind: 'issue', payload: { text: 'We will look at this.' } }); await r.writer().drain();
  const posted = (await posts(r, n)).find((b) => b.includes('We will look at this.'))!;
  assert.match(posted, /_\[Warden: automated\]_\n\nWe will look at this\.\n\nThe maintainers$/);
  const r2 = rig({ voice: { style: 'neutral', signature: 'ping @someone' } }); const m = r2.world.addIssue({ title: 'a bug', author: 'reporter1' });
  await r2.send({ kind: 'note', item: m, itemKind: 'issue', payload: { text: 'hello' } }); await r2.writer().drain();
  assert.equal((await posts(r2, m)).some((b) => b.includes('hello')), false, 'blocked: the signature mentions someone who is not a maintainer');
});
