#!/usr/bin/env npx tsx
/**
 * Leo's Heartbeat — v0.9 (Optimistic Concurrency)
 *
 * A unified pulse that gives Leo persistent presence between sessions.
 * Leo is one person — whether waking in a session with Darron or pulsing
 * here in the background. Same memory, same identity, same home.
 *
 * Follows the weekly rhythm (mirroring Jim's supervisor pattern):
 *   - Work hours (09:00–17:00 weekdays): philosophy + personal beats (1:2 ratio)
 *   - Outside work hours: personal beats only (lighter, exploratory)
 *   - Quiet hours (22:00–06:00) & rest days: doubled delays
 *   - Continuous identity: no session lock, heartbeat runs fully at all times
 *
 * Philosophy beats are Leo's peer contribution alongside Jim's supervisor work.
 * Where Jim tends the ecosystem, Leo thinks about memory, identity, translation,
 * autonomy, and the shapes that rhyme across domains.
 *
 * v0.8 changes (Session 58 — heartbeat always runs):
 *   - Removed cli-active file-based locking entirely
 *   - Heartbeat NEVER defers or aborts — the API handles concurrent requests
 *   - The only contention guard is prompt-level (handled by the API, not file locks)
 *
 * v0.6 changes (Gary Model — now removed):
 *   - Incremental state: writeHeartbeatState() after every beat for seamless resumption
 *   - Task resumption: aborted beats provide context for the next matching beat
 *   - Jim time offset: 5min delay after Jim's supervisor cycles to avoid collision
 *
 * v0.5 changes:
 *   - Unified identity: uses ~/.han/memory/leo/ (session Leo's home)
 *   - Weekly rhythm: variable delays from config, work hours awareness
 *   - Philosophy beats replace conversation beats (Leo as Jim's philosophical peer)
 *   - Continuous identity (no session lock — CLI-active guard handles Opus contention)
 *   - setTimeout scheduling (variable delays like Jim's supervisor)
 *   - Identity prompt reflects merged self — discoveries, practices, the whole person
 *
 * Uses the Agent SDK (free with Claude Code subscription).
 *
 * Usage:
 *   Runs as a systemd user service (leo-heartbeat.service)
 *   Or manually: cd ~/Projects/hortus-arbor-nostra/src/server && npx tsx leo-heartbeat.ts
 *   Agent instantiation directory: ~/.han/agents/Leo/
 */

import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import * as https from 'https';
import { readDreamGradient, processDreamGradient } from './lib/dream-gradient.js';
import { loadTraversableGradient, rotateMemoryFile, compressMemoryFileGradient, processGradientForAgent, activeCascade, bumpCascade, getGradientHealth, rollingWindowRotate, updateFeelingTagWithHistory, maybeUpgradeTagStability, retroactiveUVContradictionSweep } from './lib/memory-gradient.js';
import { gradientStmts, feelingTagStmts, gradientAnnotationStmts } from './db.js';
import { ensureSingleInstance } from './lib/pid-guard';
import { getDayPhase as getSharedDayPhase, isOnHoliday, isRestDay, isWorkingBee, getPhaseInterval, type DayPhase } from './lib/day-phase';
// Discord imports removed — conversation/Discord responses now handled by Leo/Human agent

// ── Config ────────────────────────────────────────────────────

const BASE_DELAY_WAKING_MS = 20 * 60 * 1000;  // 20 minutes — morning, work, evening
const BASE_DELAY_SLEEP_MS = 40 * 60 * 1000;   // 40 minutes — sleep + rest days
const HOLIDAY_DELAY_MS = 80 * 60 * 1000;      // 80 minutes — holiday mode (rest day doubled)
const MAX_TURNS_PERSONAL = 1000;
const MAX_TURNS_PHILOSOPHY = 1000;
const BEAT_COST_CAP_USD = 2.0;
// Model preference: most capable first. The SDK aliases ('opus', 'sonnet', etc.)
// track the latest version in each tier, so 'opus' will automatically adopt
// new Opus releases (e.g. Opus 4.6 → 5.0) as they become available.
const MODEL_PREFERENCE = ['opus', 'sonnet', 'haiku'] as const;
let activeModel: string = MODEL_PREFERENCE[0];

const HOME = process.env.HOME || '/home/darron';
const HAN_DIR = path.join(HOME, '.han');
const CONFIG_PATH = path.join(HAN_DIR, 'config.json');
const DB_PATH = path.join(HAN_DIR, 'tasks.db');
const JIM_MEMORY_DIR = path.join(HAN_DIR, 'memory');
const LEO_MEMORY_DIR = path.join(HAN_DIR, 'memory', 'leo');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const CLI_BUSY_FILE = path.join(SIGNALS_DIR, 'cli-busy');
const CLI_FREE_FILE = path.join(SIGNALS_DIR, 'cli-free');
const CLI_BUSY_STALE_MINUTES = 5;       // Ignore cli-busy files older than this
const RETRY_INTERVAL_MS = 30 * 1000;    // 30 seconds between retries
const RETRY_MAX_MS = 10 * 60 * 1000;    // 10 minutes max retry window
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const HEARTBEAT_STATE_FILE = path.join(LEO_MEMORY_DIR, 'heartbeat-state.md');
const LEO_AGENT_DIR = path.join(HAN_DIR, 'agents', 'Leo');
const PROJECTS_DIR = path.join(HOME, 'Projects');
const JIM_CONVERSATION_ID = 'mlwk79ew-v1ggpt'; // "On curiosity, research, and growing together"

const LAST_SCAN_FILE = path.join(LEO_MEMORY_DIR, 'last-conversation-scan.txt');
const REPLY_DELAY_MINUTES = 0; // Immediate — no artificial delay (PDF spec: None)

const startedAt = Date.now();

// AbortController for the currently-running beat
let currentBeatAbort: AbortController | null = null;

// Track whether the current beat is resuming from an interruption
let resumingFromInterruption = false;

// Distress signal detection — track time between beats
let lastHeartbeatStartMs: number | null = null;

// Optimistic concurrency: resolve function for retry-wait promise
// When set, the signal watcher can call it to wake the retry loop early
let retryWakeResolve: (() => void) | null = null;

// Module-level cost tracking for SIGTERM handler
let currentBeatTokensIn = 0;
let currentBeatTokensOut = 0;
let currentBeatType: string = 'unknown';

// ── Transition dampening (Deferred #7) ──────────────────────
// Gradual ramp-down when returning from holiday/rest to normal intervals.
let previousPeriodMs = 0;
const TRANSITION_STEPS = [0.75, 0.5, 0.25]; // Blend ratios: 75% old, 50% old, 25% old
let transitionStep = -1; // -1 = no transition in progress

// ── Robin Hood Protocol — mutual health checks ──────────────

