# Triage is a factory built-in task; no repo-supplied commands

- **Status:** Draft
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

The first design wrapped a command the pilot repo already had, which coupled the factory to one repo's tooling and opened an injection surface: a repo-supplied command runs inside an agent session that holds tools. The owner's direction: take what the pilot repo's triage workflow does well, and make it the factory's own.

## Decision

- Triage is a local AI factory built-in: investigate reports against current code, confirm defects with evidence, and classify kind, severity and change risk separately. Deterministic Actions Intake only routes metadata and explicit rules.
- Repositories configure built-in behavior, never executable task orchestration. Trusted, maintainer-authorized build/lint/test commands are permitted for isolated verification, not as substitute task programs.
- Features and enhancements receive a design proposal with scope, observable acceptance criteria, affected areas, blast radius, alternatives and uncertainty. Maintainer approval is required before implementation. Material design changes require renewed approval.
- Triage proposes validated state/label intents through the shared serialized writer. It never advances a completed-review marker.

## Consequences

- Confirmed unclaimed bugs within authority can become implementation-ready; an active contributor claim does not.
- Implementation requires appropriate fail-before/pass-after evidence: static checks for structural defects, dynamic reproduction for behavioral defects. Test count is not proof of correctness.
- Confirmation quality is measured in replay and live outcomes; uncertainty escalates rather than becoming an unsupported confirmation.
- The factory's task surface is closed: what it does is known, reviewed and versioned with the package.
