# Project Research Summary

**Project:** The Warden of the Gate (`/warden`, `.github/warden.yml`)
**Domain:** A Claude Code plugin that runs locally in batches as an AI-assisted maintainer for a GitHub repo. GitHub Actions does the non-AI bookkeeping, and posts go out under a GitHub App identity.
**Researched:** 2026-11-10
**Confidence:** MEDIUM-HIGH. Stack is HIGH; architecture, pitfalls and features are MEDIUM.

## Executive Summary

The Warden is a state machine that has an AI worker attached. It is not an AI reviewer with some state bolted on. The comparable tools the researchers surveyed fall short in different ways:
- CodeRabbit and Copilot keep little state, or keep it inside the vendor.
- gh-aw is stateless.
- actions/stale and Prow count days, not hours, and can't tell who acted.

The Warden's value comes from three things:
- Each item's state lives on GitHub where anyone can inspect it: one state label plus one ledger comment written by the App.
- Skip decisions are made by scripts before any AI runs.
- The maintainer sees a short decision card at a human gate.

All four researchers arrive at the same rule: **AI proposes, scripts dispose.**
- Each `claude -p` session is a pure function. Packet files go in and `structured_output` JSON comes out. The session holds no write credential and decides no state.
- A deterministic runner picks the queues, computes deltas, assigns tiers and enforces caps.
- One poster is the only holder of the App write token. It validates each result and posts through a sink (GitHub, Shadow or DryRun), using an outbox so every post happens exactly once.

**Stack decision** (this settles the item PROJECT.md deferred): **TypeScript, erasable syntax only, on Node.js with `engines >=24.12` (develop on 26.x LTS), as ESM, bundled by esbuild into committed `dist/*.mjs` files with no runtime dependencies.**
- One `warden-core` library serves the local runner, the poster, setup, and the Actions JS actions (`runs.using: node24`). The ADR 0002 clocks are implemented exactly once.
- Modular Octokit plus `@octokit/auth-app` mint two down-scoped installation tokens per run, one read and one write.
- `yaml` parses config and keeps comments when editing it.
- TypeBox 1.x feeds Ajv 8 (JSON Schema 2020-12). This one source produces the published config schema, the ledger schema and the `--json-schema` result contracts.
- Testing: Vitest 5 with fake timers, fast-check, and Stryker on the clock and tier modules.
- Tooling: Biome, actionlint, zizmor, and `claude plugin validate --strict`.
- Claude Code must be >= 2.1.302. Never use `--bare` or the Agent SDK.
- Scheduling uses a launchd LaunchAgent with `StartCalendarInterval` so missed slots catch up on wake. Not `StartInterval`, not cron.

**The main risks are security and trust, not review quality:**
1. Prompt injection from fork PRs and issue text into a session that holds tools on the maintainer's machine. This is worse than it looks: without `--bare`, `claude -p` loads the owner's global hooks, MCP servers and skills that can merge.
2. Implement and Rework sessions need Bash while reading untrusted issue text.
3. Billing can silently switch to an API key through an environment variable or `apiKeyHelper` in settings.
4. Ledgers can be spoofed or corrupted.
5. A naive `lastReviewedSha..head` delta re-reviews after every rebase and reviews code merged in from base.
6. Turning stale handling on could close a wave of the ~72 old PRs at once.

The mitigations are structural:
- Prefetched packets.
- Fixed tool lists.
- Isolated settings.
- Sessions that fail closed at the `system/init` event.
- Allowlists in the poster.
- Ledgers trusted only when the App ID matches.
- Interdiff-based deltas.
- Stale clocks that start at go-live.

Nearly all of them have to land in Foundation. Seven conflicts between the researchers need owner decisions before Foundation is locked. They are collected below.

## Conflicts Needing Owner Decisions

