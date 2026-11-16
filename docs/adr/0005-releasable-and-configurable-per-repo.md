# Ship as one package, tailored for the pilot repo first and configurable per repo

- **Status:** Accepted
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

The maintainer wants this as "a releasable solution", tailored for the pilot repo first — "as that's where I want to use it first" — but "as configurable as possible that anyone could pick it up and use it to manage a repo". The first design shipped as one vendor's plugin; the open-harness pivot (ADR 0004) and the container-portability requirement change what "releasable" means.

## Decision

- One npm package `warden` (TypeScript/Node, bun-compatible): warden-core plus the opencode and pi adapters, esbuild-bundled into committed `dist/*.mjs`, no runtime dependencies.
- **Core** (same for every repo): state machine, ledger format, one-item-per-session batches, delta review, specialists, verifier, gate cards, guardrails, stale logic, runner and schedule.
- **Per repo** (`.github/warden.yml`): label names, base branch, maintainers, voice and posting account, harness selection, execution mode, finding-severity merge gates, stale clocks, tier paths, throttles, batch size and schedule, kill switch name.
- Distribution: npm plus tagged releases with a changelog; the config carries a schema version so upgrades don't silently break a repo. A container image covers Docker and Kubernetes deployment (still self-operated — local-first applies).
- `warden setup` writes a starter config and creates missing labels without any AI.

## Consequences

- A maintainer installs one package, runs setup, and the factory is configured for their repo in an afternoon.
- A new harness is a new adapter versioned with core — not a fork of the factory.
- Schema changes need a migration note in the changelog.
