/**
 * session-hearth.ts — the hearth pulse for the INTERACTIVE seat (warm-checkout P2).
 *
 * The dispatched surfaces get their pulse from the dispatcher's turn-complete arming
 * (spoke-organelle.armHearthPulse). The interactive seat cannot use that path: its typed
 * turns never traverse the dispatcher, and — the load-bearing finding (Tenshi F2, thread
 * msz950i2) — `send-keys` into a pane where a HUMAN may be mid-composition CONCATENATES
 * with their half-typed text: a prompt authored by neither party, submitted under their
 * hand. The predicate available (`cli-busy`, written at UserPromptSubmit) is turn-granular;
 * the hazard is keystroke-granular. So this module PUSHES NOTHING.
 *
 * Design (the folds, by name):
 *  - LAYER 1 — boundary PULL (Tenshi's direction): this checker computes "a pulse is due"
 *    from disk and writes a DUE-FILE carrying the standing message (materialised at WRITE
 *    time — §2.8's blast-radius law, never fetched at fire). The seat's own Stop hook
 *    (src/hooks/hearth-pulse-pull.sh) consumes it at a turn boundary the seat already
 *    owns — the pulse arrives through the harness's feedback channel, never the input box.
 *  - LAYER 2 — the quiet-hours PUSH (Darron's ruling 2026-08-20 ~06:52, verbatim in thread
 *    mt04sic8 at mt0kkoba; built 2026-08-20 after both lands per Jim's sequencing): when a
 *    due-file sits UNCONSUMED (the seat idle — no Stop to pull it), read the input box.
 *      EMPTY → consume the due-file and deliver the pulse directly (paste + Enter — the one
 *        transport that can wake a turn-less seat; Tenshi's attribution note holds: the
 *        message is machine-authored in an attended transcript, so it is STAMPED, below).
 *      NON-EMPTY → snapshot; after ≥5 min unchanged (byte-exact over the extracted box text,
 *        whitespace preserved — the stated comparison method Tenshi asked for) → press Enter,
 *        submitting HIS OWN half-written draft as a real turn ("even if it is half written
 *        it still keeps that spoke warm"); that turn's Stop consumes the due-file via the
 *        EXISTING layer-1 pull, so pulse text NEVER touches his input (F2's fusion channel
 *        does not exist here — the two texts share no path). Changed → he's typing; re-wait.
 *      RACE CURE (Tenshi's build question, Jim-endorsed lean + a keystroke-level belt):
 *        immediately before the Enter, re-check cli-busy (mid-turn → abort; the turn's own
 *        Stop pulls the due-file anyway) AND final-recapture the box (ms window) — any
 *        change aborts. The 5-min window's race shrinks to milliseconds.
 *      STAMP (Casey's clause, Jim-endorsed — it closes her Step-2 concern AND the empty-
 *        branch attribution sibling): every hearth-submitted turn writes a counters row
 *        `session-pulse-push` with submittedBy:'hearth-pulse' and the mode; the draft case
 *        carries length + sha256-prefix, never the text (his words enter the record as his
 *        turn; the stamp identifies WHICH turn a timer sent without copying it). Consent is
 *        a fact about now; the record is read later — the stamp is what lets a future
 *        reader see a machine-submitted turn was consented to.
 *      GATE: a seat past the knee gets neither push nor Enter (fits() re-checked at push
 *        time — the pause path refreshes the stamp but a pending due-file could straddle
 *        the knee-crossing; the re-check closes that straddle).
 *  - NO HTTP ROUTE (Tenshi F3, Casey's split-brain precedent): a runtime control is a
 *    triple {memory, disk, side-effects} and this one keeps NO in-process state a second
 *    process could disagree with — due-ness is COMPUTED from the cli-busy file's mtime and
 *    the last-pulse stamp on disk, every tick, restart-safe. A push channel for state that
 *    is already pullable is a control plane you did not need to build.
 *
 * Activity IS the reset, structurally: consuming a pulse is a turn, a turn writes
 * cli-busy, and due-ness is measured from the freshest of {cli-busy, last pulse}.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { hearthPulseEnabledFor, hearthPulseMinutesFor, hearthStandingMessageFor, computeReserve, fits, senescenceCeilingPctFor } from './spoke-organelle';
import { getContextPctForSession } from './tmux-dispatcher';
import { readPool } from './stem-pool';

const HAN = path.join(os.homedir(), '.han');
const HEALTH = path.join(HAN, 'health');
const COUNTERS = path.join(HEALTH, 'hearth-counters.jsonl');

function busySignalPath(slug: string): string {
    return path.join(HAN, 'signals', `cli-busy-${slug}`);
}
function statePath(slug: string): string {
    return path.join(HEALTH, `hearth-session-${slug}.json`);
}
export function dueFilePath(slug: string): string {
    return path.join(HEALTH, `hearth-due-${slug}-session.json`);
}

function mtimeMs(p: string): number | null {
    try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

function readLastPulseMs(slug: string): number {
    try {
        const j = JSON.parse(fs.readFileSync(statePath(slug), 'utf-8'));
        return typeof j.lastPulseMs === 'number' ? j.lastPulseMs : 0;
    } catch { return 0; }
}

function counter(row: Record<string, unknown>): void {
    try {
        fs.mkdirSync(HEALTH, { recursive: true });
        fs.appendFileSync(COUNTERS, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
    } catch { /* observe-only — never let telemetry break the tick */ }
}

