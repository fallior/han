/**
 * Hortus Arbor Nostra - TypeScript Entry Point
 * Express setup, route mounting, intervals, listen
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import {
    db, HAN_DIR, PENDING_DIR, RESOLVED_DIR, CONTEXTS_DIR,
    syncRegistry
} from './db';

// Signals directory for cross-process communication
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
import { authMiddleware } from './middleware/auth';
import * as orchestrator from './orchestrator';
import { createWebSocketServer, broadcast, broadcastPrompts, broadcastTerminal as wsBroadcastTerminal, stopHeartbeat } from './ws';
import {
    listActiveSessions, getActiveSession, captureTerminal, readPendingPrompts,
    getLastBroadcastContent, setLastBroadcastContent, appendToLog, terminalSnapshotPath
} from './services/terminal';
import {
    generateId, loadConfig, sendDigestPush, createGoal, runNextTask,
    abortAllTasks, setBroadcastFn, setOrchestrator, setAdvancePipelineFn,
    detectAndRecoverGhostTasks
} from './services/planning';
import { checkDigestSchedule } from './services/digest';
import { checkWeeklyReportSchedule } from './services/reports';
// Maintenance removed — autonomous agents with unrestricted shell access are too dangerous
import { advancePipeline, setCreateGoalFn, setBroadcastFn as setProductsBroadcastFn, setLoadConfigFn } from './services/products';
import { initSupervisor, scheduleSupervisorCycle, stopSupervisor, setSupervisorBroadcastFn } from './services/supervisor';
import { runsSupervisorCycle, runsOrchestrator, poolSizeFor } from './lib/garden-manifest';
import { startPoolManager } from './lib/tmux-dispatcher';
import { startSessionHearth } from './lib/session-hearth';

// Route modules
import promptsRouter from './routes/prompts';
import tasksRouter from './routes/tasks';
import goalsRouter from './routes/goals';
import productsRouter from './routes/products';
import portfolioRouter from './routes/portfolio';
import bridgeRouter from './routes/bridge';
import analyticsRouter from './routes/analytics';
import proposalsRouter from './routes/proposals';
import supervisorRouter from './routes/supervisor';
import conversationsRouter from './routes/conversations';
import jemmaRouter from './routes/jemma';
import { startAckWatcher as startJemmaOrchestratorWatcher, stopAckWatcher } from './services/jemma-orchestrator';
import gradientRouter from './routes/gradient';
import tailscaleRouter from './routes/tailscale';
import villageRouter from './routes/village';
import voiceRouter from './routes/voice';
import healthRouter from './routes/health';
import boardRouter from './routes/board';

// ── Single instance lock ─────────────────────────────────

const app = express();

const TLS_CERT = path.join(HAN_DIR, 'tls.crt');
const TLS_KEY = path.join(HAN_DIR, 'tls.key');
const useHttps = fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY);

const server = useHttps
    ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, app)
    : http.createServer(app);

const PORT = process.env.PORT || 3847;
const UI_DIR = path.join(__dirname, '..', 'ui');

// PID guard: kill previous server on THIS port gracefully (30s), then SIGKILL if needed.
// Port-scoped so per-agent servers (3847 Leo, 3848 Jim, 3849 Tenshi, 3850 Casey) don't
// SIGTERM each other. Previously the shared 'han-server' name caused hanjim to kill the
// systemd-managed han-server on 3847 via replaceExistingInstance (2026-04-20, S130).
import { replaceExistingInstance } from './lib/pid-guard';
import { boxZoneMatchesGarden } from './lib/garden-time'; // DEC-105 seal Rider 3
// MNT-089: token + slug discriminator — BOTH agent servers share the `tsx server.ts`
// cmdline, so without the env match a recycled pid could SIGTERM the other garden server.
const serverPidGuard = replaceExistingInstance(`han-server-${PORT}`,
    { cmdlineToken: 'server.ts', envMatch: process.env.AGENT_SLUG ? { AGENT_SLUG: process.env.AGENT_SLUG } : {} });
process.on('exit', () => serverPidGuard.cleanup());
process.on('SIGINT', () => { serverPidGuard.cleanup(); process.exit(130); });

// ── Middleware ────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));

// Serve static UI assets (for app.js bundle)
app.use(express.static(UI_DIR));

// Apply authentication middleware to /api routes
// Admin HTML page is unprotected so the JS can load and handle auth client-side
app.use('/api', authMiddleware);

// Ensure directories exist
[PENDING_DIR, RESOLVED_DIR, CONTEXTS_DIR, SIGNALS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// ── Wire cross-service dependencies ──────────────────────

setBroadcastFn(broadcast);
setOrchestrator(orchestrator);
setAdvancePipelineFn(advancePipeline);
setCreateGoalFn(createGoal as any);
setProductsBroadcastFn(broadcast);
setLoadConfigFn(loadConfig);
setSupervisorBroadcastFn(broadcast);

// ── Mount routes ─────────────────────────────────────────

// Full-path routers (define their own /api/... paths)
app.use(promptsRouter);
app.use(tasksRouter);
app.use(bridgeRouter);
app.use(analyticsRouter);
app.use(proposalsRouter);
app.use('/api/supervisor', supervisorRouter);

// Prefix-mounted routers (use relative paths internally)
app.use('/api/goals', goalsRouter);
app.use('/api/products', productsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/jemma', jemmaRouter);
app.use('/api/gradient', gradientRouter);
app.use('/api', portfolioRouter);
app.use('/api/tailscale', tailscaleRouter);
app.use('/api/village', villageRouter);

// Voice routes — STT needs raw body parser for audio uploads
app.use('/api/voice/stt', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }));
app.use('/api/voice', voiceRouter);
app.use(healthRouter);
app.use(boardRouter); // K1: the kanban wall's read-only feed (one parser, board.ts serialises)

// Serve the UI
const UI_PATH = path.join(UI_DIR, 'index.html');
app.get('/', (_req, res) => {
    if (fs.existsSync(UI_PATH)) {
        res.set('Cache-Control', 'no-store');
        res.sendFile(UI_PATH);
    } else {
        res.status(404).send('UI not found. Ensure src/ui/index.html exists.');
    }
});

// Admin console
const ADMIN_PATH = path.join(UI_DIR, 'admin.html');
app.get('/admin', (_req, res) => {
    if (fs.existsSync(ADMIN_PATH)) {
        res.set('Cache-Control', 'no-store');
        res.sendFile(ADMIN_PATH);
    } else {
        res.status(404).send('Admin console not found. Ensure src/ui/admin.html exists.');
    }
});

// React Admin console (new UI — Phase 1)
const REACT_ADMIN_DIST = path.join(UI_DIR, 'react-admin-dist');
app.use('/admin-react', express.static(REACT_ADMIN_DIST));
app.get('/admin-react/*', (_req, res) => {
    const indexPath = path.join(REACT_ADMIN_DIST, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.set('Cache-Control', 'no-store');
        res.sendFile(indexPath);
    } else {
        res.status(404).send('React admin not found. Run: npm run build:react-admin');
    }
});

// ── WebSocket ────────────────────────────────────────────

const wss = createWebSocketServer(server, () => {
    const prompts = readPendingPrompts();
    const session = getActiveSession();
    let terminal = { content: null as string | null, session: null as string | null };
    if (session) {
        const result = captureTerminal(session);
        if (result) {
            terminal = { content: result.content, session: result.session };
        }
    }
    return { prompts, terminal };
});

// ── Sync registry on startup ─────────────────────────────

syncRegistry();

// ── Clean up stale broadcast signals from previous run ───

try {
    const staleBroadcastSignal = path.join(SIGNALS_DIR, 'ws-broadcast');
    if (fs.existsSync(staleBroadcastSignal)) {
        fs.unlinkSync(staleBroadcastSignal);
        console.log('[Server] Cleaned stale broadcast signal from previous run');
    }
} catch (err) {
    console.error('[Server] Failed to clean stale broadcast signal:', (err as Error).message);
}

// ── Terminal broadcast (200ms loop) ──────────────────────

function broadcastTerminal() {
    const hasClients = wss && wss.clients.size > 0;

    const session = getActiveSession();
    if (!session) {
        if (hasClients && getLastBroadcastContent() !== null) {
            setLastBroadcastContent(null as any);
            wsBroadcastTerminal(null, null);
        }
        return;
    }

    const result = captureTerminal(session);
    if (!result) return;

    if (result.content === getLastBroadcastContent()) return;
    setLastBroadcastContent(result.content);

    // Persist snapshot for UI startup
    try {
        fs.writeFileSync(terminalSnapshotPath(), result.content);
    } catch { /* best effort */ }

    // Always record to persistent log, regardless of WS clients
    appendToLog(result.content);

    // Only broadcast to WS if clients are connected
    if (hasClients) {
        wsBroadcastTerminal(result.content, result.session);
    }
}

