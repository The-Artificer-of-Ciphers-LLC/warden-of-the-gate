/** Versioned contracts. Bumping any of these is a reviewed, documented change (see CHANGELOG / ADR 0005, 0010). */
export const CLI_VERSION = '0.1.0-p4';
export const WARDEN_SCHEMA_VERSION = 1;
export const ORDERS_SCHEMA_VERSION = 1;
export const LEDGER_VERSION = 1;
export const INTENT_VERSION = 1;
/** OpenCode versions the adapter accepts (ADR 0004, owner ruling 2026-11-27): any 2.x at or above 2.2.7, the version the P0 proofs ran on.
 *  1.x and 3.x+ are refused. Each run records the version it actually used. */
export const OPENCODE_MAJOR = 2;
export const OPENCODE_FLOOR = '2.2.7';
export const SUPPORTED_OPENCODE = `>=${OPENCODE_FLOOR} <${OPENCODE_MAJOR + 1}.0.0`;
