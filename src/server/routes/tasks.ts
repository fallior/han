import { Router, Request, Response } from 'express';
import fs from 'fs';
import { db, taskStmts, goalStmts } from '../db';
import {
    generateId,
    createGoal,
    getRunningTaskId,
    getRunningAbort,
    pendingApprovals
} from '../services/planning';
import { broadcastTaskUpdate, broadcastApprovalResolved } from '../ws';

const router = Router();

/**
 * GET /api/tasks -- List tasks (optionally filtered by status)
 */
router.get('/api/tasks', (req: Request, res: Response) => {
    try {
        const tasks = req.query.status
            ? taskStmts.listByStatus.all(req.query.status as string)
            : taskStmts.list.all();
        res.json({ success: true, tasks });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tasks -- Create a new task
 */
router.post('/api/tasks', (req: Request, res: Response) => {
    try {
        const { title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, deadline } = req.body;

        if (!title || !description || !project_path) {
            return res.status(400).json({ success: false, error: 'Missing title, description, or project_path' });
        }

        // Validate gate_mode
        const validGateModes = ['bypass', 'edits_only', 'approve_all'];
        const finalGateMode = gate_mode && validGateModes.includes(gate_mode) ? gate_mode : 'bypass';

        // Validate and serialize allowed_tools
        let allowedToolsJson: string | null = null;
        if (allowed_tools) {
            if (Array.isArray(allowed_tools) && allowed_tools.length > 0) {
                allowedToolsJson = JSON.stringify(allowed_tools);
            } else if (typeof allowed_tools === 'string') {
                // Already JSON string
                try {
                    JSON.parse(allowed_tools); // Validate
                    allowedToolsJson = allowed_tools;
                } catch {
                    return res.status(400).json({ success: false, error: 'Invalid allowed_tools JSON' });
                }
            }
        }

        const id = generateId();
        const now = new Date().toISOString();

        taskStmts.insert.run(id, title, description, project_path,
            priority || 0, model || 'sonnet', max_turns || 100, finalGateMode, allowedToolsJson, now, deadline || null);

        const task = taskStmts.get.get(id);
        broadcastTaskUpdate(task);

        res.json({ success: true, task });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/tasks/:id -- Get a single task
 */
router.get('/api/tasks/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        res.json({ success: true, task });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tasks/:id/cancel -- Cancel a running or pending task
 */
router.post('/api/tasks/:id/cancel', (req: Request<{ id: string }>, res: Response) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        if (task.status !== 'pending' && task.status !== 'running') {
            return res.status(400).json({ success: false, error: 'Task is not pending or running' });
        }

        // If running, abort the agent
        const runningAbort = getRunningAbort();
        if (task.status === 'running' && runningAbort) {
            runningAbort.abort();
        }

        taskStmts.cancel.run('cancelled', new Date().toISOString(), task.id);
        const updated = taskStmts.get.get(task.id);
        broadcastTaskUpdate(updated);
        res.json({ success: true, task: updated });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/tasks/:id -- Delete a task
 */
router.delete('/api/tasks/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        if (task.status === 'running') {
            return res.status(400).json({ success: false, error: 'Cannot delete a running task -- cancel it first' });
        }
        taskStmts.del.run(task.id);
        broadcastTaskUpdate({ ...task, status: 'deleted' });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/tasks/:id/log -- Get a task's execution log
 */
router.get('/api/tasks/:id/log', (req: Request<{ id: string }>, res: Response) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        if (!task.log_file) return res.status(404).json({ success: false, error: 'No log file for this task' });

        if (!fs.existsSync(task.log_file)) {
            return res.status(404).json({ success: false, error: 'Log file not found on disk' });
        }

        const content = fs.readFileSync(task.log_file, 'utf8');
        res.json({ success: true, log: content, path: task.log_file });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tasks/:id/retry -- Retry a failed task
 *
 * Body: { smart?: boolean }
 * - simple retry (default): resets the task to pending
 * - smart retry: spawns a diagnostic agent to inspect the failure log,
 *   fix the underlying issue, then resets the original task to pending
 */
router.post('/api/tasks/:id/retry', (req: Request<{ id: string }>, res: Response) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        if (task.status !== 'failed') {
            return res.status(400).json({ success: false, error: 'Only failed tasks can be retried' });
        }

        const smart = req.body?.smart === true;

        if (smart && task.log_file && fs.existsSync(task.log_file)) {
            // Smart retry: create a diagnostic task that runs first
            const logContent = fs.readFileSync(task.log_file, 'utf8');
            // Truncate log to last 3000 chars to keep prompt reasonable
            const logTail = logContent.length > 3000 ? '...\n' + logContent.slice(-3000) : logContent;

            const diagId = generateId();
            const now = new Date().toISOString();
            const diagTitle = `Diagnose and fix: ${task.title}`;
            const diagDescription = `A task failed and needs diagnosis and remediation before retry.

## Failed Task
**Title:** ${task.title}
**Description:** ${task.description}

## Failure Log (tail)
\`\`\`
${logTail}
\`\`\`

## Instructions
1. Read the failure log above carefully to understand what went wrong
2. Inspect the project state — check relevant files, configs, dependencies
3. Take corrective action: fix broken files, install missing deps, resolve config issues
4. Verify your fix by running the relevant commands (build, lint, test, etc.)
5. Do NOT attempt to complete the original task — only fix the blocker

**Constraint:** Only fix what caused the failure. Do not refactor, add features, or make unrelated changes.`;

            taskStmts.insert.run(diagId, diagTitle, diagDescription, task.project_path,
                task.priority || 0, 'sonnet', 50, 'bypass', null, now, null);

            // Set the original task to pending, blocked until diagnostic completes
            taskStmts.cancel.run('pending', null, task.id);
            // Merge diagnostic ID into existing depends_on
            let existingDeps: string[] = [];
            try { existingDeps = task.depends_on ? JSON.parse(task.depends_on) : []; } catch {}
            existingDeps.push(diagId);
            db.prepare('UPDATE tasks SET depends_on = ? WHERE id = ?').run(JSON.stringify(existingDeps), task.id);
            const updatedOriginal = taskStmts.get.get(task.id);

            const diagTask = taskStmts.get.get(diagId);
            broadcastTaskUpdate(diagTask);
            broadcastTaskUpdate(updatedOriginal);

            res.json({
                success: true,
                mode: 'smart',
                diagnostic_task: diagTask,
                original_task: updatedOriginal,
                message: 'Diagnostic task created to fix the failure, original task reset to pending'
            });
        } else {
            // Simple retry: just reset to pending
            taskStmts.cancel.run('pending', null, task.id);
            const updated = taskStmts.get.get(task.id);
            broadcastTaskUpdate(updated);
            res.json({ success: true, mode: 'simple', task: updated });
        }
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Approval gates ────────────────────────────────────────

/**
 * GET /api/approvals -- List pending approvals
 */
router.get('/api/approvals', (req: Request, res: Response) => {
    const approvals = Array.from(pendingApprovals.entries()).map(([id, data]) => ({
        approvalId: id,
        taskId: data.taskId,
        toolName: data.toolName,
        timestamp: data.timestamp
    }));
    res.json({ success: true, approvals });
});

/**
 * GET /api/approvals/:id -- Get specific approval details
 */
router.get('/api/approvals/:id', (req: Request<{ id: string }>, res: Response) => {
    const approval = pendingApprovals.get(req.params.id);
    if (!approval) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({
        success: true,
        approvalId: req.params.id,
        taskId: approval.taskId,
        toolName: approval.toolName,
        input: approval.input,
        timestamp: approval.timestamp
    });
});

/**
 * POST /api/approvals/:id/approve -- Approve an operation
 */
router.post('/api/approvals/:id/approve', (req: Request<{ id: string }>, res: Response) => {
    const approval = pendingApprovals.get(req.params.id);
    if (!approval) return res.status(404).json({ success: false, error: 'Not found' });

    pendingApprovals.delete(req.params.id);
    approval.resolve({ behavior: 'allow' });
    broadcastApprovalResolved(req.params.id);
    res.json({ success: true });
});

/**
 * POST /api/approvals/:id/deny -- Deny an operation
 */
router.post('/api/approvals/:id/deny', (req: Request<{ id: string }>, res: Response) => {
    const approval = pendingApprovals.get(req.params.id);
    if (!approval) return res.status(404).json({ success: false, error: 'Not found' });

    const { message } = req.body;
    pendingApprovals.delete(req.params.id);
    approval.resolve({
        behavior: 'deny',
        message: message || 'Denied by user'
    });
    broadcastApprovalResolved(req.params.id);
    res.json({ success: true });
});

export default router;
