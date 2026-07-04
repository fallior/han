/**
 * Memory paired-writer — atomic both-or-neither appends to the working-memory
 * pair (working-memory-full.md + working-memory.md).
 *
 * Future-idea #49 (S153, 2026-05-09): structural prevention of single-side
 * writes that produce silent c0/c1 drift in the gradient. Sibling-shape to
 * #53's pre-slice parity-check + drift signal. #53 detects drift after the
 * fact via fs.watch; #49 prevents drift at the API layer. Both layers run.
 *
 * Maturity-arc placement (per Jim's S150-extended pattern):
 *   1. Two-surface audit (static)               — static-time guarantee
 *   2. Pre-slice parity-check + drift signal    — runtime visibility (#53)
 *   3. Slice-time parity-check + smaller-of-two — runtime recovery (DEC-085)
 *   4. ATOMIC PAIRED-WRITE HELPER (THIS FILE)   — runtime prevention (#49)
 *   5. UserPromptSubmit hook                    — harness-enforced (#50)
 *
 * Contract:
 *   - Both content args required at the type level (TypeScript signature
 *     enforces; cannot be called single-side).
 *   - If both contents are empty (after trim), helper returns no-op.
 *   - If one content is empty and the other non-empty, helper THROWS — that
 *     is the drift mode this helper exists to prevent. Callers must validate
 *     symmetry upstream and preserve their swap state for retry / observation.
 *   - If both contents are non-empty, helper acquires the memory-slot lock
 *     (via withMemorySlot) and appends both files. On second-write failure,
 *     truncates the first file back to its pre-append size — both-or-neither
 *     at the FS level for the failure mode that matters.
 *
 * The throw on asymmetry is the load-bearing piece: it's what makes
 * single-side writes impossible by construction. Callers can't accidentally
 * pass empty for one and substantial for the other; if they do, the caller
 * gets a loud error and the data isn't lost (it stays in their swap files).
 */

import * as fs from 'fs';
import * as path from 'path';
import { gradientConfigForAgent } from './agent-registry';
import { withMemorySlot } from './memory-slot';
import { countTokens } from './token-counter';

/**
 * WM-BOUNDARY marker — paired-ID handshake between WMF and WM at slice time.
 *
 * DEC-085 Amendment 2026-05-10: marker is METADATA, not content. The slicer
 * strips the marker text from c0/c1 content before insert and stores the id
 * + timestamp in `qualifier` for audit. The marker's role is ID-handshake +
 * "ready-to-slice" signal — it does NOT determine slice position. The slicer
 * takes the WHOLE file content; live files reset to header-only after slice.
 */
const WM_BOUNDARY_REGEX_STRIP = /\n*<!--\s*WM-BOUNDARY:\s*id=[^\s]+\s+ts=[^\s]+(?:\s+fabricated=[^\s]+)?\s*-->\n*/g;
const WM_BOUNDARY_REGEX_PARSE = /<!--\s*WM-BOUNDARY:\s*id=([^\s]+)\s+ts=([^\s]+)(?:\s+fabricated=([^\s]+))?\s*-->/g;

/** Remove all WM-BOUNDARY markers from a content string (and surrounding blank lines). */
export function stripMarkers(content: string): string {
    return content.replace(WM_BOUNDARY_REGEX_STRIP, '\n');
}

/**
 * MNT-026 (S216): neutralise marker-shaped text in APPENDED CONTENT — the byte-stuffing
 * cure at the single append chokepoint. The threat is QUOTATION, not collision: a WM
 * entry that quotes a literal `<!-- WM-BOUNDARY: id=X ts=Y -->` (we discuss markers in
 * memory constantly; the docs carry the exact syntax) would parse as a REAL boundary —
 * and a quoted pair landing in both files could make `pickPairedBoundary` cut at prose;
 * `stripMarkers` at archive would silently DELETE the quoted text from c0 content
 * (lived-record mutation). The transform breaks the comment-open (`<!--` → `<!·--`)
 * ONLY where it precedes `WM-BOUNDARY`, so no regex (strip/parse/find) can match it,
 * while the mention stays human-legible in the record. Real markers are written only
 * by `placePairedMarker` / the repair script — downstream of this sanitiser.
 */
export function sanitizeMarkerText(content: string): string {
    return content.replace(/<!--(?=\s*WM-BOUNDARY)/g, '<!·--');
}

/** Parse all WM-BOUNDARY markers in a content string. */
export function parseMarkers(content: string): { id: string; timestamp: string; fabricated: boolean }[] {
    const out: { id: string; timestamp: string; fabricated: boolean }[] = [];
    const regex = new RegExp(WM_BOUNDARY_REGEX_PARSE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
        out.push({ id: m[1], timestamp: m[2], fabricated: m[3] === 'true' });
    }
    return out;
}

