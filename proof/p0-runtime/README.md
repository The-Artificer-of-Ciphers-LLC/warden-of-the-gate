# P0 runtime / isolation / lookup proofs (`PROOF-runtime`, `PROOF-lookup`)

**These are evidence spikes, not production modules.** They exist to answer the P0 questions in
[the implementation plan](../../docs/prd/0001-warden-of-the-gate.implementation-plan.md#p0---prove-the-platform-before-building-on-it)
with reproducible commands. Each command prints inputs, versions, observed effects and PASS/FAIL per check,
writes a machine-readable report to `results/`, and exits non-zero on any required failure.

## Run

Prerequisites: Apple-silicon Mac on a tested macOS (27.x; other majors fail closed), Node ≥ 26.13, `opencode` v2.2.7 at
`/opt/homebrew/bin/opencode`, LM Studio server on `:1235` with a local model (the runtime proof loads `qwen3.8-27b`
as `warden-proof-qwen` if absent), Xcode (for the Swift check). No remote model, no API key, no GitHub write token.

```bash
cd proof/p0-runtime
npm ci --ignore-scripts          # pinned: typescript 6.0.3, ajv 8.20.0, scip-typescript 0.6.2, @scip-code/scip 0.10.0
node src/run-all.ts --fast       # isolation + lookup, no model needed (~10 s)
node src/run-all.ts              # + runtime proof with the local model (~25 min)
node src/proofs/runtime.ts --only=B,C   # any subset of sections A-F
```

| Command | Proves | Report |
| --- | --- | --- |
| `src/proofs/isolation.ts` | **(f)** Seatbelt boundary vs a deliberately hostile repo (npm lifecycle scripts, git hook, test runner, direct code): home credentials, unrelated files, write tokens, workspace escape, network; unknown containment blocks execution; CPU/file/wall limits | `results/isolation.json` |
| `src/proofs/runtime.ts` A | **(a)** pinned version, fresh sessions, Ajv-validated structured output | `results/runtime.json` |
| … B | **(b)** tool restrictions (deny-all, resource-scoped shell, external-directory, `ask`, repo-supplied config) | |
| … C | **(c)** resolved provider/model is local; remote resolution rejected; no hosted request when local is down | |
| … D | **(d)** cancellation, crash (SIGKILL) recovery | |
| … E | **(e)** step/output/wall-clock/tool-output/context budgets, measured footprint | |
| … F | OpenCode itself inside the boundary; tool-escalation attempts with every tool permission open | |
| `src/proofs/lookup.ts` | **(g)** compiler definitions/references, revision-bound citations, SCIP candidate, SDK/deployment-target checks, support matrix | `results/lookup.json` |

`results/*.json` in this directory are the reports from the committed run (host, versions, every observed value).

## How to read a report

Every check has `claim`, `expected`, `observed`, `pass`. `severity: "informational"` checks record a measured fact or
a finding and never fail the run. Negative controls (uncontained run, un-hardened harness, text-search baseline) are
included on purpose: a guard that was never shown to be necessary has not been proven.

## Layout

```
src/lib/seatbelt.ts        Seatbelt profile builder, runGuarded() (self-test canaries before ANY repo code), spawnContained()
src/lib/oc.ts              OpenCode headless driver (isolated XDG state, HTTP API)
src/lib/runtime-common.ts  hardened config + env flags, resolved-provider preflight, Ajv schema, completion waiting
src/lib/proxy.ts           recording, REFUSING egress proxy (observes attempts, forwards nothing)
src/lib/lookup.ts          TypeScript LanguageService + citation creation/verification
fixtures/hostile-repo      hostile lifecycle payload; fixtures/lookup-repo hand-annotated ground truth
```

Temporary canaries are created under the real `$HOME` (`~/.warden-p0-canary-*`) and removed on exit. The hostile payload
only records errno/length for real credential paths; nothing is printed or copied.

## Committed results (2026-11-18, macOS 27.2.1, OpenCode 2.2.7, typescript 6.0.3)

| Report | Required checks | Informational |
| --- | --- | --- |
| `results/isolation.json` | 27/27 PASS | 1 (memory cap unavailable) |
| `results/runtime.json` | 37/37 PASS | 7 (semantic sanity, reasoning overshoot, read-tool cap, same-session resume hazard, accepted-request fate, model-chosen escalation attempts, measured resources) |
| `results/lookup.json` | 19/19 PASS | 2 (latency/memory, SCIP occurrence comparison) |

### Findings that change the design (details in ADR 0004/0006/0007 proof records)

1. The harness ships a hosted provider enabled by default and phones home; repo-supplied config can redirect providers. Hardening flags + `provider.use deny` + resolved-model preflight are mandatory.
2. When the configured model is unavailable the harness silently substitutes another one; preflight must compare the resolved model with the expected pool member.
3. A dead local endpoint hangs the session (no error); probe first, enforce wall-clock.
4. Re-prompting a crashed session replays its dangling prompt; recover with a fresh session.
5. No per-process memory cap on macOS; Seatbelt is a deprecated CLI over a supported kernel mechanism; Docker/Apple container backends are unverified here.
6. The harness boundary must allow the LM Studio port, so candidate-code execution needs a second, network-less boundary.

### Not proven

Other macOS majors; Docker/Apple `container`; nested sandboxes (Swift macros); reliability statistics beyond 5 structured runs of one model; CodeGraphContext and Atlas execution (P3); the inbox/writer track (separate session).
