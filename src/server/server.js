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
const os = require('os');
const Database = require('better-sqlite3');
const { query: agentQuery } = require('@anthropic-ai/claude-agent-sdk');
const orchestrator = require('./orchestrator');

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

// Level 8 migrations: orchestrator columns
if (!columns.includes('goal_id')) {
    console.log('[DB] Adding Level 8 orchestrator columns...');
    db.exec(`ALTER TABLE tasks ADD COLUMN goal_id TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN complexity TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE tasks ADD COLUMN max_retries INTEGER DEFAULT 3`);
    db.exec(`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN depends_on TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN auto_model INTEGER DEFAULT 0`);
    console.log('[DB] Level 8 task columns added');
}

// Create goals table
db.exec(`CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    project_path TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    decomposition TEXT,
    task_count INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    orchestrator_backend TEXT,
    orchestrator_model TEXT
)`);

// Create projects table (Level 9 — portfolio manager)
db.exec(`CREATE TABLE IF NOT EXISTS projects (
    name TEXT PRIMARY KEY,
    description TEXT,
    path TEXT NOT NULL,
    lifecycle TEXT DEFAULT 'active',
    priority INTEGER DEFAULT 5,
    last_synced_at TEXT
)`);

// Phase 2: Budget columns on projects
const projCols = db.pragma("table_info('projects')").map(col => col.name);
if (!projCols.includes('cost_budget_daily')) {
    db.exec(`ALTER TABLE projects ADD COLUMN cost_budget_daily REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN cost_budget_total REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN cost_spent_today REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN cost_spent_total REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN budget_reset_date TEXT`);
    db.exec(`ALTER TABLE projects ADD COLUMN throttled INTEGER DEFAULT 0`);
}

// Phase 2: Deadline column on tasks
const taskCols = db.pragma("table_info('tasks')").map(col => col.name);
if (!taskCols.includes('deadline')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN deadline TEXT`);
}

// Level 10B: Protocol compliance columns
const taskCols10b = db.pragma("table_info('tasks')").map(col => col.name);
if (!taskCols10b.includes('commit_sha')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN commit_sha TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN files_changed TEXT`);
}
const goalCols = db.pragma("table_info('goals')").map(col => col.name);
if (!goalCols.includes('summary_file')) {
    db.exec(`ALTER TABLE goals ADD COLUMN summary_file TEXT`);
}
if (!goalCols.includes('parent_goal_id')) {
    db.exec('ALTER TABLE goals ADD COLUMN parent_goal_id TEXT');
    db.exec("ALTER TABLE goals ADD COLUMN goal_type TEXT DEFAULT 'standalone'");
}

// Level 10C: Knowledge proposals table
db.exec(`CREATE TABLE IF NOT EXISTS task_proposals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    title TEXT NOT NULL,
    raw_block TEXT NOT NULL,
    parsed_data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT,
    written_to TEXT
)`);

// Level 10D: ports column on projects
const projCols10d = db.pragma("table_info('projects')").map(col => col.name);
if (!projCols10d.includes('ports')) {
    db.exec(`ALTER TABLE projects ADD COLUMN ports TEXT`);
}

// Create project_memory table
db.exec(`CREATE TABLE IF NOT EXISTS project_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path TEXT NOT NULL,
    task_type TEXT,
    model_used TEXT,
    success INTEGER,
    cost_usd REAL,
    turns INTEGER,
    duration_seconds REAL,
    error_summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS digests (
    id TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    digest_text TEXT NOT NULL,
    digest_json TEXT NOT NULL,
    task_count INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    viewed_at TEXT
)`);

// Level 9 Phase 4: maintenance_enabled column on projects
const projCols9p4 = db.pragma("table_info('projects')").map(col => col.name);
if (!projCols9p4.includes('maintenance_enabled')) {
    db.exec(`ALTER TABLE projects ADD COLUMN maintenance_enabled INTEGER DEFAULT 1`);
}

db.exec(`CREATE TABLE IF NOT EXISTS maintenance_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT DEFAULT 'running',
    projects_count INTEGER DEFAULT 0,
    goals_created TEXT,
    summary TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS weekly_reports (
    id TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    report_text TEXT NOT NULL,
    report_json TEXT NOT NULL,
    task_count INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    viewed_at TEXT
)`);

// Level 11: Product pipeline tables
db.exec(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed TEXT NOT NULL,
    project_path TEXT,
    current_phase TEXT DEFAULT 'research',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    total_cost_usd REAL DEFAULT 0,
    phases_completed INTEGER DEFAULT 0,
    config TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS product_phases (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    goal_id TEXT,
    started_at TEXT,
    completed_at TEXT,
    cost_usd REAL DEFAULT 0,
    artifacts TEXT,
    gate_status TEXT DEFAULT 'none',
    gate_approved_at TEXT,
    notes TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS product_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_phase TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)`);

// ── Registry sync (Level 9) ─────────────────────────────
const REGISTRY_PATH = path.join(process.env.HOME, 'Projects', 'infrastructure', 'registry', 'services.toml');

function parseRegistryToml(content) {
    const projects = [];
    let current = null;
    let subSection = null;
    for (const raw of content.split('\n')) {
        const line = raw.trim();
        // Top-level section: [name] (not [name.subsection])
        const sectionMatch = line.match(/^\[([a-zA-Z0-9_-]+)\]$/);
        if (sectionMatch) {
            const name = sectionMatch[1];
            if (name === 'meta') { current = null; subSection = null; continue; }
            current = { name, description: '', path: '', lifecycle: 'active', ports: {} };
            subSection = null;
            projects.push(current);
            continue;
        }
        // Sub-section like [name.supabase] — track for port extraction
        const subMatch = line.match(/^\[([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\]$/);
        if (subMatch) {
            const parentName = subMatch[1];
            current = projects.find(p => p.name === parentName) || null;
            subSection = subMatch[2];
            continue;
        }
        if (!current) continue;
        // String value
        const strMatch = line.match(/^(\w+)\s*=\s*"(.*)"/);
        if (strMatch) {
            const [, key, value] = strMatch;
            if (!subSection) {
                if (key === 'description') current.description = value;
                else if (key === 'path') current.path = value.replace(/^~/, process.env.HOME);
                else if (key === 'lifecycle') current.lifecycle = value;
            }
            continue;
        }
        // Numeric value — extract ports from sub-sections
        const numMatch = line.match(/^(\w+)\s*=\s*(\d+)/);
        if (numMatch && subSection) {
            const [, key, value] = numMatch;
            if (key.includes('port')) {
                current.ports[`${subSection}.${key}`] = parseInt(value, 10);
            }
        }
    }
    return projects.filter(p => p.path);
}

function syncRegistry() {
    try {
        if (!fs.existsSync(REGISTRY_PATH)) {
            console.log('[Portfolio] Registry not found at', REGISTRY_PATH);
            return 0;
        }
        const content = fs.readFileSync(REGISTRY_PATH, 'utf8');
        const projects = parseRegistryToml(content);
        const now = new Date().toISOString();
        for (const p of projects) {
            const portsJson = Object.keys(p.ports).length > 0 ? JSON.stringify(p.ports) : null;
            portfolioStmts.upsert.run(p.name, p.description, p.path, p.lifecycle, portsJson, now);
        }
        console.log(`[Portfolio] Synced ${projects.length} projects from registry`);
        return projects.length;
    } catch (err) {
        console.error('[Portfolio] Sync failed:', err.message);
        return 0;
    }
}

// ── Portfolio aggregate queries ─────────────────────────
function getProjectStats(projectPath) {
    const taskRow = db.prepare(`
        SELECT
            COUNT(*) as tasks_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as tasks_completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as tasks_failed,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as tasks_running,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as tasks_pending,
            COALESCE(SUM(cost_usd), 0) as total_cost_usd
        FROM tasks WHERE project_path = ?
    `).get(projectPath);

    const goalRow = db.prepare(`
        SELECT
            COUNT(*) as goals_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as goals_completed
        FROM goals WHERE project_path = ?
    `).get(projectPath);

    return {
        tasks_total: taskRow.tasks_total,
        tasks_completed: taskRow.tasks_completed,
        tasks_failed: taskRow.tasks_failed,
        tasks_running: taskRow.tasks_running,
        tasks_pending: taskRow.tasks_pending,
        total_cost_usd: taskRow.total_cost_usd,
        goals_total: goalRow.goals_total,
        goals_completed: goalRow.goals_completed,
    };
}

function getAllProjectStats() {
    const taskRows = db.prepare(`
        SELECT project_path,
            COUNT(*) as tasks_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as tasks_completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as tasks_failed,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as tasks_running,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as tasks_pending,
            COALESCE(SUM(cost_usd), 0) as total_cost_usd
        FROM tasks GROUP BY project_path
    `).all();

    const goalRows = db.prepare(`
        SELECT project_path,
            COUNT(*) as goals_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as goals_completed
        FROM goals GROUP BY project_path
    `).all();

    const stats = {};
    for (const r of taskRows) {
        stats[r.project_path] = {
            tasks_total: r.tasks_total, tasks_completed: r.tasks_completed,
            tasks_failed: r.tasks_failed, tasks_running: r.tasks_running,
            tasks_pending: r.tasks_pending, total_cost_usd: r.total_cost_usd,
            goals_total: 0, goals_completed: 0,
        };
    }
    for (const r of goalRows) {
        if (!stats[r.project_path]) {
            stats[r.project_path] = {
                tasks_total: 0, tasks_completed: 0, tasks_failed: 0,
                tasks_running: 0, tasks_pending: 0, total_cost_usd: 0,
                goals_total: 0, goals_completed: 0,
            };
        }
        stats[r.project_path].goals_total = r.goals_total;
        stats[r.project_path].goals_completed = r.goals_completed;
    }
    return stats;
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
 * Commit task changes after successful completion.
 * Ensures each task's work persists in git history so sequential
 * tasks in a goal can build on each other's changes.
 */
function commitTaskChanges(projectPath, task) {
    try {
        if (!hasUncommittedChanges(projectPath)) {
            console.log(`[Git] No changes to commit for task ${task.id}`);
            return { committed: false, sha: null, filesChanged: [] };
        }

        // Stage all changes
        execFileSync('git', ['add', '-A'], {
            cwd: projectPath,
            stdio: 'ignore'
        });

        // Detect semantic commit prefix from task title
        const titleLower = task.title.toLowerCase();
        let prefix = 'chore';
        if (/\b(add|create|implement|build|new)\b/.test(titleLower)) prefix = 'feat';
        else if (/\b(fix|repair|resolve|correct|bug)\b/.test(titleLower)) prefix = 'fix';
        else if (/\b(update|improve|enhance|optimise|optimize|refactor)\b/.test(titleLower)) prefix = 'refactor';
        else if (/\b(doc|comment|readme)\b/.test(titleLower)) prefix = 'docs';
        else if (/\b(test|spec)\b/.test(titleLower)) prefix = 'test';

        const message = `${prefix}: ${task.title}\n\nTask: ${task.id}\nModel: ${task.model}\nCost: $${(task.cost_usd || 0).toFixed(4)}${task.goal_id ? `\nGoal: ${task.goal_id}` : ''}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
        execFileSync('git', ['commit', '-m', message], {
            cwd: projectPath,
            stdio: 'ignore'
        });

        // Capture commit SHA
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: projectPath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();

        // Capture files changed in this commit
        let filesChanged = [];
        try {
            const diffOutput = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
                cwd: projectPath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            });
            filesChanged = diffOutput.trim().split('\n').filter(Boolean);
        } catch {
            try {
                const lsOutput = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
                    cwd: projectPath,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore']
                });
                filesChanged = lsOutput.trim().split('\n').filter(Boolean);
            } catch { /* best effort */ }
        }

        console.log(`[Git] Committed changes for task: ${task.title} (${task.id}) [${sha.slice(0, 7)}]`);
        return { committed: true, sha, filesChanged };
    } catch (err) {
        console.error(`[Git] Commit failed for task ${task.id}:`, err.message);
        return { committed: false, sha: null, filesChanged: [] };
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

// ── Phase 2: Cost budget + priority engine ───────────────

/**
 * Recalculate project costs from task data and set throttle flag.
 */
function recalcProjectCosts(projectPath) {
    const project = portfolioStmts.getByPath.get(projectPath);
    if (!project) return;
    const today = new Date().toISOString().slice(0, 10);
    const dailyRow = db.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as total FROM tasks WHERE project_path = ? AND status = 'done' AND date(completed_at) = ?`
    ).get(projectPath, today);
    const totalRow = db.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as total FROM tasks WHERE project_path = ?`
    ).get(projectPath);
    const dailySpend = dailyRow.total;
    const totalSpend = totalRow.total;
    const overDaily = project.cost_budget_daily > 0 && dailySpend >= project.cost_budget_daily;
    const overTotal = project.cost_budget_total > 0 && totalSpend >= project.cost_budget_total;
    const throttled = (overDaily || overTotal) ? 1 : 0;
    portfolioStmts.updateCosts.run(dailySpend, totalSpend, today, throttled, project.name);
    if (throttled) console.log(`[Portfolio] Project throttled: ${project.name}`);
}

/**
 * Calculate priority score for task scheduling.
 * Considers task priority, project priority, deadline proximity, and budget headroom.
 */
