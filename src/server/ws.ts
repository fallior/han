/**
 * Claude Remote - WebSocket Module
 * Manages WebSocket server, connections, heartbeat, and broadcast helpers.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import type { Server as HTTPSServer } from 'https';

// ── Types ─────────────────────────────────────────────────

interface PromptMessage {
    type: 'prompts';
    prompts: unknown[];
    count: number;
}

interface TerminalMessage {
    type: 'terminal';
    content: string | null;
    session: string | null;
}

interface TaskUpdateMessage {
    type: 'task_update';
    task: unknown;
}

interface GoalUpdateMessage {
    type: 'goal_update';
    goal: unknown;
    tasks: unknown[];
}

interface ApprovalRequestMessage {
    type: 'approval_request';
    [key: string]: unknown;
}

interface ApprovalResolvedMessage {
    type: 'approval_resolved';
    id: string;
}

interface ProposalUpdateMessage {
    type: 'proposals_new';
    count: number;
}

interface TaskProgressMessage {
    type: 'task_progress';
    taskId: string;
    messageType: string;
    [key: string]: unknown;
}

interface SDKMessage {
    type: string;
    message?: {
        content?: Array<{ type: string; text?: string }>;
    };
    tool_name?: string;
    tool_input_summary?: string;
    subtype?: string;
    result?: unknown;
    total_cost_usd?: number;
    duration_ms?: number;
    num_turns?: number;
}

interface InitialState {
    prompts: unknown[];
    terminal: { content: string | null; session: string | null };
}

type GetInitialStateFn = () => InitialState;

interface AliveWebSocket extends WebSocket {
    isAlive: boolean;
}

// ── Module state ──────────────────────────────────────────

let wss: WebSocketServer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ───────────────────────────────────────────────

/**
 * Send a JSON string to all connected clients with readyState OPEN.
 */
export function broadcast(data: Record<string, unknown>): void {
    if (!wss || wss.clients.size === 0) return;

    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ── Public API ────────────────────────────────────────────

/**
 * Create the WebSocket server bound to an existing HTTP(S) server.
 * Sets up connection handling and heartbeat ping/pong.
 */
export function createWebSocketServer(
    httpServer: HTTPServer | HTTPSServer,
    getInitialState: GetInitialStateFn
): WebSocketServer {
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    // Connection handling
    wss.on('connection', (ws: AliveWebSocket) => {
        console.log('WebSocket client connected');

        // Send current state immediately
        const state = getInitialState();

        ws.send(JSON.stringify({
            type: 'prompts',
            prompts: state.prompts,
            count: state.prompts.length
        } satisfies PromptMessage));

        if (state.terminal.content !== null) {
            ws.send(JSON.stringify({
                type: 'terminal',
                content: state.terminal.content,
                session: state.terminal.session
            } satisfies TerminalMessage));
        } else {
            ws.send(JSON.stringify({ type: 'terminal', content: null, session: null } satisfies TerminalMessage));
        }

        // Heartbeat
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
        });
    });

    // Heartbeat interval -- detect dead connections (iOS Safari drops silently)
    heartbeatTimer = setInterval(() => {
        if (!wss) return;
        wss.clients.forEach((ws) => {
            const aws = ws as AliveWebSocket;
            if (aws.isAlive === false) return aws.terminate();
            aws.isAlive = false;
            aws.ping();
        });
    }, 30000);

    return wss;
}

/**
 * Broadcast current prompts to all connected WebSocket clients.
 */
export function broadcastPrompts(prompts: unknown[]): void {
    broadcast({ type: 'prompts', prompts, count: prompts.length });
}

/**
 * Broadcast terminal content to all connected clients.
 */
export function broadcastTerminal(content: string | null, session: string | null): void {
    broadcast({ type: 'terminal', content, session });
}

/**
 * Broadcast a task status update.
 */
export function broadcastTaskUpdate(task: unknown): void {
    broadcast({ type: 'task_update', task });
}

/**
 * Broadcast a goal update (goal + its tasks).
 */
export function broadcastGoalUpdate(goal: unknown, tasks?: unknown[]): void {
    broadcast({ type: 'goal_update', goal, tasks: tasks ?? [] });
}

/**
 * Broadcast an approval request to the phone.
 */
export function broadcastApprovalRequest(approval: Record<string, unknown>): void {
    broadcast({ type: 'approval_request', ...approval });
}

/**
 * Broadcast that an approval has been resolved.
 */
export function broadcastApprovalResolved(id: string): void {
    broadcast({ type: 'approval_resolved', id });
}

/**
 * Broadcast new proposals notification.
 */
export function broadcastProposalUpdate(count?: number): void {
    if (!wss || wss.clients.size === 0) return;
    broadcast({ type: 'proposals_new', count: count ?? 0 });
}

/**
 * Broadcast task progress (streaming SDK messages).
 */
export function broadcastTaskProgress(taskId: string, sdkMessage: SDKMessage): void {
    if (!wss || wss.clients.size === 0) return;

    // Extract the useful bits from the SDK message
    const progress: Record<string, unknown> = { taskId, messageType: sdkMessage.type };

    if (sdkMessage.type === 'assistant') {
        // Full assistant message -- extract text content
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

    broadcast({ type: 'task_progress', ...progress });
}

/**
 * Return the underlying WebSocketServer instance.
 */
export function getWSS(): WebSocketServer | null {
    return wss;
}

/**
 * Stop the heartbeat interval (for clean shutdown).
 */
export function stopHeartbeat(): void {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}