| # | Conflict | Sources | Recommendation | Decide by |
|---|----------|---------|----------------|-----------|
| 1 | **Continuing from the author's branch vs never checking out fork code.** ADR 0002 and PRD req 18 say the next person continues from the author's branch with `Co-authored-by`. PRD req 12 forbids checking out or running fork code, and continuing means running the fork's code in tests. | FEATURES Conflicts; ARCHITECTURE "Second conflict"; PITFALLS C1 | In v1 the plugin never continues a fork branch. When a defect PR is closed as stale, its issue goes back to `ready-for-agent` with the facet label `has-prior-attempt`. Implement starts fresh from base. It may read the abandoned diff as data only, and credits the author with `Co-authored-by` (email taken from the API or the noreply form). Building on the author's actual commits needs a `continue-from-author` label applied by the maintainer, or stays a human-only action. Automatic continuation moves to v1.x. DCO/CLA checks interact with this. | Foundation (decide), Implement (build) |
| 2 | **triage-review "reused unchanged" (ADR 0001) vs read-only headless sessions with no owner prompts.** The real `~/.claude/commands/triage-review.md` (1,302 lines) writes to GitHub through `gh`. Its enhancement and feature lanes need `AskUserQuestion`. It finishes by shipping an out-of-scope PR **and merging it**, which breaks "never merges". | ARCHITECTURE Triage adapter; PITFALLS C2 | Leave the command text unchanged and wrap the invocation. Headless runs pass `--issue N --dry-run` with a read-only token, and the PreToolUse hook blocks writes. An adapter (`triage.resultAdapter: gsd-triage-review`) maps the command's artifacts to `triage-result.json`, and the poster applies the labels. Defect and needs-repro lanes run headless. Enhancement and feature lanes stop at `issue.awaiting-maintainer` and are finished interactively in `/warden gate`. The merge step in the middle of the run is skipped headless, and any PR it produces goes to the human gate. The owner must accept that "unchanged" means "the command is unchanged, the invocation is wrapped", or approve adding a small output-mode flag to the command. Spike this first. | Triage (spike before planning) |
| 3 | **actions/stale cannot implement ADR 0002.** It measures idle time from `updated_at`, so the Warden's own labels, nudges and ledger edits keep resetting it. It counts in whole days and has no way to express "whose turn" or "maintainer responded". ADR 0002's "stale.yml and the plugin share one config" can't work. | STACK (verified from action.yml); FEATURES; PITFALLS C3 | Build a custom Sweep in warden-core that runs every clock from `config.stale.*`. It computes author activity from GraphQL timelines filtered by actor ID. Remove GSD Core's `stale.yml` (28+14 days); `/warden setup` detects it and tells the owner to delete it. With `stale.enabled: false`, other adopters can keep actions/stale. ADR 0002 needs an amendment. | Foundation |
| 4 | **Intake must not use `pull_request_target`.** GitHub blocks it by default in public repos from **2026-12-02**, with brownouts on Nov 9 and Nov 16. ARCHITECTURE still lists it for intake and for the sweep's `synchronize` flip; STACK and PITFALLS forbid it. | STACK; PITFALLS C4 (contradicts ARCHITECTURE) | Use `pull_request_target` nowhere. Issues use `issues` and `issue_comment` events. New PRs get labelled, and pushes flip PRs to `needs-rereview`, from two places: the scheduled Sweep polling GraphQL (hourly or every 2h), and the runner's queue selector comparing head to `lastReviewedSha`. The owner should confirm that labels arriving within one sweep interval, rather than instantly, is acceptable. | Foundation |
| 5 | **GitHub App `[bot]` badge vs ADR 0003 "never calls itself a bot".** GitHub always shows an App author as `<slug>[bot]` with a badge, and that can't be changed. Separately, `@trek-e` in the header notifies the owner on every post. | STACK; FEATURES; PITFALLS P10 | Narrow ADR 0003 to "text the Warden writes never calls itself a bot". Pick an App slug that still reads honestly with the suffix, such as `trek-e-warden`. Word the header to own the badge: "AI-assisted review drafted by Claude under `trek-e`'s rules; trek-e is accountable." Refer to the owner in backticks, without `@`. The poster inserts the header, not the model. | Foundation (App naming), Review live (wording) |
| 6 | **Backlog buckets A–F are not defined anywhere.** The PRD, PROJECT and ADRs never define them, but the Foundation gate depends on them. | ARCHITECTURE Gaps; FEATURES | Define them in the Foundation discussion. Candidate set: A never reviewed; B reviewed, waiting on author; C waiting on maintainer; D stale candidate; E bot-authored; F blocked (CI red or merge conflicts). Add "last Sweep run" and a distinct-contributor count to the report. | Foundation (discuss-phase) |
| 7 | **Implement/Rework isolation vs the owner's choice of "configurable, default main login".** PITFALLS says Implement/Rework (Bash + untrusted issue text + `postinstall` supply-chain risk) needs Claude Code's OS sandbox or a separate macOS user, and recommends that as the default for public repos. Bash deny rules alone can be bypassed. | PITFALLS P2; STACK variant; ARCHITECTURE Gaps (OAuth under a separate user is unverified) | Keep the owner's configurable default. When `isolation: main-login` is set, Implement/Rework must run with sandboxing (filesystem and network allowlists) in throwaway worktrees. Each session excludes project and local settings via `--setting-sources`, sets `disableAllHooks`, uses `npm ci --ignore-scripts` where possible, and holds no credentials. Setup warns that public repos should use the separate-user option. The owner decides whether the sandbox is mandatory or advisory. | Foundation (runner support), Implement (blocking prerequisite) |

