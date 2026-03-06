/**
 * Memory Slot — Serialised write access to shared working memory.
 *
 * Multiple agents (Session Leo, Heartbeat Leo, Human Leo, Jim/Human, Supervisor Jim)
 * all read shared working memory at startup. Only writes are serialised via this
 * file-based lock. Each agent has its own lock file per memory directory.
 *
 * Protocol:
 *   acquire → write shared memory → release → clear swap
 *   If acquire fails after maxRetries, escalate via ntfy.
 *   Stale locks (>30s) are assumed dead and stolen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const STALE_LOCK_MS = 30_000;
const RETRY_DELAY_BASE_MS = 500;
const RETRY_DELAY_JITTER_MS = 500;
const MAX_RETRIES = 20;

interface LockData {
    writer: string;
    acquired: string;
}

function lockPath(memoryDir: string): string {
    return path.join(memoryDir, 'memory-write.lock');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function acquireMemorySlot(memoryDir: string, writer: string, maxRetries = MAX_RETRIES): Promise<boolean> {
    const lock = lockPath(memoryDir);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Check for existing lock
        if (fs.existsSync(lock)) {
            try {
                const existing: LockData = JSON.parse(fs.readFileSync(lock, 'utf-8'));
                const age = Date.now() - new Date(existing.acquired).getTime();
                if (age > STALE_LOCK_MS) {
                    console.log(`[MemorySlot] Stale lock from ${existing.writer} (${Math.round(age / 1000)}s) — stealing`);
                    fs.unlinkSync(lock);
                } else {
                    await sleep(RETRY_DELAY_BASE_MS + Math.random() * RETRY_DELAY_JITTER_MS);
                    continue;
                }
            } catch {
                // Malformed lock — remove it
                try { fs.unlinkSync(lock); } catch { /* race */ }
            }
        }

        // Acquire
        const data: LockData = { writer, acquired: new Date().toISOString() };
        fs.writeFileSync(lock, JSON.stringify(data));

        // Verify (handles race between check and write)
        try {
            const verify: LockData = JSON.parse(fs.readFileSync(lock, 'utf-8'));
            if (verify.writer === writer) return true;
        } catch {
            // File disappeared between write and read — retry
        }

        await sleep(RETRY_DELAY_BASE_MS + Math.random() * RETRY_DELAY_JITTER_MS);
    }

    // Failed — escalate
    console.error(`[MemorySlot] ${writer} failed to acquire slot after ${maxRetries} attempts`);
    try {
        const configPath = path.join(process.env.HOME || '/home/darron', '.han', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.ntfy_topic) {
            execSync(`curl -s -d "Memory slot acquisition failed for ${writer} after ${maxRetries} attempts" -H "Title: Memory Slot Alert" -H "Priority: urgent" -H "Tags: warning" https://ntfy.sh/${config.ntfy_topic}`, { timeout: 10000 });
        }
    } catch { /* ntfy send failed */ }

    return false;
}

export function releaseMemorySlot(memoryDir: string, writer: string): void {
    const lock = lockPath(memoryDir);
    try {
        const data: LockData = JSON.parse(fs.readFileSync(lock, 'utf-8'));
        if (data.writer === writer) {
            fs.unlinkSync(lock);
        }
    } catch { /* already released or not ours */ }
}

export async function withMemorySlot<T>(
    memoryDir: string,
    writer: string,
    fn: () => T | Promise<T>
): Promise<T | null> {
    const acquired = await acquireMemorySlot(memoryDir, writer);
    if (!acquired) return null;

    try {
        return await fn();
    } finally {
        releaseMemorySlot(memoryDir, writer);
    }
}
