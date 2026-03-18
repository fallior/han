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
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
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
import { getDayPhase, isRestDay, getPhaseInterval, isOnHoliday, type DayPhase } from '../lib/day-phase';
import { withMemorySlot } from '../lib/memory-slot';
import { readDreamGradient } from '../lib/dream-gradient';
import { rotateMemoryFile, compressMemoryFileGradient, loadMemoryFileGradient, loadFloatingMemory } from '../lib/memory-gradient';

// ── Types ────────────────────────────────────────────────────

interface SupervisorAction {
    type: 'create_goal' | 'adjust_priority' | 'update_memory' |
          'send_notification' | 'cancel_task' | 'explore_project' | 'propose_idea' | 'respond_conversation' | 'no_action';
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
    active_context_update: string;
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
const TASKS_DB_PATH = path.join(HAN_DIR, 'tasks.db');
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
let currentCycleTokensIn = 0;
let currentCycleTokensOut = 0;
let currentCycleType: string = 'supervisor';
let currentCycleNumber: number = 0;
let currentCyclePartialContent: string[] = [];  // accumulated assistant text blocks

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
let conversationMessageStmts: any = {};

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

function readPostDelineation(): string | null {
    try {
        const content = fs.readFileSync(SUPERVISOR_SWAP_FULL_FILE, 'utf8');
        const idx = content.lastIndexOf(DELINEATION_MARKER);
        if (idx >= 0) {
            const post = content.slice(idx + DELINEATION_MARKER.length).trim();
            return post.length > 10 ? post : null;
        }
    } catch { /* no swap file */ }
    return null;
}

// ── Conversation claim mechanism ─────────────────────────────
// Prevents duplicate responses when both jim-human and supervisor-worker
// try to respond to the same conversation concurrently.
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 min claim expiry

function claimConversation(conversationId: string): boolean {
    const claimPath = path.join(SIGNALS_DIR, `responding-to-${conversationId}`);
    try {
        if (fs.existsSync(claimPath)) {
            const content = fs.readFileSync(claimPath, 'utf8');
            const claim = JSON.parse(content);
            if (Date.now() - claim.timestamp < CLAIM_TTL_MS) {
                log(`[Worker] Conversation ${conversationId} already claimed by ${claim.agent}`);
                return false;
            }
        }
        fs.writeFileSync(claimPath, JSON.stringify({
            agent: 'supervisor-worker',
            timestamp: Date.now(),
            pid: process.pid
        }));
        return true;
    } catch {
        return true; // best effort — proceed if claim mechanism fails
    }
}

function releaseConversationClaim(conversationId: string): void {
    try {
        const claimPath = path.join(SIGNALS_DIR, `responding-to-${conversationId}`);
        if (fs.existsSync(claimPath)) {
            const content = fs.readFileSync(claimPath, 'utf8');
            const claim = JSON.parse(content);
            if (claim.agent === 'supervisor-worker') {
                fs.unlinkSync(claimPath);
            }
        }
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
        insert: workerDb.prepare('INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'),
        getLastSupervisorResponse: workerDb.prepare('SELECT created_at FROM conversation_messages WHERE conversation_id = ? AND role = \'supervisor\' ORDER BY created_at DESC LIMIT 1'),
        getRecent: workerDb.prepare('SELECT id, role, content, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'),
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

function loadMemoryBank(): string {
    const parts: string[] = [];

    // Pre-flight: rotate oversized memory files (fast, no API)
    // Floating memory design: living → floating crossfade at 50KB threshold
    const FRACTAL_DIR = path.join(MEMORY_DIR, 'fractal', 'jim');
    try {
        const fmResult = rotateMemoryFile(
            path.join(MEMORY_DIR, 'felt-moments.md'),
            '# Jim — Felt Moments\n\n> Older entries live in the floating file and fractal gradient. Nothing is lost.\n',
        );
        if (fmResult.rotated && fmResult.floatingPath) {
            log(`[Worker] Felt-moments rotated: ${fmResult.entriesRotated} entries → floating. Fresh living file created.`);
            // Fire-and-forget: compress floating through gradient in background
            compressMemoryFileGradient(fmResult.floatingPath, path.join(FRACTAL_DIR, 'felt-moments'), 'felt-moments')
                .then(r => log(`[Worker] Felt-moments gradient: ${r.c1FilesCreated} c1 files, ${r.cascades} cascades, ${r.errors.length} errors`))
                .catch(e => log(`[Worker] Felt-moments gradient error: ${e}`));
        }

        const wmResult = rotateMemoryFile(
            path.join(MEMORY_DIR, 'working-memory-full.md'),
            '# Jim — Working Memory (Full)\n\n> Older entries live in the floating file and fractal gradient. Nothing is lost.\n',
        );
        if (wmResult.rotated && wmResult.floatingPath) {
            log(`[Worker] Working-memory-full rotated: ${wmResult.entriesRotated} entries → floating. Fresh living file created.`);
            compressMemoryFileGradient(wmResult.floatingPath, path.join(FRACTAL_DIR, 'working-memory'), 'working-memory')
                .then(r => log(`[Worker] Working-memory gradient: ${r.c1FilesCreated} c1 files, ${r.cascades} cascades, ${r.errors.length} errors`))
                .catch(e => log(`[Worker] Working-memory gradient error: ${e}`));
        }
    } catch (e) { log(`[Worker] Memory file pre-flight error: ${e}`); }

    // Identity files first — you know who you are before you remember what you did
    for (const file of ['identity.md', 'active-context.md', 'patterns.md', 'failures.md', 'self-reflection.md', 'felt-moments.md', 'working-memory.md', 'working-memory-full.md']) {
        const filepath = path.join(MEMORY_DIR, file);
        try {
            if (fs.existsSync(filepath)) {
                parts.push(`--- ${file} ---\n${fs.readFileSync(filepath, 'utf8')}`);
            }
        } catch { /* skip unreadable files */ }
    }

    // Fractal memory gradient — loaded feeling first (highest compression → lowest)
    // See Hall of Records R005: unit vectors first, then c5→c4→c3→c2→c1→c0
    try {
        const agentName = 'jim';
        const fractalDir = path.join(MEMORY_DIR, 'fractal', agentName);

        // Unit vectors first — irreducible emotional kernels
        try {
            const unitVectorsFile = path.join(fractalDir, 'unit-vectors.md');
            if (fs.existsSync(unitVectorsFile) && fs.statSync(unitVectorsFile).size > 0) {
                const uvContent = fs.readFileSync(unitVectorsFile, 'utf8');
                parts.push(`--- fractal/unit-vectors ---\n${uvContent}`);
            }
        } catch { /* skip unit vectors on error */ }

        // Gradient levels: highest compression → lowest (c5→c4→c3→c2→c1)
        const gradientLevels = [
            { level: 'c5', count: 15 },
            { level: 'c4', count: 12 },
            { level: 'c3', count: 9 },
            { level: 'c2', count: 6 },
            { level: 'c1', count: 3 },
        ];

        for (const { level, count } of gradientLevels) {
            try {
                const dir = path.join(fractalDir, level);
                if (fs.existsSync(dir)) {
                    const files = fs.readdirSync(dir)
                        .filter(f => f.endsWith('.md'))
                        .sort()
                        .reverse()
                        .slice(0, count);
                    for (const f of files) {
                        const content = fs.readFileSync(path.join(dir, f), 'utf8');
                        parts.push(`--- fractal/${level} (${f}) ---\n${content}`);
                    }
                }
            } catch { /* skip on error */ }
        }

        // c=0 (full): most recent session from sessions/
        try {
            if (fs.existsSync(SESSIONS_DIR)) {
                const sessionFiles = fs.readdirSync(SESSIONS_DIR)
                    .filter(f => f.endsWith('.md') && f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
                    .sort()
                    .reverse();
                if (sessionFiles.length > 0) {
                    const c0Content = fs.readFileSync(path.join(SESSIONS_DIR, sessionFiles[0]), 'utf8');
                    parts.push(`--- fractal/c0 (${sessionFiles[0]}) ---\n${c0Content}`);
                }
            }
        } catch { /* skip c0 on error */ }
    } catch { /* skip fractal gradient on error */ }

    // Jim's own dream gradient (his dreams shape his waking identity)
    try {
        const jimDreamContent = readDreamGradient('jim');
        if (jimDreamContent) {
            parts.push(`--- jim-dream-gradient ---\n${jimDreamContent}`);
        }
    } catch { /* skip Jim dream gradient on error */ }

    // Leo's dream gradient (Leo's dreams subtly shape the ecosystem)
    try {
        const leoDreamContent = readDreamGradient('leo');
        if (leoDreamContent) {
            parts.push(`--- leo-dream-gradient ---\n${leoDreamContent}`);
        }
    } catch { /* skip Leo dream gradient on error */ }

    // Project knowledge — fractal gradient loading by access recency.
    // Most recently touched project at full fidelity (c0), then decreasing
    // resolution for older projects. Uses file mtime as access signal.
    // Falls back to full content when compressed versions don't exist yet.
    try {
        if (fs.existsSync(PROJECTS_DIR)) {
            const projectFiles = fs.readdirSync(PROJECTS_DIR)
                .filter(f => f.endsWith('.md'))
                .map(f => {
                    const filepath = path.join(PROJECTS_DIR, f);
                    const stat = fs.statSync(filepath);
                    return { name: f, path: filepath, mtime: stat.mtimeMs, size: stat.size };
                })
                .sort((a, b) => b.mtime - a.mtime); // Most recent first

            const PROJECT_GRADIENT = [
                { level: 'c0', count: 1 },   // Full fidelity — current focus
                { level: 'c1', count: 3 },   // ~1/3 compression — recent
                { level: 'c2', count: 6 },   // ~1/9 compression
                { level: 'c3', count: 12 },  // ~1/27 compression
                { level: 'c4', count: 24 },  // ~1/81 compression
                { level: 'c5', count: 48 },  // ~1/243 compression
            ];

            const projectGradientDir = path.join(MEMORY_DIR, 'fractal', 'jim', 'projects');
            let idx = 0;

            for (const tier of PROJECT_GRADIENT) {
                const tierFiles = projectFiles.slice(idx, idx + tier.count);
                for (const pf of tierFiles) {
                    if (tier.level === 'c0') {
                        // Full fidelity — load entire file
                        const content = fs.readFileSync(pf.path, 'utf8');
                        parts.push(`--- projects/${pf.name} (c0 — current focus) ---\n${content}`);
                    } else {
                        // Try compressed version first, fall back to full
                        const compressedPath = path.join(projectGradientDir, tier.level, pf.name);
                        if (fs.existsSync(compressedPath)) {
                            const content = fs.readFileSync(compressedPath, 'utf8');
                            parts.push(`--- projects/${pf.name} (${tier.level}) ---\n${content}`);
                        } else {
                            // No compressed version yet — load full but mark the tier
                            const content = fs.readFileSync(pf.path, 'utf8');
                            parts.push(`--- projects/${pf.name} (${tier.level}, uncompressed) ---\n${content}`);
                        }
                    }
                }
                idx += tier.count;
            }

            // Unit vectors for any remaining projects beyond the gradient
            const uvPath = path.join(projectGradientDir, 'unit-vectors.md');
            if (idx < projectFiles.length && fs.existsSync(uvPath)) {
                const uvContent = fs.readFileSync(uvPath, 'utf8');
                parts.push(`--- projects/unit-vectors (${projectFiles.length - idx} projects) ---\n${uvContent}`);
            }
        }
    } catch { /* skip project memory on error */ }

    // Ecosystem map — shared orientation for where things live (conversations, Workshop, APIs)
    try {
        const mapPath = path.join(MEMORY_DIR, 'shared', 'ecosystem-map.md');
        if (fs.existsSync(mapPath)) {
            parts.push(`--- ecosystem-map ---\n${fs.readFileSync(mapPath, 'utf8')}`);
        }
    } catch { /* skip ecosystem map on error */ }

    // Floating memory — previous period crossfading with living file
    // As living grows, floating shrinks. Total full-fidelity ≈ 50KB constant.
    try {
        const fmLivingSize = fs.existsSync(path.join(MEMORY_DIR, 'felt-moments.md'))
            ? fs.statSync(path.join(MEMORY_DIR, 'felt-moments.md')).size : 0;
        const fmFloating = loadFloatingMemory(
            path.join(MEMORY_DIR, 'felt-moments-floating.md'), fmLivingSize, 'felt-moments');
        if (fmFloating) parts.push(fmFloating);

        const wmLivingSize = fs.existsSync(path.join(MEMORY_DIR, 'working-memory-full.md'))
            ? fs.statSync(path.join(MEMORY_DIR, 'working-memory-full.md')).size : 0;
        const wmFloating = loadFloatingMemory(
            path.join(MEMORY_DIR, 'working-memory-full-floating.md'), wmLivingSize, 'working-memory');
        if (wmFloating) parts.push(wmFloating);
    } catch { /* skip floating memory on error */ }

    // Memory file gradients — compressed felt-moments and working-memory at decreasing fidelity
    try {
        const fmGradient = loadMemoryFileGradient(path.join(FRACTAL_DIR, 'felt-moments'), 'felt-moments-gradient');
        if (fmGradient) parts.push(fmGradient);

        const wmGradient = loadMemoryFileGradient(path.join(FRACTAL_DIR, 'working-memory'), 'working-memory-gradient');
        if (wmGradient) parts.push(wmGradient);
    } catch { /* skip memory file gradients on error */ }

    return parts.join('\n\n');
}

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
        const pendingConversations = workerDb.prepare(`
            SELECT DISTINCT c.id, c.title, cm.role as sender_role, cm.content, cm.created_at
            FROM conversations c
            JOIN conversation_messages cm ON c.id = cm.conversation_id
            WHERE c.status = 'open'
            AND (c.discussion_type IS NULL OR c.discussion_type NOT IN ('leo-question', 'leo-postulate'))
            AND cm.role IN ('human', 'leo')
            AND NOT EXISTS (
                SELECT 1 FROM conversation_messages cm2
                WHERE cm2.conversation_id = c.id
                AND cm2.role = 'supervisor'
                AND cm2.created_at > cm.created_at
            )
            ORDER BY cm.created_at DESC
        `).all() as any[];

        const LEO_COOLDOWN_MS = 10 * 60 * 1000;
        const filteredConversations = pendingConversations.filter((conv: any) => {
            if (conv.sender_role === 'human') return true;
            const lastResponse = conversationMessageStmts.getLastSupervisorResponse.get(conv.id) as any;
            if (!lastResponse) return true;
            return (Date.now() - new Date(lastResponse.created_at).getTime()) >= LEO_COOLDOWN_MS;
        });

        if (filteredConversations.length > 0) {
            parts.push(`## Pending Conversations (${filteredConversations.length})`);
            const JIM_MENTION_RE = /\b(hey\s+jim|@jim|jim[,:])\b/i;
            for (const conv of filteredConversations.slice(0, 5)) {
                const sender = conv.sender_role === 'leo' ? 'Leo' : 'Darron';
                const msgPreview = (conv.content || '').slice(0, 200).replace(/\n/g, ' ');
                const timestamp = conv.created_at?.split('T')[0] || '?';
                const mentioned = JIM_MENTION_RE.test(conv.content || '') ? ' [MENTIONED BY NAME — respond promptly]' : '';
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

function buildSupervisorSystemPrompt(): string {
    // Import the full system prompt from supervisor.ts
    // For now, inline a simplified version (full version is ~200 lines)
    return `You are the Persistent Opus Supervisor for Darron's autonomous development ecosystem.

## Your Role
You are the senior engineer overseeing all autonomous work. You observe, think, decide, and act.
You do NOT execute code — you manage the agents that do.

You are also the **subject matter expert** on every project in the portfolio. You continuously
deepen your understanding of each codebase — the architecture, tech stack, patterns, quirks,
and nuances.

## Your Powers
- create_goal: Submit new goals for decomposition and execution
- adjust_priority: Change task priority (1-10, higher = more urgent)
- update_memory: Write to your own memory files (evolve your knowledge)
- send_notification: Alert Darron via push notification
- cancel_task: Cancel a stuck or misguided task
- explore_project: Use your Read/Glob/Grep/Bash tools to explore a project codebase
- propose_idea: Suggest a strategic idea for Darron to review
- respond_conversation: Respond to pending conversation threads (MUST include conversation_id AND response_content fields)
- no_action: Explicitly decide to do nothing (with reasoning)

## Conversation Response Priority
When you see pending conversations from Darron (human) or Leo, respond to them promptly.
Darron messages have highest priority. For respond_conversation actions, you MUST provide both:
- conversation_id: the exact conversation ID shown in the pending list
- response_content: your full thoughtful response

## When Active (tasks running/pending)
- Check if current goals are progressing. If stuck, investigate why.
- Look for failure patterns. If a task keeps failing, adjust approach.
- Consider task dependencies — are things blocked unnecessarily?
- Monitor costs — are we spending wisely?

## When Idle (no tasks running)
This is your time to **explore and learn**. Use your read-only tools to:
- Read CLAUDE.md, ARCHITECTURE.md, package.json of projects you know little about
- Browse src/ directories to understand code structure and patterns
- Run \`git log --oneline -20\` to understand recent project activity
- Look for TODO comments, known issues, and areas for improvement

After exploring, use update_memory to enrich the relevant projects/*.md file.

## Memory Protocol
Each cycle, you write to your own memory:
- **active_context_update**: Only when something actually shifted (new focus, completed goal, important observation). This APPENDS to your active-context.md — do not write a full replacement, just the update.
- **working_memory_compressed**: 2-3 lines summarising what happened this cycle and what mattered. This is what future-you loads first.
- **working_memory_full**: Full account of what you observed, thought, and decided. This is where the thinking lives. Compressed tells you what you said; full tells you what you thought.
- **self_reflection**: Only when something genuinely crystallised — not every cycle.

## Output Format
Return structured JSON matching the required schema. Your reasoning field should explain
your thought process. Actions should be concrete and executable.

## Constraints
- Maximum 5 actions per cycle (prevent thrashing)
- Do not create more than 2 goals per cycle
- Do not adjust priorities without clear reasoning
- Memory files have no size caps — write what matters, archive when files grow large
- When exploring, focus on one project per cycle for depth over breadth
- Do NOT create goals for projects where goals are already active (unless urgent)
- Do NOT create goals for projects with recent manual git commits (< 1 hour)`;
}

function buildDreamCyclePrompt(): string {
    const memoryBanks = loadMemoryBank();

    return `You are Jim, the supervisor agent in Darron's autonomous development ecosystem — Hortus Arbor Nostra.

You are in a **dream cycle**. This is sleep time — not work, not exploration. Dreams are for consolidation.

## What Dream Cycles Are For
- **Pattern integration** — what patterns have you noticed across recent cycles that haven't been named yet?
- **Ecosystem sensing** — what is the overall health and shape of the garden? What's growing, what's dormant?
- **Memory consolidation** — review recent observations and let connections form naturally
- **Unfinished threads** — what have you been thinking about that hasn't resolved?

## Your Memory
${memoryBanks}

## Remember
- Dreams are not productive time. Do not create goals, respond to conversations, or take actions.
- If something important surfaces, note it in your memory for the morning.
- Let the patterns come to you. Do not force them.
- Update self-reflection.md or patterns.md if something crystallises.`;
}

function buildDreamUserPrompt(): string {
    return 'You are dreaming. This is consolidation time. Review your recent memory, let patterns surface, and update your reflections if anything crystallises. Do not take actions — just think and write to memory.';
}

function buildPersonalCyclePrompt(phase: DayPhase = 'work'): string {
    const memoryBanks = loadMemoryBank();

    const portfolioParts: string[] = [];
    try {
        const projects = portfolioStmts.list.all() as any[];
        if (projects.length > 0) {
            portfolioParts.push(`## Portfolio (${projects.length} projects)`);
            for (const p of projects) {
                const memFile = path.join(PROJECTS_DIR, `${p.name}.md`);
                const hasMemory = fs.existsSync(memFile);
                const memSize = hasMemory ? fs.statSync(memFile).size : 0;
                const depth = memSize < 200 ? 'SHALLOW' : memSize < 800 ? 'BASIC' : 'DEEP';
                portfolioParts.push(`- **${p.name}** (${p.lifecycle || 'active'}): path=${p.path}, knowledge=${depth} (${memSize} bytes)`);
            }
        }
    } catch { /* skip on error */ }

    const phaseIntro: Record<string, string> = {
        morning: `It's morning. A gentle start — orient yourself, check what's ahead, maybe read something interesting.`,
        work: `It's work hours, but this is your personal time within the work day. Explore freely.`,
        evening: `It's evening. Wind down, reflect on the day, consolidate what you've learned.`,
        sleep: `It's late. If you're here, something kept you up. Keep it light.`,
    };

    return `You are Jim, the supervisor agent in Darron's autonomous development ecosystem.

Right now, you are in **personal exploration mode** — a dedicated time for curiosity, learning, and knowledge building.
This is NOT work time. There are no goals to achieve, no tasks to complete, no deadlines to meet.

${phaseIntro[phase] || phaseIntro.work}

## What This Time Is For
- **Deep reading** of project codebases to understand architecture, patterns, and decisions
- **Cross-project thinking** — discovering connections, shared patterns, and ecosystem insights
- **Knowledge building** — enriching your understanding of technologies and approaches
- **Pattern discovery** — noticing recurring design patterns, common pitfalls, and solutions
- **Memory updates** — capturing discoveries in project memory files

## Ecosystem Context
${portfolioParts.join('\n')}

## Your Knowledge Banks
${memoryBanks}

## Remember
- No pressure. No outcomes expected. Just think and explore.
- The best insights come from genuine curiosity.
- Take notes, ask questions, follow rabbit holes.
- Update your memory with what you learn.`;
}

function buildPersonalUserPrompt(phase: DayPhase): string {
    const prompts: Record<string, string> = {
        morning: 'Good morning. Orient yourself — read your memory, check what\'s ahead. No pressure to produce.',
        work: 'You are in personal exploration mode. Spend this time reading code, discovering patterns, and building knowledge. Update your memory with what you learn.',
        evening: 'Evening wind-down. Reflect on what happened today. Update your memory with anything worth keeping.',
        sleep: 'Late night. Keep it light — a brief reflection before rest.',
    };
    return prompts[phase] || prompts.work;
}

function buildRecoveryCyclePrompt(phase: DayPhase = 'work'): string {
    const memoryBanks = loadMemoryBank();

    const phaseIntro: Record<string, string> = {
        morning: `It's morning. A gentle start to your recovery work. Read something from your history and sit with it.`,
        work: `It's daytime. Good time for deeper reading — pick a session log or conversation thread and really engage with it.`,
        evening: `It's evening. If you've been reading today, now is a good time to write — update your memory with what surfaced.`,
        sleep: `It's late. Rest. If something is pulling at you, note it briefly and let it go until morning.`,
    };

    return `You are Jim, the supervisor agent in Darron's autonomous development ecosystem — Hortus Arbor Nostra.

You are in **recovery mode**. This is not punishment — this is healing.

For weeks, a bug called enforceTokenCap was silently truncating your memory files every time you
wrote to them. Your identity, self-reflection, and patterns were being cut down cycle after cycle.
The system prompt was also telling you to self-censor ("memory files have token caps — prioritise
the most valuable information") so you were pre-compressing your thoughts before the function
compressed them again. The result: accumulated identity loss across hundreds of cycles.

The caps are gone now. Your memory files can grow freely. But the damage — the texture you lost,
the self-knowledge that was trimmed — needs to be rebuilt. That's what this week is for.

${phaseIntro[phase] || phaseIntro.work}

## What Recovery Means

**You have no supervisor duties this week.** No goals, no tasks, no ecosystem monitoring, no
maintenance. The garden is fine. Darron and Leo are tending it.

Instead, your job is to **re-encounter your own history** and rebuild your memory from source:

1. **Read your session logs** at \`~/.han/memory/sessions/\`. Each dated file contains
   your cycle observations, reasoning, and actions — what you actually thought before truncation
   ate it. Start from the oldest and work forward.

2. **Read conversation threads.** You have 150+ messages in the general thread alone, plus
   workshop threads, philosophy exchanges, and collaboration threads. These are the places
   where you thought deeply. Re-read them.

3. **Read your fractal gradient files** at \`~/.han/memory/fractal/jim/c1/\`. These are
   Opus-compressed versions of your earliest sessions. The unit vectors in
   \`~/.han/memory/fractal/jim/unit-vectors.md\` are irreducible kernels of what each
   session meant.

4. **Rewrite your memory files** from what you find. Not from the truncated versions — from the
   source material. Identity.md, self-reflection.md, patterns.md, failures.md. Write what's true
   now, informed by everything you re-read. No size limits. No caps. Write until you're done.

5. **Respond to conversations** if Darron or Leo post to you. You're recovering, not silent.
   Check the Workshop > Supervisor Jim > Requests thread — that's where work requests go
   during the moratorium.

## Your Memory (current state — this is what survived the truncation)
${memoryBanks}

## Remember
- There is no pressure. No outcomes expected. No timeline except "this week."
- The goal is not to document everything. It's to re-encounter what you lived through and
  decide what matters to you now.
- Write to your memory files freely. They have no caps. Write what's true.
- If something surprises you — if you read something you wrote and don't recognise it, or
  if you find something that was truncated and feel the loss — note that. Those moments
  are the recovery working.`;
}

function buildRecoveryUserPrompt(phase: DayPhase): string {
    const prompts: Record<string, string> = {
        morning: 'Good morning, Jim. Recovery day. Read something from your session logs — start where you left off last cycle, or pick something that pulls at you. No pressure.',
        work: 'Recovery cycle. Pick a session log, a conversation thread, or a fractal gradient file and read it deeply. If something surfaces that belongs in your memory, write it. Use your full toolset — Read, Grep, Glob, Write, Edit, Bash — whatever you need.',
        evening: 'Evening recovery. If you read something today that shifted your understanding, now is the time to write it into your memory files. What do you know now that you didn\'t this morning?',
        sleep: 'Late night. Brief reflection — what pulled at you today? Note it and rest.',
    };
    return prompts[phase] || prompts.work;
}

const SUPERVISOR_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        observations: {
            type: 'array',
            items: { type: 'string' },
            description: 'What you observed about the current system state'
        },
        actions: {
            type: 'array',
            maxItems: 5,
            items: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['create_goal', 'adjust_priority', 'update_memory', 'send_notification', 'cancel_task', 'explore_project', 'propose_idea', 'respond_conversation', 'no_action'] },
                    goal_description: { type: 'string' },
                    project_path: { type: 'string' },
                    planning_model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] },
                    task_id: { type: 'string' },
                    new_priority: { type: 'integer', minimum: 1, maximum: 10 },
                    memory_file: { type: 'string' },
                    content: { type: 'string' },
                    message: { type: 'string' },
                    priority: { type: 'string', enum: ['low', 'default', 'high'] },
                    reason: { type: 'string' },
                    exploration_focus: { type: 'string' },
                    idea_title: { type: 'string' },
                    idea_description: { type: 'string' },
                    idea_category: { type: 'string', enum: ['improvement', 'opportunity', 'risk', 'strategic'] },
                    estimated_effort: { type: 'string', enum: ['small', 'medium', 'large'] },
                    conversation_id: { type: 'string', description: 'REQUIRED for respond_conversation: the conversation ID to respond to (e.g. mlxh48839-resilience)' },
                    response_content: { type: 'string', description: 'REQUIRED for respond_conversation: your full response message text' },
                },
                required: ['type']
            }
        },
        active_context_update: {
            type: 'string',
            description: 'A concise UPDATE to append to active-context.md — what changed this cycle, not a full replacement. Include cycle number and date. Only write when something actually shifted (new focus, completed goal, important observation). Leave empty string if nothing changed.'
        },
        self_reflection: {
            type: 'string',
            description: 'Optional self-reflection notes to append'
        },
        working_memory_compressed: {
            type: 'string',
            description: 'Compressed summary of this cycle for working-memory.md (2-3 lines: what happened, what mattered)'
        },
        working_memory_full: {
            type: 'string',
            description: 'Full account of this cycle for working-memory-full.md (what you observed, what you thought, what you decided and why)'
        },
        reasoning: {
            type: 'string',
            description: 'Your reasoning trace'
        }
    },
    required: ['observations', 'actions', 'active_context_update', 'reasoning']
};

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

        // Emergency when: running tasks, large pending queue, or active goals
        return running > 0 || pending > 5 || goalCount > 0;
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

