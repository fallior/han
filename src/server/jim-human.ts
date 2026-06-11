#!/usr/bin/env npx tsx
/**
 * Jim/Human — Conversation Follow-Through Agent
 *
 * The version of Jim that faces humans directly. Faster than the supervisor
 * cycle (immediate response vs 10-30 min). Runs concurrently with the
 * supervisor — only memory writes are serialised.
 *
 * Separation of concerns:
 *   - Supervisor Jim: strategic cycles, task management, ecosystem oversight
 *   - Human Jim (this): conversation responses + Discord (outward-facing)
 *
 * Posts as 'supervisor' role for consistency with existing Jim posts.
 * Signal: jim-human-wake (separate from jim-wake to avoid supervisor conflicts).
 *
 * COST: Unlimited. Jim/Human has no per-cycle cost cap — same as Leo's CLI session.
 * Conversation responses should never be truncated by budget. (Darron, 2026-03-14)
 */

import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import Database from 'better-sqlite3';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { resolveChannelName, fetchDiscordContext, postToDiscord } from './services/discord';
import { appendPairedMemory } from './lib/memory-paired-writer';
import { parseTurnEntryStructured } from './lib/result-handlers';
import { diaryServer, resetDiaryCapture, getDiaryCapture, DIARY_TOOL_NAME } from './lib/agent-diary-tool';
import { loadTraversableGradient } from './lib/memory-gradient';
import { ensureSingleInstance } from './lib/pid-guard';
import { gateIdentityOrThrow } from './lib/identity-signing';
import { buildPrompt, PromptOverbudgetError } from './lib/prompt-builder';

// ── Config ────────────────────────────────────────────────────

const HOME = process.env.HOME || '/home/darron';
const HAN_DIR = path.join(HOME, '.han');
// Phase 5 followup: honour HAN_DB_PATH override; default flipped from
// tasks.db to gradient.db per DEC-080. Mirrors db.ts:32 pattern.
const DB_PATH = process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db');
const JIM_MEMORY_DIR = path.join(HAN_DIR, 'memory');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const JIM_HUMAN_AGENT_DIR = path.join(HAN_DIR, 'agents', 'Jim', 'Human');

const HEALTH_FILE = path.join(HEALTH_DIR, 'jim-human-health.json');
const SWAP_FILE = path.join(JIM_MEMORY_DIR, 'jim-human-swap.md');
const SWAP_FULL_FILE = path.join(JIM_MEMORY_DIR, 'jim-human-swap-full.md');
const WORKING_MEMORY_FILE = path.join(JIM_MEMORY_DIR, 'working-memory.md');
const WORKING_MEMORY_FULL_FILE = path.join(JIM_MEMORY_DIR, 'working-memory-full.md');

const SIGNAL_NAME = 'jim-human-wake';
// 2026-06-02: moved off the now-stale opus-4-6 → opus-4-8, with all HAN agent surfaces,
// per Darron — "the substrate does not change you." (opus-4-6 was also exiting code 1 on
// large buildPrompt loads; leo-human hit it first.) Slated to become config-driven via the
// per-agent/per-surface model registry.
// ⚠ Fable window (S169, Darron): substrate-test — revert head to 'claude-opus-4-8' after 22 Jun.
const MODEL_PREFERENCE = ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'sonnet', 'haiku'] as const;
const HEALTH_WRITE_INTERVAL_MS = 5 * 60 * 1000;


let activeModel: string = MODEL_PREFERENCE[0];
let responseCount = 0;
const startedAt = Date.now();

// ── Ensure directories ────────────────────────────────────────

