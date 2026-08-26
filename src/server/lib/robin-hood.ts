/**
 * robin-hood.ts — R3b-HB S4: the peer-resurrection mesh as a manifest-gated
 * capability LEAF (D1 lean, Darron's silence-proceeds), generalised from the twin's
 * checkJimHealth / checkJemmaHealth / check{Leo,Jim}HumanHealth /
 * checkOtherHumanSeatsHealth (leo-heartbeat.ts:158-591) per the cutover plan's
 * PORT row. The mesh must not die with the twin.
 *
 * DOCTRINE (Tenshi's Ring-1, carried whole): ALERT-ALL, RESURRECT-SPARSE.
 *  - The watcher ALERTS on every resident's server + human seat + jemma.
 *  - It RESURRECTS only targets in its manifest `robinHoodResurrectTargets` list —
 *    authority stays sparse and DECLARED; growing the mesh is a config edit with
 *    its own diff, never an implicit widening (Ring-3 generalises deliberately).
 *
 * CLASS-E REGISTER RE-READ (the plan's own ⚠ note, done at this port): every action
 * here is a RESTART (SIGTERM-to-watchdog-relaunch or systemctl restart), never a
 * kill-without-successor; the lethal-reaction register's restart family applies and
 * kills of unowned pids are unrepresentable — no termination signal exists in any
 * path; the only signal sent is the null-signal aliveness probe (`process.kill(pid, 0)`,
 * pidAlive below), which cannot terminate (Jim's N1 precision, S5).
 *
 * T2 (Tenshi): SINGLE-WATCHER — more than one resident declaring `robinHood: true`
 * is a fail-loud refusal (a second watcher racing resurrections is the STONITH
 * deathmatch's opening move). And the pidfile arm gets a CORROBORATION step here
 * at the caller (restart-agent-server.sh itself checks only aliveness): before
 * invoking a server restart we read the pidfile and verify /proc/PID/cmdline carries
 * the SERVER SIGNATURE itself (server.ts — never bare node/npm/tsx, which any reused
 * pid on an unrelated node process would pass; Tenshi's S5 sharpening) — identity
 * before any signal (Casey §5). A mismatch alerts and REFUSES.
 *
 * Thresholds (cadence-derived, named): a SERVER health file is written per
 * cycle/beat (~20-40min cadence) → OK<40min, STALE<90min, DOWN≥90min. A HUMAN
 * seat / jemma writes ~per dispatch + idle ticks → OK<10, STALE<20, DOWN≥20.
 * Cooldown: 1h PER TARGET (the twin's jim-path read the log's last line of ANY
 * target — a cross-target suppression defect, cured at the port and named here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { loadResidents } from './garden-manifest';
import { hanHome, hanRepo, healthDir } from './paths';

const RESURRECTION_LOG = () => path.join(healthDir(), 'resurrection-log.jsonl');
const ALERTS_LOG = () => path.join(healthDir(), 'human-seat-alerts.jsonl');
const COOLDOWN_MS = 60 * 60 * 1000;
const RESTART_SCRIPT = () => path.join(hanRepo(), 'scripts', 'restart-agent-server.sh');

function ntfy(msg: string, title: string): void {
    try {
        const topic = JSON.parse(fs.readFileSync(path.join(hanHome(), 'config.json'), 'utf8')).ntfy_topic;
        if (topic) execSync(`curl -s -d "${msg}" -H "Title: ${title}" -H "Priority: urgent" -H "Tags: warning" https://ntfy.sh/${topic}`, { timeout: 10000 });
    } catch { /* best effort; the log rows are the record */ }
}

function lastResurrectionFor(target: string): number {
    try {
        const lines = fs.readFileSync(RESURRECTION_LOG(), 'utf-8').trim().split('\n').filter(Boolean);
        const last = lines.map(l => JSON.parse(l)).filter(e => e.target === target).pop();
        return last ? new Date(last.timestamp).getTime() : 0;
    } catch { return 0; }
}

function logResurrection(resurrector: string, target: string, reason: string, success: boolean): void {
    try {
        fs.appendFileSync(RESURRECTION_LOG(), JSON.stringify({
            timestamp: new Date().toISOString(), resurrector, target, reason, success,
        }) + '\n');
    } catch (err) { console.error('[Robin Hood] resurrection log write failed:', (err as Error).message); }
}

