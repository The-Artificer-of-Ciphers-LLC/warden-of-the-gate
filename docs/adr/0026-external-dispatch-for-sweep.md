# An outside scheduler starts the sweep through `workflow_dispatch`; GitHub's native schedule is only an optional backup

- **Status:** Accepted (2026-11-28). Replaces the owner's retained P1 scheduling gate (a genuine native `event: schedule` run).
- **Date:** 2026-11-28
- **Decided by:** @trek-e ("Change the gate"), after GitHub Support answered case #5025247
- **Amends:** [ADR 0012](0012-serialized-actions-state-writer.md) (scheduled backstop), [PRD](../prd/0001-warden-of-the-gate.md) §5 Sweep and §12

## Context

P1's exit gate, retained by the owner in the [November 18 handoff](../handoff/2026-11-18-handoff.md) (standing rules 7 and 8), was a genuine native `event: schedule` run of the intended Warden revision. Manual dispatch could not close it.

Four bounded experiments never saw one, in two disposable repositories, with and without Warden code, with workflows installed through the Contents API and through a real `git push` ([FINDINGS](../../proof/inbox/FINDINGS.md), [git-push verification](../../proof/inbox/results/schedule-gitpush-2026-11-18.verification.md)). Every manual `workflow_dispatch` control in the same windows ran and logged its event, and ADR 0012's writer backstop was proven through `workflow_dispatch`.

GitHub Support answered case #5025247 on 2026-11-28. Its findings:

- Nothing on the organization or the account suppresses scheduled runs, and no eligibility or protection state blocks schedules while allowing manual dispatch.
- Scheduled runs are best effort. Since late May 2026 GitHub has a known platform-side problem in the schedule service: high-frequency schedules currently get far fewer runs than the cron asks for, often hours apart, and under enough load some queued runs are dropped rather than delayed. GitHub says improvement work is in progress and on its public roadmap, with no date.
- A 10-minute observation window is too short to show anything at present.
- Committing the workflow through the Contents API rather than a `git push` makes no difference.
- For a workflow that must run at a known interval, GitHub recommends an external scheduler that calls `workflow_dispatch` or `repository_dispatch`, which does not go through the schedule service.

GitHub's own documentation says the same about the trigger: "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped. To decrease the chance of delay, schedule your workflow to run at a different time of the hour." ([Events that trigger workflows, `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)). A `workflow_dispatch` run is started by a REST call, `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`, with a required `ref`; a fine-grained token needs the "Actions" repository permission (write), and a classic token the `repo` scope ([Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)). The workflow must be on the default branch, and running one by hand or from the GitHub CLI needs write access to the repository ([Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)).

So the old gate asked for evidence that GitHub itself says it cannot promise, and its absence says nothing about Warden.

## Decision

- **The P1 scheduling gate is changed.** It no longer asks for a native `event: schedule` run. It asks that the sweep can be started by `workflow_dispatch` from a scheduler outside GitHub's schedule service, and that sweeps are idempotent. Both are already shown (below), so this gate no longer blocks P1 closeout. The rest of the P1 closeout against the [implementation plan](../prd/0001-warden-of-the-gate.implementation-plan.md) is unchanged.
- **The sweep's primary trigger is `workflow_dispatch` from an external scheduler.** For the MVP that scheduler is a `launchd` LaunchAgent on the operator's Mac running `gh workflow run warden-sweep.yml --repo OWNER/REPO` with the operator's own GitHub CLI login ([quickstart](../quickstart.md) section 6). Any other scheduler that can call the REST endpoint above works the same way. Warden creates no token and asks for no new App permission for this.
- **GitHub's native `schedule` stays only as an optional backup.** It is commented out in the [sweep example](../../packages/warden/templates/workflows/warden-sweep.yml.example). An operator who turns it on keeps it infrequent and off the top of the hour, and nothing in Warden relies on when, or whether, it fires.
- **Sweeps are idempotent, so a late, dropped or duplicate run does no harm and a later run catches up.** A sweep is level-triggered: it works out what is due from the recorded clocks at the moment it runs, not from what started it, so a late run does the overdue work and a dropped run is covered by the next one. Intents carry a content-derived `opid` (ADR 0012), so a duplicate submission produces one effect; a planned nudge is not planned again; the writer re-checks author activity at decision time, so a stale closure loses. Evidence: `packages/warden/test/sweep-writer.test.ts` ("a replayed sweep intent is idempotent: one closure, one comment", "the same nudge is not planned again", "stale closure loses"). The sweep workflow's `concurrency` group with `cancel-in-progress: false` keeps two sweeps from running at once.
- **A missed sweep is visible.** Each sweep that runs to completion records itself (`last-sweep.json`), `warden status` shows the last one, and PRD §5's alert for a sweep missing beyond the configured interval applies whatever the trigger.

## Consequences

- P1's scheduling question is settled on documented platform behavior and evidence Warden already has, instead of waiting on a provider fix with no date.
- **The MVP trigger needs the Mac to be awake or asleep, not off.** `launchd` starts a `StartCalendarInterval` job when the Mac wakes if it was asleep at the scheduled time, coalescing missed times into one run; if the Mac was off, the job waits for its next time ([Apple, Scheduling Timed Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)). The sweep job itself still runs on GitHub Actions without the Mac's state or inference, as plan P2 requires. An operator who needs sweeps while the Mac is off turns on the native backup or runs the same `gh workflow run` call from an always-on host.
- The `gh` login used by the LaunchAgent needs write access to the repository. It is the operator's credential, kept by the GitHub CLI, never by Warden or a model session.
- If the native backup is turned on in a public repository, GitHub disables scheduled workflows after 60 days without repository activity (same `schedule` documentation). The dispatch path does not depend on that schedule.
- The disposable-sandbox workflows and support records stay as historical evidence; their raw reports are not edited.
- Still open independently, unchanged by this ADR: the product sweep and event workflows have not yet been installed and run on a real runner (gap inventory P2.15, P2.17).
