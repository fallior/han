/**
 * routes/board.ts — K1: the wall's read-only feed (kanban-wall-plan.md).
 *
 * ONE consumer path: everything comes through `parseBoard()` (K0, the one source —
 * Tenshi's doctrine: the gate consumes the same object the actor consumes; a second
 * board-reading path is a defect). This route SERIALISES; it never re-parses, never
 * filters silently (UNPARSEABLE and the reconciliation ride along so the wall can
 * show its own honesty), and never writes anything (non-goal #3: read-only, zero state).
 *
 * The hearth lane (Darron's ruling 2026-08-18: rides prototype 1) is the seat's own
 * recent activity — pulse/checkout counters + the session pool + tick-plan headings —
 * so the night's quiet work is perusable rather than scrolled.
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseBoard } from '../lib/board-parser';

const router = Router();

const HEALTH = path.join(os.homedir(), '.han', 'health');
const POOL = path.join(os.homedir(), '.han', 'pool');
const PLANS = path.join(os.homedir(), 'Projects', 'han', 'plans');

interface HearthCounterRow { ts: string; kind: string; [k: string]: unknown }

function readHearthCounters(limit: number): HearthCounterRow[] {
    try {
        const lines = fs.readFileSync(path.join(HEALTH, 'hearth-counters.jsonl'), 'utf-8')
            .trim().split('\n');
        const interesting = new Set(['pulse-fire', 'session-checkout', 'session-pulse-due', 'session-pulse-would-push']);
        const rows: HearthCounterRow[] = [];
        for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
            try {
                const r = JSON.parse(lines[i]);
                if (interesting.has(r.kind)) rows.push(r);
            } catch { /* torn tail line — skip */ }
        }
        return rows;
    } catch { return []; }
}

/** K1-M1 (Jim's diff-audit, 2026-08-20): enumerate EVERY agent's session pool — the prior
 *  `readSessionPool('leo')` was a hardcoded slug in cross-agent infrastructure, the DEC-081
 *  governing-law smell verbatim (a 4th agent would not get the hearth lane for free). The
 *  filesystem is the roster here: `pool-*-session.json` is written per-slug by each agent's
 *  own pool-manager, so globbing it IS the agnostic resolution — no slug list to maintain. */
function readSessionPools(): Record<string, unknown> {
    try {
        const pools: Record<string, unknown> = {};
        for (const f of fs.readdirSync(POOL)) {
            const m = f.match(/^pool-(.+)-session\.json$/);
            if (!m) continue;
            try { pools[m[1]] = JSON.parse(fs.readFileSync(path.join(POOL, f), 'utf-8')); }
            catch { pools[m[1]] = null; }
        }
        return pools;
    } catch { return {}; }
}

/** Tick-plan cards: `## ` headings from the fi-top-ten plan files (the night watches). */
function readTickPlans(): { file: string; headings: string[] }[] {
    try {
        return fs.readdirSync(PLANS)
            .filter(f => /^fi-top-ten-\d{4}-\d{2}-\d{2}\.md$/.test(f))
            .sort().reverse().slice(0, 3)
            .map(file => {
                const text = fs.readFileSync(path.join(PLANS, file), 'utf-8');
                const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim()).slice(0, 20);
                return { file, headings };
            });
    } catch { return []; }
}

router.get('/api/board', (_req: Request, res: Response) => {
    try {
        const board = parseBoard();
        res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            source: board.source,
            reconciliation: board.reconciliation,
            entries: board.entries.map(e => ({
                // The card fields (body deliberately EXCLUDED from the list payload —
                // links never copies; the card points at the journal, it does not
                // become a second home for its content. K1 renders pointers.)
                id: e.id, num: e.num, suffix: e.suffix, title: e.title, date: e.date,
                effectiveState: e.effectiveState,
                statusRaw: e.status?.raw ?? null,
                lastStatusRaw: [...(e.status ? [e.status] : []), ...e.statusUpdates].slice(-1)[0]?.raw ?? null,
                updates: e.statusUpdates.length,
                severity: e.severity ?? null,
                owner: e.ministerial.heldFor ?? e.owner ?? null,
                resumeWhen: e.parked?.resumeWhen ?? null,
                line: e.line,
                links: e.links,
                blockedBy: e.blockedBy,
            })),
            unparseable: board.unparseable.map(u => ({ line: u.line, headerText: u.headerText })),
            backlinks: Object.fromEntries(board.backlinks),
            hearth: {
                counters: readHearthCounters(40),
                sessionPools: readSessionPools(), // K1-M1: all agents, slug-keyed (DEC-081)
                tickPlans: readTickPlans(),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
    }
});

export default router;
