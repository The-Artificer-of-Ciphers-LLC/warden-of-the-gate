import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FakeWorld } from './fake.ts';
import type { WorldSnapshot } from './fake.ts';
import type { Store } from './store.ts';

/** File-backed simulated GitHub for the `sim:<file>` backend: lets separate CLI processes (and the acceptance evidence run) share one
 *  disposable world. This is a SIMULATION backend, never a substitute for a live sandbox check; reports label it `backend: sim`. */
export function openSim(path: string, actor: string, down = false): { store: Store; world: FakeWorld; save: () => void } {
  const world = existsSync(path) ? FakeWorld.restore(JSON.parse(readFileSync(path, 'utf8')) as WorldSnapshot) : new FakeWorld();
  world.down = down;
  const save = () => { mkdirSync(dirname(path), { recursive: true }); const t = path + '.tmp'; writeFileSync(t, JSON.stringify(world.snapshot())); renameSync(t, path); };
  const store = world.view(actor);
  (store as unknown as { onWrite: () => void }).onWrite = save;
  return { store, world, save };
}
