# Roadmap: The Warden of the Gate

## Overview

The Warden goes from an empty repo to a tagged v1.0.0 plugin by following the PRD's gated rollout stages, with each phase ending at its rollout gate. The Foundation stage is split into Phases 1 and 2 because it carries almost half the requirements. Phase 1 builds the state layer every task stands on: config, labels, ledger, App identity and runner guards. Phase 2 puts the no-AI bookkeeping live and ends at the Foundation gate, the bucket report. After that, AI work is added in order of risk. Review runs in shadow first (Phase 3), then live (Phase 4). Triage and Claim come next (Phase 5), then Implement and Rework inside isolation backends (Phase 6), and finally Retro and Release (Phase 7). Throughout, AI proposes and scripts dispose: sessions are read-only, and one poster holds the write token.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Core State & Safety Rails** - Installable plugin with validated config, idempotent setup, trusted labels and ledger, App identity, and a runner that refuses unsafe starts
- [ ] **Phase 2: Bookkeeping & Bucket Report** - No-AI intake and issue clocks run on GitHub, and the maintainer sees the backlog in buckets A–F (Foundation gate)
- [ ] **Phase 3: Review Shadow** - Delta-only, tiered AI review runs locally into a shadow report the maintainer scores (shadow gate)
- [ ] **Phase 4: Review Live** - Reviews post as one signed COMMENT review per head, every PR ends at a decision card, and PR stale clocks go live
- [ ] **Phase 5: Triage & Claim** - The configured triage command runs headless per issue behind the poster, and confirmed work flows through claim windows to `ready-for-agent`
- [ ] **Phase 6: Implement & Rework** - Isolated sessions turn `ready-for-agent` issues into failing-test-first bot PRs and rework named findings
- [ ] **Phase 7: Retro & Release** - Maintainer review comments become weekly rules PRs, v1.0.0 ships, and a second repo onboards from the docs

## Phase Details

### Phase 1: Core State & Safety Rails
**Goal**: The maintainer can install the Warden, configure a repo with one validated file, and trust the state labels and ledger that the App keeps on GitHub. No AI session can start on an API key or while the kill switch is set.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06, STATE-01, STATE-02, STATE-03, STATE-04, STATE-06, POST-01, POST-02, RUN-01, RUN-02, RUN-03, RUN-08
**Success Criteria** (what must be TRUE):
  1. The maintainer installs the Warden from its marketplace at an explicit version. Plugin CI runs tsc, Biome, Vitest, the committed-`dist/` diff check, `claude plugin validate --strict`, actionlint and zizmor, all green.
  2. Running `/warden setup` on a repo (no AI) writes a starter `.github/warden.yml`, creates the missing labels, copies the workflow templates and checks the Node and Claude Code versions. It reports a conflicting `stale.yml` or other AI reviewer, and a second run changes nothing.
  3. Unset config values come from `config/defaults.yml`. An invalid config stops every task with a readable error, `examples/gsd-core.yml` validates, an older `schemaVersion`/`ledgerVersion` migrates and a newer one is refused.
  4. On a sandbox repo, the reconcile run (hourly in Actions as the App, or on demand) leaves every open PR and issue with exactly one Warden state label. Labels change add-then-remove, and a maintainer's manual label move is kept. Each item's ledger comment is edited in place. A spoofed or corrupt ledger moves the item to `needs-human` and can be rebuilt from the App's review SHA markers. Concurrent Actions and runner writes never drop each other's sections.
  5. Interactive `/warden` and the launchd job (which fires on schedule and catches up on wake) refuse to start in three cases: an API-key route is present, `claude auth status` is not the subscription, or the kill switch (repo variable or local STOP file) is set. A `warden:hold` item is skipped. Workflows and sessions use separate App tokens (read-only for sessions, write for the poster only), and the App has no `workflows` permission.
**Plans**: TBD

