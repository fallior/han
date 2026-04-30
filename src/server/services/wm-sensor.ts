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
import { acquireWmSensorLock, releaseWmSensorLock } from '../lib/sensor-lock';
import { countTokens } from '../lib/token-counter';

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
    // Phase A token refactor (S145, 2026-04-30): head/tail are TOKEN counts
    // via lib/token-counter.ts countTokens (chars÷4 approximation). Per
    // Darron's S145 ruling: tokens throughout, never bytes or chars, no
    // silent unit-switching. 25,000 tokens per tail → ~25K-token c0 per
    // rotation. Total ceiling 50,000 tokens before slicer fires.
    const defaults: Config = {
        rollingWindowHead: 25_000,
        rollingWindowTail: 25_000,
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

    // Phase A token refactor (S145, 2026-04-30): per Darron's mechanics
    // restatement and Jim's review — the slicer's domain is working memory
    // ONLY. felt-moments.md and self-reflection.md are loaded WHOLE at
    // session/cycle start, hand-curated, not chunked. Removed from the
    // watcher target list. The historical felt-moments rolling-c0s in the
    // gradient remain as superseded entries (DEC-069 honoured); going
    // forward, felt-moments.md doesn't slice.
    //
    // Phase A.2 (S145, 2026-04-30): only working-memory-full.md is in the
    // watcher. The "compressed" working-memory.md was a hand-curated summary
    // from the older design where it was loaded as orientation before the
    // full version. Per Darron's "ONE file per agent" framing the canonical
    // working memory is the full record; compression now happens through the
    // gradient cascade (slicer → c0 → c1 → c2 → ... → UV), not via a parallel
    // hand-distilled flat file. working-memory.md persists as a hand-curated
    // artefact loaded at session start per CLAUDE.md, but the slicer leaves
    // it alone — preventing duplicate-content c0s into the gradient.
    // Phase 12 cleanup will retire the dual-file pattern entirely.
    return [
        {
            agent,
            filePath: path.join(memDir, 'working-memory-full.md'),
            header: `# Working Memory (Full) — ${agentTitle}\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n`,
            contentType: 'working-memory',
        },
    ];
}

// (Lock helpers extracted to ../lib/sensor-lock.ts in Phase 4c so the backup
// queue-drain in leo-heartbeat and supervisor-worker can share the same
// primitive — whoever holds the lock owns rotation/drain for that agent.)

// ── Spawn the parallel memory-aware agent ────────────────────────

const PROCESS_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'process-pending-compression.ts');
// Bug fix S145 cont. (2026-04-30): SERVER_DIR was previously '..', '..' — that
// resolved to src/ instead of src/server/. The tsx binary lives in src/server/
// node_modules so spawning failed with ENOENT, crashing wm-sensor mid-rotation
// after the slicer had successfully produced a c0. Caught when the cascade
// chain didn't propagate through the parallel agent path. Path is now '..' —
// matches the supervisor-worker.ts pattern in maybeBackupQueueDrainJim.
const SERVER_DIR = path.resolve(__dirname, '..');

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

    const ceilingTokens = config.rollingWindowHead + config.rollingWindowTail;
    let safety = 10; // Hard ceiling on inner loop iterations — should never hit

    while (safety-- > 0) {
        // Phase A token refactor (S145, 2026-04-30): read content + countTokens
        // instead of stat.size. Slightly heavier per check (read vs stat) but for
        // these file sizes it's microseconds. Tokens are the single canonical
        // unit per Darron's S145 ruling.
        const fileTokens = countTokens(fs.readFileSync(target.filePath, 'utf8'));
        if (fileTokens <= ceilingTokens) {
            return;
        }

        log(`${target.agent}/${path.basename(target.filePath)} ${fileTokens} tokens > ceiling ${ceilingTokens} tokens — rotating`);

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
        // a pending_compressions row is in flight. Drain the FULL cascade chain
        // for this agent (c0→c1→c2→...→UV or cap-not-exceeded) BEFORE re-checking
        // file size for the next slice.
        //
        // Per Darron's S145 ruling (2026-04-30 evening): "the slicer doesn't
        // wait for the cascade — change it, make it wait." Earlier reading
        // had the slicer firing fast and cascade running in parallel; the
        // updated rule is each slice fully digests through the gradient
        // (c0→c1→c2→...) before the next slice considers. Keeps cascade
        // serial per agent; prevents memory pressure from concurrent chains;
        // makes "size check after bump complete" mean "after the chain
        // settles," not just "after one compression lands."
        //
        // Implementation: keep spawning the parallel agent. Each invocation
        // claims one pending row, processes it, exits. If the compression
        // succeeds, Phase A.1's enqueueCascadeIfNeeded enqueues the next
        // level if cap is exceeded. So the queue may have new rows after each
        // spawn. Loop until a spawn finds the queue empty (no JSON output
        // indicating compression).
        let drainCount = 0;
        let drainGuard = 50; // safety: should never need that many per slice
        while (drainGuard-- > 0) {
            const spawnResult = await spawnParallelAgent(target.agent);
            if (spawnResult.exitCode !== 0) {
                log(`${target.agent} parallel agent exited ${spawnResult.exitCode}; halting drain for this slice`);
                if (spawnResult.stderr) {
                    log(`${target.agent} parallel agent stderr: ${spawnResult.stderr.split('\n').slice(0, 5).join(' | ')}`);
                }
                return;
            }
            // Did it process something? Compression results emit JSON to stdout
            // ({"ok":true, "operation":"compress"|"incompressible", ...}).
            // Queue-empty exits cleanly with no JSON output.
            if (spawnResult.stdout.includes('"ok":true')) {
                drainCount++;
                // Loop — cascade propagation may have enqueued the next level.
            } else {
                // Queue empty for this agent — chain has settled. Stop draining.
                break;
            }
        }
        if (drainGuard <= 0) {
            log(`${target.agent} drain hit safety cap (50 compressions) — possible runaway, halting this slice`);
            return;
        }
        log(`${target.agent} cascade chain settled: ${drainCount} compressions processed; re-checking file size`);
        // Loop: re-check size. If still over ceiling, rotate again — but only
        // now, after the previous slice's full cascade has drained.
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
            if (!acquireWmSensorLock(target.agent)) {
                // Another invocation is in flight for this agent; it'll observe
                // the new size when it finishes its current pass.
                return;
            }
            try {
                await processTarget(target, config);
            } catch (err) {
                log(`processTarget error for ${target.agent}/${path.basename(target.filePath)}: ${(err as Error).message}`);
            } finally {
                releaseWmSensorLock(target.agent);
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
        // Note: NO initial-scan onChange() at boot. Per Jim+Darron's S145 audit,
        // boot-time-oversize cases are covered by (a) the heartbeat/cycle's
        // existing rollingWindowRotate calls, and (b) the next session-end
        // write naturally triggering a watch event. Skipping saves needless
        // surface area at startup.
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

    const ceilingTokens = config.rollingWindowHead + config.rollingWindowTail;
    log(`sensor starting; ceiling=${ceilingTokens} tokens (head=${config.rollingWindowHead}, tail=${config.rollingWindowTail}), debounce=${config.sensorDebounceMs}ms`);

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
        releaseWmSensorLock('leo');
        releaseWmSensorLock('jim');
        process.exit(0);
    });
}

main().catch((err) => {
    log(`fatal: ${err?.message || err}`);
    process.exit(1);
});
