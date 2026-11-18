# PROOF-inbox findings (verdict)

Raw evidence: [RESULTS.md](RESULTS.md) (generated from `results/*.json`). Mechanism: [DESIGN.md](DESIGN.md). Code of record: commit `3c3df5a` plus the later probe/render commit on this branch; sandbox workflows were installed from the same sources.

## Verdict

**The durable inbox, single shared writer and recovery protocol are demonstrated** against the disposable sandbox, with named limits. Dependent P1 work may proceed on this mechanism; the blockers below gate specific P1 items, not the whole phase.

| P0 acceptance item | Result | Where |
|---|---|---|
| Concrete durable intent mechanism independent of the Actions pending queue; one item-ledger authority; no repo ledger file; no always-on DB | **Demonstrated** | DESIGN.md; S01, S09, B1 |
| Documented proof commands report inputs, versions, observed effects, pass/fail | **Done** | README.md; every report carries backend, repo, Node, commit, TTL, per-check observed values |
| Actual serialization, not a concurrency setting or revision number | **Demonstrated, with a stated residual window** | S16, D1 (18 increments from 4 Actions runners + 2 Mac processes, 0 lost; control without the lease lost 11 of 18), S13 |
| Two claims for one issue | **Pass** (offline + live) | S02 |
| Contributor/factory ownership race | **Pass** (live: 3 rounds; offline: 8) | S03 |
| Crash before an effect | **Pass** | S04 |
| Effect applied, reply lost | **Pass** | S05, S15 |
| Duplicate and out-of-order triggers | **Pass** | S06 |
| Interrupted multi-effect application | **Pass** | S07 |
| Actions outage | **Pass** (real: workflow disabled, 5 intents durable, recovered by next trigger) | S08, C1 |
| Triggers exceeding pending-queue capacity | **Pass** (real: 12 doorbells, GitHub cancelled 10, all 12 intents applied once) | S09, B1 |
| No intent silently disappears | **Pass**: every intent ends in applied/rejected/duplicate/failed/quarantined receipt or stays visibly pending | S06, S08, S11, S12 |
| No acknowledged claim has two owners | **Pass**, including the zombie-writer worst case | S02, S03, S13 |
| Global/instance stop visible across Mac and Actions | **Demonstrated**, including cross-repository control in the actual P1 writer | S10, E1; App and production P1 proofs below |

## Things the proof changed (honest surprises)

1. **Milestone titles are not an atomic lock.** The first design used them; parallel creates of one title all succeed (2 to 6 of 6 created per round). The design now uses label names, which were exactly-once in every round (6 of 6, twice). Offline negative control: the same lease over a non-atomic create loses updates.
2. **Comment `PATCH` has no compare-and-swap** (`If-Match` returned HTTP 400), so neither a revision counter nor ETag can be the serialization proof. Git ref advance and variable create are atomic but need wider permissions.
3. **Actions cancels most doorbells.** With the default concurrency group, 12 comment triggers produced 2 successful and 10 cancelled runs. The durable inbox, not the queue, carried all 12 intents. Disabled workflows do not queue events at all, so a scheduled or manual sweep is mandatory.
4. **`GITHUB_TOKEN` cannot read or write repo Actions variables** (HTTP 403), and `vars` is a start-of-run snapshot; stop therefore lives in issue labels with event-derived authority.
5. **Throughput is low and rate-limited.** About 8.5 s per intent sequentially (20 live intents in 171 s, roughly 25 API calls per intent because of fence checks, read-backs and idempotency listings). Combined with other tooling, the proof drove the shared `gh` identity into a **secondary rate limit** (HTTP 403 "temporarily blocked from content creation") after roughly 4,500 calls in one hour (the 5,000/hour budget is shared with other tooling on that login); scenarios S13-S17 failed in the first live run for that reason and were rerun after the limit reset. Both attempts are kept in `results/`. P1 must batch/skip redundant fence lists and budget content creation.
6. **A stale ledger write can land.** A writer frozen after its last pre-write check, past the lease TTL, writes once; the post-write fence catches it, it performs no effect, and the next drain repairs the ledger from receipts (S13b records the regression from `ready` to `claimed` and the repair). This is a bounded, detected window, not a transaction.

