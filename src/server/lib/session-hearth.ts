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
 *  - LAYER 2 — quiet-hours push: NOT SHIPPED. `client_activity` is UNPROVEN as a
 *    keystroke-only signal (2026-08-19 test: the field advanced during an output stream
 *    with the human live at the keyboard — contaminated, inconclusive). This checker logs
 *    an OBSERVE-ONLY row (`session-pulse-would-push`) with the client-activity age each
 *    time a pulse goes due, so a week of rows becomes the clean experiment (the Build-B
 *    shape: observe first, flip on data). Until then the away-case honestly stalls: no
 *    turns → no boundaries → pulses wait for the human's return. Named, not hidden.
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
            // Completion-anchored (his 9:54 AM drift-catch): cli-free-<slug> mtime IS the
            // seat's last turn completion (written at every session Stop, surface-gated so a
            // spoke's turns can never reset it); busy covers mid-turn; the stamp paces due
            // re-writes between pulses on an idle occupied seat. Each agent's rhythm its own.
            const busy = mtimeMs(busySignalPath(slug));
            const free = mtimeMs(path.join(HAN, 'signals', `cli-free-${slug}`));
            const lastPulse = readLastPulseMs(slug);
            const anchor = Math.max(busy ?? 0, free ?? 0, lastPulse);
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
            // Layer-2 experiment row: what a gated push WOULD have decided, and on what data.
            counter({
                kind: 'session-pulse-would-push', slug, surface: 'session',
                clientActivityAgeSec: clientAge,
                verdict: clientAge === null ? 'no-client' : (clientAge >= 300 ? 'would-push' : 'would-defer'),
                note: 'observe-only — client_activity unproven as keystroke-only (2026-08-19 test contaminated)',
            });
        } catch (err) {
            console.warn(`[session-hearth] ${slug}: tick failed: ${(err as Error).message}`);
        }
    };
    const t = setInterval(tick, 60_000);
    (t as NodeJS.Timeout).unref?.();
}
