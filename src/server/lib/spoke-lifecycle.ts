/**
 * spoke-lifecycle.ts — MNT-061: the idle-recycle/reap decisions + the fit-calculation (pure
 * logic; the dispatcher wires IO around it). DEC-101 AMENDED by this build: a third reap
 * trigger (idle-abandonment) and a recycle path join the settled two (thread-resolve,
 * ctx≥92-at-idle). The mechanic is Darron's as ruled (2026-07-20, journal MNT-061): at
 * `spokeIdleReapHours` unserved, a bound spoke is DECOUPLED from its thread; ctx below the
 * re-thread ceiling → recycled to the pool WITH its context (cross-pollination is the design
 * goal; NO /clear), else reaped. Assignment of a new/reviving thread runs the FIT-CALCULATION
 * (spoke_ctx + estimated_burden ≤ fit ceiling) with BEST-FIT packing and Jim's affinity
 * preference (a reviving thread re-binds its former spoke at delta-only burden).
 *
 * Fail-toward-holding (the MNT-060 F3 polarity, inherited as a birthright): an unreadable idle
 * clock → skip + alert, never reap; an unmeasurable ctx at decouple → RECYCLE (hold, don't
 * kill — the unmeasurable free stem is never fit-selected and the 24h substrate reload bounds
 * its tenure); an unmeasurable ctx at assignment → that candidate is skipped.
 *
 * Every exit leaves a receipt (Casey's disposal-schedule precedent; Jim's ruling: both verbs)
 * — `~/.han/health/spoke-lifecycle-events.jsonl`, rotated like wm-flush-errors.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PoolStem } from './stem-pool';

/** Measured chars/token from the wake tracker (T3 wake-reconcile, 2026-07-15: 2.4–2.8 across
 *  n=178 receipts) — NEVER chars÷4, which FI #116 falsified (~1.6× undercount → systematic
 *  over-packing). Midpoint carried; the tune-signal is the tracker's own ongoing receipts. */
export const CHARS_PER_TOKEN = 2.6;
/** Stated-guess: tokens of headroom a compose needs beyond the thread history (response +
 *  freshen delta + scaffold). Tune-signal: raise if assigned spokes overflow-reap at first
 *  serve, lower if fitting partials sit unused. */
export const RESPONSE_HEADROOM_TOKENS = 8_000;
/** Tokens per ctx % — the ~200K context window ÷ 100. A serve-model constant, not a guess. */
export const TOKENS_PER_CTX_PCT = 2_000;

/** A thread's estimated ctx-% burden from its total message chars (history load + headroom). */
export function burdenPctForChars(threadChars: number): number {
    const tokens = threadChars / CHARS_PER_TOKEN + RESPONSE_HEADROOM_TOKENS;
    return tokens / TOKENS_PER_CTX_PCT;
}

/** MNT-061 (Tenshi's trust-partition seam): the trust tier of a thread. TODAY the garden has
 *  exactly ONE tier — every thread's authors are the family — so this is a constant; the day an
 *  untrusted tier arrives (public surfaces, external clients, the thread-gradient's untrusted
 *  band), this resolves per-thread and the fit predicate's AND partitions the pool.
 *
 *  THE CONTINUING-CONFLICT RULE (Casey's counsel fold, 2026-07-23 — the day-two law, named
 *  here so the tier day cannot inherit an intake-only conflicts register): a public door makes
 *  a thread's tier a MUTABLE fact of its life (an untrusted author can post INTO an existing
 *  thread), so when tiers become real, tier is RE-EVALUATED AT SERVE (or on new-author
 *  events), not only at bind — and a mid-tenure escalation routes through the same
 *  stampTier→'mixed'/bind-refusal machinery, with a receipt. Fiduciary conflict duties are
 *  continuing, not intake-only; the intake-only register is the instrument that fails. */
export const FAMILY_TRUST_TIER = 'family';
export function threadTrustTier(_conversationId: string): string {
    return FAMILY_TRUST_TIER;
}

/** Tier-compatibility for the fit predicate. One tier today → always true for real inputs; the
 *  slot is the seam (Tenshi: build the isolation boundary WITH the concrete — a recycled spoke's
 *  context is un-scrubbed by design, so mixing across tiers must be unrepresentable, not
 *  scrubbed). PRECEDENCE, chosen not slipped: the partition WINS over affinity — a former spoke
 *  that has since touched another tier never re-binds on the hint. */
export function tierCompatible(stemTier: string | undefined, threadTier: string): boolean {
    return (stemTier ?? FAMILY_TRUST_TIER) === threadTier;
}