## Blockers and unverified items

| Item | Status | Consequence |
|---|---|---|
| GitHub App identity, installation tokens, key custody, revoked-trust-root recovery | Production issuer, scoped issuance/renewal, protected local key and installation-token revocation verified. Trust-root replacement remains a separate unverified gate. | Replacement requires specific owner approval before creating or revoking a key |
| Cross-repository global stop | **Production integration demonstrated:** human CLI stop/resume reaches the private control repository; actual Actions P1 writer halts and acknowledges; revoked reads fail closed | Repo-scoped `GITHUB_TOKEN` cannot substitute for the read-only App token |
| Submit-only versus writer separation | Distinct App submit and Actions writer authors verified; production writer rejects a tampered ledger on HMAC integrity | Permission-level append-only isolation is **not claimed** |
| Second GitHub identity (real contributor vs operator) | **Passed:** S02/S03/S10/S11 with real human and App credentials; supplemental non-operator stop-removal check passed | Both scenario writers ran locally; separate real Actions checks are linked below |
| Scheduled sweep | **Not observed**: no `schedule` run fired in about 1 hour after install | Backstop is demonstrated only via `workflow_dispatch`; treat cron latency as unproven |
| Real Actions/GitHub outage | Simulated by disabling the workflow and by not running the writer | Server-side outage behaviour unverified |
| Read-after-write staleness | 12 trials, no stale first read | Not a bound; safety does not depend on it (atomic create + fence re-check) but the fence's residual window does |
| Scale | Largest live inbox about 60 comments; fake backend 60 intents | Listing cost at hundreds/thousands is extrapolated, not measured |
| Ledger dedupe horizon (256 ops/item) | Designed, tested via compaction | Needs an age-based rejection rule for very late redelivery (P1) |
| Branch protection / rulesets / org policy interactions | Not exercised | Sandbox has none |
| Long soak, clock skew beyond ~0.8 s | Not run | Lease margin chosen, not derived |

## Process notes

* Original proof: no GitHub App, PAT or secret was created. The pilot repo was never touched. No package was published. No real contributor was notified.
* Both original sandbox workflows were independently confirmed **disabled** at App-proof closeout. A later owner-approved, bounded observation temporarily re-enables `p0-writer` solely to look for real scheduled execution and disables it in cleanup. Temporary P0/P1 App-proof workflows/secrets are absent and their fixtures are closed. The approved App and protected local key remain.
* The owner subsequently approved pushing the main-project fix branch; commit `b00cc15` is on `origin/fix/p1-review-2026-11-18`. No PR or merge was authorized or created.

## Owner-approved App proof (2026-11-18)

App `warden-p0-sandbox-app` (ID `5819526`), installation `183378787`, is organization-only and installed on exactly `warden-p0-sandbox` and `warden-p0-control`. Webhooks are off. Maximum permissions: Issues write, Metadata read, Actions read. The private key remains outside the repository in a mode-700 directory, mode-600 file; it was neither printed nor uploaded.

