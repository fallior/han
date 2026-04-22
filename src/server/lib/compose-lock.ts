/**
 * Compose Lock — Cross-Agent Coordination for Conversation Responses
 *
 * Prevents Leo-human and Jim-human from composing responses in parallel when
 * Darron addresses both (or when a thread is ambiguous). The pattern is:
 * whoever picks up first seeds the response; the second waits, reads the
 * first's post, then composes with that knowledge.
 *
 * Built from S131's "Conversations should flow" discussion (mo98jep4-ym8hwx).
 * Complements — does not replace — the existing `responding-to-{id}` same-agent
 * duplicate-protection claim. That mechanism blocks two leo-human processes
 * from stepping on each other; this one blocks leo-human and jim-human from
 * composing the same first-response in parallel.
 *
 * File: `~/.han/signals/composing-{threadId}`
 * Format: {agent, timestamp_ms, pid}
 * TTL: 2 minutes (stale locks are forcibly reclaimed)
 */

import * as fs from 'fs';
import * as path from 'path';

const HOME = process.env.HOME || '/home/darron';
const HAN_DIR = path.join(HOME, '.han');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');

const DEFAULT_TTL_MS = 2 * 60 * 1000;       // 2 min — generous cap on compose time
const DEFAULT_MAX_WAIT_MS = 90 * 1000;       // 90 sec — total time the waiter will block
const DEFAULT_POLL_MS = 1 * 1000;            // 1 sec — how often the waiter re-checks

interface ComposeLock {
    agent: string;
    timestamp: number;
    pid: number;
}

function lockPath(threadId: string): string {
    return path.join(SIGNALS_DIR, `composing-${threadId}`);
}

function readLock(threadId: string): ComposeLock | null {
    try {
        const p = lockPath(threadId);
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf8')) as ComposeLock;
    } catch {
        return null;
    }
}

function isStale(lock: ComposeLock, ttlMs: number): boolean {
    return Date.now() - lock.timestamp > ttlMs;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function tryClaimAtomic(threadId: string, agent: string): boolean {
    try {
        fs.mkdirSync(SIGNALS_DIR, { recursive: true });
        fs.writeFileSync(
            lockPath(threadId),
            JSON.stringify({ agent, timestamp: Date.now(), pid: process.pid } satisfies ComposeLock),
            { flag: 'wx' }  // exclusive create — fails with EEXIST if file already exists
        );
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
        console.warn(`[compose-lock] Unexpected error claiming ${threadId}:`, (err as Error).message);
        return false;
    }
}

export interface AcquireResult {
    acquired: boolean;
    waited_ms: number;
    prior_agent?: string;
    holder_done?: boolean;  // true if we proceeded because the holder had already posted
}

/**
 * Optional callback: given the lock holder's agent and the timestamp the lock was
 * acquired, return true if the holder has already completed its work (i.e. posted
 * to the thread since acquiring the lock). When this returns true, the waiter
 * forcibly removes the orphaned lock and proceeds — protects against crashes or
 * code paths that forget to release.
 */
export type IsHolderDoneFn = (holderAgent: string, lockStartedAt: number) => boolean | Promise<boolean>;

/**
 * Acquire a cross-agent compose lock on this thread.
 *
 * Behaviour:
 * - If no lock exists (or the existing one is stale), atomically claim it and return immediately.
 * - If another agent holds a fresh lock, poll until it releases OR we exceed maxWaitMs.
 * - If `isHolderDone` is supplied and returns true, the lock is treated as orphaned
 *   (holder posted but failed to release); we remove it and claim.
 * - On timeout, return { acquired: false } — caller may proceed with a warning or abort.
 *
 * Atomicity: uses the `wx` flag (O_CREAT | O_EXCL), so racing claims cannot both succeed.
 *
 * IMPORTANT: Always pair with {@link releaseComposeLock} in a finally block.
 */
export async function acquireComposeLock(
    threadId: string,
    agent: string,
    opts: {
        ttlMs?: number;
        maxWaitMs?: number;
        pollMs?: number;
        isHolderDone?: IsHolderDoneFn;
    } = {}
): Promise<AcquireResult> {
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    const isHolderDone = opts.isHolderDone;
    const start = Date.now();
    let priorAgent: string | undefined;

    while (Date.now() - start < maxWaitMs) {
        // First try the atomic claim — wins the race if the slot is free
        if (tryClaimAtomic(threadId, agent)) {
            return { acquired: true, waited_ms: Date.now() - start, prior_agent: priorAgent };
        }

        // Claim failed — file exists. Read it to decide whether to wait or reclaim.
        const current = readLock(threadId);

        if (!current) {
            // File existed at claim time but not at read — someone released it mid-race. Retry.
            continue;
        }

        if (current.agent === agent && current.pid === process.pid) {
            // Re-entrant — we already own it in this process
            return { acquired: true, waited_ms: Date.now() - start };
        }

        if (isStale(current, ttlMs)) {
            // Stale lock — forcibly remove and retry atomic claim
            try { fs.unlinkSync(lockPath(threadId)); } catch { /* best effort */ }
            continue;
        }

        // Post-detection: if the holder has already posted since acquiring the lock,
        // the lock is effectively orphaned (holder forgot or was blocked from releasing).
        // Remove it and proceed.
        if (isHolderDone) {
            try {
                const done = await isHolderDone(current.agent, current.timestamp);
                if (done) {
                    console.log(`[compose-lock] ${current.agent} already posted to ${threadId} since lock acquired — removing orphaned lock`);
                    try { fs.unlinkSync(lockPath(threadId)); } catch { /* best effort */ }
                    if (tryClaimAtomic(threadId, agent)) {
                        return { acquired: true, waited_ms: Date.now() - start, prior_agent: current.agent, holder_done: true };
                    }
                    continue;
                }
            } catch (err) {
                console.warn(`[compose-lock] isHolderDone check failed:`, (err as Error).message);
                // Fall through to wait — safer to wait than to race on a bad check
            }
        }

        // Another agent holds a fresh lock and hasn't posted yet — wait and retry
        priorAgent = current.agent;
        await sleep(pollMs);
    }

    // Timed out — proceed with a warning rather than block indefinitely.
    // Caller should log this; duplicate-greeting is preferable to no-response.
    console.warn(`[compose-lock] Timeout (${maxWaitMs}ms) waiting for ${threadId} (held by ${priorAgent}) — proceeding`);
    return { acquired: false, waited_ms: Date.now() - start, prior_agent: priorAgent };
}

/**
 * Release the compose lock if we own it. Safe to call multiple times.
 * Only removes the file if the current holder matches agent + pid.
 */
export function releaseComposeLock(threadId: string, agent: string): void {
    try {
        const current = readLock(threadId);
        if (current?.agent === agent && current.pid === process.pid) {
            fs.unlinkSync(lockPath(threadId));
        }
    } catch { /* best effort */ }
}