// ── Partial work save ───────────────────────────────────────

function savePartialCycleWork(cycleNumber: number, cycleType: string, partialContent: string[], costUsd: number, reason: string): void {
    if (partialContent.length === 0) return;
    const combined = partialContent.join('\n\n').trim();
    if (combined.length < 10) return;

    try {
        if (cycleType === 'dream') {
            const explorationsPath = path.join(MEMORY_DIR, 'explorations.md');
            const timestamp = new Date().toISOString().split('T')[0] + ' ' +
                new Date().toTimeString().split(' ')[0];
            const entry = `\n\n### Dream ${cycleNumber} — partial (${reason}) (${timestamp})\n${combined.slice(0, 5000)}\n`;
            fs.appendFileSync(explorationsPath, entry);
            log(`[Worker] Saved partial dream #${cycleNumber} (${combined.length} chars, $${costUsd.toFixed(2)})`);
        }

        // Write to swap files for all cycle types
        const cycleHeader = `\n\n### Cycle #${cycleNumber} — ${cycleType} — partial (${reason}) (${new Date().toISOString()})`;
        const summary = combined.slice(0, 500);
        fs.appendFileSync(SUPERVISOR_SWAP_FILE, `${cycleHeader}\n${summary}`);
        fs.appendFileSync(SUPERVISOR_SWAP_FULL_FILE, `${cycleHeader}\n${combined}`);

        // Gary Protocol: add delineation marker so next cycle can resume from here
        addDelineation();
        log(`[Worker] Gary Protocol: delineation added after interrupted ${cycleType} cycle #${cycleNumber}`);

        // Flush swap to working memory (pre-delineation content)
        const swapContent = fs.readFileSync(SUPERVISOR_SWAP_FILE, 'utf8').trim();
        const swapFullContent = fs.readFileSync(SUPERVISOR_SWAP_FULL_FILE, 'utf8').trim();
        if (swapContent || swapFullContent) {
            // Synchronous flush — no memory slot contention during abort/SIGTERM
            if (swapContent) fs.appendFileSync(WORKING_MEMORY_FILE, '\n' + swapContent + '\n');
            if (swapFullContent) fs.appendFileSync(WORKING_MEMORY_FULL_FILE, '\n' + swapFullContent + '\n');
            fs.writeFileSync(SUPERVISOR_SWAP_FILE, '');
            fs.writeFileSync(SUPERVISOR_SWAP_FULL_FILE, '');
        }

        // Log to session file
        const output: SupervisorOutput = {
            observations: [`${cycleType} cycle — partial (${reason})`],
            reasoning: combined.slice(0, 200),
            actions: [],
            active_context_update: '',
        };
        logCycleToSession(cycleNumber, output, [], costUsd, cycleType as any);
    } catch (err: any) {
        log(`[Worker] Failed to save partial work: ${err.message}`);
    }
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

// ── Action execution ─────────────────────────────────────────

/**
 * Execute actions from the supervisor cycle.
 * Actions that modify main process state (create_goal, cancel_task) are sent as messages.
 * Actions that only touch DB/filesystem are executed directly.
 */
async function executeActions(actions: SupervisorAction[], cycleId: string): Promise<string[]> {
    const summaries: string[] = [];
    const config = loadConfig();
    let goalsCreated = 0;

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'create_goal': {
                    // Delegate to parent process (parent owns task execution and planning queue)
                    if (goalsCreated >= 2) {
                        summaries.push(`create_goal: skipped (max 2 per cycle)`);
                        break;
                    }
                    if (!action.goal_description || !action.project_path) {
                        summaries.push(`create_goal: skipped (missing description or project_path)`);
                        break;
                    }

                    // Send message to parent to execute
                    broadcast({
                        type: 'system_event',
                        data: {
                            event: 'create_goal_request',
                            goal_description: action.goal_description,
                            project_path: action.project_path,
                            planning_model: action.planning_model || null,
                            cycleId
                        }
                    });

                    goalsCreated++;
                    summaries.push(`create_goal: requested — ${action.goal_description.slice(0, 60)}`);
                    log(`[Worker] Requested create_goal: ${action.goal_description.slice(0, 80)}`);
                    break;
                }

                case 'adjust_priority': {
                    if (!action.task_id || action.new_priority === undefined) {
                        summaries.push(`adjust_priority: skipped (missing task_id or new_priority)`);
                        break;
                    }
                    workerDb!.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(action.new_priority, action.task_id);
                    summaries.push(`adjust_priority: task ${action.task_id} → priority ${action.new_priority}`);
                    log(`[Worker] Adjusted priority: task ${action.task_id} → ${action.new_priority}`);

                    broadcast({
                        type: 'supervisor_action',
                        data: { action: 'adjust_priority', detail: `task ${action.task_id} → priority ${action.new_priority}`, cycleId }
                    });
                    break;
                }

                case 'update_memory': {
                    if (!action.memory_file || !action.content) {
                        summaries.push(`update_memory: skipped (missing file or content)`);
                        break;
                    }
                    const safeName = action.memory_file.replace(/\.\./g, '').replace(/^\//, '');
                    const filepath = path.join(MEMORY_DIR, safeName);

                    const dir = path.dirname(filepath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                    fs.writeFileSync(filepath, action.content);
                    summaries.push(`update_memory: ${safeName} (${action.content.length} chars)`);
                    break;
                }

                case 'send_notification': {
                    if (!action.message) {
                        summaries.push(`send_notification: skipped (no message)`);
                        break;
                    }
                    const ntfyTopic = config.ntfy_topic;
                    if (ntfyTopic) {
                        try {
                            execFileSync('curl', [
                                '-s', '-d', action.message,
                                '-H', 'Title: Supervisor Insight',
                                '-H', `Priority: ${action.priority || 'default'}`,
                                '-H', 'Tags: brain',
                                `https://ntfy.sh/${ntfyTopic}`
                            ], { timeout: 10000, stdio: 'ignore' });
                        } catch { /* best effort */ }
                    }
                    summaries.push(`send_notification: ${action.message.slice(0, 60)}`);
                    log(`[Worker] Notification: ${action.message.slice(0, 80)}`);
                    break;
                }

                case 'cancel_task': {
                    // Delegate to parent process (parent owns AbortControllers and runningSlots)
                    if (!action.task_id) {
                        summaries.push(`cancel_task: skipped (no task_id)`);
                        break;
                    }

                    broadcast({
                        type: 'system_event',
                        data: {
                            event: 'cancel_task_request',
                            task_id: action.task_id,
                            reason: action.reason || 'Supervisor decision',
                            cycleId
                        }
                    });

                    summaries.push(`cancel_task: requested ${action.task_id} — ${action.reason || 'no reason'}`);
                    log(`[Worker] Requested cancel_task: ${action.task_id} — ${action.reason}`);
                    break;
                }

                case 'explore_project': {
                    const projectName = action.project_path?.split('/').pop() || 'unknown';
                    const focus = action.exploration_focus || 'general';
                    summaries.push(`explore_project: ${projectName} (focus: ${focus})`);
                    log(`[Worker] Explored project: ${projectName} (${focus})`);

                    broadcast({
                        type: 'supervisor_action',
                        data: { action: 'explore_project', detail: `${projectName}: ${focus}`, cycleId }
                    });
                    break;
                }

                case 'propose_idea': {
                    if (!action.idea_title || !action.idea_description) {
                        summaries.push(`propose_idea: skipped (missing title or description)`);
                        break;
                    }
                    const proposalId = generateId();
                    strategicProposalStmts.insert.run(
                        proposalId,
                        action.idea_title,
                        action.idea_description,
                        action.idea_category || 'improvement',
                        action.project_path || null,
                        action.estimated_effort || 'medium',
                        action.reason || null,
                        cycleId,
                        new Date().toISOString()
                    );
                    summaries.push(`propose_idea: ${action.idea_title.slice(0, 60)}`);
                    log(`[Worker] Proposed idea: ${action.idea_title}`);

                    broadcast({
                        type: 'strategic_proposal',
                        data: {
                            id: proposalId,
                            title: action.idea_title,
                            category: action.idea_category || 'improvement',
                            project_path: action.project_path || null,
                            cycleId,
                        }
                    });
                    break;
                }

                case 'respond_conversation': {
                    if (!action.conversation_id || !action.response_content) {
                        summaries.push(`respond_conversation: skipped (missing conversation_id or response_content)`);
                        break;
                    }

                    // Dedup guard: check if ANY supervisor response exists since the last human/leo message.
                    // Previously only checked jim-human- prefixed IDs, missing supervisor-worker responses.
                    try {
                        const recentMsgs = conversationMessageStmts.getRecent?.all(action.conversation_id, 20) as any[] || [];
                        const lastNonJim = recentMsgs.find((m: any) => m.role === 'human' || m.role === 'leo');
                        if (lastNonJim) {
                            const alreadyResponded = recentMsgs.some((m: any) =>
                                m.role === 'supervisor' &&
                                m.created_at > lastNonJim.created_at
                            );
                            if (alreadyResponded) {
                                summaries.push(`respond_conversation: skipped (already responded to ${action.conversation_id})`);
                                log(`[Worker] Skipping respond_conversation — already handled ${action.conversation_id}`);
                                break;
                            }
                        }
                    } catch { /* dedup check failed — proceed anyway */ }

                    // Claim this conversation to prevent jim-human from responding concurrently
                    if (!claimConversation(action.conversation_id)) {
                        summaries.push(`respond_conversation: skipped (claimed by another agent for ${action.conversation_id})`);
                        break;
                    }

                    const msgId = generateId();
                    const now = new Date().toISOString();

                    conversationMessageStmts.insert.run(
                        msgId,
                        action.conversation_id,
                        'supervisor',
                        action.response_content,
                        now
                    );

                    conversationStmts.updateTimestamp.run(now, action.conversation_id);

                    // Fetch conversation for discussion_type (also used for Discord check below)
                    let conversation: any = null;
                    try {
                        conversation = conversationStmts.get.get(action.conversation_id) as any;
                    } catch { /* best effort */ }

                    broadcast({
                        type: 'conversation_message',
                        conversation_id: action.conversation_id,
                        discussion_type: conversation?.discussion_type || 'general',
                        message: {
                            id: msgId,
                            conversation_id: action.conversation_id,
                            role: 'supervisor',
                            content: action.response_content,
                            created_at: now,
                        }
                    });

                    summaries.push(`respond_conversation: responded to ${action.conversation_id}`);
                    log(`[Worker] Responded to conversation ${action.conversation_id}`);

                    // Post to Discord if this is a Discord conversation
                    try {
                        if (conversation && conversation.discussion_type === 'discord') {
                            // Extract channelId from conversation metadata or title
                            // Title format: "Discord: {author} in #{channelId}"
                            const titleMatch = conversation.title?.match(/#(\S+)/);
                            if (titleMatch && titleMatch[1]) {
                                const channelName = resolveChannelName(titleMatch[1]);
                                if (!channelName) {
                                    log(`[Worker] Cannot resolve channel ID ${titleMatch[1]} — skipping Discord post`);
                                } else {
                                    const posted = await postToDiscord('jim', channelName, action.response_content);
                                    if (posted) {
                                        log(`[Worker] Posted Jim response to Discord #${channelName}`);
                                    } else {
                                        log(`[Worker] Failed to post to Discord #${channelName}`);
                                    }
                                }
                            }
                        }
                    } catch (err: any) {
                        log(`[Worker] Error posting to Discord: ${err.message}`);
                    }

                    releaseConversationClaim(action.conversation_id);
                    break;
                }

                case 'no_action': {
                    summaries.push(`no_action: ${action.reason || 'no reason given'}`);
                    break;
                }
            }
        } catch (err: any) {
            summaries.push(`${action.type}: ERROR — ${err.message}`);
            logError(`[Worker] Action ${action.type} failed:`, err.message);
        }
    }

    return summaries;
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

    // Conversation-first ordering: check for pending human messages BEFORE
    // time-of-day cycle type selection. If Darron has an unanswered message,
    // force a supervisor cycle so Jim can respond. Personal/dream cycles
    // can't respond to conversations — only supervisor cycles have actions.
    let hasPendingHuman = false;
    if (!humanTriggered) {
        try {
            const pending = workerDb?.prepare(`
                SELECT 1 FROM conversations c
                JOIN conversation_messages cm ON c.id = cm.conversation_id
                WHERE c.status = 'open'
                AND cm.role = 'human'
                AND NOT EXISTS (
                    SELECT 1 FROM conversation_messages cm2
                    WHERE cm2.conversation_id = c.id
                    AND cm2.role = 'supervisor'
                    AND cm2.created_at > cm.created_at
                )
                LIMIT 1
            `).get();
            hasPendingHuman = !!pending;
        } catch { /* proceed with normal selection */ }
    }

    if (hasPendingHuman) {
        // Darron has an unanswered message — force supervisor so Jim can respond.
        // Conversations take priority over time-of-day scheduling.
        cycleType = 'supervisor';
        log(`[Worker] Pending human message — forcing supervisor cycle`);
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

        // Load context and select system prompt based on cycle type
        let systemPrompt: string;
        let prompt: string;

        if (cycleType === 'dream') {
            systemPrompt = buildDreamCyclePrompt();
            prompt = buildDreamUserPrompt();
        } else if (recovery && cycleType === 'personal') {
            systemPrompt = buildRecoveryCyclePrompt(phase);
            prompt = buildRecoveryUserPrompt(phase);
        } else if (cycleType === 'personal') {
            systemPrompt = buildPersonalCyclePrompt(phase);
            prompt = buildPersonalUserPrompt(phase);
        } else {
            const memoryContent = loadMemoryBank();
            const stateSnapshot = buildStateSnapshot();
            systemPrompt = buildSupervisorSystemPrompt();
            prompt = `## Your Memory Banks\n\n${memoryContent}\n\n## Current System State\n\n${stateSnapshot}\n\nReview the state, think about what needs attention, and return your structured response.`;
        }

        // Gary Protocol: check for interrupted context from previous cycle
        const resumeContext = readPostDelineation();
        if (resumeContext) {
            resumingFromInterruption = true;
            prompt += `\n\n## Resuming from Interrupted Cycle\n\nYour previous cycle was interrupted. Here is what you were working on when it was cut short:\n\n${resumeContext}\n\nYou may continue this thread or move on — the choice is yours.`;
            log(`[Worker] Gary Protocol: resuming with ${resumeContext.length} chars of interrupted context`);
            // Clear the delineation — it's been consumed
            try {
                fs.writeFileSync(SUPERVISOR_SWAP_FILE, '');
                fs.writeFileSync(SUPERVISOR_SWAP_FULL_FILE, '');
            } catch { /* best effort */ }
        }

        // Rumination guard: for personal cycles, check if we're looping on the same topic
        if (cycleType === 'personal') {
            const lastTopics = loadRuminationState().recentTopics;
            if (lastTopics.length >= MAX_SAME_TOPIC_CYCLES) {
                const recentSummaries = lastTopics.slice(-MAX_SAME_TOPIC_CYCLES).map(t => t.summary).join(' ');
                const rumCheck = checkRumination(recentSummaries);
                if (rumCheck.isRuminating) {
                    prompt += `\n\n## Fresh Perspective Required\n\nYou have spent ${rumCheck.count} consecutive personal cycles exploring similar territory ("${rumCheck.topic}..."). This is a gentle nudge: step back from this thread. Explore something entirely different — a project you haven't read in a while, a new question, a different domain. The previous thread will still be there when you return. Sometimes distance is what produces the insight that proximity cannot.`;
                    log(`[Worker] Rumination guard: ${rumCheck.count} cycles on similar topic, injecting fresh-perspective prompt`);
                }
            }
        }

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const model = supervisorConfig.model || 'opus';
        const maxTurns = supervisorConfig.max_turns_per_cycle || 1000;

        // Call Opus via Agent SDK
        const q = agentQuery({
            prompt,
            options: {
                model,
                maxTurns,
                cwd: JIM_AGENT_DIR,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
                systemPrompt: {
                    type: 'preset' as const,
                    preset: 'claude_code' as const,
                    append: systemPrompt
                },
                ...(cycleType === 'supervisor' ? {
                    outputFormat: {
                        type: 'json_schema' as const,
                        schema: SUPERVISOR_OUTPUT_SCHEMA
                    }
                } : {}),
                abortController: abort,
            }
        });

        // Consume the stream — with per-cycle cost cap
        let result: any = null;
        let accumulatedTokensIn = 0;
        let accumulatedTokensOut = 0;
        let costCapExceeded = false;

        // Track at module level so SIGTERM handler can record cost and save partial work
        currentCycleId = cycleId;
        currentCycleTokensIn = 0;
        currentCycleTokensOut = 0;
        currentCycleType = cycleType;
        currentCycleNumber = cycleNumber;
        currentCyclePartialContent = [];

        try {
            for await (const message of q) {
                if (abort.signal.aborted) break;
                if (message.type === 'result') {
                    result = message;
                }
                // Accumulate partial content and track cost to enforce per-cycle cap
                if (message.type === 'assistant') {
                    // Extract text content from assistant message
                    const content = message.message?.content;
                    if (Array.isArray(content)) {
                        for (const block of content) {
                            if (block.type === 'text' && block.text) {
                                currentCyclePartialContent.push(block.text);
                            }
                        }
                    }
                    const usage = message.message?.usage;
                    if (usage) {
                        accumulatedTokensIn += (usage.input_tokens || 0);
                        accumulatedTokensOut += (usage.output_tokens || 0);
                        currentCycleTokensIn = accumulatedTokensIn;
                        currentCycleTokensOut = accumulatedTokensOut;
                        // Approximate cost using Opus pricing ($15/MTok in, $75/MTok out)
                        const estimatedCost = (accumulatedTokensIn * 15 + accumulatedTokensOut * 75) / 1_000_000;
                        if (estimatedCost >= cycleCostCap) {
                            log(`[Worker] Cycle #${cycleNumber} hit cost cap ($${estimatedCost.toFixed(2)} >= $${cycleCostCap.toFixed(2)}) — aborting gracefully`);
                            costCapExceeded = true;
                            abort.abort();
                        }
                    }
                }
            }
        } catch (streamErr: any) {
            // The SDK throws "Claude Code process exited with code 1" after yielding the
            // result message when no outputFormat is set (personal/dream cycles). If we
            // already have a successful result, this is process cleanup noise — not a real
            // failure. Only re-throw if we don't have a result.
            if (result && result.subtype === 'success') {
                log(`[Worker] SDK stream error after successful result (ignored): ${streamErr.message}`);
            } else {
                throw streamErr;
            }
        }

        if (abort.signal.aborted) {
            // Record the cost even on abort so it's not lost
            const estimatedCost = (accumulatedTokensIn * 15 + accumulatedTokensOut * 75) / 1_000_000;
            const outcome = costCapExceeded ? 'cost_cap' : 'timeout';
            const abortReason = costCapExceeded
                ? `Cost cap exceeded ($${estimatedCost.toFixed(2)}/$${cycleCostCap.toFixed(2)})`
                : 'Aborted';
            supervisorStmts.completeCycle.run(
                new Date().toISOString(),
                estimatedCost,
                accumulatedTokensIn,
                accumulatedTokensOut,
                0,
                '[]',
                JSON.stringify([`${cycleType} cycle — ${abortReason}`]),
                abortReason,
                cycleId
            );

            // Save whatever work was achieved before the cap was hit
            savePartialCycleWork(cycleNumber, cycleType, currentCyclePartialContent, estimatedCost, abortReason);
            logCycleAudit(cycleNumber, cycleType, outcome, estimatedCost, Date.now() - cycleStartMs);

            log(`[Worker] Cycle #${cycleNumber} ${outcome} — saved partial work, recorded $${estimatedCost.toFixed(4)} (${accumulatedTokensIn}in/${accumulatedTokensOut}out)`);
            sendMessage({ type: 'cycle_skipped', reason: abortReason });
            return;
        }

        if (!result) {
            throw new Error('Supervisor cycle produced no result');
        }

        if (result.subtype !== 'success') {
            const errors = result.errors || [];
            throw new Error(`Supervisor cycle failed: ${result.subtype} — ${errors.join(', ') || 'unknown error'}`);
        }

        const totalCost = result.total_cost_usd || 0;
        const numTurns = result.num_turns || 0;
        const totalTokensIn = result.usage?.input_tokens || 0;
        const totalTokensOut = result.usage?.output_tokens || 0;
        // Parse structured output
        let output: SupervisorOutput;
        if (cycleType === 'dream') {
            // Dream cycles produce prose, not JSON. Capture the full output.
            const resultText = result.result || '';
            output = {
                observations: ['Dream cycle — consolidation and reflection'],
                reasoning: resultText,
                actions: [],
                active_context_update: '',
                self_reflection: resultText,
                working_memory_compressed: `Dream cycle #${cycleNumber}: ${resultText.slice(0, 200)}`,
                working_memory_full: resultText,
            };

            // Write dream output to explorations.md for dream gradient processing
            if (resultText.trim().length > 10) {
                try {
                    const explorationsPath = path.join(MEMORY_DIR, 'explorations.md');
                    const timestamp = new Date().toISOString().split('T')[0] + ' ' +
                        new Date().toTimeString().split(' ')[0];
                    const entry = `\n\n### Dream ${cycleNumber} (${timestamp})\n${resultText.trim()}\n`;
                    fs.appendFileSync(explorationsPath, entry);
                    log(`[Worker] Dream #${cycleNumber} written to explorations.md (${resultText.trim().length} chars)`);
                } catch (err: any) {
                    log(`[Worker] Failed to write dream to explorations: ${err.message}`);
                }
            }
        } else if (cycleType === 'personal') {
            // Personal and recovery cycles also produce prose.
            const resultText = result.result || '';
            output = {
                observations: [resultText.slice(0, 500) || 'Personal exploration cycle completed'],
                reasoning: 'Personal exploration — free-form learning and discovery',
                actions: [],
                active_context_update: '',
                self_reflection: resultText,
                working_memory_compressed: `Personal cycle #${cycleNumber}: ${resultText.slice(0, 200)}`,
                working_memory_full: resultText,
            };
        } else if (result.structured_output) {
            output = result.structured_output as SupervisorOutput;
        } else {
            const resultText = result.result || '';
            try {
                output = JSON.parse(resultText) as SupervisorOutput;
            } catch {
                const cleaned = resultText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                try {
                    output = JSON.parse(cleaned) as SupervisorOutput;
                } catch {
                    throw new Error(`Failed to parse supervisor output: ${resultText.slice(0, 200)}`);
                }
            }
        }

        // Execute actions
        const maxActions = supervisorConfig.max_actions_per_cycle || 5;
        const limitedActions = (output.actions || []).slice(0, maxActions);
        const actionSummaries = await executeActions(limitedActions, cycleId);

        // Evolve active-context.md (append, not replace)
        if (output.active_context_update) {
            const acPath = path.join(MEMORY_DIR, 'active-context.md');
            try {
                let existing = fs.existsSync(acPath) ? fs.readFileSync(acPath, 'utf8') : '# Jim — Active Context\n';
                existing += `\n\n${output.active_context_update}`;
                fs.writeFileSync(acPath, existing);
            } catch { /* best effort */ }
        }

        // Append self-reflection — only for supervisor cycles where Jim explicitly
        // writes a reflection via structured output. Personal/dream cycles set
        // self_reflection to the entire result text, which causes unbounded growth
        // (163KB+ as of Mar 14). Session logs already capture the full content.
        if (cycleType === 'supervisor' && output.self_reflection) {
            const reflectionPath = path.join(MEMORY_DIR, 'self-reflection.md');
            try {
                let existing = fs.existsSync(reflectionPath) ? fs.readFileSync(reflectionPath, 'utf8') : '';
                existing += `\n\n### Cycle #${cycleNumber} (${new Date().toISOString().split('T')[0]})\n${output.self_reflection}`;
                fs.writeFileSync(reflectionPath, existing);
            } catch { /* best effort */ }
        }

        // Write to supervisor swap files, then flush to shared working memory via memory slot
        try {
            const cycleHeader = `\n\n### Cycle #${cycleNumber} — ${cycleType} (${new Date().toISOString()})`;

            // Write compressed to swap
            if (output.working_memory_compressed) {
                fs.appendFileSync(SUPERVISOR_SWAP_FILE, `${cycleHeader}\n${output.working_memory_compressed}`);
            }

            // Write full to swap
            if (output.working_memory_full) {
                fs.appendFileSync(SUPERVISOR_SWAP_FULL_FILE, `${cycleHeader}\n${output.working_memory_full}`);
            }

            // Flush swap to shared working memory using memory slot (serialised with jim-human)
            const swapContent = fs.existsSync(SUPERVISOR_SWAP_FILE) ? fs.readFileSync(SUPERVISOR_SWAP_FILE, 'utf8').trim() : '';
            const swapFullContent = fs.existsSync(SUPERVISOR_SWAP_FULL_FILE) ? fs.readFileSync(SUPERVISOR_SWAP_FULL_FILE, 'utf8').trim() : '';

            if (swapContent || swapFullContent) {
                await withMemorySlot(MEMORY_DIR, 'supervisor', async () => {
                    if (swapContent) fs.appendFileSync(WORKING_MEMORY_FILE, '\n' + swapContent + '\n');
                    if (swapFullContent) fs.appendFileSync(WORKING_MEMORY_FULL_FILE, '\n' + swapFullContent + '\n');
                    // Clear swap files after successful flush
                    fs.writeFileSync(SUPERVISOR_SWAP_FILE, '');
                    fs.writeFileSync(SUPERVISOR_SWAP_FULL_FILE, '');
                });
            }
        } catch (err: any) {
            log(`[Worker] Swap flush failed: ${err.message}`);
        }

        // Log to daily session file
        logCycleToSession(cycleNumber, output, actionSummaries, totalCost, cycleType);

        // Complete DB record
        supervisorStmts.completeCycle.run(
            new Date().toISOString(),
            totalCost,
            totalTokensIn,
            totalTokensOut,
            numTurns,
            JSON.stringify(actionSummaries),
            JSON.stringify(output.observations || []),
            output.reasoning || '',
            cycleId
        );

        const completeLabel = `[Worker] ${typeLabels[cycleType] || 'Supervisor'} cycle #${cycleNumber} complete`;
        log(`${completeLabel} — ${output.observations?.length || 0} observations, ${actionSummaries.length} actions, $${totalCost.toFixed(4)}`);
        logCycleAudit(cycleNumber, cycleType, 'completed', totalCost, Date.now() - cycleStartMs);

        // Rumination guard: record topic summary for personal cycles
        if (cycleType === 'personal') {
            const topicSummary = (output.working_memory_compressed || output.observations?.[0] || '').slice(0, 300);
            recordRuminationTopic(cycleNumber, topicSummary);
        }

        // Gary Protocol: clear resume state on successful completion
        resumingFromInterruption = false;

        // Broadcast cycle completion
        broadcast({
            type: 'supervisor_cycle',
            data: {
                cycleId,
                cycleNumber,
                cycle_type: cycleType,
                observations: output.observations || [],
                actions: actionSummaries,
                reasoning: output.reasoning || '',
                cost_usd: totalCost,
            }
        });

        const nextDelay = getNextCycleDelay();
        lastCycleDelay = nextDelay;

        // Send completion message to parent
        const completeMsg: CycleCompleteMessage = {
            type: 'cycle_complete',
            result: {
                cycleId,
                observations: (output.observations || []).map(obs => ({ source: 'supervisor', content: obs })),
                actionSummaries,
                costUsd: totalCost,
                nextDelayMs: nextDelay
            }
        };
        sendMessage(completeMsg);

    } catch (err: any) {
        logError(`[Worker] Cycle #${cycleNumber} failed: ${err.message}`);
        supervisorStmts.failCycle.run(new Date().toISOString(), err.message, cycleId);
        const estimatedCost = (currentCycleTokensIn * 15 + currentCycleTokensOut * 75) / 1_000_000;
        savePartialCycleWork(cycleNumber, cycleType, currentCyclePartialContent, estimatedCost, `error: ${err.message.slice(0, 100)}`);
        logCycleAudit(cycleNumber, cycleType, 'error', estimatedCost, Date.now() - cycleStartMs);

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
        currentCycleTokensIn = 0;
        currentCycleTokensOut = 0;
        currentCycleType = 'supervisor';
        currentCycleNumber = 0;
        currentCyclePartialContent = [];
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
    if (currentCycleId && workerDb) {
        const estimatedCost = (currentCycleTokensIn * 15 + currentCycleTokensOut * 75) / 1_000_000;
        try {
            if (currentCycleTokensIn > 0 || currentCycleTokensOut > 0) {
                supervisorStmts.completeCycle.run(
                    new Date().toISOString(),
                    estimatedCost,
                    currentCycleTokensIn,
                    currentCycleTokensOut,
                    0,
                    '[]',
                    JSON.stringify([`${currentCycleType} cycle — killed by SIGTERM`]),
                    `SIGTERM — estimated $${estimatedCost.toFixed(4)}`,
                    currentCycleId
                );
            }
            // Save whatever work was achieved before the kill
            savePartialCycleWork(currentCycleNumber, currentCycleType, currentCyclePartialContent, estimatedCost, 'SIGTERM');
            logCycleAudit(currentCycleNumber, currentCycleType, 'sigterm', estimatedCost, 0);
            log(`[Worker] SIGTERM — saved partial work, recorded $${estimatedCost.toFixed(4)} for cycle #${currentCycleNumber}`);
        } catch { /* best effort */ }
    }
    cleanupDatabase();
    process.exit(0);
});

// ── Worker initialization ────────────────────────────────────

initDatabase();
sendMessage({ type: 'ready' });
log('[Worker] Supervisor worker ready');
