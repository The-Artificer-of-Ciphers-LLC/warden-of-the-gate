# Contributor-facing output is an AI-assisted review by the maintainer, not an anonymous bot

- **Status:** Accepted
- **Date:** 2026-11-11
- **Decided by:** @trek-e

## Context

Reviews, nudges and triage comments are drafted by Claude under rules the maintainer wrote. In the maintainer's words: "I am the logic behind it, not a bot."

## Decision

- Every review, nudge and triage comment opens with a line such as "AI-assisted review by @trek-e" and says plainly that Claude drafted it under the maintainer's rules and the maintainer is accountable for it.
- Nothing contributor-facing calls itself a bot.
- The header text is configuration (`voice`), so other maintainers sign with their own handle.
- Which account posts is still open (PRD, decision 4); the voice holds either way.

## Consequences

- Contributors know who stands behind each comment and which ones the maintainer typed personally.
- The maintainer is accountable for what is posted, which is why shadow mode comes before any live posting.
- Comments posted by the Actions bookkeeping need a token for the same account so nudges carry the same voice.
