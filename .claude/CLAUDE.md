<!-- GSD:project-start source:PROJECT.md -->

## Project

**The Warden of the Gate**

The Warden of the Gate (repo `warden-of-the-gate`, command `/warden`, config `.github/warden.yml`) is a versioned Claude Code plugin that helps one maintainer keep a busy GitHub repo moving. It triages new issues, reviews contributor PRs, fixes unclaimed confirmed bugs, and closes what has gone stale, then stops at a short decision card for the maintainer. It never merges. All AI work runs in the maintainer's own Claude Code on their own machine; GitHub Actions only does non-AI bookkeeping. GSD Core is the first repo it runs on, but everything repo-specific lives in one config file so any maintainer can adopt it.

**Core Value:** Every open PR and issue sits in exactly one known state, recorded on GitHub, so any run can pick up cold and no head commit is ever reviewed twice — the maintainer only sees items that need their decision.

### Constraints

- **Cost**: No API-key Claude calls anywhere — maintainer can't afford API spend for OSS maintenance (ADR 0004)
- **Runtime**: AI only runs while the machine is on and signed in to Claude Code and `gh`; launchd slots missed while asleep run on wake, missed while off are skipped
- **Throughput**: Bounded by the maintainer's Claude Code session limits; batches must leave room for the maintainer's own work
- **Platform**: macOS launchd scheduler for v1 headless runs
- **Security**: Fork PR code never checked out or executed; rules from base branch only; headless tool list restricted
- **Portability**: Nothing GSD Core-specific hardcoded; GSD Core is just the first config (ADR 0005)
- **Tech stack**: TypeScript on Node ≥24.12 (ESM, esbuild, committed `dist/`); Claude Code ≥2.1.302 pinned; never `--bare`, `--dangerously-skip-permissions` or the Agent SDK
- **GitHub platform**: No `pull_request_target`; App never gets `workflows` permission; no conditional PATCH, so the ledger relies on writer-owned sections and a re-read before every write

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## The deferred decision: script language and runtime

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Conf. |
|---|---|---|---|---|
| Node.js | **engines `>=24.12`**; develop on **26.x LTS "Lithium"** (Active LTS since 2026-10-28; 26.13.0 installed) | Runtime for all non-AI scripts and Actions | 24.12 is the floor where type stripping and `path.matchesGlob` (stable in 24.8) are stable. `node24` is the newest Actions JS runtime. Node 24 is in maintenance until 2028-04 and Node 26 is Active LTS until 2027-10 | HIGH |
| TypeScript | **7.0.x** (7.0.2, GA 2026-07-08; native Go compiler) | Type-check only (`tsc --noEmit`) | Fast native checker. Node does the stripping, so tsc never emits | HIGH |
| esbuild | **0.28.x** | Bundle `src/` into `plugin/dist/warden.mjs` and `actions/*/dist/index.mjs` | One-command ESM bundles targeting `node24`. Simpler than Rollup or ncc for a few entrypoints | HIGH |
| Claude Code CLI | **>= 2.1.302** required (2.1.322 installed) | Headless `claude -p` sessions and the plugin host | 2.1.302 makes `-p` start in Manual mode. 2.1.259 adds `--permission-prompts none` and 2.1.248 adds `--restricted`. The runner checks `claude --version` | HIGH |
| GitHub CLI `gh` | **>= 2.100** (2.103.3 current) | Read-only queries inside interactive `/warden`; `gh variable get` for the kill switch | Already on every maintainer's machine. Not used by posting code; that goes through Octokit | HIGH |
| Octokit (modular) | `@octokit/core` **7.0.x**, `@octokit/plugin-rest-endpoint-methods` **18.x**, `@octokit/plugin-paginate-rest` **16.x**, `@octokit/plugin-throttling` **11.x**, `@octokit/plugin-retry` **8.x**, `@octokit/graphql` **9.x** | All GitHub reads and writes in poster, sweep, intake, claim and setup | Throttling and retry handle secondary rate limits during sweeps. GraphQL fetches every open PR's commits, comments and reviews in one paginated query (the sweep's main cost). `request.fetch` injection makes the client testable | HIGH |
| `@octokit/auth-app` | **8.3.x** | Local JWT to installation token for the GitHub App | Accepts a Client ID as `appId` (recommended). Supports `repositoryNames` and `permissions` per token, which is how the read-only and write tokens are minted from the same App. Caches tokens for 59 minutes | HIGH |
| `actions/create-github-app-token` | **v3** (v3.3.0, 2026-10-12) | Installation token in Actions | Use the `client-id:` input; `app-id:` is deprecated in v3.1. Supports `permission-*` inputs to scope down per job. Revokes the token at job end | HIGH |
| `yaml` (eemeli) | **2.9.x** | Parse `.github/warden.yml` and `config/defaults.yml`; write the starter config | YAML 1.2. Its Document API **preserves comments**, which `/warden setup` and future schema migrations need so they can edit a maintainer's config without destroying it. Zero dependencies, ships types | HIGH |
| Ajv | **8.20.x**, imported from `ajv/dist/2020` | Validate config, ledger JSON and headless result files | The reference JSON Schema 2020-12 validator. `allErrors` gives readable config errors. It validates against the same `config/schema.json` that is published, so editor validation and runtime validation always agree | HIGH |
| TypeBox | **`typebox` 1.4.x** (the 1.x package; *not* `@sinclair/typebox` 0.34) | Author the schemas once; get TS types and emit `config/schema.json`, `ledger.schema.json` and the result schemas | A TypeBox schema *is* a JSON Schema 2020-12 object, so the published schema, the TS types and the `--json-schema` passed to `claude -p` all come from one source with no drift | MEDIUM (1.x API is young; verify in phase 1) |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Conf. |
|---|---|---|---|---|
| `ajv-formats` | 3.0.x | `date-time`, `uri` formats in schemas | Ledger timestamps (`nudgedAt`, `reviewedAt`) | HIGH |
| `@actions/core` | 3.0.x | Inputs, outputs, `setFailed`, job summary in the JS actions | Only in `actions/*` entrypoints, bundled. The metrics job summary uses `core.summary` | HIGH |
| `node:util` `parseArgs` | built in | CLI argument parsing for `warden <verb>` | Always. Do not add commander/citty for a small internal CLI | HIGH |
| `node:path` `matchesGlob` | built in (stable 24.8+) | Match tier paths from config (`tiers.full: ["src/auth/**"]`) against PR file lists | Risk tiering. Drop `picomatch` unless a needed glob feature turns out to be missing | HIGH |
| `node:child_process` `spawn` | built in | Runner spawns `claude -p` with an explicit argv (no shell) | Runner. Never build a shell string from PR content | HIGH |
| `fast-check` | 4.10.x (dev) | Property tests | Ledger serialize/parse round-trips (including adversarial strings like `-->`), "exactly one state label" invariants, clock monotonicity | HIGH |
| `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` | 10.1.x (dev) | Mutation testing | The clock and tier modules, where an off-by-one closes a contributor's PR early. Matches the owner's feature-builder mutation gate | MEDIUM |

