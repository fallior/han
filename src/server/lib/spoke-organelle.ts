/**
 * spoke-organelle.ts — the per-spoke stats organelle + per-surface integrator + hearth pulse.
 *
 * Build B of the adaptive-hearth plan (plans/adaptive-hearth-organelle-plan.md §8, the
 * 2026-08-15 knee-thread convergence). Three responsibilities, deliberately in one small
 * module so the audit reads one file:
 *
 *  1. PRODUCER (per-spoke, self-only — Darron's organelle): every completed dispatcher
 *     transaction records an op row to the per-surface pool and updates the spoke's own
 *     persist-as-you-go stats file. The spoke observes only itself; the record survives
 *     the writer (every death mode leaves last-known values — Jim's obituary-bias cure).
 *  2. INTEGRATOR (per-surface, pooled — the consumer): the retirement reserve is
 *     `max(rolling per-surface p99, this spoke's own max op so far)` (Jim's final form).
 *     Tenshi's grammar throughout: an unclassifiable row is an ALARM, not a skip — the
 *     integrator REFUSES to emit a line from a contaminated window, with the bad row in
 *     its hands; below the sample floor it declares the manifest fallback rather than
 *     letting max-of-few wear a quantile's label (her order-statistics catch; Jim's
 *     n≥500 practical refinement).
 *  3. HEARTH PULSE (P1b, Darron's v4): activity resets a per-spoke idle timer; at
 *     hearthPulseMinutes of genuine idleness the spoke is fired its BAKED standing
 *     message (materialised at spawn, never fetched at fire time — §2.8). Flag-gated
 *     OFF per surface (hearthPulseEnabled, default false).
 *
 * UNITS: everything runs in % of the spoke's own context window (def 'ctx-delta-pct-v1').
 * The op-definition is recorded ON EVERY ROW and the integrator filters to its configured
 * definition — Jim's finding that the definition moves p99 by 4.4× makes it part of the
 * constant, never bookkeeping. ctx-delta measures window growth, which is exactly the
 * chosen op-definition (input + output + incremental cache_creation IS the turn's window
 * growth); rows from other instruments (e.g. transcript-token sweeps) carry other defs
 * and are never silently mixed.
 *
 * SENESCENCE (the line, fits()) is computed and OBSERVED here; nothing retires a spoke
 * from this module. The enable (senescenceEnabled, default false) gates only the
 * observation row's `wouldRetire` honesty — the retirement ACT is P3, behind the
 * DEC-096 Amendment-1 ruling, Q2's confirm, and the MNT-115 turn-state gate.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    spokeLifecycleFor,
} from './garden-manifest';

// ── Registry accessors (leaves live in SpokeLifecycle; defaults here per the
//    manifest's accessor pattern) ─────────────────────────────────────────────

export function hearthPulseEnabledFor(slug: string, surface: string): boolean {
    return (spokeLifecycleFor(slug, surface) as any).hearthPulseEnabled === true;
}
export function hearthPulseMinutesFor(slug: string, surface: string): number {
    return (spokeLifecycleFor(slug, surface) as any).hearthPulseMinutes ?? 50;
}
/** The BAKED standing message (Darron's v4, his words as the default). Read at spawn,
 *  stored on the session object — never fetched at fire time (§2.8's blast-radius law). */
