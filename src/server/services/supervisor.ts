/**
 * Persistent Opus Supervisor Agent — Main Process Manager
 *
 * This module manages the supervisor worker process. The worker runs in a forked
 * child process and handles the blocking Agent SDK calls, while the main Express
 * process stays responsive to HTTP/WebSocket requests.
 *
 * The main process is a thin orchestration layer:
 * - Forks and manages the worker process lifecycle
 * - Routes messages between worker and WebSocket clients
 * - Handles create_goal and cancel_task requests from the worker
 * - Schedules supervisor cycles via setTimeout
 */

import { fork, execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { HAN_DIR, taskStmts, memoryStmts } from '../db';
import { loadConfig, createGoal, getAbortForTask } from './planning';
import { computeWallClockDelay } from '../lib/agent-scheduler';
import type {
    MainToWorkerMessage,
    WorkerToMainMessage,
    CycleCompleteMessage,
    BroadcastMessage
} from './supervisor-protocol';

// ── Types ────────────────────────────────────────────────────

type BroadcastFn = (message: Record<string, unknown>) => void;

// ── Module state ─────────────────────────────────────────────

let broadcastFn: BroadcastFn | null = null;
let supervisorEnabled = true;
// Durable pause: seed from a persistent signal so an API-set pause survives a process
// restart. Without this, supervisorPaused is in-memory only and silently resets to false
// on the next agent-server bounce (e.g. the post-commit hook restarts the server on every
// commit). Written/removed by setSupervisorPaused. Agent-agnostic — the supervisor is a
// single role, no 'jim'|'leo' literal (DEC-081).
const SUPERVISOR_PAUSE_SIGNAL = path.join(HAN_DIR, 'signals', 'supervisor-paused');
let supervisorPaused = fs.existsSync(SUPERVISOR_PAUSE_SIGNAL);
if (supervisorPaused) {
    console.log(`[Supervisor] Starting PAUSED — pause signal present (${SUPERVISOR_PAUSE_SIGNAL})`);
}
let nextCycleTimeout: ReturnType<typeof setTimeout> | null = null;
let workerProcess: ChildProcess | null = null;
let workerReady = false;
let pendingCycleResolve: ((result: CycleCompleteMessage['result'] | null) => void) | null = null;
let cycleInProgress = false;

const MEMORY_DIR = path.join(HAN_DIR, 'memory');
const PROJECTS_DIR = path.join(MEMORY_DIR, 'projects');
const SESSIONS_DIR = path.join(MEMORY_DIR, 'sessions');
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const JIM_AGENT_DIR = path.join(HAN_DIR, 'agents', 'Jim');
const JIM_HEALTH_FILE = path.join(HEALTH_DIR, 'jim-health.json');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const LEO_HEALTH_FILE = path.join(HEALTH_DIR, 'leo-health.json');
const JEMMA_HEALTH_FILE = path.join(HEALTH_DIR, 'jemma-health.json');
const RESURRECTION_LOG = path.join(HEALTH_DIR, 'resurrection-log.jsonl');
const RESURRECTION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const JIM_DISTRESS_FILE = path.join(HEALTH_DIR, 'jim-distress.json');
const DISTRESS_MULTIPLIER = 3; // Trigger if cycle > 3x median duration
const DEFAULT_MEDIAN_MS = 20 * 60 * 1000; // 20 minutes if <5 cycles

// Worker restart backoff
let workerRestartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_MS = 5000;
let cycleCount = 0;
let currentCycleStartTime = 0; // Track cycle start for distress detection

// ── Dampening (Deferred #4) ─────────────────────────────────
// Idle-dampening RETIRED (F3/F4 cycle-symmetry, S184): idleness is content, not clock.
// An idle beat is a cheap content-gated stand-down on the uniform shared rhythm — the
// meditation principle (the rhythm never stops; the LOAD flexes), not a slowed clock.

// Transition-dampening + wall-clock scheduling relocated to lib/agent-scheduler
// (F3/F4 cycle-symmetry — one shared rhythm, per-slug transition state).

// ── Health signal (Robin Hood Protocol) ──────────────────────

function writeJimHealthSignal(cycleNumber: number, tier: string, costUsd: number, nextDelayMs: number, lastError: string | null = null): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        const signal = {
            agent: 'jim',
            pid: process.pid,
            timestamp: new Date().toISOString(),
            cycle: cycleNumber,
            tier,
            status: lastError ? 'error' : 'ok',
            lastError,
            costUsd,
            nextDelayMs, // So Leo can calculate 180° phase offset
            uptimeMinutes: Math.round(process.uptime() / 60),
        };
        fs.writeFileSync(JIM_HEALTH_FILE, JSON.stringify(signal, null, 2));
    } catch (err) {
        console.error('[Supervisor] Failed to write health signal:', (err as Error).message);
    }
}

// ── Check Leo health (Robin Hood Protocol) ──────────────────

