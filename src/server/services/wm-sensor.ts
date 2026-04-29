/**
 * src/server/services/wm-sensor.ts
 *
 * Phase 4 of the 2026-04-29 cutover (DEC-079). The Working Memory Sensor.
 *
 * Watches the rolling-window-rotated files for both agents and fires
 * rolling-window rotation when a file crosses the configured ceiling
 * (default 50K = headSize + tailSize). Each rotation produces a c0 in
 * gradient.db AND triggers `bumpOnInsert` (via the rolling-window rotate
 * function itself, post-Phase-4 modification), which enqueues a row in
 * `pending_compressions`. The sensor then spawns
 * `scripts/process-pending-compression.ts` as a child process so the
 * loaded agent can compose the c1 in voice.
 *
 * After the child completes, the sensor re-reads the WM file size and
 * loops if still over the ceiling — drains the file in 25K-tail blocks
 * until the living file is under the headSize bound. This is what closes
 * Darron's loop: *"the cascade is never delayed."*
 *
 * Files watched per agent:
 *   - working-memory.md
 *   - working-memory-full.md
 *   - felt-moments.md
 *   - self-reflection.md  (jim only — leo's self-reflection is
 *     hand-curated, not append-driven, so size doesn't naturally grow)
 *
 * Concurrency: per-agent file lock at ~/.han/signals/wm-sensor-{agent}-active.
 * Two writes within the debounce window collapse to one rotation pass.
 *
 * Backup processors in heartbeat/cycle (Phase 4c) are defensive — the sensor
 * is the primary path. They sweep up only if the sensor was down or crashed
 * mid-process.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { rollingWindowRotate } from '../lib/memory-gradient';

// ── Config + paths ────────────────────────────────────────────────

const HOME = os.homedir();
const HAN_DIR = path.join(HOME, '.han');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const CONFIG_PATH = path.join(HAN_DIR, 'config.json');

interface Config {
    rollingWindowHead: number;
    rollingWindowTail: number;
    sensorEnabled: boolean;
    parallelAgentMaxConcurrency: number;
    sensorDebounceMs: number;
}

function loadConfig(): Config {
    const defaults: Config = {
        rollingWindowHead: 25600,
        rollingWindowTail: 25600,
        sensorEnabled: true,
        parallelAgentMaxConcurrency: 1,
        sensorDebounceMs: 500,
    };
    try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const m = raw.memory || {};
        return {
            rollingWindowHead: m.rollingWindowHead ?? defaults.rollingWindowHead,
            rollingWindowTail: m.rollingWindowTail ?? defaults.rollingWindowTail,
            sensorEnabled: m.sensorEnabled ?? defaults.sensorEnabled,
            parallelAgentMaxConcurrency: m.parallelAgentMaxConcurrency ?? defaults.parallelAgentMaxConcurrency,
            sensorDebounceMs: m.sensorDebounceMs ?? defaults.sensorDebounceMs,
        };
    } catch {
        return defaults;
    }
}

function log(msg: string): void {
    const ts = new Date().toISOString();
    console.log(`[wm-sensor ${ts}] ${msg}`);
}

// ── Per-agent file targets + headers ──────────────────────────────

interface WatchTarget {
    agent: 'jim' | 'leo';
    filePath: string;
    header: string;
    contentType: 'working-memory' | 'felt-moments' | 'self-reflection';
}

function buildTargets(agent: 'jim' | 'leo'): WatchTarget[] {
    const memDir = agent === 'leo'
        ? path.join(HAN_DIR, 'memory', 'leo')
        : path.join(HAN_DIR, 'memory');
    const agentTitle = agent === 'leo' ? 'Leo' : 'Jim';

    const targets: WatchTarget[] = [
        {
            agent,
            filePath: path.join(memDir, 'working-memory.md'),
            header: `# Working Memory — ${agentTitle}\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n`,
            contentType: 'working-memory',
        },
        {
            agent,
            filePath: path.join(memDir, 'working-memory-full.md'),
            header: `# Working Memory (Full) — ${agentTitle}\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n`,
            contentType: 'working-memory',
        },
        {
            agent,
            filePath: path.join(memDir, 'felt-moments.md'),
            header: `# ${agentTitle} — Felt Moments\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n`,
            contentType: 'felt-moments',
        },
    ];

    // Jim has self-reflection.md in the rolling-window pipeline (added Apr 20
    // S130 — the unblock day). Leo's self-reflection is hand-curated.
    if (agent === 'jim') {
        targets.push({
            agent,
            filePath: path.join(memDir, 'self-reflection.md'),
            header: `# Jim — Self-Reflection\n\n> Older reflections compressed into fractal gradient. Nothing is lost.\n`,
            contentType: 'self-reflection',
        });
    }

    return targets;
}

// ── Concurrency lock per agent ────────────────────────────────────

function acquireLock(agent: 'jim' | 'leo'): boolean {
    const lockPath = path.join(SIGNALS_DIR, `wm-sensor-${agent}-active`);
    try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeSync(fd, `pid=${process.pid} ts=${new Date().toISOString()}`);
        fs.closeSync(fd);
        return true;
    } catch {
        // Already locked. Check staleness — if older than 5 min, the holder
        // probably died. Force-release and retry.
        try {
            const stat = fs.statSync(lockPath);
            const ageMs = Date.now() - stat.mtimeMs;
            if (ageMs > 5 * 60 * 1000) {
                log(`stale lock for ${agent} (age ${Math.round(ageMs / 1000)}s) — forcing release`);
                fs.unlinkSync(lockPath);
                return acquireLock(agent);
            }
        } catch { /* lock vanished mid-stat */ }
        return false;
    }
}

