#!/usr/bin/env tsx
/**
 * scripts/mnt023-heading-repair.ts — the MNT-023 recovery: heading harmonisation (phase-1)
 * + ITERATIVE paired drain-marker seeding (phase-3, road (C) — Jim's ruling msg 199,
 * iterative single-seed form per his RED must-fix msg 201).
 *
 * WHY (MNT-023): the WM rotation has been failing SAFE since 2026-07-02 07:38 — the pair
 * files carry frozen-spoke-era double-records and minute-skewed stamps the fabricator's
 * strict aligner (rightly) refuses to guess across, and the writer's one-marker-era relic
 * starved the primary marker path. Jim's ruling: seed paired WM-BOUNDARY markers at anchor
 * points of known correspondence and let the rotation's PRIMARY path (`pickPairedBoundary`)
 * drain the backlog with its proven machinery.
 *
 * THE ITERATIVE FORM (Jim's must-fix, traced at memory-gradient.ts:1887): the REAL rotation
 * keeps `header + stripMarkers(slice(markerPos))` — it STRIPS ALL markers from the kept
 * head at every cut, so a pre-laid ladder of N markers dies at cut 1. Therefore:
 *   - each RUN of this script seeds exactly ONE rung — the in-band anchor closest to the
 *     ~25K tail target — (+ the phase-1 rewrites on the first pass; idempotent after);
 *   - the fs.watch sensor fires on the write → the rotation cuts that rung within moments;
 *   - re-run the script for the next rung. ~5 passes projected for the current backlog.
 *   - If an in-band marker is ALREADY present (a seeded rung the rotation hasn't consumed
 *     yet), the script reports ROTATION-PENDING and refuses to double-seed.
 *
 * WHAT EACH RUN DOES:
 *   phase-1 (comp-only, headings-only, idempotent): rewrites COMP heading lines to FULL's
 *     verbatim for confident pairs (normalised-heading-ts unique on both sides). DEC-069
 *     clean: no entry added/removed; body bytes untouched; WMF headings never modified.
 *   phase-2 (census, read-only): unpaired FULL entries reported — they drain as the lived
 *     record (Jim: no content ruling needed; consolidation is a later gradient-side op).
 *   phase-3 (BOTH files): inserts ONE paired `<!-- WM-BOUNDARY: id=BR-<ts>-0 ts=… -->`
 *     immediately BEFORE the chosen anchor entry in each file. ANCHOR = ts-unique both
 *     sides + heading-identical post-rewrite + chronological files ⇒ "the same temporal
 *     point in both files", by construction (grade A = bodies also string-equal, rare by
 *     design; grade B = the normal case — Jim's amended ask #1). PROVENANCE rides the
 *     `BR-` id (the marker regex tolerates only a `fabricated=` attr; the rotation stores
 *     the boundary id in the c0/c1 `qualifier` — the forensic trail).
 *
 * ACCEPTANCE (both modes): the whole ITERATIVE drain is simulated with the REAL cut
 * semantics — `header + stripMarkers(slice(pick.charPos))`, the real `pickPairedBoundary`,
 * anchors recomputed each pass — and the projected pass schedule printed. `--apply`
 * REFUSES unless this run's own cut is provable.
 *
 * SAFETY: dry-run default. `--apply` = memory slot (the writers' own lock) → byte-recheck
 * BOTH files vs plan-time content (exit 4 on a concurrent writer) → backup BOTH beside
 * themselves (kept, DEC-069) → temp+rename BOTH with both-or-neither rollback (full
 * restored from backup if comp's rename fails). `--agent` required (S103 — the owner's hand).
 *
 * Usage:
 *   npx tsx scripts/mnt023-heading-repair.ts --agent=leo            # dry-run (default)
 *   npx tsx scripts/mnt023-heading-repair.ts --agent=leo --apply    # one pass, after GREEN
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gradientConfigForAgent } from '../src/server/lib/agent-registry';
import {
    splitMemoryFileEntries, findWmBoundaries, pickPairedBoundary,
    type MemoryFileEntry,
} from '../src/server/lib/memory-gradient';
import { stripMarkers } from '../src/server/lib/memory-paired-writer';
import { withMemorySlot } from '../src/server/lib/memory-slot';
import { countTokens } from '../src/server/lib/token-counter';

const agentArg = process.argv.find(a => a.startsWith('--agent='))?.slice('--agent='.length);
const APPLY = process.argv.includes('--apply');
if (!agentArg) { console.error('usage: mnt023-heading-repair.ts --agent=<slug> [--apply]'); process.exit(1); }
const agent = agentArg;

const cfg = gradientConfigForAgent(agent);
const memoryDir = cfg.memoryDir;
const FULL_PATH = path.join(memoryDir, 'working-memory-full.md');
const COMP_PATH = path.join(memoryDir, 'working-memory.md');

// The live rotation band (config, token units).
const hanConfig = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.han', 'config.json'), 'utf-8'));
const TAIL = hanConfig.memory?.rollingWindowTail ?? 25_000;      // target c0 size
const HEAD = hanConfig.memory?.rollingWindowHead ?? 5_000;
const MIN_TAIL = TAIL - HEAD;                                     // 20K — mirrors the rotation's call
const TRIGGER = hanConfig.memory?.rollingWindowTrigger ?? 30_000;

/** Normalised heading timestamp — the conservative pairing key. 24h + ISO 'T…Z' + '~'
 *  approx + 12-hour am/pm (pm adds 12h; 12am → 00). Seconds/ms dropped. */
