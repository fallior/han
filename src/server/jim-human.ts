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

import Database from 'better-sqlite3';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { resolveChannelName, fetchDiscordContext, postToDiscord } from './services/discord';
import { appendPairedMemory } from './lib/memory-paired-writer';
import { ensureSingleInstance } from './lib/pid-guard';
import { buildPrompt, PromptOverbudgetError } from './lib/prompt-builder';
// DEC-093 humans-PR thaw (2026-06-13): tmux warm-session transport for human-response.
// Gated per-dispatch on manifestTransport (kept 'sdk' until enable); the SDK path below
// each branch is byte-intact for one-line rollback (billed-not-broken).
import { ensureSurfaceSession, enqueueForAgent, DispatchTimeoutError, SessionNotReadyError } from './lib/tmux-dispatcher';
import { manifestModelLadder } from './lib/garden-manifest';
import type { CaptureRecord } from './lib/diary-mcp-server';

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
const HEALTH_WRITE_INTERVAL_MS = 5 * 60 * 1000;

// DEC-093 humans-PR thaw (2026-06-13): manifest surface name + tmux txn timeout. The
// conversation role is 'supervisor' (Jim's manifest catch #1 — NOT slug-derived).
const HUMAN_SURFACE = 'human-response';
const HUMAN_TXN_TIMEOUT_MS = 15 * 60_000;
const HUMAN_CONVERSATION_ROLE = 'supervisor';


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
    // SDK (agentQuery) cognition path retired at the T-7 #66 close (DEC-094):
    // tmux warm-session is now the sole transport.
    return respondToConversationViaTmux(db, conversationId, signal);
}

// ── Response: Discord ─────────────────────────────────────────

async function respondToDiscord(signal: SignalData): Promise<void> {
    // SDK (agentQuery) cognition path retired at the T-7 #66 close (DEC-094):
    // tmux warm-session is now the sole transport.
    return respondToDiscordViaTmux(signal);
}

// ── Response: tmux warm-session transport (DEC-093 humans-PR thaw) ─────────────

/**
 * The tmux warm-session conversation path (mirror of leo-human). The spoke
 * (human-response-jim) fetches the thread itself (locator scaffold), applies the
 * gates, self-posts via curl (role 'supervisor'), and ends with submit_response or
 * stand_down. stand-down → ack stood_down (NEVER paired-write, Jim's flag); diary →
 * appendSwap + post-verification → ack done / SILENT-POST-FAILURE warn.
 */
