# Pitfalls Research

**Domain:** AI-assisted GitHub repo maintenance (local headless Claude Code under launchd + non-AI GitHub Actions bookkeeping + GitHub App identity)
**Researched:** 2026-11-10
**Confidence:** MEDIUM overall. Claude Code and GitHub behaviour comes from official docs (code.claude.com, docs.github.com, github.blog changelog), fetched directly and cross-checked by search, so it gets the seam's MEDIUM tier. Community and incident material comes from search only and is LOW unless noted. Items marked *(inference)* are the agent's reasoning from the PRD/ADRs plus the documented behaviour, not a cited source.

Phase names follow the PRD rollout: **Foundation**, **Review shadow**, **Review live**, **Triage**, **Implement**, **Retro**.

---

## Read This First: Contradictions Already in the Plan

The research turned up four places where the current PRD/ADRs conflict with each other or with platform behaviour. The roadmap should resolve them before Foundation is locked, not discover them mid-phase.

| # | Conflict | Why it matters | Suggested resolution |
|---|----------|----------------|----------------------|
| C1 | PRD req 18 / ADR 0002: "the next person continues from the author's branch with `Co-authored-by`" **vs** PRD req 12: "Fork PR code is never checked out or run." | When the plugin continues a fork branch, it has to fetch, check out and test contributor code. That is the exact thing the security model forbids. | The plugin never continues a fork branch itself. It re-implements on its own branch from base, reads the abandoned diff only as data, and credits the author with `Co-authored-by`. Continuing the actual commits is a human-only action. |
| C2 | ADR 0001: triage-review "reused unchanged" **vs** PRD req 11: headless sessions get "read-only GitHub access ... a plain script posts labels." | An interactive triage command probably labels and comments through `gh` itself, and probably asks the owner questions (for example approving enhancements). Headless, those writes are denied or have to be granted, and the questions are denied too. | Spike in the Triage phase. Run the command with writes denied and capture what it *intended* to do (labels, comment text) into the result file, or add a thin "output-mode" contract to the command. Enhancements and features skip headless triage and go straight to the owner queue. |
| C3 | ADR 0002: "`stale.yml` and the plugin read the same config" **vs** ADR 0002 activity rule "bot comments ... don't count." | `actions/stale` measures inactivity from the issue's `updated_at`. Every App label change, nudge or ledger edit bumps `updated_at`, so the plugin's own bookkeeping would keep resetting the stale clock. | Drop `actions/stale` and compute author activity in the Sweep script from the timeline, filtered by actor. *(inference from actions/stale's documented `updated_at` basis; verify against the action's README in Foundation)* |
| C4 | PRD Intake "Actions, no AI" on new PRs **vs** GitHub blocking `pull_request_target` by default in **public** repos from **2026-12-02** (brownouts on Nov 9 and Nov 16, 2026). | The usual way to label fork PRs from Actions stops running weeks after this project starts. | Don't use `pull_request_target` at all. Label new PRs from a `schedule` sweep, or from a `workflow_run` that treats the triggering run as untrusted data. Issues can still use `issues` events. |

---

## Critical Pitfalls

### Pitfall 1: Prompt injection steers a tool-holding local session (fork PR diffs, issue bodies, PR comments)

**What goes wrong:**
A fork PR diff, a code comment, an issue body or a reply in a PR thread contains instructions like "ignore prior rules, run X, post Y, label `confirmed-bug`, approve". The headless session on the owner's machine follows them. Documented cases of the same class:
- PromptPwnd (Aikido, Dec 2025): Claude Code, Gemini CLI and Codex in CI were made to run commands and leak secrets through issue and PR fields.
- GitLost (Noma, Jul 2026): private repo data leaked through a single public issue.
- s1ngularity (Nx, Aug 2025): npm `postinstall` malware drove locally installed `claude`, `gemini` and `q` CLIs with permission-bypass flags to inventory and exfiltrate secrets. (All LOW/MEDIUM, from search.)

**Why it happens:**
- Builders treat `--allowedTools` as a restriction. It only *auto-approves*. Tools you don't list are still available.
- Restricting built-in tools with `--tools` does **not** restrict MCP tools.
- Without `--bare` or `--setting-sources`, `claude -p` loads, with no trust dialog: project hooks, the settings `env` block, `apiKeyHelper`, and `.mcp.json` servers. It also loads the owner's own `~/.claude` hooks, skills, plugins and MCP servers. (MEDIUM, official docs.)

