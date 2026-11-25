# Decision-model router at the front end: routes work, never authorizes it

- **Status:** Proposed (post-MVP; numbered after ADRs 0014-0018 proposed in open PRs #47 and #48)
- **Date:** 2026-11-25
- **Decided by:** pending @trek-e

## Context

The owner asked whether a Jev-style decision model could serve as Warden's front end. Such models return a probability for each typed option in one forward pass, in well under a second. The evidence ([DECISION-MODEL-ROUTER.md](../research/DECISION-MODEL-ROUTER.md)) shows they match strong judges where a verdict can be read off the text, trail by 13-28 points where it must be derived (code, math, logic), are swayed by polished wrong answers and injected notes, and do not notice stale inputs. PRD §3 and ADR 0008 already forbid model confidence as merge authority. ADR 0007 defers an orchestrator/worker split to v1.x behind benchmark replay.

## Decision

- **Role:** an optional router that proposes routing intents only: PR kind, review depth and tier, reviewer selection, contributor-reply intent for clocks, and an ordering of findings. All go through the serialized writer as proposals, like Triage.
- **Never:** approve, block, merge, skip a required review, drop a finding, judge correctness or risk, or act as a security filter. A router outage or low confidence falls back to the default full review path.
- **Connection:** the preferred implementation reads option probabilities through standard Chat Completions `logprobs`/`top_logprobs` on an approved endpoint. Non-standard decision APIs (hosted Jev `/v1/systemone`, vLLM `/v1/decide`) are not part of the design.
- **Provenance:** each routing decision records endpoint, model and pinned version, options asked in both orders, and the averaged probabilities.
- **Thresholds:** set per decision type by a lower confidence bound from at least 100 labelled PRs, re-validated when the model, version or prompt changes.
- **Rollout:** shadow mode on benchmark replay first; live only after an owner decision and a passing injection test.

## Consequences

- Preflight gains a conformance probe for `logprobs`/`top_logprobs` on any endpoint used as a router; Anthropic Messages endpoints cannot serve as routers.
- No change to merge gates, review requirements or the PRD.
- Adds a labelled-routing corpus to the replay work.
- Open: whether the gain (fewer heavy-review passes, better clock decisions) justifies the labelling effort at Warden's PR volume.
