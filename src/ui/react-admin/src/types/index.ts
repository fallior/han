/**
 * Hortus Arbor Nostra — React Admin UI Type Definitions
 *
 * These types match the actual server-side data shapes from:
 * - src/server/types.ts (TaskRow, GoalRow, ConversationRow, etc.)
 * - src/server/ws.ts (WebSocket message types)
 * - src/server/routes/conversations.ts (API response shapes)
 * - src/server/services/supervisor-worker.ts (supervisor broadcast shapes)
 */

// ── Core Domain Types ──────────────────────────────────────

export interface Task {
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
    checkpoint_ref: string | null;
    checkpoint_created_at: string | null;
    checkpoint_type: string | null;
    gate_mode: 'bypass' | 'approve_all' | 'edits_only';
    allowed_tools: string | null; // JSON array of tool names
    log_file: string | null;
    goal_id: string | null;
    complexity: string | null;
    retry_count: number;
    max_retries: number;
    parent_task_id: string | null;
    depends_on: string | null; // JSON array of task IDs
    auto_model: number; // 0 or 1
    deadline: string | null;
    commit_sha: string | null;
    files_changed: string | null; // JSON array of file paths
}

export interface Goal {
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
    summary_file: string | null;
    parent_goal_id: string | null;
    goal_type: 'standalone' | string;
    planning_cost_usd: number;
    planning_log_file: string | null;
}

/**
 * Conversation — Base type from conversations table
 * Note: API responses include computed fields like message_count
 */
export interface Conversation {
    id: string;
    title: string;
    discussion_type: string | null; // e.g. 'general', 'episodic', 'dreams', etc.
    status: 'open' | 'resolved';
    created_at: string;
    updated_at: string;
    archived_at: string | null;
    summary?: string;
    topics?: string; // JSON array of topic strings
    key_moments?: string;
    // Computed fields (added by SQL query in conversations.ts:131-140)
    message_count?: number;
    participants?: string; // GROUP_CONCAT of roles
}

/**
 * Message — From conversation_messages table
 * Note: role includes 'leo' in practice (see db.ts:564 getPending query)
 */
export interface Message {
    id: string;
    conversation_id: string;
    role: 'human' | 'supervisor' | 'leo';
    content: string;
    created_at: string;
}

// ── WebSocket Message Types ────────────────────────────────

/**
 * Supervisor cycle completion broadcast
 * Source: supervisor-worker.ts:2143-2154
 * Note: data is a NESTED object
 */
export interface WsSupervisorCycleMessage {
    type: 'supervisor_cycle';
    data: {
        cycleId: string;
        cycleNumber: number;
        cycle_type: string;
        observations: string[];
        actions: Array<{ type: string; detail: string }>;
        reasoning: string;
        cost_usd: number;
    };
}

/**
 * Supervisor action broadcast (during cycle execution)
 * Source: supervisor-worker.ts:1444-1446, 1517-1519
 */
export interface WsSupervisorActionMessage {
    type: 'supervisor_action';
    data: {
        action: string;
        detail: string;
        cycleId: string;
    };
}

/**
 * New conversation message broadcast
 * Source: conversations.ts:407-412
 * Note: message is a NESTED object
 */
export interface WsConversationMessage {
    type: 'conversation_message';
    conversation_id: string;
    discussion_type: string;
    message: Message;
}

/**
 * Task status update broadcast
 * Source: ws.ts:238, types.ts:275-278
 */
export interface WsTaskUpdateMessage {
    type: 'task_update';
    task: Task;
}

/**
 * Task progress (streaming from Agent SDK)
 * Source: ws.ts:280-290
 */
export interface WsTaskProgressMessage {
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

/**
 * Goal update broadcast (goal + tasks)
 * Source: ws.ts:245, types.ts:32-36
 */
export interface WsGoalUpdateMessage {
    type: 'goal_update';
    goal: Goal;
    tasks: Task[];
}

/**
 * Terminal output broadcast
 * Source: types.ts:269-273
 */
export interface WsTerminalMessage {
    type: 'terminal';
    content: string | null;
    session: string | null;
}

/**
 * Approval request from autonomous task
 * Source: types.ts:292-299
 */
export interface WsApprovalRequestMessage {
    type: 'approval_request';
    approvalId: string;
    taskId: string;
    toolName: string;
    input: any;
    timestamp: string;
}

/**
 * Pending prompts list
 * Source: types.ts:263-267
 */
export interface WsPromptsMessage {
    type: 'prompts';
    prompts: Array<{
        id: string;
        title: string;
        message: string;
        timestamp: string;
    }>;
    count: number;
}

/**
 * Union of all WebSocket message types
 */
export type WsMessage =
    | WsSupervisorCycleMessage
    | WsSupervisorActionMessage
    | WsConversationMessage
    | WsTaskUpdateMessage
    | WsTaskProgressMessage
    | WsGoalUpdateMessage
    | WsTerminalMessage
    | WsApprovalRequestMessage
    | WsPromptsMessage;
