/**
 * PID Guard — Single Instance Protection for HAN Services
 *
 * Prevents orphan/zombie processes by writing a PID file on startup and
 * handling duplicates. Two modes:
 *
 * - `ensureSingleInstance()` — refuses to start if another instance is running.
 *   Used by systemd-managed services (jim-human, leo-human, etc.) where systemd
 *   handles restart logic.
 *
 * - `replaceExistingInstance()` — sends SIGTERM to the existing instance, waits
 *   up to 30s for graceful shutdown, then SIGKILL if needed. Used by the server
 *   and manually-started services where the new instance should replace the old.
 *
 * PID files live in ~/.han/health/ alongside each service's health file.
 *
 * Usage:
 *   const guard = ensureSingleInstance('jemma');
 *   // OR
 *   const guard = replaceExistingInstance('han-server');
 *   // ... service runs ...
 *   process.on('SIGTERM', () => { guard.cleanup(); process.exit(143); });
 *   process.on('exit', () => guard.cleanup());
 */

import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME || '/home/darron';
const HEALTH_DIR = path.join(HOME, '.han', 'health');

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export interface PidGuard {
    cleanup: () => void;
    pidFile: string;
}

function ensureHealthDir(): void {
    if (!fs.existsSync(HEALTH_DIR)) {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
    }
}

function writePidFile(pidFile: string): PidGuard {
    fs.writeFileSync(pidFile, String(process.pid));

    const cleanup = () => {
        try {
            const currentPid = fs.readFileSync(pidFile, 'utf8').trim();
            if (currentPid === String(process.pid)) {
                fs.unlinkSync(pidFile);
            }
        } catch {
            // Best effort — file may already be gone
        }
    };

    return { cleanup, pidFile };
}

/**
 * Refuse to start if another instance is running.
 * Used by systemd-managed services where systemd handles restarts.
 */
export function ensureSingleInstance(serviceName: string): PidGuard {
    const pidFile = path.join(HEALTH_DIR, `${serviceName}.pid`);
    ensureHealthDir();

    if (fs.existsSync(pidFile)) {
        const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (oldPid && oldPid !== process.pid && isProcessAlive(oldPid)) {
            console.error(
                `[${serviceName}] Another instance is already running (PID ${oldPid}). ` +
                `Refusing to start a duplicate. Use 'systemctl --user restart ${serviceName}' ` +
                `to restart the service, or 'kill ${oldPid}' to stop the other instance first.`
            );
            process.exit(1);
        }
    }

    return writePidFile(pidFile);
}

/**
 * Replace an existing instance: SIGTERM → wait → SIGKILL if needed.
 * Used by the server and manually-started services.
 *
 * @param serviceName - Name for PID file and logging
 * @param gracefulTimeoutMs - How long to wait for graceful shutdown (default 30s)
 */
export function replaceExistingInstance(
    serviceName: string,
    gracefulTimeoutMs: number = 30000,
): PidGuard {
    const pidFile = path.join(HEALTH_DIR, `${serviceName}.pid`);
    ensureHealthDir();

    if (fs.existsSync(pidFile)) {
        const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (oldPid && oldPid !== process.pid && isProcessAlive(oldPid)) {
            console.log(`[${serviceName}] Previous instance running (PID ${oldPid}) — sending SIGTERM`);
            process.kill(oldPid, 'SIGTERM');

            // Wait for graceful shutdown, polling every 500ms
            const start = Date.now();
            let alive = true;
            while (alive && Date.now() - start < gracefulTimeoutMs) {
                try {
                    process.kill(oldPid, 0);
                    const waitStart = Date.now();
                    while (Date.now() - waitStart < 500) { /* spin */ }
                } catch {
                    alive = false;
                }
            }

            if (alive) {
                console.log(`[${serviceName}] PID ${oldPid} didn't exit after ${gracefulTimeoutMs / 1000}s — SIGKILL`);
                try { process.kill(oldPid, 'SIGKILL'); } catch { /* already dead */ }
                const killStart = Date.now();
                while (Date.now() - killStart < 2000) { /* spin */ }
            } else {
                console.log(`[${serviceName}] Previous instance (PID ${oldPid}) shut down gracefully`);
            }
        }
    }

    return writePidFile(pidFile);
}