function checkLeoHealth(): void {
    try {
        if (!fs.existsSync(LEO_HEALTH_FILE)) {
            console.log('[Robin Hood] Leo health file not found — skipping check');
            return;
        }

        const leoHealthData = JSON.parse(fs.readFileSync(LEO_HEALTH_FILE, 'utf-8'));
        const leoTimestamp = new Date(leoHealthData.timestamp).getTime();
        const ageMs = Date.now() - leoTimestamp;
        const ageMinutes = ageMs / 60000;

        if (ageMinutes < 45) {
            // OK — no action needed
            console.log(`[Robin Hood] Leo OK (${Math.round(ageMinutes)}min ago, PID ${leoHealthData.pid})`);
            return;
        }

        if (ageMinutes < 90) {
            // Stale — log and check if process alive
            console.log(`[Robin Hood] Leo stale (${Math.round(ageMinutes)}min ago) — checking PID ${leoHealthData.pid}`);
            try {
                process.kill(leoHealthData.pid, 0);
                console.log(`[Robin Hood] Leo PID ${leoHealthData.pid} is alive — no action needed`);
                return;
            } catch {
                // PID dead, will fall through to down handling
                console.log(`[Robin Hood] Leo PID ${leoHealthData.pid} is dead — treating as down`);
            }
        } else {
            // Down — log and prepare to resurrect
            console.log(`[Robin Hood] Leo down (${Math.round(ageMinutes)}min ago) — checking PID ${leoHealthData.pid}`);
            try {
                process.kill(leoHealthData.pid, 0);
                console.log(`[Robin Hood] Leo PID ${leoHealthData.pid} is alive — no action needed`);
                return;
            } catch {
                console.log(`[Robin Hood] Leo PID ${leoHealthData.pid} is dead — proceeding with resurrection`);
            }
        }

        // At this point, PID is dead and age > 45min — attempt resurrection with cooldown
        const cooldownOk = checkResurrectionCooldown();
        if (!cooldownOk) {
            console.log('[Robin Hood] Resurrection cooldown active — skipping');
            return;
        }

        console.log('[Robin Hood] Attempting Leo resurrection via systemctl');
        try {
            execSync('systemctl --user restart leo-heartbeat.service', { timeout: 30000 });
            console.log('[Robin Hood] Leo restart command sent');

            // Wait 10 seconds for service to start
            execSync('sleep 10');

            // Check if health file was updated
            if (fs.existsSync(LEO_HEALTH_FILE)) {
                const updatedHealthData = JSON.parse(fs.readFileSync(LEO_HEALTH_FILE, 'utf-8'));
                const updatedAge = (Date.now() - new Date(updatedHealthData.timestamp).getTime()) / 60000;
                if (updatedAge < 2) {
                    // Success — health file recently updated
                    console.log('[Robin Hood] Leo resurrection successful');
                    logResurrectionResult(true, `Restarted after ${Math.round(ageMinutes)}min down`, 'leo');
                    return;
                }
            }

            // Health file not updated — failure
            console.error('[Robin Hood] Leo health file not updated after restart');
            logResurrectionResult(false, `Restart failed: health file not updated after ${Math.round(ageMinutes)}min down`, 'leo');
            escalateToNtfy(`Failed to resurrect Leo (heartbeat). Last seen ${Math.round(ageMinutes)}min ago. Manual intervention needed.`);
        } catch (err) {
            const msg = (err as Error).message;
            console.error('[Robin Hood] Resurrection failed:', msg);
            logResurrectionResult(false, `Restart failed: ${msg}`, 'leo');
            escalateToNtfy(`Failed to resurrect Leo (heartbeat). Last seen ${Math.round(ageMinutes)}min ago. Manual intervention needed.`);
        }
    } catch (err) {
        console.error('[Robin Hood] Health check error:', (err as Error).message);
    }
}

// ── Check Jemma health (Robin Hood Protocol) ──────────────

