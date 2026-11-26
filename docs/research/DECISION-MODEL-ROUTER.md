# Decision Models (Jev and Jev-style) as Warden's Front-End Router

**Domain:** Whether a fast, one-pass "System One" decision model, TypeSafe AI's Jev or an open Jev-style model, should sit at Warden's front end: deciding easy calls when confident and escalating unsure ones to heavier reviewers or the maintainer.
**Researched:** 2026-11-25.
**Confidence:** HIGH for what the cited papers and vendor docs report. MEDIUM for how those results carry over to Warden: no paper tests PR review directly, and nothing here was run against Warden's own PRs. LOW for whether mlx-serve can load the open JEV-27B decision head (not confirmed).

> **Status: research + recommendation. Proposed [ADR 0019](../adr/0019-decision-model-router.md) is post-MVP.** The PRD and existing ADRs are not changed. Code is unchanged.

## Owner direction (2026-11-25, verbatim)

- "Investigate if a JEV model might be useful in this as a front end for this."
- "JEV decision model"
- On adding this note and a proposed ADR to the repo: "Yes"

## Summary

**Useful only as a router, never as a judge of code.** A Jev-style model fits the fast "which way does this go" decisions at Warden's front end: PR kind, review depth and tier, and whether a contributor reply answers an open finding. It is a poor fit for deciding whether code is correct or mergeable, and PRD §3 already forbids turning a model confidence score into merge authority.

Recommendation: keep it out of the MVP. After the MVP, run a shadow-mode router on Warden's own past PRs using a model already served through standard Chat Completions (route 3 below), and promote it only if it holds up against about 100 labelled PRs per decision type.

## What Jev is

TypeSafe AI's Jev (released 2026-09-15) takes a state (text, JSON or images) and typed questions and returns a probability for every allowed answer in one forward pass, with no generated text. Question types: Choice (named options), Noul (yes/no), Score (ordinal levels) and Box (image regions, 1.14 only). Median latency is about 0.15 s; price is $0.042 per million input tokens, output free. TypeSafe trains it with what it calls RLCD (reinforcement learning for calibrated decisions). Current versions are `jev-1.14.0` and `jev-1.13.0`; the `jev-latest` alias moves silently, so thresholds must pin a version.

## Three ways to run one

| Route | Weights and licence | Where it runs | API shape | Fit with Warden's rulings |
| --- | --- | --- | --- | --- |
| **1. TypeSafe Jev (hosted)** | Proprietary | TypeSafe cloud (also Cloudflare, OpenRouter) | Own endpoint, `POST /v1/systemone` | Poor. Closed, remote only, and not OpenAI or Anthropic shaped, which conflicts with "follow the published specs". TypeSafe states it does not train on inputs; its terms allow processing of telemetry, and zero data retention is enterprise-only on request. |
| **2. Open replicas** | autotrust/JEV-27B (Apache-2.0, Qwen3.8-27B base; its card reports parity with Jev 1.13). jaredpalmer/kev-4b (Apache-2.0, LoRA on Qwen3.5-4B-Base; run locally through MLX in arXiv 2611.00505). | Maintainer's Mac or the Nemotron/Gemma service | JEV-27B adds a non-standard `POST /v1/decide` route to vLLM; Kev-4B needs its own scoring code | Good on licence and privacy; each needs a special case in the endpoint registry. |
| **3. LLM-as-Jev on an already-served model** | Whatever the endpoint already serves | mlx-serve today | Standard Chat Completions `logprobs` / `top_logprobs` over one-letter options | Best fit. Both fields are in the OpenAI spec; mlx-serve supports them, and its v26.11.4 changelog says they now also work with `response_format` (issue #515, PR #552). Li and Wagle (arXiv 2610.02076) find frozen LLMs are already effective decision models without fine-tuning. |

Anthropic Messages returns no token probabilities, so route 3 runs only on the Chat Completions path, consistent with connection choices 4A and 5A in [MODEL-CONNECTIONS.md](MODEL-CONNECTIONS.md).

## What the evidence says for code review

- **Reads well, derives badly.** JEV-as-a-Judge (arXiv 2609.26550, CMU): within about 2 points of GPT-6 where the verdict can be read off the text (chat quality, safety, evidence-grounded factuality); behind by 12.9 points on code, 14.3 on math, 27.6 on logic and 21.4 on LiveCodeBench, where correctness must be traced.
- **Confidence helps, within limits.** At confidence 0.9 or above it ties GPT-6 (94.7% vs 94.4%). A cascade with a pre-set threshold matched GPT-6 at 41% of its fee, but on new hard correctness workloads it had to escalate 74% of items to match.
- **Fooled by polish.** When the wrong answer is more elaborately written, accuracy drops 8.8 points and error-detection AUROC falls from 0.84 to 0.76; on code the gap to GPT-6 reaches 21.8 points.
- **Cannot combine records; trusts stale summaries.** What Can't Jev Decide? (arXiv 2610.24929): single-record lookup is reliable up to 20k tokens and 64 options, but accuracy falls to 53-80% once the answer depends on several updates, and it follows a stale summary of the state. Its confidence does not flag those inherited errors, and the 23 open configurations tested share the limit.
- **PR text is attacker-controlled.** To Jev or Not to Jev (arXiv 2611.00505): an appended note to the evaluator reverses 0-4.7% of correct verdicts in five decision models but 16.7-49% in the other nine. DecisionRobust (arXiv 2610.19118): resistance to perturbation does not imply resistance to prompt injection.
- **Order and anchoring sensitivity.** Are AI Decision Models Biased? (arXiv 2610.19619): answers shift with option order and irrelevant numbers; 54% conjunction-rule violations on reworded tasks.
- **A reference answer helps.** With a reference generated once per prompt, System-1 judges reached 90.3-93.4% on JudgeBench (arXiv 2611.00505). Warden's nearest analogue is trusted verification evidence.

## Where a router would sit

**Fits (reading decisions):**

1. **Intake routing:** PR kind and a suggested review depth and tier, proposed as label intents through the serialized writer like Triage (ADR 0001).
2. **Stale clocks:** whether a contributor reply addresses the open finding, asks a question or is unrelated (ADR 0002).
3. **Reviewer selection:** which PRs get a frontier or Nemotron/Gemma pass instead of a local-only pass. This changes how hard Warden looks, not whether a PR merges.
4. **Finding ordering:** a yes/no on "is this finding supported by the cited lines" (an evidence-grounding question), used to sort or flag findings, never to drop them. Jev's errors there are mostly rejecting correct items (94.4% vs GPT-6's 97.1% accepted on HaluEval).

