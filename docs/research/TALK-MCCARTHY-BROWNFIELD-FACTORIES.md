# Talk research: "Stop Building Software Factories" (Brownfield Factories), Justin McCarthy, Diffusion

**Source:** AI Engineer CODE Summit 2026, main-stage keynote, 2026-11-12, about 18 minutes.
- Video: https://www.youtube.com/watch?v=1S4hx3wgvBE (AI Engineer channel)
- Event page with a timestamped transcript and summary: https://ai.engineer/code/2026/talks/justin-mccarthy (the talk runs 6:34:30 to 6:52:04 of the Day 2 livestream; timestamps below use that clock)
- The talk's technical companion, which McCarthy calls the "agent channel": "AI Coding Agents Need to Keep Their Promises", DEV Community, 2026-11-12, https://dev.to/jmccarthy/ai-coding-agents-need-to-keep-their-promises-2nhh
- Full machine-generated transcript: [sources/mccarthy-brownfield-factories-transcript.md](sources/mccarthy-brownfield-factories-transcript.md)

**Speaker:** Justin McCarthy, founder and CEO of Diffusion, formerly co-founder and CTO of StrongDM, where he built the StrongDM Software Factory (held-out scenarios, a "Digital Twin Universe" of service replicas, model-scored "scenario satisfaction") and published the Attractor specs. Checked on his speaker page (https://diffusion.io/speaking) and the AI Engineer speaker bio (https://ai.engineer/speakers/justin-mccarthy). Warden already cites his StrongDM work once: ADR 0016 notes that StrongDM's holdout scenarios are scored by a model, which Warden does not allow to decide a gate.

**Interest to declare:** Diffusion sells software-factory work, and the talk says so twice ("we're standing by to help"). McCarthy calls the talk "intentionally a motivational speech without much technical detail"; the essay carries the technique.

**Researched:** 2026-11-27. **Confidence:** HIGH for what was said (full transcript read, cross-checked against the event page's timestamped transcript). MEDIUM for the claims themselves: nearly all are the speaker's own practice, with no numbers. Outside sources are listed in the verification table.

---

## Verdict

Mostly confirmation, with one real gap. Warden already separates the two modes McCarthy argues for: behavior-preserving work (bugs, dependency updates, refactors) can auto-merge under standing authority, and anything that changes what the product does (features, enhancements) needs approved scope first. What Warden lacks is his "promises" beyond correctness. Its gates check that tests still pass and still catch bugs; nothing checks that a change kept the project's other commitments, such as size, speed or cost, so a factory change could quietly buy one with another.

## What the talk claims

1. **Pick the mode before you industrialize** [6:36:53-6:37:48]. Greenfield work (you do not yet know what you want) should not go through a factory. Brownfield work (an existing product people use and pay for) should, because its runtime already tells you what "working" means.
2. **Name your promises** [6:39:26-6:39:53]. A promise is "some guarantee, some aspect, some priority, and some dimension within the product that we value": features, cost, price, security. "It's rare that you want to revert and regress on your promises."
3. **A loop without its feedback leg amplifies noise** [6:40:05-6:40:51]. Production behavior, usage and support tickets are the feedback.
4. **Brownfield loops should run continuously, in the background** [6:40:58-6:42:15].
5. **Factories simplify as models improve**: skills get shorter, harnesses more general [talk, after 6:42:15].
6. **"The same but faster"** [6:45:02-6:45:48]. Faster, cheaper and safer are objectively good as long as no one is traded for another (a Pareto equilibrium). "Better" needs human intent, judgment and taste, so it belongs in discovery.
7. **Rate-match the factory to demand** [late in the talk]. Customers want outcomes, not more software; a factory that outruns demand spills "software all over the floor".
8. **"This takes like a week."** Stated, not supported.

The essay adds the techniques: treat telemetry and error logs as essential feedback and copy them somewhere agents can read; use code-coverage traces as a cheap "bounding box" of real behavior; and keep promises with differential random testing, coverage-guided fuzzing, shadow execution on real traffic (writes isolated) and mutation testing. It names the tensions "Promise Loops": a loop that hill-climbs on cost can silently pay with performance unless another loop holds performance.

## How each claim maps to Warden

Sources checked: `main` at `0ea9fa2` (PRD, ADRs 0001-0013 and 0019), open PRs #47 (ADRs 0014-0016), #48 (ADRs 0017-0018) and #55 (ADRs 0020-0022), and the draft build backlog (W-1 to W-58) in the software-factory channel.

| # | Claim | Warden today | Effect |
|---|---|---|---|
| 1 | Separate discovery from preservation | PRD §3 and §5 Triage: features and enhancements need approved scope and acceptance criteria before Implement; confirmed bugs and verified dependency/CVE fixes may proceed under standing authority. ADR 0017 (PR #48) runs differential checks only for scope that "should not change behavior". | **Confirms.** One gap: whether an item is meant to preserve behavior is inferred from its label (ADR 0017 itself notes a mislabelled item skips the gate). See proposal 2. |
| 2 | Name promises beyond features | Correctness is well covered: fail-before/pass-after (§5 Implement), older tests (ADR 0017), mutation on changed lines (ADR 0016), weakening detection (§7). Security is partly covered (§3 Actions hardening, dependency/CVE handling). No check for size, speed, resource use or cost of the code under review. | **New.** See proposal 1. |
| 3 | Feedback leg | Retro (§5) reads maintainer decisions, overrides, reverts and escaped defects, tagged by origin, and proposes rules. ADR 0018 (PR #48) adds control limits and a per-model pause. | **Confirms.** Warden's feedback is issues, reverts and maintainer decisions, not product telemetry. See "Not adopted". |
| 4 | Continuous, 24/7 | MVP is manually started, bounded scans; scheduled AI is deferred until after the pilot (§2, ADR 0004). Deterministic Sweep runs on a schedule. | **No change.** The talk gives no evidence that continuous AI beats bounded scans; Warden's choice rests on control and the pilot gate. It is the direction for the deferred "scheduled AI operation" item, not an MVP change. |
| 5 | Factories simplify with better models | ADR 0022 (PR #55): a new model starts with auto-merge paused until replay passes. ADR 0006 keeps the harness replaceable. | **Small addition, later.** When a new model is replayed, Retro may also try the same replay with prompt or skill text trimmed and propose removing text that no longer changes outcomes. Deterministic gates are never removed on this basis: they guard against model error, which a better model reduces but does not end. |
| 6 | "Same but faster"; "better" needs judgment | Matches §3: auto-merge for bounded, authorized, verified work; maintainer decisions for scope, design and boundary classes (ADR 0015). ADR 0017 differential checks, ADR 0016 mutation testing and the "checks must prove they can fail" rule already cover two of his four techniques. | **Confirms**, and adds proposal 3 (coverage-guided inputs) from the essay. |
| 7 | Rate-match to demand | §2 caps open factory implementation PRs at one (configurable). Implement only takes confirmed bugs or approved features; Triage proposes features only from submitted requests. ADR 0020 (PR #55) treats maintainer attention as the limit. | **Confirms.** Warden never invents work no one asked for. Nothing to add. |
| 8 | "Takes like a week" | Not applicable. | Not a claim Warden can use. |

## Proposed changes

### 1. Promise checks: declared, deterministic, base against candidate (new ADR candidate, 0023)

- **What.** A repository may declare named promises in `.github/warden.yml`, each with a trusted command that prints one number, a unit, a direction (lower or higher is better) and a tolerance. Examples a maintainer might choose: package size, the number of runtime dependencies, the startup time of a CLI command, or the size of a prompt the project ships. Warden never guesses promises; none exist until the maintainer names them.
- **How it runs.** The trusted executor (§7) runs each promise command on the trusted base and on the candidate, in the same scan and the same isolated workspace, and records both numbers with the command and its output. A candidate outside the tolerance in the wrong direction is a regression.
- **Two kinds, handled differently, because the evidence differs.**
  - *Counted promises* (sizes, counts, token totals) are deterministic. A regression is a finding like any other and blocks merge under the 2026-11-24 ruling that a finding is a finding.
  - *Timed promises* (speed, memory) are noisy. MongoDB's published experience is that single runs mislead: its change-point system needed several results to see a change, and its first version had a 40 to 80% false-positive rate (Daly et al., ICPE 2020). So a timed promise runs repeated, warmed-up measurements of base and candidate on the same host (as hyperfine does: at least 10 runs, warmup, outlier detection, median), and compares medians against the tolerance. Whether a timed regression blocks like a finding or goes to a maintainer decision is open question 3.
- **Pareto rule.** A change whose purpose is one promise (for example "faster") may not regress another declared promise. It is the same check; the card just shows all declared promises together so a trade is visible.
- **Unsupported is never a pass.** A promise whose command fails or cannot run on the platform is reported as `promise: unsupported` for that item, the same treatment as ADR 0017's differential checks.
- **Where it fits.** PRD §7 (static-first verification and the trusted executor), §11 (track promise results over time alongside the scorecard in ADR 0018), and a new backlog item after W-37 (differential checks), sharing its executor work.

### 2. Record intended behavior effect at Triage (amends ADR 0017)

- Triage records one more facet on every item it confirms: `preserve` (the change should not alter observable behavior: refactor, performance, dependency update, port) or `change` (new or altered behavior). Feature and enhancement approvals record it as part of the approved scope.
- ADR 0017's older-test gate and opt-in differential checks key off this facet instead of the PR's refactor or bug-fix label. That closes the gap ADR 0017 names in its own consequences.
- A `preserve` item that the differential check shows changing behavior is a finding. A `change` item that turns out to change nothing is reported but does not block.
- A bug fix is `change` for the behavior it fixes and `preserve` for everything else, so the differential check, where enabled, compares everything except the inputs the frozen reproducer covers (ADR 0014).

### 3. Coverage-guided inputs for differential checks (small amendment to ADR 0017)

- The essay pairs differential testing with coverage-guided fuzzing, which uses coverage feedback to find inputs that reach more of the code. ADR 0017 already allows "generators when enabled" and requires them to catch a planted defect before they count.
- Proposed: when the repository's language has a supported coverage-guided fuzzer or property-based tool, the differential check may use it to grow inputs toward the changed lines, under the same planted-defect rule and the same run budget. Which tool per language is build planning; none is assumed.

## Not adopted

- **Ingesting product telemetry and logs.** The essay says "there's no excuse for withholding high-resolution facts from your agents" and suggests copying logs into stores agents can read. Warden governs a repository, its sessions treat issue and comment text as untrusted (§3), and the owner's privacy-first direction rules out collecting user telemetry to feed it. Warden's runtime signal stays what the PRD already lists: reverts, escaped defects, maintainer overrides and new issues.
- **Shadow execution on real traffic.** It needs live traffic, which a library or CLI repository does not have. Warden's own "shadow mode" is a different thing (Warden's effects held local, §11) and is unchanged.
- **Continuous background AI in the MVP.** See row 4.
- **The "demand factory".** Product strategy, outside Warden's job.
- **Model-scored "satisfaction" as a gate.** McCarthy's StrongDM factory scores scenarios with a model. PRD §11 already says a model grading a model never decides a gate; this talk gives no reason to change that.

## Verification

| Claim or source | Checked against | Result |
|---|---|---|
| Speaker identity and StrongDM history | https://diffusion.io/speaking; https://ai.engineer/speakers/justin-mccarthy | Confirmed: founder and CEO of Diffusion; co-founder and former CTO of StrongDM; built its Software Factory |
| Talk date, length and timestamps | https://ai.engineer/code/2026/talks/justin-mccarthy | Confirmed: 2026-11-12, livestream 6:34:30-6:52:04 |
| Techniques (differential, fuzzing, shadow, mutation, coverage traces) | The companion essay, read in full | Confirmed as his recommendations; no measurements given |
| Differential testing is established practice | McKeeman, "Differential Testing for Software", Digital Technical Journal 10(1), 1998, pp. 100-107 (https://www.cs.tufts.edu/comp/150FP/archive/bill-mckeeman/DifferentailTesting.pdf) | Supports it, with two cautions that match ADR 0017: false positives where both outputs are allowed, and the need to compare old and new when retiring software |
| Performance regressions need statistics, not single runs | Daly, Brown, Ingo, O'Leary, Bradford, "The Use of Change Point Detection to Identify Software Performance Regressions in a Continuous Integration System", ICPE 2020 (https://research.spec.org/icpe_proceedings/2020/proceedings/p67.pdf) | Supports the counted/timed split in proposal 1: noise from platform, software and workload; 40 to 80% false positives in the first version |
| Repeated CLI timing with warmup, medians and outlier detection | hyperfine README (https://github.com/sharkdp/hyperfine) | Confirmed features: at least 10 runs by default, warmup, outlier detection, median in exports. Named as an example of the method, not as a chosen dependency |
| "Takes like a week"; "factories simplify over time" | Nothing beyond the talk | Speaker only |

## Open questions for the owner

1. **Promise checks:** answered 2026-11-26. The owner said yes, and that promises are configured by whichever repository Warden is attached to, not tied to GSD Core. Written up as proposed [ADR 0023](../adr/0023-promise-checks.md).
2. **Behavior effect at Triage:** answered 2026-11-26. The owner said yes, and that when the change fixes broken behavior, that broken behavior must not be what the fix is tested against. Written up as proposed [ADR 0024](../adr/0024-behavior-effect-at-triage.md), which adds a `fix` value next to `preserve` and `change`.
3. **Timed promises:** should a speed or memory regression beyond tolerance block merge like a finding, or go to you as a decision, given how noisy timing is on one machine?
