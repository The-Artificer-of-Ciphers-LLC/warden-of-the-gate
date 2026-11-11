# Requirements: The Warden of the Gate

**Defined:** 2026-11-10
**Core Value:** Every open PR and issue sits in exactly one known state, recorded on GitHub, so any run can pick up cold and no head commit is ever reviewed twice — the maintainer only sees items that need their decision.

## v1 Requirements

### Configuration & Release (CONF)

- [ ] **CONF-01**: Maintainer configures every repo-specific value in `.github/warden.yml` (labels, base branch, maintainers, voice, triage command, test/preflight commands, stale clocks, tier paths, specialists, throttles, batch size/schedule, kill-switch name, Memtrace on/off, isolation backend)
- [ ] **CONF-02**: Config is validated against a published JSON Schema (generated from TypeBox) and unset values come from `config/defaults.yml`; invalid config stops every task with a readable error
- [ ] **CONF-03**: Config and ledger carry `schemaVersion` / `ledgerVersion`; the plugin migrates older versions, refuses newer ones, and releases include migration notes
- [ ] **CONF-04**: `examples/gsd-core.yml` is a complete, validated config for GSD Core
- [ ] **CONF-05**: Maintainer runs `/warden setup` (no AI) to write a starter config, create missing labels idempotently, copy workflow templates, check Node ≥24.12 and Claude Code version, and detect a conflicting `stale.yml` or other AI reviewer
- [ ] **CONF-06**: Plugin ships as a versioned Claude Code plugin + marketplace in one repo, with an explicit `version`, `vX.Y.Z` tags plus a moving `v1` tag for Actions pins, a changelog, and CI that runs tsc, Biome, Vitest, the committed-`dist/` diff check, `claude plugin validate --strict`, actionlint and zizmor

### State & Ledger (STATE)

- [ ] **STATE-01**: Every open PR and issue carries exactly one Warden state label; an invariant check repairs drift, and a maintainer's manual label move wins
- [ ] **STATE-02**: Each PR (and triaged issue) has one ledger comment edited in place, with an encoded hidden JSON block (`rev`, checksum, `lastReviewedSha`, diff hash, tier, rounds, findings with status, nudge times)
- [ ] **STATE-03**: Ledger comments are trusted only when authored by the App's numeric bot user; spoofed or corrupt ledgers move the item to `needs-human`, and the ledger can be rebuilt from SHA markers in the App's reviews
- [ ] **STATE-04**: Concurrent writers (Actions vs the local runner) can't overwrite each other: writer-owned sections, runner leases, a re-read before every write and a check after it, and per-item Actions `concurrency` groups with `queue: max`
- [ ] **STATE-05**: A crash between posting and the ledger update can't cause a duplicate post or re-review (outbox with exactly-once replay)
- [ ] **STATE-06**: Labels change by adding the new one and then removing the old one, never by replacing the whole set

### Runtime & Session Safety (RUN)

- [ ] **RUN-01**: Maintainer runs `/warden` interactively, or launchd runs batches headless via a stable launcher in `${CLAUDE_PLUGIN_DATA}` (`StartCalendarInterval`, catch-up on wake, explicit PATH, `caffeinate -i`)
- [ ] **RUN-02**: Runner and interactive `/warden` refuse to start if any API-key route is present (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, cloud-provider vars, `apiKeyHelper` in any settings file), and require `claude auth status` to report the claude.ai/firstParty subscription
- [ ] **RUN-03**: Claude Code version is pinned with auto-update off; `--bare`, `--dangerously-skip-permissions` and the Agent SDK are never used
- [ ] **RUN-04**: Each item runs in a fresh `claude -p` session with a per-task tool list, `--disallowedTools "mcp__*"`, `--strict-mcp-config`, isolated setting sources, `dontAsk` with no permission prompts, `--max-turns`, a wall-clock timeout, and `--json-schema` structured output
- [ ] **RUN-05**: A session fails closed if its `system/init` event lists unexpected tools or MCP servers
- [ ] **RUN-06**: Sessions only ever see prefetched packet files and base-branch checkouts; fork code is never checked out or run outside an isolation backend; review rules come from the base branch only
- [ ] **RUN-07**: Batches enforce item caps and turn limits, stop cleanly on rate-limit, usage-limit or auth errors, classify every result subtype, and resume from GitHub state on the next run
- [ ] **RUN-08**: A kill switch (repo variable plus a local STOP file) and a per-item `warden:hold` label are checked by every workflow and before every batch and item
- [ ] **RUN-09**: Every task supports dry-run

### Identity & Posting (POST)

