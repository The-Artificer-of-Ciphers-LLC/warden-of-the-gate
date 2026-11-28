# Measured, not estimated: weighted robust scorecards and untrusted self-assessment

- **Status:** Decided, except two proposals. Decided by @trek-e on 2026-11-26:
  - cited rules must resolve;
  - a live rate outside its limits pauses auto-merge for that model;
  - the maintainer lifts the pause after replay passes.

  Decided by @trek-e on 2026-11-27 ("Yes"):
  - the weighted, robust scorecard design, which replaces the earlier run-over-run comparison at the owner's direction;
  - safety metrics weigh more than throughput metrics by default;
  - the model scorecard's replay sets.

  Still proposed, awaiting owner review: the treatment of self-assessment and abstentions.
- **Date:** 2026-11-25 (revised 2026-11-26 and 2026-11-27)
- **Decided by:** @trek-e for the cited-rule rule, the pause and how it lifts (2026-11-26), and for the weighted scorecard, its default weights and the model scorecard (2026-11-27); pending for self-assessment and abstentions
- **Research:** [Sumner, "How to Ship Millions of Lines of Agent-Written Code"](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md), candidate 4; follow-up research on [model scorecards](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md#2-a-scorecard-that-catches-a-model-not-doing-what-we-expect) and [weighted, robust scorecards](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md#3-a-weighted-robust-scorecard)

## Context

PRD §11 lists what Warden tracks, and Retro reviews outcomes over a window (§5 Retro). Nothing compares those outcomes with a baseline, so a regression can hide inside a healthy-looking total.

Sumner ran a long agent project on an hourly scorecard that showed the previous and current version side by side, "so that way it was easy to see if numbers went up or down". His closing lesson was "if you're not actively re-measuring, then it's going to like get worse".

He also reports three model behaviors that bear on Warden's abstention and scope rules:
- the model "will try to like size up everything to judge whether or not it's worth working on";
- it is easily convinced "that like your measurements are good um when they're not good";
- it "talks itself into making up rules".

These are one practitioner's observations, not measurements.

On 2026-11-26 @trek-e rejected a plain previous-run comparison: "Scorecard should be intelligent with weights and medians not just how'd it do compared to previous." He asked for established practice. The design below follows statistical process control (NIST/SEMATECH), robust statistics (Iglewicz and Hoaglin, via NIST), composite-indicator construction (OECD/JRC), SLO alerting (Google SRE Workbook) and eval statistics (Anthropic).

Warden already treats model self-reported success as untrusted (§5 Review). It does not say the same about the model's estimates, its reasons for abstaining, or the rules it cites.

## Decision

### Decided 2026-11-26 (@trek-e)

- **Cited rules must exist.** When a session cites a rule, policy or constraint to skip, narrow or abstain from work, Warden resolves the citation to one of:
  - an `.github/ORDERS.yaml` entry;
  - a `.github/warden.yml` key;
  - approved spec text on the trusted base.

  A citation that does not resolve is a finding on the session's output. The item returns to its previous state, with the unresolved citation shown.
- **Out of limits pauses auto-merge.** When a model's live rate goes past its control limit, Retro flags it and auto-merge pauses for that model. Its other work continues, but its verdicts cannot make a PR eligible for auto-merge until the pause is lifted.
- **The maintainer lifts the pause, after replay passes.** Only the maintainer clears a paused model, and only after its regression set passes again on replay. The live rate drifting back inside its limits does not lift it: with auto-merge paused, the live sample is small and no longer reflects auto-merge work.

### Weighted, robust scorecard (decided 2026-11-27, @trek-e)

Each part of the design follows one of the sources named above.

- **Each metric is judged on its own first.** Every §11 metric has:
  - a direction (higher or lower is better);
  - a weight;
  - its own limit.

  No metric that can pause auto-merge can be offset by good scores elsewhere. The OECD/JRC handbook calls this compensability: in a weighted sum, a deficit in one indicator is hidden by a surplus in another. So the pause is triggered per metric, never by the composite (decided rule above).
- **Baselines use medians, not means.** Each metric's baseline is the median of a rolling window of prior comparable runs (same repository class, model and task contract). Its spread is the median absolute deviation (MAD). A run is scored by the modified z-score, M = 0.6745 × (x − median) / MAD. |M| > 3.5 marks it as an outlier for review (Iglewicz and Hoaglin's cut-off, per NIST). Medians and MAD keep one unusual PR or one bad run from moving the baseline the way a mean and standard deviation would.
- **Drift and spikes need different windows.**
  - Rates (overrides, dismissed findings, abstentions, reverted merges) use a p-chart on a long window for sudden shifts.
  - An EWMA chart (λ about 0.2 to 0.3, NIST) catches slow drift that no single point shows.
  - As in the Google SRE Workbook's recommended multiwindow alerts, a limit counts as breached only when the long window and a short recent window both show it. Requiring both cuts false alarms, and the short window stops the alert soon after the problem ends.