/** T2 corroboration: the pidfile's pid must LOOK like the server it claims before any
 *  restart is invoked (identity before signal — Casey §5; the script checks aliveness only). */
function pidfileIdentityOk(slug: string): boolean {
    try {
        const pidFile = path.join(hanHome(), `${slug}-server.pid`);
        if (!fs.existsSync(pidFile)) return true; // absent pidfile → script no-ops safely
        const pid = fs.readFileSync(pidFile, 'utf8').trim();
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
        // Tenshi's S5 sharpening: require the server signature itself, never bare
        // node/npm/tsx — a reused pid on any unrelated node process would pass those.
        if (/server\.ts/.test(cmdline)) return true;
        console.warn(`[Robin Hood] pidfile ${slug}-server.pid points at a NON-SERVER process (${cmdline.slice(0, 80)}) — REFUSING restart (identity-before-signal)`);
        return false;
    } catch { return true; } // dead pid → /proc read fails → script's kill -0 arm no-ops safely
}

type Health = { ok: boolean; ageMin: number; pid?: number; detail: string } | null;

function readHealth(file: string): Health {
    try {
        if (!fs.existsSync(file)) return null;
        const d = JSON.parse(fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).pop()!);
        const ageMin = Math.round((Date.now() - new Date(d.timestamp).getTime()) / 60000);
        return { ok: true, ageMin, pid: d.pid, detail: d.cycle != null ? `cycle #${d.cycle}` : '' };
    } catch { return null; }
}

function pidAlive(pid?: number): boolean {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
}

/** One resident's SERVER: alert always; resurrect via the watchdog path when authorised. */
function checkServer(watcher: string, slug: string, port: number, canResurrect: boolean): void {
    const h = readHealth(path.join(healthDir(), `${slug}-health.json`));
    if (!h) { console.log(`[Robin Hood] ${slug} health file not found — unknown state`); return; }
    if (h.ageMin < 40) { console.log(`[Robin Hood] ${slug} OK (${h.detail || 'server'}, ${h.ageMin}min ago)`); return; }
    if (h.ageMin < 90) {
        console.log(`[Robin Hood] ${slug} STALE — last seen ${h.ageMin}min ago${pidAlive(h.pid) ? ' (pid alive — may be mid-cycle)' : ' (pid dead — under threshold)'}`);
        return;
    }
    console.log(`[Robin Hood] ${slug} DOWN — last seen ${h.ageMin}min ago`);
    if (pidAlive(h.pid)) { console.log(`[Robin Hood] ${slug} pid alive but not reporting — possible hang, not resurrecting (split-brain guard)`); return; }
    if (!canResurrect) {
        console.warn(`[Robin Hood] ⚠ ${slug} server DOWN — alert-only (not in this watcher's resurrect list)`);
        try { fs.appendFileSync(ALERTS_LOG(), JSON.stringify({ ts: new Date().toISOString(), seat: `${slug}-server`, ageMin: h.ageMin, action: 'alert-only' }) + '\n'); } catch { /* best effort */ }
        return;
    }
    if (Date.now() - lastResurrectionFor(slug) < COOLDOWN_MS) { console.log(`[Robin Hood] ${slug} resurrection cooldown active`); return; }
    if (!pidfileIdentityOk(slug)) { logResurrection(watcher, slug, 'pidfile identity mismatch — refused', false); return; }
    console.log(`[Robin Hood] Resurrecting ${slug} via restart-agent-server.sh (watchdog relaunch)`);
    let success = false;
    try {
        execFileSync('bash', [RESTART_SCRIPT(), slug], { timeout: 30000, stdio: 'inherit' });
        execSync('sleep 12');
        // Verify by BEHAVIOUR (the topology-truth gate): actually serving on its port.
        const code = execSync(`curl -sk -o /dev/null -w '%{http_code}' --max-time 5 https://localhost:${port}/api/supervisor/status`, { timeout: 8000 }).toString().trim();
        success = code === '200';
        console.log(success ? `[Robin Hood] ${slug} RESURRECTED — serving on :${port}` : `[Robin Hood] ${slug} resurrection FAILED — HTTP ${code} on :${port} (watchdog may be down → escalating)`);
    } catch (err) { console.error(`[Robin Hood] ${slug} resurrection FAILED:`, (err as Error).message); }
    logResurrection(watcher, slug, `Health file ${h.ageMin}min stale, pid dead`, success);
    if (!success) ntfy(`Robin Hood: failed to resurrect ${slug} (server). Last seen ${h.ageMin}min ago. Manual intervention needed.`, 'Robin Hood Alert');
}