export function hearthStandingMessageFor(slug: string, surface: string): string {
    return (spokeLifecycleFor(slug, surface) as any).hearthStandingMessage
        ?? 'Hearth pulse: go get a job from the jobs board. If the board is empty, a dream or wander beat is honest work — the covenant prices identity-work as work. Never snooze to save tokens.';
}
export function senescenceEnabledFor(slug: string, surface: string): boolean {
    return (spokeLifecycleFor(slug, surface) as any).senescenceEnabled === true;
}
export function senescenceCeilingPctFor(slug: string, surface: string): number {
    return (spokeLifecycleFor(slug, surface) as any).senescenceCeilingPct ?? 98;
}
export function opPoolWindowOpsFor(slug: string, surface: string): number {
    // Default 4000 ≈ 12 days at measured per-surface volume (Jim's drift-horizon
    // recommendation — 20000 would still be describing July in October).
    return (spokeLifecycleFor(slug, surface) as any).opPoolWindowOps ?? 4000;
}
export function opPoolMinSamplesFor(slug: string, surface: string): number {
    return (spokeLifecycleFor(slug, surface) as any).opPoolMinSamples ?? 500;
}
export function boundaryCheckMinCtxPctFor(slug: string, surface: string): number {
    return (spokeLifecycleFor(slug, surface) as any).boundaryCheckMinCtxPct ?? 80;
}
/** The declared fallback reserve (pct) — served ONLY at n=0 (a genuinely empty pool; the
 *  cold-start ladder's pooled-max takes over from op one). Sized from Jim's measured HAN
 *  numbers (p99 ≈ 15.4% of a 200K window) — ⚠ STARTER-SWEEP FLAG: this is a HAN-shaped
 *  constant (a number that encodes us); a starter garden ships something deliberately
 *  roomier, and the extraction sweeps treat it like a slug literal. */
export function fallbackReservePctFor(slug: string, surface: string): number {
    return (spokeLifecycleFor(slug, surface) as any).fallbackReservePct ?? 15.4;
}

// ── Paths ────────────────────────────────────────────────────────────────────

const HEALTH_DIR = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');
const OP_POOL_DIR = path.join(HEALTH_DIR, 'op-pool');
const SPOKE_STATS_DIR = path.join(HEALTH_DIR, 'spoke-stats');
const WINDING_UP_REGISTER = path.join(HEALTH_DIR, 'winding-up-register.jsonl');
const ORGANELLE_ALARMS = path.join(HEALTH_DIR, 'organelle-alarms.jsonl');

function ensureDirs(): void {
    for (const d of [OP_POOL_DIR, SPOKE_STATS_DIR]) {
        try { fs.mkdirSync(d, { recursive: true }); } catch { /* exists */ }
    }
}

export const OP_DEF = 'ctx-delta-pct-v1';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpRow {
    ts: string;
    slug: string;
    surface: string;
    session: string;
    model: string | null;
    fromPct: number | null;
    toPct: number | null;
    /** Window growth for the turn, in % of the window. Null when unclassifiable. */
    opPct: number | null;
    def: typeof OP_DEF;
    /** 'work' = a real op; 'wake' = a fresh-session load (the 970K-trap class — a cache
     *  build, not a unit of work); 'unclassifiable' = the sidecar could not be read or
     *  the delta is incoherent — an ALARM row, never silently dropped. */
    klass: 'work' | 'wake' | 'unclassifiable';
    note?: string;
}

export interface SpokeStats {
    session: string;
    slug: string;
    surface: string;
    model: string | null;
    birth: string;
    lastWrite: string;
    opCount: number;
    opMaxPct: number;
    opSumPct: number;
    lastCtxPct: number | null;
    /** Filled by the winding-up; a record whose terminalAct is still null belongs to a
     *  spoke that died without declaring — the absence IS the datum (Jim's third state,
     *  detectable without a third-party obituary because the record survives the writer). */
    terminalAct: null | 'senescence' | 'compaction-retirement' | 'reaped' | 'retired';
    terminalReason?: string;
}

export interface ReserveResult {
    reservePct: number;
    linePct: number;
    source: 'pooled-p99' | 'pooled-max' | 'own-max' | 'fallback-constant';
    pooledP99Pct: number | null;
    ownMaxPct: number;
    sampleN: number;
    droppedDefMismatch: number;
    refused: boolean;
    refusalRow?: OpRow;
    def: typeof OP_DEF;
}

// ── Producer: dispatch-start / turn-complete hooks ───────────────────────────

/** In-flight fromPct per tmux session (the dispatcher's single-live-transaction
 *  invariant makes one slot per session sound). */
const inFlight = new Map<string, { fromPct: number | null; startedAt: number }>();

