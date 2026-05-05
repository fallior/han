/**
 * src/server/lib/sensor-lock.ts
 *
 * Phase 4c of the 2026-04-29 cutover (DEC-079). Per-agent file lock used by
 * the WM Sensor (`services/wm-sensor.ts`) and the backup queue-drain in
 * `leo-heartbeat.ts` and `services/supervisor-worker.ts`.
 *
 * Whichever caller holds the lock owns rotation/drain for that agent. The
 * other caller skips silently — the existing concurrency guards (the
 * inline 10-min stale-claim recovery in `scripts/process-pending-compression.ts`
 * and `scripts/agent-bump-step.ts`) handle "lock holder died mid-process"
 * without any explicit liveness signalling at this layer.
 *
 * Design note: file-based lock is cooperative, not OS-enforced. Two
 * processes on the same machine race on `fs.openSync(..., 'wx')` which is
 * atomic at the filesystem level. Stale-detection recovers from crashed
 * holders.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SIGNALS_DIR = path.join(os.homedir(), '.han', 'signals');
const STALE_LOCK_AGE_MS = 5 * 60 * 1000; // 5 minutes

function lockPathFor(agent: string): string {
    return path.join(SIGNALS_DIR, `wm-sensor-${agent}-active`);
}

/**
 * Try to acquire the per-agent rotation/drain lock. Returns true if acquired
 * (caller now owns the work for this agent until it calls release), false if
 * another process already holds it.
 *
 * Stale-lock recovery: if the lock file is older than STALE_LOCK_AGE_MS, the
 * holder is presumed dead and the lock is force-released.
 */
export function acquireWmSensorLock(agent: string): boolean {
    fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    const lockPath = lockPathFor(agent);
    try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeSync(fd, `pid=${process.pid} ts=${new Date().toISOString()}`);
        fs.closeSync(fd);
        return true;
    } catch {
        try {
            const stat = fs.statSync(lockPath);
            const ageMs = Date.now() - stat.mtimeMs;
            if (ageMs > STALE_LOCK_AGE_MS) {
                fs.unlinkSync(lockPath);
                return acquireWmSensorLock(agent);
            }
        } catch { /* lock vanished mid-stat */ }
        return false;
    }
}

/**
 * Release the per-agent lock. Idempotent — safe to call even if the lock
 * isn't held (no-op if the file doesn't exist).
 */
export function releaseWmSensorLock(agent: string): void {
    try { fs.unlinkSync(lockPathFor(agent)); } catch { /* already gone */ }
}

/**
 * Peek without modifying — returns true if the lock is currently held by
 * any (alive, non-stale) process.
 */
export function isWmSensorLocked(agent: string): boolean {
    const lockPath = lockPathFor(agent);
    if (!fs.existsSync(lockPath)) return false;
    try {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        return ageMs <= STALE_LOCK_AGE_MS;
    } catch {
        return false;
    }
}
