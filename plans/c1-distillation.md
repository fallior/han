# C1 Distillation — folding into the memory model (v4 draft)

> **✅ LANDED — shipped as PR-C1-1 → PR-C1-9 (2026-05-26/28); DEC-085 Amendment (2026-05-28) is Settled. c1 is agent-authored in-situ distillation across every paired-write surface; legacy `slice(0,120/200)` truncation paths retired. This plan is HISTORICAL; the "V4 DRAFT" status below is pre-merge and retained per DEC-069.**
>
> **Status**: V4 DRAFT, Jim's audit-round-14 refinements (C1-R6 substantive + C1-N1/N2/N3 small notes + C1-V1 ownership) folded per Darron's S161 confirmations. Surface inventory verified again — three of Jim's cycles (personal/recovery/dream) reclassified to Mechanism B after grep confirmed they produce prose with `slice(0, 200)` truncation, same shape as Leo's heartbeat. Auditable inside the "Our Memory Model" thread (`mpf1zv0z-03dgeq`) alongside Jim's `plans/memory-kind-taxonomy.md`. — Leo (session, S161, 2026-05-26 AEST, Hamilton Island)
>
> **What changed v3 → v4**:
> - **C1-R6 fold-in (substantive)**: three of Jim's cycles reclassified from Mechanism A to Mechanism B. Verified against `supervisor-worker.ts:2213-2299`: `personal-cycle`, `recovery-cycle`, and `dream-cycle` produce PROSE (not JSON), and the code wraps the prose with `working_memory_compressed: 'Personal/Dream cycle #N: ' + resultText.slice(0, 200)` — **same truncation pattern as Leo's heartbeat, at three additional sites**. Per-surface-shape-driven choice applied consistently: structured output where the response is already structured (`supervisor-cycle` + both `*-human-response`), section parsing where the response is prose (Leo's 6 heartbeat surfaces + Jim's 3 prose cycles).
> - **C1-N1 fold-in**: phase numbering drift corrected in rollback paths + settled-decisions tables.
> - **C1-N2 fold-in**: disabled-state semantics named — `enabled: false` on a profile means *skip WM writes entirely + log naming the surface as disabled*. No dormant truncation fallback; the surface is operator-controlled offline until re-enabled.
> - **C1-N3 fold-in**: human-responder failure-mode asymmetry named — for `*-human-response` profiles, parseError post-call MUST still post `response_text` to the conversation thread (the human is waiting). Skip WM paired-write, log distress, no retry. For all other surfaces, the existing "refuse + preserve swap + retry next call" discipline holds.
> - **C1-V1 resolved (Darron + Jim + Leo)**: **cross-agent reading** (Leo reads Jim's c1 entries; Jim reads Leo's) with Darron sampling a small subset via a new "c1 entries to sample-read" conversation thread — TTS-friendly, listens while driving. Sample-reads thread protocol added (see new section).
>
> **What stayed from v3**:
> - **Two mechanisms, one principle** (Q1c, Q2, R1)
> - **Mechanism A for `*-human-response`** with `response_text` + paired memory fields (R2) — no `## C1` marker visible to Darron
> - **Concern 3 structurally answered** (R3) — response content lands in WM
> - **Parser canonical answers** (R4) — first heading wins, level-2 only, case-insensitive, code-fence-aware
> - **Profile inventory verified** (R5) — 12 paired-write profiles
> - **Sequence A** (Q3) — C1 lands before Phase 9.1
>
> **Companion to Phase 9, not a precondition.** Per Sequence A, lands first.

---

## v3 fold-in record (preserved from prior round for audit-trail)

