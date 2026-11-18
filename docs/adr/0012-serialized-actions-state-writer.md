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

## P1 implementation record (2026-11-18, `CORE-state`, `CORE-writer`, `CORE-storage`)

Code: [`packages/warden/src/writer`](../../packages/warden/src/writer/writer.ts), [`state`](../../packages/warden/src/state/model.ts); tests `test/writer.test.ts`, `test/approvals.test.ts`, `test/e2e.test.ts` (offline fake GitHub; **not yet run against the live sandbox**).

- The P0 mechanism is implemented as production code over a typed ledger (issue/PR workflow states, independent facets, ownership, processing lease, attempts, evidence identity with PR-only `head`, obligations, approvals, applied ops). Reductions are pure functions (`reduce.ts`); all effects, including maintainer overrides and approval decisions, go through the one writer.
- **Closed P0 open item:** a redelivery older than `inbox.maxIntentAgeHours` once the ledger has dropped its dedupe horizon is rejected `beyond-dedupe-horizon`.
- **Changed from the spike:** receipts are no longer re-listed per receipt; a content-creation budget per run halts a drain with intents pending; fence-check caching is opt-in; the ledger carries `repository` and the writer refuses a foreign ledger; ledger/receipt authors must be writer identities; optional HMAC ledger integrity.
- **Operating modes:** `shadow` rejects AI-origin intents visibly; a global/instance `warden:dry-run` control makes the writer halt (and acknowledge) before applying any queued or deterministic effect; unreadable controls mean stopped.
- **Protected local state:** per-instance directory (0700/0600, redaction on first write, instance identity pinned), write-ahead journal, decision corpus, separate transcript (30d) and security-audit retention.
- **Recovery trust:** the journal adopts only unedited intents by its authenticated submit identity and acknowledges only unedited configured-writer receipts matching comment ID, operation ID and item. Spoofed or mismatched records cannot suppress resubmission or acknowledge work; reconciliation errors are surfaced rather than discarded.
- **Later App proof:** [four live two-identity scenarios and three real Actions checks](../../proof/inbox/FINDINGS.md#owner-approved-app-proof-2026-11-18) demonstrate App-scoped cross-repository control reads, explicit resume and revoked-access fail-closed behavior. Scenario writers ran locally; separate Actions checks establish runner access and distinct authors. This does not prove full P1 writer integration or permission-level append-only isolation.
- Still open: scheduled sweep, scale/throughput and soak, production issuer/trust-root recovery, and full P1 writer/approval/journal/tamper-detection live acceptance.
