# Code-Intelligence Options

**Researched:** 2026-11-17

**Scope:** Local code lookup, graph-based impact analysis, and SDK enforcement for the [Warden PRD](../prd/0001-warden-of-the-gate.md).

**Status:** Evaluation approach approved; exact graph provider not selected.

This note recovers and consolidates the completed background research. The final consolidation independently checked the key Atlas limitations, Omnigraph description, SCIP description, CodeGraphContext description, and current licenses. No candidate was installed, benchmarked, or executed. Repository documentation is evidence of advertised capabilities, not proof of their correctness on the pilot.

**Owner decision:** use compiler-backed lookup as the baseline; evaluate pinned Atlas and SCIP or CodeGraphContext alongside it. Retain Omnigraph as a possible storage layer. Keep SDK enforcement in actual compiler/SDK/lint checks rather than depending on unshipped Atlas packs. The exact graph dependency follows measured results; detailed proposed benchmark thresholds below are not independently approved rollout guarantees.

## Summary

- **Omnigraph is already MIT-licensed.** "More open" must distinguish licensing, local operation, documented interfaces, portable indexes, and usable code extraction rather than assume Omnigraph is proprietary.
- **Omnigraph supplies a general graph database, not a documented turnkey source-code indexer.** It could store an extracted code graph, but an extractor, symbol resolver, revision tracking, and lookup adapter would still be needed.
- **GSD Atlas is a relevant local code-intelligence candidate.** Its current alpha offers TypeScript/JavaScript lookup and impact tools over CLI/MCP. Its published limitations explicitly exclude platform SDK facts, enforcement hooks, TSX, and resolved cross-package references.
- **SCIP/scip-typescript and CodeGraphContext are credible open alternatives.** SCIP gives a portable semantic index but needs a query consumer; CodeGraphContext provides a graph/MCP tool with additional runtime and database dependencies.
- **Lookup is not enforcement.** Compiler/type checks, dependency-boundary checks, lint, SDK/deployment-target checks, sandboxing, and deterministic authorization must remain independent of model or graph suggestions.
- **Do not silently remove code intelligence.** Require useful, revision-correct lookup and measure graph-specific impact value before choosing a mandatory provider.

## 1. Omnigraph

