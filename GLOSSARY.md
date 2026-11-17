# The Warden of the Gate

An AI software factory that keeps a GitHub repo moving. One instance per repo, configured by that repo; GSD Core is the first one it runs on.

## Language

### Identity

**Software factory**:
Warden itself: a self-maintaining AI system that keeps a GitHub repo moving — triage, review, implement, rework, sweep, retro — with human oversight.
_Avoid_: "Claude Code plugin", "AI reviewer", "bot"

**Pilot repo**:
The first repo a factory instance is deployed to and validated on — GSD Core for Warden. Other repos join via config.
_Avoid_: "test case" (that is a validation run), "reference implementation"

**Product**:
A repo or program the factory maintains or builds — e.g., the pilot repo. A product's internal workflows (the pilot repo's phase loop) are maintained like any other code, never executed as factory machinery.
_Avoid_: "feature of the factory", "part of Warden"

**Test run**:
A validation execution of factory tasks against real or replayed items — e.g., in Bionic before a task is trusted unattended.
_Avoid_: "test case" (ambiguous between repo and run)

### Runtime

**Harness**:
The agent runtime that drives a language model over tools in a session (file ops, shell, skills): opencode, pi, Bionic.
_Avoid_: "model" (that is the model runtime layer), "AI engine"

**Open harness**:
A harness not locked to a single vendor's models or engines. Warden targets open harnesses only.
_Avoid_: naming any specific vendor's closed agent as a Warden platform

**AgentRunner**:
The boundary that adapts a harness's sessions and results to the factory's execution contract.
_Avoid_: "runner" (that is the deterministic core), "plugin"

**Runner**:
The deterministic coordinator that selects work, tracks progress, enforces policy and budgets, and validates agent proposals before effects.
_Avoid_: "AgentRunner" (that is the harness-specific seam)

**Model pool**:
The explicitly permitted models for factory work. MVP work is local-only; a later remote option does not imply fallback permission.
_Avoid_: "LLM backend", "provider"

**Execution mode**:
How AI work starts. The MVP uses manually triggered, once-through scans; later modes may include events or schedules. Deterministic housekeeping is separate from AI pickup.
_Avoid_: "mode" unqualified

### Oversight & review

**Tiered autonomy**:
The boundary between actions permitted by standing authority and actions requiring a maintainer decision, determined by scope, change risk and verified evidence rather than model confidence alone.
_Avoid_: "supervised mode", unqualified "autonomous"

**Decision card**:
An actionable request for an authorized maintainer to approve or deny a specific proposal, with its scope, risk, evidence and recommendation.
_Avoid_: "report" (that is Review's output)

**Finding**:
A review result with a severity — blocker, major, minor, nit. Blocker always stops a merge; the other three block only when enabled in config (on by default — any nit can become a major with one change).
_Avoid_: "issue" (that is a GitHub issue), "comment"

**Decision corpus**:
The accumulated maintainer approvals and denials, with their reasoning and scope, that inform future proposals and judgments about likely maintainer agreement. Prior rulings remain binding unless the maintainer revises them in light of new evidence.
_Avoid_: "denial dataset" (excludes approvals), "agent memory" (does not identify whose decisions carry authority)

**Credential controller**:
The trusted factory component that maintains credentials within an operator-approved authority ceiling. It may renew delegated access but cannot grant itself new authority or override deliberate revocation.
_Avoid_: "master control program agent" (conflates credential authority with model judgment), "unrestricted service principal"

**Workflow state**:
An item's current position in the factory process, distinct from its kind, severity, risk and owner.
_Avoid_: "bucket" (conflates independent classifications)

**Delivery commitment**:
A contributor's obligation to supply complete, ready-for-review work by an explicit deadline. Replying to a comment is not delivery.
_Avoid_: "claim timeout" without distinguishing delivery from response silence

**Maintainer hold**:
An authorized pause of a work obligation that preserves its unexpired delivery time. Releasing the hold establishes the resumed deadline; merely stopping the factory does not create a hold.
_Avoid_: "kill switch" when pausing a contributor's obligation

**Fix round**:
A substantive attempt to address a blocking review, distinct from an acknowledgement, launch retry or unrelated comment. Factory rework and contributor correction have separate escalation paths.
_Avoid_: "review count" when counting correction attempts

**Code intelligence**:
Source-grounded symbol, reference and relationship information used to understand code and change impact. Retrieval does not grant authority or prove correctness.
_Avoid_: "code graph" when referring only to text search

**SDK enforcement**:
Verification that code obeys the applicable SDK/API and supported-target constraints, distinct from retrieving documentation or controlling an agent's tools.
_Avoid_: "SDK integration" when enforcement is intended

### Configuration

**Configuration schema**:
The versioned contract for valid operational settings and standing authority. Structural compatibility alone does not make changed behavioral defaults safe.
_Avoid_: "config" unqualified, "warden.yml" as concept without version

**Schema version**:
The identifier for the configuration contract a deployment uses, separate from the package or model version.
_Avoid_: "version" unqualified, "semver" without context

**Setup command**:
The explicit operator action that initializes missing deployment configuration and prerequisites without adopting existing backlog or overwriting established choices.
_Avoid_: "onboarding" without referencing `warden setup`

**Kill switch**:
A stop control that prevents new factory effects and requests cancellation of active work while preserving recovery and status access. It cannot recall an effect already accepted by an external system.
_Avoid_: "emergency stop" without referencing the kill-switch variable

### Rule Model

**Standing orders**:
Maintainer-approved declarative limits and permissions for factory activities, defining scope, conditions, exclusions, approval and escalation. Past decisions inform proposals but do not silently expand this authority.
_Avoid_: "rules" unqualified, "ORDERS.yaml" without scope description

**Rule scope**:
The boundaries of what a standing order authorizes the agent to do. Each rule has explicit authority limits, "what NOT to do" sections, and clear program boundaries. Rules should start narrow and expand trust as trust builds.
_Avoid_: "permissions" unqualified, "authority" without scope

**Approval gate**:
A human sign-off requirement for certain actions. Some actions require owner approval before execution; others have standing approval for routine operations. Gates decide whether the factory acts or escalates to a decision card.
_Avoid_: "gate" unqualified, "human approval" without context

**Execute-Verify-Report pattern**:
The disciplined loop for every task in a standing order: (1) Execute the actual work, (2) Verify the result is correct, (3) Report to the owner what was done and what was verified. Prevents the common failure mode of acknowledging a task without completing it.
_Avoid_: "task completion" without verification proof

**Program**:
A named group of standing-order rules for a distinct domain of factory activity, not arbitrary executable code.
_Avoid_: "feature" or "capability" without the standing-order framing
