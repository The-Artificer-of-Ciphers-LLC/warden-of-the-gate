import { MemoryLedger, recordClaim } from './ledger.js';
import type { Entry } from './types.js'; // expect:Entry:ref

// Unrelated function that happens to be called append: a text search conflates it, the compiler does not.
function append(list: string[], x: string): void { list.push(x); }

export async function main(): Promise<void> {
  const ledger = new MemoryLedger();
  const e: Entry = { id: 'a', actor: 'bot', at: 1 }; // expect:Entry:ref
  await ledger.append(e); // expect:LedgerStore.append:call
  await recordClaim(ledger, e);
  const names: string[] = [];
  append(names, 'x'); // decoy: unrelated append
}
