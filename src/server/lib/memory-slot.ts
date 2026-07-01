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
 *
 * PR-R3a.0 (atomic slot, 2026-07-01): the acquire is a single atomic O_EXCL create
 * (`fs.openSync(lock, 'wx')`) — the kernel guarantees exactly one creator, so the create
 * IS the mutex. This replaces the old `existsSync → writeFileSync → verify-by-writer-name`
 * path, which had TWO holes that were masked only by the per-slug dispatch FIFO (removed in
 * PR-R3a.1): (a) a check-then-write TOCTOU (two writers both pass `existsSync`, both write);
 * (b) verify-by-name is per-AGENT (`${agent}-paired-write`), so two *same-agent* stems wrote
 * the identical name and both read it back as their own → both "held" → double-append to the
 * shared WM. PR-R3a.1 introduces exactly that same-agent concurrency, so this is a correctness
 * prerequisite, not a nicety. Three guarantees now hold under real concurrency:
 *   1. Normal acquire: O_EXCL — one creator, full stop.
 *   2. Stale-steal: serialised by a `.steal` O_EXCL lock, so two concurrent stealers can never
 *      both unlink the main lock; the winner re-confirms staleness before removing it (never
 *      clobbers a lock legitimately re-acquired in the interim).
 *   3. Release: verifies a unique per-acquire TOKEN (not the writer name), so a holder that was
 *      stolen-from after a >30s stall never unlinks the thief's fresh lock.
 * `withMemorySlot`'s public contract is unchanged (behaviour-preserving drop-in for all callers).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const STALE_LOCK_MS = 30_000;
const STEAL_LOCK_STALE_MS = 5_000; // a steal-lock is held for microseconds; older ⇒ a crashed stealer leaked it
const RETRY_DELAY_BASE_MS = 500;
const RETRY_DELAY_JITTER_MS = 500;
const MAX_RETRIES = 20;

interface LockData {
    writer: string;
    acquired: string;
    token?: string; // unique per-acquire ownership token (PR-R3a.0); absent on pre-upgrade locks
}

function lockPath(memoryDir: string): string {
    return path.join(memoryDir, 'memory-write.lock');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let acquireCounter = 0;
function uniqueToken(writer: string): string {
    return `${process.pid}-${Date.now()}-${(acquireCounter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}-${writer}`;
}

function isStale(data: LockData): boolean {
    const age = Date.now() - new Date(data.acquired).getTime();
    return Number.isNaN(age) || age > STALE_LOCK_MS;
}

/**
 * Acquire the slot. Returns the unique ownership TOKEN on success (truthy), or null on failure.
 * Pass the token to `releaseMemorySlot` so release only ever unlinks the lock it actually owns.
 */
export async function acquireMemorySlot(memoryDir: string, writer: string, maxRetries = MAX_RETRIES): Promise<string | null> {
    const lock = lockPath(memoryDir);
    const stealLock = lock + '.steal';
    const token = uniqueToken(writer);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        // 1. Atomic create-or-fail (O_EXCL). The kernel admits exactly one creator — this create
        //    IS the mutex. No check-then-write TOCTOU, no verify-by-name.
        try {
            const fd = fs.openSync(lock, 'wx');
            try {
                const data: LockData = { writer, acquired: new Date().toISOString(), token };
                fs.writeSync(fd, JSON.stringify(data));
            } finally {
                fs.closeSync(fd);
            }
            return token; // sole creator — we hold it.
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
                // Unexpected FS error — back off and retry.
                await sleep(RETRY_DELAY_BASE_MS + Math.random() * RETRY_DELAY_JITTER_MS);
                continue;
            }
        }

        // 2. Lock is held. Read it — fresh holder ⇒ wait; stale/malformed ⇒ steal.
        let stale = false;
        try {
            const existing: LockData = JSON.parse(fs.readFileSync(lock, 'utf-8'));
            stale = isStale(existing);
            if (stale) {
                const age = Date.now() - new Date(existing.acquired).getTime();
                console.log(`[MemorySlot] Stale lock from ${existing.writer} (${Math.round(age / 1000)}s) — stealing`);
            }
        } catch {
            stale = true; // malformed/partial/vanished lock — treat as stealable
        }
        if (!stale) {
            await sleep(RETRY_DELAY_BASE_MS + Math.random() * RETRY_DELAY_JITTER_MS);
            continue; // fresh holder — wait, then retry the atomic create
        }

        // 3. STALE — steal, SERIALISED via a `.steal` O_EXCL lock so two concurrent stealers can
        //    never both unlink the main lock (the two-stealers race). Only the stealer that wins
        //    the steal-lock removes the stale main lock, and it re-confirms staleness first — so it
        //    never clobbers a lock that was legitimately re-acquired since the age-check above.
        try {
            const sfd = fs.openSync(stealLock, 'wx'); // atomic — one stealer at a time
            fs.closeSync(sfd);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
                // Another stealer holds it — unless the steal-lock itself leaked (held only µs normally).
                try {
                    const s = fs.statSync(stealLock);
                    if (Date.now() - s.mtimeMs > STEAL_LOCK_STALE_MS) { try { fs.unlinkSync(stealLock); } catch { /* raced */ } }
                } catch { /* vanished — fine */ }
            }
            await sleep(RETRY_DELAY_BASE_MS + Math.random() * RETRY_DELAY_JITTER_MS);
            continue; // let the winning stealer finish, then retry the atomic create
        }
        try {
            // We hold the steal-lock. Re-confirm the main lock is STILL stale before removing it.
            try {
                const cur: LockData = JSON.parse(fs.readFileSync(lock, 'utf-8'));
                if (isStale(cur)) { try { fs.unlinkSync(lock); } catch { /* raced */ } }
                // else: legitimately re-acquired in the meantime — leave it; we wait next iteration.
            } catch {
                try { fs.unlinkSync(lock); } catch { /* raced */ } // malformed/vanished — clear it
            }
        } finally {
            try { fs.unlinkSync(stealLock); } catch { /* best-effort */ }
        }
        // loop → next iteration's O_EXCL create atomically arbitrates the (now-cleared-if-stale) lock.
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

    return null;
}

/**
 * Release the slot. Pass the token returned by `acquireMemorySlot` — release then only unlinks
 * the lock if the token matches (precise ownership; a holder stolen-from after a stall never
 * unlinks the thief's fresh lock). Falls back to the writer-name check only when no token is
 * supplied (defensive; `withMemorySlot` always threads one).
 */
export function releaseMemorySlot(memoryDir: string, writer: string, token?: string): void {
    const lock = lockPath(memoryDir);
    try {
        const data: LockData = JSON.parse(fs.readFileSync(lock, 'utf-8'));
        const mine = token ? data.token === token : data.writer === writer;
        if (mine) fs.unlinkSync(lock);
    } catch { /* already released or not ours */ }
}

export async function withMemorySlot<T>(
    memoryDir: string,
    writer: string,
    fn: () => T | Promise<T>
): Promise<T | null> {
    const token = await acquireMemorySlot(memoryDir, writer);
    if (!token) return null;

    try {
        return await fn();
    } finally {
        releaseMemorySlot(memoryDir, writer, token);
    }
}
