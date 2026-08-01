// thermal-guard-core.ts — the PURE decision core of the pump-fail watcher (Tenshi's plan,
// thread msa3ny9e-knlzg0; built by Leo via the membrane, held for Jim's diff-audit).
//
// THE POLICY (Tenshi): watch the GAP, not the number. A healthy loop keeps a small,
// stable spread between the CPU package and the board sensors; a dead pump decouples the
// package from its coolant and the gap widens REGARDLESS of the absolute number. Rule A
// (Jim's absolute ceiling) catches the hot box; Rule B (the delta vs a learned baseline,
// load-discriminated) catches the box that isn't being cooled but isn't hot yet — the
// stalled pump, the failure with no other cover anywhere in the machine.
//
// FAIL DIRECTIONS, all chosen deliberately:
//  - No-data is SUSPECT, never safe: unreadable sensors alert (G2); before a baseline
//    exists the allowance is a tight conservative default that only LEARNS outward from
//    healthy samples (G3) — never assume-healthy on silence.
//  - The baseline never learns from an anomalous sample (a slowly-dying pump must not
//    teach the guard that a wide gap is normal).
//  - Alert repetition follows the DEC-103 §3 doubling shape (first fire immediate, then
//    10m → 20m → 40m …) — loud, never spam (S74).
//
// Pure: no fs, no net, no clock — the runner supplies samples; the suite supplies streams.
//
// MEASURED IDLE-SPREAD RANGE (the M1 calibration ledger — the cold-start default is
// authored from THIS, not from an afternoon's guess):
//   2026-08-01 ~15:00 AEST (Tenshi, warm afternoon):  ~5.2°C  (pkg 40, board ~34.8)
//   2026-08-01 23:37 AEST (Jim, cool evening, idle):  11.7°C  (pkg 34, load 0.21/core)
//   → healthy range spans ≥ 5→12°C across ONE day; the 12° default had 0.3° headroom.
//   Calibration window armed 2026-08-01 (calibrationMode: true, Rule B log-only,
//   Rule A LIVE); the default is re-authored from the 24–48h measured max + headroom,
//   then this ledger records the final range + date and the mode comes off.

export interface Tunables {
    /** Rule A ceiling, °C. author: Jim (cooling thread) — CPU package throttle-adjacent
     *  warning line; reason: catch every high-load thermal failure honestly. */
    absMaxC: number;
    /** G3 cold-start allowed spread, °C. author: Tenshi — conservative (tight) until the
     *  box teaches its own normal; may only widen via LEARNING, never by default. */
    spreadDefaultAllowC: number;
    /** Rule B sensitivity: allowance = mean + K·sd. author: Tenshi ("the one tunable");
     *  reason: 3-sigma divergence from the learned normal = not weather. */
    spreadSigmaK: number;
    /** Floor on the learned sd, °C (a very quiet week must not make the guard hair-trigger). */
    minSdC: number;
    /** Consecutive divergent samples before an alert (sustained, not a blip). */
    sustainN: number;
    /** load1/ncores at-or-above this = "busy" (the load discriminant). Rule B evaluates
     *  ONLY idle samples — a working loop under real load legitimately runs 25–45°C
     *  spreads, so any guessed "busy allowance" would be the exact unmeasured-number
     *  fail-state this guard exists to cure (Tenshi's own critique of Rule A, applied
     *  to ourselves). Under load, Rule A owns the box: a dead pump under load races
     *  past the absolute ceiling in under a minute. */
    idleLoadPerCore: number;
    /** Idle rate-of-rise ceiling, °C/min (sustained) — the fast-failure tripwire. */
    riseRateMaxCPerMin: number;
    /** EWMA learning rate for the baseline. A TRUE week: ln2/7e-5 ≈ 9,902 samples ≈
     *  6.9 days at 60s cadence (M2 — Jim's arithmetic caught the old 0.001 claiming
     *  "a week" while actually ~11.5h, off ~14×; Tenshi ruled SLOWER: the one pathology
     *  the poison-proofing cannot stop is a slow creep under the allowance quietly
     *  teaching the baseline upward — a slow α is the cheap brake on exactly that). */
    baselineAlpha: number;
    /** Samples before the learned baseline replaces the cold-start default. */
    minLearnSamples: number;
    /** Watcher-dark factor: a gap between runs > factor×interval alerts (absence-is-alarm). */
    heartbeatStaleFactor: number;
    /** Expected seconds between runs (the cron cadence; used only for the dark check). */
    intervalSec: number;
    /** M1 (the calibration window): when true, the two Rule-B rules (delta-divergence,
     *  idle-rise) are LOG-ONLY — their conditions record, no alert fires — while Rule A,
     *  sensor-unreadable and watcher-dark stay fully LIVE (Tenshi's availability leg:
     *  only the delta is unmeasured; the measuring window must never be blind to a hot
     *  box). Used for the 24–48h idle-spread measurement that authors the cold-start
     *  default from data (Jim's M1: the 12° default had 0.3° headroom over a healthy
     *  cool-evening read — measure first, then price, DEC-103). */
    calibrationMode: boolean;
    /** Re-alert doubling base, minutes (DEC-103 §3 shape). */
    realertBaseMin: number;
    /** Ceiling on the doubling wait, minutes (Q1 — Tenshi's ruling: an alarm that goes
     *  QUIET is the precise failure this plan was written against; a standing pump
     *  failure re-alerts at least ~4×/day, never stretches to multi-day silence). */
    realertMaxMin: number;
}