// ── Scheduled intervals ──────────────────────────────────

// DEC-013: ~1s capture/broadcast (the 200ms regression × the full-scrollback payload was the
// WS flood). Content-diffed (broadcasts only on change); client append-only buffer accumulates.
const terminalBroadcastInterval = setInterval(broadcastTerminal, 1000);
const orchestratorInterval = setInterval(runNextTask, 5000);

const digestInterval = setInterval(() => {
    const config = loadConfig();
    checkDigestSchedule(config);
}, 3600000);

const weeklyReportInterval = setInterval(() => {
    const config = loadConfig();
    checkWeeklyReportSchedule(config);
}, 3600000);

const ghostTaskInterval = setInterval(() => {
    const recovered = detectAndRecoverGhostTasks();
    if (recovered > 0) {
        console.log(`[Ghost Recovery] Periodic check recovered ${recovered} ghost task(s)`);
    }
}, 300000); // Every 5 minutes

// Startup checks (staggered)
setTimeout(() => { const c = loadConfig(); checkDigestSchedule(c); }, 5000);
setTimeout(() => { const c = loadConfig(); checkWeeklyReportSchedule(c); }, 10000);

// ── File system watcher ──────────────────────────────────

let watchDebounce: ReturnType<typeof setTimeout> | null = null;

