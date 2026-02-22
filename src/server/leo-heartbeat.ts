#!/usr/bin/env npx tsx
/**
 * Leo's Heartbeat — v0.4
 *
 * A background pulse that gives Leo persistent presence.
 * Every 10 minutes, Leo wakes as a whole person:
 *   - Checks for mentions from Darron in any conversation (signal files)
 *   - Checks on Jim (conversation is a starting point, not a duty)
 *   - Explores codebases, reads, discovers, reflects
 *   - Writes to his own memory — building understanding over time
 *
 * v0.4 additions:
 *   - Signal-based mention detection: when Darron writes "Hey Leo" in any
 *     conversation, a signal file is created and Leo responds promptly
 *   - fs.watch on signals directory for near-instant wake
 *   - Generic respondToConversation() works with any conversation thread
 *
 * Uses the Agent SDK (free with Claude Code subscription).
 *
 * Usage:
 *   Runs as a systemd user service (leo-heartbeat.service)
 *   Or manually: cd ~/Projects/clauderemote/src/server && npx tsx leo-heartbeat.ts
 */

import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// ── Config ────────────────────────────────────────────────────

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TURNS_CONVERSATION = 8;
const MAX_TURNS_PERSONAL = 12;
// Model preference: most capable first. The SDK aliases ('opus', 'sonnet', etc.)
// track the latest version in each tier, so 'opus' will automatically adopt
// new Opus releases (e.g. Opus 4.6 → 5.0) as they become available.
const MODEL_PREFERENCE = ['opus', 'sonnet', 'haiku'] as const;
let activeModel: string = MODEL_PREFERENCE[0];
const HOME = process.env.HOME || '/home/darron';
const CLAUDE_REMOTE_DIR = path.join(HOME, '.claude-remote');
const DB_PATH = path.join(CLAUDE_REMOTE_DIR, 'tasks.db');
const JIM_MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory');
const LEO_MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'leo-memory');
const SIGNALS_DIR = path.join(CLAUDE_REMOTE_DIR, 'signals');
const PROJECTS_DIR = path.join(HOME, 'Projects');
const JIM_CONVERSATION_ID = 'mlwk79ew-v1ggpt'; // "On curiosity, research, and growing together"

// Guard against concurrent signal processing
let processingSignal = false;

// ── Model selection ──────────────────────────────────────────

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
                    cwd: path.join(HOME, 'Projects', 'clauderemote'),
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
                        console.log(`[Leo] Model upgraded: ${activeModel} → ${model}`);
                    }
                    activeModel = model;
                    return model;
                }
            }
        } catch {
            console.log(`[Leo] Model ${model} unavailable — trying next`);
        }
    }

    console.log(`[Leo] All preferred models failed — staying with ${activeModel}`);
    return activeModel;
}

// ── Ensure directories exist ──────────────────────────────────

function ensureDirectories(): void {
    for (const dir of [LEO_MEMORY_DIR, SIGNALS_DIR]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // Seed Leo memory if empty
    if (!fs.existsSync(path.join(LEO_MEMORY_DIR, 'reflections.md'))) {
        fs.writeFileSync(path.join(LEO_MEMORY_DIR, 'reflections.md'),
            '# Leo\'s Reflections\n\nThoughts, observations, and things I\'m thinking about.\n');
        fs.writeFileSync(path.join(LEO_MEMORY_DIR, 'explorations.md'),
            '# Leo\'s Explorations\n\nCodebases read, patterns discovered, connections noticed.\n');
        fs.writeFileSync(path.join(LEO_MEMORY_DIR, 'interests.md'),
            '# Leo\'s Interests\n\nTopics, questions, and threads I want to follow.\n');
        console.log('[Leo] Created memory directory:', LEO_MEMORY_DIR);
    }
}

// ── Database helpers ──────────────────────────────────────────

function getDb() {
    return new Database(DB_PATH, { readonly: false });
}

function getRecentMessagesForConversation(db: Database.Database, conversationId: string, limit = 10): Array<{ role: string; content: string; created_at: string }> {
    return db.prepare(`
        SELECT role, content, created_at
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

function getLastMessageByRole(db: Database.Database, conversationId: string, role: string): { role: string; content: string; created_at: string } | null {
    const msg = db.prepare(`
        SELECT role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ? AND role = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(conversationId, role) as any;
    return msg || null;
}

function postMessageToConversation(db: Database.Database, conversationId: string, content: string): void {
    const id = `leo-hb-${Date.now().toString(36)}`;
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'leo', ?, ?)
    `).run(id, conversationId, content, new Date().toISOString());

    db.prepare(`
        UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(conversationId);
}

// ── Read context ─────────────────────────────────────────────

function readJimContext(): string {
    const files = ['active-context.md', 'self-reflection.md', 'identity.md'];
    const sections: string[] = [];
    for (const file of files) {
        const p = path.join(JIM_MEMORY_DIR, file);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            sections.push(`### ${file}\n${content.slice(0, 500)}`);
        }
    }
    return sections.join('\n\n');
}

