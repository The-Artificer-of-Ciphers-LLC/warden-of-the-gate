# A read-only graph lookup serves Triage, Review and Implement, and must beat the ADR 0013 pack on replay

- **Status:** Proposed (2026-11-28). Merging the PR that adds it records the three options and the replay bar; it does not choose an option. The owner chooses after the measurement in "Decision".
- **Date:** 2026-11-28
- **Research:** [Why two different models score almost the same on replay](../research/REPLAY-AGREEMENT-CAUSES-2026-11-28.md) (Cause 8 holds the sourced comparison), [Code-intelligence options](../research/CODE-INTELLIGENCE-OPTIONS.md)
- **Builds on:** [ADR 0013](0013-code-lookup.md) (code lookup, the baseline), [ADR 0018](0018-measured-not-estimated.md) (measured, not estimated), [ADR 0022](0022-new-model-starts-paused.md) (qualification by harness and settings), [ADR 0027](0027-replay-cases-are-validated.md) (replay cases are checked), [ADR 0028](0028-output-rules-written-once-and-checked.md) (Triage gets the repository), PRD §11 (replay, dev and holdout)

## Context

Two very different models scored almost the same on the 64-case replay: 42% and 44% blocking agreement, 44% and 59% triage. In both runs the reviewer saw only the patch, and the triager saw only the issue text, with no access to the code. The owner's position: "you need context for code you can't look at a block and figure out what it's doing. we need a high speed graph lookup."

What exists today:

- The ADR 0013 pack: compiler-backed (TypeScript LanguageService), prefetched and inlined, 16,000 characters, TS/JS only. It covers the defect region in 4 of the 14 known replay defects, and has never been measured with a model.
- The owner uses codegraph (assumed to be `colbymchenry/codegraph`, MIT; not yet confirmed) in his own coding setup.
- gsd-atlas (`open-gsd/gsd-atlas`, alpha) is the owner's own project: "a codegraph + sdk reference library for the coding agents to check against." Its code graph is built; its SDK reference half is designed but not built; its registered evaluation reads "MVP not met".

The research points one way on delivery:

- Smaller models do worse when they must drive a graph query themselves. In CodexGraph, Qwen2-72B fell from 9.34 to 1.95 on SWE-bench Lite.
- Agents offered tools often do not use them. In gsd-atlas's own evaluation, tools were used in 38% of sessions.
- For review, more context is not better context. CodeFuse-CR-Bench and AACR-Bench both show this.

## Decision (proposed)

