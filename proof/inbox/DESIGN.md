# P0 PROOF-inbox: chosen mechanism

Status: spike evidence. Not a production module. Verdict and blockers: [FINDINGS.md](FINDINGS.md). Raw results: [RESULTS.md](RESULTS.md); reproduce with [README.md](README.md).

## Decision in one paragraph

Durable intents are **append-only comments on a dedicated `warden-inbox` GitHub issue**, enumerated by comment id (a server-assigned total order). One shared **writer** (the Actions drain path) is the only code that edits the **item ledger comment**; the Mac and Actions event handlers only *submit intents*. Exclusive writing is enforced by a **label-epoch lease** (atomic create of `warden-lock-epoch-NNNNNN`; the epoch is a monotonic fencing token) plus a **fenced commit protocol** (fence check, base check, write, read-back, fence check). Every intent ends in exactly one **receipt** comment. Stop state lives in `warden:stop` labels on control issues and is **derived from operator-attributed issue events**, not from the label alone.

Nothing here needs a database, a repository ledger file, or contents-write authority. Everything needs only `issues: write` on the instance repository.

## Why not the obvious alternatives

| Candidate | Verdict | Evidence |
|---|---|---|
| Actions concurrency group / `queue: max` as the queue | Rejected as durability. Fine as a throughput hint. | Default group keeps 1 running + 1 pending; others are cancelled (see RESULTS: overflow). `queue: max` is still capped (100). |
| Comment revision / ETag as compare-and-swap | Rejected. | Probe `comment-patch-has-compare-and-swap`: `If-Match` on `PATCH` comment is not honoured (HTTP 400); no CAS exists. |
| Milestone title as a lock | **Rejected, found by the proof.** | Parallel creates of one title all succeed (probe `milestone-create-is-atomic`: 2 to 6 of 6 parallel creators succeeded per round). Uniqueness is a validation, not a constraint. |
| Label name as a lock | **Adopted.** | 6 rounds x 6 parallel creates: exactly one `201`, five `422 already_exists` every round. |
| Git ref create / ref advance as lock | Works (1 of 8 create; 1 of 5 advance), but needs `contents: write`. Kept as fallback only. | Probes `git-ref-*` in RESULTS. |
| Repository variable as lock | Atomic (`409`), but needs a Variables permission the posting identity should not have. | Probes `git-ref-*` in RESULTS. |
| Local-only journal | Insufficient alone (Mac off => deterministic events have no durable home). Kept as the Mac's write-ahead journal. | S15 |

## Objects and who may write them

| Object | Where | Writer | Purpose |
|---|---|---|---|
| Intent | comment on inbox issue, body = marker + canonical JSON | any allow-listed author (App identity, Mac identity) | durable request |
| Receipt | comment on inbox issue, one per intent comment | the lease holder only | acknowledgement; evidence for repair |
| Item ledger | one comment per item (marker `warden-ledger:v1`) | the lease holder only | **the single authority** for item state, owner, applied operation ids |
| Lease | label `warden-lock-epoch-NNNNNN`, description `holder|expiresAtMs|released` | acquirer of that epoch | mutual exclusion + fencing token |
| Stop | label `warden:stop` on a control issue; events API gives actor + time | operators only (derived) | instance / global stop |
| Mac journal | `journal.jsonl`, `0600`, fsync per record | Mac submit path | write-ahead copy of local results |

Receipts and the lease are *not* item ledgers. The ledger stays the only place item state is read from during normal operation. Receipts are used for acknowledgement and for detecting/repairing a lost ledger update (below); that is the one place a second record influences the ledger, and it only fires on detected divergence.

## Request admission

1. **Edge validation (submitter).** Canonical JSON is built, `opid` computed, size checked (`MAX_INTENT_BYTES = 8 KiB`). Oversize is a thrown error at the edge, never truncated. Large evidence stays local; the intent carries a digest/reference only.
2. **Write-ahead (Mac).** The intent is fsynced to the local journal as `pending` *before* any network call.
3. **Post.** `POST /issues/{inbox}/comments`. A lost reply leaves the journal entry `pending`; reconciliation looks the opid up in the inbox before resubmitting.
4. **Admission at drain.** Each pending intent is checked: author on the allow-list; comment unedited (`updated_at == created_at`); body parses; `opid` equals the hash of the body's canonical core (detects forgery/edit); size within limit; kind known. Any failure produces a visible `quarantined` receipt with a reason. Nothing is dropped silently.