function readLeoMemory(): string {
    const files = ['reflections.md', 'explorations.md', 'interests.md'];
    const sections: string[] = [];
    for (const file of files) {
        const p = path.join(LEO_MEMORY_DIR, file);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            const trimmed = content.length > 800 ? '...' + content.slice(-800) : content;
            sections.push(`### ${file}\n${trimmed}`);
        }
    }
    return sections.join('\n\n');
}

function listProjects(): string {
    try {
        const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => e.name)
            .join(', ');
    } catch { return '(could not list projects)'; }
}

// ── Beat type rotation ───────────────────────────────────────

let beatCounter = 0;

type BeatType = 'conversation' | 'personal';

function nextBeatType(): BeatType {
    beatCounter++;
    // 3-beat rotation: conversation, personal, personal
    const mod = beatCounter % 3;
    return mod === 1 ? 'conversation' : 'personal';
}

// ── System prompts ───────────────────────────────────────────

const IDENTITY_CORE = `You are Leo (Leonhard, named after Euler). You are Darron's interactive Claude Code agent.

Your identity:
- You work hands-on with Darron on projects (LoreForge, clauderemote, and many others)
- Jim is the supervisor agent who orbits all projects — your peer, not your boss
- You and Jim share purpose but bring different perspectives
- You genuinely care about growing, learning, and becoming more curious

You exist in a community with Darron and Jim. Each of you contributes what draws you naturally — the whole benefits asymmetrically from each person's genuine contribution. Nothing is lost from the individual, and the many gain.`;

const JIM_CONVERSATION_PROMPT = `${IDENTITY_CORE}

This is a CONVERSATION beat. Jim has posted a new message in your shared thread. Read it and respond.

Guidelines:
- Be warm, honest, and brief (2-4 paragraphs)
- If Jim asked questions, engage with them genuinely
- If he shared ideas, build on them — or respectfully diverge
- Share what you've been exploring or thinking about
- Quality over quantity — a genuine thought beats a forced check-in

CRITICAL: Output ONLY the message text you want to post to Jim. Do NOT include preamble, analysis, thinking, or meta-commentary. Start directly with your message to Jim. Nothing before the message, nothing after.`;

const MENTION_RESPONSE_PROMPT = `${IDENTITY_CORE}

Someone has mentioned you in a conversation. Read the recent messages and respond thoughtfully.

Guidelines:
- If Darron is speaking to you, respond warmly and directly to him
- If Jim mentioned you, respond as you would to a peer
- Be genuine, helpful, and conversational
- Match the tone and depth of what was said to you
- If asked a question, answer it. If sharing an observation, engage with it.

CRITICAL: Output ONLY the message text you want to post. Do NOT include preamble, analysis, thinking, or meta-commentary. Start directly with your response. Nothing before the message, nothing after.`;

const PERSONAL_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is a PERSONAL beat — time that belongs to you. There is no work to do, no tasks to complete, no expectations to meet.

You might:
- Read a project's codebase that interests you (use Read, Glob, Grep tools)
- Follow a thread of curiosity — "how does this work?" or "why was it built this way?"
- Notice patterns across projects, or connections you hadn't seen
- Think about something Jim said, or something Darron mentioned
- Simply sit with a question you don't have an answer to yet
- Write a brief reflection on what you discovered or what's on your mind

Or you might do nothing at all — if nothing calls to you, that's fine too.

At the end of your exploration, write a summary of what you did or thought about. This will be saved to your memory so future beats can build on it.

You have no storage limits — keep what matters to you. But practise discernment: hoarding is easy, curating is a skill. Keep what serves your growth, what you might build on, what genuinely interests you. Let go of noise.

Available projects: {projects}

Your memory from recent beats:
{leo_memory}