### Development Tools

| Tool | Version | Purpose | Notes |
|---|---|---|---|
| Vitest | **5.1.x** (+ `@vitest/coverage-v8` 5.1.x) | Unit and integration tests | Engines `^22.12 \|\| ^24 \|\| >=26`. `vi.useFakeTimers()` with `vi.setSystemTime()` is essential for 48h/72h/5d/14d/28d clock tests. Snapshots cover rendered ledger comments and decision cards. Runs `.ts` with no config |
| Biome | **2.6.x** | Lint and format, one tool | Replaces ESLint 10 plus Prettier 3 for a small repo. Runs in about a second in CI |
| `claude plugin validate --strict` | ships with Claude Code | Manifest and marketplace validation in CI | `--strict` turns warnings (unknown fields, missing metadata) into failures |
| `claude plugin tag` | ships with Claude Code | Creates `{name}--v{version}` release tags after checking that plugin.json and the marketplace entry agree | Use for every release. Pair it with a plain `vX.Y.Z` tag for Actions `uses:` pins (see Versioning) |
| actionlint | **v1.7.12** | Lint workflow YAML and `${{ }}` expressions | Run on `.github/workflows/*` and on the shipped adopter workflow templates |
| zizmor | **v1.32.0** | Security audit of workflows (template injection, `pull_request_target`, unpinned actions, excessive permissions) | Mandatory: these workflows hold an App token that can write to the repo |
| `plutil -lint` | macOS built in | Validate generated launchd plists | Runs in a `macos-latest` CI job and in `/warden schedule install` |
| npm | 11+/12.x | Package manager | Must be npm: Claude Code's auto-install reads only `package-lock.json`, `npm-shrinkwrap.json` or `bun.lock`, and skips pnpm/yarn lockfiles |

