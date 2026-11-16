# Book Research: *Software Engineering Best Practices* — Bob Hughes (McGraw-Hill, 2010)

**Source:** Bob Hughes, *Software Engineering Best Practices*, McGraw-Hill (2010), 689 pp.
- User-provided copy: https://repo.darmajaya.ac.id/4704/1/Software%20Engineering%20Best%20Practices%20%28%20PDFDrive%20%29.pdf (downloaded 2026-11-14)
- Sections read in full: ch. 1 (methodology + the 200-item ranking, pp. 7–36), BP 30–38 (pp. 110–133), ch. 8 defect prevention/removal + LOC economics (pp. 518–538), ch. 9 quality (pp. 600–620), ch. 3 "A Preview of Software Development and Maintenance in 2049" (pp. 177–187). Page numbers are the book's printed pages.

**Author:** Bob Hughes — software measurement and estimation consultant, expert witness in software breach-of-contract litigation. The book's data comes from "observations of about 13,000 projects in 600 companies" spanning more than 20 years (p. 23), plus ISBSG/SPR benchmark collections.
**Researched:** 2026-11-14.
**Confidence:** HIGH for what the book claims (read directly from the provided PDF). The data is circa 2009–2010 — pre-AI. Treat the *rankings and economics* as durable industrial evidence about defect removal, metrics, and maintenance; do not treat the tool list (2010-era static analysis, no LLMs) as current.

---

## Why this book matters to Warden

Hughes is the strongest *quantitative* backing for the correction ladder in [FRAMEWORK-CORRECTIONS.md](FRAMEWORK-CORRECTIONS.md). Tan (2026) argued from practitioner experience that deterministic checks beat prose; Hughes measured it across 13,000 projects: static analysis and inspections remove defects at roughly **twice** the efficiency of testing, and "testing, by itself, is insufficient to achieve professional levels of quality" (p. 618). The book also supplies the economic rationale for Warden's quality-first gates ("quality leads and productivity follows"), a warning about which metrics to *never* report (LOC, cost-per-defect — "professional malpractice"), empirical backing for bounded rework (~7% of repairs inject new defects), and a 2010 edition of the "codebase as garden" principle (structural decay always occurs; renovate or it rots).

---

## The method: "best practice" = top 15% + quantitative proof

- Definition (p. 8): "To be described as a best practice, a language, tool, or method needs to be associated with software projects in the **top 15 percent** of the applications measured and studied by the author and his colleagues. To be included in the set of best practices, a specific method or tool has to demonstrate by using quantitative data that it improves schedules, effort, costs, quality, customer satisfaction, or some combination of these factors."
- Every method is scored **−10 to +10** on measured productivity and quality impact (Table 1-3, p. 8), by size range, application type, and activity. "Software engineering is not a 'one size fits all' kind of occupation" (p. 9).
- The ranking covers 200 topics; "Solid empirical data exists for about 50 out of the 200. For the rest, the data is anecdotal or inconsistent" (p. 23).
- Three tiers of interest: **best practices** (score ≥ ~7), **neutral practices** (no measurable effect either way — "a rowboat does not need the same rigor of development as does a cruise ship", p. 35), and **worst practices / professional malpractice** (proven to cause harm).
- Usage reality check (p. 32): harmful practices "are actually found on about **65 percent** of U.S. software projects. Conversely, best practices that score 9 or higher have only been noted on about **14 percent**."
- The three critical topics, across all sizes and types (p. 32): **quality control, change control, project management** — plus measurement and reuse (zero-defect only).

## What the data says: Table 1-4 highlights (pp. 24–29)

Top of the 200-item ranking:

| Rank | Practice | Score |
|---|---|---|
| 1 | Reusability (>85% zero-defect materials) | 9.65 |
| 2 | Defect potentials < 3.00 per function point | 9.35 |
| 3 | Defect removal efficiency > 95% | 9.32 |
| 4–5 | Personal / Team Software Process (PSP/TSP) | 9.25 / 9.18 |
| **6** | **Automated static analysis** | **9.17** |
| **7** | **Inspections (code)** | **9.15** |
| 8 | Measurement of defect removal efficiency | 9.08 |

Notable mid- and low-rank entries:

