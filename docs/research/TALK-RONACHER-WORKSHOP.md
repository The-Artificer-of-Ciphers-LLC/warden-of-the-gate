# Talk Research: "Build the Workshop Before the Software Factory" — Armin Ronacher, Earendil

**Source:** AI Engineer YouTube channel, 19:32 long. Upload date not checked; the speaker says "this November is not even over" [06:11], so the talk is from November 2026.
- Video: https://www.youtube.com/watch?v=JNexz3Tbiu8
- Full machine-generated transcript: [sources/ronacher-workshop-before-factory-transcript.md](sources/ronacher-workshop-before-factory-transcript.md) (copied 2026-11-22 from the video page's transcript panel; recognition errors remain, timestamps are the video's clock). Captions render the speaker as "Amin Ronaha"; the name comes from the video title and Earendil's own site (below).

**Speaker:** Armin Ronacher, co-founder of Earendil. The company, the Pi relationship and his authorship of the "Building Pi With Pi" essay are confirmed by first-party pages (see the verification table). Role and background beyond that are self-reported.
**Researched:** 2026-11-22. **Rechecked:** 2026-11-27 against `main` at e91d19b (see "Recheck 2026-11-27" below; the talk adds nothing new, but four points here were overtaken by later rulings and ADRs).
**Confidence:** HIGH for what the talk claims (full transcript read directly). The talk is a practitioner's opinion piece with one personal dataset. Every number in it is **the speaker's own unverified data** (his Pi sessions, analysed by a model whose name the captions garble). Treat it as framing, not as evidence. Where the captions garble a name the name is left unresolved here.

---

## Recheck 2026-11-27

A second read of the full transcript (and a second caption copy) found nothing this note missed. Warden has changed since 2026-11-22, so four points below are out of date. They are marked in place and summarized here:

1. **Local-only premise.** Rows 16 and 17-19 and "Does not apply" assume a single loopback model on LM Studio with no hosted fallback. Since then the owner has ruled that Warden is not local-only and connects to any approved OpenAI-compatible or Anthropic Messages endpoint, with mlx-serve for the MVP ([MODEL-CONNECTIONS.md](MODEL-CONNECTIONS.md), owner rulings 2026-11-24 and 2026-11-25). The flex-scheduling verdict still holds for a local endpoint, not for every endpoint.
2. **Decision and classifier models.** Rows 17-19 call a cheap decision model a conflict. [ADR 0019](../adr/0019-decision-model-router.md) (proposed, 2026-11-25) now covers that shape: a Jev-style decision model as a router that proposes routing only and never authorizes. The talk's support-queue example [18:12-19:15] is that router. The caption name "Jeff" reads as Jev, the non-LLM model Earendil's Pi 1.0 post says Codemode supports (https://earendil.com/posts/pi-1-0/); [DECISION-MODEL-ROUTER.md](DECISION-MODEL-ROUTER.md) attributes Jev to TypeSafe AI.
3. **Owner absence (incorporation 4).** Answered 2026-11-24 (PRD §8): an item set for maintainer review waits for it, however long that takes, and maintainer absence never turns silence into approval.
4. **Executive summary before verification** [10:04-11:07]. The closest Warden equivalent is now [ADR 0020](../adr/0020-review-attention-and-maintainer-understanding.md)'s `read-after` digest (proposed, awaiting the owner), which postdates this note.

Still not acted on as of e91d19b: incorporation 1 (`wallTimeSeconds` is still 1800 in `packages/warden/src/config/defaults.ts`), incorporation 2 (no explicit "not verified" list on cards), incorporation 3 (no count of cap-ended attempts), and incorporation 5 (the triage prompt still says only that the issue is untrusted, `packages/warden/src/triage/slice.ts:33`).

---

## Why this talk matters to Warden

Mostly confirmation and two cautions, not new mechanisms. What is worth keeping:

- **Human attention is the pacing limit** [04:21-05:02], and the speaker's counter-measure is a short executive summary page produced before verification [10:04-11:07]. That is the same bet as Warden's review and triage cards: the maintainer decides from a short, evidence-bearing artifact, not by reading everything.
- **Agents are rewarded for completing, not for being right** [07:58-09:06]. This matches Warden's evidence gates, and Warden's own P7 numbers show the gap in a harness metric (see mapping).
- **Maintainer attention is not replaceable by automation** [07:10-07:58]: an automated project stops being cared for the moment the owner stops attending. Relevant to how Warden should behave when the owner is absent.
- **External systems are taxed by agents** [05:02-06:11]. Warden talks to GitHub (and Discord); its throttling already matches this caution.
- **Durable agents and code-mode plus classifier workflows** [15:03-19:15] are the two things he says harnesses should do next. Both collide with Warden's rules in part (see "does not apply").

Not new: the "workshop not factory" metaphor and the spec of what a factory is are already covered by [TALK-FACTORY.md](TALK-FACTORY.md) and [TALK-ENGINEER-AGENTS.md](TALK-ENGINEER-AGENTS.md). He argues for the opposite emphasis from both: invest in the human's skill and understanding before automation, which sits closest to [TALK-SLOP.md](TALK-SLOP.md).

---

## What the speaker claimed (with timestamps)

### Models improve, harness does not [01:18-04:21]
1. Pi's core harness "has not really changed in a year"; same tools as December of last year; it is more capable only because models improved [01:18-02:09]. (Speaker's claim; see verification: the tool list is consistent, the "nothing changed" part is overstated.)
2. Most prompting tricks and plugins are no longer needed; example: a Pi "auto research" plug-in that drove an agent toward a goal is unnecessary with a current model [02:09-02:40].
3. From his own default-configuration Pi sessions, analysed by a model (name garbled as "Chef"): corrections he has to make fell with each model generation; aborts too [02:40-03:08].
4. The 90th-percentile length of an agent run per task was about 2.5 minutes with Opus 4.6 in December and is now 14 minutes or more [03:08-03:50]. **Own data, unverified.**
5. Current agents use bash more than other tools; two other models behaved like Opus in his data but the test set was too small to chart (names garbled "Astra and Soul"); "code mode" usage is "slowly creeping up" [03:50-04:21]. **Own data, unverified; model names not resolved.**

