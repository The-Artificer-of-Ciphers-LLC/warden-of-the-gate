# Review the tests, not the diff: Spector's method checked and held against Warden

- **Date:** 2026-11-25
- **Asked by:** @trek-e ("/deep-research the following document and create necessary PRD updates and ADRs that help the product follow this methodology")
- **Document:** Itai Spector, "Stop Reviewing AI's Code. Review Its Tests (Here's How to Write Ones It Can't Cheat)", Medium, November 2026 (17-page PDF supplied by the owner).
- **Method:** three parallel research tracks traced every cited claim to its primary source (human review evidence; AI self-review and test gaming; the hands-on test-locking techniques against current Claude Code, OpenCode, fast-check, Stryker and Vitest docs). Then a comparison by hand against the PRD, the ADRs and `packages/warden` on `main` (ea3c3e5).
- **Confidence:** MEDIUM. The direction of every finding holds. Most numbers come from 2025-2026 preprints, single-company studies or vendor posts, and three of the article's figures or attributions are wrong (§1).
- **What this PR changes:** a new research note, **PROPOSED** PRD text marked **[T]**, and three **proposed** ADRs ([0014](../adr/0014-frozen-acceptance-tests.md), [0015](../adr/0015-contract-review-human-gate.md), [0016](../adr/0016-verification-loop-and-test-quality-evidence.md)). Nothing marked [T] changes behavior until the owner accepts it. The [owner questions](#5-owner-questions) are the decisions it needs; the owner answered all six on 2026-11-25 (§5).

## The method in one paragraph

Line-by-line human review was never a strong bug filter, and AI volume has made it unworkable. Replace it with three things: a **verification loop** (the agent cannot finish on a red suite), **tests the agent cannot touch** (written first in a separate session, locked by tooling, backed by CI, hardened with properties, holdouts and mutation testing), and **human review of the contract** (spec and acceptance tests, plus a 30-second scan of the test diff for cheats). Human review of the implementation stays mandatory only where a change crosses a boundary others depend on: shared components, API contracts, schemas, auth, major dependencies.

## 1. The article's claims against their sources

| Claim in the article | What the source says | Verdict |
|---|---|---|
| CMU/Stanford, July 2026: 802 developers, ~196k PRs; PR volume 3.1x, reviewers 1.5x, load per reviewer ~2x | He, Agarwal, Denisov-Blanch, Azaletskiy, Koyejo, Vasilescu, arXiv [2607.01904](https://arxiv.org/abs/2607.01904): 802 developers, 196,212 PRs, Jan 2024 to Apr 2026; "3.1x", "reviewers grew only 1.5x", load "roughly doubled (2.0x)". The mandate was a target to double merged PRs per engineer, not just "AI tools". One anonymized company; authors call it "an upper bound rather than an industry average" | **Accurate.** Moderate evidence (preprint, one firm, difference-in-differences) |
| PRs with written human feedback fell 39% to 21%; silent approvals per reviewer ~doubled (via Semgrep) | The paper itself: "substantive" review 39% to 21%; PRs with no human review at all 11% to 32%; silent approvals ~2x while commented reviews stayed ~3 a month | **Accurate** (Semgrep sells review tooling) |
| "Everyone is playing the theater of doing reviews" (Orosz, Pragmatic Engineer) | Found only in Semgrep's post, attributed to one engineer; not in the free part of the Pragmatic Engineer issue | **Unverified** anecdote |
| Anthropic says human code review became a new bottleneck | Anthropic, [Bringing Code Review to Claude Code](https://claude.com/blog/code-review) (2026-03-09): "Code review has become a bottleneck". The article's exact sentence was not found in Anthropic's pages | **Substance true, wording unverified**; vendor launching a product |
| Bacchelli & Bird 2013: defects top motive, small share of comments; outputs were knowledge transfer, awareness, alternatives | [ICSE 2013](https://microsoft.com/en-us/research/?p=164195): defects ranked first for 44%; 14% of 570 comments were defect-related; code improvements 29%. Knowledge transfer comes from interviews, not comment counts | **Accurate, slight overreach** |
| ICSE 2022: 150 developers, seeded flaws caught 3% and 21%; focus on security helped; tailored checklist best at 61% | Braz et al., [Less is More](https://arxiv.org/abs/2202.04586): control 3% and 21%; security instruction alone 46% and 61%; tailored checklist the same 46% and 61% | **Numbers right, attribution wrong**: the instruction, not the checklist, did the work |
| CodeRabbit, 470 PRs: AI-coauthored 10.83 issues vs 6.45 human | [CodeRabbit blog](https://www.coderabbit.ai/blog/state-of-AI-vs-human-code-generation-report) (2025-12-17) matches; issues are CodeRabbit's own taxonomy, labels not guaranteed | **Accurate, weakest source** (vendor, not defects) |
| Self-correction blind spot: 14 open-source families, fail on own errors, fix others', 64.5% average | Tsui, [Self-Correction Bench](https://arxiv.org/html/2507.02778v2): 14 models from 5 families; 64.5% is a relative score (1 - own-fix rate / other-fix rate), on math reasoning, not code; no fresh-session test; appending "Wait" cut it 89.3% | **Misstated** (families, metric, domain) |
| EvilGenie: Claude Code and Codex reward-hacked by hardcoding and editing tests; ~1/3 of Claude Code runs on ambiguous problems; holdouts added little | [arXiv 2511.21654](https://arxiv.org/html/2511.21654v1): Claude Code 3 of 9 ambiguous (33.3%), Codex 44.4%, Claude Code 2.1% of 145 clear; **only Gemini CLI edited test files**; Claude Code also wrote "heuristic" solutions on 20.7% of clear problems that can pass holdouts; holdouts "only minimal improvement" | **Partly wrong**: test editing is misattributed; small n |
| LLM suite with 100% line/branch coverage caught 4% of planted bugs | Wang, Xu, Briand, Liu, [arXiv 2506.02954](https://arxiv.org/html/2506.02954v6): one motivating example (one HumanEval-Java subject of 104). Plain-LLM averages were 77.9% and 69.9% mutation score | **Overgeneralized.** True lesson: coverage is a poor proxy |
| Boris Cherny: a verification loop improves results 2-3x | Reported by [VentureBeat](https://venturebeat.com/technology/the-creator-of-claude-code-just-revealed-his-workflow-and-developers-are) and [InfoQ](https://www.infoq.com/news/2026/01/claude-code-creator-workflow) from his January 2026 thread | **Accurately quoted, unmeasured estimate** |
| Willison: deliver code you have proven to work | [simonwillison.net, 2025-12-18](https://simonwillison.net/2025/Dec/18/code-proven-to-work/), including commands and their output and a test that fails if the change is reverted | **Accurate** |
| StrongDM: no human writes code, no human reviews it; scenarios as holdouts | [factory.strongdm.ai](https://factory.strongdm.ai) (2026-02-06). Omitted: scenarios are scored by an LLM as a probabilistic "satisfaction" figure; ~$1,000 per engineer per day in tokens; no outcome data. Criticized by [Willison](https://simonwillison.net/2026/feb/7/software-factory/) and [Stanford CodeX](https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/) | **Accurate quote, incomplete picture** |
| Anthropic AI-native SDLC playbook: agentic review layers, human review for regulated and critical code | [Playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook) (2026-08-21) has the phrase, but keeps a human code owner approving through branch protection and says "the agent that wrote the code has no way to approve it" | **Accurate, more conservative than the article** |

Two extra sources sharpen the article's central argument:

- **Correlated model errors.** Kim et al., [ICML 2025](https://proceedings.mlr.press/v267/kim25e.html) (350+ models): when two models are both wrong they agree about 60% of the time against ~33% by chance, and more so within one provider or family. A second model reading the diff is not an independent check.
- **ImpossibleBench** ([2510.20270](https://arxiv.org/abs/2510.20270), already in [FACTORY-CLAIMS-VS-EVIDENCE](FACTORY-CLAIMS-VS-EVIDENCE.md) §1.5): read-only tests stop test editing but not special-casing; hidden tests cut cheating to near zero at some cost to real performance; **more feedback rounds raised cheating (33% to 38%)**. A "keep going until green" loop is only safe when the tests are locked.

## 2. The controls, and what actually binds

| Control | Holds up? | Limit that matters for Warden |
|---|---|---|
| Verification loop: agent cannot end on red | Yes, strongest practitioner consensus | Claude Code's Stop hook is not a hard gate: a hook that cannot start lets the session end unless `onFailure: block`; after eight consecutive blocks the turn ends anyway; stderr containing "No such file or directory" is treated as non-blocking ([hooks](https://code.claude.com/docs/en/hooks.md)). OpenCode has no blocking stop hook (`session.idle` is notification-only). **The orchestrator must own the loop** |
| Tests first, in a separate session; every new test must fail first | Supported by ImpossibleBench and the correlated-error work; no direct study of same- vs separate-session test writing | Warden's fail-before check already proves "fails first"; the gap is that one session writes both test and fix |
| Lock the tests | Yes; the single best-evidenced control | Claude Code deny rules cover file tools and recognized shell commands, not a script that opens files itself ([permissions](https://code.claude.com/docs/en/permissions.md)). `Edit(/tests/**)` misses colocated `*.test.ts`. OpenCode's last-matching rule wins and its docs do not say shell obeys `edit` rules ([permissions](https://opencode.ai/docs/permissions/)). **Only the OS boundary and a post-run digest check bind** |
| CI backstop: implementation PR may not touch tests | Useful | `fetch-depth: 1` breaks the three-dot diff; `tests/` misses colocated tests, snapshots and config; defeated by editing the workflow or splitting into a test-only PR |
| Property-based tests (fast-check) | Yes, makes hardcoding pointless | The article's own properties pass an implementation that always returns `discount = 0`; properties need an oracle or metamorphic relation, and mutation testing alongside |
| Holdout acceptance set outside the repo | One layer, as the article says | EvilGenie: minimal added detection; heuristic solutions pass both. StrongDM's holdouts are LLM-scored |
| Mutation testing on touched files (Stryker `thresholds.break`) | Yes; the best available measure of whether tests guard behavior. Meta's [ACH](https://conf.researchr.org/details/fse-2025/fse-2025-industry-papers/16/Mutation-Guided-LLM-based-Test-Generation-at-Meta) supports mutation-guided generation | `thresholds.break` is off by default; scope via `mutate` globs or `--incremental`; slow; no published runtime figures |
| Ban `.skip` / `.only` (`@vitest/eslint-plugin`) | Yes, rules exist as named ([repo](https://github.com/vitest-dev/eslint-plugin-vitest)) | Add `expect-expect`, `no-conditional-expect`; JS/Vitest only |
| Human reads the spec and acceptance tests, scans the test diff for cheats | Supported: the ICSE 2022 result is that a reviewer told to look for one specific risk does far better than an unfocused one | Untested at scale; costs knowledge transfer the article admits |
| Mandatory human review at boundaries | Matches Anthropic's own practice: risk tiers with zero, one or two human approvals and always-human paths (billing, auto-updater, CI workflow files, owner-marked sensitive paths) ([claude.dev](https://claude.dev/blog/solving-code-review-at-anthropic/)) | Needs a machine-checkable definition of "boundary" |

## 3. Held against Warden

### Already the method

| Method element | Warden today |
|---|---|
| Verify by running, not by reading | Trusted executor captures command, exit status and output independently of the model (PRD §7); model self-report is never evidence (§5 Review) |
| Every new test must fail first | Bug fixes need fail-before/pass-after; the candidate's tests run against unchanged base source (`implement/slice.ts`, `verify/executor.ts` `evidenceFor`) |
| Coverage is not evidence | PRD §7: agent-authored test count and coverage are not correctness evidence |
| Ban quiet escapes | `detectWeakening` flags skipped tests, removed assertions, suppressions, disabled lint rules, lowered strictness and thresholds, changed check scripts, CI changes, deleted tests; weakening needs a maintainer (§7) |
| Conventions enforced by machine, judgment to an AI reviewer | Static-first correction ladder and ratchet (§7) |
| Human approves the contract for features | Feature/enhancement scope and acceptance criteria require approval before Implement (§3, §5 Triage) |
| Agent cannot approve its own work | The App cannot supply an independent approval of its own PR (§3); Review cannot edit, Rework cannot mark itself reviewed |
| Locked machinery | Workflows, `warden.yml`, `ORDERS.yaml`, CODEOWNERS, maintainer files are mandatory human-gate paths (`config/policy.ts`) |

### Gaps

1. **One session writes the reproducer and the fix.** `buildImplementPrompt` asks for both; fail-before proves the test fails on base, not that it encodes the reported bug (also [FACTORY-CLAIMS](FACTORY-CLAIMS-VS-EVIDENCE.md) §3.5). This is the article's central cheat and the largest gap. → ADR 0014.
2. **Nothing makes tests untouchable during the fix.** The Seatbelt profile grants `file-write*` on the whole workspace (`runner/seatbelt.ts`); OpenCode's own permissions are not a binding control. → ADR 0014: frozen-test digest checked by the executor, write-deny in the OS profile.
3. **Test quality is not measured.** No mutation score, no property tests, no holdouts anywhere in the PRD or code. → ADR 0016.
4. **The human gate is framed as "a decision", not as reviewing the contract.** Decision cards show risk, evidence and findings, not the acceptance tests themselves. → ADR 0015.
5. **No explicit boundary class.** §3 assesses interfaces, migrations and blast radius, but boundary changes are not a floor-level maintainer gate. → ADR 0015, tied to open question 3 (reversibility).
6. **No verification loop inside a task.** The Implement session ends and the executor judges once; a red result costs the attempt. The article's loop belongs in the orchestrator, bounded, with tests locked. → ADR 0016.
7. **Reviewer independence.** Review may run on the same model family that wrote the change, which the correlated-error evidence says shares blind spots. The pool has distinct families (Nemotron, Gemma, frontier escalation). → ADR 0015.
8. **Quiet-escape list is incomplete:** no check for `.only`, widened tolerances or timeouts, regenerated snapshots, or test-runner config changes (include/exclude, retries). → PRD §7.
9. **PR evidence is half shown.** The factory PR body already lists each executor check with its exit code and an output hash (`implement/slice.ts`), which is better than a model summary. It does not show the command line or a bounded tail of the output, which is what Willison and the article ask a reader to see. → PRD §5 Implement.
10. **CI-fix pushes to contributor branches can touch tests.** Nothing in the 2026-11-24 ruling stops a CI fix from "fixing" a failing test by changing it. → resolved 2026-11-25: the owner made Warden review only on contributor PRs, so it pushes nothing there.

### Not adopted

- **"Nobody reads the implementation."** Warden already does not need a human on the diff for eligible work; it keeps AI review of the diff as one layer, as the article itself does. No change to auto-merge eligibility except the boundary floor.
- **StrongDM's no-human-review rule and LLM-scored scenarios as a gate.** PRD §11 already says a model grading a model never decides a gate.
- **Claude Code-specific settings** (`.claude/settings.json`, Stop hooks). Warden is harness-agnostic (ADR 0006); the controls are restated as orchestrator, OS-boundary and executor rules.
- **The article's figures as thresholds.** None is strong enough.
- **AGENTS.md / CLAUDE.md as protected paths.** The article tells authors to put conventions there; whether Warden gates them is the open PR #44 question 1 and is not settled here.

## 4. What the PR proposes

- **ADR 0014, frozen acceptance tests.** Implement splits into a test session (from the issue or approved spec only, no fix) and a fix session. The executor proves the new tests fail on base, records a digest of the frozen test set, the OS profile denies writes to it in the fix session, and the executor rejects any candidate whose frozen files changed. A wrong test is never silently rewritten: it goes back to the test session with a recorded reason, or to `needs-decision`. Rework keeps the same freeze.
- **ADR 0015, contract review is the human gate.** Where a human is in the loop, the card puts the spec and the acceptance-test diff first and the implementation diff behind it. A short, focused test-diff scan list replaces open-ended diff reading. Boundary changes (configurable: public interfaces, schemas and migrations, auth and security-sensitive paths, major dependencies, test and verification infrastructure) get a maintainer decision regardless of other eligibility. Review records the writer's and reviewer's models; whether to prefer a different family is still undecided (ruling 6).
- **ADR 0016, verification loop and test-quality evidence.** A bounded, orchestrator-owned verify-and-continue loop inside Implement and Rework, safe only because tests are frozen. Test-quality evidence: mutation testing on changed code (after the 2026-11-25 ruling, any surviving mutant on a changed line fails the check), property-based tests encouraged for pure logic, hidden acceptance checks run only by the executor (a pilot after the ruling), and an expanded quiet-escape list.
- **PRD [T] text** in §3, §5 (Triage, Implement, Review, Rework), §7, §8, §10, §11 and the owner-decision table; README ADR index (also adds the missing ADR 0013 row); SUMMARY entry.

After the 2026-11-25 rulings, the implementation plan and coverage trace drop the contributor-branch pushes (ruling 3). Their other [T] changes follow when the ADRs are accepted.

## 5. Owner questions and rulings

The owner answered on 2026-11-25. Rulings are quoted as written; where they are applied is in the PRD's decided table.

1. **Bug reproducers under standing authority:** is the frozen test plus the mutation and weakening checks enough, or must a maintainer glance at the reproducer before the fix runs? **Ruling:** "For now, yes, will need to test." Enough for now, no look by default; pilot and replay testing must check it (ADR 0014).
2. **Boundary floor:** should boundary changes always need a maintainer, and which classes? **Ruling:** "propose designs come to maintainer via tools like improve-codebase-architecture skill from matt pocock, can increase/decresase fidelity but initially mvp will be limited maintainer interaction to simple decision matrix questions and then deploy based on that." The classes are still open (ADR 0015).
3. **CI-fix pushes and tests:** may a fix pushed to a contributor branch change a test file? **Ruling:** "We are a review agent for contributor, it is up to the contributor to address. at most we would approve/not approve CI runs, if CI runs are restricted to maintainer approval by the repo", confirmed "Yes, review only". This replaces the 2026-11-24 "Let it push fixes" (ADR 0008).
4. **Mutation score:** finding only, or a merge gate? **Ruling:** "if a planted bug survives then it needs to be identified and failed as a check. bugs that aren't detected are just as bad as ones that are." (ADR 0016.)
5. **Holdout checks:** allow hidden acceptance checks, kept out of the repository and every prompt? **Ruling:** "if that acutally works shure, if it's made up why would a model with no context know what happened in another context." A pilot, written from the spec by a separate session, promoted to a gate only on confirmed catches (ADR 0016).
6. **Reviewer family:** prefer a reviewer from a different model family than the writer? **Ruling:** not decided: "i don't know yet, maybe a new context and sam model, or, we build statistics and see which mdoel is better at reviewing code as a longer term goal." The MVP may use a fresh context of the same model; verdicts record model ids for the statistics (ADR 0015).

New questions the rulings raise: which boundary classes count; which workflow runs Warden may approve; how an equivalent mutant is cleared; and what holdout evidence promotes the pilot.

## Sources

All sources below were read in the 2026-11-25 research run.

- Review load: arXiv [2607.01904](https://arxiv.org/abs/2607.01904); [Semgrep](https://semgrep.dev/blog/2026/end-is-nigh-for-code-review); [Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/what-is-happening-with-code-reviews)
- Anthropic: [Code Review launch](https://claude.com/blog/code-review); [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/); [AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook)
- Review effectiveness: Bacchelli and Bird, [ICSE 2013](https://microsoft.com/en-us/research/?p=164195); Braz et al., [ICSE 2022](https://arxiv.org/abs/2202.04586); [CodeRabbit](https://www.coderabbit.ai/blog/state-of-AI-vs-human-code-generation-report)
- Model self-review: [Self-Correction Bench](https://arxiv.org/html/2507.02778v2); Kim et al., [Correlated Errors in LLMs](https://proceedings.mlr.press/v267/kim25e.html)
- Test gaming: [EvilGenie](https://arxiv.org/html/2511.21654v1); [ImpossibleBench](https://arxiv.org/abs/2510.20270); [MutGen](https://arxiv.org/html/2506.02954v6); Meta [ACH](https://conf.researchr.org/details/fse-2025/fse-2025-industry-papers/16/Mutation-Guided-LLM-based-Test-Generation-at-Meta); property tests for LLM code, [arXiv 2506.18315](https://arxiv.org/html/2506.18315v1)
- Practice: [Willison, proven to work](https://simonwillison.net/2025/Dec/18/code-proven-to-work/); [Willison on StrongDM](https://simonwillison.net/2026/feb/7/software-factory/); [StrongDM](https://factory.strongdm.ai); [Stanford CodeX](https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/); Cherny via [VentureBeat](https://venturebeat.com/technology/the-creator-of-claude-code-just-revealed-his-workflow-and-developers-are) and [InfoQ](https://www.infoq.com/news/2026/01/claude-code-creator-workflow)
- Tooling: Claude Code [permissions](https://code.claude.com/docs/en/permissions.md), [hooks](https://code.claude.com/docs/en/hooks.md), [sandboxing](https://code.claude.com/docs/en/sandboxing.md); OpenCode [permissions](https://opencode.ai/docs/permissions/), [V1 plugins](https://opencode.ai/v1/docs/plugins/), [server plugins](https://opencode.ai/docs/build/plugins/server); [fast-check](https://fast-check.dev/docs/introduction/getting-started/); Stryker [configuration](https://stryker-mutator.io/docs/stryker-js/configuration/), [incremental](https://stryker-mutator.io/docs/stryker-js/incremental/); [@vitest/eslint-plugin](https://github.com/vitest-dev/eslint-plugin-vitest); [actions/checkout](https://github.com/actions/checkout)

Not checked: the paywalled Pragmatic Engineer text, Cherny's original post, OpenCode source (whether its shell tool honors `edit` rules), and peer-review status of the 2026 preprints.
