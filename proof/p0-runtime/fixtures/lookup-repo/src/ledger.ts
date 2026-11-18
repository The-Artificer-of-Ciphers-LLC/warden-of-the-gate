import type { Entry } from './types.js'; // expect:Entry:ref

/** Durable ledger. NOTE: append() must be idempotent per entry id; the word append appears in prose on purpose. */
export interface LedgerStore {
  append(entry: Entry): Promise<void>; // expect:LedgerStore.append:def expect:Entry:ref
  size(): number;
}

export class MemoryLedger implements LedgerStore {
  private rows: Entry[] = []; // expect:Entry:ref
  async append(entry: Entry): Promise<void> { // expect:LedgerStore.append:impl expect:Entry:ref
    if (!this.rows.some((r) => r.id === entry.id)) this.rows.push(entry);
  }
  size(): number { return this.rows.length; }
}

export class FileLedger implements LedgerStore {
  constructor(private readonly path: string) {}
  async append(entry: Entry): Promise<void> { // expect:LedgerStore.append:impl expect:Entry:ref
    const note = 'append: ' + this.path; // decoy: string mention of append
    void note; void entry;
  }
  size(): number { return 0; }
}

export async function recordClaim(store: LedgerStore, entry: Entry): Promise<number> { // expect:Entry:ref
  await store.append(entry); // expect:LedgerStore.append:call
  return store.size();
}
