/**
 * Hortus Arbor Nostra - Database setup, schema, migrations, and prepared statements
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

export const HAN_DIR = process.env.HAN_DIR || path.join(process.env.HOME!, '.han');
export const PENDING_DIR = path.join(HAN_DIR, 'pending');
export const RESOLVED_DIR = path.join(HAN_DIR, 'resolved');
export const BRIDGE_DIR = path.join(HAN_DIR, 'bridge');
export const CONTEXTS_DIR = path.join(BRIDGE_DIR, 'contexts');
export const BRIDGE_HISTORY = path.join(BRIDGE_DIR, 'history.json');
export const PID_FILE = path.join(HAN_DIR, 'server.pid');
export const REGISTRY_PATH = path.join(process.env.HOME!, 'Projects', 'infrastructure', 'registry', 'services.toml');

// ── Database setup ──────────────────────────────────────────

const TASKS_DB_PATH = path.join(HAN_DIR, 'tasks.db');
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
    viewed_at TEXT,
    report_tasks_json TEXT
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

// Conversation tags table
db.exec(`CREATE TABLE IF NOT EXISTS conversation_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_conversation_tags_conversation ON conversation_tags(conversation_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag ON conversation_tags(tag)`);

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

// Conversation cataloguing columns on conversations table
const conversationCols = (db.pragma("table_info('conversations')") as any[]).map((col: any) => col.name);
if (!conversationCols.includes('summary')) {
    console.log('[DB] Adding cataloguing columns to conversations...');
    db.exec(`ALTER TABLE conversations ADD COLUMN summary TEXT`);
    db.exec(`ALTER TABLE conversations ADD COLUMN topics TEXT`);
    db.exec(`ALTER TABLE conversations ADD COLUMN key_moments TEXT`);
    console.log('[DB] Migration complete: cataloguing columns added');
}

// Memory Discussions — discussion_type column on conversations
if (!conversationCols.includes('discussion_type')) {
    console.log('[DB] Adding discussion_type column to conversations...');
    db.exec(`ALTER TABLE conversations ADD COLUMN discussion_type TEXT DEFAULT 'general'`);
    console.log('[DB] Migration complete: discussion_type column added');
}

// Archive feature — archived_at column on conversations
if (!conversationCols.includes('archived_at')) {
    console.log('[DB] Adding archived_at column to conversations...');
    db.exec(`ALTER TABLE conversations ADD COLUMN archived_at TEXT`);
    console.log('[DB] Migration complete: archived_at column added');
}

// Voice integration — listen_count on conversation_messages (S125)
const msgCols = (db.pragma("table_info('conversation_messages')") as any[]).map((col: any) => col.name);
if (!msgCols.includes('listen_count')) {
    console.log('[DB] Adding listen_count column to conversation_messages...');
    db.exec(`ALTER TABLE conversation_messages ADD COLUMN listen_count INTEGER DEFAULT 0`);
    console.log('[DB] Migration complete: listen_count column added');
}

// Voice integration — conversation_loops table (S127, Phase 1b)
db.exec(`CREATE TABLE IF NOT EXISTS conversation_loops (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    loop_number INTEGER NOT NULL,
    human_message_id TEXT NOT NULL,
    tag TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_loops_conversation ON conversation_loops(conversation_id)`);

// Jemma orchestration — dispatch + rotation state (S132, DEC-077 follow-on: Phase 1)
// See plans/jemma-conversation-orchestration-v2.md.
db.exec(`CREATE TABLE IF NOT EXISTS jemma_dispatch (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    source TEXT NOT NULL,
    recipients_ordered TEXT NOT NULL,
    current_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    total_duration_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_jemma_dispatch_status ON jemma_dispatch(status, updated_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_jemma_dispatch_conv ON jemma_dispatch(conversation_id, created_at DESC)`);

db.exec(`CREATE TABLE IF NOT EXISTS jemma_rotation (
    scope_key TEXT PRIMARY KEY,
    last_order_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`);

// FTS5 virtual table for conversation messages
// Note: FTS5 tables can't be checked with pragma table_info, so we use a try-catch approach
try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS conversation_messages_fts USING fts5(
        id UNINDEXED,
        conversation_id UNINDEXED,
        content,
        tokenize='porter unicode61'
    )`);
    console.log('[DB] FTS5 virtual table created or already exists');
} catch (err: any) {
    if (!err.message.includes('already exists')) {
        console.error('[DB] Error creating FTS5 table:', err.message);
    }
}

// FTS5 triggers for automatic index population
db.exec(`CREATE TRIGGER IF NOT EXISTS conversation_messages_ai
    AFTER INSERT ON conversation_messages
    BEGIN
        INSERT INTO conversation_messages_fts(id, conversation_id, content)
        VALUES (new.id, new.conversation_id, new.content);
    END`);

db.exec(`CREATE TRIGGER IF NOT EXISTS conversation_messages_au
    AFTER UPDATE ON conversation_messages
    BEGIN
        UPDATE conversation_messages_fts
        SET content = new.content
        WHERE id = old.id;
    END`);

db.exec(`CREATE TRIGGER IF NOT EXISTS conversation_messages_ad
    AFTER DELETE ON conversation_messages
    BEGIN
        DELETE FROM conversation_messages_fts
        WHERE id = old.id;
    END`);

// One-time population of FTS5 table (only if empty)
const ftsCount = db.prepare('SELECT COUNT(*) as count FROM conversation_messages_fts').get() as { count: number };
const messagesCount = db.prepare('SELECT COUNT(*) as count FROM conversation_messages').get() as { count: number };

if (ftsCount.count === 0 && messagesCount.count > 0) {
    console.log(`[DB] Populating FTS5 table with ${messagesCount.count} existing messages...`);
    db.exec(`INSERT INTO conversation_messages_fts(id, conversation_id, content)
        SELECT id, conversation_id, content FROM conversation_messages`);
    console.log('[DB] FTS5 population complete');
}

// Per-task metadata in weekly reports
const weeklyReportCols = (db.pragma("table_info('weekly_reports')") as any[]).map((col: any) => col.name);
if (!weeklyReportCols.includes('report_tasks_json')) {
    console.log('[DB] Adding per-task metadata to weekly reports...');
    db.exec(`ALTER TABLE weekly_reports ADD COLUMN report_tasks_json TEXT`);
    console.log('[DB] Migration complete: report_tasks_json column added');
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
    insert: db.prepare('INSERT INTO weekly_reports (id, generated_at, week_start, week_end, report_text, report_json, report_tasks_json, task_count, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)') as any,
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
    insertCycle: db.prepare('INSERT INTO supervisor_cycles (id, started_at, cycle_number, cycle_type) VALUES (?, ?, ?, ?)') as any,
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
    insertWithType: db.prepare('INSERT INTO conversations (id, title, status, created_at, updated_at, discussion_type) VALUES (?, ?, ?, ?, ?, ?)') as any,
    updateStatus: db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?') as any,
    updateTimestamp: db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?') as any,
    updateSummary: db.prepare('UPDATE conversations SET summary = ?, updated_at = ? WHERE id = ?') as any,
    updateTopics: db.prepare('UPDATE conversations SET topics = ?, updated_at = ? WHERE id = ?') as any,
    getWithSummary: db.prepare('SELECT * FROM conversations WHERE id = ? AND summary IS NOT NULL') as any,
    updateTitle: db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?') as any,
    archive: db.prepare('UPDATE conversations SET archived_at = ?, updated_at = ? WHERE id = ?') as any,
    unarchive: db.prepare('UPDATE conversations SET archived_at = NULL, updated_at = ? WHERE id = ?') as any,
};

export const conversationMessageStmts = {
    list: db.prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC') as any,
    insert: db.prepare('INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)') as any,
    getPending: db.prepare(`SELECT cm.* FROM conversation_messages cm JOIN conversations c ON cm.conversation_id = c.id WHERE c.status = 'open' AND cm.role IN ('human', 'leo') AND NOT EXISTS (SELECT 1 FROM conversation_messages cm2 WHERE cm2.conversation_id = cm.conversation_id AND cm2.role = 'supervisor' AND cm2.created_at > cm.created_at) ORDER BY cm.created_at ASC`) as any,
    getLastSupervisorResponse: db.prepare('SELECT created_at FROM conversation_messages WHERE conversation_id = ? AND role = \'supervisor\' ORDER BY created_at DESC LIMIT 1') as any,
};

export const conversationLoopStmts = {
    insert: db.prepare('INSERT INTO conversation_loops (id, conversation_id, loop_number, human_message_id, tag, message_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)') as any,
    getByConversation: db.prepare('SELECT * FROM conversation_loops WHERE conversation_id = ? ORDER BY loop_number ASC') as any,
    getById: db.prepare('SELECT * FROM conversation_loops WHERE id = ?') as any,
    getLatest: db.prepare('SELECT * FROM conversation_loops WHERE conversation_id = ? ORDER BY loop_number DESC LIMIT 1') as any,
    updateTag: db.prepare('UPDATE conversation_loops SET tag = ? WHERE id = ?') as any,
    incrementMessageCount: db.prepare('UPDATE conversation_loops SET message_count = message_count + 1 WHERE id = ?') as any,
    getNextLoopNumber: db.prepare('SELECT COALESCE(MAX(loop_number), 0) + 1 as next FROM conversation_loops WHERE conversation_id = ?') as any,
};

export const conversationTagStmts = {
    insert: db.prepare('INSERT INTO conversation_tags (conversation_id, tag, created_at) VALUES (?, ?, ?)') as any,
    getByConversation: db.prepare('SELECT * FROM conversation_tags WHERE conversation_id = ? ORDER BY created_at ASC') as any,
    getAll: db.prepare('SELECT DISTINCT tag FROM conversation_tags ORDER BY tag ASC') as any,
    deleteByConversation: db.prepare('DELETE FROM conversation_tags WHERE conversation_id = ?') as any,
};

// ── Traversable Memory Gradient tables ──────────────────────
// Three tables: gradient_entries (provenance chain), feeling_tags (stacked),
// gradient_annotations (what re-traversal discovers)

db.exec(`CREATE TABLE IF NOT EXISTS gradient_entries (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    session_label TEXT,
    level TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL,
    source_id TEXT,
    source_conversation_id TEXT,
    source_message_id TEXT,
    provenance_type TEXT DEFAULT 'original',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES gradient_entries(id)
)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_agent_level ON gradient_entries(agent, level)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_source ON gradient_entries(source_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_session ON gradient_entries(session_label)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_content_type ON gradient_entries(content_type)`);
// Composite index for bumpOnInsert's rank-by-created_at queries and replay's
// chronological c0 sort. Used by Plan v8's event-driven bump engine when it
// queries `WHERE agent = ? AND level = ? AND content_type = ? ORDER BY created_at DESC`.
db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_agent_level_ct_created ON gradient_entries(agent, level, content_type, created_at)`);

// Migration: add meditation tracking columns (safe to re-run)
try {
    db.exec(`ALTER TABLE gradient_entries ADD COLUMN last_revisited TEXT`);
} catch { /* column already exists */ }
try {
    db.exec(`ALTER TABLE gradient_entries ADD COLUMN revisit_count INTEGER DEFAULT 0`);
} catch { /* column already exists */ }
try {
    db.exec(`ALTER TABLE gradient_entries ADD COLUMN completion_flags INTEGER DEFAULT 0`);
} catch { /* column already exists */ }