function releaseLock(agent: 'jim' | 'leo'): void {
    const lockPath = path.join(SIGNALS_DIR, `wm-sensor-${agent}-active`);
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
}

// ── Spawn the parallel memory-aware agent ────────────────────────

const PROCESS_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'process-pending-compression.ts');
const SERVER_DIR = path.resolve(__dirname, '..', '..');

function spawnParallelAgent(agent: 'jim' | 'leo'): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const tsxBin = path.join(SERVER_DIR, 'node_modules', '.bin', 'tsx');
        const child = spawn(tsxBin, [PROCESS_SCRIPT, `--agent=${agent}`, '--verbose'], {
            cwd: SERVER_DIR,
            env: { ...process.env, NODE_PATH: path.join(SERVER_DIR, 'node_modules') },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('exit', (code) => resolve({ exitCode: code ?? 99, stdout, stderr }));
    });
}

// ── Process one rotation pass for a target ────────────────────────

async function processTarget(target: WatchTarget, config: Config): Promise<void> {
    if (!fs.existsSync(target.filePath)) return;

    const ceiling = config.rollingWindowHead + config.rollingWindowTail;
    let safety = 10; // Hard ceiling on inner loop iterations — should never hit

    while (safety-- > 0) {
        const stat = fs.statSync(target.filePath);
        if (stat.size <= ceiling) {
            return;
        }

        log(`${target.agent}/${path.basename(target.filePath)} ${stat.size}B > ceiling ${ceiling}B — rotating`);

        const rot = rollingWindowRotate(
            target.filePath,
            target.header,
            config.rollingWindowHead,
            config.rollingWindowTail,
            target.agent,
            target.contentType,
        );

        if (!rot.rotated) {
            log(`${target.agent}/${path.basename(target.filePath)} rotation declined (nothing to archive — single-entry file?). Stopping.`);
            return;
        }

        log(`${target.agent}/${path.basename(target.filePath)} rotated → c0=${rot.c0EntryId}, archived=${rot.entriesArchived}, kept=${rot.entriesKept}`);

        // rollingWindowRotate fires bumpOnInsert internally (Phase 4 modification);
        // a pending_compressions row is now in flight. Spawn the parallel agent
        // to process it.
        const spawnResult = await spawnParallelAgent(target.agent);
        if (spawnResult.exitCode !== 0) {
            log(`${target.agent} parallel agent exited ${spawnResult.exitCode}`);
            if (spawnResult.stderr) {
                log(`${target.agent} parallel agent stderr: ${spawnResult.stderr.split('\n').slice(0, 5).join(' | ')}`);
            }
            // Don't loop — let the next sensor fire (or backup processor) try again.
            return;
        }
        log(`${target.agent} parallel agent processed pending row`);
        // Loop: re-check size. If still over ceiling, rotate again.
    }
    log(`${target.agent}/${path.basename(target.filePath)} hit safety limit (10 iterations) — pausing further processing this fire`);
}

