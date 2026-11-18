// Excluded from tsconfig: outside the program, so compiler lookup cannot honestly answer for this file.
import type { LedgerStore } from '../src/ledger.js';
export class GeneratedLedger implements LedgerStore {
  async append(): Promise<void> {}
  size(): number { return 0; }
}
