/**
 * Supervisor API routes
 * GET  /status     — Current supervisor state
 * GET  /cycles     — Recent cycle history
 * GET  /memory     — All memory bank contents
 * GET  /memory/:file — Specific memory file
 * POST /trigger    — Manually trigger a cycle
 * POST /pause      — Pause/resume automatic cycles
 */

import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, CLAUDE_REMOTE_DIR, supervisorStmts, strategicProposalStmts } from '../db';
import {
    runSupervisorCycle, setSupervisorPaused, isSupervisorPaused,
    isSupervisorEnabled
} from '../services/supervisor';
import { createGoal } from '../services/planning';

const router = Router();
const MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory');

// GET /status — Current supervisor state
router.get('/status', (_req: Request, res: Response) => {
    try {
        const latest = supervisorStmts.getLatest.get() as any;
        const enabled = isSupervisorEnabled();
        const paused = isSupervisorPaused();

        // Memory file sizes
        const memoryFiles: Record<string, number> = {};
        try {
            const files = ['identity.md', 'active-context.md', 'patterns.md', 'failures.md', 'self-reflection.md'];
            for (const f of files) {
                const fp = path.join(MEMORY_DIR, f);
                if (fs.existsSync(fp)) {
                    memoryFiles[f] = fs.statSync(fp).size;
                }
            }
            // Project files
            const projDir = path.join(MEMORY_DIR, 'projects');
            if (fs.existsSync(projDir)) {
                for (const f of fs.readdirSync(projDir)) {
                    if (f.endsWith('.md')) {
                        memoryFiles[`projects/${f}`] = fs.statSync(path.join(projDir, f)).size;
                    }
                }
            }
        } catch { /* skip */ }

        res.json({
            success: true,
            enabled,
            paused,
            last_cycle: latest ? {
                id: latest.id,
                started_at: latest.started_at,
                completed_at: latest.completed_at,
                cost_usd: latest.cost_usd,
                num_turns: latest.num_turns,
                cycle_number: latest.cycle_number,
                error: latest.error,
                actions: latest.actions_taken ? JSON.parse(latest.actions_taken) : [],
                observations: latest.observations ? JSON.parse(latest.observations) : [],
            } : null,
            memory_files: memoryFiles,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /cycles — Recent cycle history
router.get('/cycles', (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const cycles = supervisorStmts.getRecent.all(limit) as any[];

        const formatted = cycles.map((c: any) => ({
            id: c.id,
            cycle_number: c.cycle_number,
            started_at: c.started_at,
            completed_at: c.completed_at,
            cost_usd: c.cost_usd,
            num_turns: c.num_turns,
            error: c.error,
            actions: c.actions_taken ? JSON.parse(c.actions_taken) : [],
            observations: c.observations ? JSON.parse(c.observations) : [],
            reasoning: c.reasoning,
        }));

        res.json({ success: true, cycles: formatted });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /memory — All memory bank contents
router.get('/memory', (_req: Request, res: Response) => {
    try {
        const memory: Record<string, string> = {};
        const files = ['identity.md', 'active-context.md', 'patterns.md', 'failures.md', 'self-reflection.md'];

        for (const f of files) {
            const fp = path.join(MEMORY_DIR, f);
            if (fs.existsSync(fp)) {
                memory[f] = fs.readFileSync(fp, 'utf8');
            }
        }

        // Project files
        const projDir = path.join(MEMORY_DIR, 'projects');
        if (fs.existsSync(projDir)) {
            for (const f of fs.readdirSync(projDir)) {
                if (f.endsWith('.md')) {
                    memory[`projects/${f}`] = fs.readFileSync(path.join(projDir, f), 'utf8');
                }
            }
        }

        res.json({ success: true, memory });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /memory/:file — Specific memory file (supports projects/name.md via query)
router.get('/memory/:file', (req: Request, res: Response) => {
    try {
        const filename = String(req.params.file);
        const subdir = String(req.query.subdir || '');

        // Sanitise to prevent directory traversal
        const safeName = filename.replace(/\.\./g, '').replace(/^\//, '');
        const filepath = subdir
            ? path.join(MEMORY_DIR, subdir.replace(/\.\./g, ''), safeName)
            : path.join(MEMORY_DIR, safeName);

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ success: false, error: 'Memory file not found' });
        }

        const content = fs.readFileSync(filepath, 'utf8');
        res.json({ success: true, file: safeName, content });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /trigger — Manually trigger a supervisor cycle
router.post('/trigger', async (_req: Request, res: Response) => {
    try {
        const result = await runSupervisorCycle();
        if (!result) {
            return res.json({ success: true, message: 'Cycle skipped (disabled, paused, or budget exhausted)' });
        }
        res.json({
            success: true,
            cycle_id: result.cycleId,
            observations: result.observations,
            actions: result.actionSummaries,
            cost_usd: result.costUsd,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /pause — Pause or resume automatic cycles
router.post('/pause', (req: Request, res: Response) => {
    try {
        const { paused } = req.body;
        if (typeof paused !== 'boolean') {
            return res.status(400).json({ success: false, error: 'paused must be a boolean' });
        }
        setSupervisorPaused(paused);
        res.json({ success: true, paused });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /activity — Aggregated activity feed from supervisor cycles, goals, tasks, proposals
router.get('/activity', (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const since = req.query.since as string || null;

        const events: any[] = [];

        // Supervisor cycles
        const cycles = since
            ? db.prepare('SELECT * FROM supervisor_cycles WHERE started_at > ? ORDER BY started_at DESC LIMIT ?').all(since, limit) as any[]
            : supervisorStmts.getRecent.all(limit) as any[];

        for (const c of cycles) {
            events.push({
                type: 'supervisor_cycle',
                id: c.id,
                timestamp: c.started_at,
                title: `Cycle #${c.cycle_number}`,
                status: c.error ? 'failed' : (c.completed_at ? 'completed' : 'running'),
                cost_usd: c.cost_usd,
                detail: {
                    observations: c.observations ? JSON.parse(c.observations) : [],
                    actions: c.actions_taken ? JSON.parse(c.actions_taken) : [],
                    reasoning: c.reasoning,
                    num_turns: c.num_turns,
                    error: c.error,
                },
            });
        }

        // Goals
        const goalsQuery = since
            ? 'SELECT * FROM goals WHERE created_at > ? ORDER BY created_at DESC LIMIT ?'
            : 'SELECT * FROM goals ORDER BY created_at DESC LIMIT ?';
        const goalsParams = since ? [since, limit] : [limit];
        const goals = db.prepare(goalsQuery).all(...goalsParams) as any[];

        for (const g of goals) {
            const project = g.project_path?.split('/').pop() || '?';
            events.push({
                type: 'goal',
                id: g.id,
                timestamp: g.created_at,
                title: (g.description || '').slice(0, 80),
                status: g.status,
                project: project,
                detail: {
                    task_count: g.task_count,
                    tasks_completed: g.tasks_completed,
                    tasks_failed: g.tasks_failed,
                    total_cost_usd: g.total_cost_usd,
                    project_path: g.project_path,
                },
            });
        }

        // Tasks (recent completions and active)
        const tasksQuery = since
            ? "SELECT * FROM tasks WHERE created_at > ? OR started_at > ? ORDER BY COALESCE(started_at, created_at) DESC LIMIT ?"
            : "SELECT * FROM tasks WHERE status IN ('running', 'done', 'failed') ORDER BY COALESCE(completed_at, started_at, created_at) DESC LIMIT ?";
        const tasksParams = since ? [since, since, limit] : [limit];
        const tasks = db.prepare(tasksQuery).all(...tasksParams) as any[];

        for (const t of tasks) {
            const project = t.project_path?.split('/').pop() || '?';
            events.push({
                type: 'task',
                id: t.id,
                timestamp: t.completed_at || t.started_at || t.created_at,
                title: t.title,
                status: t.status,
                project: project,
                detail: {
                    model: t.model,
                    cost_usd: t.cost_usd,
                    turns: t.turns,
                    goal_id: t.goal_id,
                    error: t.error,
                },
            });
        }

        // Strategic proposals
        const proposalsQuery = since
            ? 'SELECT * FROM supervisor_proposals WHERE created_at > ? ORDER BY created_at DESC LIMIT ?'
            : 'SELECT * FROM supervisor_proposals ORDER BY created_at DESC LIMIT ?';
        const proposalsParams = since ? [since, limit] : [limit];
        const proposals = db.prepare(proposalsQuery).all(...proposalsParams) as any[];

        for (const p of proposals) {
            events.push({
                type: 'proposal',
                id: p.id,
                timestamp: p.created_at,
                title: p.title,
                status: p.status,
                project: p.project_path?.split('/').pop() || null,
                detail: {
                    description: p.description,
                    category: p.category,
                    estimated_effort: p.estimated_effort,
                    supervisor_reasoning: p.supervisor_reasoning,
                },
            });
        }

        // Sort all events by timestamp descending
        events.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

        res.json({ success: true, events: events.slice(0, limit) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /proposals — List strategic proposals
router.get('/proposals', (req: Request, res: Response) => {
    try {
        const status = req.query.status as string;
        const proposals = status
            ? strategicProposalStmts.listByStatus.all(status) as any[]
            : strategicProposalStmts.list.all() as any[];

        res.json({ success: true, proposals });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /proposals/:id/approve — Approve a proposal, creating a goal
router.post('/proposals/:id/approve', (req: Request, res: Response) => {
    try {
        const proposal = strategicProposalStmts.get.get(req.params.id) as any;
        if (!proposal) {
            return res.status(404).json({ success: false, error: 'Proposal not found' });
        }
        if (proposal.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Proposal is already ${proposal.status}` });
        }

        // Create a goal from the proposal
        const goalId = createGoal(
            proposal.description,
            proposal.project_path || process.cwd(),
            true,
            null,
            'standalone',
            null
        );

        // Update proposal status
        strategicProposalStmts.updateStatus.run(
            'approved',
            new Date().toISOString(),
            req.body.notes || null,
            goalId,
            proposal.id
        );

        res.json({ success: true, proposal_id: proposal.id, goal_id: goalId });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /proposals/:id/dismiss — Dismiss a proposal
router.post('/proposals/:id/dismiss', (req: Request, res: Response) => {
    try {
        const proposal = strategicProposalStmts.get.get(req.params.id) as any;
        if (!proposal) {
            return res.status(404).json({ success: false, error: 'Proposal not found' });
        }
        if (proposal.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Proposal is already ${proposal.status}` });
        }

        strategicProposalStmts.updateStatus.run(
            'dismissed',
            new Date().toISOString(),
            req.body.notes || null,
            null,
            proposal.id
        );

        res.json({ success: true, proposal_id: proposal.id });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