Smaller disagreements the roadmapper can settle during planning:
- **`bin/`:** leave it out. Skills and the runner call the bundle by absolute path, because anything in `bin/` lands on PATH in headless sessions too.
- **Triage session token:** triage needs Bash, and a session with Bash can drop `GH_TOKEN` and fall back to the keychain `gh` write token. So prefetch the issue thread and point `GH_CONFIG_DIR` at an empty directory.
- **Settings for triage:** load the command through `--plugin-dir` and an explicit command file. Don't load the user's settings. Settle this inside the conflict #2 spike.
- **Ledger encoding:** use escaped JSON with `rev` and a checksum. It stays readable when debugging.

## Key Findings

### Recommended Stack (STACK.md)
- **Node >=24.12, TypeScript 7 (type-check only), esbuild 0.28, committed `dist/`:** one codebase serves local runs and Actions, and nothing gets npm-installed at runtime.
- **GitHub access:** modular Octokit, `@octokit/auth-app` 8.3, and `create-github-app-token` v3 with the `client-id:` input. Read and write tokens are separate. The App never gets the `workflows` permission.
- **Schemas:** `yaml` 2.9, TypeBox 1.x and Ajv 8 give one source for every schema. TypeBox 1.x is MEDIUM confidence; verify it in Foundation.
- **Claude Code >= 2.1.302** runs as a spawned process with:
  - `--output-format json --json-schema`
  - `dontAsk` and `--permission-prompts none`
  - `--max-turns`
  - `--tools`
  - `--strict-mcp-config`

  Never use `--bare`, `--dangerously-skip-permissions` or the Agent SDK.
- **launchd LaunchAgent:** lives in `gui/<uid>` and uses `StartCalendarInterval` and `bootstrap`. A stable launcher sits in `${CLAUDE_PLUGIN_DATA}`. PATH is set explicitly, and batches run under `caffeinate -i`.
- **Packaging:** the marketplace and plugin share one repo, and the shipped plugin lives under `plugin/`. Use `skills/`, set an explicit `version`, run `claude plugin tag`, and keep `vX.Y.Z` plus a moving `v1` tag.

### Expected Features (FEATURES.md)
- **Table stakes:**
  - Schema-validated config with `schemaVersion`.
  - Dry-run for every task.
  - Kill switch plus `warden:hold`.
  - Exactly one state label per item, with an invariant check.
  - Whose-turn stale handling with exemptions.
  - Caps.
  - Batches that resume from GitHub state.
  - COMMENT-only reviews.
  - No re-review of an unchanged head.
  - Interdiff review.
  - AI disclosure inserted by the poster.
  - Intake template check.
  - Bounded nudges.
  - A reopen path in close messages.
  - Metrics.
  - Idempotent setup.
- **Differentiators:**
  - Finding fingerprints that persist across pushes.
  - Re-checking open findings.
  - A won't-fix that sticks.
  - A decision card of about 15 lines.
  - Rules read only from base.
  - Deterministic gates.
  - Risk tiers.
  - A verifier with a cap on findings.
  - A whose-turn stale clock.
  - Claim windows.
  - Shadow mode with agreement scoring.
  - Retro learning from maintainer comments only.
  - Merge Danger.
  - Evidence that the test failed first.
  - Rework capped at 3 rounds.
  - Running on the owner's own subscription with no API key.
- **Anti-features (do not build):**
  - Auto-merge or approve.
  - Auto-closing duplicates.
  - Real-time chat commands.
  - Learning from anyone's replies.
  - Walkthroughs.
  - Floods of nits.
  - Full re-review on every push.
  - A three-stage lifecycle.
  - Staling items that wait on the maintainer.
  - Pushing to contributor branches.
  - AI in Actions.
  - Automatically applying `approved` or `wontfix`.
  - A dashboard.
  - A merge queue.
- **Deferred:**
  - v1.x: `/warden status` digest, AI duplicate candidates, automatic branch continuation, first-contribution line.
  - v2+: non-macOS schedulers, multiple maintainers.

### Architecture Approach (ARCHITECTURE.md)
1. **warden-core** holds:
   - Config layering and migrations.
   - A state machine of canonical IDs mapped to the repo's configured labels, with a transition table that says which actor may do what.
   - The ledger codec and `LedgerStore`, with GitHub and Local backends.
   - The App client.
   - Clocks, tiers and fingerprints.
2. **Actions (intake, claim, sweep)** are JS actions that call core. Each item gets a `concurrency` group with `queue: max`. Every job checks the kill switch and has a sender-ID guard against recursion.
3. **Runner** handles:
   - Preflight checks and a lock.
   - Catch-up after sleep.
   - Queues, caps and leases.
   - One fresh `claude -p` per item and per specialist.
   - A clean stop when limits are hit.