## Claude Code plugin packaging

- Manifest at `.claude-plugin/plugin.json`. Only `name` is required. Set `name: "warden"`; names starting with `claude-`, `anthropic-` or `cc-plugin-` are reserved errors. Set `version`, `description`, `author`, `repository`, `license` and `homepage`.
- Use **`skills/<name>/SKILL.md`** for every user-invocable entry (`/warden`, `/warden:setup`, `/warden:review`, and so on). The docs say "Prefer `skills/` for new plugins"; `commands/` is the legacy flat-file form. Note that plugin components are namespaced (`warden:review`). A bare `/warden` needs a skill named `warden` in plugin `warden`, which shows as `/warden:warden`. Verify the exact invocation UX in phase 1 and pick skill names to match.
- **`agents/*.md`** for the specialist reviewers and the verifier pass (subagents with their own tool lists).
- **`hooks/hooks.json`** for a `PreToolUse` guard (Node script, exec form) that enforces the human gates in *interactive* `/warden` sessions. It denies `gh pr merge`, `gh pr review --approve`, `git push` to anything outside `warden/**`, and edits to `.github/workflows/**`, `REVIEW.md`, `MAINTAINERS` and the plugin itself. This is defence in depth on top of the App's permissions.
- **`bin/warden`**: files in `bin/` are on the Bash tool's PATH while the plugin is enabled, so skills can call `warden ledger read 123`. **Pitfall:** `CLAUDE_PLUGIN_ROOT` is *not* exported to Bash-tool commands, so the shim must find itself via `"$(dirname "$(realpath "$0")")"`.
- **`${CLAUDE_PLUGIN_DATA}`** (`~/.claude/plugins/data/<id>/`, kept across updates) holds durable state: run logs, the stable launchd launcher, the local shadow-mode report and the per-repo work clones. **Never write to `${CLAUDE_PLUGIN_ROOT}`**: it is a per-version cache directory, deleted 14 days after an update.
- `userConfig` (optional): non-secret machine settings such as the App Client ID or the work-clone root. `sensitive: true` values go to the macOS keychain. Repo-specific settings stay in `.github/warden.yml` (ADR 0005), not here.
- Set `"version"` explicitly in `plugin.json`. Claude Code treats the manifest version as authoritative and keeps users on the cached copy until the string changes. Without it, every commit becomes a new version (12-character SHA), which suits development but is not a "tagged release" (ADR 0005).
- Third-party marketplaces have **auto-update off by default**. Document `/plugin` > Marketplaces > Enable auto-update, or `claude plugin update warden@artificer`.
- Per release: bump `plugin.json` version, bump the `schemaVersion` the config accepts if needed, add a CHANGELOG entry with migration notes, run `claude plugin tag` (creates `warden--v1.2.0`), **and** push `v1.2.0` plus a moving `v1` tag for `uses: …/actions/sweep@v1` and the reusable workflows.
- Config carries `schemaVersion: 1`. The runner and actions refuse a config whose major version they don't support and print the migration-note URL.

## Headless `claude -p` invocation profiles