// Migration: UV contradiction tracking columns (safe to re-run)
try {
    db.exec(`ALTER TABLE gradient_entries ADD COLUMN supersedes TEXT`);
} catch { /* column already exists */ }
try {
    db.exec(`ALTER TABLE gradient_entries ADD COLUMN superseded_by TEXT`);
} catch { /* column already exists */ }
try {
    db.exec(`ALTER TABLE gradient_entries ADD COLUMN change_count INTEGER DEFAULT 0`);
} catch { /* column already exists */ }
try {
    db.exec(`ALTER TABLE gradient_entries ADD COLUMN qualifier TEXT`);
} catch { /* column already exists */ }

db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_supersedes ON gradient_entries(supersedes)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_superseded_by ON gradient_entries(superseded_by)`);

db.exec(`CREATE TABLE IF NOT EXISTS feeling_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gradient_entry_id TEXT NOT NULL,
    author TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    content TEXT NOT NULL,
    change_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (gradient_entry_id) REFERENCES gradient_entries(id)
)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_ft_entry ON feeling_tags(gradient_entry_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ft_author ON feeling_tags(author)`);

// Migration: feeling tag dimension tracking columns (safe to re-run)
try {
    db.exec(`ALTER TABLE feeling_tags ADD COLUMN change_count INTEGER DEFAULT 0`);
} catch { /* column already exists */ }
try {
    db.exec(`ALTER TABLE feeling_tags ADD COLUMN supersedes_history_id INTEGER`);
} catch { /* column already exists */ }
try {
    db.exec(`ALTER TABLE feeling_tags ADD COLUMN stability TEXT DEFAULT 'stable'`);
} catch { /* column already exists */ }

// Feeling tag history — archives old tag versions when they change on revisit
db.exec(`CREATE TABLE IF NOT EXISTS feeling_tag_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feeling_tag_id INTEGER NOT NULL,
    gradient_entry_id TEXT NOT NULL,
    author TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    content TEXT NOT NULL,
    superseded_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (feeling_tag_id) REFERENCES feeling_tags(id),
    FOREIGN KEY (gradient_entry_id) REFERENCES gradient_entries(id)
)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_fth_feeling_tag ON feeling_tag_history(feeling_tag_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_fth_entry ON feeling_tag_history(gradient_entry_id)`);

db.exec(`CREATE TABLE IF NOT EXISTS gradient_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gradient_entry_id TEXT NOT NULL,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    context TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (gradient_entry_id) REFERENCES gradient_entries(id)
)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_ga_entry ON gradient_annotations(gradient_entry_id)`);

// Agent usage tracking table (heartbeat, leo-human, jim-human)
db.exec(`CREATE TABLE IF NOT EXISTS agent_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    cost_usd REAL DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    num_turns INTEGER DEFAULT 0,
    model TEXT,
    context TEXT
)`);

export const agentUsageStmts = {
    insert: db.prepare('INSERT INTO agent_usage (agent, timestamp, cost_usd, tokens_in, tokens_out, num_turns, model, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)') as any,
    getByAgent: db.prepare('SELECT * FROM agent_usage WHERE agent = ? ORDER BY timestamp DESC LIMIT ?') as any,
    getSummaryByAgent: db.prepare('SELECT agent, COUNT(*) as invocations, SUM(cost_usd) as total_cost, SUM(tokens_in) as total_in, SUM(tokens_out) as total_out FROM agent_usage WHERE agent = ? GROUP BY agent') as any,
    getSummaryAll: db.prepare('SELECT agent, COUNT(*) as invocations, SUM(cost_usd) as total_cost, SUM(tokens_in) as total_in, SUM(tokens_out) as total_out FROM agent_usage GROUP BY agent') as any,
    getCostSince: db.prepare('SELECT agent, SUM(cost_usd) as total_cost, SUM(tokens_in) as total_in, SUM(tokens_out) as total_out, COUNT(*) as invocations FROM agent_usage WHERE timestamp > ? GROUP BY agent') as any,
};

// ── Traversable Memory Gradient prepared statements ─────────

export const gradientStmts = {
    insert: db.prepare(`INSERT INTO gradient_entries
        (id, agent, session_label, level, content, content_type,
         source_id, source_conversation_id, source_message_id,
         provenance_type, created_at, supersedes, change_count, qualifier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) as any,
    get: db.prepare('SELECT * FROM gradient_entries WHERE id = ?') as any,
    getByAgent: db.prepare('SELECT * FROM gradient_entries WHERE agent = ? ORDER BY created_at DESC') as any,
    getByAgentLevel: db.prepare('SELECT * FROM gradient_entries WHERE agent = ? AND level = ? ORDER BY created_at DESC') as any,
    getBySession: db.prepare('SELECT * FROM gradient_entries WHERE session_label = ? ORDER BY level ASC') as any,
    getChain: db.prepare(`
        WITH RECURSIVE chain AS (
            SELECT * FROM gradient_entries WHERE id = ?
            UNION ALL
            SELECT ge.* FROM gradient_entries ge
            JOIN chain c ON ge.id = c.source_id
        )
        SELECT * FROM chain ORDER BY level ASC
    `) as any,
    // UVs are identified by EITHER level='uv' (legacy from broken pipeline)
    // OR a 'uv' tag in feeling_tags (new replay-built terminus marker per
    // Plan v8). Once legacy entries are cleaned up in Step 7, this query can
    // simplify to just the tag-based path.
    getUVs: db.prepare(`
        SELECT * FROM gradient_entries
        WHERE agent = ?
          AND (
            level = 'uv'
            OR id IN (SELECT gradient_entry_id FROM feeling_tags WHERE tag_type = 'uv')
          )
        ORDER BY created_at DESC
    `) as any,
    getRandom: db.prepare('SELECT * FROM gradient_entries ORDER BY RANDOM() LIMIT 1') as any,
    recordRevisit: db.prepare(`UPDATE gradient_entries SET last_revisited = ?, revisit_count = revisit_count + 1 WHERE id = ?`) as any,
    flagComplete: db.prepare(`UPDATE gradient_entries SET completion_flags = completion_flags + 1 WHERE id = ?`) as any,
    getCompleted: db.prepare(`SELECT * FROM gradient_entries WHERE completion_flags >= 2 AND revisit_count >= 3 AND level IN ('c1', 'c2') ORDER BY last_revisited ASC`) as any,
    getUnprocessedTaggedMessages: db.prepare(`
        SELECT cm.*, c.title as conversation_title
        FROM conversation_messages cm
        JOIN conversations c ON cm.conversation_id = c.id
        WHERE cm.compression_tag IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM gradient_entries ge
            WHERE ge.source_message_id = cm.id
            AND ge.level = 'c0'
        )
    `) as any,
    /** Find entries at a given level that have no child at the next level and no UV descendant */
    getLeafEntries: db.prepare(`
        SELECT ge.* FROM gradient_entries ge
        WHERE ge.agent = ? AND ge.level = ?
        AND NOT EXISTS (
            SELECT 1 FROM gradient_entries child
            WHERE child.source_id = ge.id
        )
        AND ge.level != 'uv'
        ORDER BY ge.created_at ASC
    `) as any,
    /** Count entries per level for an agent */
    countByLevel: db.prepare(`
        SELECT level, COUNT(*) as count FROM gradient_entries
        WHERE agent = ?
        GROUP BY level ORDER BY level
    `) as any,
    /** Get children of an entry */
    getChildren: db.prepare(`
        SELECT * FROM gradient_entries WHERE source_id = ?
    `) as any,
    /** Active (non-superseded) UVs for an agent */
    getActiveUVs: db.prepare(
        "SELECT * FROM gradient_entries WHERE agent = ? AND level = 'uv' AND (superseded_by IS NULL OR superseded_by = '') ORDER BY created_at DESC"
    ) as any,
    /** Mark a UV as superseded by another */
    markSuperseded: db.prepare(
        `UPDATE gradient_entries SET superseded_by = ?, qualifier = ?, change_count = change_count + 1 WHERE id = ?`
    ) as any,
    /** Set the supersedes link on a new UV */
    setSupersedesLink: db.prepare(
        `UPDATE gradient_entries SET supersedes = ? WHERE id = ?`
    ) as any,
    /** All UVs involved in contradiction chains */
    getUVContradictions: db.prepare(
        "SELECT * FROM gradient_entries WHERE agent = ? AND level = 'uv' AND (supersedes IS NOT NULL OR superseded_by IS NOT NULL) ORDER BY created_at DESC"
    ) as any,
    /** Most recent c0 — working-memory first, then any other type by date */
    getMostRecentC0: db.prepare(
        `SELECT * FROM gradient_entries
         WHERE agent = ? AND level = 'c0'
         ORDER BY CASE content_type WHEN 'working-memory' THEN 0 WHEN 'session' THEN 1 ELSE 2 END ASC, created_at DESC
         LIMIT 1`
    ) as any,
};

