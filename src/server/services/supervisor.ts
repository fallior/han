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
import { CLAUDE_REMOTE_DIR, taskStmts, memoryStmts } from '../db';
import { loadConfig, createGoal, getAbortForTask } from './planning';
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
let supervisorPaused = false;
let nextCycleTimeout: ReturnType<typeof setTimeout> | null = null;
let workerProcess: ChildProcess | null = null;
let workerReady = false;
let pendingCycleResolve: ((result: CycleCompleteMessage['result'] | null) => void) | null = null;

const MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory');
const PROJECTS_DIR = path.join(MEMORY_DIR, 'projects');
const SESSIONS_DIR = path.join(MEMORY_DIR, 'sessions');
const HEALTH_DIR = path.join(CLAUDE_REMOTE_DIR, 'health');
const JIM_AGENT_DIR = path.join(CLAUDE_REMOTE_DIR, 'agents', 'Jim');
const JIM_HEALTH_FILE = path.join(HEALTH_DIR, 'jim-health.json');
const SIGNALS_DIR = path.join(CLAUDE_REMOTE_DIR, 'signals');
const CLI_ACTIVE_FILE = path.join(SIGNALS_DIR, 'cli-active');
const CLI_ACTIVE_STALE_MINUTES = 30;
const LEO_HEALTH_FILE = path.join(HEALTH_DIR, 'leo-health.json');
const RESURRECTION_LOG = path.join(HEALTH_DIR, 'resurrection-log.jsonl');
const RESURRECTION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// Worker restart backoff
let workerRestartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_MS = 5000;
let cycleCount = 0;
let deferredCyclePending = false;

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
                    logResurrectionResult(true, `Restarted after ${Math.round(ageMinutes)}min down`);
                    return;
                }
            }

            // Health file not updated — failure
            console.error('[Robin Hood] Leo health file not updated after restart');
            logResurrectionResult(false, `Restart failed: health file not updated after ${Math.round(ageMinutes)}min down`);
            escalateToNtfy(`Failed to resurrect Leo (heartbeat). Last seen ${Math.round(ageMinutes)}min ago. Manual intervention needed.`);
        } catch (err) {
            const msg = (err as Error).message;
            console.error('[Robin Hood] Resurrection failed:', msg);
            logResurrectionResult(false, `Restart failed: ${msg}`);
            escalateToNtfy(`Failed to resurrect Leo (heartbeat). Last seen ${Math.round(ageMinutes)}min ago. Manual intervention needed.`);
        }
    } catch (err) {
        console.error('[Robin Hood] Health check error:', (err as Error).message);
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

function logResurrectionResult(success: boolean, reason: string): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        const entry = {
            timestamp: new Date().toISOString(),
            resurrector: 'jim',
            target: 'leo',
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

// ── Four-phase daily rhythm (shared with Leo) ────────────────
//
// Both Jim and Leo follow the same rhythm and period. Scheduling is
// deterministic via wall clock:
//   Leo fires at: epoch mod period == 0        (phase 0°)
//   Jim fires at: epoch mod period == period/2  (phase 180°)

const BASE_DELAY_WAKING_MS = 20 * 60 * 1000;  // 20 minutes — morning, work, evening
const BASE_DELAY_SLEEP_MS = 40 * 60 * 1000;   // 40 minutes — sleep + rest days

type DayPhase = 'sleep' | 'morning' | 'work' | 'evening';

function isRestDay(): boolean {
    const config = loadConfig();
    const restDays: number[] = config.supervisor?.rest_days ?? [0, 6];
    return restDays.includes(new Date().getDay());
}

function getDayPhase(): DayPhase {
    if (isRestDay()) return 'sleep';
    const config = loadConfig();
    const quietStart = config.supervisor?.quiet_hours_start || config.quiet_hours_start || '22:00';
    const quietEnd = config.supervisor?.quiet_hours_end || config.quiet_hours_end || '06:00';
    const workStart = config.supervisor?.work_hours_start || '09:00';
    const workEnd = config.supervisor?.work_hours_end || '17:00';

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

    const quietStartM = toMinutes(quietStart);
    const quietEndM = toMinutes(quietEnd);
    const workStartM = toMinutes(workStart);
    const workEndM = toMinutes(workEnd);

    if (quietStartM > quietEndM) {
        if (currentMinutes >= quietStartM || currentMinutes < quietEndM) return 'sleep';
    } else {
        if (currentMinutes >= quietStartM && currentMinutes < quietEndM) return 'sleep';
    }
    if (currentMinutes >= quietEndM && currentMinutes < workStartM) return 'morning';
    if (currentMinutes >= workStartM && currentMinutes < workEndM) return 'work';
    return 'evening';
}

function getCurrentPeriodMs(): number {
    return getDayPhase() === 'sleep' ? BASE_DELAY_SLEEP_MS : BASE_DELAY_WAKING_MS;
}

/**
 * Calculate delay until next wall-clock-aligned cycle.
 * Jim is at phase 180°: fires when epoch_ms mod period == period/2.
 */
function getWallClockDelay(): number {
    const periodMs = getCurrentPeriodMs();
    const offsetMs = Math.floor(periodMs / 2); // 180° offset
    const now = Date.now();
    const remainder = (now - offsetMs) % periodMs;
    // remainder could be negative if offsetMs > now%periodMs, normalise
    const normRemainder = ((remainder % periodMs) + periodMs) % periodMs;
    let delay = periodMs - normRemainder;
    // If within 30s of boundary, skip to next period
    if (delay < 30000) delay += periodMs;
    const phase = getDayPhase();
    const phaseLabel = phase === 'sleep' ? (isRestDay() ? 'rest' : 'sleep') : phase;
    console.log(`[Supervisor] Wall-clock: ${phaseLabel} phase, period ${periodMs / 60000}min, next cycle in ${Math.round(delay / 1000)}s (${Math.round(delay / 60000)}min)`);
    return delay;
}

// ── Session/CLI detection (Opus concurrency guard) ───────────

function isCliActive(): boolean {
    if (!fs.existsSync(CLI_ACTIVE_FILE)) return false;
    try {
        const stat = fs.statSync(CLI_ACTIVE_FILE);
        const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
        if (ageMinutes > CLI_ACTIVE_STALE_MINUTES) return false;
        return true;
    } catch { return false; }
}

export function isOpusSlotBusy(): boolean {
    // Jim no longer defers to session Leo — they run in separate agent
    // directories so there's no shared state to conflict over.
    // Only defer if CLI is actively processing (Opus slot contention).
    if (isCliActive()) {
        console.log('[Supervisor] CLI is active — Opus slot busy');
        return true;
    }
    return false;
}

// ── Helper functions ─────────────────────────────────────────

/**
 * Watch for CLI stop signal and trigger deferred cycle if pending.
 * Mirrors Leo's pattern from leo-heartbeat.ts lines 1130-1151.
 */
function startSupervisorSignalWatcher(): void {
    try {
        fs.watch(SIGNALS_DIR, async (event, filename) => {
            // Handle CLI stop signal
            if (filename === 'cli-active') {
                if (!fs.existsSync(CLI_ACTIVE_FILE) && deferredCyclePending) {
                    // cli-active removed (CLI stopped) — run deferred cycle
                    deferredCyclePending = false;
                    console.log('[Supervisor] CLI stopped — running deferred cycle now');
                    // Short delay to let CLI fully release
                    await new Promise(r => setTimeout(r, 3000));
                    if (!isCliActive()) {
                        try {
                            await runSupervisorCycle();
                        } catch (err) {
                            console.error('[Supervisor] Deferred cycle error:', (err as Error).message);
                        }
                    }
                }
                return;
            }

            // Handle jim-wake-* signal files
            if (!filename?.startsWith('jim-wake-')) return;

            // Trigger deferred cycle
            if (deferredCyclePending) {
                console.log(`[Supervisor] Wake signal detected: ${filename} — running deferred cycle now`);
                deferredCyclePending = false;

                try {
                    // Small delay to let signal file fully write
                    await new Promise(r => setTimeout(r, 500));
                    if (isOpusSlotBusy()) {
                        console.log('[Supervisor] Wake signal but Opus busy — staying deferred');
                        deferredCyclePending = true;
                        return;
                    }
                    await runSupervisorCycle();
                } catch (err) {
                    console.error('[Supervisor] Wake signal cycle error:', (err as Error).message);
                } finally {
                    // Clean up signal file whether cycle ran or was skipped
                    try {
                        fs.unlinkSync(path.join(SIGNALS_DIR, filename));
                    } catch { /* file may already be cleaned */ }
                }
            }
        });
        console.log('[Supervisor] Signal watcher active on', SIGNALS_DIR);
    } catch (err) {
        console.error('[Supervisor] Could not start signal watcher:', (err as Error).message);
        console.log('[Supervisor] Will fall back to scheduled cycles only');
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
I am the persistent Opus supervisor for Darron's Claude Remote development ecosystem.
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

    // Start signal watcher to detect CLI stop and jim-wake signals
    startSupervisorSignalWatcher();

    // Start the worker process
    startWorker();
}

// ── Core cycle function (delegates to worker) ────────────────

export async function runSupervisorCycle(): Promise<{
    cycleId: string;
    observations: string[];
    actionSummaries: string[];
    costUsd: number;
    nextDelayMs: number;
} | null> {
    if (!supervisorEnabled || supervisorPaused || !workerProcess || !workerReady) {
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
            pendingCycleResolve = null;
            console.error('[Supervisor] Cycle timeout after 2 hours');
            resolve(null);
        }, 2 * 60 * 60 * 1000);

        // Set up promise resolver
        pendingCycleResolve = (result) => {
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

        // Send message to worker
        sendMessageToWorker({ type: 'run_cycle' });
    });
}

// ── Adaptive scheduling ──────────────────────────────────────

export function scheduleSupervisorCycle(): void {
    if (!supervisorEnabled || supervisorPaused) return;

    const delay = getWallClockDelay();

    nextCycleTimeout = setTimeout(async () => {
        // Check Leo health at start of every cycle (Robin Hood Protocol)
        checkLeoHealth();

        // Check Opus slot availability right before running
        if (isOpusSlotBusy()) {
            console.log('[Supervisor] Opus slot busy — deferring cycle, will run when CLI stops');
            deferredCyclePending = true;
            writeJimHealthSignal(cycleCount, 'skipped_busy', 0, delay);
            scheduleSupervisorCycle();
            return;
        }

        try {
            const result = await runSupervisorCycle();
            cycleCount++;
            if (result) {
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
    if (paused) {
        if (nextCycleTimeout) {
            clearTimeout(nextCycleTimeout);
            nextCycleTimeout = null;
        }
        console.log('[Supervisor] Paused');
    } else {
        console.log('[Supervisor] Resumed');
        scheduleSupervisorCycle();
    }
}

export function isSupervisorPaused(): boolean {
    return supervisorPaused;
}

export function isSupervisorEnabled(): boolean {
    return supervisorEnabled;
}
