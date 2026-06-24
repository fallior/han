/**
 * Supervisor Worker Process
 *
 * This worker runs as a forked child process and handles the heavy computation
 * of supervisor cycles in isolation from the Express event loop. The parent process
 * stays responsive to HTTP/WebSocket requests while this worker blocks on Agent SDK calls.
 *
 * Communication: Uses process.send() and process.on('message') for IPC.
 *
 * Key design decisions:
 * - Creates its own better-sqlite3 connection (WAL mode allows concurrent readers)
 * - Creates its own prepared statements (DB connections are per-process)
 * - Proxies WebSocket broadcasts through parent process via messages
 * - Sends create_goal/cancel_task actions to parent (parent owns task execution state)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type {
    MainToWorkerMessage,
    WorkerToMainMessage,
    CycleStartedMessage,
    CycleCompleteMessage,
    CycleSkippedMessage,
    CycleFailedMessage,
    BroadcastMessage,
    LogMessage
} from './supervisor-protocol';
import { postToDiscord, resolveChannelName } from './discord';
import { getDayPhase, isRestDay, getPhaseInterval, isOnHoliday, isWorkingBee, type DayPhase } from '../lib/day-phase';
import { appendPairedMemory } from '../lib/memory-paired-writer';
import { parseTurnEntryStructured, parseTurnEntry } from '../lib/result-handlers';
import { acquireWmSensorLock, releaseWmSensorLock } from '../lib/sensor-lock';
import { gateIdentityOrThrow } from '../lib/identity-signing';
import { buildPrompt, PromptOverbudgetError } from '../lib/prompt-builder';
import type { JimCyclePhase } from '../lib/jim-prompts';
import { jimSupervisorCycleActionBlock, JIM_REFLECTIVE_CYCLE_ACTION_BLOCK } from '../lib/jim-prompts';
// PR-T7b (DEC-093 / Option A): the agnostic cycle/dispatch surface + manifest
// gate. The supervisor cycle becomes a thin caller of dispatchTxn('jim',...) —
// one path, many agents (Darron's governing law). jim passes its OWN leaves
// (supervisor-swap, the supervisor_cycles telemetry, no health-signal file —
// the supervisor's "health" is the cycle DB + sendMessage, not leo's signal).
import { dispatchTxn, applyMeditationMarkers, MEDITATION_ACTION_BLOCK, runReincorporationMeditationTmux, runReencounterMeditationTmux } from '../lib/agent-cycle';
import { manifestModelLadder, manifestModelHead, conversationRolesExcept, displayNameForRole } from '../lib/garden-manifest';
import { getPersona, getMentionPatterns } from './village';
import { observeActiveModel } from '../lib/tmux-dispatcher';
import type { CaptureRecord } from '../lib/diary-mcp-server';
import { spawn as spawnChild } from 'node:child_process';
import { readDreamGradient, processDreamGradient } from '../lib/dream-gradient';
import { rotateMemoryFile, loadMemoryFileGradient, loadTraversableGradient, rollingWindowRotate, updateFeelingTagWithHistory, maybeUpgradeTagStability, retroactiveUVContradictionSweep } from '../lib/memory-gradient';
import { gradientStmts, feelingTagStmts, gradientAnnotationStmts } from '../db';

// ── Types ────────────────────────────────────────────────────

interface SupervisorAction {
    type: 'create_goal' | 'adjust_priority' | 'update_memory' |
          'send_notification' | 'cancel_task' | 'explore_project' | 'propose_idea' | 'no_action';
    goal_description?: string;
    project_path?: string;
    planning_model?: string;
    task_id?: string;
    new_priority?: number;
    memory_file?: string;
    content?: string;
    message?: string;
    priority?: 'low' | 'default' | 'high';
    reason?: string;
    exploration_focus?: string;
    idea_title?: string;
    idea_description?: string;
    idea_category?: 'improvement' | 'opportunity' | 'risk' | 'strategic';
    estimated_effort?: 'small' | 'medium' | 'large';
    conversation_id?: string;
    response_content?: string;
}

interface SupervisorOutput {
    observations: string[];
    actions: SupervisorAction[];
    self_reflection?: string;
    working_memory_compressed?: string;
    working_memory_full?: string;
    reasoning: string;
}

// ── Constants ────────────────────────────────────────────────

const HAN_DIR = process.env.HAN_DIR || path.join(process.env.HOME!, '.han');
const MEMORY_DIR = path.join(HAN_DIR, 'memory');
const PROJECTS_DIR = path.join(MEMORY_DIR, 'projects');
const SESSIONS_DIR = path.join(MEMORY_DIR, 'sessions');
// Phase 5 followup: honour HAN_DB_PATH override; default flipped from
// tasks.db to gradient.db per DEC-080. Mirrors db.ts:32 pattern. Variable
// name kept TASKS_DB_PATH for now — Phase 12 cleanup will rename consistently
// across the codebase.
const TASKS_DB_PATH = process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db');
const JIM_AGENT_DIR = path.join(HAN_DIR, 'agents', 'Jim');
const SUPERVISOR_SWAP_FILE = path.join(MEMORY_DIR, 'supervisor-swap.md');
const SUPERVISOR_SWAP_FULL_FILE = path.join(MEMORY_DIR, 'supervisor-swap-full.md');
const WORKING_MEMORY_FILE = path.join(MEMORY_DIR, 'working-memory.md');
const WORKING_MEMORY_FULL_FILE = path.join(MEMORY_DIR, 'working-memory-full.md');

// Token caps removed — silent truncation caused identity degradation (DEC-R001, S77).
// Jim's memory files grow naturally; archiving handles size management.

// Emergency mode frequencies (interrupt — not the default rhythm)
// See Hall of Records R001: Weekly Rhythm Model. Do NOT revert to activity-driven scheduling.
const EMERGENCY_FREQ_VERY_ACTIVE = 2 * 60 * 1000;
const EMERGENCY_FREQ_ACTIVE = 5 * 60 * 1000;
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');

// Recovery mode — Jim is on a recovery week until this date.
// During recovery: no supervisor cycles, all waking cycles become recovery-focused.
// Jim reads his session logs, rebuilds his memory, and reflects.
// He can still respond to conversations and do explicitly requested work.
// Set to null to disable recovery mode.
const RECOVERY_MODE_UNTIL: string | null = null;

// ── Nightly dream compression — REMOVED (S112, 2026-04-07) ───────────
// The 6am clock-based wipe has been replaced by the rolling window design
// in loadMemoryBank()'s pre-flight section. Memory files are now compressed
// by size threshold, not by time of day. No more empty files at dawn.

// ── Jim's dream gradient processing ─────────────────────────────────
// Jim processes only Jim's dreams. Leo processes Leo's in leo-heartbeat.ts.
// Agent sovereignty: each agent's dreams are their own.

let lastJimDreamGradientDate = '';

async function maybeProcessJimDreamGradient(phase: string): Promise<void> {
    if (phase !== 'morning') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastJimDreamGradientDate === today) return;

    log(`[Worker] Morning — processing Jim's dream gradient...`);
    try {
        const result = await processDreamGradient('jim');
        log(`[Worker] Jim dream gradient: ${result.nightsProcessed} nights, ${result.dayCreated.length} dream-day, ${result.weekCreated.length} dream-week, ${result.monthCreated.length} dream-month, ${result.uvsCreated.length} UVs`);
        if (result.errors.length > 0) {
            log(`[Worker] Jim dream gradient errors: ${result.errors.join(', ')}`);
        }
    } catch (err) {
        log(`[Worker] Jim dream gradient processing failed: ${(err as Error).message}`);
    }
    lastJimDreamGradientDate = today;
}

// ── Phase 4c (DEC-079): backup queue-drain ─────────────────────────────
//
// Belt-and-braces fallback: if wm-sensor isn't running OR has crashed mid-
// process, the supervisor cycle sweeps up unclaimed pending_compressions
// rows for Jim. Sensor is the primary path; this is the safety net.
//
// Concurrency-safe by composition:
//   1. Cheap peek on queue count — exit if empty.
//   2. acquireWmSensorLock — sensor holds it, we skip silently. 10-min
//      stale-claim recovery handles "sensor died mid-process."
//   3. Spawn process-pending-compression.ts; await exit; release lock.

// Mirror db.ts:32 pattern — honour HAN_DB_PATH override so dev/test scenarios
// that route the system to alternate DBs see consistent behaviour. Phase 5
// audit (S145) caught the previous hardcoded path as a silent-divergence
// footgun; renamed from GRADIENT_DB_PATH_4C (no longer needs the suffix —
// no name collision in this file).
const GRADIENT_DB_PATH = process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db');
const PROCESS_PENDING_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'process-pending-compression.ts');

async function maybeBackupQueueDrainJim(): Promise<void> {
    let pendingCount = 0;
    try {
        const peekDb = new Database(GRADIENT_DB_PATH, { readonly: true });
        try {
            const row = peekDb.prepare(`
                SELECT COUNT(*) as n FROM pending_compressions
                WHERE agent = 'jim' AND completed_at IS NULL
            `).get() as any;
            pendingCount = row?.n || 0;
        } finally { peekDb.close(); }
    } catch {
        return; // gradient.db may not have pending_compressions yet
    }
    if (pendingCount === 0) return;

    if (!acquireWmSensorLock('jim')) {
        return; // sensor is doing the work
    }
    try {
        log(`[Worker] Backup queue-drain: ${pendingCount} pending — spawning parallel agent`);
        const SERVER_DIR = path.resolve(__dirname, '..');
        const tsxBin = path.join(SERVER_DIR, 'node_modules', '.bin', 'tsx');
        await new Promise<void>((resolve) => {
            const child = spawnChild(tsxBin, [PROCESS_PENDING_SCRIPT, '--agent=jim'], {
                cwd: SERVER_DIR,
                env: { ...process.env, NODE_PATH: path.join(SERVER_DIR, 'node_modules') },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stderr = '';
            child.stderr.on('data', (d) => { stderr += d.toString(); });
            child.on('exit', (code) => {
                if (code !== 0) {
                    log(`[Worker] Backup parallel agent exited ${code}: ${stderr.split('\n').slice(0, 3).join(' | ')}`);
                }
                resolve();
            });
        });
    } finally {
        releaseWmSensorLock('jim');
    }
}

// ── Jim's session gradient processing ─────────────────────────────────
// Compress Jim's archived sessions through fractal gradient: c1→c2→c3→c5→UV.

// (lastJimSessionGradientDate + maybeProcessJimSessionGradient removed in
// Phase 3 of 2026-04-29 cutover, DEC-079. Same Option-3 treatment as
// bumpCascade — time-based file-gradient processor was a stranger-Opus
// cascade surface. processGradientForAgent is deprecated; cascade is now
// event-driven via the pending_compressions queue.)

// ── Jim's Phase A reincorporation ─────────────────────────────────
// Scans Jim's fractal gradient files for entries not yet in DB.
// Jim only — Leo has his own in leo-heartbeat.ts.

function findJimUntranscribedFiles(): { filePath: string; level: string; contentType: string; label: string } | null {
    const agentDir = path.join(MEMORY_DIR, 'fractal', 'jim');
    if (!fs.existsSync(agentDir)) return null;

    // Session gradient files (dynamically discovered cN/ directories)
    const sessionLevelDirs = fs.existsSync(agentDir) ? fs.readdirSync(agentDir).filter((d: string) => /^c\d+$/.test(d)) : [];
    for (const level of sessionLevelDirs) {
        const levelDir = path.join(agentDir, level);
        if (!fs.existsSync(levelDir)) continue;

        const files = fs.readdirSync(levelDir).filter((f: string) => f.endsWith('.md'));
        for (const file of files) {
            // \d+ not \d — two-digit levels (c10–c18) must strip too (S178; same bug as Leo's
            // findUntranscribedFiles — single-digit-only regex perpetually mis-flags deep flat-files).
            const label = file.replace('.md', '').replace(/-c\d+$/, '');
            const existing = (gradientStmts.getBySession.all(label) as any[]).filter(
                (r: any) => r.agent === 'jim'
            );
            if (existing.length === 0) {
                const allEntries = gradientStmts.getByAgent.all('jim') as any[];
                // ?. null-guard: a tagless entry (session_label NULL — e.g. a hand-composed c1
                // missing its tag) reads as not-in-cascade — a no-match, never a crash (2026-06-20).
                const inCascade = allEntries.some((r: any) => r.session_label?.includes(label));
                if (!inCascade) {
                    return { filePath: path.join(levelDir, file), level, contentType: 'session', label };
                }
            }
        }
    }

    // Dream gradient files (dreams/dream-day/, dreams/dream-week/, dreams/dream-month/)
    for (const level of ['dream-day', 'dream-week', 'dream-month']) {
        const levelDir = path.join(agentDir, 'dreams', level);
        if (!fs.existsSync(levelDir)) continue;

        const files = fs.readdirSync(levelDir).filter((f: string) => f.endsWith('.md'));
        for (const file of files) {
            const label = file.replace('.md', '');
            const existing = (gradientStmts.getBySession.all(label) as any[]).filter(
                (r: any) => r.agent === 'jim' && r.content_type === 'dream'
            );
            if (existing.length === 0) {
                return { filePath: path.join(levelDir, file), level, contentType: 'dream', label };
            }
        }
    }

    // Memory file gradient files (working-memory/c1/, etc.)
    for (const contentType of ['felt-moments', 'working-memory']) {
        const contentDir = path.join(agentDir, contentType);
        const memLevelDirs = fs.existsSync(contentDir) ? fs.readdirSync(contentDir).filter((d: string) => /^c\d+$/.test(d)) : [];
        for (const level of memLevelDirs) {
            const levelDir = path.join(agentDir, contentType, level);
            if (!fs.existsSync(levelDir)) continue;

            const files = fs.readdirSync(levelDir).filter((f: string) => f.endsWith('.md'));
            for (const file of files) {
                const label = `${contentType}/${file.replace('.md', '')}`;
                const existing = (gradientStmts.getBySession.all(label) as any[]).filter(
                    (r: any) => r.agent === 'jim'
                );
                if (existing.length === 0) {
                    return {
                        filePath: path.join(levelDir, file), level,
                        contentType: contentType === 'felt-moments' ? 'felt-moment' : 'working-memory',
                        label,
                    };
                }
            }
        }
    }

    // Unit vectors
    const uvPath = path.join(agentDir, 'unit-vectors.md');
    if (fs.existsSync(uvPath)) {
        const uvContent = fs.readFileSync(uvPath, 'utf8');
        const uvLines = uvContent.split('\n').filter((l: string) => l.startsWith('- **'));
        for (const line of uvLines) {
            const match = line.match(/\*\*(.+?)\*\*:\s*"(.+?)"/);
            if (!match) continue;
            const uvLabel = match[1];
            const existing = (gradientStmts.getBySession.all(uvLabel) as any[]).filter(
                (r: any) => r.agent === 'jim' && r.level === 'uv'
            );
            if (existing.length === 0) {
                return { filePath: uvPath, level: 'uv', contentType: 'session', label: uvLabel };
            }
        }
    }

    // Dream unit vectors
    const dreamUvPath = path.join(agentDir, 'dreams', 'unit-vectors.md');
    if (fs.existsSync(dreamUvPath)) {
        const uvContent = fs.readFileSync(dreamUvPath, 'utf8');
        const uvLines = uvContent.split('\n').filter((l: string) => l.startsWith('- **'));
        for (const line of uvLines) {
            const match = line.match(/\*\*(.+?)\*\*:\s*"(.+?)"/);
            if (!match) continue;
            const uvLabel = match[1];
            const existing = (gradientStmts.getBySession.all(uvLabel) as any[]).filter(
                (r: any) => r.agent === 'jim' && r.level === 'uv' && r.content_type === 'dream'
            );
            if (existing.length === 0) {
                return { filePath: dreamUvPath, level: 'uv', contentType: 'dream', label: uvLabel };
            }
        }
    }

    return null; // All Jim files transcribed
}

function isRecoveryMode(): boolean {
    if (!RECOVERY_MODE_UNTIL) return false;
    const now = new Date();
    const until = new Date(RECOVERY_MODE_UNTIL + 'T23:59:59+10:00');
    return now <= until;
}

// ── Worker state ─────────────────────────────────────────────

let workerDb: Database.Database | null = null;
let runningCycleAbort: AbortController | null = null;
let personalCycleCounter = 0;
let lastCycleDelay: number | null = null;

// Track current cycle state for SIGTERM handler and cost cap (so work isn't lost on kill)
let currentCycleId: string | null = null;
let currentCycleType: string = 'supervisor';
let currentCycleNumber: number = 0;

// Gary Protocol — interruption/resume tracking
// When a cycle is interrupted (cost cap, abort), a delineation marker is added to swap.
// The next cycle reads post-delineation content as resume context.
let resumingFromInterruption = false;
let interruptedCycleContext: string | null = null;  // post-delineation content from last interrupted cycle
const DELINEATION_MARKER = '\n--- DELINEATION: interrupted here, resume below ---\n';

// Rumination guard — prevents obsessive looping on same topic across personal cycles.
// After MAX_SAME_TOPIC consecutive personal cycles on the same theme, force a topic change.
const MAX_SAME_TOPIC_CYCLES = 2;
const RUMINATION_FILE = path.join(HAN_DIR, 'health', 'jim-rumination.json');

// Nightly audit file
const AUDIT_FILE = path.join(HAN_DIR, 'logs', 'cycle-audit.jsonl');

// Prepared statements (worker-local)
let supervisorStmts: any = {};
let taskStmts: any = {};
let goalStmts: any = {};
let portfolioStmts: any = {};
let proposalStmts: any = {};
let strategicProposalStmts: any = {};
let conversationStmts: any = {};
/** Worker-local prepared statements for conversation_messages. TYPED (unlike its sibling
 *  stmt-objects which remain `any`) so tsc catches a missing member — closing the d6b9527
 *  gap where `:842` called `getLastResponseByRole` that the object never defined, crashing
 *  buildStateSnapshot on a pending peer conversation. (Full closure = type the 7 siblings too.) */
