# Independent verification of the git-push comparison run (2026-11-18)

The raw report `schedule-gitpush-2026-11-18.json` is preserved unchanged. This file is the separate record of what was checked afterwards, by hand, not by the harness.

## Outcome: INCONCLUSIVE (the experiment did not test its hypothesis)

- Raw report: `pass: false`, `error: "Error: spawnSync git ETIMEDOUT"`, no `symptom`, no manual control and no scheduled run recorded; run time 22:21:44 to 22:22:33 UTC (about 48 s, consistent with the harness's 45 s per-git-command timeout).
- Sequence in the sandbox case: the local clone and the local commit (`963655b7161fd6ac9bfb3da9d06259dcbaee29ca`, local only) succeeded; the `git push` to `main` then exceeded 45 s and was killed. The control repository was never reached.
- **No workflow was ever installed on either remote**, so no registration, no manual control and no schedule observation happened. This says nothing for or against the commit-method hypothesis.
- Cause of the push timeout: **unknown**. Read-only checks afterwards did not reproduce it: `git ls-remote` under the same environment took 0.4 s; a throwaway clone of the control repo and a `git push --dry-run` completed in about 0.5 s each; no global hooks path, no signing configuration and no repository hooks were found; the SSH identity greets as `trek-e`. A real push has not been re-attempted: the approval for one trial is consumed.

## Independent cleanup verification (after the run, 2026-11-18)

| Check | Sandbox `warden-p0-sandbox` | Control `warden-p0-control` |
|---|---|---|
| `.github/workflows/p1-cron-minimal.yml` on `main` | absent (HTTP 404) | absent (HTTP 404) |
| Head of `main` | `461b651e` (unchanged from before the run) | `b0811813` (unchanged from before the run) |
| Newest Actions run | `44387159987`, 2026-11-18T20:04Z (the earlier minimal test) | `44387174648`, 2026-11-18T20:04Z (the earlier minimal test) |
| Workflows listed | `p0-overlap` and `p0-writer`, both `disabled_manually` | none |
| Local temporary clones | removed by the harness; none found | removed by the harness; none found |

Nothing was left installed, enabled or running, and no commit reached either remote. No App token, secret or new credential was used.

## What this does not change

The P1 scheduling gate remains open. Support case #5025247 has no reply. Any second attempt, including a diagnostic real push to find the timeout cause, needs a fresh explicit approval.

## Follow-up: owner-approved single diagnostic push (2026-11-18, after the run above)

The owner approved one tiny live diagnostic to find why the push hung: create a throwaway branch (not `main`) in `warden-p0-control` containing one harmless text file (`DIAGNOSTIC.txt`; no workflow, no schedule), push it by `git` over the `trek-e` SSH identity under the harness's exact conditions (BatchMode, `GIT_TERMINAL_PROMPT=0`, piped stdio, 45 s limit, `ssh -v` for diagnostics), then delete the branch. Script kept outside the repo; one trial; never repeated.

| Step | Result |
|---|---|
| clone (depth 1, `main`) | 491 ms, ok |
| branch, add, commit as `trek-e <trekkie@nomorestars.com>` with the Copilot trailer | 17 / 11 / 18 ms, ok |
| `git push origin HEAD:refs/heads/diag/gitpush-timing-2026-11-18` | **1,096 ms, exit 0**; GitHub replied with its usual pull-request hint |
| delete branch (GitHub API) | ok; branch confirmed gone |

SSH offered the agent's ED25519 key and GitHub accepted it. **The earlier 45 s timeout was therefore not reproduced**: a push over the same identity and environment is fast. What differs from the failed run is only the target (the default branch `main`, with a commit that adds a workflow file under `.github/workflows/`). Whether either of those caused the stall, or it was a one-off network or agent stall, is **not established**; no further experiment was run.

Independent verification afterwards: `warden-p0-control` has only branch `main` at `b0811813` (unchanged), no `diag/*` refs, no workflows, newest Actions run still `44387174648` from the earlier test, no temporary clone directories remaining. The sandbox repository was not touched by the diagnostic.

The P1 scheduling gate remains open. A second attempt of the comparison itself (the workflow push to `main`) needs a fresh explicit approval, and the support case #5025247 still has no reply.

## Attempt 2 (owner approved one more comparison; raw report `schedule-gitpush-2026-11-18.run2.json`, preserved unchanged)

- Sandbox: installed by `git push` and one manual control dispatched (run `44412902121`, 22:34:44 UTC, success). Then the **control repository's `git push` stalled for 90 s and was killed**; no observation window opened and no schedule evidence exists.
- The harness's own cleanup then failed for the sandbox file removal (`git pull`: `ssh: connect to host github.com port 22: Operation timed out`). The disable and cancel steps had already succeeded.
- **Independent check at 22:36 UTC found the sandbox workflow file still on `main` (commit `986dfd30`) and the workflow disabled; the control repo clean (head `b0811813`, file absent).** The leftover was removed by the agent through the HTTPS Contents API (cleanup only, content verified byte-identical to blob `013aaace…`, commit `d0193b93`, author/committer `trek-e`), then verified: file absent (404), workflow list shows only `p0-overlap` and `p0-writer` (both `disabled_manually`), 0 in-progress and 0 queued runs, control repo untouched.
- **Cause of both stalls: found.** From this machine `github.com:22` is unreachable right now (`nc` to port 22 timed out 3 of 3 times and the harness log shows `Operation timed out`), while `ssh.github.com:443` is reachable and authenticates as `trek-e`. A push of one text file to a throwaway branch had succeeded earlier (1.1 s), so port 22 is intermittently blocked by this network, not by GitHub, the repos or Warden. Attempt 1's `ETIMEDOUT` on the sandbox push is consistent with the same cause (not proven for that specific moment).
- Consequence: attempts 1 and 2 are **infrastructure failures, not negative results**. They say nothing about whether the commit method affects schedule registration.
- Next: the owner's broad approval ("do what is needed to figure this out, I approve running whatever you see fit") covers a third attempt over SSH port 443 with GitHub's published host keys in a temporary `known_hosts` (the owner's `~/.ssh` is not modified), within the same two private repos and the same 10-minute bound.

## Attempt 3 (SSH over port 443; raw report `schedule-gitpush-2026-11-18.run3.json`, preserved unchanged)

**Outcome: valid trial, negative for the commit-method hypothesis in this one bounded window.** Run 22:38:55 to 22:49:05 UTC.

- Both private repos received the byte-identical workflow (blob `013aaace…`) through a real `git commit` + `git push` over the `trek-e` SSH identity (route `ssh.github.com:443`; host keys from GitHub's `/meta` endpoint in a temporary `known_hosts`; every git step succeeded, pushes about 1 s each; no stall).
- Registration worked: workflow ids `423051691` (sandbox) and `423051766` (control).
- **Manual controls: 2/2 success** (sandbox run `44413586042` at 22:39:02Z, control run `44413596718` at 22:39:06Z; the logs show `event=workflow_dispatch`).
- **Native schedule runs observed: 0/2** over the roughly 10-minute window at the documented 5-minute minimum cadence (cron `2/5 * * * *`, so expected slots around :42, :47 and :52 minute marks relative to the install).
- Install commits were **unsigned** (`verification.verified` false for both): this tested real-git-push-as-`trek-e`, not a GPG- or SSH-signed "verified" commit.
- Per-step timing is in the report (`gitSteps`, all exit 0, none timed out).

### Independent cleanup verification (after attempt 3)

| Check | Sandbox | Control |
|---|---|---|
| `.github/workflows/p1-cron-minimal.yml` on `main` | absent (HTTP 404) | absent (HTTP 404) |
| Head of `main` | `c4764f52` (install `ed6737b6` then removal) | `330c01b2` (install `3d8131d3` then removal) |
| Workflows listed | `p0-overlap`, `p0-writer`, both `disabled_manually` | none |
| Newest Actions runs | only the manual control above (no schedule runs) | only the manual control above |
| In-progress runs | 0 | 0 |

### What this establishes and does not

- Combined with the earlier minimal API-commit test (20:04 to 20:14 UTC, 0/2 scheduled) and the original observations, **installing by git push instead of the Contents API did not make a native schedule run appear in a 10-minute window**. It is one trial per method, and GitHub documents scheduling as best-effort, so this narrows but does not eliminate the commit-method hypothesis (an unsigned commit, a short window and a single `2/5` cron form were used).
- The two earlier stalls (attempts 1 and 2) were this network blocking `github.com:22`, not GitHub; they are not results.
- The remaining untested differences are listed in the handoff (organization-specific eligibility, account-level scheduling behavior, a longer observation window, other cron forms). The P1 gate is still open and support case #5025247 is still unanswered.
