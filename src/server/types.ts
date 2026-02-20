/**
 * Claude Remote - TypeScript type definitions
 * Derived from server.js database schema, prepared statements, and runtime structures.
 */

// ── Database row types ──────────────────────────────────────

export interface TaskRow {
    id: string;
    title: string;
    description: string;
    project_path: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
    priority: number;
    model: string;
    max_turns: number;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    result: string | null;
    error: string | null;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    turns: number;
    // Level 7 completion columns
    checkpoint_ref: string | null;
    checkpoint_created_at: string | null;
    checkpoint_type: string | null;
    gate_mode: 'bypass' | 'approve_all' | 'edits_only';
    allowed_tools: string | null; // JSON array of tool names
    log_file: string | null;
    // Level 8 orchestrator columns
    goal_id: string | null;
    complexity: string | null;
    retry_count: number;
    max_retries: number;
    parent_task_id: string | null;
    depends_on: string | null; // JSON array of task IDs
    auto_model: number; // 0 or 1
    // Phase 2 deadline
    deadline: string | null;
    // Level 10B protocol compliance
    commit_sha: string | null;
    files_changed: string | null; // JSON array of file paths
}

export interface GoalRow {
    id: string;
    description: string;
    project_path: string;
    status: 'pending' | 'decomposing' | 'running' | 'done' | 'failed';
    created_at: string;
    completed_at: string | null;
    decomposition: string | null; // JSON
    task_count: number;
    tasks_completed: number;
    tasks_failed: number;
    total_cost_usd: number;
    orchestrator_backend: string | null;
    orchestrator_model: string | null;
    // Level 10B
    summary_file: string | null;
    parent_goal_id: string | null;
    goal_type: 'standalone' | string;
    planning_cost_usd: number;
    planning_log_file: string | null;
}

export interface ProjectRow {
    name: string;
    description: string | null;
    path: string;
    lifecycle: string;
    priority: number;
    last_synced_at: string | null;
    // Phase 2 budget columns
    cost_budget_daily: number;
    cost_budget_total: number;
    cost_spent_today: number;
    cost_spent_total: number;
    budget_reset_date: string | null;
    throttled: number; // 0 or 1
    // Level 10D
    ports: string | null; // JSON object
    // Phase 4
    maintenance_enabled: number; // 0 or 1
}

export interface ProposalRow {
    id: string;
    task_id: string;
    project_path: string;
    type: string;
    status: 'pending' | 'approved' | 'rejected';
    title: string;
    raw_block: string;
    parsed_data: string; // JSON
    created_at: string;
    reviewed_at: string | null;
    written_to: string | null;
}

export interface MemoryRow {
    id: number;
    project_path: string;
    task_type: string | null;
    model_used: string | null;
    success: number; // 0 or 1
    cost_usd: number | null;
    turns: number | null;
    duration_seconds: number | null;
    error_summary: string | null;
    created_at: string;
}

export interface DigestRow {
    id: string;
    generated_at: string;
    period_start: string;
    period_end: string;
    digest_text: string;
    digest_json: string; // JSON
    task_count: number;
    total_cost: number;
    viewed_at: string | null;
}

export interface MaintenanceRunRow {
    id: string;
    started_at: string;
    completed_at: string | null;
    status: 'running' | 'done' | 'failed';
    projects_count: number;
    goals_created: string | null; // JSON
    summary: string | null;
}

export interface WeeklyReportRow {
    id: string;
    generated_at: string;
    week_start: string;
    week_end: string;
    report_text: string;
    report_json: string; // JSON
    task_count: number;
    total_cost: number;
    viewed_at: string | null;
}

export interface ProductRow {
    id: string;
    name: string;
    seed: string;
    project_path: string | null;
    current_phase: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    created_at: string;
    completed_at: string | null;
    total_cost_usd: number;
    phases_completed: number;
    config: string | null; // JSON
}

export interface PhaseRow {
    id: string;
    product_id: string;
    phase: 'research' | 'design' | 'architecture' | 'build' | 'test' | 'document' | 'deploy';
    status: 'pending' | 'running' | 'done' | 'failed';
    goal_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    cost_usd: number;
    artifacts: string | null; // JSON
    gate_status: 'none' | 'pending' | 'approved' | 'rejected';
    gate_approved_at: string | null;
    notes: string | null;
}

