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

## P1 implementation record (2026-11-18, `CORE-credentials`)

Code: [`packages/warden/src/credentials`](../../packages/warden/src/credentials/controller.ts); tests `test/credentials.test.ts`, `test/github-app.test.ts`, `test/units.test.ts` (HttpStore). Status: **production App issuer and explicit live backend implemented; production acceptance and owner-approved trust-root recovery are recorded separately from the historical P0 proof.**

- **Controller:** enforces the operator ceiling (repositories, permission levels) outside any model, single-flight issuance, proactive renewal, rotation, bounded persisted exponential backoff (a cold start cannot reset it), sticky persisted revocation cleared only by an explicit audited operator acknowledgement, final (non-retried) provider denial, explicit opt-out, redacted append-only lifecycle audit. Tokens exist only in memory.
- **No automatic fallback:** App issuance/controller code never reads ambient credentials (asserted by a source test). The owner explicitly approved `--operator-auth gh` for direct human stop/resume, with the authenticated login checked against the selected configured operator and environment token overrides excluded. This path is not a fallback for App failure. Likewise, only `--writer-auth actions` selects the matching repository runner's `GITHUB_TOKEN`; explicit submit/control secret selectors are separate. Missing or unknown sources are refused.
- **Production issuer:** a JWT signed using an operator-provisioned, protected local key requests exactly one repository and the specified permissions. Repository, permission and lifetime over-grants are rejected and token revocation attempted. `credentials configure --confirm` writes only an installation reference; replacement needs explicit consent. The global control repository has a separate read-only ceiling, never an expansion of the submit/write grant.
- **Revocation and concurrent scopes:** an unexpected GitHub 401 for an issued credential sets the same sticky revocation latch as revoked App issuance. An in-flight issuer completion cannot overwrite revocation. Ceiling checks run before cache/single-flight reuse, and different permission scopes cannot borrow a cached or in-flight credential.
- **Durable-state failure:** only a missing optional state file defaults to no credential history. Unreadable, malformed or invalid-shaped persisted records raise a storage failure in both issuance and status paths; corruption cannot reset revocation or backoff.
- **Submit versus writer identity (decision):** two identities. The submit identity (Mac CLI, Actions event handler) appends intent comments only; the Actions writer is the sole author of ledgers and receipts. The writer rejects ledgers/receipts from any other author and can authenticate ledgers with an owner-provisioned HMAC key. This is a *detective* control: the installation token cannot be narrowed below `issues: write`, so it is not a permission boundary. Distinct App/Actions authors were demonstrated in the P0 proof; the P1 acceptance harness exercises the production writer and integrity checks.
- **Live App proof:** [evidence and preserved failures](../../proof/inbox/FINDINGS.md#owner-approved-app-proof-2026-11-18). Approved App installation on two disposable sandboxes; repository/permission-narrowed installation-token issuance; local key protected outside the repository; distinct App/Actions authors; cross-repository control reads on Mac and real Actions; read-only write denial; revoked installation token yields 401 and fail-closed control state. Temporary secret/workflow removed and tokens revoked; the private key was never uploaded.
- **Production acceptance:** the [P1 harness](../../proof/inbox/src/p1-live-proof.ts) exercises the actual CLI, proactive App renewal, Mac journal recovery, real Actions writer, source-bound approvals, cross-repository stop/resume, ledger tampering and revoked control-token fail-closed behavior. Its first report preserves a status failure caused by the sandbox's legacy P0 ledger; a failing regression reproduced it and status now reports the unsupported item explicitly without adoption or falsely calling GitHub unreachable.
- **Trust-root recovery verified:** the [separately approved replacement proof](../../proof/inbox/FINDINGS.md#trust-root-replacement-and-recovery-2026-11-18) validated the replacement before deleting the original, observed old-key 401, proved cold starts/config replacement cannot reset revocation, and recovered only after explicit CLI acknowledgement. A second real installation-token revocation also latched and required acknowledgement. Five of six approved test tokens were issued and all revoked. Provider read enforcement propagated through 200, 200, then 401; no immediate-revocation guarantee is claimed.
- **Still gated independently:** observed scheduled execution (gate changed 2026-11-28 by [ADR 0025](0025-external-dispatch-for-sweep.md): the sweep is started through `workflow_dispatch` by an external scheduler). The only valid sandbox signing key is the protected replacement outside the repository; no production installation or production activation is implied.
