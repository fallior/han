import { Router, Request, Response } from 'express';
import fs from 'fs';
import { taskStmts, goalStmts } from '../db';
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