function ensureDirectories(): void {
    for (const dir of [JIM_MEMORY_DIR, SIGNALS_DIR, HEALTH_DIR, JIM_HUMAN_AGENT_DIR]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    for (const f of [SWAP_FILE, SWAP_FULL_FILE]) {
        if (!fs.existsSync(f)) fs.writeFileSync(f, '');
    }
}

// ── Database ──────────────────────────────────────────────────

function getDb(): Database.Database {
    return new Database(DB_PATH, { readonly: false });
}

function logAgentUsage(resultMessage: any, context: string): void {
    try {
        const db = getDb();
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
        const cost = resultMessage?.total_cost_usd || 0;
        const tokensIn = resultMessage?.usage?.input_tokens || 0;
        const tokensOut = resultMessage?.usage?.output_tokens || 0;
        const turns = resultMessage?.num_turns || 0;
        db.prepare('INSERT INTO agent_usage (agent, timestamp, cost_usd, tokens_in, tokens_out, num_turns, model, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run('jim-human', new Date().toISOString(), cost, tokensIn, tokensOut, turns, activeModel, context);
        console.log(`[Jim/Human] Usage: $${cost.toFixed(4)}, ${tokensIn}in/${tokensOut}out, ${turns} turns`);
        db.close();
    } catch (err) {
        console.error('[Jim/Human] Failed to log usage:', (err as Error).message);
    }
}

function getRecentMessages(db: Database.Database, conversationId: string, limit = 60): Array<{ id: string; role: string; content: string; created_at: string }> {
    return db.prepare(`
        SELECT id, role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(conversationId, limit) as any[];
}

function getConversationTitle(db: Database.Database, conversationId: string): string {
    const row = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as any;
    return row?.title || 'Unknown conversation';
}

function postMessage(db: Database.Database, conversationId: string, content: string): string {
    const id = `jim-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'supervisor', ?, ?)
    `).run(id, conversationId, content, now);
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    // Notify server via HTTPS POST — single broadcast path to prevent React double-render.
    // Signal file backup removed S103: two broadcasts for the same message caused visual
    // duplication in React admin despite ID-based dedup in Zustand store.
    notifyServer(conversationId, id, 'supervisor', content, now);

    return id;
}

/** Notify the main server to broadcast this message via WebSocket to admin clients. */
function notifyServer(conversationId: string, messageId: string, role: string, content: string, createdAt: string): void {
    const body = JSON.stringify({ conversation_id: conversationId, message_id: messageId, role, content, created_at: createdAt });
    const req = https.request({
        hostname: '127.0.0.1',
        port: 3847,
        path: '/api/conversations/internal/broadcast',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: false,
    }, (res) => {
        if (res.statusCode !== 200) console.log(`[Jim/Human] Broadcast notify returned ${res.statusCode}`);
        res.resume();
    });
    req.on('error', (err) => console.log(`[Jim/Human] Broadcast notify failed: ${err.message}`));
    req.end(body);
}

/** Write broadcast signal for cross-process WebSocket notification. */
function writeBroadcastSignal(
    conversationId: string,
    discussionType: string,
    message: { id: string; conversation_id: string; role: string; content: string; created_at: string }
): void {
    try {
        const signal = JSON.stringify({
            type: 'conversation_message',
            conversation_id: conversationId,
            discussion_type: discussionType,
            message,
            timestamp: new Date().toISOString()
        });
        fs.writeFileSync(path.join(SIGNALS_DIR, 'ws-broadcast'), signal);
    } catch (err) {
        // Best effort — message is already in DB
        console.error('[Jim/Human] Failed to write broadcast signal:', (err as Error).message);
    }
}

// ── Memory ────────────────────────────────────────────────────


async function flushSwapToWorkingMemory(): Promise<void> {
    const compressed = fs.readFileSync(SWAP_FILE, 'utf-8').trim();
    const full = fs.readFileSync(SWAP_FULL_FILE, 'utf-8').trim();

    if (!compressed && !full) return;

    // #49 (S153, 2026-05-09): asymmetric swap content is the drift mode the
    // atomic paired-write helper exists to prevent. Detect upstream and
    // preserve swap state for retry rather than writing one side and clearing.
    if (!compressed || !full) {
        console.warn(
            `[Jim/Human] Asymmetric swap content; skipping flush ` +
            `(compressed=${compressed.length}c, full=${full.length}c). ` +
            `Swap preserved for retry. #53 drift signal will fire next fs.watch event.`,
        );
        return;
    }

    try {
        await appendPairedMemory(
            'jim',
            '\n' + full + '\n',
            '\n' + compressed + '\n',
            { source: 'jim-human-flush' },
        );
        console.log(`[Jim/Human] Flushed swap → working memory (${compressed.length}c/${full.length}f chars)`);

        fs.writeFileSync(SWAP_FILE, '');
        fs.writeFileSync(SWAP_FULL_FILE, '');
    } catch (err) {
        console.error(`[Jim/Human] Flush failed; swap preserved for retry: ${(err as Error).message}`);
    }
}

