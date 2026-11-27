# Talk research: "Vibe Coding vs. Agentic Coding: Which Should You Use?", Grace Ableidinger (IBM Technology)

**Source:** IBM Technology's YouTube channel, 2026-11-23, 8:37.
- Video: https://www.youtube.com/watch?v=h4tHDFCPmQE
- Full transcript: [sources/ableidinger-vibe-vs-agentic-coding-transcript.md](sources/ableidinger-vibe-vs-agentic-coding-transcript.md)

**Speaker:** Grace Ableidinger, AI Developer Advocate at Red Hat since March 2026, before that an associate software engineer at Pendo; BS in Computer Science from NYU Tandon, 2025 (her LinkedIn profile, https://linkedin.com/in/grace-ableidinger, as indexed 2026-11-17). Not a factory builder.

**What kind of source this is:** an eight-minute whiteboard explainer for a general developer audience. It cites no data and names one source, Karpathy. Its points are mainstream practice, so this note checks each against the primary source that backs it (or doesn't).

**Timestamps:** the captions had no caption times; citations use the chapter times from the video's description, e.g. [04:46].

**Researched:** 2026-11-27 against Warden `main` at 8e5edc4. **Confidence:** HIGH for what was said (one caption copy, read in full). The talk's own claims are LOW-weight opinion; the sources checked below are MEDIUM-HIGH.

---

## Verdict

Almost entirely confirmation. Warden already does every control the talk lists, and in most places more strictly: scoped sessions with no GitHub tokens, a human on every one-way door, ledger and transcripts for observability, targeted revert instead of a promise of rollback, and a tool-less reviewer fed a deterministic, budgeted context pack rather than a model's summary.

One contradiction Warden should keep: the talk puts "a quick bug fix" on the vibe-coding side. Warden requires a failing reproducer first, and the evidence on fixes that become bugs supports that.

One gap, on the talk's one point with real research behind it, "focused context" [04:46]. Warden guards against a full context window, not against a long one. Its window guard fires at 60% of the declared window, which on the current 1,048,576-token setting is about 629,000 tokens, and the research says accuracy falls well before that. See proposal 1.

## What the talk claims

1. **Vibe coding is prompt, generate, iterate, without reading the code; good for prototypes and demos** [00:00-01:51]. Matches Karpathy's own post (below).
2. **AI-generated repos show duplicate functions, odd file layout and convoluted fixes; review and validation matter in production** [02:12]. No source given.
3. **Agentic coding is understand, plan, execute, test, validate, with the human strongest at understanding and validation** [02:41-03:38].
4. **Subagents with scoped permissions: "some agent that runs your tests wouldn't have access to your GitHub"** [02:41].
5. **Context is a finite attention budget; more context can make answers worse; aim for focused context; a subagent can explore and hand back a summary** [04:46]. No source given; this is Anthropic's framing almost word for word.
6. **Security: testing, governance ("humans sign off on any irreversible or potentially costly decisions"), observability, rollback, guardrails** [06:04].
7. **Pick the approach by task: quick bug fix, design trial or renaming can be vibe coded; new production features, databases, payments and large refactors want an agentic loop with a human "behind the wheel"; "stay the person who can explain the code"** [07:17].

## Sources checked

| Claim | Source | What it says |
|---|---|---|
| 1 | Andrej Karpathy on X, 2025-02-02 (https://threadreaderapp.com/thread/1886192184808149383.html); Simon Willison, "Not all AI-assisted programming is vibe coding (but vibe coding rocks)", 2025-03-19 (https://simonwillison.net/2025/Mar/19/vibe-coding/) | Karpathy: "forget that the code even exists ... I don't read the diffs anymore ... not too bad for throwaway weekend projects". Willison: vibe coding is "building software with an LLM without reviewing the code it writes"; his "golden rule": "I won't commit any code to my repository if I couldn't explain exactly what it does to somebody else". The talk's closing line is Willison's rule. |
| 5 | Anthropic, "Effective context engineering for AI agents", 2025-09-29 (https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | "Context, therefore, must be treated as a finite resource with diminishing marginal returns ... LLMs have an 'attention budget'." Good practice is "the smallest possible set of high-signal tokens". Sub-agents may use "tens of thousands of tokens or more, but [return] only a condensed, distilled summary ... (often 1,000-2,000 tokens)". |
| 5 | Hsieh et al., "RULER: What's the Real Context Size of Your Long-Context Language Models?", NVIDIA, arXiv 2404.06654, 2024 (benchmark at https://github.com/NVIDIA/RULER, Apache-2.0) | Of models claiming 32K or more, "only half of them can maintain satisfactory performance at the length of 32K"; almost all fall below the threshold before their claimed length. Example: a model claiming 1M had an effective length under 4K. Near-perfect needle-in-a-haystack scores did not predict this. |
| 5 | Hong, Troynikov and Huber, "Context Rot: How Increasing Input Tokens Impacts LLM Performance", Chroma, 2025-07-14 (https://www.trychroma.com/research/context-rot) | 18 models, including Qwen3: "model performance consistently degrades with increasing input length", even on simple tasks. On LongMemEval, focused inputs scored "significantly higher" than the full 113k-token input. The authors expect worse degradation on multi-step reasoning, which code review is. |
| 5 (local models) | Mekala et al., "Does quantization affect models' performance on long-context tasks?", EMNLP 2025, arXiv 2505.20276 | 8-bit quantization keeps accuracy (about 0.8% drop); 4-bit methods lose more, "especially for tasks involving long-context inputs (drops of up to 59%)", and the effect "depend[s] heavily on the quantization method, model, and task". Nothing below 4 bits was tested. |
| 7 (bug fixes) | Yin, Yuan, Zhou, Pasupathy and Bairavasundaram, "How do fixes become bugs?", ESEC/FSE 2011 (https://dl.acm.org/doi/10.1145/2025113.2025121) | "At least 14.8%∼24.4% of the sampled bug fixes are incorrect", and 43% of those caused crashes, hangs, data corruption or security problems, despite regression testing. |

Claims 2, 3, 4 and 6 are standard practice stated without sources; they are compared with Warden directly below.

## Against Warden

| Talk | Warden today | Verdict |
|---|---|---|
| Vibe coding is fine for prototypes, not production [01:51-02:12] | Warden never vibe codes: frozen tests, executor-run evidence, review, merge gates (PRD §3, §5). Throwaway exploration is the open spike proposal in the Maddalone note (its proposal 1). | **Confirms.** |
| Duplicate functions and convoluted fixes in AI code [02:12] | Retro measures structural erosion (verbosity, duplication, complexity trend) before widening authority and looks across merged changes for duplicated helpers (PRD §5 Retro, decided 2026-11-24); Review flags over-engineering (**[P]**). | **Confirms.** Matches the owner's remark in the Maddalone note that eight ways of doing something are eight defect paths. |
| Understand, plan, execute, test, validate [03:38] | Triage investigates against current code and proposes scope; Implement runs a test session then a fix session; Review and the trusted executor validate (PRD §5, ADR 0014, ADR 0016). | **Confirms**, with the human at plan (spec and boundary approval) and validation (boundary decisions), as she says. |
| Subagents with scoped permissions; the test runner has no GitHub access [02:41] | No GitHub write tokens in agent sessions; Review read-only and tool-less; Implement limited to an isolated workspace behind an OS boundary; the GitHub App acts only through the deterministic core (PRD §3, ADR 0011). | **Confirms**, almost her exact example. |
| Focused context; a subagent explores and returns a summary [04:46] | The reviewer stays tool-less and gets a ranked, cited context pack built by compiler lookup, capped at 16,000 characters, with cuts stated in the pack (`src/review/context.ts`, ADR 0013). Patches over 40,000 characters are refused with "split it" (`src/review/slice.ts`). Warden's own earlier prose is never evidence (PRD §3). | **Confirms the method; Warden is stricter.** A model-written summary would be prose, which Warden does not accept as evidence; a deterministic pack is the version that fits its rules. No change. |
| ...but focus also means not letting a session grow long [04:46] | Compaction is off; the window guard tells a session to answer once its prompt passes 0.6 of the declared window (`src/runner/opencode.ts`). On the old 262,144-token model, sessions reached 262,423 and 272,157 tokens before the guard existed, and the guard later fired at about 172k. On the current setting (`--context-limit 1048576` for Sushi-2bpw) the threshold is about 629,000 tokens and was "never near" in the 2026-11-27 baseline (handoff P7 notes). Nothing ties the limit to how long a prompt this model can still use well. | **Gap.** Proposal 1. |
| Governance: humans sign off on irreversible or costly decisions [06:04] | Every one-way door, defined by configured boundary classes and never by a model's judgment, comes to the maintainer (PRD §3, decided 2026-11-26; ADR 0015). Session budgets and the P7 cost reporting cover cost (ADR 0018). | **Confirms.** |
| Observability: see what the agent did and why [06:04] | Ledger records for every operation, executor evidence in the PR description, raw transcripts kept 30 days, Retro samples transcripts (PRD §4, §5, §9). | **Confirms.** |
| Rollback, "so any mistakes can be undone" [06:04] | Warden does not promise rollback: accepted external effects cannot be recalled; it pauses the affected scope and proposes a targeted revert (PRD §9). | **Warden is more precise.** A merged change on a public repository cannot be undone in the talk's sense; keep Warden's wording. |
| Guardrails; ask permission before running a command [06:04] | Authority is the intersection of platform limits, operator ceiling and standing orders; outgoing comments are validated; a model recommendation never grants permission (PRD §3). | **Confirms.** |
| A quick bug fix can be vibe coded [07:17] | Every fix needs a reproducer that fails on the base, frozen before the fix session; if none can be made to fail, Implement stops (PRD §5 Implement). | **Contradicts; Warden is right.** Yin et al. found at least 14.8% to 24.4% of sampled post-release fixes in four operating systems were incorrect, after regression testing. "Quick" is not the same as low risk. |
| Databases, payments, large refactors want a human at the wheel [07:17] | Schemas and migrations, security-sensitive paths and repository-named shared components are default boundary classes; large work is split or returned with a proposed split (PRD §3, §5). | **Confirms.** Payment code is not a named default class; a repository that has some can name it as a shared component. GSD Core has none, so no change. |
| "Stay the person who can explain the code" [07:17] | ADR 0020 (attention classes: `read-before`, `read-after` digest, `evidence-only`) is proposed and waiting on the owner. | **Bears on an open question.** The talk adds no data; Willison's rule is the same idea from a practitioner. Whether it changes the answer to ADR 0020 Q1 is the owner's call. |

## Proposed change (for the owner's call)

### 1. A measured usable context per model, and a guard tied to it (amends MODEL-CONNECTIONS endpoint record, PRD §9 and §11)

- **The gap.** An endpoint record holds the context window, the most a server will accept. The window guard is a share of it. Nothing records the length at which this model's answers are still good, so on a 1M window the guard is effectively off. The P7 baseline on the old model already had sessions past 170,000 tokens.
- **The evidence.** RULER found most models fall below its threshold well before their claimed length, and defines that point as the "effective context length". Chroma found accuracy drops with length on simple tasks and that focused inputs beat full ones. Mekala et al. found 4-bit quantization costs most on long inputs; the current model is about 2 bits per weight, lower than anything they tested, so its long-input behavior is unknown rather than known to be bad.
- **Proposed rule.**
  - Each endpoint entry may carry a second limit, `limit.usable`, beside `limit.context`. It is set from a measurement, never from a model card or a server field.
  - The measurement is a local run of the RULER suite (Apache-2.0) at 8K to 128K on the exact served model and quantization, taking the longest length that passes a stated threshold. RULER needs no network and no cloud model.
  - The window guard fires at the smaller of `windowGuard × limit.context` and `limit.usable`. With `limit.usable` unset, behavior is unchanged and `warden status` says the usable length is unmeasured.
  - The ledger records each session's peak prompt tokens, and the P7 results report recall and false positives by peak-prompt bucket, so the replay set shows whether long sessions are the ones that miss.
- **Cost.** One benchmark run per model change (ADR 0022 already starts a new model paused, so it fits there) and one more ledger field. No authority change.
- **Not shown.** Whether RULER's synthetic tasks predict review quality on Warden's cases. The per-bucket P7 report is the check on that.

## No change proposed

- **Subagent summaries.** The talk's pattern (Anthropic's too) has a model summarize what it explored. Warden's deterministic context pack does the same job without model prose entering the evidence, which PRD §3 forbids. Keep it.
- **Vibe-coded bug fixes.** Keep the reproducer rule.
- **Rollback wording.** Keep PRD §9 as written.
