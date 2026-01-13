/**
 * Claude Remote - API Server
 * Serves the mobile web UI and handles prompt responses
 */

const express = require('express');
const { execFileSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
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
        res.sendFile(UI_PATH);
    } else {
        res.status(404).send('UI not found. Ensure src/ui/index.html exists.');
    }
});

/**
 * Get all pending prompts
 */
app.get('/api/prompts', (req, res) => {
    try {
        const prompts = [];

        if (fs.existsSync(PENDING_DIR)) {
            const files = fs.readdirSync(PENDING_DIR)
                .filter(f => f.endsWith('.json'))
                .sort((a, b) => b.localeCompare(a)); // Newest first

            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(PENDING_DIR, file), 'utf8');
                    const prompt = JSON.parse(content);
                    prompts.push(prompt);
                } catch (err) {
                    console.error(`Error reading prompt file ${file}:`, err.message);
                }
            }
        }

        res.json({
            success: true,
            prompts,
            count: prompts.length
        });
    } catch (err) {
        console.error('Error fetching prompts:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
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
        // tmux send-keys sends the literal string, then Enter as a separate key
        execFile('tmux', ['send-keys', '-t', tmuxSession, response, 'Enter'], (err) => {
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
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
║    GET  /api/status     - Server status                    ║
╚═══════════════════════════════════════════════════════════╝
`);
});
