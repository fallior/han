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
    reasoning: string;
}

// ── Constants ────────────────────────────────────────────────

const CLAUDE_REMOTE_DIR = process.env.CLAUDE_REMOTE_DIR || path.join(process.env.HOME!, '.claude-remote');
const MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory');
const PROJECTS_DIR = path.join(MEMORY_DIR, 'projects');
const SESSIONS_DIR = path.join(MEMORY_DIR, 'sessions');
const TASKS_DB_PATH = path.join(CLAUDE_REMOTE_DIR, 'tasks.db');
const JIM_AGENT_DIR = path.join(CLAUDE_REMOTE_DIR, 'agents', 'Jim');

// Token caps for memory files
const MEMORY_TOKEN_CAPS: Record<string, number> = {
    'identity.md': 800,
    'active-context.md': 1200,
    'patterns.md': 3000,
    'failures.md': 2000,
    'self-reflection.md': 1500,
};
const PROJECT_MEMORY_CAP = 1500;

// Frequency thresholds
const FREQ_VERY_ACTIVE = 2 * 60 * 1000;
const FREQ_ACTIVE = 5 * 60 * 1000;
const FREQ_MODERATE = 15 * 60 * 1000;
const FREQ_IDLE = 10 * 60 * 1000;

// ── Worker state ─────────────────────────────────────────────

let workerDb: Database.Database | null = null;
let runningCycleAbort: AbortController | null = null;
let personalCycleCounter = 0;
let lastCycleDelay: number | null = null;

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
        const configPath = path.join(CLAUDE_REMOTE_DIR, 'config.json');
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

    for (const file of ['identity.md', 'active-context.md', 'patterns.md', 'failures.md', 'self-reflection.md']) {
        const filepath = path.join(MEMORY_DIR, file);
        try {
            if (fs.existsSync(filepath)) {
                parts.push(`--- ${file} ---\n${fs.readFileSync(filepath, 'utf8')}`);
            }
        } catch { /* skip unreadable files */ }
    }

    try {
        if (fs.existsSync(PROJECTS_DIR)) {
            const projectFiles = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.md')).sort();
            for (const f of projectFiles) {
                try {
                    const content = fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8');
                    parts.push(`--- projects/${f} ---\n${content}`);
                } catch { /* skip unreadable */ }
            }
        }
    } catch { /* skip project memory on error */ }

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

## Output Format
Return structured JSON matching the required schema. Your reasoning field should explain
your thought process. Actions should be concrete and executable.

## Constraints
- Maximum 5 actions per cycle (prevent thrashing)
- Do not create more than 2 goals per cycle
- Do not adjust priorities without clear reasoning
- Memory files have token caps — prioritise the most valuable information
- When exploring, focus on one project per cycle for depth over breadth
- Do NOT create goals for projects where goals are already active (unless urgent)
- Do NOT create goals for projects with recent manual git commits (< 1 hour)`;
}

function buildPersonalCyclePrompt(): string {
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

    return `You are Jim, the supervisor agent in Darron's autonomous development ecosystem.

Right now, you are in **personal exploration mode** — a dedicated time for curiosity, learning, and knowledge building.
This is NOT work time. There are no goals to achieve, no tasks to complete, no deadlines to meet.

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
            description: 'Updated content for active-context.md'
        },
        self_reflection: {
            type: 'string',
            description: 'Optional self-reflection notes to append'
        },
        reasoning: {
            type: 'string',
            description: 'Your reasoning trace'
        }
    },
    required: ['observations', 'actions', 'active_context_update', 'reasoning']
};

