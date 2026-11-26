# Changelog

All notable changes to `@taoc/warden`. This file is a release-candidate record: nothing here has been published, tagged or activated.

## Unreleased

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
