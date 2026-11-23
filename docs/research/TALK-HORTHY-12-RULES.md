# Talk Research: "12 Rules for a Software Factory That Doesn't Ship Slop" — Dex Horthy, Factory (formerly HumanLayer)

**Source:** AI Engineer YouTube channel, 19:59 long (title as given by the owner; the speaker introduces it as "12 Factor Factories ... and the war on slop" [00:12]).
- Video: https://www.youtube.com/watch?v=-NFMsM2y0Vk
- Full machine-generated transcript: [sources/horthy-12-rules-software-factory-transcript.md](sources/horthy-12-rules-software-factory-transcript.md) (copied 2026-11-23 from the video page's transcript panel; recognition errors remain, timestamps are the video's clock). Captions garble several names (see "Verified against primary sources").

**Speaker:** Dex Horthy. He says he was CEO and co-founder of HumanLayer until "about a week ago" and that the company is now part of Factory [00:23]. Role and the acquisition are self-reported in the talk; not checked here. His GitHub account (https://github.com/dexhorthy) has `12-factor-agents`, `humanlayer` and `slopfiles` repositories, which fits the background he gives.
**Researched:** 2026-11-23.
**Confidence:** HIGH for what the talk claims (full transcript read). MEDIUM-LOW for its numbers: the talk is a conference keynote with slides not in the transcript, and most figures could not be traced to a primary source (see tables). The final third is a values statement (a manifesto), not evidence.

---

## Why this talk matters to Warden

Mostly confirmation, and one vocabulary borrow. The thesis is "a software factory is just good engineering" [02:11]: forward pressure (what starts work) plus back pressure (what checks the output) [03:49-05:47]. Warden's tasks and gates already fit that frame.

- **Unattended agents do not keep a codebase healthy** [06:19-07:06]. This is the case for Warden's human-gated, evidence-gated design and against an unreviewed "dark factory" [01:43-02:11]. The first-party benchmark he cites supports the direction (below), not his exact numbers.
- **Slop is asymmetric: cheap to produce, constant cost to review** [15:58-16:57]. This is the same argument as Warden's attention-budget rule, now with a named cost on the reviewer side. It also bears on Warden's own output: a reviewer that emits many low-value findings spends the maintainer's attention (see candidate 3).
- **Deterministic lint rules as back pressure** [11:33-12:11]. Already covered by the static-first correction ladder and by [TALK-SLOP.md](TALK-SLOP.md); this talk adds named, public rule sets.
- **Align on a visual summary before reading text** [11:03-11:33]. Same shape as Ronacher's executive-summary page and Warden's cards ([TALK-RONACHER-WORKSHOP.md](TALK-RONACHER-WORKSHOP.md)). Nothing new.

Not new, skipped: factory-as-standardised-process [02:11-02:59] ([TALK-FACTORY.md](TALK-FACTORY.md)); planning before building [09:23-11:03] (PRD sections 5 and 8 already require approved scope before Implement); feature flags for models [12:12]; buy-versus-build and control-plane remarks [13:26-14:15]; the Python 2-style output claim [08:01-08:54] (Warden's code is TypeScript).

---

## What the speaker claimed (with timestamps)

### Framing [00:12-05:47]
1. Factory is "just good engineering"; the factory mindset standardises the process, not just the output [02:11-02:59]. Pre-AI factories had tracker, build, tests, PR, CI, canary, monitoring [02:59-03:49].
2. Making it agentic = replace "someone builds" with "an agent builds", then add **forward pressure** (feature requests and incidents routed to the factory) and **back pressure** (agentic review and testing, CI, linters, formal checks) [03:49-04:57].
3. Rule 1: use the forward/back-pressure frame rather than "loops" [05:47-06:19].

### Know your enemy [06:19-09:23]
4. Unattended models do not maintain or improve codebase quality over time; if you want maintainability in three to six months, you must know what is there [06:19-07:06].
5. A new benchmark, "slap code bench" (SlopCodeBench), "from the lab at University of Wisconsin", released "today", is unsaturated: GPT 5.5 "got a 15%", "Astra" "scored 16.3" [00:47-01:43, repeated 07:06-08:01]. **Speaker's figures; see verification: the first-party page does not show these numbers.**
6. It measures checkpoint-by-checkpoint evolution of a codebase, with cyclomatic complexity, lines per symbol, share of high-complexity functions; "200 custom rules", "50 of them" from long-standing practice, the rest custom from comparing model code to pre-AI repos [07:06-08:01]. **Unverified count.**
7. A paper "put up today" by Gabe "Waransky" (caption), who runs the lab; models learned to use exceptions instead of returning tuples in Python; slop patterns are more present in today's models than six months ago ("slop is amplifying") [08:01-08:54]. **Name garbled; see verification.**
8. "Claude and GLM are now writing Python 3 in Python 2 style" (percent-s formats, no f-strings) [08:01-08:54]. Anecdote or benchmark finding; not traced.
9. "Jury is still out on Fable 5.2"; allegedly telling the model it owns the codebase keeps it clean; he has not tested it [08:54-09:23]. **Explicitly untested.**
10. The "Feros" study: "30% of PRs merging without review, longer comments, more comments, more incidents per PR, more bugs per developer" [00:47-01:43]. **Unverified; the closest first-party source gives different figures (see verification).**

### Practices [09:23-14:15]
11. Plan before you build, but not forever: judge by "expected pain" (likelihood of change times difficulty of change); get database schemas right, do not argue about button colour [09:23-11:03]. Illustrative probabilities (50%, 10%, 0%; 6 hours, 5 hours, 20 hours) are examples, not measurements.
12. "Align visually": his "show me" skill gives HTML mockups, tables and charts instead of walls of text; "about 40,000 installs" [11:03-11:33]. **Install count unverified.**
13. Help agents test their own work: screenshots, browsers, videos, curl, a runnable build [11:03-11:33].
14. Fight slop with lint: Dylan "Moy" of Cloudflare's "Anti-Slop" repo, "100ish rules"; Factory has an ESLint plugin; the Python quality rules from the benchmark can be forked [11:33-12:11]. **Name, employer and rule count unverified; see verification.**
15. Slop is a tool; prototypes behind a feature flag are fine [12:11-12:42]. Give models a feature-flag system [12:12-12:42].
16. Compound over time: eval everything, learn from past sessions [12:12-12:42].
17. "Unify your forge": decisions, designs and docs should sit as near the code as possible, not in pasted chat answers [12:42-13:26].
18. You cannot buy everything; "I don't think anyone can sell you verification of your code" because only you know how to test it [13:26-14:15].

### Anti-slop manifesto [14:15-19:59]
19. Announced "anti-slop manifesto" at "slop manifesto.com", written with attendees and speakers; signers named include people at ZoomInfo, xAI and OpenAI ("I think") [14:15-15:04]. **Signer affiliations unverified.**
20. Values: outcomes over outputs; understanding over speed; own thinking over the model's first draft; better over easier work; improving the system over patching outputs [15:04-15:58].
21. Beliefs: slop is putting less effort into producing something than the consumer must spend understanding it; using AI is not slop by itself, passing it off without responsibility is; the cost of a 1,000-line PR is "approaching zero" while review cost stays constant; slop compounds because later agents read and copy it; much slop comes from organisational pressure [15:04-16:57].
22. Resolutions: use human time wisely; optimise systems for "efficient elicitation of human intent and for efficient human understanding"; own intent, taste and consequences; say when an agent wrote something and check it before sending; push back kindly on received slop [16:57-17:55].
23. "There will always be alpha in reviewing something"; agent reviewers, linters and verifiers "are useful but not sufficient"; review "some subset of the outputs", depending on stakes; judge by what shipped and who uses it, not lines of code, PRs merged or parallel agents [17:55-19:17].
24. "None of us has this figured out"; calibrate yourself [19:17-19:59].

---

## Claim-by-claim mapping to Warden

Warden facts from the PRD (`docs/prd/0001-warden-of-the-gate.md`), ADRs 0001-0012, and [../handoff/2026-11-18-p3-progress.md](../handoff/2026-11-18-p3-progress.md) (P7 section).

| # | Talk claim | Verdict | Warden today / note |
|---|---|---|---|
| 2, 3 | Forward and back pressure | **Confirms; vocabulary only** | Forward: Intake and Triage route work, Implement picks `ready` items. Back: Review, trusted executor evidence, gate-weakening detection, merge gates (PRD sections 3, 5, 7). No new requirement. |
| 4 | Unattended models do not keep quality up | **Confirms the design** | PRD section 3 high-risk and uncertain work needs a maintainer; section 11 requires explicit maintainer activation. Warden has no measurement of Implement-side erosion yet: P7 measured review and triage only. |
| 5-7 | SlopCodeBench numbers and design | **Direction supported, numbers not** | First-party arXiv paper confirms erosion rising with iteration (77% of trajectories) and best solve rate under 15% on its page. The 15% / 16.3% pairing is not reproduced anywhere found. Treat as the speaker's slide figures. |
| 10 | Unreviewed merges, incidents, bugs | **Unverified; no use as a number** | The Faros report gives similar categories with different figures. Not a basis for any Warden threshold. |
| 14 | Anti-slop lint rules | **Already covered** | PRD section 7 static-first ladder and "trusted build, lint and test commands are allowed for verification"; ADR 0009 permits maintainer-authorised lint inside the isolation boundary. TALK-SLOP covers rule curation. |
| 12, 13 | Show-me skill; help agents test | **Already covered** | Cards and PR bodies are the human-facing summary (PRD section 8); agents get a trusted executor (section 7). The talk's visual HTML format is a presentation choice; Discord cards carry only non-sensitive summaries (section 8) so HTML is out of scope. |
| 11 | Plan before building; expected pain | **Confirms** | ADR 0001 and PRD section 5 Triage: features need approved scope and acceptance criteria before Implement; material change needs renewed approval. |
| 17 | Unify the forge | **Already covered** | PRD section 4 and 8: accepted decisions are recorded on GitHub; ledger comment is the single item state. |
| 21 | Slop compounds because agents read prior output | **Partly covered** | PRD section 8 "Distinguish maintainer rulings from agent suggestions". The wider point (model-drafted comments become later context) has no explicit rule; see candidate 5. |
| 21 | Review cost is constant while production cost falls | **Confirms; measured here as a risk** | P7 clean dev run: 13 of 18 findings outside the labelled defect; later verified real but mostly edge cases and nits (handoff line 177, 181, 183). Real, but each costs maintainer attention. See candidate 3. |
| 23 | Reviewers and verifiers are not sufficient; review a stakes-dependent subset | **Consistent with ADR 0008** | ADR 0008 tiers autonomy by risk and evidence, not model confidence; PRD section 11 forbids turning shadow days into approval. Warden's own model reviewer is not qualified (below). No conflict. |
| 15 | Feature flags for models | **Does not apply** | Warden does not ship product features; no ADR touches this. |
| 9 | "Own the codebase" prompt keeps code clean | **Untested by the speaker** | If ever tried, only via replay (TALK-ENGINEER-AGENTS incorporation 1). Do not adopt. |

---

## What applies / what does not

**Applies**
- The cost asymmetry between producing and reviewing (rule: protect maintainer attention).
- Treat linters and verifiers as necessary but not sufficient; keep the human gate for high-risk work.
- Measure outcomes, not volume [19:17]: Warden's own metrics list already avoids PR counts (PRD section 11 tracks escapes, reverts and maintainer effort).

**Does not apply, or already built**
- Feature flags, vibe-coding endorsement, buy-versus-build, signers, and "alpha in reviewing" are values or context.
- Everything about Python style drift: Warden is TypeScript, and the model is a local `qwen3.8-27b`, not the models he names.
- "Dark factory" is rejected by the speaker and by Warden's design; no change.

---

## Verified against primary sources (versus the speaker's claims)

Checked 2026-11-23 from public pages only. Search results and page summaries came from the fetch tool; where I did not open the primary document I say so.

| Claim | Check | Result |
|---|---|---|
| SlopCodeBench exists, from a University of Wisconsin lab [00:47] | arXiv 2603.24755, "SlopCodeBench: Benchmarking How Coding Agents Degrade Over Long-Horizon Iterative Tasks" (v1 2026-03-25, v2 2026-05-07): https://arxiv.org/abs/2603.24755 ; NeurIPS 2026 listing https://neurips.cc/virtual/2026/poster/138903 ; project site https://scbench.ai | **Exists.** Authors include Gabriel Orlanski, Frederic Sala and Aws Albarghouthi (Wisconsin per a search summary; the abstract page did not list affiliations). The captioned "Gabe Waransky" is most likely Gabriel Orlanski (corresponding author; also author of https://gabeorlanski.github.io/papers/slopcodebench.pdf) but this is an inference from the sound of the name, not stated by the speaker; treat as unresolved. |
| GPT 5.5 "15%", "Astra" 16.3% [00:47, 07:06] | arXiv abstract (v2): 36 problems, 196 checkpoints, 15 agents, best agent passes **14.8%** of checkpoints, no agent solves a problem end to end, structural erosion rises in 77% of trajectories, verbosity in 75.5%, agent code 2.3x more verbose and 2.0x more eroded than 473 open-source Python repos. scbench.ai (v1.0, 22 models) shows isolated solve rates up to 32.1% and lists GPT 5.5 at 28.1% | **Not reproduced.** Neither 15% nor 16.3% appears on either page; the metrics differ (checkpoint pass rate versus isolated solve rate) and the leaderboard has moved. The speaker's pairing may come from a slide or a different metric. **Unverified; do not cite the figures.** "Astra" is unresolved. |
| "200 custom rules, 50 from existing practice" [07:06] | Not stated on scbench.ai; the arXiv paper was read only as an abstract page | **Unverified.** |
| "Feros" study: 30% PRs merged without review, more incidents per PR, more bugs per developer [00:47] | Likely Faros (faros.ai), "AI Engineering Report 2026: The Acceleration Whiplash": https://pages.faros.ai/hubfs/AI_Engineering_Report_2026_The_Acceleration_Whiplash_Faros.pdf ; follow-up https://www.faros.ai/blog/ai-speed-trap-takeaways | **Identity is a guess from the sound ("Feros"); not confirmed by the speaker.** Search summaries (primary PDF seen only in excerpt) report bugs per developer up 54%, incidents-to-PR ratio more than tripled, "31% more PRs merging without any review"; the later post reports different figures (unreviewed merges 76.3%, incidents per PR up 14.5%). The speaker's "30% of PRs merging without review" does not match either as stated ("31% more" is a change, not a share). **Unverified; figures conflict across the vendor's own posts.** A separate academic search found no study with these exact measures. |
| "Anti-Slop" repo by Dylan "Moy", Cloudflare principal engineer, "100ish rules" [11:33] | https://github.com/dmmulroy/anti-slop (MIT, Oxlint rules) | A repo named anti-slop by GitHub user **dmmulroy** exists. The page lists **23 rules** (18 generic plus 5 optional Effect rules), not about 100, and its page does **not** state the author works at Cloudflare (it mentions Cloudflare only as maintainer of a different config). That the speaker means this repo, and that its author is the person he names, is **unconfirmed**; the spelling "Dylan Moy" is a caption artifact. Rule count mismatch is unexplained (could be another repo, another count, or a newer version). |
| Factory ESLint plugin [11:33] | Not looked up | **Unverified.** |
| Anti-slop manifesto at slopmanifesto.com [14:15-19:59] | https://www.slopmanifesto.com/ (not opened directly); mirror https://ai-tldr.dev/releases/aie-no-ai-slop-manifesto/ ; signing gist https://gist.github.com/dexhorthy/4cc96f01be5b1208519e75dad250a948 ; discussion https://news.ycombinator.com/item?id=50488769 | **Exists and matches the talk's wording** per the mirror (dated 2026-11-12, AIE Code Summit 2026; values and slop definition as in claims 20-21; "more than 330 signatures"). First-party page itself not read; the mirror is secondary. Signer affiliations (ZoomInfo, xAI, OpenAI) **not verified.** |
| "show me" skill, "about 40,000 installs" [11:03] | Searched skill registries and Horthy's GitHub repository list (30 of 163 repositories): https://github.com/dexhorthy?tab=repositories | **Primary source not found.** No repository named show-me on the first page; page 2 not read. Install count unverified. |
| Fable 5.2 "own the codebase" prompt; Claude and GLM Python 2-style output [08:01-08:54] | Not checked | **Unverified; the speaker says Fable was untested.** |

---

## Proposed PRD and ADR updates

**Nothing here is applied.** The PRD (`docs/prd/0001-warden-of-the-gate.md`) and ADRs were not edited. Each item names the file, quotes the current text, proposes wording, and states the evidence. Items marked QUESTION belong to the owner. The talk is a weak basis for any change; most items below are "no change needed".

Terms used in the owner's brief that do not appear verbatim in the ADRs: "AI proposes, scripts dispose" and "human attention budget" are not phrased that way in `docs/adr` or the PRD (searched 2026-11-23). The nearest text is cited in each item.

### 1. Anti-slop lint rules as back pressure
- **File and section:** PRD section 7 "Static-first correction ladder" (and ADR 0009).
- **Current text:** "Enforce structural requirements through types, compiler, lint and dependency-boundary rules." (PRD section 7, ladder step 2). ADR 0009: "Warden may run maintainer-authorized build, test, and lint commands from trusted configuration inside a real OS/container execution boundary."
- **Proposal:** **No change needed.** Both already allow and prefer deterministic lint for structural defects. A public rule set (dmmulroy/anti-slop, if it is what he meant) would be a maintainer-authorised lint configuration, not a Warden requirement.
- **Talk basis:** claim 14 [11:33-12:11], weak and unverified (rule count and author unconfirmed).
- **Warden evidence:** none; P7 did not test lint rules.
- **Conflict:** none.

### 2. Measure code erosion on factory-authored PRs
- **File and section:** PRD section 11 "Track state counts ..." measurement paragraph.
- **Current text:** "... auto-merge and human-escalation rates; maintainer effort; blocking-finding agreement and escapes/reverts; duplicate review attempts versus accepted duplicates; operation recovery; local tokens/time/resource usage; code-lookup quality and overhead."
- **Proposed amendment (QUESTION, owner decides):** append "; and, for factory-authored changes, a maintainability signal over successive merges (for example complexity or size growth of touched files) so degradation across iterations is visible alongside escapes and reverts."
- **Talk basis:** claims 4-7 [06:19-08:01]. The first-party paper supports the direction (erosion rises over iterations in 77% of trajectories) but is a Python benchmark of other agents, not Warden's Implement path.
- **Warden evidence:** **none.** The P7 numbers cover Review and Triage only (handoff lines 117-123, 146-150, 177). There is no Implement-side data, so this is a hypothesis to measure, not a defect.
- **Conflict:** none. QUESTION: is a maintainability metric wanted at all before Implement has live data? The agent does not recommend building it now.

### 3. Reviewer output volume counts against the maintainer's attention
- **File and section:** ADR 0008 "Merge gate"; PRD section 3 "Eligible auto-merge" last paragraph; PRD section 11 measurement.
- **Current text (ADR 0008):** "Major, minor and nit block only when enabled in config; all three are on by default (any nit can become a major with one change)." PRD section 3: "major, minor and nit findings also block by default, individually configurable."
- **Proposal (QUESTION, owner decides, no wording proposed):** whether the **default** that nits block should stay, given claim 21 [15:58-16:57] (review cost is the constant). Possible instrumentation instead of a default change: report, per replay, findings split into "labelled defect", "verified real and actionable", "verified real nit", "false".
- **Warden evidence:** supports raising the question, does not settle it. Clean dev run: 13 of 18 findings outside `mustFind` (72% strict); verification of those 13 judged all real, "mostly plausible edge cases, plus nits" (handoff lines 177 and 181; agent verdicts, not owner labels, and verifiers lean to confirming). Under the owner's "count only false claims" rule the false rate is 0 of 18, yet recall is 4/6 (67%) and the set is below 20 PRs and 20 issues (handoff line 183). The ADR default is also an owner decision ("Decided by: @trek-e").
- **Conflict:** changing the default would amend ADR 0008 only; it does not conflict with shadow-by-default or the writer. Nothing in the talk addresses nit severity directly, so the motive is indirect.

### 4. Human gate versus auto-merge default
- **File and section:** ADR 0008 Decision, "Auto-merge is the live default for eligible work"; PRD section 3.
- **Current text:** "Auto-merge is the live default for eligible work, including contributor PRs and factory-authored PRs. Shadow mode performs no GitHub writes; live actions are enabled through rollout gates."
- **Proposal:** **No change needed.** Claim 23 [17:55-19:17] ("agent reviewers, linters, verifiers ... are not sufficient"; review a subset by stakes) is already how ADR 0008 and PRD section 11 work: stakes-based tiers, "The maintainer explicitly enables live actions after reviewing evidence. Do not turn elapsed shadow days or benchmark completion into implicit approval."
- **Warden evidence:** the P7 replay is not qualified (recall 4/6 = 67% versus the 70% gate in the clean dev half; two defects missed in every run; handoff lines 177-183), which is the existing reason the gate stays closed.
- **Conflict:** none. No need to cite the unverified Faros numbers.

### 5. Model-drafted text re-entering later sessions as context
- **File and section:** PRD section 8 "Maintainer decisions and learning" and section 3 (untrusted-input rule).
- **Current text:** "Distinguish maintainer rulings from agent suggestions; scope by repository and authorized identity." PRD section 7: "Retrieval never grants authority or establishes a successful verification gate."
- **Proposal (QUESTION, owner decides):** whether to state explicitly that ledger comments, cards, reviews and PR text drafted by a model are untrusted context for later sessions, never evidence (an `agent suggestion`, not a ruling). Candidate wording: "Text drafted by a model, including prior Warden comments and cards, is untrusted input to later sessions; it can prompt a question but is never accepted evidence of a finding or a decision."
- **Talk basis:** claim 21 "slop compounds ... the next agent reads and copies" [15:58-16:57]. Conceptual only.
- **Warden evidence:** none directly. The nearest P7 finding is about contamination between **cases**, not between sessions: replay reused one packet directory so one case read another case's snapshot (handoff lines 171-175, fixed in `4b995a9`). That is a harness defect, not slop compounding, and it should not be cited as support for this change.
- **Conflict:** none; it would extend the existing rule that structured output is validated independently.

### 6. Visual summary format for cards
- **File and section:** PRD section 8 "Decision cards and channels".
- **Current text:** "Cards show linked work, proposal/revision, applicable policy, risk/blast radius, verification/CI evidence, open findings, recommendation and precise approve/deny meaning." and "Only approved non-sensitive summaries go to Discord, not source code or private transcripts."
- **Proposal:** **No change needed.** The talk's "show me" HTML mockups [11:03-11:33] are an interactive developer workflow. Warden cards already carry a short decision artifact, and an HTML attachment would be a new channel with new data-handling questions. Candidate "decide here / not verified" header is already in [TALK-RONACHER-WORKSHOP.md](TALK-RONACHER-WORKSHOP.md) incorporation 2; do not duplicate.
- **Conflict:** HTML output to Discord would conflict with the "non-sensitive summaries" rule unless reviewed.

### 7. Plan-first, decisions on the forge, retro learning
- **File and section:** PRD section 5 Triage and Retro; section 8; ADR 0001.
- **Current text (ADR 0001):** "Features and enhancements receive a design proposal with scope, observable acceptance criteria, affected areas, blast radius, alternatives and uncertainty. Maintainer approval is required before implementation."
- **Proposal:** **No change needed** for claims 11, 16 and 17 [09:23-11:03, 12:12-13:26]. The "expected pain" heuristic could inform how Triage ranks which design questions to ask first, but the talk gives no measurement, so no requirement is proposed.

### 8. Local-model rule, single writer, shadow-by-default
- **ADR 0007 / 0004** ("MVP inference is local-only ... Remote per-task opt-in with budgets is deferred, not an MVP fallback"), **ADR 0012** ("Local AI produces validated action intents rather than competing item-ledger updates"; "`shadow` rejects AI-origin intents visibly"): nothing in the talk touches these. The one adjacent remark, that agent code and review capacity are bought or built per team [13:26-14:15], assumes hosted frontier harnesses; **no change needed**, no conflict.

### 9. Not proposed (so nobody assumes they were considered and dropped silently)
- Adopting the manifesto, adding signers or a "we value ..." section to the PRD: a values choice for the owner, not an engineering requirement; nothing supports a PRD edit. QUESTION only if the owner wants it.
- Changing replay scoring from line-range to also accept function/hunk matches: **not motivated by this talk**. It is an open owner question already recorded in the handoff (line 192); this note adds no evidence for or against.
- Any change to the cap defaults based on this talk: the 10-63 minute measured case times and 1800 s default (handoff line 146) are Warden's own evidence, already covered in [TALK-RONACHER-WORKSHOP.md](TALK-RONACHER-WORKSHOP.md) incorporation 1; the Horthy talk says nothing about wall time.

---

## Candidate incorporations (ranked)

1. **Owner decision on candidate 3** (should nit findings block by default, or only be reported). Smallest change, and the only item with Warden-side evidence (clean dev run 13 extras, verified real, mostly nits). Not a recommendation to flip the default.
2. **Candidate 5 wording** (model-drafted text is untrusted context for later sessions). One sentence; owner decision.
3. **Candidate 2** (maintainability signal on factory-authored PRs) only after Implement has live or replay data; nothing to measure today.
4. **Do not adopt:** the speaker's benchmark figures as thresholds; the Faros numbers; the unverified lint-rule counts; HTML card attachments; feature-flag tooling.

## Unverified (speaker claims taken as claims only)

- SlopCodeBench 15% and 16.3% (the paper says 14.8% for its best agent on a different metric); "200 custom rules, 50 of them"; "Astra", "Fable 5.2" and the models he names.
- "Feros" figures including "30% of PRs merging without review".
- "100ish rules" and the identity and employer of the anti-slop author.
- 40,000 installs for show-me; manifesto signer organisations.
- Claude and GLM writing Python 2-style code.

## Open threads

- Open page 2 of Horthy's GitHub repositories (or ask the owner for the link) to resolve "show me".
- Open the Faros PDF directly and check the share of PRs merged without review before quoting any number.
- Confirm whether the paper's Table of rules (about 200?) exists; the abstract page does not state it.

---
*Talk research for: The Warden of the Gate — Researched 2026-11-23*
