# Credential continuity through a bounded credential controller

- **Status:** Draft
- **Date:** 2026-11-17
- **Decided by:** @trek-e

## Context

Auto-merge is a core factory capability. Routine credential expiry must not silently reduce Warden to report-only operation, but giving a model unrestricted credential-minting authority would let it expand the very permissions meant to constrain it.

## Decision

- Use a GitHub App as the posting identity, with short-lived credentials scoped to the repository and operation.
- A trusted credential controller automatically issues, renews, rotates, and recovers credentials within an operator-approved authority ceiling. Automation is the default, with an explicit operator opt-out.
- Enforce issuance policy outside the AI model. An agent may diagnose failures and prepare requests but cannot invent permission grants, expand the ceiling, or override deliberate revocation.
- Keep root credentials and GitHub write credentials out of agent sessions. Use the deployment's protected credential store or signing service; never distribute a shared App private key in the package.
- Record issuance, rotation, revocation, policy decisions, failures, and recovery outcomes without logging credential values. Report actionable failures and relevant lifecycle changes.
- If an issuer is unavailable or no valid credential can be obtained, keep the service and recoverable queue running, suspend only affected authenticated operations, continue independent work, and retry recoverable failures with bounds and backoff. Automatically resume when authorized credentials recover.
- New provider permissions and replacement of revoked trust roots remain subject to the provider's actual authorization mechanisms. No fallback may silently use a broader personal credential, bypass repository rules, or claim an unauthenticated write succeeded.

## P0 `PROOF-inbox` findings: authority, stop storage and trust root

Evidence: [`proof/inbox/RESULTS.md`](../../proof/inbox/RESULTS.md). The proof used only the operator's existing `gh` login on the disposable sandbox and the per-run `GITHUB_TOKEN`; **no GitHub App, PAT or secret was created**, so the items marked unverified remain open gates for P1.

- **Authority/stop storage (selected):** the protected operator store holds the operator login list, the App installation reference and the authority ceiling. The Actions-side copy of *who may operate* is the maintainer identity list in `.github/warden.yml`, read by workflow code from the default branch only (never from a PR). Stop state is a `warden:stop` label on control issues whose effective value is derived from issue events attributed to operator logins (ADR 0012).
- **Verified:** issue events carry the acting identity; a non-operator (`github-actions[bot]`) removing the stop label does not resume operation; unreadable control state fails closed; inbox authorship is allow-listed.
- **Verified limit:** `GITHUB_TOKEN` cannot read or write repository Actions variables, and `vars` is a start-of-run snapshot, so stop cannot live in a variable for the Actions writer.
- **Unverified (blocked on an approved test App):** installation-token issuance and renewal, scoping to one repository, cross-repository read of a global control location, key custody, and provider-supported recovery after a revoked trust root.
- **Open design point:** one installation token cannot be narrowed to "append to inbox only", so the credential that submits intents can also edit item ledgers. P1 should issue a submit-only identity separate from the writer identity, or record divergence detection and receipt repair as the compensating control.

## Consequences

Credential automation preserves already-delegated capabilities; it is not permission escalation. Provider-specific root-key recovery needs a supported mechanism and an explicit operational recovery procedure rather than an impossible guarantee of authentication without any valid trust root.

See the [primary-source credential research](../research/PRD-BEST-PRACTICES.md#credential-continuity-follow-up) and [authority gates](0008-tiered-autonomy-and-merge-gates.md).
