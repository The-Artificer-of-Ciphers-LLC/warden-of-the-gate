# PROOF-inbox (P0 work items 1 and 2)

Throwaway spike that proves, or fails to prove, the durable inbox / single shared writer / recovery guarantees the PRD requires before live posting. **Evidence, not a production module.** Design: [DESIGN.md](DESIGN.md). Outcome: [RESULTS.md](RESULTS.md).

TypeScript with erasable syntax only, run directly by Node (22.18+; developed on 26.13). No runtime dependencies, no build step.

## Safety

* `GithubStore` refuses every repository except `The-Artificer-of-Ciphers-LLC/warden-p0-sandbox` (hard-coded guard; `WARDEN_P0_REPO` cannot widen it).
* Original proof authority: the operator's existing `gh` login (`gh auth token`) on the sandbox only, and the per-run `GITHUB_TOKEN` inside sandbox workflows. No GitHub App, PAT or repository secret was created during that original proof. The separately approved App proof below uses scoped installation tokens and one temporary Actions secret.
* Fixtures are issues titled `[P0 proof] ...` / `warden-*`, closed when a run ends; labels named `warden-lock-epoch-*` are the lease and are garbage-collected.
* The pilot repo is never referenced.

## Commands

```bash
cd proof/inbox
npm run typecheck                           # needs @types/node (not vendored): npm i -D typescript @types/node
node src/cli.ts probe                       # GitHub capability probes (what the design relies on, observed)
node src/cli.ts scenarios --backend fake    # all scenarios offline, deterministic, ~25 s
node src/cli.ts scenarios --backend github --out results/live-github-scenarios.json   # same scenarios against the sandbox
node src/cli.ts scenarios --backend fake --only S13   # a single scenario
```

Every run prints per-scenario PASS/FAIL to stderr and a machine-readable report (inputs, versions, observed values, per-check pass/fail) to `--out`. Exit code is non-zero if anything fails.

Actions-side proof (needs the sandbox installed once):

```bash
node src/cli.ts setup                       # creates inbox/control/global/item/counter issues, writes proof-config.json
scripts/install-sandbox.sh                  # pushes src + workflows into the sandbox repo (refuses any other repo)
node src/cli.ts actions-proof --out results/live-actions.json
node src/cli.ts status                      # pending, receipts, lease, stop state + which environments acked
```

## Owner-approved App proof

`src/app-live-proof.ts` is a separate, explicitly live proof for the approved `warden-p0-sandbox-app` installation. It is not the production credential issuer and does not enable the P1 CLI's GitHub backend.

```bash
node src/app-live-proof.ts --live ~/.warden-p0/warden-p0-sandbox-app-2026-11-18-replacement.pem
# Retry just the runner checks after separately recorded scenario results:
node src/app-live-proof.ts --live ~/.warden-p0/warden-p0-sandbox-app-2026-11-18-replacement.pem --actions-only
```

Requires explicit owner approval for both tokens and the temporary Actions resources:

- The key stays outside the repository in the protected directory, mode 600; its contents are never printed or uploaded.
- A sandbox-only installation token has Issues write and Metadata read. A separate control-repository-only token has Issues read and Metadata read. Tokens last at most one hour and remain in memory, except for the control-read token's approved temporary sandbox secret `WARDEN_P0_CONTROL_READ_TOKEN`.
- S02/S03/S10/S11 use real human/App credentials instead of routing every actor through one login. Both scenario writers execute locally; their `env` names do not prove execution on an Actions runner. A supplemental check exercises non-operator App removal of an operator's stop.
- The temporary, dispatch-only `p0-app-proof.yml` runs on a real Actions runner. It checks cross-repository control while stopped, after explicit resume, and after token revocation; verifies that `GITHUB_TOKEN` cannot read the control repository; rejects writes with the read-only App token; and confirms the writer's distinct `github-actions[bot]` author.
- Cleanup revokes tokens, deletes the temporary secret and workflow file, closes fixtures, and disables the existing sandbox writer schedule. Any cleanup error fails the report. The approved App and its protected local key remain for subsequent work.

The script writes non-secret evidence to `results/live-app-2026-11-18.json`, with its execution scope, source hashes, scenario checks, Actions run URLs and cleanup errors. Preserve an existing report under an attempt filename before retrying; the script refuses to overwrite it, an existing secret or an existing workflow. It waits for workflow registration, dispatches by workflow ID, and verifies disabled state during cleanup. It uses the P1 `HttpStore` with proof-supplied credentials; this is not a production issuer or full P1 live acceptance result.

The November 18 run passed four live scenarios and three real Actions checks across separate attempts. The raw reports retain their failed assertions and orchestration/cleanup errors; the independent final-state verification and remaining gates are in [`live-app-2026-11-18-closeout.json`](results/live-app-2026-11-18-closeout.json) and [FINDINGS.md](FINDINGS.md). An Actions-only result never claims the scenarios were rerun.

## Owner-approved production P1 acceptance

The separate harness exercises the actual P1 CLI, issuer/controller and serialized writer, not the P0 writer:

```bash
# Repository root; requires the owner's specific live-token and temporary-resource approvals:
node proof/inbox/src/p1-live-proof.ts --live ~/.warden-p0/warden-p0-sandbox-app-2026-11-18-replacement.pem
```

