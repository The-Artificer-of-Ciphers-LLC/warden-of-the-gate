# Phase 1: Core State & Safety Rails - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-10
**Phase:** 1-Core State & Safety Rails
**Areas discussed:** Buckets A–F, Label vocabulary, First-run backlog, App provisioning & setup

---

## Buckets A–F

| Question | Options | Selected |
|---|---|---|
| Bucket set | Lock as proposed / Lock but adjust / Different scheme | Lock as proposed |
| Exclusive? | Exclusive, fixed precedence (E>F>D>C>B>A) / Overlapping with flags | Exclusive, fixed precedence |
| Scope | PRs in A–F + separate issue section / One scheme for both | PRs in A–F + issue section |
| Data source | From GitHub history (whose-turn) / From Warden labels only | From GitHub history |
| D threshold | Past first nudge point / Within N days of a close | Past first nudge point |

**Owner's choice:** all recommended options.

---

## Label vocabulary

| Question | Options | Selected |
|---|---|---|
| Defaults | Familiar issue names + `pr:` for PRs / Everything `warden:`-prefixed | Familiar issue names + `pr:` |
| Existing labels | Adopt as-is / Adopt and normalise | Adopt as-is |
| Unknown state-like labels | Ignore / Map via config aliases | Map via config aliases |
| Alias swap | Read only, never rewrite / Normalise to canonical | Read only |

**Owner's choice:** the owner picked config aliases over the recommended "ignore". The follow-up made aliases read-only.

---

## First-run backlog

| Question | Options | Selected |
|---|---|---|
| First run | All at once, dry-run first / Gradual, N per run | All at once, dry-run first |
| Ledgers | Lazily on first real action / Eagerly on every item | Lazily |
| Initial PR state | Derived from history / Everything `pr:needs-review` | Derived from history |
| Initial issue state | Respect existing labels, else needs-triage / Everything needs-triage | Respect existing labels |

**Owner's choice:** all recommended options.

---

## App provisioning & setup

| Question | Options | Selected |
|---|---|---|
| App source | Own App via manifest flow / Own App by hand from docs / One shared App | Own App via manifest flow |
| Actions key | Setup writes environment secret / Maintainer adds by hand | Setup writes environment secret |
| Setup style | Plan, confirm, apply / Guided questions | Plan, confirm, apply |
| Conflicts | Report and block stale go-live / Report only | Report and block stale go-live |
| Ruleset | Yes, via maintainer's gh login / Print instructions only | Yes, via gh login |
| Workflows | Thin callers to reusable workflows / Full copies | Thin callers |

**Owner's choice:** all recommended options.

---

## Claude's Discretion

- Label colours and descriptions, the first-run throttle rate, launchd schedule defaults, refusal message text, the ledger field layout beyond STATE-02, and setup subcommand names.

## Deferred Ideas

None.
