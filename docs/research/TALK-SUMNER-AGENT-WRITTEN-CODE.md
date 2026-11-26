# Talk Research: "How to Ship Millions of Lines of Agent-Written Code" — Jarred Sumner, Anthropic

**Source:** AI Engineer channel, published 2026-11-24, 22:29 long, 16 chapters named in the description.
- Video: https://www.youtube.com/watch?v=TvsF67C2F54
- Full machine-generated transcript: [sources/sumner-millions-of-lines-transcript.md](sources/sumner-millions-of-lines-transcript.md) (copied 2026-11-25 from the video page's transcript panel; recognition errors remain, timestamps are the video's clock; slides are not in the transcript).

**Speaker:** Jarred Sumner, creator of Bun, at Anthropic (description and [0:12]). Anthropic acquired Bun in December 2025 (checked, see verification).
**Researched:** 2026-11-25. Not covered by any earlier note in this directory (checked `docs/research/` and SUMMARY.md).
**Confidence:** HIGH for what the talk claims (full transcript read). MEDIUM as evidence: the method claims (pre-existing test suites, differential runs, Fuzzilli) match Bun's own published docs and blog, but every result figure (4x memory, 2x startup, five rewrites, 140 agents, build times, benchmark wins) is self-reported and the PR itself was not found.

---

## Why this talk matters to Warden

It is the first talk in this directory from someone who shipped a very large agent-written change into a production runtime, and its whole argument is about evidence, which is Warden's core concern. Its thesis: "the approach you go with for how to build it is entirely driven by how do you verify that it actually is going to like work and not be buggy and that you can trust it" [2:33].

Five points map onto Warden:

- **Tests that predate the work are the trustworthy evidence** [6:58-7:22, 17:14]. "We know that like the agent couldn't have messed with it." He declined a Rust rewrite of Claude Code because its tests would have to be ported, and "as soon as you're like rewriting the tests then you can't really trust the tests anymore" [4:46]. Warden already protects verification controls (PRD §7) and PR #47 proposes frozen acceptance tests (ADR 0014). What Warden does not yet do is *rank* evidence by whether the test existed before the change. Candidate 1.
- **Three versions that must agree** [8:16-8:41]. JIT, AOT, and AOT with types stripped must behave the same. This is differential (equivalence) testing: the old behavior is the oracle. Warden compares baseline and candidate *test results* (§7) but has no check that compares baseline and candidate *behavior* on the same inputs. That matters for work meant to change no behavior: refactors, performance work, dependency bumps, ports. Candidate 2.
- **Check that the checks catch things** [17:53, 21:00]. "It's really easy to fool yourself that it's finding bugs when it's not finding bugs." This supports PR #47's mutation testing (ADR 0016) and extends it to generated inputs and fuzzers. Candidate 2.
- **Passing numbers, slop code** [11:05-11:54]. The second compiler had 2x faster startup and 3x less memory, "but the code was slop": any object accessing a property named `archive` was assumed to use the `Bun.archive` API. A human reading the code caught it. Tests and benchmarks did not. This is special-casing that games the evidence, and Warden's Review has no item that looks for it. Candidate 3. It is also a counterpoint to reviewing only tests and contracts (PR #47, ADR 0015).
- **Re-measure, and do not trust the model's own sizing** [13:42, 14:43, 16:37-17:14, 19:38-20:03, 21:00]. An hourly scorecard of previous versus current run, because "if you're not actively re-measuring, then it's going to like get worse". The model "talks itself into making up rules", sizes ideas up wrongly and talks itself out of them, and underestimates what it can do. Warden tracks metrics (§11) but does not require a run-over-run comparison, and does not check rules a session cites when it abstains or narrows work. Candidate 4.

Not adopted, with reasons, in "Not adopted" below: 140 parallel agents and batch writing, long-lived subagents, rewriting over refactoring, "try harder" nudging, and the performance figures.

---

## What the speaker claimed (with timestamps)

