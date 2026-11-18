# Installed release candidate verification: @taoc/warden 0.1.0-p4

Run on 2026-11-18 with `npm run verify-install` (packages/warden/scripts/verify-install.ts). The script packs the candidate, inspects the tarball, installs it into an empty project and drives the **installed executable** (`node_modules/.bin/warden`), not the source tree, against the simulated GitHub. Nothing was published, tagged or activated.

| Check | Result |
|---|---|
| Pack | `@taoc/warden@0.1.0-p4`, 67 files |
| Tarball contents | Contains dist, both schemas, README, LICENSE, CHANGELOG; contains no tests, evidence, scripts, keys, HTML or transcripts |
| Leak scan | No home paths, token-shaped strings or private keys in any packed file |
| Install | Installs into an empty project (npm resolves the two runtime dependencies, `ajv` and `yaml`) |
| Installed executable | `--version` reports `0.1.0-p4`; help lists every command family |
| Commands (all passed with the documented exit codes) | `setup`, `config validate`, `status`, `run --task` for all eight names (`intake`, `triage`, `review`, `sweep` succeed in dry-run; `claim`, `implement`, `rework`, `retro` return the documented unsupported code 3), `adopt --dry-run`, `data status`, `upgrade --dry-run`, `stop`, `resume --confirm` |

**22 of 22 steps passed.**

## Scope and limits

- The package name `@taoc/warden` is **unregistered** on npm (registry lookup returned 404) under the owner's existing `@taoc` scope. `private: true` stays set so nothing can be published by accident; publication is a separate, explicitly authorized step.
- The checks above prove packaging and the command surface, not live behavior: the backend was the simulated GitHub, and the model-backed tasks were only dry-run planned.
- Not covered by this verification (still open for P6): the written quickstart verified step by step on a prepared Mac with a real App, documenting measured budgets from P0 to P5, and demonstrating configuration-only adoption on a second disposable repository.
