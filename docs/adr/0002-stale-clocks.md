# Stale clocks for PRs and issues

- **Status:** Draft
- **Date:** 2026-11-11
- **Decided by:** @trek-e

## Context

Today's tooling on the pilot repo closes stale PRs after 5 days while the repo's `stale.yml` uses 28 + 14 days, so contributors get mixed signals. PRs nobody on the maintainer's side has answered should never be closed for staleness.

## Decision

**PRs**

- Nudge at 48 and 72 hours of author silence; close at 5 days.
- Only where the maintainer has responded or a review (the maintainer's or the factory's) has been posted and the author has gone quiet since.
- A PR nobody has answered or reviewed is never closed; it goes to the review queue.
- Reviewed PRs: when an explicit response or requested change is owed by the author, the five-day clock applies. If it expires, the PR is closed and the linked issue remains open for takeover. Contributor delivery commitments have their own deadline; neither maintainer review delays nor delayed CI alone count as missed delivery.
- On takeover, Warden starts from trusted base on a factory-owned branch, evaluates the prior approach, ports sound contributions with appropriate attribution, and completes the agreed solution. It does not blindly execute the abandoned contributor branch or its hooks.

**Issues waiting on the reporter**

- `needs-reproduction`: close after 14 days.
- Any other waiting-on-reporter issue: close after 28 days.
- Confirmed or approved issues never close for staleness.

These are published owner-selected repository defaults, not universal agent-development SLAs. Response silence, requested reporter information, and the shorter 48-hour delivery commitments serve different purposes; measure their effects separately during the pilot.

Activity means a push, comment or review reply from the author and resets the response clock; factory messages and CI runs don't count. Exempt maintainer-marked drafts, PRs labelled `keep-open`, and PRs waiting on the maintainer. A response-clock reset does not itself extend a committed delivery deadline.

Contributor assignment is immediate on volunteering. The default initial submission deadline is 48 hours from assignment; confirmation is not permission to start another 48-hour window. The contributor or an authorized agent confirms work and supplies an explicit delivery commitment within that window. An earlier commitment remains binding. Delivery means a complete, ready-for-review PR implementing the agreed scope with verification evidence, not merely a placeholder or draft, and not necessarily a merged PR. A maintainer must approve longer commitments and extensions before expiry. Missed commitments release the assignment and close unfinished PRs while keeping the underlying issue open.

An on-time, genuinely complete submission satisfies the initial delivery obligation even if normal review finds defects. A published blocking review starts a new 48-elapsed-hour review-fix window by default, configurable per repository; a subsequent substantive review round starts the next window. Waiting for the reviewer or delayed CI alone is not missed delivery. Author acknowledgements, unrelated comments, and placeholder pushes do not extend delivery deadlines. The shorter delivery obligation is separate from the five-day silence clock, which cannot override an earlier delivery deadline. Maintainers may approve extensions.

An explicit maintainer hold freezes unexpired remaining delivery time; release publishes the revised deadline. A material scope change needs a fresh approved commitment. Stopping Warden alone does not freeze these obligations. Backlog adoption preserves ownership and valid commitments; a newly introduced deadline starts from the published adoption notice, never a backdated assignment.

After three substantive contributor fix rounds with remaining blocking findings, escalate to the maintainer to permit further rounds or arrange takeover. Timely work is not automatically closed solely for reaching the limit. Persist the count across scans/replacement PRs; waiting for the maintainer is not author inactivity.

Deadlines make an action eligible; enforcement occurs on the next successful sweep, not necessarily at the exact wall-clock instant.

## Consequences

- Published operational defaults replace conflicting stale policies. Response silence and delivery commitments remain distinct obligations; five-day silence cannot override an earlier delivery deadline.
- The sweep runs in Actions with no AI, so stale handling continues even when the maintainer's machine is off.
- All values are configuration, so other repos can choose their own.