| Practice | Rank / score | Tier |
|---|---|---|
| Agile development | 21 / 8.41 | Very good (but "lose effectiveness rapidly above 10,000 function points", p. 7) |
| Inspections (requirements) | 22 / 8.40 | Very good |
| Measurement of bad-fix injections | 18 / 8.50 | Very good |
| Automated unit testing | 41 / 7.75 | Very good |
| Root-cause analysis | 103 / 5.50 | Good |
| Refactoring | 129 / 3.33 | **Fair** |
| Pair programming | 133 / 2.83 | Fair |
| ISO quality standards | 136 / 2.00 | Fair |
| **Manual testing** | **142 / 0.17** | **Neutral** — no measurable effect either way |
| Waterfall development | 147 / −0.33 | Unsafe |
| **Cost per defect metrics** | **158 / −2.83** | **Unsafe** |
| **Lines of code metrics (logical / physical)** | **162, 164 / −4.00, −4.50** | **Unsafe** |
| Inadequate testing | 176 / −6.38 | Worst |
| Error-prone modules in applications | 181 / −6.83 | Worst |
| Inadequate inspections | 187 / −7.42 | Worst |
| Defect removal efficiency < 85% | 196 / −9.18 | Worst (rank 1 of the "professional malpractice" list, Table 1-7, p. 34) |

Size matters (Table 1-5, pp. 30–31): for small projects (<1,000 FP) Agile and high-level languages top the list; for large systems (≥10,000 FP) **quality control ascends to the top** — requirements/design inspections, defect removal efficiency, cost tracking. Defect-removal paths tier by size (Figure 1-1, p. 10): small = peer review + unit/function/beta test; medium **adds code inspection and automated static analysis** plus regression/performance/system tests; large adds requirements/design/test-plan inspections and SQA. This is the industrial precedent for Warden's risk-tiered review: more rigor as stakes rise, with static analysis and inspection entering at the medium rung.

## Defect removal economics: the ladder's empirical backbone

The measured defect-removal efficiency of each method (Table 9-22, pp. 615–617; maximum values):

| Method | Removal efficiency | Bad-fix injection |
|---|---|---|
| Automated static analysis | **87%** | 2% |
| Requirements / design / code inspections | **85%** each | 4–6% |
| Security testing (specialized) | 90% | 4% |
| Performance testing | 80% | 7% |
| Refactoring of code | 62% | 5% |
| Error-prone module analysis | 60% | 10% |
| Informal peer reviews | 40% | 10% |
| Private desk checking | 35% | 7% |
| General testing (unit, regression, system…) | **25–41%** avg | 3–8% |

The book's own synthesis (p. 614): "Formal inspections are best at finding very complicated and subtle problems that require human intelligence and insight… also best at finding errors of omission and errors of ambiguity. **Static analysis is best at finding structural and mechanical problems** such as boundary conditions, duplications, failures of error-handling… **Testing is best at finding problems that occur when software is executing**, such as performance issues, usability issues."

Key numbers:
- "Most forms of testing are less than **35 percent** efficient in finding errors or bugs" (p. 128); "The cumulative efficiency of all forms of testing seldom tops **80 percent**, so additional steps such as inspections and static analysis are needed to raise defect removal efficiency levels above 95 percent, which is a minimum safe level" (p. 128).
- Inspections average **>65%** — "twice as efficient as most forms of testing"; some top 85–88% (p. 125).
- The U.S. average sequence is six kinds of testing, cumulative **70–85%**: "The bottom line is that **testing, by itself, is insufficient to achieve professional levels of quality**" (p. 618). The optimal sequence — pretest inspections + static analysis, then eight test kinds — reaches **>95%, some 99%** (pp. 618–619).
- Defect origin determines the only effective discovery method (p. 127): requirements defects → **formal requirements inspections** ("requirements problems cannot be found and removed by testing", p. 126); design defects → design inspections; coding defects → static analysis + code inspection + testing; **bad fixes → re-inspection after repair, rerun of static analysis, regression testing**. "Defects should be found within no more than a few hours or days from when they originate" (p. 126).
- "Most projects are on schedule and within budget until testing starts, at which time excessive defects stretch out testing by several hundred percent compared with plans and cost estimates" (p. 518).
- Successful vs unsuccessful 10,000-FP projects (pp. 131–132): successful accumulate ~4.0 defects/FP and remove ~95% (≈2,000 latent delivered, ~10% serious); unsuccessful accumulate ~7.0/FP and remove ~80% (≈14,000 latent delivered, ~20% serious). "Unsuccessful projects typically omit design and code inspections, static analysis, and depend purely on testing" (p. 132).

