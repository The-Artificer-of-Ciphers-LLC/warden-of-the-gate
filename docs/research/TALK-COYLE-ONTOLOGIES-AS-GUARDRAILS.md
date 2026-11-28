# Talk Research: "Ontologies as Guardrails for AI" — Frank Coyle, UC Berkeley

**Source:** Frank Coyle's own YouTube channel ("Dr. C"), the third video of his series on getting set for agentic AI.
- Video: https://www.youtube.com/watch?v=4Z4ie_MQOTw
- Transcript: [sources/coyle-ontologies-as-guardrails-transcript.md](sources/coyle-ontologies-as-guardrails-transcript.md). No caption times could be read, so this note cites its segment labels **[S1]** to **[S8]**.
- Companion talk, the longer version he refers to in [S1]: "Why Agentic Systems Need Ontologies", AI Engineer World's Fair 2026, 2 July 2026, 21:18, https://www.youtube.com/watch?v=Sir59K8ZDPU. Transcript: [sources/coyle-why-agentic-systems-need-ontologies-transcript.md](sources/coyle-why-agentic-systems-need-ontologies-transcript.md). Cited as **[AIEWF mm:ss]**, approximate section starts.
- Companion essay: Frank Coyle, "Why Agentic Systems Need Ontologies", Medium, 4 August 2026, https://medium.com/@coyle_41098/why-agentic-systems-need-ontologies-6361b54958e1. Cited as **[Essay]**.

