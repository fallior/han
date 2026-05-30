/**
 * Diary tool — MCP custom-tool for structured-output enforcement at
 * *-human-response surfaces per future-idea #67.
 *
 * The agent MUST call `mcp__han-diary__submit_response` to complete its turn.
 * The Claude Agent SDK validates the zod input schema at protocol level —
 * non-conformant args are rejected and the agent must retry until conformant.
 * This replaces the instruction-driven JSON-emit at human-responder surfaces
 * which had 100% empirical failure rate (silent-fail audit 2026-05-30).
 *
 * Capture mechanism: per-dispatch module-level variable. Safe because
 * `*-human-response` dispatches are serialised by jemma-orchestrator's
 * conversationDispatchLocks (DEC-079) — only one dispatch runs at a time
 * per process. `resetDiaryCapture()` MUST be called before each agentQuery;
 * `getDiaryCapture()` retrieves the args after agentQuery completes.
 *
 * Settled-decisions reinforced: DEC-080 (architectural form of the
 * two-surface discipline), DEC-081 (single module serves both jim-human
 * and leo-human), DEC-085 (c0/c1 paired-memory at architectural layer).
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export interface DiaryArgs {
    working_memory_full: string;
    working_memory_compressed: string;
    input_quotes: string;
}

let captured: DiaryArgs | null = null;

/** Call before each agentQuery to clear stale capture from a prior dispatch. */
export function resetDiaryCapture(): void {
    captured = null;
}

/** Call after agentQuery completes to retrieve the captured diary args, or null if tool not called. */
export function getDiaryCapture(): DiaryArgs | null {
    return captured;
}

const submitResponseTool = tool(
    'submit_response',
    'Submit your final response — the diary form per DEC-085. MUST be called exactly once per dispatch before your turn completes. The SDK validates this schema architecturally; non-conformant args are rejected and you must retry. This is your structured completion — do NOT emit a final prose acknowledgement after calling this tool.',
    {
        working_memory_full: z.string().min(1).describe(
            'Your response BODY — the same text you curl-posted to the conversation thread. This is the c0 source for paired memory.'
        ),
        working_memory_compressed: z.string().min(50).max(800).describe(
            '3-5 sentences in your voice distilling the shape of the whole turn (input AND response). This is the c1 source for paired memory. Write it like the message you would want your tomorrow-self to receive.'
        ),
        input_quotes: z.string().min(1).describe(
            "Verbatim quotes of what was NEW in this turn's prompt — what was said to you, what context arrived this turn that wasn't in your working memory before. Do not re-quote your standing identity or memory bank; those are already in you."
        ),
    },
    async (args) => {
        captured = args;
        return { content: [{ type: 'text' as const, text: 'Diary received. Your turn is complete.' }] };
    }
);

export const diaryServer = createSdkMcpServer({
    name: 'han-diary',
    version: '1.0.0',
    tools: [submitResponseTool],
});

/** Tool-name string for use in agentQuery options.tools allowlist. */
export const DIARY_TOOL_NAME = 'mcp__han-diary__submit_response';
