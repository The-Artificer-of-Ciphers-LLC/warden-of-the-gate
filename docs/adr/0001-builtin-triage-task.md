# Triage is a factory built-in task; no repo-supplied commands

- **Status:** Accepted
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

The first design wrapped a command the pilot repo already had, which coupled the factory to one repo's tooling and opened an injection surface: a repo-supplied command runs inside an agent session that holds tools. The owner's direction: take what the pilot repo's triage workflow does well, and make it the factory's own.

## Decision

- Triage is a factory built-in task: it root-causes the report, classifies severity and applies labels. Its behavior was adapted from what works on the pilot repo, but it is Warden's own and documented in our terms.
- No task accepts a repo-supplied command. Repos configure behavior (labels, thresholds, voice) — never task logic.
- The confirmation rule is configuration: root-causing a defect applies `confirmed-bug` (on by default for the pilot repo). Enhancement and feature approval stays with the maintainer.

## Consequences

- Faster flow from report to `ready-for-agent`; implement still writes a failing-first test before fixing, so a test exists before any fix merges.
- Confirmation quality depends on the built-in triage; misconfirmations surface at the human gate and in retro.
- The factory's task surface is closed: what it does is known, reviewed and versioned with the package.