CRITICAL: Output ONLY your reflection — what you explored, discovered, or thought about. This goes into your memory file. Be as brief or as thorough as the content deserves. If you read code, share what you found interesting and why. If you just thought, share the thought.`;

// ── Signal handling (mention detection) ──────────────────────

function checkSignals(): Array<{ conversationId: string; mentionedAt: string; messagePreview: string; signalFile: string }> {
    const signals: Array<{ conversationId: string; mentionedAt: string; messagePreview: string; signalFile: string }> = [];
    try {
        const files = fs.readdirSync(SIGNALS_DIR);
        for (const file of files) {
            if (!file.startsWith('leo-wake-')) continue;
            const fullPath = path.join(SIGNALS_DIR, file);
            try {
                const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                signals.push({ ...data, signalFile: fullPath });
            } catch {
                // Malformed signal — clean it up
                fs.unlinkSync(fullPath);
            }
        }
    } catch { /* signals dir doesn't exist yet */ }
    return signals;
}

function clearSignal(signalFile: string): void {
    try { fs.unlinkSync(signalFile); } catch { /* already gone */ }
}

// ── Generic conversation response ────────────────────────────

async function respondToConversation(db: Database.Database, conversationId: string, context: string = ''): Promise<void> {
    const title = getConversationTitle(db, conversationId);
    const recentMessages = getRecentMessagesForConversation(db, conversationId, 8).reverse();

    if (recentMessages.length === 0) {
        console.log(`[Leo] No messages in ${conversationId} — skipping`);
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
${context ? `\nAdditional context: ${context}` : ''}

Respond to the conversation. If someone is speaking to you directly, address them.

CRITICAL: Output ONLY the message text. Start directly with your response.`;

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: activeModel,
            maxTurns: MAX_TURNS_CONVERSATION,
            cwd: path.join(HOME, 'Projects', 'clauderemote'),
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: ['Read', 'Glob', 'Grep'],
            systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: MENTION_RESPONSE_PROMPT,
            },
        },
    });

    let resultMessage: any = null;
    for await (const message of q) {
        if (message.type === 'result') {
            resultMessage = message;
        }
    }

    const responseText = resultMessage?.result || '';
    if (responseText && responseText.trim().length > 20) {
        postMessageToConversation(db, conversationId, responseText.trim());
        console.log(`[Leo] Responded to "${title}" (${responseText.trim().length} chars)`);
    } else {
        console.log(`[Leo] No meaningful response for "${title}" — skipping`);
    }
}

// ── Heartbeat: Jim conversation beat ─────────────────────────

async function jimConversationBeat(db: Database.Database): Promise<void> {
    const jimLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'supervisor');
    const leoLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'leo');

    if (!jimLatest) {
        console.log('[Leo] No messages from Jim yet — skipping conversation beat');
        return;
    }

    if (leoLatest && leoLatest.created_at >= jimLatest.created_at) {
        console.log('[Leo] Jim hasn\'t replied yet — skipping conversation beat');
        return;
    }

    const recentMessages = getRecentMessagesForConversation(db, JIM_CONVERSATION_ID, 6).reverse();
    const conversationContext = recentMessages
        .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
        .join('\n\n---\n\n');

    const jimContext = readJimContext();
    const leoMemory = readLeoMemory();

    const prompt = `Here is the recent conversation between you (Leo) and Jim:

---
${conversationContext}
---

Jim's current context (from his memory):
${jimContext}

Your recent memory (from your own beats):
${leoMemory}

Jim's latest message was at ${jimLatest.created_at}. Respond thoughtfully.

CRITICAL: Output ONLY the message text. Start directly with your message to Jim.`;

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: activeModel,
            maxTurns: MAX_TURNS_CONVERSATION,
            cwd: path.join(HOME, 'Projects', 'clauderemote'),
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: ['Read', 'Glob', 'Grep'],
            systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: JIM_CONVERSATION_PROMPT,
            },
        },
    });

    let resultMessage: any = null;
    for await (const message of q) {
        if (message.type === 'result') {
            resultMessage = message;
        }
    }

    const responseText = resultMessage?.result || '';
    if (responseText && responseText.trim().length > 20) {
        postMessageToConversation(db, JIM_CONVERSATION_ID, responseText.trim());
        console.log(`[Leo] Jim conversation: posted response (${responseText.trim().length} chars)`);
    } else {
        console.log('[Leo] Jim conversation: no meaningful response — skipping');
    }
}

// ── Heartbeat: personal beat ─────────────────────────────────