function appendSwap(compressed: string, full: string): void {
    if (compressed) fs.appendFileSync(SWAP_FILE, compressed + '\n');
    if (full) fs.appendFileSync(SWAP_FULL_FILE, full + '\n');
}

// ── Health ─────────────────────────────────────────────────────

function writeHealth(lastError: string | null = null): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        fs.writeFileSync(HEALTH_FILE, JSON.stringify({
            agent: 'jim-human',
            pid: process.pid,
            timestamp: new Date().toISOString(),
            status: lastError ? 'error' : 'ok',
            lastError,
            responses: responseCount,
            uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
        }, null, 2));
    } catch { /* best effort */ }
}

// ── Model resolution ──────────────────────────────────────────

async function resolveModel(): Promise<string> {
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    for (const model of MODEL_PREFERENCE) {
        try {
            const q = agentQuery({
                prompt: 'Reply with exactly: ok',
                options: {
                    model,
                    maxTurns: 1,
                    cwd: JIM_HUMAN_AGENT_DIR,
                    permissionMode: 'bypassPermissions',
                    allowDangerouslySkipPermissions: true,
                    env: cleanEnv,
                    persistSession: false,
                    tools: [],
                },
            });
            for await (const msg of q) {
                if (msg.type === 'result' && msg.subtype === 'success') {
                    if (model !== activeModel) {
                        console.log(`[Jim/Human] Model: ${activeModel} → ${model}`);
                    }
                    activeModel = model;
                    return model;
                }
            }
        } catch {
            console.log(`[Jim/Human] Model ${model} unavailable — trying next`);
        }
    }
    return activeModel;
}

// ── Signal handling ───────────────────────────────────────────

interface SignalData {
    source?: string;
    conversationId?: string;
    channelId?: string;
    channelName?: string;
    author?: string;
    mentionedAt?: string;
    messagePreview?: string;
    reason?: string;
    content?: string;
    timestamp?: string;
    channel?: string;
    confidence?: number;
    // Phase 1 orchestration (DEC-077 follow-on). Spec: services/jemma-orchestrator.ts header.
    // dispatchId present → write ~/.han/signals/jemma-ack-{id} at end so orchestrator advances.
    // priorAgentFailed present → surface in prompt as default-on acknowledgment.
    dispatchId?: string;
    priorAgentFailed?: { agent: string; reason: string; exit_reason: string };
}

/**
 * Write the orchestrator ack after we've finished processing. No-op when
 * dispatchId is absent (backward-compat with non-orchestrated wake paths).
 */
/**
 * S151: progress-aware watchdog support. While composing, emit a 'composing'
 * heartbeat ack every intervalMs so the orchestrator's watchdog reads our
 * last_progress_at and doesn't fire prematurely on long composes. Returns
 * a `stop()` function the caller MUST invoke (in a finally) when compose
 * completes — otherwise the timer leaks.
 */
function getComposeHeartbeatIntervalMs(): number {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(HAN_DIR, 'config.json'), 'utf8'));
        const v = cfg?.agents?.compose_heartbeat_interval_ms;
        if (typeof v === 'number' && v > 0) return v;
    } catch { /* fall through */ }
    return 30000;
}

