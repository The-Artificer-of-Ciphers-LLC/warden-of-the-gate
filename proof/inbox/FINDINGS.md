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
| Global/instance stop visible across Mac and Actions | **Instance + same-repo global demonstrated; cross-repo control mechanism demonstrated in the later App proof. Full P1 writer integration remains unverified.** | S10, E1; App proof below |

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
| GitHub App identity, installation tokens, key custody, revoked-trust-root recovery | **Partially verified:** approved App, scoped issuance, protected local key and installation-token revocation proved below. Trust-root rotation/recovery remains unverified. | Production issuer/renewal and recovery still require implementation and live acceptance |
| Cross-repository global stop | **Mechanism demonstrated:** Mac and real Actions runner read control state with a control-only App token; revoked access fails closed | Full P1 writer integration still needs live acceptance; repo-scoped `GITHUB_TOKEN` cannot substitute |
| Submit-only versus writer separation | Distinct App submit and Actions writer authors verified; permission-level append-only isolation is **not claimed** | P1's author/edit/HMAC detection and repair still need live acceptance |
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
* Both original sandbox workflows are now independently confirmed **disabled**. The later App-proof fixtures are closed, and its temporary workflow and secret are absent. The approved App and protected local key remain.
* No main-project push or PR was made for the App proof. Only the specifically approved temporary sandbox workflow was installed and removed.

## Owner-approved App proof (2026-11-18)

App `warden-p0-sandbox-app` (ID `5819526`), installation `183378787`, is organization-only and installed on exactly `warden-p0-sandbox` and `warden-p0-control`. Webhooks are off. Maximum permissions: Issues write, Metadata read, Actions read. The private key remains outside the repository in a mode-700 directory, mode-600 file; it was neither printed nor uploaded.

- **Four live scenarios passed:** S02, S03 (three race rounds), S10 and S11 with real human/App credentials. Both scenario writers executed locally. Evidence: [attempt 2](results/live-app-2026-11-18-attempt2.json).
- **Operator authority passed:** the App removed a human operator's stop label, but the event-derived state remained stopped until explicit operator resume.
- **Three real Actions checks passed:** [stopped](https://github.com/The-Artificer-of-Ciphers-LLC/warden-p0-sandbox/actions/runs/44365922879), [resumed](https://github.com/The-Artificer-of-Ciphers-LLC/warden-p0-sandbox/actions/runs/44366003021), [revoked/unknown](https://github.com/The-Artificer-of-Ciphers-LLC/warden-p0-sandbox/actions/runs/44366062454). A control-only read token observed the private control repository; the runner's `GITHUB_TOKEN` could not (404). The control-only token could not read the sandbox (404) or write a control comment (403). After revocation, access returned 401 and the control stayed stopped/unknown, without falling back to another credential. The writer comment author was independently `github-actions[bot]`, distinct from the App submit author.
- **Cleanup verified independently:** all issued tokens were revoked; the temporary `WARDEN_P0_CONTROL_READ_TOKEN` secret and workflow file are absent; App-proof fixtures are closed; both original workflows are `disabled_manually`. [Closeout](results/live-app-2026-11-18-closeout.json).

**Failures are preserved, not converted to green reports.** [Attempt 1](results/live-app-2026-11-18-attempt1.json) exposed a test-fixture assumption: disabling assignment shortened S10's plan and put the pause before its final effect. A failing offline regression was added and the pause moved earlier; writer behavior did not change. Attempt 2 passed all scenarios but dispatched before GitHub registered the workflow. The [Actions-only report](results/live-app-2026-11-18.json) passed all runner checks but recorded a redundant-disable cleanup error against an already-disabled schedule. The harness now waits for registration and verifies state before disabling. Raw reports remain `pass: false`; the closeout records the separately verified outcomes and final state.

**Still gated:** no scheduled sweep was observed; the production App issuer/renewal and revoked-trust-root recovery remain unimplemented/unverified; full P1 CLI/writer/approval/journal and tamper-detection acceptance has not run live. This proof used the P1 HTTP transport with proof-supplied credentials, not an enabled production GitHub backend.