### Human attention and maintenance [04:21-07:58]
6. Humans are "the thing that paces" the work; human attention is the limiting factor [04:21-05:02].
7. Starting projects is very easy; maintaining them is not [05:02-06:11]. Agents also load external systems that are "not supposed to be part of this revolution"; he knows people with old, well-established websites that found a "new life for agents" and cannot take the volume; GitHub commit and repository counts are up [05:02-06:11]. (Anecdote plus common knowledge; no figure.)
8. His own numbers: prompts pushed per day roughly flat at about 120-190 across the year; agent active time went from under a working day to many times a working day; 141 projects created, only 10-15 committed to regularly (more than five days) [06:11-07:10]. **Own data, unverified.**
9. An informal survey of friends shows the same pattern [07:10-07:58]. **Anecdotal, no sample size.**
10. A friend fully automated an open-source project (issue in, agent reviews, commits, sends back) and then turned it off because he no longer cared and wanted the tokens for other things; conclusion: our attention to the project matters even if automated [07:10-07:58]. **Single anecdote.**

### Quality, skill and shared standards [07:58-15:03]
11. An agent "is really rewarded in just completing a goal" and success is easy to check; this is like an RL environment's reward, and does not mean the output is something we are happy with long-term. A software "Simpsons car" of features results unless someone pushes back [07:58-09:06].
12. "True skill versus agent skill": an experienced engineer's contributions differ visibly from his son's, using the same system; it is frustrating when colleagues just ask the agent and no longer understand the system or the problem [09:06-10:04].
13. Moderate the speed to stay within your understanding. His method: prompt the agent to produce a short executive summary and a typeset HTML page before it moves toward verification, "typically around 70%" of the way through; as a result he often no longer reads the code [10:04-11:07].
14. Fewer dependencies, more code written by agents, but "uncontrolled growth" is a risk; he cites a recent blog post about a crafted tar archive that different implementations read differently [11:07-12:36]. Standards, file formats and specifications matter because collaboration between humans is "as hard as it has ever been"; resist having the agent solve every problem; forks are multiplying because forking is easier than upstreaming [12:36-13:31].
15. Argues for excellence: verified software is rising but the stack is not there yet; faster, more memory-efficient, memory-safe software (Rust) is encouraged by models finding security issues [13:31-15:03].

