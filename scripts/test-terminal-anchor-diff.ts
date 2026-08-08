#!/usr/bin/env tsx
// test-terminal-anchor-diff.ts — BYTE-IDENTITY proof for the appendToLog → renderAppend extraction
// (S218, build B increment 2). The interactive-seat log surface wears the DEC-013 WS-flood scar, so
// the refactor must be proven identical, not asserted. Method: an ORACLE that is a self-contained,
// line-for-line copy of the ORIGINAL `services/terminal.ts:appendToLog` body (its own inlined
// NOISE_RE / ACTION_VERB_RE / logic, clock-injected — independent of the module under test), fuzzed
// against `renderAppend` over thousands of randomized capture sequences. Every step must agree on
// BOTH the appended output string AND the carried state, byte-for-byte.
//
//   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-terminal-anchor-diff.ts

import { renderAppend } from '../src/server/lib/terminal-anchor-diff';

// ── ORACLE: verbatim reproduction of the pre-refactor terminal.ts logic (lines 185-305) ──────
const O_TIMESTAMP_INTERVAL = 5 * 60 * 1000;
const O_ACTION_VERB_RE = /^\s*[✻✶✽⠋⠙⠹●◉]\s*(Worked|Cooked|Churned|Brewed|Shimmied|Calculated|Percolated|Baked|Crunched|Toiled|Crafted|Polished|Simmered|Contemplated|Meditated|Marinated|Choreographed|Percolating|Shimmying|Brewing|Choreographing|Simmering|Polishing|Contemplating|Meditating|Marinating|Toiling|Crafting|Working|Cooking|Churning|Calculating|Mulling|Reasoning)/i;
const O_NOISE_RE = [
    /^\s*[⏵⏴].*bypass permissions/,
    /^\s*esc to interrupt\s*$/,
    /^\s*shift\+tab to cycle\s*$/,
    /^[\s│─┌┐└┘├┤┬┴┼╔╗╚╝║═▐▛▜▝▘]+$/,
    /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*$/,
];
function oIsNoise(line: string): boolean { return O_NOISE_RE.some((re) => re.test(line)); }

interface OState { prev: string[]; lastTs: number; }
// Faithful port: returns the exact string the original would have appended, plus the next state.
function oracleAppend(state: OState, content: string, now: number): { output: string; state: OState } {
    const lines = content.split('\n');
    const header = `\n--- ${new Date(now).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} ---\n`;

    if (state.prev.length === 0) {
        let output = header;
        for (const line of lines) { if (!oIsNoise(line)) output += line + '\n'; }
        return { output, state: { prev: lines.slice(), lastTs: now } };
    }

    const toWrite: string[] = [];
    let anchor = '';
    for (let i = state.prev.length - 1; i >= 0; i--) { if (state.prev[i].trim() !== '') { anchor = state.prev[i]; break; } }

    if (!anchor) {
        for (const line of lines) { if (!oIsNoise(line) && line.trim() !== '') toWrite.push(line); }
    } else {
        let anchorIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) { if (lines[i] === anchor) { anchorIdx = i; break; } }
        if (anchorIdx >= 0) {
            for (let i = anchorIdx + 1; i < lines.length; i++) {
                if (!oIsNoise(lines[i]) && lines[i].trim() !== '') toWrite.push(lines[i]);
            }
            const checkFrom = Math.max(0, anchorIdx - 5);
            const checkTo = Math.min(anchorIdx, state.prev.length);
            for (let i = checkFrom; i < checkTo; i++) {
                const prevLine = state.prev[state.prev.length - (anchorIdx - i) - 1];
                if (prevLine && lines[i] !== prevLine && O_ACTION_VERB_RE.test(lines[i])) toWrite.push(lines[i]);
            }
        } else {
            toWrite.push('─── context refreshed ───');
            for (const line of lines) { if (!oIsNoise(line) && line.trim() !== '') toWrite.push(line); }
        }
    }

    if (toWrite.length === 0) return { output: '', state: { prev: lines.slice(), lastTs: state.lastTs } };
    let output = '';
    let lastTs = state.lastTs;
    if (now - lastTs >= O_TIMESTAMP_INTERVAL) { output += header; lastTs = now; }
    output += toWrite.join('\n') + '\n';
    return { output, state: { prev: lines.slice(), lastTs } };
}

// ── deterministic PRNG so the fuzz is reproducible (Math.random varies per run) ──────────────
let seed = 0x9e3779b9;
function rnd(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick<T>(a: T[]): T { return a[Math.floor(rnd() * a.length)]; }

const CONTENT_LINES = [
    'user: hello there', 'assistant: working on it', '● Read file.ts', 'TXN output line',
    '  some indented detail', 'a result row', 'another row', '✻ Percolating… (12s)',
    '● Worked for 2m 14s · 4.1k tokens', 'esc to interrupt', 'shift+tab to cycle',
    '⏵ bypass permissions on', '│ box │', '⠋', '', '   ', 'unique-marker-' /* + idx appended */,
];

// Build a random capture snapshot that mimics a scrolling TUI: a moving window over a growing
// virtual buffer, occasional in-place edits, noise lines, and rare full-screen replacements.
function makeSequence(steps: number): string[] {
    const seq: string[] = [];
    let buffer: string[] = [];
    for (let s = 0; s < steps; s++) {
        if (rnd() < 0.08) { buffer = []; } // rare full-screen refresh (anchor loss)
        const add = Math.floor(rnd() * 6);
        for (let k = 0; k < add; k++) {
            let ln = pick(CONTENT_LINES);
            if (ln === 'unique-marker-') ln += `${s}-${k}`;
            buffer.push(ln);
        }
        if (rnd() < 0.3 && buffer.length) buffer[buffer.length - 1] = pick(CONTENT_LINES); // in-place edit of last line
        const win = 44; // viewport height
        seq.push(buffer.slice(Math.max(0, buffer.length - win)).join('\n'));
    }
    return seq;
}

let pass = 0, fail = 0, steps = 0;
const NOW0 = 1_700_000_000_000;

for (let run = 0; run < 200; run++) {
    const seq = makeSequence(30 + Math.floor(rnd() * 40));
    let os: OState = { prev: [], lastTs: 0 };
    let rs = { prev: [] as string[], lastTs: 0 };
    for (let i = 0; i < seq.length; i++) {
        const now = NOW0 + i * (rnd() < 0.15 ? 6 * 60 * 1000 : 500); // occasionally cross the 5-min header boundary
        const o = oracleAppend(os, seq[i], now);
        const r = renderAppend(rs, seq[i], now, 'Australia/Brisbane'); // explicit zone matches the oracle's literal (DEC-105 G4: zone is the caller's)
        steps++;
        if (o.output !== r.output) {
            fail++;
            if (fail <= 3) {
                console.log(`✗ run${run} step${i}: OUTPUT differs`);
                console.log('  oracle:', JSON.stringify(o.output.slice(0, 160)));
                console.log('  render:', JSON.stringify(r.output.slice(0, 160)));
            }
        } else if (JSON.stringify(o.state.prev) !== JSON.stringify(r.state.prev) || o.state.lastTs !== r.state.lastTs) {
            fail++;
            if (fail <= 3) console.log(`✗ run${run} step${i}: STATE differs`);
        } else { pass++; }
        os = o.state; rs = r.state;
    }
}

console.log(`\nbyte-identity fuzz: ${pass}/${steps} steps identical (oracle == renderAppend), ${fail} divergent`);
process.exit(fail ? 1 : 0);
