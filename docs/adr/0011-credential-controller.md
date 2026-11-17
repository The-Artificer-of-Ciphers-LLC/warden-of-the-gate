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

## Consequences

Credential automation preserves already-delegated capabilities; it is not permission escalation. Provider-specific root-key recovery needs a supported mechanism and an explicit operational recovery procedure rather than an impossible guarantee of authentication without any valid trust root.

See the [primary-source credential research](../research/PRD-BEST-PRACTICES.md#credential-continuity-follow-up) and [authority gates](0008-tiered-autonomy-and-merge-gates.md).