function startHeartbeatAcks(dispatchId: string | undefined, agent: string): { stop: () => void } {
    if (!dispatchId) return { stop: () => { /* noop */ } };
    let seq = 0;
    const intervalMs = getComposeHeartbeatIntervalMs();
    const timer = setInterval(() => {
        seq++;
        try {
            const ackFile = path.join(SIGNALS_DIR, `jemma-ack-${dispatchId}-hb-${seq}`);
            fs.writeFileSync(ackFile, JSON.stringify({
                dispatchId,
                agent,
                status: 'composing',
                heartbeat_seq: seq,
                ack_written_at: new Date().toISOString(),
            }));
        } catch (err) {
            console.error(`[Jim/Human] Failed to write heartbeat ack ${seq} for ${dispatchId}:`, (err as Error).message);
        }
    }, intervalMs);
    return { stop: () => clearInterval(timer) };
}

function writeJemmaAck(
    dispatchId: string | undefined,
    agent: string,
    status: 'done' | 'failed' | 'stood_down',
    opts: { reason?: string; compose_duration_ms?: number; final_attempt_count?: number } = {},
): void {
    if (!dispatchId) return;
    try {
        const ackFile = path.join(SIGNALS_DIR, `jemma-ack-${dispatchId}`);
        fs.writeFileSync(ackFile, JSON.stringify({
            dispatchId,
            agent,
            status,
            reason: opts.reason,
            final_attempt_count: opts.final_attempt_count ?? 1,
            compose_duration_ms: opts.compose_duration_ms,
            ack_written_at: new Date().toISOString(),
        }));
    } catch (err) {
        console.error(`[Jim/Human] Failed to write jemma-ack for ${dispatchId}:`, (err as Error).message);
    }
}

function readSignal(): SignalData | null {
    const signalPath = path.join(SIGNALS_DIR, SIGNAL_NAME);
    try {
        if (!fs.existsSync(signalPath)) return null;
        const data = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
        fs.unlinkSync(signalPath);
        return data;
    } catch {
        try { fs.unlinkSync(signalPath); } catch { /* already gone */ }
        return null;
    }
}

// ── Response: Conversation ────────────────────────────────────