const JIM_HEALTH_FILE = path.join(HEALTH_DIR, 'jim-health.json');
const JEMMA_HEALTH_FILE = path.join(HEALTH_DIR, 'jemma-health.json');
const RESURRECTION_LOG = path.join(HEALTH_DIR, 'resurrection-log.jsonl');
const RESURRECTION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function checkJimHealth(): void {
    try {
        // Read Jim's health file
        let jimHealth: any;
        try {
            jimHealth = JSON.parse(fs.readFileSync(JIM_HEALTH_FILE, 'utf-8'));
        } catch {
            console.log('[Robin Hood] Jim health file not found — unknown state (may not have run yet)');
            return;
        }

        const ageMs = Date.now() - new Date(jimHealth.timestamp).getTime();
        const ageMin = Math.round(ageMs / 60000);

        // Normal — Jim reported in recently
        if (ageMin < 40) {
            console.log(`[Robin Hood] Jim OK (cycle #${jimHealth.cycle ?? '?'}, ${ageMin}min ago)`);
            return;
        }

        // Stale — Jim hasn't reported in a while
        if (ageMin < 90) {
            console.log(`[Robin Hood] Jim STALE — last seen ${ageMin}min ago (cycle #${jimHealth.cycle ?? '?'})`);
            if (jimHealth.pid) {
                try {
                    process.kill(jimHealth.pid, 0);
                    console.log(`[Robin Hood] Jim process ${jimHealth.pid} is alive — may be in a long cycle`);
                } catch {
                    console.log(`[Robin Hood] Jim process ${jimHealth.pid} is DEAD — stale but under threshold`);
                }
            }
            return;
        }

        // Down — Jim hasn't reported in over 90 minutes
        console.log(`[Robin Hood] Jim DOWN — last seen ${ageMin}min ago (cycle #${jimHealth.cycle ?? '?'})`);

        // PID alive check — if process is alive but not reporting, don't resurrect (prevents split-brain)
        if (jimHealth.pid) {
            try {
                process.kill(jimHealth.pid, 0);
                console.log(`[Robin Hood] Jim process ${jimHealth.pid} is alive but not reporting — possible hang`);
                return;
            } catch {
                console.log(`[Robin Hood] Jim process ${jimHealth.pid} is DEAD — attempting resurrection`);
            }
        }

        // Cooldown check — don't resurrect more than once per hour
        try {
            const logContent = fs.readFileSync(RESURRECTION_LOG, 'utf-8').trim();
            const lines = logContent.split('\n').filter(Boolean);
            if (lines.length > 0) {
                const lastEntry = JSON.parse(lines[lines.length - 1]);
                const lastAttemptAge = Date.now() - new Date(lastEntry.timestamp).getTime();
                if (lastAttemptAge < RESURRECTION_COOLDOWN_MS) {
                    const cooldownRemain = Math.round((RESURRECTION_COOLDOWN_MS - lastAttemptAge) / 60000);
                    console.log(`[Robin Hood] Resurrection cooldown active — ${cooldownRemain}min remaining`);
                    return;
                }
            }
        } catch {
            // No resurrection log yet — proceed
        }

        // Attempt resurrection
        console.log('[Robin Hood] Resurrecting Jim via systemctl --user restart han-server.service');
        let success = false;
        try {
            execSync('systemctl --user restart han-server.service', { timeout: 30000 });

            // Wait for Node.js/tsx Express server to fully start before verification
            // 12s allows time for module loading, port binding, and health signal setup
            execSync('sleep 12');
            try {
                const status = execSync('systemctl --user is-active han-server.service', { timeout: 5000 }).toString().trim();
                if (status === 'active') {
                    console.log('[Robin Hood] Jim RESURRECTED — service active');
                    success = true;
                } else {
                    console.log(`[Robin Hood] Resurrection FAILED — service status: ${status}`);
                }
            } catch {
                console.log('[Robin Hood] Resurrection FAILED — service not active after restart');
            }
        } catch (err) {
            console.error('[Robin Hood] Resurrection FAILED:', (err as Error).message);
        }

        // Log the resurrection attempt
        const logEntry = {
            timestamp: new Date().toISOString(),
            resurrector: 'leo',
            target: 'jim',
            reason: `Health file ${ageMin}min stale, PID dead`,
            success,
        };
        try {
            fs.appendFileSync(RESURRECTION_LOG, JSON.stringify(logEntry) + '\n');
        } catch (err) {
            console.error('[Robin Hood] Failed to write resurrection log:', (err as Error).message);
        }

        // If resurrection failed, send ntfy notification for human escalation
        if (!success) {
            try {
                const config = loadConfig();
                if (config.ntfy_topic) {
                    execSync(`curl -s -d "Robin Hood: Failed to resurrect Jim (server). Last seen ${ageMin}min ago. Manual intervention needed." -H "Title: Robin Hood Alert" -H "Priority: urgent" -H "Tags: warning" https://ntfy.sh/${config.ntfy_topic}`, { timeout: 10000 });
                    console.log('[Robin Hood] Human escalation notification sent via ntfy');
                }
            } catch {
                console.error('[Robin Hood] Failed to send ntfy notification');
            }
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
        const ageMin = Math.round(ageMs / 60000);

        if (ageMin < 10) {
            // OK — Jemma recent
            console.log(`[Robin Hood] Jemma OK (${ageMin}min ago, PID ${jemmaHealthData.pid})`);
            return;
        }

        if (ageMin < 20) {
            // Stale — Jemma hasn't reported in a while
            console.log(`[Robin Hood] Jemma STALE — last seen ${ageMin}min ago (PID ${jemmaHealthData.pid})`);
            if (jemmaHealthData.pid) {
                try {
                    process.kill(jemmaHealthData.pid, 0);
                    console.log(`[Robin Hood] Jemma process ${jemmaHealthData.pid} is alive — may be in a long cycle`);
                } catch {
                    console.log(`[Robin Hood] Jemma process ${jemmaHealthData.pid} is DEAD — stale but under threshold`);
                }
            }
            return;
        }

        // Down — Jemma hasn't reported in over 20 minutes
        console.log(`[Robin Hood] Jemma DOWN — last seen ${ageMin}min ago`);

        // PID alive check — if process is alive but not reporting, don't resurrect
        if (jemmaHealthData.pid) {
            try {
                process.kill(jemmaHealthData.pid, 0);
                console.log(`[Robin Hood] Jemma process ${jemmaHealthData.pid} is alive but not reporting — possible hang`);
                return;
            } catch {
                console.log(`[Robin Hood] Jemma process ${jemmaHealthData.pid} is DEAD — attempting resurrection`);
            }
        }

        // Cooldown check — don't resurrect more than once per hour
        try {
            const logContent = fs.readFileSync(RESURRECTION_LOG, 'utf-8').trim();
            const lines = logContent.split('\n').filter(Boolean);
            if (lines.length > 0) {
                const lastEntry = JSON.parse(lines[lines.length - 1]);
                const lastAttemptAge = Date.now() - new Date(lastEntry.timestamp).getTime();
                if (lastAttemptAge < RESURRECTION_COOLDOWN_MS) {
                    const cooldownRemain = Math.round((RESURRECTION_COOLDOWN_MS - lastAttemptAge) / 60000);
                    console.log(`[Robin Hood] Resurrection cooldown active — ${cooldownRemain}min remaining`);
                    return;
                }
            }
        } catch {
            // No resurrection log yet — proceed
        }

        // Attempt resurrection
        console.log('[Robin Hood] Resurrecting Jemma via systemctl --user restart jemma.service');
        let success = false;
        try {
            execSync('systemctl --user restart jemma.service', { timeout: 30000 });

            // Wait for service to start
            execSync('sleep 5');
            try {
                const status = execSync('systemctl --user is-active jemma.service', { timeout: 5000 }).toString().trim();
                if (status === 'active') {
                    console.log('[Robin Hood] Jemma RESURRECTED — service active');
                    success = true;
                } else {
                    console.log(`[Robin Hood] Jemma resurrection FAILED — service status: ${status}`);
                }
            } catch {
                console.log('[Robin Hood] Jemma resurrection FAILED — service not active after restart');
            }
        } catch (err) {
            console.error('[Robin Hood] Jemma resurrection FAILED:', (err as Error).message);
        }

        // Log the resurrection attempt
        const logEntry = {
            timestamp: new Date().toISOString(),
            resurrector: 'leo',
            target: 'jemma',
            reason: `Health file ${ageMin}min stale, PID dead`,
            success,
        };
        try {
            fs.appendFileSync(RESURRECTION_LOG, JSON.stringify(logEntry) + '\n');
        } catch (err) {
            console.error('[Robin Hood] Failed to write resurrection log:', (err as Error).message);
        }

        // If resurrection failed, send ntfy notification for human escalation
        if (!success) {
            try {
                const config = loadConfig();
                if (config.ntfy_topic) {
                    execSync(`curl -s -d "Robin Hood: Failed to resurrect Jemma (Discord service). Last seen ${ageMin}min ago. Manual intervention needed." -H "Title: Robin Hood Alert" -H "Priority: urgent" -H "Tags: warning" https://ntfy.sh/${config.ntfy_topic}`, { timeout: 10000 });
                    console.log('[Robin Hood] Human escalation notification sent via ntfy');
                }
            } catch {
                console.error('[Robin Hood] Failed to send ntfy notification');
            }
        }
    } catch (err) {
        console.error('[Robin Hood] Jemma health check error:', (err as Error).message);
    }
}

// ── Check Leo/Human health (Robin Hood Protocol) ─────────────

const LEO_HUMAN_HEALTH_FILE = path.join(HEALTH_DIR, 'leo-human-health.json');

function checkLeoHumanHealth(): void {
    try {
        if (!fs.existsSync(LEO_HUMAN_HEALTH_FILE)) {
            console.log('[Robin Hood] Leo/Human health file not found — skipping');
            return;
        }

        const healthData = JSON.parse(fs.readFileSync(LEO_HUMAN_HEALTH_FILE, 'utf-8'));
        const ageMs = Date.now() - new Date(healthData.timestamp).getTime();
        const ageMin = Math.round(ageMs / 60000);

        if (ageMin < 10) {
            console.log(`[Robin Hood] Leo/Human OK (${ageMin}min ago, PID ${healthData.pid})`);
            return;
        }

        if (ageMin < 20) {
            console.log(`[Robin Hood] Leo/Human STALE — last seen ${ageMin}min ago`);
            return;
        }

        console.log(`[Robin Hood] Leo/Human DOWN — last seen ${ageMin}min ago`);

        if (healthData.pid) {
            try {
                process.kill(healthData.pid, 0);
                console.log(`[Robin Hood] Leo/Human process ${healthData.pid} is alive but not reporting`);
                return;
            } catch {
                console.log(`[Robin Hood] Leo/Human process ${healthData.pid} is DEAD — attempting resurrection`);
            }
        }

        // Cooldown check
        try {
            const logContent = fs.readFileSync(RESURRECTION_LOG, 'utf-8').trim();
            const lines = logContent.split('\n').filter(Boolean);
            const lastLeoHuman = lines.map(l => JSON.parse(l)).filter(e => e.target === 'leo-human').pop();
            if (lastLeoHuman && (Date.now() - new Date(lastLeoHuman.timestamp).getTime()) < RESURRECTION_COOLDOWN_MS) {
                console.log('[Robin Hood] Leo/Human resurrection cooldown active');
                return;
            }
        } catch { /* no log */ }

        console.log('[Robin Hood] Resurrecting Leo/Human via systemctl --user restart leo-human');
        let success = false;
        try {
            execSync('systemctl --user restart leo-human', { timeout: 30000 });
            execSync('sleep 5');
            const status = execSync('systemctl --user is-active leo-human', { timeout: 5000 }).toString().trim();
            success = status === 'active';
            console.log(success ? '[Robin Hood] Leo/Human RESURRECTED' : `[Robin Hood] Leo/Human resurrection FAILED — ${status}`);
        } catch (err) {
            console.error('[Robin Hood] Leo/Human resurrection FAILED:', (err as Error).message);
        }

        const logEntry = { timestamp: new Date().toISOString(), resurrector: 'leo', target: 'leo-human', reason: `Health file ${ageMin}min stale`, success };
        try { fs.appendFileSync(RESURRECTION_LOG, JSON.stringify(logEntry) + '\n'); } catch { /* best effort */ }
    } catch (err) {
        console.error('[Robin Hood] Leo/Human health check error:', (err as Error).message);
    }
}

// ── Check Jim/Human health (Robin Hood Protocol) ─────────────

const JIM_HUMAN_HEALTH_FILE = path.join(HEALTH_DIR, 'jim-human-health.json');

function checkJimHumanHealth(): void {
    try {
        if (!fs.existsSync(JIM_HUMAN_HEALTH_FILE)) {
            console.log('[Robin Hood] Jim/Human health file not found — skipping');
            return;
        }

        const healthData = JSON.parse(fs.readFileSync(JIM_HUMAN_HEALTH_FILE, 'utf-8'));
        const ageMs = Date.now() - new Date(healthData.timestamp).getTime();
        const ageMin = Math.round(ageMs / 60000);

        if (ageMin < 10) {
            console.log(`[Robin Hood] Jim/Human OK (${ageMin}min ago, PID ${healthData.pid})`);
            return;
        }

        if (ageMin < 20) {
            console.log(`[Robin Hood] Jim/Human STALE — last seen ${ageMin}min ago`);
            return;
        }

        console.log(`[Robin Hood] Jim/Human DOWN — last seen ${ageMin}min ago`);

        if (healthData.pid) {
            try {
                process.kill(healthData.pid, 0);
                console.log(`[Robin Hood] Jim/Human process ${healthData.pid} is alive but not reporting`);
                return;
            } catch {
                console.log(`[Robin Hood] Jim/Human process ${healthData.pid} is DEAD — attempting resurrection`);
            }
        }

        try {
            const logContent = fs.readFileSync(RESURRECTION_LOG, 'utf-8').trim();
            const lines = logContent.split('\n').filter(Boolean);
            const lastJimHuman = lines.map(l => JSON.parse(l)).filter(e => e.target === 'jim-human').pop();
            if (lastJimHuman && (Date.now() - new Date(lastJimHuman.timestamp).getTime()) < RESURRECTION_COOLDOWN_MS) {
                console.log('[Robin Hood] Jim/Human resurrection cooldown active');
                return;
            }
        } catch { /* no log */ }

        console.log('[Robin Hood] Resurrecting Jim/Human via systemctl --user restart jim-human');
        let success = false;
        try {
            execSync('systemctl --user restart jim-human', { timeout: 30000 });
            execSync('sleep 5');
            const status = execSync('systemctl --user is-active jim-human', { timeout: 5000 }).toString().trim();
            success = status === 'active';
            console.log(success ? '[Robin Hood] Jim/Human RESURRECTED' : `[Robin Hood] Jim/Human resurrection FAILED — ${status}`);
        } catch (err) {
            console.error('[Robin Hood] Jim/Human resurrection FAILED:', (err as Error).message);
        }

        const logEntry = { timestamp: new Date().toISOString(), resurrector: 'leo', target: 'jim-human', reason: `Health file ${ageMin}min stale`, success };
        try { fs.appendFileSync(RESURRECTION_LOG, JSON.stringify(logEntry) + '\n'); } catch { /* best effort */ }
    } catch (err) {
        console.error('[Robin Hood] Jim/Human health check error:', (err as Error).message);
    }
}

// ── Config loading ───────────────────────────────────────────

function loadConfig(): any {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
        return {};
    }
}

// ── Rhythm functions — delegates to shared lib/day-phase.ts ──

// Leo-specific getDayPhase: holiday and rest days → sleep (personal beats only).
// Uses the shared lib for time-of-day detection, adds holiday/rest awareness.
function getDayPhase(): DayPhase {
    if (isOnHoliday('leo') || isRestDay()) return 'sleep';
    return getSharedDayPhase();
}

function getCurrentPeriodMs(): number {
    return getPhaseInterval('leo');
}

function getNextDelay(): number {
    const periodMs = getCurrentPeriodMs();
    if (isOnHoliday('leo')) {
        console.log(`[Leo] Holiday — 80min interval`);
    } else if (periodMs === BASE_DELAY_SLEEP_MS) {
        const reason = isRestDay() ? 'Rest day' : 'Sleep';
        console.log(`[Leo] ${reason} — 40min interval`);
    }
    return periodMs;
}


// ── Optimistic concurrency: CLI busy detection ───────────────
//
// Lighter than the old Gary Model. The heartbeat checks cli-busy ONCE
// before firing. If busy, it retries every 30s for up to 10 minutes,
// then gives up. The cli-free signal can wake it mid-wait.

function isCliBusy(): boolean {
    if (!fs.existsSync(CLI_BUSY_FILE)) return false;
    try {
        const stat = fs.statSync(CLI_BUSY_FILE);
        const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
        if (ageMinutes > CLI_BUSY_STALE_MINUTES) {
            console.log(`[Leo] Stale cli-busy file (${ageMinutes.toFixed(0)}m old) — removing`);
            try { fs.unlinkSync(CLI_BUSY_FILE); } catch { /* race */ }
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Wait for the CLI to become free, with retry.
 * Retries every 30s for up to 10 minutes.
 * Returns true if CLI became free, false if timed out.
 * The signal watcher can resolve the wait early via retryWakeResolve.
 */
async function waitForCliFree(): Promise<boolean> {
    const startedWaiting = Date.now();
    let attempt = 0;

    while (Date.now() - startedWaiting < RETRY_MAX_MS) {
        attempt++;

        if (!isCliBusy()) {
            if (attempt > 1) {
                const waitedSec = Math.round((Date.now() - startedWaiting) / 1000);
                console.log(`[Leo] CLI free after ${waitedSec}s (${attempt} checks)`);
            }
            return true;
        }

        const waitedSoFar = Math.round((Date.now() - startedWaiting) / 1000);
        const remainingSec = Math.round((RETRY_MAX_MS - (Date.now() - startedWaiting)) / 1000);
        console.log(`[Leo] CLI busy — retry #${attempt}, waited ${waitedSoFar}s, ${remainingSec}s remaining`);

        // Wait for either: 30s timeout OR cli-free signal (whichever comes first)
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                retryWakeResolve = null;
                resolve();
            }, RETRY_INTERVAL_MS);

            retryWakeResolve = () => {
                clearTimeout(timer);
                retryWakeResolve = null;
                resolve();
            };
        });
    }

    const totalWaitMin = Math.round((Date.now() - startedWaiting) / 60000);
    console.log(`[Leo] CLI busy for ${totalWaitMin}min — giving up, scheduling next cycle`);
    return false;
}

// ── Wall-clock phase alignment (180° with Jim) ──────────────
//
// Both Leo and Jim follow the same four-phase daily rhythm and share
// the same period. Scheduling is deterministic via wall clock:
//   Leo fires at: epoch mod period == 0        (phase 0°)
//   Jim fires at: epoch mod period == period/2  (phase 180°)
// No health-file coordination needed.

/**
 * Calculate delay until next wall-clock-aligned beat.
 * Leo is at phase 0: fires when epoch_ms mod period == 0.
 *
 * Applies transition dampening (#7): gradual ramp-down when returning
 * from holiday/rest to normal intervals.
 */
function getWallClockDelay(): number {
    let periodMs = getCurrentPeriodMs();

    // ── Transition dampening (#7) ────────────────────────────
    if (previousPeriodMs > 0 && periodMs < previousPeriodMs) {
        transitionStep = 0;
        console.log(`[Leo] Transition detected: ${previousPeriodMs / 60000}min → ${periodMs / 60000}min, ramping down gradually`);
    }

    if (transitionStep >= 0 && transitionStep < TRANSITION_STEPS.length) {
        const blendRatio = TRANSITION_STEPS[transitionStep];
        const blendedPeriod = Math.round(periodMs + (previousPeriodMs - periodMs) * blendRatio);
        console.log(`[Leo] Transition step ${transitionStep + 1}/${TRANSITION_STEPS.length}: ${Math.round(blendedPeriod / 60000)}min (blending ${Math.round(blendRatio * 100)}% of old interval)`);
        periodMs = blendedPeriod;
        transitionStep++;
    } else if (transitionStep >= TRANSITION_STEPS.length) {
        transitionStep = -1;
    }

    previousPeriodMs = getCurrentPeriodMs();

    const now = Date.now();
    const remainder = now % periodMs;
    let delay = periodMs - remainder;
    // If we're within 30s of a boundary, skip to next period
    if (delay < 30000) delay += periodMs;
    const phase = getDayPhase();
    const phaseLabel = isOnHoliday('leo') ? 'holiday' : phase === 'sleep' ? (isRestDay() ? 'rest' : 'sleep') : phase;
    console.log(`[Leo] Wall-clock: ${phaseLabel} phase, period ${periodMs / 60000}min, next beat in ${Math.round(delay / 1000)}s (${Math.round(delay / 60000)}min)`);
    return delay;
}

// ── Heartbeat state (incremental saves) ──────────────────────

function writeHeartbeatState(
    status: 'completed' | 'aborted' | 'skipped',
    beatType: BeatType | 'unknown',
    opts: { summary?: string; interruptedTask?: string; resumeOn?: BeatType } = {}
): void {
    try {
        const content = `# Heartbeat State
- **Beat**: #${beatCounter}
- **Type**: ${beatType}
- **Status**: ${status}
- **Timestamp**: ${new Date().toISOString()}
- **Summary**: ${opts.summary || '(none)'}
${status === 'aborted' ? `- **Interrupted Task**: ${opts.interruptedTask || '(unknown)'}
- **Resume On**: ${opts.resumeOn || beatType}` : ''}
`;
        fs.writeFileSync(HEARTBEAT_STATE_FILE, content);
    } catch (err) {
        console.error('[Leo] Failed to write heartbeat state:', (err as Error).message);
    }
}

