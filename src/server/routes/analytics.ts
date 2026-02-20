import { Router, Request, Response } from 'express';
import { db, taskStmts, digestStmts, weeklyReportStmts, maintenanceStmts } from '../db';
import { generateDailyDigest } from '../services/digest';
import { generateWeeklyReport } from '../services/reports';

const router = Router();

/**
 * GET /api/analytics -- Global analytics: stats, model breakdown, velocity, suggestions
 */
router.get('/api/analytics', (req: Request, res: Response) => {
    try {
        const memoryStmts = (db as any).memoryStmts || require('../db').memoryStmts;
        const records = memoryStmts.getAll.all();

        // Global stats
        const totalTasks = records.length;
        const successes = records.filter((r: any) => r.success).length;
        const totalCost = records.reduce((sum: number, r: any) => sum + (r.cost_usd || 0), 0);
        const global = {
            totalTasks,
            successRate: totalTasks > 0 ? successes / totalTasks : 0,
            totalCost,
            avgCostPerTask: totalTasks > 0 ? totalCost / totalTasks : 0,
        };

        // Per-model stats
        const byModel: Record<string, any> = {};
        for (const r of records) {
            const m = r.model_used || 'unknown';
            if (!byModel[m]) byModel[m] = { count: 0, successes: 0, totalCost: 0, totalTurns: 0, totalDuration: 0, withTurns: 0, withDuration: 0 };
            byModel[m].count++;
            if (r.success) byModel[m].successes++;
            byModel[m].totalCost += r.cost_usd || 0;
            if (r.turns) { byModel[m].totalTurns += r.turns; byModel[m].withTurns++; }
            if (r.duration_seconds) { byModel[m].totalDuration += r.duration_seconds; byModel[m].withDuration++; }
        }
        const byModelOut: Record<string, any> = {};
        for (const [model, s] of Object.entries(byModel) as [string, any][]) {
            byModelOut[model] = {
                count: s.count,
                successRate: s.count > 0 ? s.successes / s.count : 0,
                avgCost: s.count > 0 ? s.totalCost / s.count : 0,
                avgTurns: s.withTurns > 0 ? s.totalTurns / s.withTurns : 0,
                avgDuration: s.withDuration > 0 ? s.totalDuration / s.withDuration : 0,
            };
        }

        // Per-project stats
        const byProject: Record<string, any> = {};
        for (const r of records) {
            const p = r.project_path;
            if (!byProject[p]) byProject[p] = { count: 0, successes: 0, totalCost: 0 };
            byProject[p].count++;
            if (r.success) byProject[p].successes++;
            byProject[p].totalCost += r.cost_usd || 0;
        }
        for (const p of Object.keys(byProject)) {
            byProject[p].successRate = byProject[p].count > 0 ? byProject[p].successes / byProject[p].count : 0;
            delete byProject[p].successes;
        }

        // Velocity: tasks per day (configurable lookback via ?days=)
        const now = new Date();
        const velocityDays = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
        const dailyCounts: Array<{ date: string; count: number }> = [];
        for (let i = 0; i < velocityDays; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const count = records.filter((r: any) => r.created_at && r.created_at.startsWith(dateStr)).length;
            dailyCounts.push({ date: dateStr, count });
        }
        const last3 = dailyCounts.slice(0, 3).reduce((s: number, d) => s + d.count, 0) / 3;
        const prev4 = dailyCounts.slice(3, 7).reduce((s: number, d) => s + d.count, 0) / 4;
        const trend = last3 > prev4 * 1.2 ? 'up' : last3 < prev4 * 0.8 ? 'down' : 'stable';

        // Cost optimisation suggestions
        const suggestions: any[] = [];
        // Group by (project, task_type, model)
        const groups: Record<string, Record<string, any>> = {};
        for (const r of records) {
            const key = `${r.project_path}|||${r.task_type || 'unknown'}`;
            if (!groups[key]) groups[key] = {};
            const m = r.model_used || 'unknown';
            if (!groups[key][m]) groups[key][m] = { count: 0, successes: 0, totalCost: 0 };
            groups[key][m].count++;
            if (r.success) groups[key][m].successes++;
            groups[key][m].totalCost += r.cost_usd || 0;
        }
        for (const [key, models] of Object.entries(groups)) {
            const [projectPath, taskType] = key.split('|||');
            // Check for downgrade opportunities: opus->sonnet, sonnet->haiku
            const downgrades: [string, string][] = [['opus', 'sonnet'], ['sonnet', 'haiku']];
            for (const [expensive, cheap] of downgrades) {
                const expStats = models[expensive];
                const cheapStats = models[cheap];
                if (!expStats || expStats.count < 5) continue;
                if (!cheapStats || cheapStats.count < 5) continue;
                const cheapRate = cheapStats.successes / cheapStats.count;
                if (cheapRate < 0.7) continue;
                const expAvg = expStats.totalCost / expStats.count;
                const cheapAvg = cheapStats.totalCost / cheapStats.count;
                if (cheapAvg >= expAvg) continue;
                suggestions.push({
                    type: 'model_downgrade',
                    project: projectPath,
                    taskType,
                    currentModel: expensive,
                    suggestedModel: cheap,
                    currentAvgCost: expAvg,
                    suggestedAvgCost: cheapAvg,
                    savingsPerTask: expAvg - cheapAvg,
                    cheapSuccessRate: cheapRate,
                    sampleSize: cheapStats.count,
                });
            }
        }

        res.json({
            success: true,
            global,
            byModel: byModelOut,
            byProject,
            velocity: { dailyCounts, trend, avgLast3Days: last3, avgPrev4Days: prev4 },
            suggestions,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/errors/:project -- Error patterns for a project from project memory
 */
router.get('/api/errors/:project', (req: Request<{ project: string }>, res: Response) => {
    try {
        const projectPath = decodeURIComponent(req.params.project);
        const { getRecentFailures } = require('../db');
        const patterns = getRecentFailures(projectPath);

        // Total failure stats
        const totalRow = db.prepare(
            'SELECT COUNT(*) as total, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures FROM project_memory WHERE project_path = ?'
        ).get(projectPath) as any;

        res.json({
            success: true,
            projectPath,
            patterns,
            totalFailures: totalRow.failures || 0,
            failureRate: totalRow.total > 0 ? (totalRow.failures || 0) / totalRow.total : 0,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/digest/latest -- Get the latest daily digest
 */
router.get('/api/digest/latest', (req: Request, res: Response) => {
    try {
        const digest = digestStmts.getLatest.get() as any;
        if (!digest) return res.json({ success: true, digest: null });
        if (!digest.viewed_at) {
            digestStmts.markViewed.run(new Date().toISOString(), digest.id);
            digest.viewed_at = new Date().toISOString();
        }
        digest.digest_json = JSON.parse(digest.digest_json || '{}');
        res.json({ success: true, digest });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/digest/:id -- Get a specific digest by ID
 */
router.get('/api/digest/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const digest = digestStmts.getById.get(req.params.id) as any;
        if (!digest) return res.status(404).json({ success: true, digest: null });
        digest.digest_json = JSON.parse(digest.digest_json || '{}');
        res.json({ success: true, digest });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/digest/generate -- Generate a new daily digest
 */
router.post('/api/digest/generate', (req: Request, res: Response) => {
    try {
        const since = req.query.since
            ? new Date(req.query.since as string)
            : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const digest = generateDailyDigest(since);
        if (!digest) return res.json({ success: true, digest: null, message: 'No activity in period' });
        res.json({ success: true, digest });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/digests -- List all digests (history)
 */
router.get('/api/digests', (req: Request, res: Response) => {
    try {
        const digests = digestStmts.list.all();
        res.json({ success: true, digests });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/weekly-report/latest -- Get the latest weekly report
 */
router.get('/api/weekly-report/latest', (req: Request, res: Response) => {
    try {
        const report = weeklyReportStmts.getLatest.get() as any;
        if (!report) return res.json({ success: true, report: null });
        if (!report.viewed_at) {
            weeklyReportStmts.markViewed.run(new Date().toISOString(), report.id);
            report.viewed_at = new Date().toISOString();
        }
        report.report_json = JSON.parse(report.report_json || '{}');
        res.json({ success: true, report });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/weekly-report/:id -- Get a specific weekly report by ID
 */
router.get('/api/weekly-report/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const report = weeklyReportStmts.getById.get(req.params.id) as any;
        if (!report) return res.status(404).json({ success: true, report: null });
        report.report_json = JSON.parse(report.report_json || '{}');
        res.json({ success: true, report });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/weekly-report/generate -- Generate a new weekly report
 */
router.post('/api/weekly-report/generate', (req: Request, res: Response) => {
    try {
        const since = req.query.since
            ? new Date(req.query.since as string)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const report = generateWeeklyReport(since);
        if (!report) return res.json({ success: true, report: null, message: 'No activity in period' });
        res.json({ success: true, report });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/weekly-reports -- List all weekly reports (history)
 */
router.get('/api/weekly-reports', (req: Request, res: Response) => {
    try {
        const reports = weeklyReportStmts.list.all();
        res.json({ success: true, reports });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/maintenance/runs -- List maintenance run history
 */
router.get('/api/maintenance/runs', (req: Request, res: Response) => {
    try {
        const runs = maintenanceStmts.list.all();
        res.json({ success: true, runs });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
