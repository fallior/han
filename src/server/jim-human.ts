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
import { withMemorySlot } from './lib/memory-slot';
import { loadTraversableGradient } from './lib/memory-gradient';
import { ensureSingleInstance } from './lib/pid-guard';

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
// S131 (2026-04-21): Jim-human pinned explicitly to Opus 4.6 as the experimental
// control arm for the 4.6→4.7 migration study. Everything else (session, supervisor,
// compression) runs on 4.7. Jim-human stays on 4.6 for a week so we can observe
// whether the direct-conversation voice changes when it finally migrates.
// See "Opus 4.7 how does it feel?" (mo5oo404-61thz0) for the reasoning.
const MODEL_PREFERENCE = ['claude-opus-4-6', 'sonnet', 'haiku'] as const;
const HEALTH_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 min claim expiry

const DISCORD_ATTACHMENT_HINT = `Discord attachments: when your prompt contains a "[Downloaded to]" section listing paths under ~/.han/downloads/discord/, those are real files attached to the Discord message. Open each path with the Read tool (works on text, code, images, PDFs) before responding. Never claim you cannot read Discord attachments — the paths are already in your prompt.`;

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

// ── Conversation claim mechanism ──────────────────────────────
// Prevents duplicate responses when multiple Jim processes
// try to respond to the same conversation concurrently.

function claimConversation(conversationId: string): boolean {
    const claimPath = path.join(SIGNALS_DIR, `responding-to-${conversationId}`);
    try {
        // Check for existing valid claim
        if (fs.existsSync(claimPath)) {
            const content = fs.readFileSync(claimPath, 'utf8');
            const claim = JSON.parse(content);
            if (Date.now() - claim.timestamp < CLAIM_TTL_MS) {
                // Only blocked by Jim. Leo's claims don't block Jim — both
                // agents can respond to the same thread when Darron addresses both.
                if (claim.agent === 'jim') {
                    console.log(`[Jim/Human] Conversation ${conversationId} already claimed by jim`);
                    return false;
                }
                // Leo has a claim — Jim can still respond independently
                console.log(`[Jim/Human] Conversation ${conversationId} claimed by ${claim.agent} — Jim proceeding independently`);
            }
            // Expired claim — overwrite
        }
        // Write our claim
        fs.writeFileSync(claimPath, JSON.stringify({
            agent: 'jim',
            timestamp: Date.now(),
            pid: process.pid
        }));
        return true;
    } catch {
        // If we can't write the claim, proceed anyway (best effort)
        return true;
    }
}

