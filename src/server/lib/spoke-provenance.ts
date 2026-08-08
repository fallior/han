// spoke-provenance.ts — readable provenance for the DISPATCHED spokes (S218, provenance build B).
//
// The interactive seat gets a readable capture-pane log because each agent-server polls its
// `getActiveSession()` pane (services/terminal.ts). The dispatched spokes — human-response,
// heartbeat, compression, meditation, supervisor-cycle — are DIFFERENT tmux sessions that no
// server ever polls, so today their only record is the raw `.typescript` (unreadable — the
// alt-screen paint the offline renderer can't reconstruct). This module extends the *proven*
// readable pipeline (the anchor-diff of terminal-anchor-diff.ts, the same one the interactive
// seat uses — no twin) to the spoke sessions, written per-(agent, surface) so sovereignty holds
// by construction (S103).
//
// CADENCE — lifecycle-driven, NOT a timer (Jim's rider 2). Capture is called from the dispatcher
// lifecycle in the controller process that OWNS the spoke: after each transaction's response, and
// BEFORE `clearSession` wipes the pane scrollback (the 85% ctx self-clear — Jim's rider 1). It does
// not ride the servers' 1-second UI broadcast loop (that loop is for the live UI and carries the
// DEC-013 WS-flood scar), and it can never double-capture against a server because the servers only
// ever poll the interactive `HAN_SESSION` seat — a spoke session is never returned by
// `getActiveSession()`. Sizing: the spoke's tmux `history-limit` must exceed the largest single
// burst (a fed-wake gradient step is ~350 KB) so a full transaction's scrollback is still present
// at capture time; `-S -` then reads the whole history.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gardenTimezone } from './garden-manifest';
import { hanHome } from './paths';
import { renderAppend, type AnchorState } from './terminal-anchor-diff';

// Per-(agent, surface) anchor state — keyed by the resolved log path, so each spoke surface
// keeps its own scroll anchor and 5-minute-timestamp cursor within this process.
const perSurfaceState = new Map<string, AnchorState>();

/** The per-(agent, surface) readable provenance log. Sits in $HAN_HOME (git-ignored `logs/`? no —
 *  it mirrors terminal-log-v2-<slug>.txt which lives at the $HAN_HOME root, per the existing
 *  convention; rotation/retention is P4). */
export function spokeProvenanceLogPath(slug: string, surface: string): string {
    return path.join(hanHome(), `terminal-log-v2-${slug}-${surface}.txt`);
}

/** Full-scrollback plain-text capture of a spoke pane. `-S -` = entire history; `-p` = plain text
 *  (tmux has already done the terminal emulation, which is the whole point — no offline replay). */
function captureFullScrollback(tmuxTarget: string): string | null {
    try {
        return execFileSync('tmux',
            ['capture-pane', '-t', tmuxTarget, '-p', '-S', '-'],
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch {
        return null; // pane gone / tmux absent — best-effort, the caller carries on
    }
}

export interface CaptureOpts {
    /** lifecycle reason, recorded inline as declared-cadence metadata (rider 3): 'txn' | 'pre-clear' | 'reap' | 'belt' */
    reason?: string;
    /** injectable clock for tests; defaults to Date.now() at call time */
    now?: number;
}

/**
 * Capture a spoke pane's current scrollback and anchor-diff-append the NEW content to the
 * per-(agent, surface) readable log. Best-effort: never throws, returns whether anything was
 * captured. Call it from the dispatcher lifecycle (post-transaction, pre-clear, reap).
 */
export function captureSpokeProvenance(
    slug: string,
    surface: string,
    tmuxTarget: string,
    opts: CaptureOpts = {},
): boolean {
    try {
        const content = captureFullScrollback(tmuxTarget);
        if (content === null) return false;
        const logPath = spokeProvenanceLogPath(slug, surface);
        const now = opts.now ?? Date.now();
        const st = perSurfaceState.get(logPath) ?? { prev: [], lastTs: 0 };
        const r = renderAppend(st, content, now, gardenTimezone()); // DEC-105 G4
        perSurfaceState.set(logPath, r.state); // advance state even when output is empty
        if (r.output) {
            // Declared-cadence metadata: mark the lifecycle boundary so the #79 c0-dissection
            // and the .typescript belt know where a sampling window fell (honesty-as-metadata).
            const marked = opts.reason ? `[capture:${opts.reason}]${r.output}` : r.output;
            fs.appendFileSync(logPath, marked);
        }
        return true;
    } catch {
        return false; // best-effort
    }
}

/** Test-only: clear the per-surface state (so a proof harness starts from a clean anchor). */
export function __resetSpokeState(): void { perSurfaceState.clear(); }