**Does not fit:**

- Approving, blocking or auto-merging, or standing in for Review (PRD §3, ADR 0008).
- Skipping review on "easy" PRs: eligible auto-merge requires a completed review.
- Judging correctness, risk or blast radius.
- Serving as a prompt-injection filter.

## Fit with the ten connection choices

- **1A:** record the router's endpoint, model and pinned version on every routing decision.
- **2A, 3A:** routes 2 and 3 get the same locality checks as any model; route 1 is remote.
- **4A, 5A:** route 3 needs Chat Completions logprobs; add `logprobs`/`top_logprobs` to the conformance preflight if adopted.
- **7:** JEV-27B could run on a vLLM or NIM service only through its non-standard route; another reason to prefer route 3.
- **9A, 10A:** route 1 would need the standing remote grant and a classification ceiling; it should never receive private repositories.
- **6, 8:** unaffected.

On PRD §5's "dropping findings below a configured confidence level": that should use the confidence of the reviewer that raised the finding, calibrated as FACTORY-CLAIMS-VS-EVIDENCE.md question 4 asks, not a router score.

## Payoff caveat

Jev's advantages are speed and cost at very high volume. Warden handles tens of open PRs, and its local models carry no per-call cost. The gain would be sending heavy reviewers only where needed and better clock decisions, a v1.x improvement that fits ADR 0007's deferred orchestrator/worker split.

## What adoption would take

1. Route 3 on a model already served through mlx-serve, or Kev-4B if a smaller dedicated model scores better.
2. A few fixed Choice and Yes/No questions with one-letter options, asked in both option orders and averaged.
3. Shadow mode, no writes, on past PRs through the benchmark replay ADR 0007 already plans.
4. About 100 labelled PRs per decision type; thresholds set by a lower confidence bound, which arXiv 2609.26550 reports cuts the risk of losing more than 2 points from about 45% to about 5%.
5. An injection test (a planted "note to the reviewer" in the PR body) before use on contributor PRs.

## Sources

- Li, Miao, Krishnan, Padman, "JEV-as-a-Judge: Accept When Confident, Escalate When Unsure", https://arxiv.org/abs/2609.26550 (read through §6)
- Li, Wagle, "LLM-as-Jev", https://arxiv.org/abs/2610.02076 (abstract, introduction)
- Yang et al., "What Can't Jev Decide? Probing the Limits of One-Pass Decision Models", https://arxiv.org/abs/2610.24929 (abstract, introduction)
- Lan et al., "DecisionRobust", https://arxiv.org/abs/2610.19118 (abstract, introduction)
- Imperatrice et al., "Are AI Decision Models Biased? A Case Study of Jev", https://arxiv.org/abs/2610.19619 (abstract, introduction)
- Ling, Xue, Ye, "Jev in the Wild", https://arxiv.org/abs/2609.30216 (abstract, introduction)
- Subramanian, "To Jev or Not to Jev", https://arxiv.org/abs/2611.00505 (abstract, methods)
- TypeSafe docs: https://docs.typesafe.ai/models, https://docs.typesafe.ai/concepts/system-one; pricing and enterprise pages
- Model cards: https://huggingface.co/autotrust/JEV-27B, https://huggingface.co/jaredpalmer/kev-4b
- mlx-serve: https://github.com/ddalcu/mlx-serve/blob/main/docs/api.md, issue #515, changelog v26.11.4
