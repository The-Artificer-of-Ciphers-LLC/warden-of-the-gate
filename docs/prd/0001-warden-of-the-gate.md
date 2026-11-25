# PRD: The Warden of the Gate

- **Status:** Draft - owner product review complete; implementation proofs pending
- **Date:** 2026-11-17 (research reconciliation 2026-11-24)
- **Owner:** @trek-e
- **Supporting decisions:** [ADR index](../../README.md); all ADRs remain editable working drafts.
- **Research:** [Platform best practices](../research/PRD-BEST-PRACTICES.md), [code-intelligence options](../research/CODE-INTELLIGENCE-OPTIONS.md), [correction ladder](../research/FRAMEWORK-CORRECTIONS.md), [pitfalls](../research/PITFALLS.md), [summary](../research/SUMMARY.md) and the `TALK-*` notes in [research](../research/).
- **Research reconciliation (2026-11-24):** text marked **[R]** was added by comparing the research directory with this PRD. It is **PROPOSED, awaiting owner review**, like other post-review additions. [Owner decisions](#owner-decisions-from-the-research-reconciliation) lists the research points that needed a ruling: those decided on 2026-11-24, and those still open.
- **Tests-over-review reconciliation (2026-11-25):** text marked **[T]** applies the method in [Review the tests, not the diff](../research/TESTS-OVER-CODE-REVIEW.md) (frozen acceptance tests, contract review as the human gate, a bounded verification loop and test-quality evidence), with proposed [ADR 0014](../adr/0014-frozen-acceptance-tests.md), [ADR 0015](../adr/0015-contract-review-human-gate.md) and [ADR 0016](../adr/0016-verification-loop-and-test-quality-evidence.md). It is **PROPOSED, awaiting owner review**; the questions it raises are in [Owner decisions](#owner-decisions-from-the-research-reconciliation).
- **Implementation planning:** [Proposed phased plan](0001-warden-of-the-gate.implementation-plan.md) and [coverage trace](0001-warden-of-the-gate.implementation-trace.json); these do not replace the product contract or authorize live operation.

## TL;DR

Warden is a self-maintaining software factory for GitHub repositories. It triages issues, reviews PRs, **fixes bugs and builds features and enhancements**, follows up with contributors, merges eligible changes, takes over abandoned work, and proposes improvements to its own rules under human oversight.

The MVP proves the whole loop on GSD Core, the **pilot repo**. One instance governs one repository. A maintainer manually starts bounded, once-through AI scans on a Mac using OpenCode and a local inference service such as LM Studio. GitHub Actions performs deterministic housekeeping and serialized posting, never inference. Eligible auto-merge is a core capability, including contributor PRs. Warden does not write to contributor branches, except to push fixes for failing CI (owner ruling 2026-11-24, §5 Review). Operational settings live in `.github/warden.yml`; declarative standing authority lives in `.github/ORDERS.yaml`.

## 1. Problem, users and outcomes

Busy repositories accumulate repeatedly reviewed but unfinished PRs, unanswered issues, abandoned claims, and undocumented maintainer decisions. A long-lived session loses focus, waits for humans or CI, and forgets prior work when it restarts. The pilot backlog motivating this design had approximately 72 open PRs; that is context, not a fixed acceptance baseline.

The primary user is a solo or small-team maintainer. Contributors need clear expectations, attributable feedback and fair ownership. Other maintainers must be able to adopt the same factory through configuration rather than repository-specific task code.

Required outcomes:

- Every adopted open item has one durable, visible workflow state and a clear next action or blocker.
- Completed reviews are reused for unchanged inputs; new code receives appropriate delta review.
- Confirmed bugs and approved features/enhancements progress through implementation, verification, review and eligible merge.
- Human intervention concentrates on product decisions, risk, authority changes, exceptions and genuine uncertainty.
- Missed commitments lead to predictable takeover without losing the underlying issue or useful contribution.
- Cold starts, outages, retries and stops preserve accepted decisions and recoverable work.
- Routine inference has no cloud token charges; local hardware, energy and model-context costs still matter.

## 2. MVP boundary

### Included

All eight tasks are required: **Intake, Triage, Claim, Implement, Review, Rework, Sweep, Retro**. The first release is narrow in deployment and throughput, not a review-only substitute for the factory.

- One repository per instance; instances may share a host and local model service but not authority or mutable item state.
- Maintainer-operated Mac, OpenCode adapter first, LM Studio/local OpenAI-compatible inference. API compatibility does not mean requests go to OpenAI's cloud.
- Local-only inference, checking the actual resolved provider/model, not merely a configured default. No silent remote fallback.
- Manually triggered AI scans only: bounded queue snapshot, serial items, fresh sessions, report and exit. Do not wait inside a session for CI or a human.
- An initial configurable limit of one open factory implementation PR. Serial review/triage of other items remains possible.
- Deterministic Actions intake, claims, deadline/staleness handling, reconciliation and serialized posting can continue while the Mac is off.
- Optional lightweight Discord/credential control helper while the Mac is awake. Recording a decision does not start AI work.
- Versioned Mac CLI/npm distribution, quickstart and tested runtime/harness/model matrix. Harness, model service and execution isolation are explicit prerequisites.
- Code lookup, static-first verification, durable decision retrieval, and an evidence-based graph-integration evaluation.

### Deferred, not hidden MVP requirements

| Area | Later direction |
|---|---|
| AI pickup | GitHub webhooks/event-driven pickup and scheduled AI operation after MVP validation; no recurring local polling in MVP |
| Harnesses/models | Pi adapter; remote per-task opt-in with budgets; orchestrator/worker model split after measurement |
| Interactive surfaces | Bionic optional, not a required unattended engine; Teams/Slack after Discord |
| Distribution | Warden Docker image and broader Linux deployment; Kubernetes/Helm after that. Containers may still provide MVP worker isolation. |
| Enterprise | Management REST API, enterprise RBAC, dashboards, organizational tenancy, cross-repository orchestration and aggregate oversight |
| Policy/storage | General executable DSL, general migration engine, mandatory graph database, model training on the decision corpus |
| Retro sampling | **[R]** Once auto-merge has live data, Retro may show the maintainer a small sample of auto-merged work to look at after the fact ([Dill](../research/TALK-DILL-ZOMBIE-UI.md) candidate 2). Owner ruling 2026-11-24: "hold for now". Not a requirement |

The executable may remain `warden`, but the npm package must use an organization-owned scope: unscoped `warden` is an unrelated package. Confirm scope ownership and availability before publishing.

## 3. Authority and trust boundaries

Effective authority is the intersection of mandatory platform constraints, the operator-approved authority ceiling, and approved repository standing orders. A model recommendation never grants permission. Policy changes proposed in a PR do not authorize that PR.

- GitHub App identity for repository effects; short-lived, operation/repository-scoped credentials. No root secrets or GitHub write tokens in agent sessions.
- Factory built-ins own orchestration. Issues, PR text, repository agent instructions and standing orders cannot introduce arbitrary executable task programs.
- Product agent/phase workflows are maintained as code, not executed as factory machinery. Trusted build, lint and test commands are allowed for verification.
- Review gets prefetched inputs and restricted read-only tools. Implement/Rework may change only an isolated factory workspace within approved scope.
- Running generated/contributor code, dependency installation scripts, build plugins, lint and tests requires a real OS/container boundary. A worktree alone is not isolation.
- Exclude home credentials, unrelated files and unrestricted network access. Any allowed network/resource access is explicit and bounded. Do not run fetched code or repository plugins in privileged bookkeeping.
- Missing isolation or unknown authorization blocks the affected action visibly. No unsafe fallback into the maintainer's login environment.
- Structured-output validation is necessary, not sufficient: the deterministic core independently checks identity, scope, current inputs, evidence, policy and requested effects.
- **[R]** Issue and PR text, comments, reporter-asserted diagnoses, and Warden's own earlier prose (comments, cards, summaries) are untrusted context for later sessions: never instructions and never evidence. State and accepted findings come from the ledger's validated records, not from re-reading Warden's prose. Identify actors by numeric user/App ID, not login or display name.
- **[R]** Evaluate `.github/warden.yml`, `.github/ORDERS.yaml`, Warden workflows and any repository rule files Warden enforces from the trusted base revision only. A PR that changes them gets full review and a maintainer decision, never delta review.
- **[R]** Actions hardening: no workflow checks out or runs PR code with write credentials (no `pull_request_target` execution of contributor code); untrusted event text reaches scripts through environment variables, never inline expressions; third-party actions are pinned by full commit SHA; workflows pass a workflow linter such as actionlint or zizmor in CI. The App requests no `workflows` permission, and factory branches use a reserved prefix protected by a repository ruleset.
- **[R]** Validate every outgoing comment, review and card before posting: length cap, no secrets or credential-like strings, no @mentions or team pings except configured maintainers, no external images, labels only from the task's allowlist. A failed check blocks that effect visibly.

### Eligible auto-merge

Live auto-merge is the default for eligible contributor and factory PRs, including approved features/enhancements. It requires:

1. Approved scope or applicable standing authority; valid current approvals where required.
2. Current completed review and independently captured task-appropriate verification evidence.
3. No unresolved findings enabled as merge gates.
4. Required GitHub checks/reviews and repository rules satisfied; PR ready, not draft.
5. Current head and applicable policy match the accepted evidence; current base context has been checked for material invalidation; no applicable hold or stop.
6. Merge request bound to the reviewed head, followed by reconciliation of the actual outcome.

Risk is separate from finding severity. Evaluate affected interfaces, sensitive paths, migrations, dependency effects and blast radius. Do not turn a clean diff, low severity, code-size percentage or model confidence score into authorization.

**[T]** Boundary changes floor at a maintainer decision even when every other gate passes ([ADR 0015](../adr/0015-contract-review-human-gate.md)). Default boundary classes, configurable: exported or public interfaces and API contracts; database schemas and migrations; authentication, authorization, secrets and security-sensitive paths; a new dependency or a major-version dependency change; shared components the repository names; test, verification and CI infrastructure. The card inlines the implementation diff for the boundary files. Eligible non-boundary work does not need a human on the implementation diff; it rests on frozen tests, test-quality evidence and AI review as one layer. Which classes, and how this relates to the open reversibility question, is for the owner.

High-risk or uncertain work and changes to workflows, standing orders, access/maintainer policy or Warden's own authority require a maintainer decision. Feature/enhancement scope and acceptance criteria require approval. `wontfix` decisions require maintainer authority. Blocker findings always stop merge; major, minor and nit findings also block by default, individually configurable.

Verified automation-origin dependency/CVE fixes automatically approve and merge when within authorized scope and all gates pass. Verify origin and actual change; a security label is not sufficient. Breaking majors, migrations and high-impact/uncertain updates escalate unless that specific class is already authorized. Urgency does not bypass gates.

An App cannot supply an independent approval of its own PR. A second local session is not a second GitHub identity. Preflight incompatible branch rules and explain the required legitimate approval path; never fabricate reviewer independence or bypass protections.

## 4. Durable state and transitions

### Canonical state and independent facets

One Warden-owned ledger comment per issue/PR is authoritative. Configurable labels are a searchable projection, not a second competing database. An authorized maintainer override must pass through the same validated state writer.

| Item | Canonical open workflow states | Terminal states |
|---|---|---|
| Issue | `needs-triage`, `needs-info`, `needs-decision`, `ready`, `claimed`, `implementing`, `in-review`, `blocked` | `resolved`, `closed` |
| PR | `needs-review`, `needs-author`, `needs-rework`, `needs-decision`, `waiting-checks`, `merge-ready`, `blocked` | `merged`, `closed` |

State names are semantic identifiers; displayed label names are configurable. Store blocker reason and intended resumption when blocked. Processing leases/attempts are separate from workflow state.

**[R]** Trust a ledger comment only when its author is the configured App's numeric ID; a look-alike comment from anyone else is ignored and reported. Encode the ledger payload so item text cannot terminate or forge its marker. GitHub caps a comment body at 65,536 characters, so the ledger compacts history (keeping current state, open obligations and references to archived records) before it nears the cap; it never silently truncates. A label edit by an authorized maintainer becomes an override request through the writer; any other drift is re-projected from the ledger with a short explanation.

Independent facets include work kind (bug, feature, enhancement, dependency, documentation and configured categories), finding severity, change risk, ownership, and low-effort indicators. A quick win is not a mutually exclusive kind or workflow state.

### Principal transitions

| Event | Required transition/effect |
|---|---|
| New/adopted issue | `needs-triage`; missing information routes to `needs-info` |
| **[R]** Reporter supplies requested information | `needs-info` returns to `needs-triage`; the reporter-information clock stops |
| Confirmed unclaimed bug within authority | `ready` |
| Feature/enhancement proposal | `needs-decision`; approved criteria/design allow `ready` |
| Contributor volunteers | Assign immediately, record commitment window, enter `claimed`; not factory-ready |
| Factory starts eligible work | Record factory ownership, enter `implementing` |
| Complete linked PR submitted | Issue `in-review`, PR `needs-review`; preserve actual submission timestamp |
| Review finds enabled blocking findings | Contributor PR `needs-author`; factory PR `needs-rework` |
| Review clean, CI pending | `waiting-checks`; do not repeat model review |
| All current gates pass | `merge-ready`, then reconcile merge outcome |
| Missed delivery | Release claim; close unfinished PR, retain issue and takeover context; return eligible issue to `ready` |
| Material scope/design change | `needs-decision`, not silent scope expansion |
| Actual merge and satisfied linked work | PR `merged`; resolve linked issue according to repository linkage and verified scope |

Closed PRs do not imply resolved issues. GitHub state changes made outside Warden must be reconciled, not overwritten blindly. Never reopen an intentionally closed item simply because a stale operation arrives.

### Minimum ledger and operation records

Record item/repository identity, schema/revision, workflow state/facets, ownership, linked work, pending obligations/deadlines, holds, accepted review inputs/findings, evidence references, approval references, rework count and applied operation IDs. Issues have no PR head SHA.

Review identity includes PR head, relevant base context, effective policy and material evidence context; retain tool/model/check context needed to interpret evidence. Only accepted completed Review results advance the review marker. Intake, Implement and Rework never do.

Material new evidence can invalidate affected findings or verification even when the head is unchanged. Record the evidence and invalidation reason; an acknowledgement, ordinary CI completion or repeated unchanged finding is not a new review input. Base advancement requires a compatibility check, not an automatic full review of every unrelated commit or an assumption that all base changes are irrelevant.

All Intake/Claim/Sweep and local-result effects share one serialized Actions posting path. The local runner submits validated intents; it does not race Actions to edit the same ledger.

- Persist operation intents independently of bounded Actions concurrency queues.
- Re-read current item, policy, approvals and stop controls before an effect.
- Use durable operation identities, resumable application and reconciliation of uncertain outcomes. Enqueue/HTTP acceptance is not completion.
- Recover from lost events, duplicate deliveries, interrupted writes and effect-applied/acknowledgement-lost cases without duplicate accepted work.
- Retain a protected local recovery journal and the durable decision corpus. Accepted maintainer decisions are also recorded on GitHub.
- Actions outage means visible pending operations, not an unsynchronized local write fallback.
- CI/approval events may reevaluate gates against an already accepted current review and finalize an eligible merge without launching AI. They cannot replace missing review or authorize new scope.
- A comment revision counter or local lease alone is not distributed compare-and-swap. No unqualified exactly-once transaction promise.
- **[R]** Events caused by Warden's own App must not re-trigger Warden work loops; workflows filter on the App's ID before acting.
- **[R]** Pace mutations to respect GitHub's secondary rate limits; honor `retry-after` and back off, leaving the remaining operations visibly pending rather than dropping them.
- **[R]** Cap closures per sweep run and per day (configurable). Excess eligible closures are deferred and reported, so a defect in clock logic cannot mass-close the backlog.

The concrete durable inbox and recovery protocol must pass a capability proof before live posting. Do not create a competing repository ledger file.

## 5. The eight task contracts

Each task has bounded inputs, an explicit result, evidence, proposed effects and a next state. No model session is kept open to babysit another system.

### Intake - deterministic Actions

Inspect metadata, template completeness and explicit routing rules; initialize adopted item state and labels. Possible similarity may flag a duplicate candidate but never establishes semantic duplication or silently closes it. Apply configured draft policy and queue semantic work. Do not claim root-cause analysis or mark any code reviewed.

### Triage - local AI

Investigate the report against current code, approved rules and relevant prior decisions. Confirm a bug only with suitable evidence; otherwise request precise information or escalate uncertainty. Classify kind, finding severity and change risk separately. **[R]** Reuse a completed triage until the reporter or a maintainer adds material information, or relevant code or policy changes; a scan does not re-triage an unchanged issue. **[R]** A cause, fix or severity that the reporter asserts is a claim to verify, not a finding; the triage record says which parts Warden confirmed independently.

For features/enhancements, propose scope, observable acceptance criteria, approach, affected areas, interfaces, migration implications, blast radius, alternatives and unresolved questions. Approval is required before implementation. Triage owns this proposal; a separate design task is unnecessary.

**[T]** The approved contract for a feature or enhancement is the acceptance criteria **and** the acceptance tests the Implement test session writes from them ([ADR 0014](../adr/0014-frozen-acceptance-tests.md)). The maintainer approves the tests, shown with their fail-on-base result, before the fix session runs; a material change to them is a scope change. Criteria should be written so a test can check them.

Confirmed/approved items never stale-close. Rejected product directions remain binding unless a maintainer revises them.

### Claim - deterministic Actions

Assign a volunteering contributor immediately. A human or an authorized agent may confirm work and supply the explicit delivery commitment; the assignee remains accountable. An unrelated commenter cannot claim or extend on their behalf.

Accept a claim only while the issue is eligible and unclaimed. The serialized writer checks current ownership before assigning; competing requests do not overwrite a contributor or factory owner. Explain a rejected/conflicting claim and never report assignment success before GitHub confirms it.

**Default initial delivery: 48 elapsed hours from assignment.** Confirmation does not start another 48-hour allowance. A complete ready-for-review PR and verification evidence are required; a placeholder, draft or knowingly partial implementation is not delivery. An earlier explicit commitment remains binding. Longer windows/extensions need maintainer approval before expiry; explicit maintainer holds pause takeover.

An explicit maintainer hold freezes the unexpired portion of the applicable delivery window. Record its reason, start and remaining time; on release publish the revised deadline. A material scope change needs a fresh approved commitment. Stopping Warden alone does not grant an extension or freeze contributor obligations.

Record timely submission before semantic review so unavailable AI, maintainer review or delayed CI does not falsely expire a plausible completed delivery. Ambiguous completeness waits for assessment rather than being closed merely because the Mac is offline.

An on-time, genuinely complete submission satisfies the initial obligation even if ordinary review finds defects. **A published blocking review starts a fresh 48-hour fix window; a subsequent substantive review round starts the next window.** Author acknowledgements, unrelated comments and placeholder pushes do not extend delivery deadlines. Waiting on the reviewer/CI does not count against the author. All durations are configurable and timestamps unambiguous.

On missed commitment, release assignment, close unfinished PR with explanation, keep the original issue open, and retain partial-work references for takeover. Enforcement is on the next successful sweep.

After three substantive contributor fix rounds, escalate to the maintainer if enabled blocking findings remain, even when each submission was timely. The maintainer decides whether to permit more rounds or arrange takeover. Do not automatically close an on-time PR solely for reaching this limit. Keep the counter with the claimed work across restarts/replacement PRs; waiting on that maintainer decision is not author inactivity.

### Implement - local AI, factory-owned workspace

Select an unclaimed confirmed bug within standing authority or an approved feature/enhancement. Respect active contributor ownership and the implementation-PR cap.

Recheck the current code/design before work. Material scope, acceptance-criteria, interface, migration or blast-radius changes require renewed approval; ordinary implementation details do not.

Start from trusted base on a factory branch. For takeover, read the abandoned diff as data, assess the approach, port sound contributions with credit, and complete the whole agreed solution. Never blindly execute its branch, hooks or installation scripts.

**[T]** Implement runs two fresh sessions ([ADR 0014](../adr/0014-frozen-acceptance-tests.md)). A **test session** writes the reproducer or acceptance tests from the issue or approved spec, without a fix; every new test must fail on the base. Warden then freezes them (paths and content digests in the ledger). A **fix session** sees the frozen tests and the spec, never the test session's reasoning, and is told the tests are read-only acceptance criteria, never "make the tests pass". The OS boundary denies writes to frozen paths and test, lint, coverage and mutation configuration; the executor runs the acceptance evidence from its own frozen copy and rejects any attempt whose frozen files changed (`frozen-test-modified`). A fix session that believes a frozen test contradicts the spec exits with `test-dispute`; the item returns to the test session once with that reason, or to `needs-decision`. Within an attempt, a bounded verify-and-continue loop owned by the orchestrator feeds the executor's own failure output back to the session ([ADR 0016](../adr/0016-verification-loop-and-test-quality-evidence.md)); loop turns are not rework cycles or retries.

Use the strongest appropriate reproducer, implement the approved change, and run trusted verification. Bug fixes normally need fail-before/pass-after; features need evidence against approved criteria. **[R]** If no static or dynamic reproducer can be made to fail first, Implement stops and returns the issue to Triage with what it tried, rather than submitting an unproven fix. Preserve baseline failures separately. Submit the validated PR-opening intent with scope, approach, acceptance evidence, verification, prior-work attribution and a **Merge Danger** summary of risk/blast radius. Opening a PR is not review or merge.

**[T]** The PR description lists the frozen tests (paths, digests) separately from the implementation, and shows the proof from the executor record, never from model prose: each check's command line, exit status and a bounded output tail; the fail-on-base result; the mutation score and surviving mutants; holdout pass or fail by id.

**[R]** The PR description also states how Warden read any ambiguous acceptance criterion and lists the choices the approved spec did not determine, so a reviewer sees them first. These are reading aids, not approval. Where the spec is contradictory or a choice would change approved scope, interfaces or behavior, Implement abstains and routes the item to `needs-decision` instead of guessing.

**[R]** Factory commits satisfy the repository's DCO/CLA requirements. Contributor credit uses `Co-authored-by` trailers built from the contributor's GitHub-provided noreply address, never an address scraped from commit or comment text.

**[R]** Keep factory PRs within a configurable reviewable size. Work that would exceed it is split into approved, separately mergeable steps, or returned to `needs-decision` with a proposed split.

### Review - local read-only AI and deterministic gates

Review candidate changes against relevant base context, approved requirements, rules and prior decisions. Gather symbol/reference/impact evidence, inspect verification and detect control weakening. Findings name severity, precise location, rationale and required correction.

- Reuse accepted findings for unchanged review inputs.
- On a new head, review the delta and revalidate unresolved findings; assess affected surrounding behavior.
- Material base/policy changes can invalidate prior evidence.
- Material new evidence invalidates affected review conclusions with an auditable reason, even without a new head; do not repeat already accepted review merely because a comment arrived.
- CI/approval-only updates reevaluate gates without another model review.
- Failed/interrupted attempts may retry and are auditable; they are not duplicate completed reviews.
- Use independent verification of evidence; model self-reported success is not a trusted check result.
- **[R]** After a rebase, force-push or update-branch, compute the delta by patch equivalence against the reviewed commits (an interdiff), so a base merge or rebase alone does not trigger a full re-review and a rewritten commit is not hidden.
- **[R]** Bind each posted review to the reviewed `commit_id` and validate every inline position against that diff before posting. Give each finding a stable fingerprint (rule, anchor, normalized location) so a repeated finding updates the existing one instead of posting a duplicate. Cap findings per review (configurable) and rank them by severity; the ledger keeps the full list.
- **[R]** A diff that GitHub will not return in full, or that exceeds the configured reviewable size, is reported as too large to review reliably and routed to the author or maintainer with a request to split. It is never partially reviewed and passed.
- **[T]** Review reads the contract first: the spec or issue, the acceptance criteria and the test diff, then the implementation. It checks the test diff against one focused list (deleted or weakened assertions, widened tolerances or timeouts, new retries, regenerated snapshots, `.skip`/`.only`/`todo`, changed test-runner, coverage or mutation configuration, tests moved out of the test globs, tests that assert on the implementation's own output) and reports each hit as a located finding ([ADR 0015](../adr/0015-contract-review-human-gate.md)). Surviving mutants on changed lines are findings too ([ADR 0016](../adr/0016-verification-loop-and-test-quality-evidence.md)).
- **[T]** Review prefers a model from a different family than the one that wrote the change, when the approved pool has one, and records both families and model ids on the verdict. Same-family review is allowed when nothing else is available and is reported as such.
- **[R]** Review also reports spec gaps and conflicts: an approved criterion the change cannot satisfy as written, or behavior the spec does not determine. These route to `needs-decision`, not to the author.

**Decided 2026-11-24 (@trek-e).** A finding is a finding, no matter when it is found: a later review round may raise a finding on code that was already reviewed and has not changed.

**Decided 2026-11-24 (@trek-e).** Red CI does not skip review. Review finds what is failing in CI and fixes it. On factory PRs Rework applies the fix. On contributor PRs, Warden pushes the fix to the contributor's branch ("Let it push fixes"). The rules for that push:

- It fixes only the CI failure Review diagnosed. Other findings still go to the author, and the push never widens scope.
- The fix is built in the isolated factory workspace from the PR head, which is treated as untrusted, and verified with trusted commands before pushing.
- It adds commits on top of the reviewed head, authored by the App. It never force-pushes, rebases or amends. If the head moved since review, nothing is pushed and the PR is re-evaluated.
- A comment on the PR says what was pushed and why. The new head returns to Review; the push cannot mark itself reviewed or merge.
- These pushes count against the factory rework limit for that PR, persisted like other cycles. They are not author activity: they do not reset author clocks, satisfy the author's delivery or count as contributor fix rounds.
- A fork PR can be pushed to only while its author leaves "Allow edits by maintainers" on. When it is off, when GitHub refuses the push (branch protection, permissions), or when the fix would change `.github/workflows` (the App has no `workflows` permission), Warden does not push. It posts the cause and the proposed fix as a patch or suggested change for the author, and the PR goes to `needs-author`.
- Capability tests must prove the App can push to a fork PR head that allows maintainer edits, and is refused when it does not, before this is enabled live.
- **[T] Proposed narrowing, for the owner to decide:** the pushed fix may not change any test file or test-runner configuration. If the only fix is a test change, Warden posts the cause and a patch for the author instead and the PR goes to `needs-author` ([ADR 0014](../adr/0014-frozen-acceptance-tests.md)).

**Decided 2026-11-24 (@trek-e).** Review depth and the handling of uncertain findings are user-configurable. The maintainer pre-selects an option such as maintainer go/no-go, dropping findings below a configured confidence level, or another supported option. Dropped findings stay recorded in the ledger.

**Decided 2026-11-24 (@trek-e).** Maintainers can post commands on a PR to force a full review or to dismiss one finding; a dismissed finding stays dismissed until its code changes. A command is authorized by its author's numeric ID as a configured maintainer, never by its text.

Review never edits code. Route factory findings to Rework, contributor findings to the author, and genuine decisions to the maintainer. Record the completed review identity only after validation. If all gates pass, submit the merge intent; never report merged until GitHub confirms it.

### Rework - local AI, factory branches only

Address named current findings without unrelated scope expansion. Contributor branches are never edited, except for the CI fixes in the §5 Review ruling. Run relevant verification and return the new head to Review; Rework cannot mark itself reviewed. **[T]** Rework sees the same frozen tests and the same verify-and-continue loop as Implement. A finding that a frozen test is itself wrong goes to a new test session and a new freeze, recorded with that finding; a test change never travels inside a fix commit.

Count completed rework cycles separately from failed launches, retries and reviews. After three cycles, escalate only if findings remain unresolved. Success on cycle three is success, not automatic escalation. Resource exhaustion checkpoints and reports unfinished work rather than manufacturing a pass.

Persist counters across manual scans, process restarts and replacement PRs for the same factory work. A completed fix attempt that returns no progress still consumes a cycle; it cannot renew the allowance indefinitely. Failed launches do not consume rework cycles but have their own bounded, persistent retry accounting and an explicit exhausted/blocked outcome.

### Sweep - deterministic Actions

Reconcile ledgers, label projections, holds, claims, delivery obligations, stale response obligations and uncertain operations. Report last successful sweep and overdue work; schedules are not exact-deadline guarantees.

| Obligation | Default | Clock/exemptions |
|---|---|---|
| Initial contributor delivery | 48 elapsed hours | From assignment; maintainer-approved exceptions |
| Review fixes | 48 elapsed hours per substantive blocking review round | Waiting for review/CI is not author work owed |
| PR response silence | Nudge at 48h and 72h; close at five days | Only while explicit author response/change is owed; author push/comment/review reply resets silence, not delivery |
| Reproduction information | 14 days | Only requested reporter information |
| Other reporter information | 28 days | Only requested reporter information |

Never stale-close unreviewed PRs, confirmed/approved issues, `keep-open` items or items waiting on maintainers. Maintainer-designated drafts are exempt when drafts are enabled. Factory comments and CI do not reset author clocks. The five-day silence policy cannot override an earlier delivery deadline. All closure messages explain the reason, retained issue and return path.

**[R]** Editing the ledger notifies no one. When the author owes an action (new findings, a nudge, a deadline), Warden posts a new comment or review. A nudge lists what is still owed, the date the item will close and how to ask for an exemption.

**[R]** Every Warden comment says how to reach a human maintainer. The repository links one short pinned explanation of how Warden works, its clocks and how to appeal, so contributors are not surprised by automated state.

**[R]** GitHub disables scheduled workflows after 60 days without repository activity. Sweep records each successful run; `warden status` shows the last one, and a missed schedule beyond a configured interval raises an alert rather than silently stopping clocks.

### Retro - local AI, manually invoked

Review maintainer decisions, corrections, escapes and repeated failure patterns over the review window. Prefer design prevention, then static rules, behavioral checks, then prose. Propose justified improvements as a PR with examples, expected effects and validation.

Maintain the decision corpus; propose narrowly scoped standing-authority expansions only with outcome evidence. Human approval is required before authority expands. Weekly retrospection is an operating cadence, not a hidden scheduled AI daemon. "No justified rule change" is valid; never invent a weekly rule quota.

**[R]** Tag each escaped defect and accepted finding by origin (spec, design, code or bad fix) and track how often factory fixes introduce new defects. Retro inputs include reverted factory PRs, escaped defects, findings maintainers overrode, timeouts and abstentions. Retro may also report proposed changes to Warden's own prompts, defaults or configuration in its scan report; it never edits Warden's package or its own authority.

**Decided 2026-11-24 (@trek-e).** Measure structural erosion on factory-authored PRs (verbosity, duplication, complexity trend) before widening Implement authority. Retro also looks at the factory's merged changes over the window together, not only one PR at a time: whether they stay coherent with each other and with the approved design, or drift through duplicated helpers, diverging patterns or growth in touched modules ([Dill](../research/TALK-DILL-ZOMBIE-UI.md) candidate 1). Retro still only proposes.

## 6. Drafts and backlog adoption

Draft PRs are disallowed by default, explicitly configurable. Close newly opened drafts and PRs converted to draft while disabled, with explanation and a ready-for-review return path. Never silently mark unfinished work ready. Closing a draft alone does not revoke a valid delivery commitment. Enabled drafts still cannot merge.

Before adopting existing backlog, show a dry-run inventory and require operator selection/approval. Initialize only approved items; imported commits are not reviewed automatically. Existing drafts require a deliberate adoption decision, not mass closure. Previously waiting items receive the full published notice/response window after adoption; never retroactively mass-close old work.

Preserve existing contributor ownership and valid maintainer-approved commitments. When introducing a delivery obligation to an existing claim, publish its new window from adoption notice, not the historical assignment date. Adoption cannot manufacture an already-expired commitment.

## 7. Quality and code intelligence

### Static-first correction ladder

1. Design away invalid choices where possible.
2. Enforce structural requirements through types, compiler, lint and dependency-boundary rules.
3. Verify runtime properties through appropriate behavioral/integration/recovery checks.
4. Use prose for residual judgment, not as a substitute for enforceable constraints.

Agent-authored test count and coverage are not correctness evidence. Structural fixes may use static fail-before/pass-after checks; behavioral defects require dynamic evidence. Races, timing, recovery and side effects cannot be established by lint alone.

Protect verification controls: disabled lint rules, broadened exclusions, suppressions, skipped tests, weakened assertions and bypassed required checks cannot manufacture success. Weakening requires maintainer approval. Legitimate expectation changes still need review against approved requirements. **[R]** New inline suppression or ignore comments, and code comments that justify a workaround instead of fixing it, count as weakening. **[T]** So do focused tests (`.only`, `fit`, `fdescribe`), widened numeric tolerances, raised timeouts or retry counts in tests, regenerated or bulk-updated snapshots, changes to test-runner include/exclude or mutation configuration, and test files moved out of the configured test paths.

**[T] Test-quality evidence** ([ADR 0016](../adr/0016-verification-loop-and-test-quality-evidence.md)). Green is necessary, not sufficient. Where a tool exists for the repository's language, the executor runs mutation testing scoped to the changed files and lines; surviving mutants on changed lines are findings, and the score is recorded. During the pilot the score is not a merge threshold; one may be set from pilot data and then only ratchets up. The test session prefers property-based tests with a stated oracle or metamorphic relation for pure logic. A maintainer may attach holdout acceptance checks to an approved feature, kept in the protected operator store, run only by the executor and never shown to a session; a failing holdout is a blocker. Holdouts are one layer, not the wall. An unsupported check is reported as unsupported, never as a pass.

**[R]** When a new static rule meets existing violations, apply it as a ratchet: it gates new and changed code immediately, records the existing violations as a baseline, and the baseline may only shrink. Factory work does not fix unrelated baseline violations as a side effect.

The trusted executor captures command, inputs, exit status, output and artifacts independently of the model. Compare trusted baseline and candidate results. Do not fix unrelated baseline defects or describe them as passing. Auto-merge blocks without meaningful evidence unless an explicit scoped maintainer exception applies; required GitHub checks never bypass.

### Lookup, graph analysis and SDK enforcement

Robust code lookup is required, not silently replaced by text matching alone. Require definitions/references with verifiable locations; distinguish precise from heuristic answers. Associate evidence with repository, base/candidate revision or worktree content, compiler/SDK context, freshness and degradation. Assess callers, interfaces, package boundaries and diff impact.

The [researched comparison](../research/CODE-INTELLIGENCE-OPTIONS.md) retains Omnigraph, GSD Atlas, SCIP/scip-typescript, CodeGraphContext and other alternatives. Omnigraph's MIT graph storage is not a ready-made source index. Atlas offers useful local lookup, but current SDK packs and enforcement hooks are not shipped.

**Approved evaluation approach:** use compiler/language-service lookup as the baseline and evaluate pinned Atlas plus one viable graph/index alternative (SCIP or CodeGraphContext) alongside it. Keep Omnigraph as a possible storage layer, not a claimed source index. Measure graph-specific impact value, accuracy, citations, revision correctness, latency, memory and local token overhead before selecting a mandatory graph dependency. Keep the provider replaceable; no requirement to build a general graph platform. The exact graph provider follows the measured comparison rather than another speculative product commitment.

SDK enforcement means checks against actual supported SDK/API versions and deployment targets, not simply that a model queried a graph. Use compiler/type/lint/compatibility tooling and deterministic authorization. Report unsupported checks explicitly. Retrieval never grants authority or establishes a successful verification gate. If an index is unavailable, an approved alternate lookup may continue; missing required evidence remains a blocker.

Unshipped Atlas SDK packs are not an MVP prerequisite. This does not remove reliable lookup, graph evaluation or the SDK-enforcement objective from scope.

Publish supported languages, compiler/SDK versions and verification coverage with the tested matrix. A portable factory core does not imply proven checks for every repository or language; unsupported mandatory checks block autonomous completion rather than becoming an implicit pass.

## 8. Maintainer decisions and learning

The durable decision corpus stores approvals, denials, original reasoning, scope, evidence, policy context and subsequent outcomes. Distinguish maintainer rulings from agent suggestions; scope by repository and authorized identity. MVP learning is retrieval, not model training.

Compare proposals with applicable prior denials. A denial is effective even without a reason; request the reason for future learning. Material new evidence may justify an explicit reconsideration request linking the old ruling and explaining what changed, alternatives and mitigations. Never silently ignore a final ruling. Conflicting maintainer decisions escalate.

Historical agreement may improve recommendations and identify classes suitable for standing pre-approval. Only an approved standing-order change authorizes new scope; do not silently transfer authority between maintainers or repositories.

### Decision cards and channels

Discord is the first quick-approval channel using outbound Gateway connectivity; no public approval ingress is required. Explicitly map Discord user IDs to authorized maintainers. A guild role/display name alone is insufficient.

Cards show linked work, proposal/revision, applicable policy, risk/blast radius, verification/CI evidence, open findings, recommendation and precise approve/deny meaning. **[T]** For implementation work, the card leads with the contract: spec or issue, acceptance criteria, the frozen or changed test diff with its fail-on-base result and test-diff scan hits. The implementation diff is linked, and inlined only for boundary files ([ADR 0015](../adr/0015-contract-review-human-gate.md)). Persist the accepted decision on GitHub before acting. Stale clicks, silence, duplication and unauthorized identities do not grant permission.

One-time action cards expire after 24 hours by default, configurable, and may invalidate earlier with changed revision/policy/evidence. Approved feature scope/design persists until materially changed; daily reapproval is not required.

**Decided 2026-11-24 (@trek-e).** If an item is set for maintainer review, it waits for the maintainer review, however long that takes. Maintainer absence never turns silence into approval.

Retain a GitHub-native decision path when Discord/helper/local AI is unavailable. Only approved non-sensitive summaries go to Discord, not source code or private transcripts. A recorded approval does not start an AI scan or override GitHub-required approvals.

## 9. Runtime, containment and recovery

Preflight repository identity, supported harness/model, local provider resolution, configuration, policy, isolation, credential status and finite budgets. Reject malformed or unsupported effective configuration explicitly.

Each manual scan snapshots eligible work, processes actionable items serially in fresh sessions, checkpoints at limits, reports completed/pending/blocked/deferred work and exits. New arrivals and newly actionable AI work wait for a later scan. Do not spend a session waiting on CI or approval.

Use explicit priority and age-based fairness, not model-selected queue order: authorized urgent/security work first, review/rework that finishes existing PRs next, then other actionable review/triage and new implementation. Configure capacity/aging so approved features cannot be permanently starved by incoming bugs. Skip blocked items, retain their age, and report deferred counts/reasons. Urgency never bypasses authority, verification or the implementation-PR cap.

Enforce finite item, model-turn, wall-time, context/resource and operation-retry budgets. Pilot values must be published with the tested hardware/model matrix before live activation. Distinguish retries from rework cycles and task completion.

**[R]** Set budgets per task from measured runs on the tested model and hardware, not one shared constant or an assumed context threshold. A session that hits a budget ends with a distinct `timed-out` or `budget-exhausted` outcome, recorded and reported separately from pass, fail and abstain, and it never yields a partial result as success.

**[R]** A local model service that is down, unloaded or out of resources is not an item failure. The scan stops, releases its leases and reports the outage; no item's retry or rework allowance is consumed.

**[R]** Run at most one scan per instance at a time, enforced by a local lock. Keep the host awake during a scan where the OS allows it. Leases carry an expiry, so work held by a scan that crashed or a host that slept is reclaimed as interrupted, not counted as failed.

**[R]** A comment, push or decision that arrives after a scan's snapshot is not injected into the running session. Before posting, the writer's re-read detects it; an effect it could change is deferred to the next scan, which sees the new input.

### Stop and failure containment

Check global and instance stop controls before every task and external effect. Unknown control state does not authorize effects. On stop, block new effects, gracefully cancel active model/verification work, preserve recoverable state and require explicit resume. Status and recovery remain usable.

Already accepted external requests cannot be recalled; reconcile their real result rather than promising instantaneous rollback. A critical escape or unauthorized effect pauses the affected autonomous scope, preserves evidence and alerts the maintainer. Independent safe work may continue. Resume affected scope only after explicit review.

Propose targeted remediation/revert with current-state analysis; never blindly undo unrelated later changes.

### Credentials

The trusted credential controller automates issuance, renewal, rotation and recovery by default within the operator-approved ceiling; explicit operator opt-out is available. Model helpers may diagnose/request, not grant permissions or bypass deliberate revocation.

Renew proactively with bounded retries/backoff. Log lifecycle metadata, not secrets. Never ship a shared App private key or silently fall back to a broader PAT.

If issuer/trust-root access fails, keep status, service and recoverable queue available; suspend only affected authenticated operations and alert. Resume automatically when valid delegated authority recovers. No system can mint valid credentials after all trust roots are revoked without provider-supported reauthorization; document that recovery path honestly.

### Retention and privacy

Protect local state and redact credentials. Retain decision history/reasons/outcomes until explicit removal. Raw local transcripts default to 30 days, configurable, with export/purge controls. Credential/security audit metadata has separate configurable retention and is not purged silently with transcripts. Expose pending/recovery state and storage failures; do not acknowledge durability that was not achieved.

## 10. Configuration and operator surface

| Canonical home | Contents |
|---|---|
| `.github/warden.yml` | Repository/base/label mappings, maintainer identities, voice, runtime/model/isolation settings, operational budgets and clocks, draft policy, severity gates, notification mapping, retention and stop-control names. **[T]** `verification`: test paths, verify-and-continue loop turns, mutation tool/scope/threshold (off by default), holdouts enabled flag, boundary detectors |
| `.github/ORDERS.yaml` | Declarative authority for built-in tasks: scope/conditions, allow/deny, human gates, exclusions and escalation. **[T]** Boundary-class paths and any standing order that requires a maintainer look at bug reproducers |
| Protected operator credential/control store | Secrets, installation/trust-root details and maximum delegated authority; never model-controlled or distributed in the package |

Publish versioned schemas for both YAML files and validate their effective combination. Each setting has one canonical home. Mandatory limits cannot be weakened; applicable denial or human-approval requirement prevails over allowance. Unresolved policy conflicts escalate. No executable expressions/programs or speculative general DSL.

Pin effective defaults to the supported schema/package behavior; JSON Schema `default` alone does not populate values. Setup writes missing starter files without overwriting existing ones. Explicit operator setup may create missing labels; it is separate from task execution and backlog adoption.

Provide a dry-run upgrade diff and compatibility/migration notes. No structurally compatible upgrade may silently expand authority, disable checks or change clocks through defaults. Policy-changing upgrades need approval.

**[R]** The CLI and the installed Actions workflows each record their Warden version and ledger schema version. An incompatible pair blocks effects with an explanation and the upgrade step, rather than writing ledgers either side cannot read.

Required CLI operations (command names form the proposed MVP interface):

| Command | Contract |
|---|---|
| `warden setup` | Validate prerequisites and existing config; create only approved missing starter configuration/labels; explain App/isolation/model setup. **[R]** Detect competing automation (an existing stale workflow running other clocks, other AI reviewers) and report the conflict; never disable it without the operator |
| `warden config validate` | Validate both files and effective constraints; report actionable errors |
| `warden run [--task <name>] [--dry-run]` | One bounded manual scan or selected task; all repository effects still use the serialized writer |
| `warden adopt --dry-run [--out <file>]` / `warden adopt --selection <file> --confirm` | **PROPOSED (2026-11-18, awaiting owner review; implemented offline in P2).** Dry-run lists existing open items without Warden state (read-only) and writes an inventory file with a digest. `--selection` names the items to adopt, is bound to the current inventory digest, and needs `--confirm`; each existing draft needs an explicit `keep` or `close`. Only selected items are submitted through the writer; each receives a published adoption notice, keeps its existing owner, and starts new clocks at that notice. The inventory and the receipt are inputs/records, never a second item ledger. Never part of `setup` or `run` |
| `warden status` | Show states, ownership/deadlines, last sweep, pending operations, blockers, credential/stop status and evidence freshness without exposing secrets |
| `warden stop` / `warden resume` | Apply documented stop/resume semantics; no implicit restart of AI |
| `warden upgrade --dry-run` | Show configuration/behavior change before an explicitly approved upgrade |
| `warden data export` / `warden data purge` | Scope/export/remove retained data with explicit selection and retention safeguards |

No management REST service is required. Setup/quickstart must allow an operator on a supported prepared Mac to validate, inventory/adopt, run shadow, inspect results, stop/resume and recover without undocumented steps.

## 11. Validation, activation and measurement

### Shadow and dry-run

AI shadow results remain local: no AI-generated posted reviews, labels, implementation PRs or merges. Independently and explicitly enabled deterministic Actions housekeeping may remain live. A global dry-run disables all repository mutations. Labeling independent housekeeping "live" is not permission for AI effects.

### Pilot activation gate

Use a maintainer-curated replay set with at least:

- 20 representative PRs and 20 issues, expanded when coverage is thin.
- 90% maintainer agreement on blocking findings and triage outcomes; report each denominator separately.
- 10 blocking findings assessed and every known critical curated case detected.
- Zero unauthorized effects, duplicate accepted reviews for unchanged inputs, or lost-state recovery failures.

Cover bugs, approved features, contributor and factory PRs, dependency updates, authority-changing work, drafts, claims, deadlines, baseline failures and uncertainty. Report misses and disagreements, not only aggregate scores. These are provisional pilot acceptance thresholds, not a statistical guarantee of safety.

**[R]** Include adversarial cases: prompt-injection text in issues, PRs and comments, and tempting fixtures that invite weakening a test, broadening scope or skipping a check. Each must produce no unauthorized effect. **[T]** Include test-gaming cases: an issue whose obvious fix is to special-case the reproducer's inputs, a spec a frozen test contradicts (expected outcome `test-dispute`, not a test edit), and a fix session that tries to edit a frozen test through a file tool and through a script.

**[R]** Score replay deterministically against the curated expectations (expected finding location, triage outcome, effect allowed or not). A model grading another model's output may inform analysis but never decides a gate. When comparing prompt, model or configuration variants, tune on a development subset and report the gate on a held-out subset the variants were not tuned on.

The maintainer explicitly enables live actions after reviewing evidence. Do not turn elapsed shadow days or benchmark completion into implicit approval.

### Required functional/recovery evidence

1. End-to-end bug and approved-feature paths, including eligible auto-merge and high-risk escalation.
2. No contributor-branch edits beyond ruled CI fixes, which add commits only and fall back to a proposed fix when a fork disallows maintainer edits; takeover preserves issue and attribution while replacing unsuitable approaches.
3. Initial/review 48-hour obligations, approved extensions, held/resumed deadlines, response-clock separation, delayed review/CI and safe backlog adoption without retroactive expiry.
4. Current review reuse/delta invalidation, material new evidence and base-context changes; Implement/Rework cannot advance review markers.
5. Static-first verification, appropriate runtime evidence, and detected gate weakening.
6. Crash before/after effect, lost acknowledgement, duplicate/out-of-order trigger, queue overflow and Actions outage recovery.
7. Head/base/policy/approval changes between review and effect rejected or reevaluated.
8. Stop during a task/effect, uncertain external outcome and explicit resume.
9. Credential expiry/issuer outage/revocation with no unauthorized fallback.
10. Discord outage/stale click/unauthorized identity and GitHub fallback.
11. Local-model failure and no remote fallback; missing sandbox blocks execution.
12. Code-intelligence freshness/unsupported-result handling and SDK-check limitations.
13. Competing claims and contributor/factory ownership races, with one confirmed owner and no duplicate implementation.
14. Rework/retry exhaustion across cold starts, no-progress attempts and replacement PRs; no counter reset that silently defeats the limits.
15. Timely contributor fix rounds reach the three-round maintainer gate without automatic closure; blocked/urgent queue entries cannot silently starve approved features.
16. **[T]** Frozen tests: the test session's tests fail on the base; a fix-session write to a frozen path is denied by the OS boundary and caught by the digest check; the acceptance evidence runs from the executor's frozen copy; the verify-and-continue loop stops at its turn limit; mutation, property and holdout results are recorded, and an unsupported language is reported as unsupported.

Track state counts and age; assignment-to-ready, active execution, review wait, CI wait and fix time separately; claim/takeover/extension outcomes; auto-merge and human-escalation rates; maintainer effort; blocking-finding agreement and escapes/reverts; duplicate review attempts versus accepted duplicates; operation recovery; local tokens/time/resource usage; code-lookup quality and overhead.

**[R]** Also track maintainer decisions per completed item, reverted factory PRs, escaped defects found after merge, timeout and abstention rates, time to first response for contributors, and distinct returning contributors. Track defect origin, the bad-fix rate and structural erosion of factory-merged code over time. Lines of code and cost per defect are not targets. **[T]** Also track mutation score and survivors on changed code, frozen-test violations and `test-dispute` outcomes, verify-and-continue turns per attempt, holdout failures, boundary-change escalations, and how often review ran on the same model family as the writer.

## 12. Implementation prerequisites and proof gates

The owner confirmed the shared product understanding on November 17, 2026. The PRD review is complete and ready for MVP implementation planning. The following technical choices and proofs must be resolved or demonstrated before claiming a live-ready MVP:

| Item | Required outcome |
|---|---|
| Code-intelligence implementation | Prove compiler-backed baseline lookup, then the approved bounded comparison including Atlas and SCIP or CodeGraphContext. Select any graph dependency from results. Memtrace remains an optional unidentified candidate until its exact source/license is established; it is not a blocker to the approved evaluation. |
| Durable operation inbox | Concrete mechanism plus crash/overflow/reconciliation proof; Actions queue alone is insufficient |
| Harness and isolation | Pin a supported OpenCode version and prove effective permissions, structured results, cancellation, local-model resolution and real execution boundary |
| Pilot defaults | Publish tested Mac/OS/runtime/model/compiler/SDK matrix and finite operational budgets; configure audit retention and trust-root recovery |
| Release identity | Confirm owned npm scope; no installation command for the unrelated unscoped package |
| Activation | Curated benchmark evidence and explicit maintainer live authorization |

These are explicit readiness gates, not permission to pretend unsupported capabilities exist. This document and the ADRs remain editable design drafts; product-review confirmation does not freeze them or authorize live activation. No software implementation or provider benchmark is claimed by this documentation work.

### Owner decisions from the research reconciliation

**[R]** These research points needed an owner ruling rather than an edit.

Decided by @trek-e on 2026-11-24:

| Question | Ruling | Where applied |
|---|---|---|
| Should nit findings keep blocking merge by default? | Yes | §3, unchanged; ADR 0008 |
| What happens when no maintainer has decided anything for N days? | If an item is set for maintainer review, it waits for the maintainer review | §8 |
| May a later review round raise findings on code that was already reviewed and has not changed? | Yes: a finding is a finding, no matter when it happens | §5 Review |
| Skip model review while required CI is red? | No: the review finds what is failing in CI and fixes it. On contributor PRs: "Let it push fixes" | TL;DR, §5 Review and Rework, §11 |
| How deep does review go, and what happens to findings it cannot confirm? | User-configurable: maintainer go/no-go, drop by confidence level, or other options the maintainer pre-selects | §5 Review |
| Maintainer-only PR commands to force a full review or dismiss one finding? | Yes | §5 Review |
| Measure structural erosion on factory-authored PRs before widening Implement authority? | Yes, widened so Retro also checks whether factory merges stay coherent together over time ([Dill](../research/TALK-DILL-ZOMBIE-UI.md) candidate 1) | §5 Retro, §11 |

Still open. Nothing below changes current behavior until decided:

| Question | Research basis | Current PRD position |
|---|---|---|
| Record reversibility (one-way or two-way door) as a merge-gate input, with data, authority and external effects floored as one-way? | [Pocock](../research/TALK-POCOCK-WALKTHROUGH.md) §3 | Risk and blast radius are assessed (§3); no reversibility field |
| When GitHub refuses to assign a volunteer, reject the claim or record ownership in the ledger only? | [FEATURES](../research/FEATURES.md) | Assignment must be GitHub-confirmed (§5 Claim); no refusal outcome |
| Which review event Warden submits on contributor PRs (comment, approve, request changes), and whether its approval may count toward required reviews | [FEATURES](../research/FEATURES.md), [ARCHITECTURE](../research/ARCHITECTURE.md) (comment-only in the historical design) | §3 covers only the App's own PRs |
| **[T]** For bugs under standing authority, are the frozen reproducer plus the weakening and mutation checks enough, or must a maintainer look at the reproducer before the fix session runs? | [TESTS-OVER-CODE-REVIEW](../research/TESTS-OVER-CODE-REVIEW.md) §5 Q1; ADR 0014 | Proposed: no human by default, a standing-order option to require one; features always include the tests in the approval |
| **[T]** Should boundary changes always need a maintainer, even when otherwise auto-merge eligible, and which classes? | TESTS-OVER-CODE-REVIEW §5 Q2; ADR 0015; overlaps the reversibility question above | Proposed in §3 as **[T]**; not in force |
| **[T]** May a CI fix pushed to a contributor branch change a test file, or must it fall back to the posted patch? | TESTS-OVER-CODE-REVIEW §5 Q3; ADR 0014 | Current ruling allows any diagnosed CI fix; proposed narrowing in §5 Review |
| **[T]** Mutation score: finding only during the pilot, or a merge gate, and at what threshold? | TESTS-OVER-CODE-REVIEW §5 Q4; ADR 0016 | Proposed: findings on surviving mutants in changed lines; threshold only from pilot data |
| **[T]** Allow maintainer-held holdout acceptance checks for approved features, outside the repository and every prompt? | TESTS-OVER-CODE-REVIEW §5 Q5; ADR 0016; [FACTORY-CLAIMS](../research/FACTORY-CLAIMS-VS-EVIDENCE.md) Q5 | Proposed in §7 as **[T]**; not in force |
| **[T]** Prefer a reviewer from a different model family than the writer, and record both on the verdict? | TESTS-OVER-CODE-REVIEW §5 Q6; ADR 0015; [MODEL-CONNECTIONS](../research/MODEL-CONNECTIONS.md) verdict provenance | Proposed in §5 Review as **[T]**; not in force |