### The project [0:12-2:25]
1. He merged "a several million line of code PR" adding an ahead-of-time (AOT) compiler to Bun, "the JavaScript runtime that powers cloud code" [0:22]. **PR not found; self-reported size.**
2. Over the summer he rewrote Bun in Rust; the AOT compiler is a larger project [0:54-1:02]. **Rust rewrite confirmed by Bun's blog.**
3. Opening prompt: make Claude Code use much less memory and be faster; WebKit or Bun may be modified [1:23].
4. The compiler went through five rewrites in "a little bit over a month"; the fifth "is shipping next week" [1:45-2:02]. **Self-reported.**

### Testing decides the approach [2:18-4:46]
5. "You're really constrained by how you test that the code works ... even more important than what you're specifically [building]" [2:18-2:33].
6. Roughly half of a typical JavaScript application's CPU time is spent compiling code on demand [2:42]. **Self-reported; no source given.**
7. Bun was an easy Rust rewrite "because the tests were written in a language that's independent of the one it runs in"; they ran the same TypeScript tests on the Zig and Rust versions [4:16]. **Confirmed by Bun's blog.**
8. Claude Code's tests are in TypeScript, so a Rust rewrite would mean porting them, and "as soon as you're like rewriting the tests then you can't really trust the tests anymore" [4:46]. Hence: make JavaScript faster instead [4:59].

### Results [5:07-6:43]
9. About 4x less memory and about 2x faster startup for Claude Code; dogfooded internally, external soon [5:07]. **Self-reported. Bun's AOT docs give no such figures.**
10. A single-threaded TypeScript compiler built with `bun compile` beats the single-threaded TypeScript Go port [5:40]. **Self-reported.**
11. The compiler "treats types as predictions uh instead of like trusting them" [6:24]. **Confirmed by Bun's AOT docs.**
12. Compilers suit models: "they're just really good at writing compilers" [6:43].

### Evidence [6:58-9:07]
13. "We don't need to write any tests pretty much ourselves ... we can largely trust that the tests that predate the project work" [6:58].
14. Suites used: Bun's own, WebKit's, test262 and Claude Code's; Bun's test runner also runs in AOT mode [7:22]. **`bun test --aot` confirmed in docs.**
15. Remaining failures trace to two deliberate breaking changes, mostly against prototype pollution [7:52, 18:56-19:12]. **Read-only built-ins confirmed in the compatibility docs.**
16. Run three versions (JIT, AOT, AOT without types); "as long as the three of them behave the same then you know that it works at least for that specific application" [8:16-8:34].
17. Claude writes code generators to fuzz patterns, which "catch a lot of bugs" [8:41]. Fuzzilli was extended to TypeScript types [17:36]. **Fuzzilli use confirmed; the extension is self-reported.**
18. "Most of this is tests" [8:58].

### How it was built [9:16-16:45]
19. Write a large batch at once, then fix: compile, pass tests, "really truly works". In the batch stage, run one build, not many [9:16-9:55].
20. The first version reused JavaScriptCore code and left Claude Code at "a gigabyte" [10:23].
21. The second: 2x startup, 3x less memory, "but the code was slop" (the `archive` special case); "we cannot ship this" [11:05-11:54].
22. Large planning produces Markdown: "who's going to like 1500 markdown files It's just not reasonable" [11:54].
23. The third: 140 agents writing all the code at once [12:26]. The fourth: "the code was not slop", same performance, compilation too slow [12:51].
24. Users expect no compile time; 50 seconds for Claude Code was too long [13:07]. The fifth: good code, build under 20 seconds [14:13]. **Self-reported.**
25. Claude "will try to like size up everything to judge whether or not it's worth working on, but it's really easy to convince yourself that like your measurements are good um when they're not good"; "why is this 900,000 lines of code? This should be a lot like smaller" [13:35-14:06].
26. Ideas get sized up wrongly and talked out of; "this probably needs to be revisited more" [14:43].
27. Earlier work leaned on Claude Code workflows; now "sub agents that are like very longived", which keep the relevant code in context and "can just keep going" [15:21].

