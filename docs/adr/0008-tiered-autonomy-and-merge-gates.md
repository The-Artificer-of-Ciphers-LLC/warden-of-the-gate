# Tiered autonomy with independent risk, evidence and severity gates

- **Status:** Draft
- **Date:** 2026-11-16
- **Decided by:** @trek-e

## Context

The first design never merged: every PR ended at a human gate. The owner redefined the factory's role: merging and approving is what a software factory does, with human oversight. Authority must be grounded in explicit scope, change risk and verified evidence, not a model's confidence score.

## Decision

- **Tiered autonomy:** explicit scope/impact rules and independent verification determine eligibility. Severity and change risk are separate; uncertainty escalates. A clean diff or self-rated confidence cannot override risk or authority restrictions.
- **Auto-merge is the live default for eligible work**, including contributor PRs and factory-authored PRs. Shadow mode performs no GitHub writes; live actions are enabled through rollout gates. Warden never writes to a contributor's branch.
- **Merge gate:** a blocker finding always stops a merge — not configurable. Major, minor and nit block only when enabled in config; all three are on by default (any nit can become a major with one change).
- Merge additionally requires current accepted review inputs, task-appropriate evidence, authorized scope, valid approvals, all GitHub-required checks/reviews, non-draft status and no stop/hold. Expected-head protection and outcome reconciliation prevent treating enqueue as merge.
- Findings route to contributor correction or factory Rework. Waiting CI does not consume an AI session or necessarily require a human decision; only actual uncertainty/approval needs escalate.
- Enhancement and feature scope and acceptance criteria, `wontfix`, high-risk work, and changes to workflows, standing orders, access policy, `MAINTAINERS`, or Warden's own authority need the maintainer.
- The decision corpus informs proposals for expanding narrowly scoped standing authority. A maintainer approves each expansion before it takes effect; historical agreement alone never grants new permissions.
- Discord can carry revision-bound approval decisions from explicitly authorized maintainer identities. Record them on GitHub before acting. A Warden approval does not bypass repository-required reviews or checks.
- One-time action approvals expire after 24 hours by default, configurable, or earlier on invalidated inputs. Approved design/scope persists until materially changed; silence and expiry never grant consent.
- Routine verified automation-origin dependency/CVE fixes auto-approve/merge within authority. Breaking, migration and high-impact changes escalate unless specifically preauthorized.

## P0 `PROOF-inbox` note: stop and decision authority

Evidence in [`proof/inbox/RESULTS.md`](../../proof/inbox/RESULTS.md). Stop (global and instance) is a control label whose state is derived from operator-attributed GitHub events; every writer re-reads it before each task and each effect, an unreadable control means stopped, and each environment posts a stop acknowledgement so status can report local versus remotely confirmed state. A maintainer's approval or denial must likewise be accepted only from an identity on the operator/maintainer list as recorded by GitHub's own event attribution, never from comment text alone. Cross-repository global stop remains unverified until the GitHub App exists (ADR 0011).

## Consequences

- The human gate shrinks to escalations; success metrics track auto-merge rate and revert/escape rate on auto-merges to keep the thresholds honest.
- Contributor PRs: review is report-only; findings go back to the author (the factory never writes to their branch).

## P1 implementation record (2026-11-18, `CORE-approvals`, `CORE-stop`)

Code: [`packages/warden/src/approvals`](../../packages/warden/src/approvals/approvals.ts); tests `test/approvals.test.ts`. GitHub-native path: the writer posts `/warden approve|deny <id> bind=<digest>` instructions on the item; the Actions handler (`warden event handle`) turns the maintainer's comment into an intent using the GitHub-attributed author; the writer re-fetches the source comment, checks author and unedited state, checks the maintainer list from the default-branch policy, the binding digest, the current revision/policy/evidence and the expiry, then records the decision before anything can use it. Unauthorized, forged, replayed, conflicting, stale and expired decisions fail visibly. Action approvals expire after `approvals.actionExpiryHours` (default 24, schema maximum 168) and expiry is re-checked at use time; feature-design approvals persist until the criteria digest changes. The author of a change cannot approve it (`requireIndependentApprover`). Standing-order `deny` prevents even requesting an approval. Merge itself (P4) is not implemented.