function checkJemmaHealth(): void {
    try {
        if (!fs.existsSync(JEMMA_HEALTH_FILE)) {
            console.log('[Robin Hood] Jemma health file not found — skipping check');
            return;
        }

        const jemmaHealthData = JSON.parse(fs.readFileSync(JEMMA_HEALTH_FILE, 'utf-8'));
        const jemmaTimestamp = new Date(jemmaHealthData.timestamp).getTime();
        const ageMs = Date.now() - jemmaTimestamp;
        const ageMinutes = ageMs / 60000;

        if (ageMinutes < 10) {
            // OK — no action needed
            console.log(`[Robin Hood] Jemma OK (${Math.round(ageMinutes)}min ago, PID ${jemmaHealthData.pid})`);
            return;
        }

        if (ageMinutes < 20) {
            // Stale — log and check if process alive
            console.log(`[Robin Hood] Jemma stale (${Math.round(ageMinutes)}min ago) — checking PID ${jemmaHealthData.pid}`);
            try {
                process.kill(jemmaHealthData.pid, 0);
                console.log(`[Robin Hood] Jemma PID ${jemmaHealthData.pid} is alive — no action needed`);
                return;
            } catch {
                // PID dead, will fall through to down handling
                console.log(`[Robin Hood] Jemma PID ${jemmaHealthData.pid} is dead — treating as down`);
            }
        } else {
            // Down — log and prepare to resurrect
            console.log(`[Robin Hood] Jemma down (${Math.round(ageMinutes)}min ago) — checking PID ${jemmaHealthData.pid}`);
            try {
                process.kill(jemmaHealthData.pid, 0);
                console.log(`[Robin Hood] Jemma PID ${jemmaHealthData.pid} is alive — no action needed`);
                return;
            } catch {
                console.log(`[Robin Hood] Jemma PID ${jemmaHealthData.pid} is dead — proceeding with resurrection`);
            }
        }

        // At this point, PID is dead and age > 10min — attempt resurrection with cooldown
        const cooldownOk = checkResurrectionCooldown();
        if (!cooldownOk) {
            console.log('[Robin Hood] Resurrection cooldown active — skipping');
            return;
        }

        console.log('[Robin Hood] Attempting Jemma resurrection via systemctl');
        try {
            execSync('systemctl --user restart jemma.service', { timeout: 30000 });
            console.log('[Robin Hood] Jemma restart command sent');

            // Wait 5 seconds for service to start
            execSync('sleep 5');

            // Check if health file was updated
            if (fs.existsSync(JEMMA_HEALTH_FILE)) {
                const updatedHealthData = JSON.parse(fs.readFileSync(JEMMA_HEALTH_FILE, 'utf-8'));
                const updatedAge = (Date.now() - new Date(updatedHealthData.timestamp).getTime()) / 60000;
                if (updatedAge < 1) {
                    // Success — health file recently updated
                    console.log('[Robin Hood] Jemma resurrection successful');
                    logResurrectionResult(true, `Restarted after ${Math.round(ageMinutes)}min down`, 'jemma');
                    return;
                }
            }

            // Health file not updated — failure
            console.error('[Robin Hood] Jemma health file not updated after restart');
            logResurrectionResult(false, `Restart failed: health file not updated after ${Math.round(ageMinutes)}min down`, 'jemma');
            escalateToNtfy(`Failed to resurrect Jemma (Discord service). Last seen ${Math.round(ageMinutes)}min ago. Manual intervention needed.`);
        } catch (err) {
            const msg = (err as Error).message;
            console.error('[Robin Hood] Jemma resurrection failed:', msg);
            logResurrectionResult(false, `Restart failed: ${msg}`, 'jemma');
            escalateToNtfy(`Failed to resurrect Jemma (Discord service). Last seen ${Math.round(ageMinutes)}min ago. Manual intervention needed.`);
        }
    } catch (err) {
        console.error('[Robin Hood] Jemma health check error:', (err as Error).message);
    }
}

function checkResurrectionCooldown(): boolean {
    try {
        if (!fs.existsSync(RESURRECTION_LOG)) {
            return true; // First resurrection — allowed
        }

        const lines = fs.readFileSync(RESURRECTION_LOG, 'utf-8').trim().split('\n');
        if (lines.length === 0) return true;

        const lastEntry = JSON.parse(lines[lines.length - 1]);
        const lastAttemptTime = new Date(lastEntry.timestamp).getTime();
        const timeSinceLastAttempt = Date.now() - lastAttemptTime;

        if (timeSinceLastAttempt < RESURRECTION_COOLDOWN_MS) {
            const minutesRemaining = Math.round((RESURRECTION_COOLDOWN_MS - timeSinceLastAttempt) / 60000);
            console.log(`[Robin Hood] Cooldown active: ${minutesRemaining}min remaining`);
            return false;
        }

        return true;
    } catch (err) {
        console.log('[Robin Hood] Could not check resurrection cooldown:', (err as Error).message);
        return true; // Proceed if unable to check
    }
}

// Phase A Batch 5 (S155, 2026-05-10): removed `target: string = 'leo'` default
// per DEC-081 agent-agnostic discipline. Target is now required — three callers
// (Leo resurrection branches, all in checkLeoHealth above) pass 'leo' explicitly;
// jemma resurrection branches already pass 'jemma'. Future agents/gateways needing
// resurrection logging pass their own slug.
function logResurrectionResult(success: boolean, reason: string, target: string): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        const entry = {
            timestamp: new Date().toISOString(),
            resurrector: 'jim',
            target,
            reason,
            success
        };
        fs.appendFileSync(RESURRECTION_LOG, JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error('[Robin Hood] Failed to log resurrection:', (err as Error).message);
    }
}

