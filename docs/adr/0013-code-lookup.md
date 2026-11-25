# Reviewer code lookup: a prefetched, compiler-backed context pack

- **Status:** Draft; built offline and checked on the 32 P7 PR cases without a model (see Evidence). Model effect not yet measured.
- **Date:** 2026-11-20
- **Decided by:** @trek-e (approved the design in the project thread, 2026-11-20)

## Context

The P7 holdout after tuning found 0 of 8 expected defects across 14 PR reviews. The reviewer saw only patch hunks with three lines of context and had no tools, so it could not see a caller, a definition, a lint rule or a file the change names. The PRD requires robust, revision-bound code lookup with precise and heuristic answers labeled; the P0 lookup proof (ADR 0004 proof record) showed the TypeScript 6.0.3 LanguageService answers definitions and references exactly within a program. ADR 0004 left code intelligence without an owning ADR; this is it for the baseline. The graph-provider comparison (Atlas, SCIP or CodeGraphContext) stays open.

## Decision

- **Warden runs the lookup, not the model.** Before a review session, Warden builds a ranked, budgeted, cited context pack from a read-only snapshot of the pull request head and inlines it after the patches. The session stays tool-less (ADR 0006); no tool surface is added.
- **Three labeled tiers.** `precise`: the repository's own tsconfig program in the pinned TypeScript 6.0.3. `inferred`: a Warden-built `allowJs` program over JavaScript outside the tsconfig (compiler-derived, treated as heuristic). `text`: bounded exact-token search for Markdown, YAML, JSON, shell and anything outside both programs. P0 refused files outside the program; here they get a labeled lower tier instead, because 914 of the pilot's files are `.cjs` outside its tsconfig.
- **What a pack holds, in rank order:** declarations the change removes that code still uses; definitions of identifiers on added lines that live outside the hunk (one hop through a local's initializer and through require/import bindings); uses of named functions the change edits; files the change names; the whole enclosing function of changed lines; text uses of distinctive tokens from non-code changes, and files named after APIs that have no in-repository definition (lint rules, guards). Changelogs and `.changeset/` are excluded from text search because they echo the change's own wording.
- **Budget:** 16,000 characters by default, clamped so patch plus pack fit the 60,000-character prompt limit. A cut is stated in the pack.
- **Citations:** each item carries path, line span, tier, content sha256 and the head commit, and is re-verified against `git show <head>:<path>` before it enters the packet; a stale item is dropped and counted.
- **Containment:** the snapshot is `git archive` output (no `.git`, hooks, filters or scripts), made read-only; symlinks and paths resolving outside it are never read; repository compiler plugins and project references are ignored; only the pinned compiler's own lib files are read outside the snapshot. Warden fetches nothing: the operator keeps a local clone fetched (`--lookup-clone DIR`), and a head missing from it is reported.
- **Degradation:** a failed or impossible lookup costs no attempt; the review runs on the patch with `context: unavailable` (or `partial`) on the record and the draft card. Missing context is never "no references" and never helps authorize a merge.
- **Scope check unchanged:** findings must still cite changed lines of the pull request.

## Consequences

- `typescript` 6.0.3 moves from devDependencies to dependencies (24.3 MB unpacked, per npm).
- Live `run --task review` gets context only with `--lookup-clone` for a clone the operator can fetch. A private pilot needs Contents read for the fetch, which is outside the approved App ceiling: an owner decision, not needed today.
- Prompts grow by up to 16,000 characters; session time must be re-measured with the budgets work.
- Coexists with the separate read-only base snapshot added on main in parallel (`replay --context-repo PATH --bases FILE`, commit 89eab84), which gives the session read and list tools over the base commit. The two are independent: the pack is inlined whenever a lookup clone is given, and the tools are allowed only when a snapshot is written. Which to keep is for the measurement to decide.
- Not built here: model-side search tools (belongs in the graph comparison, measured against this baseline), decision retrieval, SDK checks, and running the repository's lint (the verification executor's job).

## Evidence

- Offline tests: `packages/warden/test/lookup.test.ts` (tiers, containment, citations, ranking, budget cut, stale items, unavailable lookup, replay wiring).
- No-model check on all 32 gsd-core candidate PRs: `proof/p7/lookup-check.ts`, result `proof/p7/results/lookup-check-2026-11-20.json` (numbers and paths only). Every case's diff matched GitHub's change count; packs were 2,281 to 15,972 characters, built in 0.2 to 6 seconds, with a cut in 3 of 32 cases. The lookup rules were adjusted once after reading pack contents for all 32 cases (changelog noise, removed-symbol hits limited to code); no model results were seen.
- Model effect: not measured. The dev half tunes, then the holdout runs once on the Mac.
