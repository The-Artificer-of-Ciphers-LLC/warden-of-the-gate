# Review attention classes: the maintainer chooses which code they keep reading

- **Status:** Accepted as amended by the owner decision below (2026-11-28).
- **Date:** 2026-11-26
- **Decided by:** @trek-e, 2026-11-28
- **Research:** [Pi creators live stream](../research/TALK-PI-CREATORS-LIVE.md), mapping rows 7-9 and 22-24

## Context

Warden's merge gates decide whether a change may merge. They do not decide whether the maintainer still understands the code after a year of factory merges. Code review has always done that second job: in Microsoft's study, all interviewees but one gave knowledge transfer as a reason for review, and understanding was their main challenge in it (Bacchelli and Bird, ICSE 2013). Open PR #47 (ADR 0015) moves the maintainer from reading diffs to reading contracts and boundary designs, and names the cost: "review was also how people learned the codebase". It leaves the fix for later.

Mario Zechner described how Pi handles this [19:43-20:58]. He reads the fixes the triage bot produces and still knows the codebase after twelve months of agent fixes. He reads the whole diff for subsystems he calls "super super important" (tools, the agent loop, core primitives), skims where he knows what the fix should look like, and does not read non-critical code such as the HTML export. This is one maintainer's practice, not a measured result, but it matches the study's point that understanding is an outcome of reading, and it is cheap to offer.

This is not the same as ADR 0015's boundary classes. A boundary class is about risk to others (interfaces, schemas, security) and floors at a design decision. An attention class is about what the maintainer wants to keep knowing, and is the maintainer's own choice.

## Decision

- **Attention classes are path sets in `.github/ORDERS.yaml`.** Each has one mode:
  - `read-before`: a PR touching these paths floors at a maintainer decision; the card inlines the full diff of those paths, not a link. Use for code the maintainer wants to see before it lands.
  - `read-after`: no change to merge eligibility. After merge, the change is listed in a periodic digest: what changed in these paths, the diff, and the linked issue. Use for code the maintainer wants to keep knowing without blocking the factory.
  - `evidence-only`: the card links the diff and shows evidence only. This is today's default for non-boundary work.
- **Defaults.** No paths are in `read-before` or `read-after` until the maintainer names them. Warden does not guess which code is core.
- **The digest is a report, not a task.** It is built from ledger records of merged PRs, needs no model, and goes through the same channel as other reports, with the GitHub-native fallback (PRD §8). Unread digests change nothing: they never pause work, and silence is never approval or disapproval.
- **Boundary classes win.** A path in both a boundary class and an attention class gets the boundary handling; `evidence-only` never weakens a boundary floor or any other merge gate.

## Consequences

- The maintainer can keep reading the core without reading everything, and the factory keeps auto-merging there under `read-after`.
- `read-before` raises the maintainer-decision rate for those paths, visible in the PRD §11 measure.
- Adds one report (the digest) and one config section. No model work, no authority change.
- Not measured: whether digests are read, or whether reading them preserves understanding. Retro can count digests opened only if the channel reports opens.

## Owner decision (2026-11-28)

- Adopted, with all three modes. The owner: "only from trusted sources, contributor pre from forks or non-trusted sources, no." The lighter modes (`read-after` and `evidence-only` in place of full review) apply only to PRs from trusted sources. A contributor PR from a fork or another untrusted source always gets full review, whatever attention class its paths have.
- The digest goes out weekly, with the Retro run ("Yes, open the PR" to the proposal). Basis: Phabricator's post-publish audit is nonblocking, and its guide gives reviewing a set of changes "at the end of the week" as its example ([Phabricator Audit](https://secure.phabricator.com/book/phabricator/article/audit/)); GitHub CODEOWNERS is the established path-based review before merge ([GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)).

The questions this ADR asked were: adopt attention classes; which modes to offer; digest cadence.

## Related

- ADR 0015: boundary classes and the deferred understanding cost
- [ADR 0010](0010-yaml-business-rules.md): standing orders hold the path sets
- [ADR 0008](0008-tiered-autonomy-and-merge-gates.md): merge gates, unchanged