function normTs(headingLine: string): string | null {
    const paren = headingLine.match(/\((20\d{2}-\d{2}-\d{2})[T ]\s*~?\s*(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z?\s*(am|pm)?/i);
    if (!paren) return null;
    let h = parseInt(paren[2], 10);
    const ampm = paren[4]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${paren[1]} ${String(h).padStart(2, '0')}:${paren[3]}`;
}

function headingLineOf(e: MemoryFileEntry): string {
    return e.content.split('\n', 1)[0];
}

function tsIndex(entries: MemoryFileEntry[]): { map: Map<string, number>; ambiguous: Set<string> } {
    const seen = new Map<string, number[]>();
    entries.forEach((e, i) => {
        const heading = headingLineOf(e);
        if (!heading.startsWith('###')) return;
        const ts = normTs(heading);
        if (!ts) return;
        (seen.get(ts) ?? seen.set(ts, []).get(ts)!).push(i);
    });
    const map = new Map<string, number>();
    const ambiguous = new Set<string>();
    for (const [ts, idxs] of seen) {
        if (idxs.length === 1) map.set(ts, idxs[0]);
        else ambiguous.add(ts);
    }
    return { map, ambiguous };
}

type Anchor = { fi: number; ci: number; ts: string; heading: string; grade: 'A' | 'B'; fullTok: number; fullCharStart: number; compCharStart: number };

/** Anchor pool on a (full, comp) content pair: ts-unique both sides, identical headings. */
function computeAnchors(fullC: string, compC: string): { anchors: Anchor[]; fullEntries: MemoryFileEntry[]; compEntries: MemoryFileEntry[] } {
    const fullEntries = splitMemoryFileEntries(fullC);
    const compEntries = splitMemoryFileEntries(compC);
    const fIdx = tsIndex(fullEntries);
    const cIdx = tsIndex(compEntries);
    let tok = 0; const tokAt: number[] = [];
    for (const e of fullEntries) { tokAt.push(tok); tok += countTokens(e.content); }
    const anchors: Anchor[] = [];
    for (const [ts, fi] of fIdx.map) {
        const ci = cIdx.map.get(ts);
        if (ci === undefined) continue;
        const fh = headingLineOf(fullEntries[fi]);
        if (fh !== headingLineOf(compEntries[ci]) || !fh.startsWith('###')) continue;
        anchors.push({
            fi, ci, ts, heading: fh,
            grade: fullEntries[fi].content === compEntries[ci].content ? 'A' : 'B',
            fullTok: tokAt[fi],
            fullCharStart: fullEntries[fi].charStart,
            compCharStart: compEntries[ci].charStart,
        });
    }
    anchors.sort((a, b) => a.fi - b.fi);
    return { anchors, fullEntries, compEntries };
}

/** The rung for the CURRENT state: the in-band anchor closest to TAIL. */
function chooseRung(anchors: Anchor[]): Anchor | null {
    const inBand = anchors.filter(a => a.fullTok >= MIN_TAIL && a.fullTok <= TRIGGER);
    if (!inBand.length) return null;
    return inBand.reduce((best, a) => Math.abs(a.fullTok - TAIL) < Math.abs(best.fullTok - TAIL) ? a : best);
}

/** Insert one paired marker before the anchor in both contents (prebuilt text → identical). */
function insertPairedMarker(fullC: string, compC: string, a: Anchor, markerText: string): { full: string; comp: string } {
    return {
        full: fullC.substring(0, a.fullCharStart) + markerText + fullC.substring(a.fullCharStart),
        comp: compC.substring(0, a.compCharStart) + markerText + compC.substring(a.compCharStart),
    };
}

/** The REAL cut (memory-gradient.ts:1887 semantics): header + stripMarkers(slice(charPos)). */
function realCut(content: string, headerText: string, charPos: number): string {
    return headerText + stripMarkers(content.substring(charPos));
}

function main() {
    const fullContent = fs.readFileSync(FULL_PATH, 'utf-8');
    const compContent = fs.readFileSync(COMP_PATH, 'utf-8');
    console.log(`[mnt023] ${agent}: full=${countTokens(fullContent)} tok, comp=${countTokens(compContent)} tok; band [${MIN_TAIL}, ${TRIGGER}], target ${TAIL}`);

    // ── ROTATION-PENDING guard: an unconsumed in-band marker means the rotation owes a cut ──
    const liveBoundaries = findWmBoundaries(fullContent);
    const pendingPick = pickPairedBoundary(liveBoundaries, findWmBoundaries(compContent), TAIL, MIN_TAIL, TRIGGER);
    if (pendingPick) {
        console.log(`[mnt023] ROTATION-PENDING: in-band paired marker ${pendingPick.full.id} already present @~${pendingPick.full.tokenPos} tok — the sensor's next fire cuts it. No seed this run.`);
        process.exit(APPLY ? 0 : 0);
    }

    // ── PHASE-1: the rewrite plan (idempotent — 0 on passes after the first) ──
    const fullEntries0 = splitMemoryFileEntries(fullContent);
    const compEntries0 = splitMemoryFileEntries(compContent);
    const fIdx0 = tsIndex(fullEntries0);
    const cIdx0 = tsIndex(compEntries0);
    type Rewrite = { compIdx: number; from: string; to: string; ts: string };
    const rewrites: Rewrite[] = [];
    const unpairedFull: { idx: number; heading: string; reason: string }[] = [];
    for (const [ts, fi] of fIdx0.map) {
        const fHeading = headingLineOf(fullEntries0[fi]);
        const ci = cIdx0.map.get(ts);
        if (ci === undefined) {
            unpairedFull.push({ idx: fi, heading: fHeading, reason: cIdx0.ambiguous.has(ts) ? 'comp-side ambiguous' : 'no comp entry at this ts' });
            continue;
        }
        const cHeading = headingLineOf(compEntries0[ci]);
        if (cHeading !== fHeading) rewrites.push({ compIdx: ci, from: cHeading, to: fHeading, ts });
    }
    for (const ts of fIdx0.ambiguous) {
        fullEntries0.forEach((e, i) => {
            if (normTs(headingLineOf(e)) === ts) unpairedFull.push({ idx: i, heading: headingLineOf(e), reason: 'full-side ambiguous (dup-record family — drains as the lived record)' });
        });
    }
    rewrites.sort((a, b) => a.compIdx - b.compIdx);
    console.log(`\n── PHASE-1 rewrites (comp headings → full's verbatim): ${rewrites.length}${rewrites.length === 0 ? ' (idempotent — already applied or none needed)' : ''} ──`);
    for (const r of rewrites) console.log(`  comp[${r.compIdx}] (${r.ts})\n    − ${r.from}\n    + ${r.to}`);
    console.log(`── PHASE-2 census: ${unpairedFull.length} unpaired FULL entries (no ruling needed — they drain as-is) ──`);

    // Apply phase-1 in memory (comp only; byte-range rebuild).
    let compRewritten = compContent;
    if (rewrites.length) {
        let cursor = 0; const parts: string[] = [];
        for (const r of rewrites) {
            const e = compEntries0[r.compIdx];
            parts.push(compContent.substring(cursor, e.charStart), r.to);
            cursor = e.charStart + r.from.length;
        }
        parts.push(compContent.substring(cursor));
        compRewritten = parts.join('');
    }

    // ── THIS RUN's rung ──
    const { anchors } = computeAnchors(fullContent, compRewritten);
    console.log(`\n── PHASE-3 anchor pool: ${anchors.length} (A: ${anchors.filter(a => a.grade === 'A').length} / B: ${anchors.filter(a => a.grade === 'B').length}) ──`);
    const rung = chooseRung(anchors);
    if (!rung) {
        const total = countTokens(fullContent);
        if (total <= TRIGGER) { console.log(`[mnt023] DRAINED: file ≤ trigger (${total} tok) — nothing to do.`); process.exit(0); }
        console.error(`[mnt023] STALL: no in-band anchor for this pass (file ${total} tok) — see the census; a ruling or a manual anchor is needed.`);
        process.exit(3);
    }
    const seedTs = Date.now();
    const markerText = `\n\n<!-- WM-BOUNDARY: id=BR-${seedTs}-0 ts=${new Date(seedTs).toISOString()} -->\n\n`;
    console.log(`\n── THIS PASS seeds ONE rung: BR-${seedTs}-0 before full[${rung.fi}]/comp[${rung.ci}] @~${rung.fullTok} tok (grade ${rung.grade}) ──\n    ${rung.heading}`);
    const seeded = insertPairedMarker(fullContent, compRewritten, rung, markerText);

    // ── ACCEPTANCE: this pass's cut + the full ITERATIVE projection (REAL cut semantics) ──
    console.log(`\n── SIMULATION (real pickPairedBoundary + REAL strip-all cut, iterating passes) ──`);
    const fullHeaderText = fullContent.substring(0, fullEntries0[0].charStart);
    const compHeaderText = compContent.substring(0, compEntries0[0].charStart);
    let simFull = seeded.full, simComp = seeded.comp, passes = 0, thisPassOk = false;
    for (;;) {
        const pick = pickPairedBoundary(findWmBoundaries(simFull), findWmBoundaries(simComp), TAIL, MIN_TAIL, TRIGGER);
        if (!pick) { console.log(`  pass ${passes + 1}: no in-band paired marker — unexpected (seeded rung should be in-band)`); break; }
        passes++;
        if (passes === 1) thisPassOk = true;
        console.log(`  pass ${passes}: cut at ${pick.full.id} — archives ~${pick.full.tokenPos} tok (c0) / ~${pick.compressed.tokenPos} tok (c1)`);
        simFull = realCut(simFull, fullHeaderText, pick.full.charPos);
        simComp = realCut(simComp, compHeaderText, pick.compressed.charPos);
        const remaining = countTokens(simFull);
        console.log(`    → remaining full ≈ ${remaining} tok (ALL markers stripped from the kept head — the real machine)`);
        if (remaining <= TRIGGER) { console.log(`  drained after ${passes} more pass(es) beyond this state? No — under the trigger NOW.`); break; }
        // Project the NEXT pass: recompute anchors on the post-cut state and seed its rung.
        const nxt = computeAnchors(simFull, simComp);
        const nextRung = chooseRung(nxt.anchors);
        if (!nextRung) { console.log(`  ⚠ projected STALL at ~${remaining} tok: no in-band anchor after this cut — a later pass will need the census/ruling.`); break; }
        const mt = `\n\n<!-- WM-BOUNDARY: id=BR-sim-${passes} ts=${new Date(seedTs).toISOString()} -->\n\n`;
        const s2 = insertPairedMarker(simFull, simComp, nextRung, mt);
        simFull = s2.full; simComp = s2.comp;
    }
    const endTok = countTokens(simFull);
    console.log(`  PROJECTION: ${passes} apply-pass(es) total → final full ≈ ${endTok} tok (${endTok <= TRIGGER ? 'fully drained ✓' : '⚠ stalls before the trigger — see above'})`);

    if (!APPLY) {
        console.log(`\n[mnt023] DRY-RUN complete — nothing written. --apply seeds THIS pass's single rung.`);
        process.exit(thisPassOk ? 0 : 3);
    }
    if (!thisPassOk) { console.error('[mnt023] REFUSING --apply: this pass\'s own cut is not provable.'); process.exit(3); }

    // ── APPLY (one pass): slot-locked, both files, both-or-neither ──
    void withMemorySlot(memoryDir, `${agent}-mnt023-repair`, async () => {
        const nowFull = fs.readFileSync(FULL_PATH, 'utf-8');
        const nowComp = fs.readFileSync(COMP_PATH, 'utf-8');
        if (nowFull !== fullContent || nowComp !== compContent) {
            console.error('[mnt023] REFUSING --apply: a file changed since the plan was computed (a writer ran). Re-run.');
            process.exit(4);
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const bakFull = `${FULL_PATH}.bak-mnt023-${ts}`;
        const bakComp = `${COMP_PATH}.bak-mnt023-${ts}`;
        fs.copyFileSync(FULL_PATH, bakFull);
        fs.copyFileSync(COMP_PATH, bakComp);
        fs.writeFileSync(`${FULL_PATH}.tmp-mnt023`, seeded.full);
        fs.writeFileSync(`${COMP_PATH}.tmp-mnt023`, seeded.comp);
        fs.renameSync(`${FULL_PATH}.tmp-mnt023`, FULL_PATH);
        try {
            fs.renameSync(`${COMP_PATH}.tmp-mnt023`, COMP_PATH);
        } catch (e) {
            fs.copyFileSync(bakFull, FULL_PATH); // both-or-neither
            console.error('[mnt023] comp write failed — full ROLLED BACK from backup. Nothing changed.', e);
            process.exit(6);
        }
        console.log(`[mnt023] PASS APPLIED: ${rewrites.length} headings harmonised + rung BR-${seedTs}-0 seeded @~${rung.fullTok} tok.`);
        console.log(`[mnt023] backups: ${bakFull} + ${bakComp} (kept, DEC-069).`);
        console.log('[mnt023] the sensor fires on this write → the rotation cuts this rung. Watch wm-rotation-events.jsonl, then RE-RUN for the next pass.');
    }).then(r => { if (r === null) { console.error('[mnt023] could not acquire the memory slot — a writer holds it; re-run.'); process.exit(5); } });
}

main();
