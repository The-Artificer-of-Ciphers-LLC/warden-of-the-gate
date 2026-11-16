# Harness differences live in AgentRunner adapters; the core is harness-agnostic

- **Status:** Accepted
- **Date:** 2026-11-16
- **Decided by:** @trek-e

## Context

Warden must run on open harnesses (opencode, pi; Bionic interactive), and each differs in how it launches headless sessions, produces structured output and pins tools — but the factory's contract (schema-validated results; "AI proposes, scripts dispose") must not change per harness.

## Decision

- A thin `AgentRunner` interface is the only seam between warden-core and a harness: an adapter launches a session with fixed inputs (packet files, tool surface, result schema) and returns a structured result plus transcript path.
- The runner re-validates every `structuredOutput` with Ajv regardless of which harness produced it. Harness differences (how structured output is obtained, how tools are pinned) live inside each adapter.
- v1 adapters: opencode (official SDK, in-process; native JSON-schema output) and pi (official SDK; structured output via prompt-level or model-layer schema enforcement). Bionic is an interactive surface, not a batch adapter — it has no headless session control (verified).
- warden-core (state machine, ledger, gates, poster, sweep) is untouched by harness choice.

## Consequences

- Adding a harness means adding an adapter plus its preflight; the core, config schema and result contracts stay stable.
- The Ajv-validation invariant is what makes "any open harness" safe: a hostile or malformed result fails validation and never reaches the poster.