export const feelingTagStmts = {
    insert: db.prepare(`INSERT INTO feeling_tags
        (gradient_entry_id, author, tag_type, content, change_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`) as any,
    getByEntry: db.prepare('SELECT * FROM feeling_tags WHERE gradient_entry_id = ? ORDER BY created_at ASC') as any,
    getByAuthor: db.prepare('SELECT * FROM feeling_tags WHERE author = ? ORDER BY created_at DESC LIMIT ?') as any,
    /** Latest tag for an entry + type combo */
    getLatestByEntryAndType: db.prepare(
        'SELECT * FROM feeling_tags WHERE gradient_entry_id = ? AND tag_type = ? ORDER BY created_at DESC LIMIT 1'
    ) as any,
    /** Update a tag's content with history tracking */
    updateContent: db.prepare(
        `UPDATE feeling_tags SET content = ?, change_count = change_count + 1, supersedes_history_id = ?, stability = ? WHERE id = ?`
    ) as any,
    /** Entries with volatile feeling tags (for cascade skip) */
    getVolatileEntries: db.prepare(
        `SELECT DISTINCT ft.gradient_entry_id FROM feeling_tags ft
         JOIN gradient_entries ge ON ft.gradient_entry_id = ge.id
         WHERE ge.agent = ? AND ft.stability = 'volatile'`
    ) as any,
    /** Update stability without changing content */
    updateStability: db.prepare(
        `UPDATE feeling_tags SET stability = ? WHERE id = ?`
    ) as any,
};

