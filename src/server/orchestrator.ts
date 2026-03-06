/**
 * Hortus Arbor Nostra - Orchestrator Intelligence Layer
 * Routes task decomposition and classification to Ollama (local) or Claude Haiku (API)
 */

import type Database from 'better-sqlite3';

// ── Types ─────────────────────────────────────────────────

interface CallLLMOptions {
    timeout?: number;
}

interface LLMResult<T = Record<string, unknown>> {
    response: T;
    backend: string;
    model: string;
}

interface ClassifyTaskResult {
    complexity: string;
    suggestedModel: string;
    estimatedTurns: number;
    reasoning: string;
    backend: string;
    model: string;
}

interface DecomposeGoalResult {
    subtasks: Subtask[];
    backend: string;
    model: string;
}

interface Subtask {
    title: string;
    description: string;
    priority: number;
    model: string;
    dependsOn: string[];
}

interface FailureAnalysis {
    shouldRetry: boolean;
    adjustedDescription: string | null;
    adjustedModel: string | null;
    reasoning: string;
    backend: string;
    model: string;
}

interface TaskForAnalysis {
    title: string;
    description: string;
    model: string;
}

interface ModelStats {
    count: number;
    successes: number;
    totalCost: number;
}

interface ProjectHistory {
    [model: string]: { failureRate: number };
}

interface RecommendModelOptions {
    minSampleSize?: number;
    minSuccessRate?: number;
}

interface RecommendModelResult {
    model: string | null;
    confidence: 'high' | 'low' | 'none';
    reason: string;
    stats: Record<string, ModelStats>;
}

interface OrchestratorStatus {
    ollamaAvailable: boolean;
    ollamaUrl: string;
    ollamaModel: string;
    backend: string;
    hasApiKey: boolean;
}

// ── Configuration ─────────────────────────────────────────

const OLLAMA_URL: string = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL: string = process.env.OLLAMA_MODEL || 'gemma3:4b';

let ollamaAvailable = false;

// ── Functions ─────────────────────────────────────────────

/**
 * Check if Ollama is available and ready
 */
export async function checkOllamaStatus(): Promise<boolean> {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, {
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok) return false;

        const data = await res.json();
        const models: Array<{ name: string }> = data.models || [];

        // Check if our preferred model is available
        const hasModel = models.some(m => m.name.includes(OLLAMA_MODEL.split(':')[0]));
        return hasModel;
    } catch (err) {
        return false;
    }
}

/**
 * Call LLM with structured JSON output
 * Tries Ollama first, falls back to Claude Haiku
 */
export async function callLLM<T = Record<string, unknown>>(
    systemPrompt: string,
    userPrompt: string,
    options: CallLLMOptions = {}
): Promise<LLMResult<T>> {
    const timeout = options.timeout || 30000;

    // Try Ollama first
    if (ollamaAvailable) {
        try {
            const res = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: OLLAMA_MODEL,
                    system: systemPrompt,
                    prompt: userPrompt,
                    stream: false,
                    format: 'json'
                }),
                signal: AbortSignal.timeout(timeout)
            });

            if (!res.ok) {
                throw new Error(`Ollama responded with ${res.status}`);
            }

            const data = await res.json();
            return {
                response: JSON.parse(data.response) as T,
                backend: 'ollama',
                model: OLLAMA_MODEL
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn('[Orchestrator] Ollama call failed, falling back to Claude:', message);
        }
    }

    // Fallback: Claude Haiku via Anthropic Messages API
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('No ANTHROPIC_API_KEY available and Ollama is not working');
    }

    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 2048,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }]
            }),
            signal: AbortSignal.timeout(timeout)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Anthropic API error: ${res.status} ${errText}`);
        }

        const data = await res.json();
        const textContent: string = data.content[0].text;

        // Extract JSON from markdown code blocks if needed
        let jsonText = textContent;
        const jsonMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonText = jsonMatch[1];
        }

        return {
            response: JSON.parse(jsonText) as T,
            backend: 'anthropic',
            model: 'claude-haiku-4-5-20251001'
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to call Claude API: ${message}`);
    }
}

/**
 * @deprecated Opus planner assigns models directly in the plan. Use planGoal() in server.js instead.
 */
