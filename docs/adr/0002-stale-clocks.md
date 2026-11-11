# Stale clocks for PRs and issues

- **Status:** Accepted (activity definition and exemptions proposed, not yet confirmed)
- **Date:** 2026-11-11
- **Decided by:** @trek-e

## Context

The command in use today closes stale PRs after 5 days while the repo's `stale.yml` uses 28 + 14 days, so contributors get mixed signals. PRs nobody on the maintainer's side has answered should never be closed for staleness.

## Decision

**PRs**

- Nudge at 48 and 72 hours of author silence; close at 5 days.
- Only where the maintainer has responded or a review (the maintainer's or the plugin's) has been posted and the author has gone quiet since.
- A PR nobody has answered or reviewed is never closed; it goes to the review queue.
- Reviewed defect PRs: once review changes are requested, the author has 5 days. If unaddressed, the PR is closed, the linked issue returns to `ready-for-agent`, and whoever picks it up (a person or the plugin) continues from the author's branch and credits them with a `Co-authored-by` line.

**Issues waiting on the reporter**

- `needs-reproduction`: close after 14 days.
- Any other waiting-on-reporter issue: close after 28 days.
- Confirmed or approved issues never close for staleness.

Why these numbers: VS Code closes needs-more-info issues after 7 days, so 14 is the kinder end for reproduction asks; actions/stale defaults to 60 + 7, and GSD Core already used 28, which stays for the rest.

**Proposed, to confirm:** activity means a push, comment or review reply from the author and resets the clock; bot comments and CI runs don't count. Exempt maintainer-marked drafts, PRs labelled `keep-open`, and PRs waiting on the maintainer.

## Consequences

- One clock replaces the conflicting ones; `stale.yml` and the plugin read the same config (`stale.*`).
- The sweep runs in Actions with no AI, so stale handling continues even when the maintainer's machine is off.
- All values are configuration, so other repos can choose their own.