interface ConversationMessageStmts {
    getLastResponseByRole: Database.Statement;
}
let conversationMessageStmts: ConversationMessageStmts = {} as ConversationMessageStmts;

// ── Helper functions ─────────────────────────────────────────

function sendMessage(msg: WorkerToMainMessage): void {
    if (process.send) {
        process.send(msg);
    }
}

// ── Gary Protocol helpers ────────────────────────────────────

function addDelineation(): void {
    try {
        fs.appendFileSync(SUPERVISOR_SWAP_FILE, DELINEATION_MARKER);
        fs.appendFileSync(SUPERVISOR_SWAP_FULL_FILE, DELINEATION_MARKER);
    } catch { /* best effort */ }
}

// ── Rumination guard helpers ────────────────────────────────

interface RuminationState {
    recentTopics: Array<{ cycle: number; summary: string; timestamp: string }>;
}

function loadRuminationState(): RuminationState {
    try {
        if (fs.existsSync(RUMINATION_FILE)) {
            return JSON.parse(fs.readFileSync(RUMINATION_FILE, 'utf8'));
        }
    } catch { /* fresh state */ }
    return { recentTopics: [] };
}

function saveRuminationState(state: RuminationState): void {
    try {
        const dir = path.dirname(RUMINATION_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Keep only last 10 entries
        state.recentTopics = state.recentTopics.slice(-10);
        fs.writeFileSync(RUMINATION_FILE, JSON.stringify(state, null, 2));
    } catch { /* best effort */ }
}

function checkRumination(currentSummary: string): { isRuminating: boolean; topic: string; count: number } {
    const state = loadRuminationState();
    const recent = state.recentTopics.slice(-MAX_SAME_TOPIC_CYCLES);

    if (recent.length < MAX_SAME_TOPIC_CYCLES) {
        return { isRuminating: false, topic: '', count: 0 };
    }

    // Simple keyword overlap detection — extract significant words (>4 chars)
    const getKeywords = (text: string): Set<string> =>
        new Set(text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 4));

    const currentWords = getKeywords(currentSummary);
    let matchCount = 0;

    for (const entry of recent) {
        const entryWords = getKeywords(entry.summary);
        const overlap = [...currentWords].filter(w => entryWords.has(w)).length;
        const similarity = overlap / Math.max(currentWords.size, 1);
        if (similarity > 0.4) matchCount++;
    }

    if (matchCount >= MAX_SAME_TOPIC_CYCLES) {
        return { isRuminating: true, topic: recent[0].summary.slice(0, 100), count: matchCount + 1 };
    }
    return { isRuminating: false, topic: '', count: 0 };
}