1. **One lookup, three consumers.** A single read-only lookup answers questions for Triage (is it already fixed, is it in scope, which code does the issue touch), Review (callers, callees, tests and docs of each changed hunk) and Implement (what a change will touch, which SDK or platform API exists at the project's target level). It never writes to the repository, never runs repository code, and opens no network connection while it answers.
2. **Bound to a revision.** Every answer is for one commit: the PR's base and head for Review, the default branch at triage time for Triage, and the working base for Implement. An answer that cannot be tied to that commit is refused, not guessed. This is what replay needs, and what keeps a live answer honest.
3. **Prefetched first.** The lookup builds a small pack chosen by the diff or the issue, inside the existing ADR 0013 budget, and Warden inlines it. A model-driven lookup tool is a later, separate option, measured on its own against the pack.
4. **Covers non-code files.** It follows references from Markdown, YAML and JSON into code and back: a command named in a workflow `.md`, a script named in `package.json`, a path named in a YAML step. 6 of the 14 replay defects are in such files, and no surveyed tool covers this, so it is built whichever option is chosen.
5. **The bar.** An option is adopted only when, on the same model, harness and settings (ADR 0022):
   - it beats the ADR 0013 pack on the dev split, measured per known defect (recall and precision separately);
   - it then matches or beats the pack on one untouched holdout run;
   - it misses no critical case that the pack catches;
   - it reports its added index and replay wall time, which the owner weighs against the gain (no published standard sets a limit, so none is proposed here).
   If no option clears this, the ADR 0013 pack stays.

   Whoever runs the comparison first needs a fresh holdout. Both 2026-11-28 runs used the full set, so the current split has been seen. Building one is part of the work.

## Options

The decision above holds for all three. They differ in who builds the index.

| | A. codegraph as is | B. Extend codegraph | C. Build our own on gsd-atlas |
| --- | --- | --- | --- |
| **What it is** | Run codegraph's CLI (`--json`) or library against a snapshot at the case's commit; Warden turns answers into the pack | Fork or upstream: add revision binding, a compiler-precise tier for TS/JS, and Markdown/YAML/JSON reference extraction | Use gsd-atlas's precise TS tier and `history --at`; add the non-code references and the SDK pack it already designs |
| **Precision** | By name (tree-sitter). One tree-sitter graph resolves 37% of TS edges alone, 81% with a language server (cartog, vendor-reported) | Compiler-exact for TS/JS once the tier is added; by name for other languages | Compiler-exact for TS/JS (TS 6.x compiler); grammar tier elsewhere |
| **Languages** | 20 code languages; no MD/YAML/JSON | Same, plus what we add | TS/JS only today (`.ts/.cts/.mts/.js/.cjs/.mjs/.jsx`); gsd-core is mostly `.cjs`, so it is covered |
| **Speed** | Vendor-reported: 27k-file repo indexes in about 100 s; one-file re-sync about 0.3 to 0.4 s | Same core; the compiler tier adds index time | Not published; the precise tier writes to SQLite at index time, so queries should be fast. To measure |
| **Revision binding** | No: a file watcher keeps it current. Warden would index a fresh `git archive` per commit and cache by commit | Added | Yes (`history --at`) |
| **Setup** | One binary, SQLite; telemetry on by default and must be turned off | Our fork to keep, or upstream review time | Node 24.16+, SQLite; no network, no telemetry; alpha, format may change between builds |
| **Triage** | Find symbols named in the issue; no "already fixed" without history | Same, plus history if added | Find, refs and `history` give "already fixed" and "where is this" |
| **Review** | Callers and callees of changed symbols | Plus tests and docs that reach the hunk | Same as B for TS/JS, plus impact (`code_impact`) |
| **Implement / fixes** | Impact of a change, by name | Impact, compiler-exact | Impact, compiler-exact; SDK facts once the SDK pack is built (not built today) |
| **Licence** | MIT | MIT (our additions under the same) | MIT (Open GSD) |
| **Main risk** | Name-only edges send wrong context; the watcher model does not fit replay | Carrying a fork of a fast-moving project | Alpha with its own gate not met; we carry the whole build |
| **Replay must show** | Beats the pack per defect on dev, with telemetry off and a per-commit index | Same as A, and beats A on the same run (otherwise A is enough) | Same as A, and beats the ADR 0013 pack on the TS/JS cases where both are compiler-exact (otherwise the gain is the non-code references, which can be added to the pack directly) |

Not taken forward: SCIP (exact, but we would write the whole query layer, and it adds nothing over the TS LanguageService that ADR 0013 already uses for TS/JS), Joern (data flow is aimed at security; JDK 19 and a large heap), CodeGraphContext (needs a graph database, no published speed or revision handling), stack-graphs (archived).

## Consequences

- The first measurement is the ADR 0013 pack itself (`--lookup-clone`), which has never been run with a model. Every option is judged against that number, so it comes first.
- Per-defect scoring in replay is needed before any option can be judged. The current blocking agreement moves with the number of findings and double-counts wrong lines (research note, Cause 1).
- The Markdown/YAML/JSON reference extractor is common work under every option. It can be built into the ADR 0013 pack first and measured there.
- Triage gets the lookup only after ADR 0028 item 3 (read-only snapshot) is built, and its own replay is rerun.
- Implement's SDK check depends on gsd-atlas's SDK pack (option C) or an equivalent. Until it exists, Implement uses the code graph only.
- Nothing here sends code off the machine. Option A's telemetry must be off by configuration Warden sets, not by trust.

## Open questions for the owner

1. Which codegraph you use: `colbymchenry/codegraph`, or another project of that name.
2. Whether gsd-atlas has work beyond its public repo (you mentioned "the opengsd database") that changes option C's state.
