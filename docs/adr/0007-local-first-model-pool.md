# Local-first model pool: local is the default floor, remote is opt-in, never a silent fallback

- **Status:** Draft
- **Date:** 2026-11-16
- **Decided by:** @trek-e

## Context

The original constraint was "no API-key calls" (a subscription agent). The open-harness pivot makes local models the default, which strengthens the intent: routine work costs electricity, not tokens. The owner will have access to remote high-end models for heavy tasks; the risk is silent drift into unbudgeted per-token spend.

## Decision

- MVP inference is local-only, initially Mac with LM Studio or an explicitly configured local compatible service. Remote per-task opt-in with budgets is deferred, not an MVP fallback.
- Preflight the actual resolved provider/model, not only defaults. Reject unapproved remote routing, preserve pending work and report local unavailability. OpenAI-compatible API syntax does not imply use of OpenAI's hosted service.
- An orchestrator/worker split (a strong model used lightly to plan, route and verify; local models do the token-heavy work) is v1.x, gated by benchmark replay of Warden's own past tasks.

## Consequences

- v1 runs entirely on local models; the remote tier is a documented extension point, not built.
- Local resource management (VRAM/context) becomes a scheduling dimension: the runner preflights that a batch fits the model.
