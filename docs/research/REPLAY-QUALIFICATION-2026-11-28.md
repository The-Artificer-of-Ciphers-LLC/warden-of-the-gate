# Replay Qualification Baseline (64 cases) and the Launchd Dispatch Test

**Domain:** Whether the local model passes the PRD §11 bar on the maintainer's own labelled history, so that a tier may give an auto-merge verdict; and whether an outside scheduler can start the sweep through `workflow_dispatch` (ADR 0026).
**Researched:** 2026-11-28.
**Confidence:** HIGH for the numbers (read from the replay report and the progress log of the runs below). LOW for generalising them: this is one run of one model, with no repository context pack, on a set that is also the tuning set (not a holdout).

> **Status: measurement, nothing decided.** No tier qualifies. No setting, label or rule was changed because of these numbers, other than the repair-round change in section 3, which the owner approved and which is merged.

## 1. Setup

- Set: 64 cases (32 PRs, 32 issues), curated by the maintainer (`trek-e`), not synthetic. Replayed in a simulated repository (`warden replay --runner opencode --context-limit 1048576`), nothing posted to GitHub.
- Model: `beamster/Qwen3.8-Flash-Next-Sushi-2bpw` through mlx-serve, via OpenCode 2.4.1. Wall time 32.3 minutes.
- Reviewer ran without a repository context pack (`--lookup-clone` was not used), so no lookup context was available to it.
- Report: instance `replay/report-2026-11-28T04-13-20-472Z.json`.

## 2. Result against §11

| §11 measure | Result | Bar | Met |
|---|---|---|---|
| Blocking-finding agreement | 14 of 33 (42%) | 90% | no |
| Triage agreement | 14 of 32 (44%) | 90% | no |
| Blocking findings assessed | 14 | at least 10 | yes |
| Critical cases detected | 0 of 0 | all | n/a: no case is flagged critical, so the bar has nothing to score |
| Accepted rate | 86% | 90% | no |

**Verdict: not qualified.** No tier may give an auto-merge verdict.

### Rows where the model disagreed with history (32)

**Triage (18)**

| Kind | Cases | Detail |
|---|---|---|
| Format rejection | issues 5004, 3534, 2613, 3993, 2696, 1697, 1989 | malformed or off-schema JSON; no label reached |
| Expected bug, got enhancement | issues 5061, 5451 | |
| Expected feature-proposal, got escalate | issue 73 | |
| Expected not-actionable, got actionable | issues 646, 3340, 4884, 5494 (as bug or likely-bug), 4027 (as feature-proposal) | |
| Expected needs-info, got actionable | issues 216, 1650 (as bug or likely-bug), 381 (as feature-proposal) | |

**Review (14)**

| Kind | Cases |
|---|---|
| Missed the known defect, no false findings | pr-5685, pr-4021, pr-5363, pr-1499, pr-3091 |
| Found the defect, added false findings | pr-2031 (1), pr-585 (1), pr-85 (1), pr-4230 (4) |
| Missed the defect and added false findings | pr-4228 (3) |
| Flagged a PR that should have been left alone | pr-3107 (1), pr-4048 (1) |
| Format rejection | pr-482, pr-1552 |

Reading: the most common triage error is calling an item actionable when the maintainer labelled it not-actionable or needs-info. The most common review error is missing the known defect. 9 of the 64 cases (7 triage, 2 review) never reached a label because the reply was rejected.

## 3. The format rejections, and the repair round

The 9 rejections split by cause (from the rejection reasons in the report):

- 5 were valid JSON that did not fit the schema (`/proposal must be object`, `/proposal/interfaces must be string`, `/escalation` empty, extra properties `$schema` or `rationale` and `confidence`). The runner's one repair round fired only for unparseable replies, so these had no repair at all.
- 4 were unparseable JSON that still failed after the existing repair round (one was an empty reply).

Change (PR 174, issue #173): `runValidated` now hands the harness a `check` function; the OpenCode repair round also fires when a reply parses but misses the schema, and sends the validator's own message back. Still one round; a second misfit is rejected as before.

Measured on the 9 rejected cases only (re-run, same model and flags): 8 of 9 are now accepted. Of the 7 triage cases, 4 now match the maintainer's label and 3 are accepted but do not match. pr-482 is accepted with 0 of 1 hits and no findings. pr-1552 is still rejected.

Effect on §11: triage agreement would move from 14 of 32 (44%) to about 18 of 32 (56%) and the review counts do not change. That is an estimate from a 9-case re-run, not a full 64-case replay, and it is still far below the 90% bar. The repair round turns rejections into scored answers; it does not make the model more accurate.

## 4. Limits of this baseline

- One run, one model. Run-to-run variance is not measured.
- The set is the maintainer's own labelled history and is not held out, so it cannot also serve as the holdout for tuning (`--split dev|holdout` exists for that).
- No repository context pack for the reviewer. Adding one may change the review numbers; it was not run here.
- The critical-case bar cannot be scored until at least one case is flagged critical.
- Labels are the maintainer's history, not a second reviewer's judgment; a model "disagreement" can be a history error.

## 5. Launchd dispatch test (ADR 0026)

Question: can a scheduler outside GitHub's schedule service start a sweep through `workflow_dispatch`?

- A placeholder `.github/workflows/warden-sweep.yml` (PR 180, issue #179) was merged: `workflow_dispatch` only, `contents: read`, no secret, no sweep work, one step that logs the event, actor, ref and run id. All five CI checks passed, including the zizmor workflow audit.
- A temporary LaunchAgent (`org.taoc.warden-sweep-test`) dispatched the workflow once with the maintainer's own `gh` login. launchd reported exit 0 and one run.
- GitHub's run log for run 46156217120 shows `WARDEN_SWEEP_PLACEHOLDER dispatched event=workflow_dispatch actor=trek-e ref=refs/heads/main`, and the run concluded success.
- The LaunchAgent was then unloaded and its plist deleted; nothing stays scheduled.

Result: the dispatch path ADR 0026 relies on works end to end from launchd on this Mac. Not shown: the real sweep (it needs the App state and a dispatch token from the owner), the timer schedule over several hours, and behaviour while the Mac sleeps. See [ADR 0026](../adr/0026-external-dispatch-for-sweep.md).

## 6. What would move the numbers (not decided)

- A full 64-case re-run with the repair round in place, to replace the 9-case estimate.
- A repository context pack for the reviewer, then a second run to see whether review misses fall.
- A dev/holdout split so a prompt or schema change can be tuned on one half and judged on the other.
- A larger or different model, for the owner to choose; the model is the owner's call.
