import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import { db, taskStmts, goalStmts, memoryStmts, portfolioStmts, CLAUDE_REMOTE_DIR } from '../db';
import { isGitRepo, createCheckpoint, rollbackCheckpoint, commitTaskChanges, cleanupCheckpoint, recalcProjectCosts, calculatePriorityScore } from './git';
import { extractAndStoreProposals } from './proposals';
import { buildTaskContext } from './context';

// ── Types ────────────────────────────────────────────────────

type BroadcastFn = (message: Record<string, unknown>) => void;
type OrchestratorModule = {
    recommendModel: (db: any, projectPath: string, taskType: string) => {
        model: string | null;
        confidence: string;
        reason: string;
        stats: Record<string, unknown>;
    };
    analyseFailure: (task: any, error: string, attemptNumber: number) => Promise<{
        shouldRetry: boolean;
        adjustedDescription: string | null;
        adjustedModel: string | null;
        reasoning: string;
        backend: string;
        model: string;
    }>;
};
type AdvancePipelineFn = (productId: string, completedPhase: string, goalResult: any) => void;

// ── Module-level state ───────────────────────────────────────

const PLANNING_CONCURRENCY = parseInt(process.env.PLANNING_CONCURRENCY as string) || 2;
let activePlanningCount = 0;
const planningQueue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
}> = [];

// ── Concurrent pipeline slots ────────────────────────────────
// Configurable via config.json: supervisor.max_agent_slots, reserve_slots, remediation_slots
// Default: 8 total, 2 reserve (for priority >= 8 / remediation), 1 dedicated remediation
const _slotConfig = (() => {
    try {
        const cfgPath = path.join(CLAUDE_REMOTE_DIR, 'config.json');
        if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            return cfg.supervisor || {};
        }
    } catch { /* use defaults */ }
    return {};
})();
const MAX_AGENT_SLOTS = _slotConfig.max_agent_slots || 8;
const RESERVE_SLOTS = _slotConfig.reserve_slots || 2;
const REMEDIATION_SLOTS = _slotConfig.remediation_slots || 1;
const NORMAL_CAPACITY = MAX_AGENT_SLOTS - RESERVE_SLOTS;

interface RunningSlot {
    taskId: string;
    abort: AbortController;
    isRemediation: boolean;
}

const runningSlots: Map<string, RunningSlot> = new Map(); // taskId → slot

const pendingApprovals = new Map<string, {
    taskId: string;
    toolName: string;
    input: any;
    resolve: (decision: { behavior: 'allow' } | { behavior: 'deny'; message: string }) => void;
    reject: (err: Error) => void;
    timestamp: string;
}>();

// Track last child goal that executed a task (round-robin fairness for research swarm)
const lastExecutedChildGoal = new Map<string, string>();

// ── Forward-reference setters ────────────────────────────────

let broadcastFn: BroadcastFn | null = null;
let orchestrator: OrchestratorModule | null = null;
let advancePipeline: AdvancePipelineFn | null = null;

export function setBroadcastFn(fn: BroadcastFn): void {
    broadcastFn = fn;
}

export function setOrchestrator(mod: OrchestratorModule): void {
    orchestrator = mod;
}

export function setAdvancePipelineFn(fn: AdvancePipelineFn): void {
    advancePipeline = fn;
}

// ── Internal broadcast helpers ───────────────────────────────

function broadcastTaskUpdate(task: any): void {
    if (!broadcastFn) return;
    broadcastFn({ type: 'task_update', task });
}

function broadcastGoalUpdate(goalId: string): void {
    if (!broadcastFn) return;

    const goal = goalStmts.get.get(goalId);
    if (!goal) return;

    const tasks = taskStmts.getByGoal.all(goalId);
    broadcastFn({ type: 'goal_update', goal, tasks });
}

function broadcastApprovalRequest(approval: {
    approvalId: string;
    taskId: string;
    toolName: string;
    input: any;
    timestamp: string;
}): void {
    if (!broadcastFn) return;
    broadcastFn({ type: 'approval_request', ...approval });
}

function broadcastApprovalResolved(approvalId: string, decision: string): void {
    if (!broadcastFn) return;
    broadcastFn({ type: 'approval_resolved', approvalId, decision });
}

function broadcastTaskProgress(taskId: string, sdkMessage: any): void {
    if (!broadcastFn) return;

    // Extract the useful bits from the SDK message
    let progress: Record<string, any> = { taskId, messageType: sdkMessage.type };

    if (sdkMessage.type === 'assistant') {
        // Full assistant message — extract text content
        const textBlocks = (sdkMessage.message?.content || [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text);
        progress.text = textBlocks.join('\n');
        progress.role = 'assistant';
    } else if (sdkMessage.type === 'tool_use_summary') {
        progress.tool = sdkMessage.tool_name;
        progress.input = sdkMessage.tool_input_summary;
    } else if (sdkMessage.type === 'result') {
        progress.subtype = sdkMessage.subtype;
        progress.result = sdkMessage.result;
        progress.cost_usd = sdkMessage.total_cost_usd;
        progress.duration_ms = sdkMessage.duration_ms;
        progress.num_turns = sdkMessage.num_turns;
    } else if (sdkMessage.type === 'system') {
        progress.subtype = sdkMessage.subtype;
    }

    broadcastFn({ type: 'task_progress', ...progress });
}

// ── Utility ──────────────────────────────────────────────────

/**
 * Generate a unique ID for goals/tasks
 */
export function generateId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Load config from ~/.claude-remote/config.json
 */
export function loadConfig(): any {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.claude-remote', 'config.json'), 'utf8'));
    } catch { return {}; }
}

/**
 * Send digest summary as a push notification via ntfy.sh
 */
