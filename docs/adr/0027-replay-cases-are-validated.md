# Replay cases are checked before they count

- **Status:** Accepted (2026-11-28)
- **Date:** 2026-11-28
- **Decided by:** @trek-e, 2026-11-28 ("Merge" on PR 175, in answer to "Merging it is your yes to the four proposals.")
- **Research:** [Hugging Face, "Introducing harness adapters"](../research/HARNESS-ADAPTERS-AT-SCALE.md), lesson B
- **Builds on:** PRD §11 (pilot activation gate), [ADR 0018](0018-measured-not-estimated.md) (replay sets), [ADR 0022](0022-new-model-starts-paused.md) (qualification)

## Context

PRD §11 makes the replay set the evidence behind live activation, and ADR 0022 makes it the evidence that a new model may give auto-merge verdicts. The set is curated by the maintainer and scored deterministically. Today `replay/replay.ts` `validateSet` checks a case's shape only: a unique id, files and an expectation for a review case, a kind and outcome for a triage case. It does not check that the case can be scored the way the curator meant.

A case can be wrong in ways a shape check does not see. A known defect can name a file the case does not include or lines the reviewer is never shown, so no review can match it. A triage case can list so many acceptable answers that any output passes. A case can name a commit the local clone does not hold, so its context is missing on one machine and present on another. Each of these makes the gate number wrong without anyone noticing.

Hugging Face ran four checks on every task before training or evaluating on it (Validation with openenv validate): the reference solution gets full reward, doing nothing scores lower, no wrong-answer canary scores above doing nothing, and replaying the reference gives the same reward. Of 1,127 candidates, 858 passed. The wrong-answer controls caught a generated task that accepted an incomplete implementation and a Terminal-Bench 2.1 verifier that accepted known-wrong answers, so a published benchmark had the fault too. Most failures were infrastructure, such as images that did not start. Failed tasks were kept in a rejected split with the failing check recorded, not deleted.

The same idea is older than the post. A test suite that cannot fail tells you nothing, which is why Warden already requires frozen tests to fail on the base before a fix ([ADR 0014](0014-frozen-acceptance-tests.md)) and planted mutants to be killed ([ADR 0016](0016-verification-loop-and-test-quality-evidence.md)). This ADR applies that rule to the replay set itself.

## Decision

### The per-case pass rule

The checks below, and the repeated-trial scoring ADR 0018 already decided, use one per-case rule:

- A review case with known defects passes when every known defect is matched (same file and same changed hunk, or the curated lines; PRD §11) and no finding is left outside the known and verified-real ones.
- A clean review case passes when no finding is left outside the verified-real ones.
- A triage case passes when the output's kind and outcome are each among the acceptable values.

### Four checks per case, with no model

Before a replay run, every case is checked with fixed, synthetic answers fed through the same scorer the run uses. No model is called.

| Check | Review case with known defects | Clean review case | Triage case |
|---|---|---|---|
| **Expected answer passes** (the post's `oracle_max`) | A review with exactly one finding at each known defect passes. Each known defect names a file in the case and lines its patch shows the reviewer | An empty review passes | Each acceptable kind and outcome is a value the triage result schema allows (`triage/schema.ts`), so a correct model can produce it |
| **Doing nothing fails** (`floor_gap`) | An empty review fails | Not applicable: doing nothing is the right answer | An output with no usable kind or outcome does not match |
| **A wrong answer does not pass** (`canary_floor`) | A review with findings only outside the known defects' hunks, where the case has such hunks, matches no known defect | A review with one finding on every changed hunk fails | The acceptable values do not cover every value the schema allows for kind, or every value for outcome |
| **Same input, same score** (`episode_determinism`) | Scoring the same recorded review twice gives the same result, and every commit the case names (`head`, `base`) is present in the clone the run uses | Same | Scoring the same recorded output twice gives the same result |

Where a check cannot be built for a case (for example, a one-hunk case has no hunk outside its defect for the wrong-answer check), the report says "not applicable" for that check and that case. It is not counted as a pass.

### Rejected cases are kept and shown

- A case that fails a check is not run and does not count toward the §11 minimums (20 PRs, 20 issues, 10 blocking findings assessed) or toward any gate number.
- It stays in the set file and is listed in the replay report under `rejected`, with the check that failed and why.
- The qualification verdict reports the counted and rejected cases separately. A set whose counted cases fall below the §11 minimums cannot qualify, as today.
- A critical case that is rejected blocks qualification until the maintainer fixes or removes it, because §11 requires every known critical curated case to be detected.

### What this does not change

- The §11 bar, the hunk-matching rule, the regression and capability sets and their trial counts are unchanged.
- A model still never grades a gate. These checks are deterministic code over the case file.
- Curation stays with the maintainer. The checks apply to every case, however it was found.

## Consequences

- Some existing or future cases will be rejected. That lowers the counted set and may push it below the §11 minimums until the maintainer fixes them. The rejected list says exactly what to fix.
- A gate number can no longer rest on a case nobody could pass or nobody could fail.
- The checks are cheap: they run the scorer on a handful of synthetic answers per case and read the clone for the named commits.
- The canary checks are narrow. They catch cases that accept everything or cannot be matched, not a subtly wrong expectation. A wrong expectation is still found the way it is today, by a disagreement the maintainer reviews.

## Owner decision

Accepted as written, 2026-11-28.

## Related

- PRD §11
- ADR 0014 (a frozen test must fail on the base), ADR 0016 (planted bugs must be caught): the same principle applied to tests
- ADR 0018 (replay sets, repeated trials), ADR 0022 (qualification)
