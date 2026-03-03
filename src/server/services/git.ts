import { execFileSync } from 'node:child_process';
import { db, portfolioStmts } from '../db';

interface Task {
    id: string;
    title: string;
    model: string;
    cost_usd?: number;
    goal_id?: string;
    priority?: number;
    deadline?: string;
    project_path: string;
    [key: string]: unknown;
}

interface Project {
    name: string;
    priority?: number;
    cost_budget_daily: number;
    cost_budget_total: number;
    cost_spent_today: number;
    cost_spent_total: number;
    [key: string]: unknown;
}

interface Checkpoint {
    ref: string | null;
    type: 'branch' | 'stash' | 'none';
}

interface CommitResult {
    committed: boolean;
    sha: string | null;
    filesChanged: string[];
}

/**
 * Check if a directory is a git repository
 */
export function isGitRepo(projectPath: string): boolean {
    try {
        execFileSync('git', ['rev-parse', '--git-dir'], {
            cwd: projectPath,
            stdio: 'ignore'
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if there are uncommitted changes in the working tree
 */
export function hasUncommittedChanges(projectPath: string): boolean {
    try {
        const output = execFileSync('git', ['status', '--porcelain'], {
            cwd: projectPath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return output.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * Create a git checkpoint before task execution
 * Returns { ref, type } where type is 'branch', 'stash', or 'none'
 */
export function createCheckpoint(projectPath: string, taskId: string): Checkpoint {
    const isDirty = hasUncommittedChanges(projectPath);

    if (isDirty) {
        // Dirty working tree — create stash
        const stashMessage = `claude-remote checkpoint ${taskId}`;
        try {
            execFileSync('git', ['stash', 'push', '-u', '-m', stashMessage], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Created stash checkpoint for task ${taskId}`);
            return { ref: stashMessage, type: 'stash' };
        } catch (err: any) {
            console.error(`[Git] Failed to create stash:`, err.message);
            return { ref: null, type: 'none' };
        }
    } else {
        // Clean working tree — create branch
        const branchName = `claude-remote/checkpoint-${taskId}`;
        try {
            execFileSync('git', ['branch', branchName], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Created branch checkpoint: ${branchName}`);
            return { ref: branchName, type: 'branch' };
        } catch (err: any) {
            console.error(`[Git] Failed to create branch:`, err.message);
            return { ref: null, type: 'none' };
        }
    }
}

/**
 * Rollback to a git checkpoint after task failure
 */
export function rollbackCheckpoint(projectPath: string, checkpointRef: string | null, checkpointType: string): void {
    if (!checkpointRef || checkpointType === 'none') return;

    try {
        if (checkpointType === 'stash') {
            // Find the stash by message and pop it
            const stashList = execFileSync('git', ['stash', 'list'], {
                cwd: projectPath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            });

            const lines = stashList.trim().split('\n');
            for (const line of lines) {
                if (line.includes(checkpointRef)) {
                    const match = line.match(/^(stash@\{\d+\})/);
                    if (match) {
                        // Reset working tree and apply stash
                        execFileSync('git', ['reset', '--hard'], {
                            cwd: projectPath,
                            stdio: 'ignore'
                        });
                        execFileSync('git', ['stash', 'pop', match[1]], {
                            cwd: projectPath,
                            stdio: 'ignore'
                        });
                        console.log(`[Git] Rolled back to stash: ${checkpointRef}`);
                        return;
                    }
                }
            }
        } else if (checkpointType === 'branch') {
            // Reset to the branch
            execFileSync('git', ['reset', '--hard', checkpointRef], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Rolled back to branch: ${checkpointRef}`);
        }
    } catch (err: any) {
        console.error(`[Git] Rollback failed:`, err.message);
    }
}

/**
 * Commit task changes after successful completion.
 * Ensures each task's work persists in git history so sequential
 * tasks in a goal can build on each other's changes.
 */
export function commitTaskChanges(projectPath: string, task: Task): CommitResult {
    try {
        if (!hasUncommittedChanges(projectPath)) {
            console.log(`[Git] No changes to commit for task ${task.id}`);
            return { committed: false, sha: null, filesChanged: [] };
        }

        // Stage all changes
        execFileSync('git', ['add', '-A'], {
            cwd: projectPath,
            stdio: 'ignore'
        });

        // Detect semantic commit prefix from task title
        const titleLower = task.title.toLowerCase();
        let prefix = 'chore';
        if (/\b(add|create|implement|build|new)\b/.test(titleLower)) prefix = 'feat';
        else if (/\b(fix|repair|resolve|correct|bug)\b/.test(titleLower)) prefix = 'fix';
        else if (/\b(update|improve|enhance|optimise|optimize|refactor)\b/.test(titleLower)) prefix = 'refactor';
        else if (/\b(doc|comment|readme)\b/.test(titleLower)) prefix = 'docs';
        else if (/\b(test|spec)\b/.test(titleLower)) prefix = 'test';

        const message = `${prefix}: ${task.title}\n\nTask: ${task.id}\nModel: ${task.model}\nCost: $${(task.cost_usd || 0).toFixed(4)}${task.goal_id ? `\nGoal: ${task.goal_id}` : ''}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
        execFileSync('git', ['commit', '-m', message], {
            cwd: projectPath,
            stdio: 'ignore'
        });

        // Capture commit SHA
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: projectPath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();

        // Capture files changed in this commit
        let filesChanged: string[] = [];
        try {
            const diffOutput = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
                cwd: projectPath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            });
            filesChanged = diffOutput.trim().split('\n').filter(Boolean);
        } catch {
            try {
                const lsOutput = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
                    cwd: projectPath,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore']
                });
                filesChanged = lsOutput.trim().split('\n').filter(Boolean);
            } catch { /* best effort */ }
        }

        console.log(`[Git] Committed changes for task: ${task.title} (${task.id}) [${sha.slice(0, 7)}]`);
        return { committed: true, sha, filesChanged };
    } catch (err: any) {
        console.error(`[Git] Commit failed for task ${task.id}:`, err.message);
        return { committed: false, sha: null, filesChanged: [] };
    }
}

/**
 * Clean up a git checkpoint after successful task completion
 */
export function cleanupCheckpoint(projectPath: string, checkpointRef: string | null, checkpointType: string): void {
    if (!checkpointRef || checkpointType === 'none') return;

    try {
        if (checkpointType === 'branch') {
            // Delete the checkpoint branch
            execFileSync('git', ['branch', '-D', checkpointRef], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Cleaned up checkpoint branch: ${checkpointRef}`);
        } else if (checkpointType === 'stash') {
            // Pop the stash to restore pre-existing work
            const stashList = execFileSync('git', ['stash', 'list'], {
                cwd: projectPath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            });

            const lines = stashList.trim().split('\n');
            for (const line of lines) {
                if (line.includes(checkpointRef)) {
                    const match = line.match(/^(stash@\{\d+\})/);
                    if (match) {
                        try {
                            execFileSync('git', ['stash', 'pop', match[1]], {
                                cwd: projectPath,
                                stdio: 'ignore'
                            });
                            console.log(`[Git] Cleaned up checkpoint stash: ${checkpointRef}`);
                        } catch (err: any) {
                            // Stash pop failed (likely merge conflict) — leave stash in place
                            console.warn(`[Git] Stash pop had conflicts — leaving stash in place for manual resolution`);
                        }
                        return;
                    }
                }
            }
        }
    } catch (err: any) {
        console.error(`[Git] Cleanup failed:`, err.message);
    }
}

/**
 * Recalculate project costs from task data and set throttle flag.
 */
export function recalcProjectCosts(projectPath: string): void {
    const project = portfolioStmts.getByPath.get(projectPath) as Project | undefined;
    if (!project) return;
    const today = new Date().toISOString().slice(0, 10);
    const dailyRow = db.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as total FROM tasks WHERE project_path = ? AND status = 'done' AND date(completed_at) = ?`
    ).get(projectPath, today) as { total: number };
    const totalRow = db.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as total FROM tasks WHERE project_path = ?`
    ).get(projectPath) as { total: number };
    const dailySpend = dailyRow.total;
    const totalSpend = totalRow.total;
    const overDaily = project.cost_budget_daily > 0 && dailySpend >= project.cost_budget_daily;
    const overTotal = project.cost_budget_total > 0 && totalSpend >= project.cost_budget_total;
    const throttled = (overDaily || overTotal) ? 1 : 0;
    portfolioStmts.updateCosts.run(dailySpend, totalSpend, today, throttled, project.name);
    if (throttled) console.log(`[Portfolio] Project throttled: ${project.name}`);
}

/**
 * Calculate priority score for task scheduling.
 * Considers task priority, project priority, deadline proximity, and budget headroom.
 */
export function calculatePriorityScore(task: Task, project?: Project | null): number {
    let score = (task.priority || 0) * 10;
    score += ((project?.priority || 5)) * 5;
    if (task.deadline) {
        const deadline = new Date(task.deadline);
        const daysUntil = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
        if (daysUntil <= 0) score += 50;
        else if (daysUntil <= 3) score += 25;
        else if (daysUntil <= 7) score += 10;
    }
    if (!project || project.cost_budget_daily === 0) {
        score += 5;
    } else if (project.cost_spent_today / project.cost_budget_daily <= 0.8) {
        score += 5;
    }
    return score;
}
