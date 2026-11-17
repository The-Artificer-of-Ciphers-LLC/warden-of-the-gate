# GitHub item ledgers with a serialized Actions state writer

- **Status:** Draft
- **Date:** 2026-11-17
- **Decided by:** @trek-e

## Context

Bookkeeping must continue while the pilot Mac is off, and local AI results must update the same durable item state. GitHub comment updates do not provide a general compare-and-swap mechanism, so independent local and Actions writers cannot safely rely on a comment revision counter or a Mac-local lock.

## Decision

- One Warden-owned ledger comment per issue or PR is authoritative for item state and findings. Labels are its searchable projection, with an explicit authorized maintainer-override path.
- Intake, Claim, Sweep, and local result application share one serialized Actions posting path. Local AI produces validated action intents rather than competing item-ledger updates.
- Retain durable operation intents independently of the bounded Actions pending queue. Reconcile missed triggers, interrupted application, stale results, and accepted-but-unacknowledged writes.
- Re-read current item state, evidence, policy, approvals, and stop controls before an effect. An operation's successful enqueue is not evidence that the effect completed.
- Claims require eligible unclaimed state at application time; serialization must not merely order two requests that both overwrite ownership. Confirm GitHub assignment before acknowledging success.
- Keep a durable local operations/recovery journal. Maintainer decisions are recorded on GitHub and retained in the scoped decision corpus.
- Do not create a competing repository ledger file. Do not fall back to unsynchronized local mutations during an Actions outage.

## Consequences

This preserves housekeeping availability without adding a separate always-on database service, at the cost of Actions round trips and an explicit dependency on Actions for live control-plane mutations. A capability spike must establish the concrete durable inbox and prove recovery before live posting is enabled.

See the [concurrency research](../research/PRD-BEST-PRACTICES.md#shared-actionslocal-writer-follow-up).
