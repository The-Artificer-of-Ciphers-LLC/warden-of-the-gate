# Article research: "Introducing harness adapters", Hugging Face

**Source:** Hugging Face blog, "Introducing harness adapters: adapt your favorite model to your harness to improve performance and cost", published 2026-11-20, https://huggingface.co/blog/harness-adapters-at-scale (read in full on 2026-11-28). No single author line; the byline lists Hugging Face staff (ybelkada, burtenshaw, SaylorTwift, lysandre, lewtun and others), and the models are published under the `harness-hub` organization. Section names below are the post's own headings.

**What kind of source this is:** an engineering report from the team that trained and released the models, with its recipe, datasets, checkpoints and trajectories public. The numbers are the authors' own runs on one base model (Qwen3.8-27B), mostly with thinking off. The authors flag where they are optimistic or unsure, and this note keeps those caveats.

**Checked on the Hub (2026-11-28):** [`harness-hub/Qwen3.8-27B-opencode-adapted`](https://huggingface.co/harness-hub/Qwen3.8-27B-opencode-adapted) is a LoRA adapter (PEFT safetensors) for [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B); both are Apache-2.0. Whether mlx-serve can load that adapter, or a converted copy, was not checked.

**Researched:** 2026-11-28. **Confidence:** HIGH for what the post says. MEDIUM for how far its results carry to Warden, because Warden does not train models and its tasks (structured review and triage under a deny-all tool surface) are not the post's benchmark tasks. The post's own out-of-distribution result says the gains did not clearly carry to a different setup.

---

## Verdict

Most of the post is about training (RL with LoRA inside an agent harness), which Warden does not do and the PRD defers. Three lessons carry over, and they are about evaluation, not training:

1. **A model's score belongs to the model, harness and settings together.** The same weights score differently under each harness and with thinking on or off, and the authors say outright that results cannot be compared across harnesses. Warden's qualification identity (ADR 0022) names the endpoint, model id and weights only. It should also name the harness version, the settings that change behavior, and any adapter.
2. **The benchmark itself must be checked before it is trusted.** The authors ran four checks on every task. They rejected about a quarter of 1,127 candidates and found a Terminal-Bench 2.1 verifier that accepted known-wrong answers. Warden's replay set is scored deterministically, but nothing checks that a case can be passed, can be failed, and cannot be passed by a wrong answer. That is a gap, and it sits under the auto-merge gate.
3. **Compare cost only where both models succeed.** The post reports tool calls and tokens on tasks both models solved. Warden's per-model budgets and scorecards do not say this, and a model that gives up early would look cheap.

Everything else either confirms what Warden already decided (real harness in the loop, held-out reporting, paired comparisons, uninformative cases) or is training detail that does not apply.

## What the post reports

1. **Headline** (Intro): Qwen3.8-27B under the pi harness scored 39% on Terminal-Bench 2.1 at about 2.9K tokens per task; frozen base plus an RL-trained LoRA scored 55% pass@1 at about 1.5K tokens, which the authors put down to the model "reasoning less, calling less tools, and performing better first time".
2. **Train inside the target harness** (TL;DR, Closing words): one LoRA per harness (pi, OpenCode, Hermes Agent), each better than the base under its own harness on both benchmarks, "when evaluated under the same conditions".
3. **The harness runs as shipped** (Training inside agent harnesses): unlike frameworks that re-implement the agent loop, "the harness runs exactly as it ships", and a proxy between the harness and vLLM records the exact tokens the trainer learns from.
4. **Pinned harness versions** (same section): pi 1.5.2, OpenCode 2.2.7 and Hermes Agent v0.22.6, pre-installed in Docker images.
5. **Task screening** (Validation with openenv validate): permissive-licence training-split tasks only; duplicates, "not for training" tasks, the 253 tasks in the target benchmarks and any task from a benchmark's own repository removed.
6. **Four checks on every task** (same section): `semantic.oracle_max` (the reference solution gets full reward), `semantic.floor_gap` (doing nothing scores lower), `semantic.canary_floor` (no wrong-answer canary scores above doing nothing) and `runtime.episode_determinism` (replaying the reference gives the same reward).
7. **What the checks found** (same section): 858 of 1,127 candidates passed. The wrong-answer controls caught a generated task that accepted an incomplete implementation and a Terminal-Bench 2.1 verifier that accepted known-wrong answers. Most failures were infrastructure, such as images that did not start. Failed tasks stay in a rejected split with the failing check recorded.
8. **Uninformative tasks** (Difficulty check with the base model): a task "where every attempt passes, or every attempt fails, gives no learning signal". Of 442 scored tasks, 151 were always solved, 120 never and 171 sometimes.
9. **Tuning leak, stated** (Super-adapter): the merge weight was chosen on Terminal-Bench 2.1, so those numbers are "slightly optimistic"; SWE-bench Pro played no part in the choice.
10. **Paired results with counts** (Adapter merging evaluation results, Final evaluation results): each comparison gives tasks newly solved against tasks lost and a p-value, for example 71 newly solved against 34 lost, p < 0.001.
11. **Efficiency on tasks both solved** (same section): with thinking off, the merged adapter used 53 to 73% fewer tool calls and 44 to 60% fewer tokens "on tasks both solve".
12. **Not comparable across harnesses** (Evaluation setup): pi compacts context and the others do not, so "you cannot compare the results across different harnesses"; comparisons within one harness are fair. Evaluation used default agent settings, temperature 0.8, one attempt, thinking off.
13. **Thinking mode matters** (Adapter merging evaluation results): results differ with thinking on and off, and the authors recommend the per-harness adapters when thinking is off. Under thinking off the trained model writes short text before tool calls, which they call "reasoning leakage" and leave to follow-up work (Open question).
14. **Cross-harness transfer** (Does the efficiency and performance ability transfer across harnesses?): the pi adapter also improved under OpenCode (44.8% to 54.0%) and Hermes, with about 45% fewer tool calls.
15. **Out of distribution** (Evaluation on out-of-distribution tasks and setup): on 300 AutomationBench tasks with that benchmark's own agent loop, differences were "within noise, except perhaps Hermes". Training inside the harnesses "neither transfers clearly to this very different setting nor breaks the model on it."
16. **A guardrail during runs** (safeagents in the loop): a plugin blocked misbehaving tool calls during training, and blocked calls per 1,000 tool calls fell over training (647 blocked of 1.3M checked).
17. **Training detail** (AsyncGRPOTrainer, Training setup, Training infrastructure, Final mixture, Super-adapter): asynchronous GRPO in TRL, LoRA on all linear layers, a 0.1 tool-efficiency bonus in the reward, a learning-rate sweep ending at 2e-5, 2×B200 per adapter, and merging three adapters by rank concatenation.

## How each lesson maps to Warden

Checked against `main` at `ef6e12f`: the PRD, ADRs 0001 to 0026, and `packages/warden/src/replay/replay.ts` and `src/runner/provenance.ts`.

| # | Lesson (post item) | Warden today | Effect |
|---|---|---|---|
| A | Score belongs to model, harness and settings together (2, 12, 13) | ADR 0022: a model's identity is endpoint, model id and version or weights digest. ADR 0018: replay sets run on every model, harness, prompt or configuration change. Provenance already records the harness and its version (`runner/provenance.ts`). ADR 0004: any OpenCode 2.x from 2.2.7 is accepted, and each run records the version it used. | **Gap.** Qualification does not name the harness version, the settings that change behavior (thinking mode, sampling temperature, context compaction) or a LoRA adapter loaded on the same base. A model qualified on OpenCode 2.2.7 with thinking off is not shown to be the same reviewer on 2.4.1 with thinking on. Proposed amendment to ADR 0022 and PRD §9. The 2.x range ruling stands: it decides what preflight accepts, not what has qualified. |
| B | Check the benchmark before trusting it (5, 6, 7) | PRD §11: replay is scored deterministically against curated expectations. `validateSet` checks only structure (ids, files, a non-empty expectation). Nothing checks that a known defect lies where the scorer can match it, that an empty review fails a defect case, or that a wrong answer cannot pass. | **Gap.** Proposed [ADR 0027](../adr/0027-replay-cases-are-validated.md) and PRD §11: four deterministic checks per case, no model involved, and a rejected list with the failing check. |
| C | Compare cost on cases both pass (11) | PRD §9: budgets per task are set from measured runs on the tested model. ADR 0018: scorecards and paired comparisons. Neither says which cases a cost comparison uses. | **Gap, small.** Proposed addition to ADR 0018 and PRD §11: token, tool-call and wall-time comparisons between configurations use only cases both passed, and the count of such cases is shown. |
| D | Real harness in the loop (3) | `runReplay` calls the same `runReview` and `runTriage` slices through the same `AgentRunner` as live work. | **Already covered.** No change. |
| E | Pinned harness versions (4) | ADR 0004 amendment 2026-11-27: owner ruled "should pin to 2.x.x"; each run records its version. | **Already covered by a ruling; not changed.** The post pins exact versions so its comparisons hold. Warden gets the same property from lesson A, by tying qualification to the version a run used, without narrowing the range. |
| F | Remove benchmark tasks and their repositories from training data (5) | Warden does not train. PRD §11: tune on a development subset and report the gate on a held-out subset. | **Already covered** for evaluation. |
| G | State when a number is optimistic because it was tuned on the same set (9) | PRD §11, same held-out rule. | **Already covered.** |
| H | Always-passed or never-passed cases carry no signal (8) | ADR 0018: regression set (expected near 100%) and capability set; capability cases graduate; Retro flags a regression set that has sat at 100%. | **Already covered** for evaluation. The post's point is about training signal; Warden's split already separates cases that guard against regressions from cases that tell models apart. |
| I | Paired newly-solved and lost counts with a test (10) | ADR 0022 and ADR 0018: paired differences on the same cases, McNemar's test, 95% intervals. | **Already covered; the post is a worked example of the same practice.** |
| J | Results from one setup do not carry to a very different one (14, 15) | ADR 0022: only Warden's own replay qualifies a model. | **Confirms.** Proposed sentence in ADR 0022: a public benchmark score, including a harness-specific one, never qualifies a model, and a harness-adapted model is a pool candidate like any other. |
| K | Track blocked tool calls per 1,000 (16) | ADR 0006: deny-all permission surface, an `ask` is treated as deny, runner-owned tool-call budget. PRD §11 tracks frozen-test violations but not denied tool calls. | **Small addition.** Proposed for the on-demand metrics report (PRD §11): denied tool calls per 1,000 tool calls, by model and harness version. It is a drift signal, not a gate. |
| L | Training recipe (17), reward shaping, adapter merging | PRD §2 defers "model training on the decision corpus". | **Left out.** Warden does not train or merge models. |
| M | Generate tasks from merged PRs (Three sources: Tasksmith) | PRD §11: the replay set is maintainer-curated. | **Left out.** The post's own figures argue for caution: 24 tasks from 30 merged PRs passed its checks, and one generated task accepted an incomplete implementation. Curation stays with the maintainer; ADR 0027's checks would apply to any case however it was found. |
| N | Reasoning leakage under thinking off (13) | Not addressed. | **Left out as an open research question of the authors'.** Lesson A already makes thinking mode part of what is qualified. |

## Proposals in this PR

All are **PROPOSED, awaiting owner review**, and marked **[H]** in the PRD.

1. **ADR 0022 amendment (lesson A, J).** A qualification covers one configuration: the model identity ADR 0022 already defines, plus the harness name and the version the run reported, the settings that change model behavior (thinking or reasoning mode, sampling temperature, context compaction), and the digest of any adapter loaded on the base weights. A public benchmark score never qualifies.
2. **ADR 0027 (lesson B).** Every replay case passes four deterministic checks before it counts: the expected answer passes, an empty answer fails a defect case, a wrong answer does not pass, and scoring the same recorded output twice gives the same result. A case that fails is kept in a rejected list with the failing check and does not count toward the §11 minimums.
3. **ADR 0018 addition (lesson C).** Cost comparisons between configurations use only the cases both passed, with that count shown. Baselines are kept per harness version and settings as well as per model.
4. **PRD §11 metrics (lesson K).** Denied tool calls per 1,000 tool calls, by model and harness version, in the on-demand metrics report.

## Question for the owner (now decided)

Proposal 1 means that when OpenCode moves from one 2.x release to another (for example 2.4.1 to 2.5.0), or a thinking or sampling setting changes, the model's verdicts stop counting toward auto-merge until a replay run on the new version passes. ADR 0018 already runs replay on every harness change; what is new is that auto-merge waits for the pass. The alternative is to treat a harness patch or minor release as the same configuration and requalify only on a new major or a settings change. The post's evidence (lesson A) is about different harnesses and thinking modes, not about patch releases of one harness, so it supports the strict rule for settings but does not settle it for minor versions.

**Decided 2026-11-28 (@trek-e):** "Major or settings only". A new major version or a settings change requalifies; a minor or patch release does not. Recorded in ADR 0022 and PRD §9.
