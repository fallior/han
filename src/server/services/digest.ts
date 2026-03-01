import { db, taskStmts, goalStmts, digestStmts } from '../db';

function generateId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Generate a daily digest summarising completed/failed tasks across all projects
 * since the given date. Inserts the digest into the database and returns summary info.
 */
export function generateDailyDigest(since: Date): { id: string; task_count: number; total_cost: number; digest_text: string } | null {
    try {
        const periodStart = since instanceof Date ? since.toISOString() : since;
        const periodEnd = new Date().toISOString();

        const projects = (db as any).prepare('SELECT * FROM projects').all();
        const projectData: Array<{
            name: string;
            tasks_completed: number;
            tasks_failed: number;
            cost: number;
            commits: string[];
            failures: Array<{ title: string; error: string }>;
        }> = [];
        const tasksArray: Array<{
            id: string;
            title: string;
            status: string;
            project: string;
            result: string | null;
            cost: number;
            commit_sha: string | null;
            completed_at: string;
        }> = [];
        let totalCompleted = 0;
        let totalFailed = 0;
        let totalCost = 0;
        let totalCommits = 0;

        for (const proj of projects) {
            const tasks = db.prepare(
                "SELECT * FROM tasks WHERE project_path = ? AND completed_at > ? AND status IN ('done', 'failed') ORDER BY completed_at ASC"
            ).all(proj.path, periodStart) as any[];

            if (tasks.length === 0) continue;

            const done = tasks.filter((t: any) => t.status === 'done');
            const failed = tasks.filter((t: any) => t.status === 'failed');
            const cost = tasks.reduce((sum: number, t: any) => sum + (t.cost_usd || 0), 0);
            const commits = tasks.filter((t: any) => t.commit_sha).map((t: any) => t.commit_sha.slice(0, 7));

            totalCompleted += done.length;
            totalFailed += failed.length;
            totalCost += cost;
            totalCommits += commits.length;

            projectData.push({
                name: proj.name,
                tasks_completed: done.length,
                tasks_failed: failed.length,
                cost,
                commits,
                failures: failed.map((t: any) => ({ title: t.title, error: (t.error || '').slice(0, 200) })),
            });

            // Capture per-task metadata for UI expansion
            for (const task of tasks) {
                tasksArray.push({
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    project: proj.name,
                    result: task.result || null,
                    cost: task.cost_usd || 0,
                    commit_sha: task.commit_sha || null,
                    completed_at: task.completed_at,
                });
            }
        }

        // Skip if no activity
        if (totalCompleted === 0 && totalFailed === 0) return null;

        const digestJson = {
            generated_at: periodEnd,
            period_start: periodStart,
            period_end: periodEnd,
            summary: {
                tasks_completed: totalCompleted,
                tasks_failed: totalFailed,
                total_cost: totalCost,
                commits: totalCommits,
                projects_active: projectData.length,
            },
            projects: projectData,
            tasks: tasksArray,
        };

        // Build markdown text
        const sinceStr = new Date(periodStart).toLocaleString();
        const lines: string[] = [
            `Since ${sinceStr}: ${totalCompleted} tasks completed across ${projectData.length} projects ($${totalCost.toFixed(4)}).${totalFailed > 0 ? ` ${totalFailed} failures awaiting review.` : ''}`,
            ``,
        ];

        for (const p of projectData) {
            lines.push(`### ${p.name}`);
            lines.push(`- ${p.tasks_completed} completed, ${p.tasks_failed} failed — $${p.cost.toFixed(4)}`);
            if (p.commits.length > 0) lines.push(`- Commits: ${p.commits.join(', ')}`);
            if (p.failures.length > 0) {
                for (const f of p.failures) {
                    lines.push(`- FAILED: ${f.title}${f.error ? ` — ${f.error.slice(0, 100)}` : ''}`);
                }
            }
            lines.push(``);
        }

        const digestText = lines.join('\n');
        const id = generateId();

        digestStmts.insert.run(id, periodEnd, periodStart, periodEnd, digestText, JSON.stringify(digestJson), totalCompleted + totalFailed, totalCost);

        return { id, task_count: totalCompleted + totalFailed, total_cost: totalCost, digest_text: digestText };
    } catch (err: any) {
        console.error('[Digest] Generation failed:', err.message);
        return null;
    }
}

/**
 * Check whether today's daily digest should be generated based on the configured
 * digest_hour. Checks the database for today's digests to survive server restarts.
 */
export function checkDigestSchedule(config: any): { id: string; task_count: number; total_cost: number; digest_text: string } | null {
    const digestHour = parseInt((config.digest_hour || '7'), 10);
    const now = new Date();

    if (now.getHours() < digestHour) return null;

    // Check DB for today's digests — survives server restarts
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const latest = digestStmts.getLatest.get() as any;
    if (latest && latest.generated_at && latest.generated_at.startsWith(todayStr)) {
        return null;
    }

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const digest = generateDailyDigest(since);
    if (digest) {
        console.log(`[Digest] Daily digest generated: ${digest.task_count} tasks, $${digest.total_cost.toFixed(4)}`);
    }
    return digest;
}
