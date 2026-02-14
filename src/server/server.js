/**
 * Claude Remote - API Server
 * Serves the mobile web UI and handles prompt responses
 * WebSocket push for real-time updates
 */

const http = require('http');
const https = require('https');
const express = require('express');
const { WebSocketServer } = require('ws');
const { execFileSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { query: agentQuery } = require('@anthropic-ai/claude-agent-sdk');

const app = express();

// Use HTTPS if Tailscale certs exist, otherwise HTTP
const CLAUDE_REMOTE_DIR_EARLY = process.env.CLAUDE_REMOTE_DIR || path.join(process.env.HOME, '.claude-remote');
const TLS_CERT = path.join(CLAUDE_REMOTE_DIR_EARLY, 'tls.crt');
const TLS_KEY = path.join(CLAUDE_REMOTE_DIR_EARLY, 'tls.key');
const useHttps = fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY);

const server = useHttps
    ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, app)
    : http.createServer(app);
const PORT = process.env.PORT || 3847;
const CLAUDE_REMOTE_DIR = process.env.CLAUDE_REMOTE_DIR || path.join(process.env.HOME, '.claude-remote');
const PENDING_DIR = path.join(CLAUDE_REMOTE_DIR, 'pending');
const RESOLVED_DIR = path.join(CLAUDE_REMOTE_DIR, 'resolved');
const BRIDGE_DIR = path.join(CLAUDE_REMOTE_DIR, 'bridge');
const CONTEXTS_DIR = path.join(BRIDGE_DIR, 'contexts');
const BRIDGE_HISTORY = path.join(BRIDGE_DIR, 'history.json');
const UI_PATH = path.join(__dirname, '..', 'ui', 'index.html');
const PID_FILE = path.join(CLAUDE_REMOTE_DIR, 'server.pid');

