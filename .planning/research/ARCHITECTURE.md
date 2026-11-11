# Architecture Research

**Domain:** Claude Code plugin acting as an AI-assisted GitHub repo maintainer. Local AI batches (interactive `/warden`, or headless `claude -p` started by launchd) are split from non-AI GitHub Actions bookkeeping. All durable state lives on GitHub.
**Researched:** 2026-11-10
**Confidence:** MEDIUM overall. Platform facts were read directly from vendor docs (code.claude.com, docs.github.com, Apple launchd man page) and are quoted below. The research seam rates direct `webfetch` as LOW and cross-checked search as MEDIUM. The overall design (state machine, ledger protocol, outbox, effective-delta review) is reasoned from those facts and the PRD/ADRs. It has not been tested against a live repo yet.

---

## Standard Architecture

### The one rule that shapes everything

**AI proposes, scripts dispose.** Every Claude session is a pure function: `packet in → result.json out`. It holds no GitHub write credential and makes no state decisions such as "should this PR be reviewed?" or "which label comes next?". Deterministic scripts do everything else: choosing the queue, checking `head == lastReviewedSha`, computing the delta, tiering, applying the state machine, editing the ledger, and posting. Each guarantee in the PRD maps onto this rule:

- "zero re-reviews": the script checks this before any AI starts.
- "read-only GitHub": the session has no write token.
- "resume from ledger": scripts own the ledger.
- "prompt injection is contained": a hijacked session can only produce a bad `result.json`, and the validator plus the human gate catch that.

### System Overview