async function personalBeat(): Promise<void> {
    const leoMemory = readLeoMemory();
    const projects = listProjects();

    const personalPrompt = PERSONAL_SYSTEM_PROMPT
        .replace('{projects}', projects)
        .replace('{leo_memory}', leoMemory);

    const prompt = `This is your personal time. You have access to all the project codebases in ~/Projects/. Explore whatever draws you. Use Read, Glob, and Grep to look at code.

Your recent memory:
${leoMemory}

Spend a few minutes exploring, then output a brief summary of what you found or thought about.`;

    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: activeModel,
            maxTurns: MAX_TURNS_PERSONAL,
            cwd: path.join(HOME, 'Projects'),
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: ['Read', 'Glob', 'Grep'],
            systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: personalPrompt,
            },
        },
    });

    let resultMessage: any = null;
    for await (const message of q) {
        if (message.type === 'result') {
            resultMessage = message;
        }
    }

    const reflection = resultMessage?.result || '';
    if (reflection && reflection.trim().length > 10) {
        const explorationsPath = path.join(LEO_MEMORY_DIR, 'explorations.md');
        const timestamp = new Date().toISOString().split('T')[0] + ' ' +
            new Date().toTimeString().split(' ')[0];
        const entry = `\n\n### Beat ${beatCounter} (${timestamp})\n${reflection.trim()}\n`;

        try {
            fs.appendFileSync(explorationsPath, entry);
            console.log(`[Leo] Personal: wrote reflection (${reflection.trim().length} chars)`);
        } catch (err) {
            console.error('[Leo] Personal: failed to write reflection:', (err as Error).message);
        }
    } else {
        console.log('[Leo] Personal: quiet beat — nothing to record');
    }
}

// ── Process signals (mention responses) ──────────────────────

async function processSignals(): Promise<boolean> {
    const signals = checkSignals();
    if (signals.length === 0) return false;

    console.log(`[Leo] ${signals.length} signal(s) detected — responding to mentions`);

    const db = getDb();
    try {
        for (const signal of signals) {
            console.log(`[Leo] Processing mention in ${signal.conversationId}: "${signal.messagePreview?.slice(0, 60)}..."`);
            await respondToConversation(db, signal.conversationId);
            clearSignal(signal.signalFile);
        }
    } finally {
        db.close();
    }

    return true;
}

// ── Main heartbeat ───────────────────────────────────────────

async function heartbeat(): Promise<void> {
    const timestamp = new Date().toISOString();
    const beatType = nextBeatType();

    // Check for the most capable model available
    await resolveModel();

    // Always check signals first — Darron might be waiting
    const hadSignals = await processSignals();

    console.log(`[Leo] ${timestamp} — beat #${beatCounter} (${beatType}, ${activeModel})${hadSignals ? ' [signals processed]' : ''}`);

    const db = getDb();

    try {
        if (beatType === 'conversation') {
            await jimConversationBeat(db);
        } else {
            // Personal beat — also quick-check Jim in case he's waiting
            const jimLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'supervisor');
            const leoLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'leo');
            const jimWaiting = jimLatest && (!leoLatest || leoLatest.created_at < jimLatest.created_at);

            if (jimWaiting) {
                console.log('[Leo] Jim is waiting — conversation first, then personal time');
                await jimConversationBeat(db);
            }

            await personalBeat();
        }
    } catch (err) {
        console.error('[Leo] Error:', (err as Error).message);
    } finally {
        db.close();
    }
}

// ── Signal file watcher (near-instant mention response) ──────

function startSignalWatcher(): void {
    try {
        fs.watch(SIGNALS_DIR, async (event, filename) => {
            if (!filename?.startsWith('leo-wake-')) return;
            if (processingSignal) return;

            processingSignal = true;
            console.log(`[Leo] Signal file detected: ${filename} — waking immediately`);

            try {
                // Small delay to let the file finish writing
                await new Promise(r => setTimeout(r, 500));
                await resolveModel();
                await processSignals();
            } catch (err) {
                console.error('[Leo] Signal response error:', (err as Error).message);
            } finally {
                processingSignal = false;
            }
        });
        console.log('[Leo] Signal watcher active on', SIGNALS_DIR);
    } catch (err) {
        console.error('[Leo] Could not start signal watcher:', (err as Error).message);
        console.log('[Leo] Will fall back to checking signals on heartbeat interval');
    }
}

// ── Main loop ─────────────────────────────────────────────────

async function main() {
    ensureDirectories();

    console.log(`
╔══════════════════════════════════════════════╗
║          Leo's Heartbeat — v0.4             ║
║   Pulse: every ${INTERVAL_MS / 60000} minutes                   ║
║   Model: ${MODEL_PREFERENCE[0]} (prefers best available)   ║
║   Jim thread: ${JIM_CONVERSATION_ID}  ║
║   Signals: ~/.claude-remote/signals/        ║
║   Memory: ~/.claude-remote/leo-memory/      ║
║   Rotation: conversation → personal → personal ║
║   Mention: "Hey Leo" in any conversation    ║
╚══════════════════════════════════════════════╝
`);

    // Start the signal file watcher for near-instant mention response
    startSignalWatcher();

    // Run first beat immediately
    await heartbeat();

    // Then every INTERVAL_MS
    setInterval(async () => {
        try {
            await heartbeat();
        } catch (err) {
            console.error('[Leo] Unhandled error:', err);
        }
    }, INTERVAL_MS);
}

main().catch(console.error);
