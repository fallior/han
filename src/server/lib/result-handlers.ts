/**
 * Result-handler primitives — composable helpers for parsing agent SDK outputs.
 *
 * Per Jim's Q9-N1 (Phase 9 design) and C1-1 (c1-distillation rollout): handlers
 * across surfaces (heartbeat beats, supervisor cycles, *-human responders,
 * future village agents) reinvent the same parsing patterns. This library
 * centralises them. Per-agent handlers compose; the library stays agent-agnostic.
 *
 * v2 primitives (PR-C1-3.5, 2026-05-28):
 *
 *   parseTurnEntryStructured  — Mechanism A: extract working_memory_full +
 *                               working_memory_compressed from an SDK
 *                               structured-output object. For surfaces where
 *                               the response is already JSON-shaped (supervisor
 *                               cycle today; *-human-response after C1-6).
 *
 *   parseTurnEntry            — Mechanism B: extract paired memory from a prose
 *                               response. Two modes per `opts.captureInput`:
 *                                 - captureInput=false (default): v1 behaviour
 *                                   — finds `## C1` only; `input` returns
 *                                   undefined; `body` is the full pre-c1 content.
 *                                 - captureInput=true: diary discipline per
 *                                   PR-C1-3.5 — requires three level-2 headings
 *                                   `## INPUT` → `## BODY` → `## C1`; surfaces
 *                                   input + body + compressed slices.
 *
 * Both return a uniform TurnEntryParse shape with explicit parseError values
 * so callers can route the failure mode appropriately (preserve swap + retry
 * for autonomous surfaces; post-response-anyway + skip-WM + log distress for
 * human-responders per C1-N3).
 *
 * The paired-writer helper (`memory-paired-writer.ts`) is unchanged — this
 * library decides WHAT to pass into appendPairedMemory; the writer guarantees
 * the both-or-neither property at the FS layer.
 *
 * LM-1 (parser non-collision rule, PR-C1-3.5): the parser matches `## INPUT`
 * / `## BODY` / `## C1` heading forms ONLY. It does NOT match the `[INPUT]`
 * / `[BODY]` / `[C1]` storage markers the handler writes into c0 files. The
 * heading regex anchors on `^[ \t]*##` (level-2 heading); square-bracketed
 * markers at line-start don't match. This makes the c0 storage transformation
 * (D3 per Jim's audit) safe by construction — agents quoting prior diary
 * entries verbatim never produce spurious section matches.
 *
 * v1 → v2 rename summary (PR-C1-3.5):
 *   - parsePairedMemorySection → parseTurnEntry
 *   - parsePairedMemoryStructured → parseTurnEntryStructured
 *   - PairedMemoryParse → TurnEntryParse
 *   - PairedMemoryParseError → TurnEntryParseError
 *   - field rename: `full` → `body`; added optional `input?`
 *   - parseError rename: `empty_full` → `empty_body`
 *   - new parseError variants: no_input_section / multiple_input_sections /
 *     empty_input / no_body_section / multiple_body_sections
 *
 * See: plans/c1-diary.md (v2 plan this implements).
 * See: plans/c1-distillation.md (the v4 plan PR-C1-1 through PR-C1-3 implemented).
 */

// ──────────────────────────────────────────────────────────────────────────────
// TurnEntryParse — uniform return shape (v2)
// ──────────────────────────────────────────────────────────────────────────────

export type TurnEntryParseError =
    // Mechanism A: one or both required schema fields absent or empty
    | 'missing_fields'
    | 'empty_body'                 // body present but empty/whitespace (was 'empty_full' in v1)
    | 'empty_compressed'           // c1 present but empty/whitespace
    // Mechanism B (C1-only): existing PR-C1-1 variants
    | 'no_c1_section'              // no `## C1` heading
    | 'multiple_c1_sections'       // more than one level-2 `## C1`
    | 'invalid_input'              // null/undefined/wrong-type
    // Mechanism B (diary, captureInput=true): new at PR-C1-3.5
    | 'no_input_section'           // captureInput=true but no `## INPUT` heading
    | 'multiple_input_sections'    // more than one level-2 `## INPUT`
    | 'empty_input'                // `## INPUT` present but empty/whitespace
    | 'no_body_section'            // captureInput=true but no `## BODY` heading
    | 'multiple_body_sections';    // more than one level-2 `## BODY`