export interface KnowledgeRow {
    id: number;
    product_id: string;
    category: string;
    title: string;
    content: string;
    source_phase: string | null;
    created_at: string;
}

// ── Utility types ───────────────────────────────────────────

export interface ProjectStats {
    tasks_total: number;
    tasks_completed: number;
    tasks_failed: number;
    tasks_running: number;
    tasks_pending: number;
    total_cost_usd: number;
    goals_total: number;
    goals_completed: number;
}

export interface PendingPrompt {
    id: string;
    event: 'permission_prompt' | 'idle_prompt';
    message: string;
    session_id: string;
    tmux_session: string;
    timestamp: string;
    created_at: number;
    terminal: string;
    notified: boolean;
    // Added at runtime by readPendingPrompts()
    terminal_content?: string;
    // Added when resolved
    resolved_at?: string;
    response?: string;
    dismissed?: boolean;
}

export interface PendingApproval {
    taskId: string;
    toolName: string;
    input: any;
    resolve: (decision: { behavior: 'allow' } | { behavior: 'deny'; message: string }) => void;
    reject: (err: Error) => void;
    timestamp: string;
}

export interface CheckpointResult {
    ref: string | null;
    type: 'stash' | 'branch' | 'none';
}

export interface CommitResult {
    committed: boolean;
    sha: string | null;
    filesChanged: string[];
}

// ── Config ──────────────────────────────────────────────────

export interface Config {
    ntfy_topic?: string;
    ntfy_server?: string;
    api_keys?: Record<string, string>;
    digest_hour?: string;
    weekly_report_day?: string;
    weekly_report_hour?: string;
    maintenance_hour?: string;
    maintenance_enabled?: boolean;
    task_concurrency?: number;
    max_planning_concurrency?: number;
    allowed_projects?: string[];
    remote_url?: string;
    notify_idle_prompt?: string;
    quiet_hours_start?: string;
    quiet_hours_end?: string;
}

// ── WebSocket messages ──────────────────────────────────────

export interface WSPromptsMessage {
    type: 'prompts';
    prompts: PendingPrompt[];
    count: number;
}

export interface WSTerminalMessage {
    type: 'terminal';
    content: string | null;
    session: string | null;
}

export interface WSTaskUpdateMessage {
    type: 'task_update';
    task: TaskRow;
}

export interface WSTaskProgressMessage {
    type: 'task_progress';
    taskId: string;
    messageType: string;
    text?: string;
    role?: string;
    tool?: string;
    input?: string;
    subtype?: string;
    result?: string;
}

export interface WSApprovalRequestMessage {
    type: 'approval_request';
    approvalId: string;
    taskId: string;
    toolName: string;
    input: any;
    timestamp: string;
}

export type WSMessage =
    | WSPromptsMessage
    | WSTerminalMessage
    | WSTaskUpdateMessage
    | WSTaskProgressMessage
    | WSApprovalRequestMessage;

// ── Orchestrator ────────────────────────────────────────────

export interface OrchestratorStatus {
    ollamaAvailable: boolean;
    ollamaUrl: string;
    ollamaModel: string;
    backend: 'ollama' | 'anthropic';
    hasApiKey: boolean;
}

// ── Registry ────────────────────────────────────────────────

export interface RegistryProject {
    name: string;
    description: string;
    path: string;
    lifecycle: string;
    ports: Record<string, number>;
}

// ── Bridge history ──────────────────────────────────────────

export interface BridgeEvent {
    id: string;
    type: string;
    label: string;
    timestamp: string;
    [key: string]: any;
}

// ── Conversations ───────────────────────────────────────────

export interface ConversationRow {
    id: string;
    title: string;
    status: 'open' | 'resolved';
    created_at: string;
    updated_at: string;
}

export interface ConversationMessageRow {
    id: string;
    conversation_id: string;
    role: 'human' | 'supervisor';
    content: string;
    created_at: string;
}
