# Tiered autonomy with independent risk, evidence and severity gates

- **Status:** Draft
- **Date:** 2026-11-24 (revised from 2026-11-16)
- **Decided by:** @trek-e

## Context

The first design never merged: every PR ended at a human gate. The owner redefined the factory's role: merging and approving is what a software factory does, with human oversight. Authority must be grounded in explicit scope, change risk and verified evidence, not a model's confidence score.

## Decision

- **Tiered autonomy:** explicit scope/impact rules and independent verification determine eligibility. Severity and change risk are separate; uncertainty escalates. A clean diff or self-rated confidence cannot override risk or authority restrictions.
- **Auto-merge is the live default for eligible work**, including contributor PRs and factory-authored PRs. Shadow mode performs no GitHub writes; live actions are enabled through rollout gates. Warden does not write to a contributor's branch, with one exception: it may push fixes for failing CI (revised 2026-11-24, see below).
- **Merge gate:** a blocker finding always stops a merge — not configurable. Major, minor and nit block only when enabled in config; all three are on by default (any nit can become a major with one change).
- Merge additionally requires current accepted review inputs, task-appropriate evidence, authorized scope, valid approvals, all GitHub-required checks/reviews, non-draft status and no stop/hold. Expected-head protection and outcome reconciliation prevent treating enqueue as merge.
- **CI fixes on contributor PRs (owner ruling 2026-11-24: "Let it push fixes"):** red CI does not skip review. Review finds what is failing, and Warden pushes the fix to the contributor's branch. The push fixes only that diagnosed failure, adds commits on top of the reviewed head as the App, and never force-pushes, rebases or amends; if the head moved, nothing is pushed. The new head returns to Review. When a fork has "Allow edits by maintainers" off, GitHub refuses the push, or the fix would change workflow files, Warden posts the cause and a patch for the author instead.
- Other findings route to contributor correction or factory Rework. Waiting CI does not consume an AI session or necessarily require a human decision; only actual uncertainty/approval needs escalate.
- Enhancement and feature scope and acceptance criteria, `wontfix`, high-risk work, and changes to workflows, standing orders, access policy, `MAINTAINERS`, or Warden's own authority need the maintainer.
- The decision corpus informs proposals for expanding narrowly scoped standing authority. A maintainer approves each expansion before it takes effect; historical agreement alone never grants new permissions.
- Discord can carry revision-bound approval decisions from explicitly authorized maintainer identities. Record them on GitHub before acting. A Warden approval does not bypass repository-required reviews or checks.
- One-time action approvals expire after 24 hours by default, configurable, or earlier on invalidated inputs. Approved design/scope persists until materially changed; silence and expiry never grant consent.
- Routine verified automation-origin dependency/CVE fixes auto-approve/merge within authority. Breaking, migration and high-impact changes escalate unless specifically preauthorized.

## P0 `PROOF-inbox` note: stop and decision authority

Evidence in [`proof/inbox/RESULTS.md`](../../proof/inbox/RESULTS.md). Stop (global and instance) is a control label whose state is derived from operator-attributed GitHub events; every writer re-reads it before each task and each effect, an unreadable control means stopped, and each environment posts a stop acknowledgement so status can report local versus remotely confirmed state. A maintainer's approval or denial must likewise be accepted only from an identity on the operator/maintainer list as recorded by GitHub's own event attribution, never from comment text alone. Cross-repository global stop remains unverified until the GitHub App exists (ADR 0011).

## Consequences

- The human gate shrinks to escalations; success metrics track auto-merge rate and revert/escape rate on auto-merges to keep the thresholds honest.
- Contributor PRs: review findings go back to the author. The only factory writes to a contributor's branch are the CI fixes above; they count against the factory rework limit and are not author activity for clocks or fix rounds. Capability tests must prove fork pushes succeed with maintainer edits allowed and are refused without them before this is live.

## P1 implementation record (2026-11-18, `CORE-approvals`, `CORE-stop`)

Code: [`packages/warden/src/approvals`](../../packages/warden/src/approvals/approvals.ts); tests `test/approvals.test.ts`. GitHub-native path: the writer posts `/warden approve|deny <id> bind=<digest>` instructions on the item; the Actions handler (`warden event handle`) turns the maintainer's comment into an intent using the GitHub-attributed author; the writer re-fetches the source comment, checks author and unedited state, checks the maintainer list from the default-branch policy, the binding digest, the current revision/policy/evidence and the expiry, then records the decision before anything can use it. Unauthorized, forged, replayed, conflicting, stale and expired decisions fail visibly. Action approvals expire after `approvals.actionExpiryHours` (default 24, schema maximum 168) and expiry is re-checked at use time; feature-design approvals persist until the criteria digest changes. The author of a change cannot approve it (`requireIndependentApprover`). Standing-order `deny` prevents even requesting an approval. Merge itself (P4) is not implemented.

Offline review hardening: source verification looks up the comment on the target item and independently parses it with the event handler's shared parser. The command kind, approval ID, binding and reason must match the submitted approval/denial or override exactly. Both global and instance stops persist independent local latches before propagation; confirmed resume clears only its own scope and reports any other local stop still in force. Corrupt or unreadable local stop state fails explicitly rather than reporting running. These controls are covered by offline regression tests.

The later [App proof](../../proof/inbox/FINDINGS.md#owner-approved-app-proof-2026-11-18) demonstrates cross-repository control reads from Mac and real Actions, explicit operator resume and fail-closed behavior after installation-token revocation. The subsequent [production P1 acceptance](../../proof/inbox/FINDINGS.md#production-p1-acceptance-2026-11-18) verifies the actual CLI and Actions writer end to end: source-bound maintainer approval, material-revision invalidation, human-authenticated cross-repository global stop/resume, writer acknowledgement, ledger-integrity rejection and revoked-access fail closed. Human remote control requires the explicitly selected, verified operator GitHub CLI identity; the App does not acquire human resume authority. No production activation follows from these sandbox proofs.
