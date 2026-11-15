# Open-Harness Pivot: Running Warden on Local Models in an Open Harness (Bionic / opencode / pi)

**Domain:** The Warden of the Gate — currently designed as a **Claude Code plugin**. This research evaluates pivoting the *AI runtime* to an **open, harness-agnostic** design that runs on **local models**, with the maintainer's stated target being **LM Studio Bionic** and explicit openness to **opencode** and **pi**.
**Researched:** 2026-11-14.
**Confidence:** HIGH for each harness's capabilities (checked against official docs and, for Bionic, the installed app on this machine). MEDIUM/LOW where a claim rests on inference or self-reported numbers (flagged per row). The single most important finding — **Bionic has no headless session-control mode** — is HIGH (verified by running the binary, reading its `Info.plist`, and reading the in-app skill files on disk).

> **Status: research + recommendation. The decision is NOT ratified.** Per the standing rule, ADR 0004 and STACK.md are formal documents and must not be rewritten without the owner's sign-off. This doc flags exactly what would change; PROJECT.md records the decision as "— Pending."

---

## 1. Why this research exists

The owner issued a direction change: Warden is built as a Claude Code plugin, but they want it to **work in the LM Studio Bionic interface, utilizing local models and what Bionic offers — "in an 'open' harness not one specific to a vendor's AI engines,"** possibly **pi** and **opencode** as well.

That sentence contains two distinct technical layers that must be separated, because they have different answers:

| Layer | What it is | Open / local options |
|---|---|---|
| **Model runtime** (inference) | The thing that turns tokens into tokens | **LM Studio core / `llmster`** — fully headless, local, OpenAI- + Anthropic-compatible REST. This is the "own inference" / AI-sovereignty layer (Lloyd, [TALK-FACTORY.md](TALK-FACTORY.md)). |
| **Agent harness** (the loop) | The thing that drives a model over tools in a session: file ops, Bash, skills, structured output | **Bionic** (GUI), **opencode** (headless + SDK), **pi** (print/JSON/RPC + SDK). This is the layer that was pinned to Claude Code. |

The pivot is really about the **harness** layer, with the **model runtime** becoming local. Bionic is a *harness* (an app), not the model server — and that distinction drives the whole recommendation, because **Bionic is GUI-first with no headless session control** (Section 3).

---

## 2. Warden's harness requirements (the checklist)

Derived from the PRD, ADRs, and PITFALLS. Every requirement is currently met by Claude Code; the pivot must meet each one in an open harness.

