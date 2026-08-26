/**
 * coordination-pre-work.ts — R3c-HB S1: the coordinator beat's board maintenance, as a
 * lib LEAF. Singleton-scoped by the CALLER (only the supervisor beat runs it, and only
 * one roster may hold that beat — the exactly-one law), so the sweep can never race
 * itself (Tenshi's double-coordinator deathmatch, prevented by construction).
 *
 * Ported from supervisor-worker.ts (`cleanupPhantomGoals` :565-634). Port findings,
 * named for the audit (every port is an audit of the thing ported):
 *  - `detectAndRecoverGhostTasks` (:640-657) is NOT ported: its worker body was already
 *    a delegated no-op — "we can't check runningSlots (that's in parent process)… just
 *    count them but don't recover" — and it counted nothing either (returns 0 before
 *    the count is used). Porting it would be a costume wearing a capability's name.
 *    Real ghost-task recovery is parent-machinery (runningSlots) that dies with the
 *    parent at the flip; if wanted, it returns as a designed feature with an owner,
 *    not a carried stub. (The plan's PORT disposition for this half corrects to
 *    RETIRE-with-ground at the audit.)
 *  - The phantom-goal sweep ports WHOLE: terminal-children parents, terminal-task
 *    standalones, stuck-decomposing timeouts — same SQL, shared db handle.
 */
import { db, goalStmts } from '../db';

/** Phantom-goal cleanup — goals whose children/tasks are all terminal, or stuck
 *  decomposing >1h. Returns the number cleaned. Coordinator-only by caller contract. */
export function cleanupPhantomGoals(log: (msg: string) => void = console.log): number {
    let fixed = 0;
    const now = new Date();
    try {
        // 1. Parent goals where ALL children are terminal (done/failed/cancelled)
        const parentGoals = db.prepare(`
            SELECT g.id FROM goals g
            WHERE g.goal_type = 'parent'
            AND g.status = 'active'
            AND NOT EXISTS (
                SELECT 1 FROM goals c
                WHERE c.parent_goal_id = g.id
                AND c.status NOT IN ('done', 'failed', 'cancelled')
            )
        `).all() as any[];
        for (const g of parentGoals) {
            goalStmts.updateProgress.run(0, 0, 0, 'failed', now.toISOString(), g.id);
            log(`[coordination] cleaned phantom parent goal: ${g.id}`);
            fixed++;
        }

        // 2. Standalone goals where ALL tasks are terminal
        const staleGoals = db.prepare(`
            SELECT g.id FROM goals g
            WHERE g.status = 'active'
            AND g.goal_type != 'parent'
            AND EXISTS (SELECT 1 FROM tasks t WHERE t.goal_id = g.id)
            AND NOT EXISTS (
                SELECT 1 FROM tasks t
                WHERE t.goal_id = g.id
                AND t.status NOT IN ('done', 'failed', 'cancelled')
            )
        `).all() as any[];
        for (const g of staleGoals) {
            goalStmts.updateProgress.run(0, 0, 0, 'failed', now.toISOString(), g.id);
            log(`[coordination] recalculated phantom goal: ${g.id}`);
            fixed++;
        }

        // 3. Goals stuck in 'decomposing' for more than 1 hour
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const stuckDecomposing = db.prepare(`
            SELECT id FROM goals
            WHERE status = 'decomposing'
            AND created_at < ?
        `).all(oneHourAgo) as any[];
        for (const g of stuckDecomposing) {
            goalStmts.updateStatus.run('failed', g.id);
            log(`[coordination] cleaned stuck decomposing goal: ${g.id} (timeout)`);
            fixed++;
        }
    } catch (err: any) {
        console.error('[coordination] phantom goal cleanup failed:', err.message);
    }
    if (fixed > 0) log(`[coordination] phantom goal cleanup: ${fixed} cleaned`);
    return fixed;
}
