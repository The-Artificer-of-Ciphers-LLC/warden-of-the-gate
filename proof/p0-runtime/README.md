# P0 runtime / isolation / lookup proofs (`PROOF-runtime`, `PROOF-lookup`)

**These are evidence spikes, not production modules.** They exist to answer the P0 questions in
[the implementation plan](../../docs/prd/0001-warden-of-the-gate.implementation-plan.md#p0---prove-the-platform-before-building-on-it)
with reproducible commands. Each command prints inputs, versions, observed effects and PASS/FAIL per check,
writes a machine-readable report to `results/`, and exits non-zero on any required failure.

## Run

Prerequisites: Apple-silicon Mac on a tested macOS (27.x; other majors fail closed), Node ≥ 26.13, `opencode` 2.x from
2.2.7 up (`>=2.2.7 <3.0.0`, ADR 0004 amendment 2026-11-27) at `/opt/homebrew/bin/opencode`, Xcode (for the Swift check).
The runtime proof also needs mlx-serve (ddalcu) on `127.0.0.1:11234` serving the model in `.github/warden.yml`'s
`modelPool` (`beamster/Qwen3.8-Flash-Next-Sushi-2bpw`). The proof only reads mlx-serve's `/v1/models`; it never loads or
unloads a model there. Set `WARDEN_PROOF_MODEL_PORT` or `WARDEN_PROOF_MODEL` to point it elsewhere. No remote model, no
API key, no GitHub write token.

```bash
cd proof/p0-runtime
npm ci --ignore-scripts          # pinned: typescript 6.0.3, ajv 8.20.0, scip-typescript 0.6.2, @scip-code/scip 0.10.0
node src/run-all.ts --fast       # isolation + lookup, no model calls (~10 s)
node src/run-all.ts              # + runtime proof with the local model (~25 min on an idle mlx-serve)
node src/proofs/runtime.ts --only=B,C   # any subset of sections A-F
```

| Command | Proves | Report |
| --- | --- | --- |
| `src/proofs/isolation.ts` | **(f)** Seatbelt boundary vs a deliberately hostile repo (npm lifecycle scripts, git hook, test runner, direct code): home credentials, unrelated files, write tokens, workspace escape, network; unknown containment blocks execution; CPU/file/wall limits | `results/isolation.json` |
| `src/proofs/runtime.ts` A | **(a)** supported version recorded, fresh sessions, Ajv-validated structured output | `results/runtime.json` |
| … B | **(b)** tool restrictions (deny-all, resource-scoped shell, external-directory, `ask`, repo-supplied config) | |
| … C | **(c)** resolved provider/model is local; remote resolution rejected; no hosted request when local is down | |
| … D | **(d)** cancellation, crash (SIGKILL) recovery | |
| … E | **(e)** step/output/wall-clock/tool-output/context budgets, measured footprint | |
| … F | OpenCode itself inside the boundary; tool-escalation attempts with every tool permission open | |
| `src/proofs/lookup.ts` | **(g)** compiler definitions/references, revision-bound citations, SCIP candidate, SDK/deployment-target checks, support matrix | `results/lookup.json` |

`results/*.json` in this directory are the reports from the committed run (host, versions, every observed value).

## How to read a report

Every check has `claim`, `expected`, `observed`, `pass`. `severity: "informational"` checks record a measured fact or
a finding and never fail the run. `severity: "unverified"` marks a claim this setup cannot observe; it never passes, never
decides the verdict, and is printed as `UNVERIFIED` so nobody reads it as proven. Negative controls (uncontained run, un-hardened harness, text-search baseline) are
included on purpose: a guard that was never shown to be necessary has not been proven.

## Layout

```
src/lib/seatbelt.ts        Seatbelt profile builder, runGuarded() (self-test canaries before ANY repo code), spawnContained()
src/lib/oc.ts              OpenCode headless driver (isolated XDG state, HTTP API)
src/lib/runtime-common.ts  hardened config + env flags, resolved-provider preflight, Ajv schema, completion waiting
src/lib/proxy.ts           recording, REFUSING egress proxy (observes attempts, forwards nothing); loopback model tap (section D)
src/lib/lookup.ts          TypeScript LanguageService + citation creation/verification
fixtures/hostile-repo      hostile lifecycle payload; fixtures/lookup-repo hand-annotated ground truth
```

Temporary canaries are created under the real `$HOME` (`~/.warden-p0-canary-*`) and removed on exit. The hostile payload
only records errno/length for real credential paths; nothing is printed or copied.

## Committed results (2026-11-18, macOS 27.2.1, OpenCode 2.2.7, typescript 6.0.3)

| Report | Required checks | Informational |
| --- | --- | --- |
| `results/isolation.json` | 27/27 PASS | 1 (memory cap unavailable) |
| `results/runtime.json` | 37/37 PASS (committed A–F run; **sections E,F were later changed and re-run, see below; A–D not re-run since**) | 7 (semantic sanity, reasoning overshoot, read-tool cap, same-session resume hazard, accepted-request fate, model-chosen escalation attempts, measured resources) |
| `results/runtime.partial-EF.json` | E,F re-run (twice): 9/9 required each time (incl. model prerequisite) | 6 each (E1b, E1c, E2b, E3b, E6, F1) |
| `results/lookup.json` | 19/19 PASS | 2 (latency/memory, SCIP occurrence comparison) |

### Findings that change the design (details in ADR 0004/0006/0007 proof records)

1. The harness ships a hosted provider enabled by default and phones home; repo-supplied config can redirect providers. Hardening flags + `provider.use deny` + resolved-model preflight are mandatory.
2. When the configured model is unavailable the harness silently substitutes another one; preflight must compare the resolved model with the expected pool member.
3. A dead local endpoint hangs the session (no error); probe first, enforce wall-clock.
4. Re-prompting a crashed session replays its dangling prompt; recover with a fresh session.
5. No per-process memory cap on macOS; Seatbelt is a deprecated CLI over a supported kernel mechanism; Docker/Apple container backends are unverified here.
6. The harness boundary must allow the model server's port (LM Studio then, mlx-serve now), so candidate-code execution needs a second, network-less boundary.

### Reproducibility correction (E1, F2)

A parent-side re-run of E,F gave 10/13, so the first committed 37/37 was not reproducible. Causes and fixes: **E1** asserted tool counts, but `steps` bounds model steps, not tool calls (a model may batch calls in one step; 5 tools executed in 2 assistant messages was observed). E1 now asserts only steps ≤ 2 and termination; E1b records the finding and E1c shows an adapter-side tool-call budget (informational; nondeterministic, reports exercised/not). **F2** was vacuous when the model ran no commands; it now fails only on a leak/escape and reports "not exercised" otherwise; F3 (harness shell, all commands) is the deterministic coverage. Two consecutive E,F runs after the fix: 9/9 required, 6 informational, identical outcomes (E1b: 1 tool executed, no batching; E1c exercised, interrupted at 2 tool parts; F2 exercised, no leak). Nondeterminism that remains by nature: whether the model batches calls (E1b/E1c) and whether it runs the hostile commands (F1/F2); neither can fail the required count.

## Moving to mlx-serve and OpenCode 2.x (2026-11-28)

The committed results above ran on OpenCode 2.2.7 against LM Studio. The owner moved the Mac to mlx-serve ("we are only
using mlx-serve", 2026-11-28) and OpenCode 2.4.1, so the harness was ported. Every check keeps its claim, with these
changes in how it is observed:

- **A1** checks that OpenCode is inside `>=2.2.7 <3.0.0` and that CLI and server agree, and records the version, instead
  of requiring exactly 2.2.7.
- **Provider id** is `mlx-serve`, as in the Warden adapter (PR #148). OpenCode's built-in `lmstudio` and `ollama`
  providers are always denied, beside the hosted `opencode` provider.
- **Startup**: OpenCode 2.4.x prints "listening" before its providers load. `startServer` and the preflight wait for the
  load, as the adapter does, so no check judges a half-started harness.
- **C0** no longer reads LM Studio's `device` field. It checks that mlx-serve lists the model with no `@peer` or
  `@provider` suffix (mlx-serve's only documented remote marker) and that the process listening on `:11234` is a local
  server, not a forwarder such as `ssh` or `socat` (`lsof`). Like `device`, this is the server's own word: it shows which
  program answers, not where that program forwards (`docs/research/MODEL-CONNECTIONS.md`).
- **D1 and D5** no longer read `lms ps`. Section D reaches mlx-serve through a recording loopback tap, which sees every
  inference stream the harness opens and when the harness hangs up on it. D1 requires every stream open at the interrupt
  to be hung up within 3 s and no new one to start. D5 requires the killed harness's stream to hang up and none to be
  open after recovery.
- **D1b reads mlx-serve's cancelled-request counter.** mlx-serve documents `/metrics.json` (with `--metrics`) but not
  its keys. On the maintainer's build (observed 2026-11-28) it reports `counters.requests_cancelled_total` and
  `gauges.requests_running`. D1b is required when that counter is served: it must rise by at least the number of streams
  the harness hung up, which is mlx-serve's own record that it stopped those requests. Another client's cancel on the
  shared server can only raise the counter, never hide ours. Without the counter, D1b stays UNVERIFIED and is never
  guessed from other keys.
- **Long generation** (2026-11-28 rerun): the Flash model finished a "2000-word essay" in about one second, before the
  interrupt (D1, D2), the kill (D5) or the 8 s budget (E4) could act, so those checks judged nothing. They now ask for
  a count to five thousand in words with a 16384-token output limit (half the served context at most), and D1 and D5 wait
  until the tap sees bytes still arriving on an open stream before they interrupt or kill. D1 and D5 fail if generation
  never starts, so a fast model can no longer pass them or fail them for the wrong reason.
- **C4 compares the resolved model with the configured default.** On 2.2.7 the hardened hosted-default case resolved
  to another LM Studio model OpenCode found by itself, which failed the expected-model check. On 2.4.1 that provider is
  denied and only the expected model is declared, so OpenCode substituted the expected model and the case passed by
  accident. The preflight now also rejects any resolution that differs from the configured default, and the case
  declares a second local model to substitute. This was a gap in the proof, not in the Warden adapter: the adapter
  writes the expected model as the configured default, so "differs from configured" and "differs from expected" are the
  same test there.
- **Isolation** checks the model server port 11234 instead of 1235. If nothing listens there, the proof opens a
  stand-in listener, so `--fast` needs no model server. It connects first and never binds beside a running server.
- **Shared server**: the full runtime run sends its requests to the same mlx-serve the maintainer's agent uses, so both
  are slower while both run. Section D's tap keeps this proof's streams apart from the agent's.

### Not proven

mlx-serve stopping decoding on client hang-up where `/metrics.json` has no cancelled counter (D1b); other macOS majors; Docker/Apple `container`; nested sandboxes (Swift macros); reliability statistics beyond 5 structured runs of one model; CodeGraphContext and Atlas execution (P3); the inbox/writer track (separate session).
