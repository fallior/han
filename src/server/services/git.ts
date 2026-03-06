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
 * Create a git checkpoint before task execution.
 *
 * CHECKPOINT STRATEGY:
 *
 * Goal: Protect user's pre-existing work and enable safe rollback if task fails.
 *
 * If working tree is DIRTY (has uncommitted changes):
 *   - Create a stash to preserve user's work
 *   - Stash includes all untracked files (-u flag)
 *   - Named with task ID for later identification
 *   - Task executes with clean working tree
 *   - On success: stash is popped (user's work restored on top of task commits)
 *   - On failure: stash is popped to rollback, restoring exact pre-task state
 *
 * If working tree is CLEAN (no uncommitted changes):
 *   - Create a branch as checkpoint
 *   - Branch created at current HEAD
 *   - Task executes normally
 *   - On success: branch is deleted (task commits persist)
 *   - On failure: branch is reset to (exact rollback)
 *
 * Why two strategies? Efficiency:
 *   - Stash is needed when user has uncommitted work (must preserve it)
 *   - Branch is simpler when working tree is already clean
 *
 * Returns { ref, type } where type is 'branch', 'stash', or 'none'
 */
export function createCheckpoint(projectPath: string, taskId: string): Checkpoint {
    const isDirty = hasUncommittedChanges(projectPath);

    if (isDirty) {
        // Dirty working tree — create stash to preserve user's work
        const stashMessage = `han checkpoint ${taskId}`;
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
        // Clean working tree — create branch as checkpoint
        const branchName = `han/checkpoint-${taskId}`;
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
 * Rollback to a git checkpoint after task failure or cancellation.
 *
 * PURPOSE: Undo all changes made by the task and restore working tree
 * to exact state before task execution.
 *
 * BRANCH ROLLBACK:
 *   - git reset --hard [checkpoint-branch]
 *   - Restores entire working tree to checkpoint state
 *   - Discards all task changes (both staged and unstaged)
 *
 * STASH ROLLBACK:
 *   - git reset --hard (discard any task changes)
 *   - git stash pop [stash-ref] (restore user's original work)
 *   - Ensures user's pre-task state is fully restored
 *   - Pop is safe here because failure handling is strict
 *
 * Note: This function is called on task FAILURE. On success,
 * cleanupCheckpoint() is called instead (pops stash safely with conflict handling).
 *
 * See cleanupCheckpoint() and ARCHITECTURE.md for full checkpoint lifecycle.
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
                        // Discard task changes and restore user's original work
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
            // Reset to the branch (exact rollback)
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
 * Clean up a git checkpoint after successful task completion.
 *
 * CHECKPOINT CLEANUP STRATEGY:
 *
 * Branch checkpoints (created for clean working trees):
 *   - Simply delete the branch — task changes are persisted in commits
 *   - No merge/conflict possible because branch was created before any changes
 *
 * Stash checkpoints (created for dirty working trees):
 *   - Use `git stash pop` to restore user's pre-existing uncommitted work
 *   - Pop applies stash AND removes it from stash list
 *   - Critical: Pop happens AFTER task commits, so user's work is restored on top
 *
 * CONFLICT HANDLING:
 *
 *   When task commits and user's stashed changes both modify the same lines,
 *   `git stash pop` fails with a merge conflict. In this case:
 *
 *   1. Working tree is left with conflict markers (<<<<<<<, =======, >>>>>>>)
 *   2. Stash is NOT dropped — it remains in stash list for inspection
 *   3. User must manually resolve:
 *      - Edit conflicted files
 *      - Remove conflict markers
 *      - git add [files] && git commit
 *      - git stash drop [stash-ref] (optional cleanup)
 *
 *   This approach ensures NO DATA LOSS. The alternative (stash drop) would
 *   discard user's work if pop fails — unacceptable.
 *
 * See claude-context/ARCHITECTURE.md "Git Checkpoint Behavior" for full details.
 */
export function cleanupCheckpoint(projectPath: string, checkpointRef: string | null, checkpointType: string): void {
    if (!checkpointRef || checkpointType === 'none') return;

    try {
        if (checkpointType === 'branch') {
            // Delete the checkpoint branch (task changes are already committed)
            execFileSync('git', ['branch', '-D', checkpointRef], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Cleaned up checkpoint branch: ${checkpointRef}`);
        } else if (checkpointType === 'stash') {
            // Restore user's pre-existing work by popping the stash
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
                            // Pop applies the stash and removes it from stash list
                            execFileSync('git', ['stash', 'pop', match[1]], {
                                cwd: projectPath,
                                stdio: 'ignore'
                            });
                            console.log(`[Git] Cleaned up checkpoint stash: ${checkpointRef}`);
                        } catch (err: any) {
                            // Pop failed: merge conflict between task commits and user's stashed changes
                            // Leave stash in place — user must resolve manually to preserve data
                            console.warn(`[Git] Stash pop had conflicts — leaving stash in place for manual resolution`);
                            // User can resolve by:
                            // 1. Edit conflicted files and remove conflict markers
                            // 2. git add . && git commit
                            // 3. git stash drop [stash-ref] for cleanup
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