### Harness directions [15:03-19:15]
16. Two-minute tasks can be babysat; with agents on "thousands of issues overnight" the agent must restore itself. He believes in **durable agents** that create **durable workflows** that can be started, stopped, suspended and resumed, partly for efficiency: with flex scheduling at raw token cost, when no token arrives for minutes the agent and its sandbox should be suspended [15:03-16:49].
17. Bash remains the base; new demand: orchestrate sub-agents and use non-LLM decision or classifier models (name garbled "Jeff") [16:49-18:12].
18. "Code mode": originally from Cloudflare; instead of thousands of tools in context, give the agent JavaScript and have tool calls happen via JavaScript so it orchestrates them; "fundamentally shockingly useful"; the harness can orchestrate very large numbers of tool calls without passing through context; "definitely the case already in Codex" and possible in Pi and others [16:49-18:12].
19. Classifier models are cheap and fast and are "not penalized for not having an active KV cache"; with code mode the agent can write an on-demand workflow where each `if` is a classifier call, e.g. 3,000 support requests "in no time" instead of hours [18:12-19:15]. **Illustration only; no measurement given.**

---

## Claim-by-claim mapping to Warden

Warden facts from [ARCHITECTURE.md](ARCHITECTURE.md), [PITFALLS.md](PITFALLS.md), ADRs 0004/0007, [../handoff/2026-11-18-p3-progress.md](../handoff/2026-11-18-p3-progress.md) and the code where named.