// ── Single instance lock ─────────────────────────────────
(function ensureSingleInstance() {
    if (fs.existsSync(PID_FILE)) {
        const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (oldPid) {
            try {
                process.kill(oldPid, 0); // Check if running
                // Still running — kill it
                console.log(`Killing previous server (PID ${oldPid})`);
                process.kill(oldPid, 'SIGTERM');
                // Brief wait for port release
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

// Clean up PID file on exit
function cleanPid() {
    try { if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PID_FILE); } catch {}
}
process.on('exit', cleanPid);
process.on('SIGINT', () => { cleanPid(); process.exit(0); });

// Middleware
app.use(express.json({ limit: '1mb' }));

// Ensure directories exist
[PENDING_DIR, RESOLVED_DIR, CONTEXTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// ── SQLite task queue ────────────────────────────────────
const TASKS_DB_PATH = path.join(CLAUDE_REMOTE_DIR, 'tasks.db');
const db = new Database(TASKS_DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    project_path TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    model TEXT DEFAULT 'sonnet',
    max_turns INTEGER DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    result TEXT,
    error TEXT,
    cost_usd REAL DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    turns INTEGER DEFAULT 0
)`);

// Migrate existing databases to add new columns
const columns = db.pragma("table_info('tasks')").map(col => col.name);
if (!columns.includes('checkpoint_ref')) {
    console.log('[DB] Adding Level 7 completion columns...');
    db.exec(`ALTER TABLE tasks ADD COLUMN checkpoint_ref TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN checkpoint_created_at TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN checkpoint_type TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN gate_mode TEXT DEFAULT 'bypass'`);
    db.exec(`ALTER TABLE tasks ADD COLUMN allowed_tools TEXT`);
    console.log('[DB] Migration complete');
}
if (!columns.includes('log_file')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN log_file TEXT`);
    console.log('[DB] Added log_file column');
}

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
 * List active claude-remote tmux sessions
 */
function listActiveSessions() {
    try {
        const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return output.trim().split('\n')
            .filter(s => s.startsWith('claude-remote'))
            .filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Get the first active claude-remote session (or null)
 */
function getActiveSession() {
    const sessions = listActiveSessions();
    return sessions.length > 0 ? sessions[0] : null;
}

/**
 * Capture terminal content from a tmux session (plain text, no ANSI, full scrollback)
 */
function captureTerminal(session) {
    try {
        const content = execFileSync('tmux', [
            'capture-pane', '-t', session, '-p', '-S', '-'
        ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 });
        return { content, session };
    } catch {
        return null;
    }
}

/**
 * Strip ANSI escape codes from text
 */
function stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
               .replace(/\x1b\][^\x07]*\x07/g, '')
               .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Capture full scrollback from a tmux session (entire history)
 */
function captureFullScrollback(session) {
    try {
        const content = execFileSync('tmux', [
            'capture-pane', '-t', session, '-p', '-S', '-'
        ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 });
        return content;
    } catch {
        return null;
    }
}

/**
 * Format session content as markdown for export
 */
function formatExport(content, session) {
    const timestamp = new Date().toISOString();
    const clean = stripAnsi(content).replace(/\s+$/, '');

    return `# Claude Code Session Export\n\n` +
           `**Session**: ${session}\n` +
           `**Exported**: ${timestamp}\n\n` +
           `---\n\n` +
           '```\n' + clean + '\n```\n';
}

// ── Git checkpoint helpers ───────────────────────────────────

/**
 * Check if a directory is a git repository
 */
function isGitRepo(projectPath) {
    try {
        execFileSync('git', ['rev-parse', '--git-dir'], {
            cwd: projectPath,
            stdio: 'ignore'
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if there are uncommitted changes in the working tree
 */
function hasUncommittedChanges(projectPath) {
    try {
        const output = execFileSync('git', ['status', '--porcelain'], {
            cwd: projectPath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return output.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * Create a git checkpoint before task execution
 * Returns { ref, type } where type is 'branch', 'stash', or 'none'
 */
function createCheckpoint(projectPath, taskId) {
    const isDirty = hasUncommittedChanges(projectPath);

    if (isDirty) {
        // Dirty working tree — create stash
        const stashMessage = `claude-remote checkpoint ${taskId}`;
        try {
            execFileSync('git', ['stash', 'push', '-u', '-m', stashMessage], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Created stash checkpoint for task ${taskId}`);
            return { ref: stashMessage, type: 'stash' };
        } catch (err) {
            console.error(`[Git] Failed to create stash:`, err.message);
            return { ref: null, type: 'none' };
        }
    } else {
        // Clean working tree — create branch
        const branchName = `claude-remote/checkpoint-${taskId}`;
        try {
            execFileSync('git', ['branch', branchName], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Created branch checkpoint: ${branchName}`);
            return { ref: branchName, type: 'branch' };
        } catch (err) {
            console.error(`[Git] Failed to create branch:`, err.message);
            return { ref: null, type: 'none' };
        }
    }
}

/**
 * Rollback to a git checkpoint after task failure
 */
function rollbackCheckpoint(projectPath, checkpointRef, checkpointType) {
    if (!checkpointRef || checkpointType === 'none') return;

    try {
        if (checkpointType === 'stash') {
            // Find the stash by message and pop it
            const stashList = execFileSync('git', ['stash', 'list'], {
                cwd: projectPath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            });

            const lines = stashList.trim().split('\n');
            for (const line of lines) {
                if (line.includes(checkpointRef)) {
                    const match = line.match(/^(stash@\{\d+\})/);
                    if (match) {
                        // Reset working tree and apply stash
                        execFileSync('git', ['reset', '--hard'], {
                            cwd: projectPath,
                            stdio: 'ignore'
                        });
                        execFileSync('git', ['stash', 'pop', match[1]], {
                            cwd: projectPath,
                            stdio: 'ignore'
                        });
                        console.log(`[Git] Rolled back to stash: ${checkpointRef}`);
                        return;
                    }
                }
            }
        } else if (checkpointType === 'branch') {
            // Reset to the branch
            execFileSync('git', ['reset', '--hard', checkpointRef], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Rolled back to branch: ${checkpointRef}`);
        }
    } catch (err) {
        console.error(`[Git] Rollback failed:`, err.message);
    }
}

/**
 * Clean up a git checkpoint after successful task completion
 */
function cleanupCheckpoint(projectPath, checkpointRef, checkpointType) {
    if (!checkpointRef || checkpointType === 'none') return;

    try {
        if (checkpointType === 'branch') {
            // Delete the checkpoint branch
            execFileSync('git', ['branch', '-D', checkpointRef], {
                cwd: projectPath,
                stdio: 'ignore'
            });
            console.log(`[Git] Cleaned up checkpoint branch: ${checkpointRef}`);
        } else if (checkpointType === 'stash') {
            // Drop the stash
            const stashList = execFileSync('git', ['stash', 'list'], {
                cwd: projectPath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            });

            const lines = stashList.trim().split('\n');
            for (const line of lines) {
                if (line.includes(checkpointRef)) {
                    const match = line.match(/^(stash@\{\d+\})/);
                    if (match) {
                        execFileSync('git', ['stash', 'drop', match[1]], {
                            cwd: projectPath,
                            stdio: 'ignore'
                        });
                        console.log(`[Git] Cleaned up checkpoint stash: ${checkpointRef}`);
                        return;
                    }
                }
            }
        }
    } catch (err) {
        console.error(`[Git] Cleanup failed:`, err.message);
    }
}

/**
 * Log a bridge event to history
 */
function logBridgeEvent(type, label, metadata = {}) {
    let history = [];
    try {
        if (fs.existsSync(BRIDGE_HISTORY)) {
            history = JSON.parse(fs.readFileSync(BRIDGE_HISTORY, 'utf8'));
        }
    } catch { /* start fresh */ }

    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const entry = {
        id,
        type,
        label: label || type,
        timestamp: new Date().toISOString(),
        ...metadata
    };

    history.unshift(entry);
    // Keep last 200 entries
    if (history.length > 200) history = history.slice(0, 200);
    fs.writeFileSync(BRIDGE_HISTORY, JSON.stringify(history, null, 2));
    return entry;
}

// Track last broadcast content for diffing
let lastBroadcastContent = '';

// Append-only terminal log with timestamps
const TERMINAL_LOG = path.join(CLAUDE_REMOTE_DIR, 'terminal-log.txt');
let lastLoggedLines = [];
let lastTimestamp = 0;
const TIMESTAMP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function appendToLog(content) {
    try {
        const lines = content.split('\n');
        const now = Date.now();

        // Find new lines by matching the tail of lastLoggedLines against lines
        let newStart = 0;
        if (lastLoggedLines.length > 0) {
            // Find where lastLoggedLines ends within current content
            const lastFew = lastLoggedLines.slice(-20);
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i] === lastFew[lastFew.length - 1]) {
                    // Check if the preceding lines match too
                    let match = true;
                    for (let j = 1; j < lastFew.length && i - j >= 0; j++) {
                        if (lines[i - j] !== lastFew[lastFew.length - 1 - j]) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        newStart = i + 1;
                        break;
                    }
                }
            }
        }

        if (newStart >= lines.length && lastLoggedLines.length > 0) return; // nothing new

        const newLines = lastLoggedLines.length === 0 ? lines : lines.slice(newStart);
        if (newLines.length === 0) return;

        let output = '';

        // Add timestamp every 5 minutes
        if (now - lastTimestamp >= TIMESTAMP_INTERVAL) {
            output += `\n--- ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} ---\n`;
            lastTimestamp = now;
        }

        output += newLines.join('\n') + '\n';
        fs.appendFileSync(TERMINAL_LOG, output);
        lastLoggedLines = lines;
    } catch { /* best effort */ }
}

/**
 * Broadcast terminal content to all WS clients (called on interval)
 */
function broadcastTerminal() {
    if (wss.clients.size === 0) return;

    const session = getActiveSession();
    if (!session) {
        if (lastBroadcastContent !== null) {
            lastBroadcastContent = null;
            const message = JSON.stringify({ type: 'terminal', content: null, session: null });
            wss.clients.forEach((client) => {
                if (client.readyState === 1) client.send(message);
            });
        }
        return;
    }

    const result = captureTerminal(session);
    if (!result) return;

    if (result.content === lastBroadcastContent) return;
    lastBroadcastContent = result.content;

    // Persist snapshot for UI startup
    try {
        fs.writeFileSync(path.join(CLAUDE_REMOTE_DIR, 'terminal.txt'), result.content);
    } catch { /* best effort */ }

    // Append new lines to persistent log
    appendToLog(result.content);

    const message = JSON.stringify({
        type: 'terminal',
        content: result.content,
        session: result.session
    });

    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
    });
}

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

    const sessions = listActiveSessions();

    res.json({
        success: true,
        status: 'running',
        pending_prompts: pendingCount,
        active_sessions: sessions,
        uptime: process.uptime()
    });
});

const TERMINAL_FILE = path.join(CLAUDE_REMOTE_DIR, 'terminal.txt');

app.get('/api/terminal', (req, res) => {
    try {
        const content = fs.readFileSync(TERMINAL_FILE, 'utf8');
        res.json({ success: true, content });
    } catch {
        res.json({ success: true, content: '' });
    }
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
 * Send keystrokes directly to the active tmux session (no prompt required)
 */
const SPECIAL_KEYS = new Set(['Enter', 'Escape', 'Tab', 'Up', 'Down', 'Left', 'Right', 'C-c', 'C-d', 'C-z', 'C-l', 'BSpace']);

app.post('/api/keys', (req, res) => {
    try {
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({ success: false, error: 'Missing key' });
        }

        const session = getActiveSession();
        if (!session) {
            return res.status(400).json({ success: false, error: 'No active tmux session' });
        }

        // Special keys are sent as bare key names, literal text uses -l flag
        const args = SPECIAL_KEYS.has(key)
            ? ['send-keys', '-t', session, key]
            : ['send-keys', '-t', session, '-l', key];

        execFile('tmux', args, (err) => {
            if (err) {
                console.error('Error sending key:', err);
                return res.status(500).json({ success: false, error: 'Failed to send key' });
            }
            res.json({ success: true });
        });
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

// ── Bridge endpoints ─────────────────────────────────

/**
 * Export current session as formatted markdown
 */
app.get('/api/bridge/export', (req, res) => {
    try {
        const session = getActiveSession();
        if (!session) {
            return res.status(400).json({ success: false, error: 'No active tmux session' });
        }

        const content = captureFullScrollback(session);
        if (!content) {
            return res.status(500).json({ success: false, error: 'Failed to capture terminal' });
        }

        const markdown = formatExport(content, session);

        // Auto-save to file
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const filename = `export-${id}.md`;
        const filepath = path.join(CONTEXTS_DIR, filename);
        fs.writeFileSync(filepath, markdown);

        const inject = req.query.inject === 'true';
        if (inject) {
            const cmd = `Read this context file — it contains the exported session: ${filepath}`;
            execFile('tmux', ['send-keys', '-t', session, '-l', cmd], (err) => {
                if (!err) {
                    execFile('tmux', ['send-keys', '-t', session, 'Enter']);
                }
            });
        }

        const clean = stripAnsi(content).replace(/\s+$/, '');
        const lineCount = clean.split('\n').length;

        logBridgeEvent('export', `Export (${lineCount} lines)`, { filename, session, lineCount });

        res.json({ success: true, filename, path: filepath, lineCount, injected: inject, content: markdown });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Import context from phone (paste from claude.ai etc)
 */
app.post('/api/bridge/import', (req, res) => {
    try {
        const { content, label, inject } = req.body;

        if (!content) {
            return res.status(400).json({ success: false, error: 'Missing content' });
        }

        // Save context file
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const filename = `${id}.md`;
        const filepath = path.join(CONTEXTS_DIR, filename);
        fs.writeFileSync(filepath, content);

        const entry = logBridgeEvent('import', label || 'Imported context', { filename });

        // Optionally inject a read command into Claude Code
        if (inject) {
            const session = getActiveSession();
            if (session) {
                const cmd = `Read this context file and follow the instructions: ${filepath}`;
                execFile('tmux', ['send-keys', '-t', session, '-l', cmd], (err) => {
                    if (!err) {
                        execFile('tmux', ['send-keys', '-t', session, 'Enter']);
                    }
                });
            }
        }

        res.json({ success: true, id: entry.id, filename, path: filepath });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * List saved context files
 */
app.get('/api/bridge/contexts', (req, res) => {
    try {
        if (!fs.existsSync(CONTEXTS_DIR)) {
            return res.json({ success: true, contexts: [] });
        }

        const files = fs.readdirSync(CONTEXTS_DIR)
            .filter(f => f.endsWith('.md'))
            .sort((a, b) => b.localeCompare(a));

        const contexts = files.map(f => {
            const filepath = path.join(CONTEXTS_DIR, f);
            const stat = fs.statSync(filepath);
            const content = fs.readFileSync(filepath, 'utf8');
            return {
                filename: f,
                size: stat.size,
                created: stat.birthtime.toISOString(),
                preview: content.substring(0, 200)
            };
        });

        res.json({ success: true, contexts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Get a specific context file
 */
app.get('/api/bridge/contexts/:filename', (req, res) => {
    try {
        const filepath = path.join(CONTEXTS_DIR, path.basename(req.params.filename));
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ success: false, error: 'Context not found' });
        }
        const content = fs.readFileSync(filepath, 'utf8');
        res.json({ success: true, content, filename: req.params.filename });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Delete a context file
 */
app.delete('/api/bridge/contexts/:filename', (req, res) => {
    try {
        const filepath = path.join(CONTEXTS_DIR, path.basename(req.params.filename));
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ success: false, error: 'Context not found' });
        }
        fs.unlinkSync(filepath);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Structured handoff — combine task + context + inject
 */
app.post('/api/bridge/handoff', (req, res) => {
    try {
        const { task, context, workingDir } = req.body;

        if (!task) {
            return res.status(400).json({ success: false, error: 'Missing task description' });
        }

        // Build handoff prompt
        let prompt = task;
        if (context) {
            prompt += '\n\n## Context\n\n' + context;
        }
        if (workingDir) {
            prompt += '\n\nWorking directory: ' + workingDir;
        }

        // Save as context file
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const filename = `handoff-${id}.md`;
        const filepath = path.join(CONTEXTS_DIR, filename);
        fs.writeFileSync(filepath, prompt);

        logBridgeEvent('handoff', 'Handoff: ' + task.substring(0, 50), { filename });

        // Inject into Claude Code
        const session = getActiveSession();
        if (session) {
            const cmd = `Read this context file and follow the instructions: ${filepath}`;
            execFile('tmux', ['send-keys', '-t', session, '-l', cmd], (err) => {
                if (!err) {
                    execFile('tmux', ['send-keys', '-t', session, 'Enter']);
                }
            });
            res.json({ success: true, filename, injected: true });
        } else {
            res.json({ success: true, filename, injected: false, note: 'No active session — context saved for later' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Bridge history — all import/export events
 */
app.get('/api/bridge/history', (req, res) => {
    try {
        if (!fs.existsSync(BRIDGE_HISTORY)) {
            return res.json({ success: true, history: [] });
        }
        const history = JSON.parse(fs.readFileSync(BRIDGE_HISTORY, 'utf8'));
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        res.json({ success: true, history: history.slice(0, limit) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Task queue endpoints ──────────────────────────────────

const taskStmts = {
    list: db.prepare('SELECT * FROM tasks ORDER BY CASE status WHEN \'running\' THEN 0 WHEN \'pending\' THEN 1 ELSE 2 END, priority DESC, created_at DESC'),
    listByStatus: db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at DESC'),
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    insert: db.prepare('INSERT INTO tasks (id, title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateStatus: db.prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?'),
    updateCheckpoint: db.prepare('UPDATE tasks SET checkpoint_ref = ?, checkpoint_type = ?, checkpoint_created_at = ? WHERE id = ?'),
    updateLogFile: db.prepare('UPDATE tasks SET log_file = ? WHERE id = ?'),
    complete: db.prepare('UPDATE tasks SET status = ?, completed_at = ?, result = ?, cost_usd = ?, tokens_in = ?, tokens_out = ?, turns = ? WHERE id = ?'),
    fail: db.prepare('UPDATE tasks SET status = ?, completed_at = ?, error = ? WHERE id = ?'),
    cancel: db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM tasks WHERE id = ?'),
    nextPending: db.prepare('SELECT * FROM tasks WHERE status = \'pending\' ORDER BY priority DESC, created_at ASC LIMIT 1'),
};

/**
 * List tasks (optionally filtered by status)
 */
app.get('/api/tasks', (req, res) => {
    try {
        const tasks = req.query.status
            ? taskStmts.listByStatus.all(req.query.status)
            : taskStmts.list.all();
        res.json({ success: true, tasks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Create a new task
 */
app.post('/api/tasks', (req, res) => {
    try {
        const { title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools } = req.body;

        if (!title || !description || !project_path) {
            return res.status(400).json({ success: false, error: 'Missing title, description, or project_path' });
        }

        // Validate gate_mode
        const validGateModes = ['bypass', 'edits_only', 'approve_all'];
        const finalGateMode = gate_mode && validGateModes.includes(gate_mode) ? gate_mode : 'bypass';

        // Validate and serialize allowed_tools
        let allowedToolsJson = null;
        if (allowed_tools) {
            if (Array.isArray(allowed_tools) && allowed_tools.length > 0) {
                allowedToolsJson = JSON.stringify(allowed_tools);
            } else if (typeof allowed_tools === 'string') {
                // Already JSON string
                try {
                    JSON.parse(allowed_tools); // Validate
                    allowedToolsJson = allowed_tools;
                } catch {
                    return res.status(400).json({ success: false, error: 'Invalid allowed_tools JSON' });
                }
            }
        }

        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        const now = new Date().toISOString();

        taskStmts.insert.run(id, title, description, project_path,
            priority || 0, model || 'sonnet', max_turns || 100, finalGateMode, allowedToolsJson, now);

        const task = taskStmts.get.get(id);
        broadcastTaskUpdate(task);

        res.json({ success: true, task });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Get a single task
 */
app.get('/api/tasks/:id', (req, res) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        res.json({ success: true, task });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Cancel a running or pending task
 */
app.post('/api/tasks/:id/cancel', (req, res) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        if (task.status !== 'pending' && task.status !== 'running') {
            return res.status(400).json({ success: false, error: 'Task is not pending or running' });
        }

        // If running, abort the agent
        if (task.status === 'running' && runningAbort) {
            runningAbort.abort();
        }

        taskStmts.cancel.run('cancelled', new Date().toISOString(), task.id);
        const updated = taskStmts.get.get(task.id);
        broadcastTaskUpdate(updated);
        res.json({ success: true, task: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Delete a task
 */
app.delete('/api/tasks/:id', (req, res) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        if (task.status === 'running') {
            return res.status(400).json({ success: false, error: 'Cannot delete a running task — cancel it first' });
        }
        taskStmts.del.run(task.id);
        broadcastTaskUpdate({ ...task, status: 'deleted' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Get a task's execution log
 */
app.get('/api/tasks/:id/log', (req, res) => {
    try {
        const task = taskStmts.get.get(req.params.id);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        if (!task.log_file) return res.status(404).json({ success: false, error: 'No log file for this task' });

        if (!fs.existsSync(task.log_file)) {
            return res.status(404).json({ success: false, error: 'Log file not found on disk' });
        }

        const content = fs.readFileSync(task.log_file, 'utf8');
        res.json({ success: true, log: content, path: task.log_file });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Approval gates ────────────────────────────────────────

const pendingApprovals = new Map(); // toolUseID -> { taskId, toolName, input, resolve, reject, timestamp }

/**
 * Broadcast approval request to phone
 */
function broadcastApprovalRequest(approval) {
    if (wss.clients.size === 0) return;
    const message = JSON.stringify({ type: 'approval_request', ...approval });
    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
    });
}

/**
 * Create a canUseTool callback for approval gates
 */
async function createCanUseToolCallback(taskId, gateMode) {
    return async (toolName, input, options) => {
        if (gateMode === 'bypass') {
            return { behavior: 'allow' };
        }

        const isDangerous = ['Bash', 'Write', 'Edit', 'NotebookEdit'].includes(toolName);
        const shouldGate = (gateMode === 'approve_all') ||
                          (gateMode === 'edits_only' && isDangerous);

        if (!shouldGate) {
            return { behavior: 'allow' };
        }

        // Route to phone for approval
        const approvalPromise = new Promise((resolve, reject) => {
            const approvalId = options.toolUseID || `${taskId}-${Date.now()}`;
            pendingApprovals.set(approvalId, {
                taskId,
                toolName,
                input,
                resolve,
                reject,
                timestamp: new Date().toISOString()
            });

            // Broadcast to phone
            broadcastApprovalRequest({
                approvalId,
                taskId,
                toolName,
                input,
                timestamp: new Date().toISOString()
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                if (pendingApprovals.has(approvalId)) {
                    pendingApprovals.delete(approvalId);
                    reject(new Error('Approval timeout'));
                }
            }, 5 * 60 * 1000);
        });

        try {
            const decision = await approvalPromise;
            return decision; // { behavior: 'allow' } or { behavior: 'deny', message: '...' }
        } catch (err) {
            return { behavior: 'deny', message: err.message };
        }
    };
}

/**
 * List pending approvals
 */
app.get('/api/approvals', (req, res) => {
    const approvals = Array.from(pendingApprovals.entries()).map(([id, data]) => ({
        approvalId: id,
        taskId: data.taskId,
        toolName: data.toolName,
        timestamp: data.timestamp
    }));
    res.json({ success: true, approvals });
});

/**
 * Get specific approval details
 */
app.get('/api/approvals/:id', (req, res) => {
    const approval = pendingApprovals.get(req.params.id);
    if (!approval) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({
        success: true,
        approvalId: req.params.id,
        taskId: approval.taskId,
        toolName: approval.toolName,
        input: approval.input,
        timestamp: approval.timestamp
    });
});

/**
 * Approve an operation
 */
app.post('/api/approvals/:id/approve', (req, res) => {
    const approval = pendingApprovals.get(req.params.id);
    if (!approval) return res.status(404).json({ success: false, error: 'Not found' });

    pendingApprovals.delete(req.params.id);
    approval.resolve({ behavior: 'allow' });
    res.json({ success: true });
});

/**
 * Deny an operation
 */
app.post('/api/approvals/:id/deny', (req, res) => {
    const approval = pendingApprovals.get(req.params.id);
    if (!approval) return res.status(404).json({ success: false, error: 'Not found' });

    const { message } = req.body;
    pendingApprovals.delete(req.params.id);
    approval.resolve({
        behavior: 'deny',
        message: message || 'Denied by user'
    });
    res.json({ success: true });
});

// ── Task execution logging ────────────────────────────────

/**
 * Create a log file for a task execution, mirroring claude-logged format.
 * Logs SDK messages (assistant text, tool uses, results) to _logs/task_*.md
 */
function createTaskLogger(task) {
    const logDir = path.join(task.project_path, '_logs');
    try {
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch { /* best effort */ }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeTitle = task.title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 50);
    const logFile = path.join(logDir, `task_${timestamp}_${safeTitle}.md`);

    // Write session header (matches claude-logged format)
    const header = [
        `# Task: ${task.title}`,
        ``,
        `- **Task ID**: ${task.id}`,
        `- **Project**: ${path.basename(task.project_path)} (${task.project_path})`,
        `- **Machine**: ${require('os').hostname()}`,
        `- **Model**: ${task.model}`,
        `- **Max Turns**: ${task.max_turns}`,
        `- **Gate Mode**: ${task.gate_mode || 'bypass'}`,
        `- **Allowed Tools**: ${task.allowed_tools || 'all'}`,
        `- **Started**: ${new Date().toISOString()}`,
        ``,
        `---`,
        ``,
    ].join('\n');

    try {
        fs.writeFileSync(logFile, header);
    } catch { /* best effort */ }

    function ts() {
        return new Date().toISOString().replace('T', ' ').slice(0, 19);
    }

    return {
        file: logFile,
        log(sdkMessage) {
            try {
                let entry = '';
                const t = ts();

                if (sdkMessage.type === 'assistant') {
                    const textBlocks = (sdkMessage.message?.content || [])
                        .filter(b => b.type === 'text')
                        .map(b => b.text);
                    const toolUses = (sdkMessage.message?.content || [])
                        .filter(b => b.type === 'tool_use');

                    if (textBlocks.length > 0) {
                        entry += `## Assistant <sub>${t}</sub>\n\n${textBlocks.join('\n')}\n\n`;
                    }
                    for (const tool of toolUses) {
                        entry += `### Tool Use: ${tool.name} <sub>${t}</sub>\n\n`;
                        entry += '```json\n' + JSON.stringify(tool.input, null, 2).slice(0, 2000) + '\n```\n\n';
                    }
                } else if (sdkMessage.type === 'tool_use_summary') {
                    entry += `**Tool**: ${sdkMessage.tool_name} — ${sdkMessage.tool_input_summary || ''} <sub>${t}</sub>\n\n`;
                } else if (sdkMessage.type === 'tool_result') {
                    const text = typeof sdkMessage.content === 'string'
                        ? sdkMessage.content
                        : JSON.stringify(sdkMessage.content);
                    entry += `**Result** (${sdkMessage.is_error ? 'error' : 'ok'}): ${(text || '').slice(0, 1000)} <sub>${t}</sub>\n\n`;
                } else if (sdkMessage.type === 'result') {
                    entry += `---\n\n## Result: ${sdkMessage.subtype} <sub>${t}</sub>\n\n`;
                    entry += `- **Cost**: $${(sdkMessage.total_cost_usd || 0).toFixed(4)}\n`;
                    entry += `- **Turns**: ${sdkMessage.num_turns || 0}\n`;
                    entry += `- **Duration**: ${sdkMessage.duration_ms ? (sdkMessage.duration_ms / 1000).toFixed(1) + 's' : 'unknown'}\n`;
                    entry += `- **Completed**: ${new Date().toISOString()}\n\n`;
                    if (sdkMessage.result) {
                        entry += sdkMessage.result + '\n\n';
                    }
                } else if (sdkMessage.type === 'system') {
                    entry += `*[system: ${sdkMessage.subtype || sdkMessage.type}]* <sub>${t}</sub>\n\n`;
                }

                if (entry) {
                    fs.appendFileSync(logFile, entry);
                }
            } catch { /* best effort — never block task execution */ }
        },
        finish(status, error) {
            try {
                let footer = `---\n\n**Final Status**: ${status}\n`;
                if (error) footer += `**Error**: ${error}\n`;
                footer += `**Log Closed**: ${new Date().toISOString()}\n`;
                fs.appendFileSync(logFile, footer);
            } catch { /* best effort */ }
        }
    };
}

// ── Task orchestrator ─────────────────────────────────────

let runningTaskId = null;
let runningAbort = null;

/**
 * Broadcast task status update to all WS clients
 */
function broadcastTaskUpdate(task) {
    if (wss.clients.size === 0) return;
    const message = JSON.stringify({ type: 'task_update', task });
    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
    });
}

/**
 * Broadcast task progress (streaming SDK message) to all WS clients
 */
function broadcastTaskProgress(taskId, sdkMessage) {
    if (wss.clients.size === 0) return;

    // Extract the useful bits from the SDK message
    let progress = { taskId, messageType: sdkMessage.type };

    if (sdkMessage.type === 'assistant') {
        // Full assistant message — extract text content
        const textBlocks = (sdkMessage.message?.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text);
        progress.text = textBlocks.join('\n');
        progress.role = 'assistant';
    } else if (sdkMessage.type === 'tool_use_summary') {
        progress.tool = sdkMessage.tool_name;
        progress.input = sdkMessage.tool_input_summary;
    } else if (sdkMessage.type === 'result') {
        progress.subtype = sdkMessage.subtype;
        progress.result = sdkMessage.result;
        progress.cost_usd = sdkMessage.total_cost_usd;
        progress.duration_ms = sdkMessage.duration_ms;
        progress.num_turns = sdkMessage.num_turns;
    } else if (sdkMessage.type === 'system') {
        progress.subtype = sdkMessage.subtype;
    }

    const message = JSON.stringify({ type: 'task_progress', ...progress });
    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
    });
}

/**
 * Run the next pending task from the queue
 */
async function runNextTask() {
    if (runningTaskId) return; // Already running a task

    const task = taskStmts.nextPending.get();
    if (!task) return;

    runningTaskId = task.id;
    const abort = new AbortController();
    runningAbort = abort;

    // Mark as running
    taskStmts.updateStatus.run('running', new Date().toISOString(), task.id);
    broadcastTaskUpdate(taskStmts.get.get(task.id));

    console.log(`[Task] Starting: ${task.title} (${task.id})`);

    // Create task execution log (mirrors claude-logged format)
    const taskLog = createTaskLogger(task);
    taskStmts.updateLogFile.run(taskLog.file, task.id);
    console.log(`[Task] Logging to: ${taskLog.file}`);

    // Create git checkpoint if project is a git repo
    let checkpointRef = null;
    let checkpointType = 'none';

    if (isGitRepo(task.project_path)) {
        const result = createCheckpoint(task.project_path, task.id);
        checkpointRef = result.ref;
        checkpointType = result.type;
        if (checkpointRef) {
            taskStmts.updateCheckpoint.run(checkpointRef, checkpointType, new Date().toISOString(), task.id);
        }
    }

    try {
        // Build clean env without CLAUDECODE (prevents nested session detection)
        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        // Prepend instructions to avoid plan mode stalling (no human to approve)
        const taskPrompt = 'IMPORTANT: Do not use plan mode (EnterPlanMode). Implement directly — you are running autonomously with no human in the loop. Just do the work.\n\n' + task.description;

        // Build agentQuery options
        const permissionMode = task.gate_mode === 'bypass' ? 'bypassPermissions' : 'default';
        const allowDangerous = task.gate_mode === 'bypass';

        const options = {
            model: task.model,
            maxTurns: task.max_turns,
            cwd: task.project_path,
            permissionMode: permissionMode,
            allowDangerouslySkipPermissions: allowDangerous,
            abortController: abort,
            env: cleanEnv,
            canUseTool: await createCanUseToolCallback(task.id, task.gate_mode || 'bypass')
        };

        // Add allowedTools if specified
        if (task.allowed_tools) {
            try {
                const toolsList = JSON.parse(task.allowed_tools);
                if (Array.isArray(toolsList) && toolsList.length > 0) {
                    options.allowedTools = toolsList;
                }
            } catch (err) {
                console.error(`[Task] Invalid allowed_tools JSON: ${task.allowed_tools}`);
            }
        }

        const q = agentQuery({
            prompt: taskPrompt,
            options
        });

        let totalCost = 0;
        let totalTokensIn = 0;
        let totalTokensOut = 0;
        let numTurns = 0;
        let resultText = '';

        for await (const message of q) {
            // Check if cancelled
            if (abort.signal.aborted) break;

            broadcastTaskProgress(task.id, message);
            taskLog.log(message);

            if (message.type === 'result') {
                const isSuccess = message.subtype === 'success';
                totalCost = message.total_cost_usd || 0;
                numTurns = message.num_turns || 0;
                resultText = message.result || '';

                // Try to extract token counts from usage
                if (message.usage) {
                    totalTokensIn = message.usage.input_tokens || 0;
                    totalTokensOut = message.usage.output_tokens || 0;
                }

                taskStmts.complete.run(
                    isSuccess ? 'done' : 'failed',
                    new Date().toISOString(),
                    resultText,
                    totalCost,
                    totalTokensIn,
                    totalTokensOut,
                    numTurns,
                    task.id
                );

                console.log(`[Task] ${isSuccess ? 'Completed' : 'Failed'}: ${task.title} ($${totalCost.toFixed(4)}, ${numTurns} turns)`);
                taskLog.finish(isSuccess ? 'done' : 'failed');

                // Clean up checkpoint on success
                if (isSuccess && checkpointRef && checkpointType !== 'none') {
                    cleanupCheckpoint(task.project_path, checkpointRef, checkpointType);
                }
            }
        }

        // If aborted (cancelled), the loop exits without a result message
        if (abort.signal.aborted) {
            const current = taskStmts.get.get(task.id);
            if (current && current.status === 'running') {
                taskStmts.cancel.run('cancelled', new Date().toISOString(), task.id);
                console.log(`[Task] Cancelled: ${task.title}`);
                taskLog.finish('cancelled');
            }
            // Rollback on cancellation
            if (checkpointRef && checkpointType !== 'none') {
                rollbackCheckpoint(task.project_path, checkpointRef, checkpointType);
            }
        }
    } catch (err) {
        const errDetail = err.stack || err.message || String(err);
        console.error(`[Task] Error: ${task.title}:`, errDetail);
        const current = taskStmts.get.get(task.id);
        if (current && (current.status === 'running' || current.status === 'pending')) {
            taskStmts.fail.run('failed', new Date().toISOString(), err.message, task.id);
        }
        taskLog.finish('failed', err.message);
        // Rollback on error
        if (checkpointRef && checkpointType !== 'none') {
            try {
                rollbackCheckpoint(task.project_path, checkpointRef, checkpointType);
                console.log(`[Task] Rolled back to checkpoint: ${checkpointRef}`);
            } catch (rollbackErr) {
                console.error(`[Task] Rollback failed:`, rollbackErr.message);
            }
        }
    } finally {
        runningTaskId = null;
        runningAbort = null;
        broadcastTaskUpdate(taskStmts.get.get(task.id));
    }
}

// Check for pending tasks every 5 seconds
const orchestratorInterval = setInterval(runNextTask, 5000);

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

    // Send current prompts immediately
    const prompts = readPendingPrompts();
    ws.send(JSON.stringify({
        type: 'prompts',
        prompts,
        count: prompts.length
    }));

    // Send current terminal state immediately
    const session = getActiveSession();
    if (session) {
        const result = captureTerminal(session);
        if (result) {
            ws.send(JSON.stringify({
                type: 'terminal',
                content: result.content,
                session: result.session
            }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'terminal', content: null, session: null }));
    }

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
    clearInterval(terminalBroadcastInterval);
    clearInterval(orchestratorInterval);
});

// Terminal broadcast — 1-second capture loop
const terminalBroadcastInterval = setInterval(broadcastTerminal, 1000);

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
    const proto = useHttps ? 'https' : 'http';
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    Claude Remote Server                    ║
╠═══════════════════════════════════════════════════════════╣
║  Mode:     ${useHttps ? 'HTTPS (Tailscale TLS)' : 'HTTP (no TLS certs found)'}${useHttps ? '              ' : '         '}║
║  Local:    ${proto}://localhost:${PORT}                        ║
║  Network:  ${proto}://<your-ip>:${PORT}                        ║
╠═══════════════════════════════════════════════════════════╣
║  API Endpoints:                                            ║
║    GET  /api/prompts    - List pending prompts             ║
║    POST /api/respond    - Send response to Claude          ║
║    GET  /api/history    - Notification history             ║
║    POST /api/keys      - Send keystrokes to session        ║
║    GET  /api/status     - Server status                    ║
║    GET  /quick          - Quick response (ntfy actions)    ║
║    GET  /api/bridge/*   - Context bridge (export/import)   ║
║    GET  /api/tasks      - Task queue (Level 7)             ║
║    POST /api/tasks      - Create autonomous task           ║
║    WS   /ws             - WebSocket push                   ║
╚═══════════════════════════════════════════════════════════╝
`);
});

process.on('SIGTERM', () => {
    cleanPid();
    clearInterval(heartbeatInterval);
    clearInterval(terminalBroadcastInterval);
    clearInterval(orchestratorInterval);
    if (runningAbort) runningAbort.abort();
    try { db.close(); } catch {}
    wss.close();
    server.close();
    process.exit(0);
});
