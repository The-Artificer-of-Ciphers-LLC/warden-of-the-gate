# Local-first model pool: local is the default floor, remote is opt-in, never a silent fallback

- **Status:** Accepted
- **Date:** 2026-11-16
- **Decided by:** @trek-e

## Context

The original constraint was "no API-key calls" (a subscription agent). The open-harness pivot makes local models the default, which strengthens the intent: routine work costs electricity, not tokens. The owner will have access to remote high-end models for heavy tasks; the risk is silent drift into unbudgeted per-token spend.

## Decision

- The model pool has a floor and a ceiling: local models (Mac MLX via LM Studio) are the default for all tasks; a remote high-end tier is opt-in config, enabled per task class only where the measured quality delta justifies it.
- The runner's preflight confirms (1) the default tier is local, (2) any remote use is explicitly configured, and (3) no silent fallback to a paid or remote model exists. A batch that cannot run local ends cleanly rather than escalating silently.
- An orchestrator/worker split (a strong model used lightly to plan, route and verify; local models do the token-heavy work) is v1.x, gated by benchmark replay of Warden's own past tasks.

## Consequences

- v1 runs entirely on local models; the remote tier is a documented extension point, not built.
- Local resource management (VRAM/context) becomes a scheduling dimension: the runner preflights that a batch fits the model.