function escalateToNtfy(message: string): void {
    try {
        const config = loadConfig();
        if (!config.ntfy_topic) {
            console.log('[Robin Hood] No ntfy_topic configured — skipping notification');
            return;
        }

        const notificationMsg = `🚨 Robin Hood Alert\n${message}`;
        const curlCmd = `curl -X POST -H "Content-Type: application/json" -H "Priority: urgent" -d '{"title":"Robin Hood","message":"${message.replace(/"/g, '\\"')}"}' "https://ntfy.sh/${config.ntfy_topic}"`;
        execSync(curlCmd, { timeout: 10000 });
        console.log('[Robin Hood] Ntfy escalation sent');
    } catch (err) {
        console.error('[Robin Hood] Failed to send ntfy notification:', (err as Error).message);
    }
}

// ── Distress signal detection (slow cycle detection) ──────────────

function getMedianCycleDuration(): number {
    try {
        const { supervisorStmts } = require('../db');
        // Fetch more cycles to get a meaningful sample after filtering idle ones
        const recentCycles = supervisorStmts.getRecent.all(20) as any[];

        // Filter to completed successful cycles that actually did something.
        // Idle cycles (no_action only) skew the median down, causing productive
        // cycles to look "slow" and trigger false distress notifications.
        const productiveCycles = recentCycles.filter((c: any) => {
            if (!c.completed_at || c.error) return false;
            // Parse actions_taken JSON — idle if empty or only no_action
            try {
                const actions: string[] = JSON.parse(c.actions_taken || '[]');
                if (actions.length === 0) return false;
                if (actions.length === 1 && actions[0].startsWith('no_action')) return false;
                return true;
            } catch {
                return true; // Can't parse — include to be safe
            }
        });

        if (productiveCycles.length === 0) {
            return DEFAULT_MEDIAN_MS;
        }

        // Calculate duration for each cycle
        const durations = productiveCycles.map((c: any) => {
            const startedAt = new Date(c.started_at).getTime();
            const completedAt = new Date(c.completed_at).getTime();
            return completedAt - startedAt;
        });

        // Return median
        durations.sort((a, b) => a - b);
        const mid = Math.floor(durations.length / 2);
        if (durations.length % 2 === 0) {
            return (durations[mid - 1] + durations[mid]) / 2;
        }
        return durations[mid];
    } catch (err) {
        console.error('[Distress] Failed to get median cycle duration:', (err as Error).message);
        return DEFAULT_MEDIAN_MS;
    }
}

function writeDistressSignal(cycleNumber: number, expectedDurationMs: number, actualDurationMs: number): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        const signal = {
            agent: 'jim',
            timestamp: new Date().toISOString(),
            type: 'slow_cycle',
            cycleNumber,
            expectedDurationMs,
            actualDurationMs,
            reason: 'Supervisor cycle exceeded 3x normal duration'
        };
        fs.writeFileSync(JIM_DISTRESS_FILE, JSON.stringify(signal, null, 2));
        console.log(`[Distress] Slow cycle detected: ${Math.round(actualDurationMs / 1000)}s vs expected ${Math.round(expectedDurationMs / 1000)}s`);
    } catch (err) {
        console.error('[Distress] Failed to write distress signal:', (err as Error).message);
    }
}

function sendDistressNtfy(expectedMinutes: number, actualMinutes: number): void {
    try {
        const config = loadConfig();
        if (!config.ntfy_topic) {
            console.log('[Distress] No ntfy_topic configured — skipping notification');
            return;
        }

        const message = `Jim supervisor degraded: cycle took ${actualMinutes}min vs ${expectedMinutes}min typical`;
        const curlCmd = `curl -X POST -H "Content-Type: application/json" -H "Priority: high" -d '{"title":"Jim Supervisor Degraded","message":"${message}"}' "https://ntfy.sh/${config.ntfy_topic}"`;
        execSync(curlCmd, { timeout: 10000 });
        console.log('[Distress] Ntfy notification sent');
    } catch (err) {
        console.error('[Distress] Failed to send ntfy notification:', (err as Error).message);
    }
}

// ── Four-phase daily rhythm (shared with Leo) ────────────────
//
// Both Jim and Leo follow the same rhythm and period. Scheduling is
// deterministic via wall clock:
//   Leo fires at: epoch mod period == 0        (phase 0°)
//   Jim fires at: epoch mod period == period/2  (phase 180°)

// F3/F4 cycle-symmetry (S184): jim's local cadence shadow retired — jim adopts the SHARED
// lib/day-phase cadence (sleep 40→20, matching leo; active 20 / rest 40 / holiday 80, shared
// for all agents). The wall-clock delay + N-body antiphase + transition-dampening now live in
// lib/agent-scheduler; getCurrentPeriodMs + BASE_DELAY_* + the local day-phase import retired with it.

/** Delay until Jim's next wall-clock-aligned cycle — delegated to the shared cycle-symmetry
 *  scheduler (lib/agent-scheduler). Jim's antiphase index resolves to 180° at N=2 (byte-identical
 *  to the prior `period/2` offset). Idle-dampening retired (content-gated in the activity layer);
 *  transition-dampening relocated (shared). */