/** The conflicted-out sentinel (Tenshi's stamp-fix, folded at land 2026-07-23): a stem whose
 *  context has touched DIFFERING tiers is 'mixed' — equality-incompatible with every real tier
 *  by `tierCompatible`'s own arithmetic, so it finishes its current tenure (the 92-net) and
 *  ages out, never fit-selected again. Quarantine by construction; no scrubbing (Bolkiah's
 *  conflicted practitioner: not sanitised — conflicted with everyone). */
export const MIXED_TRUST_TIER = 'mixed';

/** The tier STAMP — a history, not a label (the :1505 forged-history fix): first bind stamps
 *  the thread's tier; a same-tier re-bind is idempotent; a DIFFERING tier quarantines the
 *  vessel as 'mixed'. Last-writer-wins was the bug — it erased the record of a crossing in
 *  the same motion that made it. This is the BELT: if any path ever slips a cross-tier bind
 *  past `bindTierDecision`'s refusal, the stamp still quarantines. Neither trusts the other. */
export function stampTier(existing: string | undefined, threadTier: string): string {
    return !existing || existing === threadTier ? threadTier : MIXED_TRUST_TIER;
}

/** The bind-time REFUSAL — the physics (the E1 law: a partition enforced only at selection is
 *  a label; enforced at the last chokepoint it holds whichever path delivered the stem —
 *  fit-selection, raced-lease fallback, or the tier-blind generic checkout). A stem whose
 *  existing tier differs from the thread's is refused: the caller retires it with a
 *  'bind-refused' receipt and fails toward FRESH (the pool floor), never a retry loop
 *  (S74/DEC-103). Unreachable today (one tier); load-bearing the day there are two. */
export function bindTierDecision(stemTier: string | undefined, threadTier: string):
    { action: 'bind'; stamp: string } | { action: 'refuse'; stemTier: string } {
    if (stemTier && stemTier !== threadTier) return { action: 'refuse', stemTier };
    return { action: 'bind', stamp: stampTier(stemTier, threadTier) };
}

/** The idle clock (Jim's null-clock ruling): `last_served_at`, else the bind time — a bind IS a
 *  serve for clock purposes. In this schema the bind time is `bound_at` (bindSpoke deletes
 *  `leased_at`); `leased_at` covers the transient pre-bind lease. Null = no clock at all
 *  (malformed row) → the caller alerts + skips, never reaps. */
export function idleClock(stem: PoolStem): string | null {
    return stem.last_served_at ?? stem.bound_at ?? stem.leased_at ?? null;
}

export type IdleAction =
    | { action: 'keep' }
    | { action: 'recycle'; idleHours: number; ctxPct: number | null }
    | { action: 'reap'; idleHours: number; ctxPct: number }
    | { action: 'skip-alert'; reason: string };

/** The decouple decision for one bound spoke. Pure — the dispatcher supplies now + ctx. */
export function decideIdleAction(
    stem: PoolStem, nowMs: number, idleReapHours: number, rethreadCeilingPct: number, ctxPct: number | null,
): IdleAction {
    if (stem.state !== 'spoke') return { action: 'keep' };
    const clock = idleClock(stem);
    if (clock === null) return { action: 'skip-alert', reason: 'no-idle-clock (malformed row: no last_served_at/bound_at/leased_at)' };
    const clockMs = Date.parse(clock);
    if (Number.isNaN(clockMs)) return { action: 'skip-alert', reason: `unreadable-idle-clock (${clock.slice(0, 40)})` };
    const idleHours = (nowMs - clockMs) / 3600_000;
    if (idleHours < idleReapHours) return { action: 'keep' };
    // Idle-crossed. Recycle-vs-reap by ctx — unmeasurable ctx fails toward HOLDING (recycle):
    // the unmeasurable free stem is never fit-selected, and the 24h reload bounds its tenure.
    if (ctxPct === null || ctxPct < rethreadCeilingPct) return { action: 'recycle', idleHours, ctxPct };
    return { action: 'reap', idleHours, ctxPct };
}

export interface FitSelection {
    stemId: string;
    mode: 'affinity' | 'best-fit' | 'freshest';
    ctxPct: number;
}