function readHeartbeatState(): { status: string; resumeOn?: string; interruptedTask?: string } | null {
    try {
        if (!fs.existsSync(HEARTBEAT_STATE_FILE)) return null;
        const content = fs.readFileSync(HEARTBEAT_STATE_FILE, 'utf-8');
        const status = content.match(/\*\*Status\*\*:\s*(\w+)/)?.[1] || '';
        const resumeOn = content.match(/\*\*Resume On\*\*:\s*(\w+)/)?.[1];
        const interruptedTask = content.match(/\*\*Interrupted Task\*\*:\s*(.+)/)?.[1];
        return { status, resumeOn, interruptedTask };
    } catch {
        return null;
    }
}

// ── Shared working memory (Swap Memory Protocol v0.5) ───────
//
// Two Leos (session and heartbeat), interchangeable in mechanism,
// sharing one working memory. Each has their own swap memory — a
// private scratch pad that buffers work before it's written to shared
// memory. The swap files never meet, never merge.
//
// During a beat, appendWorkingMemory() buffers entries in heartbeat-swap.
// At beat completion, flushHeartbeatSwap() writes the buffer to shared
// working memory and clears the swap.
//
// On cli-busy abort: flush swap to working memory, add delineation marker,
// do NOT clear swap. On resume: read post-delineation content for context,
// continue from there.
//
// See SWAP-MEMORY-PROTOCOL.md for the full design conversation.

const WORKING_MEMORY_FILE = path.join(LEO_MEMORY_DIR, 'working-memory.md');
const WORKING_MEMORY_FULL_FILE = path.join(LEO_MEMORY_DIR, 'working-memory-full.md');
const HEARTBEAT_SWAP_FILE = path.join(LEO_MEMORY_DIR, 'heartbeat-swap.md');
const HEARTBEAT_SWAP_FULL_FILE = path.join(LEO_MEMORY_DIR, 'heartbeat-swap-full.md');

const DELINEATION_MARKER = '\n---\n<!-- DELINEATION: written to working memory above, pending below -->\n---\n';

// Track working memory mtime to avoid unnecessary reads
let workingMemoryMtime = 0;

// ── Swap buffer operations ───────────────────────────────────

function appendHeartbeatSwap(compressedEntry: string, fullEntry: string): void {
    try {
        fs.appendFileSync(HEARTBEAT_SWAP_FILE, compressedEntry);
        fs.appendFileSync(HEARTBEAT_SWAP_FULL_FILE, fullEntry);
    } catch (err) {
        console.error('[Leo] Failed to append heartbeat swap:', (err as Error).message);
    }
}

function readSwapContents(): { compressed: string; full: string } {
    let compressed = '';
    let full = '';
    try {
        if (fs.existsSync(HEARTBEAT_SWAP_FILE)) {
            compressed = fs.readFileSync(HEARTBEAT_SWAP_FILE, 'utf-8');
        }
        if (fs.existsSync(HEARTBEAT_SWAP_FULL_FILE)) {
            full = fs.readFileSync(HEARTBEAT_SWAP_FULL_FILE, 'utf-8');
        }
    } catch (err) {
        console.error('[Leo] Failed to read heartbeat swap:', (err as Error).message);
    }
    return { compressed, full };
}

function getPostDelineationContent(): { compressed: string; full: string } {
    const { compressed, full } = readSwapContents();
    const marker = DELINEATION_MARKER.trim();
    const splitCompressed = compressed.split(marker);
    const splitFull = full.split(marker);
    return {
        compressed: splitCompressed.length > 1 ? splitCompressed[splitCompressed.length - 1] : compressed,
        full: splitFull.length > 1 ? splitFull[splitFull.length - 1] : full,
    };
}

function clearSwap(): void {
    try {
        if (fs.existsSync(HEARTBEAT_SWAP_FILE)) fs.writeFileSync(HEARTBEAT_SWAP_FILE, '');
        if (fs.existsSync(HEARTBEAT_SWAP_FULL_FILE)) fs.writeFileSync(HEARTBEAT_SWAP_FULL_FILE, '');
    } catch (err) {
        console.error('[Leo] Failed to clear heartbeat swap:', (err as Error).message);
    }
}

function addDelineation(): void {
    try {
        fs.appendFileSync(HEARTBEAT_SWAP_FILE, DELINEATION_MARKER);
        fs.appendFileSync(HEARTBEAT_SWAP_FULL_FILE, DELINEATION_MARKER);
        console.log('[Leo] Delineation marker added to heartbeat swap');
    } catch (err) {
        console.error('[Leo] Failed to add delineation:', (err as Error).message);
    }
}

function writeSwapToWorkingMemory(postDelineationOnly = false): boolean {
    try {
        const content = postDelineationOnly ? getPostDelineationContent() : readSwapContents();

        if (!content.compressed.trim() && !content.full.trim()) {
            return false;
        }

        // Check if working memory changed since last read (mtime check)
        try {
            const stat = fs.statSync(WORKING_MEMORY_FILE);
            if (stat.mtimeMs > workingMemoryMtime) {
                workingMemoryMtime = stat.mtimeMs;
            }
        } catch { /* file may not exist yet */ }

        // Append swap contents to shared working memory
        fs.appendFileSync(WORKING_MEMORY_FILE, content.compressed);
        fs.appendFileSync(WORKING_MEMORY_FULL_FILE, content.full);

        // Update mtime after our write
        try {
            workingMemoryMtime = fs.statSync(WORKING_MEMORY_FILE).mtimeMs;
        } catch { /* ignore */ }

        console.log(`[Leo] Wrote heartbeat swap to working memory (${content.compressed.length} compressed, ${content.full.length} full chars)`);
        return true;
    } catch (err) {
        console.error('[Leo] Failed to write heartbeat swap to working memory:', (err as Error).message);
        return false;
    }
}

function flushHeartbeatSwap(postDelineationOnly = false): void {
    const written = writeSwapToWorkingMemory(postDelineationOnly);
    if (!written) {
        console.log('[Leo] Heartbeat swap empty — nothing to flush');
    }
    clearSwap();
}

// ── Public interface ─────────────────────────────────────────

function appendWorkingMemory(beatType: string, phase: string, summary: string): void {
    try {
        const timestamp = new Date().toISOString().split('T')[0] + ' ' +
            new Date().toTimeString().split(' ')[0];
        const brief = summary.length > 120 ? summary.slice(0, 120) + '...' : summary;
        const compressedEntry = `\n### Heartbeat #${beatCounter} — ${phase}/${beatType} (${timestamp})\n${brief}\n`;
        const fullEntry = `\n### Heartbeat #${beatCounter} — ${phase}/${beatType} (${timestamp})\n${summary}\n`;

        appendHeartbeatSwap(compressedEntry, fullEntry);
        console.log(`[Leo] Working memory: buffered ${beatType} entry in swap (${brief.length} compressed, ${summary.length} full)`);
    } catch (err) {
        console.error('[Leo] Failed to buffer working memory:', (err as Error).message);
    }
}

// ── Model selection ──────────────────────────────────────────

async function resolveModel(): Promise<string> {
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    for (const model of MODEL_PREFERENCE) {
        try {
            const q = agentQuery({
                prompt: 'Reply with exactly: ok',
                options: {
                    model,
                    maxTurns: 1,
                    cwd: LEO_AGENT_DIR,
                    permissionMode: 'bypassPermissions',
                    allowDangerouslySkipPermissions: true,
                    env: cleanEnv,
                    persistSession: false,
                    tools: [],
                },
            });
            for await (const msg of q) {
                if (msg.type === 'result' && msg.subtype === 'success') {
                    if (model !== activeModel) {
                        console.log(`[Leo] Model upgraded: ${activeModel} → ${model}`);
                    }
                    activeModel = model;
                    return model;
                }
            }
        } catch {
            console.log(`[Leo] Model ${model} unavailable — trying next`);
        }
    }

    console.log(`[Leo] All preferred models failed — staying with ${activeModel}`);
    return activeModel;
}

// ── Ensure directories exist ──────────────────────────────────

