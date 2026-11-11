# Ship as a releasable plugin, tailored for GSD Core first and configurable per repo

- **Status:** Accepted
- **Date:** 2026-11-11
- **Decided by:** @trek-e

## Context

The maintainer wants this as "a releasable solution", tailored for GSD Core "as that's where I want to use it first", but "as configurable as possible that anyone could pick it up and use it to manage a repo". It will live in its own repo under The Artificer of Ciphers: The Warden of the Gate, `The-Artificer-of-Ciphers-LLC/warden-of-the-gate`.

## Decision

- The plugin is a versioned Claude Code plugin with tagged releases and a changelog.
- **Core** (same for every repo): state machine, ledger format, one-item-per-session batches, delta review, specialists, verifier, gate cards, guardrails, stale logic, runner and schedule template.
- **Config** (per repo, `.github/warden.yml`): label names mapped onto the repo's labels, base branch, maintainers, voice header, triage command, test and preflight commands, stale clock lengths, tier paths, specialists, throttles, batch size and schedule, kill switch name, Memtrace on or off.
- `config/defaults.yml` fills anything a repo leaves out; `config/schema.json` validates every config; the config carries a schema version so upgrades never silently break a repo.
- `examples/gsd-core.yml` is the first real configuration.
- `/warden setup` writes a starter config and creates missing labels without any AI.

## Consequences

- Nothing GSD Core-specific is hardcoded; GSD Core is just the first config.
- Adoption on another repo: install the plugin, run setup, copy the two bookkeeping workflows, point the triage and test commands and voice at their own, then bucket report and shadow mode.
- Schema changes need a migration note in the changelog.
- Memtrace's licence forbids redistributing its skills, so the plugin says "install Memtrace" and works without it.