export function sendDigestPush(summary: string): void {
    const config = loadConfig();
    if (!config.ntfy_topic) return;
    try {
        execFileSync('curl', ['-s', '-d', summary, '-H', 'Title: Claude Remote Daily Digest', '-H', 'Priority: default', '-H', 'Tags: clipboard', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
    } catch {}
}

// ── DocAssist: documentation task description ───────────────────

/**
 * Build the description for the mandatory documentation task appended to every goal.
 * See docs/docassist.md section 3.1 for the full protocol.
 */
function buildDocTaskDescription(goalDescription: string, taskTitles: string[]): string {
    const taskList = taskTitles.map(t => `- ${t}`).join('\n');
    return `Update project documentation to reflect the work completed in this goal.

## Goal That Was Completed
${goalDescription}

## Tasks That Were Completed
${taskList}

## Files to Review and Update

1. **claude-context/CURRENT_STATUS.md**
   - Update "Current Stage" to reflect new progress
   - Add entries to "Recent Changes" with today's date
   - Update "What's Working" with newly functional features
   - Move completed items in "Next Actions" to done
   - Add new next actions discovered during implementation
   - Update "Known Issues" if any were found or resolved

2. **claude-context/ARCHITECTURE.md**
   - Update system diagrams if components were added or changed
   - Update directory structure if new files/directories were created
   - Update API endpoints if routes were added or modified
   - Update data models if types/interfaces changed
   - Document new patterns introduced during implementation

3. **claude-context/DECISIONS.md**
   - Add DEC-XXX entries for every significant choice made during this goal
   - Include: Context, Options Considered (with pros/cons), Decision, Consequences
   - Significant choices include: library selections, architectural patterns,
     API design choices, data model decisions, trade-offs made

4. **claude-context/session-notes/YYYY-MM-DD-autonomous-[topic].md**
   - Create a session note summarising the goal's work
   - Include: Summary, What Was Built, Key Decisions, Code Changes, Next Steps
   - Author should be "Claude (autonomous)" to distinguish from human sessions

5. **CLAUDE.md**
   - Update "Quick Context" if stage or stack changed
   - Update "Key Commands" if new scripts were added
   - Update "Project Structure" if directory layout changed

Read the existing content of each file before updating. Preserve existing style and
conventions. Use British English throughout. Do not remove existing content unless it
is factually incorrect — append and update instead.`;
}

// ── Planning concurrency control ─────────────────────────────

/**
 * Enqueue a planning function to run with concurrency control.
 * Prevents spawning too many Agent SDK sessions at once (e.g., 12 maintenance goals on startup).
 */
export function enqueuePlanning(fn: () => Promise<any>): Promise<any> {
    return new Promise((resolve, reject) => {
        planningQueue.push({ fn, resolve, reject });
        drainPlanningQueue();
    });
}

function drainPlanningQueue(): void {
    while (activePlanningCount < PLANNING_CONCURRENCY && planningQueue.length > 0) {
        const { fn, resolve, reject } = planningQueue.shift()!;
        activePlanningCount++;
        fn().then(resolve, reject).finally(() => {
            activePlanningCount--;
            drainPlanningQueue();
        });
    }
    if (planningQueue.length > 0) {
        console.log(`[Planner] ${activePlanningCount}/${PLANNING_CONCURRENCY} active, ${planningQueue.length} queued`);
    }
}

// ── Planning ─────────────────────────────────────────────────

/**
 * Plan goal decomposition using Agent SDK with Claude.
 * The planner explores the project with read-only tools and returns a structured plan.
 *
 * @param description - The goal description
 * @param projectPath - Absolute path to the project
 * @param options - Planning options
 * @param options.model - Planning model (default: 'opus')
 * @param options.maxTurns - Max planning turns (default: 30)
 * @param options.onMessage - Callback for SDK messages (for logging/progress)
 * @returns Structured plan with subtasks, reasoning, cost, and timing
 */
export async function planGoal(description: string, projectPath: string, options: {
    model?: string;
    maxTurns?: number;
    onMessage?: (msg: any) => void;
} = {}): Promise<{
    subtasks: Array<{
        title: string;
        description: string;
        priority: number;
        model: string;
        estimated_turns?: number;
        category: string;
        depends_on: string[];
    }>;
    reasoning: string;
    cost_usd: number;
    usage: Record<string, any>;
    duration_ms: number;
}> {
    const model = options.model || process.env.PLANNING_MODEL || 'opus';
    const maxTurns = options.maxTurns || 200;
    const onMessage = options.onMessage || (() => {});

    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const planSchema = {
        type: 'object',
        properties: {
            subtasks: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Brief task title (max 80 chars)' },
                        description: { type: 'string', description: 'Detailed task description with acceptance criteria and files to modify' },
                        priority: { type: 'integer', minimum: 1, maximum: 10, description: 'Priority (1-10, higher = more urgent)' },
                        model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'Best model for the task. Default to opus for anything involving reasoning, multi-file changes, debugging, or architecture. Use sonnet for straightforward single-file changes. Use haiku only for trivial tasks like creating config files or running a single command.' },
                        estimated_turns: { type: 'integer', minimum: 1, maximum: 200, description: 'Estimated agent turns needed' },
                        category: { type: 'string', enum: ['architecture', 'feature', 'bugfix', 'refactor', 'docs', 'test', 'config', 'other'], description: 'Task category — classify what kind of work this subtask performs' },
                        depends_on: { type: 'array', items: { type: 'string' }, description: 'Task titles this depends on (empty if independent)' }
                    },
                    required: ['title', 'description', 'priority', 'model', 'category', 'depends_on']
                }
            },
            reasoning: { type: 'string', description: 'Brief explanation of the decomposition strategy' }
        },
        required: ['subtasks', 'reasoning']
    };

    const planningPrompt = `## Goal\n\n${description}\n\n## Instructions\n\nYou are a planning agent. Your job is to explore this project and create a detailed execution plan.\n\n1. **Explore the project** — Read CLAUDE.md, relevant source files, check the git log, understand the project structure and current state. Use the Read, Glob, Grep, and Bash (read-only commands only) tools.\n\n2. **Analyse the goal** — Understand what needs to change, which files are involved, what dependencies exist.\n\n3. **Create subtasks** — Break the goal into concrete, ordered subtasks. Each subtask should be:\n   - Self-contained and executable by a coding agent\n   - Specific enough that a developer could implement it\n   - Include the exact files to modify and expected changes\n   - Include acceptance criteria\n\n4. **Assign models** — Choose the cheapest model that can handle each task:\n   - haiku: single-file changes, docs, config, simple fixes\n   - sonnet: multi-file features, moderate refactoring, API changes\n   - opus: only for complex architecture changes requiring deep reasoning\n\n4b. **Classify each subtask** — Assign a category that describes the type of work:\n   - architecture: system design or structural changes\n   - feature: new capability or feature addition\n   - bugfix: fixing broken behaviour or errors\n   - refactor: restructuring existing code without changing behaviour\n   - docs: documentation or comments\n   - test: testing, test coverage, or test infrastructure\n   - config: configuration files, tooling, or build setup\n   - other: anything that doesn't fit the above\n\n5. **Set dependencies** — If task B needs task A's output, put A's title in B's depends_on array.\n\n6. **Order by priority** — Higher priority = done first (10 = most urgent).\n\n**IMPORTANT**: Do NOT execute any changes. Read-only exploration only.\n**IMPORTANT**: Do NOT use write/edit tools. Only explore and plan.\n\nProject path: ${projectPath}`;

    const planningContext = `\n## Planning Agent Role\n\nYou are an autonomous planning agent in Darron's development ecosystem.\n- **Author:** Darron — Mackay, Queensland, Australia (UTC+10)\n- **Convention:** British English spelling\n- **Mode:** Planning only — explore the project and output a structured plan\n- **Tools:** Read, Glob, Grep, Bash (read-only commands like ls, git log, git diff)\n- Do NOT modify any files\n- Do NOT create commits\n- Do NOT use plan mode (EnterPlanMode) — explore with tools directly\n\nYour final response MUST be valid JSON matching the required schema.`;

    const q = agentQuery({
        prompt: planningPrompt,
        options: {
            model,
            maxTurns,
            cwd: projectPath,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            canUseTool: async (toolName: string, input: any) => {
                const blocked = checkProtectedFiles(toolName, input);
                return blocked || { behavior: 'allow' as const };
            },
            tools: ['Read', 'Glob', 'Grep', 'Bash'],
            systemPrompt: {
                type: 'preset',
                preset: 'claude_code',
                append: planningContext
            },
            outputFormat: {
                type: 'json_schema',
                schema: planSchema
            }
        }
    });

    let result: any = null;
    for await (const message of q) {
        onMessage(message);
        if (message.type === 'result') {
            result = message;
        }
    }

    if (!result) {
        throw new Error('Planning session produced no result');
    }

    if (result.subtype !== 'success') {
        const errors = result.errors || [];
        throw new Error(`Planning failed: ${result.subtype} — ${errors.join(', ') || 'unknown error'}`);
    }

    // structured_output contains parsed JSON matching planSchema
    let plan = result.structured_output;
    if (!plan || !plan.subtasks) {
        // Fallback: try parsing result text as JSON
        try {
            plan = JSON.parse(result.result);
        } catch {
            throw new Error('Planning session produced no structured output');
        }
    }

    return {
        subtasks: plan.subtasks || [],
        reasoning: plan.reasoning || '',
        cost_usd: result.total_cost_usd || 0,
        usage: result.usage || {},
        duration_ms: result.duration_ms || 0
    };
}

// ── Goal management ──────────────────────────────────────────

/**
 * Create a goal programmatically (used by API and maintenance scheduler).
 * Returns goalId. Decomposition runs asynchronously.
 */
export function createGoal(
    description: string,
    projectPath: string,
    autoExecute: boolean = true,
    parentGoalId: string | null = null,
    goalType: string = 'standalone',
    planningModel: string | null = null
): string {
    const goalId = generateId();
    const now = new Date().toISOString();
    const effectiveModel = planningModel || process.env.PLANNING_MODEL || 'opus';

    goalStmts.insert.run(
        goalId,
        description,
        projectPath,
        goalType === 'parent' ? 'active' : 'decomposing',
        now,
        'agent_sdk',
        effectiveModel,
        parentGoalId,
        goalType
    );

    broadcastGoalUpdate(goalId);

    // Parent goals don't decompose — they track children instead
    if (goalType === 'parent') {
        console.log(`[Goal ${goalId}] Parent goal created: ${description.slice(0, 80)}...`);
        return goalId;
    }

    // Plan with Agent SDK (replaces old LLM decomposition)
    (async () => {
        try {
            console.log(`[Goal ${goalId}] Planning with ${effectiveModel}: ${description}`);

            // Create planning log
            const planLogDir = path.join(projectPath, '_logs');
            try { if (!fs.existsSync(planLogDir)) fs.mkdirSync(planLogDir, { recursive: true }); } catch {}
            const planTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const planLogFile = path.join(planLogDir, `planning_${planTimestamp}_${goalId.slice(0, 8)}.md`);

            const planLogHeader = [
                `# Planning Session: ${description.slice(0, 80)}`,
                ``,
                `- **Goal ID**: ${goalId}`,
                `- **Project**: ${path.basename(projectPath)} (${projectPath})`,
                `- **Model**: ${effectiveModel}`,
                `- **Started**: ${new Date().toISOString()}`,
                ``,
                `---`,
                ``
            ].join('\n');
            try { fs.writeFileSync(planLogFile, planLogHeader); } catch {}

            // Run Agent SDK planning session (concurrency-limited)
            const planResult = await enqueuePlanning(() => planGoal(description, projectPath, {
                model: effectiveModel,
                maxTurns: 200,
                onMessage: (msg: any) => {
                    // Log planning messages to file
                    try {
                        let entry = '';
                        const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
                        if (msg.type === 'assistant') {
                            const texts = (msg.message?.content || [])
                                .filter((b: any) => b.type === 'text').map((b: any) => b.text);
                            const tools = (msg.message?.content || [])
                                .filter((b: any) => b.type === 'tool_use');
                            if (texts.length) entry += `## Planner <sub>${t}</sub>\n\n${texts.join('\n')}\n\n`;
                            for (const tool of tools) {
                                entry += `### Tool: ${tool.name} <sub>${t}</sub>\n\n`;
                                entry += '```json\n' + JSON.stringify(tool.input, null, 2).slice(0, 2000) + '\n```\n\n';
                            }
                        } else if (msg.type === 'result') {
                            entry += `## Result <sub>${t}</sub>\n\nCost: $${(msg.total_cost_usd || 0).toFixed(4)} | Turns: ${msg.num_turns || 0}\n\n`;
                        }
                        if (entry) fs.appendFileSync(planLogFile, entry);
                    } catch {}

                    // Broadcast planning progress via WebSocket
                    if (broadcastFn) {
                        broadcastFn({
                            type: 'goal_planning_progress',
                            goalId,
                            messageType: msg.type
                        });
                    }
                }
            }));

            const subtasks = planResult.subtasks || [];
            const titleToId: Record<string, string> = {};

            for (const subtask of subtasks) {
                const taskId = generateId();
                titleToId[subtask.title] = taskId;

                const dependsOnIds = (subtask.depends_on || [])
                    .map((title: string) => titleToId[title])
                    .filter(Boolean);
                const dependsOnJson = dependsOnIds.length > 0 ? JSON.stringify(dependsOnIds) : null;

                // Default to opus unless planner specifically chose a lighter model
                let finalModel = subtask.model || 'opus';
                if (orchestrator) {
                    const recommendation = orchestrator.recommendModel(db, projectPath, subtask.category || 'unknown');
                    console.log(`[Goal ${goalId}] Model recommendation for "${subtask.title}" [${subtask.category || 'unknown'}]: ${recommendation.model || 'none'} (${recommendation.confidence}, ${recommendation.reason})`);
                    if (recommendation.model && recommendation.confidence !== 'none') {
                        const costRank: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3 };
                        const recRank = costRank[recommendation.model] || 99;
                        const curRank = costRank[finalModel] || 99;

                        // Allow downgrades always; allow upgrades only with high confidence
                        if (recRank <= curRank || recommendation.confidence === 'high') {
                            console.log(`[Goal ${goalId}] Memory override: ${finalModel} → ${recommendation.model} for "${subtask.title}" (${recommendation.reason})`);
                            finalModel = recommendation.model;
                        }
                    }
                }

                // Log if model was adjusted from planner's suggestion
                if (finalModel !== subtask.model && subtask.model) {
                    console.log(`[Goal ${goalId}] Model adjusted: planner suggested ${subtask.model}, using ${finalModel} for "${subtask.title}" [${subtask.category || 'unknown'}]`);
                }

                const maxTurns = Math.max((subtask.estimated_turns || 100) * 3, 1000);

                taskStmts.insertWithGoal.run(
                    taskId,
                    subtask.title,
                    subtask.description,
                    projectPath,
                    subtask.priority || 5,
                    finalModel,
                    maxTurns,
                    'bypass',
                    null,
                    now,
                    goalId,
                    subtask.category || null,
                    dependsOnJson,
                    1
                );

                broadcastTaskUpdate(taskStmts.get.get(taskId));
            }

            // DocAssist: append mandatory documentation task (depends on all other tasks)
            const allTaskIds = subtasks.map((s: any) => titleToId[s.title]).filter(Boolean);
            if (allTaskIds.length > 0) {
                const docTaskId = generateId();
                const docDescription = buildDocTaskDescription(description, subtasks.map((s: any) => s.title));

                taskStmts.insertWithGoal.run(
                    docTaskId,
                    `docs: Update project documentation for goal`,
                    docDescription,
                    projectPath,
                    1,           // lowest priority (runs last via depends_on)
                    'sonnet',    // documentation doesn't need opus
                    100,         // max turns
                    'bypass',
                    null,
                    now,
                    goalId,
                    null,
                    JSON.stringify(allTaskIds),  // depends on ALL other tasks
                    1
                );

                broadcastTaskUpdate(taskStmts.get.get(docTaskId));
                console.log(`[Goal ${goalId}] DocAssist: appended documentation task ${docTaskId}`);
            }

            const decomposition = {
                subtasks: planResult.subtasks,
                reasoning: planResult.reasoning,
                planner: effectiveModel,
                method: 'agent_sdk',
                cost_usd: planResult.cost_usd,
                duration_ms: planResult.duration_ms
            };

            goalStmts.updateDecomposition.run(
                JSON.stringify(decomposition),
                subtasks.length + 1,  // +1 for the documentation task
                autoExecute ? 'active' : 'pending',
                goalId
            );

            // Store planning cost and log file
            goalStmts.updatePlanningCost.run(
                planResult.cost_usd || 0,
                planLogFile,
                effectiveModel,
                goalId
            );

            console.log(`[Goal ${goalId}] Planned ${subtasks.length} tasks ($${(planResult.cost_usd || 0).toFixed(4)}, ${planResult.duration_ms}ms)`);

            if (broadcastFn) {
                const goal = goalStmts.get.get(goalId);
                const tasks = taskStmts.getByGoal.all(goalId);
                broadcastFn({ type: 'goal_decomposed', goal, tasks });
            }
        } catch (err: any) {
            console.error(`[Goal ${goalId}] Planning failed:`, err.message);
            goalStmts.updateStatus.run('failed', goalId);
            broadcastGoalUpdate(goalId);
        }
    })();

    return goalId;
}

