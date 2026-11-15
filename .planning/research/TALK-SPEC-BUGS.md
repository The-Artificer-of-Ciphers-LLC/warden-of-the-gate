# Talk Research: "Your Spec Has Bugs. Catch Them Before Your Agent Codes." — Rajath Mahendrappa Kotyal, AWS

**Source:** AI Engineer YouTube channel, uploaded 2026-11-11 (7:50).
- Video: https://www.youtube.com/watch?v=0EnLxIbAvYk
- Reading edition: https://ai.engineer/talks/0EnLxIbAvYk-your-spec-has-bugs-catch-them-before
- Speaker page: https://ai.engineer/speakers/rajath-mahendrappa-kotyal
- Full machine-generated transcript: [sources/kotyal-spec-transcript.md](sources/kotyal-spec-transcript.md) (downloaded 2026-11-14; recognition errors remain, timestamps are the video's clock)

**Speaker:** Rajath Mahendrappa Kotyal ("Rajat"), AWS **automated reasoning group**. The project: the **Kiro specification analyzer** — "we use certain techniques which involves formal methods and automated reasoning to prove [verify] specification that goes to your coding agent before it writes code" [00:14–00:21].
**Researched:** 2026-11-14.
**Confidence:** HIGH for what the talk claims (full transcript read directly). The motivating statistics are cited by Kotyal from "public research" [01:38] and were not independently verified here. Kiro is an AWS product; the analyzer's internals are as described in a 7:50 talk, not peer-reviewed.

---

## Why this talk matters to Warden

Warden's Implement task takes a confirmed-bug issue (with triage's root-cause analysis) and writes code from it. That issue text *is the spec* — and this talk is the argument that **specs have bugs, those bugs flow straight into agent-written code, and they can be caught before any code is written**. It fits Warden's existing philosophy exactly: "The LLM translates, the solver checks and the human decides" [07:18] is the same division of labor as "AI proposes, scripts dispose" plus a human gate. It also matches Hughes's 2010 measurement that requirements defects are the one class *only* pre-code checking can catch (BOOK-SE-BEST-PRACTICES.md, p. 126: "requirements problems cannot be found and removed by testing").

---

## The motivating numbers (as cited in the talk)

- "there's a **20 to 40% drop** with unclear prompts on the accuracy… the LLM generates on the code accuracy" [01:42–01:49]
- "**60 to 90% of valid code is still wrong** after it writes it" [01:52–01:54]
- "we observe **two times the more regressions** when we deploy that code" [01:57–02:03]

The goal, in his words [02:08–02:42]: "We want to detect these bugs **before they reach the codebase**… similar to how we write design docs. Similar to how we draw diagrams and flowcharts to make sure the flow is set before we write any code. We want to verify that **without a human or anyone reading these files as the first reviewer**… we can observe **conflicts and gaps** in the specification or rules."

## The example: two rules that can't both hold [00:34–01:28]

An e-commerce spec handed to the coding agent contains two rules that each read fine alone:
1. "When an order is submitted and the inventory is unavailable, we place the order as a **backorder**."
2. "**No order shall be placed as a backorder.**"

"Individually read these two lines make sense right but when an LLM reads both the rules together **both cannot hold true at the same time** so we need to make sure that we resolve this ambiguity" [01:06–01:24]. An agent given both rules will pick one arbitrarily — and the "wrong" choice becomes a silent product bug.

## The process: refine → formalize → solve → cluster → decide

A three-step pipeline [02:53–03:47]:
1. **LLM refines** the wording first — "it'll try to clean up the wording on its own and if it succeeds then well and good" [02:56].
2. **Formalize English into SMT formulas** — "SMT lib is a certain set of type of function which we pass to a **SAT solver**, a satisfiability checker where it's going to give out a boolean saying this expression… is valid true or false invalid" [03:04–03:27].
3. **On ambiguity, re-iterate** — "if it detects any ambiguity between two sentences or within a sentence where there's two meanings to a sentence, then we detect that and tell the LLM to recheck that sentence and it's going to reiterate on that" [03:31–03:45].

Then a second, deeper pass on anything still ambiguous [04:11–05:03]:
- **Sample the translation 7–10 times** — "we ask the LLM to translate it seven times or 10 times and to understand whether this LLM is behaving this way based on its inherent capabilities or is something affecting it" [04:17–04:31].
- **Cluster by logical equivalence** — "based on logical equivalence of these seven or 10 different set of interpretations by the LLM we cluster them" [04:36–04:41]. Multiple clusters = the spec genuinely supports multiple meanings.
- **Decide** — "we then accept or ask the user to clear out the ambiguity or **abstain from implementing** that in the codebase" [04:52–04:58].

Worked disambiguation example [05:13–05:35]: the rule "remove the record" is "very a very vague statement. The LLM cannot [can] interpret anything it wants but we shouldn't allow that to happen and we either give two options: **we keep it as is — the record is deleted, or we retain it but hide it from the users** — which one does the user prefer?"

## Conflict vs gap [05:39–06:04]

