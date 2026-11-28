# A model new to the pool qualifies itself on replay

- **Status:** Accepted as amended by the owner decision below (2026-11-28). Builds on ADR 0018. The file name keeps its original slug so existing links work. A further amendment (qualification covers the harness and settings too) is **proposed, awaiting owner review**; see the end of this ADR.
- **Date:** 2026-11-26
- **Decided by:** @trek-e, 2026-11-28
- **Research:** [Pi creators live stream](../research/TALK-PI-CREATORS-LIVE.md), mapping rows 2 and 6

## Context

Armin Ronacher says you learn what to trust an agent with "after each model release", or start from "a base level with each family's new generation" [16:23-16:44]. That is his practice, not a measurement.

Warden's own rules already lean this way. ADR 0018 runs the replay regression and capability sets on every model, harness, prompt or configuration change. The owner decided on 2026-11-26 that a model whose live rate leaves its limits has auto-merge paused for that model, and that only the maintainer lifts the pause, after its regression set passes again on replay. ADR 0018 does not say what a model that has never been measured may do. Without a rule, a new model's verdicts could make PRs eligible for auto-merge on its first day, with no live rate to drift.

Model swaps can be quiet. On a local server such as mlx-serve, new weights can be loaded under the same endpoint and model name.

## Decision

- **New means a new identity.** A model's identity is the endpoint, the model id and the pinned version or weights digest the endpoint reports, as recorded in verdict provenance (ADR 0019). A change in any part is a new model.
- **A new model qualifies itself.** Until it qualifies, its verdicts cannot make a PR eligible for auto-merge; its other work continues and is reported. It qualifies on replay when every case that decides auto-merge passes on every trial and it meets the PRD §11 bar (90% agreement on blocking findings and triage, every critical case detected).
- **Improvement and degradation are defined.** When the model replaces another, the paired difference on the same cases is computed with a 95% interval (McNemar's test for the paired counts). It is degraded unless the interval rules out a drop of more than 5 percentage points, and improved when the whole interval is above zero. The 5-point margin is Warden's own number.
- **Surfaced only when it does not pass.** A model that qualifies and is not degraded counts with no maintainer step. One that fails or is degraded comes to the maintainer as a decision card, and its verdicts stay out of auto-merge. A one-off frontier escalation follows the same rule.
- **Drift is unchanged.** A model that drifts in live use is still paused as ADR 0018 decides, and only the maintainer lifts that pause.
- **Preflight detects swaps.** Preflight records the identity the endpoint reports. If it differs from the last recorded identity, the model is treated as new. If the endpoint cannot report a version or digest, the maintainer is told, and the model is treated as new whenever the server restarts, unless the maintainer pins its identity in configuration.

## Consequences

- Swapping or upgrading a model costs a replay run before auto-merge resumes for it, and a maintainer decision only when the run does not pass.
- Escalation to a frontier model for one task is new by this rule; its verdicts count toward auto-merge only after it qualifies.
- No new authority: the comparison uses the paired replay scoring ADR 0018 already decided, and a model that does not qualify is held out of auto-merge the same way ADR 0018 holds a paused model.

## Owner decision (2026-11-28)

The owner: "should be able to self review, pass within a certain high accept rate, and then surface if not passing at that self accept rate. need to define rate of improvement or degradation" [sic]. The definition in the Decision above was then put to him with its sources, and he answered "Yes, open the PR". A weights or version change under the same model name counts as new, and one-off frontier escalations follow the same rule.

Basis:

- An automatic system should bless or veto a model before it serves, comparing it with the previous version with tighter thresholds for sudden drops ([Breck et al., The ML Test Score, IEEE Big Data 2017](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/), Infra 4).
- Non-inferiority is judged against a margin fixed in advance, using the bound of a 95% two-sided interval for the difference ([FDA, Non-Inferiority Clinical Trials, 2016](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/non-inferiority-clinical-trials)).
- McNemar's test has acceptable type I error for comparing two classifiers on the same cases when each can run only once ([Dietterich, Neural Computation, 1998](https://pubmed.ncbi.nlm.nih.gov/9744903/)).
- The same model name can change behavior substantially within months ([Chen, Zaharia and Zou, 2023](https://arxiv.org/abs/2307.09009)).

The questions this ADR asked were: should a new model start paused; does a weights or version change count as new; may one-off frontier verdicts count before a regression pass.

## Proposed amendment (2026-11-28): a qualification covers the harness and settings too

**Proposed, awaiting owner review.** Research: [Hugging Face, "Introducing harness adapters"](../research/HARNESS-ADAPTERS-AT-SCALE.md), lessons A and J. Nothing above changes until the owner accepts it.

### Why

The post trained one LoRA adapter per harness (pi, OpenCode, Hermes Agent) on the same base model and evaluated each under its own harness. The same weights scored differently under each harness and with thinking on or off, and the authors say "you cannot compare the results across different harnesses" because one of them compacts context and the others do not (Evaluation setup). An adapter trained on one harness changed behavior under another (Does the efficiency and performance ability transfer across harnesses?), and none of the adapters clearly carried to a very different agent loop (Evaluation on out-of-distribution tasks and setup).

This ADR's identity names the endpoint, the model id and the version or weights digest. Provenance already records the harness and its version (`runner/provenance.ts`), and ADR 0018 already runs replay on every harness, prompt or configuration change. But the identity that decides whether a model is new leaves the harness and the settings out, so a model qualified under one harness version and thinking mode counts under another without a passing run.

### Proposed decision

- **A qualification is for one configuration.** It covers the model identity above plus:
  - the harness name and the version the run reported (`harnessVersion`, ADR 0004);
  - the settings that change what the model does: thinking or reasoning mode and effort, sampling temperature, and the harness's context compaction setting;
  - the digest of any adapter (for example a LoRA) loaded on the base weights. A base model with an adapter is a different model from the base alone.
- **A change to any of these is a new configuration** and follows the rule above: its verdicts stay out of auto-merge until it qualifies on replay, with no maintainer step when it passes and is not degraded. The OpenCode 2.x range ruling (ADR 0004, 2026-11-27) is unchanged: it decides which versions preflight accepts, not which have qualified.
- **A public benchmark score never qualifies a model**, including a score measured under the same harness. A harness-adapted model, such as `harness-hub/Qwen3.8-27B-opencode-adapted` (Apache-2.0, trained under OpenCode 2.2.7), is a pool candidate like any other and qualifies on Warden's replay set.
- **Comparisons stay within one configuration.** The paired comparison against the model being replaced runs both on the same harness version and settings, or reports that it could not.

### Question for the owner

When OpenCode moves between 2.x releases (for example 2.4.1 to 2.5.0), should the model requalify before its verdicts count toward auto-merge, as proposed? The alternative is to requalify only on a new major version or a settings change. The post's evidence is about different harnesses and thinking modes, not about releases of one harness, so it supports the strict rule for settings but does not settle it for minor versions.

## Related

- ADR 0018: the pause, the lift and the replay sets
- [ADR 0019](0019-decision-model-router.md): provenance records endpoint, model and pinned version
- [ADR 0007](0007-local-first-model-pool.md): the model pool
