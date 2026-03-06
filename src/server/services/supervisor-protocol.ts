/**
 * Message protocol for supervisor worker thread communication
 *
 * This defines the type-safe message exchange between the main Express process
 * and the supervisor worker thread. The worker runs the blocking Agent SDK calls
 * while the main process stays responsive to HTTP/WebSocket requests.
 */

// ============================================================================
// Messages: Main → Worker
// ============================================================================

export interface RunCycleMessage {
  type: 'run_cycle';
  /** When true, Darron posted a message — run a full supervisor cycle regardless of phase */
  humanTriggered?: boolean;
}

export interface AbortMessage {
  type: 'abort';
}

export interface ShutdownMessage {
  type: 'shutdown';
}

export type MainToWorkerMessage =
  | RunCycleMessage
  | AbortMessage
  | ShutdownMessage;

// ============================================================================
// Messages: Worker → Main
// ============================================================================

export interface CycleStartedMessage {
  type: 'cycle_started';
  cycleId: string;
  cycleNumber: number;
  cycleType: 'supervisor' | 'personal' | 'dream';
}

export interface CycleCompleteMessage {
  type: 'cycle_complete';
  result: {
    cycleId: string;
    observations: Array<{
      source: string;
      content: string;
      priority?: 'high' | 'medium' | 'low';
    }>;
    actionSummaries: string[];
    costUsd: number;
    nextDelayMs: number;
  };
}

export interface CycleSkippedMessage {
  type: 'cycle_skipped';
  reason: string;
}

export interface CycleFailedMessage {
  type: 'cycle_failed';
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface BroadcastMessage {
  type: 'broadcast';
  payload: {
    type: 'supervisor_action' | 'supervisor_cycle' | 'conversation_message' | 'strategic_proposal' | 'task_update' | 'system_event';
    data: any;
  };
}

export interface LogMessage {
  type: 'log';
  level: 'log' | 'error' | 'warn' | 'info' | 'debug';
  message: string;
  args?: any[];
}

export interface ReadyMessage {
  type: 'ready';
}

export type WorkerToMainMessage =
  | CycleStartedMessage
  | CycleCompleteMessage
  | CycleSkippedMessage
  | CycleFailedMessage
  | BroadcastMessage
  | LogMessage
  | ReadyMessage;

// ============================================================================
// Type Guards
// ============================================================================

export function isMainToWorkerMessage(msg: any): msg is MainToWorkerMessage {
  return msg && typeof msg.type === 'string' &&
    ['run_cycle', 'abort', 'shutdown'].includes(msg.type);
}

export function isWorkerToMainMessage(msg: any): msg is WorkerToMainMessage {
  return msg && typeof msg.type === 'string' &&
    ['cycle_started', 'cycle_complete', 'cycle_skipped', 'cycle_failed', 'broadcast', 'log', 'ready'].includes(msg.type);
}
