# Warden of the Gate quickstart (release candidate 0.1.0-p4)

Warden is one instance per repository. Deterministic housekeeping runs through one serialized writer; model-backed work (review, triage, implement, rework) runs by hand on a prepared Mac with a local model. **Nothing in this candidate activates itself.** Shadow mode never posts an AI review and never merges; live activation is a separate, explicit step that this release does not include.

Legend: **[verified]** means exercised in this repository by an automated test or recorded evidence; **[owner]** means a GitHub or machine action only the repository owner can take; **[not verified]** means documented from the design but not exercised end to end here.

## 0. What you need

| Need | Detail |
|---|---|
| Node | `>= 26` **[verified]** (`engines`; the example workflows and `warden setup` enforce it) |
| Mac for model work | macOS with Seatbelt (`sandbox-exec`); tested on macOS 27 only. Model-backed tasks refuse to start without a verified boundary **[verified]** |
| OpenCode | any 2.x release from `2.2.7` up (`>=2.2.7 <3.0.0`, ADR 0004); 1.x and 3.x are refused, and each run records the version it used. The P0 proofs ran on 2.2.7 only **[verified for 2.2.7]** |
| Local model | served on loopback by a local OpenAI-compatible server, mlx-serve (default `http://127.0.0.1:11234/v1`; `--model-url` overrides). `--context-limit N` is required with `--runner opencode`: give the context window the model is loaded with on the server; Warden refuses the run rather than guess one (`--output-limit N`, default 32768, must be smaller); a non-loopback provider, or a resolved model that is not a configured local one, is refused. There is no hosted fallback **[verified]** |
| GitHub | a repository you own; a GitHub App with `issues: write`, `metadata: read` and `actions: read` installed only on it **[owner]** |

## 1. Install the candidate (unpublished)

```bash
cd packages/warden && npm ci && npm run build && npm test     # no network or credentials needed
npm run verify-install                                          # packs it, installs it in an empty project, drives the INSTALLED executable [verified, 22/22]
```

The package is `@taoc/warden` (private; nothing is published, tagged or activated). Use the tarball that `npm pack` produces, or run `node packages/warden/dist/cli.js`.

## 2. Create configuration (explicit, never overwritten)

```bash
warden setup --create-config --repo OWNER/REPO --maintainers you,teammate --create-orders --create-labels
warden config validate --show-effective
```

Edit `.github/warden.yml` on the **default branch** (a pull request can never change the policy that judges it). When `--repo-dir` is a git checkout, every command that acts (`run`, `writer`, `status`, `approvals`, `stop`/`resume`, `credentials`) reads `warden.yml` and `ORDERS.yaml` from the commit at `origin/HEAD`, the default branch as `git clone` records it, never from the working tree. So a checked-out pull request, or an edit you have not merged, is not in force until it is on the default branch; `warden status` says which policy commit is in force and lists any policy file whose working copy differs. Without `origin/HEAD` (run `git remote set-head origin --auto`), pass `--trusted-ref REF` or set `WARDEN_TRUSTED_REF`; Warden refuses rather than fall back to the working tree. `setup` and `config validate` still read the working tree, so you can check an edit before you commit it. A pull request that changes these files, a workflow or another human-gate path always gets a full review and a maintainer decision:

- `merge.factoryLogins`: the login that owns factory work (needed for Implement/Rework); `merge.automationLogins`: verified bots such as `dependabot[bot]`; identities are by login, never by label.
- `verify.checks`: your repository's own checks, run by the trusted executor inside the boundary (for example `{id: unit, kind: test, command: node, args: [--test]}`). Without checks Implement and Rework refuse, because no evidence is possible.
- `drafts.allowed` (default false): drafts are closed with an explanation and a way back.
- `gates`: `blocker` is always on; `major`, `minor`, `nit` follow your choice. Orders in `.github/ORDERS.yaml` start narrow: with none, every merge goes to a maintainer **[verified]**.

## 3. Connect GitHub (protected, owner-only)

Create the App and install it on this repository only, store its key outside the repository (directory mode 0700, key mode 0600), then:

```bash
warden credentials configure --confirm --app-id N --installation-id N --app-login LOGIN --key-path /path/to/key.pem
warden credentials status
```

The key is never committed, printed or typed into a field. If it is revoked, `warden credentials ack-revocation --confirm` records it and recovery is the provider-supported path for the App; Warden never falls back to a broader token **[owner; controller behavior verified against a disposable sandbox App]**.

## 4. Look before you touch anything

```bash
warden status
warden run --task intake --dry-run      # proposes transitions through a read-only store: no repository mutation
warden run --task sweep  --dry-run
warden adopt --dry-run --out inventory.json   # lists existing items without Warden state; adopts nothing
```

`--dry-run` is the per-command guarantee. **Shadow mode** (the default `mode`) is the instance-wide default: AI results stay local, nothing is posted or merged. A global dry-run control (the shared stop/dry-run issue) additionally blocks the writer from applying anything.

## 5. Adopt existing work deliberately

```bash
warden adopt --selection selection.json --confirm
warden writer drain
```