**Speaker:** Frank Coyle, Lecturer, University of California Berkeley (World's Fair speaker page, https://aie-wf.sentry.dev/talks/aiewf-425-why-agentic-systems-need-ontologies). He says he has worked in computer science for 30 to 35 years and on expert systems in the 1980s [AIEWF 00:00, 06:13]. The World's Fair slot was a sponsor session in the Graphs track.
**Researched:** 2026-11-28.
**Confidence:** HIGH for what the talks claim (both transcripts read in full). MEDIUM for how far the lessons carry to Warden: the talks argue a design pattern with business examples (refunds, orders), and give no measurements of their own.

> **Status: PROPOSED.** Nothing here changes code. The proposals are in [ADR 0028](../adr/0028-output-rules-written-once-and-checked.md) and in the **[O]** passages of the PRD, for the owner to accept by merging or to change.

---

## Why this talk matters to Warden now

The owner's framing for this research, after the 2026-11-28 replay baseline did not qualify: "Pretty sure model isn't the problem here. Prompting and guardrails is. These models we are using come highly scored."

Coyle's whole argument is about the second half of that sentence. His thesis: a language model is probabilistic, so the reliable part of an agent has to sit outside it, as rules checked in code, and "the model proposes, the constraint layer disposes, and nonsense never scores" [S4]. His World's Fair abstract names "the ever-present temptation to fix reliability problems with more natural-language instructions" as an anti-pattern, and says "no amount of prompt engineering fully closes that gap" (event page). So the talk supports moving work from prompt text into checks. It is also clear about what checks can do: they catch outputs that break a stated rule, such as a made-up status or a second refund [AIEWF 18:59]. They do not make a model find something it missed.

Held against Warden's code on `main`, two gaps stand out, and both are prompt-and-guardrail problems rather than model problems:

1. **The rules are written twice, and the two copies already disagree.** The triage prompt tells the model the summary is at most 400 characters and every other text field at most 400 (`triage/slice.ts` `buildTriagePrompt`), while the schema it is checked against allows 600 and 1,500 (`triage/schema.ts`). The review prompt says "at most 5 findings" and rationale and correction "at most 600 characters each" (`review/prompt.ts`), while the schema allows 50 findings and 2,000 characters (`review/schema.ts`) and the poster caps at 10 (`review/findings.ts` `DEFAULT_MAX_POSTED_FINDINGS`). The tighter prompt numbers may be deliberate headroom ("a short complete object beats a long one that gets cut off"), but nothing records that, and nothing stops them drifting further. Coyle's rule is "write the rule once ... then any engine can enforce it" [S7]. The owner made the same point about code in general: "8 different ways of doing something meant eight different defect paths" ([Maddalone note](TALK-MADDALONE-SOFTWARE-FACTORIES.md)).
2. **Triage is asked to judge facts it is never given.** The triage prompt's first rule asks the model to choose `not-actionable` when an issue is "a duplicate or already fixed or already implemented, is a usage question answered by existing behaviour or docs, describes intended behaviour" (`triage/slice.ts`). The triage session gets the issue text and its comments only: `tools: { allow: [] }`, no repository, no docs. PRD §5 Triage says to "Investigate the report against current code, approved rules and relevant prior decisions." The commonest triage miss in the baseline was exactly here: 8 issues the maintainer labelled `not-actionable` or `needs-info` were called actionable ([REPLAY-QUALIFICATION-2026-11-28.md](REPLAY-QUALIFICATION-2026-11-28.md), section 2). Coyle's point that the agent needs "our conceptualization of ... our domains" [AIEWF 03:14] is the same: a check or a judgment can only be as good as the domain facts it can see. Whether those 8 issues were in fact duplicates, already fixed or answered by docs was not checked here (the cases live in the maintainer's replay set, not in this repository).

The prompt also invites a `citation` evidence item ("code you can cite"), which a session with no code cannot honestly produce. That is a prompt rule contradicting the harness.

---

## What the speaker claimed

### The short video (4Z4ie_MQOTw)
1. RAG tends to miss key details; graph RAG captures more of a domain's meaning (recap of his part 2) [S1].
2. LLMs are probabilistic by nature; neuro-symbolic AI combines them with symbolic rules "that will give us correct answers" [S2].
3. An ontology is a shared, formal representation of a domain: categories of things, instances, and relationships [S3]. It can be built top-down by experts or bottom-up from what customers ask [S3].
4. His "pick and roll": first pick existing vocabularies (schema.org, FOAF), then roll your constraints in that same vocabulary with SHACL or OWL; iterate when a constraint needs a term the vocabulary lacks [S4].
5. "The model proposes, the constraint layer disposes, and nonsense never scores" [S4].
6. Loops are the new paradigm; sequence, conditionals and loops make a language Turing complete (Böhm and Jacopini) [S5]. Quotes attributed to Boris Cherny ("My job is to write loops") and Peter Steinberger ("Design loops that prompt your agents") [S5]. **Quotes not traced to a primary source.**
7. Turn the agent loop on its side into a data flow; data flow diagrams have been around "since the early '50s" [S6]. **Inaccurate: data-flow diagrams came from structured analysis in the mid-1970s, first proposed by Larry Constantine and popularised by Yourdon, DeMarco, and Gane and Sarson** (https://en.wikipedia.org/wiki/Data-flow_diagram). The design point does not depend on the date.
8. Each edge in that flow is a place for its own guardrail; "don't think of a guardrail as a giant rail that encompasses the whole LLM"; check the JSON passed between steps; "every edge is a contract" [S7].
9. "Write the rule once in the ontology's vocabulary, then any engine can enforce it"; rules are written to the vocabulary, not to one engine, and change when the vocabulary changes [S7].
10. Example rule: every refund action must carry a manager's approval. Tools: SHACL for types, SPARQL and Cypher for queries, RDFS domain and range for inference, OWL transitive and functional properties [S8].

### The World's Fair talk (Sir59K8ZDPU) and essay
11. Ontology as "a formal specification of a shared conceptualization", attributed to Gruber 1993 [AIEWF 03:14]. **Wording slightly off:** Gruber (1993) wrote "an explicit specification of a conceptualization"; the "formal ... shared" version is Studer, Benjamins and Fensel (1998), who combined Gruber's and Borst's definitions. Not material to Warden.
12. Hallucination is a property of the model, not a defect to be removed [AIEWF 04:44; Essay].
13. Reuse existing vocabularies (schema.org, FOAF, Dublin Core, DBpedia) [AIEWF 08:20].
14. Loops have three risks: they can run forever, drift as agents talk to each other, and cost tokens [AIEWF 11:53].
15. The model only proposes a tool call; application code executes it [AIEWF 13:13, 14:39].
16. After the tool runs, put its result in a form a validator can check; if reasonable, continue; if not, "go back to the LLM" or "get a human in the loop" [AIEWF 16:15].
17. "Pydantic at the door, ontology at the ledger": check types first, then check meaning against the domain rules [AIEWF 17:43].
18. Agents should have no side effects until their result has passed the checks [AIEWF 17:43].
19. Errors the constraints catch that English instructions struggle with: a second refund on the same order (functional property), a payout to the support desk instead of the buyer (disjoint classes), a made-up status outside "paid, shipped, or refunded" (allowed values) [AIEWF 18:59].
20. Sequential reliabilities multiply: five steps at 99% give about 95% end to end; validation placed only at the end finds errors after every later step has reasoned over them [Essay]. **Arithmetic checked:** 0.99^5 = 0.951, 0.99^100 = 0.366, 0.995^100 = 0.606, 0.95^100 = 0.0059 (about 1 in 169). The essay prints the first as "0.9⁹⁵", a typo for 0.99⁵.
21. Expert systems failed because they tried to model unbounded common sense (CYC); a bounded domain with dozens or hundreds of constraints is a different task, and models now cut the authoring cost [Essay].

---

## Each lesson against Warden

| Lesson | Warden today | Verdict |
|---|---|---|
| Model proposes, rules dispose (2, 5, 12) | Ajv shape check, then whole-result rejection on scope, verdict consistency, duplicate ids and revalidation (`review/slice.ts`); outcome completeness for triage (`triage/schema.ts` `incomplete`); "model self-reported success is not a trusted check result" (PRD §5 Review); a model never grades a gate (PRD §11) | Covered |
| Every edge a contract (8) | Each model call goes through `runValidated`; each effect goes through writer intents and receipts (ADR 0012) | Covered in structure. The gap is which prompt rules have no check: **proposal 2** |
| Write the rule once (9) | Limits and rules are written once in the prompt and again, with different numbers, in the schema and code | **Gap: proposal 1** |
| Structure first, then meaning (17) | Ajv, then the semantic checks above | Covered |
| On a failed check, back to the model or a human (16) | Schema misfit gets one repair round with the validator's message (PR 174); a completeness failure is rejected whole and counts an attempt; attempts run out to a maintainer | Covered for structure. Extending repair to meaning rules left out (below) |
| No side effects before validation (18) | Shadow mode posts nothing; `readOnly(store)` in the slices; effects only through the serialized writer after acceptance (PRD §11, ADR 0012) | Covered |
| Allowed values, "only one", disjoint (19) | Enums for kind, outcome, severity, verdict; `likely-bug` requires kind `bug`; one accepted review per head and configuration (PRD §11 zero-duplicates counter); maintainers authorised by numeric ID, never by text (PRD §5 Review) | Covered |
| Give the agent the domain (11, 13) | Review gets a read-only repository snapshot and a context pack (ADR 0013); Triage gets nothing but the issue | **Gap: proposal 3** |
| Pick an existing vocabulary (4, 13) | GLOSSARY.md, GitHub's own objects and labels, ADR 0010 YAML rules | Considered; left out (below) |
| Loop risks (14) | Attempt budgets, measured budgets, turn limits on verify-and-continue (ADR 0016) | Covered |
| Reliabilities multiply (20) | Each task is gated on its own; replay scores triage and review separately (PRD §11) | Covered |
| Prefer a check to more prompt words (abstract) | PRD §11 already tunes prompt variants on a dev subset and reports the gate on a held-out subset | Adopted as part of **proposal 2** |

---

## Proposals (ADR 0028)

1. **One rule table per model task.** Every output rule the triage and review prompts state (limits, outcome rules, verdict consistency, citation rules) lives once in a table in code: the rule text the prompt shows, the hard limit if it has one, and its check or the word "judgment". The prompt's rules section, the JSON Schema limits and the post-schema checks are all built from that table. Where a tighter soft target is wanted for the model, the table holds the target beside the hard limit, so the difference is deliberate and visible.
2. **Each rule is checked or marked as judgment, and a test holds that.** A test fails if the rendered prompt states a rule that is not in the table, or a table entry has neither a check nor the `judgment` mark; the test lists the `judgment` entries so a reviewer of a table change sees which rules rest on the model. When a replay miss type has a deterministic form, the fix is a check, not more prompt text; a prompt-only change is still tuned on the dev subset and judged on the holdout (PRD §11). As a first measurement, the replay report counts review findings whose line is not a line of that file's diff, separately from other false findings; nothing is rejected for it until the numbers are in, because PRD §5 Review lets a review assess affected surrounding behaviour.
3. **Triage gets the repository it is asked to judge.** The triage session gets the same read-only repository snapshot the review session uses (read and list tools only, no network, no writes), because PRD §5 Triage already requires investigating against current code and outcome rule 1 cannot be judged without it. A `citation` evidence item names a path, and the check rejects one whose path is not in the snapshot; with no snapshot, the prompt does not offer `citation`. Searching other issues for duplicates stays out: Intake already flags duplicate candidates and never decides them (PRD §5 Intake).

Each is judged the way ADR 0018 and PRD §11 already require: a full replay before and after, on the cases both configurations scored, with the dev and holdout split once it exists.

## Left out, with reasons

- **An RDF, OWL or SHACL stack.** Warden's domain is a handful of enums and a few dozen rules. JSON Schema and TypeScript checks already express the allowed values, "only one" and "these two are different" rules Coyle shows. A second rule language would make a second copy of every rule, the exact problem proposal 1 removes.
- **Adopting an outside vocabulary for findings.** The nearest standard is SARIF 2.1.0 (OASIS, https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html), which GitHub code scanning reads. Warden posts findings as review comments and its own check run (PRD §5 Review), so SARIF would matter only if findings went to code scanning. Not asked for.
- **A repair round for meaning rules.** The baseline's 9 rejections were all schema or parse failures; none was a completeness failure. Sending "a likely bug needs at least one piece of evidence" back to the model invites it to write some evidence to pass, which is worse than a rejection. Revisit if replay shows completeness rejections.
- **Graph RAG.** His part 2, not this video. Warden's code lookup is ADR 0013.

## What guardrails cannot fix in the baseline

Mapped against the 32 disagreements in [REPLAY-QUALIFICATION-2026-11-28.md](REPLAY-QUALIFICATION-2026-11-28.md):

| Miss type | Cases | What can address it |
|---|---|---|
| Format rejection | 9 (7 triage, 2 review) | Structural guardrail: the PR 174 repair round accepts 8 of 9 |
| Triage called actionable, history says not-actionable or needs-info | 8 | Mostly context: proposal 3 gives Triage the code its not-actionable rule depends on |
| Other triage label mismatch | 3 | Judgment; prompt and model |
| Review added false findings | 7 PRs | Partly guardrail: findings on a path outside the PR are already rejected; proposal 2 measures findings off the diff. A false finding on a changed line is judgment |
| Review missed the known defect | 6 PRs | No guardrail catches a finding that was never made. The baseline ran without a repository context pack, so context is the first thing to try; then prompt, then model |

So the talk supports the owner's view for the format rejections and, through proposal 3, for the largest triage miss. It does not support it for the missed defects, where nothing outside the model can help except better input.

## Testing "the model isn't the problem" (not decided)

ADR 0022 says a public benchmark score never counts for qualification, and this note does not change that. The model card of the replayed pack (https://huggingface.co/beamster/Qwen3.8-Flash-Next-Sushi-2bpw, read 2026-11-28) gives two facts that bear on the framing:

- The pack is a community quantization of Qwen/Qwen3.8-Flash-Next: routed experts at 2 bits per weight. Against the bf16 checkpoint its top-1 token agreement is 85.94% (KL divergence 0.208), the lowest-fidelity pack in the card's table. The same maker's 3bpw pack is 90.31% and its 4bpw pack 92.89%. The 2bpw pack targets a 48 GB Mac.
- The card's benchmark (LLMProbe Hard 50: 84.0%) is for this pack itself, on hard questions (MMLU-Pro, OlympiadBench, LiveBench, NIST Juliet), not on code review or issue triage.

A direct test of the owner's framing, on Warden's own evidence: replay the same 64 cases with a higher-fidelity pack of the same model, where the machine has the memory. If the agreement numbers barely move, the quantization is not the cause and the effort belongs in prompts, guardrails and context. If they move a lot, it is. The owner chooses the model.

## What could not be checked

- The video's publication date and length (YouTube was not reachable; both transcript copies lack times).
- Whether the 8 triage cases are duplicates, already fixed or answered by docs: the cases and their issues are in the maintainer's replay set, not here.
- How many of the 7 PRs' false findings sit off the diff: the per-finding rows are in the replay report on the maintainer's machine.
- Which server served the replay. The model card says this pack loads only in sushi (a fork of mlx-serve), not in mlx-lm; Warden's setup names mlx-serve. Both speak the same OpenAI-compatible API, so this does not change the result, but the qualification record should name the server that actually ran (ADR 0022 qualifies by harness and settings).
