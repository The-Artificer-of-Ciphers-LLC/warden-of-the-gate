# The Warden of the Gate

## What This Is

The Warden of the Gate (repo `warden-of-the-gate`, command `/warden`, config `.github/warden.yml`) is a versioned Claude Code plugin that helps one maintainer keep a busy GitHub repo moving. It triages new issues, reviews contributor PRs, fixes unclaimed confirmed bugs, and closes what has gone stale, then stops at a short decision card for the maintainer. It never merges. All AI work runs in the maintainer's own Claude Code on their own machine; GitHub Actions only does non-AI bookkeeping. GSD Core is the first repo it runs on, but everything repo-specific lives in one config file so any maintainer can adopt it.

## Core Value

Every open PR and issue sits in exactly one known state, recorded on GitHub, so any run can pick up cold and no head commit is ever reviewed twice — the maintainer only sees items that need their decision.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**State and memory**
- [ ] Each item carries exactly one state label; each PR carries one ledger comment, edited in place, with a hidden JSON block (`lastReviewedSha`, tier, rounds, findings with status, nudge times)
- [ ] A run whose head commit equals `lastReviewedSha` does nothing
- [ ] On a new push, review reads `lastReviewedSha..head` plus open findings, re-checks each open finding, and looks for new ones only in the delta
- [ ] A finding the maintainer marks won't-fix stays resolved unless the code around it changes

**The loop (eight tasks, each handles one item then ends)**
- [ ] Intake (Actions, no AI): template check, existing-duplicate check, triage label
- [ ] Triage (local batch): runs the configured triage command unchanged (GSD Core: `/triage-review`), one issue per fresh session; root-causing confirms a bug (ADR 0001)
- [ ] Claim (Actions, no AI): a reporter who offered a fix gets a claim window; otherwise confirmed work becomes `ready-for-agent`
- [ ] Implement (local batch): branch off base, failing-first test, fix, local preflight, PR with a Merge Danger summary; stops at "PR opened"; one `ready-for-agent` issue a day, one open bot PR at a time
- [ ] Review (local batch): deterministic gates, then risk-tiered review of only the delta since the last reviewed commit, then a verifier pass; one comment review
- [ ] Rework (local batch): fixes only named findings on bot PRs; max 3 rounds, then the human gate
- [ ] Sweep (Actions, no AI): nudges, stale closes, claim expiry, metrics (ADR 0002)
- [ ] Retro (local batch, weekly): turns the maintainer's review comments into `REVIEW.md` lines or lint rules, as a PR

**Human gates**
- [ ] Plugin may label, comment, post comment-only reviews, open its own PRs and push to its own branches — nothing more
- [ ] Plugin applies `confirmed-bug` itself after root-causing; enhancement/feature approval, `wontfix`, approving, merging, and changes to workflows, `REVIEW.md`, the plugin or `MAINTAINERS` always need the maintainer
- [ ] Every PR ends at `pr:human-gate` with a decision card: linked issue, Merge Danger, CI evidence, open findings, recommendation

**Runtime (ADR 0004)**
- [ ] All AI work runs in the maintainer's own Claude Code: `/warden` interactively or headless `claude -p` from launchd
- [ ] Runner refuses to start if `ANTHROPIC_API_KEY` is set; no workflow has a Claude step or Anthropic secret
- [ ] Batches process items one at a time in fresh sessions with item caps and per-task turn limits; a batch that hits a limit ends cleanly and the next resumes from the ledger
- [ ] Headless sessions get a restricted tool list and read-only GitHub access, write results to a file; a plain script posts labels, ledger and comments
- [ ] Fork PR code is never checked out or run; review rules are read from the base branch only
- [ ] A kill-switch variable is checked by every workflow and by the runner before each batch
- [ ] Schedule is configurable with catch-up-on-wake as the primary mechanism (machine hours are unpredictable)
- [ ] Isolation is configurable: default runs under the maintainer's main login (restricted tools + script-mediated writes); docs cover running under a separate macOS user

**Posting identity (Decision 4 — resolved)**
- [ ] Reviews, labels, comments and fix PRs post via a GitHub App; app credential lives on the maintainer's machine; Actions bookkeeping uses an installation token for the same App so nudges carry the same voice
- [ ] Every contributor-facing output opens with the configured voice header (e.g. "AI-assisted review by @trek-e") and never calls itself a bot (ADR 0003)

