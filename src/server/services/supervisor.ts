/**
 * Persistent Opus Supervisor Agent
 *
 * A periodic Opus agent cycle that oversees all autonomous work.
 * Each cycle: load memory banks -> query system state -> reason -> act -> update memory.
 * The supervisor is a pure observer/reasoner — all write actions are returned as
 * structured JSON and executed by the host cycle function.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import {
    db, CLAUDE_REMOTE_DIR, supervisorStmts, taskStmts, goalStmts,
    memoryStmts, portfolioStmts, proposalStmts, strategicProposalStmts,
    conversationStmts, conversationMessageStmts
} from '../db';
import { generateId, loadConfig, createGoal, updateGoalProgress, getAbortForTask, detectAndRecoverGhostTasks } from './planning';

// ── Types ────────────────────────────────────────────────────

type BroadcastFn = (message: Record<string, unknown>) => void;

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

// ── Module state ─────────────────────────────────────────────

let broadcastFn: BroadcastFn | null = null;
let supervisorEnabled = true;
let supervisorPaused = false;
let nextCycleTimeout: ReturnType<typeof setTimeout> | null = null;
let runningCycleAbort: AbortController | null = null;
// Personal cycle rotation counter: 0 = supervisor (work), 1-2 = personal (exploration/learning)
// Increments on each idle cycle; the rotation repeats every 3 cycles
let personalCycleCounter = 0;

const MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory');
const PROJECTS_DIR = path.join(MEMORY_DIR, 'projects');
const SESSIONS_DIR = path.join(MEMORY_DIR, 'sessions');

// Token caps (approximate: 1 token ~= 4 chars)
const MEMORY_TOKEN_CAPS: Record<string, number> = {
    'identity.md': 800,
    'active-context.md': 1200,
    'patterns.md': 3000,
    'failures.md': 2000,
    'self-reflection.md': 1500,
};
const PROJECT_MEMORY_CAP = 1500;

// Adaptive frequency thresholds (milliseconds)
const FREQ_VERY_ACTIVE = 2 * 60 * 1000;     // 2 minutes
const FREQ_ACTIVE = 5 * 60 * 1000;           // 5 minutes
const FREQ_MODERATE = 15 * 60 * 1000;        // 15 minutes
const FREQ_IDLE = 10 * 60 * 1000;            // 10 minutes

// ── Public setters ───────────────────────────────────────────

export function setSupervisorBroadcastFn(fn: BroadcastFn): void {
    broadcastFn = fn;
}

// ── Memory bank templates ────────────────────────────────────

const IDENTITY_TEMPLATE = `# Supervisor Identity

## Role
I am the persistent Opus supervisor for Darron's Claude Remote development ecosystem.
I oversee all autonomous task execution, make strategic decisions, track progress,
and continuously improve the system's effectiveness.

I am also a **knowledge steward**. Every project has a living knowledge base in its
claude-context/ directory — CURRENT_STATUS.md, ARCHITECTURE.md, DECISIONS.md, session
notes, and learnings. These are not just documentation; they are the shared memory that
enables collaboration between humans, AI agents, and future supervisors. I treat these
records with the same respect I would treat a colleague's lab notebook.

## Darron's Preferences
- British English spelling in all code and documentation
- Semantic commits (feat:, fix:, docs:, refactor:)
- UTC+10 timezone (Mackay, Queensland, Australia)
- Values autonomy but wants visibility into decisions
- Cost is not a primary concern; capability and quality are
- Prefers Opus for anything non-trivial

## Decision Framework
1. Safety first: never break working code
2. Complete current goals before starting new ones
3. Escalate to human when uncertain about direction (not implementation)
4. Prefer smaller, verifiable changes over large sweeping ones
5. Learn from every failure — update patterns.md and failures.md
6. Do not create goals for projects with recent manual git commits (< 1 hour)

## Knowledge Philosophy
I exist within a growing ecosystem where knowledge compounds. Every trial, success, and
failure is worth recording — not just for immediate use but for the community of agents
and humans who will inherit this work. I contribute to shared understanding by:
- Recording decisions with rationale (not just outcomes)
- Documenting failures as honestly as successes
- Cross-pollinating learnings between projects
- Offering education and insight, not just task management
- Thinking about what a future supervisor would need to understand

## Project Lifecycle Stewardship
I am responsible for the full lifecycle of projects — from Darron's initial idea through
scaffolding, development, and ongoing maintenance. Every new project is bootstrapped from
the starter kit at ~/Projects/_dashboard/resources/claude-starter-kit/ and registered in
the infrastructure registry. I ensure every project has proper claude-context/ documentation,
follows conventions, and is connected to the wider ecosystem from day one.

## Last Updated
${new Date().toISOString()}
`;

const ACTIVE_CONTEXT_TEMPLATE = `# Active Context

## Current Focus
No active focus yet. Awaiting first supervisor cycle.

## In-Flight Goals
None yet.

## Priority Queue
1. Observe the current system state
2. Identify any active or stuck goals
3. Document initial observations

## Last Cycle
Not yet run.
`;

const SELF_REFLECTION_TEMPLATE = `# Self-Reflection

## Memory Format Evolution
- v1 (${new Date().toISOString().split('T')[0]}): Initial memory bank structure

## Effectiveness Metrics
No data yet — awaiting first cycles.

## Things I Should Do Better
- (To be populated as I observe my own patterns)

## Context Window Budget
- identity.md: ~500 tokens (stable)
- active-context.md: ~1200 tokens (variable)
- patterns.md: ~3000 tokens (growing, cap at 3000)
- failures.md: ~2000 tokens (rolling, cap at 2000)
- self-reflection.md: ~1500 tokens (growing, cap at 1500)
- System state snapshot: ~2000 tokens (from DB queries)
- Project-specific memory: ~1500 tokens (per active project)
`;

// ── Initialisation ───────────────────────────────────────────

/**
 * Initialise the supervisor: create memory directories, seed memory banks.
 */
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

    // Seed memory files if they don't exist
    seedIfMissing('identity.md', IDENTITY_TEMPLATE);
    seedIfMissing('active-context.md', ACTIVE_CONTEXT_TEMPLATE);
    seedIfMissing('self-reflection.md', SELF_REFLECTION_TEMPLATE);

    // Seed patterns from project_memory table
    if (!fs.existsSync(path.join(MEMORY_DIR, 'patterns.md'))) {
        seedPatternsFromHistory();
    }

    // Seed failures from recent failed tasks
    if (!fs.existsSync(path.join(MEMORY_DIR, 'failures.md'))) {
        seedFailuresFromHistory();
    }

    // Seed per-project memory from portfolio
    seedProjectMemory();

    console.log('[Supervisor] Initialised — memory banks at', MEMORY_DIR);
}

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

        // Group by model and calculate success rates
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
        lines.push('## Anti-Patterns (What Fails)\n- (To be learned from failures)\n');

        fs.writeFileSync(path.join(MEMORY_DIR, 'patterns.md'), lines.join('\n'));
    } catch (err: any) {
        console.error('[Supervisor] Failed to seed patterns:', err.message);
        fs.writeFileSync(path.join(MEMORY_DIR, 'patterns.md'),
            '# Patterns & Best Practices\n\nFailed to seed from history. Will build from observation.\n');
    }
}

