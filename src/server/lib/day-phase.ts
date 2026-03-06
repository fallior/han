/**
 * Shared Day Phase Clock
 *
 * Single source of truth for phase detection across all agents.
 * Both Leo (heartbeat) and Jim (supervisor) should use this module.
 *
 * PROTECTED STRUCTURE — See Hall of Records R001 (Weekly Rhythm Model).
 * Do NOT flatten phases, remove sleep, or merge into a reactive loop
 * without consulting Darron first.
 */

import fs from 'node:fs';
import path from 'node:path';

const HAN_DIR = process.env.HAN_DIR || path.join(process.env.HOME!, '.han');

export type DayPhase = 'sleep' | 'morning' | 'work' | 'evening';

function loadConfig(): any {
    try {
        const configPath = path.join(HAN_DIR, 'config.json');
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return {};
    }
}

export function isRestDay(): boolean {
    const config = loadConfig();
    const restDays: number[] = config.supervisor?.rest_days ?? [0, 6]; // 0=Sunday, 6=Saturday
    const now = new Date();
    return restDays.includes(now.getDay());
}

export function getDayPhase(): DayPhase {
    // Rest days follow normal time-of-day phases — rest ≠ sleep.
    // The only difference is longer intervals (see getPhaseInterval).
    const config = loadConfig();
    const quietStart = config.supervisor?.quiet_hours_start || config.quiet_hours_start || '22:00';
    const quietEnd = config.supervisor?.quiet_hours_end || config.quiet_hours_end || '06:00';
    const workStart = config.supervisor?.work_hours_start || '09:00';
    const workEnd = config.supervisor?.work_hours_end || '17:00';

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const toMinutes = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + (m || 0);
    };

    const quietStartM = toMinutes(quietStart);
    const quietEndM = toMinutes(quietEnd);
    const workStartM = toMinutes(workStart);
    const workEndM = toMinutes(workEnd);

    // Sleep: quiet hours (overnight window, e.g. 22:00–06:00)
    if (quietStartM > quietEndM) {
        if (currentMinutes >= quietStartM || currentMinutes < quietEndM) return 'sleep';
    } else {
        if (currentMinutes >= quietStartM && currentMinutes < quietEndM) return 'sleep';
    }

    // Morning: between quiet end and work start (e.g. 06:00–09:00)
    if (currentMinutes >= quietEndM && currentMinutes < workStartM) return 'morning';

    // Work: work hours (e.g. 09:00–17:00)
    if (currentMinutes >= workStartM && currentMinutes < workEndM) return 'work';

    // Evening: between work end and quiet start (e.g. 17:00–22:00)
    return 'evening';
}

/** Phase intervals in milliseconds — from Hall of Records R001 */
export const PHASE_INTERVALS = {
    sleep: 40 * 60 * 1000,
    morning: 20 * 60 * 1000,
    work: 20 * 60 * 1000,
    evening: 20 * 60 * 1000,
} as const;

/** Rest day interval — slower pace for all phases on weekends */
const REST_DAY_INTERVAL = 40 * 60 * 1000;

export function getPhaseInterval(): number {
    if (isRestDay()) return REST_DAY_INTERVAL;
    return PHASE_INTERVALS[getDayPhase()];
}
