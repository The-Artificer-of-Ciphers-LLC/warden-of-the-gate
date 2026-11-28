import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld } from '../src/github/fake.ts';
import { authorizedUrgent } from '../src/scan/urgency.ts';
import { select } from '../src/scan/select.ts';

const world = () => { const w = new FakeWorld(); w.clock = Date.parse('2026-11-27T10:00:00Z'); return w; };
const urgent = async (w: FakeWorld, n: number) => authorizedUrgent(w.view('reader'), await w.view('reader').getIssue(n), { label: 'urgent', maintainers: ['maint1'] });

test('urgent comes only from a configured maintainer applying the label; a contributor, a removal, or no label leaves the item ordinary', async () => {
  const w = world(); const a = w.addIssue({ title: 'a' }); const b = w.addIssue({ title: 'b' }); const c = w.addIssue({ title: 'c' }); const d = w.addIssue({ title: 'd' });
  await w.view('maint1').addLabel(a, 'urgent');                                                    // maintainer applied it
  await w.view('rando').addLabel(b, 'urgent');                                                     // contributor applied it
  await w.view('maint1').addLabel(c, 'urgent'); await w.view('maint1').removeLabel(c, 'urgent');   // applied then removed
  assert.equal(await urgent(w, a), true); assert.equal(await urgent(w, b), false); assert.equal(await urgent(w, c), false); assert.equal(await urgent(w, d), false);
  await w.view('rando').removeLabel(b, 'urgent'); await w.view('maint1').addLabel(b, 'urgent');    // a maintainer re-applies it
  assert.equal(await urgent(w, b), true);
  assert.equal(await authorizedUrgent(w.view('x'), { number: a, labels: ['urgent'] }, { maintainers: ['maint1'] }), false, 'no configured label: nothing is urgent');
});

test('an authorized urgent item is ordered first by the deterministic selection and still counts against the same caps', async () => {
  const sel = select([{ item: 1, kind: 'issue', ageHours: 100 }, { item: 2, kind: 'issue', ageHours: 1, urgent: true }, { item: 3, kind: 'issue', ageHours: 50 }], { maxItems: 2, starveAfterHours: 168, maxFactoryImplementationPrs: 1, openFactoryImplementationPrs: 0 });
  assert.deepEqual(sel.run.map((x) => x.item), [2, 1]); assert.equal(sel.deferred.length, 1);
});