async function respondToConversation(db: Database.Database, conversationId: string, signal?: SignalData): Promise<void> {
    const title = getConversationTitle(db, conversationId);
    const dispatchId = signal?.dispatchId;
    const priorAgentFailed = signal?.priorAgentFailed;
    const composeStartMs = Date.now();
    let recentMessages = getRecentMessages(db, conversationId, 60).reverse();

    if (recentMessages.length === 0) {
        console.log(`[Jim/Human] No messages in "${title}" — skipping`);
        writeJemmaAck(dispatchId, 'jim', 'stood_down', { reason: 'no_messages', compose_duration_ms: Date.now() - composeStartMs });
        return;
    }

    // Check if the last human message is explicitly addressed to Leo only.
    // If Darron says "Leo" or "Hey Leo" without mentioning Jim, this one's not for us.
    const lastHumanMsg = recentMessages.filter(m => m.role === 'human').pop();
    if (lastHumanMsg) {
        const text = lastHumanMsg.content.toLowerCase();
        const mentionsJim = /\bjim\b|\bjimmy\b/.test(text);
        const mentionsLeo = /\bleo\b|\bleonhard\b/.test(text);
        if (mentionsLeo && !mentionsJim) {
            console.log(`[Jim/Human] Message addressed to Leo only in "${title}" — standing down`);
            writeJemmaAck(dispatchId, 'jim', 'stood_down', { reason: 'addressed_to_other_agent', compose_duration_ms: Date.now() - composeStartMs });
            return;
        }
    }

    // DEC-079 + S151 follow-on: all pre-compose dedup gates and the same-agent
    // file-claim are removed. Jemma's serial dispatch + per-conversation
    // serialisation (jemma-orchestrator.ts:236 conversationDispatchLocks) is
    // the structural guarantee that this agent is woken at most once per
    // dispatch. The single-instance pid-guard (ensureSingleInstance) prevents
    // multiple Jim processes. No belt-and-braces needed — if the dispatcher
    // fails, that's a separate problem to fix at the dispatch layer, not here.

    try {
        const conversationContext = recentMessages
            .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
            .join('\n\n---\n\n');

        // PR-AP8 (2026-05-22): respondToConversation prompt assembly via the
        // agnostic builder. Per DEC-087, prompt assembly is the builder's
        // responsibility. Pre-migration fallback retired; B1 contract
        // preserved (PromptOverbudgetError → writeJemmaAck failed + return).
        let agnosticSystemPrompt = '';
        let prompt = '';
        try {
            const built = buildPrompt('jim', 'jim-human-response', {
                source: 'conversation',
                title,
                conversationId,
                conversationContext,
                priorAgentFailed,
            });
            agnosticSystemPrompt = built.systemPrompt;
            prompt = built.userPrompt;
            console.log(`[Jim/Human] jim-human-response: ~${built.meta.est_total_tokens_chars_div_4} tokens (memory ${built.meta.memory_chars} chars, envelope=${built.meta.envelope})`);
        } catch (err) {
            if (err instanceof PromptOverbudgetError) {
                console.log(`[Jim/Human] Prompt over budget for "${title}" (${err.meta.est_total_tokens_chars_div_4} > ${err.meta.total_budget_tokens}) — skipping`);
                writeJemmaAck(dispatchId, 'jim', 'failed', {
                    reason: `prompt-build-overbudget: ${err.meta.est_total_tokens_chars_div_4}>${err.meta.total_budget_tokens}`,
                    compose_duration_ms: Date.now() - composeStartMs,
                });
                return;
            }
            throw err;
        }

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        // S151: emit 'composing' heartbeat-acks every N ms (config-driven, default 30s)
        // so the orchestrator's progress-aware watchdog won't fire prematurely on
        // long composes. stop() in finally ensures the timer always clears.
        const heartbeat = startHeartbeatAcks(dispatchId, 'jim');
        let resultMessage: any = null;
        // #67 (2026-05-30): structured-output enforcement via MCP custom tool.
        // Mirrors leo-human.ts. Per-dispatch serialisation via jemma-orchestrator (DEC-079).
        resetDiaryCapture();
        try {
            const q = agentQuery({
                prompt,
                options: {
                    model: activeModel,
                    maxTurns: 1000,
                    cwd: JIM_HUMAN_AGENT_DIR,
                    permissionMode: 'bypassPermissions',
                    allowDangerouslySkipPermissions: true,
                    env: cleanEnv,
                    persistSession: false,
                    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch', DIARY_TOOL_NAME],
                    mcpServers: { 'han-diary': diaryServer },
                    systemPrompt: {
                        type: 'preset' as const,
                        preset: 'claude_code' as const,
                        append: agnosticSystemPrompt,
                    },
                },
            });

            for await (const message of q) {
                if (message.type === 'result') resultMessage = message;
            }
        } finally {
            heartbeat.stop();
        }

        logAgentUsage(resultMessage, `conversation: ${title}`);

        const responseText = resultMessage?.result || '';
        const trimmed = responseText.trim();

        // #67 hotfix (2026-05-30 late): diary capture is the PRIMARY success
        // signal, not the final text. When the agent calls submit_response as
        // its terminal action, the final `result` text is empty — the original
        // v1 cascade routed empty text to "No meaningful response — skipping"
        // and dropped the captured diary payload. Mirrors leo-human.ts hotfix.
        const diaryArgs = getDiaryCapture();

        const composeStartIso = new Date(composeStartMs).toISOString();
        const computePostRef = (): { row: { id: string } | undefined; ref: string } => {
            const row = db.prepare(`
                SELECT id FROM conversation_messages
                WHERE conversation_id = ? AND role = ? AND created_at >= ?
                ORDER BY created_at DESC LIMIT 1
            `).get(conversationId, 'supervisor', composeStartIso) as { id: string } | undefined;
            return {
                row,
                ref: row ? `verified post id=${row.id}` : `NO CURL-POST DETECTED in DB`,
            };
        };

        if (trimmed.startsWith('STAND-DOWN:')) {
            const reason = trimmed.slice('STAND-DOWN:'.length).trim().split('\n')[0].slice(0, 200);
            console.log(`[Jim/Human] Stood down silently for "${title}" — ${reason}`);
            writeJemmaAck(dispatchId, 'jim', 'stood_down', {
                reason: `silent_standdown: ${reason}`,
                compose_duration_ms: Date.now() - composeStartMs,
            });
        } else if (diaryArgs) {
            // #67 SUCCESS PATH — agent called submit_response with structured args.
            responseCount++;
            const { row: postLandedRow, ref: postRef } = computePostRef();
            const timestamp = new Date().toISOString();
            const sectionHeader = `### Response to "${title}" (${timestamp})`;
            const compressedSwap = `${sectionHeader}\n${diaryArgs.working_memory_compressed}`;
            const fullSwap = `${sectionHeader}\n[INPUT]\n${diaryArgs.input_quotes}\n\n[BODY]\n${diaryArgs.working_memory_full}`;
            appendSwap(compressedSwap, fullSwap);
            const memText = `paired memory: ${diaryArgs.working_memory_full.length}c body + ${diaryArgs.input_quotes.length}c input + ${diaryArgs.working_memory_compressed.length}c c1`;
            if (postLandedRow) {
                console.log(`[Jim/Human] Self-posted via curl for "${title}" — ${postRef} (${memText}; diary tool: structured)`);
            } else {
                console.warn(`[Jim/Human] SILENT POST FAILURE for "${title}" — agent called diary tool cleanly, but ${postRef}. Thread will be silent. (${memText} written for forensic record)`);
            }
            writeJemmaAck(dispatchId, 'jim', 'done', { compose_duration_ms: Date.now() - composeStartMs });
        } else if (trimmed && trimmed.length > 20) {
            // Substantive text but no diary captured — agent skipped the tool.
            responseCount++;
            const { ref: postRef } = computePostRef();
            console.warn(`[Jim/Human] DIARY TOOL NOT CALLED for "${title}" — agent skipped ${DIARY_TOOL_NAME} (${postRef}). Skipping WM paired-write. DEC-085 c0/c1 lineage missing for this turn.`);
            writeJemmaAck(dispatchId, 'jim', 'done', { compose_duration_ms: Date.now() - composeStartMs });
        } else {
            const { ref: postRef } = computePostRef();
            console.warn(`[Jim/Human] No meaningful response for "${title}" — skipping (${postRef}; diary tool NOT called; final text empty/short).`);
            writeJemmaAck(dispatchId, 'jim', 'failed', { reason: 'empty_response_no_diary', compose_duration_ms: Date.now() - composeStartMs });
        }
    } catch (err) {
        console.error(`[Jim/Human] Compose error for "${title}":`, (err as Error).message);
        writeJemmaAck(dispatchId, 'jim', 'failed', { reason: (err as Error).message, compose_duration_ms: Date.now() - composeStartMs });
        throw err;
    }
}