| # | Requirement | Why it's load-bearing | Source |
|---|---|---|---|
| R1 | **Unattended batch spawn** (launchd → runner → one agent session per item) | The whole loop runs while the maintainer is away; no human at a TUI | ADR 0004, STACK launchd |
| R2 | **Structured output with schema enforcement** (result file validated against a JSON Schema) | "AI proposes, scripts dispose" — the runner must get machine-checkable output, not prose | SUMMARY, STACK `--json-schema` |
| R3 | **Fixed tool surface + fail-closed init** (pin tools; abort if unexpected MCP/plugins load) | Prompt-injection defence (Pitfall 1): a fork PR must not gain tools it wasn't given | PITFALLS P1 |
| R4 | **Sandbox / isolation for Implement & Rework** (Bash + untrusted issue text) | The real attack surface (Pitfall 2): OS-level fs/network allowlist, throwaway worktree | PITFALLS P2 |
| R5 | **Per-item fresh sessions** (no cross-item context bleed; resumable from ledger) | Determinism + "no head commit reviewed twice" | PRD, ADR 0004 |
| R6 | **Local-first model pool; no *unbudgeted* per-token spend** (the core constraint) | "I cannot afford API calls for open source maintenance" — local is the free floor; a remote high-end tier (Nvidia) is opt-in for heavy tasks only, never a silent fallback | ADR 0004 (amended) |
| R7 | **Audit trail** (store every session's trace for Retro + governance) | Lloyd's self-improvement loop; the layer a cloud factory lacks locally | TALK-FACTORY, PITFALLS P1 |
| R8 | **Skills** (triage-review wrapper, implement/rework, retro as reusable units) | Reused commands + the correction ladder live in skills/prompts | ADR 0001, FRAMEWORK-CORRECTIONS |
| R9 | **Model routing** (cheap model for light tasks, strong model for heavy) | Cost/quality trade-off per Warden risk tier | TALK-FACTORY (Lloyd) |

---

## 3. The critical finding: Bionic is GUI-first — it has no headless session control

This is the answer that determines the architecture, so it leads.

**Verified on this machine (primary sources):**
- `/Applications/Bionic.app` is an **Electron GUI app** (`NSPrincipalClass = AtomApplication`, `ai.elementlabs.bionic`, v1.2.0+2). Running its binary with any argument just opens another GUI instance ("Another instance of the app is already running. Quitting this instance.") — **there is no CLI mode.**
- It registers a **`bionic://` URL scheme** (`CFBundleURLSchemes = [bionic]`) — a deep-link entry point, but the official docs do not document it as a session-control API.
- It runs an **internal Express HTTP server** on `127.0.0.1` (dynamic port; `http-server.json`). Probing it (`/`, `/api`, `/v1/models`, `/sessions`, `/health`, …) returns **404 for everything** — it is an internal bridge, not a public control-plane API. (`enableLocalService` is `false` in the user's settings.)
- **Official docs** (lmstudio.ai/docs/bionic, /projects-and-sessions) describe only GUI actions: create a project in the UI, open sessions in tabs, **background sessions continue when you switch tabs**, fork a response. No CLI, no API, no headless mode is documented.

**What Bionic *does* offer programmatically — but only from inside the app:**
The installed in-app skills expose a `bionic_tool` API (read directly from `/Users/trekkie/.lmstudio/apps/bionic/.internal/skills/`):
- `session-control`: `create_project`, `create_session` (with prompt + file attachments), `send_prompt` (queue/steering), `fork_session`, `interrupt_session`, `set_session_archived`, `move_session`.
- `introspection`: `list_projects`, `list_sessions`, read transcripts and queues.

So **an agent running inside Bionic can spawn and steer other Bionic sessions.** That is powerful for *interactive* multi-session work (a maintainer at the machine). But it is **agent-driven, in-app** — there is no documented way for a launchd job or an external script to create and drive Bionic sessions unattended.

**Conclusion:** **Bionic cannot be the unattended batch engine.** It is the right *interactive* surface (the maintainer's `/warden gate`, review, in-app orchestration). The unattended loop (R1) must run in a harness that has a real headless mode — **opencode** or **pi**.

> Note: the `lms` CLI *does* "connect to Bionic" — but only for **model inference** (REST), and it prefers a running LM Studio/llmster over Bionic. That confirms Bionic can *serve* local models, not that it can be *driven* headlessly.

---

## 4. Capability matrix: Bionic / opencode / pi vs Warden's requirements

Legend: ✅ native · ⚠️ possible but indirect/fragile or needs building · ❌ absent. Confidence per cell noted in Section 6 sources.

| Req | **Bionic** (GUI app) | **opencode** (sst) | **pi** (badlogic/earendil) |
|---|---|---|---|
| R1 Headless batch (launchd) | ❌ GUI only; in-app `session-control` API is agent-driven, not scriptable from outside | ✅ `opencode run "prompt"` + shared **background server** (owns sessions/tools/permissions) + `--standalone`/`--server` | ✅ `pi --print`, `pi --mode json`, `pi --mode rpc` (long-lived subprocess) + TS SDK |
| R2 Structured output (JSON schema) | ⚠️ in-app only; no documented headless structured-output contract | ✅ **SDK v2** `session.prompt({ format: { type:"json_schema", schema } })` → validated JSON (closest match to Claude Code `--json-schema`) | ⚠️ `--mode json` emits a **JSONL event stream**, not a single schema-validated object; no direct `--json-schema` flag (see gap, §5) |
| R3 Fixed tool surface + fail-closed | ⚠️ in-app permission model (`neverAsk`, per-tool confirmation); not a scriptable allowlist | ✅ agent/tool config + permissions on the server; MCP controllable | ✅ `--tools` allowlist, `--exclude-tools`, `--no-mcp`, `--no-builtin-tools`; JSONL session header + tool events for fail-closed |
| R4 Sandbox / isolation (Implement) | ⚠️ "work projects" are sandboxed with auto-checkpoints (in-app); not a launchd-containable OS sandbox | ✅ sandboxing via config/extensions; runs in throwaway dirs | ⚠️ path-protection / sandboxing are **buildable extensions** (not default); `--offline` for network |
| R5 Per-item fresh sessions | ✅ `create_session` (in-app) | ✅ `session.create` / `--session-id`; background server isolates per session | ✅ `--no-session`, `--session-id`, `--fork` |
| R6 No API key / local models | ✅ local model picker + Secure Cloud (credit) + LM Link | ✅ **built-in LM Studio** (`127.0.0.1:1234/v1`, discovers `/api/v1/models`), vLLM, Ollama; `apiKey` optional for local | ✅ `models.json` → LM Studio / Ollama / vLLM OpenAI-compatible; **llama.cpp router** for GGUF |
| R7 Audit trail (traces) | ✅ transcripts readable in-app (`introspection`) | ✅ session events via SDK; sessions persisted (sqlite) | ✅ JSONL / RPC event stream; session files on disk |
| R8 Skills (SKILL.md) | ✅ Agent-Skills format; **compatible with Claude Code / Codex skills** (the owner's Matt Pocock library already lives here) | ✅ agent skills (SKILL.md) + plugins + custom agents | ✅ `--skill` (repeatable), SKILL.md; extensions for tools/commands/events |
| R9 Model routing (local/cloud split) | ✅ local + **Secure Cloud frontier open models** (GLM, Kimi Code) per session | ✅ 200+ providers via Models.dev + BYO subscriptions; mid-run model switch | ✅ 15+ providers; `/model` mid-session; classifier/virtual models for routing |

**Model runtime (shared by all three):** **LM Studio core / `llmster`** — fully headless (`lms daemon up`, no GUI), REST on `:1234` with **OpenAI-compatible + Anthropic-compatible** endpoints, JSON-schema response-format enforcement, TS/Python SDKs. This is the local inference layer every adapter points at, and it is what makes R6 (no per-token cost) true.

**Read of the matrix:**
- **opencode** is the cleanest match for Warden's *batch* contract: headless `run` + background server, **native JSON-schema structured output** (R2), tool/permission control (R3), built-in LM Studio local discovery (R6), skills + plugins + custom agents (R8). It is the closest drop-in replacement for the `claude -p --json-schema` profile.
- **pi** is the most *minimal and extensible*: four modes (print/JSON/RPC/SDK), `models.json` for local, and everything else (sub-agents, plan mode, permission gates, sandboxing) buildable as TypeScript extensions. Its one gap for Warden is **R2** (no direct schema flag — it streams events).
- **Bionic** wins on *interactive* ergonomics and already hosts the owner's skill library, but loses R1 (no headless) — so it is the interactive surface, not the batch engine.

---

## 5. What the pivot requires

### 5a. The seam that makes it possible: a pluggable `AgentRunner`

Warden's core is **already pivot-ready** because of the "AI proposes, scripts dispose" rule: the runner spawns a session with fixed inputs (packet files) and consumes a **schema-validated** result; the session holds no write credential. The Claude Code–specific surface is only *how* you (a) launch headless, (b) get structured output, and (c) pin tools. Encapsulate those three in an adapter:

```ts
interface AgentRunRequest {
  task: 'triage' | 'review' | 'implement' | 'rework' | 'retro';
  prompt: string;            // names exactly one item + the context-pack path
  workDir: string;           // prepared read-only pack / throwaway worktree
  tools?: ToolSpec;          // fixed surface — encoded per-harness inside the adapter
  schema?: JsonSchema;       // result contract (the --json-schema equivalent)
  maxTurns?: number;
  sessionId?: string;        // runner-generated, fresh per item (R5)
  env: Record<string,string>;// scrubbed; read-only GH token, etc.
}
interface AgentRunResult {
  ok: boolean;
  structuredOutput?: unknown;// runner re-validates with Ajv — harness-agnostic (R2)
  transcriptPath: string;    // stored for Retro + audit (R7, Lloyd's loop)
  turns: number;
  usage?: { input:number; output:number; cost:number };
  stopReason: 'done' | 'turn-limit' | 'error' | 'timeout';
}
interface AgentRunner {
  readonly id: 'opencode' | 'pi' | 'bionic' | 'claude-code';
  preflight(): Promise<void>; // model loaded? local (no key)? tools pinned? — per-harness
  run(req: AgentRunRequest): Promise<AgentRunResult>;
}
```

**The load-bearing invariant:** the runner validates `structuredOutput` with Ajv **regardless of which harness produced it.** Harness differences (how structured output is obtained, how tools are pinned) live *inside* each adapter. warden-core (state machine, ledger, gates, poster, sweep) is **untouched.**

### 5b. Flag-by-flag translation (Claude Code → adapters)

| Warden need | Claude Code (today, STACK.md) | **opencode** adapter | **pi** adapter | Bionic (interactive only) |
|---|---|---|---|---|
| Headless one-shot | `claude -p` | `opencode run` / SDK `session.prompt` | `pi --print` / `--mode json` | in-app `create_session` |
| Structured output | `--output-format json --json-schema <file>` | SDK v2 `format:{type:"json_schema",schema}` | JSONL stream → parse final text, **or** LM Studio response-format at model layer | in-app (undocumented) |
| Tool allowlist | `--tools` / `--disallowedTools "mcp__*"` | agent/tool config + server permissions | `--tools` allowlist, `--exclude-tools 'mcp__*'`, `--no-mcp` | in-app permission model |
| Turn cap | `--max-turns` | server config / SDK | extension or config | in-app |
| Fresh session | `--session-id <uuid>` | `session.create` / `--session-id` | `--no-session` / `--session-id` | in-app `create_session` |
| Isolated settings (P1) | `--setting-sources`, `disableAllHooks` | config isolation on the server | `-na --no-approve`, `--offline` | in-app |
| Local model, no key | n/a (subscription OAuth) | `providers.lmstudio` → `:1234/v1` | `models.json` → LM Studio/Ollama/llama.cpp | local model picker |
| Audit trail (R7) | `--output-format stream-json` events | SDK session events | JSONL / RPC events | in-app transcripts |
| Skills (R8) | plugin `skills/` | agent skills + plugins | `--skill` (SKILL.md) | SKILL.md (Claude Code-compatible) |

### 5c. What breaks / needs amendment (flag for owner sign-off — do NOT rewrite yet)

| Document | Today | After pivot | Severity |
|---|---|---|---|
| **ADR 0004** | "All AI in local **Claude Code**, no API keys" | Spirit (**local, no per-token cost**) is *strengthened* by local models; letter generalizes to "all AI runs locally on **local models**, harness-agnostic (opencode/pi batch + Bionic interactive); no per-token API cost" | **Amend** (spirit stronger, letter broader) |
| **STACK.md** — Claude Code pinning (`>=2.1.302`), `claude -p` flag profiles, plugin packaging (`.claude-plugin/`, marketplace, `claude plugin validate/tag`) | Pinned to Claude Code | Replaced by the **AgentRunner** interface + per-harness profiles. The Node/TS/Octokit/TypeBox/Ajv/**launchd** core is **untouched** (harness-agnostic) | **Rewrite** the Claude-specific sections only |
| **PITFALLS P1** (prompt injection) | Prefetch + fixed tools + isolated settings + fail-closed init + hostile-result validation + rules-from-base | **Prefetch, hostile-result (Ajv) validation, and rules-from-base are harness-agnostic — unchanged.** Fixed-tool-surface, isolated-settings, and fail-closed-init **re-derived per harness** (opencode permissions / pi `--tools`+`--no-mcp`+`-na --offline`) | Re-derive 3 of 7 layers |
| **PITFALLS P2** (Implement sandbox) | Claude Code OS sandbox / separate macOS user | The **OS-level isolation backends** (docker-sandbox, devcontainer, apple-container, separate-user) are harness-agnostic — **unchanged.** The "Claude Code sandbox" reference becomes opencode/pi sandboxing or Bionic work-project sandbox | Minor reword |
| **PITFALLS P3** (silent API-key billing) | Refuse to start if `ANTHROPIC_API_KEY` set; scrub env + settings | **Mostly moot** — local models have no API key. Replaced by a lighter check: "no cloud provider configured; active model is local" | Simplifies |
| **PITFALLS P9** (`--max-turns`, shared subscription limits) | Batches bounded by the maintainer's Claude session limits | Replaced by per-item turn caps **plus a new resource dimension: model-load / VRAM / context-window** (a local batch must fit in memory; a fixed-context local model can't absorb an unbounded queue) | New concern added |

### 5d. The one real capability gap: structured output on pi

opencode gives Warden's exact R2 contract (native JSON-schema). **pi does not** expose a `--json-schema` flag; `--mode json` is an *event stream*. Two clean resolutions, both keeping the Ajv-validation invariant:
1. **Prompt-level:** instruct the model to emit a single JSON object matching the schema as its final message; the runner parses and Ajv-validates it. (Works, but relies on model discipline — weaker than native.)
2. **Model-layer:** use **LM Studio's JSON-schema response-format enforcement** on `/v1/chat/completions` so the *model* is constrained to the schema; pi then just relays it. (Stronger — the constraint is at inference, harness-agnostic.)

This is why **opencode is the recommended default batch adapter** and pi is the secondary: opencode makes R2 native, pi requires one of the two workarounds above.

---

## 6. What the pivot gains, and what it risks

### Gains
- **Local is a free floor.** Local models make ADR 0004's constraint a *feature*: the default unattended batch costs electricity, not tokens. P3 (billing fallback) and the subscription ceiling (P9) largely disappear for local work; a remote high-end tier is opt-in and bounded (§7).
- **AI sovereignty** (Lloyd, [TALK-FACTORY.md](TALK-FACTORY.md)): own data, own compute, own inference. No vendor lock-in, no rate limits, works offline — a stronger version of the "local by design" bet.
- **Model routing per risk tier** (R9): a small local model for light tasks (triage labels, sweep), a frontier **open** model (local big model, or Bionic Secure Cloud for the heavy full-tier review/implement) where quality matters. Lloyd's **benchmark-replay-on-your-own-tasks** validates the routing per repo instead of trusting public leaderboards.
- **Skills portability.** The owner's existing Matt Pocock skill library (grill-me, handoff, improve-codebase-architecture, code-review, tdd, triage…) already lives in Bionic and is `SKILL.md`-format — it transfers to opencode and pi. Warden's own specialists (triage-review wrapper, implement/rework, retro) stay portable `SKILL.md` files across all three.
- **Throughput unbounded by a vendor.** Batches are bounded by local compute/VRAM, not a subscription's session limit — when the machine is on, Warden can work longer.

### Risks
- **Local-model quality for review/implement (the big one — MEDIUM/LOW confidence).** This is the pivot's central risk and it *inverts* the old one: with subscription Claude, quality was assumed and cost was the risk; with local models, **cost is solved and quality is the open question.** Mitigations: (1) model routing — keep a frontier open model for full-tier review/implement; (2) **Pocock CARE** ([TALK-CARE.md](TALK-CARE.md)) — local models are *even less* incentivized toward strategic codebase health, so Warden's prompts must carry the strategic intent explicitly; (3) **Lloyd benchmark replay** on Warden's own past tasks to measure local-vs-frontier *on this repo*; (4) the **human gate** remains the final backstop. **Validate in shadow mode before trusting a local model with Implement.**
- **Bionic cannot run unattended** (confirmed, §3). If the owner specifically wants *Bionic* to drive batches, that needs an undocumented path (the `bionic://` scheme, or an in-app agent calling `session-control`) — fragile and not recommended for launchd. The honest answer to "can Bionic do the batch loop?" is **no; opencode/pi does, Bionic is the interactive surface.**
- **Harness fragmentation.** Three harnesses = more adapter surface to build and keep green. Mitigate: ship **one** default adapter (opencode) first; add pi and Bionic as secondary. The thin `AgentRunner` interface + the Ajv-validation invariant keep the core stable while adapters vary.
- **Local resource management (new).** VRAM/context limits mean a batch of N items must be scheduled against model capacity, not just a turn cap. The runner needs a "can this model fit this batch?" preflight (P9 replacement).

---

## 7. The model pool and the orchestrator economics (owner input, 2026-11-15)

The owner **ratified the pivot as a POC to get started** and added two strategic refinements that reshape the *model* layer (not the harness):

**(a) A tiered model pool, not "local only."**
- **Floor (default): local Mac MLX models** via Bionic / LM Studio — zero per-token cost, data stays on the machine. This is where ADR 0004's constraint lives and it is fully satisfied.
- **Ceiling (opt-in): remote high-end models** — the owner will have API access to **Nvidia nodes running high-end cores**, beyond the Mac MLX models. Bigger and better, but remote (data leaves the machine; there is a cost or allocation).
- So R6 refines from "no API key" to: **local is the default floor; remote high-end is an opt-in tier for heavy tasks, never a silent fallback.** The runner must know which tier it is using.

**(b) The orchestrator/worker pattern — what makes local-first viable.**
The owner's cost argument: frontier models are expensive *per token*. For spending on remote/frontier models to be worth it, the quality improvement must be **orders of magnitude** ("non-logarithmic improvement will not provide value"). If you can do it locally with hardware already purchased (sunk cost; marginal cost ≈ electricity), paying for remote models only makes sense when the quality jump is dramatic.

The resolution is an **orchestrator + worker split**:
- A **strong model (the orchestrator)** is used *lightly* — planning, task decomposition/routing, and verification. Low token volume → cheap even if it is a frontier/remote model.
- **Local models (the workers)** do the bulk of the token-heavy work (drafting, editing, running tests) under the orchestrator's guidance. High token volume → but free (local).
- This captures most of the quality benefit (from the orchestrator's *judgment*) at a fraction of the cost (the expensive model uses few tokens; the cheap local models use many but are free).

This maps directly onto Warden:
- **Pocock CARE** ([TALK-CARE.md](TALK-CARE.md)): the orchestrator *is* "the one bearing the brunt" of strategic thinking — it is the human's delegate that tells local workers to care about the codebase improving over time. The orchestrator carries the strategic intent; the local workers execute it.
- **Lloyd** ([TALK-FACTORY.md](TALK-FACTORY.md)): model routing + measurement on your own data is exactly how you decide *when* the quality delta justifies escalating a task from local-worker to remote.
- **Warden risk tiers** become a routing table: light tasks (triage labels, sweep) → local worker; heavy full-tier review/implement → orchestrator-guided-local by default, escalating to remote high-end only where the measured delta justifies it.

**Consequence for ADR 0004:** the invariant is no longer literally "no API key" — it is **local-first with a bounded, opt-in remote tier and no *unbudgeted* per-token spend.** The runner's preflight must (1) confirm the default tier is local, (2) require explicit config to enable the remote tier, and (3) never silently fall back to a paid/remote model. This *strengthens* the original cost intent (local is free and default) while allowing the quality ceiling the owner will have.

**POC scope (what "get started" means):** prove the open-harness + local-model loop end-to-end on the *cheapest* slice — one task (e.g., Review of a single PR) through an `AgentRunner` adapter driving **opencode** against a **local MLX model**, producing a schema-validated result the existing poster would post. The orchestrator/worker split and the remote Nvidia tier are **v1.x** (after the POC proves the local loop works), gated by Lloyd's benchmark-replay measurement of the local-vs-remote quality delta.

---

## 8. Recommendation

1. **Keep warden-core harness-agnostic.** Introduce the pluggable `AgentRunner` adapter behind the existing "AI proposes, scripts dispose" seam. The state machine, ledger, gates, poster, sweep, and launchd scheduler are **untouched.**
2. **Default batch runner: opencode**, pointed at **LM Studio core (`llmster`)** serving local models on `:1234`. Rationale: native JSON-schema structured output (exact match to the current `--json-schema` contract), headless `run` + background server, built-in LM Studio local discovery, skills/plugins/custom agents.
3. **pi as a secondary adapter** for maintainers who prefer minimal/extensible, accepting the structured-output workaround (§5d: prompt-level or LM Studio response-format).
4. **Bionic as the interactive maintainer surface** (`/warden gate`, review, in-app orchestration via its `session-control` API). Not the unattended batch engine.
5. **Model layer = a tiered pool.** Floor (default): local Mac MLX via LM Studio core (`llmster`) on `:1234` — free, private. Ceiling (opt-in): remote high-end models on **Nvidia nodes** via API for heavy full-tier review/implement. Route by Warden risk tier + measured quality delta (§7).
6. **Amend ADR 0004** (local-first model pool; no *unbudgeted* per-token spend) and **rewrite STACK.md's Claude-Code-specific sections** as adapter profiles. **Ratified 2026-11-15 as a POC** — these amendments are made now, scoped to the POC.
7. **Validate local-model quality in shadow mode** before trusting it with Implement: add a local-vs-frontier comparison using Lloyd's benchmark replay of Warden's own past tasks, gated by the existing ≥7/10 agreement rollout gate.
8. **Orchestrator/worker split (v1.x, after the POC).** Use a strong model *lightly* (plan / route / verify) to guide cheap local workers doing the token-heavy work — this is what makes local-first viable at frontier quality. Escalate a task to the remote Nvidia tier only where the measured local-vs-remote delta is large enough to justify it (§7).

**One-line answer (updated 2026-11-15):** *Yes — Warden runs in an open harness on a **local-first model pool**: warden-core stays as-is; a thin `AgentRunner` adapter drives **opencode** (headless batch, native structured output) or **pi**; the model layer is local Mac MLX by default with an opt-in remote **Nvidia** tier for heavy tasks; and **Bionic** is the maintainer's interactive front-end. Local work costs electricity, not tokens; a lightly-used strong orchestrator keeps quality high without paying per-token for the bulk of the work. **Ratified as a POC** to get started.*

---

## 9. Sources (primary)

**Bionic (GUI harness):**
- Local app on this machine: `/Applications/Bionic.app/Contents/Info.plist` (Electron, `ai.elementlabs.bionic`, v1.2.0+2, `bionic://` scheme); binary has no CLI mode (opens GUI). HIGH
- `/Users/trekkie/.lmstudio/apps/bionic/` — `settings.json` (`enableLocalService:false`, `cliInstalled:false`, `attemptedInstallLmsCliOnStartup:true`), `.internal/http-server.json` (127.0.0.1 Express bridge; all probed routes 404), `.internal/skills/session-control/SKILL.md` + `introspection/SKILL.md` (the in-app `bionic_tool` session-control API). HIGH
- https://lmstudio.ai/docs/bionic and /docs/bionic/projects-and-sessions (GUI-only: projects, tabs, background sessions, fork; no CLI/API documented). HIGH

**LM Studio core (model runtime):**
- `lms --help` / `lms server --help` run locally (`/Users/trekkie/.lmstudio/bin/lms`, CLI commit 43d4b26). HIGH
- https://github.com/lmstudio-ai/lms (README: `lms` prefers running LM Studio/llmster over Bionic; connects to Bionic for REST; `lms link agent` for cross-device agentic use). HIGH
- https://lmstudio.ai/docs/developer/core/headless (llmster daemon, no GUI; desktop headless mode), /docs/cli, /docs/developer (REST + OpenAI/Anthropic-compatible endpoints). HIGH

**opencode:**
- https://opencode.ai/docs/cli (`opencode run` for scripts/CI; background server owns sessions/tools/permissions; `--standalone`/`--server`; default port 4096). HIGH
- https://opencode.ai/docs/sdk (`@opencode-ai/sdk`; **v2 client** `session.prompt({ format:{type:"json_schema",schema} })` → validated structured output; session create/list/get/prompt). HIGH
- https://opencode.ai/docs/providers (built-in **LM Studio** `127.0.0.1:1234/v1` discovers `/api/v1/models`; vLLM `:8000/v1`; Ollama probe; `apiKey` optional for local). HIGH

**pi:**
- https://github.com/earendil-works/pi (formerly `badlogic/pi-mono`; ~40K stars, MIT) README: "minimal, extensible agent harness"; four modes (interactive, print/JSON, RPC, SDK); extensions/skills/templates/themes as packages. HIGH
- https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/cli.md (`--print`, `--mode json|rpc`, `--tools`/`--exclude-tools`/`--no-mcp`, `--skill`, `-na --no-approve`, `--offline`, `pi auth check --json`). HIGH
- …/docs/json.md (strict JSONL event stream; `agent_settled`; usage/cost), …/docs/rpc.md (long-lived subprocess, JSONL commands, `RpcClient`, Python example), …/docs/models.md (`models.json` → Ollama/LM Studio/vLLM OpenAI-compatible; llama.cpp router for GGUF). HIGH

**Feeds from earlier research (this pivot builds on, does not replace):**
- [TALK-FACTORY.md](TALK-FACTORY.md) — Lloyd: AI sovereignty (own data/compute/inference); self-improvement loop; benchmark replay for model routing.
- [TALK-CARE.md](TALK-CARE.md) — Pocock: declare strategic intent; applies more strongly to local models.
- [TALK-SLOP.md](TALK-SLOP.md), [BOOK-SE-BEST-PRACTICES.md](BOOK-SE-BEST-PRACTICES.md), [TALK-SPEC-BUGS.md](TALK-SPEC-BUGS.md) — correction ladder, verification economics, spec checks (all harness-agnostic; unchanged by the pivot).

**Not verified / MEDIUM-LOW:** local open-model quality for Warden's review/implement tiers on this repo (no benchmark yet — the shadow-mode validation in §8.7 is the plan); whether Bionic's `bionic://` scheme can be driven by an external script (undocumented; not recommended to rely on); pi structured-output workaround fidelity under a local model; the exact quality delta that justifies escalating from local to the remote Nvidia tier (to be measured, not assumed).

---
*Open-harness pivot research for: The Warden of the Gate — Researched 2026-11-14; model-pool + orchestrator economics added 2026-11-15. Decision status: RATIFIED as a POC (owner, 2026-11-15).*
