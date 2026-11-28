# The Warden of the Gate: docs (draft)

A self-maintaining GitHub software factory that reviews and merges PRs, fixes bugs, builds approved features/enhancements, and learns from maintainer decisions.

Current implementation status and continuation instructions: [November 18 handoff](docs/handoff/2026-11-18-handoff.md). The P1 scheduling gate was changed on 2026-11-28 after GitHub Support answered case #5025247: an external scheduler starts the sweep through `workflow_dispatch`, and GitHub's native schedule is only an optional backup ([ADR 0025](docs/adr/0025-external-dispatch-for-sweep.md)).

Start with the [consolidated PRD](docs/prd/0001-warden-of-the-gate.md) and [glossary](GLOSSARY.md). The MVP is one repository per instance, manually triggered local AI on a Mac with OpenCode, plus deterministic GitHub Actions housekeeping and serialized effects. Operational configuration and standing authority are separate.

## Workflow prototype

Download [the single-file workflow prototype](https://github.com/The-Artificer-of-Ciphers-LLC/warden-of-the-gate/blob/415f762b6e6db1b702c5a78b2be186c40be46193/docs/prd/0001-warden-of-the-gate.prototype.html) and open the saved HTML in a browser; GitHub displays the source, not a hosted application. No installation or server is needed. It is throwaway, in-memory code, not the MVP implementation or a proposed production dashboard. Guided tabs and free play exercise the factory loop, feature approval, contributor deadlines/holds/takeover, review reuse, correction limits, approval expiry, and uncertain merge recovery.

The prototype has no GitHub/model/network access and resets on refresh. Its visible scope notes distinguish simulated outcomes from unproven integration behavior. After user walkthroughs validate or reject the model, capture the verdict and prototype on a throwaway branch before promoting any validated logic; do not treat the shell as production UI.

On November 17, 2026, the owner provisionally accepted the workflow: "looks good for now, not seeing anything I don't like". The prototype and verdict are captured on [`prototype/workflow-2026-11-17`](https://github.com/The-Artificer-of-Ciphers-LLC/warden-of-the-gate/tree/prototype/workflow-2026-11-17), separate from `main`. This accepts the demonstrated workflow direction, not production readiness or live activation. No implementation issue is assigned yet; attach that branch reference when one is created.

The [proposed MVP implementation plan](docs/prd/0001-warden-of-the-gate.implementation-plan.md) sequences eight gated phases from capability proofs through the complete factory and explicit pilot activation. Its [coverage trace](docs/prd/0001-warden-of-the-gate.implementation-trace.json) assigns requirements and operator surfaces to delivery phases; planning coverage does not establish implementation correctness.

## Design documents

All PRDs and ADRs below are **editable working drafts**. Historical research is evidence, not current product scope; where it conflicts, use the consolidated PRD and current draft ADRs.

| File | Title | Status |
|---|---|---|
| [PRD 0001](docs/prd/0001-warden-of-the-gate.md) | End-to-end factory MVP | Draft |
| [ADR 0001](docs/adr/0001-builtin-triage-task.md) | Triage is a factory built-in | Draft |
| [ADR 0002](docs/adr/0002-stale-clocks.md) | Response and delivery clocks | Draft |
| [ADR 0003](docs/adr/0003-contributor-facing-voice.md) | Attributable GitHub App voice | Draft |
| [ADR 0004](docs/adr/0004-local-first-open-harness-runtime.md) | Local, manual open-harness runtime | Draft |
| [ADR 0005](docs/adr/0005-releasable-and-configurable-per-repo.md) | Scoped package and per-repository configuration | Draft |
| [ADR 0006](docs/adr/0006-agentrunner-adapter-seam.md) | Harness adapter and independent validation | Draft |
| [ADR 0007](docs/adr/0007-local-first-model-pool.md) | Local-only MVP, no remote fallback | Draft |
| [ADR 0008](docs/adr/0008-tiered-autonomy-and-merge-gates.md) | Risk, evidence and merge authority | Draft |
| [ADR 0009](docs/adr/0009-factory-product-boundary.md) | Product workflows versus isolated verification | Draft |
| [ADR 0010](docs/adr/0010-yaml-business-rules.md) | Declarative standing orders | Draft |
| [ADR 0011](docs/adr/0011-credential-controller.md) | Bounded credential continuity | Draft |
| [ADR 0012](docs/adr/0012-serialized-actions-state-writer.md) | Canonical ledgers and serialized Actions writer | Draft |
| [ADR 0013](docs/adr/0013-code-lookup.md) | Reviewer code lookup: prefetched, compiler-backed context pack | Draft |
| [ADR 0014](docs/adr/0014-frozen-acceptance-tests.md) | Frozen acceptance tests, written first in their own session | Accepted |
| [ADR 0015](docs/adr/0015-contract-review-human-gate.md) | Contract review as the human gate; boundary changes as proposed designs; reviewer independence | Accepted |
| [ADR 0016](docs/adr/0016-verification-loop-and-test-quality-evidence.md) | Bounded verification loop and test-quality evidence | Accepted |
| [ADR 0017](docs/adr/0017-preexisting-tests-and-differential-checks.md) | Evidence from tests that predate the change; opt-in differential checks | Decided (one detail Proposed) |
| [ADR 0018](docs/adr/0018-measured-not-estimated.md) | Measured, not estimated: weighted robust scorecards, untrusted self-assessment | Partly decided |
| [ADR 0019](docs/adr/0019-decision-model-router.md) | Decision-model router: routes work, never authorizes it | Proposed (post-MVP) |
| [ADR 0020](docs/adr/0020-review-attention-and-maintainer-understanding.md) | Review attention classes: the maintainer chooses what they keep reading | Proposed |
| [ADR 0021](docs/adr/0021-cross-family-review-panel.md) | Optional cross-family review panel, bounded rounds | Proposed |
| [ADR 0022](docs/adr/0022-new-model-starts-paused.md) | A model new to the pool starts with auto-merge paused | Proposed |
| [ADR 0023](docs/adr/0023-promise-checks.md) | Promise checks: per-repository, base against candidate | Proposed (adopted in principle) |
| [ADR 0024](docs/adr/0024-behavior-effect-at-triage.md) | Record a change's intended behavior effect at Triage | Proposed (facet adopted) |
| [ADR 0025](docs/adr/0025-external-dispatch-for-sweep.md) | An outside scheduler starts the sweep through `workflow_dispatch`; the native schedule is only a backup | Accepted |

## Research

- [PRD best-practice checks](docs/research/PRD-BEST-PRACTICES.md): verified platform constraints, credentials, approvals, state, quality and agentic turnaround guidance.
- [Decision-model router (Jev)](docs/research/DECISION-MODEL-ROUTER.md): whether a fast one-pass decision model fits as Warden's front end; router only, never a merge judge; basis for proposed [ADR 0019](docs/adr/0019-decision-model-router.md).
- [Mastra comparison](docs/research/MASTRA-COMPARISON.md): Mastra's agent framework and its Mastra Factory set against Warden's design; skip as a dependency (open-core licence with enterprise code in the core package, telemetry on by default, automatic model fallback), borrow two review rules and the eval verdict shape.
- [Code-intelligence options](docs/research/CODE-INTELLIGENCE-OPTIONS.md): Omnigraph, GSD Atlas, SCIP, CodeGraphContext and alternatives; existing capabilities versus SDK-enforcement roadmap, plus a bounded evaluation proposal.
- [Correction ladder](docs/research/FRAMEWORK-CORRECTIONS.md): design/static-first quality rationale; older rollout/autonomy recommendations are historical.
- [Vibe vs. agentic coding talk (Ableidinger)](docs/research/TALK-ABLEIDINGER-VIBE-VS-AGENTIC.md): IBM Technology explainer set against Warden; mostly confirms its controls, keeps the reproducer-first rule for bug fixes, and proposes a measured usable context length per model alongside the window guard.
- [Agent-written-code talk (Sumner)](docs/research/TALK-SUMNER-AGENT-WRITTEN-CODE.md): tests that predate the change, differential checks, special-casing and run-over-run measurement; basis for proposed [ADR 0017](docs/adr/0017-preexisting-tests-and-differential-checks.md) and [ADR 0018](docs/adr/0018-measured-not-estimated.md).
- [Pi creators live stream](docs/research/TALK-PI-CREATORS-LIVE.md): how Pi's maintainers decide what to read and trust; basis for proposed [ADR 0020](docs/adr/0020-review-attention-and-maintainer-understanding.md) (attention classes), [ADR 0021](docs/adr/0021-cross-family-review-panel.md) (cross-family review panel) and [ADR 0022](docs/adr/0022-new-model-starts-paused.md) (new models start paused).
- [McCarthy brownfield factories talk](docs/research/TALK-MCCARTHY-BROWNFIELD-FACTORIES.md): promises beyond features, preserve versus change, and coverage-guided inputs; basis for proposed [ADR 0023](docs/adr/0023-promise-checks.md) (per-repository promise checks) and [ADR 0024](docs/adr/0024-behavior-effect-at-triage.md) (preserve, change or fix, recorded at Triage).

The owner confirmed the shared MVP product understanding on November 17, 2026; the PRD review is complete and ready for implementation planning. Its final section names the remaining technical choices and capability proofs. No implementation, local-model benchmark or live activation is claimed by this documentation.

Source: owner decisions and primary-source research through November 17, 2026.
