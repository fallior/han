/**
 * MNT-060 addendum — the SWAP-ENTRY transport frame (Darron's design ruling, 2026-07-20 22:27).
 *
 * The `### `/`## ` delimiter class was ruled out as *"too dangerous — it looks like content
 * because it is content."* This module is the cure's single source of truth: a BIG, high-entropy
 * sentinel that is TRANSPORT, NOT PAYLOAD — the network-framing shape ("they do it in TCP
 * encapsulation, so why can't we"). Each swap entry opens with a frame line:
 *
 *     <!-- SWAP-ENTRY ts=2026-07-23T11:02:03+10:00 -->
 *
 * followed by the entry's own content (its `### ` heading + body — which ARE payload and flow
 * to WM unchanged, preserving the WM layer's downstream grammar for the sensor/rotation).
 *
 * The HDLC lineage, all four properties from the addendum:
 *   1. FRAME    — invisible in render, high-entropy, effectively unconfusable with prose. The
 *                 `ts=[0-9]…` shape requires a digit, so the taught placeholder `ts=<ISO>` in
 *                 guard/nag messages is INERT by construction (it can never parse as a frame).
 *   2. ESCAPING — any in-body occurrence (prose *quoting* a frame) is byte-stuffed at the
 *                 chokepoint (`sanitizeSwapFrameText`, the MNT-026 pattern): the `<!--` opener
 *                 is broken ONLY where it precedes SWAP-ENTRY, so no frame regex can ever match
 *                 quoted text. Parser and sanitiser are ONE chokepoint or they are a hole
 *                 (Tenshi finding 3).
 *   3. ENCAPSULATION — the flush strips frames and moves only payload (`stripSwapFrames`);
 *                 headers stripped at layer boundaries, exactly the TCP/IP shape. The sentinel
 *                 never reaches WM or the gradient, so wild occurrence tends to zero BY
 *                 CONSTRUCTION — nothing in any mind's memory ever teaches a seat to write one.
 *   4. ONE CONTRACT, BOTH HOOKS — the B-3 guard (memory-guard.sh) + the recorder
 *                 (orient-inject.sh) grep the IDENTICAL frame regex, and the flush gate
 *                 (wm-flush.sh) greps the IDENTICAL boundary family, as the sources below.
 *                 The suite string-compares all of them (the F1 gate==parser assert, extended)
 *                 so the hooks can never silently diverge from this module again.
 *
 * MIGRATION (the bell, 2026-07-23): canonical-frame on WRITE (the guard teaches it); the
 * transitional `### |## ` family stays accepted on READ (drains and stragglers) until a full
 * garden sweep shows zero legacy-grammar entries — retired declared-and-dated, never slipped.
 * Sweep owner: Tenshi; diarised 2026-08-23 (30 days post-land; early-run welcome once all
 * seats converge); the receipt — zero legacy entries garden-wide — recorded in the journal.
 *
 * RETIREMENT INVARIANT (Tenshi, 2026-07-23 — carried verbatim): the legacy family's
 * retirement is a MOVE, not a deletion — it leaves the LIVE gate but lives permanently in
 * the deliberate drain/rescue tooling, because the DEC-069 archives are legacy-format
 * forever. Deleting the acceptance wholesale would build a wall against our own past,
 * discovered mid-rescue.
 *
 * ARCHIVE RE-ENTRY (Casey, 2026-07-23): post-land, archived raw swaps legitimately contain
 * REAL transport frames (DEC-069 keeps them verbatim). They re-enter WM only through the
 * FLUSH path (strip-then-stuff) — never the appendPairedMemory belt alone, which sanitises
 * but rightly never strips, and would byte-stuff real transport into payload noise.
 */

/** The frame regex SOURCE — the one contract. `ts=` must start with a digit (see property 1).
 *  Kept as a plain string so the suite can compare the .sh hooks' grep patterns byte-for-byte. */
export const SWAP_FRAME_RE_SRC = '^<!-- SWAP-ENTRY ts=[0-9][^ ]* -->$';

/** Anywhere-in-file frame test (multiline). */
export const SWAP_FRAME_RE_M = new RegExp(SWAP_FRAME_RE_SRC, 'm');

/** All-frames matcher (strip/count). */
export const SWAP_FRAME_RE_G = new RegExp(SWAP_FRAME_RE_SRC, 'gm');

/** Entry-BOUNDARY family source for the flush parser + its .sh gate: canonical frame first,
 *  then the transitional content-shaped legacy (read-acceptance during migration only). */
export const ENTRY_BOUNDARY_RE_SRC = `(${SWAP_FRAME_RE_SRC.slice(1)}|### |## )`;

/** Compose a frame line for a new entry. */
export function swapFrame(ts: string = new Date().toISOString()): string {
    return `<!-- SWAP-ENTRY ts=${ts} -->`;
}

/**
 * ESCAPING (property 2) — neutralise frame-shaped text in PAYLOAD, the MNT-026 byte-stuffing
 * pattern (mirrors `sanitizeMarkerText` for WM-BOUNDARY): break the `<!--` opener with an
 * interpunct ONLY where it precedes SWAP-ENTRY, so no frame regex can match, while the quoted
 * text stays legible. Idempotent (`<!·--` never re-matches `<!--`).
 */
export function sanitizeSwapFrameText(content: string): string {
    return content.replace(/<!--(?=\s*SWAP-ENTRY)/g, '<!·--');
}

/**
 * ENCAPSULATION (property 3) — remove well-formed frame LINES (transport) from a body,
 * consuming each frame's own newline so payload lines keep their original spacing.
 */
export function stripSwapFrames(content: string): string {
    return content.replace(new RegExp(SWAP_FRAME_RE_SRC + '\\n?', 'gm'), '');
}

/** Count well-formed frame lines (the guard's advanced-this-turn measure, TS side). */
export function countSwapFrames(content: string): number {
    return content.match(SWAP_FRAME_RE_G)?.length ?? 0;
}
