# The Warden of the Gate: docs (draft)

Docs for `The-Artificer-of-Ciphers-LLC/warden-of-the-gate` — The Warden of the Gate, a self-maintaining software factory for any GitHub repo (config `.github/warden.yml`). PRDs in `docs/prd/`, ADRs in `docs/adr/` with a Status and Date header, research records in `docs/research/`. Numbered 0001 onward.

| File | Title | Status |
|---|---|---|
| [docs/prd/0001-warden-of-the-gate.md](docs/prd/0001-warden-of-the-gate.md) | A self-maintaining software factory for any GitHub repo | Draft |
| [docs/adr/0001-builtin-triage-task.md](docs/adr/0001-builtin-triage-task.md) | Triage is a factory built-in; no repo-supplied commands | Accepted |
| [docs/adr/0002-stale-clocks.md](docs/adr/0002-stale-clocks.md) | Stale clocks for PRs and issues | Accepted |
| [docs/adr/0003-contributor-facing-voice.md](docs/adr/0003-contributor-facing-voice.md) | Contributor-facing output is AI-assisted, signed by the configured account | Accepted |
| [docs/adr/0004-local-first-open-harness-runtime.md](docs/adr/0004-local-first-open-harness-runtime.md) | All AI work runs locally on a local-first model pool, through open harnesses | Accepted |
| [docs/adr/0005-releasable-and-configurable-per-repo.md](docs/adr/0005-releasable-and-configurable-per-repo.md) | One package, tailored for the pilot repo first, configurable per repo | Accepted |
| [docs/adr/0006-agentrunner-adapter-seam.md](docs/adr/0006-agentrunner-adapter-seam.md) | Harness differences live in AgentRunner adapters; the core is harness-agnostic | Accepted |
| [docs/adr/0007-local-first-model-pool.md](docs/adr/0007-local-first-model-pool.md) | Local-first model pool: local default, remote opt-in, never a silent fallback | Accepted |
| [docs/adr/0008-tiered-autonomy-and-merge-gates.md](docs/adr/0008-tiered-autonomy-and-merge-gates.md) | Tiered autonomy; severity-based configurable merge gate | Accepted |
| [docs/adr/0009-factory-product-boundary.md](docs/adr/0009-factory-product-boundary.md) | The factory never executes a product's own workflow | Accepted |

Source: owner decisions of Nov 11–16, 2026.
