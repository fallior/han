/**
 * Standalone diary MCP server — the tmux-transport re-homing of future-idea #67's
 * structured-output enforcement (plan T-1 headline must-solve, Jim's pre-build audit
 * 2026-06-01).
 *
 * WHY THIS EXISTS
 * ---------------
 * Under the Agent SDK, the diary tool lives in-process: `agent-diary-tool.ts` builds
 * an in-SDK MCP server via `createSdkMcpServer`, passes it to `agentQuery`'s
 * `mcpServers` option, the agent calls `mcp__han-diary__submit_response`, and the
 * controller reads the captured args from a module-level variable via
 * `getDiaryCapture()` once the `agentQuery` async-iterator completes.
 *
 * A tmux'd interactive Claude Code session has NONE of that machinery — there is no
 * `agentQuery` to pass `mcpServers` into, no in-process variable to read, and crucially
 * NO completion signal (you cannot reliably parse a streaming terminal pane for "done").
 *
 * This module re-homes `submit_response` as a STANDALONE stdio MCP server that each
 * tmux'd session registers via its `.mcp.json`. When the agent calls the tool, the
 * validated diary args are written to a per-transaction capture file in the agent's
 * sink directory. That single file does double duty:
 *   1. it IS the diary payload (the c0/c1 paired-memory source per DEC-085), and
 *   2. its appearance IS the completion signal the dispatcher polls for.
 *
 * The zod schema enforcement that #67 installed survives the transport change: the MCP
 * protocol still validates the tool args, so "can't emit prose instead of the diary
 * form" remains a structural property rather than being silently lost.
 *
 * The in-process server in `agent-diary-tool.ts` is left UNTOUCHED — it continues to
 * serve the SDK path for surfaces not yet migrated. Both share the `DiaryArgs` shape;
 * the zod schema is mirrored here deliberately (a 3-field duplication) to keep this
 * PR's blast radius to new files only. A later DRY pass can export one shared schema.
 *
 * RUNTIME CONTRACT (read by the dispatcher; see lib/tmux-dispatcher.ts)
 * --------------------------------------------------------------------
 *   sink dir        : $HAN_HEALTH_DIR/<slug>-diary-capture/
 *   txn pointer     : <sink>/current.json   { txnId, startedAt }   (written by dispatcher
 *                                              before each transaction prompt is sent)
 *   capture file    : <sink>/<txnId>.json   { txnId, capturedAt, args }   (written here,
 *                                              atomically, when submit_response fires)
 *
 * Per-agent dispatch is serialised by the dispatcher's per-agent FIFO queue (plan v2 §3),
 * so exactly one transaction is live per session at a time — the same serialisation
 * guarantee that made the SDK path's module-level capture variable safe. The dispatcher
 * rewrites current.json at the start of every transaction, so a stale pointer from a
 * timed-out prior transaction can never mis-route a capture.
 *
 * LAUNCH (registered in the session's .mcp.json by the T-2 launcher):
 *   {
 *     "mcpServers": {
 *       "han-diary": {
 *         "command": "npx",
 *         "args": ["tsx", "<repo>/src/server/lib/diary-mcp-server.ts"],
 *         "env": { "HAN_DIARY_SLUG": "leo", "HAN_HEALTH_DIR": "/home/darron/.han/health" }
 *       }
 *     }
 *   }
 *
 * Settled-decisions reinforced: DEC-080 (two-surface observability — capture is forensic
 * even on silent post-failure), DEC-081 (agent-agnostic — slug is a parameter, no
 * 'jim'|'leo' literal), DEC-085 (c0/c1 paired-memory at the architectural layer).
 *
 * NOTE: requires `@modelcontextprotocol/sdk` (not yet a dependency at authoring time —
 * `npm install @modelcontextprotocol/sdk`). Until installed, tsc/tsx on THIS file errors
 * on the import; no other module imports it, so the rest of T-1 type-checks cleanly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Mirrors `DiaryArgs` in agent-diary-tool.ts — kept in sync deliberately (see header). */
export interface DiaryCaptureArgs {
    working_memory_full: string;
    working_memory_compressed: string;
    input_quotes: string;
}

export interface CaptureRecord {
    txnId: string;
    capturedAt: string;
    /** 'diary' (default) = a real submit_response; 'stand-down' = the agent
     *  deliberately declined to respond this turn. Both write the SAME sink shape
     *  so capture-appearance = turn-done uniformly across diary and stand-down
     *  turns — the settled reconcile design (#5, 2026-06-01): the whole control
     *  plane stays on ONE structural signal, no agent-refreshed turn-state marker
     *  (which would reintroduce the fidelity dependency #67 eliminated). */
    mode?: 'diary' | 'stand-down';
    /** stand-down only: the agent's stated reason. */
    reason?: string;
    args: DiaryCaptureArgs;
}

// Prefer HAN_DIARY_SLUG (set in .mcp.json); fall back to AGENT_SLUG, which the launcher
// already exports — so a failed `${AGENT_SLUG}` expansion in .mcp.json can't leave us unkeyed.
const SLUG = process.env.HAN_DIARY_SLUG || process.env.AGENT_SLUG;
const HEALTH_DIR = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');