| # | Talk claim | Verdict | Warden today / note |
|---|---|---|---|
| 6, 13 | Attention is the limit; short executive summary before verification | **Confirms; one narrow extension** | Warden's output is already cards and a draft PR body (scope, approach, evidence, AI attribution; P4 factory PR body) and Discord cards with the exact GitHub command and no approve/deny control. The speaker's summary is requested mid-trajectory by an interactive user; Warden's deterministic executor runs after the model, so the closest equivalent is the card, not a mid-run hook. Extension in incorporation 2. |
| 6, 10 | Maintainer attention cannot be automated away | **Confirms; no code change implied** | Warden is human-gated by design (merge gates, approvals only from verified GitHub comments). The new angle is the *absence* case: the talk's friend turned the automation off. Open question in incorporation 4. |
| 11 | Agent rewarded for completion, not rightness | **Confirms; measured here** | Evidence gates: trusted executor with fail-before/pass-after, gate-weakening detection (P3 "still to build" list), shadow-by-default. Warden's own replay shows the completion/correctness gap in its metric: dev half, compaction off: accepted 16/18 (89%) while 16 of 20 findings were false (80%) (handoff, 2026-11-21 round). "Accepted" measures an output that passed the format contract, not correctness; read it only next to recall and false-positive rate. Single runs vary (same case flipped between runs), so these are not rates. |
| 12 | True skill vs agent skill; do not outsource understanding | **Confirms** | Why Warden stages shadow, qualification and a distinct activation step instead of auto-merging. Nothing to add. |
| 16 | Durable, suspendable agents; self-restoring sessions | **Partly applies** | Durable *state* already exists: write-ahead journal with fsync per record, intents durable before any network call, `unacked()` recovery (`packages/warden/src/writer/journal.ts`), persisted attempts and rework accounting, runner-enforced budgets. Durable *sessions* do not: a session that hits the wall cap is a failed attempt and a retry starts a fresh session. Measured here: single cases took 10 to 63 minutes on the local model (handoff, 2026-11-21 measurement round) while the shipped default is `wallTimeSeconds: 1800`, `maxModelTurns: 40` (`packages/warden/src/config/defaults.ts:20`), so the default would end the cases that needed longer. That is evidence for "sessions are long enough that losing one hurts", the speaker's premise, on a different cost model. See incorporation 3. |
| 16 | Suspend agent and sandbox when no tokens arrive (flex scheduling) | **Does not apply** (local endpoint only; see Recheck point 1) | Rests on paying per token to a hosted provider. Warden's inference is a loopback local model (ADR 0007), so there is no token bill to save, and suspending does not free the single local model for other work unless the owner's LM Studio use says so, which the agent must not touch. |
| 17-19 | Non-LLM classifier or decision models for bulk triage | **Conflicts as stated; a safe subset exists** (superseded by ADR 0019, see Recheck point 2) | Warden triages with one local model (`qwen3.8-27b` as loaded). A second, small classifier would be another pool member under ADR 0007: it needs proof (loopback literal, device `Local`, preflight) and the owner decides what is loaded; the agent never switches models or touches LM Studio (owner rule in memory). The Triage scan (`run --task triage`) is already "bounded, serial, shadow-only" over tracked issues; there is no throughput problem to solve with a classifier, because wall time per case is dominated by review, not triage, and triage accuracy is 34-46% (not qualified), which a cheaper classifier would not obviously improve. The KV-cache remark depends on the serving stack and was not measured here; do not rely on it. |
| 18 | Code mode: model writes JavaScript that orchestrates tool calls | **Conflicts with the core rule; read-only subset only** | Warden's rule is "AI proposes, scripts dispose": the session is a pure function packet-in, `result.json` out, with no write credential and no control-flow authority over GitHub state. Letting model-written code branch over tool calls moves control flow into the model's output. In a sandbox with only read tools it would be defensible; with any write path it would break the serialized single-writer and shadow-by-default rules, and the tool surface Warden gives OpenCode is deliberately small and restricted. The context-saving benefit is real for sessions that read many files, which is Warden's problem (context 262,144 reached; compaction failures; `Prompt is too long`), but the fix Warden chose (window guard, deterministic gathering into a packet) is the non-code-mode one. Not recommended now. |
| 7 | Agents hammer external systems | **Confirms; already mitigated** | One installation budget (5,000/hr base) shared by local runs and Actions (PITFALLS); poster serial with about 1 s between mutations; batch stops on a rate-limit signal; GraphQL pagination and conditional GETs for scans (ARCHITECTURE scaling notes); the GitHub client sleeps on `retry-after` or secondary-rate-limit responses and gives up after a bounded number of tries (`packages/warden/src/github/http.ts`). The talk adds no figure to calibrate against. |
| 8 | 141 projects started, 10-15 maintained | **Context only** | One person's data. Relevant only as a reminder that Warden's value is in the maintained long tail, which is the maintainer's scarce resource. |
| 14 | Tar parser-differential post as a warning about uncontrolled growth | **Tangential** | Warden does not parse archives. The general lesson (two parsers, one input, two meanings) already matches Warden's "validator is independent of the model" stance (Ajv plus independent scope/verdict/delta validation). No action. |
| 1-5 | Harness unchanged, models improve; many tricks obsolete | **Cautionary, no action** | Same motive as [TALK-SHIHIPAR-SWEET-BITTER.md](TALK-SHIHIPAR-SWEET-BITTER.md): scaffolding is model-relative. For a fixed local model the P7 tuning rounds show the opposite pressure (harness defects, prompts and window guard mattered). The replay ablation proposed in TALK-ENGINEER-AGENTS (incorporation 1) is the way to test whether a Warden prompt still earns its keep. |

---

## What applies / what does not

**Applies**
- Short decision artifact before the human decides (confirms existing cards).
- Treat completion as weak evidence; require an independent check (confirms evidence gates; the replay metric shows it).
- Be explicit about what happens when the maintainer disengages.
- Throttle external calls (confirms existing limits).
- Durable state across restarts (already built for the writer; not for model sessions).

**Does not apply, or conflicts with Warden's rules**
- **Hosted-token economics** (flex scheduling, raw token cost, suspending to save spend): Warden had loopback-only inference and no hosted fallback (ADR 0004/0007) when this was written. Out of date: see Recheck point 1.
- **Second, cheap classifier model**: needs a new pool member; model selection belongs to the owner (never changed by the agent); no evidence it helps Warden's measured triage accuracy. Now handled as a router-only role in ADR 0019 (Recheck point 2).
- **Code mode with write effects, or model-authored control flow over tools**: conflicts with "AI proposes, scripts dispose", the serialized single writer and shadow-by-default. Read-only use is the only shape that does not.
- **"Thousands of issues overnight"**: Warden's scans are bounded and serial by design, and on this hardware one case can take 10-63 minutes, so the throughput premise is not Warden's.
- **Reducing code reading** [10:04-11:07]: Warden's maintainer remains the gate; the speaker's practice describes a single expert reviewing his own agent, not a bot proposing changes to someone else's project.
- Talk items about Rust, verified software, forks and file-format standards: outside Warden's scope.