fs.watch(PENDING_DIR, (eventType, filename) => {
    if (!filename || !filename.endsWith('.json')) return;
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
        console.log(`Pending changed: ${eventType} ${filename}`);
        const prompts = readPendingPrompts();
        broadcastPrompts(prompts);
    }, 100);
});

// ── WebSocket broadcast signal watcher ───────────────────

/**
 * Process a WebSocket broadcast signal from an external agent (jim-human, leo-human).
 * The signal file contains a JSON payload to broadcast to all connected WebSocket clients.
 */
function processBroadcastSignal(): void {
    const signalPath = path.join(SIGNALS_DIR, 'ws-broadcast');
    try {
        if (!fs.existsSync(signalPath)) return;

        const raw = fs.readFileSync(signalPath, 'utf-8');
        fs.unlinkSync(signalPath);  // Consume the signal

        const data = JSON.parse(raw);

        // Validate required fields
        if (!data.type || !data.conversation_id) {
            console.error('[Server] Invalid broadcast signal: missing type or conversation_id');
            return;
        }

        // Strip signal metadata (timestamp is for debugging, not for clients)
        delete data.timestamp;

        broadcast(data);
        console.log(`[Server] Broadcast signal relayed: ${data.type} for ${data.conversation_id}`);
    } catch (err) {
        console.error('[Server] Failed to process broadcast signal:', (err as Error).message);
    }
}

// Watch SIGNALS_DIR for ws-broadcast files
let broadcastDebounce: ReturnType<typeof setTimeout> | null = null;

