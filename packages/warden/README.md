# @taoc/warden

Warden of the Gate: a local-first, one-repository-per-instance software factory CLI. It does deterministic GitHub housekeeping through one serialized writer and runs read-only shadow review and triage on a local model inside an OS boundary. **Release candidate 0.1.0-p4: not published, not live-ready, no AI effects are ever posted in shadow mode.** See the [implementation plan](../../docs/prd/0001-warden-of-the-gate.implementation-plan.md) and the [progress record](../../docs/handoff/2026-11-18-p3-progress.md).

```bash
npm ci && npm run build && npm test     # no network, no credentials
npm run verify-install                  # packs the candidate, installs it into an empty project and drives the INSTALLED executable
node dist/cli.js --help
```

Requirements: Node >= 26. Any model-backed task also needs macOS (Seatbelt `sandbox-exec`, tested on macOS 27), the pinned OpenCode 2.2.7, and a local OpenAI-compatible model server on loopback (mlx-serve at `http://127.0.0.1:11234/v1` by default; `--model-url` overrides), with `--context-limit` set to the window the model is loaded with. There is no hosted fallback.

## Commands

| Command | What it does |
|---|---|
| `warden setup [--create-config --repo o/n --maintainers a,b] [--create-orders] [--create-labels] [--approve-ceiling]` | prerequisite report; every creation is a separate explicit flag; existing files are never overwritten; adopts nothing |
| `warden config validate [--show-effective]` | both YAML files (Ajv), schema compatibility, effective-policy conflicts, unsafe defaults |
| `warden run --task intake\|sweep [--dry-run] [--item N]` | deterministic housekeeping. Live `intake --item N` and `sweep` only SUBMIT intents; `warden writer drain` applies them. Nothing is scheduled by Warden |
| `warden run --task review\|triage [--dry-run] [--item N] [--runner opencode --context-limit N] [--lookup-clone DIR]` | local read-only shadow work. Without `--runner opencode` a live run refuses honestly. `review` without `--item` is a bounded scan. `--lookup-clone` (review) adds a cited repository context pack from a local clone holding the PR head ([ADR 0013](../../docs/adr/0013-code-lookup.md)); Warden never fetches |
| `warden run --task implement --item N [--runner opencode --context-limit N] [--base-sha SHA] [--source URL]` | factory Implement for one triaged bug or approved feature: trusted base checkout, writable-only workspace, no shell for the model, executor evidence (fail-before/pass-after), refuses weakened gates and authority-path edits. Needs `merge.factoryLogins` and `verify.checks`. Publishes to a LOCAL outbox only unless a GitHub publisher is configured; it never opens a PR by itself in this candidate |
| `warden run --task rework --item N [--runner opencode --context-limit N]` | factory Rework: factory branches only, against the named findings of the accepted review of the current head; verified by the executor; three persisted cycles (completed attempts count even without progress), separate launch-retry budget, unresolved after the last cycle escalates |
| `warden run --task claim [--dry-run]` | finds the earliest unedited `/warden claim` comment on ready, unowned issues and submits it as a claim intent attributed to that comment's author; the writer re-verifies the comment and GitHub ownership. Items already assigned on GitHub are skipped |
| `warden run --task retro` | manual local retrospective: narrow, evidence-cited proposals or an explicit no-change; nothing applied (see the quickstart) |
| `warden adopt --dry-run [--out f]` / `--selection f --confirm` | inventory existing items, then adopt only the selected ones (existing owners kept, new clocks start at the adoption notice) |
| `warden status [--json]` | state, ownership, approvals, evidence freshness, pending operations, credentials, stop acknowledgements; no model, no secrets |
| `warden stop [--global]` / `warden resume --confirm [--global]` | local stop first, then shared stop, confirmed by re-read |
| `warden writer drain` / `warden journal reconcile` / `warden event handle` | the one serialized effect path, durable-journal recovery, and the Actions doorbell for `/warden` commands |
| `warden approvals request\|revise\|list\|check` | action and feature-design approvals bound to revision, policy and evidence |
| `warden credentials configure\|status\|ack-revocation` | protected GitHub App provisioning and controller state |
| `warden data status\|export\|purge` | scoped, redacted, confirmed, receipted local-data controls; decisions are protected |
| `warden upgrade --dry-run` | reports behavior, config, schema and default changes; there is no apply path in this candidate |
| `warden sim ...` | a simulated GitHub world for tests and evidence only (`--backend sim:<file>`) |

Exit codes: 0 ok, 1 invalid or refused, 2 usage or unconfirmed, 3 unsupported task, 4 blocked, 5 writer halted.

See [CHANGELOG.md](CHANGELOG.md) for the compatibility notes.
