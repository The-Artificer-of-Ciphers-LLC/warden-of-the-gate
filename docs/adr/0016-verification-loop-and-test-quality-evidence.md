# A bounded verification loop owned by the orchestrator, and evidence that the tests guard behavior

- **Status:** Proposed, awaiting owner review (2026-11-25). Nothing here changes behavior until accepted, except the owner rulings below.
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
  1. **Mutation score on changed code.** Run a mutation tool (Stryker for JavaScript/TypeScript) scoped to the files and line ranges the change touches, against the frozen tests plus existing tests. Every surviving mutant on a changed line is identified (file, line, mutation) and fails the check; the PR cannot merge until the tests catch it (owner ruling below). The score is recorded but is not the gate. Mutation runs inside the execution boundary on the candidate only.
  2. **Property-based tests for pure logic.** The test session is told to prefer properties (for example with fast-check) over a few examples where the code under test is a pure function, and to state an oracle or a metamorphic relation, not only range checks. Properties are encouraged, not required; their presence is reported.
  3. **Hidden acceptance checks (pilot).** For an approved feature, a separate holdout session writes a few acceptance checks. It gets the same inputs as the test session (the issue or approved spec and the base code) and never the coding session's context, reasoning or transcript; it checks whether the spec was met, not what the coding session did. A maintainer may add checks of their own. The checks live outside the repository, in the protected operator store. The executor runs them on the candidate; no session, prompt packet, PR body or comment ever sees their content, only pass or fail per check id. The operator store is outside every session's deny-by-default Seatbelt profile, so a session cannot read it. They start as a pilot and become a gate only on the evidence below. Holdouts are one layer, not the wall.
- **Quiet escapes, expanded.** Gate-weakening detection (PRD §7, `verify/executor.ts`) adds: focused tests (`.only`, `fit`, `fdescribe`), widened numeric tolerances and raised timeouts or retry counts in tests, regenerated or bulk-updated snapshot files, changes to test-runner include/exclude or mutation configuration, and test files moved out of `verification.testPaths`. Where a repository uses ESLint with `@vitest/eslint-plugin`, Warden's starter config recommends `no-disabled-tests`, `no-focused-tests` and `expect-expect` as ordinary lint rules.
- **Show the proof.** Factory PR descriptions show, from the executor record and never from model prose: each check's command line, exit status and a bounded output tail; the fail-on-base result for frozen tests; the mutation score and survivors; holdout pass/fail by id.

## Owner rulings (2026-11-25, @trek-e)

- **Mutation testing blocks merge:** "if a planted bug survives then it needs to be identified and failed as a check. bugs that aren't detected are just as bad as ones that are."
  - Implementation details, not exceptions: Stryker's `thresholds.break` defaults to null, which never fails a run, so Warden must not rely on the tool's own exit code. The executor reads the mutation report and fails the check on any survivor whose location is a changed line. As Stryker counts them, a timeout counts as detected and a runtime or compile error as invalid; a mutant no test covers ("no coverage") counts as a survivor.
  - An equivalent mutant (one that does not change behavior) can never be killed. Proposed, for the owner: a maintainer command marks that one mutant equivalent, recorded like a dismissed finding and cleared again when its code changes. Warden never marks a mutant equivalent itself.
  - A language with no supported mutation tool is reported as unsupported, never as a pass.
- **Hidden acceptance checks, a pilot:** "if that acutally works shure, if it's made up why would a model with no context know what happened in another context."
  - Answer to the question in the ruling: the holdout session is not meant to know what happened in the coding session. It writes checks from the spec, as an independent reader would, so special-casing that fits the visible tests can fail them.
  - The caveat stands: the holdout session is the same AI system and can share the coding session's misreading of the spec (correlated errors, Kim et al., ICML 2025). On EvilGenie, holdouts added little because "good enough" heuristic solutions passed both sets, and StrongDM's holdout scenarios are scored by a model. A model grading a model never decides a gate here (PRD §11); the executor runs the checks as tests.
  - The pilot runs in shadow and replay (PRD §11). Every holdout failure goes to the maintainer for a verdict: a real defect, or a wrong check.
  - Evidence to promote it to a gate, for the owner to judge: confirmed catches, meaning failures the maintainer agrees are real defects that the frozen tests, the mutation check and review all missed; a false-failure rate (checks judged wrong against the spec) low enough to accept; and the measured cost per item. Warden proposes the numbers from pilot data; the owner sets them. Without confirmed catches the pilot ends and the checks are not added.

## Consequences

- Fewer attempts end on a near-miss; each attempt can take longer. Budgets and `loopTurns` are measured per task before activation.
- Mutation testing is slow. Scoping it to changed lines and running it once per attempt (not per loop turn) keeps it bounded; its wall time is reported with the other budgets.
- Contributor PRs also get the mutation and weakening checks on their changed code. A surviving mutant there fails the check with its location, and the contributor addresses it (Warden is review only on contributor PRs, ADR 0008).
- Some merges that would pass today will wait on stronger tests; the measures in PRD §11 keep that cost visible.
- New `.github/warden.yml` keys: `verification.testPaths`, `verification.loopTurns`, `verification.mutation` (tool and scope; on where a tool exists), `verification.holdouts` (pilot flag; contents stay in the operator store). Schemas and pinned defaults follow ADR 0005.
- What remains for a human or AI reviewer: special-casing that defeats properties and mutants, spec misreadings the maintainer did not catch in the contract, and anything at a boundary (ADR 0015).

## Related

- [ADR 0006](0006-agentrunner-adapter-seam.md): the orchestrator, not the harness, owns completion
- [ADR 0009](0009-factory-product-boundary.md): verification runs trusted commands inside a real boundary
- [ADR 0014](0014-frozen-acceptance-tests.md): frozen tests make the loop safe
- [ADR 0015](0015-contract-review-human-gate.md): what the human reads instead of the diff
