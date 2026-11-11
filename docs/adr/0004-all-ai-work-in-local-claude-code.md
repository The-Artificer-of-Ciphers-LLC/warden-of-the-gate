# All AI work runs in the maintainer's own Claude Code; no API-key calls

- **Status:** Accepted
- **Date:** 2026-11-11
- **Decided by:** @trek-e

## Context

The first design ran Claude inside GitHub Actions on every event. The maintainer's constraint, in their words: "I want to run this inside Claude Code [...] I cannot afford API calls for open source maintenance."

## Decision

- No design element calls Claude with an API key. No workflow has a Claude step or an Anthropic secret.
- All AI work (triage, review, implement, rework, specialists, verifier, retro) runs in the maintainer's own Claude Code on the maintainer's machine: `/warden` when the maintainer sits down, or headless `claude -p` started by launchd with the maintainer's login.
- The runner refuses to start if `ANTHROPIC_API_KEY` is set, so a headless run can't fall back to an API key.
- GitHub Actions only does non-AI work: intake labels, claims, stale timers, nudges, ledger dates, metrics.
- Each batch handles items one at a time in fresh sessions, with an item cap and turn limits.

## Consequences

- AI runs happen only while the machine is on and signed in to Claude Code and `gh`. A launchd slot missed while it sleeps runs on wake; one missed while it's off is skipped.
- Throughput is bounded by the maintainer's session limits; batches leave room for the maintainer's own work.
- No AI runs the moment an item lands. Actions labels and queues it at once; triage and review happen in the next batch.
- Prompt injection from fork PRs now targets a session on the maintainer's machine, so headless sessions get a restricted tool list and read-only GitHub access, writes go through a plain script, and fork code is never run. Running batches under a separate macOS user is an open option.
- The existing local guards (merge authority, clean tree) now apply to every AI run.