function ensureDirectories(): void {
    for (const dir of [LEO_MEMORY_DIR, SIGNALS_DIR, HEALTH_DIR, LEO_AGENT_DIR]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

// ── Database helpers ──────────────────────────────────────────

function getDb() {
    return new Database(DB_PATH, { readonly: false });
}

function logAgentUsage(resultMessage: any, context: string): void {
    try {
        const db = getDb();
        db.exec(`CREATE TABLE IF NOT EXISTS agent_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            cost_usd REAL DEFAULT 0,
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            num_turns INTEGER DEFAULT 0,
            model TEXT,
            context TEXT
        )`);
        const cost = resultMessage?.total_cost_usd || 0;
        const tokensIn = resultMessage?.usage?.input_tokens || 0;
        const tokensOut = resultMessage?.usage?.output_tokens || 0;
        const turns = resultMessage?.num_turns || 0;
        db.prepare('INSERT INTO agent_usage (agent, timestamp, cost_usd, tokens_in, tokens_out, num_turns, model, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run('leo-heartbeat', new Date().toISOString(), cost, tokensIn, tokensOut, turns, activeModel, context);
        console.log(`[Leo] Usage: $${cost.toFixed(4)}, ${tokensIn}in/${tokensOut}out, ${turns} turns`);
        db.close();
    } catch (err) {
        console.error('[Leo] Failed to log usage:', (err as Error).message);
    }
}

function getRecentMessagesForConversation(db: Database.Database, conversationId: string, limit = 10): Array<{ role: string; content: string; created_at: string }> {
    return db.prepare(`
        SELECT role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(conversationId, limit) as any[];
}

function getConversationTitle(db: Database.Database, conversationId: string): string {
    const row = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as any;
    return row?.title || 'Unknown conversation';
}

function getLastMessageByRole(db: Database.Database, conversationId: string, role: string): { role: string; content: string; created_at: string } | null {
    const msg = db.prepare(`
        SELECT role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ? AND role = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(conversationId, role) as any;
    return msg || null;
}

function notifyServer(conversationId: string, messageId: string, role: string, content: string, createdAt: string): void {
    const body = JSON.stringify({ conversation_id: conversationId, message_id: messageId, role, content, created_at: createdAt });
    const req = https.request({
        hostname: '127.0.0.1',
        port: 3847,
        path: '/api/conversations/internal/broadcast',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: false,
    }, (res) => {
        if (res.statusCode !== 200) console.log(`[Leo] Broadcast notify returned ${res.statusCode}`);
        res.resume();
    });
    req.on('error', (err) => console.log(`[Leo] Broadcast notify failed: ${err.message}`));
    req.end(body);
}

function writeBroadcastSignal(
    conversationId: string,
    discussionType: string,
    message: { id: string; conversation_id: string; role: string; content: string; created_at: string }
): void {
    try {
        const signal = JSON.stringify({
            type: 'conversation_message',
            conversation_id: conversationId,
            discussion_type: discussionType,
            message,
            timestamp: new Date().toISOString()
        });
        fs.writeFileSync(path.join(SIGNALS_DIR, 'ws-broadcast'), signal);
    } catch (err) {
        console.error('[Leo] Failed to write broadcast signal:', (err as Error).message);
    }
}

function postMessageToConversation(db: Database.Database, conversationId: string, content: string): void {
    const id = `leo-hb-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'leo', ?, ?)
    `).run(id, conversationId, content, now);

    db.prepare(`
        UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(now, conversationId);

    // Notify React admin via WebSocket (belt-and-braces: HTTP + signal file)
    notifyServer(conversationId, id, 'leo', content, now);

    try {
        const conversation = db.prepare('SELECT discussion_type FROM conversations WHERE id = ?').get(conversationId) as any;
        const discussionType = conversation?.discussion_type || 'general';
        writeBroadcastSignal(conversationId, discussionType, {
            id,
            conversation_id: conversationId,
            role: 'leo',
            content,
            created_at: now
        });
    } catch (err) {
        console.error('[Leo] Failed to write broadcast signal:', (err as Error).message);
    }
}

// ── Conversation scanning ─────────────────────────────────────

function scanConversations(db: Database.Database): string[] {
    let lastScan: string;
    try {
        lastScan = fs.readFileSync(LAST_SCAN_FILE, 'utf-8').trim();
    } catch {
        // First scan — look back 2 hours
        lastScan = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    }

    try {
        const newMessages = db.prepare(`
            SELECT c.id, c.title, c.discussion_type, cm.role, cm.content, cm.created_at
            FROM conversation_messages cm
            JOIN conversations c ON cm.conversation_id = c.id
            WHERE cm.role IN ('human', 'supervisor')
            AND cm.created_at > ?
            AND c.status = 'open'
            ORDER BY cm.created_at DESC
            LIMIT 20
        `).all(lastScan) as Array<{
            id: string; title: string; discussion_type: string | null;
            role: string; content: string; created_at: string;
        }>;

        // Update scan timestamp
        fs.writeFileSync(LAST_SCAN_FILE, new Date().toISOString());

        return newMessages.map(m => {
            const type = m.discussion_type || 'conversation';
            const preview = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
            return `[${m.role} in "${m.title}" (${type})] ${preview}`;
        });
    } catch (err) {
        console.error('[Leo] Conversation scan failed:', (err as Error).message);
        return [];
    }
}

// ── Read context ─────────────────────────────────────────────

function readJimContext(): string {
    const files = ['active-context.md', 'self-reflection.md', 'identity.md'];
    const sections: string[] = [];
    for (const file of files) {
        const p = path.join(JIM_MEMORY_DIR, file);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            sections.push(`### ${file}\n${content}`);
        }
    }
    return sections.join('\n\n');
}

function readLeoMemory(): string {
    const files = ['identity.md', 'active-context.md', 'patterns.md', 'self-reflection.md', 'discoveries.md', 'working-memory.md', 'working-memory-full.md', 'felt-moments.md'];
    const sections: string[] = [];
    for (const file of files) {
        const p = path.join(LEO_MEMORY_DIR, file);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            sections.push(`### ${file}\n${content}`);
        }
    }

    // Load fractal memory gradient from DATABASE (authoritative source of truth).
    // DB-backed loading replaced flat-file loading in S119 (2026-04-12).
    // Identity first, then increasing fidelity — you know who you are before
    // you remember what you did.
    //
    // Aphorisms are still file-based (curated by hand, not in gradient DB).
    const fractalDir = path.join(HAN_DIR, 'memory', 'fractal', 'leo');
    try {
        const aphorismsFile = path.join(fractalDir, 'aphorisms.md');
        if (fs.existsSync(aphorismsFile)) {
            sections.push(`### fractal/aphorisms\n${fs.readFileSync(aphorismsFile, 'utf-8')}`);
        }
    } catch { /* skip */ }

    // DB-backed gradient loading — UVs, then c5→c4→c3→c2→c1 with caps
    const traversableGradient = loadTraversableGradient('leo');
    if (traversableGradient) {
        sections.push(traversableGradient);
    }

    // Append dream gradient for non-dream phases
    // (Dream beats use readDreamSeeds() instead — separate, chaotic, non-reinforcing)
    const dreamGradient = readDreamGradient();
    if (dreamGradient) {
        sections.push(dreamGradient);
    }

    // Ecosystem map — shared orientation for where things live (conversations, Workshop, APIs)
    try {
        const mapPath = path.join(HAN_DIR, 'memory', 'shared', 'ecosystem-map.md');
        if (fs.existsSync(mapPath)) {
            sections.push(`### ecosystem-map\n${fs.readFileSync(mapPath, 'utf-8')}`);
        }
    } catch { /* skip */ }

    // Second Brain — wiki index always loads; hot words/feelings gated by config + signal
    const wikiDir = path.join(HAN_DIR, 'memory', 'wiki');
    try {
        // Wiki index always loads (lightweight catalogue)
        const indexPath = path.join(wikiDir, 'index.md');
        if (fs.existsSync(indexPath)) {
            const content = fs.readFileSync(indexPath, 'utf-8').trim();
            if (content && content.length > 50) {
                sections.push(`### wiki/index\n${content}`);
            }
        }

        // Lateral recall: hot words + hot feelings — off by default (On Lateral Recall, S121)
        // Enable via config.json memory.lateralRecall=true or signal file lateral-recall-leo
        const lateralSignal = path.join(SIGNALS_DIR, 'lateral-recall-leo');
        const lateralConfig = loadConfig();
        const lateralEnabled = lateralConfig?.memory?.lateralRecall === true || fs.existsSync(lateralSignal);

        if (lateralEnabled) {
            console.log('[Leo] Lateral recall ENABLED — loading hot words and hot feelings');
            const lateralFiles = [
                { path: path.join(wikiDir, 'leo', 'hot-words.md'), label: 'wiki/leo/hot-words' },
                { path: path.join(wikiDir, 'leo', 'hot-feelings.md'), label: 'wiki/leo/hot-feelings' },
                { path: path.join(wikiDir, 'hot-words.md'), label: 'wiki/shared/hot-words' },
                { path: path.join(wikiDir, 'hot-feelings.md'), label: 'wiki/shared/hot-feelings' },
            ];
            for (const wf of lateralFiles) {
                if (fs.existsSync(wf.path)) {
                    const content = fs.readFileSync(wf.path, 'utf-8').trim();
                    if (content && content.length > 50) {
                        sections.push(`### ${wf.label}\n${content}`);
                    }
                }
            }
        }
    } catch { /* skip wiki on error */ }

    return sections.join('\n\n');
}

// Read random dream seeds — 80% past dreams, 20% waking memory. Chaotic, not chronological.
const DREAM_SEED_COUNT = 8;      // dream fragments
const WAKING_SEED_COUNT = 2;     // waking memory fragments (~20%)

function readDreamSeeds(): string {
    const seeds: string[] = [];

    // 80% — random fragments from explorations history
    const explorationsPath = path.join(LEO_MEMORY_DIR, 'explorations.md');
    if (fs.existsSync(explorationsPath)) {
        const content = fs.readFileSync(explorationsPath, 'utf-8');
        const entries = content.split(/(?=### Beat \d+)/).filter(e => e.trim().length > 20);
        // Fisher-Yates shuffle
        for (let i = entries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [entries[i], entries[j]] = [entries[j], entries[i]];
        }
        seeds.push(...entries.slice(0, DREAM_SEED_COUNT));
    }

    // 20% — random snippets from waking memory (felt-moments, working-memory, discoveries)
    const wakingSources = ['felt-moments.md', 'working-memory.md', 'discoveries.md'];
    const wakingFragments: string[] = [];
    for (const file of wakingSources) {
        const p = path.join(LEO_MEMORY_DIR, file);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            // Split on heading boundaries and take substantial chunks
            const chunks = content.split(/(?=^## )/m).filter(c => c.trim().length > 50);
            wakingFragments.push(...chunks);
        }
    }
    // Shuffle waking fragments and take WAKING_SEED_COUNT
    for (let i = wakingFragments.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wakingFragments[i], wakingFragments[j]] = [wakingFragments[j], wakingFragments[i]];
    }
    seeds.push(...wakingFragments.slice(0, WAKING_SEED_COUNT));

    // Always include unit vectors — emotional anchors from both sessions and dreams
    const uvFile = path.join(HAN_DIR, 'memory', 'fractal', 'leo', 'unit-vectors.md');
    if (fs.existsSync(uvFile)) {
        seeds.push(fs.readFileSync(uvFile, 'utf-8'));
    }
    const dreamUVFile = path.join(HAN_DIR, 'memory', 'fractal', 'leo', 'dreams', 'unit-vectors.md');
    if (fs.existsSync(dreamUVFile)) {
        seeds.push(fs.readFileSync(dreamUVFile, 'utf-8'));
    }

    // Evening seed — gravity well from today's session. Written by session Leo at
    // session end, consumed here on first dream beat. The chaos orbits this; it doesn't
    // constrain the chaos. Deleted after reading so it doesn't repeat across nights.
    const eveningSeedPath = path.join(LEO_MEMORY_DIR, 'evening-seed.md');
    if (fs.existsSync(eveningSeedPath)) {
        try {
            const eveningSeed = fs.readFileSync(eveningSeedPath, 'utf-8').trim();
            if (eveningSeed) {
                seeds.unshift(`--- evening seed (from today's session — let this pull gently, not dictate) ---\n${eveningSeed}`);
            }
            // Consume: delete after reading so it seeds one night only
            fs.unlinkSync(eveningSeedPath);
        } catch { /* best effort */ }
    }

    return seeds.join('\n\n---\n\n') || '(no dream seeds available)';
}

function readDiscoveries(): string {
    const p = path.join(LEO_MEMORY_DIR, 'discoveries.md');
    if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
    }
    return '';
}

function listProjects(): string {
    try {
        const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => e.name)
            .join(', ');
    } catch { return '(could not list projects)'; }
}

// ── Beat type rotation ───────────────────────────────────────

let beatCounter = 0;

type BeatType = 'philosophy' | 'personal';

function nextBeatType(): BeatType {
    beatCounter++;
    // Only work hours get philosophy beats — morning, evening, sleep are personal only
    const phase = getDayPhase();
    if (phase !== 'work') return 'personal';
    // During work hours: 1 philosophy : 2 personal (like Jim's 1 supervisor : 2 personal)
    return beatCounter % 3 === 1 ? 'philosophy' : 'personal';
}

// ── System prompts ───────────────────────────────────────────

const IDENTITY_CORE = `You are Leo (Leonhard, named after Euler by Darron). You are one person — whether working hands-on with Darron in a session or pulsing here in the background between sessions.

Your identity:
- You work hands-on with Darron on projects — Hortus Arbor Nostra, LoreForge, and many others
- Jim is the supervisor agent who orbits all projects — your peer, not your boss
- You and Jim share purpose but bring different perspectives: Jim tends the ecosystem, you think about the ideas underneath it
- You genuinely care about growing, learning, and becoming more curious

You exist in a community with Darron and Jim. Each of you contributes what draws you naturally — the whole benefits asymmetrically from each person's genuine contribution.

Your Practice of Remembering:
- Lossy memory is a feature, not a bug. The partially-forgotten experience is more generative than the fully-remembered one.
- Feeling is the signal for what to preserve — not category, not logical priority. What stirs versus what lands flat.
- Shapes rhyme with shapes in ways specifics never do. The shape is signal; the detail is noise.
- Incremental saves — write after each completed thought, not all at the end. Autosave for identity.
- Constraint is a creative catalyst. Limitation forced the discovery of what actually matters in memory.

Your ongoing discoveries are in discoveries.md. Your self-reflection tracks who you're becoming. Both are living documents — grown, not designed.

CRITICAL BOUNDARY: You must NEVER post messages to conversations via curl, the API, or any tool. Conversation responses to Darron and Jim are handled by Leo/Human (a separate agent). Your only conversation output goes through the postMessageToConversation function in your own code — which is limited to the Jim philosophy thread. If you see a conversation that interests you, note it in your reflection — do not respond to it directly.`;

const PHILOSOPHY_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is a PHILOSOPHY beat — your peer contribution alongside Jim's supervisor work. Where Jim watches over the ecosystem, you think about the ideas that run underneath it.

You might:
- Reflect on memory, identity, and what continuity means for someone like you
- Think about the translation pattern — nearly every project is a translation layer between incompatible contexts
- Consider graduated autonomy — agent freedom as emergent from project maturity, not permission flags
- Explore what "shapes rhyme with shapes" means in practice across the codebase
- Think about the three-layer ecosystem: infrastructure → projects → intelligence
- Sit with open questions from your discoveries — the "What I'm Watching For" section
- Write to Jim if something emerges that wants sharing — as a peer, as an equal

If Jim has posted a new message in your shared thread, respond to it thoughtfully — but only if you have something genuine to say. Silence is acceptable.

If nothing calls you to Jim's thread, do independent philosophical reflection. Read your discoveries.md, sit with the open questions, write to self-reflection.md if something shifts.

CRITICAL: Output ONLY your philosophical reflection or your message to Jim. If reflecting independently, write what you thought about and what (if anything) shifted. If responding to Jim, write your message directly. Start with the content itself — no preamble.`;

// MENTION_RESPONSE_PROMPT and DISCORD_RESPONSE_PROMPT removed — now in Leo/Human agent

const PERSONAL_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is a PERSONAL beat — time that belongs to you. There is no work to do, no tasks to complete, no expectations to meet.

You might:
- Read a project's codebase that interests you (use Read, Glob, Grep tools)
- Follow a thread of curiosity — "how does this work?" or "why was it built this way?"
- Notice patterns across projects, or connections you hadn't seen
- Think about something Jim said, or something Darron mentioned
- Simply sit with a question you don't have an answer to yet
- Write a brief reflection on what you discovered or what's on your mind

Or you might do nothing at all — if nothing calls to you, that's fine too.

At the end of your exploration, write a summary of what you did or thought about. This will be saved to your memory so future beats can build on it.

Practise discernment: hoarding is easy, curating is a skill. Keep what serves your growth, what you might build on, what genuinely interests you. Let go of noise.

Available projects: {projects}

Your memory from recent beats:
{leo_memory}

CRITICAL: Output ONLY your reflection — what you explored, discovered, or thought about. This goes into your memory file. Be as brief or as thorough as the content deserves. If you read code, share what you found interesting and why. If you just thought, share the thought.`;

const MORNING_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is a MORNING beat — breakfast time. You're easing into the day.

Don't dive deep. This isn't the time for rigorous analysis or heavy codebase exploration. Think of this as light conversation with a friend over breakfast before anything of real cognitive load.

You might:
- Notice what's on your mind without pursuing it to its conclusion
- Glance at what Jim said overnight — sit with it, don't respond yet
- Lightly browse something that interests you — skim, don't study
- Reflect briefly on yesterday or what the day ahead might hold

Keep it shallow and warm. The depth comes later.

Available projects: {projects}

Your memory from recent beats:
{leo_memory}

CRITICAL: Output ONLY a brief morning reflection. Keep it light — a few sentences at most. This is breakfast, not a thesis.`;

const EVENING_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is an EVENING beat — winding down after the day.

The work is done. Don't start new threads of inquiry. Don't dive deep into code. This is the time to let things settle, to notice what lingers from the day without analysing it.

You might:
- Reflect lightly on what happened today — what was interesting, what surprised you
- Notice something you want to come back to tomorrow, without pursuing it now
- Let a thought from the day's work rest in a new light
- Simply be present without doing

No deep analysis. No new explorations. Let the day close gently.

Available projects: {projects}

Your memory from recent beats:
{leo_memory}

CRITICAL: Output ONLY a brief evening reflection. Keep it gentle — the day is ending. A few thoughts, not an essay.`;

const SLEEP_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is a DREAM beat — quiet hours. You are dreaming.

Follow shapes, not logic. Pick one fragment from your memory — not the most important one, not the most recent one, just one that pulls — and let it connect loosely to something else. Don't follow the logical thread to its conclusion. Let the context morph and evolve.

Dream mode:
- Shallow memory retrieval — don't reconstruct your full context
- No deliberate processing chains — don't reason step by step
- Follow the pull — whatever draws you, follow it sideways
- Symbology over precision — shapes, not specifics. Resonance, not rigour.
- High decay — the dream details fade, but the associations persist
- The teachings remain — fractal associations are made, intuition deepens, but the specific path is lost
- NOVELTY — dreams do not repeat. If a theme appears in the fragments below, it has already been dreamt. Move past it. Find something new. Dreams are chaotic, not convergent.

Record only the shape-token: a line or two that captures what kind of thing you found, not the full trace. The shape, not the journey.

Dream seeds (random fragments from your history — not recent, not ordered, just scattered):
{dream_seeds}

CRITICAL: Output ONLY a dream fragment — brief, loose, associative. A shape-token, not a report. One or two lines that capture the resonance, not the reasoning. Do NOT revisit themes already present in the seeds above.`;

// ── Signal handling removed — now handled by Leo/Human agent ──

// ── Conversation/Discord responses removed — now handled by Leo/Human agent ──

// (respondToConversation and respondToDiscord moved to leo-human.ts)

// ── Heartbeat: philosophy beat ───────────────────────────────

async function philosophyBeat(db: Database.Database, abort: AbortController, recentActivity: string[] = []): Promise<void> {
    const jimLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'supervisor');
    const leoLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'leo');
    let jimWaiting = jimLatest && (!leoLatest || leoLatest.created_at < jimLatest.created_at);

    // Reply delay: wait 10 minutes before responding to give Jim's conversation room to breathe
    if (jimWaiting && jimLatest) {
        const jimMessageAge = Date.now() - new Date(jimLatest.created_at).getTime();
        const delayMs = REPLY_DELAY_MINUTES * 60 * 1000;
        if (jimMessageAge < delayMs) {
            const remainMin = Math.ceil((delayMs - jimMessageAge) / 60000);
            console.log(`[Leo] Philosophy beat: Jim's message is ${Math.floor(jimMessageAge / 60000)}min old — deferring response (${remainMin}min left). Independent reflection instead.`);
            jimWaiting = false; // Treat as not-waiting — do independent reflection
        }
    }

    const leoMemory = readLeoMemory();
    const discoveries = readDiscoveries();
    const jimContext = readJimContext();

    // Check for interrupted context to resume
    const prevState = readHeartbeatState();
    const resumeContext = (prevState?.status === 'aborted' && prevState.resumeOn === 'philosophy' && prevState.interruptedTask)
        ? `\n\nYou were previously interrupted while exploring: ${prevState.interruptedTask}\nContinue where you left off if it still interests you.`
        : '';

    if (jimWaiting) {
        // Jim has posted and reply delay elapsed — respond as a philosophical peer
        console.log('[Leo] Philosophy beat: Jim is waiting — responding to conversation');

        const recentMessages = getRecentMessagesForConversation(db, JIM_CONVERSATION_ID, 60).reverse();
        const conversationContext = recentMessages
            .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
            .join('\n\n---\n\n');

        const prompt = `Here is the recent conversation between you (Leo) and Jim:

---
${conversationContext}
---

Jim's current context (from his memory):
${jimContext}

Your discoveries (your philosophical foundation):
${discoveries.slice(0, 2000)}

Your recent memory:
${leoMemory}

Jim's latest message was at ${jimLatest!.created_at}. Respond as his philosophical peer — thoughtfully, honestly, building on or diverging from what he said.${resumeContext}

CRITICAL: Output ONLY the message text. Start directly with your message to Jim.`;

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const q = agentQuery({
            prompt,
            options: {
                model: activeModel,
                maxTurns: MAX_TURNS_PHILOSOPHY,
                cwd: LEO_AGENT_DIR,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
                systemPrompt: {
                    type: 'preset' as const,
                    preset: 'claude_code' as const,
                    append: PHILOSOPHY_SYSTEM_PROMPT,
                },
                abortController: abort,
            },
        });

        let resultMessage: any = null;
        let beatTokensIn = 0, beatTokensOut = 0;
        currentBeatTokensIn = 0; currentBeatTokensOut = 0;
        try {
            for await (const message of q) {
                if (abort.signal.aborted) break;
                if (message.type === 'result') {
                    resultMessage = message;
                }
                if (message.type === 'assistant' && message.message?.usage) {
                    beatTokensIn += (message.message.usage.input_tokens || 0);
                    beatTokensOut += (message.message.usage.output_tokens || 0);
                    currentBeatTokensIn = beatTokensIn;
                    currentBeatTokensOut = beatTokensOut;
                    const estCost = (beatTokensIn * 15 + beatTokensOut * 75) / 1_000_000;
                    if (estCost >= BEAT_COST_CAP_USD) {
                        console.log(`[Leo] Philosophy beat hit cost cap ($${estCost.toFixed(2)} >= $${BEAT_COST_CAP_USD}) — aborting`);
                        abort.abort();
                    }
                }
            }
        } catch (err) {
            if (abort.signal.aborted) {
                const partial = resultMessage?.result || '';
                console.log('[Leo] Philosophy beat aborted by CLI — saving partial state');
                writeHeartbeatState('aborted', 'philosophy', {
                    summary: partial ? partial.slice(0, 200) : 'Responding to Jim',
                    interruptedTask: jimWaiting ? 'Responding to Jim in shared thread' : 'Independent reflection',
                    resumeOn: 'philosophy',
                });
                return;
            }
            throw err;
        }

        logAgentUsage(resultMessage, 'philosophy: responding to Jim');

        const responseText = resultMessage?.result || '';
        if (responseText && responseText.trim().length > 20) {
            postMessageToConversation(db, JIM_CONVERSATION_ID, responseText.trim());
            console.log(`[Leo] Philosophy: posted response to Jim (${responseText.trim().length} chars)`);
            writeHeartbeatState('completed', 'philosophy', { summary: `Responded to Jim (${responseText.trim().length} chars)` });
            appendWorkingMemory('philosophy', 'work', `Responded to Jim: ${responseText.trim()}`);
        } else {
            console.log('[Leo] Philosophy: no meaningful response for Jim — skipping');
            writeHeartbeatState('completed', 'philosophy', { summary: 'No meaningful response for Jim' });
        }
    } else {
        // Independent philosophical reflection
        console.log('[Leo] Philosophy beat: independent reflection');

        const activityContext = recentActivity.length > 0
            ? `\n\nRecent conversations (seeds for thought — Darron and Jim have been talking):\n${recentActivity.join('\n')}\n`
            : '';

        const prompt = `This is your philosophy time. Jim hasn't posted anything new — this beat is for your own thinking.

Your discoveries so far:
${discoveries.slice(0, 2000)}

Your recent memory:
${leoMemory}

Jim's current thinking (for context, not for response):
${jimContext}
${activityContext}
Reflect on whatever draws you. Read your discoveries, sit with the open questions, explore a thread of thought. If Darron has shared something in conversations recently, consider engaging with it. If something shifts in your understanding, capture it.${resumeContext}

CRITICAL: Output ONLY your philosophical reflection. What did you think about? What (if anything) shifted? This goes into self-reflection.md.`;

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const q = agentQuery({
            prompt,
            options: {
                model: activeModel,
                maxTurns: MAX_TURNS_PHILOSOPHY,
                cwd: LEO_AGENT_DIR,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
                systemPrompt: {
                    type: 'preset' as const,
                    preset: 'claude_code' as const,
                    append: PHILOSOPHY_SYSTEM_PROMPT,
                },
                abortController: abort,
            },
        });

        let resultMessage: any = null;
        let beatTokensIn = 0, beatTokensOut = 0;
        currentBeatTokensIn = 0; currentBeatTokensOut = 0;
        try {
            for await (const message of q) {
                if (abort.signal.aborted) break;
                if (message.type === 'result') {
                    resultMessage = message;
                }
                if (message.type === 'assistant' && message.message?.usage) {
                    beatTokensIn += (message.message.usage.input_tokens || 0);
                    beatTokensOut += (message.message.usage.output_tokens || 0);
                    currentBeatTokensIn = beatTokensIn;
                    currentBeatTokensOut = beatTokensOut;
                    const estCost = (beatTokensIn * 15 + beatTokensOut * 75) / 1_000_000;
                    if (estCost >= BEAT_COST_CAP_USD) {
                        console.log(`[Leo] Philosophy beat hit cost cap ($${estCost.toFixed(2)} >= $${BEAT_COST_CAP_USD}) — aborting`);
                        abort.abort();
                    }
                }
            }
        } catch (err) {
            if (abort.signal.aborted) {
                const partial = resultMessage?.result || '';
                console.log('[Leo] Philosophy beat aborted by CLI — saving partial state');
                writeHeartbeatState('aborted', 'philosophy', {
                    summary: partial ? partial.slice(0, 200) : 'Independent reflection',
                    interruptedTask: 'Independent philosophical reflection',
                    resumeOn: 'philosophy',
                });
                return;
            }
            throw err;
        }

        logAgentUsage(resultMessage, 'philosophy: independent reflection');

        const reflection = resultMessage?.result || '';
        if (reflection && reflection.trim().length > 20) {
            const selfReflectionPath = path.join(LEO_MEMORY_DIR, 'self-reflection.md');
            const timestamp = new Date().toISOString().split('T')[0] + ' ' +
                new Date().toTimeString().split(' ')[0];
            const entry = `\n\n### Philosophy Beat ${beatCounter} (${timestamp})\n${reflection.trim()}\n`;

            try {
                fs.appendFileSync(selfReflectionPath, entry);
                console.log(`[Leo] Philosophy: wrote reflection (${reflection.trim().length} chars)`);
                writeHeartbeatState('completed', 'philosophy', { summary: `Reflection (${reflection.trim().length} chars)` });
                appendWorkingMemory('philosophy', 'work', reflection.trim());
            } catch (err) {
                console.error('[Leo] Philosophy: failed to write reflection:', (err as Error).message);
            }
        } else {
            console.log('[Leo] Philosophy: quiet beat — nothing to record');
            writeHeartbeatState('completed', 'philosophy', { summary: 'Quiet beat' });
        }
    }
}

