# The factory never executes a product's own workflow; warden-core is separated from repo-specific logic

- **Status:** Draft
- **Date:** 2026-11-16
- **Decided by:** @trek-e

## Context

The pilot repo has its own development workflow (a phase loop). Early drafts treated that loop as something the factory runs or replaces. The owner's correction: a product is something the factory makes and maintains — its internal workflows are features of the product, never factory machinery.

## Decision

- warden-core contains no logic for any specific repo's development workflow. The factory maintains products (including the pilot repo) like any other repo: triage, review, implement, rework, sweep, retro.
- All AI tasks are factory built-ins (ADR 0001); repos configure behavior, never task logic.
- A product's internal workflows (e.g., the pilot repo's phase loop) are code the factory reviews and maintains — not processes it executes.
- This boundary does not prohibit verification. Warden may run maintainer-authorized build, test, and lint commands from trusted configuration inside a real OS/container execution boundary. A worktree alone is not isolation. Issues, PR text, and standing-order rule groups cannot inject executable task logic.

## Consequences

- The core is portable to any repo without per-repo workflow coupling; "works on the pilot repo" never bleeds into "is the pilot repo's tooling".
- New repos adopt by config only; nothing in core knows a specific repo exists.
