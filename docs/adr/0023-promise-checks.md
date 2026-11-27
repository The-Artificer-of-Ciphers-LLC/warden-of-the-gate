# Promise checks: per-repository, base against candidate

- **Status:** Proposed (2026-11-26). The owner said yes to promise checks on 2026-11-26, ruled that they belong to whichever repository Warden is attached to, not to GSD Core, and ruled that a timed regression is noted rather than blocking, with intended and unintended cases told apart. The details below await owner review. Nothing here changes behavior until accepted.
- **Date:** 2026-11-26
- **Decided by:** @trek-e (adopt, per-repository); details pending
- **Research:** [McCarthy brownfield factories talk](../research/TALK-MCCARTHY-BROWNFIELD-FACTORIES.md), proposal 1

## Context

Justin McCarthy's talk names "promises" a codebase keeps beyond its features: cost, performance, security. Warden checks correctness closely (fail-before/pass-after in §5 Implement, older tests in ADR 0017, mutation on changed lines in ADR 0016). It has no check on the size, speed, resource use or cost of the code under review, so a change can pass every test and still make the package twice as large or a command twice as slow.

Each repository keeps different promises. A CLI cares about startup time, a library about package size and dependency count, a prompt-heavy project about the size of the prompts it ships. ADR 0005 already makes Warden configurable per repository, with operational settings in `.github/warden.yml`.

Owner, 2026-11-26, on whether to adopt this and which GSD Core promises to declare first: "Yes but this should. Be tied to gsd-core this should be something configured for whatever repo it’s attached too", read as: not tied to GSD Core, configured by each repository.

## Decision

- **Promises are repository configuration.** A repository declares promises in `.github/warden.yml` under `promises`. Warden ships no built-in promise list, no defaults and nothing specific to GSD Core or any other repository. With no promises declared, nothing runs and nothing is reported.
- **What a promise declares.** Each promise has a name, a trusted command that prints one number, a unit, a direction (`lower` or `higher` is better), a tolerance (absolute or percent) and a kind (`counted` or `timed`). Like the rest of `.github/warden.yml`, it is read from the trusted base revision only (§3), so a PR cannot loosen the promise it is judged by.
- **How it runs.** The trusted executor (§7) runs each promise command on the trusted base and on the candidate, in the same scan and the same isolated workspace. It records both numbers, the command and its output. A candidate outside the tolerance in the wrong direction is a regression.
- **Counted promises** (sizes, counts, token totals) are deterministic. A regression is a finding and blocks merge, under the 2026-11-24 ruling that a finding is a finding.
- **Timed promises** (speed, memory) are noisy, so one run decides nothing. Base and candidate are measured on the same host with warmup and repeated runs (at least 10, with outlier detection) and compared by median against the tolerance.
- **A timed regression is noted, not blocking** (owner, 2026-11-26). It is shown on the card with both medians and the tolerance. It is not a finding and does not block merge by itself.
- **Intended or unintended.** On a `fix` item (ADR 0024), a timed regression is marked *possibly intended*: a function that was not working can take longer once it works. Owner, 2026-11-26: "if we are fixing something the fix could take longer if the function wasn't working as an example of condition that would be intended vs inintended". On a `preserve` item it is marked *unintended*, because the change was meant to alter nothing. On a `change` item it is marked *possibly intended*, since new behavior can cost time.
- **All promises together.** A change whose purpose is one promise, such as "faster", may not regress another declared promise. The decision card shows every declared promise with base, candidate and tolerance, so a trade is visible.
- **Unsupported is never a pass.** A promise whose command fails, times out or cannot run on the platform is reported as `promise: unsupported` for that item, as ADR 0017 does for differential checks.
- **Over time.** Promise results are kept in the ledger and shown with the §11 scorecard (ADR 0018), so slow drift across many small changes is visible even when no single change breaks its tolerance.

Example, for illustration only; a repository writes its own:

```yaml
promises:
  - name: package-size
    kind: counted
    command: "npm pack --dry-run --json | jq '.[0].size'"
    unit: bytes
    direction: lower
    tolerance: { percent: 2 }
  - name: cli-startup
    kind: timed
    command: "node bin/cli.js --version"
    unit: ms
    direction: lower
    tolerance: { percent: 10 }
```

## Consequences

- A maintainer who declares nothing sees no change.
- Each declared promise adds two executor runs per scanned item, or about twenty for a timed promise. The run budget in `.github/warden.yml` covers them.
- Promise commands are trusted code from the base revision; their output is evidence, not model judgment. No model decides whether a promise held.
- Changing a promise or its tolerance is a change to `.github/warden.yml`, which gets full review and a maintainer decision (§3).
- New backlog work after W-37 (differential checks), sharing its executor.

## Questions for the owner

1. Is `.github/warden.yml` the right home, or should promises sit in `.github/ORDERS.yaml` with other gates?
2. ~~Does a timed regression block like a finding, or go to a maintainer decision?~~ Decided 2026-11-26: noted on the card, not blocking, marked intended or unintended.
3. A fix can also legitimately grow a counted promise (for example, package size when missing code is added). Should a counted regression on a `fix` or `change` item still block, or be noted like a timed one?
4. Should `warden setup` offer to suggest starter promises for a repository, for the maintainer to accept or drop, or should it leave promises entirely to the maintainer?

## Related

- [ADR 0005](0005-releasable-and-configurable-per-repo.md): per-repository configuration
- [ADR 0010](0010-yaml-business-rules.md): one canonical home per setting
- [ADR 0016](0016-verification-loop-and-test-quality-evidence.md): test-quality evidence
- [ADR 0017](0017-preexisting-tests-and-differential-checks.md): the same base-against-candidate executor and the `unsupported` rule
- [ADR 0018](0018-measured-not-estimated.md): the scorecard and repeated measurement
- [ADR 0024](0024-behavior-effect-at-triage.md): the `preserve`, `change` and `fix` facet used to mark a regression intended or unintended
