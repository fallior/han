import { Router, Request, Response } from 'express';
import fs from 'fs';
import { taskStmts, goalStmts } from '../db';
import { createGoal, generateId, enqueuePlanning } from '../services/planning';

const router = Router();

/**
 * POST / -- Submit a high-level goal for decomposition
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const { description, project_path, auto_execute = true, planning_model } = req.body;

        if (!description || !project_path) {
            return res.status(400).json({ success: false, error: 'Missing description or project_path' });
        }

        if (!fs.existsSync(project_path)) {
            return res.status(400).json({ success: false, error: 'Project path does not exist' });
        }

        const goalId = createGoal(description, project_path, auto_execute, null, 'standalone', planning_model);

        res.json({
            success: true,
            goal: goalStmts.get.get(goalId),
            message: 'Goal created, planning in progress'
        });
    } catch (err: any) {
        console.error('[Goals] Error creating goal:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET / -- List goals
 *
 * Query params:
 *   ?view=active    (default) — active, decomposing, planning goals
 *   ?view=archived  — done and failed goals, grouped by project
 *   ?view=all       — everything
 */
router.get('/', (req: Request, res: Response) => {
    try {
        const view = (req.query.view as string) || 'active';
        const allGoals = goalStmts.list.all() as any[];

        if (view === 'active') {
            const active = allGoals.filter((g: any) =>
                ['active', 'decomposing', 'planning'].includes(g.status));
            return res.json({ success: true, goals: active, view });
        }

        if (view === 'archived') {
            const archived = allGoals.filter((g: any) =>
                ['done', 'failed'].includes(g.status));
            // Group by project
            const byProject: Record<string, any[]> = {};
            for (const g of archived) {
                const proj = g.project_path || 'unknown';
                if (!byProject[proj]) byProject[proj] = [];
                byProject[proj].push(g);
            }
            return res.json({ success: true, projects: byProject, view });
        }

        // view=all
        res.json({ success: true, goals: allGoals, view });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /:id -- Get goal detail with tasks
 */
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        const tasks = taskStmts.getByGoal.all(goal.id);
        res.json({ success: true, goal, tasks });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/retry -- Retry a failed goal
 */
router.post('/:id/retry', async (req: Request<{ id: string }>, res: Response) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        if (goal.status !== 'failed') {
            return res.status(400).json({ success: false, error: 'Goal is not in failed state' });
        }

        const tasks = taskStmts.getByGoal.all(goal.id);
        const failedTasks = tasks.filter((t: any) => t.status === 'failed');

        // Reset failed tasks to pending
        for (const task of failedTasks) {
            taskStmts.updateStatus.run('pending', null, task.id);
        }

        // Update goal status
        goalStmts.updateStatus.run('active', goal.id);

        res.json({
            success: true,
            message: `Retrying ${failedTasks.length} failed tasks`,
            retriedTasks: failedTasks.length
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /:id -- Delete a goal and its tasks
 *
 * Query params:
 *   ?force=true  — Force delete active/decomposing goals (but not those with running tasks)
 */
router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        const force = req.query.force === 'true';

        // Check for running tasks first (never allow deleting goals with running tasks)
        const tasks = taskStmts.getByGoal.all(goal.id) as any[];
        const hasRunning = tasks.some((t: any) => t.status === 'running');
        if (hasRunning) {
            return res.status(400).json({ success: false, error: 'Cannot delete goal with running tasks' });
        }

        if (!force && (goal.status === 'decomposing' || goal.status === 'active')) {
            return res.status(400).json({ success: false, error: 'Cannot delete active goal. Use ?force=true to override.' });
        }

        // Delete associated tasks
        for (const task of tasks) {
            taskStmts.del.run(task.id);
        }

        // Delete child goals if this is a parent
        if (goal.goal_type === 'parent') {
            const children = goalStmts.getChildren.all(goal.id) as any[];
            for (const child of children) {
                const childTasks = taskStmts.getByGoal.all(child.id) as any[];
                for (const ct of childTasks) {
                    taskStmts.del.run(ct.id);
                }
                goalStmts.del.run(child.id);
            }
        }

        goalStmts.del.run(goal.id);
        res.json({ success: true, force });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /:id/summary -- Get goal completion summary
 */
router.get('/:id/summary', (req: Request<{ id: string }>, res: Response) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        if (!goal.summary_file) {
            if (!['done', 'failed'].includes(goal.status)) {
                return res.status(400).json({ success: false, error: 'Goal has not completed yet' });
            }
            // Goals that predate the summary feature will need backfilling from the caller
            return res.status(404).json({ success: false, error: 'Summary not available' });
        }

        if (!fs.existsSync(goal.summary_file)) {
            return res.status(404).json({ success: false, error: 'Summary file not found on disk' });
        }

        const content = fs.readFileSync(goal.summary_file, 'utf8');
        res.json({ success: true, summary_file: goal.summary_file, content });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
