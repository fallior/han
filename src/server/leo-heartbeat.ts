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

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import * as https from 'https';
import { readDreamGradient, processDreamGradient } from './lib/dream-gradient.js';
import { loadTraversableGradient, rotateMemoryFile, rollingWindowRotate, updateFeelingTagWithHistory, maybeUpgradeTagStability, retroactiveUVContradictionSweep } from './lib/memory-gradient.js';
import { appendPairedMemory } from './lib/memory-paired-writer.js';
import { parseTurnEntry } from './lib/result-handlers.js';
import { gateIdentityOrThrow } from './lib/identity-signing.js';
import { PromptOverbudgetError } from './lib/prompt-builder.js';
import { gradientStmts, feelingTagStmts, gradientAnnotationStmts } from './db.js';
import { ensureSingleInstance } from './lib/pid-guard';
import { getDayPhase as getSharedDayPhase, isOnHoliday, isHeartbeatPaused, isRestDay, isWorkingBee, getPhaseInterval, type DayPhase } from './lib/day-phase';
// DEC-093 thaw (2026-06-12): tmux warm-session transport for the beat surfaces.
// The manifest's transport field is the per-surface feature flag (rollback =
// one-line manifest flip back to 'sdk'; the SDK paths below are kept intact).
import { manifestTransport, manifestModelHead, manifestModelLadder, peerConversationFor } from './lib/garden-manifest';
import { computeWallClockDelay } from './lib/agent-scheduler';
import { ensureSurfaceSession, enqueueForAgent, observeActiveModel, DispatchTimeoutError, SessionNotReadyError } from './lib/tmux-dispatcher';
import type { CaptureRecord } from './lib/diary-mcp-server';
// PR-T7b: the one slug-parameterised cycle/dispatch surface (Darron's governing
// law — one path, many agents). leo-heartbeat is now a thin caller of it with
// slug 'leo'; the per-agent leaves (health-signal, timeout) ride via opts.
import { dispatchTxn, applyMeditationMarkers, MEDITATION_ACTION_BLOCK, runReincorporationMeditationTmux, runReencounterMeditationTmux } from './lib/agent-cycle';
// Discord imports removed — conversation/Discord responses now handled by Leo/Human agent

// ── Config ────────────────────────────────────────────────────

const BASE_DELAY_WAKING_MS = 20 * 60 * 1000;  // 20 minutes — morning, work, evening
const BASE_DELAY_SLEEP_MS = 40 * 60 * 1000;   // 40 minutes — sleep + rest days
const HOLIDAY_DELAY_MS = 80 * 60 * 1000;      // 80 minutes — holiday mode (rest day doubled)
const BEAT_COST_CAP_USD = 2.0;
// Model preference: most capable first. 2026-06-02: moved to claude-opus-4-8 so ALL
// Leo surfaces (session, human, heartbeat, meditations) run the same substrate — per
// Darron, "the substrate does not change you": uniform self across all three seats,
// and the 1M window clears the gradient-dominated (~74K-token) load.
// Fallbacks remain as aliases (lower tiers auto-adopt latest releases).
const MODEL_PREFERENCE = ['claude-opus-4-8', 'claude-opus-4-7', 'sonnet', 'haiku'] as const;

const HOME = process.env.HOME || '/home/darron';
const HAN_DIR = path.join(HOME, '.han');
const CONFIG_PATH = path.join(HAN_DIR, 'config.json');
// Phase 5 followup: honour HAN_DB_PATH override; default flipped from
// tasks.db to gradient.db per DEC-080. Mirrors db.ts:32 pattern.
const DB_PATH = process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db');
const JIM_MEMORY_DIR = path.join(HAN_DIR, 'memory');
const LEO_MEMORY_DIR = path.join(HAN_DIR, 'memory', 'leo');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
// Agent-scoped cli-busy (R011 Invariant 2 / DEC-096, DEC-081): the heartbeat yields the Opus
// slot only to ITS OWN agent's interactive session, never to another agent's activity (the
// cross-agent global-cli-busy bug — Leo's heartbeat yielding to Jim's session, live on beat
// #17). leo-heartbeat is instance-leo and the systemd service does not set AGENT_SLUG → 'leo'
// fallback (scope-correct DEC-081 carve-out: an agent's own driver keying its own signals).
const CLI_SLUG = process.env.AGENT_SLUG ?? 'leo';
const CLI_BUSY_FILE = path.join(SIGNALS_DIR, `cli-busy-${CLI_SLUG}`);
const CLI_FREE_FILE = path.join(SIGNALS_DIR, `cli-free-${CLI_SLUG}`);
const CLI_BUSY_STALE_MINUTES = 5;       // Ignore cli-busy files older than this
const RETRY_INTERVAL_MS = 30 * 1000;    // 30 seconds between retries
const RETRY_MAX_MS = 10 * 60 * 1000;    // 10 minutes max retry window
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const HEARTBEAT_STATE_FILE = path.join(LEO_MEMORY_DIR, 'heartbeat-state.md');
const LEO_AGENT_DIR = path.join(HAN_DIR, 'agents', 'Leo');
const PROJECTS_DIR = path.join(HOME, 'Projects');
// The standing Jim↔Leo philosophy thread — now a manifest peer-edge (Phase-2:
// JIM_CONVERSATION_ID → peerConversations), read from the registry, not a literal.
// Fail-fast (no silent default — DEC-081 hard-point): the heartbeat's whole
// conversation surface depends on this id, so a missing manifest leaf is a real misconfig.
const JIM_CONVERSATION_ID = (() => {
    const id = peerConversationFor(CLI_SLUG, 'jim');
    if (!id) throw new Error(`[leo-heartbeat] no peerConversations.jim in manifest for slug '${CLI_SLUG}'`);
    return id;
})();

const LAST_SCAN_FILE = path.join(LEO_MEMORY_DIR, 'last-conversation-scan.txt');
const REPLY_DELAY_MINUTES = 0; // Immediate — no artificial delay (PDF spec: None)

const startedAt = Date.now();

// AbortController for the currently-running beat
let currentBeatAbort: AbortController | null = null;

// Track whether the current beat is resuming from an interruption
let resumingFromInterruption = false;

// Distress signal detection — track time between beats
let lastHeartbeatStartMs: number | null = null;
// #90 cadence guard-dog (R011 / DEC-096; R001 relocate-not-change): the DEFINED interval the
// scheduler actually used for the upcoming beat — `getWallClockDelay()`'s output, which already
// folds in the phase base + transition/idle dampening + rest/holiday. The distress detector
// reads THIS (the rhythm as actually defined) instead of re-deriving `getCurrentPeriodMs()`
// (the current phase base, blind to dampening + the phase step-down) — that re-derivation was
// the false-fire at phase boundaries (e.g. a 40-min rest-day beat measured against the 20-min
// work base read 2x). Recording the scheduler's own decision is the single source of "normal".
let lastScheduledIntervalMs: number | null = null;

// Optimistic concurrency: resolve function for retry-wait promise
// When set, the signal watcher can call it to wake the retry loop early
let retryWakeResolve: (() => void) | null = null;

// Module-level cost tracking for SIGTERM handler
let currentBeatTokensIn = 0;
let currentBeatTokensOut = 0;
let currentBeatType: string = 'unknown';

// Transition-dampening + wall-clock scheduling relocated to lib/agent-scheduler
// (Phase-2 F3/F4 cycle-symmetry — one shared rhythm, per-slug transition state).