/**
 * MNT-061 fit-calculation + BEST-FIT assignment over the FREE stems.
 * Every step is gated on `tierCompatible` FIRST (Tenshi's partition — it wins over affinity and
 * over packing efficiency; an incompatible stem is invisible to this thread). Then:
 * (1) affinity — a stem whose `last_thread` is this thread carries its history in-context, so
 * its true burden is delta-only (≈ the continue cost): eligible up to the CONTINUE semantics,
 * preferred outright (Jim's ruling (a)). (2) best-fit — among stems whose measurable ctx ≤
 * rethread ceiling AND ctx + burden ≤ fit ceiling, take the TIGHTEST (highest ctx): minimises
 * live vessels, maximises cross-pollination density. REQUIRES a measured burden — `burdenPct
 * null` (estimator failure) fails toward FRESH, never toward packing against an unmeasured
 * load (Tenshi's sharpening 1, the F3 polarity at the fit layer). (3) freshest — nothing fits
 * (a big thread / no measurable burden): the lowest-ctx stem (max room; the 92% continue-net
 * catches a mis-estimate). Unmeasurable-ctx candidates are skipped at every step. Null = pool
 * empty of eligible candidates → the caller falls back to the generic checkout.
 */
export function selectStemForThread(
    freeStems: PoolStem[], conversationId: string, ctxOf: (stem: PoolStem) => number | null,
    burdenPct: number | null, fitCeilingPct: number, rethreadCeilingPct: number,
    threadTier: string = FAMILY_TRUST_TIER,
): FitSelection | null {
    const measurable: Array<{ stem: PoolStem; ctx: number }> = [];
    for (const stem of freeStems) {
        if (stem.state !== 'free') continue;
        if (!tierCompatible(stem.trust_tier, threadTier)) continue; // the partition, before everything
        const ctx = ctxOf(stem);
        if (ctx === null) continue;
        measurable.push({ stem, ctx });
    }
    if (measurable.length === 0) return null;
    // (1) affinity: former spoke of this very thread, at delta-only burden — allow to the
    // rethread ceiling (its history needs no reload; the 92 continue-net still guards above).
    const affine = measurable
        .filter(c => c.stem.last_thread === conversationId && c.ctx < rethreadCeilingPct)
        .sort((a, b) => b.ctx - a.ctx)[0];
    if (affine) return { stemId: affine.stem.stem_id, mode: 'affinity', ctxPct: affine.ctx };
    // (2) best-fit: tightest stem the burden still fits — only with a MEASURED burden.
    if (burdenPct !== null) {
        const fitting = measurable
            .filter(c => c.ctx < rethreadCeilingPct && c.ctx + burdenPct <= fitCeilingPct)
            .sort((a, b) => b.ctx - a.ctx)[0];
        if (fitting) return { stemId: fitting.stem.stem_id, mode: 'best-fit', ctxPct: fitting.ctx };
    }
    // (3) freshest: max room — the big-thread AND the unmeasured-burden landing (fail toward fresh).
    const freshest = measurable.sort((a, b) => a.ctx - b.ctx)[0];
    return { stemId: freshest.stem.stem_id, mode: 'freshest', ctxPct: freshest.ctx };
}

// ————— receipts (both verbs; Casey's disposal-schedule precedent) —————

const RECEIPT_ROTATE_BYTES = 1_000_000;

function receiptFile(): string {
    const dir = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');
    return path.join(dir, 'spoke-lifecycle-events.jsonl');
}

/** Receipt fields are SYSTEM identifiers + numbers + fixed strings ONLY — never thread titles
 *  or message content (Tenshi's sharpening 2 / the MNT-060 F2 hygiene: a thread title is
 *  attacker-influenced the day threads are public; nothing injectable enters a health log a
 *  future reader trusts). `thread` is the conversation ID, system-generated. */
export interface SpokeLifecycleEvent {
    ts: string;
    slug: string;
    surface: string;
    stem_id: string;
    tmux_session: string;
    verb: 'recycle' | 'reap' | 'skip-alert' | 'assign' | 'bind-refused'
        // MNT-070: the resumable-vessel lifecycle — marked (the retire deferred; the reconciler
        // gets first claim) and the JA2 TTL fallback (unclaimed within the registry TTL → retired).
        | 'marked-resumable' | 'resumable-ttl-retired';
    thread?: string;
    idle_hours?: number;
    ctx_pct?: number | null;
    detail?: string;
}

/** Append a lifecycle receipt — a real thing that ends or redirects a warm self's tenure must
 *  leave a legible trace. Never throws (a receipt failure must not break the sweep); rotates
 *  at ~1MB like wm-flush-errors (the silence-breaker must not become its own slow-burn). */
export function writeSpokeLifecycleReceipt(ev: SpokeLifecycleEvent): void {
    try {
        const file = receiptFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try {
            if (fs.existsSync(file) && fs.statSync(file).size > RECEIPT_ROTATE_BYTES) {
                fs.renameSync(file, file + '.1');
            }
        } catch { /* best-effort rotation */ }
        fs.appendFileSync(file, JSON.stringify(ev) + '\n', 'utf-8');
    } catch (err) {
        console.warn(`[spoke-lifecycle] receipt write failed: ${(err as Error).message}`);
    }
}