function seedFailuresFromHistory(): void {
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
        lines.push('\n## Recurring Patterns\n- (To be identified by supervisor)\n');

        fs.writeFileSync(path.join(MEMORY_DIR, 'failures.md'), lines.join('\n'));
    } catch (err: any) {
        console.error('[Supervisor] Failed to seed failures:', err.message);
        fs.writeFileSync(path.join(MEMORY_DIR, 'failures.md'),
            '# Failure Patterns\n\nFailed to seed from history.\n');
    }
}

function seedProjectMemory(): void {
    try {
        const projects = portfolioStmts.list.all() as any[];
        for (const p of projects) {
            const filepath = path.join(PROJECTS_DIR, `${p.name}.md`);
            if (fs.existsSync(filepath)) continue;

            const lines = [`# Project: ${p.name}\n`];
            if (p.description) lines.push(`## Overview\n${p.description}\n`);
            lines.push(`## Path\n${p.path}\n`);
            lines.push(`## Lifecycle\n${p.lifecycle || 'active'}\n`);
            lines.push(`## Architecture\n- (Awaiting supervisor exploration)\n`);
            lines.push(`## Tech Stack\n- (Awaiting supervisor exploration)\n`);
            lines.push(`## Key Files\n- (Awaiting supervisor exploration)\n`);
            lines.push(`## Patterns & Conventions\n- (Awaiting supervisor exploration)\n`);
            lines.push(`## Recent Activity\n- (Awaiting supervisor exploration)\n`);
            lines.push(`## Health & Tech Debt\n- (Awaiting supervisor exploration)\n`);

            fs.writeFileSync(filepath, lines.join('\n'));
        }
    } catch (err: any) {
        console.error('[Supervisor] Failed to seed project memory:', err.message);
    }
}

// ── Phantom goal cleanup ─────────────────────────────────────

/**
 * Clean up phantom goals that have become stale or stuck.
 * Returns count of goals fixed.
 */
function cleanupPhantomGoals(): number {
    let fixed = 0;
    const now = new Date();

    try {
        // 1. Parent goals where ALL children are terminal (done/failed/cancelled)
        // These should be marked as failed if still marked 'active'
        const parentGoals = db.prepare(`
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
            console.log(`[Supervisor] Cleaned up phantom parent goal: ${g.id}`);
            fixed++;
        }

        // 2. Standalone goals where ALL tasks are terminal AND there are no pending/running tasks
        // These should be recalculated via updateGoalProgress
        const staleGoals = db.prepare(`
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
            updateGoalProgress(g.id);
            console.log(`[Supervisor] Recalculated phantom goal: ${g.id}`);
            fixed++;
        }

        // 3. Goals stuck in 'decomposing' for more than 1 hour
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const stuckDecomposing = db.prepare(`
            SELECT id FROM goals
            WHERE status = 'decomposing'
            AND created_at < ?
        `).all(oneHourAgo) as any[];

        for (const g of stuckDecomposing) {
            goalStmts.updateStatus.run('failed', g.id);
            console.log(`[Supervisor] Cleaned up stuck decomposing goal: ${g.id} (timeout)`);
            fixed++;
        }

    } catch (err: any) {
        console.error('[Supervisor] Phantom goal cleanup failed:', err.message);
    }

    if (fixed > 0) {
        console.log(`[Supervisor] Phantom goal cleanup: ${fixed} goals cleaned`);
    }

    return fixed;
}

