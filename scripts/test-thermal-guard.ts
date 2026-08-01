#!/usr/bin/env tsx
// test-thermal-guard.ts — Tenshi's gates for the pump-fail watcher (thread msa3ny9e).
//
//   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-thermal-guard.ts
//
// G1 — synthetic streams: healthy ⇒ quiet; widening gap at idle ⇒ Rule B; high absolute
//      under load ⇒ Rule A; legitimate high-load warm-up ⇒ NO false Rule B (the load
//      discriminant); idle rate-of-rise ⇒ tripwire.
// G2 — fail-loud: unreadable sensors ⇒ alert, never silence; watcher-dark gap ⇒ alert.
// G3 — cold-start: no baseline ⇒ conservative default governs (a dead-pump spread fires
//      on the FIRST morning, before any learning); anomalies never teach the baseline.
// G4 — DEC-103/104 self-test: no destructive path (pure core — nothing to destroy);
//      throttling is the doubling shape, never a suppression of a NEW rule.

import { decide, DEFAULT_TUNABLES, FRESH_STATE, spreadAllowanceC, type GuardState, type Sample } from './thermal-guard-core';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
    cond ? pass++ : fail++;
    console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${!cond && detail ? ` — ${detail}` : ''}`);
};

const T = DEFAULT_TUNABLES;
const MIN = 60_000;
const mk = (i: number, pkg: number | null, board: number[], load1: number, extra?: Partial<Sample>): Sample => ({
    tsMs: 1_700_000_000_000 + i * MIN, packageC: pkg, boardC: board,
    otherC: {}, load1, ncores: 16, readErrors: [], ...extra,
});
const run = (samples: Sample[], from: GuardState = { ...FRESH_STATE }) => {
    let state = from;
    const fired: string[] = [];
    const conds: string[] = [];
    for (const s of samples) {
        const d = decide(s, state, T);
        state = d.state;
        fired.push(...d.alerts.map(a => a.rule));
        conds.push(...d.conditions);
    }
    return { state, fired, conds };
};

console.log('\nG1 — the four stream shapes');
// Healthy: package ~40, board ~33-37, idle. Tenshi's live read, an hour of it.
const healthy = Array.from({ length: 60 }, (_, i) => mk(i, 40 + (i % 3) * 0.5, [32, 41, 37, 34, 32, 33], 0.8));
const h = run(healthy);
ok('healthy hour ⇒ no alerts at all', h.fired.length === 0, h.fired.join(','));
ok('healthy hour ⇒ baseline learning', h.state.learnedSamples === 60 && h.state.baselineMean !== undefined);

// The pump-fail signature: idle box, package climbs away from a flat board.
const pumpFail = [
    ...Array.from({ length: 5 }, (_, i) => mk(i, 40, [33, 34, 33], 0.5)),
    ...Array.from({ length: 6 }, (_, i) => mk(5 + i, 52 + i * 2, [34, 34, 34], 0.5)), // gap 18→28° while idle
];
const p = run(pumpFail);
ok('idle widening gap ⇒ Rule B fires (delta-divergence)', p.fired.includes('delta-divergence'), p.fired.join(','));
ok('…and the fast tripwire sees the idle rise too', p.conds.includes('idle-rise'));

// Hot box under load: absolute ceiling crossed.
const hot = [mk(0, 87, [45, 46, 44], 14)];
ok('87°C package ⇒ Rule A fires regardless of load', run(hot).fired.includes('abs-threshold'));

// Legitimate high-load warm-up: spread widens WITH load — the discriminant absorbs it.
const busyWarm = [
    ...Array.from({ length: 5 }, (_, i) => mk(i, 40, [33, 34, 33], 0.4)),
    ...Array.from({ length: 8 }, (_, i) => mk(5 + i, 55 + i, [35, 36, 35], 12)), // busy: gap up to ~27°
];
const b = run(busyWarm);
ok('high-load warm-up ⇒ NO false Rule B (load discriminant)', !b.fired.includes('delta-divergence'), b.fired.join(','));
ok('…and no idle-rise tripwire while busy', !b.conds.includes('idle-rise'));

console.log('\nG2 — fail-loud (no-data is suspect, never safe)');
const unreadable = run([mk(0, null, [], 0.5, { readErrors: ['hwmon unreadable: EACCES'] })]);
ok('unreadable sensors ⇒ sensor-unreadable alert, not silence', unreadable.fired.includes('sensor-unreadable'));
const noBoard = run([mk(0, 40, [], 0.5, { readErrors: ['no board (superio/acpitz) temperatures found'] })]);
ok('missing board family ⇒ alert', noBoard.fired.includes('sensor-unreadable'));
// Watcher-dark: two runs 10 minutes apart on a 60s cadence.
const darkState = run([mk(0, 40, [33, 34], 0.5)]).state;
const dark = decide(mk(10, 40, [33, 34], 0.5), darkState, T);
ok('a 10-min silent gap on a 60s cadence ⇒ watcher-dark alert', dark.alerts.some(a => a.rule === 'watcher-dark'));

console.log('\nG3 — cold-start conservatism');
ok('no baseline ⇒ the tight default allowance governs (not learned, not lax)',
    spreadAllowanceC({ ...FRESH_STATE }, T) === T.spreadDefaultAllowC);
// A dead pump on the FIRST morning — zero history — still fires.
const coldPump = Array.from({ length: 4 }, (_, i) => mk(i, 40 + i * 8, [33, 33, 33], 0.4)); // gap 7→31°
ok('dead-pump spread with ZERO history ⇒ fires on the cold-start default', run(coldPump).fired.includes('delta-divergence'));
// Anomalous samples never teach the baseline.
const before = run(healthy).state;
const anomalous = Array.from({ length: 10 }, (_, i) => mk(100 + i, 70, [33, 33, 33], 0.4)); // gap 37°
const after = run(anomalous, { ...before }).state;
ok('anomalies are excluded from learning (baseline unchanged by a divergent run)',
    Math.abs((after.baselineMean ?? 0) - (before.baselineMean ?? 0)) < 0.001,
    `before=${before.baselineMean} after=${after.baselineMean}`);
ok('…and learnedSamples does not advance on anomalies', after.learnedSamples === before.learnedSamples);
// Busy samples — even healthy ones — never teach the IDLE baseline.
const busyHealthy = Array.from({ length: 10 }, (_, i) => mk(200 + i, 70, [36, 37, 36], 12)); // legit big busy spread
const afterBusy = run(busyHealthy, { ...before }).state;
ok('busy samples never teach the idle baseline (poison-proof)',
    afterBusy.learnedSamples === before.learnedSamples
    && Math.abs((afterBusy.baselineMean ?? 0) - (before.baselineMean ?? 0)) < 0.001);

console.log('\nG4 — alert shape (loud, never spam; distinct rules never suppressed)');
// Same rule re-fires on the doubling clock, not every sample.
const sustained = Array.from({ length: 15 }, (_, i) => mk(i, 60, [33, 33, 33], 0.4));
const s = run(sustained);
const deltaFires = s.fired.filter(r => r === 'delta-divergence').length;
ok('a 15-min sustained divergence fires once, then throttles (doubling)', deltaFires >= 1 && deltaFires <= 3, `${deltaFires} fires`);
// A DIFFERENT rule is never throttled by the first.
const mixed = run([...sustained.slice(0, 6), mk(6, 87, [33, 33, 33], 0.4)]);
ok('Rule A still fires while Rule B is throttled (per-rule throttle)', mixed.fired.includes('abs-threshold'));

console.log('\nM1/M2/Q1 — the audit folds (calibration mode, the honest alpha, the throttle ceiling)');
// M1: calibration mode silences Rule B ONLY — Rule A + fail-loud rules stay LIVE.
const CAL = { ...T, calibrationMode: true };
let calState = { ...FRESH_STATE };
let calConds: string[] = [], calFired: string[] = [];
for (const smp of Array.from({ length: 6 }, (_, i) => mk(i, 60, [33, 33, 33], 0.4))) {
    const d = decide(smp, calState, CAL); calState = d.state;
    calConds.push(...d.conditions); calFired.push(...d.alerts.map(a => a.rule));
}
ok('calibration: Rule B condition still RECORDS (the measurement)', calConds.includes('delta-divergence'));
ok('calibration: Rule B alert never FIRES (log-only)', !calFired.includes('delta-divergence') && !calFired.includes('idle-rise'));
ok('calibration: Rule A stays LIVE (the availability leg)',
    decide(mk(0, 87, [33, 33], 0.4), { ...FRESH_STATE }, CAL).alerts.some(a => a.rule === 'abs-threshold'));
ok('calibration: sensor-unreadable stays LIVE',
    decide(mk(0, null, [], 0.4, { readErrors: ['x'] }), { ...FRESH_STATE }, CAL).alerts.some(a => a.rule === 'sensor-unreadable'));
// M2: the alpha's stated reason and value agree — a TRUE week (6–8 days at 60s cadence).
const halfLifeDays = (Math.log(2) / T.baselineAlpha) / 1440;
ok('alpha half-life is a genuine week (6–8 days) — comment and value agree', halfLifeDays > 6 && halfLifeDays < 8, `${halfLifeDays.toFixed(1)} days`);
// Q1: the doubling wait is CEILINGED — a standing day-long failure keeps re-alerting.
const dayLong = Array.from({ length: 24 * 60 }, (_, i) => mk(i, 60, [33, 33, 33], 0.4));
const standing = run(dayLong);
const standingFires = standing.fired.filter(r => r === 'delta-divergence').length;
ok('a 24h standing failure re-alerts ≥4 times (the 6h ceiling holds)', standingFires >= 4, `${standingFires} fires`);

// Sub-cadence gaps never feed the rate tripwire (caught on the build's own smoke proof).
const quick1 = decide(mk(0, 32, [33, 34], 0.2), { ...FRESH_STATE }, T);
const quickSample: Sample = { ...mk(0, 33, [33, 34], 0.2), tsMs: 1_700_000_000_000 + 3_000 };
const quick2 = decide(quickSample, quick1.state, T);
ok('a 3s re-run with a 1° blip never advances the rise streak', quick2.state.riseStreak === 0);

console.log(`\nthermal-guard gates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