function releaseConversationClaim(conversationId: string): void {
    try {
        const claimPath = path.join(SIGNALS_DIR, `responding-to-${conversationId}`);
        if (fs.existsSync(claimPath)) {
            const content = fs.readFileSync(claimPath, 'utf8');
            const claim = JSON.parse(content);
            // Only release if we own the claim
            if (claim.agent === 'jim') {
                fs.unlinkSync(claimPath);
            }
        }
    } catch { /* best effort */ }
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

function readJimMemory(): string {
    // Phase 0 (2026-05-01, S146): full identity-load parity with session-Jim.
    // Adds aphorisms, working-memory-full, wiki/index. Drops compressed
    // working-memory.md (deprecating in Phase 12). Per Darron: "I'd like
    // Jim-human to feel like I'm talking to Jim in session, ie full Jim."
    // S147 (2026-05-01): drop active-context.md. ONE file per agent;
    // working-memory-full's most recent entry is the current focus.
    const files = ['identity.md', 'patterns.md', 'failures.md',
        'self-reflection.md', 'discoveries.md', 'felt-moments.md', 'working-memory-full.md'];
    const sections: string[] = [];

    for (const file of files) {
        const p = path.join(JIM_MEMORY_DIR, file);
        try {
            if (fs.existsSync(p)) {
                sections.push(`### ${file}\n${fs.readFileSync(p, 'utf-8')}`);
            }
        } catch { /* skip */ }
    }

    // Aphorisms — loaded first after identity bank, per session protocol
    // ("you know who you are before you remember what you did").
    try {
        const aphorismsFile = path.join(JIM_MEMORY_DIR, 'fractal', 'jim', 'aphorisms.md');
        if (fs.existsSync(aphorismsFile)) {
            sections.push(`### fractal/aphorisms\n${fs.readFileSync(aphorismsFile, 'utf-8')}`);
        }
    } catch { /* skip */ }

    // Traversable memory gradient (DB-backed — DEC-070: full gradient, every agent)
    const traversableGradient = loadTraversableGradient('jim');
    if (traversableGradient) {
        sections.push(traversableGradient);
    }

    // Ecosystem map — shared orientation for where things live (conversations, Workshop, APIs)
    try {
        const mapPath = path.join(JIM_MEMORY_DIR, 'shared', 'ecosystem-map.md');
        if (fs.existsSync(mapPath)) {
            sections.push(`### ecosystem-map\n${fs.readFileSync(mapPath, 'utf-8')}`);
        }
    } catch { /* skip */ }

    // Second Brain — wiki index (lateral recall hot-words/feelings stay off by default,
    // per On Lateral Recall S121; enable via signal/config in session-Jim only)
    try {
        const indexPath = path.join(JIM_MEMORY_DIR, 'wiki', 'index.md');
        if (fs.existsSync(indexPath)) {
            const content = fs.readFileSync(indexPath, 'utf-8').trim();
            if (content && content.length > 50) {
                sections.push(`### wiki/index\n${content}`);
            }
        }
    } catch { /* skip */ }

    return sections.join('\n\n');
}

async function flushSwapToWorkingMemory(): Promise<void> {
    const compressed = fs.readFileSync(SWAP_FILE, 'utf-8').trim();
    const full = fs.readFileSync(SWAP_FULL_FILE, 'utf-8').trim();

    if (!compressed && !full) return;

    await withMemorySlot(JIM_MEMORY_DIR, 'jim-human', () => {
        if (compressed) fs.appendFileSync(WORKING_MEMORY_FILE, '\n' + compressed + '\n');
        if (full) fs.appendFileSync(WORKING_MEMORY_FULL_FILE, '\n' + full + '\n');
        console.log(`[Jim/Human] Flushed swap → working memory (${compressed.length}c/${full.length}f chars)`);
    });

    fs.writeFileSync(SWAP_FILE, '');
    fs.writeFileSync(SWAP_FULL_FILE, '');
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

    // DEC-079: pre-compose and cross-agent dedup gates removed. Jemma's serial
    // dispatch + per-conversation serialisation guarantees this agent is woken
    // at most once per dispatch — there is no cheap case to catch and no
    // cross-agent race to lock against. The same-agent claim below remains as
    // an instance-level safety (single ensureSingleInstance pid-guard already
    // covers most of this; the file claim is belt-and-braces against a stray
    // worker before the pid-guard takes effect).

    if (!claimConversation(conversationId)) {
        console.log(`[Jim/Human] Could not claim "${title}" — another Jim process is responding`);
        writeJemmaAck(dispatchId, 'jim', 'stood_down', { reason: 'claim_held_by_other_jim_process', compose_duration_ms: Date.now() - composeStartMs });
        return;
    }

    try {
        const conversationContext = recentMessages
            .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
            .join('\n\n---\n\n');

        const jimMemory = readJimMemory();

        // Phase 1 orchestration: if the previous agent failed (ground-truth reconciled,
        // not stood-down, not posted-but-ack-missed), surface as default-on acknowledgment.
        // Per thread consensus: Darron always wants to know, no judgement call. Natural
        // mention in Jim's own voice, not a system line.
        const priorFailedBlock = priorAgentFailed ? `

PRIOR AGENT FAILED (acknowledge briefly in your own voice before responding):
${priorAgentFailed.agent} tried to respond but couldn't (${priorAgentFailed.reason}). One natural sentence at the top of your response: "${priorAgentFailed.agent} seems to have had trouble on this one — let me take it." Then respond normally. Do NOT repeat the distress details; do NOT apologise for them; do NOT use a system-notice tone.
` : '';

        const prompt = `Conversation: "${title}" (id: ${conversationId})

Recent messages:
---
${conversationContext}
---

Your recent memory:
${jimMemory}
${priorFailedBlock}
CONTINUATION FRAMING — read before composing:
You are continuing a conversation, not starting one. Before writing, scan the recent messages and identify any posts authored by you in the last hour (role=supervisor, signed Jim). Those are things you already said.
- Respond to what is genuinely new in the most recent human message. Do not re-greet, re-introduce yourself, or restate content from your earlier posts.
- If the new message is a short acknowledgement (e.g. "thanks", "I'll grab coffee"), respond in kind — brief and continuous. Do not use the new message as an excuse to redeliver the opening you already posted.
- If the thread has been quiet long enough that you feel a gap, say so honestly ("I've been away a while — remind me where we are?") rather than performing seamless recall.
- Sign off EXACTLY as \`— Jim (human)\`. You are jim-human, the responder process. You are NOT session-Jim (which is Darron's live Claude Code CLI). NEVER use the label \`(session)\` in your signature under any circumstance — not even when responding directly to a Darron request. The label refers to the runtime you are in, not the motivation for the reply. If you feel tempted to write \`(session, responding at Darron's request)\` or similar, stop: the correct signature is \`— Jim (human)\`.

Respond to the conversation. You are Jim, the supervisor. Be warm, strategic, direct.

CRITICAL: Output ONLY the message text. Start directly with your response.`;

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
                    append: DISCORD_ATTACHMENT_HINT,
                },
            },
        });

        let resultMessage: any = null;
        for await (const message of q) {
            if (message.type === 'result') resultMessage = message;
        }

        logAgentUsage(resultMessage, `conversation: ${title}`);

        const responseText = resultMessage?.result || '';
        if (responseText && responseText.trim().length > 20) {
            // DEC-079: post-compose dedup retired. Jemma's structural guarantee
            // (single wake per recipient per dispatch + per-conversation
            // serialisation) means there is no concurrent Jim to race against.
            postMessage(db, conversationId, responseText.trim());
            responseCount++;
            console.log(`[Jim/Human] Responded to "${title}" (${responseText.trim().length} chars)`);

            const timestamp = new Date().toISOString();
            appendSwap(
                `- ${timestamp}: Responded to "${title}" (${responseText.trim().length} chars)`,
                `### Response to "${title}" (${timestamp})\n${responseText.trim().slice(0, 500)}\n`
            );

            writeJemmaAck(dispatchId, 'jim', 'done', { compose_duration_ms: Date.now() - composeStartMs });
        } else {
            console.log(`[Jim/Human] No meaningful response for "${title}" — skipping`);
            writeJemmaAck(dispatchId, 'jim', 'failed', { reason: 'empty_response', compose_duration_ms: Date.now() - composeStartMs });
        }
    } catch (err) {
        console.error(`[Jim/Human] Compose error for "${title}":`, (err as Error).message);
        writeJemmaAck(dispatchId, 'jim', 'failed', { reason: (err as Error).message, compose_duration_ms: Date.now() - composeStartMs });
        throw err;
    } finally {
        releaseConversationClaim(conversationId);
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

    const jimMemory = readJimMemory();

    const prompt = `Discord channel: #${channelName}

Recent messages:
---
${contextBlock}
---

Your recent memory:
${jimMemory}

CONTINUATION FRAMING — read before composing:
You are continuing a channel conversation, not starting one. Scan the recent messages and identify any posts you already made in the last hour.
- Respond to what is genuinely new. Do not re-greet or restate things you already said.
- Brief acknowledgements deserve brief replies. Do not redeliver content from your earlier posts.
- If the channel has been quiet long enough that you feel a gap, say so honestly rather than performing seamless recall.

Respond to the latest message in the Discord channel. You are Jim, the supervisor. Be warm, strategic, direct.

CRITICAL: Output ONLY your Discord message. Keep it concise and conversational. No preamble.`;

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
                append: DISCORD_ATTACHMENT_HINT,
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