export interface AppendPairedMemoryOpts {
    /** Caller identifier for log context (e.g. 'leo-human-flush'). */
    source?: string;
    /**
     * If true (default), call `ensureMarkerOrFabricate(agent)` after the paired
     * write succeeds. The marker check is fast (read both files, count tokens,
     * scan for marker presence) and ensures a marker exists when WMF crosses
     * the autoFabricateAtTokens threshold (~25K). Set false in tests or when
     * the caller wants explicit control over marker placement.
     */
    ensureMarker?: boolean;
}

/**
 * Append paired content to the working-memory pair atomically (best-effort
 * at the FS level via rollback-on-second-failure; structurally enforced at
 * the API level).
 *
 * @param agent - Agent slug ('leo', 'jim', 'tenshi', 'casey', ...)
 * @param fullContent - Content to append to working-memory-full.md (must
 *                      be non-empty if compressedContent is non-empty)
 * @param compressedContent - Content to append to working-memory.md (must
 *                            be non-empty if fullContent is non-empty)
 * @param opts.source - Optional caller identifier for log context
 *
 * @throws Error if content is asymmetric (one side empty, the other not).
 * @throws Error if the second append fails (after rolling back the first).
 *               Rollback failure is logged but not re-thrown beyond the
 *               original error — files may be in inconsistent state in
 *               that worst-case scenario; manual intervention warranted.
 */
