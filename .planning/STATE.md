---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-10)

**Core value:** Every open PR and issue sits in exactly one known state, recorded on GitHub, so any run can pick up cold and no head commit is ever reviewed twice. The maintainer only sees items that need their decision.
**Current focus:** Phase 1: Core State & Safety Rails

## Current Position

Phase: 1 of 7 (Core State & Safety Rails)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-11-10: Roadmap created (7 phases, 74/74 v1 requirements mapped)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: The PRD's Foundation stage is split into Phase 1 (state layer and runner guards) and Phase 2 (no-AI bookkeeping and bucket report). The Foundation gate (ROLL-01) sits at the end of Phase 2.
- [Roadmap]: Sweep is split. Issue clocks go live in Phase 2; PR nudges and closes (SWP-02, SWP-03) in Phase 4, once reviews are actually posted.
- [Roadmap]: `/warden gate` (GATE-02) lands in Phase 4 for the PR queue. Its enhancement and feature triage lanes arrive in Phase 5 via TRI-02.
- [Roadmap]: The outbox (STATE-05) and the GitHub/Shadow/DryRun sinks (POST-05) are built in Phase 3, so going live in Phase 4 only swaps the sink.

### Pending Todos

- [Phase 6]: Implement/Rework prompts need the comment-restrictive policy from research/TALK-SLOP.md (no justifying comments; an unfixable root cause is reported as an open finding, never commented over) — blocking prerequisite alongside the sandbox (Pitfall 11).
- [Phase 7]: Retro planning should apply the correction ladder from research/FRAMEWORK-CORRECTIONS.md (design > lint > verification > prose). Open research: Biome v2.6 JavaScript-plugin API (developer preview) for custom lint rules with root-cause error messages, and the two-severity trick (error new / warn legacy) in whatever linter an adopting repo uses.
- [Phase 2]: Bucket report and Sweep metrics must use only item counts, times (median age, minutes per PR), agreement rate, re-review count and escaped defects — never LOC or cost-per-defect (Hughes: professional malpractice, they make quality worse; research/BOOK-SE-BEST-PRACTICES.md, Pitfall 12).
- [Phase 5]: Implement prompt needs the spec self-consistency policy from research/TALK-SPEC-BUGS.md (state interpretation of ambiguous rules; ambiguity → open `spec-conflict`/`spec-gap` finding at the gate, never a silent guess; 3-restatement heuristic) — blocking prerequisite alongside P11 (Pitfall 13).
- [Phase 7]: Retro inputs — add Warden's own session traces and LLM-judged run scores as v1.x inputs (Lloyd's self-improvement loop, research/TALK-FACTORY.md), and track defect origin (spec/design/code/bad-fix) per Hughes; contributor text never.
- [v1.x]: Spec verification gate (SMT/solver check of the issue spec before Implement) and benchmark replay of past tasks — both deferred, spike first (research/TALK-SPEC-BUGS.md, research/TALK-FACTORY.md).
- [Phase 1]: **Open-harness pivot — RATIFIED as a POC (2026-11-15).** ADR 0004 amended (local-first model pool; no *unbudgeted* per-token spend) and STACK.md re-framed with the `AgentRunner` adapter seam + opencode/pi profiles. Model layer = local Mac MLX floor (LM Studio/llmster `:1234`) + opt-in remote **Nvidia** tier; orchestrator/worker split is v1.x. Research: research/OPEN-HARNESS.md. **Next (build the POC):** implement the `AgentRunner` interface + opencode adapter, prove one task (Review of a single PR) end-to-end against a local MLX model → schema-validated result the existing poster posts.
- [Phase 1 / shadow]: **Validate local-model quality before trusting it with Implement.** Add a local-vs-frontier comparison using Lloyd's benchmark replay of Warden's own past tasks (research/TALK-FACTORY.md), gated by the existing ≥7/10 agreement rollout gate. Local models are *less* incentivized toward strategic codebase health, so Retro/Implement prompts must carry the explicit CARE framing (research/TALK-CARE.md). This is the pivot's central open risk.

### Blockers/Concerns

- [Phase 2]: Buckets A–F must be finalized in discuss-phase; the candidate set is in research/SUMMARY.md conflict 6.
- [Phase 2]: An ADR 0002 amendment (custom Sweep replaces actions/stale) and an ADR 0003 amendment (text never calls itself a bot; App `[bot]` badge) are needed.
- [Phase 1]: Quick checks needed: TypeBox 1.x with Ajv 8, and the ~65,536-character comment limit for ledger size.
- [Phase 3/5/6]: These phases carry research flags. Phase 5 opens with a `/triage-review` dry-run spike and Phase 6 with a headless Docker Sandbox spike under launchd.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-11-15 (round 3b — pivot ratified as POC)
Stopped at: Owner ratified the open-harness pivot **as a POC** and added two refinements (tiered model pool: local MLX + remote Nvidia; orchestrator/worker economics). Folded both into `research/OPEN-HARNESS.md` (§7 model pool + orchestrator; recommendation updated). **Amended ADR 0004** (local-first, no *unbudgeted* per-token spend; Amendment section) and **re-framed STACK.md** (pivot section + adapter-profile table at top; Claude sections retained as reference). Updated PROJECT.md (Context + Key Decisions now "Ratified as POC"). Next: build the POC — `AgentRunner` interface + opencode adapter, one task (Review) end-to-end on a local MLX model.
Resume file: None