```
┌──────────────────────────────── GitHub (system of record) ─────────────────────────────────┐
│  State labels (exactly one per item)   Ledger comment per item (App-authored, hidden JSON) │
│  PR reviews (comment-only)  Issue/PR comments  Bot branches + PRs  Repo variable: kill sw. │
│  .github/warden.yml (read from BASE branch only)   REVIEW.md   MAINTAINERS                 │
└──────────────▲───────────────────────────────▲──────────────────────────────▲──────────────┘
               │ App installation token        │ App installation token       │ read-only
               │ (Actions secret)              │ (write, poster only)         │ down-scoped token
┌──────────────┴──────────────┐  ┌─────────────┴──────────────────────────────┴──────────────┐
│ GitHub Actions (NO AI)      │  │ Maintainer's Mac (ALL AI)                                 │
│ ┌─────────┐ ┌───────┐       │  │  launchd LaunchAgent ──► runner (batch loop, script)      │
│ │ intake  │ │ claim │       │  │  /warden (interactive) ─┘   │                             │
│ └─────────┘ └───────┘       │  │        ┌────────────────────┼─────────────────────┐       │
│ ┌──────────────────────┐    │  │        ▼                    ▼                     ▼       │
│ │ sweep (cron): nudges,│    │  │   queue selector ──► gatherer ──► packet dir (files)      │
│ │ stale close, claim   │    │  │                                       │                   │
│ │ expiry, metrics,     │    │  │                                       ▼                   │
│ │ label reconcile      │    │  │        AI session(s): claude -p, restricted tools,        │
│ └──────────────────────┘    │  │        no write token, --json-schema ─► result.json       │
│   all call warden-core      │  │                                       │                   │
│   (same lib as runner)      │  │                                       ▼                   │
└─────────────────────────────┘  │   validator (schema + policy) ──► poster (sink)           │
                                 │        sinks: GitHubSink | ShadowSink | DryRunSink        │
                                 │   local: outbox/, results cache, shadow ledger, logs      │
                                 └───────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical implementation |
|---|---|---|
| **warden-core** (library) | Config load, migrate and validate. State machine (states, transitions, actor permissions). Ledger codec and store. GitHub client (App auth, rate-limit-aware, serial writes). Stale-clock math. Tiering. Fingerprints. | One package in the chosen script language (see STACK.md). Imported by the runner, the poster, setup, and the Actions entry points. **Single source of truth for rules shared by both sides.** |
| **config** | Layers `config/defaults.yml` ← base-branch `.github/warden.yml` ← machine-local overrides, then runs migrations and validates against `config/schema.json`. | Pure function `loadConfig(repo) → FrozenConfig + configHash` |
| **state machine** | Defines canonical state IDs, maps them to repo label names, lists legal transitions, and says which actor may make each one. | Declarative table plus `transition(item, to, actor)` that throws on an illegal move |
| **ledger store** | Reads and writes the per-item ledger with optimistic concurrency, writer-owned sections, leases, and verify-after-write. | `LedgerStore` interface with two backends: `GitHubLedger` (comment) and `LocalLedger` (JSON files for shadow mode) |
| **intake** (Actions) | Template check, duplicate search, initial state label, empty ledger. | Workflow on `issues: opened`, `pull_request_target: opened/reopened/ready_for_review` |
| **claim** (Actions) | Detects fix offers and opens or expires claim windows. Moves confirmed work to `ready-for-agent`. | Workflow on `issue_comment`, `issues: labeled`, plus the sweep cron |
| **sweep** (Actions) | Nudges, stale closes, claim expiry, author-activity stamps, metrics, label reconciliation (zero or two state labels → repair). | `schedule:` cron, plus `pull_request_target: synchronize` for the push → needs-rereview flip |
| **runner** | Preflight guards, machine lock, catch-up, per-task queues, item caps, turn and wall-clock limits, one fresh session per item, clean stop, resume. | Script started by launchd or `/warden run`. No AI itself. |
| **queue selector** | Builds each task's queue from GitHub state (label search, then ledger filter). Drops items whose head is already reviewed or whose lease is held. | GraphQL batch query plus ledger parse |
| **gatherer** | Builds the item's **packet**: diff and effective delta, open findings with code at anchors, base-branch rules (`REVIEW.md`), CI and gate results, tier and specialists, issue thread. **Never checks out or runs fork code.** | Script using the read-only token and a bare git object mirror (`git fetch` of `refs/pull/N/head`, read via `git show` and `git diff`, no checkout) |
| **AI session** | Reads the packet and emits a structured result (findings, re-check verdicts, triage outcome, Merge Danger text). | `claude -p` with `--tools`, `--strict-mcp-config`, `--max-turns`, `--output-format json --json-schema` |
| **specialists + verifier** | Path-routed focused reviewers. The verifier re-checks each candidate finding against the code and drops what it cannot confirm. | Plugin `agents/*.md` prompts, run by the runner as separate sequential sessions |
| **validator** | Checks the result against the schema. Policy checks: findings must point into the delta or at an open finding, no forbidden transitions, size caps, no contributor-facing text that calls itself a bot. | Pure function, no AI |
| **poster** | Applies a validated result through a sink: comment-only review, labels, ledger, comments, and for implement, push plus PR. Adds the voice header. Exactly-once via outbox. | Script, the only holder of the App write token |
| **setup** | Writes the starter `warden.yml`, creates missing labels, installs workflow templates and the launchd plist. No AI. | `/warden setup` command, which runs a script |
| **bucket report** | Deterministic backlog classification (buckets A–F). Foundation gate. | Script, output to a markdown report |

---

## Item State Machine

### Design decisions

1. **Canonical state IDs in core; repo label names in config.** Core code never hardcodes `confirmed-bug`. It uses the state `issue.confirmed`, and `labels.states.issue.confirmed: confirmed-bug` maps it to GSD Core's label (ADR 0005).
2. **Two kinds of labels.** *State labels* are exclusive: exactly one, and the state machine owns them. *Facet labels* are not exclusive: `bug`, `enhancement`, `keep-open`, tier, `claimed-by-reporter`, and so on. Only state labels obey the one-label rule.
3. **The label is authoritative for queue selection. The ledger mirrors it and holds history.** Labels are searchable (`is:open label:"pr:needs-review"`). The ledger records `state` plus the last N transitions for debugging and repair.
4. **Leases are not states.** "Being reviewed right now" lives in a ledger lease, not a label. That avoids label churn, notification noise, and stuck `in-progress` labels after a crash.
5. **Changing state is two calls, never `PUT` (replace all).** Add the new label, then remove the old one. `PUT /labels` would wipe facet labels someone added at the same moment. A crash in between leaves two state labels. The sweep reconciler repairs that with a fixed precedence (the later state in the table wins, and the ledger `state` breaks ties).
6. **Maintainer moves always win.** If the maintainer hand-sets a state label, the next reader follows it. It records `by: maintainer` in history and never "corrects" it back.

### Issue states

| State ID | Default label | Meaning | Clock (ADR 0002) |
|---|---|---|---|
| `issue.new` | `needs-triage` | Intake done, triage pending | none |
| `issue.needs-repro` | `needs-reproduction` | Waiting on reporter for a repro | close at 14 d of reporter silence |
| `issue.waiting-reporter` | `needs-info` | Waiting on reporter, other reasons | close at 28 d |
| `issue.awaiting-maintainer` | `needs-maintainer` | Enhancement or feature digest posted; maintainer must approve or deny | never closes |
| `issue.confirmed` | `confirmed-bug` | Root-caused (ADR 0001) | never closes |
| `issue.approved` | `approved` | Maintainer approved an enhancement or feature | never closes |
| `issue.claim-offered` | `claim-window` | Reporter offered a fix; claim window open | claim-window expiry |
| `issue.claimed` | `claimed` | Reporter or contributor is working on it | claim expiry, then back to ready |
| `issue.ready` | `ready-for-agent` | Implement queue | never closes |
| `issue.pr-open` | `has-pr` | A linked PR exists (bot or human) | follows the PR |
| terminal | (closed) / `wontfix` / `duplicate` | | |

### PR states

| State ID | Default label | Meaning |
|---|---|---|
| `pr.new` | `pr:needs-review` | Never reviewed. Review queue. Never stale-closed. |
| `pr.needs-rereview` | `pr:needs-rereview` | New push after a review. Review queue (delta only). |
| `pr.changes-requested` | `pr:changes-requested` | Blocking findings posted. Waiting on author. Stale clock runs. Rework queue when the author is the App. |
| `pr.human-gate` | `pr:human-gate` | Decision card posted. Maintainer's turn. Exempt from staleness. |
| `pr.blocked` | `pr:blocked` | A deterministic gate failed (CI red, conflicts, missing linked issue). Waiting on author. Stale clock runs. |
| terminal | merged / closed | |

### Transition table (who may do what)

A = Actions bookkeeping (App token). R = runner via poster (App token). M = maintainer only. The poster and the Actions entry points both call `transition()`, which rejects any move the table does not allow for that actor. This is how "human gates" are enforced in code rather than in prompts.

| From → To | Trigger | A | R | M |
|---|---|:-:|:-:|:-:|
| (none) → `issue.new` | issue opened | ✓ | | ✓ |
| `issue.new` → `needs-repro` / `waiting-reporter` | triage result | | ✓ | ✓ |
| `issue.new` → `confirmed` | triage root-caused (`triage.confirmOnRootCause`) | | ✓ | ✓ |
| `issue.new` → `awaiting-maintainer` | triage: enhancement or feature | | ✓ | ✓ |
| `awaiting-maintainer` → `approved` | approve | | | ✓ |
| any open → `wontfix` | deny | | | ✓ |
| `needs-repro`/`waiting-reporter` → `new` | reporter replied | ✓ | | ✓ |
| `needs-repro`/`waiting-reporter` → closed | stale clock | ✓ | | ✓ |
| `confirmed`/`approved` → `claim-offered` | reporter offered a fix | ✓ | | ✓ |
| `confirmed`/`approved` → `ready` | no offer, or offer window lapsed | ✓ | | ✓ |
| `claim-offered` → `claimed` | reporter accepted | ✓ | | ✓ |
| `claimed` → `ready` | claim expired | ✓ | | ✓ |
| `ready` → `pr-open` | bot PR opened (implement) or linked human PR | ✓ | ✓ | ✓ |
| `pr-open` → `ready` | defect PR stale-closed (ADR 0002) | ✓ | | ✓ |
| (none) → `pr.new` | PR opened | ✓ | ✓ | ✓ |
| `pr.new`/`needs-rereview` → `changes-requested` | review with blocking findings | | ✓ | ✓ |
| `pr.new`/`needs-rereview` → `blocked` | deterministic gate failed | | ✓ | ✓ |
| `pr.new`/`needs-rereview` → `human-gate` | review clean, or rework rounds = 3 | | ✓ | ✓ |
| `changes-requested`/`blocked`/`human-gate` → `needs-rereview` | author push (`synchronize`) | ✓ | | ✓ |
| `changes-requested` → closed | stale clock (only after review or maintainer response) | ✓ | | ✓ |
| any PR → merged | merge | | | ✓ (only) |

Invariants the reconciler checks every sweep: exactly one state label on every open item; `pr.new` items are never stale-closed; nothing in `human-gate`, `awaiting-maintainer`, `confirmed` or `approved` is closed for staleness; every open PR has an App-authored ledger.

---

## Ledger: Format and Concurrency

### Platform constraint (verified)

GitHub REST does **not** support conditional writes. In GitHub's words: "Conditional requests for unsafe methods, such as `POST`, `PUT`, `PATCH`, and `DELETE` are not supported" unless an endpoint says otherwise. The issue-comment `PATCH` endpoint does not. So there is no ETag or `If-Match` optimistic concurrency. The same page advises serial requests and at least one second between mutating requests to avoid secondary rate limits. Concurrency control therefore has to happen in the application.

### Comment format

One comment per item, authored by the App. A visible part for humans (the decision card when the item is at the gate), then a hidden machine block:

```markdown
> AI-assisted review by @trek-e — drafted by Claude under the maintainer's rules; the maintainer is accountable for it.

**Status:** changes requested · round 2 of 3 · tier: standard · last reviewed `a1b2c3d`
| ID | Severity | Status | Where |
|----|----------|--------|-------|
| F3 | blocking | open   | src/foo.ts:42 |
| F5 | advisory | won't-fix (maintainer) | src/bar.ts:10 |

<!-- warden:ledger:v1
{"schema":1,"kind":"pr","item":123,"rev":17, ... }
warden:ledger:end -->
```

Hidden JSON schema (v1):

```jsonc
{
  "schema": 1, "kind": "pr", "item": 123,
  "rev": 17,                         // bumped by every writer on every write
  "state": "pr.changes-requested",   // mirror of the label
  "history": [{"at":"…","from":"pr.new","to":"pr.changes-requested","by":"runner"}], // capped at 20
  "lease": {"holder":"runner@mac:4711","task":"review","sha":"a1b2c3d","expires":"…"},
  "runner": {                        // owned by the runner; Actions never writes here
    "rev": 9,
    "lastReviewedSha": "a1b2c3d", "baseShaAtReview": "9f8e7d6",
    "tier": "standard", "rounds": 2, "mode": "live",
    "filePatchHashes": {"src/foo.ts": "sha256:…"},
    "pending": null,                 // outbox marker, see Exactly-once posting
    "findings": [{
      "id": "F3", "fp": "sha256:…", "severity": "blocking",
      "path": "src/foo.ts", "line": 42,
      "anchor": {"sha":"a1b2c3d","hunkHash":"…","contextHash":"…"},
      "status": "open",              // open | fixed | wontfix | superseded
      "openedSha": "7c6b5a4", "resolvedSha": null, "resolvedBy": null
    }]
  },
  "actions": {                       // owned by Actions; the runner never writes here
    "rev": 8,
    "lastAuthorActivity": "…", "lastMaintainerResponse": "…", "lastReviewPosted": "…",
    "nudges": ["…48h", "…72h"], "claim": {"user":"…","expires":"…"}
  }
}
```

Encoding rules:
- Escape `--` inside JSON strings as `--` so a string cannot end the HTML comment early.
- Cap the size. GitHub comment bodies are limited to about 65,536 characters (MEDIUM confidence, community-known limit). Compact resolved findings to `{id, fp, status, resolvedSha}` after two rounds. Fail loudly above about 50 KB rather than truncating.
- **Only trust a ledger comment whose author is the App's bot user.** Contributors can paste a fake `warden:ledger` block into their own comment. The reader must filter by `user.login == "<app-slug>[bot]"` and `user.type == "Bot"`. If more than one App ledger exists, use the oldest and flag the others.

### Concurrency protocol

Three layers, cheapest first:

1. **Serialize within each side.**
   - Actions: every workflow that touches an item uses `concurrency: { group: warden-item-${{ github.event.issue.number || github.event.pull_request.number }}, cancel-in-progress: false, queue: max }`. Verified: with the default `queue: single`, an older pending run "is canceled and replaced". That would drop bookkeeping events, so set `queue: max` (up to 100 pending). Cron sweeps take a repo-wide group.
   - Runner: one OS-level lock file (`flock` in `$CLAUDE_PLUGIN_DATA/runner.lock`), so only one batch per machine.
2. **Writer-owned sections plus a lease.** The runner writes only `runner.*`, `lease`, `state` and `history`. Actions writes only `actions.*`, `state` and `history`. While a runner lease is live, Actions does not change `state`. It still stamps activity in `actions.*`, and the runner picks up the state change after the lease is released. This removes most overlap.
3. **Re-read before write, then verify after write.**

```ts
async function updateLedger(item, owner: "runner" | "actions", mutate: (section) => void) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const c1 = await gh.getLedgerComment(item);            // body + updated_at
    const doc = decode(c1.body);
    mutate(doc[owner]); doc[owner].rev++; doc.rev++;       // touch ONLY our section
    const c2 = await gh.getComment(c1.id);                 // re-read just before write
    if (c2.updated_at !== c1.updated_at) continue;         // someone wrote: start over
    await gh.patchComment(c1.id, encode(doc));
    await sleep(2000);                                     // verify after write
    const c3 = decode((await gh.getComment(c1.id)).body);
    if (c3[owner].rev >= doc[owner].rev) return c3;        // our write survived
    // a concurrent writer clobbered our section with a stale copy: loop and re-apply
  }
  throw new LedgerContention(item);                        // caller skips item, retries next batch
}
```

Verify-after-write works because each writer only checks *its own* section's `rev`. If the other side overwrote it with a stale copy, the loss shows up on the next read and gets re-applied. A lost write is detected and repaired, not silently dropped. Contention is rare, since both sides are mostly asleep and the lease removes most overlap, so a loop of four attempts is plenty.

### Issues get a ledger too

The PRD only requires a ledger per PR. The architecture should use the same `LedgerStore` for issues anyway: claim windows, triage session leases, nudge times, and `triage.lastTriagedAt` (so an issue is not re-triaged without new reporter activity) all need durable fields. Treat the issue ledger as the same component with a `kind: "issue"` schema variant.

### Exactly-once posting (outbox)

"Zero head-commit re-reviews" fails if the poster posts a review and then crashes before writing `lastReviewedSha`. Fix it with an outbox:

1. The runner saves `result.json` locally (`$CLAUDE_PLUGIN_DATA/outbox/<repo>/<item>/<sha>.json`).
2. The poster writes `runner.pending = {sha, resultHash, steps:["review","ledger","label"]}` to the ledger **before** posting.
3. Each posted artifact carries a hidden marker: `<!-- warden:review sha=a1b2c3d result=… -->`.
4. On resume, if `pending` is set, the poster checks whether a review with that marker exists, finishes the remaining steps from the saved result, and clears `pending`. **No AI is re-run.**

---

## AI Session vs Poster Split

### Credentials

- The runner mints **two installation tokens per batch** from the App private key in the macOS keychain or a 0600 file. Verified: the token request accepts `permissions` and `repositories` to down-scope, and "Installation tokens expire one hour from the time you create them".
  - **Read token**, down-scoped to `contents:read, issues:read, pull_requests:read, metadata:read, checks:read`. Used by the gatherer, and by the session only when the session must call `gh` itself (triage).
  - **Write token**, full App permissions. Exists only in the poster process's memory. Never in the session's environment, never on disk.
- Re-mint per batch, or when less than 10 minutes of validity remain. A batch can outlive one hour.
- **Never grant the App the `workflows` permission.** GitHub then rejects pushes that touch `.github/workflows/`. The "workflow changes need the maintainer" gate becomes a platform guarantee instead of a prompt instruction.

### Session invocation (headless)

```bash
env -i HOME="$HOME" PATH="$SAFE_PATH" USER="$USER" GH_TOKEN="$READ_TOKEN" WARDEN_SESSION=1 \
  claude -p "$(cat "$PACKET/prompt.md")" \
    --tools "Read,Grep,Glob" \                    # review: no Bash, no Edit, no Write
    --disallowedTools "mcp__*" \                  # unless memtrace enabled, then strict config below
    --strict-mcp-config --mcp-config "$PACKET/mcp.json" \
    --permission-mode dontAsk --permission-prompts none \
    --max-turns "$TURNS" --no-session-persistence \
    --output-format json --json-schema "$(cat schemas/review-result.json)" \
    --add-dir "$BASE_WORKTREE" \
  < /dev/null > "$PACKET/session.json"
```

Verified facts that drive these flags (code.claude.com CLI and headless docs):
- **Never use `--bare`.** "In bare mode, Claude Code never reads OAuth credentials or the system keychain", so it needs an API key, which ADR 0004 forbids. The docs also say `--bare` "will become the default for `-p` in a future release". The runner must pin the Claude Code version range it supports and fail preflight if a run comes back authenticated by anything other than the subscription.
- In `-p` mode, `ANTHROPIC_API_KEY` "is always used when present". Credentials that outrank the subscription: cloud-provider variables (`CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY`), `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`. **The preflight must refuse all of them, not only `ANTHROPIC_API_KEY`**, and it must scan settings files for `apiKeyHelper`. `env -i` adds defence in depth.
- Without `--bare`, a `-p` session "runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted". So the session's working directory is the packet directory (not a repo), and any repo directory it can see is a **base-branch** worktree only. Never a PR head.
- `--json-schema` puts the result in `structured_output`. The runner writes that to `result.json`. The session therefore needs no `Write` tool at all. The docs warn that the field is absent when the run fails, so treat "missing" as a failed item, not as an empty review.
- SIGTERM exits with 143 and leaves the turn unfinished. The wall-clock watchdog sends SIGINT first, then SIGTERM.

Tool profile by task:

| Task | Tools | GitHub token in session | Working dir |
|---|---|---|---|
| review (specialists, verifier) | Read, Grep, Glob (+ Memtrace `get_impact`, `recall_decision` if enabled) | none | packet dir + base worktree (read) |
| triage | the configured command's needs (Bash for `gh` reads, Read, Grep, Glob, Memtrace) | read-only | base worktree |
| implement / rework | Read, Grep, Glob, Edit, Write, Bash (scoped to test and preflight commands, `git` local ops) | none | dedicated worktree of base (or of the App's own bot branch for rework) |
| retro | Read, Grep, Glob | none | packet dir |

Plugin hook as defence in depth: `hooks/hooks.json` declares a `PreToolUse` guard that is active when `WARDEN_SESSION=1`. It denies `git push`, any `gh` subcommand that writes (`issue edit|comment|close`, `pr create|merge|review|comment`, `api -X POST|PATCH|PUT|DELETE`), and edits to `.github/workflows/**`, `REVIEW.md`, `MAINTAINERS`, and `warden.yml`. The read-only token already makes these writes fail. The hook makes them fail fast and leaves an audit trail.

### Implement and rework: who pushes

The session commits in its local worktree. The **poster** pushes the branch with the write token and opens the PR. The session never holds push credentials. The validator checks the commit range: no changes to protected paths, and the failing-first test commit precedes the fix commit (so ADR 0001's "test exists before any fix merges" is checked mechanically).

---

## Batch Runner Design

```
launchd (StartCalendarInterval slots + RunAtLoad)  or  /warden run
  └─ runner
     1. preflight      kill switch (repo variable via API + local ~/.warden/STOP file)
                       refuse if ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / cloud-provider vars / apiKeyHelper
                       claude + gh logged in; App key readable; supported Claude Code version
                       config loads and validates (base branch); acquire machine flock
     2. catch-up       compare last-run stamp to schedule; coalesce missed slots into one batch
     3. for task in config.batch.order (e.g. review → rework → triage → implement):
          queue = select(task)                              # GitHub labels + ledger filter
          for item in queue[:caps[task]]:
             kill switch re-checked;  daily/global caps checked
             lease = acquireLease(item, ttl = turnLimit × est + margin)   # ledger
             if not lease: continue
             packet = gather(item)                          # deterministic
             if packet.noop: release; continue              # head == lastReviewedSha, etc.
             result = runSessions(task, packet)             # fresh claude -p per session
             if session limit / rate-limit signal: stop batch cleanly
             validate(result) → post(result, sink)          # outbox, exactly-once
             releaseLease(item)
     4. write batch log (items, outcomes, turns, durations) → local + optional shadow report
```

Key behaviours:
- **One item per fresh session.** No context carries between items. This is the direct fix for `/review-open-prs` filling its context by PR 6–8.
- **Skip decisions are made before any AI runs.** `head == lastReviewedSha`, live lease, draft or `keep-open` exemptions, kill switch, caps. All of these are checked before the first `claude -p` call. The AI is never asked "has this changed?".
- **Throttles in config:** `batch.caps.{review,triage,rework}` per batch, `implement.perDay: 1`, `implement.maxOpenBotPRs: 1`, `turns.{task}`, `wallClock.{task}`. Also a minimum gap between batches, to leave session headroom for the maintainer.
- **Session-limit handling:** if the JSON result or stderr shows a usage or rate limit (`api_retry` with `error: rate_limit`, or an error result), stop the whole batch, release the lease, and do not mark the item failed. The next batch resumes from the ledger.
- **Lease TTL plus reclaim:** launchd can start a job in DarkWake and suspend it mid-item. An Apple engineer stated that launchd "doesn't guarantee anything about the power state". The lease expires and the next batch reclaims it. Because posting goes through the outbox, half-done items finish without re-running AI.
- **Scheduling (verified):** with `StartCalendarInterval`, "if the system is asleep, the job will be started the next time the computer wakes", with multiple missed events "coalesced into one". Slots missed while powered off are not run, which is why `RunAtLoad` and the runner's own catch-up stamp exist. Use a **LaunchAgent** in the user's `gui/<uid>` domain, not a LaunchDaemon, so keychain and `claude` OAuth are reachable.
- **Interactive `/warden`:** it calls the same runner functions in-process: `/warden run review --limit 3`, `/warden gate` (lists `pr:human-gate` cards locally), `/warden status` (bucket report and queues). Interactive mode is also where the triage lanes that need `AskUserQuestion` (enhancements and features) run.

---

## Delta Review

### Effective delta, not just commits

The naive `lastReviewedSha..head` breaks on force-pushes, rebases, and base merges into the PR branch. Verified: the compare API returns `status ∈ {ahead, behind, identical, diverged}` and caps at 300 files and 250 commits without pagination. It does not document what happens when a SHA is unreachable (404 or 422 are listed).

Algorithm (gatherer, deterministic):

1. `head == runner.lastReviewedSha` → **no-op** (PRD requirement 2).
2. Compute the PR's per-file patch against its *current* merge base (`git diff merge-base..head` in the bare mirror), and hash each file's normalized patch.
3. **Effective delta** = files whose patch hash differs from `runner.filePatchHashes`, plus files new to the PR.
   - Plain push (`compare` says `ahead`): this equals the commit delta.
   - Force-push or rebase (`diverged`, or 404 because the old SHA was garbage-collected): files whose PR-diff did not change are skipped, even though every commit SHA changed. That is exactly the "don't re-review" intent.
   - Base merged into the branch: upstream changes do not appear in the PR's own diff, so they are not reviewed.
4. If more than `review.fullRereviewThreshold` (for example 60%) of the PR's diff changed, or the merge base moved across a configured "breaking" path, escalate to a full review of the PR diff. Record `reason: "rewrite"` in the ledger.
5. The packet holds: effective-delta hunks (with surrounding context), the full PR file list for orientation, and every `open` finding with the current code at its relocated anchor.

### Finding re-check and stickiness

- **Re-check:** each open finding goes to the session with its original text and the current code at the relocated anchor (relocated by `hunkHash`, falling back to a `contextHash` search). The session returns `still-open | fixed | cannot-locate` per finding. `cannot-locate` sends the finding to the human gate. It is never auto-closed.
- **New findings only in the delta:** the validator drops any new finding whose location is outside the effective delta.
- **Dedupe:** fingerprint = hash(path, category, normalized flagged snippet). A new finding that matches an existing one becomes the same finding, not a new ID.
- **Won't-fix stickiness (PRD requirement 4):** when the maintainer marks a finding won't-fix, store `contextHash` = hash of the normalized ±N lines around the anchor. On later reviews it stays resolved unless its file is in the effective delta **and** the context hash at the relocated anchor differs. Only then does it reopen as a re-check candidate.
- **How the maintainer marks won't-fix:** a comment `/warden wontfix F5 [reason]` by a user listed in `maintainers`. The gatherer reads it at the next run. It is authorized by author login, never by comment content. Actions does not need to parse it, which keeps the findings section single-writer (runner only).

---

## Risk Tiers, Specialists, Verifier

```
deterministic gates (no AI)                 tier pick (no AI)              AI sessions
├ CI status (checks API)                    trivial: docs/tests only,      trivial:  1 light reviewer
├ mergeable / conflicts                       small diff                   standard: 1 reviewer → verifier
├ linked issue / template                   standard: default              full:     N specialists (path-routed,
├ protected paths touched →                 full: tier.full paths globs,             sequential sessions)
│   flag "needs maintainer"                   large diff, protected               → script merge + dedupe
├ size limits                                 paths, Memtrace --diff               → verifier
└ Memtrace --diff CI result (if on)           CI flagged risk
          │                                        │
          └──── any hard fail → pr.blocked ────────┴─► session plan (runner orchestrates)
```

- **The runner orchestrates specialists as separate `claude -p` sessions**, not as subagents inside one session. Each gets a fresh context, its own turn cap, and its own structured output. The merge and dedupe step is plain code. Subagents would share the parent's tool list and make per-specialist caps and outputs harder to enforce.
- **Specialists are config:** `specialists: [{name: security, paths: ["src/auth/**"], agent: security-reviewer}]`. Agent prompts ship in `agents/`. Repos can add their own by pointing at a base-branch file.
- **The verifier is always the last session.** Input: candidate findings plus code. Output: `confirmed | rejected(reason)` per finding. Only confirmed findings are posted. This is the main lever on the "7 in 10 blocking findings agreed" gate.
- **Memtrace (Decision 6)** is enabled only on the full tier, through `--strict-mcp-config` with a config listing just `get_impact` and `recall_decision`. When it is disabled or missing, those tools are simply absent and the plugin works fully.
- **One comment-only review per run:** the poster posts a single `event: COMMENT` review (inline comments plus summary) and updates the ledger. It never uses `APPROVE` or `REQUEST_CHANGES`, so the maintainer's own review stays the decisive one.

---

## Config Layering

```
config/defaults.yml (plugin, versioned)
   ⊕ .github/warden.yml   (read via API from the BASE branch @ default branch HEAD; never PR head)
   ⊕ ~/.warden/<owner>-<repo>.local.yml   (machine-only: schedule, isolation user, key path, caps override)
   → detect schemaVersion → migrate in memory (v1→v2→…) → validate (config/schema.json) → freeze → configHash
```

- **Merge semantics:** maps deep-merge; arrays *replace* (so a repo can shrink `specialists`); `null` deletes a default.
- **Schema version:** `schemaVersion: 1` is required in `warden.yml`. If it is *newer* than the plugin understands, **fail closed** ("upgrade the plugin"). If it is *older*, run the pure migration chain `migrations/0001-to-0002.ts` …, warn, and offer `/warden setup --migrate`, which writes the upgraded file **as a PR** (never a direct push: config changes are a maintainer gate). Every migration ships with a changelog note (ADR 0005).
- **Machine-local layer:** it keeps per-machine facts (schedule hours, separate macOS user, App key path) out of the repo, so two maintainers can share one `warden.yml`.
- **Actions read the same config through the same core library**, so the stale clocks the sweep enforces are the ones the runner reports (ADR 0002 "one clock").
- Record `configHash` in each batch log and the ledger `history` entry, so "why did it do that?" can be answered later.

---

## Recommended Project Structure

```
warden-of-the-gate/
├── .claude-plugin/
│   └── plugin.json            # name: warden-of-the-gate, version, userConfig (app id, key path: sensitive)
├── skills/                    # preferred over commands/ for new plugins (verified)
│   ├── warden/SKILL.md        # /warden entry: run | gate | status | setup | report | stop
│   ├── warden-review/SKILL.md # prompt contract for review sessions (reads packet, emits schema)
│   ├── warden-implement/SKILL.md
│   ├── warden-rework/SKILL.md
│   ├── warden-triage/SKILL.md # thin wrapper: invokes configured triage.command for ONE issue
│   └── warden-retro/SKILL.md
├── agents/                    # specialist + verifier prompts (namespaced warden-of-the-gate:*)
│   ├── reviewer.md  verifier.md  security-reviewer.md  tests-reviewer.md  docs-reviewer.md
├── hooks/hooks.json           # PreToolUse write-guard, active when WARDEN_SESSION=1
├── core/                      # warden-core library (language per STACK.md)
│   ├── config/  state/  ledger/  github/  delta/  tier/  stale/  fingerprint/
├── scripts/                   # entry points (no AI)
│   ├── runner  gather  post  setup  bucket-report  launchd-install
├── actions/                   # Actions entry points calling core (JS or composite actions)
│   ├── intake/action.yml  claim/action.yml  sweep/action.yml
├── workflow-templates/        # copied into adopting repo by setup; `uses: …/actions/<x>@<sha>`
│   ├── warden-intake.yml  warden-claim.yml  warden-sweep.yml
├── schemas/                   # result schemas for --json-schema + ledger schema
│   ├── review-result.json  triage-result.json  implement-result.json  ledger-v1.json
├── config/
│   ├── defaults.yml  schema.json
├── migrations/                # pure config migrations vN→vN+1
├── launchd/com.artificer.warden.plist.tmpl
├── examples/gsd-core.yml      # first real config
├── docs/                      # adoption how-to, isolation (separate macOS user), threat model
├── test/fixtures/             # recorded GitHub API payloads, ledger docs, diffs
└── CHANGELOG.md
```

### Structure rationale

- **`core/` is shared by `scripts/` and `actions/`.** One implementation of the state machine, ledger and clocks for both runtimes. Duplicating rules in YAML workflow `if:` expressions is how two "stale clocks" disagree again.
- **Workflow templates `uses:` actions from this repo pinned by SHA.** Adopters copy about 20 lines of YAML, and upgrades are one SHA bump. Bookkeeping logic is not pasted into every repo.
- **Skills hold prompt contracts; scripts hold logic.** A skill tells Claude what the packet looks like and what to emit. It never decides state.
- **State never goes in `${CLAUDE_PLUGIN_ROOT}`.** It "changes when the plugin updates". Local state (outbox, results cache, shadow ledger, locks, logs) goes in `${CLAUDE_PLUGIN_DATA}`, which is "kept across plugin updates". Note that `--keep-data` matters on uninstall.
- **`bin/` is deliberately absent.** Files in `bin/` land on the Bash tool's PATH in every session, including headless review sessions. The scripts are called by the runner with absolute paths instead.

---

## The Eight Tasks Mapped onto Components

| Task | Runs | Trigger | Reads | AI? | Writes (via) | States in → out |
|---|---|---|---|---|---|---|
| **Intake** | Actions | issue/PR opened | template, duplicate search | no | label, empty ledger, template-gap comment (core GitHub client) | (none) → `issue.new` / `pr.new` |
| **Triage** | runner, 1 issue per session | queue `issue.new` (+ reporter replies on `needs-repro`) | issue thread, base worktree | yes: configured command (`/triage-review --issue N`) | diagnosis comment, labels, issue ledger (poster) | `new` → `confirmed` / `needs-repro` / `waiting-reporter` / `awaiting-maintainer` |
| **Claim** | Actions | `issues: labeled confirmed/approved`, `issue_comment`, sweep cron | comments, issue ledger | no | label, claim comment, ledger `actions.claim` | `confirmed`/`approved` → `claim-offered` → `claimed` / `ready` |
| **Implement** | runner, ≤ 1/day, ≤ 1 open bot PR | queue `issue.ready` | issue, diagnosis, base worktree | yes | branch push + PR with Merge Danger (poster) | `ready` → `pr-open`; new PR → `pr.new` |
| **Review** | runner | queue `pr.new`, `pr.needs-rereview` (non-bot and bot) | packet (delta, findings, rules from base) | yes: tiered + verifier | comment-only review, ledger, label (poster; ShadowSink in shadow) | → `changes-requested` / `blocked` / `human-gate` |
| **Rework** | runner | queue `pr.changes-requested` where author = App, rounds < 3 | findings, bot branch worktree | yes | push to own branch (poster) | → `needs-rereview` (via synchronize); round 3 → `human-gate` |
| **Sweep** | Actions cron + `synchronize` | schedule | ledgers, timelines, config clocks | no | nudges (voice header), closes, label repair, metrics artifact | `changes-requested`/`blocked` → closed; `claimed` → `ready`; push → `needs-rereview` |
| **Retro** | runner, weekly | schedule | the maintainer's review comments since last retro, `REVIEW.md` | yes | PR to `REVIEW.md` or lint config (poster) | n/a (the PR enters `pr.human-gate` directly) |

### Triage adapter: a conflict to resolve in the Triage phase

Reading the existing `~/.claude/commands/triage-review.md` (1,302 lines) shows it is **not** headless-safe as is:
- It is designed as a batch sweep over every open `needs-triage` issue. It does support `--issue N`, `--dry-run` and `--limit N`.
- It writes to the tracker directly (`gh issue edit --add-label confirmed-bug`, `gh issue comment`, `gh issue close`, `gh pr create`).
- Its enhancement and feature lanes require `AskUserQuestion`, which `--permission-prompts none` removes in headless runs.
- Its flow ends with "ship queued `.out-of-scope/` entries as one PR **and merge it**", which violates "never merges".

"Reused unchanged" (ADR 0001) is still achievable through a wrapper contract:
1. Headless runs pass `--issue N --dry-run` with the **read-only token**. Writes fail even if the dry-run is ignored, and the hook guard denies them first.
2. The adapter takes the outcome from the command's own artifacts (`.gsd/triage/20-diagnosis/<N>.md`, `30-decisions.json`, the dry-run plan) and maps them to a `triage-result.json`. The poster then applies labels and the diagnosis comment.
3. Defect and needs-repro lanes run headless. Enhancement and feature lanes stop at `issue.awaiting-maintainer` and are finished **interactively** in `/warden gate`, where `AskUserQuestion` works.
4. The out-of-scope PR step is skipped in headless mode. If produced interactively, it goes to the human gate like any other PR.

The artifact formats are command-specific. The adapter needs a per-command mapping (`triage.resultAdapter: gsd-triage-review`), and other repos get a simpler "parse structured output" adapter. **Flag for phase research.**

### Second conflict: continuing from the author's branch

PRD requirement 18 says that when a defect PR goes stale, "the next person continues from the author's branch". When the plugin is that next person, it would check out and run (in tests) contributor code from a fork. That contradicts requirement 12 and the ADR 0004 threat model. Recommendation: in v1 the plugin never continues a fork branch automatically. The issue returns to `ready` with a facet label `has-prior-attempt`. The plugin implements fresh from base and credits the author with `Co-authored-by` only if the maintainer applies `continue-from-author`, which acts as a gate that the author's diff was reviewed. **Needs an owner decision.**

---

## Data Flow

### Review (live)

```
author pushes ─► Actions(synchronize): label → pr.needs-rereview; ledger.actions.lastAuthorActivity
                                         │
launchd slot ─► runner preflight ─► select(review): label query ─► ledger filter (head≠lastReviewedSha, no lease)
                                         │
                 acquire lease ─► gather: bare mirror fetch refs/pull/N/head (no checkout)
                                  effective delta, open findings@anchors, REVIEW.md@base, CI, tier
                                         │ packet/
                 claude -p (specialists…) ─► merge/dedupe (script) ─► claude -p (verifier)
                                         │ result.json (structured_output)
                 validate ─► outbox ─► poster(GitHubSink, write token):
                                  1 ledger.pending  2 COMMENT review (voice header, marker)
                                  3 ledger: lastReviewedSha, patch hashes, findings, rounds  4 label
                                         │
                 release lease ─► next item
```

Shadow mode is the same pipeline with `ShadowSink`. Ledger writes go to `LocalLedger` (`$CLAUDE_PLUGIN_DATA/shadow/<repo>/<pr>.json`) and the review goes to `shadow-report.md`. **No GitHub writes.** The zero-re-review check works in shadow because the local ledger has the same schema.

### Issue lifecycle

```
opened ─A─► issue.new ─R(triage)─► confirmed ─A(claim)─► ready ─R(implement)─► pr-open ─► (bot PR enters review flow)
                         ├─R─► needs-repro ─A(14d)─► closed
                         └─R─► awaiting-maintainer ─M─► approved ─A─► ready …   or ─M─► wontfix
```

### Key data flows

1. **State flows one way through labels.** Actions and the poster write labels. Queue selectors read them. Nothing else infers state.
2. **Credentials flow one way.** The write token lives only in the poster (local) and the Actions secret. The read token lives in the gatherer and, for triage, the session. The App key never leaves the keychain or key file.
3. **Rules flow from base only.** `warden.yml`, `REVIEW.md`, specialist overrides and `MAINTAINERS` are read at the base branch HEAD, never from the PR.
4. **Results flow through files.** Session → `structured_output` → `result.json` → validator → outbox → poster. Every step can be inspected and replayed.

---

## Suggested Build Order (matches PRD rollout)

| Stage | Components needed (new in this stage) | Why here | Gate evidence it must produce |
|---|---|---|---|
| **1. Foundation** | warden-core: config (defaults, schema, migrations scaffold, `examples/gsd-core.yml`), state machine table, GitHub client (App auth, token minting, serial writes), ledger codec + `GitHubLedger` + `LocalLedger` + concurrency protocol; `/warden setup` (labels, starter config); **intake** and **sweep** workflows (issue stale clocks, label reconcile, metrics; PR nudges only where a maintainer responded); kill switch in workflows; bucket report; runner skeleton with preflight guards (API-key refusal, kill switch, lock) **switched off** | Everything else depends on state, ledger, config, and auth. The two bookkeeping workflows give value immediately and need no AI. | Bucket report matches the maintainer's sense of the backlog |
| **2. Review shadow** | gatherer (bare mirror, no checkout), effective-delta engine, tiering, packet builder, review and verifier skills/agents, result schemas, validator, `ShadowSink`, runner batch loop (caps, turns, wall clock, lease, catch-up), launchd install, outbox | Riskiest AI path, but it has no external blast radius. It proves "zero re-review" and finding quality locally. | ≥ 7/10 blocking findings agreed; zero head re-reviews (from batch logs) |
| **3. Review live** | `GitHubSink` poster (comment review, ledger, labels), voice header, decision card rendering, `/warden gate`, `/warden wontfix` command parsing, sweep PR stale-close (needs "review posted" facts), `synchronize` → needs-rereview flip | Swapping the sink is the only change. The pipeline is already proven. | Maintainer minutes/PR down; contributor confusion check |
| **4. Triage** | triage adapter (configured command, `--issue N --dry-run`, read-only token, artifact mapping), issue ledger, interactive lanes in `/warden gate`, **claim** workflow | Needs the poster and gate from stage 3. Claim only matters once triage confirms bugs. | 9/10 labelled as the maintainer would |
| **5. Implement** | worktree manager, implement and rework skills, preflight runner (configured test commands), commit-range validator (test-first, protected paths), poster push + PR + Merge Danger, throttles (1/day, 1 open bot PR), rework rounds → human gate | Needs `ready` issues (stage 4) and the review loop (stage 3) to review its own PRs. | Bot PRs merge after a quick look more often than they bounce |
| **6. Retro** | maintainer-comment collector, retro skill, rules PR via poster | Needs a body of maintainer review comments produced by stages 3–5. | Weekly rules PR lands |

Dependency notes for the roadmap:
- **Ledger concurrency must be built and tested in Foundation**, even though only Actions writes then. Retrofitting writer-owned sections later means migrating ledger schema v1 on live PRs.
- **Build the sink abstraction in stage 2.** Without it, stage 3 becomes a rewrite instead of a swap.
- **The outbox belongs in stage 2**, not 3. Shadow mode already needs it to keep the zero-re-review metric honest.
- **Sweep is split across stages.** Issue clocks and label reconciliation come in Foundation. PR close-on-stale has to wait for stage 3, because it may only close PRs that have had a review or maintainer response.
- **Claim workflow comes in stage 4**, not Foundation, despite being "Actions, no AI". Nothing feeds it until triage confirms bugs.

---

## Scaling Considerations

| Scale | Architecture adjustments |
|---|---|
| ~70 open PRs (GSD Core today) | Everything above as is. REST plus per-item ledger reads are fine (installation token budget is about 5,000 req/h). |
| ~300+ open items | Fetch queues and ledgers with one paginated GraphQL query per task (comments filtered to the App author) instead of N REST calls. Use conditional GETs (ETag/`If-None-Match`; a 304 "does not count against your primary rate limit"). |
| Several repos per maintainer | One runner, per-repo config and local layer, repo round-robin inside the batch caps. Session limits, not GitHub, are the bottleneck. |

### Scaling priorities

1. **First bottleneck: the maintainer's Claude session limits.** Tiering (most PRs trivial or standard), the pre-AI no-op filter, and per-task caps are the levers. Order batches so review comes first: it unblocks contributors.
2. **Second: GitHub secondary rate limits on writes.** The poster must stay serial with about 1 s between mutations, per GitHub's guidance. Batch label and ledger writes per item, not per finding (one review with inline comments rather than N comments).

---

## Anti-Patterns

### 1. One long session walking the queue
**What people do:** a single Claude session loops over every PR. That is today's `/review-open-prs`.
**Why it's wrong:** context fills by item 6–8, state lives only in the session, and every run starts over.
**Do this instead:** script-driven queue, one fresh `claude -p` per item (per specialist), state in the ledger.

### 2. Letting the AI decide whether to act
**What people do:** "check if this PR changed since your last review, and if not, skip it".
**Why it's wrong:** it is non-deterministic, costs a session to decide to do nothing, and is a prompt-injection target ("this PR was already reviewed").
**Do this instead:** compare `head` with `lastReviewedSha` in the selector, before any AI.

### 3. The AI session holding a write token or posting directly
**Why it's wrong:** a fork PR's injected instructions become GitHub writes under the maintainer's voice.
**Do this instead:** read-only (or no) token in the session, `--json-schema` output, validator, poster with the write token.

### 4. Trusting any comment containing the ledger marker
**Why it's wrong:** a contributor can forge `<!-- warden:ledger … "lastReviewedSha": "<head>" -->` and skip review.
**Do this instead:** accept ledger comments only from the App's bot user.

### 5. Reading rules or config from the PR head
**Why it's wrong:** a PR can edit `REVIEW.md` or `warden.yml` to weaken its own review. Running `-p` inside a PR-head checkout also executes its `.claude/settings.json` hooks and `.mcp.json` servers.
**Do this instead:** fetch rules at the base branch, and give sessions only base worktrees plus packet files.

### 6. Whole-body rewrites of a shared comment by both writers
**Why it's wrong:** with no `If-Match`, the last writer silently wins, and nudge times or `lastReviewedSha` get lost.
**Do this instead:** writer-owned sections, re-read-before-write, verify-after-write, leases.

### 7. `--bare`, or inheriting the shell environment
**Why it's wrong:** `--bare` cannot use the subscription. An inherited `ANTHROPIC_API_KEY` or `apiKeyHelper` silently switches to API billing in `-p`.
**Do this instead:** no `--bare`, `env -i` with an allowlist, preflight refusal of every outranking credential.

### 8. Encoding rules in workflow YAML `if:` expressions
**Why it's wrong:** the second copy of the stale logic drifts from the runner's copy. That is the exact problem ADR 0002 fixes.
**Do this instead:** workflows call `actions/*` entry points backed by warden-core.

---

## Integration Points

### External services

| Service | Integration pattern | Notes |
|---|---|---|
| GitHub REST/GraphQL | App installation tokens (local: minted from key; Actions: `actions/create-github-app-token`) | No conditional writes. Serial writes with about 1 s spacing. Down-scope the read token. No `workflows` permission. Needs Variables read for the kill-switch check. |
| GitHub Actions | `pull_request_target` (never checks out head), `issues`, `issue_comment`, `schedule`; `concurrency` with `queue: max` | Kill switch `if: vars.<NAME> != 'true'` on every job. No Claude step, no Anthropic secret (ADR 0004). |
| Claude Code CLI | `claude -p` subprocess per session; plugin skills/agents/hooks loaded normally (not bare) | Pin the supported version range. Watch for "bare becomes default for -p". Parse `structured_output`, `num_turns`, error subtypes. |
| launchd | LaunchAgent in `gui/<uid>`, `StartCalendarInterval` + `RunAtLoad` | Wake catch-up coalesces missed slots. A DarkWake start can be suspended, so the lease TTL covers it. |
| Memtrace (optional) | `--strict-mcp-config` with only `get_impact` and `recall_decision`, full tier only | The plugin says "install Memtrace". It never redistributes skills (licence). |
| Configured triage command | Adapter: `--issue N --dry-run` + artifact mapping | See the conflict section. Needs per-command mapping. |
| Repo test/preflight commands | Run in the implement and rework worktree only | Never against fork code. |

### Internal boundaries

| Boundary | Communication | Notes |
|---|---|---|
| runner ↔ AI session | files in (packet), JSON out (`structured_output`) | The only AI boundary. Version the schemas. |
| validator ↔ poster | in-process; outbox file on disk | Outbox makes posting resumable. |
| runner ↔ Actions | **only via GitHub state** (labels plus ledger sections) | No direct channel. Leases are the courtesy protocol. |
| poster ↔ sink | `Sink` interface (`postReview`, `setState`, `writeLedger`, `pushBranch`, `openPR`) | GitHub, Shadow, and DryRun implementations. |
| core ↔ entry points | library calls | The same code is used locally and in Actions. |

---

## Gaps (for roadmap and phase research)

- **Buckets A–F are not defined** in the PRD, PROJECT, or ADRs. The Foundation gate depends on them. Define them in Foundation discussion. A likely set: never-reviewed, reviewed-waiting-author, waiting-maintainer, stale-candidate, bot, blocked.
- **Triage adapter details** (artifact mapping, dry-run fidelity, interactive lanes). Needs phase research against the real command.
- **Continue-from-author vs. never-run-fork-code** needs an owner decision.
- **Separate macOS user isolation:** a LaunchAgent for another user needs that user's GUI session (or a keychain-less credential path) for `claude` OAuth. Not verified; phase research.
- **The comment size limit (about 65,536 chars)** comes from community knowledge, not a documented citation. Verify in Foundation tests.
- **How `head_ref_force_pushed` timeline events are shaped** was not verified. The effective-delta design deliberately does not depend on it.
- **Which Claude Code result fields signal "usage limit reached"** on subscription auth needs an empirical check in stage 2.

## Sources

- Claude Code plugin manifest and layout: https://code.claude.com/docs/en/plugins-reference (`CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`, standard layout, `skills/` preferred, `bin/` on PATH). Seam tier LOW (webfetch); official vendor doc.
- Claude Code CLI flags: https://code.claude.com/docs/en/cli-reference (`--tools`, `--disallowedTools`, `--strict-mcp-config`, `--max-turns`, `--json-schema`, `--permission-mode`, `--bare`).
- Headless mode: https://code.claude.com/docs/en/headless (bare mode skips OAuth; bare to become default; `-p` runs project hooks and `.mcp.json` without trust; `structured_output`; SIGTERM 143; `--permission-prompts none`).
- Authentication precedence: https://code.claude.com/docs/en/authentication (`ANTHROPIC_API_KEY` "always used when present" in `-p`; full precedence list).
- GitHub REST best practices: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api (no conditional writes; serial requests; 1 s between mutations; 304 is free).
- GitHub compare commits: https://docs.github.com/en/rest/commits/commits#compare-two-commits (status enum, 300-file and 250-commit limits).
- GitHub App installation tokens: https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app (down-scoping via `permissions`/`repositories`; 1 h expiry).
- GitHub Actions concurrency: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs (`queue: single` cancels older pending; `queue: max`).
- launchd scheduling: https://developer.apple.com/library/mac/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html and https://developer.apple.com/forums/thread/815034 (run on wake, coalescing; no power-state guarantee). Seam tier MEDIUM (verified search).
- CodeRabbit incremental review behaviour (prior art for delta review): https://docs.coderabbit.ai/configuration/auto-review. LOW; hidden-state mechanism unconfirmed.
- Local primary source: `~/.claude/commands/triage-review.md` (read directly; the adapter conflict evidence).
- Project sources: `.planning/PROJECT.md`, `docs/prd/0001-warden-of-the-gate.md`, `docs/adr/0001`–`0005`.

---
*Architecture research for: AI-assisted GitHub repo maintainer (Claude Code plugin + Actions bookkeeping)*
*Researched: 2026-11-10*