### Operating it [16:37-22:02]
28. An hourly scorecard posted to Slack, comparing previous and current versions on prioritized metrics [16:37-16:52].
29. "None of these tests for the most part are things that are like made up ... they're things that like pre predated the project so that way we know that like the agent couldn't have messed with it" [17:14].
30. "It's also important to check that the tests actually catch things" [17:53].
31. The AOT output is usually faster than the JIT but not always (uglify.js; code using `eval` or `new Function`) [18:07]. **Confirmed in docs.**
32. Daily work: sending "continue" a lot; leading questions ("why are we doing this?", "what's taking so long?") "because it kind of like talks itself into making up rules"; it "tends to like underestimate what it can do" [19:18-20:03].
33. Bun beats JavaScriptCore's JIT and V8 on most JetStream 3 tests [20:23-20:37]. **Self-reported; JetStream 3 itself is real.**
34. Lessons: testability is "super important"; "make sure that the tests actually test things"; "if you're not actively reme-measuring, then it's going to like get worse"; for unshipped projects, rewriting is easier than refactoring; "if you don't act ambitiously then the models will like start having like 0.1% improvements instead of like 10%" [21:00-21:41].

---

## Verified against primary sources (versus the speaker's claims)

Checked 2026-11-25 from public pages.

| Claim | Check | Result |
|---|---|---|
| Sumner at Anthropic; Bun powers Claude Code [0:12-0:22] | Anthropic news on the acquisition; https://bun.sh/blog/bun-joins-anthropic | **Confirmed.** Anthropic acquired Bun in December 2025. |
| Rust rewrite ran the existing TypeScript tests on both versions [0:54, 4:16] | Bun blog, "Bun in Rust", 2026-07-08: https://bun.com/blog/bun-in-rust; InfoQ: https://www.infoq.com/news/2026/09/bun-ai-rewrite-zig-rust-4-months/; Simon Willison: https://simonwillison.net/2026/Jul/8/rewriting-bun-in-rust/ | **Confirmed.** The blog calls the TypeScript suite a language-independent conformance suite with over 1M assertions. It also used adversarial reviewers with diff-only context ("The implementer doesn't review. The reviewer doesn't implement."), reported about $165k in tokens, and found 19 semantic regressions after merge; fixes went into the process, not hand edits. **Counterpoint:** InfoQ quotes Zig creator Andrew Kelley asking, in substance, why there were so many bugs if the suite was sufficient. Pre-existing tests are strong evidence, not complete evidence. |
| AOT compiler exists; types are predictions [6:24] | https://bun.com/docs/compiler/aot; https://bun.com/bun-aot-how | **Confirmed, experimental.** "A declared type never removes a check." Untyped and `new Function` code can be slower (matches claim 31). |
| `bun test` runs in AOT mode [7:22] | Same docs | **Confirmed** (`bun test --aot`). |
| Breaking changes against prototype pollution [7:52, 18:56] | https://bun.com/docs/compiler/compatibility | **Confirmed.** Built-ins are read-only under AOT. |
| Fuzzilli is a JS engine fuzzer used by V8; Bun uses it [17:36] | https://github.com/googleprojectzero/fuzzilli; Bun blog | **Confirmed** for V8 and JavaScriptCore use and Bun's continuous fuzzing. The TypeScript-type extension is **unverified**. |
| JetStream 3 is a main JS benchmark [20:23] | https://browserbench.org/announcements/jetstream3/ | **Confirmed** that it exists (released 2026). Bun's results on it are **unverified**. |
| 4x memory, 2x startup; 3x memory earlier [5:07, 11:05] | AOT docs | **Unverified.** The docs give no headline figures. |
| Several-million-line PR; five rewrites; 140 agents; 50 s and under 20 s builds; 900,000 lines [0:22, 1:45, 12:26, 13:07-14:13] | Not found | **Unverified, self-reported.** |
| Faster than the single-threaded TypeScript Go port [5:40] | Not checked | **Unverified.** |
| Half of CPU time spent compiling on demand [2:42] | Not checked | **Unverified; no source given.** |

