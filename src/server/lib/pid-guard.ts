/**
 * PID Guard — Single Instance Protection for HAN Services
 *
 * Prevents orphan/zombie processes by writing a PID file on startup and
 * handling duplicates. Two modes:
 *
 * - `ensureSingleInstance()` — refuses to start if another instance is running.
 *   Used by systemd-managed services (jemma, the human responders, heartbeats)
 *   where systemd handles restart logic.
 *
 * - `replaceExistingInstance()` — sends SIGTERM to the existing instance, waits
 *   up to 30s for graceful shutdown, then SIGKILL if needed. Used by the server
 *   and manually-started services where the new instance should replace the old.
 *
 * PID files live in ~/.han/health/ alongside each service's health file.
 *
 * ── MNT-089 HARDENING (2026-08-06, three receipts in one week) ─────────────
 * The old liveness check was `process.kill(pid, 0)` — which SUCCEEDS for:
 *   (a) THREAD ids: after a service dies uncleanly (the KillMode=process orphan
 *       class), the kernel can recycle its pid as a *thread* of another process
 *       (observed twice: libuv workers of wm-sensor wearing 1442/1445). kill()
 *       signals thread-group members, so the stale lock became IMMORTAL — jemma
 *       and both human responders crash-looped for 16h+ behind exactly this.
 *   (b) RECYCLED pids: any unrelated process that inherited the number. For
 *       `ensureSingleInstance` that is a permanent false "already running"; for
 *       `replaceExistingInstance` it is worse — we would SIGTERM AN INNOCENT
 *       PROCESS (including, plausibly, the *other agent's* server, since both
 *       agent servers share the `tsx server.ts` cmdline).
 *
 * The cure: a pidfile claim is believed ONLY when the pid is a real PROCESS
 * (`/proc/<pid>/status` Tgid == Pid — a thread id fails this), whose cmdline
 * contains the service's `cmdlineToken`, and whose environment matches any
 * `envMatch` discriminators (e.g. AGENT_SLUG for the shared responder binary).
 * Anything else is a STALE CLAIM: logged with its reason and disregarded —
 * never obeyed, never killed.
 *
 * Fail directions (deliberate): if /proc is unreadable for the pid, the claim
 * is treated as stale — ensure() proceeds (all garden services share one uid,
 * so a genuinely-live duplicate is always readable), and replace() declines to
 * kill (never send SIGTERM to a process we could not positively identify).
 *
 * Usage:
 *   const guard = ensureSingleInstance('jemma', { cmdlineToken: 'jemma.ts' });
 *   // OR
 *   const guard = replaceExistingInstance('han-server-3847',
 *       { cmdlineToken: 'server.ts', envMatch: { AGENT_SLUG: 'leo' } });
 *   // ... service runs ...
 *   process.on('SIGTERM', () => { guard.cleanup(); process.exit(143); });
 *   process.on('exit', () => guard.cleanup());
 */

import fs from 'node:fs';
import path from 'node:path';
import { healthDir } from './paths';

export interface PidGuardOpts {
    /** Substring that must appear in /proc/<pid>/cmdline for the claim to be
     *  believed (the service's script filename, e.g. 'human-responder.ts').
     *  Defaults to the serviceName — pass the token explicitly whenever the
     *  unit name and the script name differ (they usually do). */
    cmdlineToken?: string;
    /** Env vars that must ALL match in /proc/<pid>/environ — the discriminator
     *  for services sharing one binary (AGENT_SLUG for responders/servers). */
    envMatch?: Record<string, string>;
}

export type PidClaimVerdict =
    | { kind: 'absent' }                                  // no such process
    | { kind: 'not-a-process'; detail: string }           // a THREAD id (Tgid != Pid) — the MNT-089 immortal lock
    | { kind: 'different-program'; detail: string }       // cmdline lacks the token — recycled pid
    | { kind: 'env-mismatch'; detail: string }            // right binary, wrong instance (e.g. other slug)
    | { kind: 'unreadable'; detail: string }              // /proc denied — treat as stale, never kill
    | { kind: 'ours' };                                   // a genuine live instance of THIS service

/** Classify a pidfile's claim about `pid`. Pure read of /proc; no side effects.
 *  Exported for the suite — the guards act only on this verdict. */
