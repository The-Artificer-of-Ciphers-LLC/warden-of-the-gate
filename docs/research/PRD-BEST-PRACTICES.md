# PRD Best-Practice Checks

**Researched:** 2026-11-17
**Scope:** Primary-source checks supporting refinement of the [PRD](../prd/0001-warden-of-the-gate.md), not an implementation specification or a vulnerability audit.
**Confidence:** HIGH for the cited platform behavior; recommendations are design judgments, not verified implementations or owner approvals.

The PRD, glossary, and ADRs are initial working drafts. Older research contains recommendations from the earlier Claude-specific design and conflicting state-authority proposals. Its existence does not make those recommendations settled decisions. The current interview has established a one-repository-per-instance MVP covering bugs and approved features/enhancements, with enterprise management APIs and Helm packaging deferred.

## 1. GitHub identity and authority

### Verified facts

- GitHub recommends a GitHub App for long-lived integrations rather than a personal access token. Apps offer fine-grained permissions, repository-level installation control, and an identity independent of a particular employee or maintainer. [GitHub: deciding when to build an App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)
- Installation access tokens expire after one hour. Their repository access and permissions can be narrowed when minted; neither can exceed the installation's grants. [GitHub: installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- Pull request authors cannot approve their own pull requests. A separate local agent session is not a separate GitHub reviewer identity. The first statement is a platform rule; the second follows from authorization being attached to the authenticated actor, not the number of sessions. [GitHub: reviewing proposed changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)

### Recommendations

- Use a GitHub App as the posting identity; keep its private key and write tokens outside agent sessions.
- Prefetch review inputs with deterministic code. Give the worker no GitHub write credential, and preferably no GitHub credential when packet files suffice.
- Distinguish an independent verification pass from a GitHub approval. Do not promise unattended merging of factory PRs if repository rules require an independent approval that the deployment cannot obtain.
- Preserve required repository checks and reviews. A Discord approval is a Warden authorization decision, not automatically a GitHub PR review.

**Owner decisions:** GitHub App adoption and eligible live auto-merge are confirmed. Preserve all repository-required reviews/checks. Preflight incompatible branch rules and explain a legitimate approval path; neither a second model session nor a Discord decision fabricates an independent GitHub review.

### Credential continuity follow-up

The owner requires automated credential lifecycle management by default, rather than routine token expiry disabling the factory. Separate routine token renewal, root-key rotation, and new permission grants:

