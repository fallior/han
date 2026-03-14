/**
 * PID Guard — Single Instance Protection for HAN Services
 *
 * Prevents orphan processes by writing a PID file on startup and checking
 * for duplicates. If another instance is already running, the new instance
 * exits with a clear error instead of silently doubling up.
 *
 * The pattern this fixes: a Claude Code session runs `nohup npx tsx <service>.ts`
 * to test something, the session ends, and the nohup process outlives it —
 * running alongside the systemd-managed instance indefinitely.
 *
 * PID files live in ~/.han/health/ alongside each service's health file.
 *
 * Usage:
 *   const guard = ensureSingleInstance('jemma');
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

export function ensureSingleInstance(serviceName: string): PidGuard {
    const pidFile = path.join(HEALTH_DIR, `${serviceName}.pid`);

    // Ensure health directory exists
    if (!fs.existsSync(HEALTH_DIR)) {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
    }

    // Check for existing instance
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
        // Stale PID file — previous instance died without cleaning up
    }

    // Write our PID
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