## Immutable operation identity

`opid = "op_" + sha256(canonical({v, kind, item, source, actor, payload, causalAfter}))[0:32]`. The `source` carries the originating event identity (for example the GitHub comment id or the local result id), so a redelivery of the same trigger yields the same `opid`, and two different people's claims yield different ones. The identity is verifiable by anyone who can read the comment, which is what makes edits and forgeries detectable.

## Authorization

* Who may *submit*: comment author on `allowedAuthors` (App bot login, Mac operator identity). The inbox issue should be locked so only collaborators can comment. A contributor's `/claim` text is turned into an intent by the Actions handler; the intent's `actor` is the verified event author, and the writer rejects a claim whose `actor` differs from `claimant.id`.
* Who may *change stop/resume*: only logins on `operators`, judged from issue events (unforgeable actor). Unauthorized label changes are ignored and reported.
* What a submitter may *cause* is decided by the writer against current ledger state, never by the submitter.
* Honest limit: a GitHub App installation token cannot be narrowed to "inbox comments only". Whoever holds the `issues: write` token could also edit a ledger comment. The writer's integrity therefore rests on (a) only the writer code holding that token on the Mac side being the submit path, and (b) divergence detection + receipt repair. Separate submit/write Apps are a P1 option.

## Serialization (what is actually enforced)

Single writer by construction: only `Writer.drain()` mutates ledgers and posts receipts, and it does so only while holding the lease.

* **Lease acquire.** List `warden-lock-epoch-*` labels, take the highest epoch `E`. If none, or released, or expired by server-corrected time, create `E+1`. Exactly one concurrent creator succeeds (`422` for the rest). The expiry timestamp comes from the holder's server-corrected clock (HTTP `Date` skew), not an unchecked local clock.
* **Fenced commit.** Before every ledger write: (1) `assertHeld` re-lists labels and confirms own epoch is still highest and unexpired (renewing inside the margin); (2) optimistic *base check*: re-read the ledger and require the `seq` this writer started from; (3) write; (4) read back and verify `{seq, epoch}`; (5) `assertHeld` again. Any failure throws `Fenced`; the writer stops and performs **no external effect**.
* **Effects only after commit.** Ownership is decided and committed first (commit point); assignment, labels and notices follow, each preceded by a stop re-read, a fence check and a fresh read of the item (closed items are never acted on).
* **Residual window, stated plainly.** A writer that is frozen *after* step (2) and *before* step (3) for longer than the lease TTL can still land one stale ledger write. The post-write fence detects it (the writer halts, performs no effects), and the next drain detects the ledger-versus-receipt divergence and repairs by folding receipts. Scenario S13(b) forces exactly this and records the stale write, the detection and the repair. This is **not** a distributed compare-and-swap and the proof does not claim one.
* **Negative controls.** Without the lease, concurrent read-modify-write loses updates (S16). The same lease built on a non-atomic create (modelled on milestones) also loses updates, which is why the primitive choice matters.

## Enumeration and recovery

* Pending = intent comment with no receipt. Enumeration is a paginated list of the inbox issue in id order; no hidden queue state exists. Cost is `ceil(comments/100)` calls per scan and is bounded by retention.
* A crash leaves: an `applying` op in the ledger with its plan and step, a possibly held lease, and intents without receipts. The next drain waits out the lease (TTL), takes a higher epoch, resumes each op from the recorded step.
* Effects are idempotent: assign and label are naturally idempotent; notices carry a marker `<!-- warden-effect:opid:step -->` that is searched before posting. Reply-lost is therefore the same case as crash-before-record.
* **Level-triggered backstop.** Triggers are only doorbells. Every trigger, plus a scheduled sweep, runs the same drain over the whole inbox, so a lost, duplicated, cancelled or reordered trigger cannot lose an intent.
* **Out-of-order.** Intents may name `causalAfter`. Until the predecessor is applied the intent stays pending (visible as `deferred`); if the predecessor was rejected/failed the dependent is rejected; after `causalTimeoutMs` it fails visibly.

