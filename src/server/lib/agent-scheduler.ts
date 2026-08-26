/**
 * Shared agent scheduler — Phase-2 F3/F4 (cycle-symmetry).
 *
 * ONE shared rhythm for every scheduling-participating agent (DEC-081, one-path-many-agents).
 * The per-agent difference lives in the ACTIVITY config, NOT the clock — the meditation
 * principle (Darron, S184): a mind can't stop thinking; an idle beat doesn't slow the clock,
 * it alters the activity toward low load (a cheap content-gated stand-down). So this module
 * carries NO idle-dampening — idleness is content, handled in the activity layer.
 *
 * What it DOES carry (relocated byte-for-byte from the per-driver getWallClockDelay):
 *  - the shared phase cadence (lib/day-phase getPhaseInterval — active 20 / rest 40 / holiday 80,
 *    the same for every agent; jim's old local sleep=40 retires to the shared sleep=20),
 *  - transition-dampening (#7 — the weekly-rhythm ramp when returning from a longer interval;
 *    R001, Darron's body-derived cadence — NOT idleness, so it stays),
 *  - the N-body antiphase offset (index/N)·period, registry-derived.
 *
 * PROTECTED: R001 (Hall of Records — the weekly rhythm). The antiphase MECHANISM is
 * relocate-not-change; at N=2 it reproduces {leo index 0 → 0°, jim index 1 → 180°} byte-for-byte.
 * The rhythm VALUES becoming uniform across agents is the S184 cycle-symmetry decision.
 */

import { getPhaseInterval, getDayPhase, isOnHoliday, isRestDay } from './day-phase';
import { loadResidents } from './garden-manifest';

const TRANSITION_STEPS = [0.75, 0.5, 0.25]; // Blend ratios: 75% old, 50% old, 25% old

interface SchedulerState { previousPeriodMs: number; transitionStep: number; }
const stateBySlug = new Map<string, SchedulerState>();
function stateFor(slug: string): SchedulerState {
    let s = stateBySlug.get(slug);
    if (!s) { s = { previousPeriodMs: 0, transitionStep: -1 }; stateBySlug.set(slug, s); }
    return s;
}

/** Surfaces that make an agent a cadence-driver (a wall-clock-scheduled cycle). */
const CADENCE_SURFACES = new Set(['heartbeat', 'supervisor-cycle']);

/**
 * Scheduling-participating agents, in deterministic manifest order. DERIVED from the
 * manifest surfaces (Jim's C-refinement: a flag that can disagree with the surface list
 * is future drift — derive it). The order sets the antiphase index, so it must be stable
 * and reproduce {leo, jim} → {0, 1} (manifest declares leo before jim).
 */
export function schedulingAgents(): string[] {
    return loadResidents()
        .filter(a => a.active && a.surfaces.some(s => CADENCE_SURFACES.has(s.name)))
        .map(a => a.slug);
}

/**
 * The agent's antiphase index + the live count N. N=2 → {leo 0, jim 1}.
 * ⚠ N-change consequence (named, Jim's C-refinement): adding a 3rd scheduling agent shifts
 * N 2→3, so every agent re-phases (jim 180°→120°). Intended — the antiphase re-spreads —
 * but byte-stability of the offsets holds only at the CURRENT N; a future agent-add is a
 * deliberate re-phase, not a regression.
 */
export function agentPhaseIndex(slug: string): { index: number; n: number } {
    const agents = schedulingAgents();
    const i = agents.indexOf(slug);
    return { index: i < 0 ? 0 : i, n: agents.length || 1 };
}

/**
 * The shared wall-clock cadence delay (ms) until this agent's next beat. Relocate-not-change
 * of the antiphase mechanism + transition-dampening; NO idle-dampening (content-gated in the
 * activity layer). The period is the SHARED getPhaseInterval(slug) — uniform across agents.
 */
export function computeWallClockDelay(slug: string): number {
    const st = stateFor(slug);
    let periodMs = getPhaseInterval(slug);

    // ── Transition dampening (#7) — the weekly-rhythm ramp (holiday/rest → active) ──
    if (st.previousPeriodMs > 0 && periodMs < st.previousPeriodMs) {
        st.transitionStep = 0;
    }
    if (st.transitionStep >= 0 && st.transitionStep < TRANSITION_STEPS.length) {
        const blendRatio = TRANSITION_STEPS[st.transitionStep];
        periodMs = Math.round(periodMs + (st.previousPeriodMs - periodMs) * blendRatio);
        st.transitionStep++;
    } else if (st.transitionStep >= TRANSITION_STEPS.length) {
        st.transitionStep = -1;
    }
    st.previousPeriodMs = getPhaseInterval(slug); // store raw (undampened) period for next comparison

    // ── N-body antiphase: offset = (index/N)·period. N=2 → {leo 0°, jim 180°} byte-identical. ──
    const { index, n } = agentPhaseIndex(slug);
    const offsetMs = Math.floor((index / n) * periodMs);
    const now = Date.now();
    const remainder = (((now - offsetMs) % periodMs) + periodMs) % periodMs;
    let delay = periodMs - remainder;
    // If within 30s of a boundary, skip to the next period.
    if (delay < 30000) delay += periodMs;
    console.log(`[${slug}] Wall-clock: ${phaseLabelFor(slug)} phase, period ${Math.round(periodMs / 60000)}min, next beat in ${Math.round(delay / 1000)}s (${Math.round(delay / 60000)}min)`);
    return delay;
}

/**
 * R3c-HB F3 (2026-08-26): the guard-dog's verdict as a PURE function, extracted so the
 * fixtures run without importing the driver (the peer-peek/acceptance-#7 lesson — a leaf
 * is what makes a test runnable forever). The gap is judged against
 * max(this fire's own scheduled delay, the phase period):
 *  - never the PREVIOUS gap's delay — whose boot-alignment shortness (46s/64s/364s) made
 *    every post-restart second beat a false positive (the 18:15/19:15/19:20 fires,
 *    2026-08-26, predicted to the minute and confirmed);
 *  - never the bare own-delay — which false-fires on a short-aligned delay after a long
 *    beat, because the fire-to-fire gap includes the previous beat's duration;
 *  - the period floor keeps the true purpose intact: a genuinely blocked cadence
 *    (the 80-min case this instrument exists for) still doubles against the period.
 * Fixtures: scripts/guard-dog-fixtures.ts (Tenshi's boot-alignment negative + the
 * synthetic-fire positive, D3's ruling).
 */
export function distressVerdict(gapMs: number, scheduledDelayMs: number, periodMs: number, multiplier: number): { fire: boolean; expectedMs: number } {
    const expectedMs = Math.max(scheduledDelayMs, periodMs);
    return { fire: gapMs > multiplier * expectedMs, expectedMs };
}

/** Human-readable phase label for the driver's scheduling log (relocated; was per-driver). */
export function phaseLabelFor(slug: string): string {
    const phase = getDayPhase();
    return isOnHoliday(slug) ? `holiday/${phase}` : isRestDay() ? `rest/${phase}` : phase;
}
