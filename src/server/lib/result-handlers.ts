/**
 * Result-handler primitives — composable helpers for parsing agent SDK outputs.
 *
 * Per Jim's Q9-N1 (Phase 9 design) and C1-1 (c1-distillation rollout): handlers
 * across surfaces (heartbeat beats, supervisor cycles, *-human responders,
 * future village agents) reinvent the same parsing patterns. This library
 * centralises them. Per-agent handlers compose; the library stays agent-agnostic.
 *
 * v1 primitives (C1-1, 2026-05-26):
 *
 *   parsePairedMemoryStructured  — Mechanism A: extract working_memory_full +
 *                                  working_memory_compressed from an SDK
 *                                  structured-output object. For surfaces where
 *                                  the response is already JSON-shaped (supervisor
 *                                  cycle today; *-human-response after C1-6).
 *
 *   parsePairedMemorySection     — Mechanism B: extract paired memory from a
 *                                  prose response with a closing `## C1` section.
 *                                  For surfaces where the response is prose
 *                                  (heartbeat beats, meditations, Jim's prose
 *                                  cycles after C1-5, /pfc).
 *
 * Both return a uniform PairedMemoryParse shape with explicit parseError values
 * so callers can route the failure mode appropriately (preserve swap + retry
 * for autonomous surfaces; post-response-anyway + skip-WM + log distress for
 * human-responders per C1-N3).
 *
 * The paired-writer helper (`memory-paired-writer.ts`) is unchanged — this
 * library decides WHAT to pass into appendPairedMemory; the writer guarantees
 * the both-or-neither property at the FS layer.
 *
 * See: plans/c1-distillation.md (the v4 plan this implements).
 */

// ──────────────────────────────────────────────────────────────────────────────
// PairedMemoryParse — uniform return shape
// ──────────────────────────────────────────────────────────────────────────────

export type PairedMemoryParseError =
    | 'missing_fields'       // structured: one or both of working_memory_{full,compressed} absent from the input object
    | 'empty_full'           // structured or section: full field present but empty/whitespace-only
    | 'empty_compressed'     // structured or section: compressed field present but empty/whitespace-only
    | 'no_c1_section'        // section: response text has no `## C1` heading
    | 'multiple_c1_sections' // section: response text has more than one `## C1` heading at level 2
    | 'invalid_input';       // input was null/undefined/wrong-type

