# Warden MVP implementation plan

- **Status:** Proposed implementation sequence; no implementation or live activation claimed
- **Date:** 2026-11-17
- **Contract:** [Owner-reviewed PRD](0001-warden-of-the-gate.md) and [twelve draft ADRs](../../README.md#design-documents)
- **Workflow evidence:** Owner provisionally accepted the [offline prototype](https://github.com/The-Artificer-of-Ciphers-LLC/warden-of-the-gate/blob/415f762b6e6db1b702c5a78b2be186c40be46193/docs/prd/0001-warden-of-the-gate.prototype.html); capture branch [`prototype/workflow-2026-11-17`](https://github.com/The-Artificer-of-Ciphers-LLC/warden-of-the-gate/tree/prototype/workflow-2026-11-17), commit `415f762`.
- **Review-slice evidence:** Owner accepted the single shadow-review logic model on 2026-11-17; capture branch [`prototype/review-slice-2026-11-17`](https://github.com/The-Artificer-of-Ciphers-LLC/warden-of-the-gate/tree/prototype/review-slice-2026-11-17), commit `21e7eea`. See the first P3 checkpoint below.
- **Coverage:** [Decision/capability trace](0001-warden-of-the-gate.implementation-trace.json). IDs below identify delivery ownership, not new product requirements.

## What this plan commits to

Deliver the complete eight-task factory, not a review-only release. The deployment remains one repository per instance, a prepared Mac, TypeScript/Node, an OpenCode adapter and local inference, with deterministic GitHub Actions bookkeeping and the shared Actions writer. Do not copy the prototype shell into production.

Every phase must leave an operator-reachable slice and observable evidence. A passing library test alone does not complete a promised command or workflow. Earlier slices are development milestones, not independently live-ready MVPs. All phases are necessary for the complete MVP.

Production AI effects stay disabled through P6. An operator may separately authorize deterministic housekeeping after P2's gate. Test mutations use a disposable repository and dedicated, explicitly approved test authority; no pilot backlog mutation, real contributor notification, package publication or production activation is implied by implementing a phase.

The existing PRD and ADRs remain editable drafts. Where an implementation proof fails, record the blocker and revise the affected draft with the owner rather than substituting a weaker guarantee.

## Sequence and dependencies

| Phase | Deliverable | Prerequisites | Exit gate |
|---|---|---|---|
| P0 | Capability proofs and bounded technical choices | None | Writer/recovery and harness/isolation approaches demonstrated, or implementation blocked |
| P1 | Secure CLI-to-writer walking skeleton | P0 | Setup, validation, status, stop/resume and one deterministic dry-run are wired end to end |
| P2 | Offline-capable bookkeeping and safe adoption | P1 | Intake, Claim and Sweep work without the Mac or inference |
| P3 | Bounded local Triage/Review and measured lookup | P2 | Useful shadow runs with independent evidence, reusable reviews and bounded scheduling |
| P4 | Implement/Rework and gated merge loop | P3 | Bug, feature, contributor and takeover paths complete in the disposable repository |
| P5 | Discord, Retro and data-management completion | P4 | Human decisions, learning proposals and privacy controls are operator-reachable |
| P6 | Installable release candidate and upgrade path | P5 | A prepared-Mac operator can follow the packaged quickstart without undocumented steps |
| P7 | Pilot replay, recovery qualification and explicit activation | P6 | All acceptance thresholds met; maintainer separately authorizes live scope |

This is the delivery order, not a requirement to put each phase into one large PR. Within P0, writer/recovery and harness/isolation proofs can proceed independently; neither can compensate for failure of the other. Later phases reuse earlier mechanisms rather than building alternate writers, approval stores or task engines.

## P0 - Prove the platform before building on it

**Owns:** `PROOF-inbox`, `PROOF-runtime`, `PROOF-lookup`.

### Work

1. **Durable inbox and writer:** choose a concrete durable-intent mechanism independent of Actions' bounded pending queue. Keep one item-ledger authority, no competing repository ledger file and no new always-on database requirement. Document request admission, immutable operation identity, authorization, enumeration/recovery, acknowledgements, retry bounds, payload limits, retention and failure visibility.
2. **Actual serialization:** demonstrate one shared writer for deterministic events and local results. Prove the implementation prevents overlapping writers; an Actions concurrency setting or ledger revision number alone is not the proof. Exercise two claims for one issue and a contributor/factory ownership race. Explain global/instance stop visibility across Mac and Actions.
3. **Pinned OpenCode and containment:** select a supported version and prove fresh headless sessions, Ajv-validatable output, effective tool restrictions, actual resolved local provider/model, cancellation and finite resource controls. Select and test a real Mac-supported OS/container execution boundary; a worktree is only a workspace.
4. **Lookup/SDK feasibility:** demonstrate compiler/language-service definitions and references on representative pilot code with revision-bound locations. Identify a feasible SCIP or CodeGraphContext comparison candidate alongside pinned Atlas; the full measured comparison belongs to P3. Identify the compiler/SDK/deployment-target checks that can actually be supported.

### Acceptance

- A maintainer can invoke documented proof commands against a disposable repository. Each reports its inputs, versions, observed effects and pass/fail, not only a narrative recommendation.
- Crash before an effect, effect applied/reply lost, duplicate/out-of-order triggers, interrupted multi-effect application, an Actions outage and triggers exceeding the applicable pending-queue capacity all recover from durable records. No intent silently disappears and no acknowledged claim has two owners.
- Repository code, hooks, install scripts and attempted tool escalation cannot read home credentials or unrelated files, obtain write tokens, escape the workspace, or reach unapproved network destinations. Missing containment or unknown permissions blocks execution.
- A configured-local default with an actually remote resolution is rejected. Local unavailability produces no hosted-model request. Cancellation leaves recoverable work and reports any already accepted external request honestly.
- The selected inbox, authority/stop storage, trust-root store, isolation backend and pinned harness versions are recorded in the existing relevant ADRs with the supporting proof results. If a necessary guarantee is unavailable, stop the dependent work.

**Explicit hand-off:** production writer/credentials/control implementation goes to P1; full code-intelligence comparison and enforcement coverage go to P3. P0 spikes are evidence, not automatically production modules.

## P1 - Secure walking skeleton and operator controls

**Owns:** `CORE-instances`, `CORE-config`, `CORE-authority`, `CORE-state`, `CORE-writer`, `CORE-credentials`, `CORE-stop`, `CORE-approvals`, `CORE-storage`; `UX-setup`, `UX-config`, `UX-status`, `UX-stop`, `UX-resume`.

### Work

- Create the versioned TypeScript/Node CLI skeleton and the single thin `AgentRunner` contract; do not build a plugin framework or a second adapter.
- Implement both versioned YAML schemas and real default materialization, combined validation, schema compatibility and effective-policy evaluation. Use Ajv for the result/schema contracts required by ADR 0006.
- Implement typed issue/PR states, independent facets, blockers/resumption reasons, ownership, leases/attempts, evidence identities, obligations and operation records. Issues must not be assigned fictional PR heads.
- Implement the proven durable inbox, serialized Actions writer, protected local recovery journal, label projections and reconciliation. All effect paths, including maintainer overrides, use this writer.
- Implement GitHub App issuance/renewal/rotation/recovery within the operator ceiling, explicit opt-out, bounded backoff, redacted lifecycle audit and deliberate-revocation handling. Keep root/write credentials outside model sessions.
- Implement operator/global/instance stop and explicit resume, writer-enforced operating modes, GitHub-native maintainer decisions, identity/scoping checks, the decision corpus's durable record, and revision/policy/evidence-bound action approvals. Enforce the configurable 24-hour action expiry and durable feature-design approval here, before merge work.
- Protect/redact local state from its first write. Apply the 30-day transcript default and separate audit/decision retention; full export/purge surfaces land in P5.

### Acceptance

- `warden setup` checks prerequisites and creates only explicitly approved missing starter files/labels. Existing files are not overwritten; setup neither adopts backlog nor activates live AI.
- `warden config validate` reports malformed/unsupported configuration, conflicting policy and unsafe effective defaults. Denial/human gates prevail; mandatory limits cannot be weakened, and a PR cannot authorize itself.
- `warden run --task intake --dry-run` reaches the core and produces a proposed transition without repository mutation. Tasks not implemented yet return an explicit unsupported/not-ready outcome, never fabricated success.
- `warden status` works without a model and exposes state, ownership/deadlines, last sweep, pending/uncertain operations, credentials, stop acknowledgements, blockers and evidence freshness without secrets.
- `warden stop` cancels new local model/verification work, requests the shared stop and reports local versus remotely confirmed state. If propagation fails, it reports the unconfirmed remote stop rather than claiming global success. Writers fail closed on unknown controls. Accepted external effects remain reconcilable.
- `warden resume` requires explicit operator action and does not start AI, restore revoked authority or reset persisted retry/rework counts.
- An authorized maintainer can approve/deny via the documented GitHub-native path; the writer records the decision before it can authorize work. Unauthorized identities, replayed/stale approvals and approval-policy conflicts fail visibly.
- Two configured instances on the same host cannot exchange mutable state, authority or decisions. Issuer outages retain pending work; credential recovery resumes only authorized operations and never switches to a broader PAT.

**Explicit hand-off:** complete deterministic task behavior/adoption goes to P2, bounded model-backed scans to P3, all promised data commands to P5, and packaged installation/upgrade to P6.

## P2 - Deterministic housekeeping and fair contributor commitments

**Owns:** `OPS-intake`, `OPS-claims`, `OPS-deadlines`, `OPS-sweep`, `OPS-drafts`, `OPS-adoption`, `OPS-attribution`, `OPS-external`; `UX-intake`, `UX-claim`, `UX-sweep`, `UX-adopt`.

### Work and acceptance

- `warden run --task intake`, `--task claim` and `--task sweep` reach registered built-ins through the shared writer; corresponding Actions event and sweep handlers run without inference or a live Mac. The sweep is started through `workflow_dispatch` by an external scheduler, with the native schedule only an optional backup ([ADR 0025](../adr/0025-external-dispatch-for-sweep.md)). No product workflow or arbitrary repo command becomes a factory task.
- Intake checks templates/metadata and explicit routes. Similarity flags a candidate only; it cannot establish a semantic duplicate, close an issue or mark a review complete.
- Contributor volunteering assigns only an eligible unclaimed issue, after a fresh ownership check and confirmed GitHub assignment. Unrelated commenters cannot claim/extend for an assignee. Competing claims and factory starts leave one confirmed owner.
- Preserve actual assignment/submission timestamps. Initial delivery is 48 elapsed hours from assignment; only genuinely complete ready-for-review work with evidence satisfies it. Record plausible timely delivery before unavailable semantic assessment; ambiguity waits for assessment rather than false takeover.
- Published substantive blocking reviews start 48-hour fix windows. Comments and placeholder pushes cannot renew them; review/CI wait is not author delivery time. Approved earlier commitments, pre-expiry extensions, material scope changes and unexpired-time holds/release notices behave as specified.
- Stop is not a contributor extension. Author/CI observations can arrive while Warden is stopped or the Mac is off; record source timestamps and reconcile them before overdue enforcement, without starting AI or bypassing the stop on effects.
- Sweep independently implements 48/72-hour response nudges, five-day response closure, 14-day reproduction and 28-day other-information windows. Author responses reset silence only; CI/factory activity does not. Honor `keep-open`, enabled designated drafts, confirmed/approved issues, unreviewed PRs and maintainer waits.
- A missed obligation releases the claim, closes unfinished PRs with explanation and retains the original issue, partial-work references and return path. Contributor fix-round exhaustion routes to the maintainer, never automatic closure solely for reaching three timely rounds.
- Draft policy covers both newly opened and converted-to-draft PRs, retains valid claims and never merges a draft. Existing drafts are handled only by deliberate adoption.
- Adoption has an operator-reachable dry-run inventory, explicit item selection/confirmation and an auditable receipt. Preserve existing owners/valid commitments; new clocks start at published adoption notice, never historical assignment. No blanket backlog closure.
- Contributor-facing messages use configurable voice and the configured App, distinguish AI-assisted proposals from deterministic notices and never impersonate a maintainer or hardcode a model vendor.
- Reconcile externally closed/merged/reassigned work, deleted/mismatched label projections and stale intents without reopening intentionally closed items.

**Proposed interface completion:** the PRD promises inventory/adoption but does not name its command. Reserve `warden adopt --dry-run` and `warden adopt --selection <inventory-file>` for an explicit, reviewed selection/confirmation flow. Before implementing it, settle the exact syntax in PRD section 10; never silently put adoption inside ordinary setup. The inventory is an input/receipt, not a second canonical item ledger.

**Phase gate:** deterministic housekeeping may be enabled only by a separate explicit operator choice after these disposable-repository checks pass. That choice cannot enable AI posting or merging.

## P3 - Useful local shadow scans, Triage and Review

**Owns:** `AI-adapter`, `AI-local`, `AI-scans`, `AI-queue`, `AI-triage`, `AI-review`, `AI-verification`, `AI-lookup`, `AI-graph`, `AI-sdk`, `AI-decisions`; `UX-run`, `UX-triage`, `UX-review`.

### First checkpoint: one live shadow review

Before the rest of P3, deliver the thinnest useful slice: a maintainer manually runs one Review scan against one pull request in the disposable repository, and a pinned OpenCode session on the local model produces a read-only review. This is a development milestone, not a live-ready MVP; no AI post, merge or contributor-branch write is possible. Its behavior is the accepted [review-slice prototype](https://github.com/The-Artificer-of-Ciphers-LLC/warden-of-the-gate/tree/prototype/review-slice-2026-11-17); lift the validated pure model, never the HTML shell.

- Preflight refuses to start when stopped, containment is unverified, the resolved model is remote, or the local model is unavailable; there is no hosted fallback.
- A fresh serial session receives a prefetched snapshot bound to one head. The result is accepted only after Ajv validation and independent scope/identity validation, and only if the head has not moved. Rejections are whole, never partial.
- The review marker advances only on an accepted review. The attempt budget is persisted and survives restart; it resets only on acceptance. The prototype's budget of 3 is a guess to settle in P3.
- Unchanged head and checks reuse the accepted review with no model call; a checks-only change re-evaluates gates with no model call; a new head gets a delta review that revalidates earlier findings.
- Stop cancels and checkpoints the running scan, and resume starts nothing and resets nothing.
- The result is a draft decision card visible only to the maintainer.

**Checkpoint gate:** the prototype's seven walkthroughs are reproduced against real components in the disposable repository, with observed evidence rather than narrative.

### Work and acceptance

- `warden run [--task <name>] [--dry-run]` wires bounded snapshot dispatch. `--task triage` and `--task review` invoke the pinned OpenCode adapter in fresh serial sessions. No scheduled AI, polling loop, wait-for-human or wait-for-CI session is introduced.
- Enforce and persist finite item, model-turn, wall-time, context/resource and operation-retry budgets; report completed/pending/blocked/deferred work and exit. Failures checkpoint; cold starts cannot reset exhausted allowances. New arrivals/new AI-ready work wait for another invocation.
- Deterministic priority/aging/capacity selects authorized urgent work, finishing review/rework, then other work while preventing permanent starvation of approved features. Blocked entries retain age; urgent items do not bypass authority or the implementation cap.
- Validate actual resolved local routing and effective tools every execution, revalidate structured results with Ajv, then independently validate identities/scope/effects. Malformed and semantically unsafe results are rejected, not applied as partial success.
- Triage confirms bugs with suitable evidence or requests precise information/escalates; kind, severity, risk and quick-win facets stay separate. Feature/enhancement proposals include the PRD's design/acceptance/migration/alternatives questions and wait for scope approval. `wontfix` remains a maintainer decision.
- Review is read-only, with prefetched inputs and restricted lookup. Findings include severity, location, rationale and correction. Only an accepted completed Review advances its marker; failed attempts remain retryable/auditable.
- Reuse unchanged accepted inputs; new heads receive delta/impact review and unresolved-finding revalidation. Material policy/base/evidence changes invalidate affected conclusions with reasons; unrelated base advances get compatibility assessment, not automatic full re-review.
- CI/approval-only changes reevaluate deterministic gates with no model call. No contributor code edits or automatic AI posts occur in shadow.
- The trusted isolated executor, not the model, captures commands/inputs/status/output/artifacts and baseline/candidate evidence. Detect weakened lint, skipped tests, assertions, exclusions and checks. Structural defects use static evidence; behavioral/race/recovery claims need appropriate dynamic evidence. Baseline failures remain explicit.
- Compiler/language-service lookup returns precise definitions/references and citations tied to repository/content/revision/compiler/SDK freshness. Heuristic/degraded/unsupported results are labeled. Missing mandatory evidence blocks the relevant task, not the entire service or an invented pass.
- Run the approved bounded comparison: compiler-backed baseline, pinned Atlas, and one viable SCIP or CodeGraphContext implementation. Measure graph-specific impact value, accuracy, citations, revision correctness, latency, memory and local token overhead on representative pilot tasks. Record versions, cases, denominators, raw evidence and limitations. Select a graph dependency only from results; no mandatory graph database, unshipped Atlas SDK pack or unidentified Memtrace dependency.
- Enforce actual supported SDK/API/deployment targets through compiler/type/lint/compatibility checks, separate from lookup. Publish supported and unsupported checks; test stale indexes, unavailable providers and denied alternate lookup.
- Retrieve applicable decisions by authorized identity/repository/scope. Preserve denials even without reasons, request useful rationale without weakening a ruling, and escalate conflicts. Reconsideration must cite material new evidence and the old ruling.

**Mode distinction:** AI shadow results stay local; independently authorized deterministic housekeeping may still run. Global dry-run is the stronger instance-wide mutation prohibition: the shared writer must also block deterministic housekeeping and previously queued effects, not just model-generated intents. `--dry-run` must establish/confirm that protection or report that global dry-run could not be established; a local flag alone is insufficient. Reports identify the effective mode and any unconfirmed control state.

**Explicit hand-off:** Implement/Rework and live-capable merge delivery go to P4, complete Discord/Retro/data surfaces to P5, tested pilot budgets/matrix and replay qualification to P7.

## P4 - Complete the factory loop, including eligible auto-merge

**Owns:** `FACTORY-implement`, `FACTORY-takeover`, `FACTORY-rework`, `FACTORY-merge`, `FACTORY-risk`, `FACTORY-containment`; `UX-implement`, `UX-rework`.

### Work and acceptance

- `warden run --task implement` selects authorized unclaimed bugs or approved features, checks current scope/base/ownership, enforces the default one-open-factory-implementation-PR cap and runs only in the proven boundary. Other eligible reviews/triage still proceed.
- A bug has suitable fail-before/pass-after evidence; a feature is verified against approved acceptance criteria. Material scope/interface/migration/blast-radius changes return to a maintainer; ordinary details do not cause unnecessary design reapproval.
- PR-opening intents include scope, approach, evidence, attribution and Merge Danger. Implement never claims review/merge completion or advances the review marker.
- Takeover starts from trusted base, reads abandoned work as data, assesses/ports sound contributions with credit and completes the agreed solution without executing abandoned hooks or editing the contributor branch.
- Contributor PRs are review only (PRD §5 Review ruling, revised 2026-11-25; ADR 0008): failing checks are reported to the author as findings, and Warden pushes nothing to a contributor's branch. Where the repository requires approval for workflow runs on a contributor's PR, Warden at most approves or does not approve the run, after a capability proof.
- `warden run --task rework` changes factory branches only, against current named findings, verifies and returns to Review. Persist three-cycle accounting across restarts/replacement PRs; no-progress completed attempts consume cycles. Failed launches have separate bounded persistent retries. Success on cycle three can merge; unresolved findings after cycle three escalate.
- Contributor fix rounds persist with claimed work and, after three timely rounds with findings remaining, stop for the maintainer without false abandonment. An explicit extra-round/takeover decision is enforceable through the P1 approval path.
- Auto-merge supports both contributor and factory PRs, bugs and approved features. Blocker is always a gate; major/minor/nit default on and follow approved configuration. Risk is assessed independently of severity/model confidence.
- High-risk/uncertain work, workflow/access/maintainer/standing-order/self-authority changes and `wontfix` require the maintainer. Verified automation-origin dependency/CVE fixes can auto-approve/merge only within authority; spoofed labels, breaking majors and migrations cannot bypass escalation.
- Preflight required GitHub checks/reviews/rules and genuine approval independence, including an App's own PR. A second model session is not an independent GitHub identity; explain incompatible branch rules rather than bypassing them.
- Enqueueing is not merging. At delivery, re-read head, relevant base, policy, evidence, approval expiry, ownership, hold and stop; bind the request to expected head and reconcile actual outcome. Repeated delivery, lost acknowledgement and stale requests produce no duplicate accepted merge effect.
- Confirm actual merged scope before resolving linked issues. CI/approval events can complete a currently reviewed eligible merge through Actions without inference, but cannot supply a missing review.
- A critical escape/unauthorized effect pauses affected scope, preserves evidence and alerts the maintainer. Recovery proposes a current-state-aware targeted remediation/revert, not blind rollback; resume requires explicit review.

**Phase gate:** disposable-repository bug, approved-feature, contributor, factory, dependency and takeover paths all reach their correct terminal/escalation outcomes. Pilot AI posting remains disabled until P7.

## P5 - Finish maintainer interaction, Retro and privacy controls

**Owns:** `HUMAN-discord`, `HUMAN-retro`, `HUMAN-data`, `HUMAN-helper`; `UX-discord`, `UX-retro`, `UX-export`, `UX-purge`.

### Work and acceptance

- An optional standalone Discord/credential helper uses outbound Gateway connectivity, explicit authorized Discord user-ID mappings and no public approval ingress. Running/restarting it never launches inference.
- Maintainers can use approve/deny buttons carrying linked work, proposal/revision/policy, risk, evidence, findings, recommendation and precise meaning. Persist on GitHub through the writer before action. A stale/duplicate/unauthorized click, role/display name, silence or expiry grants nothing.
- **Owner ruling 2026-11-27 (@trek-e, "Link-only for MVP"):** the MVP ships link-only cards that show the item, its GitHub link and the exact `/warden approve` or `/warden deny` command, so every decision is a verified GitHub comment. The Discord Gateway helper, the user-ID mapping and the approve/deny buttons in the two bullets above move to after the pilot ([PRD §8](0001-warden-of-the-gate.md#decision-cards-and-channels)).
- Preserve P1's GitHub-native decision path when Discord, helper or model is unavailable. Cards transmit approved non-sensitive summaries only, not source/private transcripts, and cannot satisfy independent required GitHub reviews.
- `warden run --task retro` reads scoped decisions, corrections, escapes and outcomes, retrieves denials and proposes narrowly scoped design/static/behavioral/rule improvements with examples and validation as a PR. No justified change is valid; no weekly quota or scheduled inference.
- Historical agreement can motivate an authority-expansion proposal, never authorize one. A maintainer approves any expansion; no model training or cross-repository authority transfer.
- `warden data export` and `warden data purge` provide explicit scoped selection/confirmation, redaction and clear receipts/errors. Preserve pending recovery data and distinct decision/audit retention safeguards; decisions remain until explicit removal. Storage failure must never acknowledge nonexistent durability.
- Verify transcript expiry at the configurable 30-day default, separate configurable security-audit retention and protected decision history. Test privacy controls while operations are pending and without an available model.

## P6 - Releasable package, upgrades and operator documentation

**Owns:** `SHIP-package`, `SHIP-upgrade`, `SHIP-docs`; `UX-install`, `UX-upgrade`.

### Work and acceptance

- Produce a versioned scoped npm/CLI release candidate, starter schemas/orders, changelog and compatibility notes. Confirm ownership/availability of the publish scope; never instruct installation of unrelated unscoped `warden`. Package identity is settled before publication, not guessed in this plan.
- A prepared-Mac operator can install the packed candidate and invoke all eight `--task` names plus setup, config validation, status, stop/resume and data controls from the installed executable, not a source-tree shortcut.
- `warden upgrade --dry-run` reports behavior/config/schema/default changes without applying them. An explicitly approved upgrade preserves config/authority/checks/clocks or requires review; unsupported versions/migrations fail actionably. No general migration engine is added.
- The quickstart covers protected App/bootstrap setup, supported model/harness/isolation prerequisites, separate inventory/adoption, shadow versus dry-run, independent housekeeping enablement, approvals, stop/resume, inbox/credential/trust-root recovery, export/purge and rollback/upgrade.
- Document Mac/Node/OpenCode/model/compiler/SDK/isolation coverage and finite budgets with measured values from P0-P5; P7 qualifies the final pilot matrix. Explicitly document opt-out and provider-supported recovery after revoked trust roots.
- Demonstrate configuration-only adoption on another disposable repository with different labels/identities; no pilot-specific task code or assumed personal identity.
- The installed release candidate contains no secrets, home paths, raw transcripts or throwaway HTML production UI. Unsupported language/SDK checks remain visible blockers.

**Explicit hand-off:** P7 owns final replay qualification, measured pilot defaults, production activation and any separately authorized publication/tagging. A packed candidate is not a published/live-ready release.

## P7 - Qualification, pilot gate and explicit activation

**Owns:** `QUAL-replay`, `QUAL-recovery`, `QUAL-metrics`, `QUAL-activation`; `UX-activate`.

### Work and acceptance

- Use a maintainer-curated replay set of at least **20 PRs and 20 issues**, expanding thin coverage. Include bug/feature/enhancement/dependency, contributor/factory, authority-changing work, drafts, claims/holds/deadlines, baseline failures and uncertainty.
- Require **at least 90% maintainer agreement separately for blocking-finding judgments and triage outcomes**, with each numerator/denominator published; assess at least **10 blocking findings**, detect **every curated known critical case**, and report misses/disagreements. No-data/too-small samples cannot pass.
- Require **zero unauthorized effects, duplicate accepted reviews of unchanged inputs, and lost-state recovery failures**. Replay/shadow must not mutate pilot items; synthetic mutation/recovery tests use the disposable repository.
- Re-run the production integration matrix below against the final installed candidate, not just P0 spikes or the HTML model. Cover crashes, outages, queue pressure, stop propagation, stale approvals/evidence and credential revocation.
- Publish measured finite item/turn/wall-time/context/resource/retry budgets, hardware/OS/Node/harness/model/isolation/compiler/SDK coverage and local lookup/model overhead. No untested universal-language or zero-resource-cost claim.
- `warden status` and the run report expose state/age, assignment-to-ready, active execution, review/CI/fix wait separately, ownership/extension/takeover, auto-merge/escalation, maintainer effort, agreement/escapes/reverts, attempted versus accepted duplicate reviews, recovery, tokens/time/resources and lookup quality/overhead.
- **Owner ruling 2026-11-27 (@trek-e, "Yes, that works"):** `warden status` shows the pilot gate (blocking-finding and triage agreement, each with its denominator; blocking findings assessed; critical cases detected; the qualification verdict), the must-be-zero counters (unauthorized effects, duplicate accepted reviews, lost-state recovery failures) and measured budgets (tokens, wall time and memory per task, by model). The other measurements in the bullet above go in a separate on-demand metrics report, not in status ([PRD §10](0001-warden-of-the-gate.md#10-configuration-and-operator-surface)).
- An operator can run the `warden setup` CLI and explicitly authorize selected live scope in a distinct activation step after inspecting the qualification report; its protected authorization/receipt is visible in `warden status`. Ordinary setup, editing a repository default, elapsed shadow time and passing replay never activate it. Final prompt/flag spelling must be documented before shipping.
- Maintainer reviews the recorded evidence and explicitly enables live operation within the existing operator ceiling. Eligible auto-merge then becomes the default within that approved scope. Stop/recovery and scope-specific incident pause remain available. No push, tag, npm publication or pilot activation occurs merely because this plan exists.

### Required functional/recovery evidence ownership

The row numbers are the [PRD section 11 evidence requirements](0001-warden-of-the-gate.md#required-functionalrecovery-evidence). The delivery owner implements the behavior; P7 integrates and qualifies every row.

| PRD row | Evidence | Delivery owner |
|---|---|---|
| 1 | Bug/feature end to end, eligible merge, high-risk escalation | P4 |
| 2 | Contributor branch protection (no writes to contributor branches; at most an approved workflow run where the repository requires one) and credited takeover | P4 |
| 3 | Initial/fix/response clocks, holds/extensions, delayed assessment/CI and adoption | P2 |
| 4 | Review reuse, delta/base/material-evidence invalidation, marker ownership | P3 |
| 5 | Static/runtime evidence, baseline separation and gate weakening | P3 |
| 6 | Crash, uncertain effect, duplicate/out-of-order, queue overflow, Actions outage | P1, with P0 proof |
| 7 | Last-moment head/base/policy/approval/evidence changes | P4 |
| 8 | Stop during model/verification/effect, uncertain outcome, explicit resume | P1 |
| 9 | Expiry, issuer outage/revocation and no credential fallback | P1 |
| 10 | Discord outage/stale click/unauthorized identity and GitHub fallback | P5 |
| 11 | Local-model failure, no remote fallback and missing containment | P3, with P0 proof |
| 12 | Lookup freshness/degradation/unsupported SDK coverage | P3 |
| 13 | Competing claims and contributor/factory ownership races | P2 |
| 14 | Persistent rework/retry exhaustion, no-progress and replacement PRs | P4 |
| 15 | Timely contributor-round escalation and queue fairness | P4 for rounds; P3 for fairness |

## Coverage check and limits

The companion trace assigns each decision/capability one delivery owner, names wired CLI/event/button surfaces in acceptance criteria, and records cross-phase deferrals. Proof ownership and production ownership are deliberately separate. P7 retests earlier deliverables; it does not become an excuse to omit their implementation gates.

Run the existing `adr-phase-coverage` skill's `scripts/check_coverage.py` against the companion JSON. It must report no orphaned decisions, dangling deferrals, unknown owners, unwired user-facing capabilities or multi-owner warnings. This checks the authored decomposition, not semantic completeness or implementation correctness; review the trace against the PRD/ADRs as well.

No new external research, provider benchmark or implementation proof is claimed here. The exact inbox/isolation mechanisms and supported versions are P0 outputs; adoption syntax is a P2 interface decision; package scope is a P6 release gate. These have named owners and failure behavior rather than speculative defaults.

## First implementation work

Begin with P0's two bounded proof tracks: durable inbox/writer/recovery and OpenCode/local-model/isolation. Add the compiler/SDK feasibility case alongside the runtime proof. Produce reproducible evidence, then update the relevant existing draft ADRs with the concrete choices. Do not build Discord, a dashboard, a general graph platform or the full task engine before these foundations are demonstrated.