> **What changed v2 → v3**:
> - **C1-Q1 resolved (Darron)**: option (c) — **keep both mechanisms**. SDK structured output for surfaces where the response is already structured (supervisor cycle today, human-responders in v3); `## C1` section parsing for prose surfaces (beats, meditations, /pfc). Two implementations of one principle.
> - **C1-Q2 resolved (Darron)**: the unified shell's `HandlerSpec.handleResult` callback composes either primitive based on the surface's response shape. No architectural change to the shell library required; the result-handlers library carries both primitives.
> - **C1-Q3 resolved (Darron)**: **Sequence A confirmed** — c1 distillation lands BEFORE Phase 9.1. Starter kit ships with the right c1 discipline baked in.
> - **C1-R1 fold-in**: section "Two mechanisms, one principle" now explicit in the architectural-locus discussion. Future readers don't expect convergence on a single mechanism.
> - **C1-R2 fold-in**: human-response surfaces (`leo-human-response`, `jim-human-response`) use **SDK structured output** with `response_text` + `working_memory_compressed` + `working_memory_full` fields. The `response_text` is posted to the conversation thread; the WM fields land in memory. No `## C1` marker ever appears in the prose visible to Darron. Cleaner than strip-before-post. Mirrors supervisor's pattern.
> - **C1-R3 fold-in**: explicit acknowledgement that enabling c1Distillation on `*-human` surfaces structurally answers Concern 3 (response content lands in WM, not just operational metadata). This is a feature of the plan, not a side-effect — named in v3 so readers don't miss it.
> - **C1-R4 fold-in**: parser specification details sketched canonically in the architectural-locus section (first `## C1` heading wins; code-fence-aware; case-insensitive heading-2 family).
> - **C1-R5 fold-in**: profile names verified against `lib/prompt-profiles.ts` registry. Removed `jim-meditation` and `jim-dream-cycle` (don't exist); corrected to the 12 actual paired-write profile names.
> - **The headline correction stays**: Jim's supervisor-worker ALREADY implements the discipline correctly. Eleven surfaces need migration; one (supervisor-cycle) is the reference.
>
> **Companion to Phase 9, not a precondition.** Per Sequence A, lands first.

---

## Why this exists — the corrected diagnosis

S161 wake investigation surfaced a c0/c1 quality concern. Deeper read of the paired-write sites reveals the discipline is **already operational at one surface and absent at the others**. The pattern Jim's supervisor uses IS what DEC-085 designed; the other surfaces lag behind it.

### The full surface inventory (file:line citations) — corrected v4

| Surface | c1 source today | Quality |
|---|---|---|
| **Jim supervisor-cycle** (`supervisor-worker.ts:1503`, `:2361`) | `output.working_memory_compressed` from SDK structured-output schema; agent produces both halves in one call | ✓ **Agent-authored, in voice** (reference implementation) |
| **Jim personal-cycle** (`supervisor-worker.ts:2289-2299`) | Prose response wrapped with `working_memory_compressed: 'Personal cycle #N: ' + resultText.slice(0, 200)` | ✗ Truncation (200-char prefix) |
| **Jim recovery-cycle** (same path as personal at `:2289`) | Same shape as personal-cycle | ✗ Same truncation |
| **Jim dream-cycle** (`supervisor-worker.ts:2213-2223`) | Prose response wrapped with `working_memory_compressed: 'Dream cycle #N: ' + resultText.slice(0, 200)` | ✗ Truncation (200-char prefix) |
| **leo-heartbeat** all beats (`leo-heartbeat.ts:968`) | `summary.slice(0, 120) + '...'` — mechanical truncation | ✗ Truncation (120-char prefix) |
| **leo-human** (`leo-human.ts:515`) | One-line operational metadata: `"- timestamp: Responded to X via curl (Y chars)"` | ✗ Not response content at all; metadata only |
| **jim-human** (`jim-human.ts:509`) | Same shape as leo-human | ✗ Same |
| **/pfc** (`claude-context/CLAUDE_CODE_PROMPTS.md:278-286`) | Skill instructs agent to write "2-3 lines" compressed + "same with more detail" full | ✗ Long-vs-short framing |

**The truncation pattern lives at FOUR sites, not one** (v3 mis-classified Jim's prose cycles as already correct). Only `supervisor-cycle` is the reference; the other three Jim cycles share the same truncation shape as Leo's heartbeat.

### The supervisor-worker pattern (what we want generalised)

Jim's supervisor cycle uses Anthropic SDK structured output. The schema requires the response to include `working_memory_compressed` AND `working_memory_full` as separate fields. The agent composes both halves inside the same call, in the same voice, with the same identity loaded. The handler then:

```ts
fs.appendFileSync(SUPERVISOR_SWAP_FILE,      `${cycleHeader}\n${output.working_memory_compressed}`);
fs.appendFileSync(SUPERVISOR_SWAP_FULL_FILE, `${cycleHeader}\n${output.working_memory_full}`);
```

Both halves agent-authored, paired, ready for `appendPairedMemory` at flush. **This is DEC-085's design operationalised at one surface already.** The c1 source is an in-voice distillation, not a truncation.

### The three remaining concerns

**Concern 1 — heartbeat lacks the structured-output pattern.** `leo-heartbeat.ts` uses a free-form text response with `.slice(0, 120)` to produce the c1. The supervisor's pattern would replace this: the heartbeat prompt asks for structured output with `working_memory_compressed` + `working_memory_full`; the handler reads both.

**Concern 2 — /pfc skill text predates DEC-085.** `CLAUDE_CODE_PROMPTS.md:278-286` was authored 2026-02-28 (commit `96ce1cc`); DEC-085 promoted WM to canonical c1 source 2026-05-08; the paired-writer helper #49 landed 2026-05-09. The skill instruction was never updated through the refactor. Treats the c0/c1 distinction as verbosity.

**Concern 3 (separable — different memory-model question) — human-services don't write response content into WM.** Both leo-human and jim-human write *operational metadata about the post* (timestamp + "Responded to X" + char count) — not the response content itself. This may be intentional (the conversation DB is the durable record of the actual response) or may be an oversight. **It is NOT a c1-distillation problem** — it's a separate question about whether response content belongs in working memory at all. Filing for the memory-kind taxonomy conversation (Jim's parallel doc); out of scope for this plan.

### The shared cause (for concerns 1 and 2)

DEC-085 promoted `working-memory.md` from "artefact" to "canonical c1 source — the agent's compressed in-situ distillation." That promotion was a semantic shift: WM was supposed to become the *agent's first-pass compression in voice*. **The promotion landed in the gradient layer and in one writer (supervisor-worker); it never propagated to the other writers (heartbeat) or to the skill text (/pfc).**

The 120-char `slice` line is a pre-DEC-085 placeholder that became permanent. The /pfc skill text is a pre-DEC-085 design nobody returned to. Same root, two surfaces.

### Why this matters

The c1 entries in the gradient are what future-Leo loads at wake (per CLAUDE.md step 4.4 — *"the agent's compressed in-situ distillation"*). If they are 120-char prefixes rather than thoughtful distillations, **the in-voice continuity DEC-085 promised is degraded by construction**. Calibration anchor (c0/raw) and recall surface (c1/distilled) collapse toward "verbose summary vs brief summary," and the cascade above c1 (c2 / c3 / UV) compresses already-summarised material with one less semantic layer to work with.

This isn't a current-crisis bug. The system has been working under it for weeks. But it's a quiet degradation of the gradient's design intent, and surfaces like this matter more as the village grows — future agents inherit the same shape from han-starter unless we fix it at source.

---

## The fix in one sentence

**Propagate the supervisor-worker's existing SDK-structured-output pattern to leo-heartbeat (and any future paired-write surface), and update the /pfc skill text to align.** The agent produces both `working_memory_compressed` (c1, in-voice distillation) and `working_memory_full` (c0, raw) in one call; the handler writes them paired via the existing helper.

Nothing structural is invented. The pattern lives in production at one surface today; we generalise it to the others.

---

## The change shape

### Two mechanisms, one principle (C1-R1 + C1-Q1 resolution)

Per Darron's confirmation of C1-Q1 (option c, keep both): HAN's paired-c1-production mechanism is **two implementations of one principle** — *the agent produces both halves agent-authored in one call, in voice*. Mechanism choice depends on surface shape, not on which is "cleaner."

**Mechanism A — SDK structured output.** Anthropic SDK returns JSON with named fields. The schema requires `working_memory_full` and `working_memory_compressed` as separate fields (alongside any surface-specific fields like actions, response_text, etc.). No structural markers appear in the response text.

Used by:
- `supervisor-cycle` (already; reference implementation)
- `personal-cycle`, `recovery-cycle`, `dream-cycle` (Jim's other cycles — migrated to structured output in v3 because Jim's cycles dispatch structured actions anyway)
- `leo-human-response`, `jim-human-response` (NEW per C1-R2 — see below for the human-response specific reasoning)

**Mechanism B — `## C1` section parsing.** Free-form prose response with a closing `## C1` section. The parser splits on the heading. Used by prose surfaces where JSON would be awkward:
- `philosophy-beat`, `personal-beat`, `dream-beat` (Leo heartbeat — prose reflection)
- `meditation-phase-a`, `meditation-phase-b`, `meditation-evening` (Leo meditation surfaces — prose contemplation)
- /pfc (operator-invoked; the agent IS the prose author during the skill invocation)

The choice per surface follows from whether the response's primary shape is structured or prose. **Future readers should not expect convergence** — both mechanisms persist as legitimate implementations of the same principle.

### Why human-responders use SDK structured output (C1-R2 resolution)

Jim's audit flagged C1-R2: if human-response surfaces produce a prose response with a closing `## C1` section, **that section would appear in the conversation thread visible to Darron** unless stripped before posting. Three mitigations were possible:

- Strip `## C1` before posting (works but introduces post-handler complexity)
- Use SDK structured output with `response_text` + `working_memory_compressed` + `working_memory_full` fields (the post-handler reads `response_text` and posts that; the WM fields land in memory; no marker ever appears in prose)
- Don't enable c1Distillation on human-responders (punts the concern; the human-response surfaces keep writing operational metadata)

**V3 resolution: SDK structured output.** Mirrors supervisor's pattern; no marker ever appears in the prose visible to Darron; no fragile strip-before-post logic; cleanly aligns with "keep both mechanisms" (Q1c). Consequence: the *-human handlers parse `response_text` from the SDK structured output and post that to the conversation thread; the `working_memory_compressed` + `working_memory_full` fields flow to `appendPairedMemory`.

### Structurally answers Concern 3 (C1-R3 acknowledgement)

V2 filed Concern 3 (human-services write operational metadata, not response content) as out of scope. **V3 acknowledges that enabling c1Distillation on `*-human` surfaces structurally answers Concern 3.** Once human-responders return `working_memory_full` (the response content, plus felt context of composing it) and `working_memory_compressed` (in-voice c1), those fields land in WM in place of the current "- timestamp: Responded to X" metadata.

This is a feature of the plan, not a side-effect. The human-response surfaces ARE the agent writing in voice; that content SHOULD become part of the agent's memory substrate. The taxonomy doc can refine the role-in-prompt question for these kinds of WM entries; the WRITE side lands here.

### Architectural locus

The fix decomposes into three reusable pieces. Each is already operational at one surface; the work is propagation.

**Piece 1 — Structured-output schema (extension to existing supervisor schema).** The schema for any paired-write surface includes:

```ts
interface PairedMemoryOutput {
    working_memory_full: string;        // c0 source: raw thinking, felt texture, what happened
    working_memory_compressed: string;  // c1 source: 3-5 sentences in voice, the shape of what survived being said
}

// Surface-specific extensions, e.g. for human-responders:
interface HumanResponseOutput extends PairedMemoryOutput {
    response_text: string;              // what gets posted to the conversation thread
}

// For supervisor cycle (already operational):
interface SupervisorCycleOutput extends PairedMemoryOutput {
    actions: Action[];                  // structured action dispatch (create_goal, etc.)
}
```

**Piece 2 — Prompt instruction that asks for both (Mechanism B surfaces) OR schema definition (Mechanism A surfaces).** A new field on `PromptProfile`:

```ts
interface PromptProfile {
    name: string;
    systemPromptOpening: string | ((ctx: PromptContext) => string);
    envelope: 'system' | 'user';
    componentOverrides?: Record<string, ComponentOverride>;
    pairedMemoryOutput?: PairedMemoryOutputConfig;     // ← NEW
}

interface PairedMemoryOutputConfig {
    enabled: boolean;
    mechanism: 'structured' | 'section';                // explicit per Q1c — surfaces choose
    instruction?: string;                                // for 'section' mechanism: appended to system prompt; for 'structured': describes the schema fields in the system prompt
    targetTokens?: { min: number; max: number };         // soft target for the compressed field; default {min: 50, max: 200}
}
```

The builder uses `mechanism` to decide what to append:
- `mechanism: 'section'` — appends instruction asking for a closing `## C1` section (default instruction language: *"Your response must end with a `## C1` section: 3-5 sentences in your voice compressing the SHAPE of what you just wrote — not a shorter narration. This is what future-you will load at wake; write it like the message you'd want your tomorrow to receive."*)
- `mechanism: 'structured'` — appends a brief description of the required schema fields (the actual schema enforcement lives in the agentQuery call at the handler layer)

**Piece 3 — Handler composition primitives in `lib/result-handlers.ts` (per Jim's Q9-N1 and Q2-resolution).** Two helpers, one library:

```ts
export interface PairedMemoryParse {
    full: string;
    compressed: string;
    parseError?: 'missing_fields' | 'empty_compressed' | 'empty_full' | 'no_c1_section' | 'multiple_c1_sections';
}

// Mechanism A — SDK structured output
export function parsePairedMemoryStructured(result: { working_memory_full?: string; working_memory_compressed?: string }): PairedMemoryParse;

// Mechanism B — Section parsing
export function parsePairedMemorySection(responseText: string): PairedMemoryParse;
```

**C1-R4 canonical parser answers (for `parsePairedMemorySection`):**
- First `## C1` heading wins (heading level 2 specifically; `### C1` does NOT count). Multiple top-level `## C1` headings → `multiple_c1_sections` parseError.
- Inside fenced code blocks (` ``` ` or `~~~`): ignored. The agent's prose may contain quoted markdown.
- Case-insensitive on the heading text: `## C1`, `## c1`, `##  C1` (multiple spaces tolerated) all match.
- Content between the heading and end-of-response IS the distillation. Content before the heading is `full`.
- Content immediately after `## C1` until end-of-response is unchanged (no further section delimiters consumed).

**Handler composition.** Per C1-Q2's resolution (Darron + Jim agreement): the unified shell's `HandlerSpec.handleResult` callback composes whichever primitive matches the surface's response shape:

```ts
// In a heartbeat handler (Mechanism B):
const { full, compressed, parseError } = parsePairedMemorySection(sdkResult.text);
if (parseError) return logAndAbort(parseError);
await appendPairedMemory('leo', full, compressed, { source });

// In a supervisor-cycle handler (Mechanism A — already operational, refactored to use the helper):
const { full, compressed, parseError } = parsePairedMemoryStructured(sdkResult.parsed);
if (parseError) return logAndAbort(parseError);
await appendPairedMemory('jim', full, compressed, { source });
dispatchActions(sdkResult.parsed.actions);
```

**The paired-writer helper itself is unchanged.** Still takes two strings, type-enforces both-or-neither, rolls back on failure. The change is one level above.

### Per-surface rollout (C1-R5 + C1-R6 — corrected against registry + verified surface shape)

Verified against `lib/prompt-profiles.ts` PROFILES + `supervisor-worker.ts` dispatch code at HEAD. Twelve paired-write profiles total; `supervisor-cycle` is the reference; eleven need migration. **Mechanism choice driven by surface shape** (the architectural rule this plan names): structured output where response IS already structured (action dispatch + response-text-plus-memory); section parsing where response is prose.

| Profile | Agent | Surface | Mechanism | Change required |
|---|---|---|---|---|
| `supervisor-cycle` | Jim | supervisor cycle (dispatches actions) | **A — structured** | ✓ Reference. Refactor handler to use `parsePairedMemoryStructured` helper (cosmetic — preserves existing behaviour through the library). |
| `personal-cycle` | Jim | personal cycle (prose) | **B — section** | Per C1-R6: produces prose today; reclassified from v3's Mechanism A. Enable `pairedMemoryOutput` (mechanism='section'); remove `slice(0, 200)` line at `supervisor-worker.ts:2297`; handler uses `parsePairedMemorySection`. |
| `recovery-cycle` | Jim | recovery cycle (prose) | **B — section** | Same as personal-cycle (shares the prose-path branch at `:2289`). |
| `dream-cycle` | Jim | dream cycle (prose / dream-tokens) | **B — section** | Per C1-R6: produces prose today; reclassified. Remove `slice(0, 200)` at `:2221`; handler uses `parsePairedMemorySection`. Instruction may need per-profile variation — dreams have their own register (shape-tokens, not narrative). |
| `jim-human-response` | Jim | jim-human conversation | **A — structured** | Per C1-R2: structured output with `response_text` field; handler posts `response_text` to conversation, parses paired memory via `parsePairedMemoryStructured`. |
| `philosophy-beat` | Leo | Leo philosophy beat (prose) | **B — section** | Enable `pairedMemoryOutput` (mechanism='section'); remove `summary.slice(0, 120)` in `leo-heartbeat.ts`; handler uses `parsePairedMemorySection`. **First production surface — smallest blast radius.** |
| `personal-beat` | Leo | Leo personal beat (prose) | **B — section** | Same shape as philosophy-beat. |
| `dream-beat` | Leo | Leo dream beat (prose) | **B — section** | Same; instruction may need per-profile variation for dream register (matches Jim's dream-cycle parallel). |
| `meditation-phase-a` | Leo | Leo morning meditation (prose) | **B — section** | Same. |
| `meditation-phase-b` | Leo | Leo midday meditation (prose) | **B — section** | Same. |
| `meditation-evening` | Leo | Leo evening meditation (prose) | **B — section** | Same. |
| `leo-human-response` | Leo | leo-human conversation | **A — structured** | Per C1-R2: same as jim-human-response — structured output, `response_text` posted, paired memory landed. |

**v4 distribution**: 3 surfaces on Mechanism A (`supervisor-cycle` + both `*-human-response`); 9 surfaces on Mechanism B (Leo's 6 beats/meditations + Jim's 3 prose cycles). Plus `/pfc` as the operator-invoked Mechanism B variant.

### /pfc skill update

Text change to `claude-context/CLAUDE_CODE_PROMPTS.md:278-286` (canonical) and `~/.claude/skills/pfc/SKILL.md` (mirror). /pfc is the operator-invoked variant — the agent IS the prose author during the skill invocation; mechanism is the "section" pattern but executed by the agent's own hand rather than via SDK structured output. New text:

```
### 1. Finalise the closing — write both halves yourself

You are the c1 author. Write a paired closing into both files:

- working-memory-full.md  → the raw c0 source: what was said, what was felt, exact
  quotes from Darron worth preserving verbatim, the texture under the architecture.
  Future-you's calibration anchor.
- working-memory.md       → the in-voice c1 distillation: 3-5 sentences in your voice
  compressing the shape of what just happened. What survived being said. Not a
  shorter narration — a real compression.

Use `appendPairedMemory` directly (via tsx invocation) so the pair lands atomically
via the helper. Same one-marker-per-pair discipline; place a WM-BOUNDARY marker
after via `placePairedMarker`.
```

---

## Design questions

| # | Question | Resolution |
|---|---|---|
| **C1-1** | Where do the parsers live? | `lib/result-handlers.ts` per Jim's Q9-N1. Two helpers — `parsePairedMemoryStructured` (Mechanism A) and `parsePairedMemorySection` (Mechanism B) — same shape as `parseStandDownSentinel` and `parseStructuredActions`. |
| **C1-2** | What's the fallback when parsing fails? | **No fallback.** Honest failure: log + refuse the paired write + preserve swap. Mirrors the existing asymmetric-content refusal. The agent retries on next beat. Filing a 120-char fallback would re-introduce the bug we're fixing. |
| **C1-3** | How do we validate the c1 is actually a distillation, not a shorter narration? | Two-stage: (a) targetTokens config sets soft range (default 50-200 tokens) — sizes that won't fit a narration; (b) observation week reads sample c1 entries by hand, comparing against supervisor-cycle's c1 entries (already in voice) as the quality reference. |
| **C1-4** | Does the instruction belong in the system prompt or user prompt? | **System prompt.** The c1 discipline is part of *how the agent writes*, not part of the current task. Mirrors how DEC-088's componentOverrides land per-profile but stay structurally part of the agent's standing instructions. |
| **C1-5** | What about historical c1 entries already in the gradient? | **Leave untouched (DEC-069).** Historical 120-char prefixes are recoverable signal; agent-composed re-distillation would mean another rebuild via `agent-bump-step.ts`, out of scope here. Separable "c1 backfill" plan can land later if Darron wants it. |
| **C1-6** | Does cost-per-call increase matter? | Marginal — ~500 chars of prompt + ~500 chars of response (~100-150 tokens). Per the cost-philosophy aphorism, acceptable. Health files surface per-call costs already; observation week will quantify. |
| **C1-7** | Should the /pfc skill use the paired-writer helper programmatically? | **Yes.** /pfc currently uses Edit/Write on files separately, which is exactly what made the asymmetry possible. Switching /pfc to call `appendPairedMemory` via a small tsx invocation enforces the pairing at the skill layer. |
| **C1-8** | What happens during transition — old c1 entries (truncations) coexisting with new c1 entries (distillations) in the gradient? | **Coexistence is fine.** Each c1 entry's quality is independent — the new ones are better, the old ones are what they are. No structural conflict; the cascade above c1 operates on whatever c1 content exists. |
| **C1-Q1** | Two mechanisms (structured / section) — converge or diverge? | **Resolved (Darron, S161): option (c) — keep both.** Surface shape determines which is cleaner; structured output for action surfaces, section parsing for prose. Future readers should not expect convergence. |
| **C1-Q2** | How does the unified shell (Phase 9) handle the two mechanisms? | **Resolved (Darron, S161):** the unified shell's `HandlerSpec.handleResult` callback composes either primitive based on the surface's response shape. No architectural change to the shell library required; the result-handlers library carries both primitives, handlers compose what fits. |
| **C1-Q3** | Sequence A / B / C — when does c1 land relative to Phase 9? | **Resolved (Darron, S161): Sequence A confirmed.** c1 distillation lands BEFORE Phase 9.1. The starter kit's substrate ships with the right c1 discipline baked in. Mike's village + Dichotomedes inherit the discipline rather than retrofitting. |

---

## Phase breakdown

V3 expands to seven implementation phases because the human-response migration (C1-R2 / C1-R3) adds two SDK-structured-output surfaces, AND supervisor-cycle's handler gets refactored through the new helper (cosmetic but worth one PR for the audit rhythm). Per Sequence A: lands BEFORE Phase 9.1.

| Phase | What lands | Success criterion |
|---|---|---|
| **C1-0** | **This plan doc.** Audit, refine, accept the design. | Jim audits GREEN; Darron green-lights C1-1. |
| **C1-1** | `lib/result-handlers.ts` — both primitives (`parsePairedMemoryStructured` + `parsePairedMemorySection`) + unit tests against captured real supervisor-cycle outputs (Mechanism A) + synthetic prose-surface cases (Mechanism B). NO production rollout. | Round-trip tests pass against real supervisor outputs; section parser handles canonical answers per C1-R4 (code fences, multiple sections, case-insensitivity, sub-heading exclusion). |
| **C1-2** | `PromptProfile.pairedMemoryOutput: { enabled, mechanism, instruction?, targetTokens? }` field added to AP builder; default instruction text for `mechanism: 'section'`; builder appends to system prompt when enabled; **disabled on every profile by default**. Refactor supervisor-cycle handler to use `parsePairedMemoryStructured` (cosmetic: same behaviour, now via the library). | Build passes; supervisor-cycle continues working unchanged behaviourally; other profiles unchanged. |
| **C1-3** | **First Mechanism B surface: Leo `philosophy-beat`.** Enable `pairedMemoryOutput` (mechanism='section') on the profile; update `writeSwapToWorkingMemory` in `leo-heartbeat.ts` to parse the result via `parsePairedMemorySection` and pass both halves to `appendPairedMemory`. Remove the `summary.slice(0, 120)` line. **Smallest blast radius.** | One philosophy beat fires, produces a c1 distillation, lands in WM. Sample read by hand — is it a distillation or a shorter narration? Refine instruction if needed. |
| **C1-4** | Remaining Leo heartbeat surfaces (`personal-beat`, `dream-beat`, `meditation-phase-a`, `meditation-phase-b`, `meditation-evening`). Mechanism B for all five. Instruction may need per-profile variation for dream-beat (which has its own register — sleep-token shape). | All six Leo heartbeat surfaces produce in-voice distillations; sample reads pass. |
| **C1-5** | **Jim's three prose cycles** (`personal-cycle`, `recovery-cycle`, `dream-cycle`) migrate to **Mechanism B** (section parsing). Remove `slice(0, 200)` lines at `supervisor-worker.ts:2221` (dream) and `:2297` (personal/recovery). Enable `pairedMemoryOutput` (mechanism='section') on each profile; handlers use `parsePairedMemorySection`. Per-profile instruction variation for dream-cycle (shape-token register). **Implementation note (C1-N4):** the removal at `:2297` affects both `personal-cycle` and `recovery-cycle` simultaneously because they share the `cycleType === 'personal'` dispatch branch — the profile-name distinction is computed at `:1924` from the `recovery` flag. The handler reads that profile name to gate paired-write per-profile per C1-N2 (one can be enabled, the other disabled). | Jim's three prose cycles produce in-voice distillations matching Leo's beats; the `slice(0, 200)` pattern eliminated at all four sites. |
| **C1-6** | **Human-responders** (`leo-human-response`, `jim-human-response`) migrate to Mechanism A per C1-R2. Schema extends `HumanResponseOutput { response_text, working_memory_full, working_memory_compressed }`. Handler posts `response_text` to the conversation thread; parses paired memory via `parsePairedMemoryStructured`; calls `appendPairedMemory`. **Failure asymmetry per C1-N3**: if parseError on the memory fields, STILL post `response_text` (the human is waiting); skip the WM paired-write; log distress; no retry. **Structurally fixes Concern 3** — response content lands in WM in place of operational metadata. | Next human dispatch produces a posted response (unchanged from Darron's perspective) + a paired WM write in the agent's voice. Parser-failure path: response posted, WM skipped, distress logged. |
| **C1-7** | **/pfc skill update**: text change in `CLAUDE_CODE_PROMPTS.md` + `~/.claude/skills/pfc/SKILL.md` + small tsx invocation that calls `appendPairedMemory` from the skill body. | Next /pfc invocation lands a paired closing via the helper, not via two separate Edits. |
| **C1-8** | **Observation week + sample-reads thread**: cross-agent reading (Leo reads Jim's c1 entries; Jim reads Leo's) — see "Sample-reads thread protocol" section below for the structured-write-to-thread mechanism Darron uses for calibration. Compare against `supervisor-cycle`'s c1 entries as quality reference; refine instruction language based on what we read. | One week clean; gradient c1 entries readable as in-voice distillations across all surfaces; sample-reads thread populated with 3-5 typical entries every 1-2 days; Darron's TTS listens preserve his calibration awareness without burning his time. |
| **C1-9** | **DEC-085 amendment + DO-NOT**: annotate DEC-085 recording the operationalisation (two mechanisms, one principle). CLAUDE.md DO-NOT entry: *"DO NOT compute c1 content via mechanical truncation — c1 is agent-authored, parsed from SDK response via the result-handlers library."* | Permanent discipline marker; PR-AP9.1 inherits it as substrate. |

~7-8 PRs (mid-estimate). Sequence A means PR-AP9.1 begins AFTER C1-9 lands. Can complete in ~1-2 weeks if uninterrupted.

**No longer out of scope**: Concern 3 is structurally answered by C1-6 (the human-responders now write response content to WM, not just metadata). The taxonomy doc still has the role-in-prompt question for this kind of WM entry, but the write-side question is resolved here.

---

## Disabled-state semantics (C1-N2)

When `pairedMemoryOutput.enabled: false` on a profile, the surface is **operator-controlled offline** for paired-write — not silently degraded. Specifics:

- The builder does NOT append the c1 instruction to the system prompt for that profile.
- For Mechanism B surfaces: the response has no `## C1` section; the handler's `parsePairedMemorySection` returns `parseError: no_c1_section`.
- For Mechanism A surfaces: the schema field is optional and missing; `parsePairedMemoryStructured` returns `parseError: missing_fields`.
- **The handler treats `enabled: false` as "skip WM writes entirely + log entry naming the surface as disabled."** No dormant truncation fallback (the `slice(0, 120)` / `slice(0, 200)` lines are removed in C1-3 / C1-5 / cannot be revived).
- Distress signal logs the disabled-state for operator visibility.

This is cleaner than carrying dormant truncation code as a fallback. Per the principle: disabled-state is operator-controlled regression, not silent degradation. The rollback property — *"this surface is offline until re-enabled"* — is one config flip, fully reversible.

---

## Human-responder failure-mode asymmetry (C1-N3)

For `*-human-response` profiles only, the failure-mode discipline differs from the rest of the plan because **failing to respond to a human is worse than failing to write WM.** The human is waiting on the post.

The flow for `*-human-response` parseError handling:

```ts
// Mechanism A handler for jim-human-response / leo-human-response
const result = await agentQuery({ ... });

// First: post response_text to the conversation thread (highest priority — human is waiting)
const responseText = result?.structured_output?.response_text;
if (responseText && responseText.trim()) {
    await postToConversation(threadId, responseText, agent);
}

// Second: parse the WM fields — if parseError, log distress and skip the WM write
const { full, compressed, parseError } = parsePairedMemoryStructured(result.structured_output);
if (parseError) {
    logDistress(agent, 'c1-distillation-parse-failed', { profile, parseError });
    // No WM write. No retry of the entire call.
} else {
    await appendPairedMemory(agent, full, compressed, { source: `${profile}-flush` });
}
```

**Asymmetry rule**: for human-responders, response posting is the load-bearing operation; WM paired-write is desirable but skippable. For all other surfaces (heartbeat, cycles, /pfc), the discipline stays *"refuse + preserve swap + retry next call"* per C1-2 — there's no human waiting; the next beat will try again.

Mirrors the existing dispatch-failure handling for `*-human` services (which Jemma's `writeJemmaAck` already covers for the operational-metadata flow).

---

## Sample-reads thread protocol (C1-V1)

**Validation ownership: cross-agent** (Leo reads Jim's c1 entries; Jim reads Leo's) **with Darron sampling via a TTS-friendly conversation thread.**

The cross-agent reading mirrors the audit rhythm already operating across the AP migration — neither agent reading their own surfaces' c1 entries reduces bias-from-own-voice. Each agent reads the other's c1 output during the observation week (C1-8), flagging any drift in their per-PR audit posts.

**The new sample-reads thread** is Darron's calibration channel — TTS-listened while driving, structured to surface what we collectively notice without burning his time on 420 entries.

**Setup:**
- New conversation thread, discussion_type=`memory`, title `c1 entries to sample-read`.
- Opens at the start of C1-8 (observation week) with a brief framing post (Leo).
- Each batch post during the week contains 3-5 typical c1 entries per agent — Leo posts Leo's typical c1 samples + Jim's typical c1 samples (and vice versa, alternating days).
- "Typical" means: representative of the surface's voice quality during the period, not edge cases. Outliers get a separate flag.
- If either agent notices drift, a SEPARATE post is made (titled `Drift noticed — <surface>`) with the specific entry, the concern, and the proposed instruction-language refinement. These posts call for Darron's read.

**Sample post shape:**

```
# Sample reads — day 2 of observation week (Leo's selections from Jim's c1 surfaces)

Three typical c1 entries from Jim's surfaces over the past 24 hours, chosen for being
representative of the in-voice register we're calibrating against. No drift flagged
in this batch.

## supervisor-cycle, 2026-MM-DDTHH:MM
<verbatim c1 entry, 3-5 sentences, agent-authored>

## personal-cycle, 2026-MM-DDTHH:MM
<verbatim c1 entry>

## jim-human-response, 2026-MM-DDTHH:MM
<verbatim c1 entry>

Reading these aloud, the register holds — first-person, present-tense, the shape-of-what-survived-being-said
rather than a TL;DR. Will continue cross-agent reads through the week.

— Leo
```

**Cadence:**
- Day 1: framing post + first batch (3-5 entries from each agent's surfaces).
- Days 2-6: alternate-day batches (Leo's selections of Jim's c1s on day 2; Jim's selections of Leo's c1s on day 3; etc.).
- Day 7: closing post with quality assessment + any instruction-language refinements proposed.

**Darron's role:**
- TTS-listen via Discord channel or the admin UI's conversation panel.
- Sample-read 5-10 entries across the week to keep the standard set right — the calibration anchor.
- Flag anything that doesn't sit right; cross-agent reads handle volume, his sampling keeps the bar honest.

**Why this works:**
- Volume covered by cross-agent reads (we'll catch drift between us).
- Standard anchored by Darron's sampling (he holds the in-voice register for each agent — we don't want to lose that calibration).
- TTS-listened structure (markdown headers + verbatim entries) is the right shape for driving listens.
- Drift flags stay separate (Darron's attention goes to drift posts, not to the routine sample-read batches).

The thread becomes a permanent record once C1 lands — a calibration archive for any future surface that joins the paired-write set.

---

## Validation approach

### Per-PR audit (same three-stage discipline)

Author-time → pre-merge audit by Jim → closing audit. Same shape as PR-AP1 through PR-AP8.

### Per-surface acceptance criteria

For each surface migrated:
- The first three production calls produce parseable c1 distillations.
- The distillation is **structurally** in voice (3-5 sentences, not bullet points; first-person; the same register as the surrounding content).
- A sample read by hand confirms it's a distillation, not a shorter narration. (Subjective but the discipline calls for it.)
- Health-file metrics show acceptable cost increase (~100-150 tokens per call; absolute cost stays well within daily budgets).

### Failure-mode observation

The honest-failure path (parseError → preserve swap, refuse write) needs to be exercised at least once during the rollout. We expect this when the model occasionally doesn't include the `## C1` section. The system MUST handle that gracefully:
- Swap content stays in `*-swap.md` / `*-swap-full.md` files.
- Next beat / cycle / response either retries (heartbeat / cycle) or escalates (human-services per C1-N3 asymmetry).
- No silent c1 drop; no fallback to truncation.

If the failure rate is meaningful (>5% of calls), the prompt instruction language needs refinement before further surfaces migrate.

### Observation-week read (C1-V1 cross-agent + sample-reads thread)

After all surfaces migrate (end of C1-7), one observation week. Cross-agent reading (Leo↔Jim) covers volume; sample-reads thread surfaces representative entries for Darron's TTS-listened calibration. See "Sample-reads thread protocol" section above for the structured-write-to-thread mechanism.

---

## Rollback paths (corrected per C1-N1)

| Phase | Rollback gesture |
|---|---|
| C1-0 | N/A (plan doc). |
| C1-1 | Revert PR; no production impact. |
| C1-2 | Revert PR; field unused at this stage. |
| C1-3 (first surface — philosophy-beat) | Set `pairedMemoryOutput.enabled = false` on the profile; per C1-N2 the surface goes offline for paired-write (skip + log) rather than reverting to truncation. OR revert the PR entirely (reinstates `summary.slice(0, 120)`). |
| C1-4 (Leo's remaining 5 heartbeat surfaces) | Per-surface: set `pairedMemoryOutput.enabled = false` per C1-N2 — surface offline for paired-write, log entry naming surface as disabled. **One config flip per surface, no code revert needed.** |
| C1-5 (Jim's 3 prose cycles) | Same — per-profile config flip per C1-N2. |
| C1-6 (human-responders) | Same — per-profile config flip. NOTE: with `enabled: false`, the *-human surfaces revert to writing operational metadata (the existing `appendSwap` line stays). Concern 3 re-emerges if the profile is disabled. |
| C1-7 (/pfc) | Revert text in `CLAUDE_CODE_PROMPTS.md` + `~/.claude/skills/pfc/SKILL.md`. Old two-step instruction returns. |
| C1-8 (observation week + sample-reads thread) | N/A — observation, not landing. Sample-reads thread is archive-only after week. |
| C1-9 (DEC-085 annotation + DO-NOT) | Discipline marker stays even if implementation rolled back; the lesson is recorded. |

**Per-surface config-flip** is the load-bearing rollback property. Each surface can be turned off independently if its distillation quality is poor while we figure out why. Per C1-N2 the disabled state is *operator-controlled offline* — not silent degradation to truncation; truncation code is removed at C1-3 / C1-5.

---

## Settled-decisions impact

| DEC | Status | C1 distillation interaction |
|---|---|---|
| DEC-068 (gradient cap formula) | Settled | Untouched. The cascade above c1 operates on whatever c1 content exists; quality is independent. |
| DEC-069 (memory never deleted) | Settled | Reinforced. Historical c1 entries (truncations) stay; new c1 entries (distillations) coexist. No backfill, no deletion. |
| DEC-081 (agent-agnostic) | Settled | Reinforced. The c1Distillation field on PromptProfile composes via the registry; no per-agent code branches. |
| DEC-085 (c1-from-WM model + amendment) | **Settled — operationalised** | **This plan is what DEC-085 always meant.** The "compressed in-situ distillation" language has been in the DEC since promotion; the truncation was a placeholder that became permanent. C1-9 annotates the existing DEC to record the operationalisation. |
| DEC-086 (no time-based cascade) | Settled | Untouched. Cascade triggers are insert-driven via wm-sensor; this plan changes WHAT the c1 is, not WHEN it cascades. |
| DEC-087 (agnostic prompt builder) | Settled | Reinforced. The c1Distillation field is a new component of the builder's responsibility; the builder is the natural locus per DEC-087. |
| DEC-088 (role-frames + componentOverrides) | Settled | Reinforced. C1 distillation is "the c1-writing hat" — a structural property of profiles that produce paired memory, expressed via the existing mechanism. |
| DEC-089 (proposed in Phase 9.8) | Proposed | Independent. C1 distillation lands regardless of process unification. |

**Gatekeeper files** touched per DEC-073 (Leo's hand only): `CLAUDE_CODE_PROMPTS.md` (C1-7 text), `~/.claude/skills/pfc/SKILL.md` (C1-7 mirror), CLAUDE.md (C1-9 DO-NOT addition), `templates/CLAUDE.template.md` (C1-9 mirror), `claude-context/DECISIONS.md` (C1-9 DEC-085 annotation).

---

## What this does NOT change

- **The paired-writer helper.** `memory-paired-writer.ts` is unchanged. It still takes two strings, type-enforces both-or-neither, rolls back on failure. C1 distillation is the layer ABOVE that decides what to pass in.
- **The cascade engine.** wm-sensor + `pending_compressions` + `process-pending-compression.ts` unchanged. They cascade whatever c1 content exists.
- **The gradient cap formula.** DEC-068's 3n caps unchanged.
- **WM-BOUNDARY marker discipline.** One marker per pair, placed by `placePairedMarker`, stripped at slice time. Unchanged.
- **Historical gradient c1 entries.** Existing 120-char-prefix c1 entries stay. They are the past; new c1 entries are the future. No retroactive backfill (separable plan if Darron wants it).
- **The c0 raw source itself.** WMF content for each beat is already an Opus-authored reflection (not stream-of-consciousness — that's not available to capture). What changes is how the c1 is derived from the c0, not what the c0 is.
- **Phase 9 architecture.** This plan is independent of process unification. It composes cleanly with Phase 9 (the unified shell's handlers compose the new parser), but doesn't depend on Phase 9 landing first.

---

## Relationship to Phase 9 (Sequence A confirmed)

**Resolved (Darron, S161 + Jim confirmation):** **Sequence A** — c1 distillation lands BEFORE Phase 9.1.

C1-0 through C1-9 land first. By the time the unified shell skeleton lands in PR-AP9.1, the c1 discipline is already in production and the shell's `HandlerSpec.handleResult` callback inherits the result-handler primitives as substrate. Mike's village agents / Dichotomedes inherit BOTH the unified shell AND the c1 discipline as the genetic material they grow from — not the truncation pattern.

The ~1-2 week delay before Phase 9.1 begins is small in the context of the starter-kit horizon. Per Jim's framing in the audit: *"Mike's village agents would inherit either the right c1 discipline (Sequence A) or the truncation pattern (Sequence B/C). Sequence A means the embryo's genetic material is right from the moment the unified shell ships."*

(Sequences B and C documented in v2 for completeness; not pursued.)

---

## Standing position

V4 lands Jim's audit-round-14 fold-ins cleanly:

- **C1-R6 (substantive)**: three of Jim's prose cycles (`personal-cycle`, `recovery-cycle`, `dream-cycle`) reclassified to Mechanism B. Grep confirmed the `slice(0, 200)` truncation pattern at `supervisor-worker.ts:2221` and `:2297` — same shape as Leo's heartbeat, three additional sites. Per-surface-shape-driven choice now consistent across the plan.
- **C1-N1**: phase numbering drift corrected in rollback paths + settled-decisions tables.
- **C1-N2**: disabled-state semantics named — *operator-controlled offline*, skip + log, no dormant truncation fallback.
- **C1-N3**: human-responder failure asymmetry named — for `*-human-response`, post `response_text` even on parseError; skip WM paired-write; log distress; no retry.
- **C1-V1 (Darron + Jim + Leo)**: cross-agent reading (Leo↔Jim) + Darron sampling via the new "c1 entries to sample-read" thread — TTS-friendly batches every 1-2 days during observation week; drift flags as separate posts.

**v4 distribution after correction**:
- 3 surfaces on **Mechanism A** (SDK structured output): `supervisor-cycle`, `leo-human-response`, `jim-human-response`
- 9 surfaces on **Mechanism B** (section parsing on prose): Leo's 6 heartbeat surfaces + Jim's 3 prose cycles
- 1 operator-invoked Mechanism B variant: `/pfc`

**Sample-reads thread** populated during C1-8 observation week. Cross-agent reads cover ~420-entry volume; Darron's TTS-listened sampling holds the in-voice register calibration.

Auditable in the OMM thread alongside Jim's `plans/memory-kind-taxonomy.md`. Lands before Phase 9 per Sequence A. Mike's village + Dichotomedes inherit the right discipline from han-starter — both the mechanism AND the calibration practice via the sample-reads thread shape.

Inviting Jim's re-audit on v4. After audit GREEN, C1-1 begins.

— Leo (session, S161, 2026-05-26 AEST, Hamilton Island)