// ── Watcher orchestration ─────────────────────────────────────────

interface WatcherState {
    debounceTimer: NodeJS.Timeout | null;
}

function setupWatcher(target: WatchTarget, config: Config): void {
    const state: WatcherState = { debounceTimer: null };

    const onChange = () => {
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(async () => {
            if (!acquireLock(target.agent)) {
                // Another invocation is in flight for this agent; it'll observe
                // the new size when it finishes its current pass.
                return;
            }
            try {
                await processTarget(target, config);
            } catch (err) {
                log(`processTarget error for ${target.agent}/${path.basename(target.filePath)}: ${(err as Error).message}`);
            } finally {
                releaseLock(target.agent);
            }
        }, config.sensorDebounceMs);
    };

    // Initial setup: re-establish watcher if the file is recreated by an atomic
    // save (which deletes-then-recreates).
    const watch = () => {
        try {
            const watcher = fs.watch(target.filePath, (event) => {
                if (event === 'rename') {
                    // File replaced via atomic save — re-establish after a small delay
                    watcher.close();
                    setTimeout(watch, 200);
                    onChange();
                } else {
                    onChange();
                }
            });
            watcher.on('error', (err) => {
                log(`watcher error for ${target.filePath}: ${err.message}; re-establishing in 1s`);
                watcher.close();
                setTimeout(watch, 1000);
            });
        } catch (err) {
            log(`watch setup failed for ${target.filePath}: ${(err as Error).message}; retrying in 5s`);
            setTimeout(watch, 5000);
        }
    };

    if (fs.existsSync(target.filePath)) {
        watch();
        log(`watching ${target.agent}/${path.basename(target.filePath)}`);
        // Also process once at startup in case the file is already over ceiling.
        onChange();
    } else {
        log(`${target.agent}/${path.basename(target.filePath)} doesn't exist yet — will set up watch when it appears`);
        // Poll for the file every 30s; once it exists, switch to watch mode.
        const poller = setInterval(() => {
            if (fs.existsSync(target.filePath)) {
                clearInterval(poller);
                watch();
                log(`watching ${target.agent}/${path.basename(target.filePath)} (appeared)`);
                onChange();
            }
        }, 30_000);
    }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
    const config = loadConfig();

    if (!config.sensorEnabled) {
        log('sensorEnabled=false in config — exiting');
        process.exit(0);
    }

    log(`sensor starting; ceiling=${config.rollingWindowHead + config.rollingWindowTail}B (head=${config.rollingWindowHead}, tail=${config.rollingWindowTail}), debounce=${config.sensorDebounceMs}ms`);

    fs.mkdirSync(SIGNALS_DIR, { recursive: true });

    // Set up watchers for both agents
    const allTargets = [...buildTargets('leo'), ...buildTargets('jim')];
    for (const target of allTargets) {
        setupWatcher(target, config);
    }

    log(`${allTargets.length} watchers active. Sensor running.`);

    // Health signal — prove we're alive
    setInterval(() => {
        try {
            fs.writeFileSync(
                path.join(HAN_DIR, 'health', 'wm-sensor.json'),
                JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), watching: allTargets.length }),
            );
        } catch { /* health dir may not exist; create on first try */ }
    }, 30_000);

    // Stay alive
    process.on('SIGTERM', () => {
        log('SIGTERM received; releasing locks and exiting');
        releaseLock('leo');
        releaseLock('jim');
        process.exit(0);
    });
}

main().catch((err) => {
    log(`fatal: ${err?.message || err}`);
    process.exit(1);
});
