# All AI work runs locally on a local-first model pool, through open harnesses

- **Status:** Draft
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

The first design ran all AI work in one vendor's agent on the maintainer's machine, under the constraint "I cannot afford API calls for open source maintenance." The owner then directed an open-harness, local-first design (ratified 2026-11-15 as a POC): the constraint was never "no API key" literally — it is no *unbudgeted* per-token spend.

## Decision

- No design element makes an unbudgeted model call. MVP inference is local-only; a remote high-end tier is a later explicit per-task opt-in with budgets, never a silent fallback (ADR 0007).
- All AI work runs through open harnesses. The MVP first validates OpenCode on a maintainer-operated Mac using LM Studio or another explicitly configured local OpenAI-compatible inference service. Pi is a later adapter; Bionic is an optional interactive surface. No vendor-locked agent is a Warden platform.
- MVP AI runs are manually triggered, once-through scans, not recurring local polling. Event-driven GitHub webhooks follow MVP validation. Scheduled and real-time operation remain later configuration directions rather than MVP daemon requirements.
- GitHub Actions only does non-AI work: intake labels, claims, stale timers, nudges, ledger dates, metrics.
- Each batch handles items one at a time in fresh sessions, with an item cap and turn limits.

## Consequences

- AI runs happen only while the machine is on and a run is explicitly invoked in the MVP. Bookkeeping can queue work while it is off.
- Throughput is bounded by local compute (VRAM/context), not a vendor subscription; the runner preflights that a batch fits.
- Actions labels and queues new work using deterministic rules without waiting for local AI availability.
- Review uses prefetched inputs and restricted read-only tools. Any candidate-code execution requires an actual OS/container boundary without home credentials, unrelated files or unrestricted network; a worktree alone is not isolation. Never blindly execute an abandoned fork branch.
- The runner rejects any resolved non-local provider/model in MVP. Local unavailability preserves pending work and reports the failure rather than selecting a remote model.
- A lightweight Discord/credential helper may remain available without triggering AI scans. CI/approval updates can reevaluate already-reviewed gates without model inference.