- **Low volume is said, not hidden.** A rate over a handful of PRs swings wildly; the SRE Workbook's example is one failure in ten requests reading as a 10% error rate. Below a configured minimum sample, the card shows "insufficient data" instead of a verdict. Warden then leans on what the SRE Workbook lists for low-traffic services:
  - synthetic work (the replay sets below);
  - pooling across repositories for the same model;
  - a longer window.
- **Weights are explicit, owned and tested.**
  - Weights live in `.github/warden.yml`, set by the maintainer, and are shown on the scorecard.
  - By default, safety metrics (escaped defects, reverted factory merges, maintainer overrides) weigh more than throughput metrics (decided 2026-11-27).
  - The OECD/JRC handbook treats the choice of weights and aggregation as something to test for robustness. So Retro also reports whether the scorecard's verdict changes under equal weights.
- **The composite is a summary, never a gate.** The weighted composite is for the trend line. It is always shown broken down into its metrics, so a reader can see what moved it (the OECD/JRC "back to the data" step: composites "should be transparent and fit to be decomposed").
- **Uncertainty is shown.** Every score carries a standard error and a 95% interval, clustered by repository or PR. Model comparisons use paired differences on the same cases (Anthropic, statistical evals).
- **The previous run is one column, not the baseline.** The card still shows the last comparable run beside the current one, because a change is easy to see that way (Sumner). Judgement uses the rolling median baseline and limits above.

### Model scorecard (decided 2026-11-27, @trek-e)

These parts follow Anthropic's guidance on agent evals and on eval statistics, and Google's code-review ML acceptance metrics (sources in the research note).

- **Replay sets with known answers.**
  - The §11 replay corpus is split into a regression set (expected near 100%; any drop is a regression) and a capability set (hard cases).
  - Each case has a recorded expected outcome. The sets include cases that should raise a finding and cases that should not.
  - Start from 20 to 50 real failures, and add every escaped defect.
  - Capability cases graduate to the regression set once passed reliably.
- **Scored per model, on every change.** The sets run on every model, harness, prompt or configuration change and on a schedule, separately for each model in the pool. Cases that decide auto-merge report pass^k over repeated trials, meaning every trial must pass.
- **Live rates per model and task contract.** These come from ledgers:
  - maintainer override rate;
  - findings dismissed versus acted on;
  - abstention rate;
  - rework loops per item;
  - factory merges later reverted.

  Each rate is scored and limited as in the weighted, robust scorecard above.
- **Graders are calibrated, and transcripts are read.**
  - A model-graded score is checked against maintainer decisions before it counts, and it never decides a gate (PRD §11).
  - Retro samples session transcripts each window.
  - Retro flags a regression set that has sat at 100%, so new cases get added.

### Still proposed (2026-11-25)

- **Self-assessment is a claim, not evidence.** A session's estimates of effort, impact, risk or feasibility, and its "not worth it" or "infeasible" reasons for abstaining, are recorded as model claims on the item. They never satisfy a gate and never close an item on their own.
- **Abstentions are revisited.** Retro lists abstentions whose stated reason was a model estimate, so the maintainer can see whether the factory is talking itself out of work it could do.

## Consequences

- Sessions must emit citations in a structured field, not prose, so Warden can resolve them. This touches the task output schemas.
- The scorecard itself adds no model work; it is a report over existing ledgers. The model scorecard does add work: repeated replay trials per model, run on each change.
- Baselines and limits need a window of normal operation first. Until it exists, the card shows rates without limits and says so. A first run says so instead of showing a comparison.
- The low-volume floor means a quiet repository may never reach a live verdict. There, the replay sets carry the signal.
- More abstentions may surface as findings at first, which is the point: they become visible instead of silent.
- No authority changes. Retro still only proposes, and only the maintainer lifts a pause.

## Open questions for the owner

1. ~~Adopt the run-over-run scorecard for Retro and scan reports?~~ Replaced 2026-11-26 at the owner's direction by the weighted, robust scorecard. ~~Adopt that design?~~ Decided 2026-11-27: yes.
2. ~~Must a cited rule resolve to real ORDERS, config or spec text?~~ Decided 2026-11-26: yes.
3. ~~Adopt the model scorecard (replay regression and capability sets per model with intervals)?~~ Decided 2026-11-27: yes.
4. ~~When a live rate leaves its control limits, is that a Retro finding only, or does it also pause auto-merge?~~ Decided 2026-11-26: both.
5. ~~What lifts the pause?~~ Decided 2026-11-26: the maintainer clears it, after the regression set passes again on replay.
6. ~~Default weights: should safety metrics (escaped defects, reverted merges, overrides) outweigh throughput metrics by default?~~ Decided 2026-11-27: yes. The rolling baseline length and the low-volume floor are left to build planning.

## Related

- PRD §5 Implement, §5 Retro, §9, §11
- PR #47 ruling 6 (independent reviewer; "we build statistics")
- ADR 0010 (declarative standing orders)
- PR #47 proposal ADR 0016 (verify-and-continue loop)