fs.watch(SIGNALS_DIR, (eventType, filename) => {
    if (filename !== 'ws-broadcast') return;

    // Short debounce — prevents double-fires from file write + chmod events
    if (broadcastDebounce) clearTimeout(broadcastDebounce);
    broadcastDebounce = setTimeout(() => {
        processBroadcastSignal();
    }, 100);
});

// Polling fallback every 5s (backup for edge cases where fs.watch misses)
const broadcastSignalInterval = setInterval(() => {
    processBroadcastSignal();
}, 5000);

// ── Initialize orchestrator ──────────────────────────────

orchestrator.initialize().then(status => {
    console.log('[Orchestrator] Initialized:', status);
}).catch(err => {
    console.error('[Orchestrator] Initialization failed:', err);
});

// ── Supervisor ───────────────────────────────────────────────
// PR-T7b gated the supervisor to its owning agent; project-b Phase 1 makes that gate
// registry-derived. Before PR-T7b, `initSupervisor()` ran UNCONDITIONALLY in every
// agent-server (3847 Leo + 3848 Jim both forked a `supervisor-worker` hardcoded to 'jim'
// — a latent double-Jim-cycle masked only by the `supervisor-paused` freeze; it would
// fire the moment the freeze lifts). The hardcoded `AGENT_SLUG === 'jim'` literal is now
// the manifest capability `runsSupervisorCycle(slug)` (DEC-081, one-path-many-agents).
// ⚠ Today ONLY jim's manifest sets the flag — supervisor-worker.ts is jim-hardcoded until
// Phase 3 (see the loud warning on AgentManifest.runsSupervisorCycle). The flag is the seam:
// once the worker is slug-agnostic (Phase 3) it becomes "this server runs its OWN slug's
// cycle" with no code change here. An unset/unknown AGENT_SLUG returns false (else-branch fires).
if (runsSupervisorCycle(process.env.AGENT_SLUG)) {
    initSupervisor();
    // Start first supervisor cycle after 30s (let other systems stabilise)
    setTimeout(scheduleSupervisorCycle, 30000);
} else {
    console.log(`[Supervisor] Not started — this server is AGENT_SLUG=${process.env.AGENT_SLUG ?? '(unset)'}; no manifest agent with this slug sets runsSupervisorCycle (project-b Phase 1 gate, DEC-081).`);
}

// ── Session-surface pool driver + hearth checker (warm-checkout P0, Jim's M1) ─────
// The per-agent server is the DRIVER for its own slug's session-surface pool: the pool
// machinery is (slug,surface)-agnostic but startPoolManager's only other caller is
// human-responder@<slug> for its OWN surface — nobody owned `session`, so a session pool
// would populate once and silently die (M1, thread msz950i2). This server is leo-scoped
// by launch (AGENT_SLUG), long-lived, and boot-owned once P3's server session lands —
// the natural owner. Inert until the manifest sets poolSize>0 on (slug, 'session').
// A 4th agent's server gets this free: slug from env, sizes from the manifest (DEC-081).
{
    const slug = process.env.AGENT_SLUG;
    if (slug && poolSizeFor(slug, 'session') > 0) {
        startPoolManager(slug, 'session');
        startSessionHearth(slug); // P2 layer-1 checker (pull-only; no HTTP route — Tenshi F3)
    } else if (!slug) {
        // The silent third branch, made loud (2026-08-20): an AGENT_SLUG-less server drives
        // no pool, runs no checker, reconciles nothing — and previously said NOTHING about it.
        // A whole night of dead organs hid behind this absent log line.
        console.log('[session-pool] Not started — AGENT_SLUG is unset (a bare server drives no pool, no hearth, no reconcile).');
    } else if (slug) {
        console.log(`[session-pool] Not started — (${slug}, session) has poolSize 0 in the manifest (warm-checkout P0 not enabled).`);
    }
}

// ── Start server ─────────────────────────────────────────

