# A bounded verification loop owned by the orchestrator, and evidence that the tests guard behavior

- **Status:** Proposed, awaiting owner review (2026-11-25). Nothing here changes behavior until accepted.
- **Date:** 2026-11-25
- **Decided by:** pending @trek-e
- **Research:** [Review the tests, not the diff](../research/TESTS-OVER-CODE-REVIEW.md)

## Context

Practitioners agree that letting an agent verify its own work is the biggest single improvement (Boris Cherny estimates 2-3x; Simon Willison: deliver code you have proven to work). Today Implement runs one session, then the executor judges once: a red result ends the attempt. Rework is the only retry, and each round is a full cycle.

A loop has a known failure mode. On ImpossibleBench, more feedback rounds raised cheating from 33% to 38%: the more an agent is pushed toward green, the more it bends the tests. The loop is safe only when the tests are frozen (ADR 0014).

Green also is not enough. Coverage is a poor proxy for catching bugs: one LLM-written suite with full line and branch coverage killed 4% of planted mutants (a single example; average plain-LLM scores were about 70-78%). Hardcoding passes example tests; properties make it pointless. Holdout tests help a little, not much: on EvilGenie they added minimal detection because "good enough" heuristic solutions pass both sets.

Claude Code's Stop hook is the article's mechanism, but it is not a hard gate (a hook that cannot start lets the session end; eight consecutive blocks end the turn anyway), and OpenCode has no blocking equivalent. Warden is harness-agnostic (ADR 0006), so the loop belongs in the orchestrator.

## Decision

- **Verify-and-continue loop.** Inside one Implement or Rework attempt, after the fix session reports done, the executor runs the trusted checks. If they fail, the orchestrator resumes the same session (or starts a fresh one with the same frozen inputs, as the harness allows) with the executor's own failure output, bounded to a configured number of turns (`verification.loopTurns`, default 3) and the task's measured budgets. The session never decides it is finished; the executor does.
  - The frozen-test digest check (ADR 0014) runs on every turn. A modification ends the attempt immediately.
  - Loop turns are not rework cycles and not retries; they are part of one attempt and recorded as such. An attempt that exhausts its turns ends `insufficient-evidence` with the last executor result.
  - No turn waits for GitHub CI or a human (PRD §9).
- **Test-quality evidence.** The executor adds three kinds of evidence, each language-pluggable and reported as unsupported where no tool exists for the repository's language (unsupported never counts as a pass):
  1. **Mutation score on changed code.** Run a mutation tool (Stryker for JavaScript/TypeScript) scoped to the files and line ranges the change touches, against the frozen tests plus existing tests. Each surviving mutant on a changed line is a finding with its location. The score and survivors are recorded. During the pilot this is a finding source, not a merge threshold; a threshold (`verification.mutation.breakBelow`) is set only from pilot data, and once set it ratchets (may only rise), like the static-rule baseline. Mutation runs inside the execution boundary on the candidate only.
  2. **Property-based tests for pure logic.** The test session is told to prefer properties (for example with fast-check) over a few examples where the code under test is a pure function, and to state an oracle or a metamorphic relation, not only range checks. Properties are encouraged, not required; their presence is reported.
  3. **Holdout acceptance checks (optional).** A maintainer may attach acceptance checks to an approved feature that live outside the repository, in the protected operator store. The executor runs them on the candidate; no session, prompt packet, PR body or comment ever sees their content, only pass or fail per check id. The operator store is outside every session's deny-by-default Seatbelt profile, so a session cannot read it. A failing holdout is a blocker finding. Holdouts are one layer, not the wall.
- **Quiet escapes, expanded.** Gate-weakening detection (PRD §7, `verify/executor.ts`) adds: focused tests (`.only`, `fit`, `fdescribe`), widened numeric tolerances and raised timeouts or retry counts in tests, regenerated or bulk-updated snapshot files, changes to test-runner include/exclude or mutation configuration, and test files moved out of `verification.testPaths`. Where a repository uses ESLint with `@vitest/eslint-plugin`, Warden's starter config recommends `no-disabled-tests`, `no-focused-tests` and `expect-expect` as ordinary lint rules.
- **Show the proof.** Factory PR descriptions show, from the executor record and never from model prose: each check's command line, exit status and a bounded output tail; the fail-on-base result for frozen tests; the mutation score and survivors; holdout pass/fail by id.

## Consequences

- Fewer attempts end on a near-miss; each attempt can take longer. Budgets and `loopTurns` are measured per task before activation.
- Mutation testing is slow. Scoping it to changed lines and running it once per attempt (not per loop turn) keeps it bounded; its wall time is reported with the other budgets.
- Contributor PRs also get the mutation and weakening checks on their changed code, so a contributor's thin tests produce findings with locations rather than a silent pass.
- New `.github/warden.yml` keys: `verification.testPaths`, `verification.loopTurns`, `verification.mutation` (tool, scope, `breakBelow`, off by default), `verification.holdouts` (enabled flag; contents stay in the operator store). Schemas and pinned defaults follow ADR 0005.
- What remains for a human or AI reviewer: special-casing that defeats properties and mutants, spec misreadings the maintainer did not catch in the contract, and anything at a boundary (ADR 0015).

## Related

- [ADR 0006](0006-agentrunner-adapter-seam.md): the orchestrator, not the harness, owns completion
- [ADR 0009](0009-factory-product-boundary.md): verification runs trusted commands inside a real boundary
- [ADR 0014](0014-frozen-acceptance-tests.md): frozen tests make the loop safe
- [ADR 0015](0015-contract-review-human-gate.md): what the human reads instead of the diff
