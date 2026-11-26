# Evidence from tests that predate the change, and differential checks

- **Status:** Mostly decided. The older-test rule (provenance, card and gate) and opt-in differential checks were decided on 2026-11-26. A refinement of the feature clause (where new feature tests go) remains Proposed, awaiting owner review.
- **Date:** 2026-11-25
- **Decided by:** @trek-e for the older-test rule and differential checks (2026-11-26); pending for where new feature tests go
- **Research:** [Sumner, "How to Ship Millions of Lines of Agent-Written Code"](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md), candidates 1 and 2; [follow-up research on feature tests](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md#1-tests-for-new-features-without-test-sprawl)

## Context

Warden already refuses to count agent-authored test count or coverage as correctness evidence, protects verification controls, and captures results through a trusted executor (PRD §7). It does not record whether a passing test existed before the change. A test the change added, or one whose expectation it edited, passes for reasons the change controls; a test that is byte-identical on the trusted base does not.

Jarred Sumner's account of shipping Bun's agent-written AOT compiler rests on exactly that distinction: the suites he trusted "pre predated the project so that way we know that like the agent couldn't have messed with it", and he declined a Rust rewrite of Claude Code because porting its tests would mean "you can't really trust the tests anymore". His second method is differential: the JIT build, the AOT build and the AOT build with types stripped must behave the same, and generated inputs widen the comparison. Bun's published Rust-rewrite write-up confirms the first method (the TypeScript suite run unchanged against both implementations). The InfoQ coverage records the counterpoint that 19 regressions still escaped, so pre-existing tests are strong evidence, not complete evidence.

Warden compares baseline and candidate test *results*. It has no check that compares baseline and candidate *behavior* on the same inputs, which is the useful oracle for work meant to change no behavior.

This ADR is adjacent to proposals in open PR #47: frozen acceptance tests (ADR 0014) and mutation and holdout checks (ADR 0016). It does not depend on either and does not change them.

## Decision

### Older tests (decided 2026-11-26, @trek-e)

- **Record provenance per test.** For every test on the trusted base or the candidate, record whether its file and test body are byte-identical on the trusted base (`preexisting`), changed (`modified`), removed (`deleted`) or new (`added`). Provenance is computed by Warden from the two revisions, never reported by the model.
- **Always show it.** The PR card always shows which tests existed before the change, and lists their evidence first. `added` tests are still shown and still required where the PRD requires them (fail-before/pass-after).
- **Editing or deleting an older test blocks auto-merge.** A `modified` or `deleted` pre-existing test is always called out clearly on the card and blocks auto-merge. It does not count as evidence for the change, and it is still reviewed against approved requirements, as PRD §7 requires for expectation changes.
- **Refactors and bug fixes need older-test coverage.** When the PR is labelled a refactor or a bug fix and no pre-existing test covers the changed code, auto-merge is blocked.
- **New features are exempt from that requirement.** No older test can exist for new behavior. Their new tests get extra review or independent checks instead (for example the frozen tests, mutation and holdout checks proposed in PR #47).
- **Why.** Pre-existing tests are independent evidence of behavior, in the sense of Michael Feathers' characterization tests: they record what the code did before anyone touched it. Test edits in the same PR are the red flag, because they let the change set its own bar.

### Where new feature tests go (proposed refinement, 2026-11-26)

@trek-e's goal is no test proliferation each time a feature is added, with a new function-level test only for a completely new function, following established practice. The sources (Software Engineering at Google ch. 12; Beck's Test Desiderata; Shi et al., FSE 2014) agree with the goal but warn against growing an existing test case to cover new behavior. They also measure redundancy by what a test catches, not what it runs. Proposed:

- **New behavior is a new case in the existing suite.** A feature or bug fix on existing code adds new test cases inside the test file or suite that already exercises the unit it extends, reusing that suite's fixtures and helpers. It does not edit existing cases. That stays the blocking condition above.
- **New test files only for new units.** A new test file, harness or fixture set is created only when the change adds a public unit (function, module or class) with no existing test home.
- **Provenance records placement.** For each `added` test, record whether it sits in an existing test file or a new one.
- **Review reports sprawl.** A new test file, harness or fixture set for code that already has a test home is a Review finding, unless the change adds a new unit.
- **Redundancy is measured.** Where mutation checks run (PR #47, ADR 0016), the card lists added tests that killed no mutant the pre-existing suite missed.

### Differential checks (decided 2026-11-26, @trek-e)

- **Optional differential checks, off by default.** For an item whose approved scope says it should not change behavior (refactor, performance work, dependency update, port), a repository may enable `verification.differential`. Warden runs the trusted base and the candidate on the same inputs in the isolated workspace and compares outputs. Any difference is a finding. Inputs come from the repository's own fixtures or recorded cases, or from generators when enabled.
- **Checks must prove they can fail.** Generated inputs and fuzzers count as evidence only if, in the same run, they catch a planted defect in a throwaway copy. A generator that catches nothing planted is reported as ineffective, not as passing. This is the same idea as ADR 0016's mutation testing, applied to inputs.
- **Unsupported is never a pass.** A language or project shape the differential runner does not support is reported as `differential: unsupported` on the card. It neither passes nor blocks by itself.

## Consequences

- The executor needs a per-test identity stable enough to compare across revisions. Test frameworks differ; the first version can work at file granularity and refine later.
- Differential runs roughly double verification time for the items that use them. They are opt-in and limited to behavior-preserving scope.
- A finding from a differential difference follows the 2026-11-24 ruling that a finding is a finding; it can block merge.
- The card gets one more line (provenance summary) and, when enabled, a differential result.
- The coverage gate needs to know which tests exercise the changed code. Where Warden cannot tell, the code counts as not covered, consistent with PRD §7 (auto-merge blocks without meaningful evidence). How coverage is measured per language is for build planning.
- Finding a unit's test home needs coverage or the repository's test layout. Where Warden cannot tell, it reports the placement as unknown rather than raising a sprawl finding.
- The refactor and bug-fix gate depends on the item's label being right; a mislabelled feature that is really a refactor would skip it, so the gate rests on the item being classified correctly.

## Open questions for the owner

1. ~~Show provenance on the card only, or also gate on it?~~ Decided 2026-11-26 (see Decision).
2. ~~Adopt `verification.differential` as opt-in, off by default?~~ Decided 2026-11-26: yes.
3. Adopt the proposed refinement on where new feature tests go (new cases in the existing suite, no edits to existing cases, new test files only for new units, sprawl as a Review finding)? Is an added test that kills no new mutant a finding, or shown on the card only?

## Related

- PRD §5 Implement, §5 Review, §7, §11
- ADR 0008 (risk, evidence and merge authority)
- PR #47 proposals: ADR 0014 (frozen tests first), ADR 0016 (mutation and holdout checks)
