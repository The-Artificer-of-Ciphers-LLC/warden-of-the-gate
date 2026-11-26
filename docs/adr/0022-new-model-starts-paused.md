# A model new to the pool starts with auto-merge paused

- **Status:** Proposed, awaiting owner review (2026-11-26). Nothing here changes behavior until accepted. Builds on ADR 0018 (open PR #48).
- **Date:** 2026-11-26
- **Decided by:** pending @trek-e
- **Research:** [Pi creators live stream](../research/TALK-PI-CREATORS-LIVE.md), mapping rows 2 and 6

## Context

Armin Ronacher says you learn what to trust an agent with "after each model release", or start from "a base level with each family's new generation" [16:23-16:44]. That is his practice, not a measurement.

Warden's own rules already lean this way. ADR 0018 (open PR #48) runs the replay regression and capability sets on every model, harness, prompt or configuration change. The owner decided on 2026-11-26 that a model whose live rate leaves its limits has auto-merge paused for that model, and that only the maintainer lifts the pause, after its regression set passes again on replay. ADR 0018 does not say what a model that has never been measured may do. Without a rule, a new model's verdicts could make PRs eligible for auto-merge on its first day, with no live rate to drift.

Model swaps can be quiet. On a local server such as mlx-serve, new weights can be loaded under the same endpoint and model name.

## Decision

- **New means a new identity.** A model's identity is the endpoint, the model id and the pinned version or weights digest the endpoint reports, as recorded in verdict provenance (ADR 0019). A change in any part is a new model.
- **A new model starts paused.** Its verdicts cannot make a PR eligible for auto-merge. Its other work continues and is reported. This uses the same pause as ADR 0018.
- **The same lift.** The maintainer lifts the pause after the model's regression set passes on replay, exactly as ADR 0018 decides for a drifting model.
- **Preflight detects swaps.** Preflight records the identity the endpoint reports. If it differs from the last recorded identity, the model is treated as new. If the endpoint cannot report a version or digest, the maintainer is told, and the model is treated as new whenever the server restarts, unless the maintainer pins its identity in configuration.

## Consequences

- Swapping or upgrading a model costs a replay run and a maintainer click before auto-merge resumes for it.
- Escalation to a frontier model for one task is new by this rule. Whether escalated verdicts may count toward auto-merge before that model has a regression pass is an owner question.
- No new metric and no new authority: this reuses the ADR 0018 pause and lift.

## Questions for the owner

1. Should a model new to the pool start with auto-merge paused?
2. Does a weights or version change under the same model name count as new?
3. For one-off frontier escalation: do its verdicts count toward auto-merge before its regression pass?

## Related

- ADR 0018 (open PR #48): the pause, the lift and the replay sets
- [ADR 0019](0019-decision-model-router.md): provenance records endpoint, model and pinned version
- [ADR 0007](0007-local-first-model-pool.md): the model pool