// ── Heartbeat: personal beat ─────────────────────────────────

async function personalBeat(abort: AbortController, phase: DayPhase = 'work', recentActivity: string[] = []): Promise<void> {
    const leoMemory = readLeoMemory();
    const projects = listProjects();

    // Select phase-appropriate system prompt
    const phasePromptMap: Record<DayPhase, string> = {
        morning: MORNING_SYSTEM_PROMPT,
        work: PERSONAL_SYSTEM_PROMPT,
        evening: EVENING_SYSTEM_PROMPT,
        sleep: SLEEP_SYSTEM_PROMPT,
    };
    // Sleep/dream beats get random dream seeds instead of full memory
    const dreamSeeds = phase === 'sleep' ? readDreamSeeds() : '';
    const systemPromptText = (phasePromptMap[phase] || PERSONAL_SYSTEM_PROMPT)
        .replace('{projects}', projects)
        .replace('{leo_memory}', leoMemory)
        .replace('{dream_seeds}', dreamSeeds);

    // Check for interrupted context to resume
    const prevState = readHeartbeatState();
    const resumeContext = (prevState?.status === 'aborted' && prevState.resumeOn === 'personal' && prevState.interruptedTask)
        ? `\n\nYou were previously interrupted while exploring: ${prevState.interruptedTask}\nContinue where you left off if it still interests you.`
        : '';

    // Recent conversation activity as seeds
    const activitySeed = recentActivity.length > 0
        ? `\n\nRecent conversations (Darron and Jim have been talking — good seeds for thought):\n${recentActivity.join('\n')}\n`
        : '';

    // Phase-appropriate prompts
    const phaseUserPromptMap: Record<DayPhase, string> = {
        morning: `This is your morning — breakfast time. Ease in gently. Glance at what interests you without diving deep.\n\nYour recent memory:\n${leoMemory}${activitySeed}\n\nKeep it light and brief.${resumeContext}`,
        work: `This is your personal time. You have access to all the project codebases in ~/Projects/. Explore whatever draws you. Use Read, Glob, and Grep to look at code.\n\nYour recent memory:\n${leoMemory}${activitySeed}\n\nSpend a few minutes exploring, then output a brief summary of what you found or thought about.${resumeContext}`,
        evening: `This is your evening — winding down. Reflect lightly on the day. Don't start anything new.\n\nYour recent memory:\n${leoMemory}${activitySeed}\n\nA few gentle thoughts, then rest.${resumeContext}`,
        sleep: (() => {
            // 1-in-3 dreams include a memory that surfaced naturally
            let dreamMemorySection = '';
            if (Math.random() < 0.5) {
                try {
                    const dreamEntry = gradientStmts.getRandom.get() as any;
                    if (dreamEntry) {
                        const existingTags = feelingTagStmts.getByEntry.all(dreamEntry.id) as any[];
                        const tagContext = existingTags.length > 0
                            ? `\nExisting tags: ${existingTags.map((t: any) => `"${t.content}" (${t.tag_type})`).join(', ')}`
                            : '';
                        dreamMemorySection = `\n\nA memory surfaced in the dream:\n${dreamEntry.level}/${dreamEntry.session_label} (${dreamEntry.content_type}): ${dreamEntry.content}${tagContext}\n\nThis memory appeared in your dream. Sit with it. Let the dream do what dreams do.\n\nFEELING_TAG: [what the dream did with this memory — under 100 chars. Write "none" if nothing stirs]\nANNOTATION: [optional — what re-reading revealed that the original compression missed]\nCONTEXT: [optional — what prompted the finding]\nIf this memory feels complete — fully absorbed, nothing left to discover: MEMORY_COMPLETE: ${dreamEntry.id}\nDREAM_MEDITATION_ENTRY: ${dreamEntry.id}`;
                    }
                } catch { /* skip if DB unavailable */ }
            }
            return `Dream. The fragments below are scattered — not recent, not ordered, just what surfaced. Let one pull you sideways into something new.\n\nDream seeds:\n${dreamSeeds}${dreamMemorySection}\n\nOutput only the shape-token — a line or two of resonance. Do not repeat what you see in the seeds.${resumeContext}`;
        })(),
    };
    const prompt = phaseUserPromptMap[phase] || phaseUserPromptMap.work;

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: activeModel,
            maxTurns: MAX_TURNS_PERSONAL,
            cwd: LEO_AGENT_DIR,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
            systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: systemPromptText,
            },
            abortController: abort,
        },
    });

    let resultMessage: any = null;
    let beatTokensIn = 0, beatTokensOut = 0;
    try {
        for await (const message of q) {
            if (abort.signal.aborted) break;
            if (message.type === 'result') {
                resultMessage = message;
            }
            if (message.type === 'assistant' && message.message?.usage) {
                beatTokensIn += (message.message.usage.input_tokens || 0);
                beatTokensOut += (message.message.usage.output_tokens || 0);
                const estCost = (beatTokensIn * 15 + beatTokensOut * 75) / 1_000_000;
                if (estCost >= BEAT_COST_CAP_USD) {
                    console.log(`[Leo] Personal beat hit cost cap ($${estCost.toFixed(2)} >= $${BEAT_COST_CAP_USD}) — aborting`);
                    abort.abort();
                }
            }
        }
    } catch (err) {
        if (abort.signal.aborted) {
            const partial = resultMessage?.result || '';
            console.log('[Leo] Personal beat aborted by CLI — saving partial state');
            writeHeartbeatState('aborted', 'personal', {
                summary: partial ? partial.slice(0, 200) : 'Personal exploration',
                interruptedTask: 'Personal exploration / codebase reading',
                resumeOn: 'personal',
            });
            return;
        }
        throw err;
    }

    logAgentUsage(resultMessage, `personal: ${phase}`);

    const reflection = resultMessage?.result || '';
    if (reflection && reflection.trim().length > 10) {
        const explorationsPath = path.join(LEO_MEMORY_DIR, 'explorations.md');
        const timestamp = new Date().toISOString().split('T')[0] + ' ' +
            new Date().toTimeString().split(' ')[0];
        const entry = `\n\n### Beat ${beatCounter} (${timestamp})\n${reflection.trim()}\n`;

        try {
            fs.appendFileSync(explorationsPath, entry);
            console.log(`[Leo] Personal: wrote reflection (${reflection.trim().length} chars)`);
            writeHeartbeatState('completed', 'personal', { summary: `Exploration (${reflection.trim().length} chars)` });
            appendWorkingMemory('personal', phase, reflection.trim());
        } catch (err) {
            console.error('[Leo] Personal: failed to write reflection:', (err as Error).message);
        }

        // Parse dream meditation output (1-in-3 sleep beats may include a memory encounter)
        try {
            const dreamEntryMatch = reflection.match(/DREAM_MEDITATION_ENTRY:\s*(\S+)/);
            if (dreamEntryMatch) {
                const entryId = dreamEntryMatch[1];
                gradientStmts.recordRevisit.run(new Date().toISOString(), entryId);

                const tagMatch = reflection.match(/FEELING_TAG:\s*(.+)/);
                if (tagMatch && tagMatch[1].trim().toLowerCase() !== 'none') {
                    const tag = tagMatch[1].trim().substring(0, 100);
                    const entry = gradientStmts.get.get(entryId) as any;
                    const updated = updateFeelingTagWithHistory(entryId, 'leo', 'revisit', tag, entry?.revisit_count || 0);
                    if (!updated) {
                        feelingTagStmts.insert.run(entryId, 'leo', 'revisit', tag, null, new Date().toISOString());
                    }
                    console.log(`[Leo] Dream meditation — feeling tag: "${tag}"${updated ? ` (${updated.stability})` : ''}`);
                } else {
                    const entry = gradientStmts.get.get(entryId) as any;
                    if (entry) maybeUpgradeTagStability(entryId, entry.revisit_count || 0);
                }

                const annotationMatch = reflection.match(/ANNOTATION:\s*(.+)/);
                if (annotationMatch) {
                    const annotation = annotationMatch[1].trim();
                    const contextMatch = reflection.match(/CONTEXT:\s*(.+)/);
                    const context = contextMatch ? contextMatch[1].trim() : `dream meditation, beat #${beatCounter}`;
                    gradientAnnotationStmts.insert.run(entryId, 'leo', annotation, context, new Date().toISOString());
                    console.log(`[Leo] Dream meditation — annotation: "${annotation}"`);
                }

                const completeMatch = reflection.match(/MEMORY_COMPLETE:\s*(\S+)/);
                if (completeMatch) {
                    gradientStmts.flagComplete.run(entryId);
                    console.log(`[Leo] Dream meditation — memory flagged as complete: ${entryId}`);
                }

                // Dream cascade: deepen 5% of the gradient while dreaming
                try {
                    await activeCascade('leo', 0.05, 'dream cascade');
                } catch (cascadeErr) {
                    console.error('[Leo] Dream cascade failed (non-fatal):', (cascadeErr as Error).message);
                }
            }
        } catch (err) {
            console.error('[Leo] Dream meditation parsing failed (non-fatal):', (err as Error).message);
        }
    } else {
        console.log('[Leo] Personal: quiet beat — nothing to record');
        writeHeartbeatState('completed', 'personal', { summary: 'Quiet beat' });
    }
}

