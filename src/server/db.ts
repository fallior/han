/**
 * Claude Remote - Database setup, schema, migrations, and prepared statements
 * Extracted from server.js for modular use.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type {
    ProjectStats,
    RegistryProject,
    BridgeEvent,
} from './types';

// ── Path constants ──────────────────────────────────────────

export const CLAUDE_REMOTE_DIR = process.env.CLAUDE_REMOTE_DIR || path.join(process.env.HOME!, '.claude-remote');
export const PENDING_DIR = path.join(CLAUDE_REMOTE_DIR, 'pending');
export const RESOLVED_DIR = path.join(CLAUDE_REMOTE_DIR, 'resolved');
export const BRIDGE_DIR = path.join(CLAUDE_REMOTE_DIR, 'bridge');
export const CONTEXTS_DIR = path.join(BRIDGE_DIR, 'contexts');
export const BRIDGE_HISTORY = path.join(BRIDGE_DIR, 'history.json');
export const PID_FILE = path.join(CLAUDE_REMOTE_DIR, 'server.pid');
export const REGISTRY_PATH = path.join(process.env.HOME!, 'Projects', 'infrastructure', 'registry', 'services.toml');

// ── Database setup ──────────────────────────────────────────

const TASKS_DB_PATH = path.join(CLAUDE_REMOTE_DIR, 'tasks.db');
export const db = new Database(TASKS_DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// ── CREATE TABLE statements (11 tables) ─────────────────────

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

db.exec(`CREATE TABLE IF NOT EXISTS projects (
    name TEXT PRIMARY KEY,
    description TEXT,
    path TEXT NOT NULL,
    lifecycle TEXT DEFAULT 'active',
    priority INTEGER DEFAULT 5,
    last_synced_at TEXT
)`);

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

// ── ALTER TABLE migrations ──────────────────────────────────

// Level 7 completion columns on tasks
const columns = (db.pragma("table_info('tasks')") as any[]).map((col: any) => col.name);
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

// Level 8 orchestrator columns on tasks
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

// Phase 2 budget columns on projects
const projCols = (db.pragma("table_info('projects')") as any[]).map((col: any) => col.name);
if (!projCols.includes('cost_budget_daily')) {
    db.exec(`ALTER TABLE projects ADD COLUMN cost_budget_daily REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN cost_budget_total REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN cost_spent_today REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN cost_spent_total REAL DEFAULT 0`);
    db.exec(`ALTER TABLE projects ADD COLUMN budget_reset_date TEXT`);
    db.exec(`ALTER TABLE projects ADD COLUMN throttled INTEGER DEFAULT 0`);
}

// Phase 2 deadline column on tasks
const taskCols = (db.pragma("table_info('tasks')") as any[]).map((col: any) => col.name);
if (!taskCols.includes('deadline')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN deadline TEXT`);
}

// Level 10B protocol compliance columns
const taskCols10b = (db.pragma("table_info('tasks')") as any[]).map((col: any) => col.name);
if (!taskCols10b.includes('commit_sha')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN commit_sha TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN files_changed TEXT`);
}
const goalCols = (db.pragma("table_info('goals')") as any[]).map((col: any) => col.name);
if (!goalCols.includes('summary_file')) {
    db.exec(`ALTER TABLE goals ADD COLUMN summary_file TEXT`);
}
if (!goalCols.includes('parent_goal_id')) {
    db.exec('ALTER TABLE goals ADD COLUMN parent_goal_id TEXT');
    db.exec("ALTER TABLE goals ADD COLUMN goal_type TEXT DEFAULT 'standalone'");
}
if (!goalCols.includes('planning_cost_usd')) {
    db.exec('ALTER TABLE goals ADD COLUMN planning_cost_usd REAL DEFAULT 0');
    db.exec('ALTER TABLE goals ADD COLUMN planning_log_file TEXT');
}

// Level 10D ports column on projects
const projCols10d = (db.pragma("table_info('projects')") as any[]).map((col: any) => col.name);
if (!projCols10d.includes('ports')) {
    db.exec(`ALTER TABLE projects ADD COLUMN ports TEXT`);
}

// Concurrent pipelines: is_remediation flag on tasks
const taskColsPipeline = (db.pragma("table_info('tasks')") as any[]).map((col: any) => col.name);
if (!taskColsPipeline.includes('is_remediation')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN is_remediation INTEGER DEFAULT 0`);
}

// Conversations tables
db.exec(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
)`);

// Supervisor cycles table
db.exec(`CREATE TABLE IF NOT EXISTS supervisor_cycles (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    cost_usd REAL DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    num_turns INTEGER DEFAULT 0,
    actions_taken TEXT,
    observations TEXT,
    reasoning TEXT,
    error TEXT,
    cycle_number INTEGER
)`);

db.exec(`CREATE TABLE IF NOT EXISTS supervisor_proposals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'improvement',
    project_path TEXT,
    estimated_effort TEXT DEFAULT 'medium',
    supervisor_reasoning TEXT,
    cycle_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT,
    reviewer_notes TEXT,
    goal_id TEXT
)`);

// Level 9 Phase 4 maintenance_enabled column on projects
const projCols9p4 = (db.pragma("table_info('projects')") as any[]).map((col: any) => col.name);
if (!projCols9p4.includes('maintenance_enabled')) {
    db.exec(`ALTER TABLE projects ADD COLUMN maintenance_enabled INTEGER DEFAULT 1`);
}

// Personal cycle tracking - cycle_type column on supervisor_cycles
const supervisorCyclesCols = (db.pragma("table_info('supervisor_cycles')") as any[]).map((col: any) => col.name);
if (!supervisorCyclesCols.includes('cycle_type')) {
    console.log('[DB] Adding cycle_type column to supervisor_cycles...');
    db.exec(`ALTER TABLE supervisor_cycles ADD COLUMN cycle_type TEXT DEFAULT 'supervisor'`);
    console.log('[DB] Migration complete: cycle_type column added');
}

// ── Prepared statements ─────────────────────────────────────

export const taskStmts = {
    list: db.prepare('SELECT * FROM tasks ORDER BY CASE status WHEN \'running\' THEN 0 WHEN \'pending\' THEN 1 ELSE 2 END, priority DESC, created_at DESC') as any,
    listByStatus: db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at DESC') as any,
    get: db.prepare('SELECT * FROM tasks WHERE id = ?') as any,
    insert: db.prepare('INSERT INTO tasks (id, title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, created_at, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)') as any,
    insertWithGoal: db.prepare('INSERT INTO tasks (id, title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, created_at, goal_id, complexity, depends_on, auto_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)') as any,
    updateStatus: db.prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?') as any,
    updateCheckpoint: db.prepare('UPDATE tasks SET checkpoint_ref = ?, checkpoint_type = ?, checkpoint_created_at = ? WHERE id = ?') as any,
    updateLogFile: db.prepare('UPDATE tasks SET log_file = ? WHERE id = ?') as any,
    complete: db.prepare('UPDATE tasks SET status = ?, completed_at = ?, result = ?, cost_usd = ?, tokens_in = ?, tokens_out = ?, turns = ? WHERE id = ?') as any,
    fail: db.prepare('UPDATE tasks SET status = ?, completed_at = ?, error = ? WHERE id = ?') as any,
    cancel: db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?') as any,
    del: db.prepare('DELETE FROM tasks WHERE id = ?') as any,
    nextPending: db.prepare('SELECT * FROM tasks WHERE status = \'pending\' ORDER BY priority DESC, created_at ASC LIMIT 1') as any,
    getByGoal: db.prepare('SELECT * FROM tasks WHERE goal_id = ? ORDER BY priority DESC, created_at ASC') as any,
    updateCommitInfo: db.prepare('UPDATE tasks SET commit_sha = ?, files_changed = ? WHERE id = ?') as any,
};

export const goalStmts = {
    list: db.prepare('SELECT * FROM goals ORDER BY created_at DESC') as any,
    get: db.prepare('SELECT * FROM goals WHERE id = ?') as any,
    insert: db.prepare('INSERT INTO goals (id, description, project_path, status, created_at, orchestrator_backend, orchestrator_model, parent_goal_id, goal_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)') as any,
    updateStatus: db.prepare('UPDATE goals SET status = ? WHERE id = ?') as any,
    updateProgress: db.prepare('UPDATE goals SET tasks_completed = ?, tasks_failed = ?, total_cost_usd = ?, status = ?, completed_at = ? WHERE id = ?') as any,
    updateDecomposition: db.prepare('UPDATE goals SET decomposition = ?, task_count = ?, status = ? WHERE id = ?') as any,
    del: db.prepare('DELETE FROM goals WHERE id = ?') as any,
    updateSummaryFile: db.prepare('UPDATE goals SET summary_file = ? WHERE id = ?') as any,
    getChildren: db.prepare('SELECT * FROM goals WHERE parent_goal_id = ? ORDER BY created_at ASC') as any,
    updatePlanningCost: db.prepare('UPDATE goals SET planning_cost_usd = ?, planning_log_file = ?, orchestrator_model = ? WHERE id = ?') as any,
};

export const memoryStmts = {
    insert: db.prepare('INSERT INTO project_memory (project_path, task_type, model_used, success, cost_usd, turns, duration_seconds, error_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)') as any,
    getByProject: db.prepare('SELECT * FROM project_memory WHERE project_path = ? ORDER BY created_at DESC LIMIT 100') as any,
    getAll: db.prepare('SELECT * FROM project_memory ORDER BY created_at DESC') as any,
};

export const portfolioStmts = {
    upsert: db.prepare('INSERT INTO projects (name, description, path, lifecycle, ports, last_synced_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, path = excluded.path, lifecycle = excluded.lifecycle, ports = excluded.ports, last_synced_at = excluded.last_synced_at') as any,
    list: db.prepare('SELECT * FROM projects ORDER BY priority DESC, name ASC') as any,
    get: db.prepare('SELECT * FROM projects WHERE name = ?') as any,
    getByPath: db.prepare('SELECT * FROM projects WHERE path = ?') as any,
    updatePriority: db.prepare('UPDATE projects SET priority = ? WHERE name = ?') as any,
    updateBudget: db.prepare('UPDATE projects SET cost_budget_daily = ?, cost_budget_total = ? WHERE name = ?') as any,
    updateCosts: db.prepare('UPDATE projects SET cost_spent_today = ?, cost_spent_total = ?, budget_reset_date = ?, throttled = ? WHERE name = ?') as any,
    unthrottle: db.prepare('UPDATE projects SET throttled = 0 WHERE name = ?') as any,
};

export const proposalStmts = {
    insert: db.prepare('INSERT INTO task_proposals (id, task_id, project_path, type, status, title, raw_block, parsed_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)') as any,
    list: db.prepare('SELECT * FROM task_proposals ORDER BY created_at DESC') as any,
    listByStatus: db.prepare('SELECT * FROM task_proposals WHERE status = ? ORDER BY created_at DESC') as any,
    get: db.prepare('SELECT * FROM task_proposals WHERE id = ?') as any,
    updateStatus: db.prepare('UPDATE task_proposals SET status = ?, reviewed_at = ?, written_to = ? WHERE id = ?') as any,
    getByTask: db.prepare('SELECT * FROM task_proposals WHERE task_id = ?') as any,
};

export const digestStmts = {
    insert: db.prepare('INSERT INTO digests (id, generated_at, period_start, period_end, digest_text, digest_json, task_count, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)') as any,
    getLatest: db.prepare('SELECT * FROM digests ORDER BY generated_at DESC LIMIT 1') as any,
    getById: db.prepare('SELECT * FROM digests WHERE id = ?') as any,
    list: db.prepare('SELECT id, generated_at, period_start, period_end, task_count, total_cost, viewed_at FROM digests ORDER BY generated_at DESC LIMIT 30') as any,
    markViewed: db.prepare('UPDATE digests SET viewed_at = ? WHERE id = ?') as any,
};

export const maintenanceStmts = {
    insert: db.prepare('INSERT INTO maintenance_runs (id, started_at, completed_at, status, projects_count, goals_created, summary) VALUES (?, ?, ?, ?, ?, ?, ?)') as any,
    getLatest: db.prepare('SELECT * FROM maintenance_runs ORDER BY started_at DESC LIMIT 1') as any,
    list: db.prepare('SELECT * FROM maintenance_runs ORDER BY started_at DESC LIMIT 30') as any,
    complete: db.prepare('UPDATE maintenance_runs SET completed_at = ?, status = ?, summary = ? WHERE id = ?') as any,
};

export const weeklyReportStmts = {
    insert: db.prepare('INSERT INTO weekly_reports (id, generated_at, week_start, week_end, report_text, report_json, task_count, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)') as any,
    getLatest: db.prepare('SELECT * FROM weekly_reports ORDER BY generated_at DESC LIMIT 1') as any,
    getById: db.prepare('SELECT * FROM weekly_reports WHERE id = ?') as any,
    list: db.prepare('SELECT id, generated_at, week_start, week_end, task_count, total_cost, viewed_at FROM weekly_reports ORDER BY generated_at DESC LIMIT 20') as any,
    markViewed: db.prepare('UPDATE weekly_reports SET viewed_at = ? WHERE id = ?') as any,
};

export const productStmts = {
    insert: db.prepare('INSERT INTO products (id, name, seed, project_path, current_phase, status, created_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)') as any,
    list: db.prepare('SELECT * FROM products ORDER BY created_at DESC') as any,
    get: db.prepare('SELECT * FROM products WHERE id = ?') as any,
    updatePhase: db.prepare('UPDATE products SET current_phase = ?, phases_completed = ? WHERE id = ?') as any,
    updateStatus: db.prepare('UPDATE products SET status = ?, completed_at = ? WHERE id = ?') as any,
    updateCost: db.prepare('UPDATE products SET total_cost_usd = ? WHERE id = ?') as any,
    updatePath: db.prepare('UPDATE products SET project_path = ? WHERE id = ?') as any,
    del: db.prepare('DELETE FROM products WHERE id = ?') as any,
};

export const phaseStmts = {
    insert: db.prepare('INSERT INTO product_phases (id, product_id, phase, status) VALUES (?, ?, ?, ?)') as any,
    getByProduct: db.prepare('SELECT * FROM product_phases WHERE product_id = ? ORDER BY CASE phase WHEN \'research\' THEN 0 WHEN \'design\' THEN 1 WHEN \'architecture\' THEN 2 WHEN \'build\' THEN 3 WHEN \'test\' THEN 4 WHEN \'document\' THEN 5 WHEN \'deploy\' THEN 6 END') as any,
    get: db.prepare('SELECT * FROM product_phases WHERE product_id = ? AND phase = ?') as any,
    updateStatus: db.prepare('UPDATE product_phases SET status = ?, started_at = ? WHERE product_id = ? AND phase = ?') as any,
    updateGoal: db.prepare('UPDATE product_phases SET goal_id = ? WHERE product_id = ? AND phase = ?') as any,
    complete: db.prepare('UPDATE product_phases SET status = ?, completed_at = ?, cost_usd = ?, artifacts = ? WHERE product_id = ? AND phase = ?') as any,
    updateGate: db.prepare('UPDATE product_phases SET gate_status = ?, gate_approved_at = ?, notes = ? WHERE product_id = ? AND phase = ?') as any,
};

export const knowledgeStmts = {
    insert: db.prepare('INSERT INTO product_knowledge (product_id, category, title, content, source_phase, created_at) VALUES (?, ?, ?, ?, ?, ?)') as any,
    getByProduct: db.prepare('SELECT * FROM product_knowledge WHERE product_id = ? ORDER BY created_at ASC') as any,
    getByCategory: db.prepare('SELECT * FROM product_knowledge WHERE product_id = ? AND category = ? ORDER BY created_at ASC') as any,
};

export const supervisorStmts = {
    insertCycle: db.prepare('INSERT INTO supervisor_cycles (id, started_at, cycle_number) VALUES (?, ?, ?)') as any,
    completeCycle: db.prepare('UPDATE supervisor_cycles SET completed_at = ?, cost_usd = ?, tokens_in = ?, tokens_out = ?, num_turns = ?, actions_taken = ?, observations = ?, reasoning = ? WHERE id = ?') as any,
    failCycle: db.prepare('UPDATE supervisor_cycles SET completed_at = ?, error = ? WHERE id = ?') as any,
    getLatest: db.prepare('SELECT * FROM supervisor_cycles ORDER BY started_at DESC LIMIT 1') as any,
    getRecent: db.prepare('SELECT * FROM supervisor_cycles ORDER BY started_at DESC LIMIT ?') as any,
    getCostSince: db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM supervisor_cycles WHERE started_at > ?') as any,
    getNextCycleNumber: db.prepare('SELECT COALESCE(MAX(cycle_number), 0) + 1 as next FROM supervisor_cycles') as any,
};

export const strategicProposalStmts = {
    insert: db.prepare('INSERT INTO supervisor_proposals (id, title, description, category, project_path, estimated_effort, supervisor_reasoning, cycle_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)') as any,
    list: db.prepare('SELECT * FROM supervisor_proposals ORDER BY created_at DESC') as any,
    listByStatus: db.prepare('SELECT * FROM supervisor_proposals WHERE status = ? ORDER BY created_at DESC') as any,
    get: db.prepare('SELECT * FROM supervisor_proposals WHERE id = ?') as any,
    updateStatus: db.prepare('UPDATE supervisor_proposals SET status = ?, reviewed_at = ?, reviewer_notes = ?, goal_id = ? WHERE id = ?') as any,
    countPending: db.prepare('SELECT COUNT(*) as count FROM supervisor_proposals WHERE status = ?') as any,
};

export const conversationStmts = {
    list: db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC') as any,
    get: db.prepare('SELECT * FROM conversations WHERE id = ?') as any,
    insert: db.prepare('INSERT INTO conversations (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)') as any,
    updateStatus: db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?') as any,
    updateTimestamp: db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?') as any,
};

export const conversationMessageStmts = {
    list: db.prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC') as any,
    insert: db.prepare('INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)') as any,
    getPending: db.prepare(`SELECT cm.* FROM conversation_messages cm JOIN conversations c ON cm.conversation_id = c.id WHERE c.status = 'open' AND cm.role IN ('human', 'leo') AND NOT EXISTS (SELECT 1 FROM conversation_messages cm2 WHERE cm2.conversation_id = cm.conversation_id AND cm2.role = 'supervisor' AND cm2.created_at > cm.created_at) ORDER BY cm.created_at ASC`) as any,
    getLastSupervisorResponse: db.prepare('SELECT created_at FROM conversation_messages WHERE conversation_id = ? AND role = \'supervisor\' ORDER BY created_at DESC LIMIT 1') as any,
};

// ── Helper functions ────────────────────────────────────────

/**
 * Parse the infrastructure registry TOML file into project objects.
 */
