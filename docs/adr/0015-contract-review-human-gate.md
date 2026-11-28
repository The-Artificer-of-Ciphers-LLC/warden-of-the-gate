# Contract review is the human gate; boundary changes come to the maintainer as a proposed design; reviewer independence

- **Status:** Accepted by @trek-e on 2026-11-27 ("Accept, in that order"), proposed 2026-11-25. Build order, decided with it: 0014 (frozen tests), then 0016 (verification loop), then 0015 (contract review). This ADR is built third. The owner rulings below were made before acceptance and stand.
- **Date:** 2026-11-25
- **Decided by:** @trek-e (rulings 2026-11-25 and 2026-11-26; accepted 2026-11-27)
- **Research:** [Review the tests, not the diff](../research/TESTS-OVER-CODE-REVIEW.md)

## Context

Line-by-line review was never a strong bug filter. In a controlled study, reviewers caught two seeded flaws 3% and 21% of the time; telling them to look for one specific risk raised that to 46% and 61% (Braz et al., ICSE 2022). AI volume makes it worse: at one company, PR volume grew 3.1x while reviewers grew 1.5x, and substantive review fell from 39% to 21% of PRs (arXiv 2607.01904). Warden's maintainer is one person, so review capacity is fixed.

Where Warden needs a human, the PRD frames it as "a maintainer decision" and the card shows risk, evidence and findings. It does not say what the human should read. The article's answer, and the one the evidence supports, is: read the contract (the spec and its acceptance tests), scan the test diff for a short list of known cheats, and read the implementation only where it crosses a boundary others depend on. Anthropic's own practice is the same shape: risk tiers with zero, one or two human approvals, and always-human paths such as billing, the auto-updater and CI workflow files.

A second model reading the diff is one useful layer, but not an independent one. When two models are both wrong they agree about 60% of the time against about 33% by chance, more so within one family (Kim et al., ICML 2025). Warden's pool has distinct families (large Nemotron and Gemma services, frontier escalation), so it can do better than a same-model review.

## Decision

- **The contract is what a human approves.** For approved features and enhancements, the approval Triage already requires covers the acceptance criteria **and** the frozen acceptance tests from the test session (ADR 0014). A decision card for implementation work shows, in order: the spec or issue, the acceptance criteria, the frozen test diff, the executor's fail-on-base result, then risk, findings and evidence. The implementation diff is linked, not inlined, unless the change is a boundary change.
- **A focused test-diff scan replaces open-ended diff reading.** The card and Review both check the test diff against one list: deleted or weakened assertions, widened tolerances or timeouts, new retries, regenerated snapshots, `.skip`/`.only`/`todo`, changed test-runner, coverage or mutation configuration, tests moved out of the test globs, and tests that assert on the implementation's own output rather than an independent expectation. Each hit is a finding with a location, not a vague concern.
- **Boundary changes floor at a maintainer decision.** A change is a boundary change when it touches a configured boundary class. Defaults, configurable in `.github/ORDERS.yaml` as paths and in `.github/warden.yml` as detectors: exported or public interfaces and API contracts; database schemas and migrations; authentication, authorization, secrets and security-sensitive paths; a new dependency or a major-version dependency change; shared components named by the repository; test, verification and CI infrastructure. A boundary change gets a maintainer decision even when every other gate passes, in the form the owner ruled below. The existing one-way door floor in `implement/slice.ts` (schema, migration) is one detector of this class.
  - **Decided 2026-11-26 (@trek-e):** external effects (publishing, releases, deploys) are a default boundary class, and a change is a one-way door exactly when it touches a boundary class. Every one-way door comes to the maintainer as a decision card; the door type is set by the configured classes, never by a model's judgment.
- **Everything else rests on the loop, not on human diff reading.** For eligible non-boundary work, human review of the implementation diff stays optional. AI review of the diff remains a layer (it finds what the loop cannot), alongside frozen tests, test-quality evidence (ADR 0016) and the static-first gates. This does not change the merge gate: blocker findings always stop a merge, and other severities follow ADR 0008.
- **Reviewer independence.** A fresh session is required in all cases, as today. The verdict records the writer's model id and family (the Implement or Rework session, or the contributor's declared tool where known) and the reviewer's. Whether Review should prefer a different family is not decided (see Owner rulings); the MVP may review with a fresh context of the same model, reported as such.

## Owner rulings (2026-11-25, @trek-e)

- **Boundary changes come as a proposed design:** "propose designs come to maintainer via tools like improve-codebase-architecture skill from matt pocock, can increase/decresase fidelity but initially mvp will be limited maintainer interaction to simple decision matrix questions and then deploy based on that."
  - When planned work will cross a boundary class, Warden brings the proposed design before building it; Warden then builds and deploys based on the maintainer's answers. A boundary change found only in finished work, such as a contributor PR, gets the same kind of card about the change it makes.
  - `improve-codebase-architecture` is a model for the tool, not a dependency. It surveys the code (weighted toward recently changed areas and existing ADRs), writes candidate cards with the files, problem, proposed solution, benefits, a before and after diagram and a strength rating, ends with a top recommendation, and changes no code. As published it is invoked by a person and then interviews them about the chosen candidate; Warden runs unattended, so it uses the survey and card shape and replaces the interview with the questions below.
  - Fidelity is a setting. The MVP level is a decision matrix: a few options side by side with their trade-offs and Warden's recommendation, each question answerable with one pick. Higher levels add the full design write-up and diagrams.
  - Which classes count and how they relate to reversibility: decided 2026-11-26 (see Decision above). The default list stands, plus external effects, and a change is a one-way door exactly when it touches a boundary class.
- **Reviewer model:** "i don't know yet, maybe a new context and sam model, or, we build statistics and see which mdoel is better at reviewing code as a longer term goal." The MVP may use a fresh context of the same model. Recording model ids on every verdict makes per-model review statistics possible (PRD §11); choosing reviewer models from them is a longer-term goal.

## Consequences

- Maintainer time moves from diffs to specs and tests, which is where intent lives and where no model can stand in for the maintainer.
- The boundary floor will raise the human-decision rate on some work that auto-merges today. The measure in PRD §11 (maintainer decisions per completed item) keeps that visible.
- Contributor PRs get the same card shape: the linked issue or spec, the contributor's test diff with the scan results, then the rest.
- The cost the article admits is real: review was also how people learned the codebase. For a solo maintainer that is mostly the maintainer's own understanding; Retro's coherence check and the held Retro sampling idea are the places to revisit it, not a requirement here.
- Model-family recording, and so the review statistics, depends on the endpoint registry (design ruled 2026-11-24) and verdict provenance (ruled 2026-11-27: every verdict records its tier, endpoint and exact model id), both in [MODEL-CONNECTIONS](../research/MODEL-CONNECTIONS.md) and neither built yet.
- Boundary design cards are a new card kind and a new Warden job (the design survey), with its own budget.

## Related

- [ADR 0008](0008-tiered-autonomy-and-merge-gates.md): merge gates, risk separate from severity
- [ADR 0010](0010-yaml-business-rules.md): standing orders hold the boundary paths
- [ADR 0014](0014-frozen-acceptance-tests.md): the frozen tests are the contract
- [ADR 0016](0016-verification-loop-and-test-quality-evidence.md): test-quality evidence that lets the diff go unread