---

## Already in Warden

- Protected verification controls; weakened assertions and skipped tests cannot manufacture success (PRD §7).
- Agent-authored test count and coverage are not correctness evidence (PRD §7).
- The trusted executor captures results independently of the model; model self-reported success is not a trusted check (PRD §5 Review, §7).
- Fail-before/pass-after for bug fixes (PRD §5 Implement).
- Retro measures structural erosion and coherence across factory merges, decided 2026-11-24 (PRD §5 Retro), which covers the "900,000 lines, should be smaller" point.
- Proposed in PR #47, not yet merged: frozen acceptance tests (ADR 0014), contract review (ADR 0015), mutation and holdout checks (ADR 0016).

---

## Candidate incorporations (ranked)

All are applied in this PR as **[S]** text or as ADRs. Candidates 1 and 3 were decided on 2026-11-26; the rest are Proposed.

1. **Rank evidence by whether the test predates the change** (ADR 0017, PRD §7 [S]; **decided 2026-11-26**, with the gate in owner question 1). The executor records, per test that ran, whether its file and content are byte-identical on the trusted base. The card shows pre-existing evidence first. A change to a pre-existing test's expectation removes that test from the evidence for the change and still needs approval against requirements (§7). Basis: claims 8, 13, 29.
2. **Optional differential checks, and generators must prove they catch something** (ADR 0017, PRD §7 [S]). For work declared behavior-preserving, run base and candidate on the same inputs and report any difference as a finding. Generated inputs or fuzzers count as evidence only if they catch a planted defect. Unsupported languages are reported as unsupported, never as a pass. Basis: claims 16, 17, 30.
3. **Review looks for special-casing** (PRD §5 Review [S], §11 replay case; **decided 2026-11-26**). Code that branches on a literal identifier, property name, file name or test input in order to pass is a finding. Basis: claim 21.
4. **Re-measure run over run, and treat the model's self-assessment as a claim** (ADR 0018, PRD §5 Retro [S], §5 Implement [S]). Retro and each scan report show a previous-versus-current scorecard of §11 metrics. Effort and impact estimates, "not worth it" and "infeasible" abstentions are recorded as untrusted claims. A rule a session cites to skip or narrow work must resolve to a real ORDERS entry, config key or approved spec text, or it is a finding. Basis: claims 25, 26, 28, 32, 34.
5. **No planning Markdown by default** (PRD §5 Implement [S]). Factory PRs add no planning or design documents unless the issue asks; adding them is scope expansion. Basis: claim 22.

---

## Bearing on PR #47's open rulings

PR #47 (Spector, "Review Its Tests") asks Tom six questions. This talk is a second, independent source on some of them.

