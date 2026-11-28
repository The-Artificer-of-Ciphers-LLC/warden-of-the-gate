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

Amendment 2026-11-28: the MVP model server is mlx-serve (owner: "we are only using mlx-serve"; "drop lmstudio we aren't using it"). Warden registers it in OpenCode as the provider `mlx-serve` and denies OpenCode's built-in `lmstudio` and `ollama` providers (ADR 0004 amendment of the same date). The connection stays the plain OpenAI-compatible endpoint. The LM Studio notes below are the 2026-11-18 proof record.

## Consequences

- v1 runs entirely on local models; the remote tier is a documented extension point, not built.
- Local resource management (VRAM/context) becomes a scheduling dimension: the runner preflights that a batch fits the model.

## P0 proof record (2026-11-18, `PROOF-runtime`)

Evidence: [`proof/p0-runtime`](../../proof/p0-runtime/README.md) (`results/runtime.json`, sections C and E).

- **Pool member proven:** LM Studio (loopback `127.0.0.1:1235`) serving `qwen3.8-27b` (MLX 4-bit, 32 k context as loaded, 16.1 GB) on a 128 GiB Apple-silicon Mac. One model is proven; the pool is not benchmarked (P3/v1.x).
- **"Local" means a loopback literal endpoint, checked on the harness's resolved configuration**, with the loaded model's LM Studio device equal to `Local` (LM Studio can otherwise list models served from another machine). Hosted, LAN, mDNS-name, lookalike (`127.0.0.1.evil.example`, `localhost.evil.example`) and userinfo (`http://127.0.0.1@evil.example`) hosts are rejected.
- **Defaults are not policy.** The harness ships a hosted provider enabled by default and contacts hosted hosts at start-up and on selection; it also silently substitutes another available model when the configured default is unavailable. Both are neutralised by the hardening set and the expected-pool-member check in ADR 0004/0006; without the preflight a "configured-local" setup can resolve elsewhere.
- **No hosted request when local is unavailable:** with a dead local endpoint and the hosted provider denied, zero outbound requests of any kind were observed (egress recorded by a refusing proxy; nothing was forwarded) and no output was produced. The unhardened harness (positive control) does attempt hosted contact, so the recorder is shown to work.
- **Resource scheduling facts for the runner's batch preflight:** harness RSS ≈ 412 MB; model 16.1 GB; one 4 k-prompt structured review ≈ 40–55 s including reasoning on this model; prompt larger than the configured context ends in a recorded `compaction.failed` after ~20 s rather than hanging. Thinking models spend reasoning tokens outside `limit.output`.