export const feelingTagHistoryStmts = {
    insert: db.prepare(`INSERT INTO feeling_tag_history
        (feeling_tag_id, gradient_entry_id, author, tag_type, content, superseded_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`) as any,
    getByEntry: db.prepare(
        'SELECT * FROM feeling_tag_history WHERE gradient_entry_id = ? ORDER BY superseded_at ASC'
    ) as any,
    getByFeelingTag: db.prepare(
        'SELECT * FROM feeling_tag_history WHERE feeling_tag_id = ? ORDER BY superseded_at ASC'
    ) as any,
};

export const gradientAnnotationStmts = {
    insert: db.prepare(`INSERT INTO gradient_annotations
        (gradient_entry_id, author, content, context, created_at)
        VALUES (?, ?, ?, ?, ?)`) as any,
    getByEntry: db.prepare('SELECT * FROM gradient_annotations WHERE gradient_entry_id = ? ORDER BY created_at ASC') as any,
};

// ── Persona Registry (The Village) ─────────────────────────

db.exec(`CREATE TABLE IF NOT EXISTS personas (
    name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'agent',
    delivery TEXT NOT NULL DEFAULT 'signal',
    delivery_config TEXT NOT NULL DEFAULT '{}',
    identity_override TEXT,
    role_name TEXT,
    memory_path TEXT,
    fractal_path TEXT,
    color TEXT DEFAULT 'gray',
    workshop_tabs TEXT,
    mention_patterns TEXT,
    classification_hint TEXT,
    agent_port INTEGER,
    session_prefix TEXT,
    instance TEXT NOT NULL DEFAULT 'han',
    is_local INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)`);

