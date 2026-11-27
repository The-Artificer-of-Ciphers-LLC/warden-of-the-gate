# Transcript: "Vibe Coding vs. Agentic Coding: Which Should You Use?", Grace Ableidinger (IBM Technology)

- **Video:** https://www.youtube.com/watch?v=h4tHDFCPmQE (IBM Technology channel), 8:37
- **Published:** 2026-11-23, per the video's description as mirrored by clipzag.com and feedmedata.ai (YouTube itself was not read from this session).
- **Copied:** 2026-11-27, from the video's captions through Exa's page reader on the video page. One copy; the caption text was not compared with a second service.
- **Timestamps:** the captions came without caption times. The section headings below are the chapter times and titles from the video's own description; where each chapter starts in the text is placed by matching the chapter title to the words, so the boundaries are approximate. Paragraph breaks and headings are added; the words are unchanged, caption errors included ("weakened projects" for "weekend projects", "Five coding" for "Vibe coding", "Encoding agents, contacts" for "In coding agents, context", "mash" for "match").

---

## [00:00] Define vibe coding vs. agentic coding

I'm sure you've heard the term vibe coding all the time. Ever since Andre Karpathy coined the term in early 2025, its definition has been a bit nebulous. In general, it carries the idea that AI turns non software developers into developers, and suddenly coding is quick and easy. But as we all know, it's a bit more nuanced than that. And just because an LLM is helping to write code doesn't necessarily mean it's vibe coding. I've talked to a lot of developers recently who are excited about the efficiency boosts they're getting from AI, but are worried about their code quality, the security, or even losing their skills as they rely too much on AI. So today, let's look at what vibe coding actually is. What changes when we move to agentic coding, and how to pick the right approach for the task in front of you?

## [01:23] Understand how vibe coding works

Vibe coding is generating software primarily through prompting and AI-generated code. The emphasis is on speed. You express what you want in natural language, the AI generates a draft, and then you iterate until you have a desired result. Karpathy describes it as fully giving into the vibes and pitched it for tasks like experimental, weakened projects, and for that exact use case, it's perfect.

## [01:51] Use vibe coding for rapid prototypes

Vibe coding is great for rapid prototyping, experimentation, demos and visualizing ideas. Someone with no coding background could build a working prototype in an afternoon.

## [02:12] Identify risks in AI-generated code

The trade off becomes evident when this code moves toward production. Because the focus is on speed and ease, there's often little to no reviewing or even understanding the code. I'm sure some of you have stumbled upon a repo that's obviously AI-generated with duplicate functions, oddly organized files, and convoluted fixes to a simple bug. AI is adaptable and great at giving you what you asked for, but not so good at having the same human discernment around code that the developer could provide. As AI-generated code gets put into production, that human piece around validation and review becomes crucial.

## [02:41] Build with agentic coding workflows

Agentic coding is where AI works hand in hand with a developer. This is beyond just generating code. A coding agent should be used as a tool. They can help understand an existing code base, plan changes, implement patterns, run tests, update documentation, and even work with development tools. What you'll notice is that an agentic coding, the AI isn't necessarily doing anything you couldn't do, it's just making it easier. Now, the best coding agents don't work alone. Larger tasks can be broken into smaller pieces and delegated to subagents. These are optimized for certain tasks and have scoped permissions. For example, some agent that runs your tests wouldn't have access to your GitHub.

## [03:38] Compare vibe and agentic coding side by side

So let's look at a vibe coding and an agentic coding workflow side by side to really illustrate the difference. Vibe coding is a condensed loop. You prompt, generate a response, and then iterate on that. You ask for what you want, keep prompting and often without even having to look at the code, AI gives you a somewhat satisfying result. Agentic coding is a little bit more involved. You want to understand the code, then make a plan, execute that plan, test it, and then validate. An agent takes a pass over your code. Helps you understand what's already there, what next steps might be, makes a change, checks it and then confirms that it did what you asked. Some of these steps could be developer or agent led, but the point is there's more human brainpower involved in agentic coding. Especially here at the understanding step and here at the validation step.

## [04:46] Give AI coding agents focused context

We talked a little earlier about this human discernment when it comes to code, but it's kind of an abstract concept. So what does it actually mean? LLMs operate on something called context, which is essentially the information provided to it at runtime that they base their answers on. Encoding agents, contacts could be files, tests, documentation, or even information in your prompt. But model attention is a finite budget. And more of this information doesn't always produce a better answer. In fact, the more context a model receives, the harder it can be for it to pick out what's important. It might be hard, for example, for an agent to map a complicated dependency or understand other devs implementation decisions across a huge code base. So the goal is focused context. Adding more human steps to the agentic pipeline can help focus the agent. This is also another justification to implement those subagents that we talked about a little bit earlier. A subagent can go down a rabbit hole exploring some niche corner of your code base, and then hand back a quick summary. That way, your main agent stays focused on planning and orchestration.

## [06:04] Secure agentic coding with guardrails

And finally, let's talk a little bit about the security that can come with agentic coding. The more powerful your agent, the more control you need. Coding agents could be able to read and write code, execute commands, and even use external tools. This makes them a lot more useful, and I'm not saying we should necessarily restrict that, but it does mean that their mistakes have the capacity to go a lot further. As agents gain more reach, agentic security becomes more important. This can look like testing, so you know that your changes worked. Governance, so humans signs off on any irreversible or potentially costly decisions. Observability, so you can see exactly what your agent did and why. Rollback, so any mistakes can be undone and guardrails so your agent stays on track and operates according to predefined rules. Many coding agents build this kind of stuff in, like asking for permission before running a command or requiring explicit connections to grant tool calling abilities.

## [07:17] Choose the right AI coding approach

So which is better? That's not really the right question. Different tasks need different levels of structure and autonomy instead. Ask yourself how much context, planning, validation, and autonomy does my task require for a quick bug fix? Testing out a new design or renaming variables. Five coding might be the right call, but for pushing net new features to production, touching any databases or payment systems, or doing large refactorings, you might want an agentic loop with you behind the wheel. Okay, so vibe coding is built through prompts and AI-generated code. Prompt. Generate. Iterate. Agentic coding goes a little bit further. We're going to understand, plan, execute, test and validate with subagents taking focused pieces of bigger tasks. As AI task grow, focused context matters more and more, and as agents get more autonomy, our security will matter more too. So testing, approvals, rollbacks and auditing. If you're worried about vibe coding, don't stop using AI. Just mash the appropriate task to the approach and stay the person who can explain the code. Ask me anything in the comments or let me know what you think about vibe coding versus agentic coding.