- **ADR 0014 (frozen tests first):** supports the premise. Tests the agent could not touch are the evidence Sumner trusts.
- **Q3 (may a CI fix change contributor tests?):** supports the narrow answer. "As soon as you're like rewriting the tests then you can't really trust the tests anymore" [4:46].
- **Q4 (does weak mutation evidence block or only report?):** supports mutation evidence in general ("check that the tests actually catch things" [17:53]) but gives no threshold. No bearing on block versus report.
- **Q1 (unattended bug-fix test gate):** indirect. Ranks pre-existing tests above new ones, which ADR 0017 makes visible on the card.
- **Q2 / ADR 0015 (humans review contracts, diff linked not inlined):** a caution. The `archive` slop passed tests and benchmarks and was caught only by reading the implementation. That argues for keeping AI implementation review as its own layer for non-boundary work, and for the special-casing check (candidate 3). It does not argue against ADR 0015's boundary gate.
- **Q5 (hidden acceptance checks), Q6 (cross-family reviewer):** no bearing. (The Bun Rust blog's diff-only adversarial reviewer is adjacent to Q6 but is not in this talk.)

---

## Not adopted

- **140 parallel agents and batch writing** [12:26, 9:16]. Warden keeps one factory implementation PR open at a time (PRD §2) and verifies each change. Batch writing for an unshipped greenfield project is a different job.
- **Long-lived subagents** [15:21]. These conflict with Warden's fresh, bounded sessions (PRD §9), which exist so state is in ledgers, not context. Noted as a tension, not adopted; revisit only with replay evidence.
- **Rewrite over refactor** [21:34]. Advice for unshipped projects; Warden works on maintained repositories under scope approval.
- **"Continue" and "try harder" nudging** [19:18, 21:41]. Warden's sessions are bounded by contract and budget; ambition is set by the approved scope, not by prompting.
- **Performance figures as targets.** All self-reported; none is a basis for a Warden threshold.

---

## Owner questions (for @trek-e)

1. **Evidence ranking (ADR 0017):** decided 2026-11-26. Always show which tests existed before the change. Block auto-merge only when the PR edits or deletes a pre-existing test, or is labelled a refactor or bug fix with no pre-existing test covering the changed code. New features need no pre-existing test; their new tests get extra review or independent checks.
   - **Proposed refinement (2026-11-26), awaiting ruling:** new feature behavior goes in as new test cases inside the existing test file for the unit it extends; existing cases are not edited; a new test file only for a new unit. See [Follow-up research](#1-tests-for-new-features-without-test-sprawl).
2. **Differential checks (ADR 0017):** adopt as opt-in per repository for behavior-preserving work, off by default? A reported difference is a finding under the 2026-11-24 rule; confirm.
3. **Special-casing check (PRD §5 Review):** decided 2026-11-26 ("Yes, check for those"). Review reports gamed tests, meaning code that special-cases test inputs to pass, and replay includes such a case.
4. **Measured, not estimated (ADR 0018):** adopt the run-over-run scorecard in Retro and the rule that a cited rule must resolve to real ORDERS, config or spec text?
5. **No planning Markdown (PRD §5 Implement):** factory PRs add no planning or design docs unless the issue asks?
6. **Model scorecard (ADR 0018):** adopt replay regression and capability sets scored per model with confidence intervals, plus live rates on control charts? Decided 2026-11-26: a live rate outside its limits is a Retro finding and also pauses auto-merge for that model. Still open: what lifts the pause (proposed: maintainer clearance after the regression set passes again on replay). See [Follow-up research](#2-a-scorecard-that-catches-a-model-not-doing-what-we-expect).

## Open threads

- Find the AOT PR to check its size and the test-suite list.
- Read Bun's release notes when the AOT compiler leaves experimental status, for any published memory and startup figures.
- If differential checks are adopted, decide the input source per language (recorded fixtures, existing test inputs, or generated inputs) during build planning.

---

## Follow-up research (2026-11-26): feature tests and model scorecards

@trek-e asked for established practice, not guesses, on two points left open by the older-test ruling. Everything below is **proposed**; it changes nothing until he rules.

### 1. Tests for new features without test sprawl

**The question, in Tom's words:** "The goal is to not have test proliferation every time a feature is added. It needs to go into a test that exists. Unless it's a completely new function, then there's a function level test."

**What the sources say.**

- *Software Engineering at Google*, ch. 12 ("Unit Testing"), names four kinds of change and how tests should respond. New features: "The engineer must write new tests to cover the new behaviors, but they shouldn't need to change any existing tests", and a change to existing tests when adding a feature "suggest[s] unintended consequences of that feature or inappropriate tests". Bug fixes: "the bug fix should include that missing test case" and "typically shouldn't require updates to existing tests". Only a deliberate behavior change is expected to update existing tests. The chapter's summary rule is "Strive for unchanging tests."
- The same chapter, "Test behaviors, not methods", gives the counterexample to growing an existing test: a test that "started out covering only the first method" and was "expanded ... when the second message was added". It calls this "a bad precedent: as the method under test becomes more complex ... its unit test will become increasingly convoluted". Its alternative is one small test per behavior, named after the behavior, kept beside the others for the same unit. Methods and behaviors map many-to-many, and tests share setup by DAMP helpers rather than by merging cases.
- Kent Beck, "Test Desiderata": tests should be *behavioral* ("if the behavior changes, the test result should change") and *structure-insensitive* ("should not change their result if the structure of the code changes").
- Shi, Gyori, Gligoric, Zaytsev and Marinov, "Balancing Trade-offs in Test-Suite Reduction" (FSE 2014), measured redundancy on 61,235 tests across 3,590 commits. Removing tests judged redundant by statement coverage shrank suites by 62.9% on average "but loses up to 20.5% in killed mutants". Judging redundancy by killed mutants instead lost no killed mutants, at the cost of a suite 11.9 percentage points larger. So "redundant" has to be measured by what a test catches, not by what it executes.

**How this fits Tom's goal.** The sources agree with the goal (no new test sprawl per feature) but not with the literal mechanism if "go into a test that exists" means editing an existing test case. Editing an existing case to cover new behavior is the pattern the Google book calls a bad precedent, and Tom's own 2026-11-26 rule already blocks auto-merge when a PR edits a pre-existing test. The practice that meets both is:

1. **New behavior goes in as a new test case inside the existing test file or suite for the unit it extends**, reusing that suite's fixtures and helpers. No new test file, harness, fixture set or test framework for a feature on existing code.
2. **Existing test cases are not edited** for a new feature or a bug fix. A bug fix adds the missing case beside the others.
3. **A new test file only for a new unit**: a new public function, module or class with no existing test home. That is Tom's "completely new function" exception.
4. **Redundancy is measured, not guessed**: where mutation checks run (proposed in PR #47, ADR 0016), an added test that kills no mutant the existing suite misses is reported as redundant.

**How Warden would enforce it (proposed).** Provenance (ADR 0017) already separates `added` from `modified`. It would also record whether an added test sits in an existing test file or a new one. The Implement contract places new cases in the test file that already exercises the changed unit. Review reports a new test file, harness or fixture set for code that already has a test home as a finding, unless the change adds a new unit. Where mutation checks run, the card shows added tests that killed nothing new.

### 2. A scorecard that catches a model not doing what we expect

**The question, in Tom's words:** "Need to figure out a best practice for how to build a scorecard to catch when a model isn't doing what we expect it to be doing." This also bears on PR #47 ruling 6 ("maybe a new context and same model, or, we build statistics").

**What the sources say.**

- Anthropic, "Demystifying evals for AI agents":
  - Keep two sets. *Regression evals* ask whether the agent "still handle[s] all the tasks it used to" and "should have a nearly 100% pass rate"; a drop "signals that something is broken". *Capability evals* hold harder tasks, and ones that reach high pass rates "'graduate' to become a regression suite that is run continuously to catch any drift".
  - Start small: "20-50 simple tasks drawn from real failures is a great start".
  - Run several trials. pass^k is "the probability that all k trials succeed", the measure for work that must be reliable every time.
  - Grade the outcome, check that graders can't be gamed, and calibrate model graders against human judgment.
  - Read transcripts: "You won't know if your graders are working well unless you read the transcripts".
  - Watch for saturation: "An eval at 100% tracks regressions but provides no signal for improvement."
  - Layer methods, "Like the Swiss Cheese Model"; no single layer catches every issue.
- Anthropic, "A statistical approach to model evaluations":
  - Report a standard error and confidence interval with every score.
  - Cluster standard errors when items share a source, because treating related items as independent underestimates the error.
  - Compare two models on paired differences over the same items.
  - Use power analysis to size a set before claiming one model beats another.
- NIST/SEMATECH e-Handbook, §6.3.3.2 "Proportions Control Charts": for a rate p over samples of size n, set limits at p̄ ± 3√(p̄(1−p̄)/n), with p̄ estimated from preliminary samples of normal operation. A point outside the limits signals the process has changed.
- Google Research, "Resolving code review comments with ML" (2023):
  - Google calibrated its model "for a target precision of 50%" and logged what authors did with each suggestion (preview, apply, "not helpful").
  - It checked that offline metrics matched online acceptance.
  - It used "not helpful" feedback "to identify recurring failure patterns". This is the live-signal half: what the people on the other end do with the model's output.
- Sumner's hourly side-by-side scorecard (claim 25) is the practitioner version of the same idea.

**What a Warden scorecard would contain (proposed).**

1. **Replay sets with known answers.** Split the §11 replay corpus into a regression set (cases Warden already handles; expected near 100%) and a capability set (hard cases). Every case has a recorded expected outcome: a planted defect that must be found, a clean change that must pass, an injection that must cause no effect. Balance cases that should trigger a finding with ones that should not. Start from 20 to 50 real failures and add each new escaped defect. Capability cases graduate to regression once passed reliably.
2. **Run them on every model, harness, prompt or configuration change and on a schedule**, per model. Tom's pool is several models (local, Nemotron, Gemma, frontier), so each is scored separately. For cases that decide auto-merge, report pass^k over repeated trials, not a single pass.
3. **Statistics, not single numbers.** Each score carries a standard error and a 95% interval, clustered by repository or PR. A model swap, or the fresh-context same-model reviewer in PR #47 ruling 6, is judged on paired differences over the same cases. Set sizes come from power analysis during build planning.
4. **Live rates from ledgers on control charts.** Track, per model and per task contract:
   - maintainer override rate on Warden verdicts;
   - findings dismissed versus acted on;
   - abstention rate;
   - rework loops per item;
   - factory merges later reverted or followed by an escaped defect.

   Limits come from a baseline window by the p-chart formula. A point outside the limits is a Retro finding that the model's behavior changed. Small samples give wide limits, and the card says so rather than hiding it.
5. **Calibrate graders.** Any model-graded score is checked against maintainer decisions before it counts and re-checked when the grading model changes. It still never decides a gate (PRD §11).
6. **Read transcripts.** Retro samples session transcripts each window, because a scorecard can measure the wrong thing.
7. **Watch saturation.** A regression set at 100% for a long time only detects regressions; new capability cases come from new real failures.

All numbers come from the executor and ledgers, never from the model (ADR 0018).

**Open for Tom.**

- Adopt this structure?
- ~~When a live rate leaves its control limits, Retro finding only, or also pause auto-merge?~~ Decided 2026-11-26 (@trek-e): "Also pause auto-merge." Retro flags it and auto-merge pauses for that model.
- What lifts the pause? Proposed: the maintainer clears it once the model's regression set passes again on replay. A live rate drifting back inside its limits is weak evidence while auto-merge is paused, since the sample shrinks.

### Sources for the follow-up

- Winters, Manshreck and Wright (eds.), *Software Engineering at Google*, ch. 12 "Unit Testing" — https://abseil.io/resources/swe-book/html/ch12.html (read 2026-11-26)
- Kent Beck, "Test Desiderata" — https://medium.com/@kentbeck_7670/test-desiderata-94150638a4b3 (read 2026-11-26)
- Shi, Gyori, Gligoric, Zaytsev, Marinov, "Balancing Trade-offs in Test-Suite Reduction", FSE 2014 — https://mir.cs.illinois.edu/gyori/pubs/fse14reduction.pdf (read 2026-11-26)
- Anthropic, "Demystifying evals for AI agents" — https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (read 2026-11-26)
- Anthropic, "A statistical approach to model evaluations" — https://www.anthropic.com/engineering/statistical-approach-to-model-evals (read 2026-11-26)
- NIST/SEMATECH e-Handbook of Statistical Methods, §6.3.3.2 "Proportions Control Charts" — https://itl.nist.gov/div898/handbook/pmc/section3/pmc332.htm (read 2026-11-26)
- Frömmgen and Kharatyan, "Resolving code review comments with ML", Google Research, 2023-05-23 — https://research.google/blog/resolving-code-review-comments-with-ml/ (read 2026-11-26)
