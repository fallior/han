#!/usr/bin/env tsx
// pump-fail-watch.ts — the pump-fail watcher RUNNER (Tenshi's two-rule thermal guard,
// thread msa3ny9e-knlzg0; built by Leo, held for Jim's diff-audit).
//
// One sample per invocation — the cadence lives in cron (the ~/scripts host-watcher
// family, han-gdrive-backup shape). Intended install (NOT installed by this build —
// held; the cron line is the operator's at land):
//
//   * * * * * cd ~/Projects/han/src/server && NODE_PATH=$(pwd)/node_modules \
//       npx tsx ../../scripts/pump-fail-watch.ts >> ~/.han/logs/thermal-guard.log 2>&1
//
// What one run does:
//   1. Reads /sys/class/hwmon (coretemp → package; superio/acpitz → board; the rest →
//      Rule-A extras) + /proc/loadavg. A failed read is a SAMPLE with readErrors —
//      the core alerts on it (no-data is suspect, never safe).
//   2. Loads ~/.han/health/thermal-guard-state.json, runs the pure core, persists state.
//   3. Fires ntfy (config.json ntfy_topic — the postNtfyAlert shape) per alert.
//      The core's own watcher-dark rule alerts if THIS timer went silent (the gap
//      between runs is measured from persisted state — absence-is-alarm).
//   4. Optional tunable overrides from config.json `thermal_guard` (authored constants
//      in thermal-guard-core.ts are the defaults — DEC-104: author + reason on face).
//
// Fail-loud, in-process: an unexpected crash still exits non-zero into the cron log,
// and the NEXT run's watcher-dark rule reports the gap. No kill paths, no destructive
// anything — this artefact only ever speaks (DEC-103/104 self-test in the plan).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { decide, DEFAULT_TUNABLES, FRESH_STATE, type GuardState, type Sample, type Tunables } from './thermal-guard-core';

const HAN = path.join(os.homedir(), '.han');
const STATE_FILE = path.join(HAN, 'health', 'thermal-guard-state.json');

function readTrim(p: string): string | null {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

/** Walk /sys/class/hwmon into a Sample. Board = the superio (it86xx/it87xx) + acpitz
 *  family (Tenshi's six live board reads); package = coretemp "Package id 0" (fallback:
 *  hottest coretemp core); everything else keeps its label for Rule A. */
function readSample(nowMs: number): Sample {
    const readErrors: string[] = [];
    let packageC: number | null = null;
    let coretempMax: number | null = null;
    const boardC: number[] = [];
    const otherC: Record<string, number> = {};

    let devices: string[] = [];
    try {
        devices = fs.readdirSync('/sys/class/hwmon').filter(d => d.startsWith('hwmon'));
    } catch (e) {
        readErrors.push(`hwmon unreadable: ${(e as Error).message}`);
    }
    if (devices.length === 0 && readErrors.length === 0) readErrors.push('no hwmon devices');

    for (const dev of devices) {
        const base = path.join('/sys/class/hwmon', dev);
        const name = readTrim(path.join(base, 'name')) ?? dev;
        let inputs: string[] = [];
        try {
            inputs = fs.readdirSync(base).filter(f => /^temp\d+_input$/.test(f));
        } catch { continue; }
        for (const input of inputs) {
            const raw = readTrim(path.join(base, input));
            if (raw === null) continue; // transient per-sensor read miss is not a device error
            const c = Number(raw) / 1000;
            if (!Number.isFinite(c)) continue;
            const label = readTrim(path.join(base, input.replace('_input', '_label'))) ?? input;
            if (name === 'coretemp') {
                if (/^Package id/.test(label)) packageC = c;
                coretempMax = coretempMax === null ? c : Math.max(coretempMax, c);
            } else if (/^it8\d/.test(name) || name === 'acpitz') {
                boardC.push(c);
            } else {
                otherC[`${name}:${label}`] = c;
            }
        }
    }
    if (packageC === null && coretempMax !== null) packageC = coretempMax;
    if (packageC === null) readErrors.push('no CPU package temperature found');
    if (boardC.length === 0) readErrors.push('no board (superio/acpitz) temperatures found');

    let load1 = 0;
    const loadRaw = readTrim('/proc/loadavg');
    if (loadRaw === null) readErrors.push('loadavg unreadable');
    else load1 = Number(loadRaw.split(' ')[0]) || 0;

    return { tsMs: nowMs, packageC, boardC, otherC, load1, ncores: os.cpus().length, readErrors };
}

function loadState(): GuardState {
    try {
        const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return { ...FRESH_STATE, ...s, alertLog: s.alertLog ?? {} };
    } catch {
        return { ...FRESH_STATE }; // cold start — the core's G3 conservative default governs
    }
}

function tunables(): Tunables {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(HAN, 'config.json'), 'utf8'));
        if (cfg.thermal_guard && typeof cfg.thermal_guard === 'object') {
            return { ...DEFAULT_TUNABLES, ...cfg.thermal_guard };
        }
    } catch { /* defaults govern */ }
    return DEFAULT_TUNABLES;
}

/** The postNtfyAlert shape (tmux-dispatcher.ts:1772): fire-and-forget, 10s bound, a
 *  failed post is logged never thrown — the alert must not hurt the box it watches. */
function ntfy(message: string, title: string): void {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(HAN, 'config.json'), 'utf8'));
        if (!cfg.ntfy_topic) { console.warn('[thermal-guard] no ntfy_topic configured — alert logged only'); return; }
        execFile('curl', ['-s', '-d', message, '-H', `Title: ${title}`, '-H', 'Priority: urgent', '-H', 'Tags: thermometer,rotating_light', `https://ntfy.sh/${cfg.ntfy_topic}`],
            { timeout: 10_000 }, (err) => { if (err) console.warn(`[thermal-guard] ntfy failed (non-fatal): ${err.message}`); });
    } catch (err) {
        console.warn(`[thermal-guard] ntfy skipped (non-fatal): ${(err as Error).message}`);
    }
}

const now = Date.now();
const sample = readSample(now);
const t = tunables();
const { alerts, state } = decide(sample, loadState(), t);

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

for (const a of alerts) {
    console.warn(`[thermal-guard] ${new Date(now).toISOString()} ALERT ${a.rule}: ${a.message}`);
    ntfy(a.message, `🌡 Thermal guard: ${a.rule}`);
}
if (alerts.length === 0 && (t.calibrationMode || process.argv.includes('--verbose'))) {
    const spread = sample.packageC !== null && sample.boardC.length
        ? (sample.packageC - sample.boardC.reduce((x, y) => x + y, 0) / sample.boardC.length).toFixed(1)
        : 'n/a';
    const tag = t.calibrationMode ? '[calibration] ' : '';
    console.log(`[thermal-guard] ${tag}${new Date(now).toISOString()} ok pkg=${sample.packageC}°C spread=${spread}°C load1=${sample.load1} learned=${state.learnedSamples}`);
}
