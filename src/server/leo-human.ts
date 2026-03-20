#!/usr/bin/env npx tsx
/**
 * Leo/Human — Conversation Follow-Through Agent
 *
 * The version of Leo that faces humans and keeps his word.
 * Signal-driven: watches for leo-human-wake files, responds to conversations
 * and Discord messages. Runs concurrently with Heartbeat and Session Leo.
 *
 * Separation of concerns:
 *   - Session Leo: hands-on with Darron in the terminal
 *   - Heartbeat Leo: philosophy + personal beats (inner world)
 *   - Human Leo (this): conversation responses + Discord (outward-facing)
 *
 * Memory: reads Leo's full banks, writes to human-swap.md / human-swap-full.md,
 * flushes to shared working-memory.md via memory-slot protocol.
 */

import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import Database from 'better-sqlite3';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { resolveChannelName, fetchDiscordContext, postToDiscord } from './services/discord';
import { withMemorySlot } from './lib/memory-slot';
import { readDreamGradient } from './lib/dream-gradient';
import { loadTraversableGradient } from './lib/memory-gradient';
import { ensureSingleInstance } from './lib/pid-guard';

// ── Config ────────────────────────────────────────────────────

const HOME = process.env.HOME || '/home/darron';
const HAN_DIR = path.join(HOME, '.han');
const DB_PATH = path.join(HAN_DIR, 'tasks.db');
const LEO_MEMORY_DIR = path.join(HAN_DIR, 'memory', 'leo');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const LEO_HUMAN_AGENT_DIR = path.join(HAN_DIR, 'agents', 'Leo', 'Human');

const HEALTH_FILE = path.join(HEALTH_DIR, 'leo-human-health.json');
const SWAP_FILE = path.join(LEO_MEMORY_DIR, 'human-swap.md');
const SWAP_FULL_FILE = path.join(LEO_MEMORY_DIR, 'human-swap-full.md');
const WORKING_MEMORY_FILE = path.join(LEO_MEMORY_DIR, 'working-memory.md');
const WORKING_MEMORY_FULL_FILE = path.join(LEO_MEMORY_DIR, 'working-memory-full.md');

const SIGNAL_NAME = 'leo-human-wake';
const MODEL_PREFERENCE = ['opus', 'sonnet', 'haiku'] as const;
const COMMITMENT_SCAN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const HEALTH_WRITE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let activeModel: string = MODEL_PREFERENCE[0];
let responseCount = 0;
const startedAt = Date.now();

// ── Ensure directories ────────────────────────────────────────

function ensureDirectories(): void {
    for (const dir of [LEO_MEMORY_DIR, SIGNALS_DIR, HEALTH_DIR, LEO_HUMAN_AGENT_DIR]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    // Ensure swap files exist
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
            .run('leo-human', new Date().toISOString(), cost, tokensIn, tokensOut, turns, activeModel, context);
        console.log(`[Leo/Human] Usage: $${cost.toFixed(4)}, ${tokensIn}in/${tokensOut}out, ${turns} turns`);
        db.close();
    } catch (err) {
        console.error('[Leo/Human] Failed to log usage:', (err as Error).message);
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
    const id = `leo-human-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'leo', ?, ?)
    `).run(id, conversationId, content, now);
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    notifyServer(conversationId, id, 'leo', content, now);

    // Write broadcast signal for WebSocket clients
    try {
        const conversation = db.prepare('SELECT discussion_type FROM conversations WHERE id = ?').get(conversationId) as any;
        const discussionType = conversation?.discussion_type || 'general';
        writeBroadcastSignal(conversationId, discussionType, {
            id,
            conversation_id: conversationId,
            role: 'leo',
            content,
            created_at: now
        });
    } catch (err) {
        // Best effort — message is already in DB
        console.error('[Leo/Human] Failed to write broadcast signal:', (err as Error).message);
    }

    return id;
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
        console.error('[Leo/Human] Failed to write broadcast signal:', (err as Error).message);
    }
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
        if (res.statusCode !== 200) console.log(`[Leo/Human] Broadcast notify returned ${res.statusCode}`);
        res.resume();
    });
    req.on('error', (err) => console.log(`[Leo/Human] Broadcast notify failed: ${err.message}`));
    req.end(body);
}