- [ ] **POST-01**: All GitHub writes go through a GitHub App; the runner mints a read-only installation token for sessions and a write token held only by the poster; the App never gets the `workflows` permission, and a ruleset limits its pushes to `warden/**`
- [ ] **POST-02**: Actions authenticate as the same App via `actions/create-github-app-token@v3`
- [ ] **POST-03**: The poster treats every result file as hostile: schema validation, a per-task label allowlist, an endpoint allowlist (no merge, no approve), COMMENT-only reviews, stripped mentions and external images, and a secret scan
- [ ] **POST-04**: Every contributor-facing post opens with the configured voice header inserted by the poster (AI-assisted, drafted by Claude under the maintainer's rules, maintainer accountable; owner named without @-mention), and Warden-written text never calls itself a bot
- [ ] **POST-05**: Posting goes through a sink: GitHub, Shadow (local report plus local ledger) or DryRun
- [ ] **POST-06**: Actions the author needs to take are posted as new comments, never only as ledger edits

### Intake (INTK)

- [ ] **INTK-01**: New issues get a template check, an existing-duplicate check (suggest only, never auto-close) and a triage label via `issues`/`issue_comment` workflows, with no AI
- [ ] **INTK-02**: New and pushed PRs are labelled or flipped to `needs-rereview` by an hourly Sweep polling GraphQL; no workflow uses `pull_request_target`
- [ ] **INTK-03**: A contributor's first PR or issue gets a one-line welcome with pointers
- [ ] **INTK-04**: Workflows guard against recursion by sender ID and avoid script injection from untrusted fields

### Sweep & Stale (SWP)

- [ ] **SWP-01**: One whose-turn function in warden-core computes author activity (push, comment or review reply from the author; bot comments and CI runs don't count) from GraphQL timelines filtered by actor ID, and nudges, closes and claim expiry all use it
- [ ] **SWP-02**: PRs where the maintainer responded or a review was posted get nudged at 48h and 72h of author silence and closed at 5 days; unanswered PRs go to the review queue instead and are never closed
- [ ] **SWP-03**: Reviewed defect PRs with unaddressed requested changes close after 5 days, and the linked issue returns to `ready-for-agent` with a `has-prior-attempt` marker
- [ ] **SWP-04**: `needs-reproduction` issues close after 14 days and other waiting-on-reporter issues after 28; confirmed or approved issues never close for staleness
- [ ] **SWP-05**: Maintainer-marked drafts, `keep-open` and PRs waiting on the maintainer are exempt; App-authored PRs are exempt from author nudges
- [ ] **SWP-06**: Clocks start at go-live (a grandfather clause for the existing backlog) with a daily close cap; every close message includes a reopen path
- [ ] **SWP-07**: Sweep records metrics: open PR count, median PR age, re-review count, distinct contributors, and the last Sweep run time

### Review (REV)

- [ ] **REV-01**: A PR whose diff hash and head equal the last reviewed state is skipped by script before any AI runs
- [ ] **REV-02**: Review covers only the effective delta (interdiff against the merge base), so rebases, base merges and force-pushes neither re-review unchanged code nor flag code the author didn't write
- [ ] **REV-03**: Findings carry fingerprints (file, enclosing symbol, snippet hash); open findings are re-checked on each push and relocated, and won't-fix findings stay resolved unless the surrounding code changes
- [ ] **REV-04**: Deterministic gates (CI status, conflicts, protected paths, size) run before AI; risk tiers come from configured tier paths
- [ ] **REV-05**: Tiered review runs the configured specialists as sequential sessions followed by a verifier pass with a cap on findings
- [ ] **REV-06**: On the full tier with Memtrace enabled, review uses `get_impact` and `recall_decision`, and a `--diff` CI check is available; everything works with Memtrace off
- [ ] **REV-07**: Each review is posted as one COMMENT review pinned to the SHA actually reviewed, with inline positions validated
- [ ] **REV-08**: Shadow mode writes reviews only to a local report with a local ledger and captures the maintainer's per-finding agree or disagree verdict
- [ ] **REV-09**: A red-team suite of malicious PRs and issues runs in CI and must pass before any live posting

### Human Gates (GATE)

- [ ] **GATE-01**: Every PR ends at `pr:human-gate` with a decision card of about 15 lines: linked issue, Merge Danger, CI evidence, open findings, recommendation
- [ ] **GATE-02**: Maintainer works the queue in `/warden gate`, including the interactive enhancement and feature triage lanes
- [ ] **GATE-03**: Maintainer marks findings won't-fix (`/warden wontfix F<n>` or thread resolution), honoured only from the maintainer's login
- [ ] **GATE-04**: The plugin never approves, merges, applies `approved` or `wontfix`, or changes workflows, `REVIEW.md`, the plugin or `MAINTAINERS` without the maintainer
- [ ] **GATE-05**: Maintainer views a no-AI `/warden status` digest: buckets A–F, queue state, last Sweep run and next batch
- [ ] **GATE-06**: Setup creates a pinned "how Warden works" issue explaining clocks, labels, voice and how to reach the maintainer

### Triage & Claim (TRI)

- [ ] **TRI-01**: Triage runs the configured triage command unchanged, one issue per fresh session, wrapped as `--issue N --dry-run` with a read-only token, a write-blocking hook, `GH_CONFIG_DIR` pointed at an empty directory, and a result adapter
- [ ] **TRI-02**: Defect and needs-repro lanes complete headless; root-causing applies `confirmed-bug` when `triage.confirmOnRootCause` is on; enhancement and feature lanes stop at `awaiting-maintainer`
- [ ] **TRI-03**: The triage command's mid-run merge never executes headless; any PR it produces goes to the human gate
- [ ] **TRI-04**: A reporter who offered a fix gets a claim window (label plus ledger entry); on expiry, or with no offer, confirmed work becomes `ready-for-agent`
- [ ] **TRI-05**: Triage suggests possible duplicates in its comment without closing them

### Implement & Rework (IMPL)

- [ ] **IMPL-01**: Implement takes one `ready-for-agent` issue a day with at most one open bot PR, branches off base into a throwaway worktree, commits a failing-first test, fixes, runs the configured test and preflight commands, and opens a PR with a Merge Danger summary and failing-run evidence; it stops at "PR opened"
- [ ] **IMPL-02**: A commit-range validator confirms the test was committed before the fix and that no protected paths were touched
- [ ] **IMPL-03**: Rework fixes only the named findings on bot PRs, at most 3 rounds, then goes to the human gate
- [ ] **IMPL-04**: For a `has-prior-attempt` issue, Implement restarts from base, reads the prior diff as data and credits the author with `Co-authored-by`; continuing the author's actual branch happens only inside an active isolation backend
- [ ] **IMPL-05**: Implement and Rework sessions hold no credentials, use isolated settings with hooks disabled, and run installs with `--ignore-scripts` where possible

### Isolation (ISO)

- [ ] **ISO-01**: `isolation.backend` is pluggable: `docker-sandbox` (default), `devcontainer`, `apple-container`, `separate-user`, `claude-sandbox`
- [ ] **ISO-02**: Implement and Rework warn (advisory) when no backend is active; fork-branch continuation refuses without one
- [ ] **ISO-03**: Container backends authenticate with the subscription (host-held token or `CLAUDE_CODE_OAUTH_TOKEN`), never an API key
- [ ] **ISO-04**: Docs cover each backend, including running batches as a separate macOS user

### Retro (RETRO)

- [ ] **RETRO-01**: Weekly, Retro collects review comments only from the maintainer's numeric user ID and opens a PR adding `REVIEW.md` lines or lint rules, showing rule count and conflicts

### Rollout Gates (ROLL)

- [ ] **ROLL-01**: The Foundation bucket report (buckets A–F, defined in Phase 1) matches the maintainer's sense of the backlog
- [ ] **ROLL-02**: Two weeks of shadow review reach at least 7 in 10 blocking findings agreed, with zero head-commit re-reviews
- [ ] **ROLL-03**: Live review lowers maintainer minutes per PR without confusing contributors
- [ ] **ROLL-04**: Triage labels 9 in 10 issues the way the maintainer would
- [ ] **ROLL-05**: Bot PRs merge after a quick look more often than they bounce, tracked together with escaped defects
- [ ] **ROLL-06**: v1.0.0 is tagged and one second repo is onboarded from the docs in an afternoon

## v2 Requirements

### Platform

- **PLAT-01**: Non-macOS schedulers (systemd, Windows Task Scheduler)
- **PLAT-02**: Multiple maintainers per repo

### Automation

- **AUTO-01**: AI-generated duplicate candidates as a standalone intake feature
- **AUTO-02**: Automatic continuation of abandoned branches without a maintainer label

## Out of Scope

| Feature | Reason |
|---------|--------|
| Merging, approving, auto-merge | The maintainer is always the merge gate |
| Pushing to or rebasing contributor branches | Contributor ownership |
| Claude in CI or Actions, or any API-key call | ADR 0004 cost constraint |
| Real-time AI or chat-ops on every event | Batch model (ADR 0004) |
| `pull_request_target` workflows | Blocked by GitHub from 2026-12-02; a security risk |
| actions/stale for Warden clocks | Can't express whose-turn; resets on the plugin's own activity |
| Auto-closing duplicates | Closes valid issues; suggest only |
| Learning from anyone but the maintainer | Retro injection risk |
| Dashboards, merge queues, walkthrough summaries | Noise; not core |
| Hosted or multi-tenant service | Local, per-maintainer tool |
| Rewriting `/triage-review` | ADR 0001: reused, invocation wrapped |
| Redistributing Memtrace skills | Licence |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| (filled by roadmapper) | | |

**Coverage:**
- v1 requirements: 74 total
- Mapped to phases: 0 (pending roadmap)

---
*Requirements defined: 2026-11-10*
*Last updated: 2026-11-10 after initial definition*
