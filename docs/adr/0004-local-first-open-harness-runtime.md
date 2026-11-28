# All AI work runs locally on a local-first model pool, through open harnesses

- **Status:** Draft
- **Date:** 2026-11-16 (revised from 2026-11-11; amended 2026-11-27, OpenCode version range)
- **Decided by:** @trek-e

## Context

The first design ran all AI work in one vendor's agent on the maintainer's machine, under the constraint "I cannot afford API calls for open source maintenance." The owner then directed an open-harness, local-first design (ratified 2026-11-15 as a POC): the constraint was never "no API key" literally — it is no *unbudgeted* per-token spend.

## Decision

- No design element makes an unbudgeted model call. MVP inference is local-only; a remote high-end tier is a later explicit per-task opt-in with budgets, never a silent fallback (ADR 0007).
- All AI work runs through open harnesses. The MVP first validates OpenCode on a maintainer-operated Mac using LM Studio or another explicitly configured local OpenAI-compatible inference service. Pi is a later adapter; Bionic is an optional interactive surface. No vendor-locked agent is a Warden platform.
- MVP AI runs are manually triggered, once-through scans, not recurring local polling. Event-driven GitHub webhooks follow MVP validation. Scheduled and real-time operation remain later configuration directions rather than MVP daemon requirements.
- GitHub Actions only does non-AI work: intake labels, claims, stale timers, nudges, ledger dates, metrics.
- Each batch handles items one at a time in fresh sessions, with an item cap and turn limits.

## Consequences

- AI runs happen only while the machine is on and a run is explicitly invoked in the MVP. Bookkeeping can queue work while it is off.
- Throughput is bounded by local compute (VRAM/context), not a vendor subscription; the runner preflights that a batch fits.
- Actions labels and queues new work using deterministic rules without waiting for local AI availability.
- Review uses prefetched inputs and restricted read-only tools. Any candidate-code execution requires an actual OS/container boundary without home credentials, unrelated files or unrestricted network; a worktree alone is not isolation. Never blindly execute an abandoned fork branch.
- The runner rejects any resolved non-local provider/model in MVP. Local unavailability preserves pending work and reports the failure rather than selecting a remote model.
- A lightweight Discord/credential helper may remain available without triggering AI scans. CI/approval updates can reevaluate already-reviewed gates without model inference.

## Amendment 2026-11-27: OpenCode is a 2.x range, not one pinned build

Owner ruling (@trek-e, 2026-11-27), in his words: "open code is 2.4.1 we need to not pini to that 2.2.7 version should pin to 2.x.x".

- The OpenCode adapter accepts any **2.x release at or above 2.2.7** (`>=2.2.7 <3.0.0`). 1.x, 3.0.0 and later, and 2.x releases below 2.2.7 are refused at preflight with the reason named. The floor stays at 2.2.7 because that is the only version the P0 proofs below ran on.
- Each run records the version `opencode --version` actually reported (`harnessVersion` in the run's result and report files, and in a factory PR's attribution line, e.g. "via opencode 2.4.1"), in place of a fixed "opencode 2.2.7" label.
- Warden never checked the OpenCode binary's sha256 at run time; the hash above was recorded by the P0 proof only. Nothing is pinned to a hash now either.
- **Open check:** the P0 proofs (`PROOF-runtime`, `PROOF-isolation`) ran on 2.2.7 and have **not** been re-run on 2.4.1 or any other 2.x release. The guarantees in the table below are observed for 2.2.7 only until the owner re-runs them on his Mac against the version he uses. The hardening flags, deny-all permission surface and resolved-provider check are still applied to every 2.x release, so a 2.x change that breaks one of them fails the preflight or the session rather than running unguarded.

## Amendment 2026-11-28: mlx-serve provider id, and waiting for OpenCode to load

Owner, 2026-11-28, in his words: "drop lmstudio we aren't using it" and "we are only using mlx-serve its performance is so much faster".

