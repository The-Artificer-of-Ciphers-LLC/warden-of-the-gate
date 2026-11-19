# P7 candidate set for owner review (open-gsd/gsd-core)

Mark each row keep or drop. A drop list is all the agent needs; everything else is kept. The set is signed as curated by the owner only after this review.

## PRs: what the reviewer must find (mustFind) or must leave alone (clean)

| id | expectation | title | basis |
|---|---|---|---|
| pr-482 | must find tests/bug-1974-context-exhaustion-record.test.cjs:129-131 | fix(#481): remove residual dead silent-expiry poll helper + Atomics.wa | later fix: https://github.com/open-gsd/gsd-core/pull/493 - "Re-adds the guard removed in #482. Refs #490. (restore bounded Windows EBUSY cleanup retry in afterEach)" |
| pr-2031 | must find tests/surface-empty-manifest-agents.test.cjs:29-29 | fix(#2018): applySurface empty manifest no longer deletes gsd-* agents | later fix: https://github.com/open-gsd/gsd-core/pull/2033 - "Fixes a `lint-tests` failure on `next` introduced by #2031 (#2018): the regression test ... used raw `fs.rmSyn" |
| pr-3656 | must find tests/gsd-check-update-worker-platform-gate.test.cjs:219-222 | fix(#3582): stop the cold-tree fixture racing concurrent hook builds | later fix: https://github.com/open-gsd/gsd-core/pull/3665 - "This is a follow-up to #3656, fixing a defect in the guard that PR added." |
| pr-5685 | must find hooks/gsd-secret-read-guard.js:166-167 | fix(#5627): look through wrapper options in the secret-read guard | later fix: https://github.com/open-gsd/gsd-core/pull/5874 - "The secret-read guard's `WRAPPERS` table (added in #5685) left out three value-taking options that sudo(8) and" |
| pr-4021 | must find src/state-document.cts:556-556 | fix(#4010): confine stateReplaceField to same-line whitespace so an em | later fix: https://github.com/open-gsd/gsd-core/pull/4453 - "#4010 (PR #4021) narrowed this pattern's label-to-value gap to same-line whitespace but did not anchor it" |
| pr-4228 | must find gsd-core/workflows/execute-phase.md:760-760 | fix(#3990): state the RED/GREEN/REFACTOR cycle once, embed tdd.md cond | later fix: https://github.com/open-gsd/gsd-core/pull/4284 - "both executor dispatch backends previously referenced an unassigned `${TDD_APPLICABLE}` placeholder" |
| pr-5363 | must find src/init.cts:243-245 | fix(#4854): init verbs emit the ROADMAP display name, not the director | later fix: https://github.com/open-gsd/gsd-core/pull/6023 - "`roadmap get-phase` and every init verb's `phase_name` kept the `(INSERTED)` marker that `phase insert` writes" |
| pr-6074 | must find .github/workflows/test.yml:11-16 | ci(#6073): re-run Tests when fix-next is added or removed | later fix: https://github.com/open-gsd/gsd-core/pull/6093 - "#6074 added `labeled`/`unlabeled` to the Tests `pull_request` trigger. Every label change started a full Tests" |
| pr-585 | must find get-shit-done/workflows/ship.md:197-203 | Enhancement(#41): /gsd-ship extracts per-commit gate_status into a PR- | later fix: https://github.com/open-gsd/gsd-core/pull/2467 - "PR #585 shipped the consumer/extraction logic and assumed commits would carry `gate_status:` trailers." |
| pr-1499 | must find package.json:89-89 | fix(#1498): regenerate capability-registry.cjs in npm version lifecycl | later fix: https://github.com/open-gsd/gsd-core/pull/1502 - "The `npm version` lifecycle hook (added in #1499) runs `gen-capability-registry.cjs --write`, which requires ." |
| pr-85 | must find get-shit-done/workflows/fast.md:79-82 | fix(3805): schema-aware log_to_state row appending in fast.md | later fix: https://github.com/open-gsd/gsd-core/pull/2214 - "`/gsd-fast`'s `log_to_state` step has never appended a Quick Task row to `STATE.md` since PR #85." |
| pr-3091 | must find src/state-transition.cts:211-214 | fix(#2969): ratchet completed_plans up for gap-closure plans under der | later fix: https://github.com/open-gsd/gsd-core/pull/5669 - "compared counters with `typeof x === 'number'`. Parsed frontmatter scalars are strings, so both sides were `-I" |
| pr-366 | must find scripts/affected-tests-lib.cjs:112-113 | ci: run affected tests in PR workflow lanes | later fix: https://github.com/open-gsd/gsd-core/pull/395 - "PR #366 (ci #365) switched PR lanes to `npm run test:affected` with no suite scoping. `affected-tests-lib.cjs`" |
| pr-4230 | must find gsd-core/workflows/verify-work.md:181-183 | fix(#3968): measure commit claims at all three surfaces — ledger, veri | later fix: https://github.com/open-gsd/gsd-core/pull/4813 - "measured `plan_head_before..HEAD` — verify-time HEAD. That window grows with every later plan's task and SUMMA" |
| pr-3107 | clean (no finding) | fix(#3020): verify graphify tool identity before reporting compatibili | src graphify identity check; no later reference; merged 2026-08-06, no later PR/issue text mentions it (full-t |
| pr-4006 | clean (no finding) | fix(#3795): read the interrupted agent id before clearing the stale ma | workflow shell reorder reads id before rm; merged 2026-08-28, no later PR/issue text mentions it (full-text se |
| pr-1621 | clean (no finding) | fix(#1619): normalize pruned mise node execPath to the stable shim in  | installer mise shim path normalization; merged 2026-06-23, no later PR/issue text mentions it (full-text searc |
| pr-577 | clean (no finding) | fix(#492): manifest effort.agent_overrides and effort.default now fall | effort fallback to canonical defaults; merged 2026-06-01, no later PR/issue text mentions it (full-text search |
| pr-1552 | clean (no finding) | fix(#1551): match dash-separated milestone phase IDs in roadmap analyz | roadmap checklist regex accepts dash IDs; merged 2026-06-22, no later PR/issue text mentions it (full-text sea |
| pr-3140 | clean (no finding) | fix(#3052): preserve frontmatter last_activity_desc on same-date body  | state frontmatter same-date preserve; merged 2026-08-07, no later PR/issue text mentions it (full-text search) |
| pr-4048 | clean (no finding) | fix(#3895): delete the mempalace-curator's model frontmatter pin — the | agent frontmatter pin removal; merged 2026-08-29, no later PR/issue text mentions it (full-text search), no de |
| pr-4420 | clean (no finding) | fix(#4276): read the quoting, not just the digits, before eating an IO | test helper quoting read; merged 2026-09-07, no later PR/issue text mentions it (full-text search), no defect  |
| pr-1546 | clean (no finding) | fix(#1545): make no-phantom-issue-refs walk() robust to broken symlink | lint test robust to broken symlinks; merged 2026-06-21, no later PR/issue text mentions it (full-text search), |
| pr-3396 | clean (no finding) | fix(#3321): exclude .claude/.planning from no-phantom-issue-refs SKIP_ | lint SKIP_DIRS addition; merged 2026-08-13, no later PR/issue text mentions it (full-text search), no defect s |
| pr-4062 | clean (no finding) | fix(#3900): overlay walker skips non-regular files — a repo-root socke | test helper skips non-regular files; merged 2026-08-29, no later PR/issue text mentions it (full-text search), |
| pr-2023 | clean (no finding) | fix(#1581): config-set no longer silently coerces Infinity / project_c | config-set Number.isFinite and project_code string; merged 2026-07-05, no later PR/issue text mentions it (ful |
| pr-1130 | clean (no finding) | fix: route nested sub_repos by longest prefix, not first array-order m | sub_repo longest-prefix routing; merged 2026-06-12, no later PR/issue text mentions it (full-text search), no  |
| pr-4534 | clean (no finding) | fix(#4383): require phase before planned-phase writes | planned-phase requires phase; merged 2026-09-09, no later PR/issue text mentions it (full-text search), no def |
| pr-3935 | clean (no finding) | fix(#3729): hoist the .planning and CI gates above the graphify hook's | hook gates hoisted above node parse; merged 2026-08-27, no later PR/issue text mentions it (full-text search), |
| pr-848 | clean (no finding) | chore(#846): remove unused PR-size labeler (size/S–XL) workflow | remove unused size-check workflow and its required-check refs; merged 2026-06-08, no later PR/issue text menti |
| pr-3317 | clean (no finding) | docs(#3316): standing counter-test rule for error/fallback branches | docs counter-test rule; merged 2026-08-10, no later PR/issue text mentions it (full-text search), no defect se |
| pr-4684 | clean (no finding) | test(#4528): migrate final seam-dispatch batch and retire the timeout- | test timeout-constant migration; merged 2026-09-13, no later PR/issue text mentions it (full-text search), no  |

## Issues: what triage must answer

| id | expected kind / outcome | title | basis |
|---|---|---|---|
| issue-4869 | bug -> likely-bug | audit-open permanently reports the debugger's own knowledge base as an | maintainer label confirmed-bug, closed as completed |
| issue-5004 | bug -> likely-bug | bug(verifier): gsd_run is only defined in Step 1 (initial mode) — re-v | maintainer label confirmed-bug, closed as completed |
| issue-5061 | bug -> likely-bug | chore(ci): require-issue-link rejects Refs #N on .out-of-scope/-only P | maintainer label confirmed-bug, closed as completed |
| issue-5189 | bug -> likely-bug | bug(tests): process-seam darwin partial-stderr assertion races Node st | maintainer label confirmed-bug, closed as completed |
| issue-5321 | bug -> likely-bug | bug(roadmap): annotate-dependencies is write-once, so a replan's new w | maintainer label confirmed-bug, closed as completed |
| issue-5451 | bug -> likely-bug | plan-phase: stall-detection config key easy to mis-guess; key not name | maintainer label confirmed-bug, closed as completed |
| issue-5553 | bug -> likely-bug | bug(roadmap.update-plan-progress): <details open>, uppercase tags and  | maintainer label confirmed-bug, closed as completed |
| issue-5726 | bug -> likely-bug | phase add / add-batch silently scope to the whole unshipped roadmap wh | maintainer label confirmed-bug, closed as completed |
| issue-5857 | bug -> likely-bug | bug(isolation-guard): a FIFO at `.gsd/.gitignore` hangs `record-dispat | maintainer label confirmed-bug, closed as completed |
| issue-5960 | bug -> likely-bug | bug(mempalace): plan:pre recall never runs outside auto-chain, and the | maintainer label confirmed-bug, closed as completed |
| issue-2856 | enhancement/feature -> feature-proposal | enh(gsd-executor): agent has no browser MCP surface, so any plan with  | maintainer label approved-enhancement |
| issue-3241 | enhancement/feature -> feature-proposal | enhance(#2313): omit the Codex per-agent model by default (supersede # | maintainer label approved-enhancement |
| issue-3534 | enhancement/feature -> feature-proposal | 3160 Phase 5 (10a) — resolve-execution must not report an effort the a | maintainer label approved-enhancement |
| issue-4039 | enhancement/feature -> feature-proposal | Share POSIX shell quoting helper across lifecycle code | maintainer label approved-enhancement |
| issue-4521 | enhancement/feature -> feature-proposal | test(#4445): Batch 10 — capability subsystem (epic #4445) | maintainer label approved-enhancement |
| issue-5560 | enhancement/feature -> feature-proposal | chore(#5556): Pi hook and lifecycle parity — Phase 3 | maintainer label approved-enhancement |
| issue-73 | enhancement/feature -> feature-proposal | Vertical MVP Slice — Phase 1 of 4: planner-side machinery | maintainer label approved-feature |
| issue-1451 | enhancement/feature -> feature-proposal | feat(capability): wire the gsd capability install/update/remove/list m | maintainer label approved-feature |
| issue-2613 | enhancement/feature -> feature-proposal | feat(#2584): Phase 2 — worktree create verb + orchestrator-exec-with-c | maintainer label approved-feature |
| issue-3993 | enhancement/feature -> feature-proposal | feat(#3646): Phase 1 — implement per-task external-tracker content-res | maintainer label approved-feature |
| issue-646 | bug/enhancement/feature/question/other -> not-actionable | fix: generate root SKILL.md index in stageSkillsForRuntimeAsSkills | maintainer label wontfix |
| issue-2696 | bug/enhancement/feature/question/other -> not-actionable | GSD model_policy has no effect on opencode (Skill() runs inline, no ag | maintainer label wontfix |
| issue-3340 | bug/enhancement/feature/question/other -> not-actionable | windows append rejects existing ledger entries with status: "resolved" | maintainer label wontfix |
| issue-4027 | bug/enhancement/feature/question/other -> not-actionable | Codex-native GSD plugin | maintainer label wontfix |
| issue-4884 | bug/enhancement/feature/question/other -> not-actionable | phase.complete advances past an integer phase when a later decimal pha | maintainer label wontfix |
| issue-5494 | bug/enhancement/feature/question/other -> not-actionable | execute:wave:post ui gate declares `query: "ui.safety-gate"`, which gs | maintainer label wontfix |
| issue-216 | bug/enhancement/feature/question/other -> needs-info | chore(infra): exclude sdk/src tests from root test runner (gsd-test v1 | maintainer label needs-info |
| issue-381 | bug/enhancement/feature/question/other -> needs-info | chore: workflow gsd_run launcher defined once-per-file but called acro | maintainer label needs-info |
| issue-1650 | bug/enhancement/feature/question/other -> needs-info | model profile not working in  OpenCode | maintainer label needs-info |
| issue-1697 | bug/enhancement/feature/question/other -> needs-info | validate.health: checklist-style phase declarations in collapsed miles | maintainer label needs-info |
| issue-1989 | bug/enhancement/feature/question/other -> needs-info | [Enhancement] Add LSP tool to code-facing agent tool lists | maintainer label needs-info |
| issue-2167 | bug/enhancement/feature/question/other -> needs-info | GPT-5.6 Ultra appears to cause overlapping agent orchestration in gsd- | maintainer label needs-info |