4. **Gatherer** builds the packet from a bare mirror without checking anything out. The packet holds the effective delta, open findings at their relocated anchors, base-branch rules, CI results and the tier.
5. **Validator, Poster and Sinks:**
   - Policy checks: a label allowlist per task, COMMENT only, no mentions, secrets or external images, and findings must fall inside the delta.
   - An outbox, the voice header, and the only copy of the write token.
6. **Setup and the bucket report** involve no AI.

Key patterns:
- The ledger has sections owned by each writer, plus a lease, a re-read before each write and a check after it. GitHub has no conditional PATCH, so this is the only protection.
- Labels change by adding the new one, then removing the old one. Never replace the set with `PUT`.
- When the maintainer moves a label, that move wins.
- Specialists run as sequential sessions, with the verifier last.
- The effective delta is found by comparing per-file patch hashes against the merge base.
- A ledger is trusted only when its author is the App's numeric bot ID.

### Critical Pitfalls (PITFALLS.md)
1. **Prompt injection.** Prefetch everything. Review sessions get only `Read,Grep,Glob`, with `--disallowedTools "mcp__*"` and `--strict-mcp-config`. Isolate settings: no project or local settings, `disableAllHooks`, and `--plugin-dir` loading only the Warden. Fail closed if the `system/init` event lists unexpected tools. The poster treats every result file as hostile. Run a red-team suite in every phase.
2. **Implement/Rework attack surface.**
   - Run sandboxed or as a separate macOS user, in throwaway worktrees, with no credentials in the session and `--ignore-scripts` where possible.
   - The App has no `workflows` permission.
   - A commit-range validator checks that the failing test was committed before the fix and that no protected paths were touched.
