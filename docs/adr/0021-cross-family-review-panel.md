# Optional cross-family review panel, with bounded rounds

- **Status:** Accepted as an opt-in mode built after the pilot (2026-11-28). The MVP reviewer is a fresh context of the same model, decided by the owner on 2026-11-28.
- **Date:** 2026-11-26
- **Decided by:** @trek-e, 2026-11-28
- **Research:** [Pi creators live stream](../research/TALK-PI-CREATORS-LIVE.md), mapping rows 13-16

## Context

Mario Zechner reviews system designs with several model families on the same inputs and gets "super different answers and super different problems" [26:19-26:52]. He also says reviewers told to be harsh are "overzealous" and a human must filter them, and mocks running review "in a loop until nothing comes up" [26:52-27:33].

The research supports the panel. A panel of smaller models from disjoint families agreed with human judgments better than one large judge, with less intra-model bias, at about a seventh of the cost (Verga et al., arXiv 2404.18796, 2024; QA and chat evaluation, not code review). When two models are both wrong they tend to give the same wrong answer, more so with the same developer or architecture, and a judge inflates scores for its own provider's models (Kim et al., ICML 2025). Warden's pool can hold distinct families (large Nemotron and Gemma services, frontier escalation when needed), so a panel is possible.

Warden already has the pieces a panel needs: finding fingerprints that deduplicate (PRD §5 Review), a cap and ranking of posted findings, the owner's ruling that uncertain-finding handling is configurable (go/no-go, drop below a confidence level, or other options), and verdicts that record the reviewer's model and family (ADR 0015).

## Decision

- **A panel is an opt-in review mode.** Configured in `.github/warden.yml` with two or more reviewer models from different families. Each reviews the same inputs in its own fresh session. Members of the same family count as one for agreement.
- **Findings merge by fingerprint.** Each merged finding records which reviewers raised it. Agreement is evidence about the finding, not a verdict: a finding one reviewer raises is still a finding unless the owner's configured option says otherwise.
- **Agreement can feed ruling 7.** "Drop findings below a confidence level" may use the agreement count as its confidence measure, if the maintainer configures it. Dropped findings stay in the ledger, as the ruling requires. Agreement never approves a merge, and blocker findings block whatever the count.
- **Rounds are bounded.** Review runs once per reviewed head and configuration. Warden never re-runs review on an unchanged head to reach a clean result or to fish for more findings. A new round happens only when the head changes, the configuration changes, or a maintainer forces a full review by command. A finding raised in any round counts (owner ruling 5).
- **Measured before it becomes a default.** The replay set runs single-reviewer and panel modes on the same cases. The panel is a candidate default only if it finds more true findings at an equal or lower false-finding rate, with the cost shown.

## Consequences

- Review cost grows with the number of panel members. The scorecard (ADR 0018) already reports cost per verdict.
- Overzealous reviewers produce more findings, and nits block merge by the owner's ruling. The posted-findings cap and ranking still apply; the ledger keeps all.
- Needs the endpoint registry to know each model's family; that is still open in [MODEL-CONNECTIONS](../research/MODEL-CONNECTIONS.md).
- No change to merge authority, review events or who decides.

## Owner decision (2026-11-28)

The owner answered "Yes, open the PR" to this proposal:

1. The panel is an opt-in mode, off by default, built after the pilot and not in the MVP.
2. Agreement may serve as the confidence measure for "drop below confidence" only once replay shows that dropping by agreement drops no true finding. Blocking findings never drop, whatever the count. Basis: strong models often make the same mistakes, even across providers, so agreement is evidence only after it is measured ([Kim et al., ICML 2025](https://arxiv.org/abs/2506.07962)).
3. The round bound stands: no re-review of an unchanged head except by maintainer command.

On the related question of the default reviewer, the owner decided the same day: "new context makes same model a new reviewer". A preregistered replay of 183 reviews found a fresh session of the same model caught as many escaped bugs as a reviewer from another family, or more ([Stephens, 2026](https://stephens.page/blog/fresh-eyes-beat-a-second-family/paper/)), so the replay comparison for a panel should include a fresh same-model session as its control.

## Related

- ADR 0015: reviewer independence, model families on verdicts
- ADR 0018: per-model scorecard and cost
- [ADR 0008](0008-tiered-autonomy-and-merge-gates.md): severity and merge gates, unchanged