### Phase 2: Bookkeeping & Bucket Report
**Goal**: GitHub keeps new issues and PRs labelled and moves waiting-on-reporter issues along without any AI. The maintainer can see the whole backlog sorted into buckets A–F.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: POST-04, POST-06, INTK-01, INTK-02, INTK-03, INTK-04, SWP-01, SWP-04, SWP-05, SWP-06, SWP-07, RUN-09, GATE-05, GATE-06, ROLL-01
**Success Criteria** (what must be TRUE):
  1. A new issue gets a template check, a possible-duplicate suggestion (never a close) and a triage label, and a first-time contributor gets a one-line welcome. Every such post opens with the configured voice header and never calls the Warden a bot. Warden-authored events do not retrigger workflows.
  2. A new PR receives its Warden state label within one Sweep interval. A push to a PR whose ledger records an older reviewed head flips it to `needs-rereview`. No workflow in the repo uses `pull_request_target`.
  3. `needs-reproduction` issues close after 14 days of reporter silence and other waiting-on-reporter issues after 28. Only author activity counts, computed by the shared whose-turn function. Clocks count from go-live under a daily close cap, and every close carries a reopen path. Confirmed, approved and `keep-open` items, and items waiting on the maintainer, never close. Requests to the author are posted as new comments.
  4. Sweep records open PR count, median PR age, re-review count, distinct contributors and the last Sweep run. `/warden status` (no AI) shows buckets A–F, queue state, the last Sweep run and the next batch, and the maintainer confirms the bucket report matches their sense of the backlog.
  5. Setup creates a pinned "how Warden works" issue, and every intake and sweep task can run in dry-run, reporting what it would post without writing.
**Plans**: TBD

### Phase 3: Review Shadow
**Goal**: The maintainer can watch the Warden review PRs locally and score its findings without anything reaching GitHub. Each review covers only what changed since the last reviewed state, and no head is reviewed twice.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: STATE-05, POST-03, POST-05, RUN-04, RUN-05, RUN-06, RUN-07, REV-01, REV-02, REV-03, REV-04, REV-05, REV-06, REV-08, REV-09, ROLL-02
**Success Criteria** (what must be TRUE):
  1. A review batch handles one PR at a time, each in a fresh restricted `claude -p` session, within caps, turn limits and a wall clock. A session whose `system/init` lists unexpected tools fails closed. The batch stops cleanly on rate-limit, usage-limit or auth errors, and the next batch resumes from the ledger.
  2. A PR whose head and diff hash are unchanged is skipped before any AI runs. After a push, rebase or base merge, only the effective delta is reviewed. Open findings are re-checked and relocated, and won't-fix findings stay resolved unless the code around them changes.
  3. Deterministic gates and the configured tier run before AI. Specialists run in sequence, followed by a verifier with a findings cap. With Memtrace on, the full tier uses `get_impact` and `recall_decision`, and everything still works with Memtrace off.
  4. Reviews land only in a local shadow report and local ledger, where the maintainer records agree or disagree per finding. A crash mid-post never duplicates an entry. Sessions see only prefetched packets and base-branch rules, and fork code is never checked out.
  5. The red-team suite of malicious PRs and issues passes in CI, with the poster rejecting every off-policy result. After two weeks of shadow review, the maintainer agrees with at least 7 in 10 blocking findings, and no head commit has been reviewed twice.
**Plans**: TBD
**Research**: Needed. Topics: `--restricted`/`--setting-sources` with subscription OAuth and `--plugin-dir`, the JSON Schema subset `--json-schema` accepts, usage-limit signals under subscription auth, the `system/init` event shape, and the interdiff algorithm against real rebase fixtures.

### Phase 4: Review Live
**Goal**: Contributors receive one signed COMMENT review per new head, and every PR ends at a short decision card for the maintainer. PRs stuck on the author are nudged and closed on the ADR 0002 clock.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: REV-07, GATE-01, GATE-02, GATE-03, GATE-04, SWP-02, SWP-03, ROLL-03
**Success Criteria** (what must be TRUE):
  1. Each reviewed head gets exactly one COMMENT review from the App, pinned to the SHA that was reviewed and with valid inline positions. The Warden never approves, merges, applies `approved` or `wontfix`, or changes workflows, `REVIEW.md`, the plugin or `MAINTAINERS`.
  2. Every PR ends at `pr:human-gate` with a decision card of about 15 lines: linked issue, Merge Danger, CI evidence, open findings and recommendation. The maintainer works the PR queue in `/warden gate`; the triage lanes are added in Phase 5.
  3. The maintainer marks a finding won't-fix with `/warden wontfix F<n>` or by resolving its thread, and it stays resolved. The same action from any other login is ignored.
  4. PRs where the maintainer responded or a review was posted get nudged at 48h and 72h of author silence and close at 5 days, counted from go-live under the daily cap. Unanswered PRs are never closed. Reviewed defect PRs with unaddressed requested changes close after 5 days, and the linked issue returns to `ready-for-agent` marked `has-prior-attempt`.
  5. The maintainer's minutes per PR at the gate drop below the pre-Warden baseline, with no contributor confusion about the reviews or clocks.
**Plans**: TBD

