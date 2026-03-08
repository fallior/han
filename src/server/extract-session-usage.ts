#!/usr/bin/env npx tsx
/**
 * Extract token usage from Claude Code session JSONL logs
 * and insert into agent_usage table.
 *
 * Usage:
 *   npx tsx extract-session-usage.ts                    # Process all unprocessed sessions
 *   npx tsx extract-session-usage.ts --dry-run          # Show what would be inserted
 *   npx tsx extract-session-usage.ts <session-id>       # Process specific session
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const HOME = process.env.HOME || '/home/darron';
const DB_PATH = path.join(HOME, '.han', 'tasks.db');
const SESSIONS_DIR = path.join(HOME, '.claude', 'projects', '-home-darron-Projects-clauderemote');

const dryRun = process.argv.includes('--dry-run');
const specificSession = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);

interface SessionUsage {
    sessionId: string;
    startTime: string;
    endTime: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    messageCount: number;
    model: string;
}

async function extractUsage(filePath: string): Promise<SessionUsage | null> {
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
    });

    let sessionId = '';
    let startTime = '';
    let endTime = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreation = 0;
    let cacheRead = 0;
    let messageCount = 0;
    let model = '';

    for await (const line of rl) {
        try {
            const d = JSON.parse(line);

            if (d.sessionId && !sessionId) sessionId = d.sessionId;

            if (d.type === 'assistant' && d.message?.usage) {
                const u = d.message.usage;
                inputTokens += u.input_tokens || 0;
                outputTokens += u.output_tokens || 0;
                cacheCreation += u.cache_creation_input_tokens || 0;
                cacheRead += u.cache_read_input_tokens || 0;
                messageCount++;

                if (d.message.model && !model) model = d.message.model;
                if (d.timestamp) {
                    if (!startTime) startTime = d.timestamp;
                    endTime = d.timestamp;
                }
            }

            if (d.timestamp) {
                if (!startTime) startTime = d.timestamp;
                endTime = d.timestamp;
            }
        } catch {
            // Skip malformed lines
        }
    }

    if (messageCount === 0) return null;

    return {
        sessionId: sessionId || path.basename(filePath, '.jsonl'),
        startTime,
        endTime,
        inputTokens,
        outputTokens,
        cacheCreation,
        cacheRead,
        messageCount,
        model,
    };
}

async function main() {
    const db = new Database(DB_PATH);

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

    // Get already-processed session IDs
    const processed = new Set(
        (db.prepare("SELECT context FROM agent_usage WHERE agent = 'session-leo' AND context LIKE 'session:%'").all() as any[])
            .map(r => r.context.replace('session:', ''))
    );

    const files = specificSession
        ? [path.join(SESSIONS_DIR, `${specificSession}.jsonl`)]
        : fs.readdirSync(SESSIONS_DIR)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => path.join(SESSIONS_DIR, f));

    const insert = db.prepare(
        'INSERT INTO agent_usage (agent, timestamp, cost_usd, tokens_in, tokens_out, num_turns, model, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    let insertedCount = 0;
    let skippedCount = 0;

    for (const filePath of files) {
        const sessionId = path.basename(filePath, '.jsonl');

        if (processed.has(sessionId)) {
            skippedCount++;
            continue;
        }

        // Skip files modified in last 5 minutes (likely active session)
        const stat = fs.statSync(filePath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 5 * 60 * 1000 && !specificSession) {
            console.log(`  Skipping ${sessionId} — active (${Math.round(ageMs / 1000)}s old)`);
            continue;
        }

        const usage = await extractUsage(filePath);
        if (!usage) continue;

        // Estimate cost (rough — Opus pricing)
        const costPerInputToken = 15 / 1_000_000;  // $15/MTok
        const costPerOutputToken = 75 / 1_000_000;  // $75/MTok
        const costPerCacheWrite = 3.75 / 1_000_000;  // $3.75/MTok
        const costPerCacheRead = 1.50 / 1_000_000;   // $1.50/MTok (5-min)
        const estimatedCost =
            usage.inputTokens * costPerInputToken +
            usage.outputTokens * costPerOutputToken +
            usage.cacheCreation * costPerCacheWrite +
            usage.cacheRead * costPerCacheRead;

        const totalInput = usage.inputTokens + usage.cacheCreation + usage.cacheRead;

        if (dryRun) {
            console.log(`  Would insert: ${sessionId}`);
            console.log(`    Time: ${usage.startTime} → ${usage.endTime}`);
            console.log(`    In: ${totalInput.toLocaleString()} (${usage.inputTokens.toLocaleString()} direct + ${usage.cacheCreation.toLocaleString()} cache-write + ${usage.cacheRead.toLocaleString()} cache-read)`);
            console.log(`    Out: ${usage.outputTokens.toLocaleString()}`);
            console.log(`    Messages: ${usage.messageCount}, Est cost: $${estimatedCost.toFixed(2)}`);
        } else {
            insert.run(
                'session-leo',
                usage.startTime,
                estimatedCost,
                totalInput,
                usage.outputTokens,
                usage.messageCount,
                usage.model,
                `session:${sessionId}`
            );
            insertedCount++;
            console.log(`  Inserted: ${sessionId} — ${usage.messageCount} msgs, ${totalInput.toLocaleString()}in/${usage.outputTokens.toLocaleString()}out, ~$${estimatedCost.toFixed(2)}`);
        }
    }

    console.log(`\nDone. Inserted: ${insertedCount}, Skipped (already processed): ${skippedCount}`);
    db.close();
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
