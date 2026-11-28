# Proposal: controlled git-push comparison for the P1 scheduling gate

> **Superseded 2026-11-28.** The comparison ran on 2026-11-18 (handoff addendum 7, negative), GitHub Support later confirmed the commit method makes no difference, and the owner changed the gate to external `workflow_dispatch` ([ADR 0025](../adr/0025-external-dispatch-for-sweep.md)). Kept as a historical record.

**Status: PROPOSED, NOT APPROVED, NOT RUN.** Nothing in this document has been executed. The owner must approve the specifics below (or change them) before the agent builds or runs anything live. Written 2026-11-18 while GitHub Support case #5025247 has no reply.

## Why this experiment

The handoff names three untested hypotheses for why no native `event: schedule` run has ever been observed. One is "Contents API commits versus an actual verified-user git push affect registration"; no controlled comparison exists. This is the only listed hypothesis that can be tested inside the existing private repos without creating anything new. It is a **discriminating experiment, not a fix**: GitHub documents scheduling as best-effort, one trial is not a rate, and a failure here changes nothing about the gate.

## What would run

| Item | Specifics |
|---|---|
| Actor | The agent, running one new script with the owner's existing `gh` login (`trek-e`) and the owner's existing local git credentials. No App token, no new token, no repository secret, no new credential of any kind. |
| Repositories | The two existing private repos only: `The-Artificer-of-Ciphers-LLC/warden-p0-sandbox` and `The-Artificer-of-Ciphers-LLC/warden-p0-control`. No new repository, no visibility change, no outside-org repo, no pilot repo. |
| Change | One file in each: `.github/workflows/p1-cron-minimal.yml`, byte-identical to the previously tested workflow (blob `013aaace843aeeabbd069596dbabe846c38f802a`): cron and manual triggers, `permissions: {}`, one step that logs its trigger event. **Difference from the earlier test:** it is installed by a real `git commit` + `git push` to `main` (author and committer `trek-e <trekkie@nomorestars.com>`), not by the Contents API. |
| Controls | One manual dispatch per repo to prove the runner works, as before. |
| Duration | Hard maximum 10 minutes after the push, early success allowed, cron at the documented 5-minute minimum interval. |
| Compute | A few seconds of Actions time per run; no inference, no Mac work. |
| Cleanup | Disable the workflow, cancel active runs, delete the file by a second `git push`, then independently verify: file absent on `main`, workflow disabled, no active runs. Any cleanup error is recorded, not hidden. |
| Evidence | A new report file (`proof/inbox/results/schedule-gitpush-<date>.json`), never overwriting earlier reports. Raw results are kept whether they fail or pass. |
| Code to write first (offline) | A copy of `proof/inbox/src/schedule-minimal-proof.ts` that installs and removes through `git` instead of the Contents API, with the same safety asserts (refuse to overwrite an existing workflow, refuse if the earlier workflows are not disabled, interruption cleans up) and offline tests for those safety paths. |

## How to read the result

- **A genuine `event: schedule` run appears after the git push but never did via the API:** supports the commit-method hypothesis. It still does not close the gate on its own; the original requirement is a genuine scheduled run executing the intended Warden revision, with verified cleanup.
- **Manual controls succeed, no schedule run:** the commit method is not the discriminator (one trial only). The support case remains the route.
- **Manual control fails or cleanup fails:** the run is reported as failed with the raw record; nothing is retried automatically.

## Constraints and risks to weigh

- **The support case asks that repository workflows not be modified without separate owner approval.** Running this while the case is open could alter what GitHub's engineers observe. The owner may prefer to tell GitHub (one follow-up comment on #5025247) first, or to wait.
- The handoff forbids unchanged timer-only retries. This differs in exactly one variable (commit method), which is why it is a candidate; the owner decides whether that is enough.
- The earlier approvals are consumed. This needs a fresh yes.
- If the owner does not want the agent to use the owner's local git credentials, the experiment cannot run as written.

## What the agent will not do without a separate yes

Expand repositories, change cadence or duration, retry, leave any workflow installed or enabled, use an App token, re-enable the original `p0-writer`/`p0-overlap` workflows, or treat a pass as closing P1.
