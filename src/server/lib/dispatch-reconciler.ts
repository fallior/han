/**
 * MNT-070 — the RECONCILER: diagnose-then-branch on a wedged dispatch (Darron's shape,
 * Jim's plan-audit GREEN ms1udg94, thread ms1j9h92). The pure half: the recovery-ladder
 * decision, the continue-nudge text (JA1), and the cross-process `resumable` marker
 * (JA2's TTL substrate). The pane CLASSIFIER lives in tmux-dispatcher (it owns the
 * chrome regexes); this module is a LEAF — no dispatcher import, so the dispatcher can
 * import from here without a cycle. I/O orchestration lives in the walker
 * (`scripts/wander-walk.ts`, phase-1 consumer); `human-responder` is the phase-2
 * consumer (DEC-081: same helper, second consumer).
 *
 * THE LAWS (S74 / DEC-103, non-negotiable — the suite pins them):
 *  - Diagnose-then-branch, never blind retry. The pane-signature is the objective
 *    discriminator that makes same-spoke nudging safe where blind re-fire never was.
 *  - ONE recovery per beat, ever — keyed on the receipt trail (a 'recovery-attempt'
 *    receipt written BEFORE the action; a second failure holds, full stop).
 *  - Content-refusal NEVER recovers: a genuine stand-down holds, exactly as J5 ruled.
 *  - Fail toward HOLD: interactive-question (R011) and unrecognised pane states hold.
 *  - Every terminal state is still DEC-103's alert-and-hold — now LOUD (MNT-069's ntfy).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** JA4 — the classifier's closed verdict set (the suite's heart). 'session-gone' is the
 *  caller-supplied fifth state (no pane to classify — the vessel is dead/unregistered). */
export type PaneClass = 'resumable' | 'still-thinking' | 'interactive-question' | 'unrecognised';

export type ReconcileVerdict =
    | 'recovered-landed'   // rung 0: the post actually LANDED, only the capture died (JA3) — no re-anything
    | 'resume-same-spoke'  // rung 1 (primary): continue-nudge the SAME healthy vessel (Darron's weather ruling)
    | 'redeliver-leg'      // rung 2: session gone, /tmp leg survives — fresh stem verifies + posts its own leg
    | 'redispatch-beat'    // rung 3: session gone, nothing composed — ONE re-dispatch of the beat on a fresh stem
    | 'extend'             // JA4: processing chrome = progress present → extend the wait, no action
    | 'hold';              // rung 4: stand-down / unrecognised / interactive / recovery spent → alert-and-hold, LOUD

/**
 * The pure recovery-ladder decision (the spoke-lifecycle pattern — testable without tmux).
 * Precedence, pinned by the suite:
 *   1. stand-down → hold (content-refusal never recovers, J5 — absolute, before everything)
 *   2. dbPostLanded → recovered-landed (diagnosis, not recovery — never burns the one attempt,
 *      and it is always right to accept a landed leg, even after a spent recovery)
 *   3. recoverySpent → hold (one reconciliation per beat, ever)
 *   4. still-thinking → extend (progress present, wait — the liveness-keyed-waiting law)
 *   5. resumable → resume-same-spoke (rung 1)
 *   6. session-gone → legFileFresh ? redeliver-leg : redispatch-beat (rungs 2/3)
 *   7. interactive-question / unrecognised → hold (fail toward hold, JA4)
 */
export function reconcileDecision(d: {
    standDown: boolean;
    recoverySpent: boolean;
    dbPostLanded: boolean;
    pane: PaneClass | 'session-gone';
    legFileFresh: boolean;
}): ReconcileVerdict {
    if (d.standDown) return 'hold';
    if (d.dbPostLanded) return 'recovered-landed';
    if (d.recoverySpent) return 'hold';
    if (d.pane === 'still-thinking') return 'extend';
    if (d.pane === 'resumable') return 'resume-same-spoke';
    if (d.pane === 'session-gone') return d.legFileFresh ? 'redeliver-leg' : 'redispatch-beat';
    return 'hold'; // interactive-question | unrecognised — fail toward hold
}

/**
 * JA1 — the continue-nudge, with the check-thread-first belt IN the text (never left to
 * prompt discipline). ONE line (it is sent raw via send-keys, not the file-pointer path —
 * a fixed mechanic string + system ids only, nothing hostile can ride it). The seat stays
 * the poster (sovereignty): the nudge asks it to complete ITS OWN turn, nothing more.
 */
export function continueNudgeText(conversationId: string, beat: number): string {
    return `The API dropped mid-response on your last turn (weather, not your fault). Check the thread first: fetch your conversation ${conversationId} and if your beat-${beat} leg already landed, do NOT re-post — just call submit_response noting it landed. Otherwise continue exactly where you left off: post your composed leg via your normal mechanics, then call submit_response.`;
}

// ————— the `resumable` marker (JA2's substrate) —————
// Cross-process by design: the walker (a detached process) diagnoses and claims; the
// pool-manager (the long-lived responder process) enforces the TTL fallback — so a vessel
// marked resumable that no reconciler claims within the registry TTL is retired by the one
// process whose kill-sweep actually runs (the MNT-070 zombie was a retire whose kill queue
// died with the walker process). Marker files live under the health dir; fixed fields only.

export interface ResumableMarker {
    slug: string;
    surface: string;
    stem_id: string;
    tmux_session: string;
    conversation_id?: string;
    marked_at: string; // ISO
    reason: string;    // fixed mechanic string (e.g. the DispatchTimeoutError class), never content
}

function resumableDir(): string {
    const dir = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');
    return path.join(dir, 'resumable');
}

export function resumableMarkerPath(tmuxSession: string): string {
    return path.join(resumableDir(), `${tmuxSession}.json`);
}

/** Write the marker (idempotent — a re-mark refreshes nothing: first marked_at stands so the
 *  TTL cannot be extended by repeated failures). Never throws. */
export function markResumable(marker: ResumableMarker): void {
    try {
        fs.mkdirSync(resumableDir(), { recursive: true });
        const p = resumableMarkerPath(marker.tmux_session);
        if (fs.existsSync(p)) return; // first mark stands — the TTL clock never resets
        fs.writeFileSync(p, JSON.stringify(marker, null, 2) + '\n', 'utf-8');
    } catch (err) {
        console.warn(`[dispatch-reconciler] resumable marker write failed (non-fatal): ${(err as Error).message}`);
    }
}

export function readResumableMarkers(slug: string, surface: string): ResumableMarker[] {
    try {
        return fs.readdirSync(resumableDir())
            .filter(f => f.endsWith('.json'))
            .map(f => { try { return JSON.parse(fs.readFileSync(path.join(resumableDir(), f), 'utf-8')) as ResumableMarker; } catch { return null; } })
            .filter((m): m is ResumableMarker => m !== null && m.slug === slug && m.surface === surface);
    } catch {
        return []; // dir absent — nothing marked
    }
}

/** Clear on successful claim (rung-1 success) or on TTL retire. Never throws. */
export function clearResumableMarker(tmuxSession: string): void {
    try { fs.unlinkSync(resumableMarkerPath(tmuxSession)); } catch { /* absent — fine */ }
}

/** JA2 — pure TTL check. Unparseable marked_at counts as EXPIRED (fail toward cleanup:
 *  a marker we cannot date must not shield a zombie forever). */
export function resumableExpired(marker: ResumableMarker, ttlMinutes: number, nowMs: number): boolean {
    const marked = Date.parse(marker.marked_at);
    if (Number.isNaN(marked)) return true;
    return nowMs - marked >= ttlMinutes * 60_000;
}