async function respondToConversationViaTmux(db: Database.Database, conversationId: string, signal?: SignalData): Promise<void> {
    const title = getConversationTitle(db, conversationId);
    const dispatchId = signal?.dispatchId;
    const priorAgentFailed = signal?.priorAgentFailed;
    const composeStartMs = Date.now();
    const recentMessages = getRecentMessages(db, conversationId, 60).reverse();

    if (recentMessages.length === 0) {
        console.log(`[Jim/Human] (tmux) No messages in "${title}" — skipping`);
        writeJemmaAck(dispatchId, 'jim', 'stood_down', { reason: 'no_messages', compose_duration_ms: Date.now() - composeStartMs });
        return;
    }
    // addressed-to-Leo-only pre-gate (cheap; avoids waking the spoke for a non-Jim msg)
    const lastHumanMsg = recentMessages.filter(m => m.role === 'human').pop();
    if (lastHumanMsg) {
        const text = lastHumanMsg.content.toLowerCase();
        if ((/\bleo\b|\bleonhard\b/.test(text)) && !(/\bjim\b|\bjimmy\b/.test(text))) {
            console.log(`[Jim/Human] (tmux) Message addressed to Leo only in "${title}" — standing down`);
            writeJemmaAck(dispatchId, 'jim', 'stood_down', { reason: 'addressed_to_other_agent', compose_duration_ms: Date.now() - composeStartMs });
            return;
        }
    }

    let txnPrompt: string;
    try {
        const built = buildPrompt('jim', 'jim-human-response-txn', {
            source: 'conversation', title, conversationId,
            roleLabel: HUMAN_CONVERSATION_ROLE, priorAgentFailed,
        });
        txnPrompt = `${built.systemPrompt}\n\n${built.userPrompt}`;
        console.log(`[Jim/Human] (tmux) jim-human-response-txn: ~${built.meta.est_total_tokens_chars_div_4} tokens (memory suppressed: ${built.meta.memory_chars} chars)`);
    } catch (err) {
        if (err instanceof PromptOverbudgetError) {
            console.log(`[Jim/Human] (tmux) Prompt over budget for "${title}" — skipping`);
            writeJemmaAck(dispatchId, 'jim', 'failed', { reason: 'prompt-build-overbudget', compose_duration_ms: Date.now() - composeStartMs });
            return;
        }
        throw err;
    }

    const heartbeat = startHeartbeatAcks(dispatchId, 'jim');
    const dispatchStartMs = Date.now();
    let cap: CaptureRecord;
    try {
        await ensureSurfaceSession('jim', HUMAN_SURFACE, { ladder: manifestModelLadder('jim', HUMAN_SURFACE), welcomeBack: 'welcome back Jim' });
        cap = await enqueueForAgent('jim', HUMAN_SURFACE, txnPrompt, { timeoutMs: HUMAN_TXN_TIMEOUT_MS });
    } catch (err) {
        heartbeat.stop();
        if (err instanceof DispatchTimeoutError || err instanceof SessionNotReadyError) {
            console.error(`[Jim/Human] (tmux) dispatch failed for "${title}" — ${(err as Error).message}`);
            writeJemmaAck(dispatchId, 'jim', 'failed', { reason: `tmux-dispatch: ${(err as Error).message}`, compose_duration_ms: Date.now() - composeStartMs });
            return;
        }
        throw err;
    }
    heartbeat.stop();
    console.log(`[Jim/Human] (tmux) "${title}": capture in ${Math.round((Date.now() - dispatchStartMs) / 1000)}s (queue+wake+compose), mode=${cap.mode ?? 'diary'}`);

    if (cap.mode === 'stand-down') {
        console.log(`[Jim/Human] (tmux) Stood down for "${title}" — ${(cap.reason ?? '').slice(0, 200)}`);
        writeJemmaAck(dispatchId, 'jim', 'stood_down', { reason: `tmux_standdown: ${(cap.reason ?? '').slice(0, 160)}`, compose_duration_ms: Date.now() - composeStartMs });
        return;
    }

    responseCount++;
    const composeStartIso = new Date(composeStartMs).toISOString();
    const postRow = db.prepare(`
        SELECT id FROM conversation_messages
        WHERE conversation_id = ? AND role = ? AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1
    `).get(conversationId, 'supervisor', composeStartIso) as { id: string } | undefined;
    const postRef = postRow ? `verified post id=${postRow.id}` : `NO CURL-POST DETECTED in DB`;
    const timestamp = new Date().toISOString();
    const sectionHeader = `### Response to "${title}" (${timestamp})`;
    const compressedSwap = `${sectionHeader}\n${cap.args.working_memory_compressed}`;
    const fullSwap = `${sectionHeader}\n[INPUT]\n${cap.args.input_quotes}\n\n[BODY]\n${cap.args.working_memory_full}`;
    appendSwap(compressedSwap, fullSwap);
    const memText = `paired memory: ${cap.args.working_memory_full.length}c body + ${cap.args.input_quotes.length}c input + ${cap.args.working_memory_compressed.length}c c1`;
    if (postRow) {
        console.log(`[Jim/Human] (tmux) Self-posted via curl for "${title}" — ${postRef} (${memText})`);
    } else {
        console.warn(`[Jim/Human] (tmux) SILENT POST FAILURE for "${title}" — diary captured but ${postRef}. Thread will be silent. (${memText} written for forensic record)`);
    }
    writeJemmaAck(dispatchId, 'jim', 'done', { compose_duration_ms: Date.now() - composeStartMs });
}