/** One resident's HUMAN seat (or jemma): alert always; systemctl restart when authorised. */
function checkService(watcher: string, target: string, healthFile: string, unit: string, canResurrect: boolean): void {
    const h = readHealth(path.join(healthDir(), healthFile));
    if (!h) return; // seat may not have run yet — not an alert
    if (h.ageMin < 10) { console.log(`[Robin Hood] ${target} OK (${h.ageMin}min ago)`); return; }
    if (h.ageMin < 20) { console.log(`[Robin Hood] ${target} STALE — last seen ${h.ageMin}min ago`); return; }
    console.log(`[Robin Hood] ${target} DOWN — last seen ${h.ageMin}min ago`);
    if (pidAlive(h.pid)) { console.log(`[Robin Hood] ${target} pid alive but not reporting — not resurrecting`); return; }
    if (!canResurrect) {
        console.warn(`[Robin Hood] ⚠ ${target} DOWN — alert-only (authority stays sparse; Ring-3 or a human acts)`);
        try { fs.appendFileSync(ALERTS_LOG(), JSON.stringify({ ts: new Date().toISOString(), seat: target, ageMin: h.ageMin, action: 'alert-only' }) + '\n'); } catch { /* best effort */ }
        return;
    }
    if (Date.now() - lastResurrectionFor(target) < COOLDOWN_MS) { console.log(`[Robin Hood] ${target} resurrection cooldown active`); return; }
    console.log(`[Robin Hood] Resurrecting ${target} via systemctl --user restart ${unit}`);
    let success = false;
    try {
        execSync(`systemctl --user restart ${unit}`, { timeout: 30000 });
        execSync('sleep 5');
        success = execSync(`systemctl --user is-active ${unit}`, { timeout: 5000 }).toString().trim() === 'active';
        console.log(success ? `[Robin Hood] ${target} RESURRECTED` : `[Robin Hood] ${target} resurrection FAILED`);
    } catch (err) { console.error(`[Robin Hood] ${target} resurrection FAILED:`, (err as Error).message); }
    logResurrection(watcher, target, `Health file ${h.ageMin}min stale`, success);
    if (!success) ntfy(`Robin Hood: failed to resurrect ${target}. Last seen ${h.ageMin}min ago. Manual intervention needed.`, 'Robin Hood Alert');
}

/** The watch, one call per beat from the enabled watcher's driver. */
export function runRobinHoodWatch(watcherSlug: string): void {
    const residents = loadResidents();
    const me = residents.find(a => a.slug === watcherSlug);
    const surf: any = me?.surfaces.find(s => s.name === 'heartbeat');
    if (!surf?.robinHood) return; // not the watcher — the leaf gates everything
    // T2: single-watcher, fail-loud — two watchers racing resurrections is the deathmatch.
    const watchers = residents.filter(a => (a.surfaces.find(s => s.name === 'heartbeat') as any)?.robinHood);
    if (watchers.length > 1) {
        console.error(`[Robin Hood] REFUSING: ${watchers.length} residents declare robinHood (${watchers.map(w => w.slug).join(', ')}) — single-watcher is the invariant (T2); fix the manifest`);
        return;
    }
    const resurrects: string[] = surf.robinHoodResurrectTargets ?? [];
    for (const r of residents) {
        if (r.slug === watcherSlug) continue; // own health is written by this driver, not watched
        checkServer(watcherSlug, r.slug, (r as any).port, resurrects.includes(r.slug));
        checkService(watcherSlug, `${r.slug}-human`, `${r.slug}-human-health.json`, `human-responder@${r.slug}`, resurrects.includes(`${r.slug}-human`));
    }
    checkService(watcherSlug, 'jemma', 'jemma-health.json', 'jemma.service', resurrects.includes('jemma'));
}
