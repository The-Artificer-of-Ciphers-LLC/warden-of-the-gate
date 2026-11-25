# Evidence from tests that predate the change, and differential checks

- **Status:** Proposed, awaiting owner review (2026-11-25). Nothing here is decided.
- **Date:** 2026-11-25
- **Decided by:** pending @trek-e
- **Research:** [Sumner, "How to Ship Millions of Lines of Agent-Written Code"](../research/TALK-SUMNER-AGENT-WRITTEN-CODE.md), candidates 1 and 2

## Context

Warden already refuses to count agent-authored test count or coverage as correctness evidence, protects verification controls, and captures results through a trusted executor (PRD §7). It does not record whether a passing test existed before the change. A test the change added, or one whose expectation it edited, passes for reasons the change controls; a test that is byte-identical on the trusted base does not.

Jarred Sumner's account of shipping Bun's agent-written AOT compiler rests on exactly that distinction: the suites he trusted "pre predated the project so that way we know that like the agent couldn't have messed with it", and he declined a Rust rewrite of Claude Code because porting its tests would mean "you can't really trust the tests anymore". His second method is differential: the JIT build, the AOT build and the AOT build with types stripped must behave the same, and generated inputs widen the comparison. Bun's published Rust-rewrite write-up confirms the first method (the TypeScript suite run unchanged against both implementations). The InfoQ coverage records the counterpoint that 19 regressions still escaped, so pre-existing tests are strong evidence, not complete evidence.

Warden compares baseline and candidate test *results*. It has no check that compares baseline and candidate *behavior* on the same inputs, which is the useful oracle for work meant to change no behavior.

This ADR is adjacent to proposals in open PR #47: frozen acceptance tests (ADR 0014) and mutation and holdout checks (ADR 0016). It does not depend on either and does not change them.

## Decision (proposed)

- **Record provenance per test.** For every test the trusted executor runs on the candidate, record whether its file and test body are byte-identical on the trusted base (`preexisting`), changed (`modified`) or new (`added`). Provenance is computed by Warden from the two revisions, never reported by the model.
- **Rank evidence by provenance.** The PR card and the review record list evidence from `preexisting` tests first. `added` tests are still shown and still required where the PRD requires them (fail-before/pass-after).
- **A modified expectation leaves the evidence.** A `modified` pre-existing test does not count as evidence for the change. The modification is still reviewed against approved requirements, as PRD §7 already requires for expectation changes.
- **Optional differential checks.** For an item whose approved scope says it should not change behavior (refactor, performance work, dependency update, port), a repository may enable `verification.differential`. Warden runs the trusted base and the candidate on the same inputs in the isolated workspace and compares outputs. Any difference is a finding. Inputs come from the repository's own fixtures or recorded cases, or from generators when enabled.
- **Checks must prove they can fail.** Generated inputs and fuzzers count as evidence only if, in the same run, they catch a planted defect in a throwaway copy. A generator that catches nothing planted is reported as ineffective, not as passing. This is the same idea as ADR 0016's mutation testing, applied to inputs.
- **Unsupported is never a pass.** A language or project shape the differential runner does not support is reported as `differential: unsupported` on the card. It neither passes nor blocks by itself.

## Consequences

- The executor needs a per-test identity stable enough to compare across revisions. Test frameworks differ; the first version can work at file granularity and refine later.
- Differential runs roughly double verification time for the items that use them. They are opt-in and limited to behavior-preserving scope.
- A finding from a differential difference follows the 2026-11-24 ruling that a finding is a finding; it can block merge.
- The card gets one more line (provenance summary) and, when enabled, a differential result.

## Open questions for the owner

1. Show provenance on the card only, or also require at least one `preexisting` test exercising the changed behavior before auto-merge?
2. Adopt `verification.differential` as opt-in, off by default?

## Related

- PRD §5 Implement, §5 Review, §7, §11
- ADR 0008 (risk, evidence and merge authority)
- PR #47 proposals: ADR 0014 (frozen tests first), ADR 0016 (mutation and holdout checks)
