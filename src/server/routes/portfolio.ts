import { Router, Request, Response } from 'express';
import { db, portfolioStmts } from '../db';
import { syncRegistry, getProjectStats, getAllProjectStats } from '../db';
import { getEcosystemSummary } from '../services/context';

const orchestrator = require('../orchestrator');

const router = Router();

/**
 * GET /portfolio -- List all projects with stats
 */
router.get('/portfolio', (req: Request, res: Response) => {
    try {
        const projects = portfolioStmts.list.all();
        const allStats = getAllProjectStats();
        const enriched = projects.map((p: any) => ({
            ...p,
            stats: allStats[p.path] || {
                tasks_total: 0, tasks_completed: 0, tasks_failed: 0,
                tasks_running: 0, tasks_pending: 0, total_cost_usd: 0,
                goals_total: 0, goals_completed: 0,
            }
        }));
        res.json({ success: true, projects: enriched });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /portfolio/sync -- Re-sync from infrastructure registry
 */
router.post('/portfolio/sync', (req: Request, res: Response) => {
    try {
        const count = syncRegistry();
        res.json({ success: true, synced: count });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /portfolio/:name/priority -- Update project priority
 */
router.put('/portfolio/:name/priority', (req: Request<{ name: string }>, res: Response) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        const priority = parseInt(req.body.priority, 10);
        if (isNaN(priority) || priority < 0 || priority > 10) {
            return res.status(400).json({ success: false, error: 'Priority must be 0-10' });
        }
        portfolioStmts.updatePriority.run(priority, req.params.name);
        res.json({ success: true, project: portfolioStmts.get.get(req.params.name) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /portfolio/:name/budget -- Set project cost budgets
 */
router.put('/portfolio/:name/budget', (req: Request<{ name: string }>, res: Response) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        const daily = parseFloat(req.body.cost_budget_daily) || 0;
        const total = parseFloat(req.body.cost_budget_total) || 0;
        if (daily < 0 || total < 0) return res.status(400).json({ success: false, error: 'Budgets must be >= 0' });
        portfolioStmts.updateBudget.run(daily, total, req.params.name);
        res.json({ success: true, project: portfolioStmts.get.get(req.params.name) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /portfolio/:name/budget -- Get project budget status
 */
router.get('/portfolio/:name/budget', (req: Request<{ name: string }>, res: Response) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        res.json({
            success: true,
            daily_budget: project.cost_budget_daily,
            total_budget: project.cost_budget_total,
            spent_today: project.cost_spent_today,
            spent_total: project.cost_spent_total,
            throttled: !!project.throttled,
            budget_pct_daily: project.cost_budget_daily > 0 ? (project.cost_spent_today / project.cost_budget_daily * 100).toFixed(1) : 0,
            budget_pct_total: project.cost_budget_total > 0 ? (project.cost_spent_total / project.cost_budget_total * 100).toFixed(1) : 0,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /portfolio/:name/unthrottle -- Manual budget override
 */
router.post('/portfolio/:name/unthrottle', (req: Request<{ name: string }>, res: Response) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        portfolioStmts.unthrottle.run(req.params.name);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /ecosystem -- Full ecosystem state with ports, stats, and budget data
 */
router.get('/ecosystem', (req: Request, res: Response) => {
    try {
        const projects = portfolioStmts.list.all();
        const allStats = getAllProjectStats();
        const ecosystem = projects.map((p: any) => {
            let ports: any = {};
            if (p.ports) {
                try { ports = typeof p.ports === 'string' ? JSON.parse(p.ports) : p.ports; } catch {}
            }
            const stats = allStats[p.path] || {
                tasks_total: 0, tasks_completed: 0, tasks_failed: 0,
                tasks_running: 0, tasks_pending: 0, total_cost_usd: 0,
                goals_total: 0, goals_completed: 0,
            };
            return {
                name: p.name,
                description: p.description,
                path: p.path,
                lifecycle: p.lifecycle,
                priority: p.priority,
                ports,
                tasks: {
                    total: stats.tasks_total,
                    completed: stats.tasks_completed,
                    failed: stats.tasks_failed,
                    running: stats.tasks_running,
                    pending: stats.tasks_pending,
                },
                goals: {
                    total: stats.goals_total,
                    completed: stats.goals_completed,
                },
                budget: {
                    daily_limit: p.cost_budget_daily,
                    total_limit: p.cost_budget_total,
                    spent_today: p.cost_spent_today,
                    spent_total: p.cost_spent_total,
                    throttled: !!p.throttled,
                },
            };
        });
        const summaryText = getEcosystemSummary();
        res.json({ success: true, projects: ecosystem, summary: summaryText });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /orchestrator/status -- Get orchestrator backend info
 */
router.get('/orchestrator/status', (req: Request, res: Response) => {
    try {
        const status = orchestrator.getStatus();
        res.json({
            success: true,
            ...status,
            planningBackend: 'agent_sdk',
            planningModel: process.env.PLANNING_MODEL || 'opus',
            executionModels: ['haiku', 'sonnet', 'opus'],
            failureAnalysisBackend: status.backend
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /orchestrator/model-recommendation -- Get model recommendation for a project/task type
 */
router.get('/orchestrator/model-recommendation', (req: Request, res: Response) => {
    try {
        const projectPath = req.query.project as string;
        const taskType = (req.query.taskType as string) || 'unknown';
        if (!projectPath) return res.status(400).json({ success: false, error: 'project query parameter is required' });
        const recommendation = orchestrator.recommendModel(db, projectPath, taskType);
        res.json({ success: true, recommendation });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
