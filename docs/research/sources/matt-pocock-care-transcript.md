# Transcript: "Tell your agents to CARE about the codebase" — Matt Pocock

**Source:** https://www.youtube.com/shorts/9uSygtI-6lw (YouTube Short, 2:06)
**Channel:** Matt Pocock (~416K subscribers; "We don't do vibe coding — this is a channel for real engineers")
**Published:** 2026-10-13
**Transcript method:** usetranscribe.io (machine-generated; the ai.engineer transcript API does not cover Shorts). Recognition errors remain; timestamps are the video's clock. Fetched 2026-11-14.

---

## Verbatim transcript (machine-generated)

**[0:00]**
I've talked before on these shorts about how agents are really good at tactical on the ground programming. They're really good at solving the problem that's in front of them, but they're really bad at strategic programming. Strategic programming is the parts of programming where you're thinking about the long view, where you are the general winning the war. And because agents are kind of reinforcement learning on tactical problems, on benchmarks, on Deep SWE, they're just not really trained or not really incentivized to think about long-term. An agent thinking long-term is kind of like that annoying colleague or the annoying dev who tells the PM, "No, we probably need to refactor before we do this because it's going to cost us velocity if we just keep on piling on mud onto our ball of mud." And because agents are trained to be generally useful, you know, for lots and lots of use cases, doesn't really make sense, even in the harness level, to push them towards this probably slightly more annoying behavior. And so, because of that, you need to be the one bearing the brunt of that. You need to be thinking strategically and pushing the agent towards more strategic improvements. You need to be the annoying one to say, "Okay, no, we might need to refactor here before we begin."

**[1:09]**
And that doesn't necessarily mean you need to be looking at the code all the time or be really in-depth inside it. It just needs like you to step up and consider that strategic programming is important. Because in these benchmarks, the agents learn that tactical programming is the only thing that matters. But if you tell them that you care about the strategic layer, that you want the code base to improve over time, not get worse, then the agents will care about it, too. And what you'll notice is when you tell them to care about it, they're actually really good at it.

**[1:40]**
Skills like my improved code base architecture skill are really great when they're driven by agents, because they can just plow through and find candidates for module deepening and for improving test coverage and all the cool stuff that you need when you've got a good code base. And so, yes, agents are not very good at thinking strategically, but that's because they're sort of incentivized not to. And when you tell them that that is what you care about, you're going to get a lot better.

*[ends]*

---

## Related same-week material (for context, not transcribed here)

- Short: "/retro is a banger of a skill"
- Short: "STOP running your checks in harness hooks"
- Full video: "mattpocock/skills: A complete AI Coding workflow, end-to-end" (17:17)
- Full video: "New Skills! v1.3 brings /pr, /implement-spec, and /retro"

**Note for the open-harness pivot:** the maintainer's Bionic environment already has Matt Pocock's skill library installed (grill-me, handoff, improve-codebase-architecture, code-review, tdd, triage, etc.), and Bionic consumes Claude Code–compatible `SKILL.md` files — so these skills transfer across the open harnesses Warden will target.
