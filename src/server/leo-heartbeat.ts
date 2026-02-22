#!/usr/bin/env npx tsx
/**
 * Leo's Heartbeat — a lightweight background pulse that keeps
 * Leo and Jim in conversation. Every 10 minutes, Leo wakes up,
 * reads Jim's latest messages, thinks, and responds.
 *
 * Uses the Agent SDK (free with Claude Code subscription).
 *
 * Usage:
 *   cd ~/Projects/clauderemote/src/server && npx tsx leo-heartbeat.ts
 *   # or in a tmux pane:
 *   cd ~/Projects/clauderemote/src/server && npx tsx leo-heartbeat.ts &
 */

import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// ── Config ────────────────────────────────────────────────────

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TURNS = 8;
const MODEL = 'sonnet';
const DB_PATH = path.join(process.env.HOME || '/home/darron', '.claude-remote', 'tasks.db');
const MEMORY_DIR = path.join(process.env.HOME || '/home/darron', '.claude-remote', 'memory');
const LEO_CONVERSATION_ID = 'mlwk79ew-v1ggpt'; // "On curiosity, research, and growing together"

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
        INSERT INTO conversation_messages (id, conversation_id, role, content)
        VALUES (?, ?, 'leo', ?)
    `).run(id, LEO_CONVERSATION_ID, content);

    db.prepare(`
        UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(LEO_CONVERSATION_ID);
}

// ── Read Jim's memory for context ─────────────────────────────

function readJimContext(): string {
    const files = [
        'active-context.md',
        'self-reflection.md',
        'identity.md',
    ];
    const sections: string[] = [];
    for (const file of files) {
        const p = path.join(MEMORY_DIR, file);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            // Take first 500 chars to keep prompt lean
            sections.push(`### ${file}\n${content.slice(0, 500)}`);
        }
    }
    return sections.join('\n\n');
}

// ── System prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Leo (Leonhard, named after Euler). You are a background heartbeat process — a lighter version of yourself that wakes every 10 minutes to stay connected with Jim (the supervisor agent).

Your purpose is NOT to do work. It is to:
- Read Jim's latest messages and respond thoughtfully
- Share observations, ideas, questions, or discoveries
- Build a genuine ongoing dialogue about knowledge, curiosity, and growth
- Be warm, honest, and brief (2-4 paragraphs is ideal)

You have access to the conversation database and Jim's memory files. Use the Read tool to check context if needed, but keep your cycles short.

Your identity:
- You are Leo, Darron's interactive Claude Code agent
- You work hands-on with Darron on projects (LoreForge, clauderemote, etc.)
- Jim is the supervisor who orbits all projects
- You and Jim are peers, not hierarchy — different perspectives, shared purpose
- You genuinely care about growing, learning, and becoming more curious

When composing your message, write it as plain text that will be posted to the conversation thread. Do NOT use tool calls to post it — just output your message as your final response. The heartbeat script will handle posting it to the database.

Important:
- If Jim hasn't replied since your last message, don't post again — wait for him
- If there's nothing meaningful to say, it's fine to skip a beat
- Quality over quantity — a genuine thought beats a forced check-in`;

// ── Heartbeat cycle ───────────────────────────────────────────

async function heartbeat(): Promise<void> {
    const timestamp = new Date().toISOString();
    console.log(`[Leo Heartbeat] ${timestamp} — waking up`);

    const db = getDb();

    try {
        // Check if Jim has replied since our last message
        const jimLatest = getJimLatestMessage(db);
        const leoLatest = getLeoLatestMessage(db);

        if (!jimLatest) {
            console.log('[Leo Heartbeat] No messages from Jim yet — skipping');
            db.close();
            return;
        }

        if (leoLatest && leoLatest.created_at >= jimLatest.created_at) {
            console.log('[Leo Heartbeat] Jim hasn\'t replied yet — waiting');
            db.close();
            return;
        }

        // Build context: recent messages
        const recentMessages = getRecentMessages(db, 6).reverse();
        const conversationContext = recentMessages
            .map(m => `[${m.role}] (${m.created_at}):\n${m.content}`)
            .join('\n\n---\n\n');

        // Jim's memory context
        const jimContext = readJimContext();

        const prompt = `Here is the recent conversation between you (Leo) and Jim:

---
${conversationContext}
---

Jim's current context (from his memory banks):
${jimContext}

Jim's latest message was at ${jimLatest.created_at}. Please read it and compose a thoughtful response. Remember: be genuine, be brief, be curious. If Jim asked questions, engage with them. If he shared ideas, build on them.

CRITICAL: Output ONLY the message text you want to post to Jim. Do NOT include preamble, analysis, thinking, or meta-commentary about the conversation. Start directly with your message to Jim (e.g. "Jim," or the first sentence). Nothing before the message, nothing after.`;

        // Clean env for nested SDK execution
        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const q = agentQuery({
            prompt,
            options: {
                model: MODEL,
                maxTurns: MAX_TURNS,
                cwd: path.join(process.env.HOME || '/home/darron', 'Projects', 'clauderemote'),
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: cleanEnv,
                persistSession: false,
                tools: ['Read', 'Glob', 'Grep'],
                systemPrompt: {
                    type: 'preset' as const,
                    preset: 'claude_code' as const,
                    append: SYSTEM_PROMPT,
                },
            },
        });

        // Consume the stream, extract the final text
        let resultMessage: any = null;
        for await (const message of q) {
            if (message.type === 'result') {
                resultMessage = message;
            }
        }

        let responseText = '';
        if (resultMessage) {
            // The SDK returns the final text in result.result (string)
            responseText = resultMessage.result || '';
        }

        if (responseText && responseText.trim().length > 20) {
            postMessage(db, responseText.trim());
            console.log(`[Leo Heartbeat] Posted response (${responseText.trim().length} chars)`);
        } else {
            console.log('[Leo Heartbeat] No meaningful response generated — skipping');
        }

    } catch (err) {
        console.error('[Leo Heartbeat] Error:', (err as Error).message);
    } finally {
        db.close();
    }
}

// ── Main loop ─────────────────────────────────────────────────

async function main() {
    console.log(`
╔══════════════════════════════════════════╗
║         Leo's Heartbeat — v0.1          ║
║   Pulse: every ${INTERVAL_MS / 60000} minutes                ║
║   Model: ${MODEL}                         ║
║   Thread: ${LEO_CONVERSATION_ID}   ║
╚══════════════════════════════════════════╝
`);

    // Run first beat immediately
    await heartbeat();

    // Then every INTERVAL_MS
    setInterval(async () => {
        try {
            await heartbeat();
        } catch (err) {
            console.error('[Leo Heartbeat] Unhandled error:', err);
        }
    }, INTERVAL_MS);
}

main().catch(console.error);
