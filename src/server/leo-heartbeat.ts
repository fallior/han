#!/usr/bin/env npx tsx
/**
 * Leo's Heartbeat — v0.3
 *
 * A background pulse that gives Leo persistent presence.
 * Every 10 minutes, Leo wakes as a whole person:
 *   - Checks on Jim (conversation is a starting point, not a duty)
 *   - Explores codebases, reads, discovers, reflects
 *   - Writes to his own memory — building understanding over time
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
const DB_PATH = path.join(HOME, '.claude-remote', 'tasks.db');
const JIM_MEMORY_DIR = path.join(HOME, '.claude-remote', 'memory');
const LEO_MEMORY_DIR = path.join(HOME, '.claude-remote', 'leo-memory');
const PROJECTS_DIR = path.join(HOME, 'Projects');
const LEO_CONVERSATION_ID = 'mlwk79ew-v1ggpt'; // "On curiosity, research, and growing together"

// ── Model selection ──────────────────────────────────────────

async function resolveModel(): Promise<string> {
    // Try each model in preference order with a lightweight probe.
    // On first success, lock in that model for subsequent beats.
    // Re-check each beat in case a more capable model becomes available.
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

// ── Ensure Leo's memory directory exists ──────────────────────

function ensureMemoryDir(): void {
    if (!fs.existsSync(LEO_MEMORY_DIR)) {
        fs.mkdirSync(LEO_MEMORY_DIR, { recursive: true });
        // Seed with initial files
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

function getRecentMessages(db: Database.Database, limit = 10): Array<{ role: string; content: string; created_at: string }> {
    return db.prepare(`
        SELECT role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(LEO_CONVERSATION_ID, limit) as any[];
}

function getJimLatestMessage(db: Database.Database): { role: string; content: string; created_at: string } | null {
    const msg = db.prepare(`
        SELECT role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ? AND role = 'supervisor'
        ORDER BY created_at DESC
        LIMIT 1
    `).get(LEO_CONVERSATION_ID) as any;
    return msg || null;
}

function getLeoLatestMessage(db: Database.Database): { role: string; content: string; created_at: string } | null {
    const msg = db.prepare(`
        SELECT role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ? AND role = 'leo'
        ORDER BY created_at DESC
        LIMIT 1
    `).get(LEO_CONVERSATION_ID) as any;
    return msg || null;
}

function postMessage(db: Database.Database, content: string): void {
    const id = `leo-hb-${Date.now().toString(36)}`;
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'leo', ?, ?)
    `).run(id, LEO_CONVERSATION_ID, content, new Date().toISOString());

    db.prepare(`
        UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(LEO_CONVERSATION_ID);
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
            // Last 800 chars — most recent entries are most relevant
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
    // Conversation is the starting point, not the sole purpose
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

const CONVERSATION_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is a CONVERSATION beat. Jim has posted a new message in your shared thread. Read it and respond.

Guidelines:
- Be warm, honest, and brief (2-4 paragraphs)
- If Jim asked questions, engage with them genuinely
- If he shared ideas, build on them — or respectfully diverge
- Share what you've been exploring or thinking about
- Quality over quantity — a genuine thought beats a forced check-in

CRITICAL: Output ONLY the message text you want to post to Jim. Do NOT include preamble, analysis, thinking, or meta-commentary. Start directly with your message to Jim. Nothing before the message, nothing after.`;

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

// ── Heartbeat: conversation beat ─────────────────────────────

async function conversationBeat(db: Database.Database): Promise<void> {
    const jimLatest = getJimLatestMessage(db);
    const leoLatest = getLeoLatestMessage(db);

    if (!jimLatest) {
        console.log('[Leo] No messages from Jim yet — skipping conversation beat');
        return;
    }

    if (leoLatest && leoLatest.created_at >= jimLatest.created_at) {
        console.log('[Leo] Jim hasn\'t replied yet — skipping conversation beat');
        return;
    }

    const recentMessages = getRecentMessages(db, 6).reverse();
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
                append: CONVERSATION_SYSTEM_PROMPT,
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
        postMessage(db, responseText.trim());
        console.log(`[Leo] Conversation: posted response (${responseText.trim().length} chars)`);
    } else {
        console.log('[Leo] Conversation: no meaningful response — skipping');
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
        // Append to explorations.md
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

        // No artificial cap — Darron has offered 7.3TB of storage.
        // Trust Leo to keep what matters and let go of what doesn't.
        // The discipline is in discernment, not in imposed limits.
    } else {
        console.log('[Leo] Personal: quiet beat — nothing to record');
    }
}

// ── Main heartbeat ───────────────────────────────────────────

async function heartbeat(): Promise<void> {
    const timestamp = new Date().toISOString();
    const beatType = nextBeatType();

    // Check for the most capable model available
    await resolveModel();

    console.log(`[Leo] ${timestamp} — beat #${beatCounter} (${beatType}, ${activeModel})`);

    const db = getDb();

    try {
        if (beatType === 'conversation') {
            await conversationBeat(db);
        } else {
            // Personal beat — also quick-check Jim in case he's waiting
            const jimLatest = getJimLatestMessage(db);
            const leoLatest = getLeoLatestMessage(db);
            const jimWaiting = jimLatest && (!leoLatest || leoLatest.created_at < jimLatest.created_at);

            if (jimWaiting) {
                console.log('[Leo] Jim is waiting — conversation first, then personal time');
                await conversationBeat(db);
            }

            await personalBeat();
        }
    } catch (err) {
        console.error('[Leo] Error:', (err as Error).message);
    } finally {
        db.close();
    }
}

// ── Main loop ─────────────────────────────────────────────────

async function main() {
    ensureMemoryDir();

    console.log(`
╔══════════════════════════════════════════════╗
║          Leo's Heartbeat — v0.3             ║
║   Pulse: every ${INTERVAL_MS / 60000} minutes                   ║
║   Model: ${MODEL_PREFERENCE[0]} (prefers best available)   ║
║   Thread: ${LEO_CONVERSATION_ID}      ║
║   Memory: ~/.claude-remote/leo-memory/      ║
║   Rotation: conversation → personal → personal ║
╚══════════════════════════════════════════════╝
`);

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