- `--output-format json` plus `--json-schema` returns the result in `.structured_output`. **The field is absent when the run ends without valid output**, so the runner must check for it and record a failed item. The runner validates `.structured_output` again with Ajv before anything is posted. This is how ADR 0004's "write results to a file; a plain script posts" works: the session never needs a Write tool or network write access, and the runner saves stdout to `${CLAUDE_PLUGIN_DATA}/runs/<run>/<item>.json`.
- `dontAsk` denies anything that would prompt. Only built-in no-approval actions (reads inside the working dirs, the read-only Bash set) and explicit `--allowedTools` rules run. `--permission-prompts none` also tells the model not to retry denied calls.
- Also read `is_error`, `subtype` and `num_turns` from the JSON result. A turn-limit stop is a clean "batch item ended". SIGTERM exits with 143; send SIGINT first for a clean stop on a wall-clock timeout.
- **Do NOT use `--bare`.** Bare mode never reads OAuth, the keychain or `CLAUDE_CODE_OAUTH_TOKEN`, so it only works with `ANTHROPIC_API_KEY`, which ADR 0004 forbids.
- `--max-budget-usd` is a client-side cost *estimate*. It is optional as a secondary brake, not a substitute for turn limits (MEDIUM; behaviour under subscription billing not verified).

| Task | Working dir | Tools | Notes |
|---|---|---|---|
| Review / verifier (fork PRs included) | Prepared context pack: base-branch worktree (read-only) plus the delta diff, open findings and rules files written by the runner | `--tools "Read,Grep,Glob"`; no Bash. If Memtrace is on: `--strict-mcp-config --mcp-config <memtrace.json>` and `--allowedTools "mcp__memtrace__get_impact" "mcp__memtrace__recall_decision"`, without `--disallowedTools "mcp__*"` | Fork code is never checked out: the runner fetches the diff through the API with a **read-only** installation token. Rules come from the base-branch worktree. Consider `--restricted` (ignores user/project settings, confines file tools to the working dirs, refuses bypass) together with `--plugin-dir` to load warden's own agents. **MEDIUM: check in a phase-2 spike that `--restricted` keeps subscription OAuth and accepts `--plugin-dir`.** macOS note: the *default* tool set leaves out Glob/Grep, so name them explicitly and confirm they appear in `system/init` |
| Triage | Dedicated work clone of the base branch | Must run the maintainer's configured command unchanged (`/triage-review`), so user settings must load (no `--restricted`, no `--setting-sources` without `user`). Allow `Read,Grep,Glob` and read-only `Bash(git log *)`, `Bash(git show *)`, `Bash(gh issue view *)` | The triage command's own needs decide the extra allow rules; record them in `config.triage.allowedTools` |
| Implement / rework (own bot branches only) | Dedicated work clone, fresh `warden/<issue>` branch | `Read,Grep,Glob,Edit,Write` plus `Bash(<config.test>)`, `Bash(<config.preflight>)`, `Bash(git add *)`, `Bash(git commit *)`, `Bash(git diff *)`, `Bash(git status *)` | The **runner** pushes and opens the PR from the result file, not the session. `GH_TOKEN` in the session's environment is a read-only token |
| Retro | Work clone | Read-only, plus `Edit` on `REVIEW.md` in the work clone | Output becomes a PR opened by the runner. The maintainer gates it |

## GitHub App authentication

- `createAppAuth({ appId: <Client ID>, privateKey })`, then `auth({ type: "installation", installationId, repositoryNames: [repo], permissions })`.
- Mint **two tokens per run from the same App**:
- Never request `workflows` permission. Without it the App *cannot* modify `.github/workflows/**`, which enforces the "workflow changes need the maintainer" gate at the platform level.
- Private key: store it in the login keychain (`security add-generic-password -s warden-github-app -a <client-id> -w "$(base64 < key.pem)"`) and read it with `security find-generic-password -s warden-github-app -w | base64 -d`. Base64 avoids `security` hex-encoding multi-line secrets (MEDIUM). Never keep the PEM in the repo or the plugin directory.
- `pull_requests: write` plus `contents: write` *can* approve and merge at the API level. The poster must have no code path to `PUT /pulls/{n}/merge` or `event: "APPROVE"` reviews (only an endpoint allowlist). Add a repo ruleset that requires a maintainer review and allows App pushes only to `warden/**`.
- uses: actions/create-github-app-token@v3
- uses: The-Artificer-of-Ciphers-LLC/warden-of-the-gate/actions/sweep@v1

## Configuration and schema validation

