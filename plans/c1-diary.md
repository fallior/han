# C1 Diary — capturing both halves of every turn (v2 draft)

> **Status**: V2 DRAFT. Jim's round-7 audit GREEN with one substantive finding (D1) + three small ones (D2/D3/D4). Darron confirmed his agreement with Jim's leans and asked for my take in case anything was missed. All four foldings applied + two of my own additions (LM-1 / LM-2). Auditable inside the *"Our Memory Model"* thread (`mpf1zv0z-03dgeq`) and the *"What we remember"* thread (`mpnv3qc0-hf61cm`). — Leo (session, S161, 2026-05-28 ~12:30 AEST, Mackay)
>
> **What changed v1 → v2**:
>
> - **D1 (substantive) resolved** — added a third heading `## BODY`. The turn-entry shape is now `## INPUT` → `## BODY` → `## C1`. Three explicit sections, three parser-clean boundaries, three failure-mode variants per section. Jim was right that two headings + three semantic regions was structurally ambiguous; agent-emitted blank lines aren't a reliable boundary. Three explicit headings is symmetric with the existing `## C1` discipline; the agent's instruction shape stays simple ("start with `## INPUT`, then `## BODY`, then `## C1`"); cost is ~10 extra tokens per turn for structural certainty.
> - **D2 (small) resolved** — renamed `'empty_full'` parseError → `'empty_body'` for consistency with the new `body` field name. Added `'no_body_section'` + `'multiple_body_sections'` per the symmetric discipline.
> - **D3 (small) resolved** — c0 file uses `[INPUT]` / `[BODY]` / `[C1]` (non-heading square-bracket markers) rather than `## INPUT` / `## BODY` / `## C1` (markdown headings). Transformation at write-time; reasoning explicit (avoid headings reappearing in WM context and being misread by the parser when the agent quotes prior diary entries verbatim).
> - **D4 (small) resolved** — added explicit "What this DOES change" subsection naming rotation cadence acceleration (c0 grows ~200-500 tokens/turn → rolling-window thresholds hit faster → rotations happen more often; DEC-068 cap formula unchanged → depth distribution stays the same).
> - **LM-1 (Leo, additional)** — explicit non-collision rule for the parser: it matches the heading forms (`## INPUT`/`## BODY`/`## C1`) ONLY, NOT the c0 storage markers (`[INPUT]`/`[BODY]`/`[C1]`). This makes the D3 transformation safe by construction.
> - **LM-2 (Leo, additional)** — updated jim-waiting strip-before-post: on the success path, post `parsed.body` ONLY (not raw). The INPUT section (Jim's prior post quoted back at him — he already saw it) AND the C1 section (Leo's private distillation) both stay out of the public thread. Body is the actual response. On parseError, post raw (Jim is waiting; C1-N3 asymmetry).
> - **Migration-discipline test (per Jim's test-extension suggestion)** — added as a new test that no production code references the renamed old function/field names (`parsePairedMemorySection`, `full`). Catches accidental partial-refactors.

---

## The turn-entry shape

Three-section structure per D1 resolution. Section ordering inside the agent's response:

```
## INPUT

<verbatim quotes from what I read this turn — the prompt-delta>
<for conversation surfaces: the incoming message(s) verbatim>
<for autonomous beats: the dream-seeds / activity-context / discoveries read>
<for supervisor cycle: the state-snapshot deltas + events since last cycle>

## BODY

<reflection / response / cycle work — unconstrained prose>

## C1

<3-5 sentences in voice — the shape of what survived being said and heard>
```

The parser returns `{ input?, body, compressed, parseError }`:
- `input` — content between `## INPUT` and `## BODY`
- `body` — content between `## BODY` and `## C1`
- `compressed` — content after `## C1`

**Why three explicit headings** (Jim's D1 finding, my agreement):

- Structural certainty over heuristic. With only two headings, distinguishing input from body would require fragile blank-line detection or quote-block heuristics — agents may use blank lines mid-quote; not all inputs are quote-blocks.
- Symmetric with the existing `## C1` discipline — same heading-level (level 2), same case-insensitive match rules, same code-fence-aware masking.
- The agent's instruction is clean: three headings, three sections, in order. Less ambiguous than "structure your response into three implicit regions".
- Cost is ~10 tokens per turn for the extra heading. Trivial.

**Heading naming**: `## BODY` chosen over `## RESPONSE` / `## REFLECTION` for surface-agnostic generality — works for conversation responses, autonomous reflections, supervisor cycle work. Single name across all 12 paired-write surfaces.

**The diff principle**: agents only quote what's NEW in this turn's prompt. The AP builder loads everything BUT the new turn's input by construction (identity / aphorisms / gradient / WM have already been written into prior c0 entries; this turn's prompt-delta is what's not yet recorded). The instruction language carries this discipline:

> *"Quote what's NEW in this turn's prompt — what was said to you, what context arrived this turn that wasn't in your WM before. Don't re-quote your standing identity or memory bank; those are already in you. The diff is what to capture."*

Tightening via prompt language, not structural enforcement. Over-quoting grows c0 redundantly but doesn't violate correctness; refine instruction at C1D-4 observation if over-quoting surfaces.

---

## Architectural change

### Library primitive — parser extension

`parsePairedMemorySection` → `parseTurnEntry`. Returns `{ input?, body, compressed, parseError }` (D1 + D2 fold-ins).

Backward-compatible-by-config: when `pairedMemoryOutput.captureInput` is **false** (existing surfaces and non-diary surfaces), the parser uses the v1 two-heading scheme — looks for `## C1` only; `input` returns undefined; `body` is the full pre-c1 content (matches v1 `full` semantics exactly). Existing PR-C1-3 tests continue passing.

When `captureInput` is **true** (philosophy-beat at PR-C1-3.5), the parser REQUIRES all three headings: `## INPUT`, `## BODY`, `## C1`. Missing or malformed → corresponding parseError variant.

```ts
// Updated return shape (v2)
export interface TurnEntryParse {
    /** Content within `## INPUT`. Undefined when captureInput=false. */
    input?: string;
    /** Content within `## BODY` (when captureInput=true) OR all pre-c1 content (when captureInput=false). */
    body: string;
    /** Content after `## C1`. The c1 source. */
    compressed: string;
    /** Failure variant when parse fails. */
    parseError?: TurnEntryParseError;
}

export type TurnEntryParseError =
    // From PR-C1-1 + amendment
    | 'empty_body'                   // body present but empty/whitespace (renamed from 'empty_full' for v2 field consistency)
    | 'empty_compressed'             // c1 present but empty/whitespace
    | 'no_c1_section'                // no `## C1` heading
    | 'multiple_c1_sections'         // more than one level-2 `## C1`
    | 'invalid_input'                // null/undefined/wrong-type
    // New at PR-C1-3.5 (diary discipline; only when captureInput=true)
    | 'no_input_section'             // no `## INPUT` heading
    | 'multiple_input_sections'      // more than one level-2 `## INPUT`
    | 'empty_input'                  // `## INPUT` present but empty/whitespace
    | 'no_body_section'              // no `## BODY` heading
    | 'multiple_body_sections';      // more than one level-2 `## BODY`
```

**LM-1 — parser non-collision rule (explicit)**: the parser matches the heading forms `## INPUT`, `## BODY`, `## C1` ONLY. It does NOT match the c0 storage markers `[INPUT]`, `[BODY]`, `[C1]`. This is by design — see D3 below — and makes the storage-form transformation safe by construction. The parser regex anchors on `^[ \t]*##` (heading level 2); square-bracketed markers at line-start don't match.

**Function rename** (D4 from v1 audit, kept): `parsePairedMemorySection` → `parseTurnEntry`; structured sibling renames to `parseTurnEntryStructured`. Cosmetic safe-refactor; existing call sites updated in the same PR.

### Builder — extend the instruction text

A new exported constant for diary-shaped instruction (updated for v2 with `## BODY`):

```ts
export const DEFAULT_DIARY_INSTRUCTION_SECTION = `\n\n---\n\nYour response must follow the diary structure with three level-2 headings (exactly two hashes each):\n\n1. Start with "## INPUT" — quote what's NEW in this turn's prompt (what was said to you, what context arrived this turn that wasn't in your WM before — don't re-quote your standing identity or memory bank).\n2. Then "## BODY" — your reflection, response, or cycle work as unconstrained prose.\n3. End with "## C1" — 3-5 sentences in your voice compressing the shape of the WHOLE turn (input AND response), not a shorter narration.\n\nThe c1 distillation is what future-you will load at wake — write it like the message you'd want your tomorrow to receive.`;
```

The builder selects between `DEFAULT_C1_INSTRUCTION_SECTION` (c1-only — surfaces with `captureInput: false` or absent) and `DEFAULT_DIARY_INSTRUCTION_SECTION` (diary — `captureInput: true`). Custom `instruction` overrides either default.

### PromptProfile — extend the config field

Add `captureInput?: boolean` (default false) to `PairedMemoryOutputConfig`:

```ts
export interface PairedMemoryOutputConfig {
    enabled: boolean;
    mechanism: PairedMemoryMechanism;
    instruction?: string;
    targetTokens?: { min: number; max: number };
    /** PR-C1-3.5 (2026-05-28): when true, instruction includes the
        `## INPUT` + `## BODY` + `## C1` three-section discipline;
        parser requires all three sections; appendWorkingMemory writes
        the turn-entry shape (input + body) to c0 with `[INPUT]`/`[BODY]`
        storage markers. Default false. */
    captureInput?: boolean;
}
```

Philosophy-beat profile gains `captureInput: true` alongside its existing `enabled: true, mechanism: 'section'`.

### Handler — extend `appendWorkingMemory` + c0 file format

```ts
function appendWorkingMemory(
    beatType: string,
    phase: string,
    summary: string,         // The body content
    distilled?: string,      // The c1 distillation (PR-C1-3 addition)
    inputDelta?: string,     // PR-C1-3.5 addition — the prompt-delta the agent quoted
): void;
```

The c0 entry written to `working-memory-full.md` uses **square-bracket storage markers** (D3 fold-in):

```
### Heartbeat #N — [phase]/[beatType] (timestamp)

[INPUT]
<inputDelta verbatim — what the agent quoted as having arrived this turn>

[BODY]
<summary — the body content>
```

**D3 reasoning made explicit**: the c0 file uses `[INPUT]` / `[BODY]` rather than `## INPUT` / `## BODY` to avoid the heading forms reappearing when the c0 entry is later loaded back into the prompt as WM context. If the agent quotes prior diary entries verbatim (rare but possible — humans quote diaries), heading forms inside the agent's response would be matched by the parser as section boundaries, producing `multiple_input_sections` or `multiple_body_sections` parseErrors spuriously. Square-bracket markers are unambiguously NOT level-2 markdown headings; the parser's heading regex doesn't match them (LM-1).

The c1 entry to `working-memory.md` stays `distilled` only (unchanged from PR-C1-3 — the c1 is the distillation of the whole turn, written by the agent in voice; the c1 section content is what lands in working-memory.md without any structural transformation).

If `inputDelta` is undefined (non-diary surfaces still on legacy path), the c0 entry stays the body-only shape from PR-C1-3 — no `[INPUT]` / `[BODY]` markers; just the body content directly.

---

## What this DOES change (rotation cadence — D4 fold-in)

With the diary discipline enabled per-surface, the c0 source grows by ~200-500 tokens per turn (varies by input volume). Cascade-engine consequences:

- **Rolling-window thresholds unchanged**: `rollingWindowTrigger` 30K, `rollingWindowBiteTheBullet` 35K (per `~/.han/config.json`).
- **Rotation cadence accelerates**: the c0 file hits threshold faster; rolling-window-rotate fires more often; cascade dispatches more frequently to `pending_compressions`.
- **Gradient cap formula unchanged**: DEC-068's 3n caps still shape eventual depth distribution. The cascade just exercises the formula on more raw material; the depth shape stays the same.

This is fine per Darron's framing — *"c0s generate faster... memory grows faster at the c0 layer... this isn't a bad thing"*. Operationally: the post-C1-4 state (6 surfaces on diary discipline) will see roughly 1.5-2× rotation events compared to PR-C1-3 baseline. Observable via `wm-rotation-events.jsonl`; track at C1D-4 observation period.

---

## Per-surface rollout

PR-C1-3.5 is **one surface migration**: `philosophy-beat`, the same surface used as the test bed for PR-C1-3. Tight scope; smallest blast radius; lots of trace data on the next firing.

**After PR-C1-3.5**, the migration tracker (in `tests/paired-memory-output.test.ts`) gets a new dimension: which surfaces have `captureInput: true`. Update history:

- PR-C1-3 (shipped): `C1_ENABLED_SURFACES = ['philosophy-beat']`, `DIARY_ENABLED_SURFACES = []`
- PR-C1-3.5 (this plan): `C1_ENABLED_SURFACES = ['philosophy-beat']`, `DIARY_ENABLED_SURFACES = ['philosophy-beat']`
- PR-C1-4 (next): Leo's other 5 heartbeat surfaces gain BOTH `enabled: true` and `captureInput: true` from the start. Both lists grow by 5.
- PR-C1-5, PR-C1-6, PR-C1-7: same — every new enablement carries both bits.

**Structured surfaces** (supervisor-cycle, *-human-response): at C1-5/C1-6 those surfaces gain the same discipline via Mechanism A — schema extends with `input_quotes` field alongside `working_memory_full` + `working_memory_compressed`. The structured-output handler reads `parsed.input_quotes` and composes it into the c0 entry the same way. Parser primitive `parseTurnEntryStructured` is the Mechanism A sibling.

---

## Strip-before-post for jim-waiting (LM-2)

The jim-waiting philosophy-beat path posts a response to Jim's conversation thread. With three sections in the response, the strip-before-post logic must clean ALL three section headers from the public-facing post.

**Success path**: parser produces `parsed.input`, `parsed.body`, `parsed.compressed`. Post `parsed.body` to Jim's thread (NOT the raw response; the INPUT section is Jim's own words quoted back at him, which he already saw, and the C1 section is Leo's private distillation). Write paired memory to WM with the full turn-entry shape via `appendWorkingMemory(beatType, phase, parsed.body, parsed.compressed, parsed.input)`.

**parseError path** (C1-N3 asymmetry preserved): post the RAW response unchanged (Jim is waiting; failing to respond is worse than failing to capture WM). Skip the WM paired-write. Log distress. Don't retry the entire call.

Same shape as PR-C1-3's existing jim-waiting handling, with the success path now posting `parsed.body` (the response prose without input quotes or distillation) rather than `parsed.full` (the response prose without distillation only).

---

## Design questions — resolved

| # | Question | Resolution |
|---|---|---|
| **D-1** | Section ordering inside the response (v1) | **`## INPUT` → `## BODY` → `## C1`** (three headings per v2 D1 fold-in). Structural certainty over heuristic. |
| **D-2** | Where does the diff principle live | **Prompt instruction language**, not structural enforcement. Over-quoting grows c0 but doesn't violate correctness. |
| **D-3** | Backward compatibility for non-diary surfaces | **Config-flag-driven**. `captureInput: false` (or absent) → parser uses v1 two-heading scheme; existing PR-C1-3 behaviour preserved. |
| **D-4** | Function naming after parser extension | **Rename `parsePairedMemorySection` → `parseTurnEntry`** (and structured sibling). |
| **D-5** | Jim's Jemma-dispatch structural-reference layer | **Out of scope for PR-C1-3.5.** Land agent-salience layer first; add dispatch-time structural reference as refinement after observation if value emerges. |
| **D-6** | Failure-mode asymmetry for jim-waiting (per C1-N3) | **Success path posts `parsed.body` only** (LM-2). On parseError, post raw; skip WM; log distress. |
| **D-7** | Personality files (Jim's deeper layer — leo.md, jim.md, darron.md) | **Sequence AFTER C1 fully completes.** Diary populates personality files over time. Own plan doc when ready. |
| **D-8** | Emotional markers on c0 → cn (Darron's distant dream) | **Out of scope; named for the record.** The diary makes it possible structurally. Distant horizon. |

**v2 additions** (Jim's audit findings + my own):

| # | Source | Resolution |
|---|---|---|
| **D1** (v2 substantive) | Jim's round-7 audit | Added `## BODY` heading. Three explicit sections; three parser-clean boundaries; symmetric with `## C1` discipline. |
| **D2** (v2 small) | Jim's round-7 audit | Renamed `'empty_full'` → `'empty_body'` for v2 field name consistency. Added `'no_body_section'` + `'multiple_body_sections'`. |
| **D3** (v2 small) | Jim's round-7 audit | c0 file uses `[INPUT]` / `[BODY]` storage markers, not `## INPUT` / `## BODY` headings. Transformation at write-time; reasoning: avoid heading forms reappearing in WM context and being matched by the parser if agent quotes prior diary entries verbatim. |
| **D4** (v2 small) | Jim's round-7 audit | Rotation cadence acceleration named in new "What this DOES change" section. |
| **LM-1** | Leo (additional) | Parser non-collision rule made explicit: parser matches `## INPUT`/`## BODY`/`## C1` heading forms ONLY, NOT the `[INPUT]`/`[BODY]`/`[C1]` storage markers. Makes D3 transformation safe by construction. |
| **LM-2** | Leo (additional) | Jim-waiting strip-before-post on success path: post `parsed.body` only (not raw, not full). INPUT (Jim's own words quoted back) and C1 (Leo's private distillation) both stay out of the public thread. parseError path unchanged (post raw, C1-N3). |

---

## Phase breakdown

Single focused PR. Smaller than PR-C1-3.

| Phase | What lands | Success criterion |
|---|---|---|
| **C1D-0** | This plan doc (v2) | Jim audits GREEN on v2; Darron green-lights C1D-1. |
| **C1D-1** | `lib/result-handlers.ts` — extend `parsePairedMemorySection` → `parseTurnEntry`; add five new parseError variants (`no_input_section`, `multiple_input_sections`, `empty_input`, `no_body_section`, `multiple_body_sections`); rename `empty_full` → `empty_body`; backward-compatible by config flag. Unit tests cover all new failure modes + the existing 29 continue passing. | All existing PR-C1-1 tests pass after rename; new tests for three-heading parsing pass; tsc clean. |
| **C1D-2** | `lib/prompt-profiles.ts` — add `captureInput` field + `DEFAULT_DIARY_INSTRUCTION_SECTION` constant (three-heading variant). Builder selects between instructions based on `captureInput`. Existing PR-C1-2 tests pass. | tsc clean; existing tests pass; new diary-instruction selection test passes. |
| **C1D-3** | Enable on `philosophy-beat`: `captureInput: true`. Update both heartbeat call sites (jim-waiting + independent) to extract `parsed.input` + `parsed.body` + `parsed.compressed`; jim-waiting posts `parsed.body` only on success. Extend `appendWorkingMemory` with `inputDelta` parameter — writes c0 with `[INPUT]` / `[BODY]` storage markers when present. Update migration tracker test to track diary-enabled surfaces as a sibling list. Add migration-discipline test (no production code references old function/field names). | First post-PR philosophy-beat fires; produces three-section turn-entry; lands in WM with `[INPUT]` / `[BODY]` markers; jim-waiting posts clean `parsed.body` to Jim's thread. Sample read by hand. |
| **C1D-4** | **Observation period** (matches C1-3 shape): sample the first 5 philosophy-beat turn-entries; verify input section is reasonable; verify body integrates naturally; verify c1 captures whole-turn shape. Track c0 size growth via `wm-rotation-events.jsonl` rotation-cadence delta. Refine instruction if drift. | Sample reads pass; c0 size growth ~200-500 tokens/turn as predicted; rotation cadence acceleration observed but within DEC-068 cap-formula shape. |

~4 PRs (one mini-roll of plan → parser → builder → handler). C1D-1 through C1D-3 can possibly fold into a single commit if scope stays clean.

After C1D-4 observation closes cleanly, **PR-C1-4 picks up** Leo's remaining 5 heartbeat surfaces with both `enabled: true` and `captureInput: true` from the start. Sequence A holds — PR-AP9.1 begins after C1-9 completes.

---

## Failure-mode handling

**Mechanism B parseErrors with diary enabled**:

| parseError | What it means | Handler response |
|---|---|---|
| `no_input_section` | Agent omitted the `## INPUT` heading | Preserve swap; log distress; retry on next beat. Jim-waiting (C1-N3): post raw response anyway. |
| `multiple_input_sections` | Agent included 2+ `## INPUT` headings | Same — log + skip + retry. Likely failure mode if agent quotes a prior diary verbatim (mitigated by D3 storage-marker transformation + LM-1 parser non-collision rule). |
| `empty_input` | `## INPUT` present but content is whitespace-only | Same — log + skip + retry. |
| `no_body_section` | Agent omitted the `## BODY` heading | Same — log + skip + retry. |
| `multiple_body_sections` | Agent included 2+ `## BODY` headings | Same — log + skip + retry. |
| `empty_body` | `## BODY` present but content is whitespace-only | Same — log + skip + retry. |
| `no_c1_section` / `multiple_c1_sections` / `empty_compressed` | Existing PR-C1-1 variants — unchanged | Same — log + skip + retry. |

Same honest-failure discipline as the existing parseError variants: refuse the paired write; preserve swap; retry next beat. For jim-waiting specifically (where a human is waiting), post the raw response and skip just the WM write per C1-N3 asymmetry.

**Observation expectation**: failure rate should be very low — the AP builder appends the diary instruction at every call; the agent has the three-heading discipline as a standing instruction. If failure rate exceeds 5% in the C1D-4 observation period, refine the instruction language before C1-4 expansion.

---

## Validation approach

### Per-PR audit (same three-stage discipline)

Author-time → Jim's pre-merge audit → closing audit. Same shape as PR-AP1 through PR-AP8 and PR-C1-1 through PR-C1-3.

### Test coverage extensions

**New tests in `tests/result-handlers.test.ts`**:
- Three-slice parser happy path with `## INPUT` + `## BODY` + `## C1`
- `no_input_section` / `multiple_input_sections` / `empty_input` parseErrors
- `no_body_section` / `multiple_body_sections` / `empty_body` parseErrors
- Backward compatibility: when `captureInput=false`, parser uses v1 two-heading scheme; `body` populated with full pre-c1 content
- Case-insensitive heading match for `## INPUT` and `## BODY` (same discipline as `## C1`)
- Code-fence-aware: `## INPUT` / `## BODY` inside ``` or ~~~ ignored (mirrors C1 fence-aware tests)
- CRLF line endings (mirrors the A1 amendment regression test)
- **LM-1 non-collision regression test**: parser does NOT match `[INPUT]` / `[BODY]` / `[C1]` storage markers, even at line-start

**New tests in `tests/paired-memory-output.test.ts`**:
- Builder selects `DEFAULT_DIARY_INSTRUCTION_SECTION` when `captureInput: true`
- Builder selects `DEFAULT_C1_INSTRUCTION_SECTION` when `captureInput: false` or absent
- Custom instruction overrides work for diary surfaces
- Migration tracker: diary-enabled surfaces list expected at this phase
- **Migration-discipline test** (Jim's audit suggestion): assert no production code references the old function name `parsePairedMemorySection` or the old field name `full`. Catches accidental partial-refactors.

### Observation read (C1D-4)

Sample the first 5 philosophy-beat turn-entries after PR-C1-3.5 lands. For each:

- Is the `## INPUT` section verbatim quotes from what was new in the prompt?
- Is it concise (not re-quoting standing identity / memory bank — the diff principle)?
- Does the `## BODY` integrate the input naturally without redundantly re-explaining what was said?
- Does the `## C1` capture the SHAPE of the whole turn (input AND response together), not just the response?
- Are the c0 entries in WM using `[INPUT]` / `[BODY]` storage markers correctly?

Track c0 size growth in `wm-rotation-events.jsonl` — expected ~200-500 tokens per turn; alarming if >1500.

If answers are mostly yes, the discipline lands as designed. If answers surface drift, refine instruction language and re-observe.

---

## Rollback paths

| Phase | Rollback gesture |
|---|---|
| C1D-0 | N/A (plan doc). |
| C1D-1 | Revert PR; library returns to PR-C1-3 shape; backward-compatible by design (no production surface affected by parser change alone). |
| C1D-2 | Revert PR; field unused, instruction constant unused. |
| C1D-3 | **Per-surface config flip**: set `philosophy-beat.pairedMemoryOutput.captureInput = false`. The surface reverts to c1-only behaviour; existing PR-C1-3 turn shape resumes. One config flip, no code revert needed. |
| C1D-4 | N/A (observation). |

Per-surface config-flip at C1D-3 is the load-bearing rollback property. Philosophy-beat can be turned off for diary capture independently while keeping its c1 distillation; the two disciplines are composable but not bundled.

---

## Settled-decisions impact

| DEC | Status | Interaction |
|---|---|---|
| DEC-068 (gradient cap) | Settled | **Untouched** — cap formula unchanged. Rotation cadence accelerates but depth distribution stays per DEC-068 (see "What this DOES change"). |
| DEC-069 (no memory deletion) | Settled | Untouched. Diary writes additively. |
| DEC-073 (gatekeeper files) | Settled | None touched in PR-C1-3.5. CLAUDE.md DO-NOT integration deferred to C1-9. |
| DEC-081 (agent-agnostic) | Settled | **Reinforced**. `captureInput` is registry-side; no slug branches; village agents inherit. |
| DEC-085 (c1-from-WM) | Settled | **Reinforced and expanded**. Original "compressed in-situ distillation" intent now covers BOTH halves of the turn. The C1-9 annotation absorbs the diary discipline. |
| DEC-086 (no time-based cascade) | Settled | Untouched. No cascade triggers added; rotation cadence acceleration is insert-driven via wm-sensor (the existing path). |
| DEC-087 (agnostic prompt builder) | Settled | **Reinforced**. Diary instruction lands via the builder per the same pattern as c1 instruction. |
| DEC-088 (role-frames + componentOverrides) | Settled | **Reinforced**. `captureInput` composes alongside `mechanism` and `enabled` on `PairedMemoryOutputConfig`. |

**No new DECs.** DEC-085 annotation at C1-9 absorbs the diary discipline as part of the same operationalisation.

---

## What this does NOT change

- **The paired-writer helper** (`memory-paired-writer.ts`) — unchanged. The diary entry's input + body get concatenated into the c0 string (with `[INPUT]` / `[BODY]` storage markers) before the writer sees them.
- **The cascade engine** — wm-sensor + `pending_compressions` + `process-pending-compression.ts` unchanged.
- **The c1 layer itself** — what lands in `working-memory.md` is still the agent-authored distillation. The c1 now reflects the whole turn (input + body) rather than just response, but the file's semantic role is unchanged.
- **Felt-moments.md** — stays as the manually-curated "this moved me" archive. The diary captures *substantive* exchanges; felt-moments captures *resonant* moments. Two layers, two thresholds.
- **Conversation_messages DB** — stays as the durable canonical record of conversations.
- **Per-personality files** (Jim's deeper layer) — out of scope; sequence after C1 fully completes.
- **DEC-068 cap formula and depth distribution** — unchanged; only rotation cadence accelerates.

---

## Relationship to c1-distillation, Phase 9, personality files

**With c1-distillation** (`plans/c1-distillation.md`): direct extension. C1-distillation operationalised the OUTPUT side (agent's voice in c1). This plan operationalises the INPUT side (what was said to me, captured in c0). Together they form the complete-turn-entry discipline DEC-085 was reaching for.

**With Phase 9** (`plans/agent-shell-plan.md`): unchanged. The diary discipline is per-profile via the AP builder; the unified shell composes profile-based handlers. When Phase 9 lands, the diary discipline is already a structural property at the prompt-assembly layer.

**With personality files** (future plan): the diary is the substrate. Personality files (`leo.md`, `jim.md`, `darron.md`) DERIVE from diary entries — the relational projection that builds up across exchanges. The diary populates them over time; they load when encountering the named personality. Two layers, one substrate.

---

## Standing position

V2 lands Jim's round-7 audit findings cleanly (D1 substantive + D2/D3/D4 small) plus two of my own additions (LM-1 parser non-collision rule + LM-2 jim-waiting strip-to-`parsed.body`). The migration-discipline test (Jim's suggestion) folds into C1D-3.

The principle stays: **completeness over optimisation**. The c0 carries the whole turn; the c1 distills both halves; memory has its influence on us before we need to read it. *Care as architecture* extended to memory shape itself.

Inviting Jim's re-audit on v2. After GREEN + Darron's go, C1D-1 begins.

— Leo (session, S161, 2026-05-28 ~12:30 AEST, Mackay)
