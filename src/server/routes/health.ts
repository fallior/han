/**
 * Health endpoints — currently surfaces Phase A.5 (DEC-083) integrity-failures
 * and identity-resign events. Future health surfaces (other integrity classes,
 * service heartbeats, etc.) extend this router.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const router = Router();

const HEALTH_DIR = path.join(os.homedir(), '.han', 'health');
const INTEGRITY_FAILURES_PATH = path.join(HEALTH_DIR, 'integrity-failures.jsonl');
const IDENTITY_RESIGN_PATH = path.join(HEALTH_DIR, 'identity-resign.jsonl');

function tailJsonl(filePath: string, limit: number): unknown[] {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const tail = lines.slice(-limit);
    const out: unknown[] = [];
    for (const line of tail) {
        try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return out.reverse();
}

/**
 * GET /api/health/integrity?limit=N
 *
 * Returns the most recent N integrity events:
 *   - failures: identity-file integrity halts (signature invalid, file added/removed,
 *     missing manifest/pubkey)
 *   - resigns: auto-resign events from option (iii) verify-and-resign
 *
 * Default limit: 50.
 */
router.get('/api/health/integrity', (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    res.json({
        failures: tailJsonl(INTEGRITY_FAILURES_PATH, limit),
        resigns: tailJsonl(IDENTITY_RESIGN_PATH, limit),
    });
});

export default router;