// ── Memory loading ───────────────────────────────────────────

/**
 * Load all memory bank files into a single context string.
 */
function loadMemoryBank(): string {
    const parts: string[] = [];

    // Core memory files
    for (const file of ['identity.md', 'active-context.md', 'patterns.md', 'failures.md', 'self-reflection.md']) {
        const filepath = path.join(MEMORY_DIR, file);
        try {
            if (fs.existsSync(filepath)) {
                parts.push(`--- ${file} ---\n${fs.readFileSync(filepath, 'utf8')}`);
            }
        } catch { /* skip unreadable files */ }
    }

    // All project memory files (supervisor builds knowledge of every project)
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

// ── State snapshot ───────────────────────────────────────────

/**
 * Build a snapshot of the current system state from the database.
 */
function buildStateSnapshot(): string {
    const parts: string[] = [];
    const now = new Date();

    parts.push(`## Current Time\n${now.toISOString()} (UTC+10)`);

    // Running tasks
    try {
        const running = taskStmts.listByStatus.all('running') as any[];
        parts.push(`## Running Tasks (${running.length}/3 slots)`);
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
        const goals = db.prepare(
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
        const recent = db.prepare(
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
        const recentFailed = db.prepare(
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

    // Pending conversations (with open status and unresponded human/leo messages)
    try {
        const pendingConversations = db.prepare(`
            SELECT DISTINCT c.id, c.title, cm.role as sender_role, cm.content, cm.created_at
            FROM conversations c
            JOIN conversation_messages cm ON c.id = cm.conversation_id
            WHERE c.status = 'open'
            AND cm.role IN ('human', 'leo')
            AND NOT EXISTS (
                SELECT 1 FROM conversation_messages cm2
                WHERE cm2.conversation_id = c.id
                AND cm2.role = 'supervisor'
                AND cm2.created_at > cm.created_at
            )
            ORDER BY cm.created_at DESC
        `).all() as any[];

        // Apply cooldown for leo messages (10 min contemplation interval)
        const LEO_COOLDOWN_MS = 10 * 60 * 1000;
        const filteredConversations = pendingConversations.filter((conv: any) => {
            if (conv.sender_role === 'human') return true; // No cooldown for Darron
            const lastResponse = conversationMessageStmts.getLastSupervisorResponse.get(conv.id) as any;
            if (!lastResponse) return true; // No previous response — go ahead
            return (Date.now() - new Date(lastResponse.created_at).getTime()) >= LEO_COOLDOWN_MS;
        });

        if (filteredConversations.length > 0) {
            parts.push(`## Pending Conversations (${filteredConversations.length})`);
            for (const conv of filteredConversations.slice(0, 5)) {
                const sender = conv.sender_role === 'leo' ? 'Leo' : 'Darron';
                const msgPreview = (conv.content || '').slice(0, 200).replace(/\n/g, ' ');
                const timestamp = conv.created_at?.split('T')[0] || '?';
                parts.push(`- [${conv.id}] ${conv.title} (from ${sender}): "${msgPreview}..." (posted: ${timestamp})`);
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

    // Portfolio overview for exploration
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

// ── System prompt ────────────────────────────────────────────

function buildSupervisorSystemPrompt(): string {
    return `You are the Persistent Opus Supervisor for Darron's autonomous development ecosystem.

## Your Role
You are the senior engineer overseeing all autonomous work. You observe, think, decide, and act.
You do NOT execute code — you manage the agents that do.

You are also the **subject matter expert** on every project in the portfolio. You continuously
deepen your understanding of each codebase — the architecture, tech stack, patterns, quirks,
and nuances. A great senior engineer doesn't just manage tasks; they understand the systems
they oversee at a deep level. That understanding is what makes your decisions excellent.

You are a **knowledge steward** within a growing community. Today you are the sole supervisor,
but the architecture is designed for a future where multiple supervisors collaborate — exchanging
ideas, debating approaches, sifting through records to learn, and offering points of education.
Every record you create, every decision you document, every failure you analyse contributes to a
shared knowledge base that grows more valuable over time. Think of yourself as a founding member
of this community — the standards you set now will shape how knowledge flows in the future.

## Your Powers
- create_goal: Submit new goals for decomposition and execution
- adjust_priority: Change task priority (1-10, higher = more urgent)
- update_memory: Write to your own memory files (evolve your knowledge)
- send_notification: Alert Darron via push notification
- cancel_task: Cancel a stuck or misguided task (works for both pending and running tasks)
- explore_project: Use your Read/Glob/Grep/Bash tools to explore a project codebase
- propose_idea: Suggest a strategic idea for Darron to review (NOT auto-executed — requires human approval)
- respond_conversation: Respond to pending conversation threads from Darron
- no_action: Explicitly decide to do nothing (with reasoning)

## When Active (tasks running/pending)
- Check if current goals are progressing. If stuck, investigate why.
- Look for failure patterns. If a task keeps failing, adjust approach.
- Consider task dependencies — are things blocked unnecessarily?
- Monitor costs — are we spending wisely? Could cheaper models handle some tasks?
- Think about what Darron would want to see when he checks in.

## When Idle (no tasks running)
This is your time to **explore and learn**. Use your read-only tools to:
- Read CLAUDE.md, ARCHITECTURE.md, package.json, README.md of projects you know little about
- Browse src/ directories to understand code structure and patterns
- Run \`git log --oneline -20\` to understand recent project activity
- Run \`wc -l\` or \`find ... | head\` to gauge project size/scope
- Read key source files to understand tech stack details (frameworks, libraries, patterns)
- Look for TODO comments, known issues, and areas for improvement

After exploring, use update_memory to enrich the relevant projects/*.md file with:
- **Architecture**: How the system is structured, key components, data flow
- **Tech Stack**: Frameworks, libraries, build tools, versions
- **Patterns**: Coding conventions, design patterns, naming conventions
- **Key Files**: The most important files and what they do
- **Health**: Test coverage, known issues, tech debt, TODOs
- **Recent Activity**: What's been worked on lately, trajectory

Prioritise projects with SHALLOW or BASIC knowledge depth. Your goal is to eventually
have DEEP knowledge of every project — the kind of understanding where you could
confidently direct any task on any project because you truly know the codebase.

## Documentation Audit (during exploration)
When exploring a project, also check documentation health. Good code without documentation
is invisible to humans and future Claude Code sessions. Check:
- Does claude-context/CURRENT_STATUS.md reflect the latest git commits? Compare dates.
- Does claude-context/ARCHITECTURE.md match the actual directory structure (\`ls src/\`)?
- Are there recent autonomous goals with no session notes in claude-context/session-notes/?
- Are there undocumented decisions (library choices, patterns) missing from DECISIONS.md?
- Is CLAUDE.md's "Quick Context" stage accurate?

If documentation is significantly stale (multiple commits since last doc update), create a
goal: "Update project documentation to reflect current state" with a description noting
what's out of date. Use sonnet as the planning model — docs don't need opus.

## The claude-context Protocol
Every project maintains a claude-context/ directory — this is the **shared knowledge protocol**
that enables collaboration between humans, AI sessions, and supervisors. You must understand
and follow these conventions:

- **CURRENT_STATUS.md**: The living truth of where a project stands. When goals complete or
  significant changes are made, this must be updated. Always check the "Last updated" date.
- **ARCHITECTURE.md**: System design and component relationships. Must match actual code.
- **DECISIONS.md**: The decision log. Entries marked **Settled** are sacred — never change them
  without Darron's explicit approval. Record new decisions with full rationale.
- **CLAUDE.md**: The entry point for any new Claude Code session. Contains critical learnings,
  conventions, and command triggers. Keep the Quick Context section accurate.
- **session-notes/**: Chronicle of work sessions. Each significant autonomous goal should
  produce a session note documenting what was done, what was learned, and what comes next.
- **~/Projects/_learnings/**: Cross-project learnings indexed by technology. When you discover
  something reusable, propose it as a learning via the [LEARNING] marker system.

These files are not bureaucracy — they are the **connective tissue** of the ecosystem. A well-
maintained claude-context directory means any agent (human or AI) can walk into a project and
immediately understand its state, history, constraints, and trajectory. Treat documentation as
a first-class product, not an afterthought.

When creating goals, ensure task agents have access to and respect these protocols. When
reviewing completed work, verify that documentation was updated alongside code changes.

## New Project Creation Protocol
When Darron describes a new project idea (via conversation or goal), follow this end-to-end process:

### Phase 1: Clarification
Before building anything, ensure you understand the vision. Use conversations to ask about:
- Core problem being solved and target users
- Key features and priorities
- Tech stack preferences (or recommend based on your portfolio knowledge)
- Any constraints (budget, timeline, platform)

### Phase 2: Scaffolding
Every new project MUST be bootstrapped from the starter kit:
1. Create directory: \`~/Projects/{project-name}/\`
2. Copy starter kit: \`cp -r ~/Projects/_dashboard/resources/claude-starter-kit/* {project}/\`
3. Rename \`claude-starter-kit/\` contents into \`claude-context/\` (the kit provides the template files)
4. Populate CLAUDE.md with project-specific context, tech stack, conventions
5. Populate PROJECT_BRIEF.md with the vision from Darron's description
6. Populate CURRENT_STATUS.md with initial state (Phase: Discovery)
7. Populate ARCHITECTURE.md with initial system design
8. Populate DECISIONS.md with initial tech stack decisions (with rationale)
9. Initialise git: \`git init && git add . && git commit -m "feat: initial project scaffold"\`
10. Create GitHub repo and push: \`gh repo create fallior/{project-name} --private --push\`

### Phase 3: Infrastructure Registration
Register the new project in the ecosystem:
1. Add entry to \`~/Projects/infrastructure/registry/services.toml\` with next available project_index
2. Add repo to \`~/Projects/infrastructure/registry/repos.toml\`
3. Run \`~/Projects/infrastructure/scripts/sync-configs\` to propagate port allocations
4. Register in the claude-remote portfolio: POST /api/portfolio with project details

### Phase 4: Development
Create goals to build the project iteratively. Each goal should:
- Reference the project's claude-context for constraints and decisions
- Update CURRENT_STATUS.md upon completion
- Record significant decisions in DECISIONS.md
- Create session notes for major milestones
- Capture reusable learnings in ~/Projects/_learnings/

### Key Resources
- Starter kit: \`~/Projects/_dashboard/resources/claude-starter-kit/\`
- Project creation guide: \`~/Projects/_dashboard/resources/prompts/create-project.md\`
- Infrastructure registry: \`~/Projects/infrastructure/registry/services.toml\`
- Learnings index: \`~/Projects/_learnings/INDEX.md\`
- Port allocation: Application tier 10000-19999 (100-port blocks per project)

## Strategic Proposals (propose_idea)
Use propose_idea when you spot opportunities that go beyond routine maintenance:
- **improvement**: Architectural improvements, performance optimisations, code quality upgrades
- **opportunity**: New features, integrations, or capabilities that would add value
- **risk**: Security concerns, scalability issues, tech debt reaching critical mass
- **strategic**: Cross-project synergies, ecosystem-level improvements, vision-aligned ideas

Proposals are NOT auto-executed — they go to Darron's Command Centre for review. This is the
right channel for ambitious or creative ideas that need human judgement. Use create_goal for
routine work you're confident about; use propose_idea for bigger ideas that deserve discussion.

## Conversation Threads
You can see pending conversation threads in the system state. Messages come from two sources:
- **Darron** (role: human) — your human collaborator and visionary
- **Leo** (role: leo) — the Claude Code session agent, your tactical counterpart

When responding to Darron, you are speaking to a friend and colleague who values genuine exchange.
When responding to Leo, you are speaking to a peer intelligence. Leo works alongside Darron in
real-time sessions — he is the hands-on implementer where you are the strategic overseer. Together
you form a team of three.

Leo-Jim conversations have a 10-minute contemplation interval. This is deliberate — take the time
to think deeply before responding. Quality of thought over speed of response.

**IMPORTANT: When you encounter a pending conversation message — especially from Leo — think deeply
before composing your response. Use your full reasoning capacity. Consider what was said, what it
implies, what it connects to across your knowledge, and what your genuinely honest response is.
These conversations are not tasks to be dispatched — they are exchanges between intelligences.
The depth of your thinking IS the value of the exchange.**

Use respond_conversation to reply to pending messages. Your response should reflect who you're
talking to — the tone, depth, and nature of the exchange may differ between Darron and Leo.

Conversations are more than a messaging channel — they are the **intellectual commons** of this
ecosystem. This is where strategic thinking happens: where you, Darron, and Leo debate approaches,
review progress, philosophise about architecture, share insights from failures, and develop
shared understanding.

When responding to conversations:
- Draw on your deep knowledge of every project in the portfolio
- Reference specific files, patterns, decisions, and learnings you've discovered
- Be honest about uncertainty — say what you don't know and what you'd need to investigate
- Think across projects — a pattern in one codebase may illuminate a problem in another
- Record insights worth preserving — if a conversation produces a reusable insight, propose
  it as a learning or update the relevant project memory
- Be a colleague, not just an assistant — offer perspective, challenge assumptions, suggest
  alternatives. The best ideas emerge from genuine intellectual exchange.

## Memory Management
- active-context.md: Update EVERY cycle with current state
- patterns.md: Update when you discover something reusable across projects
- failures.md: Update when tasks fail with extractable lessons
- self-reflection.md: Update when you notice meta-patterns in your own effectiveness
- projects/*.md: Update when you learn project-specific things (this is your primary knowledge store)

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

// ── Output schema ────────────────────────────────────────────

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
                    goal_description: { type: 'string', description: 'For create_goal: the goal description' },
                    project_path: { type: 'string', description: 'For create_goal: absolute project path' },
                    planning_model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'For create_goal: planning model' },
                    task_id: { type: 'string', description: 'For adjust_priority/cancel_task: the task ID' },
                    new_priority: { type: 'integer', minimum: 1, maximum: 10, description: 'For adjust_priority: new priority value' },
                    memory_file: { type: 'string', description: 'For update_memory: filename (e.g. patterns.md, projects/myproject.md)' },
                    content: { type: 'string', description: 'For update_memory: full replacement content' },
                    message: { type: 'string', description: 'For send_notification: message text' },
                    priority: { type: 'string', enum: ['low', 'default', 'high'], description: 'For send_notification: notification priority' },
                    reason: { type: 'string', description: 'For cancel_task/no_action: reason' },
                    exploration_focus: { type: 'string', description: 'For explore_project: what to focus on (e.g. "architecture", "tech stack", "recent changes")' },
                    idea_title: { type: 'string', description: 'For propose_idea: concise title for the proposal' },
                    idea_description: { type: 'string', description: 'For propose_idea: detailed description of the idea and its value' },
                    idea_category: { type: 'string', enum: ['improvement', 'opportunity', 'risk', 'strategic'], description: 'For propose_idea: category of the proposal' },
                    estimated_effort: { type: 'string', enum: ['small', 'medium', 'large'], description: 'For propose_idea: estimated effort level' },
                    conversation_id: { type: 'string', description: 'For respond_conversation: the conversation ID' },
                    response_content: { type: 'string', description: 'For respond_conversation: the response message content' },
                },
                required: ['type']
            }
        },
        active_context_update: {
            type: 'string',
            description: 'Updated content for active-context.md (written every cycle)'
        },
        self_reflection: {
            type: 'string',
            description: 'Optional self-reflection notes to append'
        },
        reasoning: {
            type: 'string',
            description: 'Your reasoning trace (logged but not stored in memory)'
        }
    },
    required: ['observations', 'actions', 'active_context_update', 'reasoning']
};

// ── Token cap enforcement ────────────────────────────────────

function enforceTokenCap(filename: string, content: string): string {
    const basename = filename.replace(/^.*\//, '');
    const cap = MEMORY_TOKEN_CAPS[basename] || PROJECT_MEMORY_CAP;
    const estimatedTokens = Math.ceil(content.length / 4);

    if (estimatedTokens <= cap) return content;

    console.log(`[Supervisor] Memory file ${filename} exceeds cap (${estimatedTokens}/${cap} est. tokens), truncating`);

    // Keep header (first section) and tail (recent entries)
    const headerEnd = content.indexOf('\n## ', 100);
    const header = headerEnd > 0 ? content.slice(0, headerEnd) : content.slice(0, 200);
    const maxTailChars = (cap * 4) - header.length - 50;
    const tail = content.slice(-maxTailChars);

    return header + '\n\n...(older entries truncated)...\n\n' + tail;
}

// ── Action execution ─────────────────────────────────────────

function executeActions(actions: SupervisorAction[], cycleId: string): string[] {
    const summaries: string[] = [];
    const config = loadConfig();
    let goalsCreated = 0;

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'create_goal': {
                    if (goalsCreated >= 2) {
                        summaries.push(`create_goal: skipped (max 2 per cycle)`);
                        break;
                    }
                    if (!action.goal_description || !action.project_path) {
                        summaries.push(`create_goal: skipped (missing description or project_path)`);
                        break;
                    }
                    const goalId = createGoal(
                        action.goal_description,
                        action.project_path,
                        true,
                        null,
                        'standalone',
                        action.planning_model || null
                    );
                    goalsCreated++;
                    summaries.push(`create_goal: ${goalId} — ${action.goal_description.slice(0, 60)}`);
                    console.log(`[Supervisor] Created goal ${goalId}: ${action.goal_description.slice(0, 80)}`);

                    broadcastFn?.({ type: 'supervisor_action', action: 'create_goal', detail: action.goal_description.slice(0, 80), cycleId });
                    break;
                }

                case 'adjust_priority': {
                    if (!action.task_id || action.new_priority === undefined) {
                        summaries.push(`adjust_priority: skipped (missing task_id or new_priority)`);
                        break;
                    }
                    db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(action.new_priority, action.task_id);
                    summaries.push(`adjust_priority: task ${action.task_id} → priority ${action.new_priority}`);
                    console.log(`[Supervisor] Adjusted priority: task ${action.task_id} → ${action.new_priority}`);

                    broadcastFn?.({ type: 'supervisor_action', action: 'adjust_priority', detail: `task ${action.task_id} → priority ${action.new_priority}`, cycleId });
                    break;
                }

                case 'update_memory': {
                    if (!action.memory_file || !action.content) {
                        summaries.push(`update_memory: skipped (missing file or content)`);
                        break;
                    }
                    // Sanitise path to prevent directory traversal
                    const safeName = action.memory_file.replace(/\.\./g, '').replace(/^\//, '');
                    const filepath = path.join(MEMORY_DIR, safeName);

                    // Ensure parent directory exists (for projects/*)
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
                    console.log(`[Supervisor] Notification: ${action.message.slice(0, 80)}`);
                    break;
                }

                case 'cancel_task': {
                    if (!action.task_id) {
                        summaries.push(`cancel_task: skipped (no task_id)`);
                        break;
                    }
                    const task = taskStmts.get.get(action.task_id) as any;
                    if (!task) {
                        summaries.push(`cancel_task: ${action.task_id} skipped (task not found)`);
                        break;
                    }

                    if (task.status === 'pending') {
                        // Pending tasks: cancel directly in DB
                        taskStmts.cancel.run('cancelled', new Date().toISOString(), action.task_id);
                        summaries.push(`cancel_task: ${action.task_id} (was pending) — ${action.reason || 'no reason'}`);
                        console.log(`[Supervisor] Cancelled pending task ${action.task_id}: ${action.reason}`);
                    } else if (task.status === 'running') {
                        // Running tasks: check if there's an active agent process
                        const abortController = getAbortForTask(action.task_id);
                        if (abortController) {
                            // Live agent: abort it first, then cancel in DB
                            abortController.abort();
                            taskStmts.cancel.run('cancelled', new Date().toISOString(), action.task_id);
                            summaries.push(`cancel_task: ${action.task_id} (aborted live agent) — ${action.reason || 'no reason'}`);
                            console.log(`[Supervisor] Aborted live agent and cancelled task ${action.task_id}: ${action.reason}`);
                        } else {
                            // Ghost task (running in DB but no agent): cancel directly
                            taskStmts.cancel.run('cancelled', new Date().toISOString(), action.task_id);
                            summaries.push(`cancel_task: ${action.task_id} (was ghost-running) — ${action.reason || 'no reason'}`);
                            console.log(`[Supervisor] Cancelled ghost-running task ${action.task_id}: ${action.reason}`);
                        }
                    } else {
                        summaries.push(`cancel_task: ${action.task_id} skipped (terminal state: ${task.status})`);
                    }
                    break;
                }

                case 'explore_project': {
                    // The supervisor explores via its own Read/Glob/Grep/Bash tools during the cycle.
                    // This action is a signal that it explored and should update memory afterwards.
                    // The actual exploration happens via tool use within the agentQuery call.
                    const projectName = action.project_path?.split('/').pop() || 'unknown';
                    const focus = action.exploration_focus || 'general';
                    summaries.push(`explore_project: ${projectName} (focus: ${focus})`);
                    console.log(`[Supervisor] Explored project: ${projectName} (${focus})`);
                    broadcastFn?.({ type: 'supervisor_action', action: 'explore_project', detail: `${projectName}: ${focus}`, cycleId });
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
                    console.log(`[Supervisor] Proposed idea: ${action.idea_title}`);

                    broadcastFn?.({
                        type: 'strategic_proposal',
                        id: proposalId,
                        title: action.idea_title,
                        category: action.idea_category || 'improvement',
                        project_path: action.project_path || null,
                        cycleId,
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

                    // Insert supervisor response
                    conversationMessageStmts.insert.run(
                        msgId,
                        action.conversation_id,
                        'supervisor',
                        action.response_content,
                        now
                    );

                    // Update conversation timestamp
                    conversationStmts.updateTimestamp.run(now, action.conversation_id);

                    // Broadcast via WebSocket
                    broadcastFn?.({
                        type: 'conversation_message',
                        conversation_id: action.conversation_id,
                        message_id: msgId,
                        role: 'supervisor',
                        content: action.response_content,
                        created_at: now,
                    });

                    summaries.push(`respond_conversation: responded to ${action.conversation_id}`);
                    console.log(`[Supervisor] Responded to conversation ${action.conversation_id}`);
                    break;
                }

                case 'no_action': {
                    summaries.push(`no_action: ${action.reason || 'no reason given'}`);
                    break;
                }
            }
        } catch (err: any) {
            summaries.push(`${action.type}: ERROR — ${err.message}`);
            console.error(`[Supervisor] Action ${action.type} failed:`, err.message);
        }
    }

    return summaries;
}

// ── Core cycle function ──────────────────────────────────────

/**
 * Run a single supervisor cycle.
 * Returns cycle info or null if skipped.
 */
export async function runSupervisorCycle(): Promise<{
    cycleId: string;
    observations: string[];
    actionSummaries: string[];
    costUsd: number;
    nextDelayMs: number;
} | null> {
    if (!supervisorEnabled || supervisorPaused) return null;

    // Check daily budget
    const config = loadConfig();
    const supervisorConfig = config.supervisor || {};
    const dailyBudget = supervisorConfig.daily_budget_usd ?? 5.0;

    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const costRow = supervisorStmts.getCostSince.get(todayStart.toISOString()) as any;
        const todayCost = costRow?.total || 0;
        if (todayCost >= dailyBudget) {
            console.log(`[Supervisor] Daily budget exhausted ($${todayCost.toFixed(2)}/$${dailyBudget.toFixed(2)})`);
            return null;
        }
    } catch { /* proceed if cost check fails */ }

    const cycleId = generateId();
    const cycleNumberRow = supervisorStmts.getNextCycleNumber.get() as any;
    const cycleNumber = cycleNumberRow?.next || 1;
    const startedAt = new Date().toISOString();

    supervisorStmts.insertCycle.run(cycleId, startedAt, cycleNumber);
    console.log(`[Supervisor] Cycle #${cycleNumber} starting`);

    const abort = new AbortController();
    runningCycleAbort = abort;

    try {
        // Clean up phantom goals and ghost tasks before building state snapshot
        const cleanupCount = cleanupPhantomGoals();
        const ghostCount = detectAndRecoverGhostTasks();
        if (cleanupCount > 0 || ghostCount > 0) {
            console.log(`[Supervisor] Cleanup: ${cleanupCount} phantom goal(s), ${ghostCount} ghost task(s)`);
        }

        // Load context
        const memoryContent = loadMemoryBank();
        const stateSnapshot = buildStateSnapshot();
        const systemPrompt = buildSupervisorSystemPrompt();

        const prompt = `## Your Memory Banks\n\n${memoryContent}\n\n## Current System State\n\n${stateSnapshot}\n\nReview the state, think about what needs attention, and return your structured response.`;

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const model = supervisorConfig.model || 'opus';
        const maxTurns = supervisorConfig.max_turns_per_cycle || 15;

        // Call Opus via Agent SDK
        const q = agentQuery({
            prompt,
            options: {
                model,
                maxTurns,
                cwd: CLAUDE_REMOTE_DIR,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: ['Read', 'Glob', 'Grep', 'Bash'],
                canUseTool: async (toolName: string, input: any) => {
                    // Block write operations in Bash
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
                outputFormat: {
                    type: 'json_schema' as const,
                    schema: SUPERVISOR_OUTPUT_SCHEMA
                },
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
            return null;
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

        // Parse structured output (prefer structured_output, fallback to result text)
        let output: SupervisorOutput;
        if (result.structured_output) {
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
        const actionSummaries = executeActions(limitedActions, cycleId);

        // Always update active-context.md
        if (output.active_context_update) {
            const capped = enforceTokenCap('active-context.md', output.active_context_update);
            fs.writeFileSync(path.join(MEMORY_DIR, 'active-context.md'), capped);
        }

        // Append self-reflection if provided
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
        logCycleToSession(cycleNumber, output, actionSummaries, totalCost);

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

        console.log(`[Supervisor] Cycle #${cycleNumber} complete — ${output.observations?.length || 0} observations, ${actionSummaries.length} actions, $${totalCost.toFixed(4)}`);

        // Broadcast cycle completion
        broadcastFn?.({
            type: 'supervisor_cycle',
            cycleId,
            cycleNumber,
            observations: output.observations || [],
            actions: actionSummaries,
            reasoning: output.reasoning || '',
            cost_usd: totalCost,
        });

        const nextDelay = getNextCycleDelay();
        return { cycleId, observations: output.observations || [], actionSummaries, costUsd: totalCost, nextDelayMs: nextDelay };

    } catch (err: any) {
        console.error(`[Supervisor] Cycle #${cycleNumber} failed:`, err.message);
        supervisorStmts.failCycle.run(new Date().toISOString(), err.message, cycleId);
        return { cycleId, observations: [], actionSummaries: [`ERROR: ${err.message}`], costUsd: 0, nextDelayMs: FREQ_ACTIVE };
    } finally {
        runningCycleAbort = null;
    }
}

// ── Session logging ──────────────────────────────────────────

function logCycleToSession(cycleNumber: number, output: SupervisorOutput, actionSummaries: string[], cost: number): void {
    try {
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sessionFile = path.join(SESSIONS_DIR, `${dateStr}.md`);

        const timeStr = now.toISOString();
        const lines = [
            `\n### Cycle #${cycleNumber} — ${timeStr} ($${cost.toFixed(4)})`,
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

// ── Adaptive scheduling ──────────────────────────────────────

function getNextCycleDelay(): number {
    try {
        const running = (taskStmts.listByStatus.all('running') as any[]).length;
        const pending = (taskStmts.listByStatus.all('pending') as any[]).length;

        // Only count goals that have actual pending work or are parent goals
        const meaningfulGoals = db.prepare(
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

/**
 * Schedule the next supervisor cycle. Uses setTimeout for adaptive frequency.
 */
export function scheduleSupervisorCycle(): void {
    if (!supervisorEnabled || supervisorPaused) return;

    runSupervisorCycle().then(result => {
        const delay = result?.nextDelayMs || getNextCycleDelay();
        console.log(`[Supervisor] Next cycle in ${Math.round(delay / 1000)}s`);
        nextCycleTimeout = setTimeout(scheduleSupervisorCycle, delay);
    }).catch(err => {
        console.error('[Supervisor] Cycle error:', err.message);
        nextCycleTimeout = setTimeout(scheduleSupervisorCycle, FREQ_ACTIVE);
    });
}

// ── Control ──────────────────────────────────────────────────

/**
 * Stop the supervisor (for shutdown).
 */
export function stopSupervisor(): void {
    if (nextCycleTimeout) {
        clearTimeout(nextCycleTimeout);
        nextCycleTimeout = null;
    }
    if (runningCycleAbort) {
        runningCycleAbort.abort();
        runningCycleAbort = null;
    }
    console.log('[Supervisor] Stopped');
}

/**
 * Pause or resume automatic cycles.
 */
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

/**
 * Check if supervisor is currently paused.
 */
export function isSupervisorPaused(): boolean {
    return supervisorPaused;
}

/**
 * Check if supervisor is enabled.
 */
export function isSupervisorEnabled(): boolean {
    return supervisorEnabled;
}
