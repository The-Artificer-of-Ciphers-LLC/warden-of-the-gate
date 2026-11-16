# Talk Research: "How to Build a Software Factory That Improves Itself" — Zach Lloyd, Warp

**Source:** AI Engineer YouTube channel, uploaded 2026-11-09 (~22 min).
- Video: https://www.youtube.com/watch?v=nKjPBAw_N_0
- Reading edition: https://ai.engineer/talks/nKjPBAw_N_0-build-software-factory-that-improves-itself
- Speaker page: https://ai.engineer/speakers/zach-lloyd
- Full machine-generated transcript: [sources/lloyd-factory-transcript.md](sources/lloyd-factory-transcript.md) (downloaded 2026-11-14; recognition errors remain, timestamps are the video's clock)

**Speaker:** Zach Lloyd — principal engineer at Google (led engineering on Google Docs, "hundreds of millions and I think maybe now over a billion people" [00:31]); founder and CEO of Warp (agentic development; Warp Terminal is open source, ~65k GitHub stars, "almost a million active developers" [00:57]).
**Researched:** 2026-11-14.
**Confidence:** HIGH for what the talk claims (full transcript read directly). Warp Factories is a commercial product; all numbers shown are self-reported by Lloyd, not independently verified. Transcript renders "Claude Code" as "cloud code" and model names unreliably (e.g. "GLM53 flash", "GPT56 soul") — treat specific model names as approximate.

---

## Why this talk matters to Warden

Lloyd is the clearest public articulation of the **self-improving loop** that Warden's Retro task is a first step toward: store everything your agents do, score it, aggregate failure modes into patterns, and let agents propose changes to the factory definition itself. It validates three things Warden already assumes (factory defined in code ≈ ADR 0005 config-as-code; measurement before automation; verification to lessen review burden) and adds two ideas Warden does not yet have (LLM-judged scoring of runs as Retro input; benchmark replay of past tasks for model routing). It also forces an honest contrast: Lloyd's factory is **cloud-sandboxed** for security and governance, while Warden is deliberately **local** on the maintainer's subscription — Lloyd himself concedes his platform "is just overkill for an individual like you're probably gonna want to use like your cloud code [Claude Code] subscription" [21:45].

---

## The phase shift: interactive prompting → automated development

- Where most companies are [01:24]: "interactive prompting" — engineers on laptops running Claude Code / Codex, "interactively prompting agents to build features and fix bugs."
- Where they want to get: **automated development** — "deploying this transformational technology which is agents and LLMs to get the most possible business value at the lowest possible cost in a way that is governed and secure" [01:52].
- The limits of local interactive agents, in his words [02:14–03:06]:
  - "you're **bottlenecked by a person** running them"
  - "it's hard to control costs if everyone has their own setup and it's hard to govern"
  - Security: "if there is a problem or compromise of a local agent then it's basically has the ability to **take over whatever the user who signed in on their laptop** is"
  - "everyone is kind of configuring their own MCPs, their own skills, their own tools. And it's like **you can't see what's going on. You can't audit it**"
- His answer: sandbox agents in the cloud — "the product category that is emerging to support this… is what we call a **cloud software factory**" [03:06]: "every company is going to set up a loop in the cloud where a combination of humans and agents do work. Humans are responsible for putting work in, agents will do different parts of the software life cycle… triage. They'll work with the human on a spec. They'll do implementation. They will do computer use verification" [03:15–03:41].
- The stakes [03:50]: "Define all the rules for how humans and agents interact and then get to a spot where you can really, really measure and improve over time. Because **getting this concept right is going to be the key driver to how your organization ships software**."

## The factory as infrastructure (not a product)

Three required characteristics [04:16–05:12]:
- **Open** — "a factory model that can support different models whether it's open weight or frontier… different harnesses. The best models and harnesses are constantly changing."
- **Adaptable** — "the factory should work with your existing infrastructure" (Slack, Linear/Jira, GitHub PR comments all feed in [09:52–10:14]).
- **Defined in code** — "your factory should be a thing that has like a strict definition… what are the workflows, what are the skills, what are the MCPs, where do these run and **when you define it in code and version control it then you get the ability to like test different versions of your factory. You get the ability for coding agents to update your factory**" [04:53–05:12].

Plus **AI sovereignty** for enterprises [05:16–05:48]: "owning all the data that goes in and all the data that comes out… agents running on your own infrastructure and own compute… provide your own inference."

**For Warden:** "defined in code, versioned, testable" is exactly ADR 0005 (config per repo, schema-validated, versioned) plus the plugin's skills/prompts. Warden's whole factory — `warden.yml`, specialist prompts, REVIEW.md, the runner — is a versioned code definition of an agent workflow. The difference: Warden's factory runs on the maintainer's laptop, not a cloud platform.

## Measurement first, on your own data

- Public benchmarks are untrustworthy for *your* work [06:13–06:29]: "you can't really trust the public benchmarks as like a way of understanding how good a certain model or harness is going to be on your own workflows."
- The target state [06:29–06:55]: "the world that you want to get to… is actually being **measurement first on your own data**. So whatever factory model you approach have the ability to score meaning like eval how your coding agents are doing. **Feed those scores into agents that can improve your factory** and then also create your own benchmarks. Meaning like be able to take all of your real coding agent tasks and try them against different models."
- Two kinds of engineering [07:05–07:48]: product engineers (build features through the factory) plus "**factory engineering**… improving the skills, setting the context, changing the model mix, all of these things are going to become more important as engineers are like building and improving the system that actually builds the software."

## The self-improvement loop (the core idea)

From the Warp Factories demo [08:12–14:42]:
- **Everything is stored.** The dashboard shows automation %, cycle time, spend; "everything that's happening on our team… all this data is getting stored and **what your coding agents are doing is the raw material for improving them**" [09:36–09:44].
- **Scores = online evals.** "we have a set of agents that are looking at all of these runs… using **LLM as a judge** whether or not those runs are good or not. And so for instance we have a scorer here that is looking for agents that are writing **redundant tests** which is a common failure mode with these coding agents" [12:30–12:54]. "Every one of these failures is an opportunity for improving how your system works" [13:07].
- **The loop** [13:26–14:28]: "agents will go and they'll look at all these failure modes. They'll **aggregate them**. They will look for **patterns** and then they will come up with ideas for how do you improve the underlying factory definition so that going forward you don't have this same failure mode." Worked example: a pattern "read matching repository skills before implementing" — "I saw this fail **37 times** and then it's saying okay we can actually fix this with a **PR to the factory definition**."
- "This is like closing the loop where the agent has identified a problem then it's suggesting a change to actually drive a better result in the factory. So this is like a core concept… **it's about creating these loops where agents can identify problems and then fix them**" [14:21–14:39].

## Benchmarks and model routing on your own data

- Any past run can be added to a benchmark suite [15:24–16:07]: "take past runs… say okay I want to add this to a benchmark suite… it will **replay your real past coding agent tasks** and then generate for you what looks like a basically a **cost versus quality trade-off graph**."
- Worked example [16:31–16:45]: "GLM53 flash was **93% correct** on these tasks at a cost of **$2**. GPT56 soul was like **95% correct, but it cost three times as much**."
- The point [16:48–17:02]: "you can take this information and then build a **model routing strategy** that you have real confidence is not just a generic one but for your actual code, your stack."
- Benchmark sets can be curated by hand or "ask the factory to do it because the factory is aware of all the past sessions and so everything is stored in code" [20:14–20:44].
- Stack summary [17:15–17:42]: defined-in-code data layer → sandboxed execution → flexible inference → self-improvement layer (benchmark scoring) → orchestration (multi-step workflows) → access from existing tools.

## Q&A: verification, budgets, correctness, scale

- **Verification** [18:06–18:47]: the factory creates "a pile up of PRs… the big things that I advise are **spec driven development**. So you can actually test make sure that the changes are adherent to a spec. And the other thing is **computer use verification**… agents that verify or produce evidence from the user standpoint that the thing works that can go a long way in terms of like **lessening the code review burden**."
- **Budgets** [18:59–19:21]: "we give people the tools to measure like what's your **cost per PR** and then what percent of the cost is going towards like scoring or benchmarking… you can kind of extrapolate it out."
- **Closing** [19:24–19:31]: "the key thing that I want people to leave if there's one idea is like really **set up something that you can measure and improve**. And once you can truly measure in a closed loop system, you can do all of these things in a way that's just never been possible before."
- **Correctness** [20:50–21:13]: "everything in this chart is driven by **LLM as a judge** which… another way of doing it is human grading which makes total sense. We just haven't added that yet."
- **Scale** [21:23–21:53]: "it is not open source… It is best for teams though I will say because like if you're an individual it's just **overkill**… you're probably gonna want to use like your cloud code [Claude Code] subscription but once you have a team of like maybe **10 or more** engineers having a system like this is very valuable."

---

## Implications for Warden (where each idea lands)

| # | Talk idea | Warden component | Where captured |
|---|---|---|---|
| 1 | Self-improvement loop: store runs → score → aggregate failure modes → patterns → **PRs to the factory definition** | Validates Retro's design (corrections become versioned changes, human-gated). Adds two inputs Warden lacks: **Warden's own session traces** (safe — App-authored data, not contributor text) and **LLM-judged run scores** (v1.x) | FEATURES.md (Retro row); SUMMARY.md; PROJECT.md Key Decisions |
| 2 | Factory defined in code, versioned → testable + updatable by agents | ADR 0005 config-as-code validated; `warden.yml` + skills + prompts *are* the factory definition. Retro PRs to that definition are exactly Lloyd's loop, at solo scale | SUMMARY.md |
| 3 | Measurement first on your own data; public benchmarks untrustworthy | Shadow-mode agreement scoring is Warden's version (already planned). v1.x: **benchmark replay of past Warden tasks** across model configs → cost-vs-quality graph for routing | FEATURES.md (deferred); SUMMARY.md |
| 4 | LLM-as-judge scoring of all runs (online evals); human grading "not added yet" | v1.x run-scorer as Retro input *alongside* maintainer comments. Warden's human gate is the layer Lloyd admits he lacks — a strength to keep, not close | FEATURES.md (Retro row); SUMMARY.md |
| 5 | Cost per PR + spend tracking as the budgeting unit | Warden runs on a subscription (ADR 0004) — no per-call cost; the analog is session budget/turns per item, which Warden already caps. Cost-per-PR matters only if an adopter ever moves to API billing | SUMMARY.md (note) |
| 6 | Verification = spec-driven development + computer-use verification, "lessening the code review burden" | Verifier pass + decision-card evidence (failing-first red run, test output) are Warden's version; connects to Kotyal's spec check (TALK-SPEC-BUGS.md) and Tan's verification artifacts | SUMMARY.md; FRAMEWORK-CORRECTIONS.md (verifier row) |
| 7 | **Local vs cloud:** Lloyd argues sandboxed-cloud agents (compromised local agent "takes over the user"; can't audit per-user MCPs/skills) | ADR 0004 (local, no API key) is the opposite bet — and Lloyd concedes individuals should use their local subscription. Warden answers the *security* half with sandbox/isolation (Pitfall 2) and the *governance/audit* half with stored session traces + ledger, locally. The contrast is a design decision to keep explicit in docs | SUMMARY.md; PROJECT.md Key Decisions (note) |
| 8 | "What your coding agents are doing is the raw material for improving them" | Retro's input set can grow from maintainer comments (v1) to **all Warden session traces** (v1.x): failure modes, rework rounds, verifier disagreements — the same data that feeds a future garden report | FEATURES.md (Retro row) |

## Open threads and limits

- **Warp Factories is closed-source** [21:23] — the ideas transfer; the platform doesn't. Nothing here requires adopting Warp.
- **LLM-as-judge is the only correctness signal** in his charts; he admits human grading isn't implemented. For Warden, the maintainer *is* the judge (agreement scoring), so the loop is more trustworthy at solo scale — but LLM-judge scores should be treated as *input to Retro*, never as a gate.
- **The security argument is real and aimed at Warden's architecture.** A compromised local agent with the maintainer's login is a genuine risk; Warden's mitigations (sandbox, separate user option, no credentials in sessions, fail-closed init) address it without moving to the cloud. Worth a one-paragraph acknowledgment in adopter docs: "Warden runs locally by design (cost); here is how it contains the risk Lloyd describes."
- **Model names and numbers are self-reported** (93% @ $2 vs 95% @ 3×) — directional evidence that replay-benchmarking works, not a benchmark to hit.
- **Team-scale framing.** Lloyd's governance/auditability arguments assume many engineers; for one maintainer, the ledger + decision card already provide the audit trail.

---
*Talk research for: The Warden of the Gate — Researched 2026-11-14*
