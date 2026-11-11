# PRD: The Warden of the Gate, an AI-assisted repo maintainer for Claude Code

- **Status:** Draft
- **Date:** 2026-11-11
- **Owner:** @trek-e
- **Related ADRs:** [0001](../adr/0001-root-cause-confirmation-reuses-triage-review.md), [0002](../adr/0002-stale-clocks.md), [0003](../adr/0003-ai-assisted-review-voice.md), [0004](../adr/0004-all-ai-work-in-local-claude-code.md), [0005](../adr/0005-releasable-and-configurable-per-repo.md)

## TL;DR

The Warden of the Gate (repo `warden-of-the-gate`, command `/warden`) is a Claude Code plugin that helps one maintainer keep a busy GitHub repo moving: it triages new issues, reviews contributor PRs, fixes unclaimed confirmed bugs, and closes what has gone stale, then stops at a short decision card for the maintainer. It never merges. All AI work runs in the maintainer's own Claude Code sessions on their own machine; GitHub Actions only does non-AI bookkeeping. GSD Core is the first repo it runs on, but everything specific to GSD Core lives in one config file, so anyone can point it at their own repo.

## Problem

GSD Core has about 72 open PRs that are "constantly reviewed, never completed". Today's `/review-open-prs` command runs one long session over the whole queue. It fills its context by the sixth to eighth PR, waits on CI and on the maintainer mid-run, and keeps its queue and ledger only in the session, so every new run starts over and re-reviews PRs it already reviewed. Stale items pile up and the maintainer ends up managing the process by hand.

## Goals

- Every open PR and issue is in exactly one known state, visible on GitHub, so any run can pick up cold.
- No head commit is ever reviewed twice.
- The maintainer only sees items that need a decision, as short cards, and spends fewer minutes per PR than today.
- Issues flow from intake to triage to a fix PR without the maintainer, unless a decision is theirs.
- Stale PRs and issues close on published, predictable clocks.
- Runs without any API-key Claude calls (ADR 0004).
- Ships as a versioned plugin that another maintainer can install and configure for their repo in an afternoon (ADR 0005).

## Non-goals

- Merging, approving, or auto-merging anything. The maintainer always merges.
- Pushing to or rebasing a contributor's branch.
- Running AI on every event in real time; work happens in batches.
- Running Claude inside CI or GitHub Actions.
- Replacing GSD's own phase loop for feature development.
- Hosted service or multi-tenant operation.

## Users

- **Primary:** a solo or small-team maintainer of a popular repo who uses Claude Code on their own machine and is the merge gate.
- **Secondary:** contributors, who see AI-assisted reviews, nudges and triage comments signed as the maintainer's (ADR 0003).
- **Tertiary:** other maintainers adopting the plugin for their own repos.

## Scope: the loop

Eight tasks, each handling one item and then ending:

| Task | Runs where | Does |
|---|---|---|
| Intake | Actions, no AI | Template check, existing duplicate check, triage label |
| Triage | Local batch | Runs the configured triage command as is (GSD Core: `/triage-review`); root-causing confirms a bug (ADR 0001) |
| Claim | Actions, no AI | Reporter who offered a fix gets a claim window; otherwise confirmed work becomes `ready-for-agent` |
| Implement | Local batch | Branch off the base, failing-first test, fix, local preflight, PR with a Merge Danger summary; stops at "PR opened" |
| Review | Local batch | Deterministic gates, then a risk-tiered review of only the delta since the last reviewed commit, then a verifier pass; one comment review |
| Rework | Local batch | Fixes only the named findings on bot PRs; at most 3 rounds, then the human gate |
| Sweep | Actions, no AI | Nudges, stale closes, claim expiry, metrics (ADR 0002) |
| Retro | Local batch, weekly | Turns the maintainer's review comments into `REVIEW.md` lines or lint rules, as a PR |

## Requirements

### State and memory

1. Each item carries exactly one state label; each PR carries one ledger comment, edited in place, with a hidden JSON block (`lastReviewedSha`, tier, rounds, findings with status, nudge times).
2. A run whose head commit equals `lastReviewedSha` does nothing.
3. On a new push, review reads `lastReviewedSha..head` plus open findings, re-checks each open finding, and looks for new ones only in the delta.
4. A finding the maintainer marks won't-fix stays resolved unless the code around it changes.

### Human gates

