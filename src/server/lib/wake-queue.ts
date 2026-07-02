/**
 * wake-queue.ts — the durable per-dispatch wake queue (PR-C1, MNT-009 completion plan).
 *
 * Replaces the single-flag `<agent>-human-wake` FILE (plain-overwrite → a second wake arriving
 * while the controller is busy was OVERWRITTEN or dropped by the `processing` guard — the S212
 * live-prove finding) with a queue DIRECTORY: `<signals>/<agent>-human-wake.d/<dispatchId>.json`,
 * one file per dispatch. No overwrite-drop by construction; unclaimed files survive a controller
 * restart (durable). This RESTORES the orchestrator's original intent — jemma-orchestrator's
 * per-conversation locks were always designed for concurrent different-thread dispatches
 * (DEC-079); the flat file was where that intent died.
 *
 * Write is temp+rename (Jim's F1 build-note): a claim can never read a half-written JSON, which
 * also retires the controller's 500ms settle-delay for the queue path. Claim = read+unlink —
 * atomic consume; the same mechanism subsumes the old `processing` guard's original job (inotify
 * double-event dedupe: the second event finds no file).
 *
 * One write site (DEC-080): jemma-dispatch calls `writeWakeQueueFile`; the controller calls
 * `claimWakeFiles` + `pickNextEligible`. Agent-agnostic (DEC-081): everything keyed by the
 * signal name the caller passes.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The queue directory for a wake signal (e.g. `leo-human-wake` → `<signals>/leo-human-wake.d`). */
export function wakeQueueDir(signalsDir: string, signalName: string): string {
    return path.join(signalsDir, `${signalName}.d`);
}

/**
 * Enqueue one wake as its own file (temp+rename — atomic appearance; a watcher/claimer never
 * sees a partial write). Filename = `<ms>-<dispatchId|rand>.json` so lexical order ≈ arrival order.
 */
export function writeWakeQueueFile(signalsDir: string, signalName: string, data: Record<string, unknown>): string {
    const dir = wakeQueueDir(signalsDir, signalName);
    fs.mkdirSync(dir, { recursive: true });
    const id = typeof data.dispatchId === 'string' && data.dispatchId
        ? String(data.dispatchId).replace(/[^A-Za-z0-9_-]/g, '')
        : Math.random().toString(36).slice(2, 10);
    const name = `${Date.now()}-${id}.json`;
    const target = path.join(dir, name);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, target);
    return target;
}

/**
 * Claim every queued wake: read + unlink each (atomic consume — a crashed claim leaves the file
 * for the next sweep; a consumed-but-crashed dispatch is the orchestrator watchdog's job).
 * Returns wakes in arrival (filename-lexical) order. Malformed files are removed and skipped
 * (fail-loud in the log, never wedge the queue). Missing dir ⇒ [].
 */
export function claimWakeFiles<T = Record<string, unknown>>(signalsDir: string, signalName: string): T[] {
    const dir = wakeQueueDir(signalsDir, signalName);
    let names: string[];
    try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort(); }
    catch { return []; }
    const claimed: T[] = [];
    for (const n of names) {
        const p = path.join(dir, n);
        try {
            const raw = fs.readFileSync(p, 'utf-8');
            fs.unlinkSync(p); // claim
            claimed.push(JSON.parse(raw) as T);
        } catch (err) {
            // Unreadable/malformed → remove so it can't wedge the queue; log-loud.
            try { fs.unlinkSync(p); } catch { /* already gone */ }
            console.error(`[wake-queue] ${signalName}: dropped malformed queue file ${n} — ${(err as Error).message}`);
        }
    }
    return claimed;
}

/**
 * Pick the next dispatchable wake: the FIRST queued item whose conversation is not in flight
 * (per-conversation exclusivity — matches the orchestrator's per-conversation lock intent).
 * Same-conversation wakes stay queued in order behind their in-flight sibling (defer, not drop —
 * and the deferred turn self-corrects anyway: the spoke reads the live thread and stands down if
 * already answered). Items without a conversationId are always eligible. Returns the index, -1 if
 * none eligible.
 */
export function pickNextEligible(
    queue: ReadonlyArray<{ conversationId?: string }>,
    inFlightConversations: ReadonlySet<string>,
): number {
    for (let i = 0; i < queue.length; i++) {
        const conv = queue[i].conversationId;
        if (!conv || !inFlightConversations.has(conv)) return i;
    }
    return -1;
}