export function organelleOnDispatchStart(
    session: string,
    readCtxPct: () => number | null,
): void {
    let fromPct: number | null = null;
    try { fromPct = readCtxPct(); } catch { fromPct = null; }
    inFlight.set(session, { fromPct, startedAt: Date.now() });
}

export function organelleOnTurnComplete(
    slug: string,
    surface: string,
    session: string,
    model: string | null,
    readCtxPct: () => number | null,
): OpRow {
    ensureDirs();
    const flight = inFlight.get(session);
    inFlight.delete(session);
    let toPct: number | null = null;
    try { toPct = readCtxPct(); } catch { toPct = null; }
    const fromPct = flight?.fromPct ?? null;

    let klass: OpRow['klass'];
    let opPct: number | null = null;
    let note: string | undefined;
    if (fromPct === null || toPct === null) {
        klass = 'unclassifiable';
        note = fromPct === null ? 'no fromPct (sidecar unreadable at dispatch)' : 'no toPct (sidecar unreadable at completion)';
    } else if (toPct < fromPct - 1) {
        // Window shrank materially — a /clear or re-sleeve happened mid-flight; not an op.
        klass = 'unclassifiable';
        note = `toPct ${toPct} < fromPct ${fromPct} — window shrank mid-transaction`;
    } else if (fromPct <= 1) {
        // The turn started from an empty window: this is a wake/cold-load cache build,
        // not a unit of work (the discriminator that nearly cost the constant — Jim's
        // 970K trap, stated on the instrument's face).
        klass = 'wake';
        opPct = Math.max(0, toPct - fromPct);
    } else {
        klass = 'work';
        opPct = Math.max(0, toPct - fromPct);
    }

    const row: OpRow = {
        ts: new Date().toISOString(), slug, surface, session, model,
        fromPct, toPct, opPct, def: OP_DEF, klass, ...(note ? { note } : {}),
    };
    try {
        fs.appendFileSync(poolPath(slug, surface), JSON.stringify(row) + '\n');
    } catch (err) {
        alarm('pool-append-failed', { session, error: (err as Error).message });
    }
    if (klass === 'unclassifiable') alarm('unclassifiable-op-row', { row });

    // Persist-as-you-go spoke stats — the record survives the writer.
    try {
        const stats = readSpokeStats(session) ?? {
            session, slug, surface, model,
            birth: new Date(flight?.startedAt ?? Date.now()).toISOString(),
            lastWrite: '', opCount: 0, opMaxPct: 0, opSumPct: 0,
            lastCtxPct: null, terminalAct: null,
        } as SpokeStats;
        stats.lastWrite = row.ts;
        stats.model = model ?? stats.model;
        stats.lastCtxPct = toPct;
        if (klass === 'work' && opPct !== null) {
            stats.opCount += 1;
            stats.opMaxPct = Math.max(stats.opMaxPct, opPct);
            stats.opSumPct += opPct;
        }
        writeSpokeStats(stats);
    } catch (err) {
        alarm('spoke-stats-write-failed', { session, error: (err as Error).message });
    }
    return row;
}

function poolPath(slug: string, surface: string): string {
    return path.join(OP_POOL_DIR, `${slug}-${surface}.jsonl`);
}
function spokeStatsPath(session: string): string {
    return path.join(SPOKE_STATS_DIR, `${session}.json`);
}
export function readSpokeStats(session: string): SpokeStats | null {
    try { return JSON.parse(fs.readFileSync(spokeStatsPath(session), 'utf-8')) as SpokeStats; }
    catch { return null; }
}
function writeSpokeStats(stats: SpokeStats): void {
    ensureDirs();
    const tmp = spokeStatsPath(stats.session) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(stats, null, 2));
    fs.renameSync(tmp, spokeStatsPath(stats.session));
}

function alarm(kind: string, detail: Record<string, unknown>): void {
    try {
        fs.appendFileSync(ORGANELLE_ALARMS, JSON.stringify({ ts: new Date().toISOString(), kind, ...detail }) + '\n');
        console.warn(`[spoke-organelle] ALARM ${kind}: ${JSON.stringify(detail).slice(0, 300)}`);
    } catch { /* last resort: the console line above */ }
}

