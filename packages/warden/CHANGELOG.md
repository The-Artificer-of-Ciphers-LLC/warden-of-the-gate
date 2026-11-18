# Changelog

All notable changes to `@taoc/warden`. This file is a release-candidate record: nothing here has been published, tagged or activated.

## Unreleased

- Retro task: deterministic evidence packet, validated proposals-only output, local-outbox report branch.

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
- Not covered: Linux or Windows hosts, non-TypeScript lookup, a published package, live activation.