export function parseRegistryToml(content: string): RegistryProject[] {
    const projects: RegistryProject[] = [];
    let current: RegistryProject | null = null;
    let subSection: string | null = null;

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
        // Sub-section like [name.supabase] -- track for port extraction
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
                else if (key === 'path') current.path = value.replace(/^~/, process.env.HOME!);
                else if (key === 'lifecycle') current.lifecycle = value;
            }
            continue;
        }
        // Numeric value -- extract ports from sub-sections
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

/**
 * Sync projects from the infrastructure registry TOML into the projects table.
 */
export function syncRegistry(): number {
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
    } catch (err: any) {
        console.error('[Portfolio] Sync failed:', err.message);
        return 0;
    }
}

/**
 * Get aggregate task/goal stats for a single project path.
 */
export function getProjectStats(projectPath: string): ProjectStats {
    const taskRow = db.prepare(`
        SELECT
            COUNT(*) as tasks_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as tasks_completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as tasks_failed,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as tasks_running,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as tasks_pending,
            COALESCE(SUM(cost_usd), 0) as total_cost_usd
        FROM tasks WHERE project_path = ?
    `).get(projectPath) as any;

    const goalRow = db.prepare(`
        SELECT
            COUNT(*) as goals_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as goals_completed
        FROM goals WHERE project_path = ?
    `).get(projectPath) as any;

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

/**
 * Get aggregate task/goal stats for all projects, keyed by project_path.
 */
export function getAllProjectStats(): Record<string, ProjectStats> {
    const taskRows = db.prepare(`
        SELECT project_path,
            COUNT(*) as tasks_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as tasks_completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as tasks_failed,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as tasks_running,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as tasks_pending,
            COALESCE(SUM(cost_usd), 0) as total_cost_usd
        FROM tasks GROUP BY project_path
    `).all() as any[];

    const goalRows = db.prepare(`
        SELECT project_path,
            COUNT(*) as goals_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as goals_completed
        FROM goals GROUP BY project_path
    `).all() as any[];

    const stats: Record<string, ProjectStats> = {};
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
 * Log an event to the bridge history JSON file.
 */
export function logBridgeEvent(type: string, label: string, metadata: Record<string, any> = {}): BridgeEvent {
    let history: BridgeEvent[] = [];
    try {
        if (fs.existsSync(BRIDGE_HISTORY)) {
            history = JSON.parse(fs.readFileSync(BRIDGE_HISTORY, 'utf8'));
        }
    } catch { /* start fresh */ }

    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const entry: BridgeEvent = {
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
