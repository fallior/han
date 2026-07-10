/**
 * spoke-drain.ts — the drain primitive (P3a of the update pipeline, S219).
 *
 * "The update never lands under a mid-thought mind" (the S181 lesson, mechanised —
 * P3 design step 2). Enumerates the dispatcher-owned tmux sessions (surface spokes
 * `<surface>-<slug>` + pool stems `stem-<slug>-…`) and waits until NONE shows processing
 * chrome for two consecutive polls. Bounded: on timeout it returns the still-busy list —
 * the CALLER aborts (drain-succeeds-or-update-aborts, SEC-04; there is no force).
 *
 * Read-only w.r.t. the spokes: it never nudges, never kills, never sends — it watches
 * chrome until the garden is genuinely still (R011: never touch a thinking mind).
 */
import { execSync } from 'child_process';
import { loadResidents } from './garden-manifest';
import { capturePaneTail, PROCESSING_CHROME_RE } from './tmux-dispatcher';

export interface DrainResult {
    ok: boolean;
    /** Sessions still processing at timeout (empty when ok). */
    busy: string[];
    /** Sessions watched this drain. */
    watched: string[];
    waitedMs: number;
}

/** The dispatcher-owned tmux sessions for this garden's residents (spokes + stems). */
export function dispatcherSessions(): string[] {
    let names: string[] = [];
    try {
        names = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null').toString().trim().split('\n').filter(Boolean);
    } catch { return []; } // no tmux server → nothing to drain
    const slugs = loadResidents().map((a) => a.slug);
    return names.filter((n) =>
        slugs.some((s) => n.endsWith(`-${s}`) || n.startsWith(`stem-${s}-`)));
}

export async function drainSpokes(timeoutMs: number, pollMs = 2000): Promise<DrainResult> {
    const start = Date.now();
    const watched = dispatcherSessions();
    let stillStreak = 0;
    for (;;) {
        const busy = watched.filter((s) => {
            try { return PROCESSING_CHROME_RE.test(capturePaneTail(s)); } catch { return false; } // vanished session = not busy
        });
        if (busy.length === 0) {
            stillStreak++;
            if (stillStreak >= 2) return { ok: true, busy: [], watched, waitedMs: Date.now() - start };
        } else {
            stillStreak = 0;
        }
        if (Date.now() - start > timeoutMs) {
            return { ok: false, busy, watched, waitedMs: Date.now() - start };
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }
}