export async function classifyTask(description: string, projectPath: string): Promise<ClassifyTaskResult> {
    const systemPrompt = `You are a task complexity classifier for code projects. Classify tasks as:
- simple: single-file change, docs, config, obvious fix → suggest 'haiku'
- medium: multi-file feature, refactor, moderate implementation → suggest 'sonnet'
- complex: architecture design, multi-system changes, major features → suggest 'opus'

Respond with JSON only: { "complexity": "simple|medium|complex", "suggestedModel": "haiku|sonnet|opus", "estimatedTurns": number, "reasoning": "brief explanation" }`;

    const userPrompt = `Task: ${description}\nProject: ${projectPath}`;

    try {
        const result = await callLLM<Omit<ClassifyTaskResult, 'backend' | 'model'>>(systemPrompt, userPrompt, { timeout: 15000 });
        return {
            ...result.response,
            backend: result.backend,
            model: result.model
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Orchestrator] classifyTask failed:', message);
        // Fallback: default to medium complexity
        return {
            complexity: 'medium',
            suggestedModel: 'sonnet',
            estimatedTurns: 50,
            reasoning: 'Classification failed, using safe defaults',
            backend: 'fallback',
            model: 'none'
        };
    }
}

/**
 * @deprecated Replaced by planGoal() in server.js which uses Agent SDK with Opus for higher quality plans.
 */
export async function decomposeGoal(goal: string, projectContext: string): Promise<DecomposeGoalResult> {
    const systemPrompt = `You are a software project task decomposer. Break down high-level goals into concrete, ordered subtasks.

Each subtask should:
- Be self-contained and actionable
- Have clear dependencies (if any)
- Specify appropriate model (haiku/sonnet/opus)
- Include priority (1-10, higher = more urgent)

Respond with JSON only: {
  "subtasks": [
    {
      "title": "Brief title (50 chars max)",
      "description": "Detailed task description",
      "priority": number,
      "model": "haiku|sonnet|opus",
      "dependsOn": [array of task titles this depends on, or empty array]
    }
  ]
}`;

    const userPrompt = `Goal: ${goal}\n\nProject context:\n${projectContext}`;

    try {
        const result = await callLLM<{ subtasks?: Subtask[] }>(systemPrompt, userPrompt, { timeout: 120000 });
        return {
            subtasks: result.response.subtasks || [],
            backend: result.backend,
            model: result.model
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Orchestrator] decomposeGoal failed:', message);
        throw err;
    }
}

/**
 * Analyse task failure and decide on retry strategy
 */
export async function analyseFailure(
    task: TaskForAnalysis,
    error: string,
    attemptNumber: number
): Promise<FailureAnalysis> {
    const systemPrompt = `You are a task failure analyser. Given a failed task and error, decide whether and how to retry.

Rules:
- Retry simple failures (missing dependencies, transient errors)
- Don't retry fundamental issues (invalid syntax, wrong approach)
- Can escalate model: haiku → sonnet → opus
- Can adjust task description to clarify or add constraints

Respond with JSON only: {
  "shouldRetry": boolean,
  "adjustedDescription": "string or null (null = keep original)",
  "adjustedModel": "string or null (null = keep original)",
  "reasoning": "brief explanation"
}`;

    const userPrompt = `Task: ${task.title}
Description: ${task.description}
Current model: ${task.model}
Attempt: ${attemptNumber}
Error: ${error}`;

    try {
        const result = await callLLM<Omit<FailureAnalysis, 'backend' | 'model'>>(systemPrompt, userPrompt, { timeout: 15000 });
        return {
            ...result.response,
            backend: result.backend,
            model: result.model
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Orchestrator] analyseFailure failed:', message);
        // Safe fallback: don't retry if analysis fails
        return {
            shouldRetry: false,
            adjustedDescription: null,
            adjustedModel: null,
            reasoning: 'Failure analysis failed, not retrying',
            backend: 'fallback',
            model: 'none'
        };
    }
}

/**
 * Select appropriate model based on complexity and project history
 */
export function selectModel(complexity: string, projectHistory: ProjectHistory = {}): string {
    // Default model mapping
    const modelMap: Record<string, string> = {
        simple: 'haiku',
        medium: 'sonnet',
        complex: 'opus'
    };

    let model = modelMap[complexity] || 'sonnet';

    // Check project history for model success rates
    if (projectHistory[model] && projectHistory[model].failureRate > 0.5) {
        // Escalate if this model has >50% failure rate on this project
        const escalation: Record<string, string> = { haiku: 'sonnet', sonnet: 'opus', opus: 'opus' };
        model = escalation[model];
        console.log(`[Orchestrator] Escalating ${complexity} task from ${modelMap[complexity]} to ${model} based on project history`);
    }

    return model;
}

/**
 * Get orchestrator status
 */