Only the two disposable repositories are used. App installation tokens have a one-hour maximum and the same narrow repository/Issues scopes as above; the batch budget is 40, including preserved attempts. Tokens remain in memory except for the approved temporary submit/control-read Actions secrets. A third temporary secret is a random writer-only ledger HMAC key; the App private key is never uploaded. The temporary, dispatch-only workflow uses the explicitly selected runner token as the distinct writer identity.

The harness uploads a source-hashed copy of the P1 package to `.warden-p1-proof/` in the sandbox, checks actual CLI setup/config/dry-run/status, proactive renewal, journal recovery, bound maintainer approval, global stop/resume, tamper rejection and revoked-control fail-closed behavior, then removes the code/workflow/secrets, revokes installation tokens and closes fixtures. Existing resources are not overwritten. Original lease-epoch metadata remains governed by the shared lease protocol; newly created projection labels are removed. A failure or cleanup error fails the report; old reports are never rewritten as successes.

`src/schedule-proof.ts --live` separately enables the original sandbox writer, waits at most 59 minutes for a successful **schedule-triggered** run, and disables it in cleanup. A manual dispatch does not satisfy this check. Neither proof implements the P2 Sweep task or authorizes production AI.

After a failed, finished original observation and **separate owner approval**, `--live --off-peak` temporarily re-registers the same sandbox workflow at `7,22,37,52 * * * *` with the verified personal commit identity. It checks live disabled state before editing, observes for at most 56 minutes to reserve cleanup time, verifies the successful scheduled run's actual workflow revision, restores the exact original workflow, and confirms disabled state again. Cleanup waits boundedly for status/source propagation and refuses to overwrite a concurrent owner edit. The report's `registeredActor` records GitHub's linked commit author, not otherwise-unobservable internal scheduler attribution. Both timing and attribution change, so success cannot isolate either as the original cause.

For a capability check rather than a longer observation, the owner requested `--live --rapid`: GitHub's minimum supported five-minute interval, offset as `2/5 * * * *`, with a **10-minute maximum** and the same early-success and restoration/disable safeguards. It writes `results/schedule-rapid-2026-11-18.json`. The longer window is a timeout, never a required duration or timing-accuracy assertion. GitHub may still delay or drop events; shortening the test does not make delivery guaranteed.

The original [failed observation](results/schedule-2026-11-18.json) remains failed; its [independent closeout](results/schedule-2026-11-18-closeout.json) records the verified disabled state after an immediate status-read discrepancy. The approved off-peak diagnostic writes its own report and never overwrites that evidence.

## Owner-approved trust-root recovery

`src/p1-root-proof.ts` has two ordered modes, each taking the original and replacement key paths: `--validate-replacement` verifies both roots before revocation; `--recover` runs only after the owner-approved original-key revocation. Creating a replacement and deleting the original are separately authorized GitHub administrative actions, not actions performed by this script.

The recovery proof uses the actual CLI, issuer/controller and HTTP store to check original-key HTTP 401, persisted revocation across cold starts, replacement configuration without implicit recovery, explicit operator acknowledgement, authorized reads, and installation-token revocation plus a second explicit acknowledgement. Read-only polling allows at most one minute for provider revocation propagation, without issuing a replacement token. Cleanup revokes all issued tokens and removes its unique temporary local profile. Public-key fingerprints, HTTP status observations and redacted lifecycle events are evidence; key/token values are never written to reports.

The separate approval allowed six sandbox-only, one-hour Issues-write/Metadata-read tokens across validation and recovery attempts; five were issued and revoked. Reports are never overwritten, and prior root-proof reports count against that batch ceiling. The [results and preserved failed attempt](FINDINGS.md#trust-root-replacement-and-recovery-2026-11-18) are already recorded; rerunning is not implicitly authorized. The original key is now revoked; the `-replacement.pem` file is the only valid sandbox signing key.

## Scenario index

| Id | Exercises |
|---|---|
| S01 | baseline claim: admission, decision, effects, receipt, single ledger |
| S02 | two claims for one issue, two concurrent writers (Mac + Actions) |
| S03 | contributor vs factory ownership race, repeated |
| S04 | crash before an effect; lease takeover; exactly-once effects |
| S05 | effect applied but reply lost; crash after effect before progress record |
| S06 | duplicate and out-of-order triggers |
| S07 | interrupted multi-effect application |
| S08 | Actions outage: intents durable and visible, no local mutation fallback |
| S09 | trigger flood beyond pending-queue capacity |
| S10 | instance/global stop, stop mid-plan, operator authority, fail closed, resume |
| S11 | admission: authz, edited, forged, oversize, malformed |
| S12 | retry bound and persisted attempt budget |
| S13 | zombie writer past lease expiry: fenced, stale write detected, repaired |
| S14 | zombie ledger creation; competing ledger fails closed |
| S15 | Mac write-ahead journal: crash, lost reply, reconcile |
| S16 | overlap proof: lost updates without lease, none with; non-atomic primitive control |
| S17 | retention/compaction and late redelivery |

## Reading the results honestly

* `fake` proves the *protocol logic* under injected crashes, lost replies and pauses. It models GitHub semantics (atomic label create, comment ids, event actors) that the `probe` and the live run verify against the real service.
* `github` proves the same scenarios against the real API with one identity (so author-versus-operator distinctions that need a second login are exercised only in `fake` or from inside Actions, where the actor is `github-actions[bot]`).
* Neither is a proof of distributed linearizability. See "Residual window" in DESIGN.md.
