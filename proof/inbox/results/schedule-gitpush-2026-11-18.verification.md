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
