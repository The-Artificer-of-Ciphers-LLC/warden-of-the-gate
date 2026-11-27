# Record a change's intended behavior effect at Triage; a fix is never tested against the broken behavior

- **Status:** Proposed (2026-11-26). The owner said yes to the facet on 2026-11-26 and ruled that a fix of broken behavior must not be tested against that broken behavior. The details below await owner review. Nothing here changes behavior until accepted. Amends ADR 0017.
- **Date:** 2026-11-26
- **Decided by:** @trek-e (adopt; broken behavior is never the baseline); details pending
- **Research:** [McCarthy brownfield factories talk](../research/TALK-MCCARTHY-BROWNFIELD-FACTORIES.md), proposal 2

## Context

ADR 0017 turns on its older-test gate and its opt-in differential checks from the item's label: refactor or bug fix. Its own consequences note the weakness: a mislabelled item skips the gate. McCarthy's talk separates work that discovers new behavior from work that preserves existing behavior; Warden's Triage already decides scope, so it can record that intent directly.

A differential check compares the trusted base against the candidate and treats any difference as a finding. For a bug fix that is wrong in exactly one place: the base's output for the broken case is the bug. Comparing against it would flag the fix itself.

Owner, 2026-11-26: "yes but if the alteration is a fix of a broken behavior it shouldn't use that as a bellwether to test against".

## Decision

- **Triage records one facet on every item it confirms.** `preserve` means the change should not alter observable behavior (refactor, performance work, dependency update, port). `change` means new or altered behavior (feature, enhancement). `fix` means a bug fix: the broken behavior changes, everything else is preserved. For features and enhancements the facet is part of the approved scope. The facet sits with the other semantic facets (PRD §4) and is shown on the card.
- **The facet replaces the label as the trigger.** ADR 0017's older-test gate and differential checks key off the facet, not the PR's refactor or bug-fix label. A label that disagrees with the facet is shown on the card; the facet decides.
- **`preserve`:** the differential check, where enabled, compares base and candidate on all inputs. Any difference is a finding.
- **`change`:** no differential check against the base for the new behavior. A `change` item that turns out to change nothing is reported but does not block.
- **`fix`: the broken behavior is never the baseline.**
  - The oracle for the fixed behavior is the frozen reproducer and the confirmed expected behavior from Triage (ADR 0014), never the base's output.
  - The differential check, where enabled, excludes the inputs the frozen reproducer covers. A base-versus-candidate difference on those inputs is expected and is not a finding.
  - A difference on any other input is a finding, because it means the fix changed more than the bug. The card shows the input and both outputs, so the maintainer can see whether the bug is wider than the reproducer. If it is, the fix returns to Triage to widen the reproducer and re-freeze it; the fix session does not widen it.
  - An older test that asserts the broken behavior still blocks auto-merge if the fix edits it, as ADR 0017 decides. The card names the reproducer the edit conflicts with, so the maintainer's decision has the reason in front of it.
- **Unknown is not `preserve`.** If Triage cannot tell which facet applies, the item is not confirmed until the maintainer or the approved spec says. Warden never defaults an item to `preserve` or `change` to make a gate pass or skip.

## Consequences

- Closes the mislabelling gap ADR 0017 names.
- A bug that reaches beyond its reproducer is caught as a finding rather than passing silently or blocking with no explanation.
- Triage records one more facet, and changing it after confirmation goes through the same maintainer decision as other scope changes.
- No new check: this decides when existing checks (ADR 0014 frozen tests, ADR 0017 older tests and differential checks) run and what they compare against.

## Questions for the owner

1. When a fix's differential check finds a difference outside the reproducer, should it always go back to Triage to widen the reproducer, or may the maintainer accept the wider change on the card?
2. A dependency or CVE update often changes behavior on purpose (a deprecation, a security default). Is it `preserve` with listed exceptions, or `change`?

## Related

- [ADR 0014](0014-frozen-acceptance-tests.md): frozen reproducer as the oracle for a fix
- [ADR 0017](0017-preexisting-tests-and-differential-checks.md): the gates this facet now triggers
- [ADR 0023](0023-promise-checks.md): a `preserve` item's promises are compared the same way
