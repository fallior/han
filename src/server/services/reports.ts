import { db, taskStmts, goalStmts, weeklyReportStmts } from '../db';
import { execFileSync } from 'node:child_process';

function generateId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Return the ISO week number for the given date.
 */
export function getISOWeek(date: Date): string {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return String(Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)).padStart(2, '0');
}

/**
 * Generate a weekly progress report aggregating 7 days of activity across all projects.
 * Captures per-task metadata (id, title, result, project, cost, commit_sha, completed_at) grouped by project.
 * Returns the report object or null if no activity in the period.
 */
export function generateWeeklyReport(weekStart: Date): { id: string; task_count: number; total_cost: number; report_text: string } | null {
    try {
        const periodStart = weekStart instanceof Date ? weekStart.toISOString() : weekStart;
        const periodEnd = new Date().toISOString();

        const projects = (db as any).prepare('SELECT * FROM projects').all();
        const projectData: Array<{
            name: string;
            tasks_completed: number;
            tasks_failed: number;
            cost: number;
            commits: string[];
            goals_completed: number;
        }> = [];
        let totalCompleted = 0;
        let totalFailed = 0;
        let totalCost = 0;
        let totalCommits = 0;

        // All tasks in the period (for daily breakdown)
        const allTasks: any[] = [];

        // Per-task metadata grouped by project
        const projectTasks: Record<string, Array<{
            id: string;
            title: string;
            result: string | null;
            project: string;
            cost: number;
            commit_sha: string | null;
            completed_at: string;
            status: string;
        }>> = {};

        for (const proj of projects) {
            const tasks = db.prepare(
                "SELECT * FROM tasks WHERE project_path = ? AND completed_at > ? AND status IN ('done', 'failed') ORDER BY completed_at ASC"
            ).all(proj.path, periodStart) as any[];

            if (tasks.length === 0) continue;

            const done = tasks.filter((t: any) => t.status === 'done');
            const failed = tasks.filter((t: any) => t.status === 'failed');
            const cost = tasks.reduce((sum: number, t: any) => sum + (t.cost_usd || 0), 0);
            const commits = tasks.filter((t: any) => t.commit_sha).map((t: any) => t.commit_sha.slice(0, 7));

            // Goals completed for this project in the period
            const goalsCompleted = (db.prepare(
                "SELECT COUNT(*) as count FROM goals WHERE project_path = ? AND completed_at > ? AND status = 'completed'"
            ).get(proj.path, periodStart) as any).count;

            // Build per-task metadata for this project
            projectTasks[proj.name] = tasks.map((t: any) => ({
                id: t.id,
                title: t.title,
                result: t.result || null,
                project: proj.name,
                cost: t.cost_usd || 0,
                commit_sha: t.commit_sha || null,
                completed_at: t.completed_at,
                status: t.status,
            }));

            totalCompleted += done.length;
            totalFailed += failed.length;
            totalCost += cost;
            totalCommits += commits.length;
            allTasks.push(...tasks);

            projectData.push({
                name: proj.name,
                tasks_completed: done.length,
                tasks_failed: failed.length,
                cost,
                commits,
                goals_completed: goalsCompleted,
            });
        }

        if (totalCompleted === 0 && totalFailed === 0) return null;

        // Daily breakdown (burndown data)
        const dailyBreakdown: Array<{ date: string; completed: number; failed: number }> = [];
        const startDate = new Date(periodStart);
        for (let i = 0; i < 7; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const completed = allTasks.filter((t: any) => t.status === 'done' && t.completed_at && t.completed_at.startsWith(dateStr)).length;
            const failed = allTasks.filter((t: any) => t.status === 'failed' && t.completed_at && t.completed_at.startsWith(dateStr)).length;
            dailyBreakdown.push({ date: dateStr, completed, failed });
        }

        // Goals completed in period
        const totalGoalsCompleted = (db.prepare(
            "SELECT COUNT(*) as count FROM goals WHERE completed_at > ? AND status = 'completed'"
        ).get(periodStart) as any).count;

        // Velocity: compare this week vs previous week
        const prevWeekStart = new Date(new Date(periodStart).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const prevWeekCount = (db.prepare(
            "SELECT COUNT(*) as count FROM tasks WHERE completed_at > ? AND completed_at <= ? AND status = 'done'"
        ).get(prevWeekStart, periodStart) as any).count;
        const trend = totalCompleted > prevWeekCount * 1.2 ? 'up' : totalCompleted < prevWeekCount * 0.8 ? 'down' : 'stable';

        const reportJson = {
            generated_at: periodEnd,
            week_start: periodStart,
            week_end: periodEnd,
            summary: {
                tasks_completed: totalCompleted,
                tasks_failed: totalFailed,
                goals_completed: totalGoalsCompleted,
                total_cost: totalCost,
                commits: totalCommits,
                projects_active: projectData.length,
            },
            daily_breakdown: dailyBreakdown,
            projects: projectData,
            velocity: { this_week: totalCompleted, prev_week: prevWeekCount, trend },
        };

        // Build per-task metadata structure
        const reportTasksJson = {
            generated_at: periodEnd,
            week_start: periodStart,
            week_end: periodEnd,
            summary: {
                total_tasks: allTasks.length,
                completed: totalCompleted,
                failed: totalFailed,
                total_cost: totalCost,
            },
            projects: Object.entries(projectTasks).map(([projectName, tasks]) => ({
                name: projectName,
                task_count: tasks.length,
                cost: tasks.reduce((sum, t) => sum + t.cost, 0),
                tasks: tasks,
            })),
        };

        // Build markdown text
        const weekOfStr = new Date(periodStart).toLocaleDateString();
        const lines: string[] = [
            `Week of ${weekOfStr}: ${totalCompleted} tasks completed across ${projectData.length} projects ($${totalCost.toFixed(4)}).${totalGoalsCompleted > 0 ? ` ${totalGoalsCompleted} goals completed.` : ''}`,
            ``,
            `## Daily Breakdown`,
            ``,
            `| Day | Completed | Failed |`,
            `|-----|-----------|--------|`,
        ];

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (const d of dailyBreakdown) {
            const dayName = dayNames[new Date(d.date + 'T12:00:00').getDay()];
            lines.push(`| ${dayName} ${d.date} | ${d.completed} | ${d.failed} |`);
        }

        lines.push(``, `## Velocity`, ``);
        lines.push(`- This week: ${totalCompleted} tasks (prev week: ${prevWeekCount}) — trend: ${trend}`);

        lines.push(``, `## Projects`, ``);
        for (const p of projectData) {
            lines.push(`### ${p.name}`);
            lines.push(`- ${p.tasks_completed} completed, ${p.tasks_failed} failed — $${p.cost.toFixed(4)}`);
            if (p.commits.length > 0) lines.push(`- Commits: ${p.commits.join(', ')}`);
            if (p.goals_completed > 0) lines.push(`- Goals completed: ${p.goals_completed}`);
            lines.push(``);
        }

        const reportText = lines.join('\n');
        const id = generateId();

        weeklyReportStmts.insert.run(id, periodEnd, periodStart, periodEnd, reportText, JSON.stringify(reportJson), JSON.stringify(reportTasksJson), totalCompleted + totalFailed, totalCost);

        return { id, task_count: totalCompleted + totalFailed, total_cost: totalCost, report_text: reportText };
    } catch (err: any) {
        console.error('[WeeklyReport] Generation failed:', err.message);
        return null;
    }
}

/**
 * Check whether this week's report should be generated based on the configured
 * weekly_report_day (0=Sunday) and weekly_report_hour. Sends a push notification
 * via ntfy.sh if configured. Checks the database to survive server restarts.
 */
export function checkWeeklyReportSchedule(config: any): { id: string; task_count: number; total_cost: number; report_text: string } | null {
    const reportDay = parseInt((config.weekly_report_day || '0'), 10);  // 0=Sunday
    const reportHour = parseInt((config.weekly_report_hour || '8'), 10);
    const now = new Date();

    if (now.getDay() !== reportDay) return null;
    if (now.getHours() < reportHour) return null;

    // Check DB for this week's reports — survives server restarts
    const weekStr = `${now.getFullYear()}-W${getISOWeek(now)}`;
    const latest = weeklyReportStmts.getLatest.get() as any;
    if (latest && latest.generated_at) {
        const latestDate = new Date(latest.generated_at);
        const latestWeekStr = `${latestDate.getFullYear()}-W${getISOWeek(latestDate)}`;
        if (latestWeekStr === weekStr) return null;
    }

    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const report = generateWeeklyReport(weekStart);
    if (report) {
        if (config.ntfy_topic) {
            try {
                execFileSync('curl', ['-s', '-d', report.report_text.split('\n')[0], '-H', 'Title: Hortus Arbor Nostra Weekly Report', '-H', 'Priority: default', '-H', 'Tags: bar_chart', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
            } catch {}
        }
        console.log(`[WeeklyReport] Generated: ${report.task_count} tasks, $${report.total_cost.toFixed(4)}`);
    }
    return report;
}
