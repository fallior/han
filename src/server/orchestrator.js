/**
 * Claude Remote - Orchestrator Intelligence Layer
 * Routes task decomposition and classification to Ollama (local) or Claude Haiku (API)
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';

let ollamaAvailable = false;

/**
 * Check if Ollama is available and ready
 */
async function checkOllamaStatus() {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, {
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok) return false;

        const data = await res.json();
        const models = data.models || [];

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
async function callLLM(systemPrompt, userPrompt, options = {}) {
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
                response: JSON.parse(data.response),
                backend: 'ollama',
                model: OLLAMA_MODEL
            };
        } catch (err) {
            console.warn('[Orchestrator] Ollama call failed, falling back to Claude:', err.message);
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
        const textContent = data.content[0].text;

        // Extract JSON from markdown code blocks if needed
        let jsonText = textContent;
        const jsonMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonText = jsonMatch[1];
        }

        return {
            response: JSON.parse(jsonText),
            backend: 'anthropic',
            model: 'claude-haiku-4-5-20251001'
        };
    } catch (err) {
        throw new Error(`Failed to call Claude API: ${err.message}`);
    }
}

/**
 * @deprecated Opus planner assigns models directly in the plan. Use planGoal() in server.js instead.
 */
async function classifyTask(description, projectPath) {
    const systemPrompt = `You are a task complexity classifier for code projects. Classify tasks as:
- simple: single-file change, docs, config, obvious fix → suggest 'haiku'
- medium: multi-file feature, refactor, moderate implementation → suggest 'sonnet'
- complex: architecture design, multi-system changes, major features → suggest 'opus'

Respond with JSON only: { "complexity": "simple|medium|complex", "suggestedModel": "haiku|sonnet|opus", "estimatedTurns": number, "reasoning": "brief explanation" }`;

    const userPrompt = `Task: ${description}\nProject: ${projectPath}`;

    try {
        const result = await callLLM(systemPrompt, userPrompt, { timeout: 15000 });
        return {
            ...result.response,
            backend: result.backend,
            model: result.model
        };
    } catch (err) {
        console.error('[Orchestrator] classifyTask failed:', err.message);
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
async function decomposeGoal(goal, projectContext) {
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
        const result = await callLLM(systemPrompt, userPrompt, { timeout: 120000 });
        return {
            subtasks: result.response.subtasks || [],
            backend: result.backend,
            model: result.model
        };
    } catch (err) {
        console.error('[Orchestrator] decomposeGoal failed:', err.message);
        throw err;
    }
}

/**
 * Analyse task failure and decide on retry strategy
 */
async function analyseFailure(task, error, attemptNumber) {
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
        const result = await callLLM(systemPrompt, userPrompt, { timeout: 15000 });
        return {
            ...result.response,
            backend: result.backend,
            model: result.model
        };
    } catch (err) {
        console.error('[Orchestrator] analyseFailure failed:', err.message);
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
function selectModel(complexity, projectHistory = {}) {
    // Default model mapping
    const modelMap = {
        simple: 'haiku',
        medium: 'sonnet',
        complex: 'opus'
    };

    let model = modelMap[complexity] || 'sonnet';

    // Check project history for model success rates
    if (projectHistory[model] && projectHistory[model].failureRate > 0.5) {
        // Escalate if this model has >50% failure rate on this project
        const escalation = { haiku: 'sonnet', sonnet: 'opus', opus: 'opus' };
        model = escalation[model];
        console.log(`[Orchestrator] Escalating ${complexity} task from ${modelMap[complexity]} to ${model} based on project history`);
    }

    return model;
}

/**
 * Get orchestrator status
 */
function getStatus() {
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
async function initialize() {
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
 * Pure function — no LLM call, queries SQLite directly.
 */
function recommendModel(db, projectPath, taskType, options = {}) {
    const minSampleSize = options.minSampleSize || 5;
    const minSuccessRate = options.minSuccessRate || 0.7;

    try {
        // First try task-type-specific records
        let records = db.prepare(
            'SELECT model_used, success, cost_usd FROM project_memory WHERE project_path = ? AND task_type = ?'
        ).all(projectPath, taskType);

        let scope = 'task_type';

        // Fall back to project-wide if insufficient task-type data
        if (records.length < minSampleSize) {
            records = db.prepare(
                'SELECT model_used, success, cost_usd FROM project_memory WHERE project_path = ?'
            ).all(projectPath);
            scope = 'project';
        }

        if (records.length < minSampleSize) {
            return { model: null, confidence: 'none', reason: `Insufficient data (${records.length} records)`, stats: {} };
        }

        // Group by model
        const byModel = {};
        for (const r of records) {
            const m = r.model_used || 'unknown';
            if (!byModel[m]) byModel[m] = { count: 0, successes: 0, totalCost: 0 };
            byModel[m].count++;
            if (r.success) byModel[m].successes++;
            byModel[m].totalCost += r.cost_usd || 0;
        }

        // Compute rates and filter
        const candidates = [];
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

        // Sort by avg cost ascending (cheapest first)
        candidates.sort((a, b) => a.avgCost - b.avgCost);
        const best = candidates[0];
        const confidence = best.count >= 10 ? 'high' : 'low';

        return {
            model: best.model,
            confidence,
            reason: `${best.model} has ${(best.successRate * 100).toFixed(0)}% success rate over ${best.count} tasks (${scope} scope, avg $${best.avgCost.toFixed(4)})`,
            stats: byModel
        };
    } catch (err) {
        return { model: null, confidence: 'none', reason: `Error: ${err.message}`, stats: {} };
    }
}

module.exports = {
    initialize,
    callLLM,              // Used by analyseFailure — Ollama/Haiku for quick calls
    classifyTask,         // DEPRECATED — Opus planner assigns models
    decomposeGoal,        // DEPRECATED — replaced by planGoal() in server.js
    analyseFailure,       // Retry logic — quick LLM calls, fine with small models
    selectModel,          // Fallback model mapping
    recommendModel,       // Memory-based cost optimisation (pure function, no LLM)
    getStatus,
    checkOllamaStatus
};