// ── Integrator: the reserve and the line ─────────────────────────────────────

function empiricalQuantile(sorted: number[], q: number): number {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[idx];
}

/**
 * The reserve for a spoke on (slug, surface): max(rolling pooled p99, own max so far).
 * Tenshi's grammar: an unclassifiable row INSIDE the rolling window refuses the pooled
 * term (alarm, bad row in hand) — the fallback constant serves, own-max still applies.
 * Below the sample floor the pooled term declares the fallback (never max-of-few wearing
 * p99's label). The rolling window is Jim's drift answer: noise converges away while
 * genuine drift moves the number; an all-time pool would converge away the change it
 * most needs to see.
 */
export function computeReserve(slug: string, surface: string, session: string): ReserveResult {
    const windowOps = opPoolWindowOpsFor(slug, surface);
    const minSamples = Math.max(100, opPoolMinSamplesFor(slug, surface)); // 100 = the definitional floor, never lower
    const ceiling = senescenceCeilingPctFor(slug, surface);
    const fallback = fallbackReservePctFor(slug, surface);
    const ownMaxPct = readSpokeStats(session)?.opMaxPct ?? 0;

    let rows: OpRow[] = [];
    try {
        const raw = fs.readFileSync(poolPath(slug, surface), 'utf-8');
        const lines = raw.split('\n').filter(Boolean);
        // Jim's M2: an UNPARSEABLE line is maximally unclassifiable — it becomes a
        // sentinel row that trips the refusal below, never a silent null-drop. The
        // most likely corruption (a torn final line after a crash) is exactly the one
        // that must not vanish (Casey: a damaged record is evidence of the damaging
        // event — treat it as the most evidence-bearing row, not the least).
        rows = lines.slice(-windowOps).map((l): OpRow => {
            try { return JSON.parse(l) as OpRow; }
            catch {
                return {
                    ts: '', slug, surface, session: '(unparseable)', model: null,
                    fromPct: null, toPct: null, opPct: null, def: OP_DEF,
                    klass: 'unclassifiable', note: `unparseable pool line: ${l.slice(0, 120)}`,
                };
            }
        });
    } catch { /* no pool yet */ }

    const windowRows = rows.filter(r => r.def === OP_DEF);
    const droppedDefMismatch = rows.length - windowRows.length;
    const bad = windowRows.find(r => r.klass === 'unclassifiable');
    let pooledP99: number | null = null;
    let pooledMax: number | null = null;
    let refused = false;
    let work: number[] = [];
    if (bad) {
        refused = true;
        alarm('line-refused-contaminated-window', { badRow: bad, slug, surface });
    } else {
        work = windowRows.filter(r => r.klass === 'work' && r.opPct !== null).map(r => r.opPct as number);
        if (work.length >= minSamples) {
            pooledP99 = empiricalQuantile([...work].sort((a, b) => a - b), 0.99);
        } else if (work.length > 0) {
            // Cold-start ladder (Jim, from Darron's no-man's-land question, 2026-08-15):
            // below the floor a p99 would be the max wearing a quantile's label — so USE
            // the max, deliberately, labelled as what it is. A max computed from the
            // garden's own ops is self-calibrating from op one and conservative by
            // construction — cold-start becomes the safest period, not a danger window.
            // The declared constant serves only a genuinely empty pool (n = 0).
            pooledMax = Math.max(...work);
        }
        // Jim's def-mismatch note: exclusion is correct (rows under another definition
        // are not comparable) but a silent collapse below the floor after a definition
        // change would read as a mystery — make it legible.
        if (pooledP99 === null && droppedDefMismatch > 0) {
            alarm('sample-below-floor-after-def-mismatch-drop', { slug, surface, droppedDefMismatch, sampleN: work.length });
        }
    }

    const candidates: Array<{ v: number; source: ReserveResult['source'] }> = [
        { v: ownMaxPct, source: 'own-max' },
    ];
    if (pooledP99 !== null) candidates.push({ v: pooledP99, source: 'pooled-p99' });
    else if (pooledMax !== null) candidates.push({ v: pooledMax, source: 'pooled-max' });
    else candidates.push({ v: fallback, source: 'fallback-constant' });
    const best = candidates.reduce((a, b) => (b.v > a.v ? b : a));

    return {
        reservePct: best.v,
        linePct: Math.max(0, ceiling - best.v),
        source: best.source,
        pooledP99Pct: pooledP99,
        ownMaxPct,
        // Jim's M3: report the evidence that FED the statistic, never the evidence that
        // existed (a reader deciding whether to trust the line deserves the filtered count).
        sampleN: work.length,
        droppedDefMismatch,
        refused,
        ...(bad ? { refusalRow: bad } : {}),
        def: OP_DEF,
    };
}

