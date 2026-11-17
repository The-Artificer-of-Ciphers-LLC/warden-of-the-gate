# Harness differences live in AgentRunner adapters; the core is harness-agnostic

- **Status:** Draft
- **Date:** 2026-11-16
- **Decided by:** @trek-e

## Context

Warden must run on open harnesses (opencode, pi; Bionic interactive), and each differs in how it launches headless sessions, produces structured output and pins tools — but the factory's contract (schema-validated results; "AI proposes, scripts dispose") must not change per harness.

## Decision

- A thin `AgentRunner` interface is the only seam between warden-core and a harness: an adapter launches a session with fixed inputs (packet files, tool surface, result schema) and returns a structured result plus transcript path.
- The runner re-validates every `structuredOutput` with Ajv regardless of which harness produced it. Harness differences (how structured output is obtained, how tools are pinned) live inside each adapter.
- The MVP validates one OpenCode adapter first. Pi follows against the same contract; Bionic is an optional interactive surface, not a required batch adapter. Select and pin the supported harness version through a capability spike rather than copying historical SDK examples.
- Harness defaults are not Warden policy. Validate effective tool permissions, resolved models, and policy behavior against Warden's own contracts, including no silent remote fallback and restrictive standing-order precedence.
- warden-core (state machine, ledger, gates, poster, sweep) is untouched by harness choice.

## Consequences

- Adding a harness means adding an adapter plus its preflight; the core, config schema and result contracts stay stable.
- Ajv rejects malformed results, but valid JSON is not evidence of safe intent. The deterministic core also validates scope, identities, current revisions/policy, evidence and approvals before submitting any effect.
- Effective tool permissions, actual local provider resolution, cancellation, isolation and protected verification results require capability tests against the pinned harness. Adapter availability alone does not establish safety.
