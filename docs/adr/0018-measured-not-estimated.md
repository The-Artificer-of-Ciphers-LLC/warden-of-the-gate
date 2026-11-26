# Measured, not estimated: run-over-run scorecards and untrusted self-assessment

- **Status:** Proposed, awaiting owner review (2026-11-25). Nothing here is decided.
- **Date:** 2026-11-25
- **Decided by:** pending @trek-e
- **Research:** [Sumner, "How to Ship Millions of Lines of Agent-Written Code"](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md), candidate 4; [follow-up research on model scorecards](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md#2-a-scorecard-that-catches-a-model-not-doing-what-we-expect)

## Context

PRD §11 lists what Warden tracks, and Retro reviews outcomes over a window (§5 Retro). Neither requires comparing the current run with the previous one, so a regression can hide inside a healthy-looking total.

Sumner ran a long agent project on an hourly scorecard that showed the previous and current version side by side, "so that way it was easy to see if numbers went up or down", and his closing lesson was "if you're not actively re-measuring, then it's going to like get worse". He also reports three model behaviors that bear on Warden's abstention and scope rules: the model "will try to like size up everything to judge whether or not it's worth working on", is easily convinced "that like your measurements are good um when they're not good", sizes ideas up wrongly and talks itself out of them, and "talks itself into making up rules". These are one practitioner's observations, not measurements.

Warden already treats model self-reported success as untrusted (§5 Review). It does not say the same about the model's estimates, its reasons for abstaining, or rules it cites.

## Decision (proposed)

- **Scorecard against the previous run.** Retro, and each manual scan report, includes a scorecard of the §11 metrics for this run next to the previous comparable run, with the change for each. Metrics come from ledgers, not from the model. A first run says so instead of showing a comparison.
- **Self-assessment is a claim, not evidence.** A session's estimates of effort, impact, risk or feasibility, and its "not worth it" or "infeasible" reasons for abstaining, are recorded as model claims on the item. They never satisfy a gate and never close an item on their own.
- **Cited rules must exist.** When a session cites a rule, policy or constraint to skip, narrow or abstain from work, Warden resolves the citation to an `.github/ORDERS.yaml` entry, a `.github/warden.yml` key or approved spec text on the trusted base. A citation that does not resolve is a finding on the session's output, and the item returns to its previous state with the unresolved citation shown.
- **Abstentions are revisited.** Retro lists abstentions whose stated reason was a model estimate, so the maintainer can see whether the factory is talking itself out of work it could do.

### Model scorecard (proposed 2026-11-26)

@trek-e asked for best practice on a scorecard that catches a model not doing what is expected. This follows Anthropic's guidance on agent evals and on eval statistics, NIST p-charts, and Google's code-review ML acceptance metrics (sources in the research note).

- **Replay sets with known answers.** The §11 replay corpus is split into a regression set (expected near 100%; any drop is a regression) and a capability set (hard cases). Each case has a recorded expected outcome, and the sets include cases that should and should not raise a finding. Start from 20 to 50 real failures; add every escaped defect; graduate capability cases to regression once passed reliably.
- **Scored per model, on every change.** The sets run on every model, harness, prompt or configuration change and on a schedule, separately for each model in the pool. Cases that decide auto-merge report pass^k over repeated trials.
- **Intervals and paired comparison.** Every score carries a standard error and a 95% interval, clustered by repository or PR. A model swap, or PR #47 ruling 6's fresh-context same-model reviewer, is judged on paired differences over the same cases. Set sizes come from power analysis.
- **Live rates on control charts.** From ledgers, per model and task contract: maintainer override rate, findings dismissed versus acted on, abstention rate, rework loops per item, and factory merges later reverted. Limits are p̄ ± 3√(p̄(1−p̄)/n) from a baseline window. A point outside the limits is a Retro finding that the model's behavior changed. Wide limits from small samples are shown as such.
- **Graders are calibrated, transcripts are read.** A model-graded score is checked against maintainer decisions before it counts and never decides a gate (PRD §11). Retro samples session transcripts each window, and flags a regression set that has sat at 100% so new cases are added.

## Consequences

- Sessions must emit citations in a structured field, not prose, so Warden can resolve them. This touches the task output schemas.
- The run-over-run scorecard adds no model work; it is a report over existing ledgers. The model scorecard does add work: repeated replay trials per model, run on each change.
- Live control limits need a baseline window of normal operation before they mean anything; until then the card shows rates without limits.
- More abstentions may surface as findings at first, which is the point: they become visible instead of silent.
- No authority changes. Retro still only proposes.

## Open questions for the owner

1. Adopt the run-over-run scorecard for Retro and scan reports?
2. Adopt the rule that a cited rule must resolve to real ORDERS, config or spec text, with an unresolved citation counted as a finding?
3. Adopt the model scorecard (replay regression and capability sets per model with intervals, and live rates on control charts)?
4. When a live rate leaves its control limits, is that a Retro finding only, or does it also pause auto-merge for that model until its regression set passes again?

## Related

- PRD §5 Implement, §5 Retro, §9, §11
- PR #47 ruling 6 (independent reviewer; "we build statistics")
- ADR 0010 (declarative standing orders)
- PR #47 proposal ADR 0016 (verify-and-continue loop)
