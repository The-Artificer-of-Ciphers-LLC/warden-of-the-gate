# PRD: The Warden of the Gate, a self-maintaining software factory for any GitHub repo

- **Status:** Draft
- **Date:** 2026-11-16 (revised)
- **Owner:** @trek-e
- **Related ADRs:** [0001](../adr/0001-builtin-triage-task.md), [0002](../adr/0002-stale-clocks.md), [0003](../adr/0003-contributor-facing-voice.md), [0004](../adr/0004-local-first-open-harness-runtime.md), [0005](../adr/0005-releasable-and-configurable-per-repo.md), [0006](../adr/0006-agentrunner-adapter-seam.md), [0007](../adr/0007-local-first-model-pool.md), [0008](../adr/0008-tiered-autonomy-and-merge-gates.md), [0009](../adr/0009-factory-product-boundary.md)

## TL;DR

The Warden of the Gate (repo `warden-of-the-gate`) is a self-maintaining software factory for any GitHub repo: it triages new issues, reviews PRs, fixes unclaimed confirmed bugs, closes what has gone stale, and improves its own rules — with human oversight. It runs on open agent harnesses (opencode and pi for unattended batch; Bionic as the interactive surface) on a local-first model pool, so routine work costs electricity, not tokens. GitHub Actions does non-AI bookkeeping only. The first repo it runs against is GSD Core, the pilot repo; everything specific to a repo lives in one config file, so any maintainer can point it at their own.

## Problem

Busy repos rot: PRs pile up "constantly reviewed, never completed". A long review session over the whole queue fills its context by the sixth to eighth PR, waits on CI and on the maintainer mid-run, and keeps its queue and ledger only in the session — so every new run starts over and re-reviews what it already reviewed. Stale items pile up and the maintainer ends up managing the process by hand.

The pilot repo shows this at scale: ~72 open PRs in that state, and no durable memory of what was already reviewed.

## Goals

- Every open PR and issue is in exactly one known state, visible on GitHub, so any run can pick up cold.
- No head commit is ever reviewed twice.
- The factory acts with tiered autonomy: low-risk work merges on its own; high-risk escalates to a short decision card. The maintainer spends fewer minutes per PR than today (ADR 0008).
- Issues flow from intake to triage to a fix PR without the maintainer, unless a decision is theirs.
- Stale PRs and issues close on published, predictable clocks (ADR 0002).
- Routine AI work costs no per-token spend: local models by default (ADR 0007).
- Ships as one package any maintainer can install and configure for their repo in an afternoon, on a machine, a Docker container or a Kubernetes pod (ADR 0005).

## Non-goals

- The factory never writes to a contributor's branch — review of their PRs is report-only; findings go back to the author.
- Review never edits code — on factory-generated branches it reports and routes findings to the fixing engine; it merges, nothing else.
- No model inference in CI/Actions (v1) — Actions does non-AI bookkeeping only.
- The factory never executes a maintained repo's own development workflow — products are maintained, not run as factory machinery (ADR 0009).
- No hosted multi-tenant service in v1 — local-first: the factory runs on the maintainer's machine, a Docker container or a Kubernetes pod, all self-operated.

## Users

- **Primary:** a solo or small-team maintainer of a busy repo who runs open agent harnesses on their own machine (or container) and is the oversight gate.
- **Secondary:** contributors, who see AI-assisted reviews, nudges and triage comments signed by the configured posting account (ADR 0003).
- **Tertiary:** other maintainers adopting the factory for their own repos.

## Scope: the loop

Eight tasks, each handling one item and then ending:

| Task | Runs where | Does |
|---|---|---|
| Intake | Actions, no AI | Template check, existing duplicate check, triage label |
| Triage | Local batch | Factory built-in: root-causes the report, classifies severity, applies labels; confirmation rule is config (ADR 0001) |
| Claim | Actions, no AI | Reporter who offered a fix gets a claim window; otherwise confirmed work becomes `ready-for-agent` |
| Implement | Local batch | Branch off the base, failing-first test, fix, local preflight, PR with a Merge Danger summary; stops at "PR opened" |
| Review | Local batch | Deterministic gates, then a risk-tiered review of only the delta since the last reviewed commit; reports findings (blocker/major/minor/nit) and merges on a successful review — never edits code |
| Rework | Local batch | Fixes only the named findings on factory-generated PRs; at most 3 rounds, then the human gate |
| Sweep | Actions, no AI | Nudges, stale closes, claim expiry, metrics (ADR 0002) |
| Retro | Local batch, weekly | Turns the maintainer's review comments into repo rules or lint, as a PR |

## Requirements

### State and memory

1. Each item carries exactly one state label; each PR carries one ledger comment, edited in place, with a hidden JSON block (`lastReviewedSha`, tier, rounds, findings with status, nudge times).
2. A run whose head commit equals `lastReviewedSha` does nothing.
3. On a new push, review reads `lastReviewedSha..head` plus open findings, re-checks each open finding, and looks for new ones only in the delta.
4. A finding the maintainer marks won't-fix stays resolved unless the code around it changes.

### Oversight (ADR 0008)