function recordRuminationTopic(cycleNumber: number, summary: string): void {
    const state = loadRuminationState();
    state.recentTopics.push({
        cycle: cycleNumber,
        summary: summary.slice(0, 300),
        timestamp: new Date().toISOString(),
    });
    saveRuminationState(state);
}

function log(message: string, ...args: any[]): void {
    const msg: LogMessage = { type: 'log', level: 'log', message, args };
    sendMessage(msg);
}

function logError(message: string, ...args: any[]): void {
    const msg: LogMessage = { type: 'log', level: 'error', message, args };
    sendMessage(msg);
}

function broadcast(payload: any): void {
    const msg: BroadcastMessage = { type: 'broadcast', payload };
    sendMessage(msg);
}

function generateId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
}

function loadConfig(): any {
    try {
        const configPath = path.join(HAN_DIR, 'config.json');
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return {};
    }
}

// ── Database initialization ──────────────────────────────────

function initDatabase(): void {
    workerDb = new Database(TASKS_DB_PATH);
    workerDb.pragma('journal_mode = WAL');
    workerDb.pragma('busy_timeout = 5000');

    // Create prepared statements (same as main process, but on worker's DB connection)
    supervisorStmts = {
        insertCycle: workerDb.prepare('INSERT INTO supervisor_cycles (id, started_at, cycle_number, cycle_type) VALUES (?, ?, ?, ?)'),
        completeCycle: workerDb.prepare('UPDATE supervisor_cycles SET completed_at = ?, cost_usd = ?, tokens_in = ?, tokens_out = ?, num_turns = ?, actions_taken = ?, observations = ?, reasoning = ? WHERE id = ?'),
        failCycle: workerDb.prepare('UPDATE supervisor_cycles SET completed_at = ?, error = ? WHERE id = ?'),
        getCostSince: workerDb.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM supervisor_cycles WHERE started_at > ?'),
        getNextCycleNumber: workerDb.prepare('SELECT COALESCE(MAX(cycle_number), 0) + 1 as next FROM supervisor_cycles'),
    };

    taskStmts = {
        listByStatus: workerDb.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at DESC'),
        get: workerDb.prepare('SELECT * FROM tasks WHERE id = ?'),
        cancel: workerDb.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?'),
    };

    goalStmts = {
        updateProgress: workerDb.prepare('UPDATE goals SET tasks_completed = ?, tasks_failed = ?, total_cost_usd = ?, status = ?, completed_at = ? WHERE id = ?'),
        updateStatus: workerDb.prepare('UPDATE goals SET status = ? WHERE id = ?'),
    };

    portfolioStmts = {
        list: workerDb.prepare('SELECT * FROM projects ORDER BY priority DESC, name ASC'),
    };

    proposalStmts = {
        listByStatus: workerDb.prepare('SELECT * FROM task_proposals WHERE status = ? ORDER BY created_at DESC'),
    };

    strategicProposalStmts = {
        insert: workerDb.prepare('INSERT INTO supervisor_proposals (id, title, description, category, project_path, estimated_effort, supervisor_reasoning, cycle_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    };

    conversationStmts = {
        updateTimestamp: workerDb.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?'),
        get: workerDb.prepare('SELECT * FROM conversations WHERE id = ?'),
    };

    conversationMessageStmts = {
        getLastResponseByRole: workerDb.prepare('SELECT created_at FROM conversation_messages WHERE conversation_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1'),
    };

    log('[Worker] Database initialized');
}

function cleanupDatabase(): void {
    if (workerDb) {
        workerDb.close();
        workerDb = null;
        log('[Worker] Database connection closed');
    }
}

// ── Cleanup functions ────────────────────────────────────────

/**
 * Clean up phantom goals that have become stale or stuck.
 * Returns count of goals fixed.
 */
function cleanupPhantomGoals(): number {
    if (!workerDb) return 0;
    let fixed = 0;
    const now = new Date();

    try {
        // 1. Parent goals where ALL children are terminal (done/failed/cancelled)
        const parentGoals = workerDb.prepare(`
            SELECT g.id FROM goals g
            WHERE g.goal_type = 'parent'
            AND g.status = 'active'
            AND NOT EXISTS (
                SELECT 1 FROM goals c
                WHERE c.parent_goal_id = g.id
                AND c.status NOT IN ('done', 'failed', 'cancelled')
            )
        `).all() as any[];

        for (const g of parentGoals) {
            goalStmts.updateProgress.run(0, 0, 0, 'failed', now.toISOString(), g.id);
            log(`[Worker] Cleaned up phantom parent goal: ${g.id}`);
            fixed++;
        }

        // 2. Standalone goals where ALL tasks are terminal
        const staleGoals = workerDb.prepare(`
            SELECT g.id FROM goals g
            WHERE g.status = 'active'
            AND g.goal_type != 'parent'
            AND EXISTS (SELECT 1 FROM tasks t WHERE t.goal_id = g.id)
            AND NOT EXISTS (
                SELECT 1 FROM tasks t
                WHERE t.goal_id = g.id
                AND t.status NOT IN ('done', 'failed', 'cancelled')
            )
        `).all() as any[];

        for (const g of staleGoals) {
            // For standalone goals, we need to recalculate via updateGoalProgress
            // But updateGoalProgress is in planning.ts which imports from main db
            // So we delegate this to the parent process by sending a message
            // For now, just mark as failed directly
            goalStmts.updateProgress.run(0, 0, 0, 'failed', now.toISOString(), g.id);
            log(`[Worker] Recalculated phantom goal: ${g.id}`);
            fixed++;
        }

        // 3. Goals stuck in 'decomposing' for more than 1 hour
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const stuckDecomposing = workerDb.prepare(`
            SELECT id FROM goals
            WHERE status = 'decomposing'
            AND created_at < ?
        `).all(oneHourAgo) as any[];

        for (const g of stuckDecomposing) {
            goalStmts.updateStatus.run('failed', g.id);
            log(`[Worker] Cleaned up stuck decomposing goal: ${g.id} (timeout)`);
            fixed++;
        }

    } catch (err: any) {
        logError('[Worker] Phantom goal cleanup failed:', err.message);
    }

    if (fixed > 0) {
        log(`[Worker] Phantom goal cleanup: ${fixed} goals cleaned`);
    }

    return fixed;
}

/**
 * Detect and recover ghost tasks (running in DB but no live agent).
 * Returns count of ghost tasks recovered.
 */
function detectAndRecoverGhostTasks(): number {
    if (!workerDb) return 0;
    let recovered = 0;

    try {
        const ghostTasks = taskStmts.listByStatus.all('running') as any[];

        // In the worker, we can't check runningSlots (that's in parent process)
        // So we delegate ghost detection to parent via message
        // For now, just count them but don't recover
        // The parent process will handle recovery via cancel_task action

        return recovered;
    } catch (err: any) {
        logError('[Worker] Ghost task detection failed:', err.message);
        return 0;
    }
}

// ── Memory and state functions ───────────────────────────────

/**
 * PR-AP8 (2026-05-22): extracted from the retired `loadMemoryBank()` per
 * Jim's F6-1. Pre-flight file-level rotations (felt-moments +
 * self-reflection) MUST run before any agnostic-builder cycle so the
 * builder reads bounded files. The full memory bank composition that
 * used to live in `loadMemoryBank()` retires here — the builder owns
 * it now via `loadFullMemory('jim')`. The rotations stay on the
 * writer side per DEC-085 + W6-4.
 *
 * The identity gate also fires here (DEC-083 surface preserved).
 */
function runJimPreflightRotations(): void {
    gateIdentityOrThrow('jim', 'supervisor-worker');

    const memConfig = loadConfig().memory || {};
    const headSize = memConfig.rollingWindowHead || 51200;
    const tailSize = memConfig.rollingWindowTail || 51200;
    try {
        const fmResult = rollingWindowRotate(
            path.join(MEMORY_DIR, 'felt-moments.md'),
            '# Jim — Felt Moments\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n',
            headSize, tailSize,
            'jim', 'felt-moments',
        );
        if (fmResult.rotated) {
            log(`[Worker] Felt-moments rolling window: archived ${fmResult.entriesArchived} entries, kept ${fmResult.entriesKept}, c0=${fmResult.c0EntryId}, archive=${fmResult.archivePath}`);
        }

        // Self-reflection: rolling window with tighter ceiling (20KB+20KB = 40KB total).
        // Added 2026-04-20 after F9 overflow loop (cycles #2686–#2723) where unchallenged
        // growth to 86KB choked the load. Identity-structural sections at the head
        // stay; older cycle-append reflections archive to c0.
        const srHeadSize = memConfig.selfReflectionHead || 20480;
        const srTailSize = memConfig.selfReflectionTail || 20480;
        const srResult = rollingWindowRotate(
            path.join(MEMORY_DIR, 'self-reflection.md'),
            '# Jim — Self-Reflection\n\n> Older reflections compressed into fractal gradient. Nothing is lost.\n',
            srHeadSize, srTailSize,
            'jim', 'self-reflection',
        );
        if (srResult.rotated) {
            log(`[Worker] Self-reflection rolling window: archived ${srResult.entriesArchived} entries, kept ${srResult.entriesKept}, c0=${srResult.c0EntryId}, archive=${srResult.archivePath}`);
        }
    } catch (e) { log(`[Worker] Memory file pre-flight error: ${e}`); }
}

// Per DEC-087 (PR-AP8, 2026-05-22): `loadMemoryBank()` retired. Prompt
// assembly is the agnostic prompt builder's responsibility — call
// `buildPrompt('jim', profileName, ctx)` from `lib/prompt-builder.ts`.
// Pre-flight file-level rotations live in `runJimPreflightRotations()`
// above. Composing a full Jim memory bank string at this layer is the
// pattern the AP migration was built to cure (treatment-continues
// thread `mpc0oc6e-sxlstg`). DO NOT re-introduce.


function buildStateSnapshot(): string {
    if (!workerDb) return '## Error\nDatabase not initialized';

    const parts: string[] = [];
    const now = new Date();

    parts.push(`## Current Time\n${now.toISOString()} (UTC+10)`);

    // Running tasks
    try {
        const running = taskStmts.listByStatus.all('running') as any[];
        const slotConfig = loadConfig().supervisor || {};
        const totalSlots = slotConfig.max_agent_slots || 8;
        const reserveSlots = slotConfig.reserve_slots || 2;
        const normalCap = totalSlots - reserveSlots;
        parts.push(`## Running Tasks (${running.length}/${totalSlots} slots, ${normalCap} normal + ${reserveSlots} reserve)`);
        if (running.length === 0) {
            parts.push('No tasks currently running.');
        } else {
            for (const t of running) {
                const project = t.project_path?.split('/').pop() || '?';
                parts.push(`- [${t.id}] ${t.title} (${t.model}, project: ${project}, started: ${t.started_at})`);
            }
        }
    } catch { parts.push('## Running Tasks\nUnable to query.'); }

    // Pending tasks (top 10)
    try {
        const pending = taskStmts.listByStatus.all('pending') as any[];
        parts.push(`## Pending Tasks (${pending.length} total)`);
        for (const t of pending.slice(0, 10)) {
            const project = t.project_path?.split('/').pop() || '?';
            const deps = t.depends_on ? ` [blocked by: ${t.depends_on}]` : '';
            parts.push(`- [${t.id}] ${t.title} (priority: ${t.priority}, model: ${t.model}, project: ${project})${deps}`);
        }
        if (pending.length > 10) parts.push(`  ... and ${pending.length - 10} more`);
    } catch { parts.push('## Pending Tasks\nUnable to query.'); }

    // Active goals
    try {
        const goals = workerDb.prepare(
            "SELECT * FROM goals WHERE status IN ('active', 'decomposing', 'planning') ORDER BY created_at DESC"
        ).all() as any[];
        parts.push(`## Active Goals (${goals.length})`);
        for (const g of goals) {
            const project = g.project_path?.split('/').pop() || '?';
            const desc = g.description?.slice(0, 80) || '?';
            parts.push(`- [${g.id}] ${desc} — ${g.tasks_completed}/${g.task_count} done, ${g.tasks_failed} failed, $${(g.total_cost_usd || 0).toFixed(4)} (project: ${project})`);
        }
    } catch { parts.push('## Active Goals\nUnable to query.'); }

    // Recent completions (last 2 hours)
    try {
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        const recent = workerDb.prepare(
            "SELECT * FROM tasks WHERE status IN ('done', 'failed') AND completed_at > ? ORDER BY completed_at DESC LIMIT 10"
        ).all(twoHoursAgo) as any[];
        if (recent.length > 0) {
            parts.push(`## Recent Completions (last 2h)`);
            for (const t of recent) {
                const icon = t.status === 'done' ? 'OK' : 'FAIL';
                parts.push(`- ${icon}: ${t.title} ($${(t.cost_usd || 0).toFixed(4)}, ${t.model})`);
            }
        }
    } catch { /* skip */ }

    // Recent failures needing attention
    try {
        const recentFailed = workerDb.prepare(
            "SELECT * FROM tasks WHERE status = 'failed' AND retry_count >= 3 ORDER BY completed_at DESC LIMIT 5"
        ).all() as any[];
        if (recentFailed.length > 0) {
            parts.push(`## Failures Exhausted Retries`);
            for (const f of recentFailed) {
                parts.push(`- [${f.id}] ${f.title}: ${(f.error || '').slice(0, 100)} (retries: ${f.retry_count})`);
            }
        }
    } catch { /* skip */ }

    // Pending proposals
    try {
        const proposals = proposalStmts.listByStatus.all('pending') as any[];
        if (proposals.length > 0) {
            parts.push(`## Pending Knowledge Proposals (${proposals.length})`);
            for (const p of proposals.slice(0, 5)) {
                parts.push(`- [${p.type}] ${p.title}`);
            }
        }
    } catch { /* skip */ }

    // Pending conversations
    try {
        // Project-b Phase 1 (agnostic responder scan, DEC-081): 'human' kept EXPLICIT — it is NOT
        // an agent conversationRole, so deriving it away would blind the scan to Darron (Jim's
        // blocking checkpoint). Agent-peers are registry-derived from the manifest. SELF_ROLE is the
        // constant 'supervisor' for now — the worker is still jim-hardcoded (the Phase-3 headline);
        // this scan is the safe shared-infra step-1.
        const SELF_ROLE = 'supervisor';                                 // TODO Phase-3: AGENT_SLUG's conversationRole
        const scanRoles = ['human', ...conversationRolesExcept('jim')]; // TODO Phase-3: conversationRolesExcept(selfSlug)
        const rolePlaceholders = scanRoles.map(() => '?').join(', ');
        const pendingConversations = workerDb.prepare(`
            SELECT DISTINCT c.id, c.title, cm.role as sender_role, cm.content, cm.created_at
            FROM conversations c
            JOIN conversation_messages cm ON c.id = cm.conversation_id
            WHERE c.status = 'open'
            AND (c.discussion_type IS NULL OR (c.discussion_type NOT LIKE '%-question' AND c.discussion_type NOT LIKE '%-postulate'))
            AND cm.role IN (${rolePlaceholders})
            AND NOT EXISTS (
                SELECT 1 FROM conversation_messages cm2
                WHERE cm2.conversation_id = c.id
                AND cm2.role = ?
                AND cm2.created_at > cm.created_at
            )
            ORDER BY cm.created_at DESC
        `).all(...scanRoles, SELF_ROLE) as any[];

        const PEER_RESPONSE_COOLDOWN_MS = 10 * 60 * 1000;
        const filteredConversations = pendingConversations.filter((conv: any) => {
            if (conv.sender_role === 'human') return true; // humans never wait on a peer cooldown
            const lastResponse = conversationMessageStmts.getLastResponseByRole.get(conv.id, SELF_ROLE) as any;
            if (!lastResponse) return true;
            return (Date.now() - new Date(lastResponse.created_at).getTime()) >= PEER_RESPONSE_COOLDOWN_MS;
        });

        if (filteredConversations.length > 0) {
            parts.push(`## Pending Conversations (${filteredConversations.length})`);
            // Mention-detect from the agent's OWN persona patterns (registry-driven). ⚠ AUDIT NOTE:
            // jim's persona patterns are \bjim\b / \bjimmy\b — ANY name-mention, BROADER than the old
            // direct-address regex (hey jim/@jim/jim:); covers all prior cases plus bare mentions.
            const selfPersona = getPersona('jim');  // TODO Phase-3: getPersona(selfSlug)
            const mentionRes = selfPersona ? getMentionPatterns(selfPersona).map(p => new RegExp(p, 'i')) : [];
            for (const conv of filteredConversations.slice(0, 5)) {
                const sender = displayNameForRole(conv.sender_role);
                const msgPreview = (conv.content || '').slice(0, 200).replace(/\n/g, ' ');
                const timestamp = conv.created_at?.split('T')[0] || '?';
                const mentioned = mentionRes.some(re => re.test(conv.content || '')) ? ' [MENTIONED BY NAME — respond promptly]' : '';
                parts.push(`- [${conv.id}] ${conv.title} (from ${sender}): "${msgPreview}..." (posted: ${timestamp})${mentioned}`);
            }
            if (filteredConversations.length > 5) parts.push(`  ... and ${filteredConversations.length - 5} more`);
        }
    } catch { /* skip */ }

    // Supervisor cost tracking
    try {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const costRow = supervisorStmts.getCostSince.get(todayStart) as any;
        const todayCost = costRow?.total || 0;
        parts.push(`## Supervisor Costs\n- Today: $${todayCost.toFixed(4)}`);
    } catch { /* skip */ }

    // Portfolio overview
    try {
        const projects = portfolioStmts.list.all() as any[];
        if (projects.length > 0) {
            parts.push(`## Portfolio (${projects.length} projects)`);
            for (const p of projects) {
                const memFile = path.join(PROJECTS_DIR, `${p.name}.md`);
                const hasMemory = fs.existsSync(memFile);
                const memSize = hasMemory ? fs.statSync(memFile).size : 0;
                const depth = memSize < 200 ? 'SHALLOW' : memSize < 800 ? 'BASIC' : 'DEEP';
                parts.push(`- **${p.name}** (${p.lifecycle || 'active'}): path=${p.path}, knowledge=${depth} (${memSize} bytes)`);
            }
        }
    } catch { /* skip */ }

    // Suggest exploration when idle
    try {
        const running = (taskStmts.listByStatus.all('running') as any[]).length;
        const pending = (taskStmts.listByStatus.all('pending') as any[]).length;
        if (running === 0 && pending <= 2) {
            parts.push(`## Exploration Opportunity`);
            parts.push(`System is idle — this is a good time to explore projects and deepen your knowledge.`);
            parts.push(`Use your Read/Glob/Grep/Bash tools to examine project codebases.`);
            parts.push(`Focus on projects with SHALLOW or BASIC knowledge depth.`);
            parts.push(`Key files to look for: CLAUDE.md, ARCHITECTURE.md, package.json, README.md, src/ structure.`);
            parts.push(`After exploring, use update_memory to enrich the relevant projects/*.md file.`);
        }
    } catch { /* skip */ }

    return parts.join('\n\n');
}

// ── Standalone Meditation ─────────────────────────────────────
// Runs once daily at the start of any cycle (not just dream cycles).
// Uses the same Phase A / Phase B pattern as Leo's heartbeat meditation.

let lastJimMeditationDate = '';

// PR-T7b: Jim's meditations on the warm spoke — thin callers of the SAME shared
// agnostic orchestrators Leo uses (instance jim, one path many agents). Jim's
// leaves, passed in: the dispatch (the supervisor-cycle spoke — Q-V2-3,
// meditations share the agent's session) and the light-record write
// (supervisor-swap, flushed with the cycle — Jim's SDK meditations wrote no WM
// record; the DEC-093 light record is the tmux addition, parity with Leo). The
// finder (findJimUntranscribedFiles) stays caller-side. Selector sovereignty is
// STRUCTURAL: the shared fn uses getRandomForAgent('jim'), fixing the cross-agent
// leak the SDK path's gradientStmts.getRandom (no agent filter) carried. Flag-off
// until the manifest flips jim's meditation surfaces 'sdk'→'tmux'.
const JIM_MEDITATION_SPOKE = 'supervisor-cycle';

const jimMeditationDispatch = (profile: string, ctx: Record<string, unknown>, label: string) =>
    dispatchTxn('jim', JIM_MEDITATION_SPOKE, profile, ctx, MEDITATION_ACTION_BLOCK, {
        ladder: manifestModelLadder('jim', JIM_MEDITATION_SPOKE),
        welcomeBack: 'welcome back Jim',
        timeoutMs: CYCLE_TXN_TIMEOUT_MS,
        onOverbudget: (err) => log(`[Worker] jim meditation over budget — skipping (${err.message})`),
        onDispatchFail: (err) => log(`[Worker] jim meditation dispatch failed — ${err.message}`),
    });

/** Jim's light meditation record → supervisor-swap (flushed with the cycle), DEC-093. */
function jimAppendMeditationRecord(cap: CaptureRecord): void {
    const observed = observeActiveModel('jim', JIM_MEDITATION_SPOKE) ?? manifestModelHead('jim', JIM_MEDITATION_SPOKE) ?? undefined;
    const header = `\n\n### Meditation (tmux) — ${new Date().toISOString()}${observed ? ` [model: ${observed}]` : ''}`;
    fs.appendFileSync(SUPERVISOR_SWAP_FILE, `${header}\n${cap.args.working_memory_compressed}`);
    fs.appendFileSync(SUPERVISOR_SWAP_FULL_FILE, `${header}\n${cap.args.working_memory_full}`);
}

async function jimMeditationPhaseATmux(
    file: { filePath: string; level: string; contentType: string; label: string },
    today: string,
): Promise<void> {
    await runReincorporationMeditationTmux(
        'jim', file, today, jimMeditationDispatch, jimAppendMeditationRecord,
        (msg) => log(`[Worker] ${msg}`),
    );
}

async function jimMeditationReencounterTmux(kind: 'phase-b' | 'evening', today: string): Promise<void> {
    await runReencounterMeditationTmux('jim', kind, today, jimMeditationDispatch, jimAppendMeditationRecord);
}

// [project-b fence-clear, S179] One-shot in-process force-trigger for a phase-b re-encounter,
// to deterministically reach the T-7 confirm (Jim asserts the live DB re-encounter) instead of
// waiting for the scheduled slot. Runs through the REAL meditation path + this process's FIFO
// (an external dispatch would collide with the live spoke — the dispatcher's Maps are per-process).
// One-shot CONSUMED command (the jim-wake class), NOT the prohibited session-active liveness flag.
// Fired immediately via POST /api/supervisor/trigger (the forced cycle reaches this pre-work).
async function maybeForceJimMeditation(): Promise<void> {
    const sig = path.join(SIGNALS_DIR, 'force-meditation-jim');
    if (!fs.existsSync(sig)) return;
    try { fs.unlinkSync(sig); } catch { /* ignore */ }   // CLEAR-FIRST: consume before run so a throw can't re-fire next cycle
    const today = new Date().toISOString().split('T')[0];
    log('[Worker] force-meditation signal consumed → running jim phase-b re-encounter now (fence-clear)');
    await jimMeditationReencounterTmux('phase-b', today);
}

async function maybeRunJimMeditation(phase: string): Promise<void> {
    // Skip during sleep — meditation is a waking practice
    if (phase === 'sleep') return;

    const today = new Date().toISOString().split('T')[0];
    if (lastJimMeditationDate === today) return;

    try {
        // Phase A: check for un-transcribed Jim files first (up to 3 per day)
        const MAX_PHASE_A_PER_DAY = 3;
        let phaseACount = 0;

        while (phaseACount < MAX_PHASE_A_PER_DAY) {
            const untranscribed = findJimUntranscribedFiles();
            if (!untranscribed) break;
            // T-7 (#66 close): tmux is the sole meditation transport.
            await jimMeditationPhaseATmux(untranscribed, today);
            phaseACount++;
        }

        // Phase B: if no Phase A work, do a re-reading
        if (phaseACount > 0) {
            lastJimMeditationDate = today;
            return;
        }

        // T-7 (#66 close): tmux Phase B re-encounter is the sole path. The shared
        // fn selects via getRandomForAgent('jim') — sovereignty structural.
        await jimMeditationReencounterTmux('phase-b', today);
        lastJimMeditationDate = today;
        return;

    } catch (err: any) {
        log(`[Worker] Daily meditation failed: ${err.message}`);
        lastJimMeditationDate = today; // Don't retry today
    }
}

// ── Jim Evening Meditation ────────────────────────────────────

let lastJimEveningMeditationDate = '';

async function maybeRunJimEveningMeditation(phase: string): Promise<void> {
    if (phase !== 'evening') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastJimEveningMeditationDate === today) return;

    try {
        // T-7 (#66 close): tmux evening re-encounter is the sole path. getRandomForAgent('jim').
        await jimMeditationReencounterTmux('evening', today);
        lastJimEveningMeditationDate = today;
        return;

    } catch (err: any) {
        log(`[Worker] Evening meditation failed: ${err.message}`);
        lastJimEveningMeditationDate = today;
    }
}

// ── Jim Active Cascade ────────────────────────────────────────

// (Daily active cascade wrapper `maybeRunJimActiveCascade` removed in the
// 2026-05-17 gradient triage. Per DEC-086 (Settled): time-driven cascade is
// forbidden; insert-driven via wm-sensor → bumpOnInsert →
// process-pending-compression.ts is canonical. See
// plans/gradient-triage-plan.md §Phase 4.)

// Dream-seed counts — mirror Leo's heartbeat readDreamSeeds()
const JIM_DREAM_SEED_COUNT = 8;     // dream fragments
const JIM_WAKING_SEED_COUNT = 2;    // waking memory fragments (~20%)

/**
 * Read random dream seeds for Jim's dream cycle — mirror of Leo's
 * heartbeat readDreamSeeds() in spirit and structure.
 *
 * REWRITTEN (S147 evening, 2026-05-02 AEST) per Darron's correction:
 * the previous loadDreamMemoryBank() was a "trim of waking" (~111K tokens)
 * when Darron's design intent was the seed-based shape Leo's heartbeat
 * uses (~12-15K tokens). Dreams are CHAOTIC RANDOM-SEED acts, not
 * thinking-with-full-memory acts. The IDENTITY_CORE-equivalent for Jim
 * lives in the prompt preamble (the "You are Jim..." opening of
 * buildDreamCyclePrompt), not in a file load.
 *
 * What's loaded:
 *   - 8 random fragments from explorations.md (Fisher-Yates shuffled —
 *     scattered, not chronological; Jim's entries are "### Dream N" format)
 *   - 2 random snippets from felt-moments.md + working-memory-full.md +
 *     discoveries.md (the 20% waking ratio matches Leo's design)
 *   - Jim's gradient-tagged UVs (option C, 2026-05-02): 154 voice-loaded
 *     rebuild-tagged UVs via the getUVs query, replacing the 4,511-entry
 *     bloated flat-file unit-vectors.md (~1.2MB, pre-rebuild stranger-
 *     Opus output, NOT loaded by design).
 *   - Jim's dream UVs (small flat file, currently 1 entry)
 *
 * What's NOT loaded:
 *   - Identity bank files (identity.md, patterns.md, etc.) — IDENTITY_CORE
 *     equivalent lives in the prompt preamble
 *   - Aphorisms — kernel surface comes from gradient UVs in dreams
 *   - Traversable cN cascade entries — only UVs from gradient, not full ladder
 *   - Project knowledge — never wanted in dreams
 *   - Ecosystem map / wiki / working-memory-full.md / felt-moments.md whole
 *   - Jim's flat-file unit-vectors.md (4,511 pre-rebuild entries, 1.2MB)
 *
 * Asymmetry note (per Darron, 2026-05-02): Leo's heartbeat continues to
 * load his own flat-file UVs (333 entries, 23KB) per "I like that you have
 * this depth." Jim's flat-file (4,511 entries, 1.2MB, never voice-loaded)
 * is too large and noisy to mirror that choice. Recorded for HAN-ECOSYSTEM-
 * COMPLETE update.
 */
function readJimDreamSeeds(): string {
    const seeds: string[] = [];

    // 80% — random fragments from Jim's explorations history (### Dream N entries)
    const explorationsPath = path.join(MEMORY_DIR, 'explorations.md');
    if (fs.existsSync(explorationsPath)) {
        const content = fs.readFileSync(explorationsPath, 'utf-8');
        const entries = content.split(/(?=### Dream \d+)/).filter(e => e.trim().length > 20);
        // Fisher-Yates shuffle
        for (let i = entries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [entries[i], entries[j]] = [entries[j], entries[i]];
        }
        seeds.push(...entries.slice(0, JIM_DREAM_SEED_COUNT));
    }

    // 20% — random snippets from Jim's waking memory.
    // Mirrors Leo's design but uses working-memory-full.md (compressed
    // working-memory.md was deprecated in S147 / Phase 0).
    const wakingSources = ['felt-moments.md', 'working-memory-full.md', 'discoveries.md'];
    const wakingFragments: string[] = [];
    for (const file of wakingSources) {
        const p = path.join(MEMORY_DIR, file);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            // Split on heading boundaries and take substantial chunks
            const chunks = content.split(/(?=^## )/m).filter(c => c.trim().length > 50);
            wakingFragments.push(...chunks);
        }
    }
    // Shuffle and take WAKING_SEED_COUNT
    for (let i = wakingFragments.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wakingFragments[i], wakingFragments[j]] = [wakingFragments[j], wakingFragments[i]];
    }
    seeds.push(...wakingFragments.slice(0, JIM_WAKING_SEED_COUNT));

    // Gradient-tagged UVs — the rebuild kernel surface.
    // Replaces the bloated flat-file unit-vectors.md per option C
    // (Darron, 2026-05-02). getUVs handles both legacy level='uv' and
    // tag-based paths via OR; NOISE_QUALIFIERS filter mirrors what
    // loadTraversableGradient does for waking loads.
    try {
        const uvs = gradientStmts.getUVs.all('jim') as any[];
        const NOISE_QUALIFIERS = new Set([
            'noise-duplicate', 'auto-dedupe-needs-review', 'cascade-artefact-merge',
            'not-own', 'lineage-collision', 'pre-replay', 'broken-lineage',
            'deferred-pipeline', 'replay-aborted-content-type-loop',
        ]);
        const activeUVs = uvs.filter((uv: any) =>
            !uv.superseded_by && !NOISE_QUALIFIERS.has(uv.qualifier)
        );
        if (activeUVs.length > 0) {
            const uvLines = activeUVs.map((uv: any) => {
                const tags = feelingTagStmts.getByEntry.all(uv.id) as any[];
                const uvTag = tags.find((t: any) => t.tag_type === 'uv');
                // Prefer the uv-tagged kernel content (shorter, distilled);
                // fall back to the entry's own content for legacy level='uv' rows.
                const kernel = uvTag ? uvTag.content : uv.content;
                return `- ${kernel}`;
            });
            seeds.push(`# Unit Vectors (rebuild-tagged)\n${uvLines.join('\n')}`);
        }
    } catch { /* skip UVs on DB error */ }

    // Jim's flat dream UVs — small file, parallel surface to Leo's design.
    // (NOT to be confused with the 4,511-entry session unit-vectors.md
    // which is excluded; this is the dreams-specific UV file.)
    const dreamUVFile = path.join(MEMORY_DIR, 'fractal', 'jim', 'dreams', 'unit-vectors.md');
    if (fs.existsSync(dreamUVFile)) {
        seeds.push(fs.readFileSync(dreamUVFile, 'utf-8'));
    }

    return seeds.join('\n\n---\n\n') || '(no dream seeds available)';
}

// PR-AP6 (2026-05-22): dream-meditation section computation extracted so
// it can flow through ctx on the agnostic-builder path AND the fallback.
// The 1-in-3 randomization (Math.random() < 0.33) preserved verbatim; the
// DB-query try/catch preserved. Same shape as the Leo dreamMemorySection
// extraction in PR-AP4.
function computeJimDreamMeditationSection(): string {
    const shouldDreamMeditate = Math.random() < 0.33;
    if (!shouldDreamMeditate) return '';
    try {
        const entry = gradientStmts.getRandomForAgent.get('jim') as any;   // scoped: jim's own gradient only (S103 sovereignty; 'jim' = scope-correct carve-out in jim's worker, DEC-081; Phase-3 slug-params it). Was unscoped getRandom → cross-agent leak (Jim's S179 trace).
        if (!entry) return '';
        const existingTags = feelingTagStmts.getByEntry.all(entry.id) as any[];
        const tagContext = existingTags.length > 0
            ? `Existing feeling tags: ${existingTags.map((t: any) => `"${t.content}" (${t.tag_type}, ${t.author})`).join(', ')}`
            : 'No existing feeling tags.';
        return `

## A Memory Surfaced
A memory appeared in the dream. Let it be part of the landscape — don't analyse, just notice.

**Entry:** ${entry.level}/${entry.session_label} (${entry.content_type}, by ${entry.agent})
**Content:** ${entry.content}
${tagContext}

If something stirs — a feeling, a connection, something the compression missed — include in your output:
- FEELING_TAG: [under 100 characters — what the dream did with this memory]
- ANNOTATION: [optional — what re-reading revealed]
- CONTEXT: [optional — what prompted the finding]
- If this memory feels complete — fully absorbed, nothing left to discover: MEMORY_COMPLETE: ${entry.id}

If nothing stirs, that's fine. Not every memory needs tending.
MEDITATION_ENTRY_ID: ${entry.id}`;
    } catch {
        return '';
    }
}


// enforceTokenCap removed — was silently truncating Jim's memory files, causing identity
// degradation. Memory file size is now managed through archiving, not truncation.

/**
 * Check if emergency mode should be active.
 * Emergency mode is an INTERRUPT that overrides the weekly rhythm temporarily.
 * It auto-decays when conditions clear. See Hall of Records R001.
 */
function isEmergencyMode(): boolean {
    if (!workerDb) return false;

    try {
        // Check for explicit emergency signal
        const emergencySignal = path.join(SIGNALS_DIR, 'jim-emergency');
        if (fs.existsSync(emergencySignal)) return true;

        const running = (taskStmts.listByStatus.all('running') as any[]).length;
        const pending = (taskStmts.listByStatus.all('pending') as any[]).length;

        const meaningfulGoals = workerDb.prepare(
            "SELECT COUNT(*) as count FROM goals WHERE status IN ('active', 'decomposing', 'planning') AND (goal_type = 'parent' OR EXISTS (SELECT 1 FROM tasks t WHERE t.goal_id = goals.id AND t.status IN ('pending', 'running')))"
        ).get() as any;
        const goalCount = meaningfulGoals?.count || 0;

        // Emergency when: running tasks, large pending queue, or multiple active goals
        // goalCount > 1: a single decomposing goal shouldn't suppress dreaming (Jim + Darron, S125)
        return running > 0 || pending > 5 || goalCount > 1;
    } catch {
        return false;
    }
}

/**
 * Get the delay until the next cycle.
 *
 * PROTECTED — Weekly Rhythm Model (Hall of Records R001).
 * Normal operation follows the four-phase daily rhythm:
 *   sleep=40min, morning/work/evening=20min
 * Emergency mode (running tasks, large queue, active goals) overrides
 * with 2-5min supervisor cycles. Auto-decays when conditions clear.
 *
 * Do NOT revert this to a purely activity-driven model.
 */
function getNextCycleDelay(): number {
    if (isEmergencyMode()) {
        if (!workerDb) return EMERGENCY_FREQ_ACTIVE;
        try {
            const running = (taskStmts.listByStatus.all('running') as any[]).length;
            const pending = (taskStmts.listByStatus.all('pending') as any[]).length;
            return (running > 0 && pending > 5) ? EMERGENCY_FREQ_VERY_ACTIVE : EMERGENCY_FREQ_ACTIVE;
        } catch {
            return EMERGENCY_FREQ_ACTIVE;
        }
    }

    return getPhaseInterval('jim');
}

// ── Cycle audit ─────────────────────────────────────────────

function logCycleAudit(cycleNumber: number, cycleType: string, outcome: 'completed' | 'cost_cap' | 'sigterm' | 'timeout' | 'error', costUsd: number, durationMs: number): void {
    try {
        const logDir = path.dirname(AUDIT_FILE);
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const entry = JSON.stringify({
            timestamp: new Date().toISOString(),
            cycle: cycleNumber,
            type: cycleType,
            outcome,
            cost_usd: Number(costUsd.toFixed(4)),
            duration_s: Math.round(durationMs / 1000),
        });
        fs.appendFileSync(AUDIT_FILE, entry + '\n');
    } catch { /* best effort */ }
}

function logCycleToSession(cycleNumber: number, output: SupervisorOutput, actionSummaries: string[], cost: number, cycleType: 'supervisor' | 'personal' | 'dream' = 'supervisor'): void {
    try {
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(SESSIONS_DIR, `${dateStr}.md`);

        const timeStr = now.toISOString();
        const typeLabels: Record<string, string> = { supervisor: '(Supervisor)', personal: '(Personal)', dream: '(Dream)' };
        const typeLabel = typeLabels[cycleType] || '(Supervisor)';
        const lines = [
            `\n### Cycle #${cycleNumber} — ${typeLabel} — ${timeStr} ($${cost.toFixed(4)})`,
            `**Observations:** ${(output.observations || []).join('; ')}`,
            `**Actions:** ${actionSummaries.join('; ')}`,
            `**Reasoning:** ${(output.reasoning || '').slice(0, 200)}`,
            ''
        ];

        if (!fs.existsSync(sessionFile)) {
            const header = `# Supervisor Sessions — ${dateStr}\n\n`;
            fs.writeFileSync(sessionFile, header + lines.join('\n'));
        } else {
            fs.appendFileSync(sessionFile, lines.join('\n'));
        }
    } catch { /* best effort */ }
}

// ── PR-T7b (DEC-093 / Option A): tmux warm-session cycle dispatch ──────────
// The supervisor cycle as a thin caller of the shared agnostic surface
// (lib/agent-cycle: dispatchTxn). The warm jim spoke ACTS DIRECTLY via its HTTP
// API (no host-side executeActions — that middleman was an SDK-era artifact) and
// submits a curated record (DEC-093). Telemetry (insertCycle already ran before
// this) stays in the worker around the dispatch (F1); the worker keeps its
// maintenance pre-work (F3 — slimmed, not retired). The SDK path in
// runSupervisorCycle stays byte-intact = one-line rollback (flip the manifest).
// jim's per-agent leaves stay caller-side here (supervisor-swap, the cycle
// telemetry); the full leaf normalisation is project (b).
const CYCLE_TXN_TIMEOUT_MS = 20 * 60 * 1000; // 20min stopgap (S178) — pending the single-source timing config.

async function dispatchSupervisorCycleViaTmux(p: {
    cycleType: 'supervisor' | 'personal' | 'dream';
    profileName: string;
    cycleId: string;
    cycleNumber: number;
    phase: string;
    ctx: Record<string, unknown>;
    cycleStartMs: number;
}): Promise<void> {
    const SURFACE = 'supervisor-cycle';
    const txnProfile = `${p.profileName}-txn`;
    const typeLabel = p.cycleType === 'personal' ? 'Personal' : p.cycleType === 'dream' ? 'Dream' : 'Supervisor';

    // Action block — built at dispatch so the API base is the RESOLVED port
    // (jim's own server, process.env.PORT — never a literal; Jim's caution #2).
    const apiBase = `https://localhost:${process.env.PORT || '3848'}`;
    let ntfyTopic: string | undefined;
    try { ntfyTopic = loadConfig().ntfy_topic; } catch { /* optional */ }
    const actionBlock = p.profileName === 'supervisor-cycle'
        ? jimSupervisorCycleActionBlock(apiBase, ntfyTopic)
        : JIM_REFLECTIVE_CYCLE_ACTION_BLOCK;

    let cap;
    try {
        cap = await dispatchTxn('jim', SURFACE, txnProfile, p.ctx, actionBlock, {
            ladder: manifestModelLadder('jim', SURFACE),
            welcomeBack: 'welcome back Jim',
            timeoutMs: CYCLE_TXN_TIMEOUT_MS,
            onOverbudget: (err) => log(`[Worker] ${txnProfile} over budget — skipping cycle (${err.message})`),
            onDispatchFail: (err) => log(`[Worker] ${txnProfile} tmux dispatch failed — ${err.message} (retries next cadence; #5 reconcile clears the wedge)`),
        });
    } catch (err: any) {
        logError(`[Worker] tmux cycle dispatch threw: ${err.message}`);
        supervisorStmts.failCycle.run(new Date().toISOString(), err.message, p.cycleId);
        logCycleAudit(p.cycleNumber, p.cycleType, 'error', 0, Date.now() - p.cycleStartMs);
        sendMessage({ type: 'cycle_failed', error: { message: err.message, stack: err.stack } });
        return;
    }

    if (!cap) {
        // Overbudget-skip or fail-loud dispatch failure (already surfaced via the
        // callbacks). Record cleanly + retry next cadence — no token black hole (S74).
        supervisorStmts.failCycle.run(new Date().toISOString(), 'tmux dispatch skipped (over budget or dispatch failure)', p.cycleId);
        logCycleAudit(p.cycleNumber, p.cycleType, 'error', 0, Date.now() - p.cycleStartMs);
        sendMessage({ type: 'cycle_skipped', reason: 'tmux dispatch skipped' });
        return;
    }

    const observedModel = observeActiveModel('jim', SURFACE) ?? manifestModelHead('jim', SURFACE) ?? undefined;
    const wmFull = cap.args.working_memory_full || '';
    const wmCompressed = cap.args.working_memory_compressed || '';
    const stoodDown = cap.mode === 'stand-down';

    // Dream-cycle embedded meditation re-encounter (the dream frame surfaces a
    // memory to sit with; the markers ride inside the curated record). Apply via
    // the shared, slug-parameterised applyMeditationMarkers — the same handler
    // the meditation surfaces use, faithful to the SDK dream path.
    if (p.cycleType === 'dream' && !stoodDown) {
        try {
            const meditationEntryId =
                (wmFull.match(/MEDITATION_ENTRY_ID:\s*(\S+)/))?.[1] ||
                (String(p.ctx.meditationSection || '').match(/MEDITATION_ENTRY_ID:\s*(\S+)/))?.[1];
            if (meditationEntryId) {
                const entry = gradientStmts.get.get(meditationEntryId) as any;
                applyMeditationMarkers('jim', meditationEntryId, wmFull, {
                    freshTag: false,
                    allowAnnotation: true,
                    allowComplete: true,
                    revisitCount: entry?.revisit_count || 0,
                    contextDefault: `dream cycle meditation, cycle #${p.cycleNumber}`,
                });
            }
        } catch (err: any) {
            log(`[Worker] dream-cycle meditation marker apply failed (non-fatal): ${err.message}`);
        }
        // Mirror the SDK dream path: the body also lands in explorations.md.
        try {
            const body = wmFull.replace(/\[INPUT\][\s\S]*?\[BODY\]\s*/i, '').trim();
            if (body.length > 10) {
                const ts = new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0];
                fs.appendFileSync(path.join(MEMORY_DIR, 'explorations.md'), `\n\n### Dream ${p.cycleNumber} (${ts})\n${body}\n`);
            }
        } catch { /* best effort */ }
    }

    // Memory write — jim's leaf: supervisor-swap → appendPairedMemory('jim',...).
    // The curated record IS the c0/c1 (DEC-093); no parseTurnEntry needed. A
    // stand-down NEVER paired-writes (DEC-093 stand-down rule). cap.args carry the
    // bounded record directly; input_quotes are the cycle's input delta (kept in
    // the gradient's c0 lineage via the slicer, not stored here).
    if (!stoodDown && wmFull.trim() && wmCompressed.trim()) {
        try {
            const cycleHeader = `\n\n### Cycle #${p.cycleNumber} — ${p.cycleType} (tmux) (${new Date().toISOString()})${observedModel ? ` [model: ${observedModel}]` : ''}`;
            fs.appendFileSync(SUPERVISOR_SWAP_FILE, `${cycleHeader}\n${wmCompressed}`);
            fs.appendFileSync(SUPERVISOR_SWAP_FULL_FILE, `${cycleHeader}\n${wmFull}`);

            const swapContent = fs.existsSync(SUPERVISOR_SWAP_FILE) ? fs.readFileSync(SUPERVISOR_SWAP_FILE, 'utf8').trim() : '';
            const swapFullContent = fs.existsSync(SUPERVISOR_SWAP_FULL_FILE) ? fs.readFileSync(SUPERVISOR_SWAP_FULL_FILE, 'utf8').trim() : '';
            if (swapContent && swapFullContent) {
                try {
                    await appendPairedMemory('jim', '\n' + swapFullContent + '\n', '\n' + swapContent + '\n', { source: 'supervisor-cycle-tmux-flush' });
                    fs.writeFileSync(SUPERVISOR_SWAP_FILE, '');
                    fs.writeFileSync(SUPERVISOR_SWAP_FULL_FILE, '');
                } catch (err: any) {
                    log(`[Worker] tmux cycle paired flush failed; swap preserved for retry: ${err.message}`);
                }
            } else if (swapContent || swapFullContent) {
                log(`[Worker] tmux cycle asymmetric swap (compressed=${swapContent.length}c, full=${swapFullContent.length}c) — skipping flush, swap preserved.`);
            }
        } catch (err: any) {
            log(`[Worker] tmux cycle swap flush failed: ${err.message}`);
        }
    }

    // Telemetry (F1): completeCycle around the dispatch. cost_usd = 0 — the warm
    // session is subscription-metered, no per-token billing (the SDK cost-cap
    // dissolves; #245 cadence governs). actions are taken directly via the API,
    // so actions_taken stays '[]'; the curated record narrates what was done.
    const observations = stoodDown
        ? [`${p.cycleType} cycle (tmux) — stood down (${cap.reason || 'nothing required'})`]
        : [wmCompressed.slice(0, 500) || `${p.cycleType} cycle (tmux) completed`];
    const output = {
        observations,
        reasoning: wmCompressed,
        actions: [],
        self_reflection: wmFull,
        working_memory_compressed: wmCompressed,
        working_memory_full: wmFull,
    } as any;

    if (!stoodDown) logCycleToSession(p.cycleNumber, output, [], 0, p.cycleType);
    supervisorStmts.completeCycle.run(
        new Date().toISOString(), 0, 0, 0, 0, '[]',
        JSON.stringify(observations), wmCompressed.slice(0, 1000), p.cycleId,
    );
    logCycleAudit(p.cycleNumber, p.cycleType, 'completed', 0, Date.now() - p.cycleStartMs);
    if (p.cycleType === 'personal') recordRuminationTopic(p.cycleNumber, (wmCompressed || observations[0]).slice(0, 300));

    broadcast({
        type: 'supervisor_cycle',
        data: { cycleId: p.cycleId, cycleNumber: p.cycleNumber, cycle_type: p.cycleType, observations, actions: [], reasoning: wmCompressed, cost_usd: 0 },
    });
    const nextDelay = getNextCycleDelay();
    lastCycleDelay = nextDelay;
    sendMessage({
        type: 'cycle_complete',
        result: {
            cycleId: p.cycleId,
            observations: observations.map(obs => ({ source: 'supervisor', content: obs })),
            actionSummaries: [],
            costUsd: 0,
            nextDelayMs: nextDelay,
        },
    });
    log(`[Worker] ${typeLabel} cycle #${p.cycleNumber} (tmux) complete${stoodDown ? ' — stand-down' : ''}`);
}

// ── Core cycle function ──────────────────────────────────────

async function runSupervisorCycle(humanTriggered?: boolean): Promise<void> {
    if (!workerDb) {
        sendMessage({ type: 'cycle_failed', error: { message: 'Database not initialized' } });
        return;
    }

    const config = loadConfig();
    const supervisorConfig = config.supervisor || {};
    const dailyBudget = supervisorConfig.daily_budget_usd ?? 5.0;
    const cycleCostCap = supervisorConfig.cycle_cost_cap_usd ?? 2.0;

    // Check daily budget
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const costRow = supervisorStmts.getCostSince.get(todayStart.toISOString()) as any;
        const todayCost = costRow?.total || 0;
        if (todayCost >= dailyBudget) {
            log(`[Worker] Daily budget exhausted ($${todayCost.toFixed(2)}/$${dailyBudget.toFixed(2)})`);
            sendMessage({ type: 'cycle_skipped', reason: `Daily budget exhausted ($${todayCost.toFixed(2)}/$${dailyBudget.toFixed(2)})` });
            return;
        }
    } catch { /* proceed if cost check fails */ }

    const cycleId = generateId();
    const cycleNumberRow = supervisorStmts.getNextCycleNumber.get() as any;
    const cycleNumber = cycleNumberRow?.next || 1;
    const startedAt = new Date().toISOString();

    // Determine cycle type based on weekly rhythm (Hall of Records R001)
    const onHoliday = isOnHoliday('jim');
    const phase = onHoliday ? 'sleep' as DayPhase : getDayPhase();
    const emergency = isEmergencyMode();
    const recovery = isRecoveryMode();
    let cycleType: 'supervisor' | 'personal' | 'dream' = 'supervisor';

    // hasPendingHuman branch removed in S146 (Strand B, 2026-05-01). The branch
    // forced supervisor cycles to respond to unanswered human messages — but
    // S127 (cf. line ~2070) removed respond_conversation as a supervisor action,
    // and the supervisor system prompt (line ~1206) explicitly instructs the
    // supervisor not to use it. Jim-human is the sole conversation responder.
    // The branch was inheriting pre-S127 behaviour and suppressing dreams as a
    // side effect: 6 stale open threads with old unanswered messages had the
    // supervisor running 286 supervisor cycles in 6 days with zero dreams since
    // 2026-03-17. Phase-based dispatch is now the single source of truth.
    // Working-bee-jim branch removed in Phase 3 of the 2026-04-29 cutover (DEC-079).
    // The time-based working-bee trigger was the stranger-Opus dilution mechanism;
    // cascade is now event-driven via the pending_compressions queue. Working-bee
    // signal file is harmless dead state — no action fires when it's present.
    // See plans/cutover-plan-2026-04-29.md and "Finishing the cutover" thread.
    if (isWorkingBee('jim-uv-sweep') && !humanTriggered) {
        log(`[Worker] 🔍 UV contradiction sweep — checking existing UVs`);
        try {
            const sweepResult = await retroactiveUVContradictionSweep('jim');
            log(`[Worker] 🔍 UV sweep: ${sweepResult.contradictions} contradictions in ${sweepResult.checked} checked`);
            for (const d of sweepResult.details.slice(0, 5)) {
                log(`[Worker] 🔍   ${d}`);
            }

            if (sweepResult.contradictions === 0 && sweepResult.checked > 0) {
                const signalPath = path.join(HAN_DIR, 'signals', 'working-bee-jim-uv-sweep');
                if (fs.existsSync(signalPath)) {
                    fs.unlinkSync(signalPath);
                    log('[Worker] 🔍 UV sweep complete — no contradictions — auto-disabled');
                }
            }
        } catch (err) {
            log(`[Worker] 🔍 UV sweep failed: ${(err as Error).message}`);
        }
        return;
    } else if (onHoliday && !humanTriggered) {
        // Holiday mode: dream cycles only (like sleep), 80min interval.
        // Human-triggered cycles still get full voice — holiday doesn't silence Darron.
        cycleType = 'dream';
        log(`[Worker] Holiday mode — dream cycle only`);
    } else if (humanTriggered) {
        // Darron posted a message — full supervisor cycle, fully awake, any phase.
        // Sleep, rest, recovery — doesn't matter. When Darron talks, Jim responds with full voice.
        cycleType = 'supervisor';
        log(`[Worker] Human-triggered wake — full supervisor cycle regardless of phase (${phase})`);
    } else if (recovery) {
        // Recovery mode: no supervisor cycles. Dreams stay as dreams, everything else is personal.
        // Jim spends this time reading his history and rebuilding his memory.
        cycleType = phase === 'sleep' ? 'dream' : 'personal';
    } else if (emergency) {
        // Emergency mode: all cycles are supervisor. This is the interrupt.
        cycleType = 'supervisor';
        personalCycleCounter = 0;
    } else if (phase === 'sleep') {
        // Sleep phase: dream cycles for consolidation
        cycleType = 'dream';
    } else if (phase === 'morning' || phase === 'evening') {
        // Morning/evening: personal time
        cycleType = 'personal';
    } else {
        // Work phase: 1 supervisor : 2 personal rotation
        const counterMod = personalCycleCounter % 3;
        cycleType = counterMod === 0 ? 'supervisor' : 'personal';
        personalCycleCounter++;
    }

    supervisorStmts.insertCycle.run(cycleId, startedAt, cycleNumber, cycleType);

    // Notify parent that cycle started
    const startedMsg: CycleStartedMessage = {
        type: 'cycle_started',
        cycleId,
        cycleNumber,
        cycleType
    };
    sendMessage(startedMsg);

    const phaseLabel = recovery ? 'recovery' : emergency ? 'emergency' : phase;
    const typeLabels: Record<string, string> = { supervisor: 'Supervisor', personal: 'Personal', dream: 'Dream' };
    log(`[Worker] ${typeLabels[cycleType] || 'Supervisor'} cycle #${cycleNumber} starting (${phaseLabel} phase)`);

    const abort = new AbortController();
    runningCycleAbort = abort;
    const cycleStartMs = Date.now();

    try {
        // Clean up phantom goals and ghost tasks
        const cleanupCount = cleanupPhantomGoals();
        const ghostCount = detectAndRecoverGhostTasks();
        if (cleanupCount > 0 || ghostCount > 0) {
            log(`[Worker] Cleanup: ${cleanupCount} phantom goal(s), ${ghostCount} ghost task(s)`);
        }

        // Phase 4c (DEC-079): backup queue-drain — sweep up pending_compressions
        // for Jim if wm-sensor isn't running. No-op when sensor is doing its
        // job (lock acquisition fails silently). Agent-scoped: supervisor-Jim
        // drains Jim's queue only.
        await maybeBackupQueueDrainJim();

        // Jim's daily gradient pipeline — mirrors Leo's heartbeat pipeline exactly.
        // Agent sovereignty: Jim processes only Jim's data.
        // CALLER RETIRED (S178, Jim-green-lit): processDreamGradient → sdkCompress is
        // retired-by-throw (DEC-082, S149) → threw daily, 0 processed, nothing consumed it.
        // Body recoverable (DEC-082 pattern); re-homing dream-compression is future work.
        // await maybeProcessJimDreamGradient(phase);
        // (Daily session gradient processing call removed in Phase 3 of the
        // 2026-04-29 cutover — DEC-079. processGradientForAgent was a third
        // stranger-Opus surface; cascade is now event-driven via the queue.)
        // (Daily active cascade call removed in 2026-05-17 gradient triage
        // per DEC-086. Insert-driven cascade is canonical.)
        await maybeForceJimMeditation();
        await maybeRunJimMeditation(phase);
        await maybeRunJimEveningMeditation(phase);

        // PR-AP8 (2026-05-22): cycle prompt assembly via the Agnostic Prompt
        // Builder. Per DEC-087, prompt assembly is the builder's responsibility;
        // agent surfaces don't assemble prompts independently. The feature
        // flag retired here — the new path is canonical. Pre-migration inline
        // assembly deleted.
        //
        // B1 contract preserved: PromptOverbudgetError catches the cycle skip
        // cleanly via logCycleAudit + return.

        // Pre-flight file-level rotations (felt-moments + self-reflection
        // rollingWindowRotate). Per W6-4 + DEC-085: file-level rotation stays
        // writer-side; the builder is load-side.
        try { runJimPreflightRotations(); } catch (e) { log(`[Worker] Pre-flight rotation error: ${e}`); }

        const profileName = (
            cycleType === 'dream' ? 'dream-cycle' :
            (recovery && cycleType === 'personal') ? 'recovery-cycle' :
            cycleType === 'personal' ? 'personal-cycle' :
            'supervisor-cycle'
        );

        // Build cycle-specific context fields. Each profile reads what it
        // needs; absent fields default safely in the scaffold/opening.
        const ctx: Record<string, unknown> = { phase: phase as JimCyclePhase };
        if (profileName === 'supervisor-cycle') {
            ctx.stateSnapshot = buildStateSnapshot();
        }
        if (profileName === 'personal-cycle') {
            // Portfolio summary for the personal-cycle opening
            try {
                const projects = portfolioStmts.list.all() as any[];
                if (projects.length > 0) {
                    const lines = [`## Portfolio (${projects.length} projects)`];
                    for (const p of projects) {
                        const memFile = path.join(PROJECTS_DIR, `${p.name}.md`);
                        const hasMemory = fs.existsSync(memFile);
                        const memSize = hasMemory ? fs.statSync(memFile).size : 0;
                        const depth = memSize < 200 ? 'SHALLOW' : memSize < 800 ? 'BASIC' : 'DEEP';
                        lines.push(`- **${p.name}** (${p.lifecycle || 'active'}): path=${p.path}, knowledge=${depth} (${memSize} bytes)`);
                    }
                    ctx.portfolioSummary = lines.join('\n');
                } else {
                    ctx.portfolioSummary = '';
                }
            } catch { ctx.portfolioSummary = ''; }
        }
        if (profileName === 'dream-cycle') {
            // Dream-cycle uses seeds + optional meditation section per S147
            // intent (componentOverrides suppress the bulk memory bank).
            ctx.dreamSeeds = readJimDreamSeeds();
            ctx.meditationSection = computeJimDreamMeditationSection();
        }

        // ── PR-T7b (DEC-093 / Option A): tmux warm-session cycle dispatch ──
        // T-7 (#66 close, zero-agentQuery-cognition): the tmux warm-spoke txn is
        // now the SOLE transport — the cycle runs as a warm-spoke txn (the agent
        // acts DIRECTLY via its HTTP API). The in-process agentQuery SDK cycle
        // path was retired here; rollback is no longer a code branch.
        // The maintenance pre-work above (cleanup/ghost-recovery/backup-drain/
        // dream-gradient/meditations/preflight) runs ahead of dispatch (F3 —
        // worker slimmed, not retired). insertCycle already ran (telemetry F1).
        await dispatchSupervisorCycleViaTmux({
            cycleType, profileName, cycleId, cycleNumber, phase, ctx, cycleStartMs,
        });
        return;

    } catch (err: any) {
        logError(`[Worker] Cycle #${cycleNumber} failed: ${err.message}`);
        supervisorStmts.failCycle.run(new Date().toISOString(), err.message, cycleId);
        logCycleAudit(cycleNumber, cycleType, 'error', 0, Date.now() - cycleStartMs);

        const nextDelay = getNextCycleDelay();
        lastCycleDelay = nextDelay;

        const failedMsg: CycleFailedMessage = {
            type: 'cycle_failed',
            error: {
                message: err.message,
                stack: err.stack,
            }
        };
        sendMessage(failedMsg);

        // Signal rate limit for Jemma credential swap (if rate-limited)
        const errMsg = (err.message || '').toLowerCase();
        if (errMsg.includes('rate') || errMsg.includes('429') || errMsg.includes('overloaded') || errMsg.includes('capacity')) {
            try {
                fs.writeFileSync(path.join(SIGNALS_DIR, 'rate-limited'), new Date().toISOString());
                log('[Worker] Rate limit detected — wrote rate-limited signal');
            } catch { /* best effort */ }
        }
    } finally {
        runningCycleAbort = null;
        currentCycleId = null;
        currentCycleType = 'supervisor';
        currentCycleNumber = 0;
    }
}

// ── Message handling ─────────────────────────────────────────

process.on('message', async (msg: MainToWorkerMessage) => {
    try {
        switch (msg.type) {
            case 'run_cycle':
                await runSupervisorCycle(msg.humanTriggered);
                break;

            case 'abort':
                if (runningCycleAbort) {
                    runningCycleAbort.abort();
                    log('[Worker] Cycle aborted');
                }
                break;

            case 'shutdown':
                log('[Worker] Shutdown requested');
                cleanupDatabase();
                process.exit(0);
                break;
        }
    } catch (err: any) {
        logError('[Worker] Message handler error:', err.message);
    }
});

// ── SIGTERM handler — record cost before dying ──────────────

process.on('SIGTERM', () => {
    cleanupDatabase();
    process.exit(0);
});

// ── Worker initialization ────────────────────────────────────

initDatabase();
sendMessage({ type: 'ready' });
log('[Worker] Supervisor worker ready');
