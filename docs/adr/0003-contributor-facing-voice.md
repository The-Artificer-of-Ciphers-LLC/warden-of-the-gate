# Contributor-facing output is attributable to the configured GitHub App

- **Status:** Draft
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

Reviews, nudges and triage comments are drafted by an AI agent under rules the maintainer wrote. The maintainer's constraint, in their words: "I am the logic behind it, not a bot." Nothing contributor-facing may name a specific vendor's agent or hardcode the maintainer's identity.

## Decision

- Use the repository's configured GitHub App as the posting identity; do not hardcode a maintainer identity or model vendor in the package.
- Clearly attribute AI-assisted reviews/proposals and explain that they operate under maintainer rules. Distinguish deterministic housekeeping from text actually drafted by a model.
- Configure contributor-facing voice/header text without misrepresenting an automated action as a personal maintainer action. GitHub's own App/bot identity remains visible.

## Consequences

- Contributors know who stands behind each action and which ones the maintainer typed personally.
- The maintainer is accountable for what is posted, which is why shadow mode comes before any live posting.
- Local results and Actions housekeeping use the same validated serialized posting path and App identity; workers do not hold write credentials.