/** One function, two call sites (§2.3): admission and senescence share it.
 *  fits() in pct terms: current ctx + the boundary job-class reserve ≤ ceiling. */
export function fits(ctxPct: number, reservePct: number, ceilingPct: number): boolean {
    return ctxPct + reservePct <= ceilingPct;
}

/**
 * The boundary check — runs at every work-unit boundary, OBSERVE-ONLY in this build
 * (counters observe, never gate; the retirement ACT is P3 behind the Amendment-1
 * ruling + Q2 + the MNT-115 turn-state gate). Cheap-idle below boundaryCheckMinCtxPct
 * (Darron's laziness ruling: the comparison can idle early; the value is one max()
 * and a subtraction when it matters).
 */
export function boundaryCheck(slug: string, surface: string, session: string): void {
    const stats = readSpokeStats(session);
    const ctx = stats?.lastCtxPct;
    if (ctx === null || ctx === undefined) return;
    if (ctx < boundaryCheckMinCtxPctFor(slug, surface)) return;
    const r = computeReserve(slug, surface, session);
    const wouldRetire = !fits(ctx, r.reservePct, senescenceCeilingPctFor(slug, surface));
    try {
        fs.appendFileSync(path.join(HEALTH_DIR, 'hearth-counters.jsonl'), JSON.stringify({
            ts: new Date().toISOString(), kind: 'boundary-check', slug, surface, session,
            ctxPct: ctx, linePct: r.linePct, reservePct: r.reservePct, source: r.source,
            sampleN: r.sampleN, wouldRetire,
            enabled: senescenceEnabledFor(slug, surface),
        }) + '\n');
    } catch { /* observe-only; nothing to do */ }
}

// ── The winding-up record (Casey's clause 5/7 — two acts, two names) ─────────

export function writeWindingUp(entry: {
    session: string; slug: string; surface: string;
    act: 'senescence' | 'compaction-retirement' | 'reaped' | 'retired';
    reason?: string;
    ctxPct?: number | null; linePct?: number | null;
    derivation?: Partial<ReserveResult>;
    /** compaction-retirement only: the unbanked turn declared as a NAMED ABSENCE —
     *  an absence shown with its method, never implied (Amendment-1 draft clause 5). */
    unbankedTurn?: string;
}): void {
    ensureDirs();
    const stats = readSpokeStats(entry.session);
    if (stats) {
        stats.terminalAct = entry.act;
        stats.terminalReason = entry.reason;
        stats.lastWrite = new Date().toISOString();
        try { writeSpokeStats(stats); } catch { /* register row below still lands */ }
    }
    try {
        fs.appendFileSync(WINDING_UP_REGISTER, JSON.stringify({
            ts: new Date().toISOString(), ...entry, stats: stats ?? 'died-without-declaring (no stats record)',
        }) + '\n');
    } catch (err) {
        alarm('winding-up-write-failed', { session: entry.session, error: (err as Error).message });
    }
}

// ── The hearth pulse (P1b) ───────────────────────────────────────────────────

const pulseTimers = new Map<string, NodeJS.Timeout>();