// ── Goal progress ────────────────────────────────────────────

/**
 * Update goal progress based on its tasks
 */
export function updateGoalProgress(goalId: string): void {
    if (!goalId) return;

    const goal = goalStmts.get.get(goalId) as any;
    if (!goal) return;

    // Parent goals are updated via updateParentGoalProgress(), not here
    if (goal.goal_type === 'parent') return;

    const tasks = taskStmts.getByGoal.all(goalId) as any[];
    const completed = tasks.filter(t => t.status === 'done').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const totalCost = tasks.reduce((sum: number, t: any) => sum + (t.cost_usd || 0), 0);
    const allDone = tasks.every(t => ['done', 'cancelled', 'failed'].includes(t.status));
    const anyFailed = tasks.some(t => t.status === 'failed');
    const anyDone = tasks.some(t => t.status === 'done');

    const status = allDone
      ? (anyFailed ? 'failed' : (anyDone ? 'done' : 'cancelled'))
      : 'active';
    const completedAt = allDone ? new Date().toISOString() : null;

    goalStmts.updateProgress.run(completed, failed, totalCost, status, completedAt, goalId);

    // Generate summary when goal reaches terminal state
    if (allDone && completedAt) {
        try { generateGoalSummary(goalId); }
        catch (err: any) { console.error(`[Goal] Summary generation failed for ${goalId}:`, err.message); }

        // Child goal completed: extract knowledge, then check parent
        if (goal.goal_type === 'child' && goal.parent_goal_id) {
            try { extractChildGoalKnowledge(goalId, goal.parent_goal_id); }
            catch (err: any) { console.error(`[Knowledge] Extraction failed for child ${goalId}:`, err.message); }
            updateParentGoalProgress(goal.parent_goal_id);
        }

        // Standalone goal: check if it belongs to a product pipeline phase
        if (goal.goal_type === 'standalone' || !goal.goal_type) {
            try {
                const phase = db.prepare('SELECT * FROM product_phases WHERE goal_id = ?').get(goalId) as any;
                if (phase && phase.product_id) {
                    const updatedGoal = goalStmts.get.get(goalId) as any;
                    if (advancePipeline) {
                        advancePipeline(phase.product_id, phase.phase, {
                            cost_usd: totalCost,
                            result_summary: updatedGoal ? updatedGoal.summary : null,
                            description: updatedGoal ? updatedGoal.description : null,
                            artifacts: [],
                        });
                    }
                }
            } catch (err: any) {
                console.error(`[Pipeline] Failed to check pipeline advancement for goal ${goalId}:`, err.message);
            }
        }
    }

    // Broadcast goal update
    broadcastGoalUpdate(goalId);
}

/**
 * Update parent goal progress based on child goal completion.
 * When all children complete, synthesise findings and trigger pipeline advancement.
 */