/** Authored defaults — every number carries its author + reason above (DEC-104). */
export const DEFAULT_TUNABLES: Tunables = {
    absMaxC: 85,
    spreadDefaultAllowC: 12,
    spreadSigmaK: 3,
    minSdC: 1.0,
    sustainN: 3,
    idleLoadPerCore: 0.5,
    riseRateMaxCPerMin: 1.5,
    baselineAlpha: 0.00007,
    minLearnSamples: 120,
    heartbeatStaleFactor: 3,
    intervalSec: 60,
    calibrationMode: false,
    realertBaseMin: 10,
    realertMaxMin: 360,
};

export interface Sample {
    tsMs: number;
    /** CPU package temp, °C (coretemp Package id 0) — null when unreadable. */
    packageC: number | null;
    /** Board/coolant-proxy temps, °C (superio + acpitz family). */
    boardC: number[];
    /** Every other temp worth Rule A (label → °C): gpu, nvme, …. */
    otherC: Record<string, number>;
    /** 1-minute loadavg and core count (the load discriminant). */
    load1: number;
    ncores: number;
    /** Non-empty = the read itself failed somewhere (G2: suspect, never safe). */
    readErrors: string[];
}

export interface GuardState {
    baselineMean?: number;
    baselineVar?: number;
    learnedSamples: number;
    spreadStreak: number;
    riseStreak: number;
    lastPackageC?: number;
    lastTsMs?: number;
    /** per-rule alert throttling: rule → { lastMs, count } (the doubling shape). */
    alertLog: Record<string, { lastMs: number; count: number }>;
}

export const FRESH_STATE: GuardState = {
    learnedSamples: 0, spreadStreak: 0, riseStreak: 0, alertLog: {},
};

export interface Alert { rule: string; message: string }

export interface Decision {
    /** Alerts that should FIRE now (already throttle-filtered). */
    alerts: Alert[];
    /** Conditions present this sample (pre-throttle — the suite pins on these). */
    conditions: string[];
    state: GuardState;
}

function throttled(state: GuardState, rule: string, tsMs: number, baseMin: number, maxMin: number): boolean {
    const log = state.alertLog[rule];
    if (!log) return false;
    const waitMs = Math.min(baseMin * Math.pow(2, Math.max(0, log.count - 1)), maxMin) * 60_000;
    return tsMs - log.lastMs < waitMs;
}

function fire(state: GuardState, rule: string, tsMs: number): void {
    const log = state.alertLog[rule] ?? { lastMs: 0, count: 0 };
    state.alertLog[rule] = { lastMs: tsMs, count: log.count + 1 };
}

/** The current Rule-B allowance — cold-start default until genuinely learned (G3).
 *  Idle samples only ever reach this (the load discriminant gates Rule B whole). */
export function spreadAllowanceC(state: GuardState, t: Tunables): number {
    const learned = state.baselineMean !== undefined && state.learnedSamples >= t.minLearnSamples;
    return learned
        ? state.baselineMean! + t.spreadSigmaK * Math.max(Math.sqrt(state.baselineVar ?? 0), t.minSdC)
        : t.spreadDefaultAllowC;
}

