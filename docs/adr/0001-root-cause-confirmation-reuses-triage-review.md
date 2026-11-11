# Root-causing a defect confirms the bug; the existing triage-review command is reused as is

- **Status:** Accepted
- **Date:** 2026-11-11
- **Decided by:** @trek-e

## Context

The loop needs a rule for when an issue becomes `confirmed-bug` without the maintainer. One option was to require a failing test on the base branch first. The maintainer already has a standalone triage-review command that root-causes a reported bug, and the maintainer describes it as working "perfectly".

## Decision

- The plugin applies `confirmed-bug` itself once it has root-caused the defect, the same way the triage-review command does today. No failing test is required to confirm.
- The triage stage runs the existing triage-review command unchanged. The plugin only wraps it: one issue per fresh session, with the outcome written to labels and the ledger.
- Which command runs is configuration (`triage.command`); GSD Core's config names `/triage-review`. Whether root-causing confirms is also configuration (`triage.confirmOnRootCause`), true for GSD Core.
- Enhancement and feature approval stays with the maintainer.

## Consequences

- Faster flow from report to `ready-for-agent`; the implement task still writes a failing-first test before fixing, so a test exists before any fix merges.
- Confirmation quality depends on the triage command; misconfirmations show up at the human gate and in the retro.
- No rewrite of a command that already works.