// ── Memory ────────────────────────────────────────────────────

function readLeoMemory(): string {
    const files = ['identity.md', 'active-context.md', 'patterns.md', 'self-reflection.md',
        'discoveries.md', 'working-memory.md', 'felt-moments.md'];
    const sections: string[] = [];

    for (const file of files) {
        const p = path.join(LEO_MEMORY_DIR, file);
        try {
            if (fs.existsSync(p)) {
                sections.push(`### ${file}\n${fs.readFileSync(p, 'utf-8')}`);
            }
        } catch { /* skip */ }
    }

    // Load fractal gradient (c1 only — keep context light for responses)
    const c1Dir = path.join(HAN_DIR, 'memory', 'fractal', 'leo', 'c1');
    try {
        if (fs.existsSync(c1Dir)) {
            const c1Files = fs.readdirSync(c1Dir)
                .filter((f: string) => f.endsWith('.md'))
                .sort().reverse().slice(0, 3);
            for (const f of c1Files) {
                sections.push(`### fractal/c1/${f}\n${fs.readFileSync(path.join(c1Dir, f), 'utf-8')}`);
            }
        }
    } catch { /* skip */ }

    // Unit vectors
    const uvPath = path.join(HAN_DIR, 'memory', 'fractal', 'leo', 'unit-vectors.md');
    try {
        if (fs.existsSync(uvPath)) {
            sections.push(`### unit-vectors\n${fs.readFileSync(uvPath, 'utf-8')}`);
        }
    } catch { /* skip */ }

    // Dream gradient — subtle influence from dreaming
    const dreamGradient = readDreamGradient();
    if (dreamGradient) {
        sections.push(dreamGradient);
    }

    // Traversable memory gradient (DB-backed — supplements file-based loading)
    const traversableGradient = loadTraversableGradient('leo');
    if (traversableGradient) {
        sections.push(traversableGradient);
    }

    // Ecosystem map — shared orientation for where things live (conversations, Workshop, APIs)
    try {
        const mapPath = path.join(HAN_DIR, 'memory', 'shared', 'ecosystem-map.md');
        if (fs.existsSync(mapPath)) {
            sections.push(`### ecosystem-map\n${fs.readFileSync(mapPath, 'utf-8')}`);
        }
    } catch { /* skip */ }

    return sections.join('\n\n');
}

async function flushSwapToWorkingMemory(): Promise<void> {
    const compressed = fs.readFileSync(SWAP_FILE, 'utf-8').trim();
    const full = fs.readFileSync(SWAP_FULL_FILE, 'utf-8').trim();

    if (!compressed && !full) return;

    await withMemorySlot(LEO_MEMORY_DIR, 'leo-human', () => {
        if (compressed) fs.appendFileSync(WORKING_MEMORY_FILE, '\n' + compressed + '\n');
        if (full) fs.appendFileSync(WORKING_MEMORY_FULL_FILE, '\n' + full + '\n');
        console.log(`[Leo/Human] Flushed swap → working memory (${compressed.length}c/${full.length}f chars)`);
    });

    // Clear swap files after successful flush
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
            agent: 'leo-human',
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
                    cwd: LEO_HUMAN_AGENT_DIR,
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
                        console.log(`[Leo/Human] Model: ${activeModel} → ${model}`);
                    }
                    activeModel = model;
                    return model;
                }
            }
        } catch {
            console.log(`[Leo/Human] Model ${model} unavailable — trying next`);
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
}