/** Clear the pulse (activity IS the reset). Called on dispatch-start and on retirement. */
export function clearHearthPulse(session: string): void {
    const t = pulseTimers.get(session);
    if (t) { clearTimeout(t); pulseTimers.delete(session); }
}

/**
 * Arm the pulse on turn-complete. Arms ONLY when hearthPulseEnabled (default false —
 * this build ships inert). `fire` is the dispatcher's closure over its own enqueue with
 * the session's BAKED message (materialised at spawn, §2.8 — this module never fetches
 * message content). The fire re-checks idleness via `stillIdle` so a pulse can never
 * interrupt a busy seat (acceptance §8.6-5).
 */
export function armHearthPulse(
    slug: string, surface: string, session: string,
    stillIdle: () => boolean,
    fire: () => void,
): void {
    clearHearthPulse(session);
    if (!hearthPulseEnabledFor(slug, surface)) return;
    const ms = hearthPulseMinutesFor(slug, surface) * 60_000;
    const t = setTimeout(() => {
        pulseTimers.delete(session);
        try {
            if (!stillIdle()) return; // raced a dispatch — activity already reset the clock
            fs.appendFileSync(path.join(HEALTH_DIR, 'hearth-counters.jsonl'), JSON.stringify({
                ts: new Date().toISOString(), kind: 'pulse-fire', slug, surface, session,
            }) + '\n');
            fire();
        } catch (err) {
            alarm('pulse-fire-failed', { session, error: (err as Error).message });
        }
    }, ms);
    t.unref?.();
    pulseTimers.set(session, t);
}

// ── MNT-115: the declared busy-state predicate (shared by sweeps + drain) ────

/**
 * The declared work-property, on disk: the diary-sink's current.json txn pointer —
 * dispatched → pointer exists; submit_response → cleared. The single-live-transaction
 * invariant is what makes this honest. Out-of-process readers (han-update's drain) get
 * the same truth as in-process ones. Sink convention (tmux-dispatcher's):
 * `<healthDir>/<stemKey>-diary-capture/current.json`. `keys` are the stem keys to check
 * (a pooled stem's key is its tmux session name; a non-pooled surface's key is its
 * slug — callers pass both when in doubt).
 */
export function declaredBusy(
    healthDirPath: string,
    keys: string[],
    maxAgeMs: number = 15 * 60_000,
): boolean {
    return keys.some(k => {
        const p = path.join(healthDirPath, `${k}-diary-capture`, 'current.json');
        let exists = false;
        try { exists = fs.existsSync(p); } catch { return false; }
        if (!exists) return false;
        // Jim's M1 second half + Casey's gift: EXISTENCE IS NOT LIVENESS — the same
        // category error the chrome scrape made, one layer in. The declaration
        // carries its own date (`startedAt`, written at dispatch), so a pointer
        // older than the transaction ceiling is a crashed mind's residue, not a
        // thinking one — a caveat with a lapse clause (Casey: a declaration of
        // "thinking" is a perishable fact; its evidence is on its own face).
        let raw: { startedAt?: string };
        try {
            raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { startedAt?: string };
        } catch {
            // Tenshi's torn-pointer live-fire (+ Casey's independent reproduction): a
            // TORN pointer — partial write, truncated read — previously fell to the
            // outer catch and read NOT-BUSY, silently. Casey's doctrine, now in the
            // metal here as it already is in the pool reader: a corrupted record is
            // WORSE than a missing one — it is evidence of the damaging event (a spoke
            // that may have died mid-turn, the single case SEC-04 exists for). Fail
            // toward BUSY, with the alarm, never silently open.
            alarm('declared-busy-torn-pointer', { key: k });
            return true;
        }
        const started = raw.startedAt ? Date.parse(raw.startedAt) : NaN;
        if (Number.isNaN(started)) {
            // Undated pointer: fail toward BUSY (conservative for a drain — a human
            // inspects) but alarm so it cannot sit silent.
            alarm('declared-busy-undated-pointer', { key: k });
            return true;
        }
        return (Date.now() - started) <= maxAgeMs;
    });
}