---

## Candidate incorporations (ranked)

1. **Make the replay wall cap an evidence-based, per-task setting and report timeouts as their own outcome.** Touches `packages/warden/src/config/defaults.ts` (budgets), `replay/replay.ts`, P7. Motive from this talk: when runs are long, losing one to a cap matters. Evidence is Warden's own measurement (10-63 minutes; default 1800 s ended cases that needed more). Keep it a measurement, not a change of authority: a larger cap is a config the owner sets; the default is not changed by this note.
2. **A fixed "decide here" header on every approval and review card**: the decision asked, the evidence ids it rests on, and an explicit "not verified" list (for example a model-only finding with no executor evidence). Touches `packages/warden/src/discord/` card text and the review/triage draft card. Based on the speaker's executive-summary practice [10:04-11:07]; the "unverified" line is Warden's own addition and is the part that guards against the completion-reward problem [07:58-09:06]. Output wording only, no new data.
3. **Per-session resume as a measured experiment, not a build.** Before any work, count from existing run reports how many attempts ended on the wall cap or turn cap and how many of those had produced partial findings. If the count is material, consider persisting a bounded partial result as an attempt record (read by the next attempt as untrusted notes). If it is not, drop the idea. Relates to the append-only event-log idea already recorded from the Lovable talk ([TALK-LOVABLE.md](TALK-LOVABLE.md)); do not duplicate it. Touches `runner/opencode.ts`, attempts in the state store; P7 or later.
4. **Decided 2026-11-24; see Recheck point 3.** ~~Decide the "owner stopped attending" behaviour before live activation.~~ Question for the owner (not a recommendation to build): what should Warden do when maintainers have made no decision for N days? Candidate: show "days since last maintainer decision" in `warden status` and the sweep report, stop starting new factory Implement work past a configured threshold, and never convert silence into approval. Based on the friend anecdote [07:10-07:58] (single anecdote). Needs an owner decision on N and on whether Implement should pause.
5. **Triage prompt: treat diagnoses asserted inside the issue as claims to verify, not evidence.** The current triage prompt already says the issue is untrusted data and not to follow instructions in it (`packages/warden/src/triage/slice.ts:33`). Earendil's own essay describes an `/is` prompt line that tells the agent not to trust analysis written in the issue and to derive its own from the code and execution path, because a confident wrong diagnosis in an issue misleads the agent (first-party, see verification). Add a similar line and measure it with the replay set (triage accuracy on `likely-bug` vs `needs-info`), not by assumption. Touches `triage/slice.ts`; P7.
6. **Do not adopt:** hosted flex scheduling and sandbox suspension; a second classifier model chosen by the agent; code mode with write effects; any "agent restores itself and continues unattended" path that spends a retry budget without the executor's evidence.

---

## Verified against primary sources (versus the speaker's claims)

Checked 2026-11-22 from public pages only.

