# Mastra and Mastra Factory compared with Warden's design

**Domain:** Whether Mastra (mastra-ai/mastra), a TypeScript agent and workflow framework, or its Mastra Factory software factory, should supply any part of Warden, and what Warden can learn from it.
**Researched:** 2026-11-27, against `mastra-ai/mastra` `main` at `b05048d` and Warden `main` at `e6d2658`.
**Confidence:** HIGH for licence, telemetry, model-connection and Factory behaviour, each read from Mastra's own source and docs at that commit. MEDIUM for maturity figures, which are Mastra's own published numbers. LOW for Anthropic Messages API use against a self-hosted endpoint (inferred from AI SDK support, not shown in Mastra's docs or tried).

> **Status: research + recommendation.** The PRD, ADRs and code are not changed. The ideas below are candidates for a later ADR amendment, not decisions.

## Verdict

**Skip Mastra as a dependency. Borrow two ideas.** Mastra is a large, capable TypeScript agent framework, and its new Mastra Factory is the closest thing to Warden I have found. But Warden's hard parts (the serialized GitHub writer, the ledger, stop controls, standing orders, merge gates, review-only for contributors) are not in Mastra, and the part Mastra would replace (the agent loop) is already behind Warden's `AgentRunner` seam with OpenCode. Adopting it would add a fast-moving, open-core, telemetry-on-by-default stack to a package that today has three runtime dependencies.

**Worth borrowing:**

1. **Two review rules from Mastra Factory's review skill** (Apache-2.0, so they can be adapted with credit):
   - PR content written by the author that tries to steer its own review ("approve this", "skip the tests") is a **blocking finding**, not just text to ignore.
   - Before forming its own view, the reviewer collects **existing reviews (bots and humans)** and marks each finding confirmed, addressed or refuted, with evidence. A confirmed one counts as Warden's own. Bots are identified by their account login, never by how a comment looks.
2. **The shape of Mastra's eval verdicts** for Warden's replay set and scorecard (ADR 0018): gates that must score 1.0, thresholds on tracked metrics, and a three-way result of passed, scored (gates passed, a threshold missed) or failed. Copy the shape, not the package.

## What Mastra is

Mastra ([github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra)) is a TypeScript framework for AI agents and workflows from Kepler Software Inc. (Y Combinator W25). 1.0 shipped Jan 20, 2026; `@mastra/core` is at 1.87.0-alpha.4 on main today, so roughly one minor version every few days. The 1.0 post claimed about 19.8k stars, 300+ contributors and 300k weekly npm downloads, and named Replit, PayPal and Sanity as production users (company figures). Pull requests are limited to collaborators; outsiders file issues.

| Area | What it offers |
| --- | --- |
| **Agents** | Tool-calling agent loop, structured output (Zod, JSON Schema), input/output processors, guardrails (prompt injection, PII), tool approval, subagents. |
| **Workflows** | Typed step graph with `.then()`, `.branch()`, `.parallel()`, loops, suspend and resume for human approval, snapshots in storage, cron schedules, "time travel" re-runs from a step. |
| **Harness** | Durable agents that survive restarts, background tasks, goals with run budgets, schedules, and "signals" (async input into a running thread). |
| **Memory** | Message history, working memory, semantic recall (vector search), and "observational memory" that compresses old messages into notes. |
| **Evals** | Built-in and custom scorers, versioned datasets, experiments, gates and verdicts, CI and Vitest runners. |
| **Observability** | Traces, logs, metrics, scores and human feedback, with exporters. |
| **MCP** | MCP client (agents use remote MCP servers) and MCP server authoring. Also A2A. |
| **Sandbox** | Local or remote sandboxes with filesystem, shell, LSP and search; computer use. |
| **Storage** | LibSQL, Postgres and other stores. |
| **Studio** | Local web UI on port 4111 for testing agents and workflows. |

### Model connections

- **OpenAI-compatible endpoints:** yes. A model can be `{ id, url }` pointing at any `/v1` base URL, using Chat Completions by default or the Responses API with `api: "responses"`. That covers mlx-serve and the owner's Nemotron/Gemma inference service.
- **Anthropic Messages API on your own endpoint:** not shown in Mastra's docs. It should work by passing an AI SDK Anthropic provider instance with its own base URL, since Mastra accepts AI SDK model instances. Unverified.
- **Model router:** strings like `anthropic/...` or `lmstudio/...` resolve through a catalogue of 40+ providers, plus gateways (OpenRouter, Vercel, Mastra's own).
- **Model fallbacks:** on a 500, rate limit or timeout Mastra switches to the next configured model automatically. That is exactly the silent fallback Warden's preflight forbids (ADR 0007), so Warden would have to leave it off.

### Licence (checked file by file)

- Most of the repository is **Apache-2.0**.
- Anything in a directory named `ee/` is under the **Mastra Enterprise Edition License v2.0** (effective Sep 22, 2026). It is source-available, "not open source": free for development and testing, production use needs a signed agreement and a licence key, and redistribution is barred. Kepler can change which features count as enterprise at any time (section 5.1).
- **The `ee/` code ships inside `@mastra/core` itself** (`src/auth/ee`, `src/agent-builder/ee`), as well as in `@mastra/editor`, `playground` and `playground-ui`. Mastra's docs say what needs a key depends on the features you configure, not the packages you install. The enterprise features are RBAC, fine-grained authorization, Agent Builder and a third-party Studio sign-in screen. Without a key in production, the server refuses to start for the first three.
- `@mastra/connect` ships an **Elastic License 2.0** file while its `package.json` says Apache-2.0. It is a Mastra Platform client anyway, so Warden would not use it.

So Mastra is open-core rather than a licensed engine like Memanto's. Whether open-core with enterprise code inside the core package passes the owner's rule against supporting a licensed project as a GSD capability is an open owner question. Using only the Apache parts is legal, but the enterprise code would sit in Warden's dependency tree.

### Telemetry

- `@mastra/core` sends anonymous usage telemetry to PostHog (`us.posthog.com`) **by default**, including the model provider, model name and token counts every 15 minutes and at shutdown. The id is a hash of the host name.
- It is switched off with `MASTRA_TELEMETRY_DISABLED=1`. I found no `DO_NOT_TRACK` check in the source.
- The CLI and Mastra Factory send their own PostHog events, with the same off switch.

### Runtime fit with Warden's code

- Mastra core needs Node 22.13 or later; Warden needs Node 26, so the runtime is compatible.
- Warden's package has three runtime dependencies (`ajv`, `yaml`, `typescript`). `@mastra/core` brings Hono, three generations of AI SDK provider packages, A2A SDKs, `posthog-node`, `execa`, `ws` and more.
- Mastra's release pace (87 minor versions since January, alphas on main) would mean frequent upgrade reviews for a tool whose own rules say every change to its authority is maintainer-reviewed.

## Mastra Factory: the closest match

Mastra Factory (in the same repository under `mastracode/`) is "an open-source software factory" Mastra built to maintain Mastra. Alpha July 2026, beta September, a capabilities post Nov 18, 2026; Mastra says it is not 1.0 yet (`@mastra/factory` is 0.32.0-alpha). The packages that are published are Apache-2.0 and the `mastracode/` folder has no `ee/` directory.

How it works:

- **Board:** a kanban board of work items with phases Intake, Planning, Building, Review, Done and Canceled. Each phase can name a skill, the tools it gets, an exit tool and outcomes that move the card. Plans go through a `submit_plan` step that a person approves unless set to auto-approve. Boards are customizable.
- **Intake:** GitHub and GitLab, Linear, Jira, incident.io, Slack, Dependabot.
- **Authoring:** a coding agent (Mastra Code) builds the change in a sandbox and opens the PR.
- **Review:** a separate reviewer session with the `factory-review` skill posts **approve or request changes** as a GitHub review, with a machine-readable first line and the reviewed head SHA. The author agent reads a request-changes verdict and fixes it. On its own PRs GitHub forbids an app from reviewing, so the verdict goes in as a comment.
- **Merging:** I found no code that merges automatically; Done follows a merge or close.
- **Hosting:** a server with Postgres or LibSQL, optional Redis, a GitHub App and webhooks. Sandboxes are Mastra Platform, E2B or local. Outside development it refuses to start without Platform or E2B unless you set the local option, which runs commands as the server's own user with no isolation. Self-hosting is possible; the guided setup signs you in to Mastra Platform first.
- **Memory recall:** embeds locally with fastembed by default; thread text goes to a provider only if you pick a remote embedder.

## Compare and contrast

### Where they overlap

| Warden | Mastra or Mastra Factory |
| --- | --- |
| State machine for items (triage, review, implement, rework, sweep, retro) | Factory board phases with outcomes and exit tools |
| `AgentRunner` seam running OpenCode sessions with schema-checked results (ADR 0006) | Mastra `Agent` with structured output, or a Factory phase runner |
| Fresh session per item, turn caps | Per-card sessions, goals with run budgets |
| Built-in tasks, repos configure behaviour (ADR 0001, 0009) | Skills per phase, configurable boards |
| Replay set and scorecard (ADR 0018) | Evals: datasets, experiments, scorers, gates and verdicts |
| Cross-family review panel (ADR 0021) | Nothing built in; you would compose it |
| Endpoint records for OpenAI-compatible and Anthropic APIs | `{ id, url }` custom endpoints and the model router |

### What Warden does that Mastra does not

- **Review only for outside contributors.** Warden never pushes to a contributor's branch; findings go to the author. Factory is built around its own agent writing and fixing code.
- **Never approves.** Warden leaves comment reviews and its own pass/fail check (owner ruling, 2026-11-26). Factory posts GitHub approvals.
- **State on GitHub, no database.** One ledger comment per item, an append-only inbox issue, a label-epoch lease for a single writer, receipts and recovery (ADR 0012). Factory needs a database server and keeps its board there.
- **Written authority.** `.github/ORDERS.yaml` standing orders with a closed vocabulary, deny-over-allow, and PRs that cannot authorize themselves (ADR 0010).
- **Merge gates.** Blocker findings always stop a merge, other severities by config, expected-head checks, 24-hour approval expiry (ADR 0008).
- **Contributor clocks.** Nudges at 48 and 72 hours, close at five days, issue back to ready ([ADR 0002](../adr/0002-stale-clocks.md)). Factory has no equivalent for outside contributors.
- **Stop controls** derived from operator-attributed GitHub events, re-read before every effect.
- **No silent model fallback**, enforced by preflight.
- **Protected paths** for agent instruction files (PR #59). Factory's review skill treats those files as diff content but has no fixed human gate for them.
- **Thin and auditable:** three dependencies, no telemetry.

### What Mastra could replace or add

- **Replace OpenCode with a Mastra Agent as the runner.** Possible behind the `AgentRunner` seam, but it swaps one harness for a heavier one and gives up OpenCode's process isolation and tool allowlists, which Warden has already proved. Not worth it now.
- **Use Mastra workflows for the state machine.** Suspend and resume plus snapshots resemble Warden's approvals, but they live in Mastra's storage, not on GitHub, which breaks ADR 0012's single source of truth.
- **Use `@mastra/evals` for the replay set.** The closest real fit, but the shape is easy to copy and the package pulls in `@mastra/core`.
- **Adopt Mastra Factory instead of Warden.** No. It is pre-1.0, needs a server and a database, approves PRs, and is aimed at a team's own repositories rather than a solo maintainer facing outside contributors.

### Ideas to borrow, in detail

1. **Steering is a blocking finding.** Warden's [PRD](../prd/0001-warden-of-the-gate.md) already requires prompt-injection test cases but does not say what a review does when it meets one. Factory's rule: author-controlled text that tries to direct the reviewer is a blocking security finding, while a third-party bot's boilerplate ("Prompt for AI Agents") is ignored and is not held against the author.
2. **Triage of existing reviews.** Before Warden's own pass, collect submitted reviews, unresolved threads (paginated) and bot summaries, and mark each finding confirmed, addressed (fix verified in code, not by the resolved flag) or refuted (with evidence). Wait for review bots that are still running. This fits ADR 0021's merge-by-fingerprint.
3. **Write your own design before reading theirs.** Factory's reviewer records the simplest design from the base branch and the problem before opening the diff. It matches ADR 0015's reviewer independence and is cheap to add to the review prompt.
4. **Verdict shape for the replay set.** Gates must be perfect, thresholds are tracked, and the result is passed, scored or failed. Gives the scorecard a clear line between "broke a rule" and "slipped on a metric".

## Open questions

- Should ideas 1 and 2 above become an amendment to the review contract (a new ADR or an edit to ADR 0015/0021)?
- Does open-core, with enterprise code inside Mastra's core package, pass the owner's licence rule? It only matters if a Mastra piece is ever proposed.

## Sources

- Mastra repository, `main` at `b05048d`: `README.md`, `LICENSE.md`, `ee/LICENSE`, `docs/src/content/en/docs/license.mdx`, `docs/src/content/en/models/index.mdx`, `packages/core/package.json`, `packages/core/src/telemetry/`, `packages/connect/`, `mastracode/factory/README.md`, `mastracode/factory/src/boards/work.ts`, `mastracode/factory/factory-skills/factory-review/SKILL.md`, `mastracode/web/.env.schema`, `docs/src/content/en/docs/evals/gates-and-verdicts.mdx`.
- Mastra blog: [Announcing Mastra 1.0](https://mastra.ai/blog/announcing-mastra-1) (Jan 20, 2026), [Announcing Mastra Factory](https://mastra.ai/blog/announcing-mastra-factory) (Jul 27, 2026), [New capabilities in Mastra Factory](https://mastra.ai/blog/announcing-new-capabilities-in-mastra-factory) (Nov 18, 2026).
- Enterprise DNA, [AI Pulse, Nov 18, 2026](https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-11-18-mastra-shares-its-software-factory).
- Warden repository, `main` at `e6d2658`: README, PRD 0001, ADRs 0001 to 0022, `docs/research/STACK.md`, `packages/warden/package.json`.