3. **Silent API-key billing.**
   - The preflight refuses to start if `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, any cloud-provider variable, or `apiKeyHelper` appears in the environment or in any settings file.
   - It requires a claude.ai/firstParty login.
   - Pin the Claude Code version and set `DISABLE_AUTOUPDATER=1`.
   - Watch for `--bare` becoming the default for `-p`.
   - Interactive `/warden` runs the same check.
4. **Ledger integrity.**
   - Check the App ID.
   - Encode the payload with `rev` and a checksum, and compact old findings.
   - Make the ledger rebuildable from the SHA markers in the App's reviews.
   - Refuse to write a ledger newer than the writer's version, and move to `needs-human` on a parse failure.
5. **Wrong delta and race between review and post.**
   - Review the interdiff, not the commit range.
   - Skip when the PR-diff hash is unchanged, which also covers rebases.
   - Post against the SHA that was reviewed (`commit_id`) and validate inline positions.
6. **Stale clocks closing a wave of PRs at go-live.**
   - Start the clocks at go-live and cap closes per day.
   - Exempt PRs the App authored.
   - Add a pinned "how Warden works" issue and a distinct-contributor metric.
7. **Headless stalls and shared limits.**
   - Set `--max-turns` per task and a wall-clock limit (SIGINT, then SIGTERM).
   - Classify every result subtype.
   - Stop the whole batch on a rate-limit or auth error.
   - `-p` shares the limits of interactive use, and that policy changed twice in 2026.

### External validation: Tan, "All Code Is Slop (Except Mine)" (Nov 2026)

Lauren Tan (poteto), Principal Engineer on SpaceXSI's Grok Bot team, published the strongest public articulation of how trust in agent-written code is actually built. Full analysis: [TALK-SLOP.md](TALK-SLOP.md); the operational framework derived from it: [FRAMEWORK-CORRECTIONS.md](FRAMEWORK-CORRECTIONS.md).

- **The trust pyramid:** code itself (API design, architecture) and static checks (lint, types, tests) are the deterministic layers that "force agents to do the right thing by default"; verification (runtime + formal) supplies evidence about behavior and intent; prose (rules, skills, AGENTS.md) is the weakest layer, reserved for judgment. This validates Warden's ordering of deterministic gates before AI review.
- **The correction principle:** every time an agent is corrected, the correction becomes a deterministic check — or the problem is eliminated categorically through better design. Before adding an instruction, ask if it can become a check; before adding a check, ask if better design removes the invalid choice. This is now Retro's decision procedure (design > lint > verification > prose).
- **Comments are not enforceable:** agents use comments to justify workarounds, and the next agent copies the workaround as if it were established (Cursor's timer spread). Grok Bot bans 99% of comments; the replacement is lint rules whose error messages point at the root-cause fix. New pitfall P11 (PITFALLS.md) and a comment-restrictive policy for Implement/Rework prompts.
- **The codebase is the agent's largest input:** workarounds, anti-patterns and deprecated code are weeds that agents copy. Warden's own bot PRs must not plant them; the repo lint (including Retro-added rules) runs in preflight, and a v1.x "garden" report tracks old pattern instances.
- **Verification eats the token budget:** ~70% of daily tokens go to verification (Tan and a peer she cites). The verifier pass deserves the bulk of review session budget; decision cards should carry verification evidence (failing-first red run, test output).
- **Foundations before factories:** "if your inner coding loop produces slop, then automating that loop just produces more slop." Tan's team ships 11,000 PRs/month at a ~0.5% revert rate and automerges fuzz fixes — an end state that rests on months of inner-loop investment. Warden v1 keeps the human merge gate for everything; the framework adds a config-driven "trust dial" (per-tier gate depth) as a v2+ consideration.

### External validation: Hughes (2010), Lloyd (Nov 9, 2026), Kotyal (Nov 11, 2026)

Three more sources researched 2026-11-14, each read in full (book sections / transcripts). Full analyses: [BOOK-SE-BEST-PRACTICES.md](BOOK-SE-BEST-PRACTICES.md), [TALK-FACTORY.md](TALK-FACTORY.md), [TALK-SPEC-BUGS.md](TALK-SPEC-BUGS.md).

**Hughes, *Software Engineering Best Practices* (McGraw-Hill 2010)** — the quantitative backbone for the correction ladder, from ~13,000 measured projects:
- **The ladder's ordering is measured, not intuited:** static analysis removes ~87% of coding defects and code inspections average >65% (up to 88%) — roughly twice the efficiency of testing (<35% per form, cumulative seldom >80%). "Testing, by itself, is insufficient to achieve professional levels of quality" (p. 618). Both are top-7 best practices in his 200-item ranking; **manual testing is *neutral*** (0.17) — automation is what counts.
- **"Quality leads and productivity follows":** finding/fixing bugs is the most expensive activity; improving productivity without quality first "is ineffective" (p. 7). The economic citation for spending review budget on gates and verification, not raw throughput.
- **Metrics malpractice:** LOC and cost-per-defect are ranked *unsafe* (−4.5 / −2.83) and "close to being professional malpractice" — they distort data so badly they *make quality worse* (Table 9-19). The "100× post-release fix cost" is debunked as an artifact of the broken metric (p. 18). Warden's reports must never use them (new Pitfall 12).
- **Bad fixes:** ~7% of defect repairs inject new defects; tertiary bad fixes exist (p. 614) — empirical backing for the 3-round rework cap and post-repair preflight.
- **Renovation / garden:** "structural decay always occurs" (p. 14); leaving error-prone modules in place is a *worst practice* (−6.83). Industrial precedent for the v1.x garden report.
- **Specs rot:** "the original requirements and specifications usually lag" — business rules must be mined from code (p. 14). Supports spec-verification and REVIEW.md drift detection.

**Lloyd, "How to Build a Software Factory That Improves Itself" (Warp, Nov 9)** — the self-improving loop at team scale:
- **The loop:** store every agent run → LLM-as-judge scores ("online evals") → agents aggregate failure modes into patterns → **PRs to the factory definition** (example: "read matching repository skills before implementing — failed 37 times → fix via PR"). Validates Warden's Retro and adds two inputs it lacks: **Warden's own session traces** and **LLM-judged run scores** (v1.x; the human gate stays — Lloyd admits he hasn't added human grading).
- **Factory defined in code, versioned** (workflows, skills, MCPs, run locations) → testable and updatable by agents. Validates ADR 0005 config-as-code: `warden.yml` + skills + prompts *are* the factory definition.
- **Measurement first on your own data:** public benchmarks untrustworthy; replay past tasks against model configs → cost-vs-quality graph (93% @ $2 vs 95% @ 3×) → model routing. Warden analog (v1.x): benchmark replay of past tasks.
- **Honest contrast:** Lloyd's factory is cloud-sandboxed (a compromised local agent "takes over the user"; per-user MCPs un-auditable). Warden is deliberately local (ADR 0004 cost) — and Lloyd concedes his platform "is just overkill for an individual… you're probably gonna want to use your Claude Code subscription." Warden answers the security half with sandbox/isolation (Pitfall 2) and the audit half with stored traces + ledger, locally.

**Kotyal, "Your Spec Has Bugs. Catch Them Before Your Agent Codes." (AWS, Nov 11)** — spec verification as a pre-Implement gate:
- **The problem:** specs handed to coding agents contain contradictions and gaps; unclear prompts drop accuracy 20–40%, "60–90% of valid code is still wrong after it writes it", ~2× regressions on deploy (his cited stats). Example: "place the order as a backorder" + "no order shall be placed as a backorder" — each rule reads fine alone; together they can't both hold.
- **The process (Kiro specification analyzer):** LLM refines wording → formalize English to SMT formulas → SAT/SMT solver (valid/invalid) → on ambiguity, re-iterate; sample translations 7–10× and cluster by logical equivalence → accept / ask the human to disambiguate ("remove the record": delete vs hide) / **abstain from implementing**.
- **The division of labor:** "there is no oracle for specification correctness other than the user… The LLM translates, the solver checks and the human decides." Same philosophy as "AI proposes, scripts dispose" + human gate. Matches Hughes: requirements defects are the one class only pre-code checking can catch (testing never finds them).
- **For Warden:** new Pitfall 13 (spec contradictions flow into bot PRs). v1 minimal version = Implement prompt requires a *stated interpretation* of ambiguous rules; disagreement → open finding for the gate, never a silent guess. v1.x = formal check (SMT/solver) of the issue spec before Implement.

### External check: Pocock walkthrough and `software-factory` skill (Nov 18, 2026)

Matt Pocock's ~70-minute end-to-end build with his own skills, plus the primary skill sources (`retro`, `pr`, `triage`, `implement-spec`, in-progress `software-factory`). Full analysis and the assumption table: [TALK-POCOCK-WALKTHROUGH.md](TALK-POCOCK-WALKTHROUGH.md). Self-reported single-user demo: **workflow evidence, not outcome evidence**.

- **Strengthened:** Retro as the human-review-to-automated-check loop (all 12 review comments shared one root cause; the repo already violated the rule thousands of times); comments as workaround licences (Pitfall 11; measured 12% of repo vs ~20% of the new feature); bounded one-ticket sessions with fresh context; decision-space reduction before AFK work; shadow-first, throttled, human-reviewed rollout ("start slow") and the per-task checklist (trigger, effects, next trigger, human re-entry, duplicate-run guard).
- **New to our docs (proposed, not applied):** a **ratchet** concept for rules the repo already violates; a recorded **reversibility (one-way/two-way door)** input to the merge gates; a **reviewable-diff-size cap** with a "split first" outcome; "prototypes are references, never pasted code" for Implement; "file an issue against the factory's own prompts/config" as a Retro output.
- **Not adopted:** merge-then-review, parallel implementers and auto-merge; they rest on a single-user repo and a frontier model.
- **Do not copy his token thresholds** (his own view is that the smart/dumb-zone line is moving); measure per local model.

## Implications for Roadmap

The six phases match the owner's six v1 rollout stages.

### Phase 1: Foundation
- **Why first:** every task reads labels and the ledger. Ledger concurrency and versioning can't be added later on live PRs, and credential and isolation guards must exist before any AI runs. Settles conflicts 1, 3, 4, 5 and 6, plus the runner half of 7.
- **Delivers:**
  - Repo skeleton and CI: Biome, tsc, Vitest, the dist diff check, plugin validate, actionlint and zizmor.
  - Core: config (defaults, TypeBox schema, migration scaffold, `examples/gsd-core.yml`), the state machine, the App client with read and write tokens, and the ledger codec, both stores and the concurrency protocol.
  - `/warden setup`: labels, starter config, `stale.yml` detection and workflow templates.
  - Intake for issues only.
  - Sweep: issue clocks, label reconciliation, metrics, new-PR labelling by polling, and PR nudges only where the maintainer responded.
  - Kill switch: repo variable plus a local STOP file.
  - Runner skeleton with every preflight guard, switched off.
  - launchd install and the bucket report.
- **Avoids:** P3, P4, P10, C3, C4, launchd quirks, and config or release version skew.
- **Gate:** the bucket report matches the maintainer's sense of the backlog.

### Phase 2: Review Shadow
- **Why here:** this is the riskiest AI path, but it can't affect anything outside the machine. It proves zero re-reviews and finding quality. Building the sink and the outbox here means Phase 3 is a swap, not a rewrite.
- **Delivers:**
  - Gatherer working from a bare mirror.
  - Effective delta and fingerprints.
  - Tiers and deterministic gates.
  - Packet builder.
  - Review, specialist and verifier agents, with their result schemas.
  - Validator.
  - ShadowSink with LocalLedger, and the outbox.
  - Runner batch loop: caps, turn limits, wall clock, leases, catch-up and result subtypes.
  - Shadow report with agreement capture.
  - Red-team PR suite.
- **Avoids:** P1, P5, P8 (measurement) and P9.
- **Gate:** at least 7 in 10 blocking findings agreed with, and zero head re-reviews.

### Phase 3: Review Live
- **Why here:** only the sink changes. Sweep can close stale PRs only once reviews are actually being posted.
- **Delivers:**
  - GitHubSink: one COMMENT review pinned to the reviewed SHA, with validated inline positions.
  - Voice header and decision card.
  - `/warden gate` and `/warden wontfix F<n>`, accepted only from the maintainer's login.
  - Sweep PR nudges and closes, with clocks starting at go-live and a daily cap.
  - Flipping PRs to `needs-rereview`.
- **Avoids:** P6, P7, the P10 wording issue, and P8 (caps).
- **Gate:** maintainer minutes per PR go down, and contributors aren't confused.

### Phase 4: Triage and Claim
- **Why here:** triage needs the poster and the gate from Phase 3. Claim matters only once triage starts confirming bugs.
- **Delivers:**
  - The triage adapter (conflict #2).
  - Issue ledger.
  - Interactive lanes in `/warden gate`.
  - Claim workflow: offer detection, window and expiry, recorded as a label plus a ledger entry, then the move to `ready-for-agent`.
- **Avoids:** C2, and P1 through token isolation, since triage has Bash.
- **Gate:** 9 in 10 issues labelled the way the maintainer would.

### Phase 5: Implement and Rework
- **Why here:** needs the `ready` issues from Phase 4 and the live review loop from Phase 3. Conflict #7 (isolation) blocks this phase, and conflict #1 (continuation) is built here.
- **Delivers:**
  - Throwaway worktrees with isolated settings, and enforced sandbox or isolation.
  - Implement and rework skills that run the configured test and preflight commands.
  - Commit-range validator.
  - Poster pushes to `warden/**` and opens the PR with Merge Danger and the evidence of the failing run.
  - Throttles of one per day and one open bot PR.
  - Human gate after 3 rework rounds.
  - `Co-authored-by` credit.
  - Docs for the repo ruleset.
- **Avoids:** P2 and C1. Pair the "merged after a quick look" gate with an escaped-defect metric so it can't be gamed.
- **Gate:** bot PRs merge after a quick look more often than they bounce.

### Phase 6: Retro and Release
- **Why here:** Retro needs the maintainer review comments that Phases 3–5 produce.
- **Delivers:**
  - Collector of maintainer-only comments, filtered by numeric ID.
  - Retro skill, applying the correction ladder (FRAMEWORK-CORRECTIONS.md): each recurring correction lands on the strongest rung it can express — design change > lint rule with root-cause error message > test/verification > `REVIEW.md` line.
  - Weekly PR to `REVIEW.md` or lint config, showing which rung each rule landed on, the running rule count and conflicts.
  - Release: v1.0.0 tag, changelog with migration notes, adopter docs including separate-user isolation, an upgrade rehearsal, and a second repo onboarded from the docs in an afternoon.
- **Avoids:** injection through learning from anyone's replies, `REVIEW.md` bloat, and breaking adopters on release.
- **Gate:** the weekly rules PR lands, the second repo is onboarded, and v1.0.0 is tagged.

### Phase Ordering Rationale
- State, ledger, config and auth come first because everything depends on them, and schema v1 is hard to migrate on live PRs.
- Sweep is split on purpose: issue clocks in Phase 1, PR closes in Phase 3.
- Claim is an Actions task with no AI, but it lands in Phase 4 because nothing feeds it before then.
- Version discipline (`schemaVersion`, `ledgerVersion`, compatibility checks) starts in Phase 1, even though release hardening happens in Phase 6.

### Research Flags
- **Phase 2 needs research:**
  - Whether `--restricted` together with subscription OAuth and `--plugin-dir` works.
  - Limits on the JSON Schema subset that structured output accepts.
  - Which fields signal a usage limit under subscription auth.
  - The shape of the `system/init` event.
  - The interdiff algorithm against real rebase fixtures.
- **Phase 4 needs research:**
  - A spike of the real `/triage-review` under `--dry-run` with writes denied.
  - The command's artifact formats.
  - How to load settings for it.
- **Phase 5 needs research:**
  - Claude Code sandbox configuration on macOS.
  - A LaunchAgent and OAuth running under a separate macOS user.
  - What DCO/CLA checks do with commits the App authors.
- **Phase 6 (Retro) has a defined decision procedure** in FRAMEWORK-CORRECTIONS.md; its open research is the Biome v2.6 JavaScript-plugin API (developer preview) for custom lint rules with root-cause error messages, and the two-severity trick (error for new code, warn on a legacy file list) in whatever linter the adopting repo uses.
- **Phases 1 and 3 follow standard patterns:** Phase 1 only needs quick tests of TypeBox 1.x and the comment size limit.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against the installed CLI 2.1.322, the launchd man page, the npm registry and the actions' action.yml files. TypeBox 1.x and the `--restricted` interactions are MEDIUM. |
| Features | MEDIUM | The categories are judgment calls based on the PRD/ADRs and official vendor docs. Web sources are LOW. |
| Architecture | MEDIUM | Platform facts are quoted from docs, but the design itself hasn't been tested on a live repo. Its use of `pull_request_target` is overridden by conflict #4. |
| Pitfalls | MEDIUM | Official docs back the platform behaviour. Incident reports are LOW, and several items are inference. |

**Overall:** MEDIUM-HIGH.

### Gaps to Address
- The seven owner decisions above, especially #2 and #7, which reshape Phases 4 and 5.
- Defining buckets A–F.
- Whether `--restricted` and `--setting-sources` work with OAuth and `--plugin-dir` (Phase 2 spike).
- The comment size limit of about 65,536 characters (test in Foundation).
- How usage-limit signals appear, given the volatile shared-limit policy (Phase 2).
- Keychain and OAuth under launchd for a separate user (Phase 5).
- How won't-fix is captured: thread resolve via `isResolved`, or a `/warden wontfix` comment (decide in Phase 3).
- GitHub disables scheduled workflows after 60 days with no repo activity, so show "last Sweep run" in the report.
- How claims work for users outside the org (Phase 4).

## Sources
- **Talk, read in full 2026-11-14 (HIGH for what it claims; team metrics self-reported):** Lauren Tan, "All Code Is Slop (Except Mine)", AI Engineer CODE 2026 — https://www.youtube.com/watch?v=ZZ19zhYnDKY (channel upload: https://www.youtube.com/watch?v=O_zcc6Xl12g; reading edition: https://ai.engineer/code/2026/talks/lauren-tan; transcript archived at sources/lauren-tan-slop-transcript.md). Tooling facts: Biome v2.6 JS plugins (https://biomejs.dev/blog/biome-v2-6), ESLint no-restricted-syntax, dependency-cruiser, antithesishq/bombadil.
- **Book, sections read in full 2026-11-14 (HIGH for what it claims; data circa 2009–2010, pre-AI):** Bob Hughes, *Software Engineering Best Practices*, McGraw-Hill (2010) — user-provided PDF https://repo.darmajaya.ac.id/4704/1/Software%20Engineering%20Best%20Practices%20%28%20PDFDrive%20%29.pdf; analysis in BOOK-SE-BEST-PRACTICES.md.
- **Talk, read in full 2026-11-14 (HIGH for what it claims; product numbers self-reported):** Zach Lloyd, "How to Build a Software Factory That Improves Itself", Warp — https://www.youtube.com/watch?v=nKjPBAw_N_0 (uploaded 2026-11-09; reading edition: https://ai.engineer/talks/nKjPBAw_N_0-build-software-factory-that-improves-itself; transcript archived at sources/lloyd-factory-transcript.md); analysis in TALK-FACTORY.md.
- **Talk, read in full 2026-11-18 (HIGH for what it claims; LOW as outcome evidence: self-reported single-user demo):** Matt Pocock, "Watch me ship a 21,000-line feature with mattpocock/skills" — https://www.youtube.com/watch?v=jVBlkOF8sHk; skill sources read via the GitHub API from https://github.com/mattpocock/skills (`retro`, `pr`, `triage`, `implement-spec`, `in-progress/software-factory`); analysis in TALK-POCOCK-WALKTHROUGH.md (transcript deliberately not archived).
- **Talk, read in full 2026-11-14 (HIGH for what it claims; motivating stats are his citations of "public research", not independently verified):** Rajath Mahendrappa Kotyal, "Your Spec Has Bugs. Catch Them Before Your Agent Codes.", AWS — https://www.youtube.com/watch?v=0EnLxIbAvYk (uploaded 2026-11-11; reading edition: https://ai.engineer/talks/0EnLxIbAvYk-your-spec-has-bugs-catch-them-before; transcript archived at sources/kotyal-spec-transcript.md); analysis in TALK-SPEC-BUGS.md.
- **Primary (HIGH):**
  - Local CLI help and `auth status` for Claude Code 2.1.322.
  - `man launchd.plist`.
  - The npm registry.
  - action.yml for actions/stale v11 and create-github-app-token v3.
  - code.claude.com docs: cli-reference, headless, permission-modes, authentication/iam, permissions, plugins-reference, marketplaces, agent-sdk.
  - docs.github.com: REST best practices, rate limits, compare, installation tokens, concurrency, workflow triggers.
  - GitHub changelog of 2026-11-02 announcing the `pull_request_target` block on 2026-12-02.
  - `~/.claude/commands/triage-review.md`, read directly.
- **Secondary (MEDIUM):**
  - Docs for CodeRabbit, Copilot review and coding agent, Claude Code Review, gh-aw and Dependabot.
  - Apple's launchd docs and forums.
  - The support article on plan usage for `claude -p`.
- **Tertiary (LOW):**
  - arXiv 2305.18150 and 2605.16706.
  - Uber uReview.
  - PromptPwnd, s1ngularity and GitLost.
  - Vendor blogs on AI review noise.

---
*Research completed: 2026-11-10. Ready for roadmap: yes, once the owner decisions above are made.*