### Phase 5: Triage & Claim
**Goal**: New issues are triaged the way the maintainer would triage them, without the triage command writing to GitHub or merging anything. Confirmed bugs become claimable or `ready-for-agent` work.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: TRI-01, TRI-02, TRI-03, TRI-04, TRI-05, ROLL-04
**Success Criteria** (what must be TRUE):
  1. A triage batch runs the configured triage command unchanged, one issue per fresh session, wrapped as `--issue N --dry-run`. Each session has a read-only token, a write-blocking hook and an empty `GH_CONFIG_DIR`. Its results reach GitHub only through the result adapter and the poster.
  2. Defect and needs-repro issues complete headless, and a root-caused bug gets `confirmed-bug` when `triage.confirmOnRootCause` is on. Enhancement and feature issues stop at `awaiting-maintainer`, and the maintainer finishes them in `/warden gate`.
  3. The triage command's mid-run merge never executes headless, and any PR it produces lands at the human gate. Possible duplicates are suggested in the triage comment and never closed.
  4. A reporter who offered a fix gets a claim window (label plus ledger entry). When the window expires, or no fix was offered, confirmed work becomes `ready-for-agent`.
  5. Triage labels 9 in 10 issues the way the maintainer would.
**Plans**: TBD
**Research**: Needed. Topics: a spike of the real `/triage-review` under `--dry-run` with writes denied, the command's artifact formats for the result adapter, how to load settings for it (`--plugin-dir` plus an explicit command file), and claims by users outside the org.

### Phase 6: Implement & Rework
**Goal**: Confirmed bugs turn into small bot PRs that prove a failing test first and pass review after a quick look. The PRs are built in isolated sessions that hold no credentials.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: IMPL-01, IMPL-02, IMPL-03, IMPL-04, IMPL-05, ISO-01, ISO-02, ISO-03, ISO-04, ROLL-05
**Success Criteria** (what must be TRUE):
  1. A headless batch started by launchd runs an Implement session inside a Docker Sandbox, authenticated with the subscription and never an API key. The maintainer can switch `isolation.backend` among `docker-sandbox`, `devcontainer`, `apple-container`, `separate-user` and `claude-sandbox`, and the docs cover each backend, including running batches as a separate macOS user.
  2. Implement takes at most one `ready-for-agent` issue a day while no other bot PR is open. It works in a throwaway worktree off base, commits a failing test before the fix and runs the configured test and preflight commands. It then opens a PR from `warden/**` with a Merge Danger summary and failing-run evidence, and stops at "PR opened".
  3. A commit-range validator rejects any bot PR where the fix precedes the test or a protected path changed. Sessions hold no credentials, run with hooks disabled and install with `--ignore-scripts` where possible. Implement and Rework warn when no backend is active, and fork-branch continuation refuses to run without one.
  4. Rework fixes only the named findings on bot PRs, for at most 3 rounds, then hands off to the human gate. A `has-prior-attempt` issue restarts from base, reads the prior diff as data and credits the author with `Co-authored-by`.
  5. Bot PRs merge after a quick look more often than they bounce, with escaped defects tracked alongside.
**Plans**: TBD
**Research**: Needed. Opens with a spike on headless Docker Sandboxes under launchd with subscription auth. Other topics: Claude Code sandbox configuration on macOS, LaunchAgent and OAuth/keychain under a separate macOS user, and how DCO/CLA checks treat App-authored commits.

### Phase 7: Retro & Release
**Goal**: The Warden learns from the maintainer's own review comments every week, and ships as v1.0.0 that another maintainer can adopt from the docs alone.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: RETRO-01, ROLL-06
**Success Criteria** (what must be TRUE):
  1. Each week, Retro collects review comments only from the maintainer's numeric user ID. It opens a PR adding `REVIEW.md` lines or lint rules that shows the rule count and any conflicts. Comments from anyone else never become rules.
  2. The weekly rules PR lands on GSD Core.
  3. v1.0.0 is tagged with a changelog and migration notes, the moving `v1` tag points at it, and an existing install upgrades cleanly.
  4. A maintainer of a second repo onboards from the docs in an afternoon, with every repo-specific value set in `.github/warden.yml` alone.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core State & Safety Rails | 0/TBD | Not started | - |
| 2. Bookkeeping & Bucket Report | 0/TBD | Not started | - |
| 3. Review Shadow | 0/TBD | Not started | - |
| 4. Review Live | 0/TBD | Not started | - |
| 5. Triage & Claim | 0/TBD | Not started | - |
| 6. Implement & Rework | 0/TBD | Not started | - |
| 7. Retro & Release | 0/TBD | Not started | - |
