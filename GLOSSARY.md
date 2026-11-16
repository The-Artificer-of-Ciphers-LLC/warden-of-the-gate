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
The seam between warden-core and a harness: an adapter that launches headless sessions, pins the tool surface, and returns schema-validated structured output. One adapter per harness.
_Avoid_: "runner" (that is the deterministic core), "plugin"

**Runner**:
The deterministic warden-core process that picks queues, computes deltas, assigns tiers and enforces caps. It holds no model; it spawns one agent session per item through an AgentRunner adapter and validates every result.
_Avoid_: "AgentRunner" (that is the harness-specific seam)

**Model pool**:
The set of models Warden may route to: a local floor (Mac MLX via LM Studio) as the default, an opt-in remote high-end ceiling for heavy tasks. The runner never silently falls back to a paid or remote model.
_Avoid_: "LLM backend", "provider"

**Execution mode**:
How the factory picks up work — real-time (event-triggered) or batch (calendar-scheduled). Per-repo, set when the repo is added.
_Avoid_: "mode" unqualified

### Oversight & review

**Tiered autonomy**:
Warden's oversight model: risk tier plus verifier confidence decide whether the factory acts (e.g., merges) or escalates to a human decision card. Thresholds are per-repo config.
_Avoid_: "supervised mode", unqualified "autonomous"

**Decision card**:
The short artifact posted at a human gate: linked issue, merge danger, CI evidence, open findings, recommendation.
_Avoid_: "report" (that is Review's output)

**Finding**:
A review result with a severity — blocker, major, minor, nit. Blocker always stops a merge; the other three block only when enabled in config (on by default — any nit can become a major with one change).
_Avoid_: "issue" (that is a GitHub issue), "comment"
