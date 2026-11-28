# Warden build backlog (2026-11-27)

Derived from [the implementation plan](../prd/0001-warden-of-the-gate.implementation-plan.md) (P0 to P7), the PRD's owner rulings and ADRs 0001 to 0024, measured against the repository by [the gap inventory](GAP-INVENTORY-2026-11-27.md) (143 requirement rows; basis `main` 8e5edc4). Row IDs such as `P3.7` or `X.2` are the inventory's. This file orders the work; it adds no product requirement.

## Rules for executing it

- Only decided, offline-testable work runs without a question. Everything is built and tested against the simulated GitHub (`FakeWorld`) and scripted models; nothing posts to a real repository, issues a token, changes an App, publishes a package or activates anything.
- Each item is its own branch, tests first where a behavior is specified, `npm test` green, then commit, push, PR and merge (standing authority: commits, push, PRs and merge). One item at a time; a failing test or an ambiguity stops that item and goes to the owner as a question.
- PRD and ADR bodies are formal documents. Items that need their text changed are listed as owner decisions, not edited here.
- Model-quality numbers are measured on the configured model (`beamster/Qwen3.8-Flash-Next-Sushi-2bpw` via mlx-serve) and are single runs unless stated.

## Wave 1: decided, offline, executable now

| # | Item | Inventory rows | Done when |
|---|---|---|---|
| 1.1 | Fix stale operator facts: quickstart and CHANGELOG Node and model-server statements, README ADR table through 0024, handoff stale counts | B4-B6, P6 docs | A reader following quickstart sees Node 26 and mlx-serve; README lists all 24 ADRs |
| 1.2 | Writer validates every outgoing comment, review and card: length cap, no secrets, no mentions, label allowlist | X.3 | Tests show each violation is refused with a reason and nothing is posted |
| 1.3 | Claim assignability: real check against the item, recording ledger-only claims when GitHub refuses (replace the hardcoded `assignable: () => true`) | B13, P2.4 | Tests for assignable, refused and unknown outcomes |
| 1.4 | Review findings: stable fingerprints, per-review cap with severity rank, inline position validated against the diff | X.4 | Tests for fingerprint stability, cap order and a position outside the diff rejected |
| 1.5 | Accepted AI Review and Triage produce writer intents (`review-record`, triage record) in live mode only; shadow stays local | P3.7, P4.10, gap 1 | Fake-GitHub test: live mode records the intent through the writer; shadow mode records nothing remote |
| 1.6 | Review output to GitHub as `COMMENT` reviews plus a Warden check run on the reviewed head, behind the writer and mode gate (fake only) | X.2 | Fake-GitHub test: comment review and check run on the right head; none in shadow |
| 1.7 | Maintainer commands: force a full review, dismiss one finding (with persistence) | X.1 | Parser and ledger tests; a dismissed finding stays dismissed across a re-review |
| 1.8 | Config keys for review depth and uncertain-finding handling; wire `urgent` and `approvedFeature` into selection | X.7, P3.5 | Schema, defaults and selection tests |
| 1.9 | Sweep writes `last-sweep.json`; status shows it | P1.16 | Test: sweep run updates it; `warden status` reports it |
| 1.10 | Per-run and per-day closure caps; single-scan lock | P2.17, P3.18 | Tests for cap exceeded and a second concurrent scan refused |
| 1.11 | Contributor-facing messages use configured voice and the App identity, AI-assisted marked | B14, P2.13 | Tests with a configured voice; dead `voice` key now used |
| 1.12 | Review prompt finding-id format rule | P7 | CLOSED, not adopted: the 2026-11-27 run with the rule (local commit 43f3f6f, never pushed) was worse than the run without it: accepted 14/18 against 17/18, recall 0/6 against 3/6; two cases were still rejected for a bad id, plus one provider error and one out-of-scope finding. One run each, so variance is part of this, but there is no sign of benefit. An alternative (normalising a purely cosmetic id in code before validation) changes how model output is treated and is an owner decision |

## Wave 2: needs an owner ruling or acceptance first

Built after the owner decides; each is a question to the owner, not a guess.

**Decided 2026-11-27 by @trek-e.** Each ruling is recorded in the PRD's [owner decisions](../prd/0001-warden-of-the-gate.md#owner-decisions-from-the-research-reconciliation) table (2026-11-27, Wave 2) and the sections named there. The answers are his words.