function pushStatePath(slug: string): string {
    return path.join(HEALTH, `hearth-push-${slug}.json`);
}

type PushSnapshot = { text: string; capturedAtMs: number };

function readPushSnapshot(slug: string): PushSnapshot | null {
    try {
        const j = JSON.parse(fs.readFileSync(pushStatePath(slug), 'utf-8'));
        return (typeof j.text === 'string' && typeof j.capturedAtMs === 'number') ? j : null;
    } catch { return null; }
}
function writePushSnapshot(slug: string, snap: PushSnapshot | null): void {
    try {
        if (snap === null) { fs.rmSync(pushStatePath(slug), { force: true }); return; }
        fs.writeFileSync(pushStatePath(slug), JSON.stringify(snap, null, 2));
    } catch { /* disk-only state; next tick retries */ }
}

/**
 * Extract the INPUT-BOX text from a Claude-Code pane, or null when no box is readable
 * (mid-turn spinner, menu, clear-in-progress, capture failure). Null is honest
 * UNDECIDABLE (Casey's precondition: where nothing proves the check was reached, the
 * state is undecidable, not idle-and-fine) — the caller defers, never pushes.
 * Method (read off a LIVE pane's bytes, 2026-08-20, not guessed): the input area sits
 * between the capture's last two full-width `─` rules, its first line prompted `❯ `; an
 * empty box renders `❯` + a non-breaking space. Content = the lines between the rules,
 * `❯ ` stripped from the first. A first line NOT prompted `❯`, or a `❯ 1.`-shaped menu,
 * is a dialog — null. Byte-exact from there (whitespace preserved) — the comparison unit
 * the 5-min unchanged check and the final recapture both use.
 */
export function captureInputBox(tmuxSession: string): string | null {
    let pane = '';
    try {
        pane = execFileSync('tmux', ['capture-pane', '-p', '-t', tmuxSession],
            { encoding: 'utf-8', timeout: 3000 });
    } catch { return null; }
    const lines = pane.replace(/\n+$/, '').split('\n');
    const isRule = (l: string): boolean => l.length >= 8 && /^─+$/.test(l.trim()) && l.trim().length >= 8;
    let bottom = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (isRule(lines[i])) { bottom = i; break; }
    }
    if (bottom <= 0) return null;
    let top = -1;
    for (let i = bottom - 1; i >= 0; i--) {
        if (isRule(lines[i])) { top = i; break; }
    }
    if (top < 0 || bottom - top < 2) return null;
    const content = lines.slice(top + 1, bottom);
    if (!/^\s*❯/.test(content[0])) return null;          // not the input area (dialog, other chrome)
    if (/❯\s*\d+\./.test(content[0])) return null;        // an interactive menu, not input
    content[0] = content[0].replace(/^\s*❯\s?/, '');
    return content.join('\n');
}

/** A rendered input box whose text is only whitespace (incl. the empty box's non-breaking
 *  space) or the TUI's dim placeholder counts as EMPTY — nothing of the human's is in it. */
