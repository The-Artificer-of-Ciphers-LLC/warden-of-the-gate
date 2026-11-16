# All AI work runs locally on a local-first model pool, through open harnesses

- **Status:** Accepted
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

The first design ran all AI work in one vendor's agent on the maintainer's machine, under the constraint "I cannot afford API calls for open source maintenance." The owner then directed an open-harness, local-first design (ratified 2026-11-15 as a POC): the constraint was never "no API key" literally — it is no *unbudgeted* per-token spend.

## Decision

- No design element makes an unbudgeted model call. Local models are the default floor; a remote high-end tier is opt-in config for heavy tasks and never a silent fallback (ADR 0007).
- All AI work runs on the maintainer's machine, container or pod through open harnesses: opencode and pi for unattended batch (ADR 0006), Bionic as the interactive surface. No vendor-locked agent is a Warden platform.
- One runner process, two trigger modes: calendar-scheduled batches and event-triggered real-time pickup; execution mode is per-repo config. Kept alive by launchd locally, or run as a container/pod daemon.
- GitHub Actions only does non-AI work: intake labels, claims, stale timers, nudges, ledger dates, metrics.
- Each batch handles items one at a time in fresh sessions, with an item cap and turn limits.

## Consequences

- AI runs happen only while the machine or container is on; a missed slot runs on wake or next pickup.
- Throughput is bounded by local compute (VRAM/context), not a vendor subscription; the runner preflights that a batch fits.
- No AI runs the moment an item lands unless real-time mode is configured; Actions labels and queues it at once, and the runner picks it up on its next trigger.
- Prompt injection from fork PRs targets sessions on the maintainer's machine, so sessions get a restricted tool surface and read-only GitHub access; writes go through a plain script; fork code is never run.
- The runner refuses to start if the active model tier would spend unbudgeted tokens (preflight: default tier is local; remote requires explicit config).
