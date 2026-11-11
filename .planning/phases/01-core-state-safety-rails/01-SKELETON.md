# Walking Skeleton — The Warden of the Gate

**Phase:** 1
**Generated:** 2026-11-10
**Built by:** plans 01-01 (packaging and refusal path) and 01-02 (GitHub state path)

## Capability Proven End-to-End

The maintainer installs the `warden` plugin, types `/warden` and is refused while an API-key route is present; with a clean subscription login, `warden reconcile --item N` reads `.github/warden.yml` from the sandbox's default branch, mints App tokens from the keychain key, and leaves the item with exactly one App-applied state label and one App-authored ledger comment that a second run edits in place.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime and language | TypeScript (erasable syntax only) on Node >=24.12, ESM; `tsc --noEmit` for types | CLAUDE.md stack; Node strips types, so tests and dev runs execute `src/` directly |
| Bundling | esbuild → committed `plugin/dist/warden.mjs` and `actions/sweep/dist/index.mjs`, createRequire banner, defaults.yml embedded via `define` | Only `plugin/` reaches the plugin cache; no runtime npm install (no package.json under `plugin/`) |
| Plugin shape | Marketplace `artificer` at repo root, plugin `warden` in `plugin/`, one skill `skills/warden/SKILL.md` (`/warden:warden`, bare `/warden`), no `bin/` | RESEARCH finding 1 and the `bin/` install caveat |
| "UI" slot | The `/warden` skill: a fail-closed `!` preflight injection, then the bundle runs the verb; owner decisions via AskUserQuestion | No web UI exists; the skill is the maintainer's interface |
| CLI | `warden <verb>` via node:util parseArgs; allowlisted verbs resolved by esbuild glob import from `src/cli/verbs/<verb>.ts`; each exports `run(argv, ctx)` | Later phases add verbs as files without editing a registry |
| "Data layer" slot | GitHub itself: state labels (exactly one per open item) plus one App-authored ledger comment `<!-- warden:ledger v1 {asciiJson} -->` per item the Warden acted on | Core value: state lives on GitHub so any run can pick up cold; ledgers are lazy (D-11) |
| Ledger trust and concurrency | Numeric App bot user id + `performed_via_github_app.id`; writer-owned sections (`runner`, `actions`), body-sha256 re-read before write, verify own rev after, leases | No conditional PATCH on GitHub; `updated_at` is second-granular |
| Auth (GitHub) | Each maintainer's own GitHub App (D-14), key base64 in the login keychain; two down-scoped installation tokens (read for sessions, write for the poster/reconciler) via @octokit/auth-app | POST-01; the App never gets `workflows` or `administration` |
| Auth (Claude) | Subscription only: env deny-list + settings scan + `claude auth status --json` (claude.ai/firstParty) + version >=2.1.302 | ADR 0004; `ANTHROPIC_BASE_URL` is invisible to auth status |
| Config | `.github/warden.yml` read through the contents API at the default branch → yaml → migrate → merge over embedded defaults → Ajv2020 validation of raw and merged → frozen, hashed | CONF-01..03; one TypeBox source for types and the published schema |
| Deployment target | Local: launchd LaunchAgent → stable launcher in `${dataDir}` → `node <installPath>/dist/warden.mjs run`. GitHub: reusable workflow + node24 JS action at `@v1`, called by a thin caller | ADR 0004 (AI local only) and D-19 |
| Directory layout | `src/core/{config,preflight,github,state,whose-turn,buckets,ledger,reconcile,setup,schedule}`, `src/cli/{warden.ts,verbs/}`, `src/actions/sweep/`, `plugin/`, `actions/sweep/`, `test/<area>/`, `examples/` | One warden-core shared by runner and Actions, so clocks and state never disagree |
| Durable local state | `${CLAUDE_PLUGIN_DATA}` or `~/.claude/plugins/data/warden-artificer/`: `app.json`, `STOP`, `locks/`, `logs/`, `launcher.sh` | Never write to `${CLAUDE_PLUGIN_ROOT}` (deleted 14 days after update) |

## Stack Touched in Phase 1

- [ ] Project scaffold: npm, tsconfig, Biome, Vitest, esbuild, CI matrix (01-01)
- [ ] Routing: `/warden` skill → bundle → verb dispatch (01-01)
- [ ] Data layer: one real read (contents API config, labels, comments) and one real write (label add, ledger comment create and in-place edit) on the sandbox (01-02)
- [ ] Interface: the `/warden` skill's fail-closed preflight and AskUserQuestion confirmation (01-01, 01-09)
- [ ] Deployment: documented local full-stack run (`node plugin/dist/warden.mjs reconcile --repo <sandbox> --item N`), launchd job (01-08) and the hourly reusable workflow (01-07)

## Out of Scope (Deferred to Later Slices)

- Any AI session (`claude -p` profiles, tool lists, `system/init` checks): Phase 3
- Intake workflows on `issues`/`issue_comment`, voice header, welcome posts, dry-run for every task: Phase 2
- Author-activity clocks, nudges and closes (whose-turn v0 only labels and buckets here): Phases 2 and 4
- `/warden status` bucket report display and the Foundation gate: Phase 2 (buckets are defined and computed here)
- Outbox and GitHub/Shadow/DryRun sinks: Phase 3
- Review markers written on real reviews: Phase 4 (the format is frozen here for rebuild)

## Subsequent Slice Plan

- Phase 2: no-AI intake and issue clocks on GitHub; `/warden status` shows buckets A-F
- Phase 3: delta-only tiered review into a local shadow report
- Phase 4: live COMMENT reviews, decision cards, PR clocks
- Phase 5: headless triage through the poster; claim windows
- Phase 6: isolated implement and rework sessions
- Phase 7: retro rules PRs and the v1.0.0 release