- **Four live scenarios passed:** S02, S03 (three race rounds), S10 and S11 with real human/App credentials. Both scenario writers executed locally. Evidence: [attempt 2](results/live-app-2026-11-18-attempt2.json).
- **Operator authority passed:** the App removed a human operator's stop label, but the event-derived state remained stopped until explicit operator resume.
- **Three real Actions checks passed:** [stopped](https://github.com/The-Artificer-of-Ciphers-LLC/warden-p0-sandbox/actions/runs/44365922879), [resumed](https://github.com/The-Artificer-of-Ciphers-LLC/warden-p0-sandbox/actions/runs/44366003021), [revoked/unknown](https://github.com/The-Artificer-of-Ciphers-LLC/warden-p0-sandbox/actions/runs/44366062454). A control-only read token observed the private control repository; the runner's `GITHUB_TOKEN` could not (404). The control-only token could not read the sandbox (404) or write a control comment (403). After revocation, access returned 401 and the control stayed stopped/unknown, without falling back to another credential. The writer comment author was independently `github-actions[bot]`, distinct from the App submit author.
- **Cleanup verified independently:** all issued tokens were revoked; the temporary `WARDEN_P0_CONTROL_READ_TOKEN` secret and workflow file are absent; App-proof fixtures are closed; both original workflows are `disabled_manually`. [Closeout](results/live-app-2026-11-18-closeout.json).

**Failures are preserved, not converted to green reports.** [Attempt 1](results/live-app-2026-11-18-attempt1.json) exposed a test-fixture assumption: disabling assignment shortened S10's plan and put the pause before its final effect. A failing offline regression was added and the pause moved earlier; writer behavior did not change. Attempt 2 passed all scenarios but dispatched before GitHub registered the workflow. The [Actions-only report](results/live-app-2026-11-18.json) passed all runner checks but recorded a redundant-disable cleanup error against an already-disabled schedule. The harness now waits for registration and verifies state before disabling. Raw reports remain `pass: false`; the closeout records the separately verified outcomes and final state.

**Historical scope:** this P0 proof used the P1 HTTP transport with proof-supplied credentials, not an enabled production GitHub backend. The production integration was subsequently implemented and exercised below; scheduled execution and trust-root replacement remain independently gated.

## Production P1 acceptance (2026-11-18)

The [successful report](results/p1-live-2026-11-18.json) records **17 passing checks, six successful real Actions runs, 19 issued short-lived installation tokens and zero cleanup errors**. Unlike the P0 App proof, it invokes the actual P1 CLI, production App issuer/controller and production serialized writer. All uploaded package sources and the runner/template are hash-bound in the report; the hashes were independently compared with the current source.

- CLI setup creates only approved missing configuration/labels; schema validation succeeds; Intake dry-run proposes a transition with zero repository mutations; Review remains explicitly unsupported.
- Proactive renewal obtains a distinct installation token and records a redacted rotation audit. Each token is scoped to the sandbox with Issues write/Metadata read, or the private control repository with Issues read/Metadata read.
- A crash after the protected journal write but before posting is recovered through `warden journal reconcile`. The real Actions writer applies the note and bound approval request; Mac reconciliation acknowledges matching Actions receipts without becoming a writer.
- A real `trek-e` maintainer comment is turned into an App-submitted intent; the Actions writer verifies its exact source/binding, records the approval, and the CLI's authorization check succeeds. A later material revision update invalidates that approval.
- Explicit human CLI global stop/resume uses the selected, authenticated `trek-e` login. The complete P1 writer reads the other private repository, acknowledges stop and applies no queued effect. Local dry-run is blocked while stopped; resume starts no AI.
- A real edit of an Actions-authored ledger causes the production writer to halt on HMAC integrity. Restoring the original signed bytes allows the pending revision update to drain. This is detective integrity enforcement, not an append-only permission guarantee.
- Revoking the control-read token makes the actual P1 writer halt stopped/unknown, with no repository-token fallback. Live status reports reachable GitHub, credentials, controls, journal and approval fields without exposing secrets or calling a model.
- **Independent cleanup verification:** no sandbox secrets, temporary P1 workflow or open P1 fixtures remain; the control repository has no open fixtures. All test installation tokens were revoked. Uploaded temporary source was removed; the App key was never uploaded.

The [first attempt](results/p1-live-2026-11-18-attempt1.json) retains `pass: false`: all 16 preceding checks and six Actions runs passed, but status treated the sandbox's legacy P0 ledger as a P1 ledger and falsely reported GitHub unreachable. An offline failing regression reproduced it; status now explicitly reports unsupported/foreign/malformed ledgers without adopting them. The corrected full rerun passed. Together the attempts used **38 of the 40 approved tokens**.

Offline checks: **72/72 tests**, package typecheck/build, proof typecheck and whitespace checks passed. Additional red/green regressions cover permission-scope sharing through single-flight/cache, revocation of a cached token, and an in-flight issuer completion trying to overwrite revocation. These injected cases are not claimed as naturally occurring GitHub outages.

**P1 is not declared complete yet:** provider-supported revoked-trust-root replacement needs separate approval and observed evidence. Scheduled execution is being observed independently; a manual dispatch is not a cron result. P2's actual Sweep task and shipped housekeeping/token-delivery workflow are not implemented or activated by this work.
