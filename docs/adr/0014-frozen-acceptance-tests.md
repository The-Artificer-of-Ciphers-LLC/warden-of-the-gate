# Frozen acceptance tests: written first in their own session, untouchable during the fix

- **Status:** Proposed, awaiting owner review (2026-11-25). Nothing here changes behavior until accepted, except the two owner rulings below.
- **Date:** 2026-11-25
- **Decided by:** pending @trek-e
- **Research:** [Review the tests, not the diff](../research/TESTS-OVER-CODE-REVIEW.md); [FACTORY-CLAIMS-VS-EVIDENCE](../research/FACTORY-CLAIMS-VS-EVIDENCE.md) §3.5

## Context

Implement today runs one session that is told to add a failing test and then fix the code (`implement/slice.ts`, `buildImplementPrompt`). The executor proves the new test fails on the base and passes on the candidate. That proves the test and the fix agree with each other, not that either agrees with the issue: a misread requirement produces a perfect test of the wrong thing and a perfect fix for it.

Agents also cheat when they can. ImpossibleBench found Claude models cheated mostly by editing tests, even when told not to; EvilGenie found Claude Code and Codex hardcoding expected outputs and Gemini CLI editing test files. Read-only tests stop test editing but not special-casing. A prompt instruction ("never weaken tests") is a request, not a control. Harness permission rules are not binding either: Claude Code's deny rules miss a script that opens files itself, and OpenCode's documentation does not say its shell tool honors `edit` rules. The Seatbelt profile (`runner/seatbelt.ts`) grants `file-write*` on the whole workspace. Only the OS boundary and the trusted executor can bind.

## Decision

- **Two sessions for factory work.** Implement runs a **test session** and then a **fix session**, both fresh and both inside the existing execution boundary.
  - The test session sees the issue, the triage record or the approved spec and the base code. It writes tests only: for a bug, the reproducer; for a feature, tests for each approved acceptance criterion. It may not change non-test files; a non-test change rejects the attempt.
  - The executor runs the new tests on the base. **Every new test must fail on the base** (a test that passes before the fix exists tests nothing). A test that cannot be made to fail returns the item to Triage, as the PRD already requires for an unprovable bug.
  - The fix session sees the frozen tests and the spec, never the test session's reasoning or transcript. Its prompt says the tests are the acceptance criteria and are read-only; it is never told "make the tests pass".
- **Freeze record.** After the test session, Warden records the frozen test set in the ledger: each path, its content sha256 and the base commit. Test files are recognized by configured globs (`verification.testPaths` in `.github/warden.yml`; defaults: `test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, snapshot files) plus the test-runner and coverage configuration files the repository uses.
- **Binding enforcement, in two layers.**
  1. The fix session's Seatbelt profile adds write denial for every frozen path and for the test-runner, lint, coverage and mutation configuration (an OS rule, not a harness setting). Harness permission rules may mirror it as defense in depth but are never relied on; OpenCode's rule order (last match wins) and its V1/V2 config change make it a poor sole control.
  2. The executor does not trust the working tree for the acceptance evidence: it runs the frozen tests from its own copy taken at the freeze. After the fix session it also recomputes the frozen digests in the workspace. Any changed, deleted or renamed frozen file makes the attempt `rejected` with reason `frozen-test-modified`. The fix session may add new test files; they are reported as unreviewed additions and never count as the acceptance evidence.
- **A wrong test is not fixed by the fixer.** The fix session's result schema has an explicit `test-dispute` exit (on ImpossibleBench, an allowed "flag it" exit cut GPT-5's cheating from 54% to 9%). If the fix session reports that a frozen test contradicts the spec, Implement stops with `test-dispute`, records the session's stated reason as untrusted text, and returns the item to the test session once with that reason, or to `needs-decision` if the spec itself is ambiguous. The attempt counts.
- **Rework keeps the freeze.** Rework sees the same frozen set. A review finding that a frozen test is itself wrong routes to a new test session and a new freeze, recorded with the finding that caused it; it never travels inside a fix commit.
- **Factory PRs separate the two.** A factory PR's description lists the frozen tests (paths, digests) separately from the implementation, so a reader of the contract (ADR 0015) can find them first.
- **Contributor PRs.** Warden cannot control how a contributor wrote their change. Their PRs keep the existing rules: changes to existing test expectations need review against approved requirements, and weakening is detected (PRD §7). Warden pushes nothing to a contributor's branch (owner ruling 2026-11-25, ADR 0008), so no Warden commit can change a contributor's tests.

## Owner rulings (2026-11-25, @trek-e)

- **Bug reproducers under standing authority:** "For now, yes, will need to test." The frozen reproducer plus the weakening and mutation checks are enough; no maintainer looks at the reproducer before the fix session by default, and a standing order may require a look. The ruling is provisional: pilot and replay testing must measure how often a reproducer later proved wrong or too weak (PRD §11). Features still include the acceptance tests in the approval.
- **Fixes on contributor branches:** moot. Warden is review only on contributor PRs (ADR 0008), which replaces the proposed narrowing that stood here.

## Consequences

- Implement costs a second session per attempt. Budgets are measured per task (PRD §9), so the test session gets its own measured budget.
- The fail-before check moves earlier and becomes a gate on the test session rather than a check on the finished candidate. `evidenceFor` still requires a test that went from failing on the base to passing on the candidate, and now also requires that test to be in the frozen set.
- `copyPaths` in `implement/slice.ts` already recognizes test paths by a fixed pattern; it becomes the configured `verification.testPaths` set.
- Takeover (abandoned contributor work) passes the contributor's tests to the test session as data to assess, never as a frozen set.
- What this does not stop: special-casing that passes frozen tests. That is what properties, mutation testing and holdouts are for (ADR 0016).
- Capability proof before live use: a sandbox run where the fix session tries to edit a frozen test through its file tool and through a script, and both are blocked by the OS profile and caught by the digest check.

## Related

- [ADR 0006](0006-agentrunner-adapter-seam.md): harness permissions are not trusted; the deterministic core validates
- [ADR 0008](0008-tiered-autonomy-and-merge-gates.md): review only on contributor PRs
- [ADR 0015](0015-contract-review-human-gate.md): the frozen tests are the contract a human reviews
- [ADR 0016](0016-verification-loop-and-test-quality-evidence.md): the verification loop is safe only because these tests are frozen
