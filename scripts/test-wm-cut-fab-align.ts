/*
 * Unit test — WM-rotation rectification (DEC-085 re-amendment, S210).
 * Pure functions, no DB. Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-wm-cut-fab-align.ts
 *
 * Locks two gradient-core invariants:
 *  1. pickPairedBoundary is TARGET-SEEKING (closest to the ~25K c0 target, in band) — not most-recent.
 *  2. fabricatePairedBoundary aligns the comp cut on the SAME WORK ENTRY (Jim's S210 must-fix):
 *     wm has MORE entries than wmf (dreams are wm-only), so the c0/c1 pair must cover the same
 *     WORK range — never the misaligned pair the index-cut produced.
 */
import { pickPairedBoundary, fabricatePairedBoundary } from '../src/server/lib/memory-gradient';
import { countTokens } from '../src/server/lib/token-counter';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
    if (cond) { pass++; console.log('  ✓', name); }
    else { fail++; console.log('  ✗ FAIL:', name); }
}

// ── Test 1: pickPairedBoundary — target-seeking, not most-recent ──────────────
const mk = (id: string, tokenPos: number, charPos: number) =>
    ({ id, timestamp: '2026-06-30T00:00:00Z', fabricated: false, charPos, tokenPos });
{
    const full = [mk('m10k', 10000, 100), mk('m25k', 25000, 250), mk('m29k', 29000, 290)];
    const comp = [mk('m10k', 10000, 80), mk('m25k', 25000, 200), mk('m29k', 29000, 240)];
    const choice = pickPairedBoundary(full, comp, 25000, 20000, 30000);
    check('picks the ~25K marker (target-seeking, in band)', choice?.full.id === 'm25k');
    check('does NOT pick the most-recent (29K) marker', choice?.full.id !== 'm29k');
    check('excludes the below-min (10K) marker', choice?.full.id !== 'm10k');
    // no paired marker in band → null
    const none = pickPairedBoundary([mk('x', 5000, 10)], [mk('x', 5000, 10)], 25000, 20000, 30000);
    check('returns null when no marker sits in the band', none === null);
}

// ── Test 2: fabricatePairedBoundary — work-entry alignment (Jim's example) ────
// full = [w1,w2,w3,w4] (work only); comp = [w1,dA,w2,w3,dB,w4] (dreams are wm-only).
function entry(head: string, body: string) { return `### ${head} (2026-06-30)\n${body}`; }
{
    const pad = 'padding word '.repeat(20);
    const w = (n: number) => entry(`Work ${n}`, `work body ${n} ${pad}`);
    const d = (s: string) => entry(`Dream ${s}`, `dream body ${s} ${pad}`);
    const full = `# WMF\n\n` + [w(1), w(2), w(3), w(4)].join('\n');
    const comp = `# WM\n\n` + [w(1), d('A'), w(2), w(3), d('B'), w(4)].join('\n');

    // Force fabricationIndex = 3 (cut after w3): minTail just below w1+w2+w3 cumulative,
    // maxTail just above it but below the w4 cumulative.
    const t = (n: number) => countTokens(w(n).trim());
    const after3 = t(1) + t(2) + t(3);
    const minTail = after3 - 2;
    const maxTail = after3 + 2; // < after3 + t(4) so w4 is excluded

    const fab = fabricatePairedBoundary(full, comp, minTail, maxTail);
    check('fab returns a result (aligned pair)', !!fab);
    if (fab) {
        const fullBefore = fab.fullModified.split('WM-BOUNDARY')[0];
        const compBefore = fab.compModified.split('WM-BOUNDARY')[0];
        const has = (s: string, h: string) => s.includes(h);
        // c0 (full before marker): w1,w2,w3 but not w4
        check('c0 includes Work 1,2,3', ['Work 1', 'Work 2', 'Work 3'].every(h => has(fullBefore, h)));
        check('c0 excludes Work 4', !has(fullBefore, 'Work 4'));
        // c1 (comp before marker): the bug was c1 MISSING Work 3 — assert it is present
        check('c1 includes Work 1,2,3 (NOT missing Work 3 — the bug)', ['Work 1', 'Work 2', 'Work 3'].every(h => has(compBefore, h)));
        check('c1 excludes Work 4', !has(compBefore, 'Work 4'));
        // dreams: A (before the cut) into c1; B (after the cut) rides forward
        check('c1 includes Dream A (interleaved before the cut)', has(compBefore, 'Dream A'));
        check('c1 excludes Dream B (after the cut → kept head)', !has(compBefore, 'Dream B'));
    }

    // ── Test 3: fail-safe — a work entry missing from comp → null, never a misaligned pair ──
    const compBroken = `# WM\n\n` + [w(1), w(2), d('B'), w(4)].join('\n'); // Work 3 absent in comp
    const fabBroken = fabricatePairedBoundary(full, compBroken, minTail, maxTail);
    check('fail-safe: returns null when a work entry cannot be aligned', fabBroken === null);
}

console.log(`\nwm-cut-fab-align: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
