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

All are applied in this PR as **[S]** text marked PROPOSED, or as Proposed ADRs. Nothing here is decided.

1. **Rank evidence by whether the test predates the change** (ADR 0017, PRD §7 [S]; **decided 2026-11-26**, with the gate in owner question 1). The executor records, per test that ran, whether its file and content are byte-identical on the trusted base. The card shows pre-existing evidence first. A change to a pre-existing test's expectation removes that test from the evidence for the change and still needs approval against requirements (§7). Basis: claims 8, 13, 29.
2. **Optional differential checks, and generators must prove they catch something** (ADR 0017, PRD §7 [S]). For work declared behavior-preserving, run base and candidate on the same inputs and report any difference as a finding. Generated inputs or fuzzers count as evidence only if they catch a planted defect. Unsupported languages are reported as unsupported, never as a pass. Basis: claims 16, 17, 30.
3. **Review looks for special-casing** (PRD §5 Review [S], §11 replay case). Code that branches on a literal identifier, property name, file name or test input in order to pass is a finding. Basis: claim 21.
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
2. **Differential checks (ADR 0017):** adopt as opt-in per repository for behavior-preserving work, off by default? A reported difference is a finding under the 2026-11-24 rule; confirm.
3. **Special-casing check (PRD §5 Review):** add it as a Review item and a replay case?
4. **Measured, not estimated (ADR 0018):** adopt the run-over-run scorecard in Retro and the rule that a cited rule must resolve to real ORDERS, config or spec text?
5. **No planning Markdown (PRD §5 Implement):** factory PRs add no planning or design docs unless the issue asks?

## Open threads

- Find the AOT PR to check its size and the test-suite list.
- Read Bun's release notes when the AOT compiler leaves experimental status, for any published memory and startup figures.
- If differential checks are adopted, decide the input source per language (recorded fixtures, existing test inputs, or generated inputs) during build planning.