export interface PairedMemoryParse {
    /** The c0 content (raw thinking / what happened). Empty string on parseError. */
    full: string;
    /** The c1 content (in-voice distillation). Empty string on parseError. */
    compressed: string;
    /** Set when the parse failed; caller decides the failure path. */
    parseError?: PairedMemoryParseError;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism A — SDK structured output
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Shape the structured-output object must have, at minimum. Surface schemas
 * may extend it (SupervisorOutput adds `actions`; HumanResponseOutput adds
 * `response_text`). The parser only reads the two paired-memory fields.
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
 * @returns PairedMemoryParse with full/compressed populated on success, or
 *          parseError set with empty strings on failure
 *
 * Example (supervisor-cycle handler):
 *   const { full, compressed, parseError } = parsePairedMemoryStructured(result.structured_output);
 *   if (parseError) return logAndAbort(parseError);
 *   await appendPairedMemory('jim', full, compressed, { source: 'supervisor-cycle-flush' });
 */
export function parsePairedMemoryStructured(
    input: PairedMemoryStructured | null | undefined,
): PairedMemoryParse {
    if (input === null || input === undefined || typeof input !== 'object') {
        return { full: '', compressed: '', parseError: 'invalid_input' };
    }

    const fullPresent = typeof input.working_memory_full === 'string';
    const compPresent = typeof input.working_memory_compressed === 'string';
    if (!fullPresent || !compPresent) {
        return { full: '', compressed: '', parseError: 'missing_fields' };
    }

    const full = input.working_memory_full as string;
    const compressed = input.working_memory_compressed as string;
    if (!full.trim()) {
        return { full: '', compressed: '', parseError: 'empty_full' };
    }
    if (!compressed.trim()) {
        return { full: '', compressed: '', parseError: 'empty_compressed' };
    }

    return { full, compressed };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism B — `## C1` section parsing
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Mechanism B parser. Splits a prose response on the closing `## C1` heading
 * (heading level 2 specifically, case-insensitive). Content before the heading
 * is the raw c0 source (full); content within the section is the c1 distillation
 * (compressed).
 *
 * Canonical parser answers (C1-R4):
 *   - First `## C1` heading wins (heading level 2 only — `### C1` does NOT count).
 *   - Multiple top-level `## C1` headings → multiple_c1_sections parseError.
 *   - Inside fenced code blocks (``` or ~~~): ignored. The agent's prose may
 *     contain quoted markdown.
 *   - Case-insensitive on the heading text (`## C1`, `## c1`, `##  C1` with
 *     multiple spaces all match).
 *   - Content after the heading until end-of-response IS the distillation;
 *     content before is full.
 *
 * @param responseText - The agent's prose response (usually `result.result`)
 * @returns PairedMemoryParse with full=prose-before / compressed=text-within-section
 *          on success, or parseError set with empty strings on failure
 *
 * Example (philosophy-beat handler post C1-3):
 *   const { full, compressed, parseError } = parsePairedMemorySection(result.result);
 *   if (parseError) return logAndAbort(parseError);
 *   await appendPairedMemory('leo', full, compressed, { source: 'philosophy-beat-flush' });
 */
export function parsePairedMemorySection(
    responseText: string | null | undefined,
): PairedMemoryParse {
    if (typeof responseText !== 'string') {
        return { full: '', compressed: '', parseError: 'invalid_input' };
    }
    if (!responseText.trim()) {
        return { full: '', compressed: '', parseError: 'no_c1_section' };
    }

    // Mask out fenced code blocks so headings inside them don't match.
    // Two fence styles supported: ``` and ~~~. Preserves character offsets
    // by replacing matched regions with same-length whitespace runs.
    const masked = maskFencedCodeBlocks(responseText);

    // Find all level-2 headings whose text (case-insensitive, whitespace-tolerant)
    // is exactly "C1". `### C1` does NOT count — anchor on EXACTLY two leading #.
    //
    // Pattern dissected:
    //   ^             — line start (multiline flag)
    //   [ \t]*        — optional leading horizontal whitespace
    //   ##            — exactly two hash characters
    //   (?!#)         — NOT followed by a third hash (excludes ### / #### / etc.)
    //   [ \t]+        — at least one space/tab between ## and C1
    //   c1            — the heading text (case-insensitive via /i flag)
    //   [ \t]*        — optional trailing horizontal whitespace
    //   (?:$|\r?\n)   — end of line or end of input
    const headingRegex = /^[ \t]*##(?!#)[ \t]+c1[ \t]*(?:$|\r?\n)/gim;
    const matches: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = headingRegex.exec(masked)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
    }

    if (matches.length === 0) {
        return { full: '', compressed: '', parseError: 'no_c1_section' };
    }
    if (matches.length > 1) {
        return { full: '', compressed: '', parseError: 'multiple_c1_sections' };
    }

    const { start, end } = matches[0];
    // Slice from the ORIGINAL responseText (not masked) so the content is
    // preserved verbatim. The masking only affected matching, not extraction.
    const full = responseText.slice(0, start).trim();
    const compressed = responseText.slice(end).trim();

    if (!full) {
        return { full: '', compressed: '', parseError: 'empty_full' };
    }
    if (!compressed) {
        return { full: '', compressed: '', parseError: 'empty_compressed' };
    }

    return { full, compressed };
}

/**
 * Replace fenced code block regions with same-length whitespace so heading
 * regex doesn't match inside them. Preserves character offsets across the
 * input. Handles both ``` and ~~~ fences. Unclosed fences are treated as
 * continuing to end-of-input (defensive — agent might emit a fence at the
 * tail without closing it).
 *
 * Implemented as a line-by-line scan rather than a single regex because JS
 * regex has no `\Z` (end-of-input) anchor, and the multiline-with-end-of-input
 * pattern is fragile. Line scan is straightforward and predictable.
 */
function maskFencedCodeBlocks(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let inFence = false;
    let fenceDelim: '```' | '~~~' | null = null;

    for (const line of lines) {
        // Detect a fence-delimiter line (optional leading horizontal whitespace,
        // then ``` or ~~~ optionally followed by a language tag / arbitrary text).
        const openMatch = /^[ \t]*(```|~~~)/.exec(line);

        if (!inFence) {
            if (openMatch) {
                // Open a fence. Mask this line (the opener itself is not content
                // we want to expose to heading-matching).
                inFence = true;
                fenceDelim = openMatch[1] as '```' | '~~~';
                out.push(' '.repeat(line.length));
            } else {
                out.push(line);
            }
        } else {
            // Inside a fence. Check whether this line closes the same fence type.
            // Closer must be the delimiter ALONE on a line (allowing leading
            // horizontal whitespace and optional trailing whitespace).
            // A1 fix (Jim's audit, 2026-05-26): `\r?` allows the optional
            // trailing `\r` left by `split('\n')` on CRLF input. Without it,
            // CRLF-terminated input never closes a fence — masking continues
            // to EOF, and a real `## C1` after the fence is missed. Symmetric
            // with the heading regex's `(?:$|\r?\n)`.
            const closerRegex = fenceDelim === '```'
                ? /^[ \t]*```[ \t]*\r?$/
                : /^[ \t]*~~~[ \t]*\r?$/;
            const isClose = closerRegex.test(line);
            // Mask all lines while in-fence (including the closer) — the heading
            // regex never sees fence content.
            out.push(' '.repeat(line.length));
            if (isClose) {
                inFence = false;
                fenceDelim = null;
            }
        }
    }

    // Unclosed fences: in-fence state at EOF is fine — the trailing content was
    // already masked. No special handling needed.
    return out.join('\n');
}