Sources: [README at the inspected revision](https://github.com/ModernRelay/omnigraph/blob/6fc2f823621ee37784066a6fae51b2f8e8ad131e/README.md), [license](https://github.com/ModernRelay/omnigraph/blob/main/LICENSE), [MCP interface](https://github.com/ModernRelay/omnigraph/blob/6fc2f823621ee37784066a6fae51b2f8e8ad131e/docs/user/operations/mcp.md).

Omnigraph describes an object-storage-native graph database with typed ontology, branching, vector/BM25/graph retrieval, and an open Lance data format. It offers local storage, HTTP and MCP interfaces, and SDK integrations. Its optional cloud offering is separate from the MIT core.

Its schema and Cedar policies constrain graph operations; they do not prove source-code API usage is valid. The inspected README and repository layout did not establish a source parser, compiler-backed references, code call graph, or automatic association between indexed facts and Git commits. This is a bounded finding, not proof that no future extension exists.

**Fit:** retain as a possible storage backend, not a drop-in replacement for Atlas or a language service. Using it for Warden would require the code-intelligence extraction and freshness layer. Cloud defaults, embedding-provider behavior, and the separate Studio license require review before any adoption.

## 2. GSD Atlas

Inspected revision: `7147e43b0ff8248753dc2e9f52a1607d60a712e0`.

Primary sources:

- [Alpha limitations and evaluation status](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/reference/alpha-limitations.md)
- [MCP tools](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/reference/mcp.md)
- [TypeScript support](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/reference/typescript-support.md)
- [Freshness and writer lease](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/explanation/how-freshness-and-the-writer-lease-work.md)
- [Evaluation analysis](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/eval/analysis.md), [diagnosis](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/eval/diagnosis.md)
- [Product design](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/PRD.md), [SDK-provider research](https://github.com/open-gsd/gsd-atlas/blob/7147e43b0ff8248753dc2e9f52a1607d60a712e0/docs/SDK-PROVIDERS.md), [license](https://github.com/open-gsd/gsd-atlas/blob/main/LICENSE)

### Implemented and documented

MIT-licensed, local macOS/Linux operation; indexing and answering questions open no network connection and send no telemetry. The alpha requires Node 24.16.0 or newer and Git. It exposes seven stdio MCP tools, including symbol finding, references, context, and impact, plus CLI commands.

The TypeScript precise tier uses the project's compiler when it is 6.x, otherwise the bundled 6.0.3 compiler; fallback and unavailable precision are reported as degradation. Grammar-level extraction complements compiler information. Freshness uses reconciliation, content identity, a writer lease, and optional watching rather than assuming a watcher sees everything.

### Current gaps relevant to Warden

- No TSX indexing; JavaScript JSX is supported.
- No claimed resolved references between packages in a multi-package repository.
- No TypeScript 7 resolver.
- No stable interface/index compatibility promise.
- No platform SDK fact packs, Swift module, or shipped agent-enforcement hooks.

**SDK enforcement:** Atlas's planned SDK facts concern platform API availability and deployment targets, not simply access to an agent SDK. A research routing hook is not a shipped enforcement layer. Warden cannot claim this capability exists today or make graph retrieval the security boundary.

### Existing evaluation

Atlas reports a registered evaluation of 450 sessions under Claude Code:

| Measure | Atlas | Grep baseline | Published outcome |
|---|---:|---:|---|
| Accuracy | 0.8000 | 0.7511 | Accuracy criterion met |
| Mean billable tokens/session | 47,375.1 | 29,393.1 | Token criterion not met |
| Non-abstaining sessions with verifiable citations | 72.7% | 73.7% | Citation criterion not met |

Its published overall verdict is that its MVP gate was not met. The diagnosis reports Atlas calls in only 86/225 Atlas sessions and substantial tool-definition overhead. These results do not prove Atlas is unsuitable for Warden: different local models, routing, and task mixes require a new evaluation. They do preclude presenting its benefit as already established.

**Fit:** a first-class candidate for a pinned, read-only integration experiment. Do not promise its future SDK packs as an existing Warden dependency.

## 3. Open alternatives

| Option | License / interface | Value | Limits and integration work |
|---|---|---|---|
| TypeScript compiler/language service | Apache-2.0; compiler/LSP interfaces | Exact definitions, references, diagnostics; includes TSX/JSX support | Not a persistent graph. Harness integration and safe plugin/config loading must be validated against the pinned OpenCode version. |
| SCIP + scip-typescript | Apache-2.0; protobuf index, bindings and CLI | Portable semantic symbol/reference index; TS/JS and workspace-aware indexing | Format plus indexer, not a complete MCP query service. Needs a consumer; batch index must be associated with the exact source revision. |
| CodeGraphContext | MIT; CLI and MCP | Graph queries, caller/callee relationships, class hierarchy, watching; TS/JS among supported languages | Python and graph backend footprint. Tree-sitter-derived relationships must not be presented as compiler-exact; TS-specific SCIP support needs verification. |
| Kythe | Apache-2.0; extractors, indexers and serving ecosystem | Rich graph/cross-reference model; TypeScript indexer exists | Build-centric/Bazel ecosystem; heavier integration. TS quality and Mac pilot footprint untested. |
| Joern | Apache-2.0; code-property-graph queries and server | Call/data-flow analysis, especially useful for deeper analysis | JVM/tooling footprint; JavaScript frontend documented, exact TypeScript coverage not established by this investigation. |
| Serena / SolidLSP | Serena application GPL-3.0-or-later; SolidLSP MIT; MCP/LSP | Local symbol/reference tools; alternative ready-made lookup surface | Not itself a persistent graph. Current component licensing differs from historical MIT releases; assess distribution terms, do not call it non-open merely because it is copyleft. |

Primary sources: [TypeScript](https://github.com/microsoft/TypeScript), [SCIP](https://github.com/scip-code/scip/blob/be1d9f769a02a11be3b3ec5485231e2531a78a1c/README.md), [scip-typescript](https://github.com/sourcegraph/scip-typescript), [CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext/blob/f09cf00af9e13969ab31c5841ed39670cd00d9f1/README.md), [Kythe](https://github.com/kythe/kythe), [Joern](https://github.com/joernio/joern), [Serena component licensing](https://github.com/oraios/serena/blob/main/LICENSE).

Additional leads retained from the research: [GitNexus](https://github.com/abhigyanpatwari/GitNexus) requires particular license review; the inspected research identified noncommercial restrictions, so do not assume permissive redistribution. [Stack graphs](https://github.com/github/stack-graphs) was identified as archived. [Glean](https://github.com/facebookincubator/Glean) is another heavier fact-database option; TS/JS integration was not established. [ast-grep](https://github.com/ast-grep/ast-grep) is useful structural search/lint, not a substitute for precise references or a call graph.

Omnigraph, Atlas, and CodeGraphContext are all MIT in the inspected core projects. SCIP provides an especially clear open interchange format. There is no single defensible "more open" ranking across licenses, data portability, and deployment.

## 4. Capability contract and enforcement

Require useful lookup independently of provider:

1. Definitions and references with verifiable source locations; distinguish exact from heuristic relationships and explicitly report unsupported languages.
2. Repository and revision/worktree identity, freshness, compiler/SDK context, and degradation on every relevant answer. Review must support both base and candidate inputs, not silently index only the default branch.
3. Caller/impact and diff-scoped affected-area queries evaluated on actual pilot changes, including workspace boundaries.
4. Local-only indexing/querying, restricted read-only interfaces, no automatic repository plugins or executable setup. Repository configuration may be parsed as data; a useful TypeScript service still needs its project configuration.
5. Index unavailability is visible. An approved alternate lookup path may continue, but missing precise evidence is not "no references" and cannot authorize a merge. Missing mandatory verification blocks the affected action.
6. Decision-corpus retrieval stays independent of the code index.

Warden owns deterministic permissions, provider/model validation, citation/revision checks, protected verification results, and effect authorization. OpenCode's current documented policy semantics are not interchangeable with Warden's deny/approval-wins contract. Pin the supported harness and prove the effective behavior; do not rely on historical V1 plugin/SDK snippets.

For platform SDK availability, use the actual pinned compiler, SDK/deployment target, type declarations, lint and compatibility tooling. A graph may help find and explain usage, but does not establish runtime compatibility by itself. Unsupported SDK checks must be reported and escalated, not invented as a successful Atlas feature.

## 5. Bounded evaluation proposal

The evaluation approach is approved; this detailed protocol is a proposal, **not an executed benchmark or a selected graph provider**.

Use the same pinned local model and harness, identical tasks and budgets, and pinned repository snapshots. Include the pilot, a TSX/workspace fixture, and plain JavaScript. Compare a symbol-service/search baseline, Atlas, and one other viable graph/index candidate (SCIP consumer or CodeGraphContext). Do not build every alternative before deciding.

Use 65 lookup cases: 15 definitions, 15 reference sets, 10 caller/impact, 10 cross-package, 10 real PR diff-impact, and five absent-symbol cases. Establish compiler-backed ground truth where applicable and manually assess impact expectations rather than treating a reference set as complete behavioral impact.

Report accuracy/precision/recall, verifiable citations, impact misses, abstention, cold/warm indexing time, RAM/disk, wall time, total local tokens including tool-definition overhead, and tool usage. Exercise edits, renames, branch/worktree switches, stale indexes, and unavailable providers.

Provisional comparison targets: exact-tier definition/reference precision at least 95%, reference recall at least 90%, and at least a five-percentage-point improvement on impact tasks without more than 20% additional mean token use or task time. These are selection hypotheses to review, not safety claims. Require **zero accepted wrong-revision citations or unauthorized effects** regardless of provider. SDK/enforcement probes must reject unauthorized actions independently of which lookup arm runs.

Select the smallest provider combination that meets the required capability contract. A language-service baseline is a recommendation, not permission to drop graph evaluation or the user's SDK-enforcement objective. Record a separate provider decision after the spike.

## 6. Unresolved identification and limits

The existing Warden research names Memtrace tools `get_impact` and `recall_decision`, but does not establish an unambiguous project URL/vendor/license. Do not compare unrelated products with that name. Keep it a candidate only after its exact source and terms are identified.

No Warden-local performance or SDK-enforcement validation was performed. Candidate claims are time-bound to the inspected documentation; licenses, language coverage and interfaces must be rechecked at the version selected for shipping. The core recommendations do not depend on unverified star counts, inferred maturity from popularity, or a claim that one model's benchmark generalizes to another.