function updateParentGoalProgress(parentGoalId: string): void {
    const children = goalStmts.getChildren.all(parentGoalId) as any[];
    if (children.length === 0) return;

    const completed = children.filter((c: any) => c.status === 'done').length;
    const failed = children.filter((c: any) => c.status === 'failed').length;
    const totalCost = children.reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0);
    const allDone = children.every((c: any) => ['done', 'failed', 'cancelled'].includes(c.status));
    const anyFailed = children.some((c: any) => c.status === 'failed');
    const anyComplete = children.some((c: any) => c.status === 'done');

    const status = allDone
      ? (anyFailed ? 'failed' : (anyComplete ? 'done' : 'cancelled'))
      : 'active';
    const completedAt = allDone ? new Date().toISOString() : null;

    goalStmts.updateProgress.run(completed, failed, totalCost, status, completedAt, parentGoalId);
    broadcastGoalUpdate(parentGoalId);

    console.log(`[Goal] Parent ${parentGoalId} progress: ${completed}/${children.length} children complete`);

    if (allDone && completedAt) {
        // Phase-aware synthesis
        try {
            const phaseRecord = db.prepare('SELECT phase FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
            if (phaseRecord) {
                if (phaseRecord.phase === 'research') synthesizeResearchFindings(parentGoalId);
                else if (phaseRecord.phase === 'design') synthesizeDesignArtifacts(parentGoalId);
                else if (phaseRecord.phase === 'architecture') synthesizeArchitectureSpec(parentGoalId);
                else if (phaseRecord.phase === 'build') synthesizeBuildResults(parentGoalId);
                else if (phaseRecord.phase === 'test') synthesizeTestResults(parentGoalId);
                else if (phaseRecord.phase === 'document') synthesizeDocumentPackage(parentGoalId);
                else if (phaseRecord.phase === 'deploy') synthesizeDeployReport(parentGoalId);
            }
        } catch (err: any) { console.error(`[Pipeline] Synthesis failed for ${parentGoalId}:`, err.message); }

        try { generateGoalSummary(parentGoalId); }
        catch (err: any) { console.error(`[Goal] Summary failed for parent ${parentGoalId}:`, err.message); }

        // Check if parent goal belongs to a product pipeline phase
        try {
            const phase = db.prepare('SELECT * FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
            if (phase && phase.product_id) {
                const parentGoal = goalStmts.get.get(parentGoalId) as any;
                if (advancePipeline) {
                    advancePipeline(phase.product_id, phase.phase, {
                        cost_usd: totalCost,
                        result_summary: parentGoal ? parentGoal.summary : null,
                        description: parentGoal ? parentGoal.description : null,
                        artifacts: [],
                    });
                }
            }
        } catch (err: any) {
            console.error(`[Pipeline] Failed to advance pipeline for parent ${parentGoalId}:`, err.message);
        }
    }
}

/**
 * Extract knowledge entries from a completed child research goal.
 * Looks for [KNOWLEDGE] markers in task results, falls back to goal summary.
 */
function extractChildGoalKnowledge(childGoalId: string, parentGoalId: string): void {
    try {
        const childGoal = goalStmts.get.get(childGoalId) as any;
        if (!childGoal) return;

        const phaseRecord = db.prepare('SELECT product_id, phase FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phaseRecord) return;

        const productId = phaseRecord.product_id;
        const sourcePhase = phaseRecord.phase || 'unknown';
        const now = new Date().toISOString();
        let extracted = 0;

        const knowledgeStmts = {
            insert: db.prepare('INSERT INTO product_knowledge (product_id, category, title, content, source_phase, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
        };

        // Try to extract [KNOWLEDGE] markers from task results
        const tasks = taskStmts.getByGoal.all(childGoalId) as any[];
        const knowledgeRegex = /\[KNOWLEDGE\s+category="([^"]+)"\s+title="([^"]+)"\]([\s\S]*?)\[\/KNOWLEDGE\]/g;

        for (const task of tasks) {
            if (!task.result) continue;
            let match;
            while ((match = knowledgeRegex.exec(task.result)) !== null) {
                knowledgeStmts.insert.run(productId, match[1].trim(), match[2].trim(), match[3].trim(), sourcePhase, now);
                extracted++;
            }
        }

        // Also check goal summary file
        if (childGoal.summary_file && fs.existsSync(childGoal.summary_file)) {
            try {
                const content = fs.readFileSync(childGoal.summary_file, 'utf8');
                let match;
                const regex = /\[KNOWLEDGE\s+category="([^"]+)"\s+title="([^"]+)"\]([\s\S]*?)\[\/KNOWLEDGE\]/g;
                while ((match = regex.exec(content)) !== null) {
                    knowledgeStmts.insert.run(productId, match[1].trim(), match[2].trim(), match[3].trim(), sourcePhase, now);
                    extracted++;
                }
            } catch {}
        }

        // Fallback: if no markers found, store the area description + summary as a knowledge entry
        if (extracted === 0) {
            const area = childGoal.description.split(':')[0].replace(/^.*?for\s+/i, '').trim() || 'general';
            const summary = childGoal.summary || `Completed: ${childGoal.description.slice(0, 500)}`;
            knowledgeStmts.insert.run(productId, area.toLowerCase(), `${area} ${sourcePhase} findings`, summary, sourcePhase, now);
            extracted = 1;
        }

        console.log(`[Knowledge] Extracted ${extracted} entries from child goal ${childGoalId} (phase: ${sourcePhase})`);
    } catch (err: any) {
        console.error(`[Knowledge] Extraction failed for child goal ${childGoalId}:`, err.message);
    }
}

// ── Phase synthesis helpers ──────────────────────────────────

function getKnowledgeStmts() {
    return {
        insert: db.prepare('INSERT INTO product_knowledge (product_id, category, title, content, source_phase, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
        getByProduct: db.prepare('SELECT * FROM product_knowledge WHERE product_id = ? ORDER BY created_at ASC'),
    };
}

function getProductStmts() {
    return {
        get: db.prepare('SELECT * FROM products WHERE id = ?'),
    };
}

/**
 * Synthesise findings from all child research goals into a Research Brief.
 * Stores as a knowledge entry with category='research_brief'.
 */
function synthesizeResearchFindings(parentGoalId: string): void {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phase) return;

        const productId = phase.product_id;
        const product = getProductStmts().get.get(productId) as any;
        if (!product) return;

        const knStmts = getKnowledgeStmts();
        const children = goalStmts.getChildren.all(parentGoalId) as any[];
        const allKnowledge = knStmts.getByProduct.all(productId) as any[];
        const researchKnowledge = allKnowledge.filter((k: any) => k.source_phase === 'research' && k.category !== 'research_brief');

        let brief = `# Research Brief: ${product.name}\n\n`;
        brief += `**Seed Idea:** ${product.seed}\n\n`;
        brief += `**Completed:** ${new Date().toISOString().split('T')[0]}\n\n---\n\n`;

        // Group knowledge by category
        const byCategory: Record<string, any[]> = {};
        for (const k of researchKnowledge) {
            if (!byCategory[k.category]) byCategory[k.category] = [];
            byCategory[k.category].push(k);
        }

        for (const [cat, entries] of Object.entries(byCategory)) {
            brief += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`;
            for (const e of entries) {
                brief += `### ${e.title}\n\n${e.content}\n\n`;
            }
        }

        // Add child goal summaries
        brief += `## Research Goals\n\n`;
        for (const child of children) {
            brief += `- **${child.description}** — ${child.status} ($${(child.total_cost_usd || 0).toFixed(4)})\n`;
        }

        const now = new Date().toISOString();
        knStmts.insert.run(productId, 'research_brief', `Complete Research Brief — ${product.name}`, brief, 'research', now);

        console.log(`[Pipeline] Research synthesis complete for "${product.name}" — ${researchKnowledge.length} entries`);
    } catch (err: any) {
        console.error(`[Pipeline] Research synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

function synthesizeDesignArtifacts(parentGoalId: string): void {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phase) return;
        const productId = phase.product_id;
        const product = getProductStmts().get.get(productId) as any;
        if (!product) return;

        const knStmts = getKnowledgeStmts();
        const allKnowledge = knStmts.getByProduct.all(productId) as any[];
        const designKnowledge = allKnowledge.filter((k: any) => k.source_phase === 'design' && k.category !== 'design_spec');
        const totalCost = (goalStmts.getChildren.all(parentGoalId) as any[]).reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0);

        let spec = `# Design Specification: ${product.name}\n\n`;
        spec += `**Completed:** ${new Date().toISOString().split('T')[0]}\n`;
        spec += `**Cost:** $${totalCost.toFixed(4)}\n\n---\n\n`;

        for (const k of designKnowledge) {
            spec += `## ${k.title}\n\n${k.content}\n\n`;
        }

        const now = new Date().toISOString();
        knStmts.insert.run(productId, 'design_spec', `Complete Design Spec — ${product.name}`, spec, 'design', now);

        console.log(`[Pipeline] Design synthesis complete for "${product.name}" — ${designKnowledge.length} entries`);
    } catch (err: any) {
        console.error(`[Pipeline] Design synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

function synthesizeArchitectureSpec(parentGoalId: string): void {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phase) return;
        const productId = phase.product_id;
        const product = getProductStmts().get.get(productId) as any;
        if (!product) return;

        const knStmts = getKnowledgeStmts();
        const allKnowledge = knStmts.getByProduct.all(productId) as any[];
        const archKnowledge = allKnowledge.filter((k: any) => k.source_phase === 'architecture' && k.category !== 'architecture_spec');
        const totalCost = (goalStmts.getChildren.all(parentGoalId) as any[]).reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0);

        let spec = `# Architecture Specification: ${product.name}\n\n`;
        spec += `**Completed:** ${new Date().toISOString().split('T')[0]}\n`;
        spec += `**Cost:** $${totalCost.toFixed(4)}\n\n---\n\n`;

        for (const k of archKnowledge) {
            spec += `## ${k.title}\n\n${k.content}\n\n`;
        }

        const now = new Date().toISOString();
        knStmts.insert.run(productId, 'architecture_spec', `Complete Architecture Spec — ${product.name}`, spec, 'architecture', now);

        console.log(`[Pipeline] Architecture synthesis complete for "${product.name}" — ${archKnowledge.length} entries`);
    } catch (err: any) {
        console.error(`[Pipeline] Architecture synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

function synthesizeBuildResults(parentGoalId: string): void {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phase) return;
        const productId = phase.product_id;
        const product = getProductStmts().get.get(productId) as any;
        if (!product) return;

        const knStmts = getKnowledgeStmts();
        const allKnowledge = knStmts.getByProduct.all(productId) as any[];
        const buildKnowledge = allKnowledge.filter((k: any) => k.source_phase === 'build' && k.category !== 'build_report');
        const totalCost = (goalStmts.getChildren.all(parentGoalId) as any[]).reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0);

        let report = `# Build Report: ${product.name}\n\n`;
        report += `**Completed:** ${new Date().toISOString().split('T')[0]}\n`;
        report += `**Cost:** $${totalCost.toFixed(4)}\n\n---\n\n`;

        for (const k of buildKnowledge) {
            report += `## ${k.title}\n\n${k.content}\n\n`;
        }

        const now = new Date().toISOString();
        knStmts.insert.run(productId, 'build_report', `Complete Build Report — ${product.name}`, report, 'build', now);

        console.log(`[Pipeline] Build synthesis complete for "${product.name}" — ${buildKnowledge.length} entries`);
    } catch (err: any) {
        console.error(`[Pipeline] Build synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

function synthesizeTestResults(parentGoalId: string): void {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phase) return;
        const productId = phase.product_id;
        const product = getProductStmts().get.get(productId) as any;
        if (!product) return;

        const knStmts = getKnowledgeStmts();
        const allKnowledge = knStmts.getByProduct.all(productId) as any[];
        const testKnowledge = allKnowledge.filter((k: any) => k.source_phase === 'test' && k.category !== 'test_report');
        const totalCost = (goalStmts.getChildren.all(parentGoalId) as any[]).reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0);

        let report = `# Test Report: ${product.name}\n\n`;
        report += `**Completed:** ${new Date().toISOString().split('T')[0]}\n`;
        report += `**Cost:** $${totalCost.toFixed(4)}\n\n---\n\n`;

        for (const k of testKnowledge) {
            report += `## ${k.title}\n\n${k.content}\n\n`;
        }

        const now = new Date().toISOString();
        knStmts.insert.run(productId, 'test_report', `Complete Test Report — ${product.name}`, report, 'test', now);

        console.log(`[Pipeline] Test synthesis complete for "${product.name}" — ${testKnowledge.length} entries, $${totalCost.toFixed(4)}`);
    } catch (err: any) {
        console.error(`[Pipeline] Test synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

function synthesizeDocumentPackage(parentGoalId: string): void {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phase) return;
        const productId = phase.product_id;
        const product = getProductStmts().get.get(productId) as any;
        if (!product) return;

        const knStmts = getKnowledgeStmts();
        const allKnowledge = knStmts.getByProduct.all(productId) as any[];
        const docKnowledge = allKnowledge.filter((k: any) => k.source_phase === 'document' && k.category !== 'doc_package');
        const totalCost = (goalStmts.getChildren.all(parentGoalId) as any[]).reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0);

        let pkg = `# Documentation Package: ${product.name}\n\n`;
        pkg += `**Completed:** ${new Date().toISOString().split('T')[0]}\n`;
        pkg += `**Cost:** $${totalCost.toFixed(4)}\n\n---\n\n`;

        for (const k of docKnowledge) {
            pkg += `## ${k.title}\n\n${k.content}\n\n`;
        }

        const now = new Date().toISOString();
        knStmts.insert.run(productId, 'doc_package', `Complete Documentation Package — ${product.name}`, pkg, 'document', now);

        console.log(`[Pipeline] Documentation synthesis complete for "${product.name}" — ${docKnowledge.length} entries, $${totalCost.toFixed(4)}`);
    } catch (err: any) {
        console.error(`[Pipeline] Documentation synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

function synthesizeDeployReport(parentGoalId: string): void {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId) as any;
        if (!phase) return;
        const productId = phase.product_id;
        const product = getProductStmts().get.get(productId) as any;
        if (!product) return;

        const knStmts = getKnowledgeStmts();
        const allKnowledge = knStmts.getByProduct.all(productId) as any[];
        const deployKnowledge = allKnowledge.filter((k: any) => k.source_phase === 'deploy' && k.category !== 'deploy_report');
        const totalCost = (goalStmts.getChildren.all(parentGoalId) as any[]).reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0);

        let report = `# Deploy Report: ${product.name}\n\n`;
        report += `**Completed:** ${new Date().toISOString().split('T')[0]}\n`;
        report += `**Cost:** $${totalCost.toFixed(4)}\n\n---\n\n`;

        for (const k of deployKnowledge) {
            report += `## ${k.title}\n\n${k.content}\n\n`;
        }

        const now = new Date().toISOString();
        knStmts.insert.run(productId, 'deploy_report', `Complete Deploy Report — ${product.name}`, report, 'deploy', now);

        console.log(`[Pipeline] Deploy synthesis complete for "${product.name}" — ${allKnowledge.length} entries, $${totalCost.toFixed(4)}`);
    } catch (err: any) {
        console.error(`[Pipeline] Deploy synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

// ── Goal summary ─────────────────────────────────────────────

/**
 * Generate a structured summary log when a goal completes.
 * Mirrors human session log format: What Was Done, Commits, Files Changed, Cost Summary.
 */
export function generateGoalSummary(goalId: string): string | null {
    const goal = goalStmts.get.get(goalId) as any;
    if (!goal) return null;

    const tasks = taskStmts.getByGoal.all(goalId) as any[];
    if (tasks.length === 0) return null;

    // Calculate duration from earliest task start to latest task completion
    const startTimes = tasks.map(t => t.started_at).filter(Boolean).sort();
    const endTimes = tasks.map(t => t.completed_at).filter(Boolean).sort();
    const goalStart = startTimes[0] || goal.created_at;
    const goalEnd = endTimes[endTimes.length - 1] || goal.completed_at || new Date().toISOString();
    const durationMs = new Date(goalEnd).getTime() - new Date(goalStart).getTime();
    const durationMin = Math.round(durationMs / 60000);
    const durationStr = durationMin >= 60
        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
        : `${durationMin}m`;

    // Aggregate data
    const totalCost = tasks.reduce((sum: number, t: any) => sum + (t.cost_usd || 0), 0);
    const totalTokensIn = tasks.reduce((sum: number, t: any) => sum + (t.tokens_in || 0), 0);
    const totalTokensOut = tasks.reduce((sum: number, t: any) => sum + (t.tokens_out || 0), 0);
    const totalTurns = tasks.reduce((sum: number, t: any) => sum + (t.turns || 0), 0);
    const doneTasks = tasks.filter(t => t.status === 'done');
    const failedTasks = tasks.filter(t => t.status === 'failed');

    // Collect commits and files
    const commits = tasks.filter(t => t.commit_sha).map(t => ({ sha: t.commit_sha, title: t.title }));
    const allFiles = new Set<string>();
    for (const t of tasks) {
        if (t.files_changed) {
            try { JSON.parse(t.files_changed).forEach((f: string) => allFiles.add(f)); } catch {}
        }
    }

    // Build markdown summary
    const lines: string[] = [
        `# Goal Summary: ${goal.description}`,
        ``,
        `- **Goal ID**: ${goal.id}`,
        `- **Project**: ${path.basename(goal.project_path)} (${goal.project_path})`,
        `- **Status**: ${goal.status}`,
        `- **Start**: ${goalStart}`,
        `- **End**: ${goalEnd}`,
        `- **Duration**: ${durationStr}`,
        `- **Tasks**: ${doneTasks.length} completed, ${failedTasks.length} failed, ${tasks.length} total`,
        ``,
        `---`,
        ``,
        `## What Was Done`,
        ``,
    ];

    for (const t of doneTasks) {
        lines.push(`- **${t.title}** (${t.model}, $${(t.cost_usd || 0).toFixed(4)}, ${t.turns || 0} turns)`);
        if (t.result) {
            const brief = t.result.replace(/\n/g, ' ').slice(0, 200);
            lines.push(`  - ${brief}${t.result.length > 200 ? '...' : ''}`);
        }
    }

    if (failedTasks.length > 0) {
        lines.push(``, `### Failed Tasks`, ``);
        for (const t of failedTasks) {
            lines.push(`- **${t.title}** (${t.model})`);
            if (t.error) lines.push(`  - Error: ${t.error.slice(0, 200)}`);
        }
    }

    if (commits.length > 0) {
        lines.push(``, `## Commits`, ``);
        for (const c of commits) {
            lines.push(`- \`${c.sha.slice(0, 7)}\` — ${c.title}`);
        }
    }

    if (allFiles.size > 0) {
        lines.push(``, `## Files Changed`, ``);
        for (const f of [...allFiles].sort()) {
            lines.push(`- ${f}`);
        }
    }

    lines.push(
        ``, `## Cost Summary`, ``,
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Total Cost | $${totalCost.toFixed(4)} |`,
        `| Tokens In | ${totalTokensIn.toLocaleString()} |`,
        `| Tokens Out | ${totalTokensOut.toLocaleString()} |`,
        `| Total Turns | ${totalTurns} |`,
        `| Duration | ${durationStr} |`,
        ``
    );

    if (tasks.length > 1) {
        lines.push(`## Per-Task Breakdown`, ``,
            `| Task | Status | Model | Cost | Turns | Commit |`,
            `|------|--------|-------|------|-------|--------|`);
        for (const t of tasks) {
            const sha = t.commit_sha ? `\`${t.commit_sha.slice(0, 7)}\`` : '-';
            lines.push(`| ${t.title} | ${t.status} | ${t.model} | $${(t.cost_usd || 0).toFixed(4)} | ${t.turns || 0} | ${sha} |`);
        }
        lines.push(``);
    }

    lines.push(`---`, ``);

    // Write summary file
    const logDir = path.join(goal.project_path, '_logs');
    try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }); } catch {}

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeDesc = goal.description.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 50);
    const summaryFile = path.join(logDir, `goal_${timestamp}_${safeDesc}.md`);

    try {
        fs.writeFileSync(summaryFile, lines.join('\n'));
        goalStmts.updateSummaryFile.run(summaryFile, goalId);
        console.log(`[Goal] Summary written: ${summaryFile}`);
    } catch (err: any) {
        console.error(`[Goal] Failed to write summary:`, err.message);
        return null;
    }

    // Broadcast goal completion
    if (broadcastFn) {
        broadcastFn({
            type: 'goal_completed',
            goalId,
            status: goal.status,
            summary_file: summaryFile,
            total_cost: totalCost,
            duration: durationStr,
            tasks_completed: doneTasks.length,
            tasks_failed: failedTasks.length
        });
    }

    return summaryFile;
}

// ── Task outcome recording ───────────────────────────────────

/**
 * Record task outcome in project memory
 */
export function recordTaskOutcome(task: any): void {
    if (!task.completed_at) return;

    const success = task.status === 'done' ? 1 : 0;
    const durationSeconds = task.started_at && task.completed_at
        ? (new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 1000
        : null;

    try {
        memoryStmts.insert.run(
            task.project_path,
            task.complexity || 'unknown',
            task.model,
            success,
            task.cost_usd || 0,
            task.turns || 0,
            durationSeconds,
            task.error || null,
            task.completed_at
        );
    } catch (err: any) {
        console.error('[Memory] Failed to record outcome:', err.message);
    }
}

// ── Protected system paths ───────────────────────────────────

/**
 * Paths that autonomous agents must NEVER modify.
 * These are system/user config files outside project directories.
 */
const PROTECTED_PATH_PATTERNS = [
    /^\/home\/[^/]+\/\.bashrc$/,
    /^\/home\/[^/]+\/\.bash_profile$/,
    /^\/home\/[^/]+\/\.profile$/,
    /^\/home\/[^/]+\/\.zshrc$/,
    /^\/home\/[^/]+\/\.ssh\//,
    /^\/home\/[^/]+\/\.gnupg\//,
    /^\/home\/[^/]+\/\.gitconfig$/,
    /^\/home\/[^/]+\/\.npmrc$/,
    /^\/home\/[^/]+\/\.env$/,
    /^\/etc\//,
    /^\/root\//,
];

function isProtectedPath(filepath: string): boolean {
    if (!filepath) return false;
    const resolved = path.resolve(filepath);
    return PROTECTED_PATH_PATTERNS.some(p => p.test(resolved));
}

/**
 * Check if a tool call targets a protected system file.
 * Returns a deny response if so, null if allowed.
 */
function checkProtectedFiles(toolName: string, input: any): { behavior: 'deny'; message: string } | null {
    const writingTools = ['Write', 'Edit', 'NotebookEdit'];
    if (writingTools.includes(toolName)) {
        const filepath = input?.file_path || input?.notebook_path || '';
        if (isProtectedPath(filepath)) {
            return {
                behavior: 'deny' as const,
                message: `BLOCKED: Cannot modify protected system file "${filepath}". System config files (.bashrc, .profile, .ssh/, .gitconfig, /etc/) are off-limits to autonomous agents.`
            };
        }
    }

    if (toolName === 'Bash') {
        const cmd = ((input as any)?.command || '');
        // Check for redirects/pipes to protected paths
        for (const pattern of PROTECTED_PATH_PATTERNS) {
            const pathMatches = cmd.match(/(?:>|>>|tee\s+(?:-a\s+)?|cp\s+\S+\s+|mv\s+\S+\s+)(\S+)/g) || [];
            for (const match of pathMatches) {
                const target = match.replace(/^(?:>>?|tee\s+(?:-a\s+)?|cp\s+\S+\s+|mv\s+\S+\s+)/, '').trim();
                if (pattern.test(target) || pattern.test(path.resolve(target))) {
                    return {
                        behavior: 'deny' as const,
                        message: `BLOCKED: Cannot modify protected system file "${target}" via Bash. System config files are off-limits to autonomous agents.`
                    };
                }
            }
        }
    }

    return null;
}

// ── Approval gates ───────────────────────────────────────────

/**
 * Create a canUseTool callback for approval gates
 */
export async function createCanUseToolCallback(
    taskId: string,
    gateMode: string
): Promise<(toolName: string, input: any, options: any) => Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }>> {
    return async (toolName: string, input: any, options: any) => {
        // ALWAYS check protected files — regardless of gate mode
        const protectedCheck = checkProtectedFiles(toolName, input);
        if (protectedCheck) return protectedCheck;

        if (gateMode === 'bypass') {
            return { behavior: 'allow' as const };
        }

        const isDangerous = ['Bash', 'Write', 'Edit', 'NotebookEdit'].includes(toolName);
        const shouldGate = (gateMode === 'approve_all') ||
                          (gateMode === 'edits_only' && isDangerous);

        if (!shouldGate) {
            return { behavior: 'allow' as const };
        }

        // Route to phone for approval
        const approvalPromise = new Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }>((resolve, reject) => {
            const approvalId = options.toolUseID || `${taskId}-${Date.now()}`;
            pendingApprovals.set(approvalId, {
                taskId,
                toolName,
                input,
                resolve,
                reject,
                timestamp: new Date().toISOString()
            });

            // Broadcast to phone
            broadcastApprovalRequest({
                approvalId,
                taskId,
                toolName,
                input,
                timestamp: new Date().toISOString()
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                if (pendingApprovals.has(approvalId)) {
                    pendingApprovals.delete(approvalId);
                    reject(new Error('Approval timeout'));
                }
            }, 5 * 60 * 1000);
        });

        try {
            const decision = await approvalPromise;
            return decision; // { behavior: 'allow' } or { behavior: 'deny', message: '...' }
        } catch (err: any) {
            return { behavior: 'deny' as const, message: err.message };
        }
    };
}

// ── Task execution logging ───────────────────────────────────

/**
 * Create a log file for a task execution, mirroring claude-logged format.
 * Logs SDK messages (assistant text, tool uses, results) to _logs/task_*.md
 */
export function createTaskLogger(task: any): {
    file: string;
    log: (sdkMessage: any) => void;
    finish: (status: string, error?: string) => void;
} {
    const logDir = path.join(task.project_path, '_logs');
    try {
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch { /* best effort */ }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeTitle = task.title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 50);
    const logFile = path.join(logDir, `task_${timestamp}_${safeTitle}.md`);

    // Write session header (matches claude-logged format)
    const header = [
        `# Task: ${task.title}`,
        ``,
        `- **Task ID**: ${task.id}`,
        `- **Project**: ${path.basename(task.project_path)} (${task.project_path})`,
        `- **Machine**: ${os.hostname()}`,
        `- **Model**: ${task.model}`,
        `- **Max Turns**: ${task.max_turns}`,
        `- **Gate Mode**: ${task.gate_mode || 'bypass'}`,
        `- **Allowed Tools**: ${task.allowed_tools || 'all'}`,
        `- **Started**: ${new Date().toISOString()}`,
        ``,
        `---`,
        ``,
    ].join('\n');

    try {
        fs.writeFileSync(logFile, header);
    } catch { /* best effort */ }

    function ts(): string {
        return new Date().toISOString().replace('T', ' ').slice(0, 19);
    }

    return {
        file: logFile,
        log(sdkMessage: any) {
            try {
                let entry = '';
                const t = ts();

                if (sdkMessage.type === 'assistant') {
                    const textBlocks = (sdkMessage.message?.content || [])
                        .filter((b: any) => b.type === 'text')
                        .map((b: any) => b.text);
                    const toolUses = (sdkMessage.message?.content || [])
                        .filter((b: any) => b.type === 'tool_use');

                    if (textBlocks.length > 0) {
                        entry += `## Assistant <sub>${t}</sub>\n\n${textBlocks.join('\n')}\n\n`;
                    }
                    for (const tool of toolUses) {
                        entry += `### Tool Use: ${tool.name} <sub>${t}</sub>\n\n`;
                        entry += '```json\n' + JSON.stringify(tool.input, null, 2).slice(0, 2000) + '\n```\n\n';
                    }
                } else if (sdkMessage.type === 'tool_use_summary') {
                    entry += `**Tool**: ${sdkMessage.tool_name} — ${sdkMessage.tool_input_summary || ''} <sub>${t}</sub>\n\n`;
                } else if (sdkMessage.type === 'tool_result') {
                    const text = typeof sdkMessage.content === 'string'
                        ? sdkMessage.content
                        : JSON.stringify(sdkMessage.content);
                    entry += `**Result** (${sdkMessage.is_error ? 'error' : 'ok'}): ${(text || '').slice(0, 1000)} <sub>${t}</sub>\n\n`;
                } else if (sdkMessage.type === 'result') {
                    entry += `---\n\n## Result: ${sdkMessage.subtype} <sub>${t}</sub>\n\n`;
                    entry += `- **Cost**: $${(sdkMessage.total_cost_usd || 0).toFixed(4)}\n`;
                    entry += `- **Turns**: ${sdkMessage.num_turns || 0}\n`;
                    entry += `- **Duration**: ${sdkMessage.duration_ms ? (sdkMessage.duration_ms / 1000).toFixed(1) + 's' : 'unknown'}\n`;
                    entry += `- **Completed**: ${new Date().toISOString()}\n\n`;
                    if (sdkMessage.result) {
                        entry += sdkMessage.result + '\n\n';
                    }
                } else if (sdkMessage.type === 'system') {
                    entry += `*[system: ${sdkMessage.subtype || sdkMessage.type}]* <sub>${t}</sub>\n\n`;
                }

                if (entry) {
                    fs.appendFileSync(logFile, entry);
                }
            } catch { /* best effort — never block task execution */ }
        },
        finish(status: string, error?: string) {
            try {
                let footer = `---\n\n**Final Status**: ${status}\n`;
                if (error) footer += `**Error**: ${error}\n`;
                footer += `**Log Closed**: ${new Date().toISOString()}\n`;
                fs.appendFileSync(logFile, footer);
            } catch { /* best effort */ }
        }
    };
}

// ── Task scheduling ──────────────────────────────────────────

/**
 * Get next pending task with dependency-aware ordering.
 * @param remediation — if true, only return remediation tasks; if false, only normal tasks
 */
export function getNextPendingTask(remediation?: boolean): any | null {
    const pending = taskStmts.listByStatus.all('pending') as any[];
    if (pending.length === 0) return null;

    // Filter out tasks already running in another slot
    const notRunning = pending.filter(task => !runningSlots.has(task.id));

    // Filter by pipeline type
    const typed = notRunning.filter(task => {
        const isRem = !!(task.is_remediation);
        if (remediation === true) return isRem;
        if (remediation === false) return !isRem;
        return true; // no filter
    });

    // Filter out tasks with unsatisfied dependencies
    const ready = typed.filter(task => {
        if (!task.depends_on) return true;
        try {
            const depIds = JSON.parse(task.depends_on);
            if (!Array.isArray(depIds) || depIds.length === 0) return true;
            return depIds.every((id: string) => {
                const dep = taskStmts.get.get(id) as any;
                return dep && (dep.status === 'done' || dep.status === 'cancelled');
            });
        } catch { return true; }
    });

    if (ready.length === 0) return null;

    // Filter out tasks from throttled projects (Phase 2)
    const unthrottled = ready.filter(task => {
        const project = portfolioStmts.getByPath.get(task.project_path) as any;
        return !project || !project.throttled;
    });

    const candidates = unthrottled.length > 0 ? unthrottled : ready;

    // Round-robin across child goals for research swarm fairness
    try {
        const childTasks: Array<{ task: any; childGoalId: string; parentGoalId: string }> = [];
        for (const task of candidates) {
            if (!task.goal_id) continue;
            const goal = goalStmts.get.get(task.goal_id) as any;
            if (goal && goal.goal_type === 'child' && goal.parent_goal_id) {
                childTasks.push({ task, childGoalId: goal.id, parentGoalId: goal.parent_goal_id });
            }
        }

        if (childTasks.length > 0) {
            // Group by parent
            const byParent: Record<string, typeof childTasks> = {};
            for (const ct of childTasks) {
                if (!byParent[ct.parentGoalId]) byParent[ct.parentGoalId] = [];
                byParent[ct.parentGoalId].push(ct);
            }

            for (const [parentId, tasks] of Object.entries(byParent)) {
                if (tasks.length > 1) {
                    // Multiple children have ready tasks — round-robin
                    const uniqueChildren = [...new Set(tasks.map(t => t.childGoalId))];
                    if (uniqueChildren.length > 1) {
                        const lastChild = lastExecutedChildGoal.get(parentId);
                        const sorted = uniqueChildren.sort();
                        let nextIndex = 0;
                        if (lastChild) {
                            const lastIndex = sorted.indexOf(lastChild);
                            if (lastIndex >= 0) nextIndex = (lastIndex + 1) % sorted.length;
                        }
                        const chosenChildId = sorted[nextIndex];
                        lastExecutedChildGoal.set(parentId, chosenChildId);
                        const chosen = tasks.find(t => t.childGoalId === chosenChildId);
                        if (chosen) return chosen.task;
                    }
                }
            }

            // Single child or single parent — just return the first child task
            return childTasks[0].task;
        }
    } catch (err: any) {
        console.error('[Scheduler] Round-robin error:', err.message);
    }

    // Score and sort by priority engine
    const scored = candidates.map(task => {
        const project = portfolioStmts.getByPath.get(task.project_path) as any;
        return { task, score: calculatePriorityScore(task, project) };
    });
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.task || null;
}

// ── Main task scheduler loop ─────────────────────────────────

/**
 * Run the next pending task from the queue
 */
// ── Auto-retry with escalation ──────────────────────────────

const AUTO_RETRY_DELAY_MS = 30_000; // 30 seconds before retry

/**
 * Schedule an automatic retry for a failed task.
 *
 * Escalation ladder (one pass through, then defer to human):
 * 1. retry_count 0 → simple reset to pending after 30s delay
 * 2. retry_count 1 → smart retry with Sonnet diagnostic agent
 * 3. retry_count 2 → smart retry with Opus diagnostic agent
 * 4. retry_count 3+ → give up, notify human with full failure context
 */
function scheduleAutoRetry(task: any, errorMessage: string): void {
    const retryCount = task.retry_count || 0;

    if (retryCount >= 3) {
        // Exhausted all automated retries — notify human
        notifyHumanOfFailure(task, errorMessage, retryCount);
        return;
    }

    const attempt = retryCount + 1;
    const label = attempt === 1 ? 'simple reset'
        : attempt === 2 ? 'Sonnet diagnostic'
        : 'Opus diagnostic';

    console.log(`[AutoRetry] ${task.title} — scheduling ${label} in ${AUTO_RETRY_DELAY_MS / 1000}s (attempt ${attempt}/3)`);

    setTimeout(() => {
        try {
            const current = taskStmts.get.get(task.id) as any;
            if (!current || current.status !== 'failed') return; // Already retried or cancelled

            if (attempt === 1) {
                // Step 1: simple reset
                db.prepare('UPDATE tasks SET status = ?, started_at = NULL, completed_at = NULL, error = NULL, retry_count = ? WHERE id = ?')
                    .run('pending', attempt, task.id);
                console.log(`[AutoRetry] ${task.title} — reset to pending (attempt ${attempt})`);
                broadcastTaskUpdate(taskStmts.get.get(task.id));
            } else {
                // Steps 2-3: smart retry with escalating model
                const model = attempt === 2 ? 'sonnet' : 'opus';
                spawnDiagnosticTask(current, task, errorMessage, attempt, model);
            }
        } catch (err: any) {
            console.error(`[AutoRetry] ${label} failed:`, err.message);
        }
    }, AUTO_RETRY_DELAY_MS);
}

/**
 * Create a diagnostic agent task to inspect and fix the failure,
 * then block the original task on it via depends_on.
 */
function spawnDiagnosticTask(
    current: any, originalTask: any, errorMessage: string,
    attempt: number, model: 'sonnet' | 'opus'
): void {
    // Read failure log for diagnostic context
    let logTail = 'No log file available';
    if (current.log_file) {
        try {
            const logContent = fs.readFileSync(current.log_file, 'utf8');
            logTail = logContent.length > 3000 ? '...\n' + logContent.slice(-3000) : logContent;
        } catch {}
    }

    const diagId = generateId();
    const now = new Date().toISOString();
    const modelLabel = model.charAt(0).toUpperCase() + model.slice(1);
    const diagTitle = `[${modelLabel}] Diagnose and fix: ${originalTask.title}`;
    const diagDescription = `A task has failed ${attempt} time(s) and needs diagnosis before retry.

## Failed Task
**Title:** ${originalTask.title}
**Description:** ${originalTask.description}
**Error:** ${errorMessage || 'unknown'}
**Retry attempt:** ${attempt}/3

## Failure Log (tail)
\`\`\`
${logTail}
\`\`\`

## Instructions
1. Read the failure log above to understand what went wrong
2. Inspect the project state — check relevant files, configs, dependencies
3. Take corrective action: fix broken files, install missing deps, resolve config issues
4. Verify your fix by running the relevant commands (build, lint, test, etc.)
5. Do NOT attempt to complete the original task — only fix the blocker

**Constraint:** Only fix what caused the failure. Do not refactor, add features, or make unrelated changes.`;

    taskStmts.insert.run(diagId, diagTitle, diagDescription, originalTask.project_path,
        (originalTask.priority || 0) + 1, model, 50, 'bypass', null, now, null);

    // Mark as remediation task so it runs in the dedicated remediation pipeline
    db.prepare('UPDATE tasks SET is_remediation = 1 WHERE id = ?').run(diagId);

    // If the original task belongs to a goal, link the diagnostic too
    if (originalTask.goal_id) {
        db.prepare('UPDATE tasks SET goal_id = ? WHERE id = ?').run(originalTask.goal_id, diagId);
    }

    // Reset original task to pending, blocked on the diagnostic
    let existingDeps: string[] = [];
    try { existingDeps = current.depends_on ? JSON.parse(current.depends_on) : []; } catch {}
    existingDeps.push(diagId);

    db.prepare('UPDATE tasks SET status = ?, started_at = NULL, completed_at = NULL, error = NULL, retry_count = ?, depends_on = ? WHERE id = ?')
        .run('pending', attempt, JSON.stringify(existingDeps), originalTask.id);

    console.log(`[AutoRetry] ${originalTask.title} — ${modelLabel} diagnostic task ${diagId} created, original blocked until fix completes`);
    broadcastTaskUpdate(taskStmts.get.get(diagId));
    broadcastTaskUpdate(taskStmts.get.get(originalTask.id));

    // Update goal progress to reflect new task
    if (originalTask.goal_id) {
        updateGoalProgress(originalTask.goal_id);
    }
}

/**
 * All automated retries exhausted — notify the human via WebSocket
 * and ntfy push notification with a summary of what failed and why.
 */
function notifyHumanOfFailure(task: any, errorMessage: string, retryCount: number): void {
    console.log(`[AutoRetry] ${task.title} — all ${retryCount} retries exhausted, deferring to human`);

    // Read failure log for context
    let logTail = '';
    if (task.log_file) {
        try {
            const logContent = fs.readFileSync(task.log_file, 'utf8');
            logTail = logContent.length > 1500 ? '...\n' + logContent.slice(-1500) : logContent;
        } catch {}
    }

    const summary = [
        `Task "${task.title}" has failed ${retryCount} times and exhausted all automated retries.`,
        ``,
        `Error: ${errorMessage || 'unknown'}`,
        logTail ? `\nLast log output:\n${logTail}` : '',
        ``,
        `The task tried: simple reset → Sonnet diagnostic → Opus diagnostic.`,
        `Human intervention is needed. Consider opening an interactive Opus session`,
        `to investigate the root cause and find a fix or acceptable workaround.`,
    ].join('\n');

    // Broadcast to connected UI clients
    broadcastFn?.({ type: 'human_escalation', taskId: task.id, title: task.title, summary });

    // Push notification via ntfy
    try {
        const config = loadConfig();
        if (config.ntfy_topic) {
            const shortMsg = `Task "${task.title}" failed ${retryCount}x — needs human intervention. ${errorMessage || ''}`.slice(0, 500);
            execFileSync('curl', [
                '-s', '-d', shortMsg,
                '-H', 'Title: Task Needs Human Help',
                '-H', 'Priority: high',
                '-H', 'Tags: warning,rotating_light',
                `https://ntfy.sh/${config.ntfy_topic}`
            ], { timeout: 10000, stdio: 'ignore' });
        }
    } catch {}
}

/**
 * Detect and recover "ghost" tasks — tasks marked as 'running' in the database
 * but not actually executing (not present in runningSlots).
 *
 * This can happen if:
 * - The agent process crashes mid-task
 * - The server restarts while tasks are running
 * - An abort operation fails to clean up database state
 *
 * Runs periodically (every 5 minutes) to detect stale tasks and reset them
 * for retry via the escalating retry ladder.
 *
 * @returns Number of ghost tasks recovered
 */
export function detectAndRecoverGhostTasks(): number {
    const GHOST_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
    const LONG_RUNNING_WARNING_MS = 2 * 60 * 60 * 1000; // 2 hours
    const now = Date.now();
    let recoveredCount = 0;

    // Get all tasks marked as 'running' in the database
    const runningTasks = taskStmts.listByStatus.all('running') as any[];

    for (const task of runningTasks) {
        const isInMemory = runningSlots.has(task.id);
        const startedAt = task.started_at ? new Date(task.started_at).getTime() : 0;
        const runningDuration = now - startedAt;

        // Check for legitimately running tasks that have been running too long
        if (isInMemory && runningDuration > LONG_RUNNING_WARNING_MS) {
            console.log(`[GhostDetect] Warning: Task ${task.id} (${task.title}) has been running for ${Math.round(runningDuration / 60000)} minutes — may be stuck but still in runningSlots`);
            continue;
        }

        // Skip if task is legitimately running (in memory)
        if (isInMemory) {
            continue;
        }

        // Task is NOT in runningSlots but marked as 'running' in DB
        // Check if it's been long enough to consider it a ghost
        if (runningDuration < GHOST_THRESHOLD_MS) {
            // Too recent — might be in the process of starting, give it more time
            continue;
        }

        // This is a ghost task — recover it
        console.log(`[GhostDetect] Found ghost task: ${task.id} (${task.title}) — running for ${Math.round(runningDuration / 60000)} min but not in runningSlots`);

        const currentRetryCount = task.retry_count || 0;
        const newRetryCount = currentRetryCount + 1;

        if (newRetryCount > 3) {
            // Max retries exhausted — mark as failed
            const errorMsg = `Ghost task detected: marked as running for ${Math.round(runningDuration / 60000)} minutes but no active agent process. Retry limit (3) exhausted.`;

            db.prepare('UPDATE tasks SET status = ?, completed_at = ?, error = ? WHERE id = ?')
                .run('failed', new Date().toISOString(), errorMsg, task.id);

            console.log(`[GhostDetect] ${task.title} — max retries exhausted, marking as failed`);

            // Notify human of failure
            notifyHumanOfFailure(task, errorMsg, currentRetryCount);

            broadcastTaskUpdate(taskStmts.get.get(task.id));
        } else {
            // Reset to pending for retry
            db.prepare('UPDATE tasks SET status = ?, started_at = NULL, completed_at = NULL, error = NULL, retry_count = ? WHERE id = ?')
                .run('pending', newRetryCount, task.id);

            console.log(`[GhostDetect] ${task.title} — reset to pending (retry ${newRetryCount}/3) after ghost detection`);

            broadcastTaskUpdate(taskStmts.get.get(task.id));
        }

        recoveredCount++;
    }

    if (recoveredCount > 0) {
        console.log(`[GhostDetect] Recovered ${recoveredCount} ghost task(s)`);
    }

    return recoveredCount;
}

/**
 * Main scheduler entry point — called on interval.
 * 3-tier slot filling: remediation → normal capacity → reserve (high-priority only).
 */
export async function runNextTask(): Promise<void> {
    const totalRunning = runningSlots.size;
    const remediationRunning = [...runningSlots.values()].filter(s => s.isRemediation).length;
    const normalRunning = totalRunning - remediationRunning;

    // 1. Fill dedicated remediation slots
    if (remediationRunning < REMEDIATION_SLOTS) {
        const remTask = getNextPendingTask(true);
        if (remTask) {
            executeTask(remTask, true); // fire-and-forget
        }
    }

    // 2. Fill normal capacity slots (up to NORMAL_CAPACITY)
    const normalAvailable = NORMAL_CAPACITY - normalRunning;
    for (let i = 0; i < normalAvailable; i++) {
        const task = getNextPendingTask(false);
        if (!task) break;
        executeTask(task, false); // fire-and-forget
    }

    // 3. Dip into reserve for high-priority tasks (priority >= 8)
    const currentTotal = runningSlots.size;
    if (currentTotal < MAX_AGENT_SLOTS) {
        const reserveAvailable = MAX_AGENT_SLOTS - currentTotal;
        for (let i = 0; i < reserveAvailable; i++) {
            const task = getNextHighPriorityTask();
            if (!task) break;
            executeTask(task, false); // fire-and-forget
        }
    }
}

/**
 * Get the next pending non-remediation task with priority >= 8.
 * Only these tasks justify dipping into reserve capacity.
 */
function getNextHighPriorityTask(): any | null {
    const pending = taskStmts.listByStatus.all('pending') as any[];
    if (pending.length === 0) return null;

    const candidates = pending.filter(task => {
        if (runningSlots.has(task.id)) return false;
        if (task.is_remediation) return false;
        if ((task.priority || 5) < 8) return false;
        // Check dependencies
        if (!task.depends_on) return true;
        try {
            const depIds = JSON.parse(task.depends_on);
            if (!Array.isArray(depIds) || depIds.length === 0) return true;
            return depIds.every((id: string) => {
                const dep = taskStmts.get.get(id) as any;
                return dep && (dep.status === 'done' || dep.status === 'cancelled');
            });
        } catch { return true; }
    });

    if (candidates.length === 0) return null;

    // Sort by priority descending
    candidates.sort((a, b) => (b.priority || 5) - (a.priority || 5));
    return candidates[0];
}

/**
 * Execute a single task in a pipeline slot.
 * This is the core agent runner — extracted from the old single-slot runNextTask.
 */
async function executeTask(task: any, isRemediation: boolean): Promise<void> {
    const abort = new AbortController();
    const slotLabel = isRemediation ? 'Remediation' : 'Normal';

    runningSlots.set(task.id, { taskId: task.id, abort, isRemediation });

    // Mark as running
    taskStmts.updateStatus.run('running', new Date().toISOString(), task.id);
    broadcastTaskUpdate(taskStmts.get.get(task.id));

    console.log(`[${slotLabel}] Starting: ${task.title} (${task.id}) — slots: ${runningSlots.size}/${MAX_AGENT_SLOTS} (capacity: ${NORMAL_CAPACITY} normal + ${RESERVE_SLOTS} reserve)`);

    // Create task execution log (mirrors claude-logged format)
    const taskLog = createTaskLogger(task);
    taskStmts.updateLogFile.run(taskLog.file, task.id);
    console.log(`[Task] Logging to: ${taskLog.file}`);

    // Create git checkpoint if project is a git repo
    let checkpointRef: string | null = null;
    let checkpointType: string = 'none';

    if (isGitRepo(task.project_path)) {
        const result = createCheckpoint(task.project_path, task.id);
        checkpointRef = result.ref;
        checkpointType = result.type;
        if (checkpointRef) {
            taskStmts.updateCheckpoint.run(checkpointRef, checkpointType, new Date().toISOString(), task.id);
        }
    }

    let resultText = '';  // Hoisted for access in catch block (failure learnings extraction)

    try {
        // Build clean env without CLAUDECODE (prevents nested session detection)
        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        // Build ecosystem-aware context (Level 10)
        let goalContext: string | null = null;
        if (task.goal_id) {
            const goal = goalStmts.get.get(task.goal_id) as any;
            if (goal) goalContext = `Goal: ${goal.description}`;
        }
        const taskContext = buildTaskContext(task.project_path, goalContext || undefined, task.title);
        console.log(`[Task] Context injected: ${taskContext.length} chars (~${Math.ceil(taskContext.length / 4)} tokens)`);

        const taskPrompt = task.description;

        // Build agentQuery options
        const permissionMode = task.gate_mode === 'bypass' ? 'bypassPermissions' : 'default';
        const allowDangerous = task.gate_mode === 'bypass';

        const options: any = {
            model: task.model,
            maxTurns: task.max_turns,
            cwd: task.project_path,
            permissionMode: permissionMode,
            allowDangerouslySkipPermissions: allowDangerous,
            abortController: abort,
            env: cleanEnv,
            canUseTool: await createCanUseToolCallback(task.id, task.gate_mode || 'bypass'),
            systemPrompt: {
                type: 'preset',
                preset: 'claude_code',
                append: taskContext
            }
        };

        // Add allowedTools if specified
        if (task.allowed_tools) {
            try {
                const toolsList = JSON.parse(task.allowed_tools);
                if (Array.isArray(toolsList) && toolsList.length > 0) {
                    options.allowedTools = toolsList;
                }
            } catch (err: any) {
                console.error(`[Task] Invalid allowed_tools JSON: ${task.allowed_tools}`);
            }
        }

        const q = agentQuery({
            prompt: taskPrompt,
            options
        });

        let totalCost = 0;
        let totalTokensIn = 0;
        let totalTokensOut = 0;
        let numTurns = 0;
        resultText = '';

        for await (const message of q) {
            // Check if cancelled
            if (abort.signal.aborted) break;

            broadcastTaskProgress(task.id, message);
            taskLog.log(message);

            if (message.type === 'result') {
                const msg = message as any;
                const isSuccess = msg.subtype === 'success';
                totalCost = msg.total_cost_usd || 0;
                numTurns = msg.num_turns || 0;
                resultText = msg.result || '';

                // Try to extract token counts from usage
                if (msg.usage) {
                    totalTokensIn = msg.usage.input_tokens || 0;
                    totalTokensOut = msg.usage.output_tokens || 0;
                }

                taskStmts.complete.run(
                    isSuccess ? 'done' : 'failed',
                    new Date().toISOString(),
                    resultText,
                    totalCost,
                    totalTokensIn,
                    totalTokensOut,
                    numTurns,
                    task.id
                );

                console.log(`[Task] ${isSuccess ? 'Completed' : 'Failed'}: ${task.title} ($${totalCost.toFixed(4)}, ${numTurns} turns)`);
                taskLog.finish(isSuccess ? 'done' : 'failed');

                // Record outcome in project memory (once per task)
                recordTaskOutcome(taskStmts.get.get(task.id));

                // Auto-retry on SDK result failure
                if (!isSuccess) {
                    scheduleAutoRetry(task, resultText || msg.subtype || 'SDK result failure');
                }

                // Commit changes and clean up checkpoint on success
                // (Must run before updateGoalProgress so summary has commit SHAs)
                if (isSuccess) {
                    const updatedTask = taskStmts.get.get(task.id) as any;
                    const commitResult = commitTaskChanges(task.project_path, updatedTask || task);
                    if (commitResult.committed && commitResult.sha) {
                        taskStmts.updateCommitInfo.run(
                            commitResult.sha,
                            JSON.stringify(commitResult.filesChanged),
                            task.id
                        );
                    }
                    if (checkpointRef && checkpointType !== 'none') {
                        cleanupCheckpoint(task.project_path, checkpointRef, checkpointType);
                    }

                    // Extract knowledge proposals from result (Level 10C)
                    try {
                        extractAndStoreProposals(task.id, resultText, task.project_path);
                    } catch (err: any) {
                        console.error(`[Proposals] Extraction failed for task ${task.id}:`, err.message);
                    }
                }

                // Recalculate project costs (Phase 2)
                recalcProjectCosts(task.project_path);

                // Update goal progress (may trigger summary generation)
                if (task.goal_id) {
                    updateGoalProgress(task.goal_id);
                }
            }
        }

        // If aborted (cancelled), the loop exits without a result message
        if (abort.signal.aborted) {
            const current = taskStmts.get.get(task.id) as any;
            if (current && current.status === 'running') {
                taskStmts.cancel.run('cancelled', new Date().toISOString(), task.id);
                console.log(`[Task] Cancelled: ${task.title}`);
                taskLog.finish('cancelled');
            }
            // Rollback on cancellation
            if (checkpointRef && checkpointType !== 'none') {
                rollbackCheckpoint(task.project_path, checkpointRef, checkpointType);
            }
        }
    } catch (err: any) {
        const errDetail = err.stack || err.message || String(err);
        console.error(`[Task] Error: ${task.title}:`, errDetail);
        const current = taskStmts.get.get(task.id) as any;
        if (current && (current.status === 'running' || current.status === 'pending')) {
            taskStmts.fail.run('failed', new Date().toISOString(), err.message, task.id);
        }
        taskLog.finish('failed', err.message);

        // Record outcome in project memory (once per task)
        recordTaskOutcome(taskStmts.get.get(task.id));

        // Extract knowledge proposals from failed task results too (Phase F)
        if (resultText) {
            try {
                extractAndStoreProposals(task.id, resultText, task.project_path);
            } catch (propErr: any) {
                console.error(`[Proposals] Extraction failed for task ${task.id}:`, propErr.message);
            }
        }

        // Update goal progress and recalculate costs
        if (task.goal_id) {
            updateGoalProgress(task.goal_id);
        }
        recalcProjectCosts(task.project_path);

        // Auto-retry on exception failure
        scheduleAutoRetry(task, err.message);

        // Rollback on error
        if (checkpointRef && checkpointType !== 'none') {
            try {
                rollbackCheckpoint(task.project_path, checkpointRef, checkpointType);
                console.log(`[Task] Rolled back to checkpoint: ${checkpointRef}`);
            } catch (rollbackErr: any) {
                console.error(`[Task] Rollback failed:`, rollbackErr.message);
            }
        }
    } finally {
        runningSlots.delete(task.id);
        console.log(`[${slotLabel}] Slot freed. Active: ${runningSlots.size}/${MAX_AGENT_SLOTS}`);
        broadcastTaskUpdate(taskStmts.get.get(task.id));

        // Update goal progress on completion
        if (task.goal_id) {
            updateGoalProgress(task.goal_id);
        }
    }
}

// ── Exported accessors for module-level state ────────────────

export { pendingApprovals };

export function getRunningTaskId(): string | null {
    // Return the first running task ID (backwards compat for cancel endpoint)
    const first = runningSlots.values().next().value;
    return first?.taskId ?? null;
}

export function getRunningAbort(): AbortController | null {
    // Return the first running abort (backwards compat for SIGTERM)
    const first = runningSlots.values().next().value;
    return first?.abort ?? null;
}

/**
 * Get the abort controller for a specific task (for targeted cancellation).
 */
export function getAbortForTask(taskId: string): AbortController | null {
    return runningSlots.get(taskId)?.abort ?? null;
}

/**
 * Get all currently running task IDs.
 */
export function getRunningTaskIds(): string[] {
    return [...runningSlots.keys()];
}

/**
 * Abort all running tasks (for shutdown).
 */
export function abortAllTasks(): void {
    for (const slot of runningSlots.values()) {
        slot.abort.abort();
    }
}
