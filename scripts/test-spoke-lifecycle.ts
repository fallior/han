/**
 * P1 (#warm-dispatch, S200) — proves the generic spoke monitor:
 *   1. spokeLifecycleFor resolves the registry thresholds (garden defaults + the no-hidden-globals
 *      principle: the numbers come from GARDEN_MANIFEST, not code) — unknown → defaults (fail-safe).
 *   2. verifyWarmOrNudge (the warm-gate): warm spoke → no nudge; shallow spoke → bounded full-load
 *      nudge → returns when warm; stays-cold → fail-safe SessionNotReadyError (no hollow answers).
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-spoke-lifecycle.ts
 * EXIT 0 iff every assertion holds.
 */
import * as os from 'os';
import * as path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { spokeLifecycleFor, GARDEN_MANIFEST } from '../src/server/lib/garden-manifest';
import { verifyWarmOrNudge, __setTestHooks, SessionNotReadyError } from '../src/server/lib/tmux-dispatcher';

let failures = 0;
const ok = (c: boolean, m: string) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const SLUG = 'testwarm', SURFACE = 'unit';
const ctxFile = path.join(os.homedir(), '.han', 'health', `${SLUG}-${SURFACE}-ctx.json`);
const setCtx = (pct: number) => writeFileSync(ctxFile, JSON.stringify({ context_window: { used_percentage: pct } }));
const clearCtx = () => { try { rmSync(ctxFile); } catch { /* none */ } };

async function main() {
    console.log('[1] spokeLifecycleFor — registry-sourced thresholds (no hidden code globals)');
    const def = GARDEN_MANIFEST.spokeLifecycle;
    ok(def.ctxClearThresholdPct === 85, `garden default clear threshold === 85 (from the manifest)`);
    ok(def.warmFloorPct === 30 && def.maxWarmNudges === 2, `garden defaults warmFloor=30 maxNudges=2`);
    const leoBeat = spokeLifecycleFor('leo', 'heartbeat');
    ok(leoBeat.ctxClearThresholdPct === 85 && leoBeat.warmFloorPct === 30, `leo/heartbeat resolves to the garden defaults`);
    const unknown = spokeLifecycleFor('nobody', 'nosuch');
    ok(unknown.ctxClearThresholdPct === 85 && unknown.maxWarmNudges === 2, `unknown slug/surface → garden defaults (fail-safe)`);

    // ── warm-gate: fast, deterministic via instant-sleep + sendLine capture + the ctx sidecar file ──
    const nudges: string[] = [];
    const TINY = 120; // per-attempt give-up window (ms) — keeps the cold-path test brief

    console.log('[2] verifyWarmOrNudge — a WARM spoke passes with NO nudge');
    clearCtx(); setCtx(40);
    __setTestHooks({ sleep: () => {}, sendLine: (_t, l) => nudges.push(l) });
    nudges.length = 0;
    await verifyWarmOrNudge(SLUG, SURFACE, 30, 2, TINY);
    ok(nudges.length === 0, `ctx 40% ≥ floor 30% → 0 nudges (warm spoke untouched)`);

    console.log('[3] verifyWarmOrNudge — a SHALLOW spoke is nudged, then warms → returns');
    setCtx(14); nudges.length = 0;
    // simulate the nudge causing a full reconstitution: on the first nudge, the ctx climbs to warm
    __setTestHooks({ sleep: () => {}, sendLine: (_t, l) => { nudges.push(l); setCtx(40); } });
    await verifyWarmOrNudge(SLUG, SURFACE, 30, 2, TINY);
    ok(nudges.length === 1, `ctx 14% → exactly 1 full-load nudge, then warm → returns (got ${nudges.length})`);
    ok(/COMPLETE welcome-back/i.test(nudges[0] ?? ''), `the nudge is the full-reconstitution instruction`);

    console.log('[4] verifyWarmOrNudge — stays COLD → fail-safe SessionNotReadyError after maxNudges');
    setCtx(14); nudges.length = 0;
    __setTestHooks({ sleep: () => {}, sendLine: (_t, l) => nudges.push(l) }); // never warms
    let threw: unknown = null;
    try { await verifyWarmOrNudge(SLUG, SURFACE, 30, 2, TINY); } catch (e) { threw = e; }
    ok(threw instanceof SessionNotReadyError, `stays cold → throws SessionNotReadyError (fail-safe, no hollow answer)`);
    ok(nudges.length === 2, `exactly maxNudges=2 nudges before failing safe (got ${nudges.length})`);

    __setTestHooks(null);
    clearCtx();
    if (failures) { console.error(`\nFAILED: ${failures} assertion(s).`); process.exit(1); }
    console.log('\nALL PASS — generic spoke monitor: registry thresholds + warm-gate (nudge → warm | fail-safe).');
}

main().catch((e) => { __setTestHooks(null); clearCtx(); console.error('test error:', e); process.exit(1); });