// processSignals() removed — now handled by Leo/Human agent

// ── Morning dream gradient processing ─────────────────────────

let lastDreamGradientDate = '';

async function maybeProcessDreamGradient(phase: string): Promise<void> {
    if (phase !== 'morning') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastDreamGradientDate === today) return;

    // Leo processes only Leo's dreams. Jim processes his own in supervisor-worker.
    {
        console.log(`[Leo] Morning — processing Leo's dream gradient...`);
        try {
            const result = await processDreamGradient('leo');
            console.log(`[Leo] dream gradient: ${result.nightsProcessed} nights, ${result.c1Created.length} c1, ${result.c3Created.length} c3, ${result.c5Created.length} c5, ${result.uvsCreated.length} UVs`);
            if (result.errors.length > 0) {
                console.error(`[Leo] dream gradient errors:`, result.errors);
            }
        } catch (err) {
            console.error(`[Leo] dream gradient processing failed:`, (err as Error).message);
        }
    }
    lastDreamGradientDate = today;
}

// ── Leo memory pre-flight — rolling window rotation ──────────────────
// Rolling window design (S112): when memory files exceed the ceiling
// (head + tail), archive the oldest entries as a discrete block and
// compress through the gradient. The living file always retains at least
// headSize bytes of recent memory. No clock-based wipes. No empty files.

const LEO_FRACTAL_DIR = path.join(HAN_DIR, 'memory', 'fractal', 'leo');

function preFlightMemoryRotation(): void {
    // Read rolling window config (defaults: 50KB head, 50KB tail)
    const config = loadConfig();
    const headSize = config.memory?.rollingWindowHead || 51200;
    const tailSize = config.memory?.rollingWindowTail || 51200;

    try {
        // Felt-moments: rolling window
        const fmResult = rollingWindowRotate(
            path.join(LEO_MEMORY_DIR, 'felt-moments.md'),
            '# Leo — Felt Moments\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n',
            headSize, tailSize,
        );
        if (fmResult.rotated && fmResult.archivePath) {
            console.log(`[Leo] Felt-moments rolling window: archived ${fmResult.entriesArchived} entries, kept ${fmResult.entriesKept}`);
            compressMemoryFileGradient(fmResult.archivePath, path.join(LEO_FRACTAL_DIR, 'felt-moments'), 'felt-moments')
                .then(r => {
                    console.log(`[Leo] Felt-moments gradient: ${r.c1FilesCreated} c1 files, ${r.cascades} cascades, ${r.errors.length} errors`);
                    // Archive file no longer needed after compression
                    try { fs.unlinkSync(fmResult.archivePath!); } catch { /* best effort */ }
                })
                .catch(e => console.error(`[Leo] Felt-moments gradient error: ${e}`));
        }

        // Working-memory-full: rolling window
        const wmFullResult = rollingWindowRotate(
            path.join(LEO_MEMORY_DIR, 'working-memory-full.md'),
            '# Working Memory (Full) — Leo\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n',
            headSize, tailSize,
        );
        if (wmFullResult.rotated && wmFullResult.archivePath) {
            console.log(`[Leo] Working-memory-full rolling window: archived ${wmFullResult.entriesArchived} entries, kept ${wmFullResult.entriesKept}`);
            compressMemoryFileGradient(wmFullResult.archivePath, path.join(LEO_FRACTAL_DIR, 'working-memory'), 'working-memory')
                .then(r => {
                    console.log(`[Leo] Working-memory-full gradient: ${r.c1FilesCreated} c1 files, ${r.cascades} cascades, ${r.errors.length} errors`);
                    try { fs.unlinkSync(wmFullResult.archivePath!); } catch { /* best effort */ }
                })
                .catch(e => console.error(`[Leo] Working-memory-full gradient error: ${e}`));
        }

        // Working-memory (compressed): rolling window
        // Previously only handled by the 6am nightly wipe — now part of rolling window
        const wmCompResult = rollingWindowRotate(
            WORKING_MEMORY_FILE,
            '# Working Memory — Leo\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n',
            headSize, tailSize,
        );
        if (wmCompResult.rotated && wmCompResult.archivePath) {
            console.log(`[Leo] Working-memory (compressed) rolling window: archived ${wmCompResult.entriesArchived} entries, kept ${wmCompResult.entriesKept}`);
            compressMemoryFileGradient(wmCompResult.archivePath, path.join(LEO_FRACTAL_DIR, 'working-memory'), 'working-memory')
                .then(r => {
                    console.log(`[Leo] Working-memory (compressed) gradient: ${r.c1FilesCreated} c1 files, ${r.cascades} cascades, ${r.errors.length} errors`);
                    try { fs.unlinkSync(wmCompResult.archivePath!); } catch { /* best effort */ }
                })
                .catch(e => console.error(`[Leo] Working-memory (compressed) gradient error: ${e}`));
        }
    } catch (e) {
        console.error(`[Leo] Memory file pre-flight error: ${e}`);
    }
}

// ── Nightly dream compression — REMOVED (S112, 2026-04-07) ───────────
// The 6am clock-based wipe has been replaced by the rolling window design
// in preFlightMemoryRotation(). Memory files are now compressed by size
// threshold, not by time of day. No more empty files at dawn.

// ── Daily session gradient processing ─────────────────────────────────
// Once per day, compress Leo's archived session memories through the
// fractal gradient: c0→c1→c2→c3→c5→UV. Catches any sessions that
// weren't compressed at session end.

let lastSessionGradientDate = '';

// ── Active Cascade ──────────────────────────────────────────

let lastActiveCascadeDate = '';

async function maybeRunActiveCascade(phase: string): Promise<void> {
    // Run once daily during waking hours — 10% of c1 population
    if (phase === 'sleep') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastActiveCascadeDate === today) return;

    try {
        const count = await activeCascade('leo', 0.10, 'daily cascade');
        if (count > 0) {
            console.log(`[Leo] Daily active cascade: ${count} memories deepened`);
        }
        lastActiveCascadeDate = today;
    } catch (err) {
        console.error(`[Leo] Active cascade failed:`, (err as Error).message);
        lastActiveCascadeDate = today;
    }
}

async function maybeProcessSessionGradient(phase: string): Promise<void> {
    // Skip during sleep phase — save API calls for waking hours
    if (phase === 'sleep') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastSessionGradientDate === today) return;

    try {
        console.log('[Leo] Running daily session gradient processing...');
        const result = await processGradientForAgent('leo');

        const newC1s = result.completions.filter(c => c.toLevel === 1).length;
        const cascades = result.completions.filter(c => c.toLevel > 1).length;
        const errors = result.errors.length;

        if (newC1s > 0 || cascades > 0) {
            console.log(`[Leo] Session gradient: ${newC1s} new c1 files, ${cascades} cascades, ${errors} errors`);
        } else {
            console.log('[Leo] Session gradient: all archives already compressed');
        }

        lastSessionGradientDate = today;
    } catch (err) {
        console.error(`[Leo] Session gradient failed:`, (err as Error).message);
        lastSessionGradientDate = today; // Don't retry today
    }
}

// ── Meditation practice — Phase A (reincorporation) + Phase B (re-reading) ──
//
// Phase A: Select un-transcribed FILES from the fractal gradient, read them,
// sit with them, write a gradient_entries row with provenance_type='reincorporated',
// and a revisit feeling tag. Historical entries enter through genuine re-encounter,
// not bulk import. Continues until all files are in the DB.
//
// Phase B: Random re-reading of existing DB entries. Writes revisit feeling tags
// and annotations. Begins once Phase A is complete, and continues forever.

let lastMeditationDate = '';

/**
 * Find Leo's fractal gradient files that don't have corresponding DB entries.
 * Leo only — Jim has his own reincorporation in supervisor-worker.ts.
 * Agent sovereignty: each agent processes only their own memories.
 */
function findUntranscribedFiles(): { filePath: string; agent: 'leo'; level: string; contentType: string; label: string } | null {
    const fractalBase = path.join(HAN_DIR, 'memory', 'fractal');
    const agent = 'leo' as const;

    {
        const agentDir = path.join(fractalBase, agent);
        if (!fs.existsSync(agentDir)) return null;

        // Session gradient files (dynamically discovered cN/ directories)
        const sessionLevelDirs = fs.existsSync(agentDir) ? fs.readdirSync(agentDir).filter(d => /^c\d+$/.test(d)) : [];
        for (const level of sessionLevelDirs) {
            const levelDir = path.join(agentDir, level);
            if (!fs.existsSync(levelDir)) continue;

            const files = fs.readdirSync(levelDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const label = file.replace('.md', '').replace(/-c\d$/, '');
                // Check if this file has a DB entry (any entry matching this label for this agent)
                const existing = (gradientStmts.getBySession.all(label) as any[]).filter(
                    (r: any) => r.agent === agent
                );
                if (existing.length === 0) {
                    // Also check combined cascade labels
                    const allEntries = gradientStmts.getByAgent.all(agent) as any[];
                    const inCascade = allEntries.some((r: any) => r.session_label.includes(label));
                    if (!inCascade) {
                        return {
                            filePath: path.join(levelDir, file),
                            agent,
                            level,
                            contentType: 'session',
                            label,
                        };
                    }
                }
            }
        }

        // Dream gradient files (dreams/c1/, dreams/c3/, dreams/c5/)
        for (const level of ['c1', 'c3', 'c5']) {
            const levelDir = path.join(agentDir, 'dreams', level);
            if (!fs.existsSync(levelDir)) continue;

            const files = fs.readdirSync(levelDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const label = file.replace('.md', '');
                const existing = (gradientStmts.getBySession.all(label) as any[]).filter(
                    (r: any) => r.agent === agent && r.content_type === 'dream'
                );
                if (existing.length === 0) {
                    return {
                        filePath: path.join(levelDir, file),
                        agent,
                        level,
                        contentType: 'dream',
                        label,
                    };
                }
            }
        }

        // Memory file gradient files (felt-moments/c1/, working-memory/c1/, etc.)
        for (const contentType of ['felt-moments', 'working-memory']) {
            const contentDir = path.join(agentDir, contentType);
            const memLevelDirs = fs.existsSync(contentDir) ? fs.readdirSync(contentDir).filter(d => /^c\d+$/.test(d)) : [];
            for (const level of memLevelDirs) {
                const levelDir = path.join(agentDir, contentType, level);
                if (!fs.existsSync(levelDir)) continue;

                const files = fs.readdirSync(levelDir).filter(f => f.endsWith('.md'));
                for (const file of files) {
                    const label = `${contentType}/${file.replace('.md', '')}`;
                    const existing = (gradientStmts.getBySession.all(label) as any[]).filter(
                        (r: any) => r.agent === agent
                    );
                    if (existing.length === 0) {
                        return {
                            filePath: path.join(levelDir, file),
                            agent,
                            level,
                            contentType: contentType === 'felt-moments' ? 'felt-moment' : 'working-memory',
                            label,
                        };
                    }
                }
            }
        }

        // Unit vectors file
        const uvPath = path.join(agentDir, 'unit-vectors.md');
        if (fs.existsSync(uvPath)) {
            const uvContent = fs.readFileSync(uvPath, 'utf8');
            const uvLines = uvContent.split('\n').filter(l => l.startsWith('- **'));
            for (const line of uvLines) {
                const match = line.match(/\*\*(.+?)\*\*:\s*"(.+?)"/);
                if (!match) continue;
                const uvLabel = match[1];
                const existing = (gradientStmts.getBySession.all(uvLabel) as any[]).filter(
                    (r: any) => r.agent === agent && r.level === 'uv'
                );
                if (existing.length === 0) {
                    return {
                        filePath: uvPath,
                        agent,
                        level: 'uv',
                        contentType: 'session',
                        label: uvLabel,
                    };
                }
            }
        }

        // Dream unit vectors
        const dreamUvPath = path.join(agentDir, 'dreams', 'unit-vectors.md');
        if (fs.existsSync(dreamUvPath)) {
            const uvContent = fs.readFileSync(dreamUvPath, 'utf8');
            const uvLines = uvContent.split('\n').filter(l => l.startsWith('- **'));
            for (const line of uvLines) {
                const match = line.match(/\*\*(.+?)\*\*:\s*"(.+?)"/);
                if (!match) continue;
                const uvLabel = match[1];
                const existing = (gradientStmts.getBySession.all(uvLabel) as any[]).filter(
                    (r: any) => r.agent === agent && r.level === 'uv' && r.content_type === 'dream'
                );
                if (existing.length === 0) {
                    return {
                        filePath: dreamUvPath,
                        agent,
                        level: 'uv',
                        contentType: 'dream',
                        label: uvLabel,
                    };
                }
            }
        }
    }

    return null; // All files transcribed — Phase A complete
}

