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
 * ── THE STARTTIME DISCRIMINATOR (Casey's doctrine; plan v2, built 2026-08-06) ──
 * "The law's oldest answer to recycled names is not better name-matching; it is
 * name + DATE OF BIRTH — attributes can coincide but an origin moment cannot."
 * The pidfile records `"<pid> <starttime> <bootid>"`:
 *   - starttime = /proc/<pid>/stat field 22, clock ticks since boot (proc(5):
 *     "(22) starttime %llu — The time the process started after system boot").
 *     Parsed AFTER the last ')' — comm may contain spaces/parens; certified
 *     against a hostile `prctl(PR_SET_NAME, ") 99 (evil")` comm by two hands.
 *   - bootid = /proc/sys/kernel/random/boot_id — starttime resets each boot and
 *     early-boot pids cluster in the same small tick range (pid 1 ≈ 21 ticks),
 *     so a prior-boot claim is DEMOTED to attribute-only, never compared.
 *
 * ── THE CLASSIFIER'S STANDING INVARIANT (Casey, plan v2 §2) ─────────────────
 * NO DISCRIMINATOR MAY BE AN ACCEPTOR. `ours` is reached only by SURVIVING
 * every gate — a new discriminator can only ever subtract from `ours`, never
 * add to it. (Identification works by exclusion: a matching feature excludes
 * the mismatching and proves nothing by itself; identity is the conjunction,
 * and the gravest act needs the whole conjunction.) The birthdate is therefore
 * a REJECTOR: a mismatch rejects; a match merely fails to reject.
 *
 * ── BASIS vs VERDICT (Casey, plan v2 §1) ────────────────────────────────────
 * The verdict answers WHAT was concluded; the basis answers ON WHAT EVIDENCE.
 * They are separate fields so a later reader can tell a finding from an
 * assumption — an `ours` reached on all discriminators and an `ours` reached
 * attribute-only must never be byte-identical on the face of the log,
 * especially in the sentence that precedes a kill.
 *
 * Fail directions (deliberate): if /proc is unreadable for the pid, the claim
 * is treated as stale — ensure() proceeds (all garden services share one uid,
 * so a genuinely-live duplicate is always readable), and replace() declines to
 * kill (never send SIGTERM to a process we could not positively identify).
 * The kill path stays killable on attribute-only basis — Casey traced the
 * alternative (require full basis to kill) to a double-drive reintroduction
 * during every rolling upgrade, and declined her own doctrine's extension.
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

export type PidClaimKind =
    | { kind: 'absent' }                                  // no such process
    | { kind: 'not-a-process'; detail: string }           // a THREAD id (Tgid != Pid) — the MNT-089 immortal lock
    | { kind: 'birthdate-mismatch'; detail: string }      // same-boot claim, wrong origin moment — a recycled pid (never obeyed, never killed)
    | { kind: 'different-program'; detail: string }       // cmdline lacks the token — recycled pid
    | { kind: 'env-mismatch'; detail: string }            // right binary, wrong instance (e.g. other slug)
    | { kind: 'unreadable'; detail: string }              // /proc denied — treat as stale, never kill
    | { kind: 'ours' };                                   // a genuine live instance of THIS service

/** Casey (plan v2 §1): the evidence the verdict rests on — carried on EVERY
 *  verdict, and logged on the `ours` path too, or the strongest claims become
 *  indistinguishable from the weakest exactly where it matters. */
export type ClaimBasis = 'full' | 'attribute-only';
export type BasisReason = 'legacy-format' | 'prior-boot';
export type PidClaimVerdict = PidClaimKind & { basis: ClaimBasis; basisReason?: BasisReason };

export interface PidClaim {
    pid: number;
    starttime?: string;
    bootid?: string;
}

/** The claimed birth record, when the pidfile carried one. */
export interface ExpectedBirth { starttime: string; bootid: string; }

let _bootId: string | null = null;
function currentBootId(): string {
    if (_bootId === null) {
        try { _bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim(); }
        catch { _bootId = ''; }
    }
    return _bootId;
}

/** /proc/<pid>/stat field 22 (starttime, clock ticks since boot — proc(5)).
 *  Parsed after the LAST ')': comm may contain spaces and parens (certified
 *  against prctl(PR_SET_NAME, ") 99 (evil")). state = token[0] (field 3), so
 *  starttime = token[19]. Returns null when unreadable (raced exit). */
export function liveStarttime(pid: number): string | null {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
        const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return after[19] ?? null;
    } catch { return null; }
}

