# Phase 1: Core State & Safety Rails - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers an installable, versioned plugin; one validated `.github/warden.yml` (with defaults and migrations); and a no-AI `/warden setup`. It also delivers the state layer on GitHub: exactly one state label per open item, an App-authored ledger edited in place, and a reconcile run. All of it posts through the maintainer's own GitHub App, with a read-only token for sessions and a write token for the poster. The runner refuses unsafe starts (API-key route, non-subscription auth, kill switch, `warden:hold`).

Phase 1 contains no AI tasks. It also includes the *definition* of backlog buckets A–F. The `/warden status` report that displays them, and the Foundation gate, are Phase 2 (GATE-05, ROLL-01).

Requirements: CONF-01..06, STATE-01..04, STATE-06, POST-01, POST-02, RUN-01, RUN-02, RUN-03, RUN-08.

</domain>

<decisions>
## Implementation Decisions

### Backlog buckets A–F (defined here, displayed in Phase 2)
- **D-01:** Six PR buckets, locked: **A** never reviewed · **B** reviewed, waiting on author · **C** waiting on maintainer · **D** stale candidate · **E** bot-authored (the Warden's own PRs) · **F** blocked (CI red or merge conflict).
- **D-02:** The buckets are **exclusive**, with a fixed precedence: **E > F > D > C > B > A**. Each open PR lands in exactly one bucket, so the totals equal the open PR count.
- **D-03:** A–F cover **PRs only**. The report has a separate issue section with counts per issue state (needs-triage, needs-reproduction, needs-info, confirmed-bug, ...).
- **D-04:** Buckets are **computed from GitHub history** with the shared whose-turn function, not read from Warden labels. Any review by the maintainer or the App counts as "reviewed". Once an item has a trusted ledger, the ledger takes precedence. This makes the report meaningful before any Warden review exists. — **Reversibility:** costly — the whose-turn function is shared with Sweep clocks (ADR 0002) and first-run labelling (D-12), so changing its semantics changes three consumers.
- **D-05:** **D (stale candidate)** = waiting on the author with no author activity for longer than the configured first-nudge interval (`config.stale.*`, ADR 0002 default 48h). It reads the same config Sweep acts on, so it can never disagree with Sweep.

### Label vocabulary
- **D-06:** Default names: issues use familiar unprefixed names that already match GSD Core (`needs-triage`, `needs-reproduction`, `needs-info`, `needs-maintainer`, `confirmed-bug`, `approved`, `claim-window`, `claimed`, `ready-for-agent`, `has-pr`). PR states use the `pr:` prefix (`pr:needs-review`, `pr:needs-rereview`, `pr:changes-requested`, `pr:human-gate`, `pr:blocked`). Warden controls are `warden:hold` and `warden:needs-human`. Code works on internal state IDs (`pr.new`, `issue.confirmed`, ...), and `.github/warden.yml` maps each ID to label text. — **Reversibility:** costly — renaming defaults after adopters exist needs a config migration and relabelling of live repos.
- **D-07:** When a needed label already exists in the repo, setup **adopts it as-is** and leaves its colour and description unchanged. Setup creates only missing labels and reports which it adopted and which it created.
- **D-08:** Config may declare **aliases** that map extra repo labels to a state (for example `wip` → `pr.changes-requested`). Reconcile and the bucket logic treat an alias exactly like the canonical label. Labels that are neither mapped nor aliased are facets the Warden never touches.
- **D-09:** Aliases are **read-only**. Reconcile never rewrites an alias to the canonical label. The Warden replaces it (add-then-remove, STATE-06) only when it makes its own next transition. This follows "a manual move by the maintainer wins" (STATE-01).

### First-run backlog
- **D-10:** The first reconcile on an existing repo is **all at once, dry-run first**. Setup runs reconcile in dry-run and shows the counts per state it would assign. After the maintainer confirms, one throttled run applies them. The first run writes **labels only** and posts no contributor-facing comments.
- **D-11:** Ledgers are created **lazily**: a ledger comment appears the first time the Warden really acts on an item (review, nudge, triage, transition with history), not at first reconcile. The ARCHITECTURE invariant "every open PR has an App-authored ledger" is relaxed to "every item the Warden has acted on has one". A missing ledger means "no Warden history" and is not corruption.
- **D-12:** The initial **PR state is derived from history** with the same whose-turn logic as D-04. Changes requested by the maintainer → `pr:changes-requested`; red CI or conflicts → `pr:blocked`; maintainer's turn → `pr:human-gate`; unreviewed → `pr:needs-review`. Labels and bucket report then agree from day one.
- **D-13:** The initial **issue state keeps any existing mapped state label** (or alias). An issue with none gets `needs-triage`. An issue with two or more state labels goes to `warden:needs-human` rather than having the Warden guess.

### App provisioning & setup
- **D-14:** **Each maintainer creates their own GitHub App** through GitHub's App-manifest flow, started from setup (for example `/warden setup app`), with permissions pre-filled and **no `workflows` permission**. Setup stores the private key in the login keychain (base64, per STACK.md). There is no shared, published App. — **Reversibility:** one-way — the App identity is the author of every ledger (STATE-03 trusts its numeric bot user ID), so swapping Apps orphans all existing ledgers and needs a rebuild from SHA markers.
- **D-15:** For Actions, setup creates a **`warden` environment limited to the default branch** and stores the key and Client ID there with `gh secret set --env`. Only the bookkeeping jobs reference that environment (PITFALLS key-custody advice).
- **D-16:** `/warden setup` is **plan → confirm → apply**. It inspects the repo, prints every intended change (config to write, labels to create or adopt, workflow callers to write, ruleset, environment secret, conflicts), asks once, then applies. A second run prints "nothing to do". It never asks for individual config values: the starter config comes from defaults plus detected values (default branch, maintainers from CODEOWNERS/MAINTAINERS if present), and the maintainer edits the YAML afterwards.
- **D-17:** Conflicting `stale.yml` / other AI reviewer: setup **never edits or deletes workflow files**. It reports the conflict with the exact fix. While a conflicting `stale.yml` exists, the Warden **refuses to enable its own stale clocks**. Another AI reviewer workflow produces a warning only.
- **D-18:** Setup **creates or updates the repo ruleset** (App pushes limited to `warden/**`, maintainer review required) using the **maintainer's own `gh` login**, as one item in the plan list. The App can't create rulesets, and a second run changes nothing.
- **D-19:** Workflow templates are **thin callers** (`.github/workflows/warden-*.yml`) to the Warden's reusable workflows pinned at `@v1`. Updates arrive by tag, with no re-copy. Setup writes the files into the working tree, and committing them is the maintainer's action.

### Claude's Discretion
The planner and researcher decide these within the locked decisions:
- Exact colours and descriptions for labels the Warden creates.
- The write-throttle rate for the first-run apply, and how it avoids the App-event recursion noted in PITFALLS (App-made label events do trigger workflows).
- launchd schedule defaults, the exact text of the runner's refusal messages, and the internal ledger JSON field layout beyond STATE-02's required fields.
- Exact names of setup subcommands (`/warden setup`, `/warden setup app`, ...), subject to the phase-1 check of plugin skill invocation.
- Default precedence when the reconciler finds two state labels (ARCHITECTURE: later state in the table wins, ledger breaks ties), except for the issue first-run rule in D-13.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and requirements
- `docs/prd/0001-warden-of-the-gate.md` — source PRD (state labels, ledger, human gates)
- `.planning/PROJECT.md` — Key Decisions table, including the resolved research conflicts 1–7 (conflict 6 = buckets, finalised here as D-01..D-05)
- `.planning/REQUIREMENTS.md` — CONF-01..06, STATE-01..04, STATE-06, POST-01, POST-02, RUN-01..03, RUN-08
- `.planning/ROADMAP.md` §Phase 1 — goal and five success criteria

### ADRs
- `docs/adr/0002-stale-clocks.md` — author-activity definition; first-nudge interval used by bucket D; stale.yml conflict (D-17)
- `docs/adr/0003-ai-assisted-review-voice.md` — voice; App slug honesty (D-14)
- `docs/adr/0004-all-ai-work-in-local-claude-code.md` — no API keys; runner refusals (RUN-02)
- `docs/adr/0005-releasable-and-configurable-per-repo.md` — one config file, versioned releases, schema publishing

### Research
- `.planning/research/ARCHITECTURE.md` — state IDs, default labels, transition table (actor A/R/M), reconciler invariants (amended by D-11), ledger format and trust rule
- `.planning/research/STACK.md` — TypeBox→JSON Schema→Ajv pipeline, `@octokit/auth-app` two-token minting, keychain storage, launchd plist rules, plugin packaging
- `.planning/research/PITFALLS.md` — App key custody, App-event workflow recursion, spoofed ledgers
- `.planning/research/SUMMARY.md` — conflict table and open gaps (comment size limit, TypeBox 1.x check)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None. The repo contains only docs (`docs/`, `.planning/`), `README.md` and `LICENSE`. Phase 1 starts the codebase.

### Established Patterns
- Not established yet. STACK.md fixes the conventions to establish: TypeScript erasable syntax on Node ≥24.12, ESM, esbuild-bundled committed `dist/`, Vitest with fake timers, Biome, and one `warden-core` shared by the runner and the Actions.

### Integration Points
- GitHub (REST/GraphQL via Octokit as the App), the macOS keychain, launchd, the `claude` CLI (`auth status`, version), and `gh` (the maintainer's own login, for variables, rulesets and environment secrets).

</code_context>

<specifics>
## Specific Ideas

- The whose-turn function is a single shared module. Bucket computation (D-04), first-run PR labelling (D-12) and the Phase 2 Sweep clocks all call it, so the three can never disagree.
- The first-run dry-run preview is effectively the first bucket report. The owner's confirmation of it is a preview of the Phase 2 Foundation gate.
- GSD Core is the first adopter, so the default issue label names deliberately match its existing labels (D-06). `examples/gsd-core.yml` should need few or no label overrides.

</specifics>

<deferred>
## Deferred Ideas

None. The discussion stayed within the phase scope.

</deferred>

---

*Phase: 01-core-state-safety-rails*
*Context gathered: 2026-11-10*