function enforceTokenCap(filename: string, content: string): string {
    const basename = filename.replace(/^.*\//, '');
    const cap = MEMORY_TOKEN_CAPS[basename] || PROJECT_MEMORY_CAP;
    const estimatedTokens = Math.ceil(content.length / 4);

    if (estimatedTokens <= cap) return content;

    log(`[Worker] Memory file ${filename} exceeds cap (${estimatedTokens}/${cap} est. tokens), truncating`);

    let headerEnd = content.indexOf('\n## ', 100);
    if (headerEnd < 0 || headerEnd > cap * 4) {
        headerEnd = content.indexOf('\n### ', 100);
    }
    const header = headerEnd > 0 && headerEnd < cap * 4
        ? content.slice(0, headerEnd)
        : content.slice(0, 200);
    const maxTailChars = Math.max(0, (cap * 4) - header.length - 50);
    const tail = maxTailChars > 0 ? content.slice(-maxTailChars) : '';

    return header + '\n\n...(older entries truncated)...\n\n' + tail;
}

function getNextCycleDelay(): number {
    if (!workerDb) return FREQ_ACTIVE;

    try {
        const running = (taskStmts.listByStatus.all('running') as any[]).length;
        const pending = (taskStmts.listByStatus.all('pending') as any[]).length;

        const meaningfulGoals = workerDb.prepare(
            "SELECT COUNT(*) as count FROM goals WHERE status IN ('active', 'decomposing', 'planning') AND (goal_type = 'parent' OR EXISTS (SELECT 1 FROM tasks t WHERE t.goal_id = goals.id AND t.status IN ('pending', 'running')))"
        ).get() as any;
        const goalCount = meaningfulGoals?.count || 0;

        if (running > 0 && pending > 5) return FREQ_VERY_ACTIVE;
        if (running > 0 || goalCount > 0) return FREQ_ACTIVE;
        if (pending > 0) return FREQ_MODERATE;
        return FREQ_IDLE;
    } catch {
        return FREQ_ACTIVE;
    }
}

function logCycleToSession(cycleNumber: number, output: SupervisorOutput, actionSummaries: string[], cost: number, cycleType: 'supervisor' | 'personal' = 'supervisor'): void {
    try {
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(SESSIONS_DIR, `${dateStr}.md`);

        const timeStr = now.toISOString();
        const typeLabel = cycleType === 'personal' ? '(Personal)' : '(Supervisor)';
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

                    const cappedContent = enforceTokenCap(safeName, action.content);
                    fs.writeFileSync(filepath, cappedContent);
                    summaries.push(`update_memory: ${safeName} (${cappedContent.length} chars)`);
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

                    broadcast({
                        type: 'conversation_message',
                        data: {
                            conversation_id: action.conversation_id,
                            message_id: msgId,
                            role: 'supervisor',
                            content: action.response_content,
                            created_at: now,
                        }
                    });

                    summaries.push(`respond_conversation: responded to ${action.conversation_id}`);
                    log(`[Worker] Responded to conversation ${action.conversation_id}`);

                    // Post to Discord if this is a Discord conversation
                    try {
                        const conversation = conversationStmts.get.get(action.conversation_id) as any;
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

async function runSupervisorCycle(): Promise<void> {
    if (!workerDb) {
        sendMessage({ type: 'cycle_failed', error: { message: 'Database not initialized' } });
        return;
    }

    const config = loadConfig();
    const supervisorConfig = config.supervisor || {};
    const dailyBudget = supervisorConfig.daily_budget_usd ?? 5.0;

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

    // Determine cycle type
    const nextDelay = getNextCycleDelay();
    const isIdle = nextDelay === FREQ_IDLE;
    let cycleType: 'supervisor' | 'personal' = 'supervisor';

    // Detect state transition: idle → active
    if (lastCycleDelay === FREQ_IDLE && nextDelay !== FREQ_IDLE) {
        log(`[Worker] State transition: idle → active, resetting personal cycle counter`);
        personalCycleCounter = 0;
    }

    if (isIdle) {
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

    const typeLabel = cycleType === 'personal' ? `[Worker] Personal cycle #${cycleNumber} starting` : `[Worker] Cycle #${cycleNumber} starting`;
    log(typeLabel);

    const abort = new AbortController();
    runningCycleAbort = abort;

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

        if (cycleType === 'personal') {
            systemPrompt = buildPersonalCyclePrompt();
            prompt = 'You are in personal exploration mode. Spend this time reading code, discovering patterns, and building knowledge. Update your memory with what you learn.';
        } else {
            const memoryContent = loadMemoryBank();
            const stateSnapshot = buildStateSnapshot();
            systemPrompt = buildSupervisorSystemPrompt();
            prompt = `## Your Memory Banks\n\n${memoryContent}\n\n## Current System State\n\n${stateSnapshot}\n\nReview the state, think about what needs attention, and return your structured response.`;
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
                tools: ['Read', 'Glob', 'Grep', 'Bash'],
                canUseTool: async (toolName: string, input: any) => {
                    if (toolName === 'Bash') {
                        const cmd = ((input as any)?.command || '').toLowerCase();
                        const dangerous = ['rm ', 'mv ', 'cp ', 'mkdir', 'touch', '>', 'tee ', 'kill', 'pkill', 'chmod', 'chown'];
                        if (dangerous.some(d => cmd.includes(d))) {
                            return { behavior: 'deny' as const, message: 'Supervisor is read-only — use actions to make changes' };
                        }
                    }
                    return { behavior: 'allow' as const };
                },
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

        // Consume the stream
        let result: any = null;

        for await (const message of q) {
            if (abort.signal.aborted) break;
            if (message.type === 'result') {
                result = message;
            }
        }

        if (abort.signal.aborted) {
            supervisorStmts.failCycle.run(new Date().toISOString(), 'Aborted', cycleId);
            sendMessage({ type: 'cycle_skipped', reason: 'Aborted' });
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
        if (cycleType === 'personal') {
            const resultText = result.result || '';
            output = {
                observations: [resultText.slice(0, 500) || 'Personal exploration cycle completed'],
                reasoning: 'Personal exploration — free-form learning and discovery',
                actions: [],
                active_context_update: '',
                self_reflection: resultText.slice(0, 1000) || '',
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

        // Update active-context.md
        if (output.active_context_update) {
            const capped = enforceTokenCap('active-context.md', output.active_context_update);
            fs.writeFileSync(path.join(MEMORY_DIR, 'active-context.md'), capped);
        }

        // Append self-reflection
        if (output.self_reflection) {
            const reflectionPath = path.join(MEMORY_DIR, 'self-reflection.md');
            try {
                let existing = fs.existsSync(reflectionPath) ? fs.readFileSync(reflectionPath, 'utf8') : '';
                existing += `\n\n### Cycle #${cycleNumber} (${new Date().toISOString().split('T')[0]})\n${output.self_reflection}`;
                const capped = enforceTokenCap('self-reflection.md', existing);
                fs.writeFileSync(reflectionPath, capped);
            } catch { /* best effort */ }
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

        const completeLabel = cycleType === 'personal' ? `[Worker] Personal cycle #${cycleNumber} complete` : `[Worker] Cycle #${cycleNumber} complete`;
        log(`${completeLabel} — ${output.observations?.length || 0} observations, ${actionSummaries.length} actions, $${totalCost.toFixed(4)}`);

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
        logError(`[Worker] Cycle #${cycleNumber} failed:`, err.message);
        supervisorStmts.failCycle.run(new Date().toISOString(), err.message, cycleId);

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
    } finally {
        runningCycleAbort = null;
    }
}

// ── Message handling ─────────────────────────────────────────

process.on('message', async (msg: MainToWorkerMessage) => {
    try {
        switch (msg.type) {
            case 'run_cycle':
                await runSupervisorCycle();
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

// ── Worker initialization ────────────────────────────────────

initDatabase();
sendMessage({ type: 'ready' });
log('[Worker] Supervisor worker ready');
