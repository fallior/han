// terminal-anchor-diff.ts — the shared anchor-diff render core for capture-pane logs.
//
// Extracted from `services/terminal.ts:appendToLog` (S218, provenance build) so the
// interactive-seat log and the new per-spoke provenance log use ONE algorithm, not a
// twin (DEC-081). Pure and side-effect-free: it takes the previous capture state + a
// fresh capture-pane snapshot and returns the text to append plus the next state. The
// caller owns *where* the state lives (a module singleton for the interactive seat, a
// per-(agent,surface) Map for spokes) and *where* the output is written.
//
// The algorithm is byte-for-byte the one appendToLog shipped: last-non-empty-line as the
// scroll anchor; new content is everything after the anchor in the fresh snapshot; a
// missing anchor means a major screen change (compaction / context refresh) → emit a
// marker + all new content; action-verb lines that overwrite in place are recovered near
// the anchor; a 5-minute timestamp header rides the output. Noise lines never land.

const TIMESTAMP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Action verb pattern — these overwrite in-place but we want to capture them.
const ACTION_VERB_RE = /^\s*[✻✶✽⠋⠙⠹●◉]\s*(Worked|Cooked|Churned|Brewed|Shimmied|Calculated|Percolated|Baked|Crunched|Toiled|Crafted|Polished|Simmered|Contemplated|Meditated|Marinated|Choreographed|Percolating|Shimmying|Brewing|Choreographing|Simmering|Polishing|Contemplating|Meditating|Marinating|Toiling|Crafting|Working|Cooking|Churning|Calculating|Mulling|Reasoning)/i;

// Noise patterns — never write these to the log.
const NOISE_RE = [
    /^\s*[⏵⏴].*bypass permissions/,           // permission mode indicator
    /^\s*esc to interrupt\s*$/,                 // hint
    /^\s*shift\+tab to cycle\s*$/,              // hint
    /^[\s│─┌┐└┘├┤┬┴┼╔╗╚╝║═▐▛▜▝▘]+$/,         // box-drawing only
    /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*$/,                  // lone spinner chars
];

export function isNoise(line: string): boolean {
    return NOISE_RE.some((re) => re.test(line));
}

export interface AnchorState {
    /** the previous capture's lines (the diff anchor source) */
    prev: string[];
    /** epoch ms of the last emitted 5-minute timestamp header */
    lastTs: number;
}

export interface RenderResult {
    /** text to append to the log (empty string = nothing new this snapshot) */
    output: string;
    /** the next state to carry forward */
    state: AnchorState;
}

// DEC-105 G4: the zone is the CALLER's to supply (production passes gardenTimezone()) —
// the pure core no longer bakes a per-garden fact. The en-AU marker format is grandfathered
// as the one local-parsed-back site (terminal-search.ts parseAuMarker) and pinned as a
// writer/parser pair in scripts/test-garden-time.ts — keep the toLocaleString shape exact.
function tsHeader(now: number, zone: string): string {
    return `\n--- ${new Date(now).toLocaleString('en-AU', { timeZone: zone })} ---\n`;
}

/**
 * Render the append text for one capture-pane snapshot, given the prior state.
 * Byte-identical to the original appendToLog body; `now` is read once by the caller
 * (both the timestamp decision and the header format derive from the same instant).
 * `zone` — IANA zone for the marker headers (callers pass gardenTimezone(); DEC-105 G4).
 */
export function renderAppend(state: AnchorState, content: string, now: number, zone: string): RenderResult {
    const lines = content.split('\n');

    // First capture — write everything (minus noise), this is session start.
    if (state.prev.length === 0) {
        let output = tsHeader(now, zone);
        for (const line of lines) {
            if (!isNoise(line)) output += line + '\n';
        }
        return { output, state: { prev: lines.slice(), lastTs: now } };
    }

    const toWrite: string[] = [];

    // Last non-empty line of prev as our scroll anchor.
    let anchor = '';
    for (let i = state.prev.length - 1; i >= 0; i--) {
        if (state.prev[i].trim() !== '') { anchor = state.prev[i]; break; }
    }

    if (!anchor) {
        for (const line of lines) {
            if (!isNoise(line) && line.trim() !== '') toWrite.push(line);
        }
    } else {
        // Find the anchor in current capture (search from the end).
        let anchorIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i] === anchor) { anchorIdx = i; break; }
        }

        if (anchorIdx >= 0) {
            // New content is everything after the anchor.
            for (let i = anchorIdx + 1; i < lines.length; i++) {
                if (!isNoise(lines[i]) && lines[i].trim() !== '') toWrite.push(lines[i]);
            }
            // Recover action-verb lines that overwrote in place just above the anchor.
            const checkFrom = Math.max(0, anchorIdx - 5);
            const checkTo = Math.min(anchorIdx, state.prev.length);
            for (let i = checkFrom; i < checkTo; i++) {
                const prevLine = state.prev[state.prev.length - (anchorIdx - i) - 1];
                if (prevLine && lines[i] !== prevLine && ACTION_VERB_RE.test(lines[i])) {
                    toWrite.push(lines[i]);
                }
            }
        } else {
            // Anchor not found — major screen change (compaction / context refresh).
            toWrite.push('─── context refreshed ───');
            for (const line of lines) {
                if (!isNoise(line) && line.trim() !== '') toWrite.push(line);
            }
        }
    }

    if (toWrite.length === 0) {
        return { output: '', state: { prev: lines.slice(), lastTs: state.lastTs } };
    }

    let output = '';
    let lastTs = state.lastTs;
    if (now - lastTs >= TIMESTAMP_INTERVAL) {
        output += tsHeader(now, zone);
        lastTs = now;
    }
    output += toWrite.join('\n') + '\n';
    return { output, state: { prev: lines.slice(), lastTs } };
}