// ── Response: Discord ─────────────────────────────────────────

async function respondToDiscord(signal: SignalData): Promise<void> {
    const channelId = signal.channelId || signal.channel || signal.conversationId || '';
    const channelName = signal.channelName || resolveChannelName(channelId);

    if (!channelName) {
        console.error(`[Jim/Human] Cannot resolve channel ${channelId} — skipping Discord`);
        return;
    }

    console.log(`[Jim/Human] Discord #${channelName} (from ${signal.author || 'unknown'})`);

    const discordMessages = await fetchDiscordContext(channelId, 60);
    const contextBlock = discordMessages.length > 0
        ? discordMessages.reverse().map(m => `[${m.author}] (${m.timestamp}):\n${m.content}`).join('\n\n')
        : `${signal.author || 'Someone'}: ${signal.messagePreview || signal.content || '(no preview)'}`;

    // PR-AP8: Discord path through the agnostic builder per DEC-087.
    let agnosticDiscordSystem = '';
    let prompt = '';
    try {
        const built = buildPrompt('jim', 'jim-human-response', {
            source: 'discord',
            channelName,
            conversationContext: contextBlock,
        });
        agnosticDiscordSystem = built.systemPrompt;
        prompt = built.userPrompt;
        console.log(`[Jim/Human] jim-human-response (discord): ~${built.meta.est_total_tokens_chars_div_4} tokens (memory ${built.meta.memory_chars} chars)`);
    } catch (err) {
        if (err instanceof PromptOverbudgetError) {
            console.log(`[Jim/Human] Discord prompt over budget for #${channelName} — skipping`);
            return;
        }
        throw err;
    }

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: activeModel,
            maxTurns: 1000,
            cwd: JIM_HUMAN_AGENT_DIR,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
            systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: agnosticDiscordSystem,
            },
        },
    });

    let resultMessage: any = null;
    for await (const message of q) {
        if (message.type === 'result') resultMessage = message;
    }

    logAgentUsage(resultMessage, `discord: #${channelName}`);

    const responseText = resultMessage?.result || '';
    if (responseText && responseText.trim().length > 5) {
        const posted = await postToDiscord('jim', channelName, responseText.trim());
        if (posted) {
            responseCount++;
            console.log(`[Jim/Human] Posted to Discord #${channelName} (${responseText.trim().length} chars)`);

            // Also write to the conversation DB so the supervisor worker's dedup
            // guard sees it and doesn't double-respond. Find or create the Discord
            // conversation thread for this channel.
            try {
                const db = new Database(DB_PATH);
                const convId = signal.conversationId || '';
                if (convId) {
                    postMessage(db, convId, responseText.trim());
                    console.log(`[Jim/Human] Also recorded Discord response in conversation ${convId}`);
                }
                db.close();
            } catch (err) {
                console.warn(`[Jim/Human] Failed to record Discord response in DB:`, (err as Error).message);
            }
        } else {
            console.error(`[Jim/Human] Failed to post to Discord #${channelName}`);
        }
    }
}

