# Ship as one package, tailored for the pilot repo first and configurable per repo

- **Status:** Draft
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

The maintainer wants this as "a releasable solution", tailored for the pilot repo first — "as that's where I want to use it first" — but "as configurable as possible that anyone could pick it up and use it to manage a repo". The first design shipped as one vendor's plugin; the open-harness pivot (ADR 0004) and the container-portability requirement change what "releasable" means.

## Decision

- Ship a versioned TypeScript/Node CLI/npm bundle for a maintainer-operated Mac, with the OpenCode adapter first. Pi and Warden Docker distribution follow MVP validation; Helm is not MVP.
- Keep the executable name `warden`, but use an operator-owned npm scope: the unrelated unscoped package is already occupied. Confirm the exact publish identity before release.
- **Core:** built-in eight-task loop, semantic state/facets, durable ledgers/intents, review identity/deltas, evidence gates, decisions, stop/recovery and bounded scans. No repository-specific task code.
- **Operational configuration:** `.github/warden.yml` owns identities, label mappings, local runtime, finite budgets, clocks, draft/severity policy, notifications and retention.
- **Standing authority:** `.github/ORDERS.yaml` owns declarative task scopes, restrictions and human gates. Publish and jointly validate versioned schemas with one canonical home per setting.
- Tagged releases include a changelog, Mac quickstart and tested runtime/harness/model/isolation matrix. No untested promise of zero dependencies or universal harness compatibility.
- `warden setup` creates approved missing starter files/labels without AI and never overwrites existing configuration. Existing backlog requires separate dry-run inventory and explicit adoption.
- Upgrades show a dry-run behavior/configuration diff. New defaults cannot silently change authority, checks or clocks; policy changes require approval.

## Consequences

- A maintainer installs one package, runs setup, and the factory is configured for their repo in an afternoon.
- A new harness is a new adapter versioned with core — not a fork of the factory.
- Schema changes need a migration note in the changelog.