| Claim | Check | Result |
|---|---|---|
| Code mode originated with Cloudflare [16:49-18:12] | Cloudflare blog "Code Mode: the better way to use MCP", Kenton Varda and Sunil Pai, 2025-09-26: https://blog.cloudflare.com/code-mode/ | **Verified.** The post describes converting MCP tools into a TypeScript API and having the model write code against it, running in an isolate with no general network access and API keys held by the supervisor. Its stated advantages (agents handle more tools; multi-call chains avoid feeding intermediate output back through the model) match the speaker's account. |
| Code mode is "shockingly useful" | Same post and Cloudflare docs: https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/ | The post claims "striking" results but I did not find a published benchmark in the pages read. The docs mark Code Mode **experimental** ("may have breaking changes. Use caution in production") and state that code execution "does not replace authorization": permissions and approvals must be enforced in the upstream tool handlers. A Check Point Research article on exploiting Code Mode and Workers (https://research.checkpoint.com/2026/when-agentic-glue-melts/, 2026-08-06) appeared in search results; **not read**, so no claim is made about its content. |
| Pi is Earendil's coding agent; core unchanged in a year [01:18-02:09] | Pi repository https://github.com/earendil-works/pi (MIT, "minimal, extensible agent harness"; packages include `pi-coding-agent`, `pi-ai`, `pi-durable`); product site https://pi.dev/; npm https://www.npmjs.com/package/@earendil-works/pi-coding-agent (author listed as Mario Zechner, version 1.6.0 at time of search) | **Pi exists and is Earendil's** (also Earendil's "Pi 1.0" post, https://earendil.com/posts/pi-1-0/, dated 2026-10-01). **"Core has not changed" is only partly supported:** the default tool set listed in the docs is read, bash, edit, write (consistent with "same tools"), but the Pi 1.0 post lists Codemode, deferred tool loading, cache warming and mid-conversation system messages as additions, and the Pi site's "what we didn't build" list now reads "No MCP — Now with MCP+Codemode". I did not verify the December tool list. The speaker's "same tools" is credible; "core harness unchanged" is not literally what the vendor announced. |
| Durable agents [15:03-16:49] | Same Pi 1.0 post: a new experimental `Pi Durable` package ("a new substrate for building long-running agentic applications"); repo lists `@earendil-works/pi-durable` ("Durable conversation, task, and document runtime") | **Verified that Earendil ships this as experimental.** What it does in practice was not tested; the claim that durable agents are needed is the vendor's own position. |
| Non-LLM classifier "Jeff" [16:49-18:12] | Pi 1.0 post says Codemode adds "native support for MCP, and non-LLM models like Jev and image models" | The first-party text spells it differently from the captions. Recheck 2026-11-27: read as Jev, the decision model Pi supports (TypeSafe AI per [DECISION-MODEL-ROUTER.md](DECISION-MODEL-ROUTER.md)), which ADR 0019 covers. |
| "Blog post going around about a tar archive that different tar implementations read differently" [11:07-12:36] | Search for parser-differential tar writing | The speaker names no post. Two public candidates fit: Astral, "tar-codec" (2026-10-27, https://astral.sh/blog/tar-codec: differentials that make "uv, pip, and other package tooling" see different contents of the same tarball) and Harmen Stoppels' tar test suite (https://stoppels.ch/tar/). **Which one he means is not established.** Both confirm that tar implementations extract crafted archives differently, which is the point the speaker makes. |
| Pi has changed "in one form or another"; Opus 4.6 in December | Not checked | Model release dates and Pi's December state not verified. |
| Sub-claims of his dataset (p90 run length 2.5 to 14+ minutes; 120-190 prompts/day; 141 projects, 10-15 maintained; corrections and aborts falling; code-mode "creeping up") | No data published in the talk or found on the pages above | **Unverified, own data.** |
| Ronacher essay on issues treated as evidence | https://lucumr.pocoo.org/2026/5/24/pi-oss/ ("Building Pi With Pi", 2026-05-24) | **Verified** as a first-party essay by Armin Ronacher; it contains the `/is` prompt instruction quoted in paraphrase in incorporation 5, and a "Careful Parallelism" section saying fully detached automated engineering ("dark factory") is not where Pi is today. |

## Unverified (speaker claims taken as claims only)

- All numbers in his charts (see mapping rows 4, 5, 8), the survey, the friend's automation story, the son's contribution quality.
- That emergent bash use rises and code mode is rising in his sessions; model names compared ("Astra and Soul") and the analysis model ("Chef") are caption artifacts and were not resolved.
- That the 3,000-request classifier workflow runs "in no time"; no figure given.
- That GitHub volumes and old websites are overloaded, beyond common knowledge; no source named.

## Open threads

- Is the cap-driven failure rate (incorporation 3) large enough to justify any session-resume work? Needs a count from existing run reports, not new model runs.
- ~~What should Warden do when the owner goes quiet (incorporation 4)?~~ Decided 2026-11-24 (PRD §8).
- Whether a read-only, sandboxed code-mode style gatherer is ever worth it for large-context reads: not measured, and the window-guard route is cheaper. Revisit only if context failures persist after P7 tuning.

---
*Talk research for: The Warden of the Gate — Researched 2026-11-22*
