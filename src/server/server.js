/**
 * Claude Remote - API Server
 * Serves the mobile web UI and handles prompt responses
 * WebSocket push for real-time updates
 */

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { execFileSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3847;
const CLAUDE_REMOTE_DIR = process.env.CLAUDE_REMOTE_DIR || path.join(process.env.HOME, '.claude-remote');
const PENDING_DIR = path.join(CLAUDE_REMOTE_DIR, 'pending');
const RESOLVED_DIR = path.join(CLAUDE_REMOTE_DIR, 'resolved');
const UI_PATH = path.join(__dirname, '..', 'ui', 'index.html');

// Middleware
app.use(express.json());

// Ensure directories exist
[PENDING_DIR, RESOLVED_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

/**
 * Serve the mobile web UI
 */
app.get('/', (req, res) => {
    if (fs.existsSync(UI_PATH)) {
        res.set('Cache-Control', 'no-store');
        res.sendFile(UI_PATH);
    } else {
        res.status(404).send('UI not found. Ensure src/ui/index.html exists.');
    }
});

/**
 * Read all pending prompts with live terminal content
 */
function readPendingPrompts() {
    const prompts = [];

    if (!fs.existsSync(PENDING_DIR)) return prompts;

    const files = fs.readdirSync(PENDING_DIR)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Newest first

    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(PENDING_DIR, file), 'utf8');
            const prompt = JSON.parse(content);

            // Capture tmux pane content to get the actual prompt with options
            if (prompt.tmux_session) {
                try {
                    const paneContent = execFileSync('tmux', [
                        'capture-pane', '-t', prompt.tmux_session, '-p', '-e'
                    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                    prompt.terminal_content = paneContent;
                } catch {
                    // tmux session may not exist
                }
            }

            prompts.push(prompt);
        } catch (err) {
            console.error(`Error reading prompt file ${file}:`, err.message);
        }
    }

    return prompts;
}

/**
 * Get all pending prompts (HTTP fallback)
 */
app.get('/api/prompts', (req, res) => {
    try {
        const prompts = readPendingPrompts();
        res.json({ success: true, prompts, count: prompts.length });
    } catch (err) {
        console.error('Error fetching prompts:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Send a response to Claude Code
 */
app.post('/api/respond', (req, res) => {
    try {
        const { id, response } = req.body;

        if (!id || response === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing id or response'
            });
        }

        // Find the prompt file
        const promptFile = path.join(PENDING_DIR, `${id}.json`);

        if (!fs.existsSync(promptFile)) {
            return res.status(404).json({
                success: false,
                error: 'Prompt not found'
            });
        }

        // Read prompt to get tmux session
        const prompt = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
        const tmuxSession = prompt.tmux_session;

        if (!tmuxSession) {
            return res.status(400).json({
                success: false,
                error: 'No tmux session associated with this prompt'
            });
        }

        // Check if tmux session exists (using execFileSync for safety)
        try {
            execFileSync('tmux', ['has-session', '-t', tmuxSession], { stdio: 'ignore' });
        } catch {
            // Session doesn't exist - clean up the prompt file
            fs.renameSync(promptFile, path.join(RESOLVED_DIR, `${id}.json`));
            return res.status(400).json({
                success: false,
                error: 'tmux session no longer exists'
            });
        }

        // Inject the response via tmux using execFile (safe from injection)
        // For numbered menu selections, send just the key (no Enter needed)
        const sendEnter = !req.body.noEnter;
        const args = ['send-keys', '-t', tmuxSession, response];
        if (sendEnter) args.push('Enter');
        execFile('tmux', args, (err) => {
            if (err) {
                console.error('Error sending keys:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to send response to tmux'
                });
            }

            // Move prompt file to resolved
            const resolvedFile = path.join(RESOLVED_DIR, `${id}.json`);
            prompt.resolved_at = new Date().toISOString();
            prompt.response = response;
            fs.writeFileSync(resolvedFile, JSON.stringify(prompt, null, 2));
            fs.unlinkSync(promptFile);

            console.log(`Response sent to ${tmuxSession}: ${response.substring(0, 50)}...`);

            // Broadcast updated state to WebSocket clients
            broadcastPrompts();

            res.json({
                success: true,
                message: 'Response sent'
            });
        });
    } catch (err) {
        console.error('Error responding:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * Server status / health check
 */
app.get('/api/status', (req, res) => {
    // Count pending prompts
    let pendingCount = 0;
    if (fs.existsSync(PENDING_DIR)) {
        pendingCount = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith('.json')).length;
    }

    // List tmux sessions (using execFileSync for safety)
    let sessions = [];
    try {
        const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        sessions = output.trim().split('\n')
            .filter(s => s.startsWith('claude-remote'))
            .filter(Boolean);
    } catch {
        // No sessions or tmux not running
    }

    res.json({
        success: true,
        status: 'running',
        pending_prompts: pendingCount,
        active_sessions: sessions,
        uptime: process.uptime()
    });
});

/**
 * Quick-response page for ntfy.sh action buttons
 * Opens in phone browser, fires API call, shows result
 */
const ALLOWED_ACTIONS = new Set(['1','2','3','4','5','6','7','8','9','y','n','Y','N','Enter','Escape']);

app.get('/quick', (req, res) => {
    const { id, action } = req.query;

    if (!id || !action) {
        return res.status(400).send('Missing id or action');
    }

    if (!ALLOWED_ACTIONS.has(action)) {
        return res.status(400).send('Invalid action');
    }

    // Sanitise for embedding in HTML
    const safeId = id.replace(/[^a-zA-Z0-9\-_]/g, '');
    const safeAction = action.replace(/[^a-zA-Z0-9]/g, '');

    res.set('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#0a0e14">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0e14; color: #e6edf3; font-family: -apple-system, system-ui, sans-serif;
       display: flex; align-items: center; justify-content: center;
       height: 100vh; margin: 0; flex-direction: column; gap: 16px;
       padding: 20px; text-align: center; }
.icon { font-size: 48px; margin-bottom: 8px; }
.status { font-size: 22px; font-weight: 600; }
.detail { font-size: 14px; color: #8b949e; line-height: 1.5; }
.ok { color: #3fb950; }
.err { color: #f85149; }
.link { color: #39d0d8; text-decoration: none; font-size: 14px; margin-top: 8px; }
</style>
</head>
<body>
<div class="icon" id="icon">&#x23F3;</div>
<div class="status" id="msg">Sending response...</div>
<div class="detail" id="detail">Approving action ${safeAction}</div>
<script>
fetch('/api/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '${safeId}', response: '${safeAction}', noEnter: true })
})
.then(r => r.json())
.then(d => {
    const icon = document.getElementById('icon');
    const msg = document.getElementById('msg');
    const detail = document.getElementById('detail');
    if (d.success) {
        icon.textContent = '\\u2705';
        msg.textContent = 'Response sent';
        msg.className = 'status ok';
        detail.innerHTML = 'Claude Code received your input<br><a class="link" href="/">Open full UI</a>';
    } else {
        icon.textContent = '\\u274C';
        msg.textContent = d.error || 'Failed';
        msg.className = 'status err';
        detail.innerHTML = 'The prompt may have already been resolved<br><a class="link" href="/">Open full UI</a>';
    }
})
.catch(() => {
    document.getElementById('icon').textContent = '\\u26A0\\uFE0F';
    document.getElementById('msg').textContent = 'Connection error';
    document.getElementById('msg').className = 'status err';
    document.getElementById('detail').innerHTML = 'Could not reach the server<br><a class="link" href="/">Retry</a>';
});
</script>
</body></html>`);
});

/**
 * Notification history — resolved prompts
 */
app.get('/api/history', (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);

        if (!fs.existsSync(RESOLVED_DIR)) {
            return res.json({ success: true, history: [], count: 0 });
        }

        const files = fs.readdirSync(RESOLVED_DIR)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => b.localeCompare(a))
            .slice(0, limit);

        const history = [];
        for (const file of files) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(RESOLVED_DIR, file), 'utf8'));
                delete content.terminal;
                delete content.terminal_content;
                history.push(content);
            } catch {
                // Skip malformed files
            }
        }

        res.json({ success: true, history, count: history.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Clear a prompt without responding (dismiss)
 */
app.delete('/api/prompts/:id', (req, res) => {
    try {
        const { id } = req.params;
        const promptFile = path.join(PENDING_DIR, `${id}.json`);

        if (!fs.existsSync(promptFile)) {
            return res.status(404).json({
                success: false,
                error: 'Prompt not found'
            });
        }

        // Move to resolved without responding
        const prompt = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
        prompt.resolved_at = new Date().toISOString();
        prompt.dismissed = true;

        const resolvedFile = path.join(RESOLVED_DIR, `${id}.json`);
        fs.writeFileSync(resolvedFile, JSON.stringify(prompt, null, 2));
        fs.unlinkSync(promptFile);

        broadcastPrompts();

        res.json({
            success: true,
            message: 'Prompt dismissed'
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ── WebSocket server ──────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });

/**
 * Broadcast current prompts to all connected WebSocket clients
 */
function broadcastPrompts() {
    if (wss.clients.size === 0) return;

    const prompts = readPendingPrompts();
    const message = JSON.stringify({
        type: 'prompts',
        prompts,
        count: prompts.length
    });

    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}

// Connection handling
wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    // Send current state immediately
    const prompts = readPendingPrompts();
    ws.send(JSON.stringify({
        type: 'prompts',
        prompts,
        count: prompts.length
    }));

    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });
});

// Heartbeat interval — detect dead connections (iOS Safari drops silently)
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// ── File system watcher ──────────────────────────────────

let watchDebounce = null;

fs.watch(PENDING_DIR, (eventType, filename) => {
    if (!filename || !filename.endsWith('.json')) return;

    // Debounce: Linux inotify fires multiple events per file write
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
        console.log(`Pending changed: ${eventType} ${filename}`);
        broadcastPrompts();
    }, 100);
});

// ── Start server ─────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    Claude Remote Server                    ║
╠═══════════════════════════════════════════════════════════╣
║  Local:    http://localhost:${PORT}                         ║
║  Network:  http://<your-ip>:${PORT}                         ║
╠═══════════════════════════════════════════════════════════╣
║  API Endpoints:                                            ║
║    GET  /api/prompts    - List pending prompts             ║
║    POST /api/respond    - Send response to Claude          ║
║    GET  /api/history    - Notification history             ║
║    GET  /api/status     - Server status                    ║
║    GET  /quick          - Quick response (ntfy actions)    ║
║    WS   /ws             - WebSocket push                   ║
╚═══════════════════════════════════════════════════════════╝
`);
});

process.on('SIGTERM', () => {
    clearInterval(heartbeatInterval);
    wss.close();
    server.close();
});