- On OpenCode 2.4.1 the first review run stopped with "no resolved default model (status 200)". A probe on the owner's Mac showed why: 2.4.1 prints "listening" before its providers load. Just after startup `GET /api/provider` answered `data: []` and `GET /api/model/default` answered `data: null`; five seconds later the configured model was the default, at loopback `127.0.0.1:11234/v1`. The reply shape (`{ data }`) is the same as on 2.2.7.
- The resolved-routing check now asks again while OpenCode answers 200 with no default model and nothing non-local, up to the startup limit (`startupMs`, 60 s), then refuses. A non-local provider or model, a substituted model, a model from another provider or an error reply still fails on the first reading, without waiting.
- Warden's provider id is now `mlx-serve` (name "mlx-serve (local)"), not `lmstudio`. OpenCode merges a config provider into a built-in provider of the same id, so the old id pulled OpenCode's LM Studio catalogue models in beside the configured one (the probe listed three). OpenCode's own `lmstudio` and `ollama` providers, which discover models on their default ports, are denied by policy, as `opencode` already was.
- mlx-serve is the MVP server. The adapter still speaks to the plain OpenAI-compatible endpoint at the configured URL, so Warden is not tied to one way of hosting the model.

## P0 proof record (2026-11-18, `PROOF-runtime`)

Evidence: [`proof/p0-runtime`](../../proof/p0-runtime/README.md) — `results/runtime.json` (44/44 checks), `results/isolation.json` (28/28), commands in the README. These are spikes, not production modules. Host: Apple silicon, macOS 27.2.1, Node 26.13.0.

**Chosen and pinned**

