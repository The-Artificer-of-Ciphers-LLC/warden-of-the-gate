import { Lease } from './lease.ts';
import type { Store } from './store.ts';
import { Faults, jitter, sleep } from './util.ts';

/** Read-modify-write counter on ONE comment (no CAS available). Without mutual exclusion, concurrent workers lose updates;
 *  with the lease the final value equals the number of increments. This is the direct proof of overlap prevention. */
export async function counterInit(s: Store, issue: number) { return (await s.createComment(issue, JSON.stringify({ n: 0, history: [] }))).id; }
export async function counterRead(s: Store, id: number) { return JSON.parse((await s.getComment(id)).body) as { n: number; history: unknown[] }; }
export async function counterWorker(s: Store, id: number, o: { mode: 'lease' | 'nolease'; perWorker: number; ttlMs: number; label: string }) {
  const lease = new Lease(s, o.label, o.ttlMs, new Faults()); const epochs: number[] = [];
  for (let k = 0; k < o.perWorker; k++) {
    if (o.mode === 'lease' && !(await lease.acquire(180_000))) throw new Error('could not acquire');
    try {
      if (o.mode === 'lease') await lease.assertHeld(1500);
      const cur = await counterRead(s, id);
      if (o.mode === 'nolease') await sleep(jitter(15));
      cur.n += 1; cur.history.push({ by: o.label, epoch: o.mode === 'lease' ? lease.epoch : 0 });
      await s.updateComment(id, JSON.stringify(cur));
      if (o.mode === 'lease') epochs.push(lease.epoch);
    } finally { if (o.mode === 'lease') await lease.release(); }
  }
  return epochs;
}
export async function counterExperiment(mk: () => Store, issue: number, o: { mode: 'lease' | 'nolease'; workers: number; perWorker: number; ttlMs: number; label: string }) {
  const s0 = mk(); const id = await counterInit(s0, issue);
  const all = await Promise.all(Array.from({ length: o.workers }, (_, w) => counterWorker(mk(), id, { ...o, label: `${o.label}-w${w}` })));
  const epochs = all.flat(); const fin = await counterRead(s0, id); const expected = o.workers * o.perWorker; const distinct = new Set(epochs).size;
  return { mode: o.mode, workers: o.workers, perWorker: o.perWorker, expected, final: fin.n, lostUpdates: expected - fin.n, distinctEpochsUsed: distinct, epochsStrictlyDistinctPerIncrement: o.mode === 'lease' ? distinct === epochs.length : null, commentId: id };
}