**Memtrace (Decision 6 — resolved)**
- [ ] Memtrace usage narrowed to `get_impact` and `recall_decision` on the full review tier plus a `--diff` CI check; on/off via config; plugin works fully without Memtrace and only says "install Memtrace" (licence forbids redistributing its skills)

**Configuration and release (ADR 0005)**
- [ ] All repo specifics live in `.github/warden.yml`, validated against a published `config/schema.json`, with `config/defaults.yml` filling gaps: label names, base branch, maintainers, voice header, triage command, test and preflight commands, stale clocks, tier paths, specialists, throttles, batch size and schedule, kill-switch name, Memtrace on/off
- [ ] Config carries a schema version; tagged releases with a changelog; schema changes ship with migration notes
- [ ] `/warden setup` writes a starter config and creates missing labels without any AI
- [ ] `examples/gsd-core.yml` is the first real configuration

**Stale handling (ADR 0002 — activity definition confirmed)**
- [ ] PRs: nudge at 48h and 72h of author silence, close at 5 days, only where the maintainer responded or a review was posted; unanswered PRs go to the review queue instead
- [ ] Reviewed defect PRs with unaddressed requested changes after 5 days close; the issue returns to `ready-for-agent`, and the next person continues from the author's branch with `Co-authored-by` credit
- [ ] Issues: `needs-reproduction` closes after 14 days, other waiting-on-reporter after 28; confirmed or approved issues never close for staleness
- [ ] Author activity = a push, comment or review reply from the author (resets the clock); bot comments and CI runs don't count; exempt maintainer-marked drafts, `keep-open`, and PRs waiting on the maintainer

**Rollout gates**
- [ ] Foundation: bucket report (backlog buckets A–F) matches the maintainer's sense of the backlog
- [ ] Review shadow (2 weeks, local report only): ≥7 in 10 blocking findings agreed with; zero head-commit re-reviews
- [ ] Review live: maintainer minutes per PR go down; contributors aren't confused
- [ ] Triage: 9 in 10 labelled the way the maintainer would
- [ ] Implement: bot PRs merge after a quick look more often than they bounce
- [ ] Retro: weekly rules PR

### Out of Scope

- Merging, approving, or auto-merging anything — the maintainer is always the merge gate
- Pushing to or rebasing a contributor's branch — contributor ownership
- Real-time AI on every event — work happens in batches (ADR 0004)
- Running Claude inside CI / GitHub Actions or any API-key Claude call — cost constraint (ADR 0004)
- Replacing GSD's own phase loop for feature development — different job
- Hosted service or multi-tenant operation — local, per-maintainer tool
- Rewriting the triage-review command — reused unchanged (ADR 0001)
- Redistributing Memtrace skills — licence

## Context

- Motivating repo: GSD Core has ~72 open PRs "constantly reviewed, never completed". Today's `/review-open-prs` runs one long session over the whole queue, fills its context by PR 6–8, waits on CI and the maintainer mid-run, and keeps its queue/ledger only in-session — so every run starts over and re-reviews. Stale items pile up; `stale.yml` (28+14 days) conflicts with the command's 5-day close.
- Existing assets reused: `/triage-review` (root-causes bugs, "works perfectly"), local guards (merge authority, clean tree), GSD Core tooling conventions (`gsd-tools.cjs`).
- Source docs: `docs/prd/0001-warden-of-the-gate.md`, `docs/adr/0001`–`0005` (all Accepted). Repo lives at `The-Artificer-of-Ciphers-LLC/warden-of-the-gate`.
- Users: primary — solo/small-team maintainer of a popular repo using Claude Code locally; secondary — contributors seeing AI-assisted reviews signed as the maintainer; tertiary — other maintainers adopting the plugin.
- Prompt injection from fork PRs targets a session on the maintainer's machine — hence restricted tools, read-only GitHub, script-mediated writes, never running fork code.
- Success metrics: open PR count and median PR age; zero re-reviews of an already-reviewed head; maintainer minutes per PR at the gate; rounds to merge for bot PRs; share of blocking findings the maintainer agrees with; escaped defects traced to loop PRs.

## Constraints