- GitHub App JWTs use `RS256` and have an expiry no more than ten minutes into the future. GitHub's authentication SDK support can regenerate JWTs; installation-token issuance then uses that app identity. [GitHub: generating a JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- GitHub App private keys do not expire automatically; they must be revoked when retired. GitHub allows multiple keys for rotation without downtime and recommends protecting the signing key, for example in a sign-only key vault. The documented key-generation procedure uses App settings; this research has not established an API allowing an installation token to replace its own root signing key. Do not claim universal automated root-key recovery on that basis. [GitHub: managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- Adding App permissions requires approval by the installed account or authorizing user before the expanded permissions take effect. Token renewal cannot exceed the installation's existing grants. [GitHub: changing App permissions](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#changing-the-permissions-of-a-github-app), [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- GitHub recommends caching usable tokens, expiring tokens, protecting root keys, and promptly revoking compromised credentials. It distinguishes operator-hosted server installations from native/public clients: a distributor must not embed an App private key in a package shipped to users. [GitHub: App best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- OWASP recommends application logging of authentication outcomes, authorization failures, privilege/token administration, and cryptographic-key rotation, with enough context to identify when, where, who, and what happened. This is first-party OWASP guidance, not a GitHub API guarantee. [OWASP: Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

**Recommendations:** Use a credential controller outside model sessions, with deterministic enforcement of operator-approved issuance policy. Automatically mint or renew the minimum required credentials inside the approved ceiling, refresh before expiry, and retry transient issuer failures with bounds and backoff. Log metadata and outcomes, never secret values. An AI helper may diagnose and prepare requests but must not be the sole authority authorizing broader credentials. No controller can authenticate after every valid trust root has been revoked or force an unavailable issuer to respond: keep the daemon and recoverable queue running, suspend only operations that lack valid authority, and raise a visible recovery request. Never silently substitute a broader personal credential, bypass repository rules, or renew deliberately revoked authorization.

## 2. Events, schedules, and recovery

### Verified facts

- `ready_for_review`, `synchronize`, and `closed` are actions of `pull_request`; `pull_request_review` and `pull_request_review_comment` are separate event names. `pull_request.review` is not the event spelling shown in GitHub's trigger reference. [GitHub: workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- Scheduled Actions may be delayed or dropped under load, run on the default branch, and are automatically disabled in public repositories after 60 days without repository activity. They are not an exact-deadline service. [GitHub: schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- GitHub signs webhook bodies with HMAC-SHA256 in `X-Hub-Signature-256`; signature comparison should use a constant-time comparison. Secrets must not be committed. [GitHub: validating deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- GitHub recommends checking event type and action, responding within ten seconds, and using `X-GitHub-Delivery` to identify a delivery. Requested redeliveries retain that delivery ID. [GitHub: webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- Failed deliveries are not automatically redelivered. GitHub provides redelivery for deliveries from the past three days. [GitHub: redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)

### Recommendations

- Define deadlines as eligibility times; reconcile overdue work on the next successful sweep. Report last successful sweep and overdue counts.
- Treat events as prompts to reconcile current GitHub state, not as the only durable record of work. Recover from missed events with startup and periodic reconciliation.
- Persist accepted event/work identifiers before acknowledging durable acceptance. Separate a successfully applied event from an interrupted attempt so a redelivery can resume rather than be discarded.
- Do not infer fork-PR pushes from base-branch `push` events.
- Never run contributor-controlled code in privileged bookkeeping workflows. Select the precise event/permission design before implementation; do not copy old research's blanket claim about a future `pull_request_target` platform ban without independently verifying the claimed policy.

**Owner decisions:** MVP AI pickup is manually triggered, once-through scans; webhooks follow validation. Deterministic Actions housekeeping continues independently. Expired obligations are enforced on the next successful sweep; exact workflow triggers must satisfy isolation and recovery requirements.

## 3. Ledger, concurrency, and merge evidence

### Verified facts

- GitHub does not generally support conditional writes for unsafe HTTP methods unless an endpoint explicitly documents them. Conditional GET support is not a comment-update compare-and-swap mechanism. [GitHub: REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)
- GitHub recommends serial API requests, spacing large volumes of mutating requests by at least one second, and honoring rate-limit retry/reset headers with bounded retries. [GitHub: REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- The PR merge endpoint accepts an expected head `sha` and returns conflict if it does not match. The newer asynchronous merge endpoint also accepts a head SHA; acceptance or queue entry does not mean the PR has merged. [GitHub: merge a PR](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request), [asynchronous merge](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously)

### Recommendations

- Use the agreed authoritative per-item GitHub ledger comments, with labels as a searchable projection and an explicit maintainer-override path. The earlier competing repository ledger file has been removed from the current design.
- A `rev` counter or expiring lease in an ordinary comment does not itself prevent concurrent writers. Specify serialization and crash recovery across both the local runner and Actions before claiming lossless updates.
- Use durable operation identities, an outbox/reconciliation protocol, and explicit handling of uncertain API outcomes. Say "idempotent effects with reconciliation," not an unqualified exactly-once transaction across GitHub APIs.
- Intake, implementation, and rework must not advance `lastReviewedSha`. Only a completed, validated review does so. Issues have input revisions, not necessarily PR head SHAs.
- Key review evidence to head SHA, relevant base context, policy version, and review/result version. An unchanged head can still need gate reevaluation after CI, policy, approvals, or base context change without repeating model review unnecessarily.
- Recheck head, required checks, applicable approvals, policy, and kill switch immediately before a merge; send the expected SHA. Track queued/accepted/merged as different outcomes.
- Preserve durable control-plane state across restarts. A local cache may be disposable; pending actions, accepted approvals, decision history, and recovery information cannot all be treated as disposable.

**Owner decisions:** GitHub per-item ledgers are authoritative; labels are a projection, with a durable local recovery journal/corpus and accepted decisions also on GitHub. The serialized Actions writer is confirmed. Review identity includes head, relevant base context and policy; only changed material inputs invalidate completed review. Proving the concrete durable inbox remains an implementation prerequisite.

### Shared Actions/local writer follow-up

The owner requires Actions bookkeeping to keep working while the Mac is off; a Mac-local mutex alone cannot serialize those writers.

GitHub documents repository-wide workflow/job concurrency groups. By default only one run is pending and newer queued work replaces that pending run; `queue: max` allows up to 100 pending runs, with additional runs canceled. `queue: max` cannot be combined with `cancel-in-progress: true`. Dispatch order is not a guaranteed operation order. [GitHub: workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

**Recommendation:** Route control-plane item mutations through one serialized Actions posting path, shared by Intake, Claim, Sweep, and local result application. Local AI remains local; the local runner submits schema-validated action intents rather than competing item-ledger writes. Use the same repository concurrency group, do not cancel active mutations, and retain a durable operation inbox/reconciliation mechanism because the Actions pending queue is bounded and not a durable business-work queue. Re-read state and reject stale intents before effects; reconcile accepted-but-unacknowledged writes. Choose the concrete inbox representation during the implementation capability spike, before claiming recovery guarantees.

This adds Actions round trips and makes live state mutations dependent on Actions availability. During an outage, preserve intents and visibly report them pending; never substitute an unsynchronized local write path to make the dashboard look successful.

**Owner decision:** The shared serialized Actions posting path and durable inbox/reconciliation requirement are confirmed. The concrete inbox representation and its failure-mode validation remain implementation prerequisites.

## 4. Deployment and configuration ownership

### Verified facts

- Kubernetes ConfigMaps are for non-confidential configuration; Secrets hold credentials such as keys and tokens. Secrets require appropriate encryption-at-rest and least-privilege controls; the resource name does not make them automatically secure. [Kubernetes: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- Container writable filesystems are ephemeral; persistent volumes outlive an individual Pod. Persistence depends on the chosen volume type and deployment, not on declaring all container files durable. [Kubernetes: volumes](https://kubernetes.io/docs/concepts/storage/volumes/)
- Node recommends Active LTS or Maintenance LTS releases for production. The release table consulted lists Node 20 as EOL and Node 24 and 26 as LTS. The PRD's Node 20 image is therefore not a suitable new deployment baseline. [Node: releases](https://nodejs.org/en/about/previous-releases)

### Recommendations

- Separate repository policy from deployment bootstrap: repository URL, credential references, persistent state path, and model endpoint must be supplied before the process can retrieve repository configuration.
- Keep secrets out of repository policy. A chart may avoid duplicating per-repository rules but cannot truthfully require "no cluster-level secrets or config" while authenticating as a GitHub App.
- Start with one active control-plane writer per repository. Do not enable horizontal autoscaling until concurrency, shared-state, and model-resource arbitration are specified.
- Remove the nonfunctional illustrative Dockerfile rather than treating it as a tested artifact. Document deployment requirements first; validate actual packaging when built.
- Helm is deferred for the agreed MVP. A portable container image does not require building enterprise orchestration or a chart now.

**Owner decisions:** Mac/OpenCode/local inference first; Warden Docker distribution later. Durable state, corpus and recovery are required. Executing code requires a real OS/container boundary; a worktree alone is not isolation. Publish the exact tested runtime/model/isolation matrix before release.

## 5. Schema evolution and standing orders

### Verified facts

- SemVer describes compatibility of a declared public API. A minor version denotes backward-compatible functionality; it is not permission to change user-visible behavior arbitrarily. Initial `0.y.z` releases may evolve before a stable public contract is declared. [Semantic Versioning 2.0.0](https://semver.org/)
- JSON Schema's `default` is an annotation; standard validation does not insert missing values into an instance. A defaults resolver or explicitly configured validator behavior is a separate mechanism. [JSON Schema: annotations](https://json-schema.org/understanding-json-schema/reference/annotations)

### Recommendations

- Treat configuration syntax and effective policy as related but distinct contracts. A structurally valid update that disables a merge gate or broadens authority is not a harmless default migration.
- Pin effective defaults to a supported schema/policy version. Require an explicit diff and approval for autonomy-changing migrations; preserve previous behavior until approved.
- Reject unsupported/missing schema versions with actionable diagnostics rather than inventing a migration from `0.0.0`.
- Make migration validation precede application and use an explicit dry-run/apply contract. Do not let `--confirm` mean "declare a manually unresolved breaking change complete."
- Keep standing orders declarative: configure built-in capabilities, allowed scope, approval requirements, and escalation. Do not introduce arbitrary executable programs or an unrestricted expression language as an incidental YAML feature.
- Resolve the distinction between forbidden repo-supplied task logic and required test execution. Warden can own task orchestration while invoking maintainer-authorized verification commands in an isolated workspace; this requires an explicit execution contract, not an arbitrary command supplied by an issue.
- Record learned approvals/denials as decision evidence, not automatically executable instructions. The owner has confirmed that authority expansion requires approval of a standing-order change.

**Owner decisions:** Standing orders are declarative, not arbitrary task programs. Mandatory limits apply first; applicable denial or human approval wins over allowance, with unresolved conflicts escalated. Trusted build/lint/test commands are permitted within the execution boundary.

## 6. Discord quick approvals

### Verified facts

- Discord supports buttons, commands, and modals; interactions identify the invoking user/member and interaction context. [Discord: interactions overview](https://docs.discord.com/developers/interactions/overview), [interaction objects](https://docs.discord.com/developers/interactions/receiving-and-responding)
- Interactions can be received through either the Gateway or HTTP outgoing webhooks; these are mutually exclusive interaction-delivery modes. A Gateway connection does not require a public Interactions Endpoint URL. [Discord: interactions overview](https://docs.discord.com/developers/interactions/overview#preparing-for-interactions)
- Gateway communication uses a persistent WebSocket connection. [Discord: Gateway](https://docs.discord.com/developers/events/gateway)
- HTTP interaction endpoints must validate `X-Signature-Ed25519` and `X-Signature-Timestamp` and acknowledge Discord's verification PING. [Discord: preparing an endpoint](https://docs.discord.com/developers/interactions/overview#configuring-an-interactions-endpoint-url)
- An initial interaction response is required within three seconds; interaction tokens remain usable for followups for fifteen minutes. Deferred responses are supported. These limits concern a received interaction, not the lifetime of a maintainer's underlying approval request. [Discord: interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-callback)
- Discord has guild roles and channel permission overrides. Discord role membership is not proof of GitHub repository authority. The first statement is a platform fact; the second is a Warden authorization design requirement. [Discord: permissions](https://docs.discord.com/developers/topics/permissions)

### Recommendations

- For the local-first MVP, prefer a Gateway-based optional Discord adapter over exposing a public approval server. Account for disconnects, reconnects, and the runner being asleep.
- Present a short summary, risk/blast radius, evidence links, decision requested, and Approve/Decline controls. Provide a reason field, especially for denials, to enrich the decision corpus.
- Configure an explicit Discord-user-ID to authorized maintainer mapping and validate repository/action authority at decision time. Do not authorize by display name, message text, emoji reaction, or merely seeing a button.
- Bind a decision request to a specific proposal revision or PR head, policy revision, intended action, and expiry. Reject duplicate, superseded, unauthorized, or stale decisions visibly.
- Acknowledge the interaction promptly, persist the decision, and mirror it to GitHub before executing the authorized action. If persistence fails, report failure and do not claim approval took effect.
- Keep the approval request durable independently of Discord interaction tokens. Disable or update resolved cards; no response must never imply consent.
- Use only approved, non-sensitive notification content. Do not send code, credentials, private discussion, or sensitive implementation details to a chat service as a side effect of enabling notifications.
- Chat approval must not bypass repository-required reviews or checks. Preserve a GitHub-native decision path when Discord is unavailable.

**Owner decisions:** Optional Gateway connectivity, explicit user-ID-to-maintainer mapping, revision-bound approvals, recording on GitHub before acting, and GitHub fallback are confirmed. Action cards expire after 24 hours by default, configurable, or sooner on invalidation. Design approvals persist until materially changed. Enrollment must use authorized operator configuration; no guild-role/display-name inference.

## 7. Static-first verification

The owner prioritizes lint and static analysis because agent- or contributor-authored tests can be tailored to the implementation instead of validating the requirement. Existing research already provides the relevant distinction:

- The [correction ladder](FRAMEWORK-CORRECTIONS.md) prioritizes design constraints, then static checks, then dynamic verification, and finally prose. It distinguishes structural constraints from observable runtime behavior; it does not recommend removing behavioral verification.
- The [Tan talk research](TALK-SLOP.md) records examples of architecture boundaries and forbidden syntax enforced by lint, as well as runtime and property-based verification for behavior. Its historical "never merges in v1" recommendation does not describe the current owner-approved auto-merge direction.
- The [book research](BOOK-SE-BEST-PRACTICES.md) records older empirical claims about static analysis and inspections. Those figures are historical research notes, not a measured prediction of Warden's effectiveness or a justification for eliminating runtime checks.
- ESLint's official `no-restricted-syntax` rule supports AST selectors and custom messages, illustrating a concrete way to enforce structural bans without a bespoke test per occurrence. [ESLint: no-restricted-syntax](https://eslint.org/docs/latest/rules/no-restricted-syntax)

**Recommendations:** Make static checks first-class merge gates and run applicable checks before expensive model review. Prefer eliminating the defect class rather than adding implementation-mirroring tests. Preserve behavior-specific evidence where static checks cannot establish correctness. Protect the verification policy itself: neither lint nor tests are trustworthy if the same change can quietly disable rules, exclude affected files, skip checks, or weaken assertions. Review verification changes against approved requirements rather than treating more tests or greater coverage as proof of correctness.

## 8. Runtime documentation drift

- The old OpenCode `/docs/sdk/` URL now redirects to explicitly labeled V1 documentation. The current documentation index points to a different V2 SDK surface; do not confuse the old SDK's `/v2` client export with the current OpenCode product's V2 SDK. [OpenCode: V1 SDK](https://opencode.ai/v1/docs/sdk/), [current index](https://opencode.ai/docs/llms.txt)
- Current `@opencode/sdk` documentation describes an embedded host using in-memory routing with no HTTP listener and explicit lifecycle cleanup. It also notes project configuration/plugin loading during worktree operations. [OpenCode: current SDK](https://opencode.ai/docs/build/sdk/)
- Current OpenCode policy rules use last-match precedence and drop invalid statements with a warning. That is not Warden's agreed deny/approval-wins, invalid-policy-does-not-grant-authority contract. Adapters must enforce Warden policy independently and validate effective configuration rather than blindly forwarding standing orders as harness policy. [OpenCode: policies](https://opencode.ai/docs/policies/)
- OpenCode's documented model selection may fall back when a configured model is unavailable. Warden must explicitly prevent unapproved providers/models and verify the resolved model before work; setting a default alone is insufficient to enforce no silent remote fallback. [OpenCode: models](https://opencode.ai/docs/models/)
- LM Studio documents headless operation through `llmster` independently of a desktop UI. This supports separating the model service from the harness. [LM Studio: headless operation](https://lmstudio.ai/docs/developer/core/headless)
- Pi's current first-party README links print/JSON, RPC, and SDK modes and identifies the package as `@earendil-works/pi-coding-agent`. Historical package/API examples should be checked when pinning a supported adapter. [Pi: source README](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/README.md)

**Recommendations:** Specify the adapter contract and required capabilities in the PRD; choose and pin a tested harness version during implementation. Do not copy version-specific snippets from old research without a capability spike. Keep policy, resolved-model checks, schema validation, process isolation, and write authorization in Warden's control rather than assuming the harness provides equivalent semantics.

## 9. Automated dependency approval and merging

GitHub documents automatic approval of Dependabot PRs, metadata-based classification of update type and dependency type, and automatic merging once required branch-protection checks and approvals are satisfied. Its example scopes an automatic merge to a particular dependency and patch update; that example demonstrates a mechanism, not a universal safety claim about all dependency updates. [GitHub: automating Dependabot](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions)

The owner requires automated approval and merging for Dependabot and other automated vulnerability remediation. Keep the distinction between trusted origin and permitted scope: verify GitHub metadata, evaluate the actual change, preserve verification controls, and apply standing authority. Breaking majors, migrations, authority changes, uncertain/high-impact work escalate unless the specific class is already explicitly authorized. A security label alone never overrides the high-risk gate.

Automatic approval also depends on GitHub identity: an App cannot satisfy an independent author-approval requirement by approving its own PR. Do not generate a second nominal identity merely to make a review count appear independent.

## 10. Distribution naming

The public npm registry already resolves `warden` to an unrelated package. The owner has agreed to keep the executable name while publishing under an organization-owned scope; the exact scope and package availability must be confirmed before release. Do not retain installation instructions that install the unrelated unscoped package. [npm registry: warden metadata](https://registry.npmjs.org/warden/latest)

## 11. Agentic contribution and review turnaround

### Verified guidance

- GitHub recommends clear, well-scoped agent tasks with complete acceptance criteria. Its guidance distinguishes broad, ambiguous, sensitive work from suitable initial tasks; it does not establish a universal agent completion SLA. It recommends submitting a batch of review comments together rather than triggering the agent separately for individual comments. [GitHub: cloud-agent best practices](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results)
- OpenAI's current agent guidance emphasizes explicit goals, context, constraints, and completion conditions; planning difficult work; and running relevant checks and reviewing results before acceptance. It does not prescribe a seven-day or 48-hour contribution deadline. [OpenAI: best practices](https://learn.chatgpt.com/guides/best-practices)
- Google's published review guidance recommends responding within one business day and ideally completing multiple review rounds in a day. It explicitly distinguishes response latency from the duration of the entire review process, and says not to lower quality standards for apparent speed. This is human-team guidance, not a measured local-agent SLA. [Google: review speed](https://google.github.io/eng-practices/review/reviewer/speed.html)
- Google recommends one self-contained change with its relevant checks and enough context for review. Smaller, coherent changes are easier to review and reason about; this does not justify incomplete placeholders merely to meet a deadline. [Google: small changes](https://google.github.io/eng-practices/review/developer/small-cls.html)

### Recommendation and owner direction

Withdraw the proposed seven-day default: it was a design suggestion, not a researched agentic-development standard. The owner wants an agent-first contribution policy: complete initial submission within 48 hours, then a fresh 48-hour window to address a blocking review response. These are configurable repository policy limits, not claims about measured local-model performance. Work may finish much sooner; local run budgets and the factory's three-cycle rework limit remain separate controls.

Recommend measuring assignment-to-ready time, active execution time, review waiting, CI waiting, review-fix time, extension frequency, and takeover outcomes separately. Assess the policy against the actual local model and pilot workload rather than importing a cloud-provider marketing latency or a human weekly cadence. Large or uncertain work should receive approved scope/acceptance criteria and an explicit exception or independently complete deliverables, not weakened verification or deadline-shaped placeholder submissions.

**Confirmed event semantics:** Initial submission is due 48 elapsed hours after assignment, not after a later confirmation. A published blocking review starts the new fix window, and a subsequent substantive review round starts the next window. Author acknowledgements, unrelated comments, and placeholder pushes do not renew delivery deadlines. Waiting for the reviewer or CI does not count against the author. The separate five-day silence policy cannot override an earlier delivery deadline. Enforce an expired obligation on the next successful sweep and retain maintainer-approved extensions.

**Follow-up owner decisions:** Explicit maintainer holds freeze remaining delivery time and publish a revised deadline on release; stopping Warden does not itself extend commitments. Three timely contributor fix rounds with remaining blocking findings trigger a maintainer decision, not automatic closure. Deterministic priority plus aging/capacity must prevent feature starvation while urgent authorized work and finishing existing PRs receive priority.

## 12. Consolidation checklist

The consolidated PRD addresses these earlier inconsistencies. Retain this checklist to verify subsequent edits rather than treating historical research or overriding bullets as the current specification:

1. Restore the dedicated Review task; remove the duplicate Implement heading and repeated invariant sections.
2. Keep deterministic Intake separate from AI root-cause analysis and approval decisions.
3. Separate workflow state, backlog category, severity, risk tier, ownership, and processing lease. "Exactly one state label" does not mean "exactly one label."
4. Replace the old Claim flow with immediate assignment, confirmation/deadline commitments, protected human ownership, and the agreed takeover policy.
5. Apply design/acceptance-criteria approval and implementation to features/enhancements as well as bug fixes.
6. Resolve abandoned fork-work reuse without running untrusted branches in privileged environments.
7. Define review/rework counters independently from implementation attempts and successful review commits.
8. Define the decision corpus's durability, provenance, maintainer/repository scope, denial matching, and evidence threshold for proposing a revised ruling.
9. Define kill-switch behavior for in-flight work, not just checks before batches. "Checked before a batch" does not guarantee "all operations stop immediately."
10. Replace impressionistic rollout gates with sample sizes, measurable acceptance thresholds, stop conditions, and rollback criteria, including false positives and erroneous autonomous actions.
11. Clearly separate MVP requirements from deferred API/enterprise/deployment proposals.
12. Reconcile all task sections and ADRs with the agreed operating boundaries; adding an authoritative paragraph above conflicting steps is only an interim interview capture.
