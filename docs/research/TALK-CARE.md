# Talk Research: "Tell your agents to CARE about the codebase" — Matt Pocock

**Source:** YouTube Short, 2:06, published 2026-10-13.
- Video: https://www.youtube.com/shorts/9uSygtI-6lw
- Speaker: Matt Pocock (~416K subscribers; "We don't do vibe coding — this is a channel for real engineers")
- Full machine-generated transcript: [sources/matt-pocock-care-transcript.md](sources/matt-pocock-care-transcript.md) (usetranscribe.io; the ai.engineer transcript API does not cover Shorts. Recognition errors remain, timestamps are the video's clock.)

**Researched:** 2026-11-14.
**Confidence:** HIGH for what the short claims (full transcript read directly). It is a 2-minute opinion piece, not an empirical study — treat it as a strong practitioner heuristic that reinforces, not replaces, the Tan/Hughes/Lloyd/Kotyal findings.

---

## Why this matters to Warden

Pocock gives the clearest one-line statement of a problem Warden's **Retro** and **garden** tasks exist to solve: agents are *tactically* excellent (solve the problem in front of them) but *strategically* inert (they don't refactor, deepen modules, or improve the codebase over time) — **because their training incentives reward only the tactical**. The fix is not a better model; it is for the human to *declare that they care about the strategic layer*, at which point agents turn out to be "actually really good" at it.

This lands on Warden in three places:
1. **Retro** — the weekly task that turns corrections into durable `REVIEW.md` lines / lint rules is exactly "telling the agent you care about the strategic layer, that the codebase should improve over time, not get worse."
2. **The open-harness pivot** (see [OPEN-HARNESS.md](OPEN-HARNESS.md)) — the CARE argument applies *more* strongly to **local open models** than to frontier models, because local models are even less incentivized toward long-horizon codebase health. Warden's prompts must carry the strategic intent explicitly, or a local model will happily pile "mud onto the ball of mud."
3. **Garden / module-deepening** — Pocock's `improved-codebase-architecture` skill "plows through and finds candidates for module deepening and improving test coverage." That is a ready-made, agent-driven candidate generator for Warden's garden report.

---

## The core idea (with quotes)

**Tactical vs strategic programming.**
- "agents are really good at tactical on the ground programming… solving the problem that's in front of them, but they're really bad at strategic programming" [0:00].
- "Strategic programming is the parts of programming where you're thinking about the long view, where you are the general winning the war" [0:00].

**Why agents don't do it — an incentive problem, not a capability gap.**
- "because agents are kind of reinforcement learning on tactical problems, on benchmarks, on Deep SWE, they're just not really trained or not really incentivized to think about long-term" [0:00].
- The strategic move is socially costly: "An agent thinking long-term is kind of like that annoying colleague… who tells the PM, 'No, we probably need to refactor before we do this because it's going to cost us velocity if we just keep on piling on mud onto our ball of mud'" [0:00].
- Harnesses won't push it either: "because agents are trained to be generally useful… for lots and lots of use cases, doesn't really make sense, even in the harness level, to push them towards this probably slightly more annoying behavior" [0:00].

**The human bears the strategic brunt — but lightly.**
- "you need to be the one bearing the brunt of that. You need to be thinking strategically and pushing the agent towards more strategic improvements. You need to be the annoying one" [0:00].
- Crucially, this is *cheap* for the human: "that doesn't necessarily mean you need to be looking at the code all the time or be really in-depth inside it. It just needs like you to step up and consider that strategic programming is important" [1:09].

**Declaring the intent flips the agent.**
- "if you tell them that you care about the strategic layer, that you want the code base to improve over time, not get worse, then the agents will care about it, too. And what you'll notice is when you tell them to care about it, they're actually really good at it" [1:09].

**Skills are the lever.**
- "Skills like my improved code base architecture skill are really great when they're driven by agents, because they can just plow through and find candidates for module deepening and for improving test coverage" [1:40].
- "agents are not very good at thinking strategically, but that's because they're sort of incentivized not to. And when you tell them that that is what you care about, you're going to get a lot better" [1:40].

---

## Implications for Warden (where each idea lands)

| # | Pocock idea | Warden component | Where captured |
|---|---|---|---|
| 1 | Agents are tactically trained, strategically inert; the human must declare strategic intent | **Retro** prompt must state, explicitly: "you care about the codebase improving over time; prefer a small durable improvement (rule, lint, design note) over leaving the same class of problem to recur." This is the prompt-level expression of the correction ladder | FEATURES.md (Retro row); PROJECT.md Key Decisions; [OPEN-HARNESS.md](OPEN-HARNESS.md) (local-model risk) |
| 2 | "Tell them you care → they're actually really good at it" — the capability is latent, not absent | Validates that Warden's Retro can be **prompt-driven** (no new model capability needed) and works on local models, not just frontier ones | [OPEN-HARNESS.md](OPEN-HARNESS.md) |
| 3 | `improved-codebase-architecture` skill "plows through" finding module-deepening + test-coverage candidates | A ready-made, agent-driven **garden candidate generator**. Warden's garden report (v1.x) can run this skill in a read-only session and collect candidates; the maintainer gates which become PRs | FEATURES.md (garden row, v1.x); [OPEN-HARNESS.md](OPEN-HARNESS.md) |
| 4 | The strategic move is "annoying" and costs short-term velocity — harnesses avoid it by design | Warden's **human gate** is the structural place where the "annoying" strategic call is made: Retro proposes, the maintainer decides. This is the layer a fully-automated factory (Lloyd) lacks and Warden keeps on purpose | SUMMARY.md; PROJECT.md Key Decisions |
| 5 | Skills are the unit of reusable strategic intent | Reinforces the open-harness decision to keep Warden's specialists as **portable `SKILL.md` files** (triage-review wrapper, implement/rework, retro) that load in Bionic / opencode / pi alike | [OPEN-HARNESS.md](OPEN-HARNESS.md) |

---

## Open threads and limits

- **It is a heuristic, not evidence.** No benchmark or measurement is offered. Warden should treat "tell them to care → they do" as a *prompting hypothesis to validate in shadow mode* (does a local model given the strategic framing actually emit more durable-improvement candidates than one without it?), not as a law.
- **The "annoyance" is real and must be budgeted.** If Retro runs the module-deepening skill every week, it will surface candidates the maintainer does not want. Warden's existing caps (one rules PR/week, human gate) are the throttle; Pocock's point is that the *input* to those caps should be strategically framed, not tactically framed.
- **Local models amplify the gap.** Frontier models are at least exposed to long-horizon training signal; small local open models less so. The CARE framing is *more* load-bearing on a 7–32B local model than on a frontier one — see [OPEN-HARNESS.md](OPEN-HARNESS.md) for the model-routing consequence.
- **Same-week shorts point the same direction** ("/retro is a banger of a skill"; "STOP running your checks in harness hooks") — Pocock is consistently arguing that *durable, versioned* improvements (skills, rules) beat ephemeral in-context nudges. That is precisely Warden's correction ladder (design > lint > verification > prose).

---
*Talk research for: The Warden of the Gate — Researched 2026-11-14*