**For Warden:** the ladder's ordering (design > static checks > dynamic verification > prose) is not just Tan's intuition — it matches 2010 industrial measurements of where defects actually get removed. And the origin→discovery table is the direct ancestor of Kotyal's spec-verification idea (see [TALK-SPEC-BUGS.md](TALK-SPEC-BUGS.md)): requirements/spec defects are the one class that *only* pre-code checking can catch.

## Quality leads, productivity follows

- "Quality needs to be improved faster and to a higher level than productivity in order for productivity to improve at all. The reason for this is that **finding and fixing bugs is overall the most expensive activity** in software development. **Quality leads and productivity follows.** Attempts to improve productivity without improving quality first are ineffective" (p. 7).
- "Effective software quality control is the most important single factor that separates successful projects from delays and disasters" (p. 130).
- "In today's world, software engineers spend more days per year fixing bugs than doing actual development" (p. 123). Every ~120 delivered defects removed saves about one maintenance person; every ~240 saves a support person (p. 123).
- "Poor quality always causes schedule delays and cost overruns, while good quality is associated with on-time completions… and effective cost controls" (p. 123).
- Delivered-defect economics (Table 9-16, p. 600): 4 defects/KLOC ≈ MTTF of 105 hours and "Poor" satisfaction; ≥8/KLOC is the "Litigation" row.

**For Warden:** this is the economic citation for spending review budget on quality gates (deterministic checks, verifier pass) rather than on raw throughput — the same argument Tan makes with token economics.

## Metrics: LOC and cost-per-defect are malpractice

