# Warden of the Gate quickstart (release candidate 0.1.0-p4)

Warden is one instance per repository. Deterministic housekeeping runs through one serialized writer; model-backed work (review, triage, implement, rework) runs by hand on a prepared Mac with a local model. **Nothing in this candidate activates itself.** Shadow mode never posts an AI review and never merges; live activation is a separate, explicit step that this release does not include.

Legend: **[verified]** means exercised in this repository by an automated test or recorded evidence; **[owner]** means a GitHub or machine action only the repository owner can take; **[not verified]** means documented from the design but not exercised end to end here.

## 0. What you need

| Need | Detail |
|---|---|
| Node | `>= 22.18` **[verified]** |
| Mac for model work | macOS with Seatbelt (`sandbox-exec`); tested on macOS 27 only. Model-backed tasks refuse to start without a verified boundary **[verified]** |
| OpenCode | pinned `2.2.7`; any other version is refused **[verified]** |
| Local model | served on loopback by LM Studio (default `http://127.0.0.1:1235/v1`); a non-loopback provider, or a resolved model that is not a configured local one, is refused. There is no hosted fallback **[verified]** |
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

Edit `.github/warden.yml` on the **default branch** (a pull request can never change the policy that judges it):

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
- **Scheduling is not validated.** The `schedule` trigger in the sweep example is commented out on purpose: no native scheduled run has ever been observed in the disposable sandbox repositories (see `docs/handoff`). Run `warden run --task sweep` by hand or by `workflow_dispatch`, and enable a schedule only after you have seen a real scheduled run in your own repository. Scheduling is best effort and never an exact-deadline guarantee.

## 7. Model-backed shadow work (on the Mac)

```bash
warden run --task triage --item 12 --runner opencode      # one issue: a draft proposal card, nothing posted
warden run --task triage --runner opencode                # bounded scan of tracked issues awaiting triage: finite items and wall time, then exit
warden run --task review --item 34 --runner opencode      # one PR: read-only, bound to one head
warden run --task review --runner opencode                # bounded scan: finite items and wall time, then exit
```

- Preflight refuses on stop, an unverified boundary, a non-local model or an unavailable endpoint. A review is rejected whole if the head moved, a finding is outside the PR, or the result is malformed; attempts persist (3 by default) and a restart does not reset them. Unchanged heads and checks reuse the accepted review with no model call. A patch too large for the local reviewer is refused with a "split it" message instead of being half reviewed **[verified live on a disposable sandbox PR; model quality is not established]**.
- **Implement / Rework** (factory): `warden run --task implement --item N --runner opencode` works from a trusted checkout of the default-branch tip, lets the model edit files only inside that workspace with no shell, runs your checks in the boundary, and requires fail-before/pass-after evidence for a bug. Weakened gates, edits to workflow/access/orders paths and oversize diffs are refused. The result goes to a **local outbox** branch; opening a real PR needs contents and pull-request write permission that the App ceiling in step 3 does not grant, and granting it is an explicit owner action **[verified against real git and the real executor; not run against GitHub]**.
- **Merge** exists only in live mode, bound to the head that was reviewed, and only after eligibility: blocker always gates, risk is assessed separately from severity, high or uncertain risk and workflow/access/orders edits need a maintainer, and required independent approvals are never bypassed. Enqueueing is not merging; GitHub must confirm before the ledger says merged **[verified against the simulated GitHub]**.

- **Retro** (manual, local): `warden run --task retro [--window-days 30] [--runner opencode] [--source REPO_PATH]` gathers this instance's own decisions, denials, critical escapes and review/triage/implement/rework outcomes, and asks the local model for NARROW proposals (design change first, then a static check, a test, and only then a rule). Every proposal must cite evidence ids; "no change is justified" is a valid answer, and with no evidence no model is called. A proposal that would expand authority is only text for a maintainer and, if it touches an action that was denied before, must cite the old ruling and newer evidence. Nothing is applied, merged or trained on; with `--source` the report is prepared as a `warden/retro-DATE` branch in the local outbox **[verified with a fake model; not run with the real model]**.

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

Discord approval cards and the helper; a published package; a GitHub publisher for factory PRs; live activation and the qualification replay (P7); Linux or Windows hosts; non-TypeScript lookup. See `docs/handoff/2026-11-18-p3-progress.md` for the current state and the P1 gate.
