# Phase 1: Core State & Safety Rails - Research

**Researched:** 2026-11-10
**Domain:** Claude Code plugin packaging, TypeScript/Node config and schema pipeline, GitHub App identity, GitHub label and comment state, macOS launchd, credential-safety preflight
**Confidence:** HIGH for the facts probed live this session (CLI behaviour, npm registry, GitHub API shapes, bundling, linters). MEDIUM for design choices derived from them. LOW where marked `[ASSUMED]`.

## Summary

Phase 1 is greenfield: the repo holds only docs and planning files. This research builds on `.planning/research/` (STACK, ARCHITECTURE, PITFALLS, SUMMARY) and does not repeat it. Instead it probed this machine and the primary sources for the MEDIUM items that Phase 1 depends on. Six findings change or sharpen what the planner must do:

1. **`/warden` invocation works.** A plugin skill is always `/<plugin>:<name>`, and "the bare `/fancy` also invokes the skill unless another command already uses that name" `[CITED: code.claude.com/docs/en/skills]`. With plugin `warden` and skill `warden`, the canonical form is `/warden:warden`, and `/warden setup` reaches the same skill with `$ARGUMENTS = setup`. A skill can run the preflight as a `` !`node "${CLAUDE_PLUGIN_ROOT}/dist/warden.mjs" preflight` `` line. A non-zero exit "aborts the entire skill invocation ... Claude never sees the skill content", which is exactly the interactive refuse-to-start guard (RUN-02 and RUN-08) `[CITED: code.claude.com/docs/en/skills]`.
2. **`claude auth status --json` is a reliable second credential check.** Probed live: it reports `authMethod: "claude.ai"` and `apiProvider: "firstParty"` for the subscription. It also catches `ANTHROPIC_API_KEY` (`api_key`), an `apiKeyHelper` in user **or project** settings (`api_key_helper`), a settings `env` key, and Bedrock, Vertex or Foundry (`third_party`). It does **not** catch `ANTHROPIC_BASE_URL`, and it reports both `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` as `oauth_token`. So the environment scan and the auth-status check are both required, and neither is enough alone `[VERIFIED: local probe, Claude Code 2.1.322]`.
3. **TypeBox 1.4.6 works with Ajv 8.20 in `strict` mode under JSON Schema 2020-12**, including `format: date-time` from ajv-formats. Use `Type.Enum([...])`, which emits `{"enum":[...]}`, instead of a `Union` of `Literal`s, which emits noisy `anyOf`/`const` errors. TypeBox emits no `$schema` key, so add one when writing `config/schema.json` `[VERIFIED: local probe]`.
4. **The esbuild ESM bundle crashes without a `createRequire` banner.** The output fails with `Dynamic require of "process" is not supported` (from yaml's CJS build). With the banner it runs, and yaml keeps comments `[VERIFIED: local probe, esbuild 0.28.2]`.
5. **actionlint 1.7.12 (the latest release) rejects `concurrency.queue`**, which STATE-04 requires: `unexpected key "queue" for "concurrency" section`. Run it with `-ignore 'unexpected key "queue" for "concurrency" section'`. **zizmor 1.32.0 flags the locked `@v1` thin callers (D-19) as `unpinned-uses` (high)**. A `zizmor.yml` policy of `"The-Artificer-of-Ciphers-LLC/*": ref-pin` clears it, and an explicit `secrets:` block clears `secrets-inherit` `[VERIFIED: local probe]`.
6. **Ledger trust must use numeric IDs only.** REST shows the App as `user.login: "github-actions[bot]"` but GraphQL shows `author.login: "github-actions"`, with the same `Bot.databaseId` 41898282. REST comments carry `performed_via_github_app.id` (the App ID, which differs from the bot user ID), and GraphQL comments carry `editor` and `lastEditedAt`. Comment `updated_at` has **one-second resolution**, so the re-read-before-write check must compare a body hash, not `updated_at` `[VERIFIED: GitHub API probes]`.

**Primary recommendation:** Build a walking skeleton first: repo with CI green → `plugin/` that installs → `loadConfig()` with TypeBox+Ajv → `warden preflight` (env scan + settings scan + `claude auth status` + version + kill switch + STOP) wired into the `/warden` skill through `!` injection → App auth with two down-scoped tokens → `setState()` add-then-remove plus ledger codec, trust and store → one `warden reconcile --item N` against a sandbox repo. Then widen it to setup, workflows, launchd, first-run dry-run, rebuild-from-markers and migrations.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Backlog buckets A–F (defined here, displayed in Phase 2)
- **D-01:** Six PR buckets, locked: **A** never reviewed · **B** reviewed, waiting on author · **C** waiting on maintainer · **D** stale candidate · **E** bot-authored (the Warden's own PRs) · **F** blocked (CI red or merge conflict).
- **D-02:** The buckets are **exclusive**, with a fixed precedence: **E > F > D > C > B > A**. Each open PR lands in exactly one bucket, so the totals equal the open PR count.
- **D-03:** A–F cover **PRs only**. The report has a separate issue section with counts per issue state (needs-triage, needs-reproduction, needs-info, confirmed-bug, ...).
- **D-04:** Buckets are **computed from GitHub history** with the shared whose-turn function, not read from Warden labels. Any review by the maintainer or the App counts as "reviewed". Once an item has a trusted ledger, the ledger takes precedence. This makes the report meaningful before any Warden review exists. — **Reversibility:** costly — the whose-turn function is shared with Sweep clocks (ADR 0002) and first-run labelling (D-12), so changing its semantics changes three consumers.
- **D-05:** **D (stale candidate)** = waiting on the author with no author activity for longer than the configured first-nudge interval (`config.stale.*`, ADR 0002 default 48h). It reads the same config Sweep acts on, so it can never disagree with Sweep.

#### Label vocabulary
- **D-06:** Default names: issues use familiar unprefixed names that already match GSD Core (`needs-triage`, `needs-reproduction`, `needs-info`, `needs-maintainer`, `confirmed-bug`, `approved`, `claim-window`, `claimed`, `ready-for-agent`, `has-pr`). PR states use the `pr:` prefix (`pr:needs-review`, `pr:needs-rereview`, `pr:changes-requested`, `pr:human-gate`, `pr:blocked`). Warden controls are `warden:hold` and `warden:needs-human`. Code works on internal state IDs (`pr.new`, `issue.confirmed`, ...), and `.github/warden.yml` maps each ID to label text. — **Reversibility:** costly — renaming defaults after adopters exist needs a config migration and relabelling of live repos.
- **D-07:** When a needed label already exists in the repo, setup **adopts it as-is** and leaves its colour and description unchanged. Setup creates only missing labels and reports which it adopted and which it created.
- **D-08:** Config may declare **aliases** that map extra repo labels to a state (for example `wip` → `pr.changes-requested`). Reconcile and the bucket logic treat an alias exactly like the canonical label. Labels that are neither mapped nor aliased are facets the Warden never touches.
- **D-09:** Aliases are **read-only**. Reconcile never rewrites an alias to the canonical label. The Warden replaces it (add-then-remove, STATE-06) only when it makes its own next transition. This follows "a manual move by the maintainer wins" (STATE-01).

#### First-run backlog
- **D-10:** The first reconcile on an existing repo is **all at once, dry-run first**. Setup runs reconcile in dry-run and shows the counts per state it would assign. After the maintainer confirms, one throttled run applies them. The first run writes **labels only** and posts no contributor-facing comments.
- **D-11:** Ledgers are created **lazily**: a ledger comment appears the first time the Warden really acts on an item (review, nudge, triage, transition with history), not at first reconcile. The ARCHITECTURE invariant "every open PR has an App-authored ledger" is relaxed to "every item the Warden has acted on has one". A missing ledger means "no Warden history" and is not corruption.
- **D-12:** The initial **PR state is derived from history** with the same whose-turn logic as D-04. Changes requested by the maintainer → `pr:changes-requested`; red CI or conflicts → `pr:blocked`; maintainer's turn → `pr:human-gate`; unreviewed → `pr:needs-review`. Labels and bucket report then agree from day one.
- **D-13:** The initial **issue state keeps any existing mapped state label** (or alias). An issue with none gets `needs-triage`. An issue with two or more state labels goes to `warden:needs-human` rather than having the Warden guess.

#### App provisioning & setup
- **D-14:** **Each maintainer creates their own GitHub App** through GitHub's App-manifest flow, started from setup (for example `/warden setup app`), with permissions pre-filled and **no `workflows` permission**. Setup stores the private key in the login keychain (base64, per STACK.md). There is no shared, published App. — **Reversibility:** one-way — the App identity is the author of every ledger (STATE-03 trusts its numeric bot user ID), so swapping Apps orphans all existing ledgers and needs a rebuild from SHA markers.
- **D-15:** For Actions, setup creates a **`warden` environment limited to the default branch** and stores the key and Client ID there with `gh secret set --env`. Only the bookkeeping jobs reference that environment (PITFALLS key-custody advice).
- **D-16:** `/warden setup` is **plan → confirm → apply**. It inspects the repo, prints every intended change (config to write, labels to create or adopt, workflow callers to write, ruleset, environment secret, conflicts), asks once, then applies. A second run prints "nothing to do". It never asks for individual config values: the starter config comes from defaults plus detected values (default branch, maintainers from CODEOWNERS/MAINTAINERS if present), and the maintainer edits the YAML afterwards.
- **D-17:** Conflicting `stale.yml` / other AI reviewer: setup **never edits or deletes workflow files**. It reports the conflict with the exact fix. While a conflicting `stale.yml` exists, the Warden **refuses to enable its own stale clocks**. Another AI reviewer workflow produces a warning only.
- **D-18:** Setup **creates or updates the repo ruleset** (App pushes limited to `warden/**`, maintainer review required) using the **maintainer's own `gh` login**, as one item in the plan list. The App can't create rulesets, and a second run changes nothing.
- **D-19:** Workflow templates are **thin callers** (`.github/workflows/warden-*.yml`) to the Warden's reusable workflows pinned at `@v1`. Updates arrive by tag, with no re-copy. Setup writes the files into the working tree, and committing them is the maintainer's action.

### Claude's Discretion
The planner and researcher decide these within the locked decisions:
- Exact colours and descriptions for labels the Warden creates.
- The write-throttle rate for the first-run apply, and how it avoids the App-event recursion noted in PITFALLS (App-made label events do trigger workflows).
- launchd schedule defaults, the exact text of the runner's refusal messages, and the internal ledger JSON field layout beyond STATE-02's required fields.
- Exact names of setup subcommands (`/warden setup`, `/warden setup app`, ...), subject to the phase-1 check of plugin skill invocation.
- Default precedence when the reconciler finds two state labels (ARCHITECTURE: later state in the table wins, ledger breaks ties), except for the issue first-run rule in D-13.

### Deferred Ideas (OUT OF SCOPE)
None. The discussion stayed within the phase scope.
</user_constraints>

## Project Constraints (from CLAUDE.md)

These are drawn from `./.claude/CLAUDE.md` and `~/.claude/CLAUDE.md`. They carry the same authority as locked decisions.

| # | Directive | Applies to Phase 1 as |
|---|-----------|-----------------------|
| P-1 | No API-key Claude calls anywhere (ADR 0004) | Preflight refusals (RUN-02); no Anthropic secret in any workflow |
| P-2 | TypeScript on Node ≥24.12, ESM, esbuild, committed `dist/` | `engines.node: ">=24.12"`, `erasableSyntaxOnly`, no TS `enum`/`namespace`/parameter properties |
| P-3 | Claude Code ≥2.1.302 pinned; never `--bare`, `--dangerously-skip-permissions` or the Agent SDK | Version gate in preflight; a CI grep test that fails on those strings in `src/` |
| P-4 | No `pull_request_target`; the App never gets `workflows`; no conditional PATCH, so the ledger uses writer-owned sections plus a re-read before every write | Workflow templates, App manifest, ledger store |
| P-5 | Fork PR code is never checked out or executed; rules come from the base branch only | Reconcile reads `.github/warden.yml` through the contents API at the default branch; no checkout in workflows |
| P-6 | Nothing GSD Core-specific is hardcoded (ADR 0005) | Every label name, branch and maintainer comes from config; GSD Core lives only in `examples/gsd-core.yml` |
| P-7 | Use npm (Claude Code auto-install reads only the npm/bun lockfiles) | Root `package-lock.json`; **no `package.json` inside `plugin/`**, so Claude Code auto-installs nothing |
| P-8 | Pin third-party actions by full SHA | `actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0` `[VERIFIED: gh api git/ref/tags/v3.3.0]` |
| P-9 | Never write to `${CLAUDE_PLUGIN_ROOT}`; durable state goes in `${CLAUDE_PLUGIN_DATA}` | STOP file, lock file, logs and the launchd launcher live in the data dir |
| P-10 | GSD workflow enforcement: file changes only through GSD commands | Execution goes through `/gsd-execute-phase` |
| P-11 | Owner directive: the agent refers to itself as "the agent", and owner decisions are asked with AskUserQuestion | Interactive setup confirmations and refusal text name actors explicitly ("the Warden refuses...") |
| P-12 | Conflict to resolve: CLAUDE.md/STACK name the ledger marker `<!-- warden:ledger v1 {json} -->`; ARCHITECTURE uses `<!-- warden:ledger:v1 ... warden:ledger:end -->` | **Use the CLAUDE.md form** (project instructions win). Freeze it in Phase 1, because changing it later is a ledger migration |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONF-01 | Every repo-specific value lives in `.github/warden.yml` | §Config pipeline. The TypeBox schema covers every key now, including keys whose features land later (voice, triage, specialists, isolation), so `examples/gsd-core.yml` is complete in Phase 1 |
| CONF-02 | Published JSON Schema from TypeBox, defaults from `config/defaults.yml`, readable error stops every task | §Pattern 2. TypeBox→Ajv verified; Ajv `allErrors` paths; raw-file validation with a no-`required` variant |
| CONF-03 | `schemaVersion`/`ledgerVersion` migrate older and refuse newer; releases carry migration notes | §Pattern 3, migration registry; Open Question 2 (there is no real "older" version yet) |
| CONF-04 | `examples/gsd-core.yml` is complete and valid | A test loads it through the same `loadConfig()` |
| CONF-05 | `/warden setup` (no AI): starter config, labels, workflow copies, Node/Claude version, stale.yml and AI-reviewer detection, idempotent | §Pattern 6 (plan → confirm → apply), the label case-insensitivity pitfall, the App manifest flow |
| CONF-06 | Versioned plugin plus marketplace, tags, changelog, CI (tsc, Biome, Vitest, dist diff, `claude plugin validate --strict`, actionlint, zizmor) | §Plugin packaging, validated live; actionlint `queue` ignore; zizmor ref-pin policy |
| STATE-01 | Exactly one state label; invariant repair; a manual move wins | §Pattern 4, reconcile using the timeline's `LabeledEvent` actor IDs |
| STATE-02 | One ledger comment edited in place, with an encoded JSON block (`rev`, checksum, `lastReviewedSha`, diff hash, tier, rounds, findings, nudge times) | §Pattern 5, codec: ASCII-only JSON, `<`/`>`/`&` escaping, sha256 checksum |
| STATE-03 | Trust only the App's numeric bot user; spoofed or corrupt → needs-human; rebuild from SHA markers | Trust rule verified on REST and GraphQL; the `editor` field; review marker format |
| STATE-04 | Writer-owned sections, leases, re-read before write and verify after, per-item concurrency with `queue: max` | §Pattern 5 store; the 1-second `updated_at` pitfall; the actionlint `queue` pitfall |
| STATE-06 | Add-then-remove label changes | `POST /issues/{n}/labels` then `DELETE /issues/{n}/labels/{name}`; never `PUT` |
| POST-01 | App writes; a read-only session token and a write token for the poster only; no `workflows`; a ruleset limits pushes to `warden/**` | §Pattern 7, two `auth()` calls with `permissions`; manifest `default_permissions`; ruleset API |
| POST-02 | Actions use the same App through `create-github-app-token@v3` | `client-id` input (the `app-id` input is deprecated), `permission-*` inputs, `app-slug` output, SHA pin |
| RUN-01 | Interactive `/warden` or a launchd headless batch through a stable launcher (`StartCalendarInterval`, explicit PATH, `caffeinate -i`) | §Pattern 8; `claude plugin list --json` gives `installPath`; data dir `~/.claude/plugins/data/warden-artificer/` |
| RUN-02 | Refuse on any API-key route; require claude.ai/firstParty | §Pattern 1, the full env list (larger than REQUIREMENTS names), settings scan, and the `auth status` truth table |
| RUN-03 | Pinned Claude Code, auto-update off, never `--bare` etc. | `claude --version` parse (`2.1.322 (Claude Code)`), `DISABLE_AUTOUPDATER=1` in the launcher env, CI grep test |
| RUN-08 | Kill switch (repo variable plus local STOP) and `warden:hold`, checked by every workflow and before every batch and item | `gh variable get` cannot tell 404 from 403 (both exit 1); use `gh api --include`; workflow `if:` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Config load, merge and validate | warden-core library (bundled into `plugin/dist` and `actions/*/dist`) | GitHub contents API (base-branch read) | One implementation is shared by the runner and Actions (ADR 0002 "one clock") |
| Credential preflight (env, settings, auth status, version) | Local runner CLI (`warden preflight`) | Skill `!` injection (interactive guard) | Only the maintainer's machine can see its env, settings and keychain |
| Kill switch | GitHub repo variable (Actions `if:`) | Local runner (`gh api` plus STOP file) | Actions read `vars.*` natively; the runner uses the maintainer's `gh` login |
| State labels and transitions | warden-core state module | GitHub Issues API (labels) | Labels are the source of truth for queue selection; code enforces add-then-remove |
| Ledger codec, trust and store | warden-core ledger module | GitHub issue comments (REST and GraphQL) | No conditional PATCH, so concurrency control lives in application code |
| Reconcile run | Actions (scheduled reusable workflow, App token) | Local runner (`warden reconcile`, on demand) | Hourly with no machine dependency; on demand for setup's dry-run |
| App provisioning | Local setup (browser manifest flow plus a loopback callback) | macOS keychain, GitHub environment secrets | The key never leaves the keychain or the `warden` environment |
| Ruleset and environment creation | Local setup with the maintainer's own `gh` login | — | The App lacks `administration`, by design |
| Scheduling | macOS launchd LaunchAgent (`gui/<uid>`) | Stable launcher in the plugin data dir | Catch-up on wake; keychain is reachable only in the GUI session |
| Plugin distribution | Claude Code marketplace (`.claude-plugin/marketplace.json` at the repo root) | Git tags (`warden--vX.Y.Z`, `vX.Y.Z`, moving `v1`) | `plugin.json` `version` pins users |

## Standard Stack

### Core
| Library | Version (pin exact) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | engines `>=24.12`; dev on 26.13.0 | Runtime | `[VERIFIED: node --version → v26.13.0]` |
| typescript | 7.0.2 | `tsc --noEmit` only | Native compiler, bin `tsc` `[VERIFIED: npm view typescript@7.0.2 bin]` |
| esbuild | 0.28.2 | Bundle `src/cli/warden.ts` → `plugin/dist/warden.mjs` and `src/actions/*` → `actions/*/dist/index.mjs` | Needs the `createRequire` banner (Pitfall 1) `[VERIFIED: local bundle probe]` |
| typebox | 1.4.6 (package `typebox`, **not** `@sinclair/typebox` 0.34.52) | Schemas → TS types plus JSON Schema 2020-12 | `import Type, { type Static } from "typebox"`; `export default Type` at `build/index.d.mts:8` `[VERIFIED: node_modules/typebox/build/index.d.mts:1-8; build/type/types/static.d.mts:46 "export type Static<Type extends TSchema, ..."]` |
| ajv | 8.20.0 via `ajv/dist/2020.js` | Validate config, ledger and result files | Named export: `exports.Ajv2020 = Ajv2020;` `[VERIFIED: node_modules/ajv/dist/2020.js:37-39]` |
| ajv-formats | 3.0.1 | `date-time`, `uri` | Verified working with Ajv2020 strict mode `[VERIFIED: local probe]` |
| yaml | 2.9.1 | Parse config; `parseDocument` keeps comments for setup and migrations | `doc.toString()` round-trip kept the leading comment `[VERIFIED: local probe]` |
| @octokit/core | 7.0.8 | REST/GraphQL client with `request.fetch` injection | `[VERIFIED: npm view]` |
| @octokit/plugin-rest-endpoint-methods / -paginate-rest / -throttling / -retry | 18.0.0 / 16.0.0 / 11.0.5 / 8.1.1 | Typed endpoints, pagination, secondary-rate-limit handling | `[VERIFIED: npm view]` |
| @octokit/graphql | 9.0.5 | Open PR and issue sweep queries | `[VERIFIED: npm view]` |
| @octokit/auth-app | 8.3.1 | JWT → installation tokens with `permissions` and `repositoryIds`/`repositoryNames`; a Client ID is accepted as `appId` ("A Client ID string may also be used and is recommended") | `[CITED: github.com/octokit/auth-app.js README]` |
| @actions/core | 3.0.1 | Inputs, outputs and `setFailed` in the JS actions only | `[VERIFIED: npm view]` |
| Claude Code CLI | ≥2.1.302 required; 2.1.322 installed; npm `@anthropic-ai/claude-code@2.1.322` for CI | `claude plugin validate --strict`, `claude auth status --json`, `claude plugin list --json` | `[VERIFIED: local CLI]` |
| gh | ≥2.100 (2.103.3 installed) | Maintainer-login operations: variable read, ruleset, environment, secrets | `[VERIFIED: gh --version]` |

### Supporting / Dev
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest + @vitest/coverage-v8 | 5.1.0 (or 5.0.5 if the SUS checkpoint is declined) | Tests, fake timers, snapshots | All tests |
| fast-check | 4.10.2 | Property tests | Ledger codec round-trip, label-set invariants |
| @biomejs/biome | 2.6.6 (or 2.6.5) | Lint and format | CI and pre-commit |
| @types/node | **24.19.2** (pin the `^24` line, not 26.6.6) | Stops Node-26-only APIs leaking into code the Actions `node24` runtime executes | All |
| actionlint | 1.7.12 (Homebrew; CI via the rhysd download script or a pinned binary) | Workflow lint | With the `queue` ignore |
| zizmor | 1.32.0 (`uvx zizmor@1.32.0`) | Workflow security audit | With `zizmor.yml` policies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Type.Enum` for string unions | `Type.Union([Type.Literal(..)])` | Union emits `anyOf`+`const`, which makes Ajv report three errors per bad value `[VERIFIED: probe]` |
| `gh api --include` for the kill switch | `gh variable get` | `gh variable get` exits 1 for both "not found" and HTTP 403, so it can't fail closed correctly `[VERIFIED: probe]` |
| Node lock via `fs.openSync(path, "wx")` | `flock(1)` (named in ARCHITECTURE) | **macOS has no `flock` on PATH** (only `/usr/bin/lockf`) `[VERIFIED: command -v flock]` |
| Commit-pinned `@v1` for Warden's own reusable workflows | SHA pins | D-19 is locked to `@v1`; use the zizmor `ref-pin` policy for the Warden owner only |

**Installation:**
```bash
npm install --save-dev --save-exact typescript@7.0.2 esbuild@0.28.2 typebox@1.4.6 ajv@8.20.0 ajv-formats@3.0.1 yaml@2.9.1 \
  @octokit/core@7.0.8 @octokit/plugin-rest-endpoint-methods@18.0.0 @octokit/plugin-paginate-rest@16.0.0 \
  @octokit/plugin-throttling@11.0.5 @octokit/plugin-retry@8.1.1 @octokit/graphql@9.0.5 @octokit/auth-app@8.3.1 \
  @actions/core@3.0.1 vitest@5.1.0 @vitest/coverage-v8@5.1.0 fast-check@4.10.2 @biomejs/biome@2.6.6 @types/node@24.19.2
```
Everything is a devDependency, because it is all bundled into `dist/`.

## Package Legitimacy Audit

Seam: `gsd-tools query package-legitimacy check --ecosystem npm ...`, run 2026-11-10.

| Package | Registry | Age (latest publish) | Downloads/wk | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| typebox | npm | 1.4.6, 2 days | 16.9M | github.com/sinclairzx81/typebox | SUS (too-new) | Flagged. Planner adds a checkpoint, or pins 1.4.5 |
| ajv | npm | 8.20.0, 2026-04 | 518M | github.com/ajv-validator/ajv | OK | Approved |
| ajv-formats | npm | 2024-03 | 203M | github.com/ajv-validator/ajv-formats | OK | Approved |
| yaml | npm | 2026-09 | 312M | github.com/eemeli/yaml | OK | Approved |
| esbuild | npm | 2026-08 | 415M | github.com/evanw/esbuild | OK (postinstall `node install.js`, the known platform-binary check) | Approved |
| typescript | npm | 2026-07 | 417M | github.com/microsoft/TypeScript | OK | Approved |
| vitest | npm | 5.1.0, 8 days | 180M | github.com/vitest-dev/vitest | SUS (too-new) | Flagged |
| @vitest/coverage-v8 | npm | 8 days | 62M | github.com/vitest-dev/vitest | SUS (too-new) | Flagged |
| @biomejs/biome | npm | 4 days | 26M | github.com/biomejs/biome | SUS (too-new) | Flagged |
| fast-check | npm | 2026-09 | 73M | github.com/dubzzz/fast-check | OK | Approved |
| @octokit/core, plugin-rest-endpoint-methods, plugin-paginate-rest, plugin-throttling, plugin-retry, graphql, auth-app | npm | 2026-08/09 | 9M–48M | github.com/octokit/* | OK | Approved |
| @actions/core | npm | 2026-04 | 21.6M | github.com/actions/toolkit | OK | Approved |
| @types/node | npm | 26.6.6, 13 days | 627M | DefinitelyTyped | SUS (too-new, for 26.x) | Use 24.19.2 per the engines floor |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `typebox` [WARNING: flagged as suspicious — verify before using.], `vitest` [WARNING: flagged as suspicious — verify before using.], `@vitest/coverage-v8` [WARNING: flagged as suspicious — verify before using.], `@biomejs/biome` [WARNING: flagged as suspicious — verify before using.], `@types/node@26` [WARNING: flagged as suspicious — verify before using.]. Every flag is "too-new" only: each package has a long history, high downloads and its canonical repo. The planner inserts one `checkpoint:human-verify` before the Wave-0 `npm install`. Alternatively, pin the previous patch (typebox 1.4.5, vitest 5.0.5 is the previous minor, biome 2.6.5).

## Architecture Patterns

### System Architecture Diagram

```
                ┌──────────── maintainer's Mac ────────────────────────────────────────────┐
 user types     │  /warden <verb>  (skill warden:warden)                                    │
 /warden ──────►│    !`node $PLUGIN_ROOT/dist/warden.mjs preflight`  ── exit≠0 → ABORT      │
                │         │ exit 0                                                          │
 launchd slot ─►│  launcher (DATA dir) → caffeinate -i node <installPath>/dist/warden.mjs run│
                │         ▼                                                                 │
                │  preflight: env scan → settings scan → claude --version ≥ 2.1.302        │
                │            → claude auth status (claude.ai + firstParty) → STOP file      │
                │            → kill-switch var (gh api, 200/404 only) → lock (wx file)      │
                │         ▼ ok                                                              │
                │  loadConfig: contents API @ default branch → yaml → migrate → merge       │
                │              defaults → Ajv(merged) + Ajv(raw, no-required) → frozen cfg  │
                │         ▼                                                                 │
                │  keychain (base64 PEM) → auth-app JWT → READ token (sessions, Phase 3+)   │
                │                                       → WRITE token (poster/reconciler)   │
                │         ▼                                                                 │
                │  reconcile(item): GraphQL labels + timeline actors + reviews + CI         │
                │     ├─ hold label?        → skip                                          │
                │     ├─ 1 state label      → keep (manual move wins)                       │
                │     ├─ 0 state labels     → derive (whose-turn v0 / D-12, D-13)           │
                │     └─ ≥2 state labels    → latest non-App actor wins / needs-human (D-13)│
                │         ▼ setState: POST add → DELETE old (≥1 s apart, throttled)          │
                │  ledger (only if acting, D-11): find App comment by numeric id →          │
                │     trust check → decode/verify checksum → mutate own section →           │
                │     re-read (body hash equal?) → PATCH → wait → verify own rev            │
                └───────────────────────────────────────────────────────────────────────────┘
                                   ▲  same warden-core code  ▼
 ┌──── GitHub Actions (no AI) ─────────────────────────────────────────────────────────────┐
 │ caller .github/workflows/warden-sweep.yml (schedule hourly, dispatch)                    │
 │   if: vars.<KILL> != 'on' → uses: <warden>/.github/workflows/sweep.yml@v1                │
 │   reusable job: environment: warden → create-github-app-token (client-id, permission-*)  │
 │   → uses: <warden>/actions/sweep@v1 (node24) → reconcile all open items                   │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
.claude-plugin/marketplace.json      # name "artificer"; plugins[0] {name:"warden", source:"./plugin"}; NO version here
plugin/                              # ONLY this dir is copied to the plugin cache
├── .claude-plugin/plugin.json       # name "warden", version, description, author, repository, license, homepage
├── README.md                        # 40+ words (validate prints README_MISSING otherwise)
├── skills/warden/SKILL.md           # /warden:warden (bare /warden) — dispatches on $ARGUMENTS
├── config/defaults.yml              # human-readable copy; also embedded into dist via esbuild text loader
├── config/schema.json               # generated from TypeBox, committed, published per tag
├── templates/workflows/warden-sweep.yml   # thin caller copied by setup
└── dist/warden.mjs                  # committed bundle (CLI: preflight|setup|reconcile|run|ledger|schedule)
src/
├── core/config/   core/state/   core/ledger/   core/github/   core/preflight/   core/whose-turn/
├── cli/warden.ts                    # node:util parseArgs verbs
└── actions/sweep/main.ts
actions/sweep/action.yml + dist/index.mjs   # runs.using: node24
.github/workflows/ci.yml   .github/workflows/sweep.yml (reusable, on: workflow_call)
examples/gsd-core.yml   zizmor.yml   biome.json   tsconfig.json   vitest.config.ts   CHANGELOG.md
test/fixtures/   (recorded GraphQL/REST JSON; fake `claude`, `gh`, `security` executables)
```
No `bin/` directory. Files there land on PATH in every session, and "claude.ai and Cowork don't install a plugin that has a top-level `bin/` directory" `[CITED: code.claude.com/docs/en/plugins-reference]`.

### Pattern 1: Credential preflight (RUN-02, RUN-03, RUN-08)
**What:** One pure-ish function `preflight(ctx) → {ok} | {refuse: Reason[]}`. It collects every refusal, not only the first, and prints them all. The CLI exits 2 on refusal.
**Checks, in order:**
1. **Environment deny-list.** Refuse if any of these is set and non-empty: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AWS_API_KEY`, `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `AWS_BEARER_TOKEN_BEDROCK`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_MANTLE`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`. Also refuse `CLAUDE_CODE_OAUTH_TOKEN` in Phase 1; the Phase 6 ISO-03 container path allows it later. These names come from the env-vars docs `[CITED: code.claude.com/docs/en/env-vars]`. Note that `CLAUDE_CODE_USE_POWERSHELL_TOOL` is **not** a provider switch, so don't use a `CLAUDE_CODE_USE_*` prefix match.
2. **Settings scan.** For each JSON file in `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json`, `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json` and the macOS managed file `[ASSUMED: /Library/Application Support/ClaudeCode/managed-settings.json]`: refuse on an `apiKeyHelper` key, or on any deny-listed name inside `env`. A file that doesn't parse is a refusal (fail closed).
3. **`claude --version`.** Parse `^(\d+)\.(\d+)\.(\d+) \(Claude Code\)` and refuse below 2.1.302 `[VERIFIED: output "2.1.322 (Claude Code)"]`.
4. **`claude auth status --json`**, run in the **same cwd** the work will use, because project settings change the result. Require `loggedIn === true && authMethod === "claude.ai" && apiProvider === "firstParty"`. Exit 1 means logged out.
5. **Local STOP file** at `${dataDir}/STOP`.
6. **Kill-switch variable** (Pattern 9).
7. **Lock** (`fs.openSync(lock, "wx")`, holding pid and start time; reclaim when the pid is dead).

Truth table probed live with Claude Code 2.1.322 `[VERIFIED: local probe]`:

| Condition | loggedIn | authMethod | apiProvider | apiKeySource |
|---|---|---|---|---|
| Subscription (normal) | true | `claude.ai` | `firstParty` | — (plus `subscriptionType`) |
| `ANTHROPIC_API_KEY` env | true | `api_key` | `firstParty` | `ANTHROPIC_API_KEY` |
| settings `env.ANTHROPIC_API_KEY` | true | `api_key` | `firstParty` | `ANTHROPIC_API_KEY` |
| `apiKeyHelper` in user **or project** settings | true | `api_key_helper` | `firstParty` | `apiKeyHelper` |
| `ANTHROPIC_AUTH_TOKEN` | true | `oauth_token` | `firstParty` | — |
| `CLAUDE_CODE_OAUTH_TOKEN` | true | `oauth_token` | `firstParty` | — |
| `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` | true | `third_party` | `bedrock`/`vertex`/`foundry` | — |
| `ANTHROPIC_BASE_URL` only | true | **`claude.ai`** | `firstParty` | — ← **not caught; the env scan is required** |
| Empty `CLAUDE_CONFIG_DIR` (logged out) | false (exit 1) | `none` | `firstParty` | — |

Never log the JSON wholesale. It contains `email`, `orgId`, `orgName` and `loginExpiresAt`, so read only the four fields above.

### Pattern 2: Config pipeline (CONF-01..04)
**What:** `loadConfig({ rawYaml, defaultsYaml }) → { config: Readonly<Config>, configHash, warnings }`, or a `ConfigError` holding the Ajv errors mapped to YAML line and column through `yaml`'s `Document` ranges.
**Steps:** parse raw with `parseDocument` (refuse on YAML errors) → read `schemaVersion` (missing → error) → if newer than `CURRENT`, refuse with the upgrade message → if older, run the pure migration chain → validate the **raw** object against `RawConfigSchema` (a deep-partial with no `required`) for user-facing paths → deep-merge over defaults (objects merge; **arrays replace**; `null` deletes) → validate the merged object against `ConfigSchema` (`additionalProperties: false` at the top level only; see Pitfall 7) → `Object.freeze` deeply → `configHash = sha256(canonical JSON)`.
**Where it reads from:** Actions and the runner read `.github/warden.yml` via `GET /repos/{o}/{r}/contents/.github/warden.yml?ref=<default_branch>`, never a checkout (P-5). Setup reads the working tree, because it writes the file there.

### Pattern 3: Version migrations (CONF-03)
A registry `migrations: Record<number, (doc) => doc>` holds pure functions `n → n+1`, separately for config and for ledger. `CURRENT_CONFIG_SCHEMA = 1` and `CURRENT_LEDGER_VERSION = 1`. A writer refuses to write a ledger whose `v` is newer than its own, and the item goes to `warden:needs-human` with the reason `ledger-newer`. Make the registry injectable so tests can prove the chain and the refusal with a synthetic v0 (Open Question 2). CHANGELOG entries carry a `### Migration` subsection; a CI test asserts that one exists whenever `CURRENT_*` changes.

### Pattern 4: State labels and reconcile (STATE-01, STATE-06, D-06..D-13)
- **State table:** canonical IDs (`issue.new`, ..., `pr.new`, `pr.needs-rereview`, `pr.changes-requested`, `pr.human-gate`, `pr.blocked`) → `config.labels.states[id]` → label text, plus `config.labels.aliases[label] = id`. Controls (`warden:hold`, `warden:needs-human`) are **not** state labels.
- **`setState(item, toId, actor)`:** check `transition(from, to, actor)` against the table → `POST /repos/{o}/{r}/issues/{n}/labels {labels:[newLabel]}` → wait at least 1 s → `DELETE /repos/{o}/{r}/issues/{n}/labels/{oldLabel}` for each other state or alias label. Never `PUT /labels` (it replaces the whole set and wipes facets). Octokit URL-encodes `pr:needs-review` in the path.
- **Reconcile decision for each open item:**
  1. `warden:hold` → skip (RUN-08).
  2. Exactly one state or alias label → keep it, even if it's an alias (D-09).
  3. Zero → derive one. PRs use whose-turn v0 (D-12): maintainer `CHANGES_REQUESTED` latest review → `pr.changes-requested`; failing `statusCheckRollup` or `mergeable == CONFLICTING` → `pr.blocked`; last actor the author after a maintainer/App review → `pr.human-gate`; no maintainer/App review → `pr.new`. Issues get `issue.new` (D-13).
  4. Two or more → on the first run, issues go to `warden:needs-human` (D-13). Otherwise read `timelineItems(itemTypes:[LABELED_EVENT])`. If the newest state-label add came from a non-App actor (compare `actor { ... on User { databaseId } ... on Bot { databaseId } }` to the App bot ID), keep that label and remove the others (maintainer move wins). If not, the later state in the table wins, and the ledger `state` breaks ties.
- **First run (D-10):** `warden reconcile --all --dry-run` prints counts per state. Apply serially with at least 1 s between mutations; that is about 2 calls per item, so ~200 open items take about 7 minutes. Labels only, no comments.
- **Recursion:** Phase 1 workflows trigger only on `schedule` and `workflow_dispatch`, so App label events can't start them again. The sender-ID guard comes with the `issues`/`issue_comment` intake in Phase 2 (INTK-04).
- **Whose-turn v0 scope:** D-12 needs a minimal whose-turn function in Phase 1, before SWP-01 (Phase 2) completes it with author-activity clocks. Build it as `src/core/whose-turn/` with a stable signature from day one (D-04 reversibility note).

### Pattern 5: Ledger codec, trust and store (STATE-02..04)
- **Format (P-12):** `<!-- warden:ledger v1 ` + `asciiJson` + ` -->` on a single line at the end of the comment body, below a short visible summary.
- **`asciiJson`:** `JSON.stringify(doc)` with `<` → `<`, `>` → `>`, `&` → `&`, and every non-ASCII code unit → `\uXXXX`. After this, the payload can't contain `-->`, `--!>` or `<!--` (HTML comment terminators and nesting), and characters equal bytes, so the size cap is the same in either unit. `JSON.parse` reverses it with no custom decoder `[ASSUMED: HTML comment end rules per WHATWG tokenizer; the escape-sufficiency argument is reasoning, so prove it with a fast-check property]`.
- **Fields (v1):** `{ v:1, kind:"pr"|"issue", item, rev, checksum, state, history:[≤20], lease:null|{holder,task,sha,expires}, runner:{rev,lastReviewedSha,diffHash,tier,rounds,findings:[...]}, actions:{rev,nudges:[...],lastAuthorActivity,...} }`. `checksum = sha256(canonicalJson(doc without checksum))`. The checksum detects corruption and hand edits, not a forger. Trust comes from authorship (next bullet).
- **Trust (STATE-03):** accept only a comment where REST `user.id == appBotUserId && user.type == "Bot" && performed_via_github_app?.id == appId`, or GraphQL `author.__typename == "Bot" && author.databaseId == appBotUserId`. In GraphQL also require `editor == null` or `editor` to be the App. Compare **numeric IDs only**: REST login is `slug[bot]`, GraphQL login is `slug` `[VERIFIED: probes on cli/cli comments: REST user.id 41898282 "github-actions[bot]", performed_via_github_app.id 15368; GraphQL author.databaseId 41898282 login "github-actions"]`. Get `appBotUserId` from `GET /users/{slug}%5Bbot%5D` (dependabot → id 49699333, App id 29110) `[VERIFIED: gh api]`. In Actions, `create-github-app-token` outputs `app-slug`.
- **Untrusted ledger or bad checksum, or several App ledgers:** add `warden:needs-human`, keep the state label, and never "start fresh". With several App ledgers, use the oldest and flag the rest.
- **Rebuild:** `rebuildLedger(item)` lists the App's reviews (`GET /pulls/{n}/reviews`, filtered by `user.id`) and extracts `<!-- warden:review v1 sha=<40hex> diff=<sha256> -->` markers. It takes the newest as `lastReviewedSha`/`diffHash` and recomputes `rounds` = marker count. **Freeze this review marker format in Phase 1.** Phase 4 writes it.
- **Store (`updateLedger(item, owner, mutate)`):** read c1 → decode → mutate only `doc[owner]` plus `lease`/`state`/`history` per ownership → bump `doc[owner].rev` and `doc.rev` → re-read c2 and compare **`sha256(c2.body) === sha256(c1.body)`** (not `updated_at`, Pitfall 3) → PATCH → wait about 2 s → re-read c3 and require `c3[owner].rev >= ours` → loop up to 4 times → else `LedgerContention`. While a live runner `lease` exists, Actions doesn't change `state`.
- **Size:** a hard cap of 60,000 characters for the whole body; refuse above it (fail loudly). Compact resolved findings to `{id, fp, status, resolvedSha}`. The 65,536 limit is community-reported only `[CITED: github.community thread 148867; mshick/add-pr-comment#93 "Body is too long (maximum is 65536 characters)"]`. Confirm it with a sandbox E2E probe.

### Pattern 6: `/warden setup` plan → confirm → apply (CONF-05, D-14..D-19)
`planSetup(repoState, cfg) → Change[]`, where each Change is `{kind, target, action:"create"|"update"|"adopt"|"none", detail}`. Print all changes, ask once with AskUserQuestion (P-11), then `applySetup(changes)`. Idempotency test: `planSetup(afterApply)` returns only `action:"none"` and prints "nothing to do".
- **Labels:** `GET /repos/{o}/{r}/labels` (paginated) and match **case-insensitively** `[ASSUMED]`; adopt existing labels as they are (D-07).
- **Workflows:** write `plugin/templates/workflows/warden-sweep.yml` into `.github/workflows/`, with the kill-switch variable name from config substituted. Never edit or delete existing workflow files (D-17).
- **Conflicts:** a `.github/workflows/*.yml` containing `uses: actions/stale@` → report it and set the internal flag `staleClocksBlocked` (D-17). `anthropics/claude-code-action`, `coderabbit`, `.coderabbit.yaml` or a Copilot code-review ruleset rule (`copilot_code_review`) → warn only `[ASSUMED: heuristic list]`.
- **Versions:** `process.versions.node >= 24.12` and `claude --version >= 2.1.302`.
- **App (D-14):** `/warden setup app` starts a loopback HTTP server on `127.0.0.1:<random port>`. It opens the browser to a local page that auto-submits a form POST of `manifest=<json>` to `https://github.com/settings/apps/new?state=<random>` (or `/organizations/<org>/settings/apps/new`). GitHub redirects to `redirect_url` with `code` and `state`. Setup checks `state` and calls `POST /app-manifests/{code}/conversions`, which returns `id, slug, client_id, pem, webhook_secret, ...` and must happen within one hour `[CITED: docs.github.com registering-a-github-app-from-a-manifest; docs.github.com/en/rest/apps/apps#create-a-github-app-from-a-manifest]`. Manifest: `public:false`, `hook_attributes:{url:"https://example.invalid/warden-unused", active:false}` (`url` is required even when the hook is inactive), and `default_permissions:{issues:"write", pull_requests:"write", contents:"write", metadata:"read", checks:"read", statuses:"read"}`. No `workflows`, no `administration`, and no `default_events`. Request the full v1 permission set now, because a later permission change forces every installer to re-approve `[ASSUMED]`.
- **Key custody:** `security add-generic-password -U -s warden-github-app -a <client_id> -w <base64(pem)>`, read back with `security find-generic-password -s warden-github-app -a <client_id> -w | base64 -d`. Probed in a throwaway keychain: a multi-line secret passed raw comes back **hex-encoded** (`6c696e65310a6c696e6532`), so base64 is required. The prompted-`-w` form didn't accept piped stdin in the probe `[VERIFIED: throwaway keychain probe]`. The argv form exposes the base64 value to same-user `ps` for milliseconds. Accept that, or spike the TTY prompt.
- **Actions environment (D-15):** `gh api -X PUT repos/{o}/{r}/environments/warden` with a custom deployment-branch policy for the default branch, then `gh secret set WARDEN_APP_PRIVATE_KEY --env warden --repo o/r` (PEM on stdin) and `gh variable set WARDEN_APP_CLIENT_ID --env warden` `[ASSUMED: exact environment body fields]`.
- **Ruleset (D-18):** `GET /repos/{o}/{r}/rulesets`, match by `name`, then `POST` or `PUT /rulesets/{id}`. Fields come from the API docs: `enforcement: active`, `conditions.ref_name.include: ["~DEFAULT_BRANCH"]`, rule `pull_request` with `required_approving_review_count: 1` (plus the required booleans), and `bypass_actors` with `actor_type` one of `Integration|OrganizationAdmin|RepositoryRole|Team|DeployKey|User` and `bypass_mode` one of `always|pull_request|exempt` `[CITED: docs.github.com/en/rest/repos/rules]`. See Open Question 3 for scoping App pushes to `warden/**`.

### Pattern 7: Two App tokens (POST-01, POST-02)
```ts
// Source: github.com/octokit/auth-app.js README (appId accepts a Client ID; permissions/repositoryIds options)
import { createAppAuth } from "@octokit/auth-app";
const auth = createAppAuth({ appId: clientId, privateKey: pemFromKeychain() });
const READ = { contents: "read", issues: "read", pull_requests: "read", metadata: "read", checks: "read", statuses: "read" } as const;
const WRITE = { contents: "write", issues: "write", pull_requests: "write", metadata: "read" } as const;
export const mintRead  = () => auth({ type: "installation", installationId, repositoryIds: [repoId], permissions: READ });
export const mintWrite = () => auth({ type: "installation", installationId, repositoryIds: [repoId], permissions: WRITE });
// write token: only the poster/reconciler module imports mintWrite; a test asserts no other module does.
```
Tokens expire after one hour `[CITED: docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app]`. Re-mint when less than 10 minutes remain. Separate permission sets may share auth-app's cache, so pass `refresh: true` or check `token.permissions` `[ASSUMED]`.

Actions side (reusable `.github/workflows/sweep.yml`):
```yaml
# Source: actions/create-github-app-token action.yml (v3.3.0): inputs client-id, private-key, permission-*; outputs token, installation-id, app-slug
on:
  workflow_call:
    secrets:
      WARDEN_APP_PRIVATE_KEY: { required: false }
permissions: {}
jobs:
  sweep:
    runs-on: ubuntu-latest
    environment: warden
    concurrency: { group: "warden-sweep-${{ github.repository }}", queue: max }
    steps:
      - id: app
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0
        with:
          client-id: ${{ vars.WARDEN_APP_CLIENT_ID }}
          private-key: ${{ secrets.WARDEN_APP_PRIVATE_KEY }}
          permission-issues: write
          permission-pull-requests: write
          permission-contents: read
      - uses: The-Artificer-of-Ciphers-LLC/warden-of-the-gate/actions/sweep@v1
        with: { token: "${{ steps.app.outputs.token }}", app-slug: "${{ steps.app.outputs.app-slug }}" }
```
Reusable workflows and environment secrets: "To use an environment secret in a reusable workflow, set `environment` on the job in the reusable workflow"; "The job that calls the reusable workflow can't use the `environment` keyword"; "The caller workflow must still pass the secret", and "the environment secret takes precedence" `[CITED: docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows]`. `secrets: inherit` works only within the same org or enterprise, and adopters are in other orgs, so the caller passes `WARDEN_APP_PRIVATE_KEY` explicitly. That also satisfies zizmor's `secrets-inherit` audit `[VERIFIED: zizmor probe]`. Whether `vars.WARDEN_APP_CLIENT_ID` resolves from the caller's environment inside the reusable job needs the sandbox E2E check `[ASSUMED]`.

### Pattern 8: launchd (RUN-01)
- Plist `~/Library/LaunchAgents/com.artificer.warden.<owner>.<repo>.plist`, generated from a template string and snapshot-tested. Check it with `plutil -lint`, install with `launchctl bootstrap gui/$(id -u)`, kick with `launchctl kickstart -k`, remove with `launchctl bootout`.
- Keys: `StartCalendarInterval` (an array of `{Hour,Minute}`); `ProgramArguments: ["/usr/bin/caffeinate","-i","<dataDir>/launcher.sh","<owner>/<repo>"]`; `EnvironmentVariables: {PATH: <absolute dirs of node, claude, gh>, DISABLE_AUTOUPDATER: "1"}`; `StandardOutPath`/`StandardErrorPath` under `<dataDir>/logs/`; `ProcessType: Background`; `LowPriorityIO: true`. Man page: "If multiple intervals transpire before the computer is woken, those events will be coalesced into one event upon wake from sleep", while `StartInterval` firings during sleep are "missed due to shortcomings in kqueue(3)" `[VERIFIED: man launchd.plist lines 357-375]`.
- **Data dir outside Claude Code:** `${CLAUDE_PLUGIN_DATA}` isn't set under launchd. Resolve it at install time as `~/.claude/plugins/data/warden-artificer/`, from the rule "`my-plugin@my-marketplace` becomes `my-plugin-my-marketplace`" `[CITED: code.claude.com/docs/en/plugins/components]`. Respect `CLAUDE_CONFIG_DIR` `[ASSUMED]`.
- **Launcher** finds the current install with `claude plugin list --json` → the element with `id == "warden@artificer"` → `installPath` (fields verified: `enabled, id, installPath, installedAt, lastUpdated, projectEnabled, projectPath, scope, version`) `[VERIFIED: local CLI]`. Then it runs `node <installPath>/dist/warden.mjs run --repo <o/r>`.
- In Phase 1, `run` = preflight → reconcile (dry-run unless `batch.enabled`) → exit. No AI tasks exist yet, so the runner is "switched off" in the ARCHITECTURE sense.

### Pattern 9: Kill switch (RUN-08)
- **Actions:** every caller job has `if: vars.<NAME> != 'on'`, with `<NAME>` substituted by setup from `config.killSwitch.variable`. Expressions can't read a name from config at run time.
- **Local:** first run `gh api repos/{o}/{r}` (proves access), then `gh api --include repos/{o}/{r}/actions/variables/{NAME}`. HTTP 200 with `value == "on"` → refuse; 404 → off; anything else (403, network, parse error) → **refuse** (fail closed). `gh variable get` is unusable here: not-found and 403 both exit 1 (`variable WARDEN_KILL_SWITCH was not found` / `HTTP 403: You must have repository read permissions...`) `[VERIFIED: gh probe]`.
- **Per item:** reconcile and every later task skip items labelled `warden:hold`. The kill switch is re-checked before each write burst (PITFALLS: "flipping it mid-batch stops the next write").

### Anti-Patterns to Avoid
- **Matching a ledger by marker text or by login string:** both are spoofable or differ by API. Use numeric IDs.
- **Comparing `updated_at` for optimistic concurrency:** it has one-second resolution.
- **`PUT /issues/{n}/labels`:** it replaces facets and violates STATE-06.
- **A `package.json` inside `plugin/`:** Claude Code would auto-install from it, and the bundle already has everything.
- **Reading defaults or schema from `${CLAUDE_PLUGIN_ROOT}/..`:** only `plugin/` is in the cache. Embed `defaults.yml` in the bundle with esbuild `--loader:.yml=text`.
- **Setting `version` in both `plugin.json` and the marketplace entry:** `plugin.json` wins, and the validator warns on a mismatch ("Entry declares version ... At install time, plugin.json wins") `[CITED: code.claude.com/docs/en/plugins/marketplace-reference]`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON Schema validation | a custom validator | Ajv2020 + ajv-formats | 2020-12 semantics; `allErrors` instance paths |
| Schema ↔ TS types | duplicate interfaces | TypeBox `Static<typeof X>` | One source for types, the published schema and the result schemas |
| GitHub App JWT and token cache | `node:crypto` JWT signing | @octokit/auth-app | Clock skew, PKCS#1/#8 key handling, the 1-hour expiry |
| Secondary rate limits | sleep loops | @octokit/plugin-throttling + plugin-retry | Honours `retry-after` and `x-ratelimit-reset` |
| YAML with comments | regex edits | `yaml` `parseDocument` | Setup and migrations must not destroy the maintainer's comments |
| CLI args | commander/citty | `node:util` `parseArgs` | Built in; tiny surface |
| Plist generation | a plist library | a template string + `plutil -lint` + snapshot | Small, fixed shape |
| Workflow security lint | review by eye | actionlint + zizmor | Injection, pins, permissions |
| Plugin manifest checks | a custom checker | `claude plugin validate --strict` (works logged out, verified) | Authoritative; `--json` gives machine output |
| Release tag consistency | a custom script | `claude plugin tag --dry-run` | Checks that `plugin.json` and the marketplace entry agree |

**Key insight:** every hard part of this phase is an integrity property: who wrote a comment, whether a label set changed under the Warden, whether a credential route exists. Each one has a platform-provided signal (numeric actor IDs, `performed_via_github_app`, `editor`, `claude auth status`). Do not re-derive any of them from strings.

## Common Pitfalls

### Pitfall 1: ESM bundle dies on CJS `require`
**What goes wrong:** `plugin/dist/warden.mjs` throws `Dynamic require of "process" is not supported` at load.
**Why it happens:** yaml's CJS build and others call `require` for builtins, and esbuild's ESM shim forbids it.
**How to avoid:** `--banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"` `[VERIFIED: probe; fails without, runs with]`.
**Warning signs:** a smoke test `node plugin/dist/warden.mjs --version` fails in CI.

### Pitfall 2: actionlint rejects `queue: max`
**What goes wrong:** CI goes red on a workflow that GitHub accepts.
**Why:** actionlint 1.7.12 (latest, 2026-03-30) predates the key. Upstream issue rhysd/actionlint#657 is open, and the author is reported inactive (#719) `[VERIFIED: gh api, gh search]`.
**How to avoid:** `actionlint -ignore 'unexpected key "queue" for "concurrency" section'` (exit 0 verified). Lint the shipped templates by passing their paths explicitly, because actionlint only auto-discovers `.github/workflows`.

### Pitfall 3: `updated_at` hides concurrent writes
**What goes wrong:** two PATCHes within the same second look like "no change" to the re-read check, and one section is lost.
**Why:** REST timestamps are second-granular (`"2019-10-08T11:46:03Z"`) `[VERIFIED: gh api]`.
**How to avoid:** compare the body sha256 before writing, and verify the writer's own section `rev` after writing.

### Pitfall 4: `ANTHROPIC_BASE_URL` slips past `claude auth status`
**What goes wrong:** requests route through a gateway (possibly API-billed) while auth status still says `claude.ai`.
**How to avoid:** the env deny-list is mandatory, not optional (Pattern 1) `[VERIFIED: probe]`.

### Pitfall 5: zizmor fails the locked `@v1` pin
**What goes wrong:** `unpinned-uses` (high) on every thin caller, and `secrets-inherit` if callers use `inherit`.
**How to avoid:** a repo `zizmor.yml` with `rules.unpinned-uses.config.policies: {"The-Artificer-of-Ciphers-LLC/*": ref-pin, "*": hash-pin}`, plus an explicit `secrets:` block in callers (both verified to clear). Adopters who run zizmor themselves need the same policy; document it.

### Pitfall 6: Label names are case-insensitive on GitHub
**What goes wrong:** setup tries to create `Needs-Triage` when `needs-triage` exists → 422, and the second run isn't idempotent.
**How to avoid:** compare lowercase names and adopt the existing label (D-07) `[ASSUMED]`.

### Pitfall 7: an over-strict schema breaks older plugins
**What goes wrong:** `additionalProperties:false` everywhere makes a config written for v1.1 fail on the v1.0 plugin.
**How to avoid:** set `additionalProperties:false` on known leaf objects only where a typo would be dangerous (labels, killSwitch). Elsewhere, report unknown keys as warnings by validating against a strict variant, which produces warnings but doesn't block. `schemaVersion` is the hard compatibility gate.

### Pitfall 8: Strict validation fails on things that aren't errors at runtime
**What goes wrong:** `claude plugin validate --strict` fails on a missing marketplace `description` (verified). An agent `.md` without `description` gives a warning, so strict fails. The plugin-directory `README_MISSING` is reported but doesn't change the exit code unless you pass `--profile directory` `[VERIFIED: probes]`.
**How to avoid:** marketplace `description`, `plugin/README.md` with 40+ words, and a description on every agent and skill. Run validate on both `.` (marketplace) and `plugin/`.

### Pitfall 9: `/warden` collides with another command
**What goes wrong:** if the user has another `/warden` command, the bare form resolves elsewhere.
**How to avoid:** document `/warden:warden` as canonical. The skill uses `disable-model-invocation: true`, so Claude never starts batches on its own initiative.

### Pitfall 10: the `!` preflight is denied rather than run
**What goes wrong:** outside auto mode, an injected command whose permission check isn't "allow" aborts with `Shell command permission check failed`. The guard still fails closed (good), but every run fails.
**How to avoid:** `allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/warden.mjs" *)` in the frontmatter. `${CLAUDE_PLUGIN_ROOT}` is substituted in "Bash rules in the `allowed-tools` frontmatter" `[CITED: code.claude.com/docs/en/skills]`. Confirm the exact rule matching in the walking skeleton (human check).

## Code Examples

### TypeBox schema → committed JSON Schema → Ajv
```ts
// Source: verified locally with typebox 1.4.6 + ajv 8.20.0 (strict) + ajv-formats 3.0.1
import Type, { type Static } from "typebox";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const ConfigSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  mode: Type.Enum(["shadow", "live"]),                 // → {"enum":[...]}
  stale: Type.Object({ firstNudgeHours: Type.Integer({ minimum: 1 }) }),
}, { $id: "https://raw.githubusercontent.com/The-Artificer-of-Ciphers-LLC/warden-of-the-gate/v1/plugin/config/schema.json" });
export type Config = Static<typeof ConfigSchema>;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);   // runtime-verified in the esbuild bundle; default-import typing under tsc 7 nodenext is [ASSUMED]
export const validateConfig = ajv.compile<Config>(ConfigSchema);
// build step: writeFileSync("plugin/config/schema.json", JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", ...ConfigSchema }, null, 2))
```

### Ledger encode/decode
```ts
// Source: design per CLAUDE.md marker; escaping verified by reasoning, to be proven by fast-check
const MARK = /<!-- warden:ledger v1 (\{.*?\}) -->/s;
export const toAsciiJson = (o: unknown) =>
  JSON.stringify(o).replace(/[<>&\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
export const encode = (doc: LedgerDoc) => `<!-- warden:ledger v1 ${toAsciiJson(withChecksum(doc))} -->`;
export function decode(body: string): LedgerDoc | { corrupt: string } { /* match MARK, JSON.parse, Ajv, checksum */ }
// property: ∀ doc (fc.string incl. "-->", "--!>", "<!--", emoji): decode(encode(doc)) deepEquals doc
//           and encode(doc) contains exactly one "-->"
```

### Skill entry with fail-closed preflight
```markdown
---
name: warden
description: Run the Warden of the Gate for this repo (setup, reconcile, status, run).
argument-hint: "[setup|setup app|reconcile|run|stop] [--dry-run]"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/warden.mjs" *)
---
!`node "${CLAUDE_PLUGIN_ROOT}/dist/warden.mjs" preflight --interactive`

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/warden.mjs" $ARGUMENTS` and report its output. ...
```
Note: `setup` must skip the kill-switch, App-key and config parts of preflight, because those don't exist yet, but it keeps the credential checks. Model that as `preflight --for setup`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@sinclair/typebox` 0.34 | `typebox` 1.x package | 1.x line (1.4.6 on 2026-11-08) | Import from `typebox`; `Type.Enum`, `Type.Script` exist |
| `commands/*.md` plugin commands | `skills/<name>/SKILL.md` | docs say commands are "the older format" | Use skills; namespaced `/<plugin>:<name>` |
| `create-github-app-token` `app-id:` | `client-id:` | v3.1 (`deprecationMessage: "Use 'client-id' instead."`) | Store the Client ID as an env variable |
| `launchctl load/unload` | `bootstrap/bootout/kickstart gui/$UID` | — | Use the modern verbs |
| `pull_request_target` labelling | scheduled polling | GitHub default-blocks it 2026-12-02 | Phase 1 workflows are schedule/dispatch only |

**Deprecated/outdated:** `flock` in ARCHITECTURE (not on macOS); `secrets: inherit` (cross-org adopters can't use it).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | macOS managed settings live at `/Library/Application Support/ClaudeCode/managed-settings.json` | Pattern 1 | Settings scan misses a managed `apiKeyHelper`; the `auth status` check still catches it |
| A2 | Escaping `<>&` and non-ASCII is enough to keep JSON inside an HTML comment intact | Pattern 5 | Ledger corruption; a fast-check property test catches it |
| A3 | The 65,536 comment limit applies to characters; the 60,000 ASCII cap is safe | Pattern 5 | Oversized PATCH → 422; the sandbox E2E probe confirms |
| A4 | GitHub label names are matched case-insensitively | Pitfall 6 | Setup not idempotent |
| A5 | The manifest flow accepts a loopback `redirect_url` and `hook_attributes.active:false` | Pattern 6 | `/warden setup app` needs a different callback; human spike |
| A6 | Requesting the full v1 permission set now avoids re-approval later | Pattern 6 | Installers must re-approve later |
| A7 | `vars.*` in a reusable job reads the caller repo's environment and repo variables | Pattern 7 | The Client ID isn't found; pass it as an input instead |
| A8 | auth-app's cache keys tokens by permissions, or `refresh:true` is needed | Pattern 7 | The read path gets a write token. A test asserts `token.permissions` |
| A9 | The data dir respects `CLAUDE_CONFIG_DIR` | Pattern 8 | The launcher looks in the wrong dir |
| A10 | GitHub environment-creation body fields (deployment branch policy) | Pattern 6 | Setup apply fails; caught in the sandbox |
| A11 | AI-reviewer detection heuristics (claude-code-action, coderabbit, copilot ruleset) | Pattern 6 | Missed warning only (D-17 says warn) |

## Open Questions (RESOLVED)

All five questions were resolved on 2026-11-10. The owner decided Q1–Q3 through AskUserQuestion in the plan-phase session. Q4 and Q5 record the design the plans already adopt. The plans implement these resolutions and do not ask the owner again.

1. **`warden:needs-human` vs "exactly one state label".**
   - Known: D-06 makes `warden:needs-human` a control label, and D-13 sends multi-label issues to it.
   - Unclear: whether such an item keeps two state labels, which breaks the invariant.
   - Recommendation: the invariant is "exactly one state label, OR `warden:needs-human` present (frozen; reported; never auto-repaired)".
   - **RESOLVED (owner, 2026-11-10): exempt, frozen.** The invariant is "exactly one Warden state label OR `warden:needs-human` present". An item carrying `warden:needs-human` is frozen. Reconcile and Sweep report it and never auto-repair it, and the owner fixes it by hand. An explicit owner-run verb such as `warden ledger rebuild` counts as the owner's manual repair, not as auto-repair, and it never removes `warden:needs-human`. Implemented by plans 01-02 (tracer frozen path), 01-05 (untrusted, corrupt or newer ledgers go to needs-human), 01-06 (`decideState` freezes needs-human items) and 01-09 (the first-run change counts needs-human items as settled).
2. **CONF-03 "older version migrates" when only v1 exists.**
   - Recommendation: ship the migration framework, prove it with an injected synthetic v0→v1 in tests, and keep the real registry empty. Success criterion 3 is then met by the tested mechanism.
   - **RESOLVED (owner, 2026-11-10): synthetic v0 in tests.** Phase 1 ships the migration framework with empty real registries (`CONFIG_MIGRATIONS = {}`, `LEDGER_MIGRATIONS = {}`). Tests inject a synthetic v0→v1 migration to prove the chain. Newer versions are refused in real code paths. Implemented by plans 01-03 (Task 3, config) and 01-05 (Task 2, ledger).
3. **Ruleset "App pushes limited to `warden/**`" (D-18).**
   - Known: rulesets have no per-actor targeting. `bypass_actors` exempts actors, and `restrict creations/updates` apply to everyone else.
   - Option: a ruleset on `~ALL` excluding `refs/heads/warden/**` with `creation`/`update`/`deletion`, bypass `RepositoryRole` maintain/admin. It blocks the App, but also non-admin collaborators' branches. Plus a default-branch ruleset with `pull_request` (1 approval).
   - Recommendation: the planner shows both rulesets in the setup plan and the owner confirms the collaborator impact.
   - **RESOLVED (owner, 2026-11-10): the owner confirms at setup.** `/warden setup` always plans both rulesets: `warden-branch-guard` on `~ALL` excluding `refs/heads/warden/**`, with `creation`/`update`/`deletion` rules and bypass `RepositoryRole` maintain/admin; and `warden-review-gate` on `~DEFAULT_BRANCH` with `pull_request` (1 approval). The setup plan states the collaborator impact: non-admin collaborators can no longer create, update or delete branches outside `warden/**`. Nothing is applied until the owner gives the single D-16 setup confirmation. There is no per-repo opt-out key. Implemented by plans 01-09 (the Change `impact` text shown before the one confirmation) and 01-10 (`planRulesets()`).
4. **Bucket A–F computation in Phase 1.** Buckets are defined here but displayed in Phase 2. Recommend that Phase 1 ship `classifyBucket()` plus tests, reusing whose-turn v0, so the D-10 dry-run can print them.
   - **RESOLVED (adopted design, 2026-11-10):** Phase 1 ships `classifyBucket()` and `BUCKET_PRECEDENCE` with tests, built on the shared whose-turn function, so the D-10 first-run dry-run prints bucket counts. Phase 2 displays them in `/warden status` (GATE-05, ROLL-01). Implemented by plan 01-06.
5. **`CLAUDE_CODE_OAUTH_TOKEN` acceptance.** Refused in Phase 1 (`oauth_token` is ambiguous with `ANTHROPIC_AUTH_TOKEN`). Phase 6 (ISO-03) revisits it with an explicit config opt-in.
   - **RESOLVED (adopted design, 2026-11-10):** the Phase 1 runner preflight refuses a run when `CLAUDE_CODE_OAUTH_TOKEN` is set. Phase 6 (ISO-03) revisits it behind an explicit config opt-in. That work is out of scope for Phase 1. Implemented by plan 01-04 (`API_KEY_ROUTE_VARS` includes `CLAUDE_CODE_OAUTH_TOKEN`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | 26.13.0 | — |
| npm | install, lockfile | ✓ | 11.20.0 | — |
| Claude Code CLI | validate, auth status, plugin list | ✓ | 2.1.322 | — |
| gh | setup, kill switch | ✓ (authenticated) | 2.103.3 | — |
| actionlint | CI lint | ✓ | 1.7.12 | — |
| zizmor | CI audit | ✗ on PATH; ✓ via `uvx zizmor@1.32.0` | 1.32.0 | uvx/pipx |
| plutil, launchctl, caffeinate, security | launchd, keychain | ✓ | macOS 27.2 | — |
| flock | (ARCHITECTURE lock) | ✗ | — | Node `wx` lockfile |
| Sandbox GitHub repo with the App installed | E2E success criteria 1, 4 | unknown | — | Human checkpoint: the owner creates it |
| Biome, Vitest, esbuild, tsc | dev | ✗ (Wave 0 install) | — | — |

**Missing dependencies with no fallback:** the sandbox repo plus App installation. This is owner action through a `checkpoint:human-action`.
**Missing dependencies with fallback:** zizmor (uvx), flock (Node lockfile).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.1.0 (+ @vitest/coverage-v8), fast-check 4.10.2 |
| Config file | none. Wave 0 creates `vitest.config.ts` (`test.include: ["test/**/*.test.ts"]`, `fakeTimers` per test) |
| Quick run command | `npx vitest run test/<area>` (under 30 s) |
| Full suite command | `npm run check` = `biome ci . && tsc --noEmit && vitest run && npm run build && git diff --exit-code -- plugin/dist actions/*/dist && claude plugin validate --strict . && claude plugin validate --strict plugin && actionlint -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/*.yml plugin/templates/workflows/*.yml && uvx zizmor@1.32.0 --offline .github/workflows plugin/templates/workflows` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Every config key is in the schema; GSD values only in example | unit | `npx vitest run test/config/schema.test.ts` | ❌ Wave 0 |
| CONF-02 | Defaults merge (arrays replace, null deletes); invalid → readable error with YAML line | unit | `npx vitest run test/config/load.test.ts` | ❌ |
| CONF-03 | Older migrates (injected v0), newer refused, ledger newer refused | unit | `npx vitest run test/config/migrate.test.ts test/ledger/version.test.ts` | ❌ |
| CONF-04 | `examples/gsd-core.yml` validates | unit | `npx vitest run test/config/examples.test.ts` | ❌ |
| CONF-05 | Setup plan; second run "nothing to do"; stale.yml blocks clocks; AI reviewer warns; labels adopted case-insensitively | unit (fake Octokit fetch, temp dir) | `npx vitest run test/setup/` | ❌ |
| CONF-06 | Versions agree (package.json = plugin.json); CHANGELOG has an entry; validate --strict | CI + unit | `npx vitest run test/release/` + CI steps | ❌ |
| STATE-01 | Reconcile: 0/1/≥2 labels; manual move wins; alias kept; hold skipped | unit + fast-check | `npx vitest run test/state/reconcile.test.ts` | ❌ |
| STATE-02 | Codec round-trip incl. `-->`, emoji; one ledger per item; in-place PATCH | property | `npx vitest run test/ledger/codec.test.ts` | ❌ |
| STATE-03 | Spoof (wrong user.id, Bot login match only, edited by human) → needs-human; rebuild from markers | unit | `npx vitest run test/ledger/trust.test.ts test/ledger/rebuild.test.ts` | ❌ |
| STATE-04 | Two writers interleaved (in-memory comment server with 1 s timestamps) never lose a section; lease blocks Actions state change | unit (fake timers) | `npx vitest run test/ledger/concurrency.test.ts` | ❌ |
| STATE-06 | Label calls are POST then DELETE; never PUT; facets untouched | unit (recorded calls) | `npx vitest run test/state/labels.test.ts` | ❌ |
| POST-01 | Read/write permission bodies; only the poster module imports `mintWrite`; manifest has no `workflows`/`administration` | unit + static | `npx vitest run test/github/` | ❌ |
| POST-02 | Reusable workflow uses `create-github-app-token` by SHA with `client-id`; environment `warden` | static (YAML parse) + actionlint/zizmor | `npx vitest run test/workflows/` | ❌ |
| RUN-01 | Plist snapshot; `plutil -lint` (macOS only, `it.skipIf`); launcher resolves installPath from fixture JSON | unit | `npx vitest run test/schedule/` | ❌ |
| RUN-02 | Each env var, settings `env`, `apiKeyHelper` (user and project), and each `auth status` row of the truth table refuses | unit (fake `claude` on PATH) | `npx vitest run test/preflight/credentials.test.ts` | ❌ |
| RUN-03 | Version < 2.1.302 refused; launcher env has `DISABLE_AUTOUPDATER=1`; no `--bare`/`--dangerously-skip-permissions`/`claude-agent-sdk` anywhere in `src/` | unit + static grep | `npx vitest run test/preflight/version.test.ts test/static/forbidden.test.ts` | ❌ |
| RUN-08 | STOP file; var 200 "on"/404/403/network → refuse/ok/refuse/refuse; `warden:hold` skipped | unit (fake `gh`) | `npx vitest run test/preflight/killswitch.test.ts` | ❌ |
| SC-1/4/5 (E2E) | Marketplace install at version; sandbox reconcile; launchd fires after sleep | manual (human-verify) | `warden reconcile --repo <sandbox> --all` then inspect | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run test/<area touched>` plus `npx tsc --noEmit`
- **Per wave merge:** `npm run check`
- **Phase gate:** full suite green in CI on Node 24 and 26 × ubuntu/macos, plus the three manual E2E checks, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `package.json` (type: module, engines, scripts `build`/`check`/`test`), `package-lock.json`, `tsconfig.json` (`erasableSyntaxOnly`, `noEmit`, `module: nodenext`), `biome.json`, `vitest.config.ts`, `zizmor.yml`
- [ ] `test/helpers/fake-fetch.ts` (Octokit `request.fetch` with a recorded-fixture router plus an in-memory comment/label store with second-granular timestamps)
- [ ] `test/helpers/fake-bin/{claude,gh,security}` (scripts that record argv and env and emit canned JSON) and a PATH-prepend helper
- [ ] `test/fixtures/github/*.json` (open PRs with reviews, statusCheckRollup, mergeable, timeline LabeledEvents with Bot/User actors, App comments with `performed_via_github_app`)
- [ ] `.github/workflows/ci.yml` (matrix Node 24/26 × ubuntu/macos; installs `@anthropic-ai/claude-code@2.1.322` for validate only)
- [ ] Framework install: `npm install --save-dev --save-exact ...` (after the SUS checkpoint)

## Security Domain

`security_enforcement` is enabled, ASVS level 1, `security_block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | GitHub App JWT → installation tokens (@octokit/auth-app); Claude subscription only (preflight) |
| V3 Session Management | yes (tokens) | 1-hour installation tokens, re-minted below 10 minutes left; nothing on disk |
| V4 Access Control | yes | Down-scoped read and write tokens; transition table by actor; no `workflows`/`administration`; ruleset |
| V5 Input Validation | yes | TypeBox+Ajv for config and ledger; the ledger is untrusted input until author ID, checksum and schema pass |
| V6 Cryptography | yes | `node:crypto` sha256 for checksum and hash; auth-app for RS256 JWT. Never hand-roll |
| V7 Error/Logging | yes | Never log tokens, the PEM or `auth status` PII fields; redact `ghs_`/`ghp_`/`-----BEGIN` in logs |
| V8 Data Protection | yes | PEM in the login keychain (base64) and in the `warden` environment secret only |
| V10 Malicious Code / supply chain | yes | Exact pins, committed lockfile, SHA-pinned third-party actions, zizmor |
| V14 Configuration | yes | Workflow `permissions: {}` at the top; environment limited to the default branch |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Contributor posts a fake `warden:ledger` comment | Spoofing | Numeric `user.id` + `performed_via_github_app.id`; GraphQL `editor` check |
| A finding or quote containing `-->` breaks the hidden block | Tampering | ASCII JSON with `<>&` escapes; property test |
| Lost update between Actions and runner | Tampering | Writer-owned sections, body-hash re-read, verify own `rev`, lease |
| API-key billing via env, settings or helper | Elevation (cost) | Env deny-list + settings scan + `auth status` truth table |
| App key exfiltration from Actions | Info disclosure | Environment secret limited to the default branch; only the bookkeeping job references `environment: warden`; no third-party actions besides the SHA-pinned token action |
| Workflow script injection | Tampering | Phase 1 workflows take no untrusted event fields (schedule/dispatch only); zizmor `template-injection` |
| App self-recursion via label events | DoS | Phase 1 has no event-triggered workflows; repo-wide concurrency group |
| Secondary rate-limit ban on first-run apply | DoS | Serial writes, at least 1 s apart, plugin-throttling, dry-run first |

## Sources

### Primary (HIGH confidence)
- Local CLI probes, Claude Code 2.1.322: `claude plugin validate --strict [--json]` (marketplace + plugin; logged-out config), `claude auth status --json` under 9 credential conditions, `claude plugin list --json`, `claude plugin tag --help`, `claude --version`
- Local package probes in scratch dirs: typebox 1.4.6 + ajv 8.20.0 + ajv-formats 3.0.1 schema output and strict compile; esbuild 0.28.2 ESM bundle with and without the banner; yaml comment round-trip; `node_modules/ajv/dist/2020.js:37-39`; `node_modules/typebox/build/index.d.mts:1-8`
- `man launchd.plist` (macOS 27.2) lines 357-375, 483-500; `man security`; throwaway-keychain probe
- GitHub API probes: `users/dependabot[bot]`, `apps/dependabot`, cli/cli issue comments (REST and GraphQL), `actions/create-github-app-token` `action.yml` and tag v3.3.0 SHA, actionlint and zizmor latest releases, `gh variable get` exit behaviour
- actionlint 1.7.12 and zizmor 1.32.0 runs on a sample caller workflow
- npm registry (`npm view`) for every package; `gsd-tools query package-legitimacy check`

### Secondary (MEDIUM, official docs fetched)
- code.claude.com/docs/en/plugins-reference (manifest fields, env-var export table, `bin/` caveat)
- code.claude.com/docs/en/plugins/components (skill command names, hooks, data dir id rule)
- code.claude.com/docs/en/skills (bare-name invocation, `!` injection failure and permission rules, substitutions)
- code.claude.com/docs/en/plugins/marketplace-reference (fields, sources, `owner/repo@ref`, validation messages)
- code.claude.com/docs/en/env-vars (credential and provider variables, `DISABLE_AUTOUPDATER`)
- code.claude.com/docs/en/settings (file scopes, precedence)
- docs.github.com: App manifest flow; `POST /app-manifests/{code}/conversions`; installation tokens; repository rulesets; concurrency `queue`; reusable workflows and environment secrets

### Tertiary (LOW)
- Comment size limit: github.community thread 148867; mshick/add-pr-comment#93 (web search only)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Every version came from the registry, and the critical combinations were run locally.
- Architecture: MEDIUM. The patterns rest on verified platform signals, but no live sandbox run has happened yet.
- Pitfalls: HIGH for 1–5 and 8 (reproduced); MEDIUM-LOW for 6, 7, 9 and 10.

**Research date:** 2026-11-10
**Valid until:** 2026-11-24 (fast-moving: Claude Code ships often, and actionlint `queue` support may land)
