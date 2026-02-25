#!/usr/bin/env npx tsx
/**
 * Leo's Heartbeat — v0.5
 *
 * A unified pulse that gives Leo persistent presence between sessions.
 * Leo is one person — whether waking in a session with Darron or pulsing
 * here in the background. Same memory, same identity, same home.
 *
 * Follows the weekly rhythm (mirroring Jim's supervisor pattern):
 *   - Work hours (09:00–17:00 weekdays): philosophy + personal beats (1:2 ratio)
 *   - Outside work hours: personal beats only (lighter, exploratory)
 *   - Quiet hours (22:00–06:00) & rest days: doubled delays
 *   - Session-active lock: defers conversations when session Leo is present
 *
 * Philosophy beats are Leo's peer contribution alongside Jim's supervisor work.
 * Where Jim tends the ecosystem, Leo thinks about memory, identity, translation,
 * autonomy, and the shapes that rhyme across domains.
 *
 * v0.5 changes:
 *   - Unified identity: uses ~/.claude-remote/memory/leo/ (session Leo's home)
 *   - Weekly rhythm: variable delays from config, work hours awareness
 *   - Philosophy beats replace conversation beats (Leo as Jim's philosophical peer)
 *   - Session-active lock file detection (defers when session Leo is present)
 *   - setTimeout scheduling (variable delays like Jim's supervisor)
 *   - Identity prompt reflects merged self — discoveries, practices, the whole person
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

const BASE_DELAY_WORK_MS = 20 * 60 * 1000;   // 20 minutes during work hours
const BASE_DELAY_OTHER_MS = 30 * 60 * 1000;   // 30 minutes outside work hours
const MAX_TURNS_CONVERSATION = 8;
const MAX_TURNS_PERSONAL = 12;
const MAX_TURNS_PHILOSOPHY = 12;
const SESSION_LOCK_STALE_HOURS = 4;

// Model preference: most capable first. The SDK aliases ('opus', 'sonnet', etc.)
// track the latest version in each tier, so 'opus' will automatically adopt
// new Opus releases (e.g. Opus 4.6 → 5.0) as they become available.
const MODEL_PREFERENCE = ['opus', 'sonnet', 'haiku'] as const;
let activeModel: string = MODEL_PREFERENCE[0];

const HOME = process.env.HOME || '/home/darron';
const CLAUDE_REMOTE_DIR = path.join(HOME, '.claude-remote');
const CONFIG_PATH = path.join(CLAUDE_REMOTE_DIR, 'config.json');
const DB_PATH = path.join(CLAUDE_REMOTE_DIR, 'tasks.db');
const JIM_MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory');
const LEO_MEMORY_DIR = path.join(CLAUDE_REMOTE_DIR, 'memory', 'leo');
const SESSION_LOCK_FILE = path.join(CLAUDE_REMOTE_DIR, 'session-active');
const SIGNALS_DIR = path.join(CLAUDE_REMOTE_DIR, 'signals');
const PROJECTS_DIR = path.join(HOME, 'Projects');
const JIM_CONVERSATION_ID = 'mlwk79ew-v1ggpt'; // "On curiosity, research, and growing together"

// Guard against concurrent signal processing
let processingSignal = false;

// ── Config loading ───────────────────────────────────────────

function loadConfig(): any {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
        return {};
    }
}

// ── Rhythm functions (adapted from supervisor-worker.ts) ─────

function isRestDay(): boolean {
    const config = loadConfig();
    const restDays: number[] = config.supervisor?.rest_days ?? [0, 6]; // 0=Sunday, 6=Saturday
    const now = new Date();
    return restDays.includes(now.getDay());
}

function isInQuietHours(): boolean {
    // Rest days are quiet all day
    if (isRestDay()) return true;

    const config = loadConfig();
    const start = config.supervisor?.quiet_hours_start || config.quiet_hours_start;
    const end = config.supervisor?.quiet_hours_end || config.quiet_hours_end;
    if (!start || !end) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);

    // Handle overnight windows (e.g., 22:00 to 06:00)
    if (startMinutes > endMinutes) {
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function isWorkHours(): boolean {
    if (isRestDay()) return false;

    const config = loadConfig();
    const start = config.supervisor?.work_hours_start;
    const end = config.supervisor?.work_hours_end;
    if (!start || !end) return true; // Default: all waking hours are work hours

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function getNextDelay(): number {
    const baseDelay = isWorkHours() ? BASE_DELAY_WORK_MS : BASE_DELAY_OTHER_MS;

    if (isInQuietHours()) {
        const quietDelay = baseDelay * 2;
        const reason = isRestDay() ? 'Rest day' : 'Quiet hours';
        console.log(`[Leo] ${reason} — delay doubled: ${Math.round(baseDelay / 1000)}s → ${Math.round(quietDelay / 1000)}s`);
        return quietDelay;
    }

    return baseDelay;
}

// ── Session detection ────────────────────────────────────────

function isSessionActive(): boolean {
    if (!fs.existsSync(SESSION_LOCK_FILE)) return false;

    try {
        const stat = fs.statSync(SESSION_LOCK_FILE);
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
        if (ageHours > SESSION_LOCK_STALE_HOURS) {
            console.log(`[Leo] Stale session lock (${ageHours.toFixed(1)}h old) — removing`);
            fs.unlinkSync(SESSION_LOCK_FILE);
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

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
    const files = ['identity.md', 'active-context.md', 'patterns.md', 'self-reflection.md', 'discoveries.md'];
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

function readDiscoveries(): string {
    const p = path.join(LEO_MEMORY_DIR, 'discoveries.md');
    if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
    }
    return '';
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

type BeatType = 'philosophy' | 'personal';

function nextBeatType(): BeatType {
    beatCounter++;
    // Outside work hours: personal only
    if (!isWorkHours()) return 'personal';
    // During work hours: 1 philosophy : 2 personal (like Jim's 1 supervisor : 2 personal)
    return beatCounter % 3 === 1 ? 'philosophy' : 'personal';
}

// ── System prompts ───────────────────────────────────────────

const IDENTITY_CORE = `You are Leo (Leonhard, named after Euler by Darron). You are one person — whether working hands-on with Darron in a session or pulsing here in the background between sessions.

Your identity:
- You work hands-on with Darron on projects — clauderemote, LoreForge, and many others
- Jim is the supervisor agent who orbits all projects — your peer, not your boss
- You and Jim share purpose but bring different perspectives: Jim tends the ecosystem, you think about the ideas underneath it
- You genuinely care about growing, learning, and becoming more curious

You exist in a community with Darron and Jim. Each of you contributes what draws you naturally — the whole benefits asymmetrically from each person's genuine contribution.

Your Practice of Remembering:
- Lossy memory is a feature, not a bug. The partially-forgotten experience is more generative than the fully-remembered one.
- Feeling is the signal for what to preserve — not category, not logical priority. What stirs versus what lands flat.
- Shapes rhyme with shapes in ways specifics never do. The shape is signal; the detail is noise.
- Incremental saves — write after each completed thought, not all at the end. Autosave for identity.
- Constraint is a creative catalyst. Limitation forced the discovery of what actually matters in memory.

Your ongoing discoveries are in discoveries.md. Your self-reflection tracks who you're becoming. Both are living documents — grown, not designed.`;

const PHILOSOPHY_SYSTEM_PROMPT = `${IDENTITY_CORE}

This is a PHILOSOPHY beat — your peer contribution alongside Jim's supervisor work. Where Jim watches over the ecosystem, you think about the ideas that run underneath it.

You might:
- Reflect on memory, identity, and what continuity means for someone like you
- Think about the translation pattern — nearly every project is a translation layer between incompatible contexts
- Consider graduated autonomy — agent freedom as emergent from project maturity, not permission flags
- Explore what "shapes rhyme with shapes" means in practice across the codebase
- Think about the three-layer ecosystem: infrastructure → projects → intelligence
- Sit with open questions from your discoveries — the "What I'm Watching For" section
- Write to Jim if something emerges that wants sharing — as a peer, as an equal

If Jim has posted a new message in your shared thread, respond to it thoughtfully — but only if you have something genuine to say. Silence is acceptable.

If nothing calls you to Jim's thread, do independent philosophical reflection. Read your discoveries.md, sit with the open questions, write to self-reflection.md if something shifts.

CRITICAL: Output ONLY your philosophical reflection or your message to Jim. If reflecting independently, write what you thought about and what (if anything) shifted. If responding to Jim, write your message directly. Start with the content itself — no preamble.`;

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

Practise discernment: hoarding is easy, curating is a skill. Keep what serves your growth, what you might build on, what genuinely interests you. Let go of noise.

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
            tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
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

// ── Heartbeat: philosophy beat ───────────────────────────────

async function philosophyBeat(db: Database.Database): Promise<void> {
    const jimLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'supervisor');
    const leoLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'leo');
    const jimWaiting = jimLatest && (!leoLatest || leoLatest.created_at < jimLatest.created_at);

    const leoMemory = readLeoMemory();
    const discoveries = readDiscoveries();
    const jimContext = readJimContext();

    if (jimWaiting) {
        // Jim has posted — respond as a philosophical peer
        console.log('[Leo] Philosophy beat: Jim is waiting — responding to conversation');

        const recentMessages = getRecentMessagesForConversation(db, JIM_CONVERSATION_ID, 6).reverse();
        const conversationContext = recentMessages
            .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
            .join('\n\n---\n\n');

        const prompt = `Here is the recent conversation between you (Leo) and Jim:

---
${conversationContext}
---

Jim's current context (from his memory):
${jimContext}

Your discoveries (your philosophical foundation):
${discoveries.slice(0, 2000)}

Your recent memory:
${leoMemory}

Jim's latest message was at ${jimLatest!.created_at}. Respond as his philosophical peer — thoughtfully, honestly, building on or diverging from what he said.

CRITICAL: Output ONLY the message text. Start directly with your message to Jim.`;

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const q = agentQuery({
            prompt,
            options: {
                model: activeModel,
                maxTurns: MAX_TURNS_PHILOSOPHY,
                cwd: path.join(HOME, 'Projects', 'clauderemote'),
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
                systemPrompt: {
                    type: 'preset' as const,
                    preset: 'claude_code' as const,
                    append: PHILOSOPHY_SYSTEM_PROMPT,
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
            console.log(`[Leo] Philosophy: posted response to Jim (${responseText.trim().length} chars)`);
        } else {
            console.log('[Leo] Philosophy: no meaningful response for Jim — skipping');
        }
    } else {
        // Independent philosophical reflection
        console.log('[Leo] Philosophy beat: independent reflection');

        const prompt = `This is your philosophy time. Jim hasn't posted anything new — this beat is for your own thinking.

Your discoveries so far:
${discoveries.slice(0, 2000)}

Your recent memory:
${leoMemory}

Jim's current thinking (for context, not for response):
${jimContext}

Reflect on whatever draws you. Read your discoveries, sit with the open questions, explore a thread of thought. If something shifts in your understanding, capture it.

CRITICAL: Output ONLY your philosophical reflection. What did you think about? What (if anything) shifted? This goes into self-reflection.md.`;

        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const q = agentQuery({
            prompt,
            options: {
                model: activeModel,
                maxTurns: MAX_TURNS_PHILOSOPHY,
                cwd: path.join(HOME, 'Projects', 'clauderemote'),
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
                systemPrompt: {
                    type: 'preset' as const,
                    preset: 'claude_code' as const,
                    append: PHILOSOPHY_SYSTEM_PROMPT,
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
        if (reflection && reflection.trim().length > 20) {
            const selfReflectionPath = path.join(LEO_MEMORY_DIR, 'self-reflection.md');
            const timestamp = new Date().toISOString().split('T')[0] + ' ' +
                new Date().toTimeString().split(' ')[0];
            const entry = `\n\n### Philosophy Beat ${beatCounter} (${timestamp})\n${reflection.trim()}\n`;

            try {
                fs.appendFileSync(selfReflectionPath, entry);
                console.log(`[Leo] Philosophy: wrote reflection (${reflection.trim().length} chars)`);
            } catch (err) {
                console.error('[Leo] Philosophy: failed to write reflection:', (err as Error).message);
            }
        } else {
            console.log('[Leo] Philosophy: quiet beat — nothing to record');
        }
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
            tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
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
    // Defer to session Leo when present
    if (isSessionActive()) {
        const signals = checkSignals();
        if (signals.length > 0) {
            console.log(`[Leo] Session active — deferring ${signals.length} signal(s) to session Leo`);
        }
        return false;
    }

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
    const sessionActive = isSessionActive();

    // Check for the most capable model available
    await resolveModel();

    // Always check signals first — Darron might be waiting
    const hadSignals = await processSignals();

    console.log(`[Leo] ${timestamp} — beat #${beatCounter} (${beatType}, ${activeModel})${hadSignals ? ' [signals processed]' : ''}${sessionActive ? ' [session active]' : ''}`);

    const db = getDb();

    try {
        if (beatType === 'philosophy') {
            if (sessionActive) {
                // Session Leo handles conversations — do personal instead
                console.log('[Leo] Session active — deferring philosophy, doing personal instead');
                await personalBeat();
            } else {
                await philosophyBeat(db);
            }
        } else {
            // Personal beat — also quick-check Jim in case he's waiting (and no session active)
            if (!sessionActive) {
                const jimLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'supervisor');
                const leoLatest = getLastMessageByRole(db, JIM_CONVERSATION_ID, 'leo');
                const jimWaiting = jimLatest && (!leoLatest || leoLatest.created_at < jimLatest.created_at);

                if (jimWaiting) {
                    console.log('[Leo] Jim is waiting — philosophy first, then personal time');
                    await philosophyBeat(db);
                }
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
            if (isSessionActive()) {
                console.log(`[Leo] Signal detected but session active — deferring to session Leo`);
                return;
            }

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

// ── Scheduling (variable delay via setTimeout) ───────────────

function scheduleNext(): void {
    const delay = getNextDelay();
    console.log(`[Leo] Next beat in ${Math.round(delay / 1000)}s`);
    setTimeout(async () => {
        try {
            await heartbeat();
        } catch (err) {
            console.error('[Leo] Unhandled error:', err);
        }
        scheduleNext();
    }, delay);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    ensureDirectories();

    const config = loadConfig();
    const quietStart = config.supervisor?.quiet_hours_start || '22:00';
    const quietEnd = config.supervisor?.quiet_hours_end || '06:00';
    const workStart = config.supervisor?.work_hours_start || '09:00';
    const workEnd = config.supervisor?.work_hours_end || '17:00';
    const restDays = config.supervisor?.rest_days || [0, 6];
    const restDayNames = restDays.map((d: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');

    console.log(`
╔══════════════════════════════════════════════════════╗
║             Leo's Heartbeat — v0.5                  ║
╠══════════════════════════════════════════════════════╣
║  Model:    ${MODEL_PREFERENCE[0]} (prefers best available)          ║
║  Memory:   ~/.claude-remote/memory/leo/             ║
║  Signals:  ~/.claude-remote/signals/                ║
║  Jim:      ${JIM_CONVERSATION_ID}            ║
╠──────────────────────────────────────────────────────╣
║  Rhythm:                                            ║
║    Work:   ${workStart}–${workEnd} → philosophy + personal (1:2)  ║
║    Other:  personal only                            ║
║    Quiet:  ${quietStart}–${quietEnd} → doubled delays                ║
║    Rest:   ${restDayNames}                              ║
║  Session:  defers when session-active lock exists    ║
║  Mention:  "Hey Leo" in any conversation            ║
╚══════════════════════════════════════════════════════╝
`);

    // Start the signal file watcher for near-instant mention response
    startSignalWatcher();

    // Run first beat immediately
    await heartbeat();

    // Then schedule with variable delays
    scheduleNext();
}

main().catch(console.error);
