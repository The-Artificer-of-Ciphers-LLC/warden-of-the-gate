# warden (P1 walking skeleton)

Production TypeScript/Node package for Warden of the Gate, phase P1 (see [implementation plan](../../docs/prd/0001-warden-of-the-gate.implementation-plan.md)). **Private and unpublished** (`warden-core-unpublished`); the npm scope is a P6 release gate. Not live-ready: no AI effects exist in this phase.

```bash
npm ci && npm run build && npm test          # 59 tests, no network, no credentials
node scripts/evidence.ts                      # regenerates evidence/acceptance-transcript.md
node dist/cli.js --help
```

Lifted deliberately from the P0 spikes (`proof/inbox`, `proof/p0-runtime`): the append-only inbox + label-epoch lease + fenced commit + receipt protocol, the Mac write-ahead journal, label-based stop derived from operator-attributed events, the runner budget finding (step cap does not bound tool calls). Nothing imports the proof code.

## Commands

| Command | What it does |
|---|---|
| `warden setup [--create-config --repo o/n --maintainers a,b] [--create-orders] [--create-labels] [--approve-ceiling]` | prerequisite report; each creation is a separate explicit flag; existing files never overwritten; adopts nothing |
| `warden config validate [--show-effective]` | both YAMLs (Ajv), schema compatibility, effective-policy conflicts, unsafe defaults |
| `warden run --task <name> [--dry-run] [--item N]` | `intake --dry-run` proposes transitions through a read-only store; every other task returns `unsupported` (exit 3) |
| `warden status [--json]` | state, ownership, approvals+expiry, evidence freshness, pending/uncertain ops, credentials, stop + acks; no model, no secrets |
| `warden stop [--global]` / `warden resume --confirm [--global]` | local stop first, then shared stop, confirmed by re-read; unconfirmed is reported as such |
| `warden writer drain` | the one serialized effect path (Actions entry point) |
| `warden event handle --event-path f` | Actions doorbell: `/warden approve\|deny <id> bind=<digest>`, `/warden override <state> <reason>` become durable intents |
| `warden approvals request\|revise\|list\|check` | action / feature-design approvals bound to revision+policy+evidence |
| `warden credentials status\|ack-revocation` | credential controller state; explicit revocation acknowledgement |
| `warden sim ...` | simulated GitHub world for tests/evidence only (`--backend sim:<file>`) |

Exit codes: 0 ok, 1 invalid/refused, 2 usage or unconfirmed, 3 unsupported task, 4 blocked, 5 writer halted.

## P1 acceptance traceability

| P1 acceptance bullet | CLI path | Test evidence |
|---|---|---|
| `setup` checks prerequisites, creates only approved missing files/labels, no overwrite, no adoption/activation | `warden setup` | `e2e: setup ...` |
| `config validate`: malformed/unsupported/conflicting/unsafe; denial prevails; mandatory limits fixed; PR cannot authorize itself | `warden config validate` | `e2e: config validate`, `units: defaults/orders/effective policy` |
| `run --task intake --dry-run`: proposed transition, no mutation; other tasks explicit unsupported | `warden run` | `e2e: run --task intake` (world byte-identical before/after) |
| `status` without a model; fields; no secrets | `warden status` | `e2e: status` |
| `stop`: local vs remote confirmation, unconfirmed reported, writers fail closed, accepted effects reconcilable | `warden stop`, `writer drain` | `e2e: stop`, `writer: crash points` |
| `resume`: explicit, starts no AI, does not restore revoked authority or reset counts | `warden resume --confirm` | `e2e: resume`, `units: retry bound persisted` |
| GitHub-native approve/deny; record before authorize; unauthorized/replayed/stale/conflict fail visibly; 24h expiry | `event handle`, `approvals` | `approvals.test.ts` (11 tests, incl. CLI end to end) |
| Two instances on one host cannot exchange state; issuer outage keeps pending work; recovery never uses a broader PAT | storage + credentials | `units: storage`, `units: two instances`, `credentials.test.ts`, `units: HttpStore` |
| Crash/uncertain effect/duplicate/out-of-order/queue overflow/outage recover (PRD evidence row 6) | `writer drain` | `writer.test.ts` |

## Decisions recorded here (and in the ADRs)

1. **Identity split (ADR 0011/0012):** two identities. The *submit* identity (Mac CLI, event handler) may only append intent comments; the *writer* identity is the only author of ledgers and receipts. The writer rejects ledgers/receipts authored by any other login (`Anomaly`, fail closed) and, when the owner provisions `WARDEN_LEDGER_KEY` (an Actions secret the agent did not create), authenticates ledgers with an HMAC so an edit by the submit identity is detected. Without the key only author checks and receipt divergence repair apply, and that is the stated limit. A single installation token still cannot be narrowed to "inbox only"; this split is a detective control, not a permission boundary.
2. **Stop authority:** operators = `maintainers` plus optional `operators`. The CLI's acting identity must be in that list for its stop to be operator-attributed (`stop` reports `operatorAttributed`). Both instance and global stops persist local protection before remote propagation. Their local latches are independent: confirmed resume clears only the requested scope and reports any remaining local stop.
3. **Replay protection:** intents older than `inbox.maxIntentAgeHours` that cannot be proven new (ledger has dropped its dedupe horizon) are rejected `beyond-dedupe-horizon` (closes the P0 open item).
4. **Throughput:** receipts are de-duplicated from the scan (no per-receipt re-list), `fenceCacheMs` is an opt-in knob for pre-write fence checks (default 0; post-write checks are never cached), and a per-run content-creation budget (`maxCreatesPerRun`, default 80) halts the drain with intents still pending.
5. **Local state failures:** only absent optional JSON state defaults to empty/running. Malformed, unreadable or invalid-shaped stop and credential state raises `STORAGE FAILURE`; it cannot clear revocation, issue credentials or authorize a run.
6. **Maintainer source binding:** event intake and writer verification share one parser. Approval/denial and override intents must match the unedited GitHub-attributed comment on the target item, including command kind, approval/binding IDs and reason.
7. **Journal recovery:** only unedited intents by the authenticated submit identity are adopted. Acknowledgement requires an unedited configured-writer receipt matching the source comment, operation ID and target item. Untrusted or mismatched records leave the operation pending; reconciliation errors are surfaced.

## Known gaps and unverified items

- **No live GitHub result.** `HttpStore` is tested only against a local HTTP server. The real credential issuer (GitHub App JWT -> installation token) is **not implemented**: `--backend github` reports unavailable instead of falling back to any ambient token. This is gated on the parent's App proofs (cross-repo stop, identity split, second identity, scheduled sweep).
- Cross-repository global stop is wired (`inbox.globalControl`) but unverified; an unreadable global control makes the instance stopped.
- Writer-side `assignable` is `() => true`; real GitHub assignability checks belong to P2 (Claim).
- No OpenCode adapter (P3); `AgentRunner`, `BudgetMonitor` and `runValidated` are tested with scripted runners only.
- Setup does not create the inbox/control issues or the Actions workflow; the writer workflow template is P2.
- Decision corpus is a local, per-instance, append-only file fed by `writer drain` on the Mac plus the ledger/receipts on GitHub; export/purge are P5.
