# The factory acts with tiered autonomy; the merge gate is severity-based and configurable

- **Status:** Accepted
- **Date:** 2026-11-16
- **Decided by:** @trek-e

## Context

The first design never merged: every PR ended at a human gate. The owner redefined the factory's role: merging and approving is what a software factory does, with human oversight. That oversight must be mechanical — risk tier plus verifier confidence decide what the factory may do alone.

## Decision

- **Tiered autonomy:** risk tier plus verifier confidence decide whether the factory acts (e.g., merges) or escalates to a decision card. Thresholds are per-repo config.
- **Merge gate:** a blocker finding always stops a merge — not configurable. Major, minor and nit block only when enabled in config; all three are on by default (any nit can become a major with one change).
- "Successful review" = CI green + verifier pass + zero enabled findings. The factory merges on success; everything else escalates to the decision card (linked issue, Merge Danger, CI evidence, open findings, recommendation).
- Enhancement and feature approval, `wontfix`, approving a contributor PR beyond the gate, and changes to workflows or `MAINTAINERS` always need the maintainer.

## Consequences

- The human gate shrinks to escalations; success metrics track auto-merge rate and revert/escape rate on auto-merges to keep the thresholds honest.
- Contributor PRs: review is report-only; findings go back to the author (the factory never writes to their branch).