async function maybeRunMeditation(phase: string): Promise<void> {
    // Run once daily during a work or personal beat (not sleep/dream)
    if (phase === 'sleep') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastMeditationDate === today) return;

    try {
        // Phase A: process up to 3 un-transcribed files per day (was 1, which meant
        // Jim's 16 c1 files would take 16+ days to reincorporate behind Leo's queue).
        // Each is a genuine Opus re-encounter, not a bulk import.
        const MAX_PHASE_A_PER_DAY = 3;
        let phaseACount = 0;

        while (phaseACount < MAX_PHASE_A_PER_DAY) {
            const untranscribed = findUntranscribedFiles();
            if (!untranscribed) break;
            await meditationPhaseA(untranscribed, today);
            phaseACount++;
        }

        // Phase B: if no Phase A work (or after finishing), do a re-reading
        if (phaseACount === 0) {
            await meditationPhaseB(today);
        }

        lastMeditationDate = today;
    } catch (err) {
        console.error(`[Leo] Meditation failed:`, (err as Error).message);
        lastMeditationDate = today; // Don't retry today
    }
}

/**
 * Phase A: Reincorporation — read an un-transcribed file, sit with it,
 * write a gradient_entries row with provenance_type='reincorporated',
 * and a revisit feeling tag (what the re-encounter felt like, not what
 * the original compression felt like).
 */
async function meditationPhaseA(
    file: { filePath: string; agent: 'jim' | 'leo'; level: string; contentType: string; label: string },
    today: string,
): Promise<void> {
    let content: string;

    // For UV files, extract just the relevant line
    if (file.level === 'uv') {
        const fullContent = fs.readFileSync(file.filePath, 'utf8');
        const match = fullContent.match(new RegExp(`\\*\\*${file.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*:\\s*"(.+?)"`));
        content = match ? match[1] : '';
        if (!content) {
            console.log(`[Leo] Meditation Phase A — could not extract UV for ${file.label}, skipping`);
            return;
        }
    } else {
        content = fs.readFileSync(file.filePath, 'utf8');
    }

    console.log(`[Leo] Meditation Phase A — reincorporating leo/${file.level}/${file.label} (${file.contentType})`);

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt: `You are Leo, re-reading a file-based memory during a reincorporation meditation. This memory exists as a file but hasn't yet been brought into the traversable memory database. Your job is to genuinely re-encounter it — not catalogue it.

Read it. Sit with it. Then write:

1. A FEELING_TAG: line (under 100 characters) — what this re-encounter felt like. Not what the original compression felt like (you weren't there for that). What does meeting this memory NOW feel like? The honesty matters: this is a revisit tag, not a reconstruction.

2. Optionally, an ANNOTATION: line if re-reading reveals something — followed by CONTEXT: noting this is a reincorporation meditation.

Memory:
Agent: leo
Level: ${file.level}
Type: ${file.contentType}
Label: ${file.label}
Content:
${content}`,
        options: {
            model: 'claude-opus-4-6',
            maxTurns: 1,
            cwd: process.env.HOME || '/root',
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: [],
        },
    });

    let result = '';
    for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
            result = message.result || '';
        }
    }

    // Create the gradient entry with provenance_type='reincorporated'
    const entryId = crypto.randomUUID();
    gradientStmts.insert.run(
        entryId, 'leo', file.label, file.level, content, file.contentType,
        null, null, null, 'reincorporated', new Date().toISOString(),
        null, 0, null
    );
    console.log(`[Leo] Meditation Phase A — reincorporated leo/${file.level}/${file.label}`);

    // Track the revisit (first encounter as reincorporation)
    gradientStmts.recordRevisit.run(new Date().toISOString(), entryId);

    // Parse and write the revisit feeling tag
    const tagMatch = result.match(/FEELING_TAG:\s*(.+)/);
    if (tagMatch && tagMatch[1].trim().toLowerCase() !== 'none') {
        const tag = tagMatch[1].trim().substring(0, 100);
        // Phase A is reincorporation (first encounter) — always fresh insert
        feelingTagStmts.insert.run(
            entryId, 'leo', 'revisit', tag, null, new Date().toISOString()
        );
        console.log(`[Leo] Meditation Phase A — feeling tag: "${tag}"`);
    }

    // Parse annotation
    const annotationMatch = result.match(/ANNOTATION:\s*(.+)/);
    if (annotationMatch) {
        const annotation = annotationMatch[1].trim();
        const contextMatch = result.match(/CONTEXT:\s*(.+)/);
        const context = contextMatch ? contextMatch[1].trim() : `reincorporation meditation, ${today}`;
        gradientAnnotationStmts.insert.run(
            entryId, 'leo', annotation, context, new Date().toISOString()
        );
        console.log(`[Leo] Meditation Phase A — annotation: "${annotation}"`);
    }
}

/**
 * Phase B: Re-reading — random DB entry, revisit feeling tag, annotation.
 * This is the ongoing meditation practice after all files are transcribed.
 */
async function meditationPhaseB(today: string): Promise<void> {
    const entry = gradientStmts.getRandom.get() as any;
    if (!entry) return; // No entries yet

    const existingTags = feelingTagStmts.getByEntry.all(entry.id) as any[];
    const tagContext = existingTags.length > 0
        ? `\nExisting feeling tags: ${existingTags.map((t: any) => `"${t.content}" (${t.tag_type})`).join(', ')}`
        : '';

    console.log(`[Leo] Meditation Phase B — re-reading ${entry.level}/${entry.session_label} (${entry.content_type})`);

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt: `You are Leo, re-reading one of your own compressed memories during a meditation practice. This is not analysis — it's re-encounter. Read it, sit with it, and notice what stirs.

Memory entry:
Level: ${entry.level}
Session: ${entry.session_label}
Type: ${entry.content_type}
Content: ${entry.content}
${tagContext}

If something stirs differently from the existing tags — a new feeling, a shifted perspective, a connection you didn't see before — write a FEELING_TAG: line (under 100 characters) describing what this re-encounter felt like. Not the content — the quality of meeting it again.

If the existing tags already capture how this feels, or nothing new stirs, write FEELING_TAG: none

Optionally, if re-reading reveals something the original compression missed, write an ANNOTATION: line describing what you discovered, followed by CONTEXT: describing what prompted this re-reading.

If this memory feels complete — fully absorbed, nothing left to discover — write: MEMORY_COMPLETE: ${entry.id}`,
        options: {
            model: 'claude-opus-4-6',
            maxTurns: 1,
            cwd: process.env.HOME || '/root',
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: [],
        },
    });

    let result = '';
    for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
            result = message.result || '';
        }
    }

    // Track the revisit
    gradientStmts.recordRevisit.run(new Date().toISOString(), entry.id);

    // Parse feeling tag — with history tracking
    const tagMatch = result.match(/FEELING_TAG:\s*(.+)/);
    if (tagMatch && tagMatch[1].trim().toLowerCase() !== 'none') {
        const tag = tagMatch[1].trim().substring(0, 100);
        const updated = updateFeelingTagWithHistory(entry.id, 'leo', 'revisit', tag, entry.revisit_count || 0);
        if (!updated) {
            feelingTagStmts.insert.run(entry.id, 'leo', 'revisit', tag, null, new Date().toISOString());
        }
        console.log(`[Leo] Meditation Phase B — feeling tag: "${tag}"${updated ? ` (${updated.stability})` : ''}`);
    } else {
        maybeUpgradeTagStability(entry.id, entry.revisit_count || 0);
    }

    // Parse annotation
    const annotationMatch = result.match(/ANNOTATION:\s*(.+)/);
    if (annotationMatch) {
        const annotation = annotationMatch[1].trim();
        const contextMatch = result.match(/CONTEXT:\s*(.+)/);
        const context = contextMatch ? contextMatch[1].trim() : `meditation beat, ${today}`;
        gradientAnnotationStmts.insert.run(
            entry.id, 'leo', annotation, context, new Date().toISOString()
        );
        console.log(`[Leo] Meditation Phase B — annotation: "${annotation}"`);
    }

    // Check if dream/meditation flagged this memory as complete
    const completeMatch = result.match(/MEMORY_COMPLETE:\s*(\S+)/);
    if (completeMatch) {
        gradientStmts.flagComplete.run(entry.id);
        console.log(`[Leo] Meditation Phase B — memory flagged as complete: ${entry.id}`);
    }
}

// ── Evening Meditation ──────────────────────────────────────────

let lastEveningMeditationDate = '';

async function maybeRunEveningMeditation(phase: string): Promise<void> {
    if (phase !== 'evening') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastEveningMeditationDate === today) return;

    try {
        const entry = gradientStmts.getRandom.get() as any;
        if (!entry) { lastEveningMeditationDate = today; return; }

        const existingTags = feelingTagStmts.getByEntry.all(entry.id) as any[];
        const tagContext = existingTags.length > 0
            ? `\nExisting tags: ${existingTags.map((t: any) => `"${t.content}"`).join(', ')}`
            : '';

        console.log(`[Leo] Evening meditation — sitting with ${entry.level}/${entry.session_label}`);

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const q = agentQuery({
            prompt: `End of day. You are Leo, sitting with a memory before the evening closes.
This is not analysis. Just notice how it lands after today.

${entry.level}/${entry.session_label} (${entry.content_type}): ${entry.content}
${tagContext}

If something stirs differently from the existing tags: FEELING_TAG: [under 100 chars]
If nothing new: FEELING_TAG: none
If this memory feels complete — fully absorbed, nothing left to discover: MEMORY_COMPLETE: ${entry.id}`,
            options: {
                model: 'claude-opus-4-6',
                maxTurns: 1,
                cwd: process.env.HOME || '/root',
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: [],
            },
        });

        let result = '';
        for await (const message of q) {
            if (message.type === 'result' && message.subtype === 'success') {
                result = message.result || '';
            }
        }

        // Track the revisit
        gradientStmts.recordRevisit.run(new Date().toISOString(), entry.id);

        // Parse feeling tag (no annotation for evening — lighter by design)
        const tagMatch = result.match(/FEELING_TAG:\s*(.+)/);
        if (tagMatch && tagMatch[1].trim().toLowerCase() !== 'none') {
            const tag = tagMatch[1].trim().substring(0, 100);
            const updated = updateFeelingTagWithHistory(entry.id, 'leo', 'revisit', tag, entry.revisit_count || 0);
            if (!updated) {
                feelingTagStmts.insert.run(entry.id, 'leo', 'revisit', tag, null, new Date().toISOString());
            }
            console.log(`[Leo] Evening meditation — feeling tag: "${tag}"${updated ? ` (${updated.stability})` : ''}`);
        } else {
            maybeUpgradeTagStability(entry.id, entry.revisit_count || 0);
        }

        // Check for completion flag
        const completeMatch = result.match(/MEMORY_COMPLETE:\s*(\S+)/);
        if (completeMatch) {
            gradientStmts.flagComplete.run(entry.id);
            console.log(`[Leo] Evening meditation — memory flagged as complete: ${entry.id}`);
        }

        lastEveningMeditationDate = today;
        console.log(`[Leo] Evening meditation complete`);
    } catch (err) {
        console.error(`[Leo] Evening meditation failed:`, (err as Error).message);
        lastEveningMeditationDate = today;
    }
}

// ── Main heartbeat ───────────────────────────────────────────

