# Talk Research: "All Code Is Slop (Except Mine)" — Lauren Tan, SpaceXSI

**Source:** AI Engineer CODE 2026, main stage, Nov 11, 2026 (talk at 1:01:02–1:18:36 of the livestream); re-uploaded to the AI Engineer YouTube channel Nov 14, 2026 (17:31).
- Conference recording: https://www.youtube.com/watch?v=ZZ19zhYnDKY
- Channel upload: https://www.youtube.com/watch?v=O_zcc6Xl12g
- Reading edition: https://ai.engineer/code/2026/talks/lauren-tan
- Full machine-generated transcript: [sources/lauren-tan-slop-transcript.md](sources/lauren-tan-slop-transcript.md) (downloaded 2026-11-14; recognition errors remain, timestamps are the conference recording's clock)

**Speaker:** Lauren Tan ("poteto"), Principal Engineer, SpaceXSI — Grok Bot team (x.com/poteto).
**Researched:** 2026-11-14.
**Confidence:** HIGH for what the talk claims (full transcript read directly). MEDIUM for external tool facts verified below. The team metrics are self-reported, not independently verified — treat them as directional evidence that the approach works at scale, not as a benchmark to hit.

---

## Why this talk matters to Warden

Warden is a trust machine: it exists so one maintainer can trust an AI loop with a busy repo. Tan's talk is the strongest public articulation of *how trust is actually built* — not with better prompts, but by moving corrections down a ladder from prose to executable constraints. It validates three things Warden already assumes (deterministic gates before AI, verification as the bulk of review effort, foundations before automation) and adds three things Warden does not yet have (a correction ladder for Retro, a comment-restrictive policy for Implement/Rework, and the "codebase as garden" principle).

---

## The thesis: trust, not volume

- Opening claim: she personally shipped **3,000 PRs to production** in the month before the talk [01:02:08]. "With agents anyone can now be a coding machine."
- The thesis [01:02:35]: "the job of a software engineer, the meta of being a software engineer, is figuring out how to maintain or even improve the quality of your code while massively increasing your productivity."
- She rejects "software factory" as the frame and prefers **trust** [01:02:54]: "Not blind trust, but investing in your agents environment so you can trust that your agents are going to do the right thing."
- Cost of getting there: **six months** of environment investment before she could ship thousands of PRs "a lot of them in my sleep" [01:03:09].

## The trust pyramid (four layers, strongest first)

Her "inverse pyramid" for where to spend time on the agent's environment [01:03:27]:

| Layer | What | Character |
|---|---|---|
| 1. Code itself | Good API design, architecture, refactoring | Deterministic — constrains what the agent can produce |
| 2. Static checks | Lint rules, type systems, compilers, tests | Deterministic — "force them to do the right thing by default" |
| 3. Verification | Runtime and formal verification | Evidence about behavior; "check whether or not the agent understood your goals and your intent" [01:03:56] |
| 4. Prose | Rules, skills, AGENTS.md | "A little bit of prose... things that require judgment" [01:04:12] |

Layers 1–2 together "constrain what agents can do and force them to do the right thing by default" [01:03:49]. The ordering is the point: **the strongest constraints live in code, not in instructions.**

## The garden: the codebase is the agent's largest input

- "Agents generate their outputs based on their inputs... your codebase is one of the largest inputs" [01:04:25].
- Scale shift: in 2024 she reviewed ~3 colleague PRs a day; today it is "more like 300" [01:05:04]. "Every engineer is now a team of hundreds or even thousands of agents and code is arriving so rapidly that it almost feels like a continuous stream" [01:05:12].
- Consequence: "any workarounds, anti-patterns, deprecated code is now likely to be just copied by the next agent since it looks like the established pattern" [01:05:54] — "like weeds or pests growing in your garden... they spread everywhere before you know it" [01:06:04].
- Therefore: "you want to make your codebase as pristine as possible so that agents are always copying the good stuff" [01:06:15]. The reading edition sharpens this: **cleaning up old examples is part of improving future output, not merely paying down historical debt.**

## Case studies: eliminating classes of mistakes

### Dune — "Next.js for Electron" with constraints baked in

Dune is the client framework she built for Grok Bot to implement "organic architecture" [01:06:24]. Technically unremarkable; the interesting part is "a lot of constraints and lint rules that we've encoded... a lot of the lessons that we've learned building desktop applications" [01:06:42].

Governing principle: **"anything that requires nuance to use well often leads to slop"** [01:06:52].

| Anti-pattern | Where it showed up | How the team eliminated it |
|---|---|---|
| React `useEffect` ("you need a PhD to use use effect") | Misused everywhere; agents are not good at nuance | **Banned in product code**, allowed only inside some Dune APIs [01:07:19]. "This problem has now been categorically eliminated and we never need to catch that during code review again" [01:07:28] |
| Main-thread code imported into the renderer (long tasks, jank) | Cursor, an Electron app [01:07:41] | Two top-level directories literally named `electron-renderer` and `electron-main`; cross-imports "forbidden or banned by our dependency graph analyzer and some lint rules" [01:07:59]. "These are simple lint rules to set up but it means one less thing that we need to review" [01:08:13] |
| Imperative timers (`setTimeout`, `requestAnimationFrame`, `requestIdleCallback`) as quick fixes | Cursor, patching an architecture clash between VS Code's imperative style and React's declarative style [01:08:49] | Banned outright in Grok Bot; enforced by lint rules with helpful error messages (below) [01:09:47] |
| Comments justifying the workarounds above | Cursor, where agents wrote comments explaining why each quick fix was fine [01:09:28] | **99% of comments banned** in Grok Bot [01:09:47] |

Note the timers case is a three-rung story: the *use* of timers was lint-bannable (shape), but the root cause was an architecture clash (design). Her team fixed the design so timers became unnecessary, then banned the pattern to stop new instances.

### Comments as permission slips

The talk's most surprising finding [01:08:23]: agents use markdown — documentation, code comments, rules, skills — "as a place to write down their justifications for not doing the right thing." They also **over-rotate**: "they'll over rotate on some small correction that you made, and they treat it like a hard rule that can never be broken ever again" [01:08:39].

The Cursor timers sequence, step by step [01:08:49–01:09:42]:
1. Agents reached for imperative timers as quick fixes, patching over the imperative/declarative architecture clash.
2. "Our choice of architecture actually made both the client and the agent performance much worse" [01:09:10] — timers rapidly created and destroyed cause major GC, which causes lag and jank.
3. Agents wrote comments explaining why each quick fix was justified — "before you know it, we had timers spreading everywhere and the performance of the app really suffered" [01:09:38].

Why comments fail as controls, in her words:
- They **go stale easily** [01:09:52].
- "Humans just really don't bother reading the comment slop anyway" [01:09:56].
- They "give an agent an escape hatch to justify not doing the right thing because it's hard" [01:09:59].
- "The worst part about comments though is that **they're not enforceable**" [01:10:07] — "what seems well-intentioned, like 'I'm going to tell the next agent not to do something', never ends up actually being anything that you can trust" [01:10:12].

The replacement [01:10:22]: "lint rules that give good and very helpful error messages telling the agent to **fix the root cause, the real problem**, rather than just patch around it."

### The correction principle (the talk's core rule)

> "Our general principle is that every time we correct our agents, it turns into one of these deterministic checks or we think about how to categorically eliminate that problem in the code through better API design, through better architecture." [01:10:36]

The reading edition states the decision order explicitly: **Before adding another instruction, ask whether the requirement can become a check. Before adding a check, ask whether better design can remove the invalid choice altogether.**

The end state she describes: "if you do this enough times, you'll find that you have just less things to look out for in code review. And at some point, you'll realize there's nothing left to review, and you can just let agents merge most of their own pull requests" [01:10:53].

## Verification: reviewing evidence, not diffs

" Our code review process has now really shrunk into looking at verification artifacts instead. So things like videos, screenshots, diagrams, formal verification" [01:11:16].

- **Runtime verification** = "giving your agent a way to run the code for itself and use debugging tools that human developers use as well, like the Chrome DevTools protocol" [01:11:28].
  - **Feature map**: "a site map of all of the features that are available in your application from the user's point of view" [01:11:45] — shared vocabulary, so "the thingy in the left sidebar" doesn't depend on guessing [01:11:56].
  - **Custom CLIs inside skills**: "agents can reuse the CLI and the driver every time which cuts down on token usage and is also testable" [01:12:03].
- **Formal verification** (explicitly experimental [01:12:49]):
  - **TLA+** model checking of major user flows, e.g. notifications across multiple devices and platforms [01:12:19].
  - **Lean** proofs for selected algorithms — their custom virtualization library, checked for flickering/jittering [01:12:34].
  - "We've already found quite a few bugs with formal verification. But it's certainly not a silver bullet and we're treating it as another tool, another layer in our agents environment" [01:12:46].
- **Property-based UI testing**: the library **Bombadil** — "this has also caught a few UI bugs for us already" [01:13:10].
- **State chart skill**: she built a "state chart" skill in her plugin (transcript: "PAC potato stack"; press coverage: Potato Stack / pstack) that visualizes state machines from the user's point of view — "much easier to review alongside the videos and screenshots" [01:14:28].

### Token economics: verification is eating the budget

- A tweet from an engineer named **Cindy** (around May 2026): she couldn't trust her agents because subtle bugs were getting merged; what was missing was the verification process. Six months later: **70% of her daily tokens go into verification** [01:13:29].
- Tan: "that tracks with what I see as well, that most of my token usage goes to verification" [01:13:42].
- The economic argument [01:13:46]: none of these techniques are new — "these are just good software engineering tools, but ones that might have been prohibitively expensive to use before as they were hard to understand or write or maintain. But agents drastically cut this cost down." Hence: "we're entering a **golden age of software testing and verification** because agents let us test everything to a much greater degree than used to be economical" [01:14:08].
- Formal verification doubles as an intent check: it "can also help you better reason about how your product should work and whether your agents really understand your intent and goals" [01:14:18].

## The scoreboard (self-reported)

| Metric | Value |
|---|---|
| Grok Bot team PRs shipped to production, month before talk (Oct 2026) | **11,000** [01:15:02] |
| Tan's personal PRs, the month before that | 3,000 [01:02:08] |
| Stable client releases | ~1 per day [01:15:14] |
| Distinct contributors in October (many casual/drive-by) | ~227 [01:15:30] |
| Share of PRs reverted | **~0.5%**, lower on a relative basis and steady [01:15:47] |
| Client performance (startup, typing, opening/switching chats) | Improved on multiple dimensions vs launch, despite the Electron ceiling [01:15:56] |

The reading edition cautions correctly: these are reported outcomes, not a controlled experiment proving every repo improves as merge volume rises. **The transferable part is the order of operations, not the numbers.**

## Order of operations: foundations before factories

> "Before you jump into building out a software factory and automating everything that you can, whenever you correct your agent, try and do it by improving your codebase first. Start with a lint rule to prevent new occurrences of anti-patterns and then clean up those old patterns as well, and then make sure that your verification story is really strong." [01:16:43]

> "A lot of this work is a prerequisite to automation anyway. And if your inner coding loop produces slop, then automating that loop just produces more slop and you need to throw more and more tokens at the problem, which we all know is very expensive." [01:16:58]

The outer loop she runs once foundations are in place [01:17:45]: whenever a new release is cut, Grok Bot spins up a Cursor project that **fuzzes the entire application** by using it like a real user, opens fixed PRs for each bug found, and **automerges them** — "because our codebase is good enough that pull requests tend to just be good by default. And most product code that we land no longer really requires deep human review" [01:18:08].

Closing line [01:18:23]: "when you have solid foundations and good organic architecture, you can turn slop into gold."

---

## External facts verified during this research

- **Bombadil** — [github.com/antithesishq/bombadil](https://github.com/antithesishq/bombadil): property-based testing for web and terminal UIs, by Oskar Wickström at Antithesis (announced Jan 2026). Rust binary driving a Chromium-based browser; TypeScript spec DSL based on linear temporal logic; successor to Quickstrom (which found bugs in more than half of TodoMVC apps). MIT. Runs locally, in CI, or inside Antithesis's deterministic hypervisor for perfect reproductions.
- **Dune** — internal to SpaceXSI Grok Bot, not public. poteto's Aug 2026 launch tweet describes it as "a new agent friendly framework... designed for agents, even the ones who have very little context, to write high quality code by default." The constraint *patterns* (banned APIs, directory boundaries, comment policy) are transferable even though the framework is not.
- **Biome v2.6** (Oct 15, 2026) — [biomejs.dev/blog/biome-v2-6](https://biomejs.dev/blog/biome-v2-6): **JavaScript plugins are now a developer preview** — custom lint rules written in JS/TS via `defineRule` + AST queries, loaded from `biome.json`, distributable as npm packages via `biome-manifest.json`. The v2.6 blog example is a rule banning `setTimeout`/`setInterval` — exactly Tan's pattern. Relevant because Warden's stack (STACK.md) uses Biome; see FRAMEWORK-CORRECTIONS.md for the mechanics.
- **ESLint `no-restricted-syntax`** — [eslint.org](https://eslint.org/docs/latest/rules/no-restricted-syntax): AST selectors with custom messages, e.g. `CallExpression[callee.name='setTimeout']` — the classic way to ban a pattern with a helpful error.
- **dependency-cruiser** — [github.com/sverweij/dependency-cruiser](https://github.com/sverweij/dependency-cruiser): declarative import-boundary rules for JS/TS — the tool class behind Tan's `electron-main`/`electron-renderer` boundary.

---

## Implications for Warden (where each idea lands)

| # | Talk idea | Warden component | Where captured |
|---|---|---|---|
| 1 | Trust pyramid: executable constraints before prose | Deterministic gates + risk tiering already run *before* AI review; the talk validates that ordering and adds the principle that REVIEW.md (prose) is the *weakest* rung, not the default | SUMMARY.md; FRAMEWORK-CORRECTIONS.md |
| 2 | Correction principle (every correction → check or design) | **Retro task** (Phase 7): the ladder is Retro's decision procedure — design > lint > verification > prose | FRAMEWORK-CORRECTIONS.md; FEATURES.md Retro row |
| 3 | Comments as permission slips / not enforceable | **Implement/Rework sessions** (Phase 6): new pitfall — agent-justified workarounds spread at bot velocity; comment-restrictive prompt policy + lint rules with root-cause messages | PITFALLS.md P11; FRAMEWORK-CORRECTIONS.md |
| 4 | Codebase as garden (pristine inputs) | Warden's own PRs must not plant weeds: repo lint runs in preflight; Retro also cleans up *old* pattern instances ("clean up those old patterns as well"); v1.x "garden" report | FEATURES.md (deferred); PITFALLS.md P11 |
| 5 | Verification eats the token budget (70%) | Verifier pass deserves the bulk of review session budget; decision card carries verification evidence (failing-first red run, test output) | SUMMARY.md Phase 2/3 notes; FRAMEWORK-CORRECTIONS.md |
| 6 | Feature map (shared vocabulary of user-facing features) | For GSD Core (a CLI/agent tool) the analog is a command/surface map for Implement sessions — deferred, v1.x | FEATURES.md (deferred) |
| 7 | State chart skill (visualize state machines from the user's POV) | Warden *is* a state machine: bucket report / decision card could render where an item sits in the label graph — nice-to-have, v1.x | FEATURES.md (deferred) |
| 8 | Foundations before factory; outer loop automerges fuzz fixes | Warden v1 **never merges** — the human gate is a *trust dial*. The framework allows per-tier autonomy relaxation (e.g. lint-clean + test-green + small-diff bot PRs get a lighter gate) only after foundations are proven; off by default | FRAMEWORK-CORRECTIONS.md (trust dial); PROJECT.md Key Decisions |
| 9 | Revert rate ~0.5% at 11,000 PRs/month | External data point for what "good foundations" looks like at volume; Warden already tracks escaped defects traced to loop PRs — add "reverted bot PRs" as the sibling metric | SUMMARY.md (success-metric note) |

## Open threads and how they were resolved

- **How do you "lint" something vs test it?** → Answered in [FRAMEWORK-CORRECTIONS.md](FRAMEWORK-CORRECTIONS.md): lint asserts *structural* invariants over source (no execution, whole tree, deterministic); tests assert *behavioral* invariants under conditions (execution required, flake risk). Decision heuristics and the two-severity trick for legacy debt are there.
- **How do you lint instead of comment for patterns/anti-patterns?** → Answered in FRAMEWORK-CORRECTIONS.md: six-step procedure (find pattern → write structural rule → design the error message as problem/why/fix-pointer → delete the justifying comments → verify with a tempting fixture → record in Retro), grounded in Biome v2.6 JS plugins, ESLint `no-restricted-syntax`, and dependency-cruiser.
- **Dune** — not public; patterns transfer, framework doesn't. No further research possible or needed.
- **Cindy** — an engineer Tan follows; the May 2026 tweet was not independently located. The claim (70% of tokens → verification) is second-hand via the talk; directionally consistent with Tan's own usage.
- **TLA+/Lean/Bombadil for Warden** — out of scope for v1 (GSD Core is a CLI tool; these are UI/flow-heavy techniques). Recorded in the framework as rung-2 options for repos that have them.

---
*Talk research for: The Warden of the Gate — Researched 2026-11-14*