export function getStatus(): OrchestratorStatus {
    return {
        ollamaAvailable,
        ollamaUrl: OLLAMA_URL,
        ollamaModel: OLLAMA_MODEL,
        backend: ollamaAvailable ? 'ollama' : 'anthropic',
        hasApiKey: !!process.env.ANTHROPIC_API_KEY
    };
}

/**
 * Initialize orchestrator (check Ollama availability)
 */
export async function initialize(): Promise<OrchestratorStatus> {
    console.log('[Orchestrator] Checking Ollama availability...');
    ollamaAvailable = await checkOllamaStatus();

    if (ollamaAvailable) {
        console.log(`[Orchestrator] Using Ollama (${OLLAMA_MODEL}) at ${OLLAMA_URL}`);
    } else {
        console.log('[Orchestrator] Ollama not available, will use Anthropic API (Haiku)');
    }

    return getStatus();
}

/**
 * Recommend cheapest model with acceptable success rate from project memory.
 * Pure function -- no LLM call, queries SQLite directly.
 */
export function recommendModel(
    db: Database.Database,
    projectPath: string,
    taskType: string,
    options: RecommendModelOptions = {}
): RecommendModelResult {
    const minSampleSize = options.minSampleSize || 5;
    const minSuccessRate = options.minSuccessRate || 0.7;

    try {
        // First try task-type-specific records
        let records = db.prepare(
            'SELECT model_used, success, cost_usd FROM project_memory WHERE project_path = ? AND task_type = ?'
        ).all(projectPath, taskType) as Array<{ model_used: string; success: number; cost_usd: number }>;

        let scope = 'task_type';

        // Fall back to project-wide if insufficient task-type data
        if (records.length < minSampleSize) {
            records = db.prepare(
                'SELECT model_used, success, cost_usd FROM project_memory WHERE project_path = ?'
            ).all(projectPath) as Array<{ model_used: string; success: number; cost_usd: number }>;
            scope = 'project';
        }

        if (records.length < minSampleSize) {
            return { model: null, confidence: 'none', reason: `Insufficient data (${records.length} records)`, stats: {} };
        }

        // Group by model
        const byModel: Record<string, ModelStats> = {};
        for (const r of records) {
            const m = r.model_used || 'unknown';
            if (!byModel[m]) byModel[m] = { count: 0, successes: 0, totalCost: 0 };
            byModel[m].count++;
            if (r.success) byModel[m].successes++;
            byModel[m].totalCost += r.cost_usd || 0;
        }

        // Compute rates and filter
        const candidates: Array<{ model: string; successRate: number; avgCost: number; count: number }> = [];
        for (const [model, stats] of Object.entries(byModel)) {
            if (model === 'unknown') continue;
            const successRate = stats.count > 0 ? stats.successes / stats.count : 0;
            const avgCost = stats.count > 0 ? stats.totalCost / stats.count : 0;
            if (stats.count >= minSampleSize && successRate >= minSuccessRate) {
                candidates.push({ model, successRate, avgCost, count: stats.count });
            }
        }

        if (candidates.length === 0) {
            return { model: null, confidence: 'none', reason: 'No model meets threshold', stats: byModel };
        }

        // Category-aware sorting: complex tasks prioritize success rate, simple tasks prioritize cost
        const complexCategories = ['architecture', 'bugfix'];
        let sortStrategy: string;

        if (complexCategories.includes(taskType)) {
            // Sort by success rate descending (best success first), then cost ascending as tiebreaker
            candidates.sort((a, b) => b.successRate - a.successRate || a.avgCost - b.avgCost);
            sortStrategy = 'success-weighted';
        } else {
            // Simple categories (docs, config, test, etc.) and default: cheapest first
            candidates.sort((a, b) => a.avgCost - b.avgCost);
            sortStrategy = 'cost-weighted';
        }

        const best = candidates[0];
        console.log(`[Orchestrator] recommendModel(${taskType}): ${candidates.length} candidates, best=${best.model} (${(best.successRate * 100).toFixed(0)}% success, $${best.avgCost.toFixed(4)} avg)`);
        const confidence: 'high' | 'low' = best.count >= 10 ? 'high' : 'low';

        return {
            model: best.model,
            confidence,
            reason: `${best.model} has ${(best.successRate * 100).toFixed(0)}% success rate over ${best.count} tasks (${scope} scope, avg $${best.avgCost.toFixed(4)}, ${sortStrategy})`,
            stats: byModel
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { model: null, confidence: 'none', reason: `Error: ${message}`, stats: {} };
    }
}

// ── CommonJS compatibility ────────────────────────────────

module.exports = { initialize, callLLM, classifyTask, decomposeGoal, analyseFailure, selectModel, recommendModel, getStatus, checkOllamaStatus };