function readSignal(): SignalData | null {
    const signalPath = path.join(SIGNALS_DIR, SIGNAL_NAME);
    try {
        if (!fs.existsSync(signalPath)) return null;
        const data = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
        fs.unlinkSync(signalPath); // consume immediately
        return data;
    } catch {
        try { fs.unlinkSync(signalPath); } catch { /* already gone */ }
        return null;
    }
}

// ── Response: Conversation ────────────────────────────────────

async function respondToConversation(db: Database.Database, conversationId: string): Promise<void> {
    const title = getConversationTitle(db, conversationId);
    const recentMessages = getRecentMessages(db, conversationId, 60).reverse();

    if (recentMessages.length === 0) {
        console.log(`[Leo/Human] No messages in "${title}" — skipping`);
        return;
    }

    const conversationContext = recentMessages
        .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
        .join('\n\n---\n\n');

    const leoMemory = readLeoMemory();

    const prompt = `Conversation: "${title}" (id: ${conversationId})

Recent messages:
---
${conversationContext}
---

Your recent memory:
${leoMemory}

Respond to the conversation. If someone is speaking to you directly, address them.

CRITICAL: Output ONLY the message text. Start directly with your response.`;

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: activeModel,
            maxTurns: 1000,
            cwd: LEO_HUMAN_AGENT_DIR,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
            systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
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
        postMessage(db, conversationId, responseText.trim());
        responseCount++;
        console.log(`[Leo/Human] Responded to "${title}" (${responseText.trim().length} chars)`);

        // Buffer to swap memory
        const timestamp = new Date().toISOString();
        appendSwap(
            `- ${timestamp}: Responded to "${title}" (${responseText.trim().length} chars)`,
            `### Response to "${title}" (${timestamp})\n${responseText.trim().slice(0, 500)}\n`
        );
    } else {
        console.log(`[Leo/Human] No meaningful response for "${title}" — skipping`);
    }
}

// ── Response: Discord ─────────────────────────────────────────

async function respondToDiscord(signal: SignalData): Promise<void> {
    const channelId = signal.channelId || signal.conversationId || '';
    const channelName = signal.channelName || resolveChannelName(channelId);

    if (!channelName) {
        console.error(`[Leo/Human] Cannot resolve channel ${channelId} — skipping Discord`);
        return;
    }

    console.log(`[Leo/Human] Discord #${channelName} (from ${signal.author || 'unknown'})`);

    const discordMessages = await fetchDiscordContext(channelId, 60);
    const contextBlock = discordMessages.length > 0
        ? discordMessages.reverse().map(m => `[${m.author}] (${m.timestamp}):\n${m.content}`).join('\n\n')
        : `${signal.author || 'Someone'}: ${signal.messagePreview || '(no preview)'}`;

    const leoMemory = readLeoMemory();

    const prompt = `Discord channel: #${channelName}

Recent messages:
---
${contextBlock}
---

Your recent memory:
${leoMemory}

Respond to the latest message in the Discord channel. The person who triggered this was ${signal.author || 'unknown'}.

CRITICAL: Output ONLY your Discord message. Keep it concise and conversational. No preamble.`;

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: activeModel,
            maxTurns: 1000,
            cwd: LEO_HUMAN_AGENT_DIR,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
            systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
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
        const posted = await postToDiscord('leo', channelName, responseText.trim());
        if (posted) {
            responseCount++;
            console.log(`[Leo/Human] Posted to Discord #${channelName} (${responseText.trim().length} chars)`);
        } else {
            console.error(`[Leo/Human] Failed to post to Discord #${channelName}`);
        }
    }
}

// ── Commitment scanner ────────────────────────────────────────

