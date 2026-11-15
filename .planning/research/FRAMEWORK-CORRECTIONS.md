# Framework: The Correction Ladder

**Purpose:** A decision procedure for where a correction should land, so that recurring agent mistakes stop being re-caught by review. Built from Tan's "All Code Is Slop (Except Mine)" talk ([TALK-SLOP.md](TALK-SLOP.md)) plus tooling research (Biome v2.6, ESLint, dependency-cruiser). Applies to Warden's Retro task (Phase 7), Implement/Rework prompts (Phase 6), deterministic gates (Phase 3), and to any repo that adopts the plugin.

**The one rule** (Tan, [01:10:36]): *every time you correct an agent, turn the correction into a deterministic check — or eliminate the problem categorically through better design.* Stated as decision order: **before adding another instruction, ask whether the requirement can become a check; before adding a check, ask whether better design can remove the invalid choice altogether.**

---

## The ladder (strongest rung first)

| Rung | Name | What it does | Enforceability |
|---|---|---|---|
| 0 | **Design** | Makes the mistake *unrepresentable*, or makes the right thing the only easy path (API shape, architecture, directory structure) | The invalid choice does not exist; nothing to enforce |
| 1 | **Static checks** | Types/compilers (contract) and lint rules (shape): the pattern must not appear, or only in allowlisted places | Deterministic CI gate; runs on every file including unchanged ones |
| 2 | **Dynamic verification** | Tests, runtime verification, property-based and formal methods: behavior under conditions must hold | CI gate; execution required; can be flaky or partial |
| 3 | **Prose** | REVIEW.md / AGENTS.md lines for judgment that cannot be encoded | Weakest: agents ignore it, over-rotate on it, and use it to *justify* not doing the right thing |

Tan's pyramid puts rungs 0–1 (deterministic) above rung 2 (verification evidence) above rung 3 (prose). The ladder is a *demotion* procedure: every correction should be pushed to the strongest rung that can express it, and only what genuinely requires judgment stays in prose.