5. The factory may label, comment, post reviews, open its own PRs and push to its own branches.
6. Tiered autonomy: risk tier plus verifier confidence decide whether the factory acts or escalates to a decision card; thresholds are per-repo config.
7. Merge gate: a blocker finding always stops a merge; major, minor and nit block only when enabled in config (on by default — any nit can become a major with one change).
8. It ends every escalated item at the human gate with a decision card: linked issue, Merge Danger, CI evidence, open findings, recommendation.
9. Enhancement and feature approval, `wontfix`, approving a contributor PR beyond the gate, and changes to workflows, rules files or `MAINTAINERS` always need the maintainer.

### Runtime (ADR 0004, ADR 0006)

10. All AI work runs locally through an AgentRunner adapter on open harnesses: opencode and pi for unattended batch; Bionic as the interactive surface. No vendor-locked agent is a Warden platform.
11. Local-first model pool: local models by default; an opt-in remote high-end tier for heavy tasks (v1.x); the runner's preflight never allows a silent paid fallback (ADR 0007).
12. One runner process, two trigger modes: calendar-scheduled batches and event-triggered real-time pickup; execution mode is per-repo config, set when the repo is added. Kept alive by launchd locally, or run as a container/pod daemon.
13. Each batch processes items one at a time in fresh sessions, with an item cap and a turn limit per task so it stops well inside the model's context. A batch that hits a limit ends cleanly; the next resumes from the ledger.
14. Sessions get a restricted tool surface and read-only GitHub access. They write results to a file; the runner re-validates it against the result schema before anything is posted.
15. Fork PR code is never checked out or run. Review rules are read from the base branch only.
16. A kill switch variable is checked by every workflow and by the runner before each batch.

### Configuration and release (ADR 0005)

17. All repo specifics live in `.github/warden.yml`, validated against a published schema, with defaults for anything left out: label names, base branch, maintainers, voice (posting account), harness selection, execution mode, finding-severity merge gates, stale clocks, tier paths, throttles, batch size and schedule, kill switch name.
18. One npm package `warden` (TypeScript/Node, bun-compatible) with committed `dist/*.mjs` and a container image; tagged releases with a changelog; the config carries a schema version so upgrades don't silently break a repo.
19. `warden setup` writes a starter config and creates missing labels without any AI.

### Stale handling (ADR 0002)

20. PRs: nudge at 48 and 72 hours of author silence, close at 5 days, only where the maintainer responded or a review was posted. Unanswered PRs go to the review queue instead.
21. Reviewed defect PRs whose requested changes aren't addressed in 5 days are closed; the issue returns to `ready-for-agent`, and whoever picks it up continues from the author's branch with a `Co-authored-by` credit.
22. Issues: `needs-reproduction` closes after 14 days, other waiting-on-reporter issues after 28; confirmed or approved issues never close for staleness.

## Rollout

0. **POC (two-track):** Bionic test runs — the Review task against pilot-repo PRs on a local model, validating prompts, packets and result contracts interactively — while the opencode adapter is built in parallel. Gate: a schema-validated Review result posted by the existing poster; then the pi adapter.
1. **Foundation:** factory skeleton, config schema with the pilot repo as first config, labels, ledger and tier scripts, backlog buckets A to F, the two bookkeeping workflows, runner switched off. Gate: the bucket report matches the maintainer's sense of the backlog.
2. **Review in shadow:** batched review writes only to a local report for two weeks. Gate: at least 7 in 10 blocking findings are ones the maintainer agrees with; no head commit is re-reviewed.
3. **Review live:** posts comment reviews and labels. Gate: maintainer minutes per PR go down; contributors aren't confused.
4. **Triage:** one issue per session, in batches. Gate: 9 in 10 labelled the way the maintainer would.
5. **Implement:** one `ready-for-agent` issue a day, one open factory PR at a time. Gate: factory PRs merge after a quick look more often than they bounce.
6. **Retro:** weekly rules PR.

## Success metrics

- Open PR count and median PR age (from the sweep's metrics).
- Re-reviews of an already-reviewed head commit: zero.
- Maintainer minutes per PR at the gate (on escalated items).
- Rounds to merge for factory PRs.
- Share of blocking findings the maintainer agrees with (shadow and live).
- Escaped defects traced to PRs that went through the loop.
- Auto-merge rate: share of factory-reviewed PRs merged with no human intervention.
- Revert/escape rate on auto-merges: share of factory-auto-merged PRs later reverted or found to have escaped defects.

## Open decisions

- **Which account posts (open):** a GitHub App, a machine user, or the maintainer's own account. The voice header names this configured account; fix PRs need a non-maintainer author so the maintainer's review counts as the second reviewer.
- **Memtrace (open):** narrow it to `get_impact` and `recall_decision` on the full tier plus a `--diff` CI check, or drop it from the review path. Proposed test: replay 10 recent PRs with and without it.
- **Stale details to confirm:** what counts as author activity (proposed: a push, comment or review reply; bot comments and CI runs don't count) and exemptions (maintainer-marked drafts, `keep-open`, PRs waiting on the maintainer).
- **Execution mode and schedule per repo:** which hours the machine or container is usually on.
- **Isolation:** whether runs on fork PRs use a separate OS user or container rather than the maintainer's main login.
