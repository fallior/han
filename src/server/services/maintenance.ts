import { db, portfolioStmts, maintenanceStmts } from '../db';

import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

function generateId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function loadConfig(): any {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.han', 'config.json'), 'utf8'));
    } catch { return {}; }
}

type CreateGoalFn = (description: string, projectPath: string, autoExecute: boolean, parentGoalId: string | null, goalType: string, planningModel: string) => string | null;
type BroadcastFn = (msg: string) => void;
type SendPushFn = (summary: string) => void;

/**
 * Run nightly maintenance: create a maintenance goal for each active, enabled project.
 * Accepts optional callback functions for goal creation, WebSocket broadcast, and push notifications.
 */
export function runNightlyMaintenance(
    createGoalFn?: CreateGoalFn,
    broadcastFn?: BroadcastFn,
    sendPushFn?: SendPushFn,
): { runId: string; goalIds: string[] } | null {
    try {
        const runId = generateId();
        const now = new Date().toISOString();
        const projects = portfolioStmts.list.all().filter((p: any) =>
            p.lifecycle === 'active' && p.maintenance_enabled !== 0
        );

        if (projects.length === 0) return null;

        maintenanceStmts.insert.run(runId, now, null, 'running', projects.length, null, null);

        const goalIds: string[] = [];
        for (const proj of projects) {
            if (!fs.existsSync(proj.path)) continue;
            try {
                const goalId = createGoalFn?.(
                    `Nightly maintenance for ${proj.name}: run test suite, check for outdated dependencies, verify project health`,
                    proj.path,
                    true,
                    null,
                    'standalone',
                    'sonnet'
                );
                if (goalId) goalIds.push(goalId);
            } catch (err: any) {
                console.error(`[Maintenance] Failed to create goal for ${proj.name}:`, err.message);
            }
        }

        maintenanceStmts.complete.run(
            goalIds.length === 0 ? now : null,
            goalIds.length > 0 ? 'active' : 'skipped',
            `Created ${goalIds.length} maintenance goals for ${projects.length} projects`,
            runId
        );

        // Broadcast via WebSocket
        if (broadcastFn) {
            const msg = JSON.stringify({ type: 'maintenance_started', runId, projects: projects.length, goals: goalIds.length });
            broadcastFn(msg);
        }

        // Send push notification
        const config = loadConfig();
        if (config.ntfy_topic) {
            if (sendPushFn) {
                sendPushFn(`Nightly maintenance started: ${goalIds.length} goals across ${projects.length} projects`);
            } else {
                try {
                    execFileSync('curl', ['-s', '-d', `Nightly maintenance started: ${goalIds.length} goals across ${projects.length} projects`, '-H', 'Title: Hortus Arbor Nostra Maintenance', '-H', 'Priority: low', '-H', 'Tags: wrench', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
                } catch {}
            }
        }

        console.log(`[Maintenance] Run ${runId}: ${goalIds.length} goals created for ${projects.length} projects`);
        return { runId, goalIds };
    } catch (err: any) {
        console.error('[Maintenance] Run failed:', err.message);
        return null;
    }
}

/**
 * Check whether today's nightly maintenance should run based on the configured
 * maintenance_hour and maintenance_enabled flag. Checks the database for today's
 * runs to survive server restarts (not just in-memory state).
 */
export function checkMaintenanceSchedule(
    config: any,
    createGoalFn?: CreateGoalFn,
): { runId: string; goalIds: string[] } | null {
    if (config.maintenance_enabled === false) return null;
    const maintenanceHour = parseInt((config.maintenance_hour || '2'), 10);
    const now = new Date();

    if (now.getHours() < maintenanceHour) return null;

    // Check DB for today's runs — survives server restarts
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const latest = maintenanceStmts.getLatest.get() as any;
    if (latest && latest.started_at && latest.started_at.startsWith(todayStr)) {
        return null;
    }

    const result = runNightlyMaintenance(createGoalFn);
    if (result) {
        console.log(`[Maintenance] Nightly run: ${result.goalIds.length} goals created`);
    }
    return result;
}