- **Conflict:** rules contradict each other (the backorder pair — "rule one is conflicting with rule three").
- **Gap:** "a gap is where **no rule covers** an [idle] order in this example… there's no entry for this rule where you are missing something" — a case the spec never considered, which an agent will fill in by guessing.

## The limits — and the division of labor [06:08–07:32]

- "End of the day, we want to make sure **there is no oracle for specification correctness other than the user**. User needs to make sure to check every part of the snippet, part of the rule book before sending it to the LLM. And we as a tool only can help them and **the user is more important here because of implicit domain knowledge**. The LLM doesn't know a lot of domain knowledge and there's no guarantee… only user can give that guarantee" [06:12–06:44].
- Honesty about the tech's maturity: "there's **thin evidence right now for formalization** and how it can be used in agents, we are emerging in this technology" [06:46–06:52].
- The takeaway, in his words [07:00–07:30]: "**check the spec always before you pass it down to the agent**… cluster the translation by logical equivalent to determine the different LLM interpretations and where it's genuinely going wrong. **The LLM translates, the solver checks and the human decides.** We give the human options and if there's no answer to that, we use LLM judges or **abstain from implementing** that piece."
- Team: "this work has been majorly contributed by my team — Andrea Jin, Stefan and Delmos" (transcript rendering; a team blog is linked in the video) [07:35–07:45].

---

## Implications for Warden (where each idea lands)

| # | Talk idea | Warden component | Where captured |
|---|---|---|---|
| 1 | Spec bugs (conflicts + gaps) flow into agent code; unclear prompts drop accuracy 20–40% | **New pitfall P13:** a confirmed-bug issue with contradictory or under-specified acceptance criteria produces a "clean-looking" bot PR that implements the wrong thing | PITFALLS.md (new P13) |
| 2 | Formal check *before* the coding agent writes code (SMT + solver) | **Spec verification gate, deferred v1.x:** a deterministic/semi-deterministic check of the issue spec (repro steps + expected behavior) before Implement. Fits the correction ladder as an *upstream* rung — it checks the spec, not the code | TALK-SPEC-BUGS.md; FEATURES.md (deferred); FRAMEWORK-CORRECTIONS.md |
| 3 | **v1 minimal version (no SMT needed):** the Implement prompt requires the agent to *state its interpretation* of each ambiguous rule; if two plausible readings exist, it must report the ambiguity as an **open finding for the human gate** and implement neither guess | Cheap, prompt-level version of "abstain rather than guess" — consistent with the comment-restrictive policy (P11): never silently resolve ambiguity | PITFALLS.md P13; PROJECT.md Key Decisions |
| 4 | Sample the translation N times, cluster by logical equivalence | Cheap v1 heuristic: ask the Implement agent to restate the spec's key rules 3× (or reuse triage's root-cause output); **disagreement between samplings = ambiguity flag** on the decision card. No solver required | TALK-SPEC-BUGS.md (heuristic) |
| 5 | "The LLM translates, the solver checks and the human decides" + abstain | Matches Warden's core: AI proposes, scripts dispose, **human gate decides**. Ambiguity is a *finding type* (spec-conflict / spec-gap), not something to paper over | FRAMEWORK-CORRECTIONS.md (spec-verification section) |
| 6 | Defect origin: requirements defects are only catchable pre-code (Hughes, p. 126) | Triage's root-cause output is Warden's de-facto spec for Implement; a self-consistency check on it (v1) and formal check (v1.x) is the highest-leverage place to spend rigor, because testing can never catch these later | FEATURES.md (triage row note); SUMMARY.md |
| 7 | "60–90% of valid code is still wrong after it writes it" | Reinforces the verifier pass + human gate as *necessary*, not optional — even code that compiles and passes its own tests is frequently wrong | SUMMARY.md; FRAMEWORK-CORRECTIONS.md (verifier row) |

## Open threads and limits

- **SMT formalization of natural-language specs is immature** — Kotyal says so himself ("thin evidence right now"). For v1, Warden should use the *prompt-level* version (stated interpretation + abstain); the SMT/solver version is a v1.x+ experiment, and only for specs that can be expressed as rule sets (issue acceptance criteria qualify; free-form feature requests may not).
- **Kiro is a product, not open source.** The *pattern* (refine → formalize → solve → cluster → human decides) is transferable; the tool isn't. If a v1.x spike happens, candidates are any SMT-capable checker (Z3) with an LLM translation layer — the talk doesn't name its solver.
- **The statistics are second-hand** ("public research", not cited in the talk). Directionally consistent with Hughes's defect-origin data and Tan's verification economics; treat as motivation, not benchmark.
- **Scope:** this talk covers *spec* correctness (rules contradicting or missing). It does not cover spec–code drift after the fact — that is Hughes's "specs usually lag" territory (BOOK-SE-BEST-PRACTICES.md) and a Retro/garden concern, not an Implement-gate concern.

---
*Talk research for: The Warden of the Gate — Researched 2026-11-14*