- **Cost**: No API-key Claude calls anywhere — maintainer can't afford API spend for OSS maintenance (ADR 0004)
- **Runtime**: AI only runs while the machine is on and signed in to Claude Code and `gh`; launchd slots missed while asleep run on wake, missed while off are skipped
- **Throughput**: Bounded by the maintainer's Claude Code session limits; batches must leave room for the maintainer's own work
- **Platform**: macOS launchd scheduler for v1 headless runs
- **Security**: Fork PR code never checked out or executed; rules from base branch only; headless tool list restricted
- **Portability**: Nothing GSD Core-specific hardcoded; GSD Core is just the first config (ADR 0005)
- **Tech stack**: TypeScript on Node ≥24.12 (ESM, esbuild, committed `dist/`); Claude Code ≥2.1.302 pinned; never `--bare`, `--dangerously-skip-permissions` or the Agent SDK
- **GitHub platform**: No `pull_request_target`; App never gets `workflows` permission; no conditional PATCH, so the ledger relies on writer-owned sections and a re-read before every write

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Root-causing confirms a bug; triage-review reused unchanged (ADR 0001) | Existing command works; implement still writes failing-first test | — Pending |
| Single stale clock config shared by stale.yml and plugin (ADR 0002) | Removes conflicting contributor signals | — Pending |
| Author-activity definition and exemptions confirmed as proposed in ADR 0002 | Owner confirmed during initialization | — Pending |
| Contributor output signed as AI-assisted review by the maintainer (ADR 0003) | "I am the logic behind it, not a bot" | — Pending |
| All AI in local Claude Code, no API keys (ADR 0004) | Cost constraint | — Pending |
| Releasable plugin, config per repo (ADR 0005) | Usable by any maintainer | — Pending |
| Post via a GitHub App (Decision 4) | Non-maintainer author so maintainer review counts as second review; Actions uses installation token for same voice | — Pending |
| Memtrace narrowed to get_impact + recall_decision on full tier + `--diff` CI check, optional (Decision 6) | Keep high-value graph context without hard dependency | — Pending |
| Isolation configurable, default main login | Practical default; separate macOS user documented for stronger containment | — Pending |
| Schedule configurable, catch-up-on-wake primary | Machine hours unpredictable | — Pending |
| v1 = all six rollout stages | Owner wants the full loop in the first milestone | — Pending |
| v1 done = tagged v1.0.0 release, all six tasks live on GSD Core with gates passed, plus one second repo onboarded from docs in an afternoon | Proves both value and ADR 0005 portability | — Pending |
| Script language: TypeScript (erasable syntax) on Node ≥24.12, ESM, esbuild-bundled committed `dist/`, one `warden-core` for runner + Actions | Research: one codebase, no runtime installs, portable date/JSON handling; Bash and Python rejected | — Pending |
| Architecture rule: AI proposes, scripts dispose — sessions are read-only and return schema-validated result files; one poster holds the write token | Contains prompt injection and makes state deterministic | — Pending |
| Fork-branch continuation (conflict 1) allowed only inside an active isolation backend; otherwise Implement restarts from base, reads the old diff as data, credits `Co-authored-by` | Owner choice "allow with sandbox"; resolves PRD req 12 vs req 18 | — Pending |
| Triage (conflict 2): `/triage-review` text unchanged, invocation wrapped (`--issue N --dry-run`, read-only token, write-blocking hook, result adapter); defect and needs-repro lanes run headless, enhancement and feature lanes finish in `/warden gate`; mid-run merge never runs headless | Keeps ADR 0001 and "never merges" both true | — Pending |
| Stale (conflict 3): custom Sweep in warden-core, not actions/stale; setup detects and asks to remove GSD Core `stale.yml`; ADR 0002 amendment needed | actions/stale measures idle time from `updated_at` and resets on the plugin's own activity | — Pending |
| Intake (conflict 4): no `pull_request_target` anywhere; hourly Sweep polls GraphQL for new and pushed PRs; the runner also compares head vs `lastReviewedSha` | GitHub blocks `pull_request_target` by default from 2026-12-02 | — Pending |
| Voice (conflict 5): amend ADR 0003 to "text the Warden writes never calls itself a bot"; honest App slug; header inserted by the poster, names the owner in backticks without @-mention | GitHub's `[bot]` badge on App comments can't be changed | — Pending |
| Backlog buckets A–F (conflict 6): candidate set (never reviewed / waiting on author / waiting on maintainer / stale candidate / bot-authored / blocked), finalized in Phase 1 discussion | Undefined in source docs; Foundation gate depends on it | — Pending |
| Isolation (conflict 7): pluggable `isolation.backend` (docker-sandbox default, devcontainer, apple-container, separate-user, claude-sandbox); advisory for Implement/Rework on base, required for fork-branch continuation; spike headless Docker Sandboxes under launchd in Phase 5 | Owner choice; Docker Sandboxes keep the subscription token on the host | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-10 after initialization*
