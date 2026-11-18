# PROOF-inbox (P0 work items 1 and 2)

Throwaway spike that proves, or fails to prove, the durable inbox / single shared writer / recovery guarantees the PRD requires before live posting. **Evidence, not a production module.** Design: [DESIGN.md](DESIGN.md). Outcome: [RESULTS.md](RESULTS.md).

TypeScript with erasable syntax only, run directly by Node (22.18+; developed on 26.13). No runtime dependencies, no build step.

## Safety

* `GithubStore` refuses every repository except `The-Artificer-of-Ciphers-LLC/warden-p0-sandbox` (hard-coded guard; `WARDEN_P0_REPO` cannot widen it).
* Authority used: the operator's existing `gh` login (`gh auth token`) on the sandbox only, and the per-run `GITHUB_TOKEN` inside sandbox workflows. **No GitHub App, PAT or repository secret was created.**
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