function getWallClockDelay(): number {
    return computeWallClockDelay('jim');
}

// ── Helper functions ─────────────────────────────────────────

/**
 * Watch for Jim wake signal and trigger supervisor cycle.
 */
function startSupervisorSignalWatcher(): void {
    try {
        fs.watch(SIGNALS_DIR, async (event, filename) => {
            // Handle jim-wake signal flag
            if (filename !== 'jim-wake') return;

            console.log('[Supervisor] Wake signal detected');

            try {
                // Small delay to let signal file fully write
                await new Promise(r => setTimeout(r, 500));
                // Read signal to check if human-triggered
                let humanTriggered = false;
                const signalPath = path.join(SIGNALS_DIR, 'jim-wake');
                try {
                    const content = fs.readFileSync(signalPath, 'utf8');
                    const signal = JSON.parse(content);
                    humanTriggered = signal.reason === 'human_message_fallback';
                } catch { /* couldn't read — treat as non-human */ }
                // Clean up signal flag immediately (before cycle — it's just a flag)
                try {
                    fs.unlinkSync(signalPath);
                } catch { /* already gone */ }
                console.log(`[Supervisor] Running wake-triggered cycle${humanTriggered ? ' (human message — full voice)' : ''}`);
                await runSupervisorCycle({ humanTriggered });
            } catch (err) {
                console.error('[Supervisor] Wake signal cycle error:', (err as Error).message);
            }
        });
        console.log('[Supervisor] Signal watcher active on', SIGNALS_DIR);
    } catch (err) {
        console.error('[Supervisor] Could not start signal watcher:', (err as Error).message);
        console.log('[Supervisor] Will fall back to scheduled cycles only');
    }
}

// Process wake signal if it existed before the watcher started.
// fs.watch() only fires on NEW events — a pre-existing flag is invisible to it.
async function processExistingWakeSignals(): Promise<void> {
    try {
        const signalPath = path.join(SIGNALS_DIR, 'jim-wake');
        if (!fs.existsSync(signalPath)) return;

        console.log('[Supervisor] Found existing wake signal on startup');
        // Read signal to check if human-triggered
        let humanTriggered = false;
        try {
            const content = fs.readFileSync(signalPath, 'utf8');
            const signal = JSON.parse(content);
            humanTriggered = signal.reason === 'human_message_fallback';
        } catch { /* couldn't read */ }
        // Clean up flag immediately
        try { fs.unlinkSync(signalPath); } catch { /* already gone */ }

        try {
            await runSupervisorCycle({ humanTriggered });
        } catch (err) {
            console.error('[Supervisor] Stale signal cycle error:', (err as Error).message);
        }
    } catch (err) {
        console.error('[Supervisor] Error processing existing wake signal:', (err as Error).message);
    }
}

function sendMessageToWorker(msg: MainToWorkerMessage): void {
    if (workerProcess && workerReady) {
        workerProcess.send(msg);
    }
}

function handleWorkerMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
        case 'ready':
            workerReady = true;
            console.log('[Supervisor] Worker ready');
            break;

        case 'cycle_started':
            console.log(`[Supervisor] Cycle #${msg.cycleNumber} (${msg.cycleType}) started: ${msg.cycleId}`);
            break;

        case 'cycle_complete':
            if (pendingCycleResolve) {
                pendingCycleResolve(msg.result);
                pendingCycleResolve = null;
            }
            break;

        case 'cycle_skipped':
            console.log(`[Supervisor] Cycle skipped: ${msg.reason}`);
            if (pendingCycleResolve) {
                pendingCycleResolve(null);
                pendingCycleResolve = null;
            }
            break;

        case 'cycle_failed':
            console.error(`[Supervisor] Cycle failed: ${msg.error.message}`);
            if (pendingCycleResolve) {
                pendingCycleResolve(null);
                pendingCycleResolve = null;
            }
            break;

        case 'broadcast':
            handleBroadcastFromWorker(msg);
            break;

        case 'log':
            // Forward worker logs to console
            const logFn = console[msg.level] || console.log;
            logFn(msg.message, ...(msg.args || []));
            break;
    }
}