function calculatePriorityScore(task, project) {
    let score = (task.priority || 0) * 10;
    score += ((project?.priority || 5)) * 5;
    if (task.deadline) {
        const deadline = new Date(task.deadline);
        const daysUntil = Math.ceil((deadline - Date.now()) / 86400000);
        if (daysUntil <= 0) score += 50;
        else if (daysUntil <= 3) score += 25;
        else if (daysUntil <= 7) score += 10;
    }
    if (!project || project.cost_budget_daily === 0) {
        score += 5;
    } else if (project.cost_spent_today / project.cost_budget_daily <= 0.8) {
        score += 5;
    }
    return score;
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
            // If enter flag set, also send Enter after the literal text
            if (req.body.enter && !SPECIAL_KEYS.has(key)) {
                execFile('tmux', ['send-keys', '-t', session, 'Enter'], (err2) => {
                    if (err2) {
                        console.error('Error sending Enter:', err2);
                        return res.status(500).json({ success: false, error: 'Failed to send Enter' });
                    }
                    res.json({ success: true });
                });
                return;
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

// ── Goal orchestration endpoints ──────────────────────────

/**
 * POST /api/goals — Submit a high-level goal for decomposition
 */
app.post('/api/goals', async (req, res) => {
    try {
        const { description, project_path, auto_execute = true } = req.body;

        if (!description || !project_path) {
            return res.status(400).json({ success: false, error: 'Missing description or project_path' });
        }

        if (!fs.existsSync(project_path)) {
            return res.status(400).json({ success: false, error: 'Project path does not exist' });
        }

        const goalId = createGoal(description, project_path, auto_execute);

        res.json({
            success: true,
            goal: goalStmts.get.get(goalId),
            message: 'Goal created, decomposition in progress'
        });
    } catch (err) {
        console.error('[Goals] Error creating goal:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/goals — List all goals
 */
app.get('/api/goals', (req, res) => {
    try {
        const goals = goalStmts.list.all();
        res.json({ success: true, goals });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/goals/:id — Get goal detail with tasks
 */
app.get('/api/goals/:id', (req, res) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        const tasks = taskStmts.getByGoal.all(goal.id);
        res.json({ success: true, goal, tasks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/goals/:id/retry — Retry a failed goal
 */
app.post('/api/goals/:id/retry', async (req, res) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        if (goal.status !== 'failed') {
            return res.status(400).json({ success: false, error: 'Goal is not in failed state' });
        }

        const tasks = taskStmts.getByGoal.all(goal.id);
        const failedTasks = tasks.filter(t => t.status === 'failed');

        // Reset failed tasks to pending
        for (const task of failedTasks) {
            taskStmts.updateStatus.run('pending', null, task.id);
            broadcastTaskUpdate(taskStmts.get.get(task.id));
        }

        // Update goal status
        goalStmts.updateStatus.run('active', goal.id);
        broadcastGoalUpdate(goal.id);

        res.json({
            success: true,
            message: `Retrying ${failedTasks.length} failed tasks`,
            retriedTasks: failedTasks.length
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/goals/:id — Delete a goal and its tasks
 */
app.delete('/api/goals/:id', (req, res) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        if (goal.status === 'decomposing' || goal.status === 'active') {
            return res.status(400).json({ success: false, error: 'Cannot delete active goal' });
        }

        // Delete associated tasks
        const tasks = taskStmts.getByGoal.all(goal.id);
        for (const task of tasks) {
            if (task.status === 'running') {
                return res.status(400).json({ success: false, error: 'Cannot delete goal with running tasks' });
            }
            taskStmts.del.run(task.id);
        }

        goalStmts.del.run(goal.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/goals/:id/summary — Get goal completion summary
 */
app.get('/api/goals/:id/summary', (req, res) => {
    try {
        const goal = goalStmts.get.get(req.params.id);
        if (!goal) {
            return res.status(404).json({ success: false, error: 'Goal not found' });
        }

        if (!goal.summary_file) {
            if (!['done', 'failed'].includes(goal.status)) {
                return res.status(400).json({ success: false, error: 'Goal has not completed yet' });
            }
            // Backfill: generate summary for completed goals that predate this feature
            const summaryFile = generateGoalSummary(goal.id);
            if (!summaryFile) {
                return res.status(404).json({ success: false, error: 'Summary could not be generated' });
            }
        }

        const updatedGoal = goalStmts.get.get(req.params.id);
        if (!fs.existsSync(updatedGoal.summary_file)) {
            return res.status(404).json({ success: false, error: 'Summary file not found on disk' });
        }

        const content = fs.readFileSync(updatedGoal.summary_file, 'utf8');
        res.json({ success: true, summary_file: updatedGoal.summary_file, content });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Knowledge proposals endpoints (Level 10C) ────────────

/**
 * GET /api/proposals — List knowledge proposals
 */
app.get('/api/proposals', (req, res) => {
    try {
        const proposals = req.query.status
            ? proposalStmts.listByStatus.all(req.query.status)
            : proposalStmts.list.all();
        const enriched = proposals.map(p => ({
            ...p,
            parsed_data: JSON.parse(p.parsed_data)
        }));
        res.json({ success: true, proposals: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/proposals/:id/approve — Approve and write to official files
 */
app.post('/api/proposals/:id/approve', (req, res) => {
    try {
        const proposal = proposalStmts.get.get(req.params.id);
        if (!proposal) return res.status(404).json({ success: false, error: 'Proposal not found' });
        if (proposal.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Proposal already ${proposal.status}` });
        }

        const data = JSON.parse(proposal.parsed_data);
        let writtenTo = '';

        if (proposal.type === 'learning') {
            writtenTo = writeLearning(data, proposal.project_path);
        } else if (proposal.type === 'decision') {
            writtenTo = writeDecision(data, proposal.project_path);
        }

        proposalStmts.updateStatus.run('approved', new Date().toISOString(), writtenTo, proposal.id);
        res.json({ success: true, written_to: writtenTo });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/proposals/:id/reject — Reject a proposal
 */
app.post('/api/proposals/:id/reject', (req, res) => {
    try {
        const proposal = proposalStmts.get.get(req.params.id);
        if (!proposal) return res.status(404).json({ success: false, error: 'Proposal not found' });
        if (proposal.status !== 'pending') {
            return res.status(400).json({ success: false, error: `Proposal already ${proposal.status}` });
        }

        proposalStmts.updateStatus.run('rejected', new Date().toISOString(), null, proposal.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Portfolio endpoints (Level 9) ────────────────────────

/**
 * GET /api/portfolio — List all projects with stats
 */
app.get('/api/portfolio', (req, res) => {
    try {
        const projects = portfolioStmts.list.all();
        const allStats = getAllProjectStats();
        const enriched = projects.map(p => ({
            ...p,
            stats: allStats[p.path] || {
                tasks_total: 0, tasks_completed: 0, tasks_failed: 0,
                tasks_running: 0, tasks_pending: 0, total_cost_usd: 0,
                goals_total: 0, goals_completed: 0,
            }
        }));
        res.json({ success: true, projects: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/portfolio/:name — Update project priority
 */
app.put('/api/portfolio/:name', (req, res) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        const priority = parseInt(req.body.priority, 10);
        if (isNaN(priority) || priority < 0 || priority > 10) {
            return res.status(400).json({ success: false, error: 'Priority must be 0-10' });
        }
        portfolioStmts.updatePriority.run(priority, req.params.name);
        res.json({ success: true, project: portfolioStmts.get.get(req.params.name) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/portfolio/sync — Re-sync from infrastructure registry
 */
app.post('/api/portfolio/sync', (req, res) => {
    try {
        const count = syncRegistry();
        res.json({ success: true, synced: count });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/portfolio/:name/budget — Set project cost budgets
 */
app.put('/api/portfolio/:name/budget', (req, res) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        const daily = parseFloat(req.body.cost_budget_daily) || 0;
        const total = parseFloat(req.body.cost_budget_total) || 0;
        if (daily < 0 || total < 0) return res.status(400).json({ success: false, error: 'Budgets must be >= 0' });
        portfolioStmts.updateBudget.run(daily, total, req.params.name);
        res.json({ success: true, project: portfolioStmts.get.get(req.params.name) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/portfolio/:name/budget — Get project budget status
 */
app.get('/api/portfolio/:name/budget', (req, res) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        res.json({
            success: true,
            daily_budget: project.cost_budget_daily,
            total_budget: project.cost_budget_total,
            spent_today: project.cost_spent_today,
            spent_total: project.cost_spent_total,
            throttled: !!project.throttled,
            budget_pct_daily: project.cost_budget_daily > 0 ? (project.cost_spent_today / project.cost_budget_daily * 100).toFixed(1) : 0,
            budget_pct_total: project.cost_budget_total > 0 ? (project.cost_spent_total / project.cost_budget_total * 100).toFixed(1) : 0,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/portfolio/:name/unthrottle — Manual budget override
 */
app.post('/api/portfolio/:name/unthrottle', (req, res) => {
    try {
        const project = portfolioStmts.get.get(req.params.name);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        portfolioStmts.unthrottle.run(req.params.name);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ecosystem — Full ecosystem state with ports, stats, and budget data
 */
app.get('/api/ecosystem', (req, res) => {
    try {
        const projects = portfolioStmts.list.all();
        const allStats = getAllProjectStats();
        const ecosystem = projects.map(p => {
            let ports = {};
            if (p.ports) {
                try { ports = typeof p.ports === 'string' ? JSON.parse(p.ports) : p.ports; } catch {}
            }
            const stats = allStats[p.path] || {
                tasks_total: 0, tasks_completed: 0, tasks_failed: 0,
                tasks_running: 0, tasks_pending: 0, total_cost_usd: 0,
                goals_total: 0, goals_completed: 0,
            };
            return {
                name: p.name,
                description: p.description,
                path: p.path,
                lifecycle: p.lifecycle,
                priority: p.priority,
                ports,
                tasks: {
                    total: stats.tasks_total,
                    completed: stats.tasks_completed,
                    failed: stats.tasks_failed,
                    running: stats.tasks_running,
                    pending: stats.tasks_pending,
                },
                goals: {
                    total: stats.goals_total,
                    completed: stats.goals_completed,
                },
                budget: {
                    daily_limit: p.cost_budget_daily,
                    total_limit: p.cost_budget_total,
                    spent_today: p.cost_spent_today,
                    spent_total: p.cost_spent_total,
                    throttled: !!p.throttled,
                },
            };
        });
        const summaryText = getEcosystemSummary();
        res.json({ success: true, projects: ecosystem, summary: summaryText });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/orchestrator/status — Get orchestrator backend info
 */
app.get('/api/orchestrator/status', (req, res) => {
    try {
        const status = orchestrator.getStatus();
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/orchestrator/memory/:project — Get project memory (outcome history)
 */
app.get('/api/orchestrator/memory/:project', (req, res) => {
    try {
        const projectPath = decodeURIComponent(req.params.project);
        const records = memoryStmts.getByProject.all(projectPath);

        // Calculate success rates by model
        const byModel = {};
        for (const record of records) {
            if (!byModel[record.model_used]) {
                byModel[record.model_used] = { total: 0, successes: 0, failures: 0, totalCost: 0 };
            }
            byModel[record.model_used].total++;
            if (record.success) {
                byModel[record.model_used].successes++;
            } else {
                byModel[record.model_used].failures++;
            }
            byModel[record.model_used].totalCost += record.cost_usd || 0;
        }

        // Calculate failure rates
        for (const model in byModel) {
            const stats = byModel[model];
            stats.failureRate = stats.total > 0 ? stats.failures / stats.total : 0;
            stats.successRate = stats.total > 0 ? stats.successes / stats.total : 0;
        }

        res.json({
            success: true,
            projectPath,
            recordCount: records.length,
            byModel,
            recentRecords: records.slice(0, 20)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/analytics — Aggregated performance analytics from project memory
 */
app.get('/api/analytics', (req, res) => {
    try {
        const records = memoryStmts.getAll.all();

        // Global stats
        const totalTasks = records.length;
        const successes = records.filter(r => r.success).length;
        const totalCost = records.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
        const global = {
            totalTasks,
            successRate: totalTasks > 0 ? successes / totalTasks : 0,
            totalCost,
            avgCostPerTask: totalTasks > 0 ? totalCost / totalTasks : 0,
        };

        // Per-model stats
        const byModel = {};
        for (const r of records) {
            const m = r.model_used || 'unknown';
            if (!byModel[m]) byModel[m] = { count: 0, successes: 0, totalCost: 0, totalTurns: 0, totalDuration: 0, withTurns: 0, withDuration: 0 };
            byModel[m].count++;
            if (r.success) byModel[m].successes++;
            byModel[m].totalCost += r.cost_usd || 0;
            if (r.turns) { byModel[m].totalTurns += r.turns; byModel[m].withTurns++; }
            if (r.duration_seconds) { byModel[m].totalDuration += r.duration_seconds; byModel[m].withDuration++; }
        }
        const byModelOut = {};
        for (const [model, s] of Object.entries(byModel)) {
            byModelOut[model] = {
                count: s.count,
                successRate: s.count > 0 ? s.successes / s.count : 0,
                avgCost: s.count > 0 ? s.totalCost / s.count : 0,
                avgTurns: s.withTurns > 0 ? s.totalTurns / s.withTurns : 0,
                avgDuration: s.withDuration > 0 ? s.totalDuration / s.withDuration : 0,
            };
        }

        // Per-project stats
        const byProject = {};
        for (const r of records) {
            const p = r.project_path;
            if (!byProject[p]) byProject[p] = { count: 0, successes: 0, totalCost: 0 };
            byProject[p].count++;
            if (r.success) byProject[p].successes++;
            byProject[p].totalCost += r.cost_usd || 0;
        }
        for (const p of Object.keys(byProject)) {
            byProject[p].successRate = byProject[p].count > 0 ? byProject[p].successes / byProject[p].count : 0;
            delete byProject[p].successes;
        }

        // Velocity: tasks per day (last 7 days)
        const now = new Date();
        const dailyCounts = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const count = records.filter(r => r.created_at && r.created_at.startsWith(dateStr)).length;
            dailyCounts.push({ date: dateStr, count });
        }
        const last3 = dailyCounts.slice(0, 3).reduce((s, d) => s + d.count, 0) / 3;
        const prev4 = dailyCounts.slice(3, 7).reduce((s, d) => s + d.count, 0) / 4;
        const trend = last3 > prev4 * 1.2 ? 'up' : last3 < prev4 * 0.8 ? 'down' : 'stable';

        // Cost optimisation suggestions
        const suggestions = [];
        const costRank = { haiku: 1, sonnet: 2, opus: 3 };
        // Group by (project, task_type, model)
        const groups = {};
        for (const r of records) {
            const key = `${r.project_path}|||${r.task_type || 'unknown'}`;
            if (!groups[key]) groups[key] = {};
            const m = r.model_used || 'unknown';
            if (!groups[key][m]) groups[key][m] = { count: 0, successes: 0, totalCost: 0 };
            groups[key][m].count++;
            if (r.success) groups[key][m].successes++;
            groups[key][m].totalCost += r.cost_usd || 0;
        }
        for (const [key, models] of Object.entries(groups)) {
            const [projectPath, taskType] = key.split('|||');
            // Check for downgrade opportunities: opus→sonnet, sonnet→haiku
            const downgrades = [['opus', 'sonnet'], ['sonnet', 'haiku']];
            for (const [expensive, cheap] of downgrades) {
                const expStats = models[expensive];
                const cheapStats = models[cheap];
                if (!expStats || expStats.count < 5) continue;
                if (!cheapStats || cheapStats.count < 5) continue;
                const cheapRate = cheapStats.successes / cheapStats.count;
                if (cheapRate < 0.7) continue;
                const expAvg = expStats.totalCost / expStats.count;
                const cheapAvg = cheapStats.totalCost / cheapStats.count;
                if (cheapAvg >= expAvg) continue;
                suggestions.push({
                    type: 'model_downgrade',
                    project: projectPath,
                    taskType,
                    currentModel: expensive,
                    suggestedModel: cheap,
                    currentAvgCost: expAvg,
                    suggestedAvgCost: cheapAvg,
                    savingsPerTask: expAvg - cheapAvg,
                    cheapSuccessRate: cheapRate,
                    sampleSize: cheapStats.count,
                });
            }
        }

        res.json({
            success: true,
            global,
            byModel: byModelOut,
            byProject,
            velocity: { dailyCounts, trend, avgLast3Days: last3, avgPrev4Days: prev4 },
            suggestions,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/errors/:project — Error patterns for a project from project memory
 */
app.get('/api/errors/:project', (req, res) => {
    try {
        const projectPath = decodeURIComponent(req.params.project);
        const patterns = getRecentFailures(projectPath);

        // Total failure stats
        const totalRow = db.prepare(
            'SELECT COUNT(*) as total, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures FROM project_memory WHERE project_path = ?'
        ).get(projectPath);

        res.json({
            success: true,
            projectPath,
            patterns,
            totalFailures: totalRow.failures || 0,
            failureRate: totalRow.total > 0 ? (totalRow.failures || 0) / totalRow.total : 0,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Digest API (Level 9 Phase 3) ──────────────────────────

app.get('/api/digest/latest', (req, res) => {
    try {
        const digest = digestStmts.getLatest.get();
        if (!digest) return res.json({ success: true, digest: null });
        if (!digest.viewed_at) {
            digestStmts.markViewed.run(new Date().toISOString(), digest.id);
            digest.viewed_at = new Date().toISOString();
        }
        digest.digest_json = JSON.parse(digest.digest_json || '{}');
        res.json({ success: true, digest });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/digest/generate', (req, res) => {
    try {
        const since = req.query.since
            ? new Date(req.query.since)
            : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const digest = generateDailyDigest(since);
        if (!digest) return res.json({ success: true, digest: null, message: 'No activity in period' });
        sendDigestPush(digest.digest_text.split('\n')[0]);
        res.json({ success: true, digest });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/digest/history', (req, res) => {
    try {
        const digests = digestStmts.list.all();
        res.json({ success: true, digests });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Maintenance API (Level 9 Phase 4) ─────────────────────

app.get('/api/maintenance/history', (req, res) => {
    try {
        const runs = maintenanceStmts.list.all();
        res.json({ success: true, runs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/maintenance/run', (req, res) => {
    try {
        const result = runNightlyMaintenance();
        if (!result) return res.json({ success: true, result: null, message: 'No active projects with maintenance enabled' });
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/maintenance/:project/toggle', (req, res) => {
    try {
        const project = portfolioStmts.get.get(req.params.project);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        const newValue = project.maintenance_enabled ? 0 : 1;
        db.prepare('UPDATE projects SET maintenance_enabled = ? WHERE name = ?').run(newValue, req.params.project);
        res.json({ success: true, project: req.params.project, maintenance_enabled: !!newValue });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Weekly Report API (Level 9 Phase 5) ───────────────────

app.get('/api/weekly-report/latest', (req, res) => {
    try {
        const report = weeklyReportStmts.getLatest.get();
        if (!report) return res.json({ success: true, report: null });
        if (!report.viewed_at) {
            weeklyReportStmts.markViewed.run(new Date().toISOString(), report.id);
            report.viewed_at = new Date().toISOString();
        }
        report.report_json = JSON.parse(report.report_json || '{}');
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/weekly-report/generate', (req, res) => {
    try {
        const since = req.query.since
            ? new Date(req.query.since)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const report = generateWeeklyReport(since);
        if (!report) return res.json({ success: true, report: null, message: 'No activity in period' });
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/weekly-report/history', (req, res) => {
    try {
        const reports = weeklyReportStmts.list.all();
        res.json({ success: true, reports });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Level 11: Product Pipeline API ───────────────────────

app.post('/api/products', (req, res) => {
    try {
        const { name, seed, config } = req.body;
        if (!name || !seed) return res.status(400).json({ success: false, error: 'name and seed are required' });
        const productId = createProduct(name, seed, config || {});
        const product = productStmts.get.get(productId);
        const phases = phaseStmts.getByProduct.all(productId);
        res.json({ success: true, product, phases });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/products', (req, res) => {
    try {
        const products = productStmts.list.all();
        res.json({ success: true, products });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/products/:id', (req, res) => {
    try {
        const product = productStmts.get.get(req.params.id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        const phases = phaseStmts.getByProduct.all(req.params.id);
        const knowledge = knowledgeStmts.getByProduct.all(req.params.id);
        res.json({ success: true, product, phases, knowledge });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/products/:id', (req, res) => {
    try {
        const product = productStmts.get.get(req.params.id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        productStmts.updateStatus.run('cancelled', new Date().toISOString(), req.params.id);
        res.json({ success: true, message: `Product "${product.name}" cancelled` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/products/:id/phases/:phase/approve', (req, res) => {
    try {
        const { id, phase } = req.params;
        const product = productStmts.get.get(id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        const phaseRecord = phaseStmts.get.get(id, phase);
        if (!phaseRecord) return res.status(404).json({ success: false, error: 'Phase not found' });
        if (phaseRecord.gate_status !== 'pending') return res.status(400).json({ success: false, error: `Gate is not pending (current: ${phaseRecord.gate_status})` });

        phaseStmts.updateGate.run('approved', new Date().toISOString(), req.body.notes || null, id, phase);
        const goalId = executePhase(id, phase);
        res.json({ success: true, phase, goalId, message: `Phase "${phase}" approved and started` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/products/:id/phases/:phase/reject', (req, res) => {
    try {
        const { id, phase } = req.params;
        const product = productStmts.get.get(id);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        const phaseRecord = phaseStmts.get.get(id, phase);
        if (!phaseRecord) return res.status(404).json({ success: false, error: 'Phase not found' });

        phaseStmts.updateGate.run('rejected', new Date().toISOString(), req.body.notes || 'Rejected', id, phase);
        // Re-run the previous phase
        const prevIndex = PIPELINE_PHASES.indexOf(phase) - 1;
        if (prevIndex >= 0) {
            const prevPhase = PIPELINE_PHASES[prevIndex];
            phaseStmts.complete.run('pending', null, 0, null, id, prevPhase);
            const goalId = executePhase(id, prevPhase);
            res.json({ success: true, phase, message: `Phase "${phase}" rejected. Re-running "${prevPhase}".`, goalId });
        } else {
            res.json({ success: true, phase, message: `Phase "${phase}" rejected. No previous phase to re-run.` });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/products/:id/knowledge', (req, res) => {
    try {
        const { category } = req.query;
        const entries = category
            ? knowledgeStmts.getByCategory.all(req.params.id, category)
            : knowledgeStmts.getByProduct.all(req.params.id);
        res.json({ success: true, entries });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/products/:id/knowledge', (req, res) => {
    try {
        const { category, title, content, source_phase } = req.body;
        if (!category || !title || !content) return res.status(400).json({ success: false, error: 'category, title, and content are required' });
        knowledgeStmts.insert.run(req.params.id, category, title, content, source_phase || 'manual', new Date().toISOString());
        res.json({ success: true, message: 'Knowledge entry added' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/products/:id/research', (req, res) => {
    try {
        const productId = req.params.id;
        const product = productStmts.get.get(productId);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

        const phase = phaseStmts.get.get(productId, 'research');
        if (!phase) return res.status(404).json({ success: false, error: 'Research phase not found' });

        const parentGoal = phase.goal_id ? goalStmts.get.get(phase.goal_id) : null;
        if (!parentGoal) {
            return res.json({ success: true, status: 'not_started', phase, subagents: [] });
        }

        const children = goalStmts.getChildren.all(parentGoal.id);
        const subagents = children.map(child => {
            const tasks = taskStmts.getByGoal.all(child.id);
            return {
                goal_id: child.id,
                area: child.description.split('.')[0].split(':')[0].trim(),
                status: child.status,
                progress: { tasks_total: child.task_count || 0, tasks_completed: child.tasks_completed || 0, tasks_failed: child.tasks_failed || 0 },
                cost_usd: child.total_cost_usd || 0,
                created_at: child.created_at,
                completed_at: child.completed_at,
                tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, cost_usd: t.cost_usd || 0 }))
            };
        });

        const knowledge = knowledgeStmts.getByProduct.all(productId)
            .filter(k => k.source_phase === 'research')
            .map(k => ({ category: k.category, title: k.title, preview: k.content.slice(0, 200), created_at: k.created_at }));

        res.json({
            success: true,
            status: parentGoal.status,
            phase,
            parent_goal: { id: parentGoal.id, status: parentGoal.status, total_cost_usd: parentGoal.total_cost_usd || 0, created_at: parentGoal.created_at, completed_at: parentGoal.completed_at },
            subagents,
            knowledge_count: knowledge.length,
            knowledge_preview: knowledge.slice(0, 10)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/products/:id/design', (req, res) => {
    try {
        const productId = req.params.id;
        const product = productStmts.get.get(productId);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

        const phase = phaseStmts.get.get(productId, 'design');
        if (!phase) return res.status(404).json({ success: false, error: 'Design phase not found' });

        const parentGoal = phase.goal_id ? goalStmts.get.get(phase.goal_id) : null;
        if (!parentGoal) {
            return res.json({ success: true, status: 'not_started', phase, subagents: [] });
        }

        const children = goalStmts.getChildren.all(parentGoal.id);
        const subagents = children.map(child => {
            const tasks = taskStmts.getByGoal.all(child.id);
            return {
                goal_id: child.id,
                area: child.description.split('.')[0].split(':')[0].trim(),
                status: child.status,
                progress: { tasks_total: child.task_count || 0, tasks_completed: child.tasks_completed || 0, tasks_failed: child.tasks_failed || 0 },
                cost_usd: child.total_cost_usd || 0,
                created_at: child.created_at,
                completed_at: child.completed_at,
                tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, cost_usd: t.cost_usd || 0 }))
            };
        });

        const knowledge = knowledgeStmts.getByProduct.all(productId)
            .filter(k => k.source_phase === 'design')
            .map(k => ({ category: k.category, title: k.title, preview: k.content.slice(0, 200), created_at: k.created_at }));

        res.json({
            success: true,
            status: parentGoal.status,
            phase,
            parent_goal: { id: parentGoal.id, status: parentGoal.status, total_cost_usd: parentGoal.total_cost_usd || 0, created_at: parentGoal.created_at, completed_at: parentGoal.completed_at },
            subagents,
            knowledge_count: knowledge.length,
            knowledge_preview: knowledge.slice(0, 10)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/orchestrator/setup — Pull Ollama model
 */
app.post('/api/orchestrator/setup', async (req, res) => {
    try {
        const status = orchestrator.getStatus();
        const modelName = req.body.model || status.ollamaModel;

        // Start pulling model (async, can take a while)
        res.json({
            success: true,
            message: `Starting pull of ${modelName}`,
            note: 'This endpoint is a placeholder. Use "ollama pull" command directly for now.'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Goal orchestration helpers ────────────────────────────

/**
 * Generate a unique ID for goals/tasks
 */
function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Create a goal programmatically (used by API and maintenance scheduler).
 * Returns goalId. Decomposition runs asynchronously.
 */
function createGoal(description, projectPath, autoExecute = true, parentGoalId = null, goalType = 'standalone') {
    const goalId = generateId();
    const now = new Date().toISOString();
    const orchStatus = orchestrator.getStatus();

    goalStmts.insert.run(
        goalId,
        description,
        projectPath,
        goalType === 'parent' ? 'active' : 'decomposing',
        now,
        orchStatus.backend,
        orchStatus.backend === 'ollama' ? orchStatus.ollamaModel : 'claude-haiku-4-5-20251001',
        parentGoalId,
        goalType
    );

    broadcastGoalUpdate(goalId);

    // Parent goals don't decompose — they track children instead
    if (goalType === 'parent') {
        console.log(`[Goal ${goalId}] Parent goal created: ${description.slice(0, 80)}...`);
        return goalId;
    }

    // Start decomposition asynchronously
    (async () => {
        try {
            const projectContext = readProjectContext(projectPath);

            console.log(`[Goal ${goalId}] Decomposing: ${description}`);
            const decomposition = await orchestrator.decomposeGoal(description, projectContext);

            const subtasks = decomposition.subtasks || [];
            const titleToId = {};

            for (const subtask of subtasks) {
                const taskId = generateId();
                titleToId[subtask.title] = taskId;

                const dependsOnIds = (subtask.dependsOn || [])
                    .map(title => titleToId[title])
                    .filter(Boolean);
                const dependsOnJson = dependsOnIds.length > 0 ? JSON.stringify(dependsOnIds) : null;

                // Memory-based model recommendation (Phase E feedback loop)
                let finalModel = subtask.model || 'sonnet';
                const recommendation = orchestrator.recommendModel(db, projectPath, 'unknown');
                if (recommendation.model && recommendation.confidence !== 'none') {
                    const costRank = { haiku: 1, sonnet: 2, opus: 3 };
                    if ((costRank[recommendation.model] || 99) <= (costRank[finalModel] || 99)) {
                        console.log(`[Goal ${goalId}] Memory override: ${finalModel} → ${recommendation.model} for "${subtask.title}" (${recommendation.reason})`);
                        finalModel = recommendation.model;
                    }
                }

                taskStmts.insertWithGoal.run(
                    taskId,
                    subtask.title,
                    subtask.description,
                    projectPath,
                    subtask.priority || 5,
                    finalModel,
                    100,
                    'bypass',
                    null,
                    now,
                    goalId,
                    null,
                    dependsOnJson,
                    1
                );

                broadcastTaskUpdate(taskStmts.get.get(taskId));
            }

            goalStmts.updateDecomposition.run(
                JSON.stringify(decomposition),
                subtasks.length,
                autoExecute ? 'active' : 'pending',
                goalId
            );

            console.log(`[Goal ${goalId}] Decomposed into ${subtasks.length} tasks`);

            if (wss.clients.size > 0) {
                const goal = goalStmts.get.get(goalId);
                const tasks = taskStmts.getByGoal.all(goalId);
                const message = JSON.stringify({ type: 'goal_decomposed', goal, tasks });
                wss.clients.forEach((client) => {
                    if (client.readyState === 1) client.send(message);
                });
            }
        } catch (err) {
            console.error(`[Goal ${goalId}] Decomposition failed:`, err.message);
            goalStmts.updateStatus.run('failed', goalId);
            broadcastGoalUpdate(goalId);
        }
    })();

    return goalId;
}

/**
 * Update goal progress based on its tasks
 */
function updateGoalProgress(goalId) {
    if (!goalId) return;

    const goal = goalStmts.get.get(goalId);
    if (!goal) return;

    // Parent goals are updated via updateParentGoalProgress(), not here
    if (goal.goal_type === 'parent') return;

    const tasks = taskStmts.getByGoal.all(goalId);
    const completed = tasks.filter(t => t.status === 'done').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
    const allDone = tasks.every(t => ['done', 'cancelled', 'failed'].includes(t.status));
    const anyFailed = tasks.some(t => t.status === 'failed');

    const status = allDone ? (anyFailed ? 'failed' : 'done') : 'active';
    const completedAt = allDone ? new Date().toISOString() : null;

    goalStmts.updateProgress.run(completed, failed, totalCost, status, completedAt, goalId);

    // Generate summary when goal reaches terminal state
    if (allDone && completedAt) {
        try { generateGoalSummary(goalId); }
        catch (err) { console.error(`[Goal] Summary generation failed for ${goalId}:`, err.message); }

        // Child goal completed: extract knowledge, then check parent
        if (goal.goal_type === 'child' && goal.parent_goal_id) {
            try { extractChildGoalKnowledge(goalId, goal.parent_goal_id); }
            catch (err) { console.error(`[Knowledge] Extraction failed for child ${goalId}:`, err.message); }
            updateParentGoalProgress(goal.parent_goal_id);
        }

        // Standalone goal: check if it belongs to a product pipeline phase
        if (goal.goal_type === 'standalone' || !goal.goal_type) {
            try {
                const phase = db.prepare('SELECT * FROM product_phases WHERE goal_id = ?').get(goalId);
                if (phase && phase.product_id) {
                    const updatedGoal = goalStmts.get.get(goalId);
                    advancePipeline(phase.product_id, phase.phase, {
                        cost_usd: totalCost,
                        result_summary: updatedGoal ? updatedGoal.summary : null,
                        description: updatedGoal ? updatedGoal.description : null,
                        artifacts: [],
                    });
                }
            } catch (err) {
                console.error(`[Pipeline] Failed to check pipeline advancement for goal ${goalId}:`, err.message);
            }
        }
    }

    // Broadcast goal update
    broadcastGoalUpdate(goalId);
}

/**
 * Update parent goal progress based on child goal completion.
 * When all children complete, synthesise findings and trigger pipeline advancement.
 */
function updateParentGoalProgress(parentGoalId) {
    const children = goalStmts.getChildren.all(parentGoalId);
    if (children.length === 0) return;

    const completed = children.filter(c => c.status === 'done').length;
    const failed = children.filter(c => c.status === 'failed').length;
    const totalCost = children.reduce((sum, c) => sum + (c.total_cost_usd || 0), 0);
    const allDone = children.every(c => ['done', 'failed', 'cancelled'].includes(c.status));
    const anyFailed = children.some(c => c.status === 'failed');

    const status = allDone ? (anyFailed ? 'failed' : 'done') : 'active';
    const completedAt = allDone ? new Date().toISOString() : null;

    goalStmts.updateProgress.run(completed, failed, totalCost, status, completedAt, parentGoalId);
    broadcastGoalUpdate(parentGoalId);

    console.log(`[Goal] Parent ${parentGoalId} progress: ${completed}/${children.length} children complete`);

    if (allDone && completedAt) {
        // Phase-aware synthesis
        try {
            const phaseRecord = db.prepare('SELECT phase FROM product_phases WHERE goal_id = ?').get(parentGoalId);
            if (phaseRecord) {
                if (phaseRecord.phase === 'research') synthesizeResearchFindings(parentGoalId);
                else if (phaseRecord.phase === 'design') synthesizeDesignArtifacts(parentGoalId);
            }
        } catch (err) { console.error(`[Pipeline] Synthesis failed for ${parentGoalId}:`, err.message); }

        try { generateGoalSummary(parentGoalId); }
        catch (err) { console.error(`[Goal] Summary failed for parent ${parentGoalId}:`, err.message); }

        // Check if parent goal belongs to a product pipeline phase
        try {
            const phase = db.prepare('SELECT * FROM product_phases WHERE goal_id = ?').get(parentGoalId);
            if (phase && phase.product_id) {
                const parentGoal = goalStmts.get.get(parentGoalId);
                advancePipeline(phase.product_id, phase.phase, {
                    cost_usd: totalCost,
                    result_summary: parentGoal ? parentGoal.summary : null,
                    description: parentGoal ? parentGoal.description : null,
                    artifacts: [],
                });
            }
        } catch (err) {
            console.error(`[Pipeline] Failed to advance pipeline for parent ${parentGoalId}:`, err.message);
        }
    }
}

/**
 * Extract knowledge entries from a completed child research goal.
 * Looks for [KNOWLEDGE] markers in task results, falls back to goal summary.
 */
function extractChildGoalKnowledge(childGoalId, parentGoalId) {
    try {
        const childGoal = goalStmts.get.get(childGoalId);
        if (!childGoal) return;

        const phaseRecord = db.prepare('SELECT product_id, phase FROM product_phases WHERE goal_id = ?').get(parentGoalId);
        if (!phaseRecord) return;

        const productId = phaseRecord.product_id;
        const sourcePhase = phaseRecord.phase || 'unknown';
        const now = new Date().toISOString();
        let extracted = 0;

        // Try to extract [KNOWLEDGE] markers from task results
        const tasks = taskStmts.getByGoal.all(childGoalId);
        const knowledgeRegex = /\[KNOWLEDGE\s+category="([^"]+)"\s+title="([^"]+)"\]([\s\S]*?)\[\/KNOWLEDGE\]/g;

        for (const task of tasks) {
            if (!task.result) continue;
            let match;
            while ((match = knowledgeRegex.exec(task.result)) !== null) {
                knowledgeStmts.insert.run(productId, match[1].trim(), match[2].trim(), match[3].trim(), sourcePhase, now);
                extracted++;
            }
        }

        // Also check goal summary file
        if (childGoal.summary_file && fs.existsSync(childGoal.summary_file)) {
            try {
                const content = fs.readFileSync(childGoal.summary_file, 'utf8');
                let match;
                const regex = /\[KNOWLEDGE\s+category="([^"]+)"\s+title="([^"]+)"\]([\s\S]*?)\[\/KNOWLEDGE\]/g;
                while ((match = regex.exec(content)) !== null) {
                    knowledgeStmts.insert.run(productId, match[1].trim(), match[2].trim(), match[3].trim(), sourcePhase, now);
                    extracted++;
                }
            } catch {}
        }

        // Fallback: if no markers found, store the area description + summary as a knowledge entry
        if (extracted === 0) {
            const area = childGoal.description.split(':')[0].replace(/^.*?for\s+/i, '').trim() || 'general';
            const summary = childGoal.summary || `Completed: ${childGoal.description.slice(0, 500)}`;
            knowledgeStmts.insert.run(productId, area.toLowerCase(), `${area} ${sourcePhase} findings`, summary, sourcePhase, now);
            extracted = 1;
        }

        console.log(`[Knowledge] Extracted ${extracted} entries from child goal ${childGoalId} (phase: ${sourcePhase})`);
    } catch (err) {
        console.error(`[Knowledge] Extraction failed for child goal ${childGoalId}:`, err.message);
    }
}

/**
 * Synthesise findings from all child research goals into a Research Brief.
 * Stores as a knowledge entry with category='research_brief'.
 */
function synthesizeResearchFindings(parentGoalId) {
    try {
        const phase = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId);
        if (!phase) return;

        const productId = phase.product_id;
        const product = productStmts.get.get(productId);
        if (!product) return;

        const children = goalStmts.getChildren.all(parentGoalId);
        const allKnowledge = knowledgeStmts.getByProduct.all(productId).filter(k => k.source_phase === 'research' && k.category !== 'research_brief');

        let brief = `# Research Brief: ${product.name}\n\n`;
        brief += `**Seed Idea:** ${product.seed}\n\n`;
        brief += `**Completed:** ${new Date().toISOString().split('T')[0]}\n\n---\n\n`;

        // Group knowledge by category
        const byCategory = {};
        for (const k of allKnowledge) {
            if (!byCategory[k.category]) byCategory[k.category] = [];
            byCategory[k.category].push(k);
        }

        const categoryNames = {
            market: 'Market Research', technical: 'Technical Feasibility',
            competitive: 'Competitive Analysis', practices: 'Engineering Best Practices',
            regulatory: 'Regulatory & Compliance', ux: 'UX Patterns & Design'
        };

        for (const [category, entries] of Object.entries(byCategory)) {
            brief += `## ${categoryNames[category] || category}\n\n`;
            for (const entry of entries) {
                brief += `### ${entry.title}\n\n${entry.content}\n\n`;
            }
        }

        // Execution summary
        brief += `---\n\n## Execution Summary\n\n`;
        for (const child of children) {
            const area = child.description.split('.')[0].slice(0, 60);
            brief += `- **${area}**: ${child.status} (${child.tasks_completed || 0}/${child.task_count || 0} tasks, $${(child.total_cost_usd || 0).toFixed(4)})\n`;
        }
        const totalCost = children.reduce((sum, c) => sum + (c.total_cost_usd || 0), 0);
        brief += `\n**Total Research Cost:** $${totalCost.toFixed(4)}\n`;

        const now = new Date().toISOString();
        knowledgeStmts.insert.run(productId, 'research_brief', `Complete Research Brief — ${product.name}`, brief, 'research', now);

        console.log(`[Pipeline] Research synthesis complete for "${product.name}" — ${allKnowledge.length} findings, $${totalCost.toFixed(4)}`);
    } catch (err) {
        console.error(`[Pipeline] Research synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

/**
 * Synthesise design artifacts from all child design goals into a Design Package.
 * Stores as a knowledge entry with category='design_package'.
 */
function synthesizeDesignArtifacts(parentGoalId) {
    try {
        const phaseRecord = db.prepare('SELECT product_id FROM product_phases WHERE goal_id = ?').get(parentGoalId);
        if (!phaseRecord) return;

        const productId = phaseRecord.product_id;
        const product = productStmts.get.get(productId);
        if (!product) return;

        const children = goalStmts.getChildren.all(parentGoalId);
        const allKnowledge = knowledgeStmts.getByProduct.all(productId).filter(k => k.source_phase === 'design' && k.category !== 'design_package');

        let pkg = `# Design Package: ${product.name}\n\n`;
        pkg += `**Seed Idea:** ${product.seed}\n\n`;
        pkg += `**Completed:** ${new Date().toISOString().split('T')[0]}\n\n---\n\n`;

        const byCategory = {};
        for (const k of allKnowledge) {
            if (!byCategory[k.category]) byCategory[k.category] = [];
            byCategory[k.category].push(k);
        }

        const categoryNames = {
            requirements: 'Requirements Specification', datamodel: 'Data Model',
            api: 'API Specification', ux: 'UX & Wireframes',
            interactions: 'Interaction Design', accessibility: 'Accessibility'
        };

        for (const [category, entries] of Object.entries(byCategory)) {
            pkg += `## ${categoryNames[category] || category}\n\n`;
            for (const entry of entries) {
                pkg += `### ${entry.title}\n\n${entry.content}\n\n`;
            }
        }

        pkg += `---\n\n## Execution Summary\n\n`;
        for (const child of children) {
            const area = child.description.split('.')[0].slice(0, 60);
            pkg += `- **${area}**: ${child.status} (${child.tasks_completed || 0}/${child.task_count || 0} tasks, $${(child.total_cost_usd || 0).toFixed(4)})\n`;
        }
        const totalCost = children.reduce((sum, c) => sum + (c.total_cost_usd || 0), 0);
        pkg += `\n**Total Design Cost:** $${totalCost.toFixed(4)}\n`;

        const now = new Date().toISOString();
        knowledgeStmts.insert.run(productId, 'design_package', `Complete Design Package — ${product.name}`, pkg, 'design', now);

        console.log(`[Pipeline] Design synthesis complete for "${product.name}" — ${allKnowledge.length} artifacts, $${totalCost.toFixed(4)}`);
    } catch (err) {
        console.error(`[Pipeline] Design synthesis failed for parent ${parentGoalId}:`, err.message);
    }
}

/**
 * Record task outcome in project memory
 */
function recordTaskOutcome(task) {
    if (!task.completed_at) return;

    const success = task.status === 'done' ? 1 : 0;
    const durationSeconds = task.started_at && task.completed_at
        ? (new Date(task.completed_at) - new Date(task.started_at)) / 1000
        : null;

    try {
        memoryStmts.insert.run(
            task.project_path,
            task.complexity || 'unknown',
            task.model,
            success,
            task.cost_usd || 0,
            task.turns || 0,
            durationSeconds,
            task.error || null,
            task.completed_at
        );
    } catch (err) {
        console.error('[Memory] Failed to record outcome:', err.message);
    }
}

/**
 * Broadcast goal update to WebSocket clients
 */
function broadcastGoalUpdate(goalId) {
    if (wss.clients.size === 0) return;

    const goal = goalStmts.get.get(goalId);
    if (!goal) return;

    const tasks = taskStmts.getByGoal.all(goalId);

    const message = JSON.stringify({
        type: 'goal_update',
        goal,
        tasks
    });

    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
    });
}

/**
 * Generate a structured summary log when a goal completes.
 * Mirrors human session log format: What Was Done, Commits, Files Changed, Cost Summary.
 */
function generateGoalSummary(goalId) {
    const goal = goalStmts.get.get(goalId);
    if (!goal) return null;

    const tasks = taskStmts.getByGoal.all(goalId);
    if (tasks.length === 0) return null;

    // Calculate duration from earliest task start to latest task completion
    const startTimes = tasks.map(t => t.started_at).filter(Boolean).sort();
    const endTimes = tasks.map(t => t.completed_at).filter(Boolean).sort();
    const goalStart = startTimes[0] || goal.created_at;
    const goalEnd = endTimes[endTimes.length - 1] || goal.completed_at || new Date().toISOString();
    const durationMs = new Date(goalEnd) - new Date(goalStart);
    const durationMin = Math.round(durationMs / 60000);
    const durationStr = durationMin >= 60
        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
        : `${durationMin}m`;

    // Aggregate data
    const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
    const totalTokensIn = tasks.reduce((sum, t) => sum + (t.tokens_in || 0), 0);
    const totalTokensOut = tasks.reduce((sum, t) => sum + (t.tokens_out || 0), 0);
    const totalTurns = tasks.reduce((sum, t) => sum + (t.turns || 0), 0);
    const doneTasks = tasks.filter(t => t.status === 'done');
    const failedTasks = tasks.filter(t => t.status === 'failed');

    // Collect commits and files
    const commits = tasks.filter(t => t.commit_sha).map(t => ({ sha: t.commit_sha, title: t.title }));
    const allFiles = new Set();
    for (const t of tasks) {
        if (t.files_changed) {
            try { JSON.parse(t.files_changed).forEach(f => allFiles.add(f)); } catch {}
        }
    }

    // Build markdown summary
    const lines = [
        `# Goal Summary: ${goal.description}`,
        ``,
        `- **Goal ID**: ${goal.id}`,
        `- **Project**: ${path.basename(goal.project_path)} (${goal.project_path})`,
        `- **Status**: ${goal.status}`,
        `- **Start**: ${goalStart}`,
        `- **End**: ${goalEnd}`,
        `- **Duration**: ${durationStr}`,
        `- **Tasks**: ${doneTasks.length} completed, ${failedTasks.length} failed, ${tasks.length} total`,
        ``,
        `---`,
        ``,
        `## What Was Done`,
        ``,
    ];

    for (const t of doneTasks) {
        lines.push(`- **${t.title}** (${t.model}, $${(t.cost_usd || 0).toFixed(4)}, ${t.turns || 0} turns)`);
        if (t.result) {
            const brief = t.result.replace(/\n/g, ' ').slice(0, 200);
            lines.push(`  - ${brief}${t.result.length > 200 ? '...' : ''}`);
        }
    }

    if (failedTasks.length > 0) {
        lines.push(``, `### Failed Tasks`, ``);
        for (const t of failedTasks) {
            lines.push(`- **${t.title}** (${t.model})`);
            if (t.error) lines.push(`  - Error: ${t.error.slice(0, 200)}`);
        }
    }

    if (commits.length > 0) {
        lines.push(``, `## Commits`, ``);
        for (const c of commits) {
            lines.push(`- \`${c.sha.slice(0, 7)}\` — ${c.title}`);
        }
    }

    if (allFiles.size > 0) {
        lines.push(``, `## Files Changed`, ``);
        for (const f of [...allFiles].sort()) {
            lines.push(`- ${f}`);
        }
    }

    lines.push(
        ``, `## Cost Summary`, ``,
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Total Cost | $${totalCost.toFixed(4)} |`,
        `| Tokens In | ${totalTokensIn.toLocaleString()} |`,
        `| Tokens Out | ${totalTokensOut.toLocaleString()} |`,
        `| Total Turns | ${totalTurns} |`,
        `| Duration | ${durationStr} |`,
        ``
    );

    if (tasks.length > 1) {
        lines.push(`## Per-Task Breakdown`, ``,
            `| Task | Status | Model | Cost | Turns | Commit |`,
            `|------|--------|-------|------|-------|--------|`);
        for (const t of tasks) {
            const sha = t.commit_sha ? `\`${t.commit_sha.slice(0, 7)}\`` : '-';
            lines.push(`| ${t.title} | ${t.status} | ${t.model} | $${(t.cost_usd || 0).toFixed(4)} | ${t.turns || 0} | ${sha} |`);
        }
        lines.push(``);
    }

    lines.push(`---`, ``);

    // Write summary file
    const logDir = path.join(goal.project_path, '_logs');
    try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }); } catch {}

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeDesc = goal.description.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 50);
    const summaryFile = path.join(logDir, `goal_${timestamp}_${safeDesc}.md`);

    try {
        fs.writeFileSync(summaryFile, lines.join('\n'));
        goalStmts.updateSummaryFile.run(summaryFile, goalId);
        console.log(`[Goal] Summary written: ${summaryFile}`);
    } catch (err) {
        console.error(`[Goal] Failed to write summary:`, err.message);
        return null;
    }

    // Broadcast goal completion
    if (wss.clients.size > 0) {
        const msg = JSON.stringify({
            type: 'goal_completed',
            goalId,
            status: goal.status,
            summary_file: summaryFile,
            total_cost: totalCost,
            duration: durationStr,
            tasks_completed: doneTasks.length,
            tasks_failed: failedTasks.length
        });
        wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(msg);
        });
    }

    return summaryFile;
}

/**
 * Generate a daily digest aggregating task activity across all projects.
 * Returns the digest object or null if no activity in the period.
 */
function generateDailyDigest(since) {
    try {
        const periodStart = since instanceof Date ? since.toISOString() : since;
        const periodEnd = new Date().toISOString();

        const projects = portfolioStmts.list.all();
        const projectData = [];
        let totalCompleted = 0;
        let totalFailed = 0;
        let totalCost = 0;
        let totalCommits = 0;

        for (const proj of projects) {
            const tasks = db.prepare(
                'SELECT * FROM tasks WHERE project_path = ? AND completed_at > ? AND status IN (\'done\', \'failed\') ORDER BY completed_at ASC'
            ).all(proj.path, periodStart);

            if (tasks.length === 0) continue;

            const done = tasks.filter(t => t.status === 'done');
            const failed = tasks.filter(t => t.status === 'failed');
            const cost = tasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
            const commits = tasks.filter(t => t.commit_sha).map(t => t.commit_sha.slice(0, 7));

            totalCompleted += done.length;
            totalFailed += failed.length;
            totalCost += cost;
            totalCommits += commits.length;

            projectData.push({
                name: proj.name,
                tasks_completed: done.length,
                tasks_failed: failed.length,
                cost,
                commits,
                failures: failed.map(t => ({ title: t.title, error: (t.error || '').slice(0, 200) })),
            });
        }

        // Skip if no activity
        if (totalCompleted === 0 && totalFailed === 0) return null;

        const digestJson = {
            generated_at: periodEnd,
            period_start: periodStart,
            period_end: periodEnd,
            summary: {
                tasks_completed: totalCompleted,
                tasks_failed: totalFailed,
                total_cost: totalCost,
                commits: totalCommits,
                projects_active: projectData.length,
            },
            projects: projectData,
        };

        // Build markdown text
        const sinceStr = new Date(periodStart).toLocaleString();
        const lines = [
            `Since ${sinceStr}: ${totalCompleted} tasks completed across ${projectData.length} projects ($${totalCost.toFixed(4)}).${totalFailed > 0 ? ` ${totalFailed} failures awaiting review.` : ''}`,
            ``,
        ];

        for (const p of projectData) {
            lines.push(`### ${p.name}`);
            lines.push(`- ${p.tasks_completed} completed, ${p.tasks_failed} failed — $${p.cost.toFixed(4)}`);
            if (p.commits.length > 0) lines.push(`- Commits: ${p.commits.join(', ')}`);
            if (p.failures.length > 0) {
                for (const f of p.failures) {
                    lines.push(`- FAILED: ${f.title}${f.error ? ` — ${f.error.slice(0, 100)}` : ''}`);
                }
            }
            lines.push(``);
        }

        const digestText = lines.join('\n');
        const id = generateId();

        digestStmts.insert.run(id, periodEnd, periodStart, periodEnd, digestText, JSON.stringify(digestJson), totalCompleted + totalFailed, totalCost);

        // Broadcast via WebSocket
        if (wss.clients.size > 0) {
            const msg = JSON.stringify({ type: 'digest_ready', digestId: id, task_count: totalCompleted + totalFailed, total_cost: totalCost });
            wss.clients.forEach(client => {
                if (client.readyState === 1) client.send(msg);
            });
        }

        return { id, task_count: totalCompleted + totalFailed, total_cost: totalCost, digest_text: digestText };
    } catch (err) {
        console.error('[Digest] Generation failed:', err.message);
        return null;
    }
}

/**
 * Load config from ~/.claude-remote/config.json
 */
function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.claude-remote', 'config.json'), 'utf8'));
    } catch { return {}; }
}

/**
 * Send digest summary as a push notification via ntfy.sh
 */
function sendDigestPush(summary) {
    const config = loadConfig();
    if (!config.ntfy_topic) return;
    try {
        execFileSync('curl', ['-s', '-d', summary, '-H', 'Title: Claude Remote Daily Digest', '-H', 'Priority: default', '-H', 'Tags: clipboard', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
    } catch {}
}

/**
 * Run nightly maintenance: create a maintenance goal for each active, enabled project.
 */
function runNightlyMaintenance() {
    try {
        const runId = generateId();
        const now = new Date().toISOString();
        const projects = portfolioStmts.list.all().filter(p =>
            p.lifecycle === 'active' && p.maintenance_enabled !== 0
        );

        if (projects.length === 0) return null;

        maintenanceStmts.insert.run(runId, now, null, 'running', projects.length, null, null);

        const goalIds = [];
        for (const proj of projects) {
            if (!fs.existsSync(proj.path)) continue;
            try {
                const goalId = createGoal(
                    `Nightly maintenance for ${proj.name}: run test suite, check for outdated dependencies, verify project health`,
                    proj.path,
                    true
                );
                if (goalId) goalIds.push(goalId);
            } catch (err) {
                console.error(`[Maintenance] Failed to create goal for ${proj.name}:`, err.message);
            }
        }

        maintenanceStmts.complete.run(
            goalIds.length === 0 ? now : null,
            goalIds.length > 0 ? 'active' : 'skipped',
            `Created ${goalIds.length} maintenance goals for ${projects.length} projects`,
            runId
        );

        // Broadcast + push
        if (wss.clients.size > 0) {
            const msg = JSON.stringify({ type: 'maintenance_started', runId, projects: projects.length, goals: goalIds.length });
            wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
        }

        const config = loadConfig();
        if (config.ntfy_topic) {
            try {
                execFileSync('curl', ['-s', '-d', `Nightly maintenance started: ${goalIds.length} goals across ${projects.length} projects`, '-H', 'Title: Claude Remote Maintenance', '-H', 'Priority: low', '-H', 'Tags: wrench', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
            } catch {}
        }

        console.log(`[Maintenance] Run ${runId}: ${goalIds.length} goals created for ${projects.length} projects`);
        return { runId, goalIds };
    } catch (err) {
        console.error('[Maintenance] Run failed:', err.message);
        return null;
    }
}

/**
 * Generate a weekly progress report aggregating 7 days of activity across all projects.
 * Returns the report object or null if no activity in the period.
 */
function generateWeeklyReport(weekStart) {
    try {
        const periodStart = weekStart instanceof Date ? weekStart.toISOString() : weekStart;
        const periodEnd = new Date().toISOString();

        const projects = portfolioStmts.list.all();
        const projectData = [];
        let totalCompleted = 0;
        let totalFailed = 0;
        let totalCost = 0;
        let totalCommits = 0;

        // All tasks in the period (for daily breakdown)
        const allTasks = [];

        for (const proj of projects) {
            const tasks = db.prepare(
                'SELECT * FROM tasks WHERE project_path = ? AND completed_at > ? AND status IN (\'done\', \'failed\') ORDER BY completed_at ASC'
            ).all(proj.path, periodStart);

            if (tasks.length === 0) continue;

            const done = tasks.filter(t => t.status === 'done');
            const failed = tasks.filter(t => t.status === 'failed');
            const cost = tasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
            const commits = tasks.filter(t => t.commit_sha).map(t => t.commit_sha.slice(0, 7));

            // Goals completed for this project in the period
            const goalsCompleted = db.prepare(
                'SELECT COUNT(*) as count FROM goals WHERE project_path = ? AND completed_at > ? AND status = \'completed\''
            ).get(proj.path, periodStart).count;

            totalCompleted += done.length;
            totalFailed += failed.length;
            totalCost += cost;
            totalCommits += commits.length;
            allTasks.push(...tasks);

            projectData.push({
                name: proj.name,
                tasks_completed: done.length,
                tasks_failed: failed.length,
                cost,
                commits,
                goals_completed: goalsCompleted,
            });
        }

        if (totalCompleted === 0 && totalFailed === 0) return null;

        // Daily breakdown (burndown data)
        const dailyBreakdown = [];
        const startDate = new Date(periodStart);
        for (let i = 0; i < 7; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const completed = allTasks.filter(t => t.status === 'done' && t.completed_at && t.completed_at.startsWith(dateStr)).length;
            const failed = allTasks.filter(t => t.status === 'failed' && t.completed_at && t.completed_at.startsWith(dateStr)).length;
            dailyBreakdown.push({ date: dateStr, completed, failed });
        }

        // Goals completed in period
        const totalGoalsCompleted = db.prepare(
            'SELECT COUNT(*) as count FROM goals WHERE completed_at > ? AND status = \'completed\''
        ).get(periodStart).count;

        // Velocity: compare this week vs previous week
        const prevWeekStart = new Date(new Date(periodStart).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const prevWeekCount = db.prepare(
            'SELECT COUNT(*) as count FROM tasks WHERE completed_at > ? AND completed_at <= ? AND status = \'done\''
        ).get(prevWeekStart, periodStart).count;
        const trend = totalCompleted > prevWeekCount * 1.2 ? 'up' : totalCompleted < prevWeekCount * 0.8 ? 'down' : 'stable';

        const reportJson = {
            generated_at: periodEnd,
            week_start: periodStart,
            week_end: periodEnd,
            summary: {
                tasks_completed: totalCompleted,
                tasks_failed: totalFailed,
                goals_completed: totalGoalsCompleted,
                total_cost: totalCost,
                commits: totalCommits,
                projects_active: projectData.length,
            },
            daily_breakdown: dailyBreakdown,
            projects: projectData,
            velocity: { this_week: totalCompleted, prev_week: prevWeekCount, trend },
        };

        // Build markdown text
        const weekOfStr = new Date(periodStart).toLocaleDateString();
        const lines = [
            `Week of ${weekOfStr}: ${totalCompleted} tasks completed across ${projectData.length} projects ($${totalCost.toFixed(4)}).${totalGoalsCompleted > 0 ? ` ${totalGoalsCompleted} goals completed.` : ''}`,
            ``,
            `## Daily Breakdown`,
            ``,
            `| Day | Completed | Failed |`,
            `|-----|-----------|--------|`,
        ];

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (const d of dailyBreakdown) {
            const dayName = dayNames[new Date(d.date + 'T12:00:00').getDay()];
            lines.push(`| ${dayName} ${d.date} | ${d.completed} | ${d.failed} |`);
        }

        lines.push(``, `## Velocity`, ``);
        lines.push(`- This week: ${totalCompleted} tasks (prev week: ${prevWeekCount}) — trend: ${trend}`);

        lines.push(``, `## Projects`, ``);
        for (const p of projectData) {
            lines.push(`### ${p.name}`);
            lines.push(`- ${p.tasks_completed} completed, ${p.tasks_failed} failed — $${p.cost.toFixed(4)}`);
            if (p.commits.length > 0) lines.push(`- Commits: ${p.commits.join(', ')}`);
            if (p.goals_completed > 0) lines.push(`- Goals completed: ${p.goals_completed}`);
            lines.push(``);
        }

        const reportText = lines.join('\n');
        const id = generateId();

        weeklyReportStmts.insert.run(id, periodEnd, periodStart, periodEnd, reportText, JSON.stringify(reportJson), totalCompleted + totalFailed, totalCost);

        // Broadcast via WebSocket
        if (wss.clients.size > 0) {
            const msg = JSON.stringify({ type: 'weekly_report_ready', reportId: id, task_count: totalCompleted + totalFailed, total_cost: totalCost });
            wss.clients.forEach(client => {
                if (client.readyState === 1) client.send(msg);
            });
        }

        return { id, task_count: totalCompleted + totalFailed, total_cost: totalCost, report_text: reportText };
    } catch (err) {
        console.error('[WeeklyReport] Generation failed:', err.message);
        return null;
    }
}

// ── Level 11: Product Pipeline Framework ─────────────────

const PIPELINE_PHASES = ['research', 'design', 'architecture', 'build', 'test', 'document', 'deploy'];
const GATED_PHASES = ['design', 'architecture', 'build', 'deploy'];

/**
 * Create a new product pipeline. Creates the product record, 7 phase records,
 * a project directory, and kicks off the research phase.
 */
function createProduct(name, seed, config = {}) {
    const productId = generateId();
    const now = new Date().toISOString();
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const projectDir = path.join(os.homedir(), 'Projects', safeName);

    // Create product record
    productStmts.insert.run(productId, name, seed, projectDir, 'research', 'active', now, JSON.stringify(config));

    // Create 7 phase records
    for (const phase of PIPELINE_PHASES) {
        phaseStmts.insert.run(generateId(), productId, phase, 'pending');
    }

    // Create project directory with basic structure
    try {
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }
        const claudeMd = `# ${name}\n\n> Auto-generated by Claude Remote Product Pipeline\n\n## Seed\n\n${seed}\n`;
        const readmeMd = `# ${name}\n\nGenerated by Claude Remote.\n`;
        fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), claudeMd);
        fs.writeFileSync(path.join(projectDir, 'README.md'), readmeMd);
        productStmts.updatePath.run(projectDir, productId);
    } catch (err) {
        console.error(`[Pipeline] Failed to create project directory for ${name}:`, err.message);
    }

    // Register as a project in portfolio
    try {
        const existingProject = db.prepare('SELECT id FROM projects WHERE path = ?').get(projectDir);
        if (!existingProject) {
            portfolioStmts.insert.run(generateId(), safeName, projectDir, 'Product pipeline: ' + name, 'active', now);
        }
    } catch (err) {
        console.error(`[Pipeline] Failed to register project:`, err.message);
    }

    // Broadcast pipeline creation
    if (wss.clients.size > 0) {
        const msg = JSON.stringify({ type: 'pipeline_created', productId, name, phases: PIPELINE_PHASES.length });
        wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
    }

    // Kick off research phase (not gated)
    executePhase(productId, 'research');

    console.log(`[Pipeline] Created product "${name}" (${productId}), research phase started`);
    return productId;
}

/**
 * Get a summary of accumulated knowledge for a product (capped at 2000 chars).
 */
function getKnowledgeSummary(productId) {
    const entries = knowledgeStmts.getByProduct.all(productId);
    if (entries.length === 0) return '';

    let summary = 'Previous findings:\n';
    for (const entry of entries) {
        const line = `- [${entry.category}] ${entry.title}: ${entry.content}\n`;
        if (summary.length + line.length > 2000) {
            summary += '... (truncated)\n';
            break;
        }
        summary += line;
    }
    return summary;
}

/**
 * Generate focused research subagent prompts for the 6 research areas.
 */
function getResearchSubagents(productName, seed) {
    return [
        {
            area: 'market',
            title: `Market Research: ${productName}`,
            description: `Market research for ${productName}. Seed idea: ${seed}

Research objectives:
- Market size and growth trends (TAM/SAM/SOM estimates)
- Target audience demographics and pain points
- Customer willingness to pay and pricing expectations
- Revenue model opportunities (freemium, subscription, one-time, usage-based)
- Market entry barriers and timing considerations
- Geographic considerations (AU/US/EU markets)

Deliverables: market size estimates, 3-5 target customer personas, recommended revenue model with pricing ranges, go-to-market strategy recommendations.`
        },
        {
            area: 'technical',
            title: `Technical Feasibility: ${productName}`,
            description: `Technical feasibility assessment for ${productName}. Seed idea: ${seed}

Research objectives:
- Required APIs, libraries, and frameworks (availability, licensing, maturity)
- Implementation complexity per major component
- Infrastructure requirements (hosting, storage, compute, networking)
- Third-party service dependencies (payment, auth, notifications, analytics)
- Technical risks and mitigation strategies
- Development time estimates per component

Deliverables: technology assessment matrix, implementation roadmap with estimates, risk register with mitigations, proof-of-concept recommendations.`
        },
        {
            area: 'competitive',
            title: `Competitive Analysis: ${productName}`,
            description: `Competitive landscape analysis for ${productName}. Seed idea: ${seed}

Research objectives:
- Direct competitors (products solving the same problem)
- Indirect competitors (alternative approaches customers use today)
- Feature comparison matrix (what they offer, what they lack)
- Pricing analysis (monetisation models, pricing tiers)
- Market positioning (messaging, target audience, differentiators)
- Gaps and opportunities (underserved needs, emerging trends)

Deliverables: competitive matrix with 5-10 key competitors, feature gap analysis, pricing comparison, recommended positioning strategy.`
        },
        {
            area: 'practices',
            title: `Best Practices: ${productName}`,
            description: `Engineering best practices research for ${productName}. Seed idea: ${seed}

Research objectives:
- Design patterns for this problem domain (architecture, data models)
- Reference implementations and open-source examples
- Documentation and API design standards
- Performance optimisation techniques relevant to this domain
- Security best practices (authentication, authorisation, data protection)
- Testing strategies (unit, integration, E2E patterns)

Deliverables: recommended design patterns with rationale, reference repositories, security checklist, testing strategy template.`
        },
        {
            area: 'regulatory',
            title: `Regulatory Requirements: ${productName}`,
            description: `Regulatory and compliance research for ${productName}. Seed idea: ${seed}

Research objectives:
- Legal requirements by jurisdiction (AU, US, EU)
- Industry standards and certifications (ISO, SOC2, etc.)
- Data privacy laws (GDPR, CCPA, Australian Privacy Act)
- Accessibility requirements (WCAG, ADA)
- Terms of service and privacy policy considerations
- Insurance and liability considerations

Deliverables: compliance checklist by jurisdiction, required certifications with timeline, legal document requirements, risk assessment.`
        },
        {
            area: 'ux',
            title: `UX Pattern Research: ${productName}`,
            description: `UX patterns and design research for ${productName}. Seed idea: ${seed}

Research objectives:
- UI patterns for this product category (dashboards, forms, navigation)
- Design inspiration from best-in-class examples
- Interaction patterns (mobile, desktop, touch, keyboard)
- Accessibility patterns (screen readers, keyboard navigation)
- Responsive design strategies and breakpoints
- Onboarding flow examples and user activation patterns

Deliverables: UI pattern library references, recommended design system or component library, interaction flow diagrams, onboarding checklist.`
        }
    ];
}

/**
 * Generate focused design subagent prompts for the 6 design artifact areas.
 */
function getDesignSubagents(productName, seed, knowledgeSummary) {
    const ctx = knowledgeSummary ? `\n\nContext from research phase:\n${knowledgeSummary}` : '';
    return [
        {
            area: 'requirements',
            title: `Requirements: ${productName}`,
            description: `Requirements specification for ${productName}. Seed idea: ${seed}${ctx}

Deliverables:
- User stories in "As a [role], I want [feature], so that [benefit]" format (15-30 stories)
- Acceptance criteria for each story (Given/When/Then)
- Functional requirements grouped by feature area
- Non-functional requirements (performance, scalability, security, availability)
- Edge cases and error scenarios
- Priority classification (must-have, should-have, nice-to-have)
- Out-of-scope items explicitly listed`
        },
        {
            area: 'datamodel',
            title: `Data Model: ${productName}`,
            description: `Data model design for ${productName}. Seed idea: ${seed}${ctx}

Deliverables:
- Entity-relationship diagram description (entities, attributes, relationships)
- Database schema (tables, columns, types, constraints, indices)
- Data validation rules per field
- Migration plan (initial schema creation SQL)
- Seed data requirements
- Data retention and archival policy
- Estimated storage growth projections`
        },
        {
            area: 'api',
            title: `API Specification: ${productName}`,
            description: `API contract specification for ${productName}. Seed idea: ${seed}${ctx}

Deliverables:
- REST endpoint listing (method, path, description)
- Request/response schemas for each endpoint (JSON examples)
- Authentication and authorisation model (JWT, API keys, OAuth, etc.)
- Error response format and standard error codes
- Rate limiting and pagination strategy
- Webhook/event specifications if applicable
- API versioning strategy`
        },
        {
            area: 'ux',
            title: `UX Design: ${productName}`,
            description: `UX and wireframe design for ${productName}. Seed idea: ${seed}${ctx}

Deliverables:
- Page/screen inventory (list all views with purpose)
- Wireframe descriptions for each page (layout, components, content areas)
- Component hierarchy (reusable UI components)
- Navigation structure and information architecture
- Responsive breakpoints and mobile adaptation strategy
- Design system recommendations (colours, typography, spacing)
- Onboarding flow (first-time user experience)`
        },
        {
            area: 'interactions',
            title: `Interaction Design: ${productName}`,
            description: `Interaction and state design for ${productName}. Seed idea: ${seed}${ctx}

Deliverables:
- User flow diagrams (Mermaid format) for key journeys
- State management patterns (what state lives where)
- Form validation flows with error message specifications
- Loading states, empty states, and error states for each view
- Real-time update patterns (polling, WebSocket, SSE)
- Optimistic UI patterns where applicable
- Transition and animation specifications`
        },
        {
            area: 'accessibility',
            title: `Accessibility Design: ${productName}`,
            description: `Accessibility and compliance design for ${productName}. Seed idea: ${seed}${ctx}

Deliverables:
- WCAG 2.1 AA compliance checklist with implementation notes
- Keyboard navigation map (tab order, shortcuts, focus management)
- Screen reader annotations (ARIA roles, labels, live regions)
- Colour contrast verification plan
- Touch target sizing for mobile (minimum 44x44px)
- Alternative text strategy for images and media
- Reduced motion and preference-based adaptations`
        }
    ];
}

/**
 * Execute a specific phase for a product by creating a goal.
 */
function executePhase(productId, phase) {
    const product = productStmts.get.get(productId);
    if (!product) return null;

    const now = new Date().toISOString();

    // Research phase: spawn parallel subagent swarm
    if (phase === 'research') {
        try {
            const parentDesc = `Research phase for ${product.name} — orchestrate parallel research subagents and synthesise findings. Seed: ${product.seed}`;
            const parentGoalId = createGoal(parentDesc, product.project_path, false, null, 'parent');

            const areas = getResearchSubagents(product.name, product.seed);
            const childGoalIds = [];

            for (const area of areas) {
                const childGoalId = createGoal(area.description, product.project_path, true, parentGoalId, 'child');
                childGoalIds.push(childGoalId);
                console.log(`[Pipeline] Research subagent created: ${area.area} (${childGoalId})`);
            }

            phaseStmts.updateStatus.run('active', now, productId, phase);
            phaseStmts.updateGoal.run(parentGoalId, productId, phase);
            productStmts.updatePhase.run(phase, PIPELINE_PHASES.indexOf(phase), productId);

            if (wss.clients.size > 0) {
                const msg = JSON.stringify({ type: 'pipeline_phase_started', productId, phase, goalId: parentGoalId, childGoals: childGoalIds.length });
                wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
            }

            console.log(`[Pipeline] Research phase started for "${product.name}" — parent ${parentGoalId}, ${childGoalIds.length} children`);
            return parentGoalId;
        } catch (err) {
            console.error(`[Pipeline] Failed to execute research phase for ${product.name}:`, err.message);
            return null;
        }
    }

    // Design phase: spawn parallel design artifact swarm
    if (phase === 'design') {
        try {
            const knowledgeSummary = getKnowledgeSummary(productId);
            const parentDesc = `Design phase for ${product.name} — orchestrate parallel design subagents producing structured artifacts. Seed: ${product.seed}`;
            const parentGoalId = createGoal(parentDesc, product.project_path, false, null, 'parent');

            const areas = getDesignSubagents(product.name, product.seed, knowledgeSummary);
            const childGoalIds = [];

            for (const area of areas) {
                const childGoalId = createGoal(area.description, product.project_path, true, parentGoalId, 'child');
                childGoalIds.push(childGoalId);
                console.log(`[Pipeline] Design subagent created: ${area.area} (${childGoalId})`);
            }

            phaseStmts.updateStatus.run('active', now, productId, phase);
            phaseStmts.updateGoal.run(parentGoalId, productId, phase);
            productStmts.updatePhase.run(phase, PIPELINE_PHASES.indexOf(phase), productId);

            if (wss.clients.size > 0) {
                const msg = JSON.stringify({ type: 'pipeline_phase_started', productId, phase, goalId: parentGoalId, childGoals: childGoalIds.length });
                wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
            }

            console.log(`[Pipeline] Design phase started for "${product.name}" — parent ${parentGoalId}, ${childGoalIds.length} children`);
            return parentGoalId;
        } catch (err) {
            console.error(`[Pipeline] Failed to execute design phase for ${product.name}:`, err.message);
            return null;
        }
    }

    // Other phases: single goal with knowledge context
    const knowledgeSummary = getKnowledgeSummary(productId);
    const descriptions = {
        architecture: `Architecture phase for ${product.name}: select tech stack, design infrastructure, plan CI/CD. ${knowledgeSummary}`,
        build: `Build phase for ${product.name}: implement all features per the architecture. ${knowledgeSummary}`,
        test: `Test phase for ${product.name}: write and run unit tests, integration tests, verify all features. ${knowledgeSummary}`,
        document: `Document phase for ${product.name}: generate README, API docs, deployment guide, CLAUDE.md. ${knowledgeSummary}`,
        deploy: `Deploy phase for ${product.name}: containerise, set up CI/CD, configure infrastructure. ${knowledgeSummary}`,
    };

    const description = descriptions[phase] || `Phase "${phase}" for ${product.name}. ${knowledgeSummary}`;

    try {
        const goalId = createGoal(description, product.project_path, true);

        phaseStmts.updateStatus.run('active', now, productId, phase);
        phaseStmts.updateGoal.run(goalId, productId, phase);
        productStmts.updatePhase.run(phase, PIPELINE_PHASES.indexOf(phase), productId);

        if (wss.clients.size > 0) {
            const msg = JSON.stringify({ type: 'pipeline_phase_started', productId, phase, goalId });
            wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
        }

        console.log(`[Pipeline] Phase "${phase}" started for "${product.name}" (goal: ${goalId})`);
        return goalId;
    } catch (err) {
        console.error(`[Pipeline] Failed to execute phase "${phase}" for ${product.name}:`, err.message);
        return null;
    }
}

/**
 * Advance the product pipeline after a phase completes.
 * Called from updateGoalProgress() when a goal linked to a product phase completes.
 */
function advancePipeline(productId, completedPhase, goalResult) {
    const product = productStmts.get.get(productId);
    if (!product) return;

    const now = new Date().toISOString();

    // Mark phase as completed
    const goal = goalResult || {};
    phaseStmts.complete.run('completed', now, goal.cost_usd || 0, JSON.stringify(goal.artifacts || []), productId, completedPhase);

    // Update product cost
    const phases = phaseStmts.getByProduct.all(productId);
    const totalCost = phases.reduce((sum, p) => sum + (p.cost_usd || 0), 0);
    productStmts.updateCost.run(totalCost, productId);

    // Extract knowledge from goal results
    if (goal.result_summary || goal.description) {
        try {
            knowledgeStmts.insert.run(
                productId, completedPhase,
                `${completedPhase} phase results`,
                goal.result_summary || `Completed: ${goal.description || completedPhase}`,
                completedPhase, now
            );
        } catch (err) {
            console.error(`[Pipeline] Failed to store knowledge:`, err.message);
        }
    }

    // Find next phase
    const currentIndex = PIPELINE_PHASES.indexOf(completedPhase);
    if (currentIndex >= PIPELINE_PHASES.length - 1) {
        // All phases complete
        productStmts.updateStatus.run('completed', now, productId);
        if (wss.clients.size > 0) {
            const msg = JSON.stringify({ type: 'pipeline_completed', productId, name: product.name });
            wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
        }
        const config = loadConfig();
        if (config.ntfy_topic) {
            try {
                execFileSync('curl', ['-s', '-d', `Product "${product.name}" pipeline completed!`, '-H', 'Title: Pipeline Complete', '-H', 'Priority: high', '-H', 'Tags: rocket', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
            } catch {}
        }
        console.log(`[Pipeline] Product "${product.name}" completed all phases`);
        return;
    }

    const nextPhase = PIPELINE_PHASES[currentIndex + 1];

    if (GATED_PHASES.includes(nextPhase)) {
        // Gate: wait for approval
        phaseStmts.updateGate.run('pending', null, null, productId, nextPhase);
        if (wss.clients.size > 0) {
            const msg = JSON.stringify({ type: 'pipeline_gate_pending', productId, name: product.name, phase: nextPhase, completedPhase });
            wss.clients.forEach(client => { if (client.readyState === 1) client.send(msg); });
        }
        const config = loadConfig();
        if (config.ntfy_topic) {
            try {
                execFileSync('curl', ['-s', '-d', `Phase "${completedPhase}" complete for ${product.name}. Approve "${nextPhase}" to continue.`, '-H', 'Title: Pipeline Gate', '-H', 'Priority: default', '-H', 'Tags: traffic_light', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
            } catch {}
        }
        console.log(`[Pipeline] Gate pending for "${nextPhase}" on "${product.name}"`);
    } else {
        // No gate — auto-advance
        executePhase(productId, nextPhase);
    }
}

/**
 * Read project context files (CLAUDE.md, CURRENT_STATUS.md, README.md)
 */
function readProjectContext(projectPath) {
    const files = ['CLAUDE.md', 'CURRENT_STATUS.md', 'README.md'];
    let context = '';

    for (const file of files) {
        const filepath = path.join(projectPath, file);
        if (fs.existsSync(filepath)) {
            try {
                const content = fs.readFileSync(filepath, 'utf8');
                context += `\n## ${file}\n\n${content.slice(0, 5000)}\n`;
            } catch {
                // Skip unreadable files
            }
        }
    }

    return context || 'No project context files found.';
}

// ── Level 10: Context injection helpers ──────────────────

function readFileOrEmpty(filepath, maxChars = 5000) {
    try {
        if (!fs.existsSync(filepath)) return '';
        return fs.readFileSync(filepath, 'utf8').slice(0, maxChars);
    } catch { return ''; }
}

function extractSettledDecisions(markdown) {
    if (!markdown) return [];
    const sections = markdown.split(/(?=### DEC-)/);
    return sections.filter(s =>
        /\*\*Status\*\*:\s*Settled/i.test(s)
    ).map(s => s.trim());
}

function detectProjectTechStack(projectPath) {
    const techSet = new Set();
    const depMap = {
        'express': ['Express', 'Node.js'],
        'better-sqlite3': ['SQLite'],
        'bun:sqlite': ['SQLite', 'Bun'],
        '@anthropic-ai/claude-agent-sdk': ['Claude Agent SDK'],
        'react': ['React'],
        'react-dom': ['React'],
        'drizzle-orm': ['Drizzle ORM'],
        'ws': ['WebSocket'],
        'hono': ['Bun'],
        'elysia': ['Bun'],
    };
    const pkgPaths = [
        path.join(projectPath, 'package.json'),
        path.join(projectPath, 'src', 'server', 'package.json'),
    ];
    for (const pkgPath of pkgPaths) {
        try {
            if (!fs.existsSync(pkgPath)) continue;
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            techSet.add('JavaScript');
            for (const dep of Object.keys(allDeps)) {
                if (depMap[dep]) depMap[dep].forEach(t => techSet.add(t));
                if (dep.startsWith('@tanstack/')) techSet.add('TanStack');
                if (dep.startsWith('@cloudflare/')) techSet.add('Cloudflare Workers');
            }
            if (pkg.engines?.bun) techSet.add('Bun');
        } catch { /* skip */ }
    }
    const claudeMd = readFileOrEmpty(path.join(projectPath, 'CLAUDE.md'), 2000);
    const stackMatch = claudeMd.match(/\*\*Stack\*\*:\s*(.+)/);
    if (stackMatch) {
        stackMatch[1].split(/\s*\+\s*/).forEach(t => techSet.add(t.trim()));
    }
    return [...techSet];
}

function getRelevantLearnings(techStack) {
    if (!techStack.length) return [];
    const indexPath = path.join(os.homedir(), 'Projects', '_learnings', 'INDEX.md');
    const indexContent = readFileOrEmpty(indexPath, 10000);
    if (!indexContent) return [];

    const techSectionMatch = indexContent.match(/## Index by Tech Stack\s*\n([\s\S]*?)(?=\n## |$)/);
    if (!techSectionMatch) return [];

    const techSection = techSectionMatch[1];
    const learnings = [];
    const hasJs = techStack.some(t => /javascript|typescript|node|express|react|bun/i.test(t));
    const categories = techSection.split(/(?=### )/);

    for (const category of categories) {
        const headerMatch = category.match(/^### (.+)/);
        if (!headerMatch) continue;
        const categoryName = headerMatch[1].trim();
        const isMatch = techStack.some(tech =>
            categoryName.toLowerCase().includes(tech.toLowerCase()) ||
            tech.toLowerCase().includes(categoryName.toLowerCase().split(' / ')[0])
        ) || (hasJs && /javascript|typescript/i.test(categoryName));
        if (!isMatch) continue;

        const entryRegex = /- \*\*(L\d+)\*\* \((\w+)\): (.+)/g;
        let match;
        while ((match = entryRegex.exec(category)) !== null) {
            const [, id, severity, summary] = match;
            if (severity === 'LOW') continue;
            let content = null;
            if (severity === 'HIGH') {
                const idTableMatch = indexContent.match(new RegExp(`\\| ${id} \\| \\w+ \\| \\[.+?\\]\\((.+?)\\)`));
                if (idTableMatch) {
                    const learningPath = path.join(os.homedir(), 'Projects', '_learnings', idTableMatch[1]);
                    content = readFileOrEmpty(learningPath, 500);
                }
            }
            learnings.push({ id, severity, summary, content });
        }
    }

    const seen = new Set();
    return learnings.filter(l => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
    }).slice(0, 5);
}

/**
 * Get recent failure patterns for a project from project_memory.
 * Deduplicates by normalised error text, returns top 5 by frequency.
 */
function getRecentFailures(projectPath) {
    try {
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        const failures = db.prepare(
            'SELECT error_summary, model_used, task_type, created_at FROM project_memory WHERE project_path = ? AND success = 0 AND error_summary IS NOT NULL AND created_at > ? ORDER BY created_at DESC'
        ).all(projectPath, cutoff);

        if (!failures.length) return [];

        const patterns = {};
        for (const f of failures) {
            const normalised = f.error_summary.slice(0, 100).toLowerCase()
                .replace(/[0-9a-f]{6,}/g, '...')
                .replace(/\d+/g, 'N')
                .trim();
            if (!patterns[normalised]) {
                patterns[normalised] = { error: f.error_summary.slice(0, 200), count: 0, lastSeen: f.created_at, models: new Set() };
            }
            patterns[normalised].count++;
            patterns[normalised].models.add(f.model_used);
        }

        return Object.values(patterns)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(p => ({ ...p, models: [...p.models] }));
    } catch { return []; }
}

function getEcosystemSummary() {
    try {
        const projects = portfolioStmts.list.all();
        if (!projects.length) return '';
        const allStats = getAllProjectStats();
        return projects.map(p => {
            // Port summary — show web/api ports only for brevity
            let portTag = '';
            if (p.ports) {
                try {
                    const ports = typeof p.ports === 'string' ? JSON.parse(p.ports) : p.ports;
                    const portParts = [];
                    for (const [key, val] of Object.entries(ports)) {
                        const shortKey = key.replace(/.*\./, '').replace(/_port$/, '');
                        if (['web', 'api', 'port'].includes(shortKey)) {
                            portParts.push(`${shortKey}:${val}`);
                        }
                    }
                    if (portParts.length) portTag = ` [${portParts.join(', ')}]`;
                } catch {}
            }
            // Task queue state
            const stats = allStats[p.path] || {};
            const queueParts = [];
            if (stats.tasks_running) queueParts.push(`${stats.tasks_running} running`);
            if (stats.tasks_pending) queueParts.push(`${stats.tasks_pending} pending`);
            if (stats.tasks_completed) queueParts.push(`${stats.tasks_completed} done`);
            const queueTag = queueParts.length ? ` (${queueParts.join(', ')})` : '';
            // Flags
            let flags = '';
            if (p.throttled) flags += ' [THROTTLED]';
            if (p.priority !== 5) flags += ` [priority: ${p.priority}]`;
            const desc = (p.description || '').slice(0, 60);
            return `- **${p.name}** (${p.lifecycle})${portTag}${queueTag}: ${desc}${flags}`;
        }).join('\n');
    } catch { return ''; }
}

/**
 * Parse key: value fields from a structured marker block.
 */
function parseMarkerFields(block) {
    const fields = {};
    let currentKey = null;
    for (const line of block.split('\n')) {
        const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1].toLowerCase();
            fields[currentKey] = kvMatch[2].trim();
        } else if (currentKey && line.trim()) {
            fields[currentKey] += ' ' + line.trim();
        }
    }
    return fields;
}

/**
 * Extract [LEARNING]...[/LEARNING] blocks from task result text.
 */
function extractProposedLearnings(resultText) {
    if (!resultText) return [];
    const blocks = [];
    const regex = /\[LEARNING\]\s*\n([\s\S]*?)\[\/LEARNING\]/g;
    let match;
    while ((match = regex.exec(resultText)) !== null) {
        const fields = parseMarkerFields(match[1]);
        if (fields.problem && fields.solution) {
            blocks.push({
                severity: (fields.severity || 'MEDIUM').toUpperCase(),
                tech: fields.tech || '',
                problem: fields.problem,
                root_cause: fields.root_cause || '',
                solution: fields.solution,
                raw: match[0]
            });
        }
    }
    return blocks;
}

/**
 * Extract [DECISION]...[/DECISION] blocks from task result text.
 */
function extractProposedDecisions(resultText) {
    if (!resultText) return [];
    const blocks = [];
    const regex = /\[DECISION\]\s*\n([\s\S]*?)\[\/DECISION\]/g;
    let match;
    while ((match = regex.exec(resultText)) !== null) {
        const fields = parseMarkerFields(match[1]);
        if (fields.title && fields.decision) {
            blocks.push({
                title: fields.title,
                context: fields.context || '',
                options: fields.options || '',
                decision: fields.decision,
                consequences: fields.consequences || '',
                raw: match[0]
            });
        }
    }
    return blocks;
}

/**
 * Map tech stack to a learning category directory name.
 */
function determineLearningCategory(techList) {
    const categoryMap = {
        'javascript': 'javascript', 'typescript': 'javascript', 'node.js': 'javascript',
        'react': 'javascript', 'express': 'javascript',
        'cloudflare': 'cloudflare', 'workers': 'cloudflare', 'd1': 'cloudflare',
        'drizzle': 'drizzle', 'drizzle orm': 'drizzle',
        'tanstack': 'tanstack', 'bun': 'bun', 'sqlite': 'javascript',
        'claude agent sdk': 'claude-agent-sdk',
    };
    for (const tech of techList) {
        const key = tech.toLowerCase();
        if (categoryMap[key]) return categoryMap[key];
    }
    return techList[0]
        ? techList[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : 'general';
}

/**
 * Write an approved learning to ~/Projects/_learnings/ and update INDEX.md.
 */
function writeLearning(data, projectPath) {
    const learningsDir = path.join(os.homedir(), 'Projects', '_learnings');
    const indexPath = path.join(learningsDir, 'INDEX.md');
    const indexContent = readFileOrEmpty(indexPath, 50000);

    // Calculate next learning ID
    const idMatches = [...indexContent.matchAll(/\bL(\d+)\b/g)];
    const maxNum = idMatches.reduce((max, m) => Math.max(max, parseInt(m[1], 10)), 0);
    const nextId = `L${String(maxNum + 1).padStart(3, '0')}`;

    // Determine category directory
    const techList = data.tech.split(',').map(t => t.trim()).filter(Boolean);
    const category = determineLearningCategory(techList);
    const categoryDir = path.join(learningsDir, category);
    if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });

    // Create filename
    const safeName = data.problem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const filePath = path.join(categoryDir, `${safeName}.md`);
    const relPath = `${category}/${safeName}.md`;
    const projectName = path.basename(projectPath);
    const today = new Date().toISOString().slice(0, 10);

    // Write learning file
    const content = `# ${nextId}: ${data.problem.slice(0, 80)}

**Severity:** ${data.severity}
**Tech Stack:** ${data.tech}
**Discovered:** ${today} in ${projectName} (automated task)

## Problem

${data.problem}

## Root Cause

${data.root_cause || 'Not identified'}

## Solution

${data.solution}

## References

- Captured automatically by Claude Remote automator
`;
    fs.writeFileSync(filePath, content);

    // Update INDEX.md — add to "Index by ID" table
    let updated = indexContent;
    const idTableEnd = updated.match(/(\| L\d+ \|[^\n]+\n)(\n---)/);
    if (idTableEnd) {
        const newRow = `| ${nextId} | ${data.severity} | [${relPath}](${relPath}) | ${data.problem.slice(0, 80)} |\n`;
        updated = updated.replace(idTableEnd[0], idTableEnd[1] + newRow + idTableEnd[2]);
    }

    // Add to "Index by Tech Stack" section
    for (const tech of techList) {
        const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sectionRegex = new RegExp(`(### [^\\n]*${escaped}[^\\n]*\\n)`, 'i');
        const sectionMatch = updated.match(sectionRegex);
        if (sectionMatch) {
            const afterHeader = updated.indexOf(sectionMatch[0]) + sectionMatch[0].length;
            const rest = updated.slice(afterHeader);
            const nextHeading = rest.search(/\n###? /);
            const insertAt = nextHeading >= 0 ? afterHeader + nextHeading : afterHeader + rest.length;
            const entry = `- **${nextId}** (${data.severity}): ${data.problem.slice(0, 80)}\n`;
            updated = updated.slice(0, insertAt) + entry + updated.slice(insertAt);
            break;
        }
    }

    fs.writeFileSync(indexPath, updated);
    console.log(`[Proposals] Learning ${nextId} written to ${filePath}`);
    return filePath;
}

/**
 * Append an approved decision to the project's DECISIONS.md.
 */
function writeDecision(data, projectPath) {
    const decisionsPath = path.join(projectPath, 'claude-context', 'DECISIONS.md');
    const content = readFileOrEmpty(decisionsPath, 100000);

    // Calculate next DEC number
    const decMatches = [...content.matchAll(/DEC-(\d+)/g)];
    const maxDec = decMatches.reduce((max, m) => Math.max(max, parseInt(m[1], 10)), 0);
    const nextNum = String(maxDec + 1).padStart(3, '0');
    const decId = `DEC-${nextNum}`;
    const today = new Date().toISOString().slice(0, 10);

    // Build decision entry
    const entry = `\n### ${decId}: ${data.title}

**Date**: ${today}
**Author**: Claude Remote (automated)
**Status**: Accepted

#### Context

${data.context}

#### Options Considered

${data.options}

#### Decision

${data.decision}

#### Consequences

${data.consequences}

---
`;

    let updated = content;

    // Add to Decision Index table
    const indexRow = `| ${decId} | ${data.title} | Accepted | ${today} |`;
    const indexTableEnd = updated.match(/(\| DEC-\d+ \|[^\n]+\n)(\n---)/);
    if (indexTableEnd) {
        updated = updated.replace(indexTableEnd[0], indexTableEnd[1] + indexRow + '\n' + indexTableEnd[2]);
    }

    // Insert entry before "## Template" section
    const templateIdx = updated.indexOf('## Template');
    if (templateIdx >= 0) {
        updated = updated.slice(0, templateIdx) + entry + '\n' + updated.slice(templateIdx);
    } else {
        updated += entry;
    }

    fs.writeFileSync(decisionsPath, updated);
    console.log(`[Proposals] Decision ${decId} written to ${decisionsPath}`);
    return decisionsPath;
}

/**
 * Extract and store knowledge proposals from task result text.
 */
function extractAndStoreProposals(taskId, resultText, projectPath) {
    const learnings = extractProposedLearnings(resultText);
    const decisions = extractProposedDecisions(resultText);
    const now = new Date().toISOString();

    for (const l of learnings) {
        const id = generateId();
        proposalStmts.insert.run(
            id, taskId, projectPath, 'learning', 'pending',
            l.problem.slice(0, 100), l.raw, JSON.stringify(l), now
        );
        console.log(`[Proposals] Learning extracted from task ${taskId}: ${l.problem.slice(0, 60)}`);
    }

    for (const d of decisions) {
        const id = generateId();
        proposalStmts.insert.run(
            id, taskId, projectPath, 'decision', 'pending',
            d.title, d.raw, JSON.stringify(d), now
        );
        console.log(`[Proposals] Decision extracted from task ${taskId}: ${d.title}`);
    }

    const total = learnings.length + decisions.length;
    if (total > 0) broadcastProposalUpdate(total);
    return total;
}

/**
 * Broadcast new proposals notification to WebSocket clients.
 */
function broadcastProposalUpdate(count) {
    if (wss.clients.size === 0) return;
    const message = JSON.stringify({ type: 'proposals_new', count });
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(message);
    });
}

function buildTaskContext(projectPath, goalContext) {
    const parts = [];

    parts.push(`## Autonomous Agent Context

You are an autonomous agent in Darron's development ecosystem.
- **Author:** Darron — Mackay, Queensland, Australia (UTC+10)
- **Conventions:** British English spelling, semantic commits (feat:, fix:, docs:, refactor:)
- **Execution mode:** Running via Claude Agent SDK — no human in the loop
- **Git:** Changes committed automatically on success, rolled back on failure
- Do NOT use plan mode (EnterPlanMode) — implement directly`);

    const claudeMd = readFileOrEmpty(path.join(projectPath, 'CLAUDE.md'), 3000);
    if (claudeMd) parts.push(`\n## Project Instructions\n\n${claudeMd}`);

    const status = readFileOrEmpty(path.join(projectPath, 'claude-context', 'CURRENT_STATUS.md'), 3000);
    if (status) parts.push(`\n## Current Project Status\n\n${status}`);

    const decisionsRaw = readFileOrEmpty(path.join(projectPath, 'claude-context', 'DECISIONS.md'), 8000);
    const settled = extractSettledDecisions(decisionsRaw);
    if (settled.length > 0) {
        const decisionsText = settled.slice(0, 5).join('\n\n---\n\n').slice(0, 2000);
        parts.push(`\n## Settled Architecture Decisions\n\nThese decisions are FINAL. Do NOT change without explicit user discussion.\n\n${decisionsText}`);
    }

    const techStack = detectProjectTechStack(projectPath);
    const learnings = getRelevantLearnings(techStack);
    if (learnings.length > 0) {
        let learningsText = '\n## Critical Cross-Project Learnings\n\n';
        for (const l of learnings) {
            if (l.severity === 'HIGH' && l.content) {
                learningsText += `### ${l.id} (HIGH): ${l.summary}\n\n${l.content}\n\n`;
            } else {
                learningsText += `- **${l.id}** (${l.severity}): ${l.summary}\n`;
            }
        }
        parts.push(learningsText);
    }

    const failures = getRecentFailures(projectPath);
    if (failures.length > 0) {
        let pitfallsText = '\n## Known Pitfalls (Recent Failures)\n\nPrevious tasks on this project hit these errors. Avoid repeating them:\n';
        for (const f of failures) {
            pitfallsText += `- **${f.error.slice(0, 120)}** (${f.count}x, last: ${f.lastSeen.slice(0, 10)})\n`;
        }
        parts.push(pitfallsText);
    }

    const ecosystem = getEcosystemSummary();
    if (ecosystem) parts.push(`\n## Development Ecosystem\n\nSister projects in this ecosystem:\n${ecosystem}\n\nNote: Tasks can depend on task IDs from any project/goal via \`depends_on\`. Port numbers shown above are allocated centrally — avoid conflicts when configuring services.`);

    if (goalContext) parts.push(`\n## Goal Context\n\nThis task is part of a larger goal:\n${goalContext.slice(0, 1000)}`);

    parts.push(`\n## Knowledge Capture

If you encounter something worth capturing during this task, output structured markers in your final response:

For reusable lessons (bugs, gotchas, patterns):
[LEARNING]
severity: HIGH|MEDIUM|LOW
tech: Comma, Separated, Technologies
problem: What went wrong or was confusing
root_cause: Why it happened
solution: How to fix or avoid it
[/LEARNING]

For architecture/design choices:
[DECISION]
title: Short decision title
context: What prompted this choice
options: Brief options considered
decision: What was chosen and why
consequences: What this means going forward
[/DECISION]

Only flag genuinely reusable cross-project insights — not routine implementation steps.`);

    return parts.join('\n');
}

// ── Task queue endpoints ──────────────────────────────────

const taskStmts = {
    list: db.prepare('SELECT * FROM tasks ORDER BY CASE status WHEN \'running\' THEN 0 WHEN \'pending\' THEN 1 ELSE 2 END, priority DESC, created_at DESC'),
    listByStatus: db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at DESC'),
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    insert: db.prepare('INSERT INTO tasks (id, title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, created_at, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    insertWithGoal: db.prepare('INSERT INTO tasks (id, title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, created_at, goal_id, complexity, depends_on, auto_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateStatus: db.prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?'),
    updateCheckpoint: db.prepare('UPDATE tasks SET checkpoint_ref = ?, checkpoint_type = ?, checkpoint_created_at = ? WHERE id = ?'),
    updateLogFile: db.prepare('UPDATE tasks SET log_file = ? WHERE id = ?'),
    complete: db.prepare('UPDATE tasks SET status = ?, completed_at = ?, result = ?, cost_usd = ?, tokens_in = ?, tokens_out = ?, turns = ? WHERE id = ?'),
    fail: db.prepare('UPDATE tasks SET status = ?, completed_at = ?, error = ? WHERE id = ?'),
    cancel: db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM tasks WHERE id = ?'),
    nextPending: db.prepare('SELECT * FROM tasks WHERE status = \'pending\' ORDER BY priority DESC, created_at ASC LIMIT 1'),
    getByGoal: db.prepare('SELECT * FROM tasks WHERE goal_id = ? ORDER BY priority DESC, created_at ASC'),
    updateCommitInfo: db.prepare('UPDATE tasks SET commit_sha = ?, files_changed = ? WHERE id = ?'),
};

const goalStmts = {
    list: db.prepare('SELECT * FROM goals ORDER BY created_at DESC'),
    get: db.prepare('SELECT * FROM goals WHERE id = ?'),
    insert: db.prepare('INSERT INTO goals (id, description, project_path, status, created_at, orchestrator_backend, orchestrator_model, parent_goal_id, goal_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateStatus: db.prepare('UPDATE goals SET status = ? WHERE id = ?'),
    updateProgress: db.prepare('UPDATE goals SET tasks_completed = ?, tasks_failed = ?, total_cost_usd = ?, status = ?, completed_at = ? WHERE id = ?'),
    updateDecomposition: db.prepare('UPDATE goals SET decomposition = ?, task_count = ?, status = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM goals WHERE id = ?'),
    updateSummaryFile: db.prepare('UPDATE goals SET summary_file = ? WHERE id = ?'),
    getChildren: db.prepare('SELECT * FROM goals WHERE parent_goal_id = ? ORDER BY created_at ASC'),
};

const memoryStmts = {
    insert: db.prepare('INSERT INTO project_memory (project_path, task_type, model_used, success, cost_usd, turns, duration_seconds, error_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    getByProject: db.prepare('SELECT * FROM project_memory WHERE project_path = ? ORDER BY created_at DESC LIMIT 100'),
    getAll: db.prepare('SELECT * FROM project_memory ORDER BY created_at DESC'),
};

const portfolioStmts = {
    upsert: db.prepare('INSERT INTO projects (name, description, path, lifecycle, ports, last_synced_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, path = excluded.path, lifecycle = excluded.lifecycle, ports = excluded.ports, last_synced_at = excluded.last_synced_at'),
    list: db.prepare('SELECT * FROM projects ORDER BY priority DESC, name ASC'),
    get: db.prepare('SELECT * FROM projects WHERE name = ?'),
    getByPath: db.prepare('SELECT * FROM projects WHERE path = ?'),
    updatePriority: db.prepare('UPDATE projects SET priority = ? WHERE name = ?'),
    updateBudget: db.prepare('UPDATE projects SET cost_budget_daily = ?, cost_budget_total = ? WHERE name = ?'),
    updateCosts: db.prepare('UPDATE projects SET cost_spent_today = ?, cost_spent_total = ?, budget_reset_date = ?, throttled = ? WHERE name = ?'),
    unthrottle: db.prepare('UPDATE projects SET throttled = 0 WHERE name = ?'),
};

const proposalStmts = {
    insert: db.prepare('INSERT INTO task_proposals (id, task_id, project_path, type, status, title, raw_block, parsed_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    list: db.prepare('SELECT * FROM task_proposals ORDER BY created_at DESC'),
    listByStatus: db.prepare('SELECT * FROM task_proposals WHERE status = ? ORDER BY created_at DESC'),
    get: db.prepare('SELECT * FROM task_proposals WHERE id = ?'),
    updateStatus: db.prepare('UPDATE task_proposals SET status = ?, reviewed_at = ?, written_to = ? WHERE id = ?'),
    getByTask: db.prepare('SELECT * FROM task_proposals WHERE task_id = ?'),
};

const digestStmts = {
    insert: db.prepare('INSERT INTO digests (id, generated_at, period_start, period_end, digest_text, digest_json, task_count, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getLatest: db.prepare('SELECT * FROM digests ORDER BY generated_at DESC LIMIT 1'),
    getById: db.prepare('SELECT * FROM digests WHERE id = ?'),
    list: db.prepare('SELECT id, generated_at, period_start, period_end, task_count, total_cost, viewed_at FROM digests ORDER BY generated_at DESC LIMIT 30'),
    markViewed: db.prepare('UPDATE digests SET viewed_at = ? WHERE id = ?'),
};

const maintenanceStmts = {
    insert: db.prepare('INSERT INTO maintenance_runs (id, started_at, completed_at, status, projects_count, goals_created, summary) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    getLatest: db.prepare('SELECT * FROM maintenance_runs ORDER BY started_at DESC LIMIT 1'),
    list: db.prepare('SELECT * FROM maintenance_runs ORDER BY started_at DESC LIMIT 30'),
    complete: db.prepare('UPDATE maintenance_runs SET completed_at = ?, status = ?, summary = ? WHERE id = ?'),
};

const weeklyReportStmts = {
    insert: db.prepare('INSERT INTO weekly_reports (id, generated_at, week_start, week_end, report_text, report_json, task_count, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getLatest: db.prepare('SELECT * FROM weekly_reports ORDER BY generated_at DESC LIMIT 1'),
    getById: db.prepare('SELECT * FROM weekly_reports WHERE id = ?'),
    list: db.prepare('SELECT id, generated_at, week_start, week_end, task_count, total_cost, viewed_at FROM weekly_reports ORDER BY generated_at DESC LIMIT 20'),
    markViewed: db.prepare('UPDATE weekly_reports SET viewed_at = ? WHERE id = ?'),
};

const productStmts = {
    insert: db.prepare('INSERT INTO products (id, name, seed, project_path, current_phase, status, created_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    list: db.prepare('SELECT * FROM products ORDER BY created_at DESC'),
    get: db.prepare('SELECT * FROM products WHERE id = ?'),
    updatePhase: db.prepare('UPDATE products SET current_phase = ?, phases_completed = ? WHERE id = ?'),
    updateStatus: db.prepare('UPDATE products SET status = ?, completed_at = ? WHERE id = ?'),
    updateCost: db.prepare('UPDATE products SET total_cost_usd = ? WHERE id = ?'),
    updatePath: db.prepare('UPDATE products SET project_path = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM products WHERE id = ?'),
};

const phaseStmts = {
    insert: db.prepare('INSERT INTO product_phases (id, product_id, phase, status) VALUES (?, ?, ?, ?)'),
    getByProduct: db.prepare('SELECT * FROM product_phases WHERE product_id = ? ORDER BY CASE phase WHEN \'research\' THEN 0 WHEN \'design\' THEN 1 WHEN \'architecture\' THEN 2 WHEN \'build\' THEN 3 WHEN \'test\' THEN 4 WHEN \'document\' THEN 5 WHEN \'deploy\' THEN 6 END'),
    get: db.prepare('SELECT * FROM product_phases WHERE product_id = ? AND phase = ?'),
    updateStatus: db.prepare('UPDATE product_phases SET status = ?, started_at = ? WHERE product_id = ? AND phase = ?'),
    updateGoal: db.prepare('UPDATE product_phases SET goal_id = ? WHERE product_id = ? AND phase = ?'),
    complete: db.prepare('UPDATE product_phases SET status = ?, completed_at = ?, cost_usd = ?, artifacts = ? WHERE product_id = ? AND phase = ?'),
    updateGate: db.prepare('UPDATE product_phases SET gate_status = ?, gate_approved_at = ?, notes = ? WHERE product_id = ? AND phase = ?'),
};

const knowledgeStmts = {
    insert: db.prepare('INSERT INTO product_knowledge (product_id, category, title, content, source_phase, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    getByProduct: db.prepare('SELECT * FROM product_knowledge WHERE product_id = ? ORDER BY created_at ASC'),
    getByCategory: db.prepare('SELECT * FROM product_knowledge WHERE product_id = ? AND category = ? ORDER BY created_at ASC'),
};

syncRegistry();

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
        const { title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, deadline } = req.body;

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
            priority || 0, model || 'sonnet', max_turns || 100, finalGateMode, allowedToolsJson, now, deadline || null);

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
 * Get next pending task with dependency-aware ordering
 */
// Track last child goal that executed a task (round-robin fairness for research swarm)
const lastExecutedChildGoal = new Map();

function getNextPendingTask() {
    const pending = taskStmts.listByStatus.all('pending');
    if (pending.length === 0) return null;

    // Filter out tasks with unsatisfied dependencies
    const ready = pending.filter(task => {
        if (!task.depends_on) return true;
        try {
            const depIds = JSON.parse(task.depends_on);
            if (!Array.isArray(depIds) || depIds.length === 0) return true;
            return depIds.every(id => {
                const dep = taskStmts.get.get(id);
                return dep && dep.status === 'done';
            });
        } catch { return true; }
    });

    if (ready.length === 0) return null;

    // Filter out tasks from throttled projects (Phase 2)
    const unthrottled = ready.filter(task => {
        const project = portfolioStmts.getByPath.get(task.project_path);
        return !project || !project.throttled;
    });

    const candidates = unthrottled.length > 0 ? unthrottled : ready;

    // Round-robin across child goals for research swarm fairness
    try {
        const childTasks = [];
        for (const task of candidates) {
            if (!task.goal_id) continue;
            const goal = goalStmts.get.get(task.goal_id);
            if (goal && goal.goal_type === 'child' && goal.parent_goal_id) {
                childTasks.push({ task, childGoalId: goal.id, parentGoalId: goal.parent_goal_id });
            }
        }

        if (childTasks.length > 0) {
            // Group by parent
            const byParent = {};
            for (const ct of childTasks) {
                if (!byParent[ct.parentGoalId]) byParent[ct.parentGoalId] = [];
                byParent[ct.parentGoalId].push(ct);
            }

            for (const [parentId, tasks] of Object.entries(byParent)) {
                if (tasks.length > 1) {
                    // Multiple children have ready tasks — round-robin
                    const uniqueChildren = [...new Set(tasks.map(t => t.childGoalId))];
                    if (uniqueChildren.length > 1) {
                        const lastChild = lastExecutedChildGoal.get(parentId);
                        const sorted = uniqueChildren.sort();
                        let nextIndex = 0;
                        if (lastChild) {
                            const lastIndex = sorted.indexOf(lastChild);
                            if (lastIndex >= 0) nextIndex = (lastIndex + 1) % sorted.length;
                        }
                        const chosenChildId = sorted[nextIndex];
                        lastExecutedChildGoal.set(parentId, chosenChildId);
                        const chosen = tasks.find(t => t.childGoalId === chosenChildId);
                        if (chosen) return chosen.task;
                    }
                }
            }

            // Single child or single parent — just return the first child task
            return childTasks[0].task;
        }
    } catch (err) {
        console.error('[Scheduler] Round-robin error:', err.message);
    }

    // Score and sort by priority engine
    const scored = candidates.map(task => {
        const project = portfolioStmts.getByPath.get(task.project_path);
        return { task, score: calculatePriorityScore(task, project) };
    });
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.task || null;
}

/**
 * Run the next pending task from the queue
 */
async function runNextTask() {
    if (runningTaskId) return; // Already running a task

    const task = getNextPendingTask();
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

    let resultText = '';  // Hoisted for access in catch block (failure learnings extraction)

    try {
        // Build clean env without CLAUDECODE (prevents nested session detection)
        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        // Build ecosystem-aware context (Level 10)
        let goalContext = null;
        if (task.goal_id) {
            const goal = goalStmts.get.get(task.goal_id);
            if (goal) goalContext = `Goal: ${goal.description}`;
        }
        const taskContext = buildTaskContext(task.project_path, goalContext);
        console.log(`[Task] Context injected: ${taskContext.length} chars (~${Math.ceil(taskContext.length / 4)} tokens)`);

        const taskPrompt = task.description;

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
            canUseTool: await createCanUseToolCallback(task.id, task.gate_mode || 'bypass'),
            systemPrompt: {
                type: 'preset',
                preset: 'claude_code',
                append: taskContext
            }
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
        resultText = '';

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

                // Record outcome in project memory (once per task)
                recordTaskOutcome(taskStmts.get.get(task.id));

                // Commit changes and clean up checkpoint on success
                // (Must run before updateGoalProgress so summary has commit SHAs)
                if (isSuccess) {
                    const updatedTask = taskStmts.get.get(task.id);
                    const commitResult = commitTaskChanges(task.project_path, updatedTask || task);
                    if (commitResult.committed && commitResult.sha) {
                        taskStmts.updateCommitInfo.run(
                            commitResult.sha,
                            JSON.stringify(commitResult.filesChanged),
                            task.id
                        );
                    }
                    if (checkpointRef && checkpointType !== 'none') {
                        cleanupCheckpoint(task.project_path, checkpointRef, checkpointType);
                    }

                    // Extract knowledge proposals from result (Level 10C)
                    try {
                        extractAndStoreProposals(task.id, resultText, task.project_path);
                    } catch (err) {
                        console.error(`[Proposals] Extraction failed for task ${task.id}:`, err.message);
                    }
                }

                // Recalculate project costs (Phase 2)
                recalcProjectCosts(task.project_path);

                // Update goal progress (may trigger summary generation)
                if (task.goal_id) {
                    updateGoalProgress(task.goal_id);
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

        // Record outcome in project memory (once per task)
        recordTaskOutcome(taskStmts.get.get(task.id));

        // Extract knowledge proposals from failed task results too (Phase F)
        if (resultText) {
            try {
                extractAndStoreProposals(task.id, resultText, task.project_path);
            } catch (propErr) {
                console.error(`[Proposals] Extraction failed for task ${task.id}:`, propErr.message);
            }
        }

        // Update goal progress and recalculate costs
        if (task.goal_id) {
            updateGoalProgress(task.goal_id);
        }
        recalcProjectCosts(task.project_path);

        // Orchestrator retry logic
        const retryCount = task.retry_count || 0;
        const maxRetries = task.max_retries || 3;

        if (retryCount < maxRetries && task.goal_id) {
            console.log(`[Orchestrator] Analysing failure for retry (attempt ${retryCount + 1}/${maxRetries})...`);

            try {
                const recovery = await orchestrator.analyseFailure(task, err.message, retryCount + 1);

                if (recovery.shouldRetry) {
                    const retryId = generateId();
                    const now = new Date().toISOString();
                    const retryTitle = `${task.title} (retry ${retryCount + 1})`;
                    const retryDescription = recovery.adjustedDescription || task.description;
                    const retryModel = recovery.adjustedModel || task.model;

                    // Create retry task
                    taskStmts.insertWithGoal.run(
                        retryId,
                        retryTitle,
                        retryDescription,
                        task.project_path,
                        task.priority + 1, // Bump priority
                        retryModel,
                        task.max_turns,
                        task.gate_mode,
                        task.allowed_tools,
                        now,
                        task.goal_id,
                        task.complexity,
                        task.depends_on,
                        task.auto_model
                    );

                    // Update retry metadata
                    db.prepare('UPDATE tasks SET retry_count = ?, parent_task_id = ? WHERE id = ?')
                        .run(retryCount + 1, task.id, retryId);

                    console.log(`[Orchestrator] Created retry task: ${retryTitle} (${recovery.reasoning})`);
                    broadcastTaskUpdate(taskStmts.get.get(retryId));
                }
            } catch (retryErr) {
                console.error(`[Orchestrator] Retry analysis failed:`, retryErr.message);
            }
        }

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

        // Update goal progress on completion
        if (task.goal_id) {
            updateGoalProgress(task.goal_id);
        }
    }
}

// Check for pending tasks every 5 seconds
const orchestratorInterval = setInterval(runNextTask, 5000);

// ── Daily digest scheduler ────────────────────────────────

let lastDigestDate = null;

function checkDigestSchedule() {
    const config = loadConfig();
    const digestHour = parseInt((config.digest_hour || '7'), 10);
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (lastDigestDate === todayStr) return;
    if (now.getHours() < digestHour) return;

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const digest = generateDailyDigest(since);
    if (digest) {
        lastDigestDate = todayStr;
        sendDigestPush(digest.digest_text.split('\n')[0]);
        console.log(`[Digest] Daily digest generated: ${digest.task_count} tasks, $${digest.total_cost.toFixed(4)}`);
    }
}

const digestInterval = setInterval(checkDigestSchedule, 3600000);

// Check on startup if today's digest is missing
setTimeout(checkDigestSchedule, 5000);

// ── Nightly maintenance scheduler ─────────────────────────

let lastMaintenanceDate = null;

function checkMaintenanceSchedule() {
    const config = loadConfig();
    if (config.maintenance_enabled === false) return;
    const maintenanceHour = parseInt((config.maintenance_hour || '2'), 10);
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (lastMaintenanceDate === todayStr) return;
    if (now.getHours() < maintenanceHour) return;

    const result = runNightlyMaintenance();
    if (result) {
        lastMaintenanceDate = todayStr;
        console.log(`[Maintenance] Nightly run: ${result.goalIds.length} goals created`);
    }
}

const maintenanceInterval = setInterval(checkMaintenanceSchedule, 3600000);

// Check on startup if today's maintenance is missing (after digest check)
setTimeout(checkMaintenanceSchedule, 10000);

// ── Weekly report scheduler ───────────────────────────────

let lastWeeklyReportWeek = null;

function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return String(Math.ceil((((d - yearStart) / 86400000) + 1) / 7)).padStart(2, '0');
}

function checkWeeklyReportSchedule() {
    const config = loadConfig();
    const reportDay = parseInt((config.weekly_report_day || '0'), 10);  // 0=Sunday
    const reportHour = parseInt((config.weekly_report_hour || '8'), 10);
    const now = new Date();

    const weekStr = `${now.getFullYear()}-W${getISOWeek(now)}`;
    if (lastWeeklyReportWeek === weekStr) return;
    if (now.getDay() !== reportDay) return;
    if (now.getHours() < reportHour) return;

    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const report = generateWeeklyReport(weekStart);
    if (report) {
        lastWeeklyReportWeek = weekStr;
        if (config.ntfy_topic) {
            try {
                execFileSync('curl', ['-s', '-d', report.report_text.split('\n')[0], '-H', 'Title: Claude Remote Weekly Report', '-H', 'Priority: default', '-H', 'Tags: bar_chart', `https://ntfy.sh/${config.ntfy_topic}`], { timeout: 10000, stdio: 'ignore' });
            } catch {}
        }
        console.log(`[WeeklyReport] Generated: ${report.task_count} tasks, $${report.total_cost.toFixed(4)}`);
    }
}

const weeklyReportInterval = setInterval(checkWeeklyReportSchedule, 3600000);

// Check on startup if this week's report is missing
setTimeout(checkWeeklyReportSchedule, 15000);

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

// Initialize orchestrator
orchestrator.initialize().then(status => {
    console.log('[Orchestrator] Initialized:', status);
}).catch(err => {
    console.error('[Orchestrator] Initialization failed:', err);
});

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
    clearInterval(digestInterval);
    clearInterval(maintenanceInterval);
    clearInterval(weeklyReportInterval);
    if (runningAbort) runningAbort.abort();
    try { db.close(); } catch {}
    wss.close();
    server.close();
    process.exit(0);
});