- Replay and qualification thresholds versus the PRD's 90% agreement bar (B1): **DECIDED** ("Yes to both"). PRD §11 governs: raise `replay/replay.ts` `DEFAULT_THRESHOLDS` to the §11 bar (90% agreement separately on blocking findings and triage, each denominator reported; at least 10 blocking findings assessed; every curated critical case detected) and add a critical-case flag to curated cases. A finding matches a known defect by same file and same changed diff hunk, not an exact line range.
- ADRs 0014 to 0016 (frozen tests, contract gate, verification loop, mutation): **DECIDED** ("Accept, in that order"). All three accepted; build order 0014 (frozen tests), then 0016 (verification loop), then 0015 (contract review). Still open: ADR 0017 and 0024 details (test provenance display, differential checks, preserve/change/fix facet), 0018 measurements, 0020 to 0023.
- Remote or frontier models for reviewer-family diversity (B8) versus loopback-only: **PARTLY DECIDED.** The owner ruled 2026-11-24 that Warden is never local-only ("Local models are not what auto merge verdict rests on"), and on 2026-11-27 ("Yes, that works") that any registered endpoint tier he approves for the auto-merge gate may give a verdict, with tier, endpoint and exact model id recorded in every verdict's provenance ([MODEL-CONNECTIONS](../research/MODEL-CONNECTIONS.md)). Still open: consent and budget for remote and frontier tiers, and reconciling ADR 0007, PRD §2 "Local-only inference" and `config/policy.ts` ("MVP inference is local-only") with these rulings.
- ADR 0015 one-way-door detection by configured boundary class (B9): **already decided 2026-11-26** (PRD §12, 2026-11-26 table; ADR 0015 Decision). A change is a one-way door exactly when it touches a configured boundary class; external effects (publishing, releases, deploys) are a default class; every one-way door comes to the maintainer as a decision card.
- Discord: buttons and a Gateway helper versus link-only cards (B12): **DECIDED** ("Link-only for MVP"). Keep the current link-only cards (`discord/cards.ts`); every decision is a verified GitHub comment. Buttons and the Gateway helper are deferred to after the pilot (PRD §8, plan P5).
- Status metrics and measured budgets (P6 and P7): **DECIDED** ("Yes, that works"). `warden status` shows the pilot gate (blocking-finding and triage agreement, each with its denominator; blocking findings assessed; critical cases detected; qualification verdict), the must-be-zero counters (unauthorized effects, duplicate accepted reviews, lost-state recovery failures) and measured budgets (tokens, wall time, memory per task, by model). The rest of the PRD §11 tracking list goes in a separate on-demand metrics report (PRD §10, §11; plan P7).

## Wave 3: owner or GitHub gated (not executed)

P1 scheduling gate and Support case 5025247; adoption command syntax; App Contents and Pull requests write for live Implement publishing, protected ceiling and any token; Discord application, channel, token and user-ID mappings; npm scope, package name and any publication or tag; curated replay set (at least 20 PRs and 20 issues) and the label-derived triage review; activation of live scope; the workflow-run approval capability proof; clean-up of the sandbox's leftover PR, issue and branches.

## P7 measurement track (runs alongside)

State: not qualified. New model, dev half, one run: accepted 17/18, recall 3/6, strict extras 13 of 16. The finding-id prompt rule was tried and not adopted (item 1.12). A repeat run of the unmodified setup, to measure variance, has not been done. A clean holdout on the current harness does not exist, and any further run on that holdout is another look at it.

## Progress (2026-11-27): Wave 1 executed

| # | State | PR | Notes |
|---|---|---|---|
| 1.1 | merged | 126 | Operator docs: Node 26, mlx-serve, ADR table through 0024 |
| 1.2 | merged | 125 | Outgoing validation; also checked before the plan is recorded in the ledger |
| 1.3 | merged | 127 | Real assignability check (optional `Store.canAssign`) |
| 1.4 | merged | 128 | Fingerprints, inline flags, severity-ranked cap helper |
| 1.5 | merged | 129 | `review-record` producer, live mode only. Triage records NOT done: they need a new intent kind and a ruling on what an accepted triage does in live mode |
| 1.6 | merged | 130 | `review-post`: COMMENT review plus check run, fake GitHub only; the HttpStore calls are written to the REST docs and never run (needs pull-requests and checks write) |
| 1.7 | merged | 131 | `/warden review` and `/warden dismiss`; login-based authorization (PRD says numeric ID); scan path not yet honouring a forced review |
| 1.8 | merged | 132 | Review config keys, optional finding confidence, authorized urgency for review and triage scans. Open: review DEPTH has no defined options; the prompt does not ask for confidence; `approvedFeature` has no caller until an implement scan exists |
| 1.9 | merged | 133 | `last-sweep.json` written by a completed Mac-side sweep |
| 1.10 | merged | 134 | Closure caps (5 per run, 10 per day: unspecified numbers chosen by the agent) and a single-scan lock. The per-day count is host-local |
| 1.11 | merged | 135 | Configured voice on posted comments; style wording unreviewed |
| 1.12 | closed | n/a | Finding-id prompt rule tried and not adopted |

Everything above ran against the simulated GitHub and scripted models. Nothing was posted to a real repository, no permission or token changed, nothing was published or activated.
