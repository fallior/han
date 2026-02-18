/**
 * Claude Remote - TypeScript Entry Point
 * Express setup, route mounting, intervals, listen
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import {
    db, CLAUDE_REMOTE_DIR, PENDING_DIR, RESOLVED_DIR, CONTEXTS_DIR,
    PID_FILE, syncRegistry
} from './db';
import * as orchestrator from './orchestrator';
import { createWebSocketServer, broadcast, broadcastPrompts, broadcastTerminal as wsBroadcastTerminal, stopHeartbeat } from './ws';
import {
    listActiveSessions, getActiveSession, captureTerminal, readPendingPrompts,
    getLastBroadcastContent, setLastBroadcastContent, appendToLog
} from './services/terminal';
import {
    generateId, loadConfig, sendDigestPush, createGoal, runNextTask,
    abortAllTasks, setBroadcastFn, setOrchestrator, setAdvancePipelineFn
} from './services/planning';
import { checkDigestSchedule } from './services/digest';
import { checkWeeklyReportSchedule } from './services/reports';
// Maintenance removed — autonomous agents with unrestricted shell access are too dangerous
import { advancePipeline, setCreateGoalFn, setBroadcastFn as setProductsBroadcastFn, setLoadConfigFn } from './services/products';

// Route modules
import promptsRouter from './routes/prompts';
import tasksRouter from './routes/tasks';
import goalsRouter from './routes/goals';
import productsRouter from './routes/products';
import portfolioRouter from './routes/portfolio';
import bridgeRouter from './routes/bridge';
import analyticsRouter from './routes/analytics';
import proposalsRouter from './routes/proposals';

// ── Single instance lock ─────────────────────────────────

const app = express();

const TLS_CERT = path.join(CLAUDE_REMOTE_DIR, 'tls.crt');
const TLS_KEY = path.join(CLAUDE_REMOTE_DIR, 'tls.key');
const useHttps = fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY);

const server = useHttps
    ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, app)
    : http.createServer(app);

const PORT = process.env.PORT || 3847;
const UI_DIR = path.join(__dirname, '..', 'ui');

(function ensureSingleInstance() {
    if (fs.existsSync(PID_FILE)) {
        const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (oldPid) {
            try {
                process.kill(oldPid, 0);
                console.log(`Killing previous server (PID ${oldPid})`);
                process.kill(oldPid, 'SIGTERM');
                const start = Date.now();
                while (Date.now() - start < 1000) { /* spin */ }
            } catch {
                // Not running — stale PID file
            }
        }
    }
    if (!fs.existsSync(CLAUDE_REMOTE_DIR)) {
        fs.mkdirSync(CLAUDE_REMOTE_DIR, { recursive: true });
    }
    fs.writeFileSync(PID_FILE, String(process.pid));
})();

function cleanPid() {
    try { if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PID_FILE); } catch {}
}
process.on('exit', cleanPid);
process.on('SIGINT', () => { cleanPid(); process.exit(0); });

// ── Middleware ────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));

// Serve static UI assets (for app.js bundle)
app.use(express.static(UI_DIR));

// Ensure directories exist
[PENDING_DIR, RESOLVED_DIR, CONTEXTS_DIR].forEach(dir => {
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

// ── Mount routes ─────────────────────────────────────────

// Full-path routers (define their own /api/... paths)
app.use(promptsRouter);
app.use(tasksRouter);
app.use(bridgeRouter);
app.use(analyticsRouter);
app.use(proposalsRouter);

// Prefix-mounted routers (use relative paths internally)
app.use('/api/goals', goalsRouter);
app.use('/api/products', productsRouter);
app.use('/api', portfolioRouter);

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

// ── Terminal broadcast (1-second loop) ───────────────────

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
        fs.writeFileSync(path.join(CLAUDE_REMOTE_DIR, 'terminal.txt'), result.content);
    } catch { /* best effort */ }

    appendToLog(result.content);
    wsBroadcastTerminal(result.content, result.session);
}

// ── Scheduled intervals ──────────────────────────────────

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

// ── Initialize orchestrator ──────────────────────────────

orchestrator.initialize().then(status => {
    console.log('[Orchestrator] Initialized:', status);
}).catch(err => {
    console.error('[Orchestrator] Initialization failed:', err);
});

// ── Start server ─────────────────────────────────────────

server.listen(Number(PORT), '0.0.0.0', () => {
    const proto = useHttps ? 'https' : 'http';
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    Claude Remote Server                    ║
╠═══════════════════════════════════════════════════════════╣
║  Mode:     ${useHttps ? 'HTTPS (Tailscale TLS)' : 'HTTP (no TLS certs found)'}${useHttps ? '              ' : '         '}║
║  Local:    ${proto}://localhost:${PORT}                        ║
║  Network:  ${proto}://<your-ip>:${PORT}                        ║
╚═══════════════════════════════════════════════════════════╝
`);
});

process.on('SIGTERM', () => {
    cleanPid();
    stopHeartbeat();
    clearInterval(terminalBroadcastInterval);
    clearInterval(orchestratorInterval);
    clearInterval(digestInterval);
    clearInterval(weeklyReportInterval);
    abortAllTasks();
    try { db.close(); } catch {}
    wss.close();
    server.close();
    process.exit(0);
});