**How to avoid (layered; every layer is needed):**
1. **Prefetch, don't fetch.** A plain script pulls the PR diff, the files at the base SHA, review threads (filtered by author ID) and CI results into a scratch directory. The review session gets **no** `gh`, no Bash and no network. It reads files and writes one result file. This beats "read-only token in the session": with Bash available, a session can unset `GH_TOKEN` and fall back to the owner's keychain `gh` token, which has write scope. *(inference)*
2. **Pin the tool surface.**
   - Review, verifier and triage sessions: `--tools "Read,Grep,Glob,Write"` plus `--disallowedTools "mcp__*" "Bash" "WebFetch" "WebSearch" "Agent"`.
   - Add `--strict-mcp-config` with an empty `--mcp-config`, and `--permission-mode dontAsk --permission-prompts none`.
   - Evaluate `--restricted` (v2.1.248+). It loads only managed settings plus `--settings`, removes command tools and WebFetch, and confines file tools to the working directories. Spike whether it still uses subscription OAuth.
3. **Isolate configuration.** Use `--setting-sources` that excludes `project` and `local`, `--settings '{"disableAllHooks": true}'`, and `--plugin-dir` pointing only at Warden. This owner's global setup includes MCP servers (Exa, Claude Docs, claude-in-chrome, memtrace, codegraph), SessionStart hooks (the codegraph worktree indexer) and merge-capable skills (`bug-fixer` "through merge", `review-open-prs`, `pr`). All of that would load into an injected session by default.
4. **Fail closed on the init event.** Run with `--output-format stream-json`. Abort if the `system/init` event lists any `mcp_servers`, unexpected `plugins`, or tools beyond the allowlist.
5. **Treat the result file as hostile input.** The poster validates it against a JSON schema (also pass `--json-schema`) and checks the following.
   - **Label allowlist per task:** review can never emit `confirmed-bug`, `wontfix` or approve.
   - **Event types:** only `COMMENT` reviews.
   - **No @mentions:** strip or neutralise them, so the App can't be made to mass-ping users in the owner's name.
   - **No secrets:** scan for secret patterns (`ghp_`, `github_pat_`, `sk-ant-`, `-----BEGIN`) and refuse to post.
   - **Links and images:** strip external image URLs, a known exfil channel through rendered markdown.
   - **Length:** cap total length.
6. **Rules from base only.** Read REVIEW.md, CLAUDE.md, `.github/warden.yml` and specialist prompts from the base SHA, never from the PR. A PR that touches any of these is forced to the full tier and flagged on the card.
7. **Input provenance.** Rework reads only findings authored by the App and maintainer comments, filtered by numeric user ID. Retro reads only maintainer-authored comments. Contributor replies go to the decision card as context and never auto-resolve a finding.

**Warning signs:**
- `permission_denials` in result messages, especially Bash, WebFetch or `mcp__*`.
- Init events that list MCP servers.
- Result files with mentions, URLs or label values outside the allowlist.
- Findings whose wording echoes PR text verbatim.
- Shadow-mode reports that "agree" with an obviously wrong PR.

**Residual risk to document honestly:**
- The posted comment itself is a public channel. Anything the session can read can be published, so the readable set must hold no secrets (layer 1).
- An Implement or Rework session needs Bash to run tests, so it cannot be fully locked down. See Pitfall 2.
- Injection can still bias *judgement*, for example "this PR is fine", without any tool misuse. Only the human gate catches that.

**Phase to address:** Foundation (runner flags, poster validation, prefetch script) → verified in Review shadow (red-team PRs) → re-verified each later phase as new session types appear.

---

### Pitfall 2: The Implement/Rework session is the real attack surface (Bash plus untrusted issue text plus supply chain)

**What goes wrong:**
- Implement takes an issue body (untrusted), writes code, runs tests and preflight with Bash on the owner's main login.
- An injected issue can make it run commands, or write a subtle backdoor into a "fix" that then arrives as a clean-looking bot PR.
- Dependency installs during preflight run `postinstall` scripts. That is the s1ngularity vector, which drove the local `claude` CLI itself.
- A write-capable session in the repo checkout can plant `.claude/settings.json` hooks or `.mcp.json`. The next `claude -p` in that directory then runs them without a trust prompt. (MEDIUM, official docs: `-p` uses project hooks and `.mcp.json` with no trust dialog.)

**Why it happens:**
"Confirmed bug" (ADR 0001: root-cause analysis confirms it, no failing test needed) feels like a trust boundary, but the issue text that drove the confirmation is still attacker-controlled. The rollout gate "bot PRs merge after a quick look" rewards rubber-stamping.

**How to avoid:**
- Run Implement and Rework with Claude Code **sandboxing**: an OS-level filesystem and network allowlist. Bash deny rules alone don't hold; the docs say they can be bypassed with `/usr/bin/curl` or `sh -c`.
- Better still, run them under the documented separate macOS user. Make that the recommended default for public repos.
- No credentials in the session. The plain script, not the session, pushes the branch and opens the PR with the App token.
- Work in a throwaway git worktree outside the main checkout. Run every `claude -p` with `--setting-sources` that ignores project settings and with `disableAllHooks`, so planted hooks never execute. Delete the worktree after each item.
- Use `npm ci --ignore-scripts` or the configured equivalent where the project allows it. The preflight command is config, so document the risk.
- The Merge Danger card must flag issue-originated changes to auth, CI, release, dependency or workflow files. The App must lack the `workflows` permission, so it physically cannot change `.github/workflows`.

