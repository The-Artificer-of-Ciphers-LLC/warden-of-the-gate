# Output rules are written once, and each is checked or marked as judgment

- **Status:** Proposed (2026-11-28). Merging the PR that adds it is the owner's yes to the three proposals below.
- **Date:** 2026-11-28
- **Research:** [Frank Coyle, "Ontologies as Guardrails for AI"](../research/TALK-COYLE-ONTOLOGIES-AS-GUARDRAILS.md), with his World's Fair talk and essay
- **Builds on:** PRD §5 Triage and Review, PRD §11 (replay, dev and holdout), [ADR 0013](0013-code-lookup.md) (code lookup), [ADR 0018](0018-measured-not-estimated.md) (measured, not estimated), [ADR 0022](0022-new-model-starts-paused.md) (qualification)

## Context

The 2026-11-28 replay baseline did not qualify: 42% agreement on blocking findings and 44% on triage, against the 90% bar ([REPLAY-QUALIFICATION-2026-11-28](../research/REPLAY-QUALIFICATION-2026-11-28.md)). The owner's view is that prompting and guardrails, not the model, are the problem.

Coyle's argument is that the reliable part of an agent sits outside the model, as rules checked in code: "the model proposes, the constraint layer disposes, and nonsense never scores", every hand-off between steps is "a contract", and the rule is written once so "any engine can enforce it". He names fixing reliability with more natural-language instructions as an anti-pattern.

Warden already follows the outer shape: Ajv checks the reply's shape, then deterministic code rejects the whole result for semantic faults (a finding outside the PR, a verdict that contradicts its findings, duplicate ids, an incomplete triage outcome). Two things on `main` do not follow it.

**The rules exist in two copies that disagree.** The prompts state limits and rules in English, and the schemas and checks state them again in code:

| Rule | Prompt says | Code enforces |
|---|---|---|
| Triage summary length | 400 characters (`triage/slice.ts`) | 600 (`triage/schema.ts`) |
| Other triage text fields | 400 characters | 1,500 |
| Review rationale and correction | 600 characters each (`review/prompt.ts`) | 2,000 (`review/schema.ts`) |
| Findings per review | at most 5 | schema 50; poster shows 10 (`review/findings.ts`) |

Some of the tighter prompt numbers may be deliberate headroom, but nothing says which, and two copies drift.

**Triage is asked to judge what it cannot see.** The triage prompt's first rule picks `not-actionable` for an issue that is "a duplicate or already fixed or already implemented, ... answered by existing behaviour or docs, describes intended behaviour". The session gets only the issue and its comments (`tools: { allow: [] }`, no repository). PRD §5 Triage already says to investigate "against current code". The baseline's commonest triage miss was 8 issues labelled `not-actionable` or `needs-info` that the model called actionable. The prompt also offers a `citation` evidence item ("code you can cite") that a session with no code cannot produce honestly.

## Decision (proposed)

### 1. One rule table per model task

Every output rule the triage and review prompts state lives once, in a table in code next to the task's schema. Each entry holds:

- the rule's text as the prompt shows it;
- its hard limit, where it has one, which the JSON Schema is built from;
- a soft target, only where the model is meant to aim below the hard limit, so the difference is deliberate and visible;
- its check (a function over the parsed result that returns the reason it fails), or the word `judgment` when no deterministic check exists.

The prompt's rules section, the schema's limits and the post-schema checks are all generated from the table. The current disagreements above are resolved by choosing, per rule, a hard limit and an optional target; the prompt then states both or only the target, from the same entry.

### 2. Each rule is checked or marked as judgment, and a test holds that

- A test fails if the rendered prompt states a rule that does not come from the table, or if a table entry has neither a check nor the `judgment` mark. Whether a `judgment` rule could be checked is a reviewer's question, not a test's, so the test output lists every `judgment` entry for whoever reviews a change to the table.
- When a replay miss type has a deterministic form, the fix is a check in the table, not more prompt text. A change that is only prompt text is tuned on the dev subset and judged on the holdout, as PRD §11 already requires.
- First measurement: the replay report counts review findings whose line is not a line of that file's diff, separately from other false findings. Nothing is rejected for it yet, because PRD §5 Review lets a review assess affected surrounding behaviour. The owner decides on rejecting them once the counts exist.

### 3. Triage gets the repository it is asked to judge

- The triage session gets the same read-only repository snapshot at the base revision that the review session uses (`repoContext`: read and list tools only, no network, no writes), so the `not-actionable` rule can be applied to the code it names.
- A `citation` evidence item names a repository path. The check rejects the whole result if that path is not in the snapshot. When no snapshot is available, the prompt does not offer `citation`.
- Searching other issues for duplicates is not added. Intake already flags duplicate candidates and never decides them (PRD §5 Intake).

### How each is judged

By replay, as ADR 0018 and PRD §11 require: a full run before and after on the same cases, comparisons on the cases both configurations scored, and the dev and holdout split once it exists. A change that does not move the numbers is still kept if it removes a disagreement between two copies of a rule, because that is a defect path on its own.

### What this does not change

- No ontology language (RDF, OWL, SHACL) is added. JSON Schema and TypeScript checks already express allowed values, single-value and disjointness rules; a second rule language would be a second copy of every rule.
- Repair rounds stay as PR 174 built them: one round, for schema and parse failures only. A completeness or meaning failure is still rejected whole, because asking a model to add evidence until a rule passes invites made-up evidence.
- No model grades a gate. A public benchmark score still never qualifies a model (ADR 0022).
- Triage stays read-only and posts nothing in shadow.

## Consequences

- Prompt text and enforcement cannot disagree, and a reader can see in one place which rules are enforced and which rest on the model's judgment.
- Some current replies that pass today's looser schema may fail a tighter hard limit if one is chosen; the replay shows how many before it ships.
- Triage sessions take longer and use more tokens when they read code. That is measured per ADR 0018. The snapshot is the one the review already builds, so no new fetch path or credential is involved.
- Missed defects are not addressed by any of this. No check can catch a finding that was never made; the first lever there is the repository context pack, which the baseline did not use.

## Owner decision

Pending. Merging the PR is the owner's yes to proposals 1, 2 and 3 as written.

## Related

- PRD §5 Triage, §5 Review, §11
- ADR 0013 (code lookup), ADR 0018 (measured), ADR 0022 (qualification), ADR 0027 (replay cases are checked)
- [Maddalone note](../research/TALK-MADDALONE-SOFTWARE-FACTORIES.md): the owner's position that duplicated logic means duplicated defect paths
