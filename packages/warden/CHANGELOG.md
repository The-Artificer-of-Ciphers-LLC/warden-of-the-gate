# Changelog

All notable changes to `@taoc/warden`. This file is a release-candidate record: nothing here has been published, tagged or activated.

## Unreleased

- OpenCode is no longer pinned to exactly 2.2.7 (owner ruling 2026-11-27, ADR 0004 amendment). Preflight accepts any 2.x release at or above 2.2.7 and refuses 1.x, 3.x and earlier 2.x builds with the reason named. Every `run` and `replay` result and report file records the observed `harnessVersion`, and a factory PR's attribution names it ("via opencode 2.4.1"). `runtime.harnessVersion` defaults to `2.x`; an exact version in an existing `warden.yml` stays valid. The P0 proofs ran on 2.2.7 and have not been re-run on later 2.x releases.
- OpenCode 2.4.x starts serving before its providers load, so the first review on 2.4.1 stopped with "no resolved default model (status 200)". The routing check now asks again until the configured model resolves, up to the startup limit, and still refuses at once on non-local routing or a substituted model. Warden's OpenCode provider is now `mlx-serve` (owner, 2026-11-28: "drop lmstudio we aren't using it"); OpenCode's built-in `lmstudio` and `ollama` providers are denied, so only the configured model is registered (ADR 0004 amendment 2026-11-28).
- Trusted base (W-20, PRD §3, confirmed 2026-11-27): in a git checkout, acting commands read `warden.yml` and `ORDERS.yaml` from `origin/HEAD` (or `--trusted-ref` / `WARDEN_TRUSTED_REF`), never the working tree, and refuse when that ref cannot be resolved. `warden status` shows the policy commit and any policy file whose working copy is not in force. A review of a pull request that changes policy, workflow or other human-gate files is always full (earlier findings still re-checked), and its card asks for a maintainer decision.
- Actions hardening (W-20): the example workflows pin `actions/checkout` and `actions/setup-node` by commit SHA, set `persist-credentials: false` and pass `WARDEN_TRUSTED_REF`. A new offline check (`config/workflow-check.ts`) finds `pull_request_target`/`workflow_run` workflows that check out PR code, event text inlined into scripts, unpinned actions and persisted checkout tokens; every template passes it, and CI runs zizmor 1.33.1 over this repository's workflows and the templates. The credential controller refuses the `workflows` permission whatever the ceiling says.
- The default local model endpoint is now mlx-serve at `http://127.0.0.1:11234/v1` (OpenAI-compatible); `--model-url` overrides it and `--lmstudio-url` is kept as an alias. The 0.1.0-p4 entry below records LM Studio because that is what that candidate used.
- Node >= 26 is now required (`engines`, `warden setup` and the example workflows). The Seatbelt work was built and proven on Node 26, and the repository checks now run on it.
- The Seatbelt test fixtures run `node --test test/sum.test.js` instead of `node --test test/`. Node 22 and 24 load a directory argument as a module path and fail, so the fixtures passed only on Node 26; naming the file keeps the fail-before/pass-after setup (the base has no test file) and works on every Node version.
- The OpenCode runner no longer guesses the model's context window. `--context-limit N` is required with `--runner opencode` (on `run` and `replay`); preflight and each session refuse with a clear reason when it is missing, not a whole number of at least 4096, or not larger than `--output-limit` (default 32768). The silent 131072 fallback and the server-specific window lookups (`/v1/models` extras, LM Studio `/api/v0`) are removed, following the published-specs ruling in `docs/research/MODEL-CONNECTIONS.md`.
- Retro task: deterministic evidence packet, validated proposals-only output, local-outbox report branch.
- Review code lookup (ADR 0013): `run --task review --lookup-clone DIR` and `replay --lookup-clone DIR [--context-chars N]` give the reviewer a prefetched, cited repository context pack (precise TypeScript, inferred JavaScript, text tiers). `typescript` 6.0.3 is now a runtime dependency. Replay cases may carry `head`/`base` commits; replay results report context stats and per-case wall time.

## 0.1.0-p4 (release candidate, unpublished)

- P1 walking skeleton: CLI, schemas, serialized writer, stop/resume, approvals, credential controller with a GitHub App issuer.
- P2 deterministic housekeeping: intake, claim, sweep (nudges, closures, delivery/fix-window expiry, holds), draft policy, reconcile, adoption (`warden adopt`).
- P3 local shadow work: read-only review and triage on a pinned OpenCode adapter inside a Seatbelt boundary; nothing is posted in shadow mode.
- P4 groundwork: merge eligibility gates, head-bound merge delivery (live mode only), rework accounting, critical-escape pause.
- P5/P6 pieces: `warden data status|export|purge`, `warden upgrade --dry-run`.

### Compatibility

- Node >= 22.18. macOS with Seatbelt (`sandbox-exec`) is required for any model-backed task; the only tested macOS major is 27.
- OpenCode is pinned to 2.2.7; the local model is served by LM Studio on loopback. There is no hosted fallback.
- `warden.yml` schemaVersion 1 and `ORDERS.yaml` schemaVersion 1. There is no migration engine: unsupported versions fail with an actionable message.
- Not covered: Linux or Windows hosts, lookup beyond TypeScript/JavaScript (other languages get text search only), a published package, live activation.
