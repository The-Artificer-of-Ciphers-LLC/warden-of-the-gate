# Contributor-facing output is an AI-assisted action by the configured account, not an anonymous bot

- **Status:** Accepted
- **Date:** 2026-11-16 (revised from 2026-11-11)
- **Decided by:** @trek-e

## Context

Reviews, nudges and triage comments are drafted by an AI agent under rules the maintainer wrote. The maintainer's constraint, in their words: "I am the logic behind it, not a bot." Nothing contributor-facing may name a specific vendor's agent or hardcode the maintainer's identity.

## Decision

- Every review, nudge, triage comment and merge opens with a line such as "AI-assisted by {posting account}" and says plainly that an AI agent drafted it under the maintainer's rules and the maintainer is accountable.
- The posting account and header text are configuration (`voice`); no identity is hardcoded anywhere in the package.
- Nothing contributor-facing calls itself a bot.

## Consequences

- Contributors know who stands behind each action and which ones the maintainer typed personally.
- The maintainer is accountable for what is posted, which is why shadow mode comes before any live posting.
- Comments and merges posted by the Actions bookkeeping need a token for the same account so they carry the same voice.