export async function appendPairedMemory(
    agent: string,
    fullContent: string,
    compressedContent: string,
    opts: AppendPairedMemoryOpts = {},
): Promise<void> {
    const cfg = gradientConfigForAgent(agent);
    const fullPath = path.join(cfg.memoryDir, 'working-memory-full.md');
    const compPath = path.join(cfg.memoryDir, 'working-memory.md');
    const source = opts.source ?? 'unknown';

    // MNT-026: byte-stuff marker-shaped text in incoming content at the ONE chokepoint —
    // quoted `<!-- WM-BOUNDARY …` prose can never parse as a real boundary downstream.
    fullContent = sanitizeMarkerText(fullContent);
    compressedContent = sanitizeMarkerText(compressedContent);

    const fullPresent = !!fullContent.trim();
    const compPresent = !!compressedContent.trim();

    // No-op for both-empty (legitimate "nothing to flush" case)
    if (!fullPresent && !compPresent) return;

    // Refuse asymmetric — preserves the structural promise.
    // Callers must validate symmetry upstream; on throw, swap state is
    // preserved (caller hasn't cleared swap yet) so next flush retries.
    if (fullPresent !== compPresent) {
        throw new Error(
            `appendPairedMemory: asymmetric content from ${source} for ${agent} ` +
            `(full=${fullContent.length}c present=${fullPresent}, ` +
            `comp=${compressedContent.length}c present=${compPresent}). ` +
            `Caller must pass both-or-neither; preserve swap state and retry.`,
        );
    }

    // Both present — pair-write under lock with rollback-on-second-failure
    const slotResult = await withMemorySlot(cfg.memoryDir, `${agent}-paired-write`, () => {
        const fullSizeBefore = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
        fs.appendFileSync(fullPath, fullContent);
        try {
            fs.appendFileSync(compPath, compressedContent);
            return true;
        } catch (err) {
            // Roll back the full append — both-or-neither at the FS level.
            try {
                fs.truncateSync(fullPath, fullSizeBefore);
            } catch (truncErr) {
                console.error(
                    `[appendPairedMemory] CRITICAL: rollback truncate failed for ${agent} (${source}): ` +
                    `${(truncErr as Error).message}. Files may be in inconsistent state — manual intervention warranted.`,
                );
            }
            throw new Error(
                `appendPairedMemory: comp append failed for ${agent} (${source}); ` +
                `rolled back full append: ${(err as Error).message}`,
            );
        }
    });

    // withMemorySlot returns null if it fails to acquire the lock after
    // MAX_RETRIES. Treat that as a failure to write — caller should preserve
    // swap state and retry next cycle.
    if (slotResult === null) {
        throw new Error(
            `appendPairedMemory: failed to acquire memory slot for ${agent} (${source}). ` +
            `Caller must preserve swap state and retry.`,
        );
    }

    // DEC-085 Amendment 2026-05-10: post-write marker check. If WMF has crossed
    // the auto-fabricate threshold (~25K tokens) and no marker exists yet, place
    // an auto-fabricated marker at end-of-file. Cheap (couple of reads); idempotent
    // when marker already exists.
    if (opts.ensureMarker !== false) {
        try {
            await ensureMarkerOrFabricate(agent, { source });
        } catch (err) {
            // Marker check failure is observability, not a write failure —
            // log loud but don't re-throw (the paired write itself succeeded).
            console.warn(
                `[appendPairedMemory] ensureMarkerOrFabricate failed for ${agent} (${source}): ` +
                `${(err as Error).message}`,
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// DEC-085 Amendment 2026-05-10: Marker primitives (one-marker-at-a-time +
// prompt-start auto-fabrication). See DECISIONS.md DEC-085 amendment.
// ──────────────────────────────────────────────────────────────────────────────

export interface PlacePairedMarkerOpts {
    /** Caller identifier for log context. */
    source?: string;
    /** If true, marker carries `fabricated=true` flag. Default false. */
    fabricated?: boolean;
    /**
     * MNT-023 root-cure (S216): keep existing markers — markers ACCUMULATE as cut
     * candidates (the recovered S210 design; the rotation consumes them by archiving
     * + its kept-head strip-all). Default false = the legacy strip-others behaviour
     * (semantic /pfc placements unchanged; flipping that default is a housekeeping
     * design conversation, MNT-025-adjacent, not this diff).
     */
    accumulate?: boolean;
}

/**
 * Atomically place a single WM-BOUNDARY marker at end-of-file in BOTH
 * working-memory files for the agent. Removes any pre-existing markers in
 * either file (one-marker-at-a-time discipline per Darron's S155 directive).
 *
 * The marker is the "ready-to-slice" signal + paired-ID handshake. It does
 * NOT determine slice position (the slicer takes whole-file regardless of
 * marker location). At slice time, the marker is stripped from c0/c1 content
 * and stored in `qualifier` as audit metadata.
 *
 * @returns the placed marker id (also embedded in both files)
 */
export async function placePairedMarker(
    agent: string,
    opts: PlacePairedMarkerOpts = {},
): Promise<string> {
    const cfg = gradientConfigForAgent(agent);
    const fullPath = path.join(cfg.memoryDir, 'working-memory-full.md');
    const compPath = path.join(cfg.memoryDir, 'working-memory.md');
    const source = opts.source ?? 'unknown';
    const fabricated = opts.fabricated ?? false;

    const id = fabricated ? `BF-${Date.now()}` : `B${Date.now()}`;
    const ts = new Date().toISOString();
    const fabFlag = fabricated ? ' fabricated=true' : '';
    const marker = `\n\n<!-- WM-BOUNDARY: id=${id} ts=${ts}${fabFlag} -->\n`;

    const slotResult = await withMemorySlot(cfg.memoryDir, `${agent}-marker-place`, () => {
        if (!fs.existsSync(fullPath) || !fs.existsSync(compPath)) {
            throw new Error(`placePairedMarker: paired files missing for ${agent}`);
        }
        const fullContent = fs.readFileSync(fullPath, 'utf8');
        const compContent = fs.readFileSync(compPath, 'utf8');

        // accumulate (MNT-023 root-cure): keep existing markers as cut candidates.
        // Legacy default: strip-others (one-marker-at-a-time, S155 — reversed at 06738be;
        // the auto-band placer passes accumulate:true; semantic /pfc callers unchanged).
        const fullStripped = opts.accumulate ? fullContent : stripMarkers(fullContent);
        const compStripped = opts.accumulate ? compContent : stripMarkers(compContent);

        // Append the new marker at end-of-file in both
        const fullSizeBefore = fs.statSync(fullPath).size;
        fs.writeFileSync(fullPath, fullStripped.replace(/\n+$/, '') + marker);
        try {
            fs.writeFileSync(compPath, compStripped.replace(/\n+$/, '') + marker);
            return true;
        } catch (err) {
            // Roll back full
            try { fs.truncateSync(fullPath, fullSizeBefore); } catch {/* best-effort */}
            throw new Error(
                `placePairedMarker: comp write failed for ${agent} (${source}): ${(err as Error).message}`,
            );
        }
    });

    if (slotResult === null) {
        throw new Error(`placePairedMarker: failed to acquire memory slot for ${agent} (${source})`);
    }

    return id;
}

export interface EnsureMarkerOpts {
    source?: string;
    /**
     * DEPRECATED (MNT-023 root-cure, S216): superseded by the harvest-band gate —
     * the band is read from live config (rollingWindowTail − rollingWindowHead …
     * rollingWindowTrigger; derived, never a hardcoded 5000 — Jim's band-drift nit).
     * Retained so pre-existing callers type-check; ignored.
     */
    autoFabricateAtTokens?: number;
}

/** The rotation's bands, from live config (fallback = the shipped defaults).
 *  harvestMin..max = where the rotation ACCEPTS a marker for a cut (Tail−Head … Trigger);
 *  placeMin = where PLACEMENT fires (Tail — Darron's design: "place the marker once we
 *  hit ~25K", so harvested c0s land at ≈ the 25K target, not the 20K band floor). */
function markerBands(): { harvestMin: number; placeMin: number; max: number } {
    try {
        const cfgJson = JSON.parse(fs.readFileSync(path.join(process.env.HOME ?? '', '.han', 'config.json'), 'utf8'));
        const tail = cfgJson.memory?.rollingWindowTail ?? 25_000;
        const head = cfgJson.memory?.rollingWindowHead ?? 5_000;
        const trigger = cfgJson.memory?.rollingWindowTrigger ?? 30_000;
        return { harvestMin: tail - head, placeMin: tail, max: trigger };
    } catch {
        return { harvestMin: 20_000, placeMin: 25_000, max: 30_000 };
    }
}

/**
 * The MNT-023 root-cure gate, pure + unit-testable. Decides marker placement for a
 * WMF content string (token positions from file start):
 *   - 'in-band-exists' — a marker already sits inside the HARVEST band
 *     [harvestMin, max]: the rotation's `pickPairedBoundary` will cut at it; place
 *     nothing. ONLY harvest-band markers count as supply — a stranded below-band
 *     marker (the 2026-07-02 stall: one at ~18.7K against a 20K floor, blocking
 *     all placement for three days) must NOT block.
 *   - 'out-of-band' — EOF below placeMin (wait for the ~Tail thought-edge —
 *     Darron's design, so the harvested c0 lands at ≈25K, not the band floor) or
 *     past max (an EOF marker would not be harvestable — dishonest; past-trigger
 *     recovery belongs to the bite-fabricator / the repair script, not here).
 *   - 'place' — EOF ∈ [placeMin, max] and no harvest-band marker exists: place NOW,
 *     at this thought-edge — harvestable AND at the designed c0 size by
 *     construction. (A chunky append leapfrogging placeMin→past-max gets no marker;
 *     the bite-fabricator is the named net — Jim's residual #1.)
 */
export function chooseMarkerAction(
    fullContent: string,
    bands: { harvestMin: number; placeMin: number; max: number } = markerBands(),
): 'in-band-exists' | 'out-of-band' | 'place' {
    const re = new RegExp(WM_BOUNDARY_REGEX_PARSE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullContent)) !== null) {
        const tokenPos = countTokens(fullContent.substring(0, m.index));
        if (tokenPos >= bands.harvestMin && tokenPos <= bands.max) return 'in-band-exists';
    }
    const eofTokens = countTokens(fullContent);
    if (eofTokens < bands.placeMin || eofTokens > bands.max) return 'out-of-band';
    return 'place';
}

/**
 * The MNT-023 ROOT-CURE (S216, Jim's audit requirements from the stranded-marker
 * forensics): keep the harvest band supplied. Whenever the WMF's EOF passes through
 * the band [Tail−Head, Trigger] with no in-band marker, place a fresh ACCUMULATING
 * paired marker at that thought-edge — so the rotation's primary path always has an
 * in-band candidate, regardless of whether any ritual (/pfc) ever runs. Replaces the
 * S155-relic any-marker-exists gate that starved the band (a stranded below-band
 * marker blocked all placement — MNT-023's root; the /pfc close was the only
 * accidental supply, retired by MNT-012).
 *
 * Called automatically after `appendPairedMemory` (via opts.ensureMarker, default
 * true) — every paired write is the placement hook; the just-flushed entry is a
 * genuine thought-edge.
 *
 * @returns 'fabricated' if a marker was placed, 'exists' if an in-band marker
 *          already covers the band, 'below-threshold' if EOF is outside the band
 *          (either side — the legacy name kept for callers' log strings),
 *          'paired-files-missing' if the files don't exist yet.
 */
export async function ensureMarkerOrFabricate(
    agent: string,
    opts: EnsureMarkerOpts = {},
): Promise<'fabricated' | 'exists' | 'below-threshold' | 'paired-files-missing'> {
    const cfg = gradientConfigForAgent(agent);
    const fullPath = path.join(cfg.memoryDir, 'working-memory-full.md');
    const compPath = path.join(cfg.memoryDir, 'working-memory.md');

    if (!fs.existsSync(fullPath) || !fs.existsSync(compPath)) return 'paired-files-missing';

    const fullContent = fs.readFileSync(fullPath, 'utf8');

    const action = chooseMarkerAction(fullContent);
    if (action === 'in-band-exists') return 'exists';
    if (action === 'out-of-band') return 'below-threshold';

    await placePairedMarker(agent, { source: opts.source ?? 'auto-band', fabricated: true, accumulate: true });
    return 'fabricated';
}