/** Classify a pidfile's claim about `pid`. Pure read of /proc; no side effects.
 *  Exported for the suite — the guards act only on this verdict.
 *  INVARIANT (Casey): no gate here may ACCEPT — `ours` is only ever what
 *  survives every rejector. */
export function classifyPidClaim(
    pid: number,
    serviceName: string,
    opts: PidGuardOpts = {},
    expected?: ExpectedBirth,
): PidClaimVerdict {
    // The basis is decided by what evidence CAN be consulted for this claim.
    let basis: ClaimBasis = 'attribute-only';
    let basisReason: BasisReason | undefined = 'legacy-format';
    if (expected) {
        if (expected.bootid === currentBootId() && currentBootId() !== '') {
            basis = 'full'; basisReason = undefined;
        } else {
            // Prior-boot claim: not FALSE, merely UNVERIFIABLE — a finding about the
            // instrument, never the world (Casey: demote to next-best basis, never
            // refuse; Evidence Act s 48's shape — absence of best proof never bars proof).
            basis = 'attribute-only'; basisReason = 'prior-boot';
        }
    }
    const withBasis = (v: PidClaimKind): PidClaimVerdict => ({ ...v, basis, basisReason });

    const token = opts.cmdlineToken ?? serviceName;
    let status: string;
    try { status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8'); }
    catch { return withBasis({ kind: 'absent' }); }

    const pidLine = /^Pid:\s*(\d+)/m.exec(status)?.[1];
    const tgidLine = /^Tgid:\s*(\d+)/m.exec(status)?.[1];
    if (!pidLine || !tgidLine) return withBasis({ kind: 'unreadable', detail: 'status unparsable' });
    if (pidLine !== tgidLine) {
        return withBasis({ kind: 'not-a-process', detail: `pid ${pid} is a THREAD of tgid ${tgidLine} (the MNT-089 recycled-tid class)` });
    }

    // The birthdate gate — a REJECTOR, never an acceptor (Jim M1 / the invariant):
    // a mismatch rejects; a match proves nothing and the attribute chain still gates.
    if (basis === 'full' && expected) {
        const live = liveStarttime(pid);
        if (live === null) return withBasis({ kind: 'unreadable', detail: 'stat unreadable (raced exit?)' });
        if (live !== expected.starttime) {
            return withBasis({ kind: 'birthdate-mismatch', detail: `live starttime ${live} != claimed ${expected.starttime} (same boot) — a recycled pid cannot present the original's birth tick` });
        }
    }

    let cmdline: string;
    try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').join(' '); }
    catch { return withBasis({ kind: 'unreadable', detail: 'cmdline unreadable' }); }
    if (!cmdline.includes(token)) {
        return withBasis({ kind: 'different-program', detail: `cmdline "${cmdline.slice(0, 80)}" lacks token "${token}"` });
    }

    if (opts.envMatch && Object.keys(opts.envMatch).length > 0) {
        let environ: string;
        try { environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf-8'); }
        catch { return withBasis({ kind: 'unreadable', detail: 'environ unreadable' }); }
        const entries = new Set(environ.split('\0'));
        for (const [k, v] of Object.entries(opts.envMatch)) {
            if (!entries.has(`${k}=${v}`)) {
                return withBasis({ kind: 'env-mismatch', detail: `${k}!=${v} (same binary, different instance)` });
            }
        }
    }
    return withBasis({ kind: 'ours' });
}

/** Casey (plan v2 §1): the label carried into every ours-path log line — a
 *  "verified same-service" that was attribute-only must SAY so, especially in
 *  the sentence that precedes a kill. */
function basisLabel(v: PidClaimVerdict): string {
    return v.basis === 'full' ? 'full' : `attribute-only: ${v.basisReason ?? 'legacy-format'}`;
}

export interface PidGuard {
    cleanup: () => void;
    pidFile: string;
}

function ensureHealthDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writePidFile(pidFile: string): PidGuard {
    // The birth record: pid + starttime + bootid. If the own-starttime read ever
    // fails, fall back to the legacy bare form — a claim should degrade to the
    // weaker basis, never block a start.
    const st = liveStarttime(process.pid);
    const boot = currentBootId();
    const content = st && boot ? `${process.pid} ${st} ${boot}` : String(process.pid);
    fs.writeFileSync(pidFile, content);

    const cleanup = () => {
        try {
            // First-token comparison (plan T12): the birth record must never stop
            // cleanup from removing our own file.
            const first = fs.readFileSync(pidFile, 'utf8').trim().split(/\s+/)[0];
            if (first === String(process.pid)) {
                fs.unlinkSync(pidFile);
            }
        } catch {
            // Best effort — file may already be gone
        }
    };

    return { cleanup, pidFile };
}

/** Casey (plan v2 §3, the undefined-form clause): any pidfile that is not
 *  exactly one or three well-formed tokens is classified attribute-only —
 *  a read-side ambiguity must never license the grave act, and an unnamed
 *  form must be resolved by a decision, not by parser accident. */
function readClaim(pidFile: string): PidClaim | null {
    let raw: string;
    try { raw = fs.readFileSync(pidFile, 'utf8'); } catch { return null; }
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const pid = parseInt(tokens[0] ?? '', 10);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (tokens.length === 3 && /^\d+$/.test(tokens[1]) && tokens[2].length > 0) {
        return { pid, starttime: tokens[1], bootid: tokens[2] };
    }
    return { pid };   // legacy bare / torn / unnamed form → attribute-only path
}

function expectedOf(claim: PidClaim): ExpectedBirth | undefined {
    return claim.starttime && claim.bootid ? { starttime: claim.starttime, bootid: claim.bootid } : undefined;
}

/**
 * Refuse to start if another GENUINE instance of this service is running.
 * A stale claim (dead pid / thread id / recycled pid / wrong birthdate / other
 * instance) is logged with its reason and overwritten — never obeyed (MNT-089).
 */
export function ensureSingleInstance(serviceName: string, opts: PidGuardOpts = {}): PidGuard {
    const dir = healthDir();
    const pidFile = path.join(dir, `${serviceName}.pid`);
    ensureHealthDir(dir);

    const claim = readClaim(pidFile);
    if (claim !== null && claim.pid !== process.pid) {
        const verdict = classifyPidClaim(claim.pid, serviceName, opts, expectedOf(claim));
        if (verdict.kind === 'ours') {
            console.error(
                `[${serviceName}] Another instance is already running (PID ${claim.pid}, verified same-service (${basisLabel(verdict)})). ` +
                `Refusing to start a duplicate. Use 'systemctl --user restart ${serviceName}' ` +
                `to restart the service, or 'kill ${claim.pid}' to stop the other instance first.`
            );
            process.exit(1);
        }
        console.log(`[${serviceName}] Disregarding STALE pidfile claim (pid ${claim.pid}: ${verdict.kind}` +
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

    const claim = readClaim(pidFile);
    if (claim !== null && claim.pid !== process.pid) {
        const oldPid = claim.pid;
        const expected = expectedOf(claim);
        const verdict = classifyPidClaim(oldPid, serviceName, opts, expected);
        if (verdict.kind === 'ours') {
            console.log(`[${serviceName}] Previous instance running (PID ${oldPid}, verified same-service (${basisLabel(verdict)})) — sending SIGTERM`);
            try { process.kill(oldPid, 'SIGTERM'); } catch { /* raced to exit */ }

            // Wait for graceful shutdown, polling every 500ms
            const start = Date.now();
            let alive = true;
            while (alive && Date.now() - start < gracefulTimeoutMs) {
                if (classifyPidClaim(oldPid, serviceName, opts, expected).kind !== 'ours') { alive = false; break; }
                const waitStart = Date.now();
                while (Date.now() - waitStart < 500) { /* spin */ }
            }

            if (alive && classifyPidClaim(oldPid, serviceName, opts, expected).kind === 'ours') {
                // Tenshi's belt (fold-at-land, 2026-08-06): the deadliest signal fires only on
                // a verdict taken in the same breath — never on evidence up to a poll stale.
                // Casey: "a warrant executes on the conditions at execution, not at issue."
                console.log(`[${serviceName}] PID ${oldPid} didn't exit after ${gracefulTimeoutMs / 1000}s — SIGKILL (fresh verdict: ours (${basisLabel(verdict)}))`);
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
