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
 */

import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { resolveChannelName, fetchDiscordContext, postToDiscord } from './services/discord';
import { withMemorySlot } from './lib/memory-slot';

// ── Config ────────────────────────────────────────────────────

const HOME = process.env.HOME || '/home/darron';
const CLAUDE_REMOTE_DIR = path.join(HOME, '.claude-remote');
const DB_PATH = path.join(CLAUDE_REMOTE_DIR, 'tasks.db');
const JIM_MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory');
const SIGNALS_DIR = path.join(CLAUDE_REMOTE_DIR, 'signals');
const HEALTH_DIR = path.join(CLAUDE_REMOTE_DIR, 'health');
const JIM_HUMAN_AGENT_DIR = path.join(CLAUDE_REMOTE_DIR, 'agents', 'Jim', 'Human');

const HEALTH_FILE = path.join(HEALTH_DIR, 'jim-human-health.json');
const SWAP_FILE = path.join(JIM_MEMORY_DIR, 'jim-human-swap.md');
const SWAP_FULL_FILE = path.join(JIM_MEMORY_DIR, 'jim-human-swap-full.md');
const WORKING_MEMORY_FILE = path.join(JIM_MEMORY_DIR, 'working-memory.md');
const WORKING_MEMORY_FULL_FILE = path.join(JIM_MEMORY_DIR, 'working-memory-full.md');

const SIGNAL_NAME = 'jim-human-wake';
const MODEL_PREFERENCE = ['opus', 'sonnet', 'haiku'] as const;
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
    const id = `jim-human-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'supervisor', ?, ?)
    `).run(id, conversationId, content, now);
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    return id;
}

// ── Memory ────────────────────────────────────────────────────

function readJimMemory(): string {
    const files = ['identity.md', 'active-context.md', 'patterns.md', 'failures.md',
        'self-reflection.md', 'felt-moments.md', 'working-memory.md'];
    const sections: string[] = [];

    for (const file of files) {
        const p = path.join(JIM_MEMORY_DIR, file);
        try {
            if (fs.existsSync(p)) {
                sections.push(`### ${file}\n${fs.readFileSync(p, 'utf-8')}`);
            }
        } catch { /* skip */ }
    }

    // Load fractal gradient (c1 only)
    const c1Dir = path.join(JIM_MEMORY_DIR, 'fractal', 'jim', 'c1');
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
    const uvPath = path.join(JIM_MEMORY_DIR, 'fractal', 'jim', 'unit-vectors.md');
    try {
        if (fs.existsSync(uvPath)) {
            sections.push(`### unit-vectors\n${fs.readFileSync(uvPath, 'utf-8')}`);
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

async function respondToConversation(db: Database.Database, conversationId: string): Promise<void> {
    const title = getConversationTitle(db, conversationId);
    const recentMessages = getRecentMessages(db, conversationId, 60).reverse();

    if (recentMessages.length === 0) {
        console.log(`[Jim/Human] No messages in "${title}" — skipping`);
        return;
    }

    // Dedup: check if Jim/Human already responded since the last human/leo message
    const lastNonJim = recentMessages.filter(m => m.role === 'human' || m.role === 'leo').pop();
    if (lastNonJim) {
        const jimResponses = recentMessages.filter(m =>
            m.role === 'supervisor' &&
            m.id.startsWith('jim-human-') &&
            m.created_at > lastNonJim.created_at
        );
        if (jimResponses.length > 0) {
            console.log(`[Jim/Human] Already responded to "${title}" since last human/leo message — skipping`);
            return;
        }
    }

    const conversationContext = recentMessages
        .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
        .join('\n\n---\n\n');

    const jimMemory = readJimMemory();

    const prompt = `Conversation: "${title}" (id: ${conversationId})

Recent messages:
---
${conversationContext}
---

Your recent memory:
${jimMemory}

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
            },
        },
    });

    let resultMessage: any = null;
    for await (const message of q) {
        if (message.type === 'result') resultMessage = message;
    }

    const responseText = resultMessage?.result || '';
    if (responseText && responseText.trim().length > 20) {
        postMessage(db, conversationId, responseText.trim());
        responseCount++;
        console.log(`[Jim/Human] Responded to "${title}" (${responseText.trim().length} chars)`);

        const timestamp = new Date().toISOString();
        appendSwap(
            `- ${timestamp}: Responded to "${title}" (${responseText.trim().length} chars)`,
            `### Response to "${title}" (${timestamp})\n${responseText.trim().slice(0, 500)}\n`
        );
    } else {
        console.log(`[Jim/Human] No meaningful response for "${title}" — skipping`);
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
            },
        },
    });

    let resultMessage: any = null;
    for await (const message of q) {
        if (message.type === 'result') resultMessage = message;
    }

    const responseText = resultMessage?.result || '';
    if (responseText && responseText.trim().length > 5) {
        const posted = await postToDiscord('jim', channelName, responseText.trim());
        if (posted) {
            responseCount++;
            console.log(`[Jim/Human] Posted to Discord #${channelName} (${responseText.trim().length} chars)`);
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
            await respondToConversation(db, signal.conversationId);
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
    console.log(`[Jim/Human] Starting (PID ${process.pid})`);
    ensureDirectories();
    writeHealth();

    setInterval(() => writeHealth(), HEALTH_WRITE_INTERVAL_MS);

    console.log(`[Jim/Human] Watching ${SIGNALS_DIR} for ${SIGNAL_NAME}`);

    fs.watch(SIGNALS_DIR, async (event, filename) => {
        if (filename !== SIGNAL_NAME) return;

        await new Promise(r => setTimeout(r, 500));

        const signal = readSignal();
        if (!signal) return;

        try {
            await processSignal(signal);
            writeHealth();
        } catch (err) {
            console.error('[Jim/Human] Signal processing error:', (err as Error).message);
            writeHealth((err as Error).message);
        }
    });

    // Poll every 60s as backup
    setInterval(async () => {
        const signal = readSignal();
        if (signal) {
            try {
                await processSignal(signal);
                writeHealth();
            } catch (err) {
                console.error('[Jim/Human] Poll signal error:', (err as Error).message);
                writeHealth((err as Error).message);
            }
        }
    }, 60_000);

    await new Promise(() => {});
}

main().catch(err => {
    console.error('[Jim/Human] Fatal:', err);
    process.exit(1);
});