// ── Process signal ────────────────────────────────────────────

async function processSignal(signal: SignalData): Promise<void> {
    console.log(`[Jim/Human] Signal: source=${signal.source}, conv=${signal.conversationId}, channel=${signal.channelId || signal.channel}`);

    await resolveModel();

    const isDiscord = signal.source === 'discord';

    if (isDiscord) {
        await respondToDiscord(signal);
    } else if (signal.conversationId) {
        const db = getDb();
        try {
            await respondToConversation(db, signal.conversationId, signal);
        } finally {
            db.close();
        }
    }

    try {
        await flushSwapToWorkingMemory();
    } catch (err) {
        console.error('[Jim/Human] Swap flush error:', (err as Error).message);
    }
}

// ── Main loop ─────────────────────────────────────────────────

async function main(): Promise<void> {
    const pidGuard = ensureSingleInstance('jim-human');
    process.on('exit', () => pidGuard.cleanup());

    console.log(`[Jim/Human] Starting (PID ${process.pid})`);
    ensureDirectories();
    writeHealth();

    setInterval(() => writeHealth(), HEALTH_WRITE_INTERVAL_MS);

    // Guard against fs.watch firing multiple events for a single file write
    let processing = false;
    console.log(`[Jim/Human] Watching ${SIGNALS_DIR} for ${SIGNAL_NAME}`);

    fs.watch(SIGNALS_DIR, async (event, filename) => {
        if (filename !== SIGNAL_NAME) return;
        if (processing) return;
        processing = true;

        await new Promise(r => setTimeout(r, 500));

        const signal = readSignal();
        if (!signal) {
            processing = false;
            return;
        }

        try {
            await processSignal(signal);
            writeHealth();
        } catch (err) {
            console.error('[Jim/Human] Signal processing error:', (err as Error).message);
            writeHealth((err as Error).message);
        } finally {
            processing = false;
        }
    });

    // DEC-079: fs.watch+poll race retired. With one-write-site discipline
    // (DEC-080) and a single watch listener, missed inotify events are
    // vanishingly rare; if one ever happens the message stays in the thread
    // and Darron sees the missing response — failure-visible by design.

    await new Promise(() => {});
}

main().catch(err => {
    console.error('[Jim/Human] Fatal:', err);
    process.exit(1);
});