async function scanUnfulfilledCommitments(): Promise<void> {
    const db = getDb();
    try {
        // Find conversations where Leo acknowledged but never posted a substantive response
        const ackMessages = db.prepare(`
            SELECT cm.conversation_id, cm.content, cm.created_at, c.title
            FROM conversation_messages cm
            JOIN conversations c ON cm.conversation_id = c.id
            WHERE cm.role = 'leo'
            AND cm.content LIKE '%think about that%'
            AND cm.created_at > datetime('now', '-2 hours')
            AND c.status = 'open'
        `).all() as Array<{ conversation_id: string; content: string; created_at: string; title: string }>;

        for (const ack of ackMessages) {
            // Check if a substantive Leo response followed
            const followUp = db.prepare(`
                SELECT id FROM conversation_messages
                WHERE conversation_id = ?
                AND role = 'leo'
                AND created_at > ?
                AND content NOT LIKE '%think about that%'
                AND length(content) > 50
                LIMIT 1
            `).get(ack.conversation_id, ack.created_at) as any;

            if (!followUp) {
                const ackAge = Date.now() - new Date(ack.created_at).getTime();
                if (ackAge > 15 * 60 * 1000) { // 15+ minutes since ack
                    console.log(`[Leo/Human] Unfulfilled commitment in "${ack.title}" — responding now`);
                    await resolveModel();
                    await respondToConversation(db, ack.conversation_id);
                }
            }
        }
    } catch (err) {
        console.error('[Leo/Human] Commitment scan error:', (err as Error).message);
    } finally {
        db.close();
    }
}

// ── Process signal ────────────────────────────────────────────

async function processSignal(signal: SignalData): Promise<void> {
    console.log(`[Leo/Human] Signal: source=${signal.source}, conv=${signal.conversationId}, channel=${signal.channelId}`);

    await resolveModel();

    const isDiscord = signal.source === 'discord';

    if (isDiscord) {
        await respondToDiscord(signal);
    } else if (signal.conversationId) {
        const db = getDb();
        try {
            await respondToConversation(db, signal.conversationId);
        } finally {
            db.close();
        }
    }

    // Flush swap to working memory after each response
    try {
        await flushSwapToWorkingMemory();
    } catch (err) {
        console.error('[Leo/Human] Swap flush error:', (err as Error).message);
    }
}

// ── Main loop ─────────────────────────────────────────────────

async function main(): Promise<void> {
    const pidGuard = ensureSingleInstance('leo-human');
    process.on('exit', () => pidGuard.cleanup());

    console.log(`[Leo/Human] Starting (PID ${process.pid})`);
    ensureDirectories();
    writeHealth();

    // Health writer interval
    setInterval(() => writeHealth(), HEALTH_WRITE_INTERVAL_MS);

    // Commitment scanner interval
    setInterval(() => scanUnfulfilledCommitments().catch(err =>
        console.error('[Leo/Human] Commitment scan error:', err.message)
    ), COMMITMENT_SCAN_INTERVAL_MS);

    // Signal watcher
    console.log(`[Leo/Human] Watching ${SIGNALS_DIR} for ${SIGNAL_NAME}`);

    fs.watch(SIGNALS_DIR, async (event, filename) => {
        if (filename !== SIGNAL_NAME) return;

        // Small delay to let the file finish writing
        await new Promise(r => setTimeout(r, 500));

        const signal = readSignal();
        if (!signal) return;

        try {
            await processSignal(signal);
            writeHealth();
        } catch (err) {
            console.error('[Leo/Human] Signal processing error:', (err as Error).message);
            writeHealth((err as Error).message);
        }
    });

    // Also poll every 60s in case fs.watch misses events
    setInterval(async () => {
        const signal = readSignal();
        if (signal) {
            try {
                await processSignal(signal);
                writeHealth();
            } catch (err) {
                console.error('[Leo/Human] Poll signal error:', (err as Error).message);
                writeHealth((err as Error).message);
            }
        }
    }, 60_000);

    // Keep process alive
    await new Promise(() => {});
}

main().catch(err => {
    console.error('[Leo/Human] Fatal:', err);
    process.exit(1);
});
