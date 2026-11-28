# Why two different models score almost the same on replay, and what to change

**Status:** Research, 2026-11-28. No code changes in this note. Read against `main` at `30229c8`.
**Question (Tom, 2026-11-28):** switching from Qwen3.8 Flash 2bpw to Inkling 2 Mini bf16 slowed replay from about 32 minutes to about 2 hours and did not improve it. What should change instead? His view: "Pretty sure model isn't the problem here. Prompting and guardrails is." And on context: "you can't look at a block and figure out what it's doing. we need a high speed graph lookup."

| Run | Blocking agreement | Triage agreement | Source |
| --- | --- | --- | --- |
| Qwen3.8 Flash 2bpw | 14 of 33 (42%) | 14 of 32 (44%) | [REPLAY-QUALIFICATION-2026-11-28.md](REPLAY-QUALIFICATION-2026-11-28.md) |
| Inkling 2 Mini bf16 | 16 of 36 (44%) | 19 of 32 (59%) | Tom's run output, 2026-11-28 |

## Short answer

1. **The data supports Tom.** A 2-bit model and a bf16 model land two points apart on review. When very different models tie, the shared inputs are the limit: what the reviewer is shown, how its answer is checked, and how it is scored. Every cause below sits in Warden or in the replay set, not in the model.
2. **The blocking number measures less than it seems.** Its denominator moves with how many findings the model makes (that is the whole 33 vs 36 difference), a finding on the right defect but a wrong line is counted twice against the model, and a correct finding that the set does not know about counts as a false positive. Qwen's run actually caught 7 of the 14 known defects (50%), with 14 of its 26 findings on a known defect.
3. **The reviewer is shown only the diff.** In both runs no repository context was given (`--lookup-clone` was not used). Most of the 14 known defects were found later by a fix PR, and seeing them needs code or docs outside the diff. The context pack that already exists (ADR 0013) has never been measured with a model. That is the cheapest next run, and it is one flag.
4. **Triage is capped by the set, not the model.** 12 of the 32 triage expectations are maintainer policy calls (6 `wontfix`, 6 `needs-info`) made from comments and labels that the set does not contain, and the triager has no repository access. Inkling's 59% may be close to the reachable ceiling with today's inputs.
5. **Graph lookup is the right long-term lever, built as a prefetched pack first.** The published studies agree that smaller models gain from precise, prefetched context and lose when they must drive a graph tool themselves. The proposed [ADR 0029](../adr/0029-graph-lookup-for-triage-review-implement.md) sets the options (codegraph as is, extend codegraph, or build our own on gsd-atlas) and what replay must show, with the ADR 0013 pack as the baseline to beat.

## Ranked fixes

Ranked cheapest-and-largest first. "Expected effect" is a hypothesis to test on replay, not a measured result.

| # | Fix | Cost | Miss type it targets | Expected effect (hypothesis) |
| --- | --- | --- | --- | --- |
| 1 | Run replay with `--lookup-clone` (ADR 0013 pack) | One flag, plus a local clone | Misses that need code outside the diff | Recall up on the 4 cases whose defect region the pack covers; little change elsewhere |
| 2 | Score per known defect, report precision apart, show near-miss lines, judge unknown findings | Small code change in `replay.ts`; can re-score the two existing reports offline | Measurement artefacts (double-counted wrong lines, unknown-but-real findings) | The reported number tracks real catches; Qwen's true recall reads 50%, not 42% |
| 3 | Number every new-file line in the rendered patch | Small change in `review/prompt.ts` | Wrong-line findings (counted as both a false positive and a miss) | Fewer near misses; precision and recall both up a few points |
| 4 | Send the sampling settings the model card asks for | Config in `runner/opencode.ts` | Run-to-run noise, long thinking, repetition | Less variance; Inkling runtime down |
| 5 | Stop throwing away whole results: per-finding rejection and a second attempt | Small change in `review/slice.ts` and `replay.ts` | Defects lost because one finding cited an out-of-scope path or a format error | Recovers the rejected cases (9 in the Qwen run, est. 8 already rescued by PR 174) |
| 6 | Give Triage its inputs: issue comments and labels in the set, read-only repo snapshot, scope docs | Set rebuild plus ADR 0028 item 3 | Policy outcomes (`wontfix`, `needs-info`) the model cannot see | Triage up on those 12 cases; the rest unchanged |
| 7 | Aggregate several samples (about 5) | 5x runtime | Recall on hard cases; triage label noise | Recall up; diminishing past 5 (SWR-Bench) |
| 8 | Graph lookup for Triage, Review and Implement | New component, ADR 0029 | Cross-file and docs-to-code defects the pack cannot reach | Has to beat fix 1 on replay before it is used |
| 9 | ADR 0028 rule table | Already decided, not built | Format rejections and prompt/schema disagreements | Accepted rate up; ADR 0028 itself says it does not fix missed defects |