/**
 * The tmux warm-session Discord path (mirror of leo-human). Controller fetches +
 * embeds Discord context (not spoke-fetchable), DELIVERY OVERRIDE posts the reply.
 */
async function respondToDiscordViaTmux(signal: SignalData): Promise<void> {
    const channelId = signal.channelId || signal.channel || signal.conversationId || '';
    const channelName = signal.channelName || resolveChannelName(channelId);
    if (!channelName) {
        console.error(`[Jim/Human] (tmux) Cannot resolve channel ${channelId} — skipping Discord`);
        return;
    }
    const dispatchId = signal.dispatchId;
    console.log(`[Jim/Human] (tmux) Discord #${channelName} (from ${signal.author || 'unknown'})`);

    const discordMessages = await fetchDiscordContext(channelId, 60);
    const contextBlock = discordMessages.length > 0
        ? discordMessages.reverse().map(m => `[${m.author}] (${m.timestamp}):\n${m.content}`).join('\n\n')
        : `${signal.author || 'Someone'}: ${signal.messagePreview || '(no preview)'}`;

    let txnPrompt: string;
    try {
        const built = buildPrompt('jim', 'jim-human-response-txn', {
            source: 'discord', channelName, conversationContext: contextBlock, roleLabel: HUMAN_CONVERSATION_ROLE,
        });
        txnPrompt = `${built.systemPrompt}\n\n${built.userPrompt}`;
        console.log(`[Jim/Human] (tmux) jim-human-response-txn (discord): ~${built.meta.est_total_tokens_chars_div_4} tokens`);
    } catch (err) {
        if (err instanceof PromptOverbudgetError) { console.log(`[Jim/Human] (tmux) Discord prompt over budget for #${channelName} — skipping`); return; }
        throw err;
    }

    const heartbeat = startHeartbeatAcks(dispatchId, 'jim');
    let cap: CaptureRecord;
    try {
        await ensureSurfaceSession('jim', HUMAN_SURFACE, { ladder: manifestModelLadder('jim', HUMAN_SURFACE), welcomeBack: 'welcome back Jim' });
        cap = await enqueueForAgent('jim', HUMAN_SURFACE, txnPrompt, { timeoutMs: HUMAN_TXN_TIMEOUT_MS });
    } catch (err) {
        heartbeat.stop();
        if (err instanceof DispatchTimeoutError || err instanceof SessionNotReadyError) {
            console.error(`[Jim/Human] (tmux) Discord dispatch failed #${channelName} — ${(err as Error).message}`);
            return;
        }
        throw err;
    }
    heartbeat.stop();

    if (cap.mode === 'stand-down') {
        console.log(`[Jim/Human] (tmux) Stood down on Discord #${channelName} — ${(cap.reason ?? '').slice(0, 200)}`);
        return;
    }
    const body = cap.args.working_memory_full.trim();
    if (body.length > 5) {
        const posted = await postToDiscord('jim', channelName, body);
        if (posted) {
            responseCount++;
            console.log(`[Jim/Human] (tmux) Posted to Discord #${channelName} (${body.length} chars)`);
            try {
                const ddb = getDb();
                const convId = signal.conversationId || '';
                if (convId) postMessage(ddb, convId, body);
                ddb.close();
            } catch (err) { console.warn(`[Jim/Human] (tmux) Failed to record Discord response in DB:`, (err as Error).message); }
            const timestamp = new Date().toISOString();
            const sectionHeader = `### Discord #${channelName} (${timestamp})`;
            appendSwap(`${sectionHeader}\n${cap.args.working_memory_compressed}`, `${sectionHeader}\n[INPUT]\n${cap.args.input_quotes}\n\n[BODY]\n${cap.args.working_memory_full}`);
        } else {
            console.error(`[Jim/Human] (tmux) Failed to post to Discord #${channelName}`);
        }
    }
}

// ── Process signal ────────────────────────────────────────────

async function processSignal(signal: SignalData): Promise<void> {
    console.log(`[Jim/Human] Signal: source=${signal.source}, conv=${signal.conversationId}, channel=${signal.channelId || signal.channel}`);

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
