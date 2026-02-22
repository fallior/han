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

import { fork, type ChildProcess } from 'node:child_process';
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

// Worker restart backoff
let workerRestartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_MS = 5000;

// ── Helper functions ─────────────────────────────────────────

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

    const workerPath = path.join(__dirname, 'supervisor-worker.js');
    console.log(`[Supervisor] Starting worker: ${workerPath}`);

    workerProcess = fork(workerPath, [], {
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
    for (const dir of [MEMORY_DIR, PROJECTS_DIR, SESSIONS_DIR]) {
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
        // Set up timeout (10 minutes safety net)
        const timeout = setTimeout(() => {
            pendingCycleResolve = null;
            console.error('[Supervisor] Cycle timeout after 10 minutes');
            resolve(null);
        }, 10 * 60 * 1000);

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

    runSupervisorCycle().then(result => {
        const delay = result?.nextDelayMs || 5 * 60 * 1000; // Default to 5 minutes
        console.log(`[Supervisor] Next cycle in ${Math.round(delay / 1000)}s`);
        nextCycleTimeout = setTimeout(scheduleSupervisorCycle, delay);
    }).catch(err => {
        console.error('[Supervisor] Cycle error:', err.message);
        nextCycleTimeout = setTimeout(scheduleSupervisorCycle, 5 * 60 * 1000);
    });
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