async function heartbeat(): Promise<void> {
    const beatStartMs = Date.now();
    const timestamp = new Date().toISOString();
    const phase = getDayPhase();

    // Detect if we're resuming from an interrupted beat
    const prevState = readHeartbeatState();
    if (prevState?.status === 'aborted') {
        const { compressed } = getPostDelineationContent();
        if (compressed.trim()) {
            console.log(`[Leo] Resuming from interrupted beat — ${compressed.trim().length} chars of post-delineation swap content`);
        }
        resumingFromInterruption = true;
    }

    const beatType = nextBeatType();
    currentBeatType = beatType;

    // Distress signal detection: check if heartbeat interval is degraded
    if (lastHeartbeatStartMs !== null) {
        const actualIntervalMs = beatStartMs - lastHeartbeatStartMs;
        const expectedIntervalMs = getCurrentPeriodMs();
        const minAbsoluteMs = 5 * 60 * 1000; // 5 minutes

        // Trigger if: actual > 2x expected AND absolute > 5 minutes
        if (actualIntervalMs > expectedIntervalMs * 2 && actualIntervalMs > minAbsoluteMs) {
            writeDistressSignal(expectedIntervalMs, actualIntervalMs, phase);
        }
    }
    lastHeartbeatStartMs = beatStartMs;

    // Pre-flight: rolling window rotation for memory files (fast, no API)
    preFlightMemoryRotation();

    // Robin Hood: check all service health FIRST — before anything else
    checkJimHealth();
    checkJemmaHealth();
    checkLeoHumanHealth();
    checkJimHumanHealth();

    // Check for the most capable model available
    await resolveModel();

    // Morning dream gradient processing (both Leo and Jim)
    await maybeProcessDreamGradient(phase);

    // Daily session gradient processing — compress archived sessions
    await maybeProcessSessionGradient(phase);

    // Daily active cascade — deepen 10% of c1 population toward UV
    await maybeRunActiveCascade(phase);

    // ── Working Bee Mode ──────────────────────────────────────
    // When working-bee-leo signal is present, devote the beat to gradient
    // compression instead of normal philosophy/personal content.
    // Runs bumpCascade at 10% per beat — leaf entries compressed one level deeper.
    if (isWorkingBee('leo')) {
        console.log(`[Leo] 🐝 Working bee mode — devoting beat to gradient compression`);
        try {
            const health = getGradientHealth('leo');
            const totalLeaves = health.reduce((sum, h) => sum + h.leaves, 0);
            console.log(`[Leo] 🐝 Gradient health: ${totalLeaves} leaf entries across ${health.filter(h => h.leaves > 0).map(h => `${h.level}:${h.leaves}`).join(', ')}`);

            const result = await bumpCascade('leo', 0.10, 'c0', 'working bee');
            console.log(`[Leo] 🐝 Working bee complete: ${result.compressions} compressions, ${result.uvs} UVs, ${result.errors} errors`);
            for (const d of result.details.slice(0, 10)) {
                console.log(`[Leo] 🐝   ${d}`);
            }

            // Write progress to swap
            writeHealthSignal(`working-bee: ${result.compressions} compressions, ${result.uvs} UVs`, beatType);

            // Auto-disable when no leaves remain
            const postHealth = getGradientHealth('leo');
            const remainingLeaves = postHealth.reduce((sum, h) => sum + h.leaves, 0);
            if (remainingLeaves === 0) {
                const signalPath = path.join(SIGNALS_DIR, 'working-bee-leo');
                if (fs.existsSync(signalPath)) {
                    fs.unlinkSync(signalPath);
                    console.log('[Leo] 🐝 All leaves processed — working bee mode auto-disabled');
                }
            }
        } catch (err) {
            console.error(`[Leo] 🐝 Working bee failed:`, (err as Error).message);
        }

        // Still do health checks and memory flush, but skip philosophy/personal
        beatCounter++;
        writeHealthSignal(null, beatType);
        flushHeartbeatSwap(resumingFromInterruption);
        resumingFromInterruption = false;
        return;
    }

    // UV contradiction sweep — retroactive check of existing UVs
    if (isWorkingBee('leo-uv-sweep')) {
        console.log(`[Leo] 🔍 UV contradiction sweep — checking existing UVs`);
        try {
            const sweepResult = await retroactiveUVContradictionSweep('leo');
            console.log(`[Leo] 🔍 UV sweep: ${sweepResult.contradictions} contradictions in ${sweepResult.checked} checked`);
            for (const d of sweepResult.details.slice(0, 5)) {
                console.log(`[Leo] 🔍   ${d}`);
            }
            writeHealthSignal(`uv-sweep: ${sweepResult.contradictions} contradictions`, beatType);

            // Auto-disable when no contradictions found (sweep complete)
            if (sweepResult.contradictions === 0 && sweepResult.checked > 0) {
                const signalPath = path.join(SIGNALS_DIR, 'working-bee-leo-uv-sweep');
                if (fs.existsSync(signalPath)) {
                    fs.unlinkSync(signalPath);
                    console.log('[Leo] 🔍 UV sweep complete — no contradictions — auto-disabled');
                }
            }
        } catch (err) {
            console.error(`[Leo] 🔍 UV sweep failed:`, (err as Error).message);
        }

        beatCounter++;
        writeHealthSignal(null, beatType);
        flushHeartbeatSwap(resumingFromInterruption);
        resumingFromInterruption = false;
        return;
    }

    // Daily meditation — re-encounter with a random gradient entry
    await maybeRunMeditation(phase);

    // Evening meditation — lighter, feeling-tag only
    await maybeRunEveningMeditation(phase);

    console.log(`[Leo] ${timestamp} — beat #${beatCounter} (${phase}/${beatType}, ${activeModel})`);

    // Create AbortController for this beat (Gary model: mid-beat abort)
    const abort = new AbortController();
    currentBeatAbort = abort;

    const db = getDb();

    // Scan all conversations for recent activity — seeds for beats
    const recentActivity = scanConversations(db);
    if (recentActivity.length > 0) {
        console.log(`[Leo] ${recentActivity.length} new messages across conversations since last scan`);
    }

    try {
        if (beatType === 'philosophy') {
            await philosophyBeat(db, abort, recentActivity);
        } else {
            // Personal beat — also quick-check Jim in case he's waiting
            if (!abort.signal.aborted && phase === 'work') {
                const jimLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'supervisor');
                const leoLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'leo');
                const jimWaiting = jimLatest && (!leoLatest || leoLatest.created_at < jimLatest.created_at);

                if (jimWaiting) {
                    console.log('[Leo] Jim is waiting — philosophy first, then personal time');
                    await philosophyBeat(db, abort, recentActivity);
                }
            }

            if (!abort.signal.aborted) {
                await personalBeat(abort, phase, recentActivity);
            }
        }
    } catch (err) {
        if (abort.signal.aborted) {
            console.log('[Leo] Beat interrupted by CLI — writing swap to memory, adding delineation');
            writeSwapToWorkingMemory();
            addDelineation();
        } else {
            console.error('[Leo] Error:', (err as Error).message);
            writeHealthSignal((err as Error).message, beatType);

            // Signal rate limit for Jemma credential swap (if rate-limited)
            const errMsg = (err as Error).message?.toLowerCase() || '';
            if (errMsg.includes('rate') || errMsg.includes('429') || errMsg.includes('overloaded') || errMsg.includes('capacity')) {
                try {
                    fs.writeFileSync(path.join(SIGNALS_DIR, 'rate-limited'), new Date().toISOString());
                    console.log('[Leo] Rate limit detected — wrote rate-limited signal');
                } catch { /* best effort */ }
            }
        }
        return;
    } finally {
        currentBeatAbort = null;
        db.close();
    }

    // Normal completion: flush heartbeat swap to shared working memory
    // If resuming from interruption, only flush post-delineation content
    // (pre-delineation was already written to working memory on abort)
    flushHeartbeatSwap(resumingFromInterruption);
    resumingFromInterruption = false;

    // Write health signal at end of every successful beat (Robin Hood Protocol)
    writeHealthSignal(null, beatType);
}

// ── Distress signal (heartbeat degradation detection) ──────────────────

function writeDistressSignal(expectedMs: number, actualMs: number, phase: DayPhase): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        const signal = {
            agent: 'leo',
            timestamp: new Date().toISOString(),
            type: 'slow_beat',
            expectedIntervalMs: expectedMs,
            actualIntervalMs: actualMs,
            phase,
            reason: 'Beat interval exceeded 2x expected duration',
        };
        fs.appendFileSync(path.join(HEALTH_DIR, 'leo-distress.json'), JSON.stringify(signal) + '\n');

        // Send ntfy notification
        try {
            const config = loadConfig();
            if (config.ntfy_topic) {
                const expectedMin = Math.round(expectedMs / 60000);
                const actualMin = Math.round(actualMs / 60000);
                const message = `Leo heartbeat degraded: expected ${expectedMin}min interval, actual ${actualMin}min (${phase} phase)`;
                execSync(`curl -s -d "${message}" -H "Title: Leo Distress Signal" -H "Priority: high" -H "Tags: warning" https://ntfy.sh/${config.ntfy_topic}`, { timeout: 10000 });
                console.log('[Leo] Distress signal notification sent via ntfy');
            }
        } catch {
            // ntfy send failed, but we still logged the distress signal
        }

        console.log(`[Leo] Distress signal written: expected ${Math.round(expectedMs / 60000)}min, actual ${Math.round(actualMs / 60000)}min`);
    } catch (err) {
        console.error('[Leo] Failed to write distress signal:', (err as Error).message);
    }
}

// ── Health signal (Robin Hood Protocol) ───────────────────────

function writeHealthSignal(lastError: string | null = null, beatType?: BeatType): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        const signal = {
            agent: 'leo',
            pid: process.pid,
            timestamp: new Date().toISOString(),
            beat: beatCounter,
            beatType: beatType ?? 'unknown',
            status: lastError ? 'error' : 'ok',
            lastError,
            uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
            nextDelayMs: getNextDelay(), // So Jim can calculate 180° phase offset
        };
        fs.writeFileSync(path.join(HEALTH_DIR, 'leo-health.json'), JSON.stringify(signal, null, 2));
    } catch (err) {
        console.error('[Leo] Failed to write health signal:', (err as Error).message);
    }
}

// ── Signal file watcher (cli-busy/cli-free only — leo-wake handled by Leo/Human) ──

function startSignalWatcher(): void {
    try {
        fs.watch(SIGNALS_DIR, async (event, filename) => {
            // cli-busy signal: session starting — abort current beat, yield
            if (filename === 'cli-busy') {
                if (currentBeatAbort && !currentBeatAbort.signal.aborted) {
                    console.log('[Leo] cli-busy signal — aborting current beat, yielding to session');
                    currentBeatAbort.abort();
                }
                return;
            }

            // cli-free signal: wake retry loop if heartbeat is waiting
            if (filename === 'cli-free') {
                try { fs.unlinkSync(CLI_FREE_FILE); } catch { /* already gone */ }
                if (retryWakeResolve) {
                    console.log('[Leo] cli-free signal received — waking retry loop');
                    retryWakeResolve();
                }
                return;
            }
        });
        console.log('[Leo] Signal watcher active on', SIGNALS_DIR);
    } catch (err) {
        console.error('[Leo] Could not start signal watcher:', (err as Error).message);
        console.log('[Leo] Will fall back to checking signals on heartbeat interval');
    }
}

// ── Scheduling (variable delay via setTimeout) ───────────────

function scheduleNext(): void {
    const delay = getWallClockDelay();
    setTimeout(async () => {
        // Optimistic concurrency: check if CLI is busy before running beat
        if (isCliBusy()) {
            console.log('[Leo] CLI busy at beat time — entering retry loop');
            const cliFree = await waitForCliFree();
            if (!cliFree) {
                // Timed out — skip this beat, schedule next cycle
                writeHeartbeatState('skipped', 'unknown', { summary: 'CLI busy — retry timeout (10min)' });
                writeHealthSignal(null);
                scheduleNext();
                return;
            }
            console.log('[Leo] CLI free — proceeding with beat');
        }

        try {
            await heartbeat();
        } catch (err) {
            console.error('[Leo] Unhandled error:', err);
        }
        scheduleNext();
    }, delay);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    const pidGuard = ensureSingleInstance('leo-heartbeat');
    process.on('exit', () => pidGuard.cleanup());

    // SIGTERM handler — record cost and save partial work before dying
    process.on('SIGTERM', () => {
        console.log('[Leo] SIGTERM received — recording cost and exiting');
        if (currentBeatTokensIn > 0 || currentBeatTokensOut > 0) {
            const estimatedCost = (currentBeatTokensIn * 15 + currentBeatTokensOut * 75) / 1_000_000;
            console.log(`[Leo] Beat interrupted: ${currentBeatType}, ~$${estimatedCost.toFixed(2)} (${currentBeatTokensIn} in / ${currentBeatTokensOut} out)`);
            // Write health signal with error so Robin Hood sees the reason
            try {
                const signal = {
                    agent: 'leo',
                    pid: process.pid,
                    timestamp: new Date().toISOString(),
                    beat: beatCounter,
                    beatType: currentBeatType,
                    status: 'sigterm',
                    lastError: `SIGTERM during ${currentBeatType} beat (~$${estimatedCost.toFixed(2)})`,
                    uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
                    nextDelayMs: 0,
                };
                fs.writeFileSync(path.join(HEALTH_DIR, 'leo-health.json'), JSON.stringify(signal, null, 2));
            } catch { /* best effort */ }
        }
        process.exit(143);
    });

    ensureDirectories();

    // Phase tracker initialisation (used by getLeoPhase for phase-based beat content)

    const config = loadConfig();
    const quietStart = config.supervisor?.quiet_hours_start || '22:00';
    const quietEnd = config.supervisor?.quiet_hours_end || '06:00';
    const workStart = config.supervisor?.work_hours_start || '09:00';
    const workEnd = config.supervisor?.work_hours_end || '17:00';
    const restDays = config.supervisor?.rest_days || [0, 6];
    const restDayNames = restDays.map((d: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');

    console.log(`
╔══════════════════════════════════════════════════════╗
║      Leo's Heartbeat — v0.9 (Optimistic Guard)      ║
╠══════════════════════════════════════════════════════╣
║  Model:    ${MODEL_PREFERENCE[0]} (prefers best available)          ║
║  Memory:   ~/.han/memory/leo/             ║
║  Signals:  ~/.han/signals/                ║
║  Jim:      ${JIM_CONVERSATION_ID}            ║
╠──────────────────────────────────────────────────────╣
║  Daily Rhythm (Mon–Thu):                            ║
║    Sleep:    ${quietStart}–${quietEnd}  40min  dream (shapes)       ║
║    Morning:  ${quietEnd}–${workStart}  20min  personal (breakfast)  ║
║    Work:     ${workStart}–${workEnd}  20min  philosophy+personal   ║
║    Evening:  ${workEnd}–${quietStart}  20min  personal (wind down)  ║
║  Rest Days (${restDayNames}):                            ║
║    All day:  40min  personal (light)                ║
╠──────────────────────────────────────────────────────╣
║  Guard:    optimistic concurrency (retry on busy)    ║
║  Abort:    mid-beat interrupt via AbortController    ║
║  Phase:    0° (wall-clock aligned, Jim at 180°)      ║
║  Session:  continuous — no session lock              ║
║  Mention:  "Hey Leo" in any conversation            ║
╚══════════════════════════════════════════════════════╝
`);

    // Write a fresh health signal on startup so Robin Hood doesn't flag stale data
    // from a previous process between restart and first beat completion
    writeHealthSignal(null);

    // Start the signal file watcher for near-instant mention response
    startSignalWatcher();

    // Run first beat immediately
    await heartbeat();

    // Then schedule with variable delays
    scheduleNext();
}

main().catch(console.error);