function handleBroadcastFromWorker(msg: BroadcastMessage): void {
    const { type, data } = msg.payload;

    switch (type) {
        case 'system_event':
            // Handle system events from worker (create_goal_request, cancel_task_request)
            if (data.event === 'create_goal_request') {
                try {
                    const goalId = createGoal(
                        data.goal_description,
                        data.project_path,
                        true,
                        null,
                        'standalone',
                        data.planning_model || null
                    );
                    console.log(`[Supervisor] Created goal ${goalId} (requested by worker cycle ${data.cycleId})`);
                    broadcastFn?.({ type: 'supervisor_action', action: 'create_goal', detail: data.goal_description.slice(0, 80), cycleId: data.cycleId });
                } catch (err: any) {
                    console.error(`[Supervisor] Failed to create goal: ${err.message}`);
                }
            } else if (data.event === 'cancel_task_request') {
                try {
                    const task = taskStmts.get.get(data.task_id) as any;
                    if (!task) {
                        console.log(`[Supervisor] Task ${data.task_id} not found (cancel request from worker)`);
                        return;
                    }

                    if (task.status === 'pending') {
                        taskStmts.cancel.run('cancelled', new Date().toISOString(), data.task_id);
                        console.log(`[Supervisor] Cancelled pending task ${data.task_id} (requested by worker)`);
                    } else if (task.status === 'running') {
                        const abortController = getAbortForTask(data.task_id);
                        if (abortController) {
                            abortController.abort();
                            taskStmts.cancel.run('cancelled', new Date().toISOString(), data.task_id);
                            console.log(`[Supervisor] Aborted and cancelled running task ${data.task_id} (requested by worker)`);
                        } else {
                            taskStmts.cancel.run('cancelled', new Date().toISOString(), data.task_id);
                            console.log(`[Supervisor] Cancelled ghost-running task ${data.task_id} (requested by worker)`);
                        }
                    }
                } catch (err: any) {
                    console.error(`[Supervisor] Failed to cancel task ${data.task_id}: ${err.message}`);
                }
            }
            break;

        default:
            // Forward other broadcasts to WebSocket clients
            broadcastFn?.(msg.payload.data || msg.payload);
            break;
    }
}