Only the selected items get Warden state. Existing owners are kept, new clocks start at the published adoption notice (never at a historical date), an existing draft needs an explicit `keep` or `close`, and nothing is closed for age. The inventory and the receipt are records, not a second ledger **[verified; the adopt syntax is proposed in PRD section 10 and awaits owner review]**.

## 6. New work flows in through events

Review the example workflows in `packages/warden/templates/workflows/` (`warden-events`, `warden-writer`, `warden-sweep`). They are inert `.example` files. Copy them into `.github/workflows/` only after you have read them: they check out the default branch only, run no lifecycle scripts, and give the writer its own identity and a single-flight concurrency group **[verified: parse and safety invariants]**.

- `issues` / `pull_request` events become intake intents; a draft PR is closed by policy; a blocking review starts the author's 48-hour fix window; a `/warden claim` comment becomes a verified claim for that commenter only; `/warden release`, `/warden hold <reason>`, `/warden release-hold`, `/warden approve|deny`, `/warden override` and `/warden resume-scope` are the maintainer commands **[verified against the simulated GitHub]**.
- **The sweep is started from outside GitHub's schedule service.** GitHub runs `schedule` triggers on a best-effort basis: they can be hours late, and under load some are dropped. So the sweep example's primary trigger is `workflow_dispatch`, started on a timer by a scheduler you run; its `schedule` trigger is commented out and is only an optional backup ([ADR 0026](adr/0026-external-dispatch-for-sweep.md)). Sweeps are idempotent: a late run does the overdue work, a dropped run is covered by the next one and a duplicate run changes nothing **[verified against the simulated GitHub]**. `warden status` shows the last completed sweep. Run it by hand with `warden run --task sweep`, or set up the timer below. Scheduling is never an exact-deadline guarantee.
- **Timer on the Mac (launchd).** A LaunchAgent runs `gh workflow run` with your own GitHub CLI login, which needs write access to the repository; Warden adds no token or App permission for it. Find the full path of `gh` (launchd does not use your shell's `PATH`):

  ```zsh
  command -v gh
  ```

  Save this as `~/Library/LaunchAgents/org.taoc.warden-sweep.plist`, with that path in place of `/opt/homebrew/bin/gh` and your repository in place of `OWNER/REPO`. It asks for a sweep at minute 17 of every fourth hour, local time, matching the commented backup schedule:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>org.taoc.warden-sweep</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/gh</string><string>workflow</string><string>run</string>
      <string>warden-sweep.yml</string><string>--repo</string><string>OWNER/REPO</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
      <dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>17</integer></dict>
      <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>17</integer></dict>
      <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>17</integer></dict>
      <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>17</integer></dict>
      <dict><key>Hour</key><integer>16</integer><key>Minute</key><integer>17</integer></dict>
      <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>17</integer></dict>
    </array>
    <key>StandardOutPath</key><string>/tmp/warden-sweep.log</string>
    <key>StandardErrorPath</key><string>/tmp/warden-sweep.log</string>
  </dict>
  </plist>
  ```

  Load it, start one sweep now to check it works, and look for the run:

  ```zsh
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.taoc.warden-sweep.plist
  launchctl kickstart gui/$(id -u)/org.taoc.warden-sweep
  gh run list --workflow warden-sweep.yml --repo OWNER/REPO --limit 3
  ```

  `launchctl bootout gui/$(id -u)/org.taoc.warden-sweep` removes it. If the Mac is asleep at a scheduled time, launchd starts the job when it wakes, coalescing missed times into one run; if the Mac is off, the job waits for its next time ([Apple, Scheduling Timed Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)). For sweeps while the Mac is off, run the same `gh workflow run` call from an always-on host, or turn on the backup `schedule` (off the top of the hour, and never relied on) **[documented; not yet run against a live repository]**.

- **Discord cards** (notifications only): `warden discord sync --channel ID [--dry-run]` posts one card per pending approval and edits it in place when the approval resolves on GitHub. A card shows the exact `/warden approve ...` command and a link button; it has no approve or deny control, mentions are disabled, and nothing done in Discord can record a decision, because decisions are accepted only from a verified maintainer comment on GitHub. The bot token comes from `WARDEN_DISCORD_TOKEN` and is never printed or stored **[verified against a fake gateway and a stubbed REST client, and once live on 2026-11-18: one card posted to a private channel and edited in place, turning green, when its approval resolved]** **[owner: create the Discord application, channel and token]**.

## 7. Model-backed shadow work (on the Mac)

```bash
warden run --task triage --item 12 --runner opencode --context-limit N      # one issue: a draft proposal card, nothing posted
warden run --task triage --runner opencode --context-limit N                # bounded scan of tracked issues awaiting triage: finite items and wall time, then exit
warden run --task review --item 34 --runner opencode --context-limit N      # one PR: read-only, bound to one head
warden run --task review --runner opencode --context-limit N                # bounded scan: finite items and wall time, then exit
```

- Preflight refuses on stop, an unverified boundary, a non-local model, an unconfirmed context window or an unavailable endpoint. A review is rejected whole if the head moved, a finding is outside the PR, or the result is malformed; attempts persist (3 by default) and a restart does not reset them. Unchanged heads and checks reuse the accepted review with no model call. A patch too large for the local reviewer is refused with a "split it" message instead of being half reviewed **[verified live on a disposable sandbox PR; model quality is not established]**.
- **Implement / Rework** (factory): `warden run --task implement --item N --runner opencode --context-limit N` works from a trusted checkout of the default-branch tip, lets the model edit files only inside that workspace with no shell, runs your checks in the boundary, and requires fail-before/pass-after evidence for a bug. Weakened gates, edits to workflow/access/orders paths and oversize diffs are refused. The result goes to a **local outbox** branch; opening a real PR needs contents and pull-request write permission that the App ceiling in step 3 does not grant, and granting it is an explicit owner action. A GitHub publisher exists behind `--publisher github --push-remote ...` (factory `warden/*` branches only, fast-forward pushes, always a draft PR, tip must equal the verified commit); it is **[verified against the simulated GitHub and real git; never run against GitHub]** and `--push-remote github` publishes to THIS repository with an App-issued credential limited to contents and pull-request write, available only after the owner raises the protected ceiling to include those two permissions (the default ceiling still refuses) **[verified with a fake issuer, and live on the disposable sandbox on 2026-11-18: a draft PR on a `warden/*` branch whose tip GitHub reported as the verified commit; see the handoff for the shortcuts used]** **[owner: grant the permissions on the App and approve the ceiling]**.
- **Merge** exists only in live mode, bound to the head that was reviewed, and only after eligibility: blocker always gates, risk is assessed separately from severity, high or uncertain risk and workflow/access/orders edits need a maintainer, and required independent approvals are never bypassed. Enqueueing is not merging; GitHub must confirm before the ledger says merged **[verified against the simulated GitHub]**.

- **Retro** (manual, local): `warden run --task retro [--window-days 30] [--runner opencode --context-limit N] [--source REPO_PATH]` gathers this instance's own decisions, denials, critical escapes and review/triage/implement/rework outcomes, and asks the local model for NARROW proposals (design change first, then a static check, a test, and only then a rule). Every proposal must cite evidence ids; "no change is justified" is a valid answer, and with no evidence no model is called. A proposal that would expand authority is only text for a maintainer and, if it touches an action that was denied before, must cite the old ruling and newer evidence. Nothing is applied, merged or trained on; with `--source` the report is prepared as a `warden/retro-DATE` branch in the local outbox **[verified with a fake model; not run with the real model]**.

- **Replay and qualification** (P7): `warden replay --set FILE [--runner opencode --context-limit N]` replays a maintainer-curated set of PRs and issues in a SIMULATED repository against the local model and reports recall, false-positive rate, accepted rate and triage accuracy with a qualification verdict. A synthetic set (`fixtures/replay/synthetic.json` is a demo) or a set with fewer than 20 PRs and 20 issues can never qualify, and the command never activates anything **[verified with a scripted model; not run with the real model]**.

## 8. Stop, resume and recover

```bash
warden stop --reason "why"            # local first, then shared; unconfirmed remote stop is reported as unconfirmed
warden resume --confirm                # starts nothing, resets nothing
warden journal reconcile               # re-submit or adopt durable local intents; never acts as the writer
warden status                          # pending/uncertain operations, credentials, stop acknowledgements
```

A critical escape pauses the affected item; only notes and a source-verified `/warden resume-scope <reason>` are accepted until a maintainer resumes it **[verified]**.

## 9. Your data

```bash
warden data status
warden data export --scope reviews,triage --out export.json --confirm
warden data purge --scope transcripts --confirm        # only what is past retention (30 days by default)
```

Scopes are explicit; credentials are never exported; decisions are kept until you remove them with `--include-decisions`; pending recovery items are never purged; each action writes a receipt **[verified]**.

## 10. Upgrades and rollback

`warden upgrade --dry-run` lists behavior, config, schema and default changes since the instance was created and fails with an actionable message for unknown, newer or unsupported-schema situations. There is no apply path and no migration engine in this candidate. To roll back, reinstall the previous tarball: configuration and ledgers are plain files and GitHub comments, and `warden config validate` tells you if the older version cannot read them **[dry-run verified]**.

## What this release does not include

Discord live operation (the owner creates the Discord application and channel and supplies a bot token; the cards themselves are built, see section 6); a published package; a live GitHub publisher for factory PRs (the publisher is built and tested against the simulation, but needs an owner-granted contents and pull-request write permission and a publish credential, neither of which exists here); live activation (never implied; a separate explicit owner step) and a maintainer-curated qualification set (P7: the replay framework exists, see below, but the curated set of at least 20 PRs and 20 issues is the owner's to supply); Linux or Windows hosts; non-TypeScript lookup. See `docs/handoff/2026-11-18-p3-progress.md` for the current state; the P1 scheduling gate was changed on 2026-11-28 ([ADR 0026](adr/0026-external-dispatch-for-sweep.md)).
