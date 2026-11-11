---
phase: "1"
slug: "core-state-safety-rails"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-10"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.1.x (+ @vitest/coverage-v8), fast-check 4.10.x |
| **Config file** | none — Wave 0 installs `vitest.config.ts` (`test.include: ["test/**/*.test.ts"]`) |
| **Quick run command** | `npx vitest run test/<area>` plus `npx tsc --noEmit` |
| **Full suite command** | `npm run check` (biome ci, tsc --noEmit, vitest run, build + `git diff --exit-code` on dist, `claude plugin validate --strict` on marketplace and plugin, actionlint with the `concurrency.queue` ignore, zizmor 1.32.0 offline) |
| **Estimated runtime** | ~30 seconds quick, ~120 seconds full |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/<area touched>` and `npx tsc --noEmit`
- **After every plan wave:** Run `npm run check`
- **Before `/gsd-verify-work`:** Full suite green in CI (Node 24 and 26 × ubuntu/macos) plus the manual E2E checks below
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Seeded per requirement from 01-RESEARCH.md § Validation Architecture. Task IDs are filled in once plans exist.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CONF-01 | — | N/A | unit | `npx vitest run test/config/schema.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONF-02 | — | Invalid config stops every task with a readable error | unit | `npx vitest run test/config/load.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONF-03 | — | Newer schema/ledger version refused | unit | `npx vitest run test/config/migrate.test.ts test/ledger/version.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONF-04 | — | N/A | unit | `npx vitest run test/config/examples.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONF-05 | — | Setup idempotent; conflicting stale.yml / AI reviewer reported | unit | `npx vitest run test/setup/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONF-06 | — | N/A | unit + CI | `npx vitest run test/release/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | STATE-01 | — | Exactly one state label; manual move kept; hold skipped | unit + property | `npx vitest run test/state/reconcile.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | STATE-02 | — | Ledger codec cannot be broken by `-->` | property | `npx vitest run test/ledger/codec.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | STATE-03 | — | Spoofed/corrupt ledger → needs-human; rebuild from App markers | unit | `npx vitest run test/ledger/trust.test.ts test/ledger/rebuild.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | STATE-04 | — | Concurrent writers never drop sections | unit (fake timers) | `npx vitest run test/ledger/concurrency.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | STATE-06 | — | Add-then-remove label ordering, never PUT | unit | `npx vitest run test/state/labels.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | POST-01 | — | Read-only session token; write token only in poster; no `workflows` permission | unit + static | `npx vitest run test/github/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | POST-02 | — | App token action pinned by SHA with `client-id` | static | `npx vitest run test/workflows/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RUN-01 | — | N/A | unit | `npx vitest run test/schedule/` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RUN-02 | — | Any API-key route or non-subscription auth refuses to start | unit (fake `claude`) | `npx vitest run test/preflight/credentials.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RUN-03 | — | Old Claude Code refused; no `--bare`/skip-permissions/Agent SDK in src | unit + static | `npx vitest run test/preflight/version.test.ts test/static/forbidden.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RUN-08 | — | Kill switch (var or STOP file) refuses; unreadable var fails closed | unit (fake `gh`) | `npx vitest run test/preflight/killswitch.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json`, `package-lock.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `zizmor.yml`
- [ ] `test/helpers/fake-fetch.ts` — Octokit `request.fetch` fixture router plus in-memory comment/label store with second-granular timestamps
- [ ] `test/helpers/fake-bin/{claude,gh,security}` — argv/env recorders emitting canned JSON, plus a PATH-prepend helper
- [ ] `test/fixtures/github/*.json` — PRs, reviews, timeline label events, App comments with `performed_via_github_app`
- [ ] `.github/workflows/ci.yml` — Node 24/26 × ubuntu/macos matrix
- [ ] Framework install via `npm install --save-dev --save-exact …` (after the package-legitimacy checkpoint)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Marketplace install at an explicit version | CONF-06 (SC-1) | Needs a real Claude Code install from the published marketplace | `claude plugin install warden@<marketplace>` at the tagged version; confirm version in `/plugin` |
| Sandbox reconcile leaves one state label per item and edits ledgers in place | STATE-01..04 (SC-4) | Needs a real GitHub repo with the App installed | Run `warden reconcile --repo <sandbox> --all`; inspect labels and ledger comments |
| launchd job fires on schedule and catches up on wake | RUN-01 (SC-5) | Needs a real Mac sleep/wake cycle | Install schedule, sleep past a slot, wake, check run log |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