5. The plugin may label, comment, post comment-only reviews, open its own PRs and push to its own branches.
6. It applies `confirmed-bug` itself once it has root-caused the defect (ADR 0001). Enhancement and feature approval, `wontfix`, approving, merging, and changes to workflows, `REVIEW.md`, the plugin or `MAINTAINERS` always need the maintainer.
7. It ends every PR at `pr:human-gate` with a decision card: linked issue, Merge Danger, CI evidence, open findings, recommendation.

### Runtime (ADR 0004)

8. All AI work runs in the maintainer's own Claude Code: `/warden` interactively, or headless `claude -p` from a local scheduler (launchd on macOS).
9. The runner refuses to start if `ANTHROPIC_API_KEY` is set. No workflow has a Claude step or an Anthropic secret.
10. Each batch processes items one at a time in fresh sessions, with an item cap and a turn limit per task so it stops well inside the maintainer's session limits. A batch that hits a limit ends cleanly; the next resumes from the ledger.
11. Headless sessions get a restricted tool list and read-only GitHub access. They write results to a file; a plain script posts labels, ledger and comments.
12. Fork PR code is never checked out or run. Review rules are read from the base branch only.
13. A kill switch variable is checked by every workflow and by the runner before each batch.

### Configuration and release (ADR 0005)

14. All repo specifics live in `.github/warden.yml`, validated against a published schema, with defaults for anything left out: label names, base branch, maintainers, voice header, triage command, test and preflight commands, stale clocks, tier paths, specialists, throttles, batch size and schedule, kill switch name, Memtrace on or off.
15. Tagged releases with a changelog; the config carries a schema version so upgrades don't silently break a repo.
16. `/warden setup` writes a starter config and creates missing labels without any AI.

### Stale handling (ADR 0002)

17. PRs: nudge at 48 and 72 hours of author silence, close at 5 days, only where the maintainer responded or a review was posted. Unanswered PRs go to the review queue instead.
18. Reviewed defect PRs whose requested changes aren't addressed in 5 days are closed; the issue returns to `ready-for-agent`, and the next person continues from the author's branch with a `Co-authored-by` credit.
19. Issues: `needs-reproduction` closes after 14 days, other waiting-on-reporter issues after 28; confirmed or approved issues never close for staleness.

## Rollout

1. **Foundation:** plugin skeleton, config schema with GSD Core as the first config, labels, ledger and tier scripts, backlog buckets A to F, the two bookkeeping workflows, runner switched off. Gate: the bucket report matches the maintainer's sense of the backlog.
2. **Review in shadow:** batched review writes only to a local report for two weeks. Gate: at least 7 in 10 blocking findings are ones the maintainer agrees with; no head commit is re-reviewed.
3. **Review live:** posts comment reviews and labels. Gate: maintainer minutes per PR go down; contributors aren't confused.
4. **Triage:** one issue per session, in batches. Gate: 9 in 10 labelled the way the maintainer would.
5. **Implement:** one `ready-for-agent` issue a day, one open bot PR at a time. Gate: bot PRs merge after a quick look more often than they bounce.
6. **Retro:** weekly rules PR.

## Success metrics

- Open PR count and median PR age (from the sweep's metrics).
- Re-reviews of an already-reviewed head commit: zero.
- Maintainer minutes per PR at the gate.
- Rounds to merge for bot PRs.
- Share of blocking findings the maintainer agrees with (shadow and live).
- Escaped defects traced to PRs that went through the loop.

## Open decisions

- **Decision 4, which account posts (open):** a GitHub App (recommended, signed as the maintainer's review), a machine user, or the maintainer's own account. Fix PRs need a non-maintainer author so the maintainer's review counts as the second reviewer. The chosen account's credential lives on the maintainer's machine, and the Actions bookkeeping needs a token for the same account.
- **Decision 6, Memtrace (open):** narrow it to `get_impact` and `recall_decision` on the full tier plus a `--diff` CI check, or drop it from the review path. Proposed test: replay 10 recent PRs with and without it.
- **Stale details to confirm:** what counts as author activity (proposed: a push, comment or review reply; bot comments and CI runs don't count) and exemptions (maintainer-marked drafts, `keep-open`, PRs waiting on the maintainer).
- **Batch schedule and size:** which hours the machine is usually on.
- **Isolation:** whether headless runs on fork PRs use a separate macOS user rather than the maintainer's main login.