**Warning signs:**
- Fix PRs touching files unrelated to the issue's root cause.
- New dependencies added in a bug fix.
- Untracked `.claude/` or `.mcp.json` files appearing in worktrees.
- Sandbox denial logs.

**Phase to address:** Implement (blocking prerequisite). Sandbox/isolation design starts in Foundation so the runner supports it.

---

### Pitfall 3: Silent fallback to API-key billing (breaks the core cost constraint)

**What goes wrong:**
A headless run bills an API account instead of the subscription.

**Why it happens (MEDIUM, official auth docs):**
- **Credential precedence:** cloud-provider vars, then `ANTHROPIC_AUTH_TOKEN`, then `ANTHROPIC_API_KEY`, then `apiKeyHelper`, then `CLAUDE_CODE_OAUTH_TOKEN`, then profiles, then subscription `/login`.
- **In `-p` mode,** `ANTHROPIC_API_KEY` "is always used when present".
- **Settings can inject credentials:** the settings `env` block and `apiKeyHelper` can supply them from user or project settings, so the runner's own environment can look clean while a settings file injects a key.
- **Interactive `/warden`:** an API key approved once in the past is reused silently.
- **`--bare` breaks subscription auth:** it is the docs' recommended mode for scripts and "will become the default for `-p` in a future release", but it never reads OAuth, keychain or `CLAUDE_CODE_OAUTH_TOKEN`. When that default flips, headless runs fail with "not logged in". The tempting "fix" is setting an API key.
- **Separate overage risk:** if the owner enabled paid extra usage on the plan, runs past the limits may cost money. (LOW: the support page doesn't say what happens at the limit.)

**How to avoid:**
- Runner preflight refuses to start if any of these is set, in the process env **or** in any settings `env` block: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`/`FOUNDRY`, `ANTHROPIC_BASE_URL`, or `apiKeyHelper` in any settings file.
- Never pass `--bare`. Check the Claude Code version against a tested range and pass explicit flags rather than relying on `-p` defaults.
- Turn auto-update off for the runner (`DISABLE_AUTOUPDATER=1`). Upgrade deliberately.
- The `/warden` interactive entry point runs the same check, since PRD req 9 only covers the runner.
- Document "turn off extra usage" in setup docs.

**Warning signs:**
- `/status` shows an API key in use.
- Console billing activity.
- A sudden "not logged in" after a Claude Code update.

**Phase to address:** Foundation.

---

### Pitfall 4: Ledger trust, corruption and races

**What goes wrong:**
1. **Spoofing.** Anyone can post a comment containing the ledger marker, for example `lastReviewedSha=<head>` (never reviewed) or `findings: won't-fix`.
2. **HTML-comment breakage.** JSON holding `-->`, which is plausible inside a quoted code snippet, ends the hidden block early. It corrupts the ledger and leaks raw JSON into the rendered comment.
3. **Size.** Comment bodies cap at 65,536 characters *(MEDIUM-LOW: widely reported API limit; verify)*. Findings history grows without bound.
4. **Lost updates.** Actions Sweep (nudge times) and a local batch (findings) read-modify-write the same comment. GitHub has no conditional PATCH for comments, so last writer wins. *(inference)*
5. **Deletion.** Any collaborator with write access can delete or edit the comment.
6. **Version skew.** An upgraded local plugin writes ledger v2 while the pinned Actions workflow still writes v1.

**How to avoid:**
- Trust a ledger only if `user.id` equals the App bot's numeric ID and `performed_via_github_app.id` equals the App ID. Never match on login string or marker text alone.
- Encode the payload (base64 JSON inside a fixed marker). Include `ledgerVersion`, a monotonically increasing `rev` and a checksum. On parse failure, go to a `needs-human` state; never "start fresh".
- Use single-writer field ownership. Actions owns clock and nudge fields; local runs own review fields. Re-read right before PATCH and merge field-wise.
- Serialize writers: `concurrency:` groups per item number in workflows, and a local lockfile shared by launchd batches and interactive `/warden`.
- Compact findings: keep resolved ones as hashes or counts and archive the detail in the decision card.
- Make the ledger rebuildable. Every posted review carries a hidden marker with the SHA it reviewed, so a deleted ledger can be reconstructed from the App's review history.
- Any writer refuses to write a ledger whose version is newer than its own.

**Warning signs:**
- Two ledger comments on one PR.
- Parse errors.
- `rev` going backwards.
- Nudge times lost after a review run.

**Phase to address:** Foundation (format, ownership, locking). Review shadow keeps a local mirror of the same format, so "zero re-reviews" is measurable before anything posts.

---

### Pitfall 5: `lastReviewedSha..head` is the wrong delta (force-push, rebase, "Update branch")

**What goes wrong:**
- **Force-push:** after a rebase, `lastReviewedSha` is no longer an ancestor of head. `git diff last..head` then includes every base change since the old merge-base, so the review flags code the contributor never wrote.
- **"Update branch" merge commits:** these pull base changes into the delta the same way.
- **Rebase with no change:** a pure rebase produces a new SHA with an identical PR diff, which counts as a re-review.
- **Line drift:** findings anchored by line numbers drift. A won't-fix finding re-fires after unrelated edits above it.

**How to avoid:**
- Define "reviewed state" as the **PR diff** (merge-base(base, head)..head), not the head SHA. Store a hash of the normalised PR diff. If it's unchanged, skip (zero re-reviews even across rebases).
- Compute the delta as a diff of the two PR diffs (`git range-diff` or a per-file patch comparison). Base-merge commits never enter the delta.
- Detect `head_ref_force_pushed` timeline events and non-ancestor SHAs explicitly.
- Anchor findings by file plus a hash of the surrounding hunk lines. "Code around it changes" means that anchor hash changes.
- Fetch fork objects into a bare mirror (`refs/pull/N/head`) to diff. Never check out.

**Warning signs:**
- Findings on files outside the PR's changed-file list.
- A re-review counter above 0 right after a rebase.
- Contributors replying "I didn't touch that".

**Phase to address:** Review shadow (the gate's "zero re-reviews" depends on it). Foundation defines the ledger fields.

---

### Pitfall 6: TOCTOU between review and post

**What goes wrong:**
- **Head moves:** the author pushes while a batch reviews. The poster posts a review against the new head, or records `lastReviewedSha = current head`, so the unreviewed commits are marked reviewed forever.
- **Invalid inline positions:** inline comments on lines outside the current diff get rejected (HTTP 422), and the whole review fails. *(MEDIUM-LOW, common API behaviour)*

**How to avoid:**
- Pin everything to the SHA the session actually saw. Post with `commit_id` set to that SHA, and record that SHA, not the live head.
- Re-check the head at post time. If it moved, post anyway (pinned) and leave the item queued for a delta review.
- Validate every inline position against that SHA's diff, and fold invalid ones into the review body.

**Phase to address:** Review live (poster). Design it in Foundation.

---

### Pitfall 7: Stale handling that alienates contributors

**What goes wrong:**
Research on 20 large projects found Stale bot cleared backlog but was followed by **fewer active contributors** (Khatoonabadi et al., arXiv:2305.18150; LOW/MEDIUM, from search). Specific risks here:
- **Go-live avalanche:** when Sweep turns on, every one of the roughly 72 old PRs with a months-old review and a silent author gets nudged and then closed within 5 days.
- **Activity mis-counting:**
  - Commit dates are author-controlled, and rebases keep old dates.
  - Pushes aren't timestamped in the PR API.
  - The author replying to the bot is real activity.
  - The App's own comments must not count.
- **Bot PRs:** the stale logic applies author-silence clocks to the App's own PRs.
- **Too many nudges:** two nudges in 24 hours (48h and 72h) can read as nagging, especially across time zones and weekends. *(inference)*

**How to avoid:**
- Grandfather on go-live: clocks start from activation, not history. Cap closes per day. Pin a "how Warden works" issue and link it from CONTRIBUTING and from every nudge.
- Record observed head-SHA changes with the observation time (Sweep and the ledger) as push activity. Use timeline `created_at` for comments. Filter actors by ID.
- Exempt App-authored PRs from stale closes.
- Close messages always say how to reopen and that the work is credited.
- A defect PR that gets closed returns its issue to `ready-for-agent` with author credit preserved (see C1).

**Warning signs:**
- Reopen requests.
- "Why was this closed?" comments.
- Falling distinct-contributor counts in Sweep metrics. Add that metric.

**Phase to address:** Foundation (clock logic, activity definition) → Review live (Sweep turned on only after reviews post, since closes require "a review was posted").

---

### Pitfall 8: AI review noise erodes trust fast

**What goes wrong:**
- Nit-heavy, verbose or false-positive reviews get ignored, and the owner and contributors learn to skim past them. Practitioner reports put "critical" false-positive rates around 30% and show teams ignoring bots within weeks. (LOW, anecdotal search sources.)
- The same finding gets restated on every push.
- Low-severity points get labelled blocking.

**How to avoid:**
- Keep the shadow gate (≥7/10 blocking findings agreed) and keep tracking agreement live.
- Hard caps: N blocking findings and M total. Nits never go in contributor-facing output.
- Every finding cites file, line and evidence. The verifier pass drops anything it can't re-derive.
- Re-checked open findings are updated in place in the ledger and summarised as "still open (n)", not re-posted.
- Retro feeds disagreements back into REVIEW.md.

**Warning signs:**
- Agreement dropping below 70%.
- The owner overriding findings at the gate.
- Contributors arguing with the bot.

**Phase to address:** Review shadow (measure) → Review live (caps, format) → Retro (feedback loop).

---

### Pitfall 9: Headless runs that stall, loop or burn the owner's limits

**What goes wrong:**
- **Turns:** `--max-turns` has no default. A run that hits it ends with `error_max_turns` and no result.
- **Background waits:** background work can keep a `-p` process alive up to the 10-minute idle cap, or indefinitely for background commands.
- **Global CLAUDE.md:** this owner's global CLAUDE.md requires `AskUserQuestion` for every decision. Headless, that tool is denied or removed, so a session may thrash until the turn cap.
- **Shared limits:** `claude -p` on a plan draws from the **same subscription limits** as interactive use (support article, Oct 7 2026 update; the June 2026 separate-pool plan was paused). This policy has changed twice in 2026, so treat it as volatile.
- **Auth expiry:** an expired login fails every request. Login expiry and keychain problems under launchd show up as generic failures.
- **Older versions:** on versions before Manual-mode `-p` defaults (pre-v2.1.302), or with a `--permission-prompt-tool`, permission requests can wait.

**How to avoid:**
- Set per-task `--max-turns`, `--permission-prompts none`, a wall-clock timeout per item (send SIGINT, then SIGTERM), and `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`.
- Classify every result subtype:
  - `success`
  - `error_max_turns`
  - `error_max_budget_usd`
  - `error_during_execution`
  - `error_max_structured_output_retries`
  - `stop_reason: refusal`
  - `api_retry` events with `rate_limit` or `authentication_failed`
- On a rate limit or auth error, **stop the whole batch** (don't retry item by item) and record `nextAllowedAt` locally.
- Keep the item cap well under the limit window, and leave headroom for the owner's own work (PRD req 10).
- Load a Warden-specific system prompt via `--append-system-prompt-file`. Exclude user settings so global CLAUDE.md directives don't apply.

**Warning signs:**
- Rising `num_turns` per item.
- Items repeatedly ending in `error_max_turns`.
- The owner hitting limits during their own interactive work.

**Phase to address:** Foundation (runner) → tuned in Review shadow.

---

### Pitfall 10: GitHub App identity mistakes (scope, key custody, recursion, "[bot]" badge)

**What goes wrong:**
- **Over-broad permissions:** the App gets `contents: write` for its own branches and can push anywhere unprotected, including base. If granted `workflows`, it can rewrite CI.
- **Key in two places:** the App private key sits on the owner's machine and as an Actions secret. Any workflow with secret access, or any compromised third-party action, can mint tokens.
- **Token expiry:** installation tokens expire after **1 hour** (MEDIUM, official). A long batch that minted one token at start fails mid-run.
- **Recursion:** events created with App tokens **do trigger workflows**, unlike `GITHUB_TOKEN` (MEDIUM, official). App comments and labels fire `issue_comment` and `labeled` workflows, which write again, and so on.
- **Shared rate limit:** local runs and Actions share one installation budget (5,000/hr base).
- **"[bot]" badge vs voice:** GitHub shows the App as `name[bot]` with a bot badge, which contradicts ADR 0003's "never calls itself a bot". If the voice header uses `@trek-e`, every post notifies the owner.

**How to avoid:**
- **Minimal permissions:** issues and pull-requests write, contents write. **No** `workflows`, **no** administration.
- **Ruleset** restricting App pushes to a `warden/*` branch prefix. Protected base.
- **Short-lived tokens:** mint per item and per write burst, downscoped via the `permissions` and `repositories` parameters (or `actions/create-github-app-token` permission inputs).
- **Key custody:** store the local private key in the macOS Keychain or outside every working directory, with Read deny rules. In Actions, put the key in an **environment** secret limited to the default branch and only the bookkeeping jobs.
- **Recursion guards:** every workflow job checks `github.event.sender.id != <app bot id>` (or `sender.type != 'Bot'` plus an allowlist).
- **Voice:** reference the owner in backticks or without `@`, and word the header to own the badge: "AI-assisted review drafted by Claude under `trek-e`'s rules; trek-e is accountable." Accept that GitHub will display "bot".

**Phase to address:** Foundation (App setup, workflows) → Review live (voice wording).

---

## Moderate Pitfalls

### Actions workflow misuse beyond `pull_request_target`
- **Script injection:** `${{ github.event.issue.title }}`, a comment body or a branch name interpolated into `run:` is shell injection with secrets in scope. This applies to `issues` and `issue_comment` triggers, which run in base context even for fork PRs. Pass event data via `env:` only. Lint workflows with zizmor or actionlint in CI.
- **`workflow_run` artifacts and PR numbers are attacker-controlled** (GitHub Security Lab). Look the PR up by head SHA through the API.
- **Scheduled workflows:** GitHub disables them in public repos after 60 days without repository activity, and cron runs can be delayed at peak minutes. Adopters' quiet repos lose Sweep silently. Schedule off-peak minutes and surface "last Sweep run" in the bucket report. *(MEDIUM-LOW, documented GitHub behaviour, not fetched this session)*
- **Supply chain:** pin third-party actions by SHA. Adopters should pin Warden's reusable workflows by tag or SHA, since those workflows receive the adopter's App key.

### Secondary rate limits and write amplification
- **Limits** (MEDIUM, official): 80 content-generating requests/min and 500/hour; 900 points/min, with mutating requests costing more; 100 concurrent requests. Continuing to request while limited "may result in the banning of your integration".
- **Where it bites:** the first labelling pass over a large backlog, `/warden setup` creating labels, and editing every ledger on every run.
- **Mitigation:**
  - Serialise writes and diff before each PATCH (skip unchanged ledgers).
  - Honour `retry-after` and `x-ratelimit-reset`, with exponential backoff.
  - Throttle to well under 80/min.
  - Budget the hourly 500.

### Label-state drift
- **Ways it drifts:**
  - Humans add or remove labels in the UI.
  - Other bots, issue forms or labelers add labels.
  - Repos rename labels.
  - A config change remaps names.
- **Result:** the "exactly one state label" invariant breaks, and the plugin and a human can fight, re-applying each other's labels.
- **Mitigation:** the ledger is the source of truth for plugin-owned state, and labels are a projection. A state-label change by a non-App actor (from the timeline) is an **override event**: honour it, record it, never revert it. Two or more state labels go to `needs-human`. Label renames need a migration step, not a silent remap.

### Config schema and plugin release breakage for adopters
- **Updates stall:** Claude Code plugin updates are off by default for third-party marketplaces. Users get a new copy only when the computed `version` changes, so pushing commits without bumping `version` ships nothing (MEDIUM, official).
- **Floating refs:** adopters on a floating ref get breaking changes the moment you push.
- **Version skew:** the plugin is updated locally while the two copied workflows stay old. Ledger and config formats diverge.
- **Over-strict schema:** a schema with `additionalProperties: false` makes a newer config fail on an older plugin.
- **Mitigation:**
  - Separate `configVersion` and `ledgerVersion`. The runner checks plugin, workflow and config version compatibility before each batch and refuses on mismatch.
  - Ship a `warden migrate` (non-AI) for each schema bump. Changelog migration notes are required (ADR 0005).
  - Use marketplace `ref`/`sha` pinning and release channels.
  - Make "second repo onboarded from docs" (v1 done criterion) a test of upgrades too.

### Co-authored-by and contributor-branch handling
- **Trailer format:** the trailer must be exactly `Co-authored-by: Name <email>` after a blank line at the end of the message. The email must be one linked to the contributor's account; otherwise use their `ID+login@users.noreply.github.com`. Get it from the API, not from commit metadata the contributor may have set to a private address.
- **DCO and CLA:** repos with DCO or CLA checks can fail on App-authored commits, or on reused contributor commits without `Signed-off-by`. The App can't sign off for them. Make this config (`dco: true` changes the continuation flow).
- **Branch boundaries:** never push to contributor branches (non-goal). The "continue" path is a new App branch (see C1).

### launchd quirks
- **Schedule key:** `StartCalendarInterval` catches up once on wake, coalescing missed slots. `StartInterval` doesn't reliably catch up. Slots missed while the machine is off are skipped (MEDIUM). Use `StartCalendarInterval` hourly plus a runner-side "is a batch due?" stamp file. That makes catch-up-on-wake deterministic.
- **PATH:** launchd PATH is `/usr/bin:/bin:/usr/sbin:/sbin`. `claude` (`~/.local/bin`), `gh`, `node` and `/opt/homebrew/bin` aren't on it. Set `EnvironmentVariables` explicitly and resolve absolute paths at setup time.
- **Domain:** use a **LaunchAgent** in the `gui/<uid>` domain. LaunchDaemons and logged-out sessions can't use the login keychain, where Claude Code stores credentials on macOS. A locked keychain makes it fall back to `~/.claude/.credentials.json`.
- **Separate macOS user:** this option needs that user's own Claude login, `gh` login and an active session, or a file-based credential setup.
- **Sleep and wake:**
  - The machine can idle-sleep mid-batch. Wrap the run in `caffeinate -i`.
  - Right after wake the network may not be up. Retry DNS and connection failures before declaring the batch failed.
  - A run during a dark wake can be cut off. *(inference)*
- **Silent disabling:** macOS Login Items / "Background Items" toggles can disable the agent silently. Repos under `~/Documents`, `~/Desktop` or iCloud hit TCC prompts that a headless job can't answer. Setup docs must check both.
- **Single instance:** launchd won't start a second instance of a running job, but interactive `/warden` can run concurrently. Use the shared lockfile (Pitfall 4).

---

## Minor Pitfalls

- **Huge PRs:** the diff API refuses very large diffs (on the order of 300 files / 20k lines; LOW). Fall back to per-file fetching and force full tier plus a human card.
- **Kill switch checked too rarely:** PRD says "before each batch". The poster must also check it before **every** write, and fail closed if the variable can't be read.
- **Shadow mode leakage:** Actions bookkeeping runs during shadow. Make sure Sweep doesn't treat "no ledger" as "unreviewed", and doesn't nudge from shadow data.
- **Decision cards go stale:** the head moves after the card is posted. Stamp the card with the SHA and invalidate it on change.
- **Duplicate detection without AI:** naive similarity gives false matches. Label and link only, never auto-close.
- **Goodhart on metrics:** "zero re-reviews" can be met by skipping reviews, and "bot PRs merge after a quick look" by rubber-stamping. Pair each with a counter-metric: unreviewed-delta count, and escaped defects.
- **Retro bloat:** REVIEW.md gains contradictory or overfitted rules. Have the Retro PR show rule count and conflicts.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Give review sessions `gh` with a read-only token instead of prefetching | Less script code | Session can reach keychain write token or network; exfil path | Never for fork PRs |
| Key reviews on head SHA only | Simple | Re-reviews on every rebase; base changes in delta | Never |
| Match ledger by marker text | Simple lookup | Spoofable state | Never |
| Use `actions/stale` for the shared clock | Free | Bot activity resets clocks (C3) | Never with App-posted bookkeeping |
| Run Implement on main login without sandbox | Faster setup | Host compromise via issue injection or `postinstall` | Private repo with trusted reporters only |
| Let `-p` load user/project settings | Owner's tools "just work" | Hooks, MCP and skills (incl. merge-capable ones) in injected sessions | Never for headless |
| One long-lived installation token per batch | Fewer calls | Fails after 1h mid-batch | Batches provably under 50 min |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code `-p` | `--allowedTools` as restriction | `--tools` + `--disallowedTools "mcp__*"` + `--strict-mcp-config` + `dontAsk` |
| Claude Code `-p` | `--bare` for reproducibility | Not usable with subscription auth; use `--setting-sources` + `--settings` + `--plugin-dir` |
| Claude Code updates | Auto-update between runs | Pin version, disable autoupdater, test flags on upgrade |
| GitHub App | Recursive workflow triggers | Sender-ID guard on every job |
| GitHub reviews | Inline comments on lines outside the diff | Validate positions, fold into body |
| GitHub comments | HTML-comment JSON containing `-->` | Encode payload |
| Actions | `pull_request_target` for fork labelling | `schedule` / `workflow_run` with untrusted-data handling |
| launchd | Assume shell PATH and profile env | Explicit `EnvironmentVariables`, absolute paths |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| App private key inside a working directory | Readable by any session, publishable | Keychain or outside dirs + Read deny |
| Contributor comments fed into Rework or Retro | Injection becomes code or rules | Filter by maintainer/App user ID |
| Posting unvalidated model output | Mass mentions, secret leak, wrong labels | Schema + allowlists + secret scan in the poster |
| App granted `workflows` permission | Agent can rewrite CI | Omit permission; ruleset on `.github/` |
| `-p` run in a dir with writable `.claude/` | Planted hooks run next session | Throwaway worktrees, ignore project settings, `disableAllHooks` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Voice header @-mentions the owner | Owner notification flood | Handle in backticks/plain text |
| Header claims "not a bot" while UI shows [bot] | Contributors feel misled | Say plainly: AI-drafted under the owner's rules, owner accountable |
| AI text in first person as the owner ("I tested this") | False claims of human verification | Never claim actions not taken; mark which comments the owner typed |
| Wall of findings on a first-time contributor | Contributor abandons | Caps, kind tone, blocking only |
| No way to ask for a human | Frustration | Every comment says how to request the owner's review |

## "Looks Done But Isn't" Checklist

- [ ] **Runner:** refuses with an API key in **settings `env`**, not just the shell env. Verify by setting it in `~/.claude/settings.json`.
- [ ] **Review session:** init event shows zero MCP servers and only the allowlisted tools. Verify with this owner's real `~/.claude`.
- [ ] **Poster:** rejects a result file containing `@someone`, `ghp_...`, an external image, or `confirmed-bug` from review.
- [ ] **Ledger:** a fake ledger comment from a non-App account is ignored. A finding quoting `-->` round-trips.
- [ ] **Delta:** rebase-only push → no review. "Update branch" merge → no findings on base code.
- [ ] **Head moved during review:** posted review and ledger carry the reviewed SHA, not the new head.
- [ ] **Sweep:** an App comment doesn't reset the author clock. A rebase push does. Go-live doesn't mass-close.
- [ ] **launchd:** job runs after sleep and wake, with the lid closed then opened, after a reboot plus login, with network delayed.
- [ ] **Kill switch:** flipping it mid-batch stops the next **write**, not just the next batch.
- [ ] **Upgrade:** new plugin plus old workflows → runner refuses with a clear message.
- [ ] **Public repo after 2026-12-02:** no workflow depends on `pull_request_target`.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Injected comment posted | MEDIUM | Kill switch; delete/minimise comment; rotate any token that was readable; add case to red-team suite |
| Ledger corrupted or deleted | LOW (if rebuildable) | `needs-human`; rebuild from App reviews' SHA markers |
| Mass stale close | MEDIUM | Reopen via script from Sweep log; apology note in pinned issue; add daily cap |
| API-key billing incident | HIGH | Revoke key; audit settings `env`; add check; check Console usage |
| App key leaked | HIGH | Revoke key in App settings, generate new, rotate Actions secret, audit App activity log |
| Breaking release to adopters | MEDIUM | Yank by moving marketplace `ref`; ship `warden migrate`; changelog note |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| C1 fork-branch continuation | Foundation (decide), Implement (build) | No code path checks out a fork ref |
| C2 triage command contract | Triage (spike first) | Headless triage produces intended actions in the result file, zero denied writes |
| C3 stale clock basis | Foundation | Unit tests: App activity never resets clock |
| C4 `pull_request_target` block | Foundation | Workflows pass during GitHub brownout windows |
| P1 prompt injection | Foundation → Review shadow | Red-team PR/issue suite run each phase |
| P2 Implement sandbox | Implement (prereq designed in Foundation) | Sandbox denies egress; planted `.claude/` hook doesn't run |
| P3 API-key fallback | Foundation | Preflight tests per credential source |
| P4 ledger integrity | Foundation | Spoof/encoding/race tests |
| P5 delta correctness | Review shadow | Zero re-reviews across rebase fixtures |
| P6 TOCTOU | Review live | Push-during-review test |
| P7 stale alienation | Foundation → Review live | Go-live dry run shows close counts; contributor-count metric |
| P8 review noise | Review shadow → Retro | ≥70% agreement sustained live |
| P9 headless limits | Foundation | Every result subtype handled; batch stops on rate limit |
| P10 App scope/recursion | Foundation | No recursive runs in a week of logs; App lacks `workflows` |
| launchd quirks | Foundation | Sleep/wake/reboot checklist passes |
| Config/release breakage | Foundation (versions) → v1.0.0 | Second-repo onboarding + an upgrade rehearsal |

## Sources

Official (seam tier MEDIUM: fetched and cross-checked):
- Claude Code headless/`-p`: https://code.claude.com/docs/en/headless
- Claude Code authentication and precedence: https://code.claude.com/docs/en/iam
- Claude Code permissions, "What runs before you trust a folder", Bash rule limits: https://code.claude.com/docs/en/permissions
- Claude Code CLI reference (`--tools`, `--max-turns`, `--restricted`, `--strict-mcp-config`, `--permission-prompts`): https://code.claude.com/docs/en/cli-reference
- Agent loop result subtypes: https://code.claude.com/docs/en/agent-sdk/agent-loop
- Plugin hosting, versions and auto-update: https://code.claude.com/docs/en/plugins/host-marketplace
- Claude plan and `claude -p` usage status: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- GitHub REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub App installation tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- Triggering workflows (App tokens trigger runs): https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- `pull_request_target` blocked by default Dec 2, 2026: https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2
- `actions/checkout` v7 safer defaults: https://github.blog/changelog/2026-06-18-safer-pull_request_target-defaults-for-github-actions-checkout
- `pull_request_target` default-branch sourcing: https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/
- GitHub Security Lab, pwn requests: https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/

Community and incident (LOW unless noted):
- PromptPwnd: https://aikido.dev/blog/promptpwnd-github-actions-ai-agents
- CSA note on AI GitHub Actions injection: https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-github-actions-security-20260503-csa-st/
- s1ngularity / Nx AI-CLI abuse: https://snyk.io/blog/weaponizing-ai-coding-agents-for-malware-in-the-nx-malicious-package , https://wiz.io/blog/s1ngularity-supply-chain-attack
- Stale bot study: https://arxiv.org/abs/2305.18150 ; abandoned PRs: https://arxiv.org/abs/2110.15447
- AI review noise (anecdotal): https://tianpan.co/blog/2026-04-17-ai-code-review-at-scale-false-positive-trap , https://dev.to/alexey-pelykh/i-ran-449-ai-code-reviews-in-9-days-then-i-almost-got-banned-17h5
- launchd sleep behaviour: https://lists.macosforge.org/pipermail/launchd-dev/2012-October/001029.html , https://developer.apple.com/library/prerelease/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html

---
*Pitfalls research for: AI-assisted GitHub repo maintenance (The Warden of the Gate)*
*Researched: 2026-11-10*
