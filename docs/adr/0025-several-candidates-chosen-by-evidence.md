# Several fix candidates, chosen by deterministic evidence

- **Status:** Proposed (2026-11-27). The owner said yes on 2026-11-27 to writing this up as an ADR: opt-in per repository, one candidate by default, chosen by evidence. The details below await owner review. Nothing here changes behavior until accepted.
- **Date:** 2026-11-27
- **Decided by:** @trek-e (adopt as an opt-in proposal); details pending
- **Research:** [Maddalone software factories talk](../research/TALK-MADDALONE-SOFTWARE-FACTORIES.md), proposal 2

## Context

Warden's Implement task produces exactly one implementation per item: one fix session against the frozen tests (ADR 0014). When that attempt fails its gates or comes out larger than it should, the only recourse is rework or abstention.

Rob West's article, which the Maddalone talk paraphrases, argues that design work benefits from variation: build alternatives, compare them, keep the better one. Warden already has what makes comparison safe. The frozen tests, the weakening and frozen-path checks, and mutation on changed lines (ADR 0016) are run by the trusted executor, not judged by a model.

The evidence for repeated attempts depends on that kind of automatic check. Brown et al., "Large Language Monkeys: Scaling Inference Compute with Repeated Sampling" (arXiv 2407.21787, 2024), found that on SWE-bench Lite, independent samples from DeepSeek-Coder-V2 resolved 15.9% of issues with one sample and 56% with 250, picking solutions with unit tests. The same paper found that picking without an automatic check (majority vote, reward models) stopped improving after a few hundred samples.

## Decision

- **Opt-in, per repository.** `.github/warden.yml` may set `implement.candidates` to a number N. The default is 1, which is today's behavior. Like the rest of `.github/warden.yml`, the setting is read from the trusted base revision only (PRD §3), so a PR cannot raise it for itself.
- **Independent fix sessions.** Implement runs up to N fix sessions against the same frozen tests and the same approved spec. Each is a fresh session, sees no other candidate's code or reasoning, and runs in its own factory workspace under the same OS boundary. The test session still runs once; the tests are frozen before any fix session starts.
- **The same gates for every candidate.** Each candidate goes through every executor gate a single candidate would: frozen-test and frozen-path checks, weakening detection, fail-on-base and pass-after, mutation on changed lines, older tests (ADR 0017), and special-casing review (PRD §5 Review). A candidate that fails any gate is out.
- **Chosen by deterministic evidence only.** Among the candidates that pass every gate, Warden picks in this order:
  1. better results on the repository's promise checks, if [ADR 0023](0023-promise-checks.md) is accepted and the repository declares any;
  2. the smaller diff (lines added plus lines removed, excluding the frozen tests);
  3. fewer files touched;
  4. the earliest candidate, as a final tie-break.

  A model never picks, ranks or scores candidates. This follows PRD §11: a model grading a model never decides a gate.
- **One PR.** Only the chosen candidate becomes a PR, so the one-open-factory-PR cap (PRD §2) is unchanged. The other candidates' workspaces are deleted after the run; the ledger keeps their gate results, diff sizes and cost.
- **Boundary-class features.** When the item touches a boundary class (ADR 0015) and so already comes to the maintainer as a decision card, the card may show the two passing candidates whose diffs differ most, so the maintainer can choose between two designs. Warden still recommends by the order above.
- **No passing candidate.** If no candidate passes every gate, Implement abstains or returns the item exactly as it would with one failed candidate. Warden never relaxes a gate because several attempts failed.

## Consequences

- More attempts give more chances that one games the tests. Selection happens only after the weakening, mutation and frozen-test checks, and the replay set's test-gaming and special-casing cases (PRD §11) must be run with N > 1 and pass before a repository may set N above 1.
- Local compute grows with N. The scorecard (ADR 0018) reports cost per item, so the maintainer can see what extra candidates cost against what they bought.
- The ledger shows how many candidates ran, how many passed, and which rule picked the winner, so a pick can be reproduced.
- Retro can report whether items that needed several candidates later had more reverts or escaped defects than single-candidate items.

## Questions for the owner

1. Should there be a hard ceiling on N that a repository cannot exceed (for example 5), or only the run budget in `.github/warden.yml`?
2. When candidates tie on everything but the earliest-candidate rule, should the card note the tie?

## Related

- [ADR 0014](0014-frozen-acceptance-tests.md): the frozen tests every candidate is judged by
- [ADR 0016](0016-verification-loop-and-test-quality-evidence.md): mutation and verification gates each candidate must pass
- [ADR 0018](0018-measured-not-estimated.md): the scorecard that reports cost
- [ADR 0023](0023-promise-checks.md): promise checks, the first selection rule if accepted