- **Harness:** OpenCode **v2.2.7** (Homebrew; binary sha256 `17d42049…eab5`, recorded in the report), driven headless through its local HTTP API (`opencode serve`, per-run password, loopback). OpenCode 2.3.0 is available and **not adopted**; re-run the proofs before moving the pin. *Superseded 2026-11-27 by the version-range ruling below: the exact pin is now a 2.x range, and 2.2.7 is its floor.*
- **Harness state:** per-run `XDG_*` directories and a scrubbed environment. The maintainer's `~/.config/opencode` (remote provider, MCP servers) never participates.
- **Hardening flags (required, not optional):** `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_FREE_MODELS`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_FILEWATCHER_DISABLE`, plus config `policies: provider.use deny opencode`, `update: disable`, `share: disabled`. Observed without them: the harness enables a hosted `opencode` provider by default and contacts `models.opencode.ai` / `opencode.ai`; a repo-supplied `opencode.json` can redirect the provider (C7, B6).
- **Isolation backend:** **macOS Seatbelt via `sandbox-exec`**, deny-default profile (`system.sb` baseline), rebuilt environment, per-run scratch `HOME`, network limited to named loopback ports, reads limited to system/toolchain/workspace. Process-group kill on wall-clock timeout; `ulimit -t`/`-f` enforced. Tested on macOS major 27 only; any other major, a missing binary or any failed canary probe is *unknown containment* and blocks execution (F3: five defective-boundary variants all blocked, repo code never ran).
- **Not chosen:** Docker (CLI present, no daemon/VM provider on this Mac) and Apple's `container` CLI (not installed) — **unverified**, not evaluated. Apple documents `sandbox-exec` as deprecated; this is a recorded risk, revisit if a supported per-process equivalent or a verified container backend is adopted.

**Proven (observed)**

| Guarantee | Result |
| --- | --- |
| Fresh headless sessions; Ajv-validated output | 5/5 sessions distinct, empty log, strict-Ajv valid (first pass); five malformed/hostile outputs rejected; no cross-session recall (A) |
| Tool restrictions | deny-all offers no tools; `shell` scoped to `echo *` rejects `touch`; read outside workspace rejected (`external_directory`); `ask` parks a request and nothing executes unanswered; repo config ignored (B) |
| Resolved provider is local | harness is asked what it *resolved*: only loopback endpoints accepted; hosted, LAN, mDNS, lookalike and userinfo hosts rejected; endpoint probed; model device must be `Local` (C) |
| No hosted request when local fails | dead local endpoint + hardened harness: zero egress observed, no output; explicit hosted selection fails `provider.no-route` with zero egress (C6, C8) |
| Cancellation | interrupt stops generation in ~0.4 s and LM Studio returns to idle; transcript and workspace changes recoverable via git; crash (SIGKILL) leaves the session and prompt on disk; fresh session recovers (D) |
| Finite budgets | `steps` cap bounds **model steps** (assistant messages), *not* tool calls; `limit.output`, tool-output truncation, adapter wall-clock interrupt (8.1 s for an 8 s budget), bounded context overflow (E). A tool-call budget is **not** provided by the harness: the runner must enforce it (constraint 7) |
| Boundary vs hostile repo | npm lifecycle scripts, git hook, test runner and direct code: 0 breaches over 44 hostile attempts per vector (plus 2 positive controls) (home credentials, unrelated files, write token in env, `gh`, symlink/hardlink/rename escape, unapproved loopback incl. LM Studio port, internet, DNS, UDP, unix sockets, listen, osascript/open/launchctl); the identical payload uncontained succeeds on every vector (positive control) |
| Harness inside the boundary | OpenCode runs inside Seatbelt; with every tool permission open the harness shell still cannot read home, reach the internet or write outside the workspace: deterministic proof via the harness shell (F3). The model-driven run (F2) fails only on a leak and is reported *not exercised* when the model runs no commands |

**Constraints this imposes (carry into P1/P3 design)**

1. **Two boundaries, not one.** The harness needs the LM Studio loopback port; any command it spawns inherits that profile and can reach the model server. Candidate-code execution (installs, hooks, tests, builds) must run in a *separate* profile with **no** network (the proof's hostile vectors use only a dummy approved port).
2. **Preflight asks the running harness for the resolved model** and compares it with the expected pool member: when the configured default is unavailable the harness silently substitutes another model (observed: another LM Studio model).
3. **Local failure hangs instead of erroring** (dead endpoint → no response). The adapter must probe the endpoint before launch and enforce a wall-clock interrupt.
4. **Recovery uses a fresh session.** Re-prompting a crashed session also answers its dangling prompt (12.6 k characters of unbounded work observed). Killing the harness aborts the in-flight LM Studio generation (~0.14 s), so the accepted request is lost, not completed: report it as "accepted, result discarded".
5. **No per-process memory cap exists on macOS** (`ulimit -v` fails with EINVAL). Memory is bounded only by the model/context budget, the wall-clock kill and host monitoring. Reasoning tokens are not strictly bounded by `limit.output` (141 vs cap 48 observed); wall-clock is the hard bound.
6. LM Studio can list models served by *other* devices (LM Link). `lms ps` device must be `Local` for a model to count as local.
7. **Tool-call budget is the runner's job.** `steps` bounds model steps; one step can batch several tool calls (observed: 5 tools executed in 2 assistant messages in a verification run). The adapter must poll the message log and interrupt past its budget (E1c shows the mechanism works but is time-bounded, not exact: calls batched in one step may execute before the poll sees them).

**Unverified / not claimed:** other macOS majors, Docker/Apple container backends, nested sandboxing (Swift macro plugins, tools that call `sandbox_init`), CPU/GPU contention while the factory and the maintainer share the Mac, statistical reliability of structured output beyond 5 runs of one model and schema, and OpenCode MCP/LSP/plugin surfaces (disabled or unused in the proof). If the boundary is unavailable the dependent work (any candidate-code execution) stays blocked; nothing is weakened.

**Compiler/SDK checks inside the boundary (`PROOF-lookup`, `proof/p0-runtime/results/lookup.json`, 21/21).** No existing ADR owns code intelligence, so the P0 feasibility result is recorded here and in the proof README; the graph-provider decision stays with P3. Baseline = TypeScript LanguageService, **typescript 6.0.3 pinned** (7.0.2 exists; its programmatic API is `unstable/*`, not adopted). Definitions, references and implementations matched hand-annotated ground truth exactly within the program (text search: precision 0.38); every citation carries repo, commit, content sha256, span, compiler version and tsconfig hash and re-verifies from `git show <commit>:<path>`; edited files are detected stale by hash; dirty trees are flagged; files outside the program (`exclude`d code) are reported as coverage gaps and refused rather than answered heuristically. Comparison candidate **scip-typescript 0.6.2 + @scip-code/scip 0.10.0** ran inside the boundary and, with SCIP implementation relationships joined, matched the same truth (5/5); CodeGraphContext 0.6.13 and GSD Atlas 0.1.0-alpha.0 (`7147e43`) are identified only. Supportable checks proven: TypeScript runtime-API floor (`lib`), Node API floor (matching `@types/node`), `@deprecated` usage, Apple deployment target (`swiftc -typecheck -target`, compiled inside the boundary). Python, Go/Rust/Kotlin/Java/C#, Swift macros/plugins and repo-supplied compiler plugins are **unsupported** and must block, never pass implicitly.