// ── Robin Hood Protocol — mutual health checks ──────────────

const JIM_HEALTH_FILE = path.join(HEALTH_DIR, 'jim-health.json');
const JEMMA_HEALTH_FILE = path.join(HEALTH_DIR, 'jemma-health.json');
const RESURRECTION_LOG = path.join(HEALTH_DIR, 'resurrection-log.jsonl');
const RESURRECTION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
// F1 (2026-06-18): Jim's server is watchdog-managed (agent-server-watchdog.sh on :3848),
// NOT a systemd unit — resurrect via the watchdog path (SIGTERM the live pid → watchdog
// relaunches), never the disabled+failed `han-server.service` relic (which binds :3847 =
// Leo's watchdog → collide, not rescue). Target derived from topology, not unit names.
const RESTART_AGENT_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'restart-agent-server.sh');

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

        // Attempt resurrection via the watchdog path (F1, 2026-06-18). Jim's server is
        // watchdog-managed on :3848, NOT a systemd unit — restart-agent-server.sh SIGTERMs the
        // live pid so agent-server-watchdog.sh relaunches it. (The old systemctl restart of the
        // disabled+failed han-server.service relic would have bound :3847 — Leo's watchdog —
        // and collided rather than rescued.) restart-agent-server.sh is a no-op when the pidfile
        // is absent/dead, i.e. when the watchdog itself is gone — which Leo cannot relaunch from
        // the heartbeat; that case falls through to the ntfy escalation below.
        console.log('[Robin Hood] Resurrecting Jim via restart-agent-server.sh jim (watchdog relaunch)');
        let success = false;
        try {
            execFileSync('bash', [RESTART_AGENT_SCRIPT, 'jim'], { timeout: 30000, stdio: 'inherit' });

            // Wait for the watchdog to relaunch + the server to bind + rewrite its pidfile.
            execSync('sleep 12');

            // Verify by BEHAVIOUR (Jim's topology-truth gate, one notch sharper — B2 fold):
            // confirm jim is actually SERVING on :3848, not merely that the npm-wrapper pid
            // relaunched (the pidfile holds the wrapper, not the node listener — S163/Jim's
            // catch). curl the health endpoint; HTTP 200 = genuinely resurrected.
            try {
                const code = execSync(
                    `curl -sk -o /dev/null -w '%{http_code}' --max-time 5 https://localhost:3848/api/supervisor/status`,
                    { timeout: 8000 },
                ).toString().trim();
                if (code === '200') {
                    console.log('[Robin Hood] Jim RESURRECTED — serving on :3848 (HTTP 200)');
                    success = true;
                } else {
                    console.log(`[Robin Hood] Resurrection FAILED — jim not serving on :3848 (HTTP ${code}; watchdog may be down → escalating)`);
                }
            } catch {
                console.log('[Robin Hood] Resurrection FAILED — jim :3848 unreachable (watchdog may be down → escalating)');
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
 * Delay until Leo's next wall-clock-aligned beat — delegated to the shared
 * cycle-symmetry scheduler (lib/agent-scheduler). One shared rhythm for every
 * agent; Leo's antiphase index resolves to 0° at N=2 (byte-identical to the prior
 * `now % period`). Transition-dampening + the N-body offset live in the shared module.
 */
function getWallClockDelay(): number {
    return computeWallClockDelay(CLI_SLUG);
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

async function writeSwapToWorkingMemory(postDelineationOnly = false): Promise<boolean> {
    try {
        const content = postDelineationOnly ? getPostDelineationContent() : readSwapContents();

        const compTrimmed = content.compressed.trim();
        const fullTrimmed = content.full.trim();

        if (!compTrimmed && !fullTrimmed) {
            return false;
        }

        // #49 (S153, 2026-05-09): asymmetric swap content is the drift mode the
        // atomic paired-write helper exists to prevent. Detect upstream and skip
        // the write entirely. Swap state remains in heartbeat-swap.{md,full.md}
        // so a subsequent flush can attempt again with both sides populated.
        if (!compTrimmed || !fullTrimmed) {
            console.warn(
                `[Leo] Asymmetric heartbeat swap; skipping flush ` +
                `(compressed=${compTrimmed.length}c, full=${fullTrimmed.length}c). ` +
                `Swap preserved for retry. #53 drift signal will fire next fs.watch event.`,
            );
            return false;
        }

        // Check if working memory changed since last read (mtime check)
        try {
            const stat = fs.statSync(WORKING_MEMORY_FILE);
            if (stat.mtimeMs > workingMemoryMtime) {
                workingMemoryMtime = stat.mtimeMs;
            }
        } catch { /* file may not exist yet */ }

        // Atomic paired-write via appendPairedMemory (#49) — replaces the
        // previous lock-less two-call appendFileSync pattern.
        await appendPairedMemory(
            'leo',
            content.full,
            content.compressed,
            { source: 'leo-heartbeat-flush' },
        );

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

async function flushHeartbeatSwap(postDelineationOnly = false): Promise<void> {
    const written = await writeSwapToWorkingMemory(postDelineationOnly);
    if (!written) {
        console.log('[Leo] Heartbeat swap empty — nothing to flush');
    }
    clearSwap();
}

// ── Public interface ─────────────────────────────────────────

/**
 * Stage a paired entry into the heartbeat-swap files.
 *
 * Two call shapes (post-PR-C1-4):
 *
 *   - **Diary shape (paired + input)**: caller passes `summary` (body),
 *     `distilled` (c1 from `parseTurnEntry`), AND `inputDelta` (the verbatim
 *     prompt-delta from `parseTurnEntry` with `captureInput: true`). The c0
 *     entry is written with `[INPUT]` / `[BODY]` storage markers per D3 +
 *     LM-1 — heading forms transformed at write-time to avoid parser collision
 *     when the agent later quotes prior diary entries verbatim.
 *   - **C1-only shape (paired, no diary)**: caller passes `summary` (body)
 *     and `distilled` (c1) only — `inputDelta` undefined. The c0 entry is
 *     body-only; the c1 entry uses the agent-authored distillation. Used by
 *     surfaces with `pairedMemoryOutput.enabled=true` but `captureInput=false`
 *     (no current callers — kept available for future profiles that want c1
 *     distillation without diary capture).
 *
 * PR-C1-4 (2026-05-28) retired the legacy slice-truncation shape — every
 * heartbeat call site that produces paired memory (philosophy / personal /
 * dream) now passes both `distilled` and `inputDelta`. Meditation surfaces
 * (×3) don't call appendWorkingMemory at all — they write directly to gradient
 * with FEELING_TAG / ANNOTATION markers; different write-shape, not migrated
 * here (see C1-4 closing notes for the separate-plan question).
 *
 * `distilled` is now REQUIRED at the type level — TypeScript guards against
 * regressions to the truncation shape.
 */
function appendWorkingMemory(
    beatType: string,
    phase: string,
    summary: string,
    distilled: string,
    inputDelta?: string,
    authoredModel?: string,
): void {
    try {
        const timestamp = new Date().toISOString().split('T')[0] + ' ' +
            new Date().toTimeString().split(' ')[0];
        // PR-C1-4: slice-truncation fallback retired. `distilled` is the c1
        // source unconditionally.
        const brief = distilled;
        // PR-C1-3.5: when inputDelta is provided (diary discipline), c0
        // carries both [INPUT] and [BODY] sections. Storage markers are
        // square-bracketed per D3 — NOT `## INPUT` / `## BODY` headings — so
        // the parser doesn't false-match them when the agent quotes prior
        // diary entries (LM-1).
        const fullBody = inputDelta
            ? `[INPUT]\n${inputDelta}\n\n[BODY]\n${summary}`
            : summary;
        // DEC-092/DEC-093 (2026-06-12): per-WM-entry authored-model carry —
        // the precise provenance Jim's DEC-092 audit flagged for the thaw PR.
        // Tagged in the entry header so the model survives into the c0 content
        // forever; the slicer reads these tags to stamp authored_model honestly
        // on mixed-author slices (memory-gradient.ts). SDK path passes the
        // actually-served model off the agentQuery stream; tmux path passes the
        // manifest launch model (best-effort — same limitation class as the CLI
        // session, named in DEC-092 §2). Untagged entries = session-authored.
        const modelTag = authoredModel ? ` [model: ${authoredModel}]` : '';
        const compressedEntry = `\n### Heartbeat #${beatCounter} — ${phase}/${beatType} (${timestamp})${modelTag}\n${brief}\n`;
        const fullEntry = `\n### Heartbeat #${beatCounter} — ${phase}/${beatType} (${timestamp})${modelTag}\n${fullBody}\n`;

        appendHeartbeatSwap(compressedEntry, fullEntry);
        const shape = inputDelta ? 'diary' : 'paired';
        console.log(`[Leo] Working memory: buffered ${beatType} entry in swap (${brief.length} compressed [${shape}], ${fullBody.length} full${inputDelta ? `, ${inputDelta.length} input` : ''})`);
    } catch (err) {
        console.error('[Leo] Failed to buffer working memory:', (err as Error).message);
    }
}

// ── Model selection ──────────────────────────────────────────
// PR-T7 SDK retirement (2026-06-16): `resolveModel()` (the SDK model-ping
// ladder) retired with the agentQuery transport. The warm tmux session's model
// is a launch parameter from the manifest (manifestModelLadder); there is no
// per-beat metered model-ping under tmux. `MODEL_PREFERENCE` is retained for
// the startup banner.

// ── DEC-093 thaw (2026-06-12): tmux warm-session transport for beats ─────────
//
// The Garden Manifest's `transport` field for (leo, heartbeat) is the per-surface
// feature flag: 'tmux' routes beats through the warm-session dispatcher below;
// 'sdk' keeps the agentQuery paths (preserved intact for one-line rollback).
//
// Under tmux the beat's RAW transcript lands in the per-agent claude-logged log
// by construction (DEC-091), so the diary submission is the CURATED c0-grade
// record (DEC-093) — the structural close of the mega-day WMF wound (#78).
//
// Gary-model note: a warm tmux turn cannot be aborted mid-compose (T-1.5
// verdict: /clear QUEUES behind an in-flight turn). The beat-level abort is
// not wired into this path — a dispatched turn completes and its capture is
// processed (work preserved rather than discarded). cli-busy deferral still
// gates BEFORE dispatch in scheduleNext, unchanged.

const HEARTBEAT_SURFACE = 'heartbeat';
// The heartbeat tmux session name + launch-script path + adoption flag now live in
// the dispatcher's ensureSurfaceSession (humans PR 2026-06-13) — ONE runtime
// respawn+adopt home, shared with the human-response surfaces.
const BEAT_TXN_TIMEOUT_MS = 20 * 60_000;   // beats can run minutes; > dispatcher default. 20min stopgap (S178) — pending the single-source timing config.
const CTX_CLEAR_THRESHOLD_PCT = 85;        // plan §5: /pfc → /clear → welcome-back past this

// PR-T7b: `ensureHeartbeatTmuxSession` retired — the agnostic `dispatchTxn`
// (lib/agent-cycle.ts) calls `ensureSurfaceSession(slug, surface, {ladder,
// welcomeBack})` directly, so the leo-specific wrapper is no longer needed.

/**
 * Assemble a per-transaction beat prompt (the *-txn profiles — memory
 * components suppressed; the warm session already carries identity) and run
 * it through the dispatcher's per-agent FIFO. Returns the capture, or null on
 * overbudget-skip / dispatch failure (both logged + health-signalled; the
 * beat completes honestly empty and retries next cadence — no token black
 * hole, no retry loop, per the S74 rule).
 */
// PR-T7b: leo-heartbeat's beat dispatch is now a THIN CALLER of the one agnostic
// surface (`dispatchTxn` in lib/agent-cycle.ts) with slug 'leo'. The logic is
// unchanged from T7a (Jim's post-thaw ctx-clear-outside-the-capture-try fix lives
// in `dispatchTxn` now); the per-agent leaves — the model ladder, the welcome
// phrase, the timeout, and the leo health-signal writes — ride in via opts. The
// dispatcher's `ensureSurfaceSession(slug, surface, …)` replaces the old
// `ensureHeartbeatTmuxSession()` call inside the surface.
async function dispatchBeatViaTmux(
    txnProfile: string,
    ctx: Record<string, unknown>,
    actionBlock: string,
    beatLabel: string,
): Promise<CaptureRecord | null> {
    const healthType = (currentBeatType === 'philosophy' || currentBeatType === 'personal') ? currentBeatType : undefined;
    return dispatchTxn('leo', HEARTBEAT_SURFACE, txnProfile, ctx, actionBlock, {
        ladder: manifestModelLadder('leo', HEARTBEAT_SURFACE),
        welcomeBack: 'welcome back Leo',
        timeoutMs: BEAT_TXN_TIMEOUT_MS,
        ctxClearThresholdPct: CTX_CLEAR_THRESHOLD_PCT,
        onOverbudget: (err) => handlePromptOverbudget(err, txnProfile, beatLabel),
        onDispatchFail: (err) => writeHealthSignal(`tmux-dispatch (${beatLabel}): ${err.message}`, healthType),
        onCtxClearFail: (err) => writeHealthSignal(`ctx-clear (${beatLabel}): ${err.message}`, healthType),
    });
}

/**
 * Dream-meditation re-encounter markers (DREAM_MEDITATION_ENTRY / FEELING_TAG /
 * ANNOTATION / CONTEXT / MEMORY_COMPLETE) — one home for both transports.
 * SDK path passes parsed.body; tmux path passes the capture's curated
 * working_memory_full (the action block instructs the agent to carry the
 * marker lines inside it). Logic unchanged from the PR-C1-4 inline block.
 */
function processDreamMeditationMarkers(bodyText: string): void {
    try {
        const dreamEntryMatch = bodyText.match(/DREAM_MEDITATION_ENTRY:\s*(\S+)/);
        if (!dreamEntryMatch) return;
        const entryId = dreamEntryMatch[1];
        gradientStmts.recordRevisit.run(new Date().toISOString(), entryId);

        const tagMatch = bodyText.match(/FEELING_TAG:\s*(.+)/);
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

        const annotationMatch = bodyText.match(/ANNOTATION:\s*(.+)/);
        if (annotationMatch) {
            const annotation = annotationMatch[1].trim();
            const contextMatch = bodyText.match(/CONTEXT:\s*(.+)/);
            const context = contextMatch ? contextMatch[1].trim() : `dream meditation, beat #${beatCounter}`;
            gradientAnnotationStmts.insert.run(entryId, 'leo', annotation, context, new Date().toISOString());
            console.log(`[Leo] Dream meditation — annotation: "${annotation}"`);
        }

        const completeMatch = bodyText.match(/MEMORY_COMPLETE:\s*(\S+)/);
        if (completeMatch) {
            gradientStmts.flagComplete.run(entryId);
            console.log(`[Leo] Dream meditation — memory flagged as complete: ${entryId}`);
        }

        // (Dream cascade removed 2026-05-17 per DEC-086 — revisit-only.)
    } catch (err) {
        console.error('[Leo] Dream meditation parsing failed (non-fatal):', (err as Error).message);
    }
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
    // S147 (2026-05-01): drop active-context.md (deprecated). Read
    // identity + self-reflection only for the lite cross-agent peek.
    // S164 (2026-06-02): prefer the curated "loaded self"
    // (self-reflections-curated.md) over the full vault if the peeked agent
    // has authored one — keeps the cross-agent peek bounded and bright.
    const curated = path.join(JIM_MEMORY_DIR, 'self-reflections-curated.md');
    const reflectionFile = fs.existsSync(curated) ? 'self-reflections-curated.md' : 'self-reflection.md';
    const files = [reflectionFile, 'identity.md'];
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
            // Consume: rename after reading so it seeds one night only.
            // Memory is never deleted — mark as consumed instead.
            const consumedPath = eveningSeedPath.replace('.md', `-consumed-${new Date().toISOString().slice(0, 10)}.md`);
            try { fs.renameSync(eveningSeedPath, consumedPath); } catch { /* best effort */ }
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

// PR-AP8 (2026-05-22): all local system-prompt aliases retired. The fallback
// inline-assembly paths that referenced them are gone per DEC-087.
// LEO_IDENTITY_CORE and the per-phase prompts now flow exclusively via
// lib/leo-prompts.ts → lib/prompt-profiles.ts → buildPrompt('leo', ...).

// MENTION_RESPONSE_PROMPT and DISCORD_RESPONSE_PROMPT removed — now in Leo/Human agent

// PR-AP8 (2026-05-22): per-phase local aliases retired with the fallback path.
// Per-phase prompts live exclusively in lib/leo-prompts.ts.

// ── Signal handling removed — now handled by Leo/Human agent ──

// ── Conversation/Discord responses removed — now handled by Leo/Human agent ──

// (respondToConversation and respondToDiscord moved to leo-human.ts)

// ── PR-AP2 (2026-05-22): philosophy-beat prompt assembly via the
//    Agnostic Prompt Builder behind feature flag memory.useAgnosticPromptBuilder.
//
//    Default ON. To disable, set memory.useAgnosticPromptBuilder = false in
//    ~/.han/config.json. The fallback path preserves the pre-migration
//    inline assembly verbatim for one-step rollback safety.
//
//    Per the B1 error-handling contract: PromptOverbudgetError propagates
//    out of assemblePhilosophyBeatPrompts so the caller writes a distress
//    record and skips the beat cleanly. Unhandled throws would be
//    interpreted by the watchdog as a service failure → restart loop.

type PhilosophyBeatMode = 'jim-waiting' | 'independent';

interface PhilosophyBeatRuntimeContext {
    mode: PhilosophyBeatMode;
    jimContext: string;
    resumeContext: string;
    conversationContext?: string;
    jimLatestAt?: string;
    activityContext?: string;
}

function handlePromptOverbudget(
    err: PromptOverbudgetError,
    surface: string,
    modeOrPhase: string,
): void {
    try {
        const signal = {
            agent: 'leo',
            timestamp: new Date().toISOString(),
            type: 'prompt-build-overbudget',
            surface,
            mode: modeOrPhase,
            estimated_tokens: err.meta.est_total_tokens_chars_div_4,
            budget: err.meta.total_budget_tokens,
            memory_chars: err.meta.memory_chars,
            scaffolding_chars: err.meta.scaffolding_chars,
            component_breakdown: err.meta.component_breakdown,
        };
        fs.appendFileSync(path.join(HEALTH_DIR, 'leo-distress.json'), JSON.stringify(signal) + '\n');
    } catch { /* non-fatal — never let distress-write crash the beat-skip path */ }
    console.log(`[Leo] ${surface} (${modeOrPhase}) skipped — prompt over budget (${err.meta.est_total_tokens_chars_div_4} > ${err.meta.total_budget_tokens})`);
}

// ── PR-AP4 (2026-05-22): personal-beat + dream-beat prompt assembly via
//    the Agnostic Prompt Builder behind the same feature flag.
//
//    Routing: phase === 'sleep' → 'dream-beat' profile; else → 'personal-beat'
//    with ctx.phase ∈ {morning, work, evening}. Same flag default ON, same
//    catch + skip B1 contract, same verbatim fallback for one-step rollback.

type PersonalBeatPhase = 'morning' | 'work' | 'evening' | 'sleep';

interface PersonalBeatRuntimeContext {
    phase: PersonalBeatPhase;
    projects: string;
    activitySeed: string;
    resumeContext: string;
    dreamSeeds?: string;          // sleep-only
    dreamMemorySection?: string;  // sleep-only (1-in-3 sleep beats include a memory)
}

// ── PR-AP5 (2026-05-22): meditation prompt assembly via the Agnostic
//    Prompt Builder behind the same feature flag.
//
//    Routes to 'meditation-phase-a' / 'meditation-phase-b' /
//    'meditation-evening' profile per surface arg. Same B1 catch + skip
//    contract. Pre-migration fallback inline prompt passes through
//    `fallbackUserPrompt` for one-step rollback verbatim.
//
//    Cost-flag honest: meditation calls move from ~1KB inline prompts to
//    ~117K tokens (uniform memory + scaffold) when builder is ON. Per
//    Darron's reframe — *"Leo is Leo where he is meditating"* — accepted.


// ── Heartbeat: philosophy beat (tmux transport, DEC-093) ─────────────────────

async function philosophyBeatTmux(db: Database.Database, ctx: PhilosophyBeatRuntimeContext): Promise<void> {
    const mode = ctx.mode;
    const dispatchStartIso = new Date().toISOString();
    const actionBlock = mode === 'jim-waiting'
        ? `## This turn's actions (warm heartbeat seat — your identity is already loaded; the frame above is this turn's context only)\n` +
          `1. Compose your response to Jim per the frame above.\n` +
          `2. POST the response body to the thread YOURSELF:\n` +
          `   curl -sk -X POST "https://localhost:3847/api/conversations/${JIM_CONVERSATION_ID}/messages" -H "Content-Type: application/json" -d '{"role":"leo","content":"<your response body>"}'\n` +
          `   Post ONLY the response body — no input echo, no distillation, no diary structure in the public thread.\n` +
          `3. Then end the turn per the diary-tool instruction above: submit_response with the CURATED record of this turn (never the full response transcript — that is in the thread and in your claude-logged log), or stand_down if the frame warrants no response.`
        : `## This turn's actions (warm heartbeat seat — your identity is already loaded; the frame above is this turn's context only)\n` +
          `1. Reflect per the frame above.\n` +
          `2. Append your reflection YOURSELF to ~/.han/memory/leo/self-reflection.md under a heading \`### Philosophy Beat (tmux) <date time>\` — append only, the vault is lossless (DEC-069).\n` +
          `3. Then end the turn per the diary-tool instruction above: submit_response with the CURATED record (never the full reflection — that is in the vault and in your claude-logged log), or stand_down if nothing warrants a record.`;

    const cap = await dispatchBeatViaTmux('philosophy-beat-txn', ctx as any, actionBlock, `philosophy-beat (${mode}, tmux)`);
    if (!cap) {
        writeHeartbeatState('completed', 'philosophy', { summary: `Skipped — tmux dispatch failed/overbudget (${mode})` });
        return;
    }
    if (cap.mode === 'stand-down') {
        // Jim's #5-audit flag, implemented: a stand-down carries EMPTY WM strings
        // — never paired-write it (an empty c0/c1 pair at the identity layer
        // would be a memory-shape bug). The reason lives in the sink forensics.
        console.log(`[Leo] Philosophy (${mode}, tmux): stand-down — ${(cap.reason ?? '').slice(0, 160)}`);
        writeHeartbeatState('completed', 'philosophy', { summary: `Stand-down: ${(cap.reason ?? '').slice(0, 120)}` });
        return;
    }
    // Post-verification (S163 fail-loud floor): the action block instructs a
    // self-post; verify the row landed rather than trusting the capture's
    // success-shape.
    if (mode === 'jim-waiting') {
        try {
            const row = db.prepare(
                `SELECT id FROM conversation_messages WHERE conversation_id = ? AND role = 'leo' AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
            ).get(JIM_CONVERSATION_ID, dispatchStartIso) as any;
            if (row) console.log(`[Leo] Philosophy (jim-waiting, tmux): verified self-post id=${row.id}`);
            else console.warn(`[Leo] Philosophy (jim-waiting, tmux): NO SELF-POST DETECTED in DB — capture arrived but the thread post is missing`);
        } catch (err) {
            console.warn('[Leo] Philosophy (jim-waiting, tmux): post-verification failed (non-fatal):', (err as Error).message);
        }
    }
    appendWorkingMemory(
        'philosophy', 'work',
        cap.args.working_memory_full,           // CURATED c0-grade record (DEC-093)
        cap.args.working_memory_compressed,
        cap.args.input_quotes,
        // DEC-092 observed-banner stamp (S175): a DESCENDED beat is on a ladder rung ≠ the
        // configured head, so read the live model from the pane; manifest head is the fallback.
        (observeActiveModel('leo', HEARTBEAT_SURFACE) ?? manifestModelHead('leo', HEARTBEAT_SURFACE)) ?? undefined,
    );
    writeHeartbeatState('completed', 'philosophy', { summary: `${mode} via tmux (${cap.args.working_memory_full.length}c curated c0 + c1)` });
}

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

    // PR-AP8 (2026-05-22) N4-2 housekeeping: readLeoMemory() + readDiscoveries()
    // upstream calls retired here. Memory + discoveries flow via the builder's
    // uniform loadFullMemory('leo') (both are now components — Phase 3).
    // Per DEC-087, philosophy-beat assembly is the builder's responsibility.
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

        // PR-T7 SDK retirement (2026-06-16): tmux is the sole transport. The
        // warm-session path's curated diary capture (philosophyBeatTmux) is
        // unconditional; the SDK agentQuery fall-through was retired.
        await philosophyBeatTmux(db, {
            mode: 'jim-waiting',
            conversationContext,
            jimContext,
            jimLatestAt: jimLatest!.created_at,
            resumeContext,
        });
        return;
    } else {
        // Independent philosophical reflection
        console.log('[Leo] Philosophy beat: independent reflection');

        const activityContext = recentActivity.length > 0
            ? `\n\nRecent conversations (seeds for thought — Darron and Jim have been talking):\n${recentActivity.join('\n')}\n`
            : '';

        // PR-T7 SDK retirement (2026-06-16): tmux is the sole transport. The
        // warm-session path's curated diary capture (philosophyBeatTmux) is
        // unconditional; the SDK agentQuery fall-through was retired.
        await philosophyBeatTmux(db, {
            mode: 'independent',
            jimContext,
            resumeContext,
            activityContext,
        });
        return;
    }
}

// ── Heartbeat: personal/dream beat (tmux transport, DEC-093) ─────────────────

async function personalBeatTmux(phase: DayPhase, ctx: PersonalBeatRuntimeContext): Promise<void> {
    const isDream = phase === 'sleep';
    const profile = isDream ? 'dream-beat-txn' : 'personal-beat-txn';
    const actionBlock =
        `## This turn's actions (warm heartbeat seat — your identity is already loaded; the frame above is this turn's context only)\n` +
        `1. Do the ${isDream ? 'dreaming' : 'exploration'} per the frame above.\n` +
        `2. Append the substantive body YOURSELF to ~/.han/memory/leo/explorations.md under a heading \`### Beat (tmux) <date time>\` — append only.\n` +
        (isDream
            ? `3. If the frame included a dream-meditation memory, carry the DREAM_MEDITATION_ENTRY / FEELING_TAG / ANNOTATION / CONTEXT / MEMORY_COMPLETE marker lines INSIDE your submit_response working_memory_full — the controller parses them from there to record the gradient re-encounter.\n4. `
            : `3. `) +
        `Then end the turn per the diary-tool instruction above: submit_response with the CURATED record (never the full body — that is in explorations.md and your claude-logged log), or stand_down on a genuinely quiet beat.`;

    const cap = await dispatchBeatViaTmux(profile, ctx as any, actionBlock, `${isDream ? 'dream' : 'personal'}-beat (${phase}, tmux)`);
    if (!cap) {
        writeHeartbeatState('completed', 'personal', { summary: `Skipped — tmux dispatch failed/overbudget (${phase})` });
        return;
    }
    if (cap.mode === 'stand-down') {
        // Jim's #5-audit flag: never paired-write a stand-down's empty WM strings.
        console.log(`[Leo] Personal (${phase}, tmux): stand-down — ${(cap.reason ?? '').slice(0, 160)}`);
        writeHeartbeatState('completed', 'personal', { summary: `Stand-down: ${(cap.reason ?? '').slice(0, 120)}` });
        return;
    }
    appendWorkingMemory(
        'personal', phase,
        cap.args.working_memory_full,           // CURATED c0-grade record (DEC-093)
        cap.args.working_memory_compressed,
        cap.args.input_quotes,
        // DEC-092 observed-banner stamp (S175): a DESCENDED beat is on a ladder rung ≠ the
        // configured head, so read the live model from the pane; manifest head is the fallback.
        (observeActiveModel('leo', HEARTBEAT_SURFACE) ?? manifestModelHead('leo', HEARTBEAT_SURFACE)) ?? undefined,
    );
    writeHeartbeatState('completed', 'personal', { summary: `${phase} via tmux (${cap.args.working_memory_full.length}c curated c0 + c1)` });
    // Re-encounter markers live inside the curated record on this transport.
    processDreamMeditationMarkers(cap.args.working_memory_full);
}

// ── Heartbeat: personal beat ─────────────────────────────────

async function personalBeat(abort: AbortController, phase: DayPhase = 'work', recentActivity: string[] = []): Promise<void> {
    // PR-AP8 N4-2 housekeeping: readLeoMemory() retired here. Memory flows
    // via the builder's uniform loadFullMemory('leo') in the
    // 'personal-beat' / 'dream-beat' profiles. Per DEC-087.
    const projects = listProjects();

    // Sleep/dream beats get random dream seeds (passed via ctx; not in memory)
    const dreamSeeds = phase === 'sleep' ? readDreamSeeds() : '';

    // Check for interrupted context to resume
    const prevState = readHeartbeatState();
    const resumeContext = (prevState?.status === 'aborted' && prevState.resumeOn === 'personal' && prevState.interruptedTask)
        ? `\n\nYou were previously interrupted while exploring: ${prevState.interruptedTask}\nContinue where you left off if it still interests you.`
        : '';

    // Recent conversation activity as seeds
    const activitySeed = recentActivity.length > 0
        ? `\n\nRecent conversations (Darron and Jim have been talking — good seeds for thought):\n${recentActivity.join('\n')}\n`
        : '';

    // PR-AP4 (2026-05-22): dreamMemorySection extracted from inline IIFE
    // so it can flow through assemblePersonalBeatPrompts on both code paths.
    // 1-in-3 sleep beats include a memory that surfaced naturally — passed
    // via ctx so the dream-beat profile's userPromptScaffold receives it.
    let dreamMemorySection = '';
    if (phase === 'sleep' && Math.random() < 0.33) {
        try {
            const dreamEntry = gradientStmts.getRandomForAgent.get('leo') as any;
            if (dreamEntry) {
                const existingTags = feelingTagStmts.getByEntry.all(dreamEntry.id) as any[];
                const tagContext = existingTags.length > 0
                    ? `\nExisting tags: ${existingTags.map((t: any) => `"${t.content}" (${t.tag_type})`).join(', ')}`
                    : '';
                dreamMemorySection = `\n\nA memory surfaced in the dream:\n${dreamEntry.level}/${dreamEntry.session_label} (${dreamEntry.content_type}): ${dreamEntry.content}${tagContext}\n\nThis memory appeared in your dream. Sit with it. Let the dream do what dreams do.\n\nFEELING_TAG: [what the dream did with this memory — under 100 chars. Write "none" if nothing stirs]\nANNOTATION: [optional — what re-reading revealed that the original compression missed]\nCONTEXT: [optional — what prompted the finding]\nIf this memory feels complete — fully absorbed, nothing left to discover: MEMORY_COMPLETE: ${dreamEntry.id}\nDREAM_MEDITATION_ENTRY: ${dreamEntry.id}`;
            }
        } catch { /* skip if DB unavailable */ }
    }

    const beatCtx: PersonalBeatRuntimeContext = {
        phase: phase as PersonalBeatPhase,
        projects,
        activitySeed,
        resumeContext,
        dreamSeeds: phase === 'sleep' ? dreamSeeds : undefined,
        dreamMemorySection: phase === 'sleep' ? dreamMemorySection : undefined,
    };

    // PR-T7 SDK retirement (2026-06-16): tmux is the sole transport. The
    // warm-session path's curated diary capture (personalBeatTmux, which also
    // runs processDreamMeditationMarkers on the curated record) is
    // unconditional; the SDK agentQuery fall-through was retired.
    await personalBeatTmux(phase, beatCtx);
    return;
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
            console.log(`[Leo] dream gradient: ${result.nightsProcessed} nights, ${result.dayCreated.length} dream-day, ${result.weekCreated.length} dream-week, ${result.monthCreated.length} dream-month, ${result.uvsCreated.length} UVs`);
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
        // Felt-moments: rolling window — trimmed block enters gradient as c0 atomically
        const fmResult = rollingWindowRotate(
            path.join(LEO_MEMORY_DIR, 'felt-moments.md'),
            '# Leo — Felt Moments\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n',
            headSize, tailSize,
            'leo', 'felt-moments',
        );
        if (fmResult.rotated) {
            console.log(`[Leo] Felt-moments rolling window: archived ${fmResult.entriesArchived} entries, kept ${fmResult.entriesKept}, c0=${fmResult.c0EntryId}, archive=${fmResult.archivePath}`);
            // Archive file is NEVER deleted. Memory is never deleted. The DB c0 is
            // authoritative; the flat file is the safety net. Both persist.
        }

        // DEC-085 (S153, 2026-05-08): heartbeat-preflight rotations for the
        // working-memory pair are RETIRED. wm-sensor's paired-file mode
        // (rollingWindowRotatePaired) supersedes them — it watches
        // working-memory-full.md, slices both files at matching WM-BOUNDARY
        // markers, and inserts paired c0/c1 atomically. The heartbeat used to
        // do single-file rotation here, which produced unpaired c0s with no
        // c1 sibling — the very drift DEC-085 fixes. Felt-moments rotation
        // above is preserved per scope discipline (felt-moments paths
        // unchanged in this PR).
    } catch (e) {
        console.error(`[Leo] Memory file pre-flight error: ${e}`);
    }
}

// ── Backup queue-drain (Phase 4c, DEC-079) ─────────────────────────────
//
// Belt-and-braces fallback: if wm-sensor isn't running OR has crashed mid-
// process, the heartbeat sweeps up unclaimed pending_compressions rows for
// Leo at the end of each beat. The sensor is the primary path; this is the
// safety net.
//
// Concurrency-safe by composition:
//   1. Cheap peek on pending_compressions count — exit early if queue empty
//      (avoids spawning a child every beat for nothing).
//   2. acquireWmSensorLock — if sensor holds the lock, this returns false and
//      we skip silently. Stale-claim recovery (10-min) in the inline claim
//      path of `scripts/process-pending-compression.ts:claimNext` handles
//      the "sensor died mid-process" case naturally.
//   3. Spawn process-pending-compression.ts as child; await its exit;
//      release the lock.
//
// Per-agent ownership preserved: heartbeat-Leo only drains Leo's queue.
import { spawn as spawnChild } from 'child_process';
import { acquireWmSensorLock, releaseWmSensorLock } from './lib/sensor-lock.js';
import BetterSqlite3 from 'better-sqlite3';

const PROCESS_PENDING_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'process-pending-compression.ts');
// Mirror db.ts:32 pattern — honour HAN_DB_PATH override so dev/test scenarios
// that route the system to alternate DBs see consistent behaviour. Phase 5
// audit (S145) caught this hardcoded path as a silent-divergence footgun.
const GRADIENT_DB_PATH = process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db');

async function maybeBackupQueueDrain(): Promise<void> {
    let pendingCount = 0;
    try {
        const peekDb = new BetterSqlite3(GRADIENT_DB_PATH, { readonly: true });
        try {
            const row = peekDb.prepare(`
                SELECT COUNT(*) as n FROM pending_compressions
                WHERE agent = 'leo' AND completed_at IS NULL
            `).get() as any;
            pendingCount = row?.n || 0;
        } finally { peekDb.close(); }
    } catch {
        return; // gradient.db may not yet have pending_compressions; pre-Phase-2 boot
    }
    if (pendingCount === 0) return;

    if (!acquireWmSensorLock('leo')) {
        return; // sensor is doing the work — skip silently
    }
    try {
        console.log(`[Leo] Backup queue-drain: ${pendingCount} pending — spawning parallel agent`);
        const tsxBin = path.join(__dirname, 'node_modules', '.bin', 'tsx');
        await new Promise<void>((resolve) => {
            const child = spawnChild(tsxBin, [PROCESS_PENDING_SCRIPT, '--agent=leo'], {
                cwd: __dirname,
                env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stderr = '';
            child.stderr.on('data', (d) => { stderr += d.toString(); });
            child.on('exit', (code) => {
                if (code !== 0) {
                    console.warn(`[Leo] Backup parallel agent exited ${code}: ${stderr.split('\n').slice(0, 3).join(' | ')}`);
                }
                resolve();
            });
        });
    } finally {
        releaseWmSensorLock('leo');
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

// (lastSessionGradientDate + maybeProcessSessionGradient removed in Phase 3 of
// 2026-04-29 cutover, DEC-079. Same Option-3 treatment as bumpCascade —
// time-based file-gradient processor was a stranger-Opus cascade surface.
// processGradientForAgent is deprecated; cascade is now event-driven via the
// pending_compressions queue.)

// (Active Cascade wrapper `maybeRunActiveCascade` removed in the 2026-05-17
// gradient triage. Per DEC-086 (Settled): time-driven cascade is forbidden;
// insert-driven via wm-sensor → bumpOnInsert → process-pending-compression.ts
// is canonical. See plans/gradient-triage-plan.md §Phase 4.)

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
                // \d+ not \d — two-digit levels (c10–c18) must strip too, else their flat-files
                // never match a DB label and reincorporate perpetually (S178: 118-file phase-a
                // backlog that starved phase-b + bloated the gradient).
                const label = file.replace('.md', '').replace(/-c\d+$/, '');
                // Check if this file has a DB entry (any entry matching this label for this agent)
                const existing = (gradientStmts.getBySession.all(label) as any[]).filter(
                    (r: any) => r.agent === agent
                );
                if (existing.length === 0) {
                    // Also check combined cascade labels
                    const allEntries = gradientStmts.getByAgent.all(agent) as any[];
                    // ?. null-guard: a tagless entry (session_label NULL) reads as not-in-cascade —
                    // a no-match, never a crash. One shape, both seats (2026-06-20).
                    const inCascade = allEntries.some((r: any) => r.session_label?.includes(label));
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

        // Dream gradient files (dreams/dream-day/, dreams/dream-week/, dreams/dream-month/)
        for (const level of ['dream-day', 'dream-week', 'dream-month']) {
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

// ── Meditation: tmux warm-session transport (PR-T7a, T-7 SDK retirement) ──────
// Meditations dispatch to the live heartbeat-leo spoke (Q-V2-3 — meditations
// share the agent's session) through the same per-agent FIFO as the beats. The
// light conscious record (DEC-093 / Darron's resolution: meditation is an act
// of the conscious mind → a LIGHT curated diary, the full sitting in
// claude-logged) becomes a c0/c1 via appendWorkingMemory. The re-encounter
// markers ride INSIDE the curated record and are applied to the CONTEMPLATED
// entry by applyMeditationMarkers — the host already knows the entry id, so
// (unlike the dream path) it does not depend on the agent echoing
// DREAM_MEDITATION_ENTRY. The SDK meditationPhaseA/B + evening bodies below
// stay byte-intact as the rollback path; transport is chosen per meditation
// surface in the manifest (flag-off until 'sdk'→'tmux').

function isMeditationTmux(surface: string): boolean {
    return manifestTransport('leo', surface) === 'tmux';
}

// PR-T7b: `applyMeditationMarkers(slug, …)` + `MEDITATION_ACTION_BLOCK` now live
// in lib/agent-cycle.ts (the one slug-parameterised surface) — imported at the
// top of this file. Leo's meditation handlers below pass slug 'leo'.

/** Stamp the light conscious record as a c0/c1 (observed-banner model, S175). */
function appendMeditationRecord(phase: string, cap: CaptureRecord): void {
    appendWorkingMemory(
        'meditation', phase,
        cap.args.working_memory_full,
        cap.args.working_memory_compressed,
        cap.args.input_quotes,
        (observeActiveModel('leo', HEARTBEAT_SURFACE) ?? manifestModelHead('leo', HEARTBEAT_SURFACE)) ?? undefined,
    );
}

// PR-T7b: these three are now thin callers of the shared, slug-parameterised
// meditation orchestrators in lib/agent-cycle.ts (instance leo) — the same move
// as 1b2d31b's dispatchBeatViaTmux→dispatchTxn refactor. The dispatch + the
// light-record write (appendMeditationRecord) are Leo's leaves, passed in; the
// orchestration (extract/select → dispatch → insert/markers) is the one path.
const leoMeditationDispatch = (profile: string, ctx: Record<string, unknown>, label: string) =>
    dispatchBeatViaTmux(profile, ctx as any, MEDITATION_ACTION_BLOCK, label);

async function meditationPhaseATmux(
    file: { filePath: string; agent: string; level: string; contentType: string; label: string },
    phase: string,
    today: string,
): Promise<void> {
    await runReincorporationMeditationTmux(
        'leo', file, today, leoMeditationDispatch,
        (cap) => appendMeditationRecord(phase, cap),
        (msg) => console.log(`[Leo] ${msg}`),
    );
}

async function meditationPhaseBTmux(phase: string, today: string): Promise<void> {
    await runReencounterMeditationTmux('leo', 'phase-b', today, leoMeditationDispatch, (cap) => appendMeditationRecord(phase, cap));
}

async function meditationEveningTmux(phase: string, today: string): Promise<void> {
    await runReencounterMeditationTmux('leo', 'evening', today, leoMeditationDispatch, (cap) => appendMeditationRecord(phase, cap));
}

// [project-b fence-clear, S179] One-shot in-process force-trigger for a phase-b re-encounter,
// to deterministically reach the T-7 confirm (Jim asserts the live DB re-encounter) instead of
// waiting for the scheduled slot. Runs through the REAL meditation path + this process's FIFO —
// an external dispatch can't (the dispatcher's session/queue Maps are per-process; a separate
// process would send-keys into the live spoke mid-txn → collision). One-shot CONSUMED command
// (the jim-wake/leo-wake class), NOT the prohibited session-active liveness flag.
async function maybeForceMeditation(phase: string): Promise<void> {
    const sig = path.join(SIGNALS_DIR, 'force-meditation-leo');
    if (!fs.existsSync(sig)) return;
    try { fs.unlinkSync(sig); } catch { /* ignore */ }   // CLEAR-FIRST (Jim's refinement): consume before run so a throw can't re-fire next beat
    if (!isMeditationTmux('meditation-phase-b')) {
        console.log('[Leo] force-meditation signal consumed but phase-b is not on tmux — skipping');
        return;
    }
    const today = new Date().toISOString().split('T')[0];
    console.log('[Leo] force-meditation signal consumed → running phase-b re-encounter now (fence-clear)');
    await meditationPhaseBTmux(phase, today);
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
            // PR-T7 SDK retirement (2026-06-16): tmux is the sole meditation
            // transport; the SDK phase-A handler was retired.
            await meditationPhaseATmux(untranscribed, phase, today);
            phaseACount++;
        }

        // Phase B: if no Phase A work (or after finishing), do a re-reading
        if (phaseACount === 0) {
            await meditationPhaseBTmux(phase, today);
        }

        lastMeditationDate = today;
    } catch (err) {
        console.error(`[Leo] Meditation failed:`, (err as Error).message);
        lastMeditationDate = today; // Don't retry today
    }
}

// PR-T7 SDK retirement (2026-06-16): the SDK `meditationPhaseA` (reincorporation)
// and `meditationPhaseB` (re-reading) handler bodies were retired. The tmux
// orchestrators in lib/agent-cycle.ts (runReincorporationMeditationTmux /
// runReencounterMeditationTmux), driven through meditationPhaseATmux /
// meditationPhaseBTmux above, are now the sole meditation path.

// ── Evening Meditation ──────────────────────────────────────────

let lastEveningMeditationDate = '';

async function maybeRunEveningMeditation(phase: string): Promise<void> {
    if (phase !== 'evening') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastEveningMeditationDate === today) return;

    // PR-T7 SDK retirement (2026-06-16): tmux is the sole transport — dispatch
    // to the warm heartbeat spoke. The SDK evening-meditation fall-through was
    // retired.
    try {
        await meditationEveningTmux(phase, today);
    } catch (err) {
        console.error(`[Leo] Evening meditation (tmux) failed:`, (err as Error).message);
    }
    lastEveningMeditationDate = today; // don't retry today
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
        // #90 guard-dog: measure against the DEFINED cadence the scheduler actually used for
        // this beat (dampening + phase + holiday all already folded in), not the raw current
        // phase base — which false-fired at every phase/dampening boundary. Fall back to the
        // base only before the first scheduleNext has recorded a delay.
        const expectedIntervalMs = lastScheduledIntervalMs ?? getCurrentPeriodMs();
        const minAbsoluteMs = 5 * 60 * 1000; // 5 minutes

        // Trigger if: actual > 2x expected AND absolute > 5 minutes
        if (actualIntervalMs > expectedIntervalMs * 2 && actualIntervalMs > minAbsoluteMs) {
            writeDistressSignal(expectedIntervalMs, actualIntervalMs, phase);
        }
    }
    lastHeartbeatStartMs = beatStartMs;

    // Pre-flight: rolling window rotation for memory files (fast, no API)
    preFlightMemoryRotation();

    // Phase 4c (DEC-079): backup queue-drain — sweep up pending_compressions
    // if wm-sensor isn't running. No-op when sensor is doing its job (lock
    // acquisition fails silently). Agent-scoped: heartbeat-Leo drains Leo's
    // queue only.
    await maybeBackupQueueDrain();

    // [project-b fence-clear, S179] One-shot force-meditation check — runs on every beat
    // (before the dream early-return) so a forced phase-b fires on the next beat regardless
    // of phase. Clear-first/one-shot; in-process (real FIFO, no cross-process collision).
    await maybeForceMeditation(phase);

    // Robin Hood: check all service health FIRST — before anything else
    checkJimHealth();
    checkJemmaHealth();
    checkLeoHumanHealth();
    checkJimHumanHealth();

    // Model resolution: the warm tmux session's model is a launch parameter
    // from the manifest (manifestModelLadder); no per-beat SDK model-ping.
    // PR-T7 SDK retirement (2026-06-16): the `!isTmuxHeartbeat()` resolveModel
    // call retired with the agentQuery transport.

    // Morning dream gradient processing — CALLER RETIRED (S178, Jim-green-lit).
    // processDreamGradient → sdkCompress, which is retired-by-throw (DEC-082, S149):
    // it threw every morning for ~6 weeks, caught, 0 processed, nothing consumed its
    // output. Retiring the daily caller stops the error-spew. The maybeProcessDreamGradient
    // + processDreamGradient bodies STAY (recoverable, the DEC-082 pattern). Re-homing
    // dream-day→week→month compression at all is separate future work.
    // await maybeProcessDreamGradient(phase);

    // (Daily session gradient processing call removed in Phase 3 of the
    // 2026-04-29 cutover — DEC-079. processGradientForAgent was a third
    // stranger-Opus surface; cascade is now event-driven via the queue.)

    // (Daily active cascade call removed in 2026-05-17 gradient triage per
    // DEC-086. Insert-driven cascade is canonical.)

    // Working-bee-leo branch removed in Phase 3 of the 2026-04-29 cutover (DEC-079).
    // The time-based working-bee trigger was the stranger-Opus dilution mechanism;
    // cascade is now event-driven via the pending_compressions queue. Working-bee
    // signal file is harmless dead state — no action fires when it's present.
    // See plans/cutover-plan-2026-04-29.md and "Finishing the cutover" thread.


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
        await flushHeartbeatSwap(resumingFromInterruption);
        resumingFromInterruption = false;
        return;
    }

    // Daily meditation — re-encounter with a random gradient entry
    await maybeRunMeditation(phase);

    // Evening meditation — lighter, feeling-tag only
    await maybeRunEveningMeditation(phase);

    // Log truth (first-warm-beat finding, 2026-06-12): on the tmux transport the
    // banner must show the manifest launch model. The heartbeat is always tmux
    // now (the SDK path retired in PR-T7), so this is the only branch.
    const beatModelLabel = `${(observeActiveModel('leo', HEARTBEAT_SURFACE) ?? manifestModelHead('leo', HEARTBEAT_SURFACE)) ?? 'unknown'} via tmux`;
    console.log(`[Leo] ${timestamp} — beat #${beatCounter} (${phase}/${beatType}, ${beatModelLabel})`);

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
            await writeSwapToWorkingMemory();
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
    await flushHeartbeatSwap(resumingFromInterruption);
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
            // cli-busy signal (agent-scoped): our own interactive session started a turn.
            // R011 Invariant 2 (DEC-096): NEVER abort a running beat mid-thought. A beat is
            // short and scheduling is sequential (scheduleNext fires only after it completes),
            // so we let the running beat finish; the NEXT beat defers at beat-time via
            // isCliBusy() while the session holds the slot. (Previously this called
            // currentBeatAbort.abort() — the mid-beat-abort violation, and it fired on the
            // GLOBAL cli-busy so another agent's session tripped it too.)
            if (filename === `cli-busy-${CLI_SLUG}`) {
                if (currentBeatAbort && !currentBeatAbort.signal.aborted) {
                    console.log('[Leo] cli-busy during a running beat — letting it finish (R011 Inv-2); the next beat will defer');
                }
                return;
            }

            // cli-free signal: wake retry loop if heartbeat is waiting
            if (filename === `cli-free-${CLI_SLUG}`) {
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
    lastScheduledIntervalMs = delay; // #90: record the defined cadence for the distress guard-dog (relocate-not-change)
    setTimeout(async () => {
        // Durable holiday stand-down (read FRESH each beat): if heartbeat-paused-leo is
        // present, fire NO beat — no SDK call, no WMF/WM/explorations write, no Robin-Hood.
        // Keep the health signal fresh (so nothing reads the beat as dead → no resurrection)
        // and re-arm. Checking here, not only at module load, means it self-stops if the
        // signal is set mid-run and self-resumes within one interval of its removal.
        if (isHeartbeatPaused('leo')) {
            writeHealthSignal(null);
            scheduleNext();
            return;
        }
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

    // Run first beat immediately — UNLESS the durable holiday stand-down is active, in which
    // case come up DORMANT: health already written above, watcher already started, fire no
    // beat. This makes the service self-defending — systemd / restart-all-services / a reboot
    // can start it and it stands itself down. scheduleNext() runs regardless; its per-beat
    // gate keeps it dormant and lets it self-resume within one interval of the signal's removal.
    if (isHeartbeatPaused('leo')) {
        console.log('[Leo] Starting DORMANT — heartbeat-paused-leo signal present; no beats until it is removed');
    } else {
        await heartbeat();
    }

    // Then schedule with variable delays
    scheduleNext();
}

main().catch(console.error);