export function classifyPidClaim(pid: number, serviceName: string, opts: PidGuardOpts = {}): PidClaimVerdict {
    const token = opts.cmdlineToken ?? serviceName;
    let status: string;
    try { status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8'); }
    catch { return { kind: 'absent' }; }

    const pidLine = /^Pid:\s*(\d+)/m.exec(status)?.[1];
    const tgidLine = /^Tgid:\s*(\d+)/m.exec(status)?.[1];
    if (!pidLine || !tgidLine) return { kind: 'unreadable', detail: 'status unparsable' };
    if (pidLine !== tgidLine) {
        return { kind: 'not-a-process', detail: `pid ${pid} is a THREAD of tgid ${tgidLine} (the MNT-089 recycled-tid class)` };
    }

    let cmdline: string;
    try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').join(' '); }
    catch { return { kind: 'unreadable', detail: 'cmdline unreadable' }; }
    if (!cmdline.includes(token)) {
        return { kind: 'different-program', detail: `cmdline "${cmdline.slice(0, 80)}" lacks token "${token}"` };
    }

    if (opts.envMatch && Object.keys(opts.envMatch).length > 0) {
        let environ: string;
        try { environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf-8'); }
        catch { return { kind: 'unreadable', detail: 'environ unreadable' }; }
        const entries = new Set(environ.split('\0'));
        for (const [k, v] of Object.entries(opts.envMatch)) {
            if (!entries.has(`${k}=${v}`)) {
                return { kind: 'env-mismatch', detail: `${k}!=${v} (same binary, different instance)` };
            }
        }
    }
    return { kind: 'ours' };
}

export interface PidGuard {
    cleanup: () => void;
    pidFile: string;
}

function ensureHealthDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

function readClaimedPid(pidFile: string): number | null {
    try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch { return null; }
}

/**
 * Refuse to start if another GENUINE instance of this service is running.
 * A stale claim (dead pid / thread id / recycled pid / other instance) is
 * logged with its reason and overwritten — never obeyed (MNT-089).
 */
export function ensureSingleInstance(serviceName: string, opts: PidGuardOpts = {}): PidGuard {
    const dir = healthDir();
    const pidFile = path.join(dir, `${serviceName}.pid`);
    ensureHealthDir(dir);

    const oldPid = readClaimedPid(pidFile);
    if (oldPid !== null && oldPid !== process.pid) {
        const verdict = classifyPidClaim(oldPid, serviceName, opts);
        if (verdict.kind === 'ours') {
            console.error(
                `[${serviceName}] Another instance is already running (PID ${oldPid}, verified same-service). ` +
                `Refusing to start a duplicate. Use 'systemctl --user restart ${serviceName}' ` +
                `to restart the service, or 'kill ${oldPid}' to stop the other instance first.`
            );
            process.exit(1);
        }
        console.log(`[${serviceName}] Disregarding STALE pidfile claim (pid ${oldPid}: ${verdict.kind}` +
            `${'detail' in verdict ? ` — ${verdict.detail}` : ''}) — starting.`);
    }

    return writePidFile(pidFile);
}

/**
 * Replace an existing GENUINE instance: SIGTERM → wait → SIGKILL if needed.
 * A stale claim is logged and overwritten — and critically, NEVER killed:
 * a recycled pid is somebody else's process (MNT-089's replace-path hazard).
 *
 * @param serviceName - Name for PID file and logging
 * @param opts - cmdline token + env discriminators (see PidGuardOpts)
 * @param gracefulTimeoutMs - How long to wait for graceful shutdown (default 30s)
 */
export function replaceExistingInstance(
    serviceName: string,
    opts: PidGuardOpts = {},
    gracefulTimeoutMs: number = 30000,
): PidGuard {
    const dir = healthDir();
    const pidFile = path.join(dir, `${serviceName}.pid`);
    ensureHealthDir(dir);

    const oldPid = readClaimedPid(pidFile);
    if (oldPid !== null && oldPid !== process.pid) {
        const verdict = classifyPidClaim(oldPid, serviceName, opts);
        if (verdict.kind === 'ours') {
            console.log(`[${serviceName}] Previous instance running (PID ${oldPid}, verified same-service) — sending SIGTERM`);
            try { process.kill(oldPid, 'SIGTERM'); } catch { /* raced to exit */ }

            // Wait for graceful shutdown, polling every 500ms
            const start = Date.now();
            let alive = true;
            while (alive && Date.now() - start < gracefulTimeoutMs) {
                if (classifyPidClaim(oldPid, serviceName, opts).kind !== 'ours') { alive = false; break; }
                const waitStart = Date.now();
                while (Date.now() - waitStart < 500) { /* spin */ }
            }

            if (alive && classifyPidClaim(oldPid, serviceName, opts).kind === 'ours') {
                // Tenshi's belt (fold-at-land, 2026-08-06): the deadliest signal fires only on
                // a verdict taken in the same breath — never on evidence up to a poll stale.
                // Casey: "a warrant executes on the conditions at execution, not at issue."
                console.log(`[${serviceName}] PID ${oldPid} didn't exit after ${gracefulTimeoutMs / 1000}s — SIGKILL (fresh verdict: ours)`);
                try { process.kill(oldPid, 'SIGKILL'); } catch { /* already dead */ }
                const killStart = Date.now();
                while (Date.now() - killStart < 2000) { /* spin */ }
            } else if (alive) {
                // Tenshi's log-word note (2026-08-06): the fresh verdict flipped at the last
                // instant — the pid answers but is no longer verifiably ours. Not "graceful";
                // exited-or-recycled. No signal was sent (the belt held).
                console.log(`[${serviceName}] Previous instance (PID ${oldPid}) exited-or-recycled at the final verdict — no signal sent`);
            } else {
                console.log(`[${serviceName}] Previous instance (PID ${oldPid}) shut down gracefully`);
            }
        } else {
            console.log(`[${serviceName}] Disregarding STALE pidfile claim (pid ${oldPid}: ${verdict.kind}` +
                `${'detail' in verdict ? ` — ${verdict.detail}` : ''}) — NOT killing; starting.`);
        }
    }

    return writePidFile(pidFile);
}