- "The lines of code metric penalizes high-level languages and can't measure noncode activities at all. In the author's view, usage of lines of code for economic studies constitutes **professional malpractice**" (p. 17). A 1994 controlled study of ten versions of the same application in ten languages found "LOC metrics violated the standard assumptions of economic productivity so severely that using LOC metrics for studies involving more than one programming language constituted professional malpractice" (p. 538).
- "The cost per defect metric actually penalizes quality and achieves its lowest values for the buggiest applications. Cost per defect cannot be used to measure zero-defect applications" (p. 17).
- The **100× myth** debunked (p. 18): "Mathematical problems with the cost per defect metric have led to the urban legend that 'it costs 100 times as much to fix a bug after delivery as during development.' This claim is not based on time and motion studies, but is merely due to the fact that cost per defect goes up as numbers of defects go down. **Defect repairs before and after deployment take about the same amount of time.** Bug repairs at both times range from 15 minutes to more than eight hours." (Nuance: post-release fixes carry ripple effects and support costs the raw fix-time comparison doesn't capture — but the 100× figure is an artifact of a broken metric, not a measured ratio.)
- Table 9-19 (p. 604) ranks metrics by measured effect on defect prevention/removal: IFPUG function points top the list (−30% potentials / +15% removal); **the bottom two are harmful** — cost per defect and LOC *make quality worse* when used. "As commonly used in the software literature, both cost per defect and lines of code are close to being professional malpractice" (p. 605).
- The usage disconnect (Table 9-21, pp. 607–608): the three most-used "defect prevention" methods in U.S. projects are all harmful — uncertified reuse (90% of projects), cost-per-defect metric (75%), LOC (72%) — while the most effective are rare: certified reuse (1%), inspection participation (12%). "A severe disconnect between effective methods of defect prevention and day-to-day usage" (p. 606).
- "Measurement of software is a professional embarrassment as of 2009" (p. 112); "Lack of defect measures and unknown levels of defect removal efficiency imply amateurishness; not professionalism" (p. 537).

**For Warden:** a direct constraint on what the bucket report, Sweep metrics, and adopter-facing docs may claim. Never LOC or cost-per-defect (they reward the wrong behavior — see new Pitfall 12). Warden's existing metrics (open PR count, median age, minutes per PR, agreement rate, escaped defects) are all fine; if a "productivity" number is ever wanted, use completed items or function points.

## Bad fixes and bounded rework

- "About **7 percent** of attempts to repair software defects contain new defects in the repairs themselves. In fact, sometimes there are secondary and even tertiary bad fixes; that is, **three consecutive attempts to fix a bug may fail to fix the original bug and introduce new bugs** that were not there before" (p. 614).
- "The 'bad fix' injection rate for projects without inspections is alarmingly high" (p. 132). Measuring bad-fix injections is itself a very-good practice (#18, Table 1-4).
- Test cases themselves are buggy: an IBM study "found more errors in test cases than in the software that was being tested. The same study found about 35 percent duplicate or redundant test cases" (pp. 613–614) — redundancy "adds costs, but not rigor" (p. 129).

**For Warden:** empirical backing for the **3-round rework cap** and for the verifier pass (which must re-derive each finding, including whether a "fix" introduced new problems). The bad-fix injection rate is also the argument for re-running static analysis + regression after every repair — Warden's Implement preflight already does this.

## Renovation, error-prone modules, and specs rot (the garden, 2010 edition)

- "As software ages, **structural decay always occurs**, which may slow down performance or cause an increase in bugs or defects. Therefore if the software continues to have business value, it may be necessary to **'renovate'** legacy applications. Renovation consists of topics such as restructuring or refactoring to lower complexity, **identification and removal of error-prone modules**" (p. 14).
- "Error-prone modules in applications" is a **worst practice** (−6.83, Table 1-4); error-prone module analysis is a recognized removal activity (60% efficiency, Table 9-22).
- **Specs rot:** "Existing business rules can be extracted from the code using data-mining techniques, **since the original requirements and specifications usually lag** and are not kept current" (p. 14). Data mining for business-rule extraction is a very-good practice (#48, Table 1-4).
- Complexity: code with cyclomatic complexity <10 has "only about 40 percent as many errors" as code above 20 (p. 526); "100 percent coverage almost never occurs when cyclomatic complexity levels get above 5" (p. 534).

**For Warden:** this is the industrial precedent for Tan's "codebase as garden" — decay is *always* happening, so a periodic renovation pass (the v1.x "garden" report: deprecated/anti-pattern instances, oldest first) is standard maintenance practice, not a novelty. And "specs usually lag" supports the spec-verification direction: by the time an issue is implemented, the written spec may already disagree with the code.

## The 2049 preview: agents, reuse, and data-mined specs (ch. 3)

Hughes's speculative chapter is the earliest published sketch of what Warden and Lloyd are building:
- "From the 1960s through 2009, software development has been essentially a **craft**… This method of custom development using custom code written line by line can never be efficient, economical, or achieve consistent levels of quality and security" (p. 177). "Composing and painting a portrait in oil paint and developing a software application are very similar… Neither portraits nor software applications are engineering disciplines" (p. 177).
- Circa 2049, "about **85 percent** of these outputs [requirements analysis] could be produced by **intelligent agents and expert systems** with little human effort other than setting up search criteria" (p. 181).
- Design: "almost every new feature will be designed as a **reusable artifact**, rather than… a unique artifact for a single application" (p. 182); "The extraction of design and algorithms from legacy code can be done automatically via **data mining** of the source code, assuming that past specifications have not been fully updated or may even be missing" (p. 183).
- The economics of the shift: custom development runs ~10–15 FP/staff-month at 4.5 defects/FP and 87% removal (≈1,400 delivered defects); construction from certified reusable components runs 45–50 FP/staff-month at 1.25 defects/FP and 98% removal (≈60 delivered) (p. 185).
- "It is unlikely that automatic development of sophisticated applications will occur even by 2049… It is even possible to envision a kind of **robotic assembly line for software** where intelligent agents and expert systems perform more than 90 percent of the tasks now performed by humans" (p. 186).

**For Warden:** the book frames the whole enterprise — agents doing the volume work, humans owning quality gates and renovation. Warden's "AI proposes, scripts dispose" is the 2026 version of this path; Lloyd's self-improving factory (TALK-FACTORY.md) is the same idea with a measurement loop.

---

## Implications for Warden (where each idea lands)

| # | Book idea | Warden component | Where captured |
|---|---|---|---|
| 1 | Ladder ordering = measured removal efficiency (static analysis 87%, inspections ~65–88% vs testing <35–80%; "testing by itself is insufficient") | Deterministic gates + correction ladder get 2010 industrial backing, not just one team's experience | FRAMEWORK-CORRECTIONS.md (new "Empirical backing" note); SUMMARY.md |
| 2 | Quality leads, productivity follows; bug-fixing is the most expensive activity | Economic rationale for quality-first gates (red CI → "fix CI first", no AI tokens spent) | SUMMARY.md; FRAMEWORK-CORRECTIONS.md (gates row) |
| 3 | LOC + cost-per-defect = professional malpractice; they *make quality worse* (Table 9-19); most-used ≠ best | Success metrics and adopter docs must never use LOC or cost-per-defect; report items, time, agreement | PITFALLS.md (new P12); PROJECT.md Key Decisions |
| 4 | ~7% of repairs inject new defects; tertiary bad fixes exist; measure bad-fix injections | Bounded rework (3 rounds) + verifier re-derivation + preflight after every repair | FEATURES.md (bounded-rework row reinforced); SUMMARY.md |
| 5 | Defect origin → only effective discovery: requirements defects can *only* be caught pre-code (inspections), never by testing | Spec verification before Implement — the direct ancestor of Kotyal's SMT check; v1 minimal = self-consistency + stated interpretation | TALK-SPEC-BUGS.md; PITFALLS.md (new P13); FRAMEWORK-CORRECTIONS.md |
| 6 | Structural decay always occurs; renovation = refactoring + removal of error-prone modules (worst practice to leave them) | v1.x "garden" report gets industrial backing: periodic renovation is standard practice, not novelty | FEATURES.md (deferred row reinforced); SUMMARY.md |
| 7 | Specs usually lag the code; business rules must be mined from code | Retro/spec-drift: REVIEW.md and issue specs can rot; spec-from-code is a v1.x+ idea | SUMMARY.md |
| 8 | Measuring defect origins (#28) and removal efficiency (#8) are top-10 practices | Retro tracks *where* findings originate (spec/design/code/bad-fix); agreement rate is Warden's defect-removal-efficiency analog | FEATURES.md (Retro row); PROJECT.md Key Decisions |
| 9 | "Most projects are on schedule until testing starts, at which time defects stretch it by several hundred percent" | Pre-test deterministic gates: don't spend tokens reviewing what static checks already reject | FRAMEWORK-CORRECTIONS.md (gates row) |
| 10 | 2049 preview: agents do ~85% of requirements work; design for reuse; robotic assembly line | Long-horizon framing: Warden is a step on the craft→engineering path; Retro + factory self-improvement (Lloyd) is the 2026 version | SUMMARY.md |

## Open threads and limits

- **Pre-AI data.** All measurements predate LLMs. The *relative* ranking (static checks and inspection above testing; prose weakest) is the durable part, and it matches Tan's 2026 experience — but agent-era numbers (e.g., how well LLM "inspections" find requirements defects) are unknown. Hughes's own caveat: the data "spans more than 20 years of observation, so… it is easily possible that some of the practices are out of place on the list" (p. 24).
- **Function points are slow and expensive** — Hughes admits "very few applications above 10,000 function points have ever been counted" (p. 114). Warden should not require FP counting from adopters; the *principle* (measure in a size unit that matches economics, never LOC) transfers without the counting cost.
- **Inspections are human meetings** (moderator, recorder, 3–6 participants, p. 125). Warden's analog is the verifier pass + human gate; the book's efficiency numbers for *formal* inspections don't directly transfer to LLM review, but the origin→discovery logic does.
- **Standards don't measure up:** "There are no known controlled studies that demonstrate if adherence to standards improves quality. There is some anecdotal evidence that at least some standards, such as ISO 9001-9004, degrade quality" (p. 605). Relevant if adopters ask Warden to certify against a standard: the book says standards adherence is unproven.
- **The 100× myth** is debunked for *fix time*; the real post-release cost drivers are ripple effects, support load, and trust damage — which is exactly what Warden's escaped-defect metric tracks.

---
*Book research for: The Warden of the Gate — Researched 2026-11-14*