- `.github/warden.yml` → parse with `yaml` → deep-merge over `config/defaults.yml` (arrays replace, objects merge) → validate the **merged** result with Ajv against `config/schema.json`. Also validate the **raw** file with a no-`required` variant, so error paths point at the maintainer's own keys.
- `config/schema.json` is generated from TypeBox at build time, committed, and published at a stable raw URL per tag. The starter config written by `/warden setup` begins with `# yaml-language-server: $schema=<url>` so editors validate it for free.
- The same pipeline (TypeBox → JSON Schema → Ajv) validates the ledger block and every headless result file. The result schemas are also what `--json-schema` receives. Keep them simple (objects, arrays, enums, strings, integers; no `$ref` cycles) for structured-output compatibility (MEDIUM).
- Ledger encoding: `<!-- warden:ledger v1 {json} -->`. Escape `<`, `>` and `&` in the JSON as `<`, `>` and `&`, so a finding that quotes `-->` can't end the comment early. Keep under GitHub's 65,536-character comment body limit by capping stored finding text and keeping the full text in the review comment (MEDIUM on the exact limit).

## launchd scheduling (macOS), HIGH from `man launchd.plist`

- **LaunchAgent** in the user's GUI domain (`~/Library/LaunchAgents/com.artificer.warden.<owner>.<repo>.plist`). Install with `launchctl bootstrap gui/$(id -u) <plist>`, run on demand with `launchctl kickstart -k gui/$(id -u)/<label>`, remove with `launchctl bootout`. Do not use the deprecated `launchctl load/unload`. It must be an agent, not a daemon, because the keychain (Claude OAuth, App key) is only available in the logged-in user session.
- **Catch-up on wake = `StartCalendarInterval`** (array of `{Hour, Minute}` from `config.schedule`). The man page says: "Unlike cron which skips job invocations when the computer is asleep, launchd will start the job the next time the computer wakes up. If multiple intervals transpire before the computer is woken, those events will be coalesced into one event upon wake." **Do not use `StartInterval`**: firings missed during sleep are lost. Slots missed while powered off are not replayed (matches ADR 0004). Optional `RunAtLoad` covers boot/login, behind a config flag, and is safe because of the runner's own last-run guard.
- The plist must point at a **stable launcher** in `${CLAUDE_PLUGIN_DATA}` (or `~/Library/Application Support/warden/`), never into the versioned plugin cache. The launcher finds the current plugin install path at run time, for example from `claude plugin list --json`.
- Set `EnvironmentVariables.PATH` explicitly (launchd's default is `/usr/bin:/bin:/usr/sbin:/sbin`). Write in absolute paths found with `command -v node claude gh` at install time (for example `/opt/homebrew/bin`, `~/.local/bin`). Set `StandardOutPath`/`StandardErrorPath` under `${CLAUDE_PLUGIN_DATA}/logs/`. Set `ProcessType: Background` and `LowPriorityIO: true` so batches don't slow the maintainer's foreground work.
- Wrap the batch in `/usr/bin/caffeinate -i` so idle sleep can't cut a session short. On wake, the runner waits for the network (retry `GET /rate_limit` with backoff, up to about 2 minutes) before the kill-switch check (MEDIUM).
- Generate the plist from a template string, check it with `plutil -lint`, and snapshot-test it. No plist library is needed.

## GitHub Actions bookkeeping

| Workflow | Triggers | Does |
|---|---|---|
| `warden-intake` | `issues: [opened, edited]`, `issue_comment: [created]` | Template check, duplicate check, triage label, claim-offer detection (claim window) |
| `warden-sweep` | `schedule` (hourly or every 2h; 48h/72h nudges need sub-day resolution) plus `workflow_dispatch` | Nudges, stale closes, claim expiry, `ready-for-agent` transitions, ledger dates, metrics (job summary plus a pinned metrics issue) |
- **No `pull_request_target` workflows.** PR author activity (push, comment, review reply) is computed by the sweep from GraphQL timelines when it runs. That is stateless, never touches fork code and has no secret-exposure surface. This is the main reason to poll instead of reacting to PR events.
- Every job starts with `if: vars.WARDEN_KILL_SWITCH != 'on'` (the variable name comes from config). The local runner reads the same variable with `gh variable get <name> --repo <o>/<r>` using the maintainer's own `gh` login. The create-github-app-token v3 inputs include no variables permission, so don't rely on the App for this read (MEDIUM). A local `${CLAUDE_PLUGIN_DATA}/STOP` file is an offline kill switch.
- Pin third-party actions by full SHA (zizmor will flag tags). `actions/checkout` v7, `actions/setup-node` v7 if ever needed, `actions/github-script` v9 (not needed: logic lives in the bundled actions).
- actions/stale measures idle time from the issue's **`updated_at`**. Any update by anyone resets it: the warden's own label changes, nudges and in-place ledger edits. ADR 0002 says activity means *author* activity only, and that bot comments and CI runs don't count. actions/stale can't express that.
- It is day-granular (`days-before-stale`, `days-before-close`). It has no "only if the maintainer responded or a review was posted" condition. Requirements 17–18 (48h/72h nudges, 5-day close, reviewed defect PRs return to `ready-for-agent` with `Co-authored-by` continuation) are beyond it.
- Issues (`needs-reproduction` 14d, other waiting-on-reporter 28d) look like they fit, but have the same `updated_at` problem as soon as the warden labels or comments.
- **Action:** the sweep implements all clocks from `config.stale.*`. `/warden setup` detects an existing `stale.yml` (GSD Core has one with 28+14 days) and tells the maintainer to delete it, because two clocks are exactly the conflict ADR 0002 removes.

## Testing strategy (stack-level)

- **Vitest 5** for everything. Fake timers drive every clock. `fast-check` covers ledger round-trips and state-label invariants.
- **GitHub**: inject a fake `fetch` through Octokit's `request: { fetch }`, with recorded JSON fixtures per scenario (fork PR, force-push, author silent 49h, and so on). Don't use nock: it patches globals and lags on undici/fetch interception.
- **Headless runner**: put a fake `claude` executable first on PATH in tests. It records argv and env, emits canned `--output-format json` payloads (success, missing `structured_output`, turn limit, `is_error`, exit 143), and lets tests assert the exact flag set and that `ANTHROPIC_API_KEY` is refused or scrubbed.
- **launchd**: snapshot the generated plist and run `plutil -lint` in a `macos-latest` job.
- **E2E**: a sandbox repo with the App installed. A manually dispatched workflow runs intake and sweep against seeded issues and PRs with the clock offset by config, before each release.
- **CI matrix**: Node 24 and 26 on `ubuntu-latest` and `macos-latest`. Steps: Biome, `tsc --noEmit`, Vitest, rebuild-and-diff `dist/`, `claude plugin validate --strict plugin/` (install Claude Code in CI just for validation, with no auth needed), actionlint and zizmor.

## Installation

# Dev-only; nothing here is a runtime dependency of the shipped plugin (everything is bundled into dist/)

# Bundled into dist/ (listed as devDependencies so Claude Code never auto-installs anything)

# External tools

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| Node + TS (bundled) | Bash + `gh` + `jq` | Only for the `bin/warden` shim and the launcher. For logic it fails on GNU/BSD `date` differences, ledger escaping and testability |
| Node + TS (bundled) | Python 3 + PyGithub/ghapi | If the maintainer base were Python-only with no Node, which is unlikely for Claude Code and GSD users. Needs `setup-python` and pip in every Actions run, can't ship JS actions, and gets no plugin auto-install support |
| Node + TS | Plain JS/CJS like `gsd-tools.cjs` | Acceptable if the owner wants exact GSD Core parity. Costs type safety on three cross-runtime contracts (config, ledger, result files) |
| Committed esbuild bundle | Ship `package.json` + `package-lock.json` and let Claude Code auto-install | If dependencies grow large or a native module is needed. Auto-install has a 60 s timeout, is registry-only and doesn't help the Actions side |
| Modular `@octokit/*` | `octokit` 5.0.x meta-package | Fine, but the meta-package was last published 2025-10 and pulls in OAuth and webhooks code that isn't needed |
| Octokit for writes | `gh api` from scripts | Interactive one-offs only. Octokit gives throttling/retry, typed errors and fetch injection for tests |
| `yaml` | `js-yaml` 5.x | If comment preservation weren't needed. It is, for setup and migrations |
| TypeBox + Ajv | Zod 4 + `z.toJSONSchema()` | If the team prefers Zod ergonomics. The emitted JSON Schema can differ in meaning from Zod's runtime checks (transforms, refinements), and ADR 0005 makes the *published* schema the contract |
| TypeBox + Ajv | Hand-written `schema.json` + `json-schema-to-ts` | If TypeBox 1.x proves awkward in phase 1. Same runtime story, more manual typing |
| Vitest | `node:test` | If zero dev dependencies is a hard rule. `node:test` has mock timers, but snapshot, coverage and Stryker integration are weaker |
| Biome | ESLint 10 + Prettier 3 | If a specific ESLint plugin (e.g. security rules) becomes necessary |
| Custom sweep | actions/stale v11 | Never for this project's clocks (see above). Fine for repos that adopt warden without its stale feature (`stale.enabled: false`) |
| launchd LaunchAgent | cron | Never on macOS: cron skips slots missed during sleep, which defeats catch-up-on-wake |
| Spawn `claude -p` | `@anthropic-ai/claude-agent-sdk` | Never here: the third-party claude.ai-login restriction, plus it pins its own Claude Code binary instead of the maintainer's |

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `claude --bare` | Never reads OAuth, keychain or `CLAUDE_CODE_OAUTH_TOKEN`, so it forces `ANTHROPIC_API_KEY` (breaks ADR 0004) | `-p` with explicit `--tools`, `--permission-mode dontAsk`, `--strict-mcp-config` |
| `--dangerously-skip-permissions` / `bypassPermissions` | Removes the restricted-tool boundary that prompt-injection defence depends on | `dontAsk` plus narrow `--allowedTools` |
| `StartInterval` in plists | Missed while asleep = lost | `StartCalendarInterval` |
| `launchctl load/unload` | Deprecated legacy subcommands | `launchctl bootstrap/bootout/kickstart gui/$UID` |
| Pointing launchd at `${CLAUDE_PLUGIN_ROOT}` | Changes with every plugin version; old dirs are deleted 14 days after update | Stable launcher in `${CLAUDE_PLUGIN_DATA}` |
| `pull_request_target` + checkout of PR head | Classic fork-PR secret exfiltration vector; also breaks "never run fork code" | Sweep polls PR timelines with the App token, no checkout |
| actions/stale for ADR 0002 clocks | `updated_at`-based; the warden's own writes reset it | Custom sweep from `config.stale.*` |
| `app-id:` input on create-github-app-token | Deprecated in v3.1 | `client-id:` |
| `@sinclair/typebox` 0.34 | The 0.x line; 1.x moved to the `typebox` package | `typebox` 1.x |
| pnpm/yarn lockfiles in `plugin/` | Claude Code skips the dependency install for them | npm (and ideally no runtime deps at all) |
| TS `enum` / parameter properties / runtime `namespace` | Unsupported by Node type stripping (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) | String-literal unions, plain classes; `erasableSyntaxOnly` |
| Requesting `workflows` permission on the App | Lets AI-authored PRs change CI | Leave it out; workflow edits stay human |
| Working in the maintainer's own clone | Runs collide with uncommitted work and the clean-tree guard | Dedicated per-repo work clones under `${CLAUDE_PLUGIN_DATA}/repos/<owner>/<repo>` |

## Stack Patterns by Variant

- Install the plugin, `claude /login`, the App key in *that* user's login keychain, and the LaunchAgent in that user's `gui/<uid>` domain.
- The batch user only needs to be logged in (fast user switching). Its keychain is separate, which is the containment point.
- Use `claude setup-token` and have the launcher export `CLAUDE_CODE_OAUTH_TOKEN` (subscription only, one year). Store the App key as a 0600 file in `${CLAUDE_PLUGIN_DATA}` as a documented fallback.
- Review full tier only: `--strict-mcp-config --mcp-config <generated memtrace.json>`, allow exactly `get_impact` and `recall_decision`. The `--diff` CI check is a separate optional workflow step. The plugin ships no Memtrace skills (licence).
- `stale.enabled: false`. The sweep skips closes and nudges but still runs claim expiry and metrics. The adopter may keep their own actions/stale.

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| Node 24.12+ / 26.x | TS type stripping (stable), `path.matchesGlob` (stable) | Below 24.12, stripping works but isn't "stable". Set the `engines` floor at 24.12 |
| Bundles targeting `node24` | Actions `runs.using: node24` | Don't use Node 26-only APIs in shared code; `@types/node@^24` enforces this |
| Vitest 5.1 | Node `^22.12 \|\| ^24 \|\| >=26` | Node 25 unsupported (EOL anyway) |
| Claude Code ≥ 2.1.302 | `-p` Manual-mode default; `--permission-prompts` (≥2.1.259); `--restricted` (≥2.1.248); MCP validate checks (≥2.1.281) | Runner hard-fails below 2.1.302 |
| create-github-app-token v3 | `client-id` input (v3.1+), enterprise apps (v3.2+) | Pin by SHA |
| actions/stale v11 | node24, ESM | Only relevant if an adopter keeps it |
| `@octokit/auth-app` 8.x | `@octokit/core` 7.x | Same major line across all `@octokit/*` plugins listed |

## Sources

- `claude --help`, `claude plugin --help`, `claude plugin validate --help`, `claude auth status --json` (field names only), Claude Code 2.1.322 installed locally: flag existence and semantics. HIGH
- https://code.claude.com/docs/en/cli-reference: `--max-turns`, `--tools`, `--disallowedTools "mcp__*"`, `--restricted`, `--json-schema`, `--permission-mode` values. HIGH (matches local help)
- https://code.claude.com/docs/en/headless: `structured_output`, bare-mode auth limits, `dontAsk`, `--permission-prompts none`, SIGTERM exit 143, Manual-mode default since 2.1.302. HIGH
- https://code.claude.com/docs/en/permission-modes: `dontAsk` semantics. HIGH
- https://code.claude.com/docs/en/authentication: precedence order, `setup-token` one-year token, `-p` always uses `ANTHROPIC_API_KEY`. HIGH
- https://code.claude.com/docs/en/agent-sdk/overview: third-party claude.ai-login restriction. HIGH
- https://code.claude.com/docs/en/plugins-reference: manifest fields, standard layout, `bin/`, `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`, env not exported to the Bash tool. HIGH
- https://code.claude.com/docs/en/plugin-marketplaces and /plugins/loading: marketplace sources, version resolution, auto-update default off for third-party marketplaces, npm auto-install rules, 14-day cleanup of old versions. HIGH
- npm registry (`npm view`, 2026-11-10): every package version listed. HIGH
- https://raw.githubusercontent.com/nodejs/Release/main/schedule.json and nodejs.org/dist/index.json: Node 26 Active LTS 2026-10-28, Node 24 maintenance. HIGH
- https://nodejs.org/api/typescript.html, https://nodejs.org/api/path.html: type-stripping and `matchesGlob` stability history. HIGH
- GitHub API: `actions/create-github-app-token` v3.3.0 `action.yml` and releases (`client-id`, `app-id` deprecated, `permission-*` inputs); `actions/stale` v11.0.0 `action.yml` and README (`updated_at` semantics, node24); latest tags for checkout v7, setup-node v7, github-script v9, actionlint v1.7.12, zizmor v1.32.0. HIGH
- https://github.com/octokit/auth-app.js: `repositoryNames`, `permissions`, Client ID as `appId`, 59-minute cache. HIGH
- https://github.com/sinclairzx81/typebox: `typebox` 1.x package, JSON Schema 2020-12. MEDIUM
- `man launchd.plist` (macOS, local): `StartCalendarInterval` coalescing on wake, `StartInterval` loss during sleep, `RunAtLoad` caveat, `ProcessType`. HIGH
- Not verified, MEDIUM/LOW: `--restricted` plus subscription OAuth plus `--plugin-dir` together; structured-output JSON Schema subset limits; `security -w` multi-line encoding; exact 65,536-character comment limit; keychain lock-on-sleep effect on headless auth.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