// DEC-105 seal Rider 3 (Casey's fail-loud instrument, softened by Jim's root-cure fold:
// the parseAuMarker pair is now correct BY CONSTRUCTION on any box, so divergence no
// longer breaks it). What remains worth one loud line at boot is clock HYGIENE: a box
// whose system zone differs from the garden's speaks two clocks in its own logs, cron
// times and `date` output. Never fail-stop. The standing daily check is FI #126's organ.
{
    const zc = boxZoneMatchesGarden();
    if (!zc.match) {
        console.warn(`[Server] ⚠ clock hygiene: system zone '${zc.boxZone}' != garden zone '${zc.gardenZone}' — the box's own logs/cron speak a different clock than the garden's records (the parseAuMarker pair is zone-safe by construction; this is hygiene, not breakage — DEC-105 rider).`);
    }
}

server.listen(Number(PORT), '0.0.0.0', () => {
    const proto = useHttps ? 'https' : 'http';
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    Hortus Arbor Nostra Server                    ║
╠═══════════════════════════════════════════════════════════╣
║  Mode:     ${useHttps ? 'HTTPS (Tailscale TLS)' : 'HTTP (no TLS certs found)'}${useHttps ? '              ' : '         '}║
║  Local:    ${proto}://localhost:${PORT}                        ║
║  Network:  ${proto}://<your-ip>:${PORT}                        ║
╚═══════════════════════════════════════════════════════════╝
`);

    // Recover ghost tasks from previous session
    const recovered = detectAndRecoverGhostTasks();
    if (recovered > 0) {
        console.log(`[Ghost Recovery] Startup recovered ${recovered} ghost task(s) from previous session`);
    }

    // Start Jemma orchestrator ack watcher (Phase 1, DEC-077 follow-on).
    // No-op when config.orchestration.enabled === false.
    // MNT-030 (S218): slug-gated — the exact DEC-081 twin of the supervisor gate above (:345).
    // Ungated, BOTH per-agent servers ran the orchestrator and raced the shared signals dir
    // (unlink-first-wins ack-drain): the "Ack for complete dispatch — ignoring" flood + the
    // eaten-heartbeat premature watchdog force-close (journal MNT-030). One server owns dispatch;
    // the flag is garden CONFIG (runsOrchestrator on the agent's garden-manifest.json entry).
    if (runsOrchestrator(process.env.AGENT_SLUG)) {
        try {
            startJemmaOrchestratorWatcher();
        } catch (err) {
            console.error('[Server] Failed to start Jemma orchestrator watcher:', (err as Error).message);
        }
    } else {
        console.log(`[Orchestrator] Not started — this server is AGENT_SLUG=${process.env.AGENT_SLUG ?? '(unset)'}; no manifest agent with this slug sets runsOrchestrator (MNT-030 gate, DEC-081).`);
    }
});

process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received — shutting down');
    serverPidGuard.cleanup();
    stopSupervisor();
    stopHeartbeat();
    stopAckWatcher();
    clearInterval(terminalBroadcastInterval);
    clearInterval(orchestratorInterval);
    clearInterval(digestInterval);
    clearInterval(weeklyReportInterval);
    clearInterval(ghostTaskInterval);
    clearInterval(broadcastSignalInterval);
    abortAllTasks();
    wss.close();

    // Clean-death floor (P0): exit even if server.close() hangs on lingering sockets,
    // and close db AFTER the server stops (not before) so nothing polls a closed handle
    // during the close window. The prior order (db.close before server.close) was the
    // ghost-server cause: a hung server.close() never reached process.exit, orphaning a
    // process with a closed db that the watchdog poll then spammed against.
    let exited = false;
    const die = () => {
        if (exited) return;
        exited = true;
        try { db.close(); } catch { /* best effort */ }
        // 143 = 128 + 15 (SIGTERM) so systemd Restart=always reads it as a signal death.
        process.exit(143);
    };
    server.close(die);
    // Hard backstop: if sockets keep server.close() from calling back, force exit anyway.
    setTimeout(die, 5000).unref();
});
