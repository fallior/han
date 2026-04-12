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
    getLastBroadcastContent, setLastBroadcastContent, appendToLog
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
import gradientRouter from './routes/gradient';
import tailscaleRouter from './routes/tailscale';
import villageRouter from './routes/village';

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

// PID guard: kill previous server gracefully (30s), then SIGKILL if needed
import { replaceExistingInstance } from './lib/pid-guard';
const serverPidGuard = replaceExistingInstance('han-server');
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
    if (!wss || wss.clients.size === 0) return;

    const session = getActiveSession();
    if (!session) {
        if (getLastBroadcastContent() !== null) {
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
        fs.writeFileSync(path.join(HAN_DIR, 'terminal.txt'), result.content);
    } catch { /* best effort */ }

    appendToLog(result.content);
    wsBroadcastTerminal(result.content, result.session);
}

// ── Scheduled intervals ──────────────────────────────────

const terminalBroadcastInterval = setInterval(broadcastTerminal, 200);
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

initSupervisor();
// Start first supervisor cycle after 30s (let other systems stabilise)
setTimeout(scheduleSupervisorCycle, 30000);

// ── Start server ─────────────────────────────────────────

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
});

process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received — shutting down');
    serverPidGuard.cleanup();
    stopSupervisor();
    stopHeartbeat();
    clearInterval(terminalBroadcastInterval);
    clearInterval(orchestratorInterval);
    clearInterval(digestInterval);
    clearInterval(weeklyReportInterval);
    clearInterval(ghostTaskInterval);
    clearInterval(broadcastSignalInterval);
    abortAllTasks();
    try { db.close(); } catch {}
    wss.close();
    server.close(() => {
        // Exit with non-zero so systemd Restart=always knows this was a signal death,
        // not a clean "I'm done" exit. 143 = 128 + 15 (SIGTERM).
        process.exit(143);
    });
});