export function decide(sample: Sample, prev: GuardState, t: Tunables = DEFAULT_TUNABLES): Decision {
    const state: GuardState = {
        ...prev,
        alertLog: { ...prev.alertLog },
    };
    const alerts: Alert[] = [];
    const conditions: string[] = [];
    const CALIBRATION_MUTED = new Set(['delta-divergence', 'idle-rise']); // Rule B only — never Rule A / fail-loud
    const consider = (rule: string, message: string) => {
        conditions.push(rule);
        if (t.calibrationMode && CALIBRATION_MUTED.has(rule)) return; // M1: log-only in the measure window
        if (!throttled(state, rule, sample.tsMs, t.realertBaseMin, t.realertMaxMin)) {
            fire(state, rule, sample.tsMs);
            alerts.push({ rule, message });
        }
    };

    // Watcher-dark self-check (absence-is-alarm): the gap since the previous run.
    if (state.lastTsMs !== undefined) {
        const gapSec = (sample.tsMs - state.lastTsMs) / 1000;
        if (gapSec > t.heartbeatStaleFactor * t.intervalSec) {
            consider('watcher-dark', `thermal guard was dark for ${Math.round(gapSec)}s (expected every ${t.intervalSec}s) — the watcher itself went silent; check its timer`);
        }
    }

    // G2 — no-data is suspect, never safe.
    if (sample.readErrors.length > 0 || sample.packageC === null || sample.boardC.length === 0) {
        consider('sensor-unreadable', `thermal guard cannot read the sensors it stands on (${sample.readErrors.join('; ') || 'package/board missing'}) — treat as SUSPECT, not safe`);
        // No temps to judge and nothing learnable — do not touch streaks/baseline.
        state.lastTsMs = sample.tsMs;
        return { alerts, conditions, state };
    }

    const pkg = sample.packageC;
    const boardMean = sample.boardC.reduce((a, b) => a + b, 0) / sample.boardC.length;
    const spread = pkg - boardMean;
    const busy = sample.ncores > 0 && sample.load1 / sample.ncores >= t.idleLoadPerCore;

    // Rule A — the absolute ceiling (every sensor).
    const all: Array<[string, number]> = [['cpu-package', pkg], ...Object.entries(sample.otherC)];
    for (const [label, c] of all) {
        if (c >= t.absMaxC) {
            consider('abs-threshold', `${label} at ${c.toFixed(1)}°C ≥ ${t.absMaxC}°C ceiling — the box is HOT (Rule A)`);
            break; // one Rule-A alert per sample carries the message
        }
    }

    // Rule B — the gap, against the learned (or conservative cold-start) allowance.
    // IDLE-ONLY (the load discriminant): under load a healthy loop runs big spreads
    // legitimately, and a dead pump under load trips Rule A within a minute anyway.
    // A busy sample FREEZES the streak (neither advance nor reset) — a dying pump
    // under intermittent load must not have its evidence erased by a busy blip.
    const allowance = spreadAllowanceC(state, t);
    const divergent = !busy && spread > allowance;
    if (divergent) {
        state.spreadStreak += 1;
        if (state.spreadStreak >= t.sustainN) {
            consider('delta-divergence', `package−board spread ${spread.toFixed(1)}°C exceeds allowance ${allowance.toFixed(1)}°C for ${state.spreadStreak} idle samples — the pump-fail signature (Rule B)`);
        }
    } else if (!busy) {
        state.spreadStreak = 0;
    }

    // Rule B' — idle rate-of-rise (the fast tripwire). Sub-cadence gaps are excluded:
    // a 1° blip over 3s reads as 20°/min, so samples closer than half the expected
    // interval never count (caught live on the build's own smoke proof).
    if (state.lastPackageC !== undefined && state.lastTsMs !== undefined && !busy) {
        const dtMin = (sample.tsMs - state.lastTsMs) / 60_000;
        if (dtMin >= (t.intervalSec / 60) * 0.5) {
            const rate = (pkg - state.lastPackageC) / dtMin;
            if (rate > t.riseRateMaxCPerMin) {
                state.riseStreak += 1;
                if (state.riseStreak >= t.sustainN) {
                    consider('idle-rise', `package rising ${rate.toFixed(2)}°C/min while idle for ${state.riseStreak} samples — heat is not leaving the die (Rule B)`);
                }
            } else {
                state.riseStreak = 0;
            }
        }
    } else if (busy) {
        state.riseStreak = 0;
    }

    // Baseline learning — HEALTHY IDLE samples only: an anomaly must never teach the
    // guard that a wide gap is normal, and a busy sample's legitimate wide spread must
    // never poison the idle baseline. EWMA over spread.
    if (!busy && !divergent) {
        if (state.baselineMean === undefined) {
            state.baselineMean = spread;
            state.baselineVar = 0;
        } else {
            const a = t.baselineAlpha;
            const diff = spread - state.baselineMean;
            state.baselineMean += a * diff;
            state.baselineVar = (1 - a) * ((state.baselineVar ?? 0) + a * diff * diff);
        }
        state.learnedSamples += 1;
    }

    state.lastPackageC = pkg;
    state.lastTsMs = sample.tsMs;
    return { alerts, conditions, state };
}