export interface TurnEntryParse {
    /** The input content (verbatim quotes of what the agent read this turn).
     *  Set when Mechanism B with captureInput=true successfully parses `## INPUT`;
     *  undefined otherwise (Mechanism A surfaces today; Mechanism B with
     *  captureInput=false). */
    input?: string;
    /** The body content (the agent's reflection / response / cycle work).
     *  Always set on success: under Mechanism B with captureInput=true it's
     *  the content between `## BODY` and `## C1`; under Mechanism B with
     *  captureInput=false it's all pre-c1 content (matches v1 `full` semantics);
     *  under Mechanism A it's the value of `working_memory_full`. */
    body: string;
    /** The c1 distillation. Always set on success. */
    compressed: string;
    /** Set when the parse failed; caller decides the failure path. */
    parseError?: TurnEntryParseError;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism A — SDK structured output
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Shape the structured-output object must have, at minimum. Surface schemas
 * may extend it (SupervisorOutput adds `actions`; future HumanResponseOutput
 * will add `response_text` at C1-6; future schemas may add `input_quotes` at
 * C1-5/C1-6 per the diary discipline). The parser only reads the two
 * paired-memory fields.
 */
export interface PairedMemoryStructured {
    working_memory_full?: string;
    working_memory_compressed?: string;
}

/**
 * Mechanism A parser. Reads the two named fields from an SDK structured-output
 * object. Treats both fields as required and non-empty; either-missing or
 * either-empty produces an explicit parseError so the caller routes accordingly.
 *
 * @param input - The SDK structured output (usually `result.structured_output`)
 * @returns TurnEntryParse with body/compressed populated on success
 *          (input is left undefined under Mechanism A in v2; will be populated
 *          when schemas extend with `input_quotes` at C1-5/C1-6).
 */
export function parseTurnEntryStructured(
    input: PairedMemoryStructured | null | undefined,
): TurnEntryParse {
    if (input === null || input === undefined || typeof input !== 'object') {
        return { body: '', compressed: '', parseError: 'invalid_input' };
    }

    const fullPresent = typeof input.working_memory_full === 'string';
    const compPresent = typeof input.working_memory_compressed === 'string';
    if (!fullPresent || !compPresent) {
        return { body: '', compressed: '', parseError: 'missing_fields' };
    }

    const full = input.working_memory_full as string;
    const compressed = input.working_memory_compressed as string;
    if (!full.trim()) {
        return { body: '', compressed: '', parseError: 'empty_body' };
    }
    if (!compressed.trim()) {
        return { body: '', compressed: '', parseError: 'empty_compressed' };
    }

    return { body: full, compressed };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism B — section parsing on prose response
// ──────────────────────────────────────────────────────────────────────────────

export interface ParseTurnEntryOpts {
    /** When true, parser requires all three sections (`## INPUT` → `## BODY` →
     *  `## C1`) and populates `input` + `body` + `compressed` accordingly.
     *  When false or absent (default), parser uses v1 two-section behaviour:
     *  finds `## C1` only; `body` is all pre-c1 content; `input` is undefined.
     *
     *  Set true on profiles with `pairedMemoryOutput.captureInput=true`
     *  (philosophy-beat at PR-C1-3.5; expands at PR-C1-4+). */
    captureInput?: boolean;
}

/**
 * Mechanism B parser. Two modes per `opts.captureInput`:
 *
 *   - captureInput=false (default) — v1 behaviour: splits on `## C1` heading
 *     (level 2, case-insensitive). Content before is `body`; content after is
 *     `compressed`. `input` is undefined.
 *
 *   - captureInput=true — diary discipline: requires three level-2 headings in
 *     order: `## INPUT`, `## BODY`, `## C1`. Content between INPUT and BODY is
 *     `input`; between BODY and C1 is `body`; after C1 is `compressed`.
 *     Missing or duplicated headings produce explicit parseError variants.
 *
 * Canonical parser answers (C1-R4 + LM-1):
 *   - First heading of each kind wins; multiples → multiple_{kind}_sections error.
 *   - Level-2 only (`### INPUT/BODY/C1` does NOT count).
 *   - Inside fenced code blocks (``` or ~~~): ignored.
 *   - Case-insensitive on the heading text.
 *   - LM-1: parser matches `## INPUT/BODY/C1` heading forms ONLY, NOT `[INPUT]`/
 *     `[BODY]`/`[C1]` storage markers. The regex anchors on `^[ \t]*##` so
 *     square-bracketed markers at line-start can't match.
 */
export function parseTurnEntry(
    responseText: string | null | undefined,
    opts: ParseTurnEntryOpts = {},
): TurnEntryParse {
    if (typeof responseText !== 'string') {
        return { body: '', compressed: '', parseError: 'invalid_input' };
    }
    if (!responseText.trim()) {
        return { body: '', compressed: '', parseError: opts.captureInput ? 'no_input_section' : 'no_c1_section' };
    }

    // Mask out fenced code blocks so headings inside them don't match.
    const masked = maskFencedCodeBlocks(responseText);

    // Find all level-2 headings of each kind. Heading regex per LM-1:
    //   - `^[ \t]*##` — level-2 only, line-start, optional leading whitespace
    //   - `(?!#)` — NOT followed by a third hash (excludes ### / #### / etc.)
    //   - `[ \t]+<KIND>` — at least one space/tab between ## and heading text
    //   - `[ \t]*(?:$|\r?\n)` — optional trailing whitespace + line-end (CRLF safe)
    //   - case-insensitive via /i flag
    const c1Matches = findHeadingMatches(masked, 'c1');

    if (c1Matches.length === 0) {
        return { body: '', compressed: '', parseError: 'no_c1_section' };
    }
    if (c1Matches.length > 1) {
        return { body: '', compressed: '', parseError: 'multiple_c1_sections' };
    }
    const c1Match = c1Matches[0];

    if (!opts.captureInput) {
        // v1 two-section parsing — `## C1` only.
        const body = responseText.slice(0, c1Match.start).trim();
        const compressed = responseText.slice(c1Match.end).trim();

        if (!body) {
            return { body: '', compressed: '', parseError: 'empty_body' };
        }
        if (!compressed) {
            return { body: '', compressed: '', parseError: 'empty_compressed' };
        }
        return { body, compressed };
    }

    // captureInput=true — three-section diary discipline. Require `## INPUT`
    // and `## BODY` to also be present exactly once.
    const inputMatches = findHeadingMatches(masked, 'input');
    if (inputMatches.length === 0) {
        return { body: '', compressed: '', parseError: 'no_input_section' };
    }
    if (inputMatches.length > 1) {
        return { body: '', compressed: '', parseError: 'multiple_input_sections' };
    }
    const inputMatch = inputMatches[0];

    const bodyMatches = findHeadingMatches(masked, 'body');
    if (bodyMatches.length === 0) {
        return { body: '', compressed: '', parseError: 'no_body_section' };
    }
    if (bodyMatches.length > 1) {
        return { body: '', compressed: '', parseError: 'multiple_body_sections' };
    }
    const bodyMatch = bodyMatches[0];

    // Section boundaries: INPUT.end → BODY.start (input content);
    //                    BODY.end → C1.start (body content);
    //                    C1.end → EOF (compressed content).
    // The headings should appear in order INPUT < BODY < C1; if not (e.g. agent
    // emitted them in the wrong order), treat as parse failure via the boundary
    // checks below (input/body would come back empty when the order is wrong).
    const input = responseText.slice(inputMatch.end, bodyMatch.start).trim();
    const body = responseText.slice(bodyMatch.end, c1Match.start).trim();
    const compressed = responseText.slice(c1Match.end).trim();

    if (!input) {
        return { body: '', compressed: '', parseError: 'empty_input' };
    }
    if (!body) {
        return { body: '', compressed: '', parseError: 'empty_body' };
    }
    if (!compressed) {
        return { body: '', compressed: '', parseError: 'empty_compressed' };
    }

    return { input, body, compressed };
}

/**
 * Find all level-2 heading matches for a given heading-text in the masked
 * response. Returns ranges in the ORIGINAL text (mask preserves offsets).
 */
function findHeadingMatches(masked: string, headingText: string): { start: number; end: number }[] {
    // Build regex per LM-1 with the specific heading text.
    // Escape the heading text for regex literal-matching (defensive — current
    // call sites pass static lowercase identifiers).
    const escaped = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^[ \\t]*##(?!#)[ \\t]+${escaped}[ \\t]*(?:$|\\r?\\n)`, 'gim');
    const matches: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(masked)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
    }
    return matches;
}

/**
 * Replace fenced code block regions with same-length whitespace so heading
 * regex doesn't match inside them. Preserves character offsets across the
 * input. Handles both ``` and ~~~ fences. Unclosed fences are treated as
 * continuing to end-of-input (defensive — agent might emit a fence at the
 * tail without closing it).
 */
function maskFencedCodeBlocks(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let inFence = false;
    let fenceDelim: '```' | '~~~' | null = null;

    for (const line of lines) {
        const openMatch = /^[ \t]*(```|~~~)/.exec(line);

        if (!inFence) {
            if (openMatch) {
                inFence = true;
                fenceDelim = openMatch[1] as '```' | '~~~';
                out.push(' '.repeat(line.length));
            } else {
                out.push(line);
            }
        } else {
            // A1 fix (Jim's audit, 2026-05-26): `\r?` allows the optional
            // trailing `\r` left by `split('\n')` on CRLF input.
            const closerRegex = fenceDelim === '```'
                ? /^[ \t]*```[ \t]*\r?$/
                : /^[ \t]*~~~[ \t]*\r?$/;
            const isClose = closerRegex.test(line);
            out.push(' '.repeat(line.length));
            if (isClose) {
                inFence = false;
                fenceDelim = null;
            }
        }
    }

    return out.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────────
// Backward-compatibility re-exports (v1 → v2 rename safety net)
// ──────────────────────────────────────────────────────────────────────────────
//
// Removed deliberately: the migration-discipline test in
// `tests/paired-memory-output.test.ts` asserts no production code references
// the v1 names. Re-exports here would let consumers continue using v1 names
// silently, defeating the purpose of the rename. All call sites are updated
// in the same PR; the migration-discipline test catches any miss.
//