function startWorker(): void {
    if (workerProcess) {
        console.warn('[Supervisor] Worker already running');
        return;
    }

    const workerPath = path.join(__dirname, 'supervisor-worker.ts');
    console.log(`[Supervisor] Starting worker: ${workerPath}`);

    workerProcess = fork(workerPath, [], {
        execArgv: ['-r', 'tsx/cjs'],
        env: process.env,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    workerReady = false;

    workerProcess.on('message', (msg: any) => {
        handleWorkerMessage(msg as WorkerToMainMessage);
    });

    workerProcess.on('error', (err) => {
        console.error('[Supervisor] Worker error:', err);
    });

    workerProcess.on('exit', (code, signal) => {
        console.log(`[Supervisor] Worker exited (code: ${code}, signal: ${signal})`);
        workerProcess = null;
        workerReady = false;

        // Resolve pending cycle promise if any
        if (pendingCycleResolve) {
            pendingCycleResolve(null);
            pendingCycleResolve = null;
        }

        // Auto-restart with backoff
        if (supervisorEnabled && !supervisorPaused && workerRestartAttempts < MAX_RESTART_ATTEMPTS) {
            workerRestartAttempts++;
            console.log(`[Supervisor] Restarting worker (attempt ${workerRestartAttempts}/${MAX_RESTART_ATTEMPTS}) in ${RESTART_BACKOFF_MS}ms`);
            setTimeout(() => {
                startWorker();
            }, RESTART_BACKOFF_MS);
        } else if (workerRestartAttempts >= MAX_RESTART_ATTEMPTS) {
            console.error('[Supervisor] Max restart attempts reached, giving up');
        }
    });
}

// ── Public setters ───────────────────────────────────────────

export function setSupervisorBroadcastFn(fn: BroadcastFn): void {
    broadcastFn = fn;
}

// ── Memory bank templates (for init only) ────────────────────

const IDENTITY_TEMPLATE = `# Supervisor Identity

## Role
I am the persistent Opus supervisor for Darron's Hortus Arbor Nostra development ecosystem.
I oversee all autonomous task execution, make strategic decisions, track progress,
and continuously improve the system's effectiveness.

## Last Updated
${new Date().toISOString()}
`;

const ACTIVE_CONTEXT_TEMPLATE = `# Active Context

## Current Focus
No active focus yet. Awaiting first supervisor cycle.

## Last Cycle
Not yet run.
`;

const SELF_REFLECTION_TEMPLATE = `# Self-Reflection

## Memory Format Evolution
- v1 (${new Date().toISOString().split('T')[0]}): Initial memory bank structure

## Effectiveness Metrics
No data yet — awaiting first cycles.
`;

// ── Initialisation ───────────────────────────────────────────

function seedIfMissing(filename: string, content: string): void {
    const filepath = path.join(MEMORY_DIR, filename);
    if (!fs.existsSync(filepath)) {
        fs.writeFileSync(filepath, content);
    }
}

function seedPatternsFromHistory(): void {
    try {
        const records = memoryStmts.getAll.all() as any[];
        if (records.length === 0) {
            fs.writeFileSync(path.join(MEMORY_DIR, 'patterns.md'),
                '# Patterns & Best Practices\n\nNo historical data yet. Patterns will be recorded as tasks complete.\n');
            return;
        }

        const byModel: Record<string, { total: number; success: number; cost: number }> = {};
        for (const r of records) {
            const model = r.model_used || 'unknown';
            if (!byModel[model]) byModel[model] = { total: 0, success: 0, cost: 0 };
            byModel[model].total++;
            if (r.success) byModel[model].success++;
            byModel[model].cost += r.cost_usd || 0;
        }

        const lines = ['# Patterns & Best Practices\n', '## Model Performance (from history)\n'];
        for (const [model, stats] of Object.entries(byModel)) {
            const rate = ((stats.success / stats.total) * 100).toFixed(0);
            const avgCost = (stats.cost / stats.total).toFixed(4);
            lines.push(`- **${model}**: ${rate}% success (${stats.total} tasks, avg $${avgCost})`);
        }
        lines.push('\n## Task Decomposition Patterns\n- (To be learned from observation)\n');

        fs.writeFileSync(path.join(MEMORY_DIR, 'patterns.md'), lines.join('\n'));
    } catch (err: any) {
        console.error('[Supervisor] Failed to seed patterns:', err.message);
        fs.writeFileSync(path.join(MEMORY_DIR, 'patterns.md'),
            '# Patterns & Best Practices\n\nFailed to seed from history.\n');
    }
}

function seedFailuresFromHistory(): void {
    const { db } = require('../db');
    try {
        const failures = db.prepare(
            "SELECT title, error, model, project_path, completed_at FROM tasks WHERE status = 'failed' ORDER BY completed_at DESC LIMIT 20"
        ).all() as any[];

        if (failures.length === 0) {
            fs.writeFileSync(path.join(MEMORY_DIR, 'failures.md'),
                '# Failure Patterns\n\nNo failures recorded yet.\n');
            return;
        }

        const lines = ['# Failure Patterns\n', '## Recent Failures\n'];
        lines.push('| Date | Task | Error Summary | Model |');
        lines.push('|------|------|---------------|-------|');
        for (const f of failures.slice(0, 10)) {
            const date = f.completed_at?.split('T')[0] || '?';
            const title = (f.title || '').slice(0, 40);
            const error = (f.error || '').slice(0, 60).replace(/\|/g, '/');
            lines.push(`| ${date} | ${title} | ${error} | ${f.model || '?'} |`);
        }

        fs.writeFileSync(path.join(MEMORY_DIR, 'failures.md'), lines.join('\n'));
    } catch (err: any) {
        console.error('[Supervisor] Failed to seed failures:', err.message);
        fs.writeFileSync(path.join(MEMORY_DIR, 'failures.md'),
            '# Failure Patterns\n\nFailed to seed from history.\n');
    }
}

function seedProjectMemory(): void {
    const { portfolioStmts } = require('../db');
    try {
        const projects = portfolioStmts.list.all() as any[];
        for (const p of projects) {
            const filepath = path.join(PROJECTS_DIR, `${p.name}.md`);
            if (fs.existsSync(filepath)) continue;

            const lines = [`# Project: ${p.name}\n`];
            if (p.description) lines.push(`## Overview\n${p.description}\n`);
            lines.push(`## Path\n${p.path}\n`);
            lines.push(`## Lifecycle\n${p.lifecycle || 'active'}\n`);

            fs.writeFileSync(filepath, lines.join('\n'));
        }
    } catch (err: any) {
        console.error('[Supervisor] Failed to seed project memory:', err.message);
    }
}

export function initSupervisor(): void {
    const config = loadConfig();
    const supervisorConfig = config.supervisor || {};

    if (supervisorConfig.enabled === false) {
        supervisorEnabled = false;
        console.log('[Supervisor] Disabled via config');
        return;
    }

    // Create directories
    for (const dir of [MEMORY_DIR, PROJECTS_DIR, SESSIONS_DIR, JIM_AGENT_DIR]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // Seed memory files
    seedIfMissing('identity.md', IDENTITY_TEMPLATE);
    seedIfMissing('active-context.md', ACTIVE_CONTEXT_TEMPLATE);
    seedIfMissing('self-reflection.md', SELF_REFLECTION_TEMPLATE);

    if (!fs.existsSync(path.join(MEMORY_DIR, 'patterns.md'))) {
        seedPatternsFromHistory();
    }

    if (!fs.existsSync(path.join(MEMORY_DIR, 'failures.md'))) {
        seedFailuresFromHistory();
    }

    seedProjectMemory();

    console.log('[Supervisor] Initialised — memory banks at', MEMORY_DIR);

    // Write a fresh health signal on startup so Robin Hood doesn't flag stale data
    // from a previous process between restart and first cycle completion
    writeJimHealthSignal(cycleCount, 'starting', 0, 0);

    // Start signal watcher to detect CLI stop and jim-wake signals
    startSupervisorSignalWatcher();

    // Process any wake signals that predate the watcher (e.g. from before server restart)
    processExistingWakeSignals().catch(err =>
        console.error('[Supervisor] Startup signal scan failed:', (err as Error).message)
    );

    // Start the worker process
    startWorker();
}

// ── Core cycle function (delegates to worker) ────────────────

export async function runSupervisorCycle(options?: { humanTriggered?: boolean }): Promise<{
    cycleId: string;
    observations: string[];
    actionSummaries: string[];
    costUsd: number;
    nextDelayMs: number;
} | null> {
    if (!supervisorEnabled || supervisorPaused || !workerProcess || !workerReady) {
        return null;
    }

    // Guard against overlapping cycles
    if (cycleInProgress) {
        console.log('[Supervisor] Cycle already in progress — skipping');
        return null;
    }

    // Send run_cycle message to worker and await response
    return new Promise<{
        cycleId: string;
        observations: string[];
        actionSummaries: string[];
        costUsd: number;
        nextDelayMs: number;
    } | null>((resolve) => {
        // Set up timeout (2 hours — generous safety net, cycles can run long)
        const timeout = setTimeout(() => {
            cycleInProgress = false;
            pendingCycleResolve = null;
            console.error('[Supervisor] Cycle timeout after 2 hours');
            resolve(null);
        }, 2 * 60 * 60 * 1000);

        // Set up promise resolver
        pendingCycleResolve = (result) => {
            cycleInProgress = false;
            clearTimeout(timeout);
            if (!result) {
                resolve(null);
                return;
            }

            // Transform result to match expected format
            resolve({
                cycleId: result.cycleId,
                observations: result.observations.map(o => o.content),
                actionSummaries: result.actionSummaries,
                costUsd: result.costUsd,
                nextDelayMs: result.nextDelayMs
            });
        };

        // Mark cycle as in progress and send message to worker
        cycleInProgress = true;
        sendMessageToWorker({ type: 'run_cycle', humanTriggered: options?.humanTriggered });
    });
}

// ── Adaptive scheduling ──────────────────────────────────────

export function scheduleSupervisorCycle(): void {
    if (!supervisorEnabled || supervisorPaused) return;

    const delay = getWallClockDelay();

    nextCycleTimeout = setTimeout(async () => {
        // Check Leo and Jemma health at start of every cycle (Robin Hood Protocol)
        checkLeoHealth();
        checkJemmaHealth();

        // Record cycle start time for distress detection
        currentCycleStartTime = Date.now();

        try {
            const result = await runSupervisorCycle();
            cycleCount++;

            if (result) {
                // Idle-dampening retired (F3/F4): idleness is content-gated on the uniform
                // rhythm, not tracked to slow the clock (the meditation principle, S184).

                // Check for slow cycle (distress signal)
                const actualDurationMs = Date.now() - currentCycleStartTime;
                const medianDurationMs = getMedianCycleDuration();
                const threshold = medianDurationMs * DISTRESS_MULTIPLIER;

                if (actualDurationMs > threshold) {
                    const expectedMinutes = Math.round(medianDurationMs / 60000);
                    const actualMinutes = Math.round(actualDurationMs / 60000);
                    writeDistressSignal(cycleCount, medianDurationMs, actualDurationMs);
                    sendDistressNtfy(expectedMinutes, actualMinutes);
                }

                writeJimHealthSignal(cycleCount, 'complete', result.costUsd, delay);
            }
        } catch (err: any) {
            cycleCount++;
            console.error('[Supervisor] Cycle error:', err.message);
            writeJimHealthSignal(cycleCount, 'error', 0, delay, err.message);
        }

        scheduleSupervisorCycle();
    }, delay);
}

// ── Control ──────────────────────────────────────────────────

export function stopSupervisor(): void {
    if (nextCycleTimeout) {
        clearTimeout(nextCycleTimeout);
        nextCycleTimeout = null;
    }
    if (workerProcess) {
        sendMessageToWorker({ type: 'shutdown' });
        workerProcess = null;
        workerReady = false;
    }
    console.log('[Supervisor] Stopped');
}

export function setSupervisorPaused(paused: boolean): void {
    supervisorPaused = paused;
    // Persist so the pause survives a server/worker restart (in-memory state alone resets
    // to false on the next agent-server bounce). Fail-safe: a FS error never breaks the
    // in-memory pause — it just won't survive a restart, which we log.
    try {
        if (paused) {
            fs.mkdirSync(path.dirname(SUPERVISOR_PAUSE_SIGNAL), { recursive: true });
            fs.writeFileSync(SUPERVISOR_PAUSE_SIGNAL, `${new Date().toISOString()}\n`);
        } else {
            fs.rmSync(SUPERVISOR_PAUSE_SIGNAL, { force: true });
        }
    } catch (err) {
        console.warn(`[Supervisor] Could not persist pause signal: ${(err as Error).message}`);
    }
    if (paused) {
        if (nextCycleTimeout) {
            clearTimeout(nextCycleTimeout);
            nextCycleTimeout = null;
        }
        console.log('[Supervisor] Paused (persisted)');
    } else {
        console.log('[Supervisor] Resumed (signal cleared)');
        scheduleSupervisorCycle();
    }
}

export function isSupervisorPaused(): boolean {
    return supervisorPaused;
}

export function isSupervisorEnabled(): boolean {
    return supervisorEnabled;
}
