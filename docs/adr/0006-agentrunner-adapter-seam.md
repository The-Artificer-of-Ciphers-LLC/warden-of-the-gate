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

## P0 proof record (2026-11-18, `PROOF-runtime`)

Evidence: [`proof/p0-runtime`](../../proof/p0-runtime/README.md) (`results/runtime.json`). Pinned harness and isolation backend are recorded in [ADR 0004](0004-local-first-open-harness-runtime.md).

- **Structured output is adapter-owned for OpenCode 2.2.7.** Its HTTP API has no JSON-Schema response-format parameter. The adapter puts the schema and prefetched packet in the prompt, extracts the reply, and the runner validates with **Ajv 8.20.0 (strict, `additionalProperties: false`)**. 5/5 fresh sessions validated on first pass with the local model; missing fields, extra properties (a smuggled `effect`), enum violations, wrong types and prose are all rejected. Validity is not correctness: the proof records semantic quality as informational only.
- **Permission surface used by the adapter:** per-session `permissions` rules (`{action, resource, effect}`), starting from deny-all and adding named allows (`read`, `shell` with a resource pattern). Observed action names: `read`, `shell` (the tool is `shell`, not `bash`), `external_directory`. An `ask` effect parks a pending request that the headless runner must treat as **deny**. An unlisted action name silently grants nothing, so every allow is verified by a positive control.
- **Fresh session per item** is proven (empty log, no cross-session recall) and is also the recovery rule: a crashed or interrupted session must not be re-prompted because the dangling prompt is replayed.
- **Adapter preflight (all required):** the resolved model and *all enabled providers* must be loopback; the resolved model must equal the expected pool member; the endpoint must answer and list the model; `lms ps` device must be `Local`; hardening environment flags must be set. Then the adapter enforces step cap (`agents.<name>.steps`), `limit.output`, tool-output truncation and a wall-clock interrupt.
- **Budgets are runner-enforced:** the harness `steps` cap bounds model steps only, not tool calls (one step can batch many). The adapter owns a tool-call budget and a wall-clock budget, polling the session log and interrupting when either is exceeded; the budget is time-bounded, not exact.
- Cancellation contract: `POST /api/session/{id}/interrupt` → outcome `interrupted` within ~0.4 s; the adapter lists active sessions and interrupts them before any new work after a crash.

## P1 implementation record (2026-11-18)

Code: [`packages/warden/src/runner/agent-runner.ts`](../../packages/warden/src/runner/agent-runner.ts). One `AgentRunner` interface (preflight, run with `AbortSignal`), no plugin framework and no second adapter. `runValidated` refuses when stopped or preflight fails, enforces the **runner-owned tool-call, model-turn and wall-clock budget** (`BudgetMonitor`; a single turn batching many tool calls is still bounded, per the P0 finding) and re-validates every structured output with Ajv strict mode. `NotReadyRunner` is the only adapter in P1 and never fabricates a result. The OpenCode adapter lands in P3.