**Empirical backing (Hughes 2010, ~13,000 measured projects):** the ladder's ordering matches industrial measurements of defect-removal efficiency, not just one team's 2026 experience. Automated static analysis removes ~87% of coding defects; formal code/design inspections average >65% (up to 88%) — roughly *twice* the efficiency of testing, where most forms are <35% and cumulative seldom tops 80%. "The bottom line is that testing, by itself, is insufficient to achieve professional levels of quality" (p. 618). In his 200-item ranking, static analysis (#6) and code inspections (#7) are top-7 best practices, while **manual testing is *neutral*** (0.17) — automation is what counts. The origin→discovery table (p. 127) adds the rule that matters most for Warden: **requirements/spec defects can only be caught pre-code** ("requirements problems cannot be found and removed by testing", p. 126) — which is why spec verification (below) sits *upstream* of the ladder. Full data: [BOOK-SE-BEST-PRACTICES.md](BOOK-SE-BEST-PRACTICES.md).

## Decision procedure for a recurring mistake M

1. **Can the API or architecture change so M is unrepresentable — or so the right thing is the only easy path?**
   → Rung 0. Tan's `useEffect` case: the fix was not "tell agents to use useEffect carefully" but *ban it in product code and provide the declarative alternative inside Dune*. The timers case: fix the imperative/declarative architecture clash so timers stop being tempting, then ban them.
2. **Otherwise: is M expressible as a structural rule** — a banned symbol/call, an import boundary, a file location, a syntactic pattern?
   → Rung 1 (lint). See "Lint vs test" below for the exact boundary.
3. **Otherwise: is M about behavior under conditions** — it compiles and looks right, but leaks, races, janks, or breaks an invariant at runtime?
   → Rung 2 (test / verification). Pick the cheapest method that expresses the property: unit test → integration/runtime check → property-based (e.g. Bombadil for UIs) → formal (TLA+/Lean, experimental).
4. **Only if M requires judgment that cannot be encoded** (taste, product intent, trade-off calls):
   → Rung 3 (one line in REVIEW.md). Keep prose lines reviewable and few; Retro reports how many there are.

If a mistake sits on two rungs at once (the timers case: shape *and* behavior), do both — rung 0 or 1 to stop new instances, rung 2 to catch what slips through and the legacy — but record which rung *owns* the correction so Retro doesn't double-track it.

---

## Lint vs test: how to tell which tool

The talk groups lint and tests in the same "deterministic" layer, but they catch different things. The distinction:

| | **Lint (static)** | **Test (dynamic)** |
|---|---|---|
| Asserts | A *structural* invariant over source: pattern X does not appear (or appears only in allowlisted paths) | A *behavioral* invariant over execution: under conditions C, outcome O / property P holds |
| Needs execution? | No — parses the source (CST/AST) | Yes — runs the code |
| Cost per run | Milliseconds; whole tree, every commit | Seconds to minutes; only what is exercised |
| Catches | *Existence* of a pattern: banned API, cross-boundary import, structural smell | *Consequence*: leaks, races, timing, GC pressure, state transitions |
| Covers unchanged code? | Yes — runs on everything | No — only what tests touch |
| Determinism | Exact; no flake | Can be flaky, environment-dependent |
| Failure mode to watch | Too-broad ban → false positives (fix with allowlists, e.g. `useEffect` allowed inside Dune APIs) | Coverage gaps; a pattern can be absent yet its consequence persist via other code |
| Talk examples | Ban `setTimeout` in product code; ban imports across the `electron-main`/`electron-renderer` boundary | Property-based UI testing (Bombadil); TLA+ model check of the notification flow; Lean proof for the virtualization library |

**Decision heuristics:**
- If you can write it as "**no X in path P**" or "**X only allowed in allowlist A**" → **lint**.
- If the mistake is "X exists but *misbehaves* under conditions" → **test**.
- If the pattern is a *patch over a design flaw* (the timers case) → **fix the design first** (rung 0), then ban the pattern (rung 1) so it cannot come back, and let tests verify the behavior that motivated the ban (rung 2).
- If you can express the constraint as a **type** (branded types, module structure, path aliases that make the wrong import not resolve) → prefer that: it is lint with compiler-grade precision, and the error message is written for you.
- **Both apply** (new instances vs legacy): use the two-severity trick — register the same rule twice, `error` for new code and `warn` on a known-legacy file list that is paid down gradually. (Pattern from the vibe-coding-toolkit quality-gates doc; works in ESLint by exporting one rule function under two IDs.)

**What lint cannot do:** see consequences. A timer ban stops new timers; it does not prove the GC-jank is gone — that needs a test or runtime measurement. Conversely, **what tests cannot do:** stop the *next* agent from writing the pattern in a file no test covers. Lint is the only rung that polices the whole tree for free, which is why Tan calls these "simple lint rules to set up" that each remove one thing from review forever.

---

## Lint instead of comment: the mechanics

**The failure mode** (Tan's Cursor timers sequence): an agent writes a workaround, then writes a *comment justifying it*. The next agent reads the comment, treats the workaround as intentional and established, and copies it. The pattern spreads; performance suffers. Comments fail as controls because they **go stale**, **humans don't read them**, they give agents **an escape hatch to justify not doing the right thing**, and above all **they are not enforceable** — "I'm going to tell the next agent not to do X" never becomes something you can trust.

**Procedure — converting a justified workaround into a lint rule:**

1. **Find the pattern.** Grep for the workaround and its justifying comments. Count instances; note which files are legacy vs new growth.
2. **Write a structural rule** matching the pattern:
   - **Biome** (Warden's stack): v2.6+ JavaScript plugins — `defineRule` with AST queries, e.g. ban `CallExpression` whose callee is `setTimeout`/`setInterval`/`requestAnimationFrame` outside an allowlisted directory. The v2.6 release example is exactly this ban; plugins load from `biome.json` and can be distributed as an npm package via `biome-manifest.json`. *(Developer preview — verify stability in the phase that uses it.)*
   - **ESLint** (adopters on ESLint): `no-restricted-syntax` with AST selectors + custom messages, e.g. `CallExpression[callee.name='setTimeout']`; import boundaries via `eslint-plugin-import` (`no-restricted-paths`) or **dependency-cruiser** (declarative boundary rules — the tool class behind Tan's `electron-main`/`electron-renderer` split).
   - **Types**: where the constraint is a contract, encode it in types instead (path aliases so the wrong import doesn't resolve; branded types for values that must be constructed deliberately).
3. **Design the error message** — this is where most rules fail, and it is Tan's explicit point: messages must tell the agent **to fix the root cause, not patch around it**. Three parts, in order:
   1. *What you did wrong* — name the pattern precisely.
   2. *Why it is banned* — one line, stating the root cause (not a restatement of the rule).
   3. *What to do instead* — point at the actual alternative: an import path, an API name, a doc link.

   Example (timers): `no-raw-timers: raw timers patch over an imperative/declarative architecture clash and cause GC jank. Use the declarative scheduler: import { schedule } from '@repo/schedule'.`
4. **Delete or rewrite the justifying comments.** The comment was a permission slip; once the rule exists, either fix the workaround at its root or remove it. Do not leave "this is banned by lint" comments — the rule says that better.
5. **Verify with a tempting fixture.** Run an agent session against code that tempts the pattern (a legacy file full of it, a task where the workaround is the path of least resistance). Confirm it hits the rule and fixes the root cause rather than suppressing or commenting over the error. This generalizes Warden's red-team suite: injection tests for safety, temptation tests for quality.
6. **Record it in Retro.** The rule's origin (which finding/comment triggered it) goes into the rules PR, so REVIEW.md does *not* also carry a prose line for the same thing. One correction, one rung.

**Comment policy for agent-written code** (Grokbot bans 99% of comments; Warden adopts a narrower version for its own sessions):
- Implement/Rework session prompts should state: *do not add comments that justify a workaround. If you cannot fix the root cause, stop and report it as an open finding for the human gate — do not comment over it.*
- Allowed: comments stating a non-obvious invariant, or citing an issue/ADR. Enforceable by convention: a lint rule for `TODO`/`FIXME` without an issue link.
- Rationale to include in the prompt: *comments are not enforceable and become permission slips for future agents; a helpful lint error or a design change is the durable fix.*

---

## Spec verification (Kotyal): the rung below the spec

The ladder handles mistakes in *code*. A different class of bug lives in the *spec*: rules that contradict each other or leave gaps, which an agent resolves by guessing — and the guess becomes a silent product bug. Kotyal (AWS, Nov 2026; [TALK-SPEC-BUGS.md](TALK-SPEC-BUGS.md)) shows the check that catches this *before* any code is written: LLM refines wording → formalize to SMT formulas → SAT/SMT solver (valid/invalid) → on ambiguity, sample the translation 7–10× and cluster by logical equivalence → accept / ask the human to disambiguate ("remove the record": delete vs hide) / **abstain from implementing**. His division of labor — "The LLM translates, the solver checks and the human decides" [07:18] — is the same philosophy as "AI proposes, scripts dispose" plus a human gate.

This is not a new ladder rung; it is an **upstream complement**: the spec is the input to Implement, and Hughes measured that requirements defects are the one class no downstream method (lint, test, review) can ever catch. Placement in Warden:

- **v1 (prompt-level, no solver):** the Implement prompt requires the agent to *state its interpretation* of each ambiguous rule in the issue spec. If two plausible readings exist, it reports the ambiguity as an **open finding for the human gate** (finding types: `spec-conflict`, `spec-gap`) and implements neither guess — the same "abstain rather than comment over it" discipline as P11. A cheap heuristic from the talk: ask for 3 restatements of a key rule; disagreement between samplings = ambiguity flag.
- **v1.x (formal):** a deterministic/semi-deterministic spec check in Implement preflight — SMT/solver-based contradiction and gap detection on the issue's acceptance criteria (repro steps + expected behavior). Triage's root-cause output is Warden's de-facto spec for Implement, so the same check can run on it at triage time. Spike before building: natural-language→SMT formalization is immature (Kotyal: "thin evidence right now"), and only rule-set-shaped specs are tractable.

---

## Where Warden applies the ladder

| Warden component | Application of the framework |
|---|---|
| **Retro** (Phase 7) | The ladder *is* Retro's decision procedure. Input: maintainer review comments + recurring findings (from the ledger). For each, Retro proposes the strongest rung: design-change PR > lint rule with root-cause message > test/verification PR > REVIEW.md line. The weekly rules PR shows which rung each rule landed on, the running rule count, and conflicts (already in the plan) — plus a section for *demotions*: prose lines that have since become checks. **Input set grows in v1.x (Lloyd's self-improvement loop, [TALK-FACTORY.md](TALK-FACTORY.md)):** Warden's own session traces (failure modes, rework rounds, verifier disagreements) and LLM-judged run scores — safe as Retro input because they are App-authored data, never contributor text. Lloyd's loop (store runs → score → aggregate patterns → PRs to the factory definition) is exactly Retro at team scale; Warden's human gate is the layer Lloyd admits he lacks. |
| **Deterministic gates** (Phase 3) | The repo's own lint/typecheck is a gate *before* any AI review — the talk validates this ordering: do not spend tokens reviewing what static checks already reject. A PR that fails the repo's lint gets a short "fix CI first" comment with no AI review (already planned; the talk is the citation). Hughes adds the industrial economics: "Most projects are on schedule and within budget until testing starts, at which time excessive defects stretch out testing by several hundred percent" (p. 518) — pre-test gates are where the schedule is saved or lost. |
| **Implement/Rework prompts** (Phase 6) | The comment policy above, plus: *when you find yourself deviating from a repo convention, that deviation is reported as an open finding for the gate — never commented over.* Rework may only touch named findings, so a "justified workaround" cannot sneak in as collateral. |
| **Verifier pass** (Phase 3) | Verification economics: Tan reports ~70% of daily tokens go to verification. The verifier (re-deriving each finding against code) deserves the bulk of review session budget; specialists get less. This is a budget-allocation input for Phase 3 tuning, not a new feature. Kotyal's cited stat — "60–90% of valid code is still wrong after it writes it" [01:52] — reinforces that the verifier + human gate are *necessary*, not optional: code that compiles and passes its own tests is frequently still wrong. |
| **Decision card** (Phase 4) | Carries verification *evidence*, not just findings: the failing-first red run, test output, and (for UI repos, v1.x) screenshots/video. Mirrors Tan's "review has shrunk into looking at verification artifacts." |
| **Codebase as garden** (ongoing) | Warden's own PRs must not plant weeds: preflight runs the repo lint *including rules Retro added*; a finding that "the codebase contains N instances of pattern X" is actionable work, not just a note. v1.x: a weekly "garden" report listing deprecated/anti-pattern instances, oldest first — Tan: cleaning up old examples is part of improving future output. |
| **Trust dial** (v2+ consideration) | Tan's end state — automerging fuzz-fix PRs because "PRs tend to just be good by default" — rests on months of inner-loop investment. Warden v1 never merges (PRD non-goal). The framework's extension: make gate depth *per-tier and config-driven* so that, once foundations are proven (lint clean + tests green + small diff + high agreement history), low-tier bot PRs can get a lighter gate. Off by default; the human merge button stays for everything in v1. |

## What this does NOT mean

- **Not "ban all comments."** The talk's lesson is narrower: *an explanation of a known-bad pattern does not prevent another instance.* Documentation that explains why the design is this way (ADR-style, in docs) is fine; comments justifying workarounds are the problem.
- **Not "formal verification everywhere."** Tan is explicit: experimental, another layer, not a silver bullet. For Warden's first repo (a CLI tool) rung 2 means the configured test command and preflight; TLA+/Lean/Bombadil are options for repos that have flows or UIs worth it.
- **Not "automerge now."** The outer loop (fuzz → fix → automerge) is the *reward* for foundations, not a substitute. "If your inner coding loop produces slop, then automating that loop just produces more slop."
- **Not a replacement for the human gate in v1.** The ladder reduces what reaches the gate; it does not remove the gate.

---
*Framework for: The Warden of the Gate — built 2026-11-14 from TALK-SLOP.md + tooling research*