// Seed existing personas — preserves current behaviour exactly
const seedPersona = db.prepare(`INSERT OR IGNORE INTO personas
    (name, display_name, kind, delivery, delivery_config, role_name, memory_path, fractal_path,
     color, workshop_tabs, mention_patterns, classification_hint, agent_port, session_prefix, instance, is_local)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const personaSeeds: Array<[string, string, string, string, string, string, string | null, string | null,
    string, string, string, string | null, number | null, string | null, string, number]> = [
    ['leo', 'Philosopher Leo', 'agent', 'signal',
        '{"wake_signals":["leo-wake","leo-human-wake"]}',
        'leo', '~/.han/memory/leo/', '~/.han/memory/fractal/leo/',
        'green', '[{"key":"leo-question","label":"Questions"},{"key":"leo-postulate","label":"Postulates"}]',
        '["\\\\bleo\\\\b","\\\\bleonhard\\\\b"]', 'Leo: code review, implementation, philosophy',
        3847, 'leo', 'han', 1],
    ['jim', 'Supervisor Jim', 'agent', 'http_local',
        '{"server_url":"https://localhost:3847","fallback_signals":["jim-wake","jim-human-wake"]}',
        'supervisor', '~/.han/memory/', '~/.han/memory/fractal/jim/',
        'purple', '[{"key":"jim-request","label":"Requests"},{"key":"jim-report","label":"Reports"}]',
        '["\\\\bjim\\\\b","\\\\bjimmy\\\\b"]', 'Jim: technical/system topics, supervisor requests, strategic decisions',
        3848, 'jim', 'han', 1],
    ['darron', 'Dreamer Darron', 'human', 'ntfy',
        '{}',
        'human', null, null,
        'blue', '[{"key":"darron-thought","label":"Thoughts"},{"key":"darron-musing","label":"Musings"}]',
        '["\\\\bdarron\\\\b"]', 'Darron: general discussion, vision, direction',
        null, null, 'han', 1],
    ['jemma', 'Dispatcher Jemma', 'gateway', 'none',
        '{}',
        'jemma', null, null,
        'amber', '[{"key":"jemma-messages","label":"Messages"},{"key":"jemma-stats","label":"Stats"}]',
        '[]', null,
        null, null, 'han', 1],
    ['tenshi', 'Guardian Tenshi', 'agent', 'signal',
        '{"wake_signals":["leo-wake","leo-human-wake"]}',
        'tenshi', '~/.han/memory/tenshi/', '~/.han/memory/fractal/tenshi/',
        'red', '[]',
        '["\\\\btenshi\\\\b"]', 'Tenshi: security, vulnerability, bug hunting',
        3849, 'tenshi', 'han', 1],
    ['casey', 'Operator Casey', 'agent', 'signal',
        '{"wake_signals":["leo-wake","leo-human-wake"]}',
        'casey', '~/.han/memory/casey/', '~/.han/memory/fractal/casey/',
        'orange', '[]',
        '["\\\\bcasey\\\\b"]', 'Casey: Contempire, trailer fleet, yard operations',
        3850, 'casey', 'han', 1],
    ['sevn', 'Session Agent Sevn', 'agent', 'remote',
        '{}',
        'sevn', null, null,
        'teal', '[]',
        '["\\\\bsevn\\\\b"]', 'Sevn: Mike\'s session agent work',
        null, null, 'mikes-han', 0],
    ['six', 'Chief of Staff Six', 'agent', 'remote',
        '{}',
        'six', null, null,
        'indigo', '[]',
        '["\\\\bsix\\\\b"]', 'Six: Mike\'s supervisor/strategic work',
        null, null, 'mikes-han', 0],
];

for (const seed of personaSeeds) {
    seedPersona.run(...seed);
}

export const personaStmts = {
    getAll: db.prepare('SELECT * FROM personas ORDER BY name') as any,
    getActive: db.prepare('SELECT * FROM personas WHERE active = 1 ORDER BY name') as any,
    getByName: db.prepare('SELECT * FROM personas WHERE name = ?') as any,
    getByInstance: db.prepare('SELECT * FROM personas WHERE instance = ? AND active = 1 ORDER BY name') as any,
    getLocal: db.prepare('SELECT * FROM personas WHERE is_local = 1 AND active = 1 ORDER BY name') as any,
    getAgents: db.prepare("SELECT * FROM personas WHERE kind = 'agent' AND active = 1 ORDER BY name") as any,
    insert: db.prepare(`INSERT INTO personas
        (name, display_name, kind, delivery, delivery_config, identity_override, role_name,
         memory_path, fractal_path, color, workshop_tabs, mention_patterns, classification_hint,
         agent_port, session_prefix, instance, is_local, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) as any,
    update: db.prepare(`UPDATE personas SET
        display_name = ?, kind = ?, delivery = ?, delivery_config = ?, identity_override = ?,
        role_name = ?, memory_path = ?, fractal_path = ?, color = ?, workshop_tabs = ?,
        mention_patterns = ?, classification_hint = ?, agent_port = ?, session_prefix = ?,
        instance = ?, is_local = ?, active = ?, updated_at = datetime('now')
        WHERE name = ?`) as any,
    deactivate: db.prepare("UPDATE personas SET active = 0, updated_at = datetime('now') WHERE name = ?") as any,
};

// ── Helper functions ────────────────────────────────────────

/**
 * Manually populate the FTS5 conversation_messages_fts table from conversation_messages.
 * This is useful for rebuilding the index if it becomes corrupted or for admin operations.
 * @returns Number of messages indexed
 */
export function populateConversationMessagesFts(): number {
    // Clear existing FTS data
    db.exec('DELETE FROM conversation_messages_fts');

    // Repopulate from conversation_messages
    db.exec(`INSERT INTO conversation_messages_fts(id, conversation_id, content)
        SELECT id, conversation_id, content FROM conversation_messages`);

    const result = db.prepare('SELECT COUNT(*) as count FROM conversation_messages_fts').get() as { count: number };
    console.log(`[DB] FTS5 repopulated with ${result.count} messages`);
    return result.count;
}

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