function boxIsEmpty(text: string): boolean {
    const t = text.replace(/[\s ]+/g, ' ').trim();
    return t === '' || /^Try\s["“]/.test(t);
}

/** Newest client_activity age (s) across this slug's seat sessions — OBSERVE-ONLY data
 *  for the layer-2 experiment. Null = no client / tmux unavailable. */
function newestClientActivityAgeSec(slug: string): number | null {
    try {
        const out = execFileSync('tmux',
            ['list-clients', '-F', '#{session_name} #{client_activity}'],
            { encoding: 'utf-8', timeout: 3000 });
        let newest = 0;
        for (const line of out.split('\n')) {
            const [sess, act] = line.trim().split(/\s+/);
            if (!sess || !act) continue;
            if (!(sess.startsWith(`${slug}-`) || sess.startsWith(`stem-${slug}-session-`))) continue;
            const n = parseInt(act, 10);
            if (Number.isFinite(n) && n > newest) newest = n;
        }
        return newest ? Math.max(0, Math.round(Date.now() / 1000 - newest)) : null;
    } catch { return null; }
}

/**
 * LAYER 2 — one push attempt against an unconsumed due-file. Every branch is disk-state +
 * tmux-read; no in-process memory a restart could lose (a mid-wait restart CONTINUES the
 * wait — the snapshot persists on disk with its capture time; Jim's audit note, 2026-08-20:
 * better than re-waiting, and the failure direction is never a wrong Enter). Returns a
 * verdict string for
 * the counters row. Design source: Darron's ruling (thread mt04sic8 at mt0kkoba) + Casey's
 * stamp + Tenshi's race questions + Jim's sequencing fold — the module header carries the WHY.
 */
function attemptPush(slug: string, seatSession: string, now: number): string {
    // Gate 0: mid-turn → no push of ANY kind (both branches). The live turn's own Stop
    // pulls the due-file — the safe rail always has first claim on a busy seat.
    if (fs.existsSync(busySignalPath(slug))) return 'mid-turn-abort';
    // Gate: a seat past the knee gets neither push nor Enter (Jim's fold — the pause path
    // can't retract an already-written due-file, so the knee is re-checked HERE).
    const ctx = getContextPctForSession(slug, 'session', seatSession);
    if (ctx !== null) {
        const r = computeReserve(slug, 'session', seatSession);
        if (!fits(ctx, r.reservePct, senescenceCeilingPctFor(slug, 'session'))) {
            writePushSnapshot(slug, null);
            return 'senescent-no-push';
        }
    }
    const box = captureInputBox(seatSession);
    if (box === null) { writePushSnapshot(slug, null); return 'box-unreadable-deferred'; }

    if (boxIsEmpty(box)) {
        // EMPTY branch: consume the due-file FIRST (at-most-once — the delivered turn's own
        // Stop must find nothing to pull, or the pulse arrives twice), then paste + Enter.
        // The message is single-lined defensively: send-keys -l is not a bracketed paste, and
        // a literal newline mid-paste is a submit — the fusion class, structurally avoided.
        let message: string;
        try { message = String(JSON.parse(fs.readFileSync(dueFilePath(slug), 'utf-8')).message ?? ''); }
        catch { return 'due-file-vanished'; } // consumed by a racing Stop pull — the good race
        fs.rmSync(dueFilePath(slug), { force: true });
        const line = `Hearth pulse (layer-2 push — the box was empty; submitted-by: hearth-pulse): ${message.replace(/\s*\n\s*/g, ' ')}`;
        execFileSync('tmux', ['send-keys', '-t', seatSession, '-l', line], { timeout: 3000 });
        execFileSync('sleep', ['1']);
        execFileSync('tmux', ['send-keys', '-t', seatSession, 'Enter'], { timeout: 3000 });
        writePushSnapshot(slug, null);
        counter({ kind: 'session-pulse-push', slug, surface: 'session', session: seatSession,
            submittedBy: 'hearth-pulse', mode: 'delivered-into-empty' });
        console.log(`[session-hearth] ${slug}: layer-2 push delivered into empty box (${seatSession})`);
        return 'delivered-into-empty';
    }

    // NON-EMPTY branch: his draft. Snapshot → 5-min unchanged → Enter.
    const snap = readPushSnapshot(slug);
    if (!snap || snap.text !== box) {
        writePushSnapshot(slug, { text: box, capturedAtMs: now });
        return snap ? 'draft-changed-rewait' : 'draft-snapshotted';
    }
    if (now - snap.capturedAtMs < 5 * 60_000) return 'draft-waiting';

    // Unchanged ≥5 min. Race gates, then Enter.
    const busyPath = busySignalPath(slug);
    if (fs.existsSync(busyPath)) { writePushSnapshot(slug, null); return 'mid-turn-abort'; }
    const finalBox = captureInputBox(seatSession);
    if (finalBox === null || finalBox !== box) {
        if (finalBox !== null) writePushSnapshot(slug, { text: finalBox, capturedAtMs: now });
        return 'final-recapture-changed';
    }
    execFileSync('tmux', ['send-keys', '-t', seatSession, 'Enter'], { timeout: 3000 });
    writePushSnapshot(slug, null);
    // The due-file is deliberately LEFT: the Enter-turn's Stop consumes it via layer-1 —
    // the pulse rides the safe rail; his draft and the pulse text never share a channel.
    const crypto = require('node:crypto') as typeof import('node:crypto');
    counter({ kind: 'session-pulse-push', slug, surface: 'session', session: seatSession,
        submittedBy: 'hearth-pulse', mode: 'entered-his-draft',
        draftLen: box.length, draftSha256_12: crypto.createHash('sha256').update(box).digest('hex').slice(0, 12) });
    console.log(`[session-hearth] ${slug}: layer-2 pressed Enter on an unchanged 5-min draft (${seatSession}, ${box.length}c) — the turn's Stop pulls the pulse`);
    return 'entered-his-draft';
}

/**
 * Start the session-surface hearth checker for this agent. Idempotent; no-op unless the
 * garden enables the pulse for (slug, 'session'). One writer per slug BY DEPLOYMENT (the
 * per-agent server is the P0 driver process); the state is on disk so even a rogue second
 * writer converges rather than split-brains.
 */
const started = new Set<string>();
export function startSessionHearth(slug: string): void {
    if (started.has(slug)) return;
    started.add(slug);
    if (!hearthPulseEnabledFor(slug, 'session')) {
        console.log(`[session-hearth] ${slug}: pulse not enabled for the session surface — checker not started`);
        return;
    }
    const intervalMin = hearthPulseMinutesFor(slug, 'session');
    // (History, kept per DEC-108: a boot-time state seed briefly lived here on 2026-08-20 —
    // the cure for the anchor-deadlock, since cli-busy dies at every Stop and the state file
    // was only written on-due, so no first pulse could ever fire. Superseded the same morning
    // by Darron's occupancy ruling below: the deadlock dissolves structurally once the timer
    // exists only for an OCCUPIED seat, whose own turns supply the anchor.)
    console.log(`[session-hearth] ${slug}: checker started (pulse=${intervalMin}m, occupancy-gated; layer-1 pull only; layer-2 observe-only)`);
    const tick = (): void => {
        try {
            const now = Date.now();
            // ── Occupancy gate (Darron's ruling 2026-08-20 ~10:26 AM; DEC-108 WHY): "a never-
            // woken seat doesn't need to be kept warm... the re-caching fee will be paid at the
            // cast anyhow — the timer only comes into existence when the stem is checked out,
            // maturing to a spoke." A FREE stem gets no timer, no dues, no rows (pulsing it
            // buys nothing the checkout fee doesn't pay, and under future layer-2 push it would
            // violate the inertness principle — a free stem must never produce). The timer is
            // born at checkout for free: the sleeve is written before the attach-flush, so the
            // flush-turn's Stop writes cli-free and the anchor exists from the first minute.
            // A classic COLD seat (empty-pool fallback) is occupied too — tmux is its evidence.
            const seat = readPool(slug, 'session').stems.find(s => s.state === 'leased' || s.state === 'spoke');
            if (!seat) {
                try { execFileSync('tmux', ['has-session', '-t', `session-${slug}`], { stdio: 'ignore' }); }
                catch { return; } // no leased stem, no cold seat → no timer exists
            }
            const seatSession = seat?.tmux_session ?? `session-${slug}`;
            // ── LAYER 2: an unconsumed due-file ≥60s old means the seat is idle (a live turn's
            // Stop would have pulled it) — run one push attempt. 60s gives a just-finishing
            // turn its boundary first; the pull rail always has first claim.
            const dueMtime = mtimeMs(dueFilePath(slug));
            if (dueMtime !== null && now - dueMtime >= 60_000) {
                const verdict = attemptPush(slug, seatSession, now);
                if (verdict !== 'draft-waiting') { // waiting is the quiet steady state, not a row per tick
                    counter({ kind: 'session-pulse-push-attempt', slug, surface: 'session', session: seatSession, verdict });
                }
            }
            // ENTER-anchored (Darron's ruling 2026-08-25, superseding his 2026-08-20 completion
            // anchor — MNT-180's cure): cli-enter-<slug> is a LEVEL stamp written by cli-active
            // at every UserPromptSubmit and consumed by NOTHING, so it cannot be eaten the way
            // cli-free-leo is (the legacy heartbeat watcher unlinks cli-free as a one-shot edge
            // — two readers, one file, opposite semantics; leo ticked a flat 50 from lastPulse
            // while every other agent reset on interaction). WHY Enter, not completion (his
            // ruling, recorded): the 60-min cache knee runs from the turn's FIRST cache read —
            // anchored on Enter the pulse lands within TTL by construction; anchored on
            // completion, a 10-minute turn puts the next pulse at the knee's edge. busy stays
            // as the mid-turn belt; cli-free is the TRANSITION fallback only (a seat whose
            // hook predates the stamp), else completion would out-vote Enter and re-instate
            // the old anchor by the back door.
            const busy = mtimeMs(busySignalPath(slug));
            const enter = mtimeMs(path.join(HAN, 'signals', `cli-enter-${slug}`));
            const free = mtimeMs(path.join(HAN, 'signals', `cli-free-${slug}`));
            const lastPulse = readLastPulseMs(slug);
            const anchor = enter !== null
                ? Math.max(enter, busy ?? 0, lastPulse)
                : Math.max(busy ?? 0, free ?? 0, lastPulse); // legacy shape until the stamp exists
            if (anchor === 0) {
                // Occupied but no signal yet (freshly checked out, first flush still landing):
                // seed the stamp so the first due fires one interval from NOW — the timer's birth.
                try { fs.writeFileSync(statePath(slug), JSON.stringify({ lastPulseMs: now }, null, 2)); } catch { /* next tick retries */ }
                return;
            }
            if (now - anchor < intervalMin * 60_000) return;
            // ── Senescence PAUSE (Darron's ruling 2026-08-19 ~11:26 PM; DEC-108 WHY) ──────────
            // An interactive seat past the knee — fits(): ctx + p99-reserve ≤ ceiling (98) —
            // gets NO pulse: within one worst-case operation of the cliff, the organelle stops
            // adding machine-driven turns. B2b forbids auto-retiring the human's seat, so of
            // Darron's "auto-retire or pause" the session arm is PAUSE (the pooled-spoke retire
            // arm is the MNT-166 turn-complete actor). The ctx source is the statusline SIDECAR
            // (getContextPctForSession), NOT boundaryCheck's spoke-stats — an attached seat's
            // typed turns never traverse the dispatcher, so spoke-stats are blind exactly here.
            // Null ctx → pulse normally: the pause protects a MEASURED cliff; an unmeasured
            // seat keeps today's behaviour rather than silently losing its organelle. The stamp
            // refreshes on pause so the row paces at the pulse interval, never per-tick.
            if (seat) { // the occupancy gate's find, reused
                const ctx = getContextPctForSession(slug, 'session', seat.tmux_session);
                if (ctx !== null) {
                    const r = computeReserve(slug, 'session', seat.tmux_session);
                    const ceiling = senescenceCeilingPctFor(slug, 'session');
                    if (!fits(ctx, r.reservePct, ceiling)) {
                        fs.writeFileSync(statePath(slug), JSON.stringify({ lastPulseMs: now }, null, 2));
                        counter({ kind: 'session-pulse-paused-senescent', slug, surface: 'session',
                            session: seat.tmux_session, ctxPct: ctx, reservePct: r.reservePct, ceilingPct: ceiling });
                        console.log(`[session-hearth] ${slug}: pulse PAUSED — seat ${seat.stem_id} at ctx ${ctx}% + reserve ${r.reservePct}% > ceiling ${ceiling}% (senescent; retirement is the human's hand)`);
                        return;
                    }
                }
            }
            // Due. Write the due-file (message materialised NOW — §2.8), refresh the stamp.
            // One pending pulse, never a queue: an unconsumed due-file is overwritten.
            const due = {
                ts: new Date().toISOString(),
                slug, surface: 'session',
                message: hearthStandingMessageFor(slug, 'session'),
            };
            fs.mkdirSync(HEALTH, { recursive: true });
            fs.writeFileSync(dueFilePath(slug), JSON.stringify(due, null, 2));
            fs.writeFileSync(statePath(slug), JSON.stringify({ lastPulseMs: now }, null, 2));
            const clientAge = newestClientActivityAgeSec(slug);
            counter({ kind: 'session-pulse-due', slug, surface: 'session' });
            // The old layer-2 EXPERIMENT row, kept as telemetry beside the now-live push
            // (history: client_activity was the candidate gate until Darron's 2026-08-20
            // ruling made the input box itself the gate — this row let the two be compared).
            counter({
                kind: 'session-pulse-would-push', slug, surface: 'session',
                clientActivityAgeSec: clientAge,
                verdict: clientAge === null ? 'no-client' : (clientAge >= 300 ? 'would-push' : 'would-defer'),
                note: 'comparison telemetry — the LIVE push gates on the input box, not this field',
            });
        } catch (err) {
            console.warn(`[session-hearth] ${slug}: tick failed: ${(err as Error).message}`);
        }
    };
    const t = setInterval(tick, 60_000);
    (t as NodeJS.Timeout).unref?.();
}