Not on the list: a bigger model. Both runs point away from it, and Tom ruled it out.

## Cause 1: the score itself

**Evidence.** `packages/warden/src/replay/replay.ts`:

- Line 103: `const den = findings + misses`. The denominator is the number of findings the model chose to make plus the known defects it missed. A model that says more gets a bigger denominator. That alone explains 33 vs 36; nothing is wrong with the set.
- Line 106: `num: findings - fps`. The numerator counts findings, not defects. Two findings on one known defect count twice.
- Line 64: a finding matches only on the same path and either the curated lines or the same changed hunk. A finding on the right defect in a neighbouring hunk is a false positive (line 67) and the defect is also a miss.
- Line 67: any finding outside `mustFind` and outside `verifiedReal` is a false positive. The set's `mustFind` is "what a later fix PR changed" (`proof/p7/REVIEW.md`). A real defect that nobody later fixed counts against the model.
- Severity is not used. A `nit` and a `blocker` count the same.

**What the Qwen run really did.** From its report: 26 findings, 12 false positives, 14 findings on a known defect, 7 of the 14 known defects caught. That is 50% defect recall and 54% finding precision. The same split for Inkling needs its report file (see "What I need from you").

**Sourced practice.**
- SWR-Bench scores reviews against 1,000 verified PRs as change-actions and reports precision, recall and F1 separately. Its best single-pass system reached F1 19.38% ([arXiv 2509.01494](https://arxiv.org/abs/2509.01494)).
- The Martian Code Review Bench matches each comment to human-verified "golden comments" with an LLM judge and reports precision and recall separately ([withmartian/code-review-benchmark](https://github.com/withmartian/code-review-benchmark/)). The best tools sit near 60 to 67% precision and 65% recall ([superdiffs table of Martian data](https://www.superdiffs.com/benchmark/noise)).
- One run moves about 5 points on that benchmark ([kaicontext](https://kaicontext.com/benchmarks/code-review/)), so a 2-point gap between our two runs is within noise.

**Fix.** Keep the PRD §11 gate, but compute it from defects: recall = known defects caught / known defects, precision = findings on a known or verified defect / findings, each with its denominator. Report near misses (right file, line outside the hunk) on their own. Send findings the set does not know about to an LLM-judge pass (as Martian does) and then to `verifiedReal`, not straight to false positives. Repeat a run before reading a 2 to 5 point change as real.

**Expected effect.** No model change, so no real improvement. It makes every later comparison readable. This is a code change, so it is a separate PR after this note; the two existing report files can be re-scored offline without a new run.

**PRD note.** The §11 bar (90% agreement) was set against today's formula. Changing the formula is an owner decision, not something to slip in.

## Cause 2: the reviewer sees only the diff

**Evidence.**
- Neither run used `--lookup-clone` ([REPLAY-QUALIFICATION-2026-11-28.md](REPLAY-QUALIFICATION-2026-11-28.md) line 13). The reviewer saw the patch text and nothing else.
- The 14 known defects come from later fix PRs (`proof/p7/REVIEW.md`), for example pr-3656: "a follow-up to #3656, fixing a defect in the guard that PR added." A later fix is, by its nature, something the original reviewers did not see in the diff either.
- 6 of the 14 defects are in `.md`, `.yml` or `package.json` files. No code graph resolves those today (Cause 8).
- The ADR 0013 pack was checked offline without a model (`proof/p7/results/lookup-check-2026-11-20.json`): it covers the defect region in 4 of 14 cases (pr-482, pr-4021, pr-5363, pr-366) and the later fix's other files in only 1 (pr-6074). So fix 1 has a known upper bound before it runs.
- ADR 0013 (`docs/adr/0013-code-lookup.md`) is still Draft: "Model effect not yet measured." The gap inventory says the same (`docs/backlog/GAP-INVENTORY-2026-11-27.md` line 188).

**Sourced practice.**
- PR-Agent adds 5 extra lines before and 1 after each hunk, and grows the window up to 10 lines until it reaches the enclosing function or class (`patch_extra_lines_before`, `allow_dynamic_context`, [configuration.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/configuration.toml)).
- ByteDance's BitsAI-CR expands context to function boundaries with tree-sitter, up to four times the diff size ([arXiv 2501.15134](https://arxiv.org/html/2501.15134)).
- ContextCRBench found the PR and issue text help more than surrounding code: adding the PR description raised F1 by 72% on quality estimation ([arXiv 2511.07017](https://arxiv.org/abs/2511.07017)). Our review cases carry the PR title but not its description.
- CodeFuse-CR-Bench and AACR-Bench both found more context can hurt non-agent reviewers: Qwen3-235B scored 47.29 with the top-1 retrieved file and 33.55 with the top-5 ([arXiv 2509.14856](https://arxiv.org/html/2509.14856v3); [arXiv 2601.19494](https://arxiv.org/html/2601.19494)). Precision of context matters more than volume.

**Fix.** Run fix 1 now (command below). Then add the PR description to review cases at set build time, and grow each hunk to its enclosing function, as PR-Agent and BitsAI-CR do. Graph lookup (Cause 8) is the step after.

**Expected effect.** Recall up on the 4 cases the pack covers. If the pack moves nothing even there, that is itself the answer: prefetched symbol context is not what these defects need, and the graph must cover docs and tests.

## Cause 3: the model must count line numbers

**Evidence.** `packages/warden/src/review/prompt.ts` line 8 renders each file as `=== FILE i: path (status) ===` followed by the raw patch, with no line numbers. Line 14 tells the model that `"line" is the line number in the NEW file taken from the patch hunk headers`. The model has to count lines from the `@@` header. A miscount lands the finding outside the hunk, which the score treats as a false positive and a miss (Cause 1).

**Sourced practice.**
- PR-Agent turns each hunk into a `__new hunk__` block with the new-file number on every line and an `__old hunk__` block for removed lines (`decouple_and_convert_to_hunks_with_lines_numbers`, [git_patch_processing.py](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/algo/git_patch_processing.py)).
- Sentry's own reviewer hit the same bug: comments land off by one because "The LLM must infer absolute line numbers by counting from the `newStart` value" ([getsentry/warden#256](https://github.com/getsentry/warden/issues/256)). Its proposed fix is per-line numbers.
- I found no controlled study that puts a number on the gain. This rests on practitioner reports.

**Fix.** Render patches in PR-Agent's numbered format. Keep `diffLines` and `sameHunk` as they are, so matching does not change.

**Expected effect.** Fewer near misses. The size depends on how many Qwen and Inkling findings sat on the right file outside the hunk; the report files show it.

## Cause 4: the model runs without its sampling settings

**Evidence.**
- `packages/warden/src/runner/opencode.ts` line 110 writes only `name` and `limit` for the model. No temperature, top_p, top_k or presence penalty is sent, so mlx-serve uses the model's own defaults (temperature 1.0 in both models' generation configs, read earlier from Hugging Face).
- Line 185 appends "Think briefly, then reply" to every prompt, while the reasoning effort the server uses is not set by Warden.
- Every case is one sample; the score of a single run carries its full noise.

**Sourced practice.**
- Qwen3's model card: thinking mode Temperature 0.6, TopP 0.95, TopK 20, MinP 0; "DO NOT use greedy decoding" ([Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B)). For quantized models it strongly recommends presence_penalty 1.5 ([Qwen3-8B-AWQ](https://huggingface.co/Qwen/Qwen3-8B-AWQ)). The 2bpw Qwen run is quantized.
- PR-Agent runs at `temperature=0.2` ([configuration.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/configuration.toml)).
- For classification and judging, low temperature gives consistent verdicts and high temperature lowers consistency ([arXiv 2603.28304](https://arxiv.org/abs/2603.28304)).
- OpenCode drops an agent's temperature for a self-declared model unless the model entry also sets `"temperature": true` ([anomalyco/opencode#42775](https://github.com/anomalyco/opencode/issues/42775)), and it has no `top_k` field at agent level. Model `options` are the route that works. I confirmed this in the code at commit `8b65fa2`, not at the current head.

**Fix.** Per model, send the card's settings through the model entry's `options` (with `"temperature": true`), and for a quantized model a presence penalty. Make "think briefly" a per-model setting rather than a fixed instruction. Check with one request that mlx-serve receives them.

**Expected effect.** Less run-to-run noise and shorter outputs. It may explain part of the Inkling runtime, which I cannot confirm without its report's per-case `wallMs`.

## Cause 5: one bad finding throws away the whole review

**Evidence.**
- `packages/warden/src/review/slice.ts` lines 133-134: a single finding that cites a path outside the PR fails the whole result. Duplicate ids and a verdict that does not match the findings also fail it whole.
- `packages/warden/src/replay/replay.ts` line 57: `maxAttempts: 1`. A failed case gets no second try, and every known defect in it becomes a miss.
- `packages/warden/src/review/prompt.ts` line 12 caps findings at 5.
- The Qwen run had 9 format rejections; PR 174's repair round is estimated to rescue 8 ([REPLAY-QUALIFICATION-2026-11-28.md](REPLAY-QUALIFICATION-2026-11-28.md)).

**Sourced practice.** BitsAI-CR keeps generation and filtering apart: a second pass decides per comment whether to keep it, which raised precision from 54.50% to 67.12% ([arXiv 2501.15134](https://arxiv.org/html/2501.15134)). Dropping one bad comment rather than the whole review is the same idea.

**Fix.** Drop the offending finding and keep the rest, recording the drop. Allow a second attempt in replay, as live review already can. Keep the cap at 5 until the per-defect score (Cause 1) shows whether it costs recall.

**Expected effect.** Recovers the rejected cases not already saved by PR 174.

## Cause 6: Triage cannot see what the maintainer saw

**Evidence.**
- `proof/p7/build-set.ts` line 19: a triage case holds only the title and the body, cut at 6,000 characters. No comments, labels or linked PRs.
- `packages/warden/src/triage/slice.ts` line 69: `tools: { allow: [] }`. The triager cannot look at the code or docs to tell "already fixed" or "out of scope".
- 12 of 32 expectations come from maintainer policy labels (`proof/p7/REVIEW.md`): `wontfix` → not-actionable on 646, 2696, 3340, 4027, 4884, 5494; `needs-info` → needs-info on 216, 381, 1650, 1697, 1989, 2167. The reason for those labels is usually in the comments or in project scope, which the model never sees.

**Sourced practice.** ContextCRBench: textual context (issue and PR descriptions) gave larger gains than code context ([arXiv 2511.07017](https://arxiv.org/abs/2511.07017)).

**Fix.** Rebuild the set with the issue's comments up to the moment of the maintainer's decision (never after, or the answer leaks), and its labels other than the one being predicted. Give Triage the read-only repo snapshot and the project's scope documents (ADR 0028 item 3). Then rerun triage alone.

**Expected effect.** Movement on those 12 cases only. If they still miss, the expectation may not be reachable from public text, and the set should mark them.

## Cause 7: runtime

Inkling took about 2 hours against Qwen's 32 minutes. The likely causes are bf16 weights against 2-bit, and long thinking at temperature 1.0 with no reasoning limit. I have not confirmed this: the per-case `wallMs` in the Inkling report would show whether a few cases ran long or every case did. It does not change the ranking.

## Cause 8: graph lookup

Tom's point is right: a reviewer that sees a block without its callers, tests and the docs that drive it is guessing. The question is how to give it that, and how fast.

### What exists

- **ADR 0013 context pack** (`src/lookup/`, `src/review/context.ts`): compiler-backed (TypeScript LanguageService), precise, inferred and text tiers, 16,000-character budget, inlined into the prompt; the model stays tool-less. TS/JS only. Covers the defect region in 4 of 14 replay cases. Never measured with a model.
- **PR 183 / Coyle talk note** (`docs/research/TALK-COYLE-ONTOLOGIES-AS-GUARDRAILS.md` lines 35 and 93) set Graph RAG aside in favour of a rule table. Looking at it again: that call was right for guardrails, which is what the talk was about, and ADR 0028 itself says missed defects need context, not rules. It did not weigh a code graph for context. This note does.

### Incumbent: codegraph

Tom uses "codegraph" through an MCP server and a SessionStart "codegraph worktree indexer" hook (`docs/research/PITFALLS.md` line 45). Several projects share the name. **I assumed `colbymchenry/codegraph`** (v1.6.5, read at commit `aedff9a`, 2026-11-28); please confirm.

- MIT licence. Native Rust parsing kernel over tree-sitter grammars for 20 languages, stored in SQLite; CLI with JSON output, a library API and an MCP server.
- Speed (vendor-reported): the 27,000-file Swift compiler repo indexes fresh in about 100 seconds; a one-file save re-syncs in about 0.3 to 0.4 seconds.
- Matching is by name (tree-sitter), not by compiler. No Markdown, YAML or JSON support in its language list.
- Kept current by a file watcher, not bound to a commit. Replay needs the graph as of each PR's head, so this has to be handled.
- Telemetry is on by default and can be turned off (`codegraph telemetry off`). Warden would have to turn it off.
- Its own benchmark measures agents answering architecture questions with fewer tool calls, not review quality.

### Roll our own: gsd-atlas

Tom's description: "a codegraph + sdk reference library for the coding agents to check against." Read at `open-gsd/gsd-atlas` commit `7147e43` (current head).

- **Code graph half.** Alpha. TS/JS only (`.ts/.cts/.mts/.js/.cjs/.mjs/.jsx`, not `.tsx`). Grammar tier plus a TypeScript-compiler precise tier, stored in local SQLite (`node:sqlite`). CLI (`find`, `refs`, `context`, `impact`, `explain`, `history`) and seven MCP tools. Revision-bound `history --at`. No network, no telemetry. Node 24.16+, macOS and Linux.
- **SDK reference half.** Designed in `docs/SDK-PROVIDERS.md`: read the project's target level (tsconfig `lib`, `engines.node`, browserslist) and answer what APIs exist at that level from files installed with the toolchain (`lib.*.d.ts`, `@types/node`, MDN browser-compat-data). **Not built**: `docs/reference/alpha-limitations.md` says "No SDK pack exists, and no built-in module has a `platform` tier."
- **Evaluation.** "OVERALL: MVP not met". Accuracy 0.80 against a grep arm's 0.75 (met), but 61% more tokens (not met) and 72.7% verifiable citations against an 80% bar (not met). The model called an atlas tool in only 38% of sessions (`docs/eval/diagnosis.md`). The project gates further work on a new registered run.
- I could not see anything kept outside the public repo. Tom mentioned atlas work "on the opengsd database"; the coordinator's reading is that this is atlas's own local SQLite store.

### Comparison

| Approach | Precision | Covers MD/YAML/JSON? | Setup | Query speed | Revision-bound | Evidence of effect on review |
| --- | --- | --- | --- | --- | --- | --- |
| ADR 0013 pack (baseline) | Compiler-exact | No | Already built; needs a clone with heads | Not published | Yes (head commit) | None yet |
| SCIP + scip-typescript | Compiler-exact, defs, refs, implementations | No | npm install, one CLI run; we write the query layer | Index 1k to 5k lines/s ([Sourcegraph](https://sourcegraph.com/blog/announcing-scip-typescript)) | One index per run | None found |
| Tree-sitter map (Aider repo map) | By name | No | In-process | Not published | No (file mtime) | None found |
| codegraph (colbymchenry) | By name | No | One binary + SQLite | Vendor: sub-second re-sync | No (watcher) | None on review |
| CodeGraphContext | Tree-sitter, SCIP optional | No | Python + graph DB | Not published | Not described | None |
| Joern code property graph | AST + data flow | No | JDK 19, docs show 30 GB heap ([Joern](https://docs.joern.io/installation/)) | Heavy | Snapshot | Built for security, not review |
| gsd-atlas | Grammar + TS compiler | No (links code comments to ADR file names only) | Node 24.16 + SQLite | Not published | Yes (`history --at`) | Accuracy +4.9 points, tokens +61%, MVP not met |

Name-only matching has a measured cost: one tree-sitter graph resolves 37% of TypeScript edges by itself and 81% with a language server on a 230-file service ([cartog](https://github.com/jrollin/cartog/), vendor-reported). Dedicated SQLite graph stores answer in under a millisecond to about 10 ms (codebase-memory, cartog, codescope; all vendor-reported), so speed is not the constraint once edges are resolved at index time.

### What the research says about how to use a graph

- **Small models do worse when they must query the graph.** CodexGraph on SWE-bench Lite: GPT-4o matched the AutoCodeRover baseline (22.96), but Qwen2-72B fell from 9.34 to 1.95; the authors say weaker models "may struggle to formulate appropriate graph queries" ([arXiv 2408.03910](https://arxiv.org/html/2408.03910)).
- **Graph context helps, by a few points.** RepoGraph added about 2 to 2.7 points absolute on SWE-bench Lite across four systems, with more tokens ([arXiv 2410.14684](https://arxiv.org/pdf/2410.14684v2)).
- **Review is not issue-solving.** On a 144-PR review study, neither static concatenation nor agent repository access beat the plain condition, and repository-aware strategies added latency ([Beyond More Context](https://sol.sbc.org.br/index.php/ise/article/view/46362)). AACR-Bench found agents improve with repository context but get worse on diff-local issues ([arXiv 2601.19494](https://arxiv.org/html/2601.19494)).
- **Agents do not reliably use offered tools.** gsd-atlas's own evaluation: tools used in 38% of sessions.
- **Anthropic's guidance** is a hybrid: retrieve some data up front for speed, and keep context to "the smallest possible set of high-signal tokens" ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

My reading of these, an inference rather than a cited finding: for a local model, build the graph lookup as a small, precise, prefetched pack chosen by the diff, with any model-driven tool optional and measured separately. That is the shape of the ADR 0013 pack, so the graph should replace its index, not its delivery.

### Gap no tool fills

None of the tools above follows references from Markdown, YAML or JSON into code: a workflow `.md` that calls a CLI command, a `package.json` script that names a file, a YAML step that runs a script. 6 of the 14 replay defects sit in those files. gsd-core is a workflow toolkit where much of the behaviour is in Markdown, so this has to be built whichever option is chosen. The ADR 0013 pack's exact-token text tier is the closest thing today.

## The next replay

Test fix 1 alone, on the same Inkling setup, so the only change is the context pack. One-time setup of a gsd-core clone with every PR head (references only), then the run. Replace the path on the first line with your set file.

```zsh
SET_FILE=~/path/to/gsd-core-maintainer-set.json
git clone https://github.com/open-gsd/gsd-core.git ~/projects/gsd-core-lookup
git -C ~/projects/gsd-core-lookup fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'
cd ~/projects/warden-run
node packages/warden/dist/cli.js replay --runner opencode --set "$SET_FILE" --context-limit 573440 --trusted-ref replay-inkling --lookup-clone ~/projects/gsd-core-lookup
```

Use the same `--model-url` and other flags as your last Inkling run if you passed any. The full set (not `--split`) is used so the result compares directly with the two runs above; both earlier runs already used the full set, so no case is still unseen.

**Reading the result.** Look first at the 4 cases the pack covers (pr-482, pr-4021, pr-5363, pr-366). If they move, the pack works and the graph should extend its reach. If they do not, prefetched symbols are not what these defects need, and the graph work should start with docs and tests.

## What I need from you

The two report files, so I can re-score both runs per defect without a new run:

- Qwen: `replay/report-2026-11-28T04-13-20-472Z.json` in the Warden home on your Mac
- Inkling: the newest `replay/report-*.json` from this afternoon

From them I would check: findings on a known defect's file but outside its hunk (Cause 3), findings per case, rejection reasons (Cause 5), the triage `got` labels on the 12 policy cases (Cause 6), and per-case `wallMs` (Cause 7). You do not need to review any rows.

## What I could not check

- The Inkling report, so its defect recall and precision are not split out here.
- The current head of OpenCode's sampling code (checked at commit `8b65fa2`).
- Which "codegraph" Tom uses, and anything about gsd-atlas outside its public repo.
- Where PR-Agent defines `diff_hunk_format`.