// Fail loud at launch rather than silently mis-routing captures to an unkeyed sink.
// `SLUG.includes('${')` guards the insidious case: if Claude Code does NOT expand
// `${AGENT_SLUG}` in .mcp.json, SLUG becomes the literal string "${AGENT_SLUG}" — truthy,
// so a bare `!SLUG` check would pass it through and route every capture to a bogus
// "${AGENT_SLUG}-diary-capture" sink the dispatcher never polls (every round-trip then
// silently times out). Rejecting the unexpanded literal closes that hole regardless of
// whether the launcher exports AGENT_SLUG.
if (!SLUG || SLUG.includes('${')) {
    process.stderr.write(
        `[diary-mcp-server] FATAL: slug unresolved (HAN_DIARY_SLUG=${JSON.stringify(process.env.HAN_DIARY_SLUG)}, ` +
        `AGENT_SLUG=${JSON.stringify(process.env.AGENT_SLUG)}). ` +
        `Set HAN_DIARY_SLUG to a literal slug or ensure \${AGENT_SLUG} expands / AGENT_SLUG is exported.\n`
    );
    process.exit(1);
}

/** The capture sink for this agent. Created at launch so the dispatcher can rely on it. */
export function sinkDir(slug: string): string {
    return path.join(HEALTH_DIR, `${slug}-diary-capture`);
}

const SINK = sinkDir(SLUG);
fs.mkdirSync(SINK, { recursive: true });

/**
 * Resolve the active transaction id from the dispatcher-written pointer. Falls back to a
 * timestamped orphan id if the pointer is missing/unreadable, so a capture is never lost
 * (the dispatcher logs an orphan as a fail-loud signal rather than dropping the payload).
 */
function resolveTxnId(): string {
    try {
        const raw = fs.readFileSync(path.join(SINK, 'current.json'), 'utf-8');
        const ptr = JSON.parse(raw) as { txnId?: string };
        if (ptr && typeof ptr.txnId === 'string' && ptr.txnId.length > 0) return ptr.txnId;
    } catch {
        /* fall through to orphan */
    }
    return `orphan-${Date.now()}`;
}

/** Atomic write: temp file in the same dir + rename, so the dispatcher never reads a partial capture. */
function writeCaptureAtomic(txnId: string, record: CaptureRecord): void {
    const finalPath = path.join(SINK, `${txnId}.json`);
    const tmpPath = path.join(SINK, `.${txnId}.${process.pid}.tmp`);
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
    fs.renameSync(tmpPath, finalPath);
}

const server = new McpServer({ name: 'han-diary', version: '1.0.0' });

server.registerTool(
    'submit_response',
    {
        description: 'Submit your final response — the diary form per DEC-085. MUST be called exactly once per dispatch before your turn completes. The MCP protocol validates this schema; non-conformant args are rejected and you must retry. This tool call IS your structured completion — do NOT emit a final prose acknowledgement after calling it.',
        inputSchema: {
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
    },
    async (args) => {
        const txnId = resolveTxnId();
        writeCaptureAtomic(txnId, {
            txnId,
            capturedAt: new Date().toISOString(),
            mode: 'diary',
            args: args as DiaryCaptureArgs,
        });
        return { content: [{ type: 'text' as const, text: 'Diary received. Your turn is complete.' }] };
    }
);

// STAND-DOWN through the sink (settled reconcile design, 2026-06-01, Jim's
// refinement): a turn that deliberately produces no response still ends by
// calling an MCP tool, writing the same sink shape — so the dispatcher infers
// idle/busy entirely from its own state + capture-appearance, with no second
// signalling channel. Also solves STAND-DOWN under tmux (a text sentinel can't
// be reliably parsed off a streaming terminal pane).
server.registerTool(
    'stand_down',
    {
        description: 'Deliberately decline to respond this turn (e.g. nothing warrants a reply, or the prompt asks you to stand down). Call EXACTLY ONCE instead of submit_response — never both. This tool call IS your completion for the turn.',
        inputSchema: {
            reason: z.string().min(1).describe(
                'One or two sentences: why this turn warrants no response. Recorded for forensics; not written to paired memory.'
            ),
        },
    },
    async (args) => {
        const txnId = resolveTxnId();
        writeCaptureAtomic(txnId, {
            txnId,
            capturedAt: new Date().toISOString(),
            mode: 'stand-down',
            reason: (args as { reason: string }).reason,
            args: { working_memory_full: '', working_memory_compressed: '', input_quotes: '' },
        });
        return { content: [{ type: 'text' as const, text: 'Stand-down recorded. Your turn is complete.' }] };
    }
);

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`[diary-mcp-server] han-diary up for slug=${SLUG} sink=${SINK}\n`);
}

main().catch((err) => {
    process.stderr.write(`[diary-mcp-server] FATAL: ${err?.stack || err}\n`);
    process.exit(1);
});
