# GitHub item ledgers with a serialized Actions state writer

- **Status:** Draft; P0 `PROOF-inbox` mechanism selected and demonstrated against the disposable sandbox (see Proof results)
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

## Selected mechanism (P0 `PROOF-inbox`, 2026-11-18)

Spike code, design and raw evidence: [`proof/inbox/`](../../proof/inbox/README.md) ([design](../../proof/inbox/DESIGN.md), [results](../../proof/inbox/RESULTS.md)). Everything below needs only `issues: write` on the instance repository; no database, no repository ledger file, no contents-write authority.

- **Durable inbox:** append-only intent comments on a dedicated `warden-inbox` issue, enumerated in server-assigned comment-id order. An intent is `{v, kind, item, source, actor, payload, causalAfter, opid}`; `opid = sha256(canonical core)` so identity is content-derived and verifiable. Actions triggers and the Mac are only *doorbells and submitters*; a scheduled sweep runs the same level-triggered drain.
- **Admission:** edge size limit 8 KiB (rejected, never truncated); author allow-list; comment unedited; body hash equals `opid`; anything else yields a visible `quarantined` receipt.
- **Single writer:** only the drain path edits item ledgers and posts receipts, and only while holding a **label-epoch lease** (`warden-lock-epoch-NNNNNN`, created with GitHub's atomic label-name uniqueness, which probes confirmed; milestone titles are *not* atomic and must not be used). Ledger writes are **fenced** (lease check, base-`seq` check, write, read-back, lease check) and external effects follow only a verified commit. An Actions concurrency group is a throughput hint, not the correctness mechanism.
- **Acknowledgement:** one receipt per intent comment (`applied | rejected | duplicate | failed | quarantined`) carrying `opid`, epoch, seq and the resulting owner/state. The ledger records the op before the receipt, so lost receipts regenerate. The Mac journal marks `acked` only from a receipt.
- **Recovery:** pending = intent without receipt. `applying` ops resume from their recorded step; effects are idempotent (native, or marker-checked before posting). Out-of-order intents wait on `causalAfter`. Retry bound 5, persisted in the ledger. A competing second ledger comment halts the writer (fail closed).
- **Known residual window:** a writer frozen after its last pre-write check for longer than the lease TTL can land one stale ledger write. It is detected by the post-write fence (no effect is performed) and repaired on the next drain by folding receipts. This is not a distributed compare-and-swap; no exactly-once claim is made.
- **Retention:** applied pairs expire after a configured window (failed/quarantined kept 4x; pending never deleted); the ledger keeps the last 256 applied op ids as the dedupe horizon. A redelivery older than that horizon needs an age-based rejection rule in P1 (open).
- **Stop storage:** `warden:stop` label on instance and global control issues; effective state is derived from **operator-attributed issue events**, so a non-operator cannot resume by removing the label, and an unreadable control issue means stopped. Both scopes are re-read before each task and each effect. Writers post a per-environment stop acknowledgement. Repo Actions variables are not used: `GITHUB_TOKEN` cannot read them and `vars` is a start-of-run snapshot.

## Proof results and blockers

Verdict and blockers: [`proof/inbox/FINDINGS.md`](../../proof/inbox/FINDINGS.md); raw results generated into [`proof/inbox/RESULTS.md`](../../proof/inbox/RESULTS.md). Passed against the sandbox: 17/17 scenarios offline and live, 16/16 Actions-side checks (real runner: 12 doorbells, 10 cancelled by GitHub, all 12 intents applied once; 18 increments from 4 Actions runners + 2 Mac processes with 0 lost versus 11 lost without the lease). Gating P1:

- **Global stop across repositories** is unverified: Actions in repository X reading a control repository needs a credential wider than `GITHUB_TOKEN` (the GitHub App of ADR 0011). Until demonstrated, global stop is only proven as a second control scope inside one repository; do not claim cross-instance stop.
- **Submit-versus-write separation** is not enforceable with one installation token: the Mac's `issues: write` token could also edit a ledger comment. P1 must either use two identities (submit-only vs writer) or accept divergence detection plus repair as the control.
- **Throughput and secondary rate limits:** about 8.5 s and roughly 25 API calls per intent in the spike; the shared login hit GitHub's secondary content-creation limit during the proof. P1 must batch/skip redundant fence lists and budget content creation.
- **Scheduled sweep not observed:** no `schedule` run fired in about an hour; the backstop is proven only via `workflow_dispatch`.

## Consequences

This preserves housekeeping availability without adding a separate always-on database service, at the cost of Actions round trips and an explicit dependency on Actions for live control-plane mutations. A capability spike must establish the concrete durable inbox and prove recovery before live posting is enabled.

See the [concurrency research](../research/PRD-BEST-PRACTICES.md#shared-actionslocal-writer-follow-up).
