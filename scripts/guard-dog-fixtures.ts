/**
 * guard-dog-fixtures.ts — R3c-HB F3 acceptance (D3's ruling, Tenshi's two fixtures).
 *
 * Runs the guard-dog's pure verdict (lib/agent-scheduler distressVerdict) against the
 * cases that define the fix — importing NO driver code (the peer-peek lesson: a leaf
 * makes the acceptance runnable forever, carefully). Exit 0 = all hold; exit 1 = a
 * fixture failed, with the failing row printed.
 *
 * Run: cd src/server && npx tsx ../../scripts/guard-dog-fixtures.ts
 */
import { distressVerdict } from '../src/server/lib/agent-scheduler';

const MIN = 60_000;

type Case = { name: string; gapMs: number; delayMs: number; periodMs: number; mult: number; expectFire: boolean };

const CASES: Case[] = [
    // ── Tenshi fixture 1: the boot-alignment NEGATIVE — the exact live shape of the
    //    2026-08-26 18:15 (casey, 46s), 19:15 (casey, 64s) and 19:20 (leo, 364s) false
    //    fires: a normal full-period gap after a restart whose first beat had a short
    //    wall-clock-alignment delay. The old code compared against that short previous
    //    delay and fired; the period floor must keep these silent.
    { name: 'boot-alignment casey 18:15 (prev-delay 46s shape)', gapMs: 20 * MIN, delayMs: 46_000, periodMs: 20 * MIN, mult: 2, expectFire: false },
    { name: 'boot-alignment leo 19:20 (prev-delay 6min shape)', gapMs: 20 * MIN, delayMs: 364_000, periodMs: 20 * MIN, mult: 2, expectFire: false },
    // ── The second false-positive shape the naive own-delay fix would have introduced:
    //    a short-aligned delay AFTER a long beat (the gap includes the previous beat's
    //    duration, the scheduled delay does not).
    { name: 'short delay after long beat', gapMs: 5 * MIN, delayMs: 60_000, periodMs: 20 * MIN, mult: 2, expectFire: false },
    // ── Ordinary steady-state: gap ≈ period + beat duration.
    { name: 'steady state with beat duration', gapMs: 26 * MIN, delayMs: 20 * MIN, periodMs: 20 * MIN, mult: 2, expectFire: false },
    // ── Tenshi fixture 2: the synthetic-fire POSITIVE (acceptance #6's row re-cited) —
    //    the 80-minute cadence, the case this instrument exists for. A detector that has
    //    never fired since its fix is indistinguishable from one the fix broke.
    { name: 'SYNTHETIC: the 80-min cadence', gapMs: 80 * MIN, delayMs: 20 * MIN, periodMs: 20 * MIN, mult: 2, expectFire: true },
    // ── A true stall reached through a short-delay schedule still fires (the period
    //    floor raises the bar to 2×period, not to infinity).
    { name: 'true stall behind a short delay', gapMs: 45 * MIN, delayMs: 60_000, periodMs: 20 * MIN, mult: 2, expectFire: true },
    // ── Boundary: just under the threshold stays silent.
    { name: 'boundary: 39min on a 20min period', gapMs: 39 * MIN, delayMs: 20 * MIN, periodMs: 20 * MIN, mult: 2, expectFire: false },
];

let failed = 0;
for (const c of CASES) {
    const v = distressVerdict(c.gapMs, c.delayMs, c.periodMs, c.mult);
    const ok = v.fire === c.expectFire;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} — gap ${Math.round(c.gapMs / MIN)}min vs ${c.mult}×max(${Math.round(c.delayMs / 1000)}s, ${Math.round(c.periodMs / MIN)}min) → fire=${v.fire} (expected ${c.expectFire})`);
    if (!ok) failed++;
}
console.log(failed === 0 ? `\nALL ${CASES.length} FIXTURES HOLD` : `\n${failed} FIXTURE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
