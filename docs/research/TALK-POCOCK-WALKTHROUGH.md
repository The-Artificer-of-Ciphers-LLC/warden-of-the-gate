# Talk Research: "Watch me ship a 21,000-line feature with mattpocock/skills" — Matt Pocock

**Source:** YouTube, about 70 minutes (4,170 s per the player metadata); the page showed "4h ago" when read on 2026-11-18.
- Video: https://www.youtube.com/watch?v=jVBlkOF8sHk
- Channel: Matt Pocock (~445K subscribers). Skills repo: https://github.com/mattpocock/skills (MIT; ~327K stars and pushed 2026-11-18 per the GitHub API when checked).
- **Transcript:** read in full 2026-11-18 from the YouTube transcript panel (machine-generated; recognition errors remain, timestamps are the video's clock). Unlike earlier notes, the full transcript is **not archived** under `sources/`: it is a third party's copyrighted speech and this note carries paraphrase and timestamps instead. Re-read it from the video link above.
- **Primary-source check (done 2026-11-18):** the skills named in the talk were fetched from the repo through the GitHub API: `retro`, `pr`, `triage`, `implement-spec`, and the in-progress `software-factory` skill (paths under `skills/engineering/` and `skills/in-progress/`).

**Researched:** 2026-11-18.
**Confidence:** HIGH for what the talk claims and what the skills contain. LOW as evidence of results: it is one author's self-reported demo on his own single-user personal app, with no measurements, no failure rate and no baseline. The PR size is stated inconsistently (title and PR page: about 21,000 lines added; narration: "25,000"). Treat it as a practitioner workflow reference, not an empirical study.

---

## What is going on

Pocock builds one feature (an in-place diagram editor inside his thumbnail creator) end to end with his own skills, in Claude Code (Opus 5.5, medium effort), and narrates why he does each step. The sequence:

1. **Choose a skill by expected diff size** [3:08]: a small diff is one-shot; a large one starts with a *grilling* session; one that outgrows that escalates to a multi-session "wayfinder".
2. **Grill with docs** [4:42–35:00]: an interactive Q&A in which the agent asks, he answers (dictated), and the agent updates a project **glossary** and writes **ADRs** as decisions land. He prompts with the *why*, not the *what* [5:05–6:06]; he stays in charge and may stop any time or force one-question-at-a-time [14:01–16:04].
3. **Prototype several UI variants in the background** while grilling continues [13:00, 33:13]; review, drop variants, iterate.
4. **Write the spec and tickets** [42:28]: a GitHub issue (about 47 user stories) plus sub-issues with blocked-by edges, so tickets can run in parallel.
5. **Compact, then implement AFK** [46:28]: a skill runs the ticket graph with fresh-context sub-agents on one integration branch, then an agent review and a coding-standards check. Result: one very large PR.
6. **Split into stacked PRs** [48:43]: seven small PRs, ordered as two-way doors with a feature flag, ending in the one-way door.
7. **Human review of the stack** [51:30]: he reviews every line only for the demo, and says mandatory review is for the one-way-door PR (an additive database migration); the rest are non-blocking. Two-way-door PRs auto-merge once CI passes.
8. **Retro** [57:50]: an agent reads the ~30 saved session transcripts plus his 12 review comments, and returns a ranked list of improvements; he files about 20 issues from it.
9. **Comment audit** [1:04:16]: asked to be more aggressive, the agent classifies roughly 2,000 lines of comments (about 940 deletable; others become workarounds to redesign, tests or ADRs).

His closing claim [1:08:34]: the human adds the most value at two points, early **alignment** (grilling/prototype) and late **standards enforcement** (review and retro).

---

## What it teaches that matters to Warden

### 1. Retro is validated, with a concrete method and concrete outputs
- Retro = read session transcripts + human review comments from disk/GitHub CLI, find the root cause, propose environment changes [57:50–1:04:00]. The retro **skill itself** (primary source) says mechanical violations get a **deterministic check** (custom lint rule, hook, CI job) "full stop", reserving written standards for judgement calls, and it names categories to inspect: navigation, automated checks, coding standards, global steering files, tool economy, no-op instructions, information access.
- The finding that all 12 review comments shared one root cause (nothing in written standards covered them, and the existing code did the opposite, in "thousands" of places [1:00:00]) is the Tan "codebase is the largest input" point with a number attached. It supports Warden's garden report.
- **Ratchets:** he asks for deterministic rules that are not imposed on day one but tightened over time [55:06] (the retro counted about 2,000 existing violations for one banned pattern, so an immediate ban was not viable). **New to our docs:** no file under `docs/` mentions ratcheting, so the correction ladder (design > lint > verification > prose, from the Tan note) currently has no answer for "the rule is right but the repo already violates it thousands of times".
- Skill defects found by retro become **issues on the skills repo** [1:02:13]: the factory's own prompts are improved through the same issue pipeline. Warden's Retro proposes `REVIEW.md`/rule changes; this adds "file an issue against the factory's own prompts/config".

### 2. The comment finding corroborates Pitfall 11 and adds a metric and a policy shape
- Measured by the agent: about 12% of the repo is comments but about 18–20% of the new feature [1:01:26]. Comment density is a cheap, deterministic **drift metric** for Retro/garden.
- Framing [1:05:00]: a comment next to a workaround is a licence to keep the workaround. His audit buckets: delete, redesign the workaround, promote to an ADR, move into a test name [1:05:46–1:07:48]. A phased ban by folder is proposed, not a global ban.
- Agents also leave comments written for their own future sessions [57:50], which then live forever.

### 3. Reversibility as a gate dimension (new to our design)
- His `pr` skill (primary source) requires every PR description to state **one-way or two-way door**: cheap to roll back = lower risk; destructive or hard-to-reverse = one-way. Merge policy followed the door type: automerge on CI for two-way, mandatory human review only for the migration.
- Warden's PRD already separates risk from severity and lists migrations and blast radius (PRD §4/§5), (see the risk and design sections of the PRD) but has no explicit **reversibility** field. A recorded door type (with a floor: anything touching data, authority or external services is one-way) would give the tiered-autonomy gates (ADR 0008) a simple, explainable input. *Proposed, not decided.*

### 4. Session scope and context: useful, but his numbers are opinion and moving
- "Smart zone / dumb zone" [40:15–42:00]: quality degrades as the window fills (about 150K tokens is his cited rule of thumb, attributed to another practitioner); he says current models are **less about hallucination and more about worse output plus cost**, and that cached tokens are re-billed at large sizes. He prefers a fresh sub-agent with one narrow problem over reusing a deep context.
- Compaction is called safe when a conversation has just been turned into a durable document (spec, glossary, issues) [46:28].
- **For Warden:** the principle (one ticket per session, durable artifacts, fresh context per task) matches our bounded-run design. The **numbers do not transfer**: our models are local, with far smaller practical budgets (ADR 0007). Do not hard-code a token threshold; measure per model (consistent with Lloyd's "measure on your own data").

### 5. Decision-space reduction
- "The more decisions you give it, the more likely it is to choose a bad one" [45:03]. Prototype + glossary + spec + tickets are all ways to remove choices before the AFK run. Warden's structured output, deterministic gates and approved feature design already do this; the talk supports requiring a **prototype or accepted design reference** for large feature Implement work.
- A retro finding to heed: the implementer **copied the throwaway prototype** instead of reimplementing it [1:02:05], which led him to a skill fix. Warden's Implement prompt should say prototypes are references for behavior, not code to paste.

### 6. Review of very large diffs does not scale
- His own code-review skill could not cover the 21K-line diff with one agent, and per-ticket review was "extraordinarily slow" [1:02:28]. His mitigation is to split into stacked, individually reviewable PRs. For Warden, whose reviewer is a local model with a bounded prompt (about 4K tokens measured in ADR 0007), this is the strongest reason to **cap reviewable diff size** and route oversized PRs to "split first" rather than attempt a review.

### 7. His in-progress `software-factory` skill is a close external design check
It defines a factory as tasks triggered by tickets, PRs and schedules, run on disposable runners, with the **ticket tracker as the human interface** and a rule that **a run never waits for a human**: the human's later change retriggers a run. The design discipline matches Warden's:
- "**Start slow**": every trigger is an accelerator, so use three brakes (automated checks, a separate cold-read automated review, human review that feeds new checks); add one automated trigger at a time, throttled, with human review on every PR; cap loops at a few tries before a human. This lines up with Warden's shadow-first rollout, 3-round caps and human merge gate.
- Five questions per task: trigger, reads/writes, what it triggers next, where a human re-enters, and **what stops two runs doing the same work**. The last is our serialized writer and lease (ADR 0012). Each ticket source also needs an answer to "what stops it filing the same ticket twice?" which is our idempotent opid and dedupe design.
- His `triage` skill (primary source) uses the same shape as Warden: one category role plus one state role per item, `needs-info` returning to `needs-triage` on reply, a PR treated as an issue with attached code, maintainer override at any time, and a mandatory AI-generated disclaimer on every bot comment. Our contributor-message rules (ADR 0003) already distinguish AI-assisted from deterministic messages; the disclaimer rule is a cheap, consistent precedent.
- A real difference: his factory is cloud-runner based and assumes a hosted orchestrator; Warden is local-model and Actions-bookkeeping. Nothing in the skill contradicts that split.

---

## Caveats: where the talk should NOT move our assumptions

- **Single-user personal software.** He merges first and reviews afterward "because I'm the only user" [52:00] and says he would clone and run it for a production system. Warden serves repositories with contributors; the human merge gate for all PRs in v1 stays.
- **Frontier model with large context, parallel sub-agents, auto-merge.** Warden v1 caps factory implementation PRs at 1 and uses local models. His throughput claims are not a target.
- **Self-reported and unmeasured.** No defect, revert or cost data. It is not evidence that the process is *safe*, only that it is *workable for him*.
- **Skills drift.** The skills repo changes daily (and `software-factory` is marked in-progress). Re-check before citing specifics in an ADR.
- **Provenance in this environment.** Several skills installed here share names with his (`prototype`, `grilling`, `tdd`, `code-review`, `domain-modeling`). Their provenance was not verified for this note, and nothing in Warden depends on them.

---

## Assumption review (proposed changes; none applied to the PRD or ADRs)

| Assumption in our docs | Effect | Proposed action (owner decides) |
|---|---|---|
| Retro turns corrections into checks (design > lint > verification > prose); P11 comments | **Strengthened**, with a method and a metric | Add comment-density and "comments next to workarounds" to the Retro/garden report inputs; add a **ratchet** concept (rule enforced only on new or changed code, tightened over time) to the correction ladder; add "file an issue against Warden's own prompts/config" as a Retro output type |
| Risk is separate from severity; blast radius is considered | **Gap found** | Consider a recorded reversibility (one-way/two-way door) field feeding ADR 0008 gates, with a floor for data/authority/external effects |
| Review is bounded (local model, small prompt) | **Strengthened** | Add a reviewable-diff-size cap; oversized PRs get a "split into smaller PRs" outcome instead of a degraded review |
| Implement uses approved feature design before coding | **Strengthened** | Implement prompt: prototypes and design docs are behavioral references, never copied code; require a stated design reference for large work |
| Session budgets and bounded runs | **Refined** | Do not hard-code a context-size threshold; derive per-model limits from measured results (P0 runtime proofs already measure local behavior) |
| Warden is a factory with human gates and shadow-first rollout | **Corroborated** by an independent design checklist | Use his five per-task questions as a design-review checklist for each Warden task (trigger, effects, next trigger, human re-entry, duplicate-run guard) |
| Contributor-facing bot messages are labelled | **Corroborated** | Keep the AI-versus-deterministic distinction from ADR 0003; no change needed |
| Parallel implementation and auto-merge for reversible PRs | **Not adopted** | Remains out of v1 scope; revisit with the trust-dial note in SUMMARY.md if the pilot earns it |

## Open questions

- Does a reversibility field earn its keep over the existing risk facet, or does it just restate it? A tiny replay over past pilot PRs could say.
- What reviewable-diff-size cap does the local reviewer actually tolerate? This is measurable with the P0/P3 harness and should not be guessed.
- Would Warden's Retro benefit from reading its own session traces the way his does (Lloyd's note already proposes this)? He shows the traces being read cheaply from local disk; ours are journaled on the Mac.
