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
import { CLAUDE_REMOTE_DIR, supervisorStmts } from '../db';
import {
    runSupervisorCycle, setSupervisorPaused, isSupervisorPaused,
    isSupervisorEnabled
} from '../services/supervisor';

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

export default router;