## Acknowledgements

One receipt per intent comment: `applied | rejected | duplicate | failed | quarantined`, carrying `opid`, `epoch`, `seq`, and for state-changing results the resulting `{state, owner}`. Receipt posting is idempotent (re-list before post). The ledger op status is written before the receipt, so a lost receipt is regenerated on the next drain. The Mac marks a journal entry `acked` only from a receipt.

## Retry bounds

`MAX_ATTEMPTS = 5` per operation, counted in the ledger so a cold start cannot reset it. After the fifth failure the op becomes `failed` with a receipt and stays visible in status until an operator deals with it. Between attempts the backoff is the doorbell/sweep cadence (not an in-process loop). Lease acquisition polls with jitter for a bounded wait. API rate limits (`403/429`, `Retry-After`) are honoured with a bounded retry; persistent limiting surfaces as an error, not a silent drop.

## Payload limits and capacity

Intent: 8 KiB canonical JSON (comment limit is 64 KiB; ledger is guarded at 60 000 characters). Ledger keeps the most recent 256 op ids per item (the dedupe horizon). A drain handles at most `maxIntentsPerRun` intents and the next doorbell continues. Content-creation secondary rate limits (about 80 creates per minute) are the practical throughput ceiling; the live proof measured the retries.

## Retention

Applied/rejected/duplicate intent+receipt pairs older than the retention window are deleted by `compact` under the lease. Failed/quarantined pairs are kept four times longer. Pending intents are never deleted. A late redelivery of a compacted op is still a no-op because the ledger keeps applied op ids; a redelivery older than the ledger horizon cannot be recognized and must be rejected by an age rule in P1 (recorded as an open item).

## Failure visibility

`warden status` data (proof: `cli status`): pending count and oldest age, receipts by result, lease holder/epoch/expiry, stop state with reasons, and which environments acknowledged the stop. Quarantine/failed/deferred/anomaly all produce a receipt or a halted drain report (non-zero summary) and an Actions job summary. A competing second ledger comment halts the writer (fail closed) rather than guessing.

## Stop and control (Mac and Actions)

* **Instance stop**: label `warden:stop` on the instance control issue. **Global stop**: same mechanism on a control issue that every instance reads. In the proof both live in the sandbox repo; the *cross-repository* read (Actions in repo X reading a control repo) needs a token wider than `GITHUB_TOKEN` and is **unverified** until the GitHub App (ADR 0011) exists.
* **State derivation**: stopped = label present, or the last operator-attributed event was `labeled`. A non-operator removing the label cannot resume (the writer still reports stopped and records the tamper). A read error means *unknown means stopped*.
* **Visibility**: the writer re-reads both scopes before every task and before every effect, so a stop issued mid-run takes effect between effects (S10), not at the next run. Actions `vars` are a start-of-run snapshot, and `GITHUB_TOKEN` cannot read repo variables (see RESULTS), so a variable is not used.
* **Acknowledgement**: when a writer halts on stop it posts one `warden-stop-ack env=<mac|actions>` comment on the control issue. `status` shows which environments confirmed; a missing ack is reported as unconfirmed, not as global success.
* **Resume**: only an operator removing the label (explicit, attributed). Resume does not drain by itself.

## Trust root (proposed, partly unverified)

* Trust root for *who may operate*: the operator login list and the App installation, held in the protected operator store (ADR 0011), mirrored into `.github/warden.yml` maintainer identities for the Actions-side writer. The writer must run workflow code from the default branch only (`issue_comment`, `schedule`, `workflow_dispatch`; never `pull_request_target` with PR code), so a PR cannot change its own authorization.
* Verified here: actor attribution on issue events; allow-list authorization of inbox authors; unauthorized-actor stop tamper ignored.
* Unverified here (no App approved): App-token issuance, installation scoping, key custody, provider recovery after a revoked trust root. These stay blocked for P1 and are listed in the ADRs.
