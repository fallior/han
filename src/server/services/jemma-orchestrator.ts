/**
 * Jemma Orchestrator — Phase 1
 *
 * Sequencing orchestrator for multi-agent conversation responses. When a
 * message addresses multiple agents, Jemma wakes them one at a time instead
 * of fanning signals in parallel. Each agent reads the prior agent's post
 * before composing; failures advance the queue with a `prior_agent_failed`
 * context so the next agent can acknowledge gracefully.
 *
 * See plans/jemma-conversation-orchestration-v2.md for the full spec.
 *
 * Phase 1 scope (this file):
 *   - `orchestrate()` — entry point called by routes/conversations.ts + routes/jemma.ts
 *   - Ordering: first-mention-wins + left-shift rotation for the unnamed case
 *   - Atomic DB transaction for dispatch + rotation seed + rotation advance
 *   - Ack watcher (fs.watch on ~/.han/signals/, filter jemma-ack-*)
 *   - Watchdog at 285s (T_futile 225s + 60s grace) with thread-as-ground-truth
 *     reconciliation before declaring failure
 *   - Distress log (~/.han/health/distress.jsonl) + ntfy for all-failed
 *   - Instrumentation: dispatch.total_duration_ms + recipients[i].compose_ms
 *     + attempts + exit_reason for Phase 2 tuning
 *
 * NOT in Phase 1 (Phase 2 will add):
 *   - 3-strategy resilient compose (full → trimmed → Sonnet)
 *   - Pulse/probe heartbeat protocol
 *   - Richer distress context from pulse data
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import { db, HAN_DIR } from '../db';
import { deliverMessage, SIGNALS_DIR, HEALTH_DIR } from './jemma-dispatch';

// ── Paths ─────────────────────────────────────────────────────

const DISTRESS_LOG = path.join(HEALTH_DIR, 'distress.jsonl');

// ── Timing constants (Phase 1) ────────────────────────────────
// T_futile = 225s: 3 attempts × 70s + 2 backoffs × 20s (matches Phase 2 resilient compose budget).
// Grace = 60s: Jim-session's risk #4 fix (v1's 30s gave 5s margin, too thin under load).
// Widened to real backstop not placeholder (Jim-session): load-bearing for the entire
// window Phase 1 runs alone.

const DISPATCH_TIMEOUT_MS = 285 * 1000;
const WATCHDOG_POLL_MS = 10 * 1000;       // how often we scan in-progress dispatches

// ── Signal file conventions ───────────────────────────────────
//
// Wake payload (written by jemma-dispatch.writeSignalFile, read by leo-human/jim-human):
//   ~/.han/signals/{agent}-human-wake  — JSON with:
//     { source, conversationId, discussionType, author, messagePreview, confidence,
//       mentionedAt, dispatchId?, prior_agent_failed? }
//   dispatchId present → agent writes ack after posting/standing-down.
//   prior_agent_failed present → agent surfaces in prompt as default-on acknowledgment.
//
// Ack (written by agent, read by orchestrator):
//   ~/.han/signals/jemma-ack-{dispatchId}  — JSON with:
//     { dispatchId, agent, status: 'done'|'failed'|'stood_down',
//       reason?, final_attempt_count, compose_duration_ms, ack_written_at }

function ackPath(dispatchId: string): string {
    return path.join(SIGNALS_DIR, `jemma-ack-${dispatchId}`);
}

// ── Types ─────────────────────────────────────────────────────

export interface OrchestrateRequest {
    conversationId: string;
    messageId: string;
    recipients: string[];          // from classifyAddressee
    messageText: string;
    author: string;
    source: 'admin' | 'discord';
    discussionType?: string;
    channel?: string;
    channelName?: string;
    reasoning?: string;
}

export interface RecipientState {
    agent: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed' | 'stood_down' | 'posted_but_ack_missed';
    wake_at?: string;
    completed_at?: string;
    compose_ms?: number;
    attempts: number;                // always 1 in Phase 1
    exit_reason?: 'done' | 'failed_ack' | 'watchdog_timeout' | 'stood_down' | 'posted_but_ack_missed';
    last_error?: string;
}

export interface DispatchRow {
    id: string;
    conversation_id: string;
    message_id: string;
    source: string;
    recipients_ordered: string;
    current_index: number;
    status: 'pending' | 'in_progress' | 'complete' | 'all_failed' | 'orphaned';
    total_duration_ms: number | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}

interface AckPayload {
    dispatchId: string;
    agent: string;
    status: 'done' | 'failed' | 'stood_down';
    reason?: string;
    final_attempt_count?: number;
    compose_duration_ms?: number;
    ack_written_at?: string;
}

// ── Config ────────────────────────────────────────────────────
//
// DEC-079 (2026-05-03): orchestration is the ONLY dispatch path. The previous
// `isEnabled()` config flag and its rollback fallback were retired alongside
// the compose-lock; the legacy parallel-fanout path in routes/conversations.ts
// is gone. Always-on by construction.

function ntfyTopic(): string | null {
    try {
        const cfgPath = path.join(process.env.HOME || '', '.han', 'config.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        return cfg?.ntfy_topic || null;
    } catch {
        return null;
    }
}

// ── Prepared statements ───────────────────────────────────────

const insertDispatch = db.prepare(`
    INSERT INTO jemma_dispatch
      (id, conversation_id, message_id, source, recipients_ordered, current_index, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 'in_progress', ?, ?)
`);

const seedRotation = db.prepare(`
    INSERT OR IGNORE INTO jemma_rotation (scope_key, last_order_json, updated_at)
    VALUES (?, ?, ?)
`);

const readRotation = db.prepare(`SELECT last_order_json FROM jemma_rotation WHERE scope_key = ?`);

const writeRotation = db.prepare(`
    INSERT INTO jemma_rotation (scope_key, last_order_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(scope_key) DO UPDATE SET last_order_json = excluded.last_order_json, updated_at = excluded.updated_at
`);

const updateDispatch = db.prepare(`
    UPDATE jemma_dispatch
       SET recipients_ordered = ?, current_index = ?, status = ?, updated_at = ?,
           total_duration_ms = ?, completed_at = ?
     WHERE id = ?
`);

const readDispatch = db.prepare(`SELECT * FROM jemma_dispatch WHERE id = ?`);
const activeDispatches = db.prepare(`SELECT * FROM jemma_dispatch WHERE status = 'in_progress'`);

// ── Ordering ──────────────────────────────────────────────────

/**
 * Compute recipient order for this dispatch.
 * - All-mentioned: order by first-mention position.
 * - Some-mentioned: mentioned first (in mention order), un-mentioned appended
 *   in current rotation order.
 * - None-mentioned: rotation order (alphabetical first time via INSERT OR IGNORE).
 */
export function computeRecipientOrder(
    recipients: string[],
    messageText: string,
    currentRotation: string[],
): string[] {
    if (recipients.length <= 1) return [...recipients];

    const text = messageText.toLowerCase();
    const mentionPos = new Map<string, number>();
    for (const agent of recipients) {
        // Match on first-name-token; handles common nicknames per v2 spec
        const patterns: Record<string, RegExp> = {
            leo: /\bleo\b|\bleonhard\b/i,
            jim: /\bjim\b|\bjimmy\b/i,
        };
        const pat = patterns[agent];
        if (pat) {
            const m = messageText.match(pat);
            if (m && m.index !== undefined) mentionPos.set(agent, m.index);
        } else {
            // Generic fallback for agents without a nickname
            const idx = text.indexOf(agent.toLowerCase());
            if (idx >= 0) mentionPos.set(agent, idx);
        }
    }

    const mentioned = recipients.filter(r => mentionPos.has(r));
    const unmentioned = recipients.filter(r => !mentionPos.has(r));

    // All mentioned → order by mention position
    if (unmentioned.length === 0) {
        return [...mentioned].sort((a, b) => (mentionPos.get(a)! - mentionPos.get(b)!));
    }

    // Some/none mentioned → mentioned first, then un-mentioned in rotation order
    const mentionedSorted = mentioned.sort((a, b) => (mentionPos.get(a)! - mentionPos.get(b)!));
    const rotationOrdered = currentRotation.filter(r => unmentioned.includes(r));
    // Include any un-rotated newcomers at the end, preserving determinism
    for (const r of unmentioned) if (!rotationOrdered.includes(r)) rotationOrdered.push(r);

    return [...mentionedSorted, ...rotationOrdered];
}

/** Left-shift by 1: [a, b, c] → [b, c, a]. */
export function advanceRotation(order: string[]): string[] {
    if (order.length <= 1) return [...order];
    return [...order.slice(1), order[0]];
}

// ── Dispatch lifecycle ────────────────────────────────────────

/**
 * Per-conversation serialisation (DEC-079). Two near-simultaneous human messages
 * on the same thread chain through this map — the second waits for the first
 * dispatch to fire its initial wake before starting. Two messages on DIFFERENT
 * threads dispatch concurrently; the lock is per-conversation, not global.
 *
 * The chain holds only until `orchestrate()` returns (i.e. until the first wake
 * has been written). Subsequent recipient wakes within the same dispatch are
 * driven by ack/watchdog and are already serial by the orchestrator's design.
 */
const conversationDispatchLocks: Map<string, Promise<unknown>> = new Map();

/**
 * Main entry point. Called in place of the per-recipient deliverMessage loop.
 *
 * Writes the dispatch row, seeds rotation if needed, and fires the first wake.
 * The ack watcher handles the rest asynchronously.
 *
 * Atomic transaction (Jim-human + Leo-human v2 amendment): dispatch INSERT +
 * rotation seed happen together, so a crash between them cannot leave stale
 * rotation state that produces the same agent-first twice in a row.
 *
 * RECOVERY WRITE-ORDER (DEC-079, Jim's review): the dispatch row is committed
 * BEFORE the first wake is fired (txn at line ~282 commits before
 * `fireWakeForIndex` at line ~290). This order MUST NOT be inverted: if the
 * wake fires before the row commits and Jemma crashes between them, the agent
 * composes for a non-existent dispatch and the ack falls on the floor. Future
 * refactors that touch this function must preserve queue-row-first ordering.
 */
export async function orchestrate(req: OrchestrateRequest): Promise<{ dispatchId: string; order: string[] } | null> {
    if (req.recipients.length === 0) return null;

    // Per-conversation serialisation: chain through any in-flight dispatch on
    // the same conversation so two human messages don't initialise concurrently.
    const prior = conversationDispatchLocks.get(req.conversationId);
    if (prior) {
        try { await prior; } catch { /* prior dispatch failed; proceed anyway */ }
    }

    const work = (async () => {
        const dispatchId = crypto.randomUUID();
        const now = new Date().toISOString();
        const alphabetical = [...req.recipients].sort();

        // Read current rotation (may not exist yet). We do this inside the txn too, but
        // read it first so the ordering computation has a value; the txn re-reads and
        // writes atomically with the dispatch insert.
        const precheck = readRotation.get('global') as { last_order_json: string } | undefined;
        const currentRotation: string[] = precheck ? JSON.parse(precheck.last_order_json) : alphabetical;

        const order = computeRecipientOrder(req.recipients, req.messageText, currentRotation);

        const recipientStates: RecipientState[] = order.map(agent => ({
            agent, status: 'pending', attempts: 0,
        }));

        // Atomic: dispatch insert + rotation seed. Rotation advance happens on dispatch close.
        // QUEUE-ROW-FIRST: this txn commits before the wake below — see function header.
        const txn = db.transaction(() => {
            seedRotation.run('global', JSON.stringify(alphabetical), now);
            insertDispatch.run(
                dispatchId,
                req.conversationId,
                req.messageId,
                req.source,
                JSON.stringify(recipientStates),
                now,
                now,
            );
        });
        txn();

        console.log(`[Orchestrator] Dispatch ${dispatchId} for conv=${req.conversationId}: [${order.join(', ')}]`);

        // Fire the first wake (queue row already committed above)
        await fireWakeForIndex(dispatchId, 0, req, recipientStates);

        return { dispatchId, order };
    })();

    conversationDispatchLocks.set(req.conversationId, work);
    try {
        return await work;
    } finally {
        // Release only if our promise is still the head; otherwise a later
        // dispatch has already taken over the lock for this conversation.
        if (conversationDispatchLocks.get(req.conversationId) === work) {
            conversationDispatchLocks.delete(req.conversationId);
        }
    }
}

async function fireWakeForIndex(
    dispatchId: string,
    index: number,
    req: OrchestrateRequest,
    states: RecipientState[],
    priorAgentFailed?: { agent: string; reason: string; exit_reason: string },
): Promise<void> {
    const recipient = states[index].agent;
    const now = new Date().toISOString();

    states[index].status = 'in_progress';
    states[index].wake_at = now;

    updateDispatch.run(
        JSON.stringify(states),
        index,
        'in_progress',
        now,
        null,
        null,
        dispatchId,
    );

    await deliverMessage({
        source: req.source,
        recipient,
        message: req.messageText,
        author: req.author,
        classification_confidence: 1.0,
        channel: req.channel,
        channelName: req.channelName,
        conversationId: req.conversationId,
        discussionType: req.discussionType,
        reasoning: req.reasoning,
        dispatchId,
        priorAgentFailed,
    } as any);

    console.log(`[Orchestrator] Woke ${recipient} for dispatch ${dispatchId} (index ${index}${priorAgentFailed ? `, prior_failed=${priorAgentFailed.agent}` : ''})`);
}

// ── Ack handling ──────────────────────────────────────────────

/**
 * Handle an ack from an agent. Updates the recipient's state, advances the
 * queue if not terminal, or closes the dispatch if all done.
 */
async function handleAck(ack: AckPayload): Promise<void> {
    const row = readDispatch.get(ack.dispatchId) as DispatchRow | undefined;
    if (!row) {
        console.warn(`[Orchestrator] Ack for unknown dispatch ${ack.dispatchId} — ignoring`);
        return;
    }
    if (row.status !== 'in_progress') {
        console.log(`[Orchestrator] Ack for ${row.status} dispatch ${ack.dispatchId} — ignoring`);
        return;
    }

    const states: RecipientState[] = JSON.parse(row.recipients_ordered);
    const idx = row.current_index;
    if (idx >= states.length || states[idx].agent !== ack.agent) {
        console.warn(`[Orchestrator] Ack from ${ack.agent} doesn't match current index ${idx} — ignoring`);
        return;
    }

    const now = new Date().toISOString();
    const state = states[idx];
    state.compose_ms = ack.compose_duration_ms;
    state.attempts = ack.final_attempt_count || 1;
    state.completed_at = now;

    if (ack.status === 'done') {
        state.status = 'done';
        state.exit_reason = 'done';
    } else if (ack.status === 'stood_down') {
        state.status = 'stood_down';
        state.exit_reason = 'stood_down';
        state.last_error = ack.reason;
    } else {
        state.status = 'failed';
        state.exit_reason = 'failed_ack';
        state.last_error = ack.reason;
        writeDistress(row, state, 'warning');
    }

    await advanceQueue(row, states, {} as OrchestrateRequestRecoverable);
}

/**
 * Shape of the fields needed to fire subsequent wakes. We reconstruct most of
 * these from the dispatch row; only `messageText`, `author`, `channel`, and
 * `discussionType` may be needed. We store the message text in a secondary
 * field if the dispatch triggered for Discord needs it; for admin we re-read
 * from conversation_messages.
 */
interface OrchestrateRequestRecoverable {
    channel?: string;
    channelName?: string;
}

async function advanceQueue(
    row: DispatchRow,
    states: RecipientState[],
    _hint: OrchestrateRequestRecoverable,
): Promise<void> {
    const now = new Date().toISOString();
    const startedAt = new Date(row.created_at).getTime();
    const nextIndex = row.current_index + 1;

    if (nextIndex >= states.length) {
        // Queue empty
        const allFailed = states.every(s => s.status === 'failed');
        const anyDone = states.some(s => s.status === 'done' || s.status === 'posted_but_ack_missed');
        const status: DispatchRow['status'] = allFailed ? 'all_failed' : 'complete';

        updateDispatch.run(
            JSON.stringify(states),
            row.current_index,
            status,
            now,
            Date.now() - startedAt,
            now,
            row.id,
        );

        // Rotation advance on close — only if no explicit mentions drove order.
        // We always advance: the spec is "rotation advances on dispatch close" so
        // position-0 still counts as "having gone" even if they failed/stood down.
        const currentOrder = states.map(s => s.agent);
        const nextOrder = advanceRotation(currentOrder);
        writeRotation.run('global', JSON.stringify(nextOrder), now);

        console.log(`[Orchestrator] Dispatch ${row.id} closed: status=${status}, rotation→[${nextOrder.join(', ')}]`);

        if (allFailed) await handleAllFailed(row, states);
        else if (!anyDone) console.warn(`[Orchestrator] Dispatch ${row.id} closed with no successful post — check states`);
        return;
    }

    // More recipients — fire next wake with prior-failed context if applicable
    const prior = states[row.current_index];
    let priorAgentFailed: { agent: string; reason: string; exit_reason: string } | undefined;

    // v2 amendment (Jim-session): populate prior_agent_failed ONLY on
    // ground-truth-reconciled `failed`. NOT on `stood_down` (dedup working as
    // designed). NOT on `posted_but_ack_missed` (thread is truth, post succeeded).
    if (prior.status === 'failed') {
        priorAgentFailed = {
            agent: prior.agent,
            reason: prior.last_error || 'unknown',
            exit_reason: prior.exit_reason || 'failed_ack',
        };
    }

    // Reconstruct orchestrate request fields needed for re-dispatch
    const messageRow = db.prepare(`
        SELECT content FROM conversation_messages WHERE id = ?
    `).get(row.message_id) as { content: string } | undefined;

    if (!messageRow) {
        console.error(`[Orchestrator] Cannot advance dispatch ${row.id}: source message ${row.message_id} not found`);
        updateDispatch.run(JSON.stringify(states), row.current_index, 'orphaned', now, null, now, row.id);
        return;
    }

    const convRow = db.prepare(`SELECT discussion_type FROM conversations WHERE id = ?`).get(row.conversation_id) as
        { discussion_type?: string } | undefined;

    const reconstructed: OrchestrateRequest = {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        recipients: states.map(s => s.agent),
        messageText: messageRow.content,
        author: 'darron',
        source: row.source as 'admin' | 'discord',
        discussionType: convRow?.discussion_type,
    };

    await fireWakeForIndex(row.id, nextIndex, reconstructed, states, priorAgentFailed);
}

// ── Watchdog + thread-as-ground-truth ─────────────────────────

async function checkWatchdogs(): Promise<void> {
    const rows = activeDispatches.all() as DispatchRow[];
    const nowMs = Date.now();

    for (const row of rows) {
        const states: RecipientState[] = JSON.parse(row.recipients_ordered);
        const idx = row.current_index;
        if (idx >= states.length) continue;

        const state = states[idx];
        if (state.status !== 'in_progress') continue;

        const wakeAtMs = state.wake_at ? new Date(state.wake_at).getTime() : new Date(row.updated_at).getTime();
        const elapsed = nowMs - wakeAtMs;

        // Orphan threshold: 2 × timeout with no progress at all
        if (elapsed > 2 * DISPATCH_TIMEOUT_MS) {
            console.warn(`[Orchestrator] Dispatch ${row.id} orphaned (${Math.round(elapsed / 1000)}s stale)`);
            updateDispatch.run(JSON.stringify(states), idx, 'orphaned', new Date().toISOString(), null, new Date().toISOString(), row.id);
            continue;
        }

        if (elapsed < DISPATCH_TIMEOUT_MS) continue;

        // Watchdog fired. DEC-079: thread-as-ground-truth reconcile retired.
        // With dedup gates removed from leo-human/jim-human, a missed-ack-but-posted
        // case is benign — the agent posted, the user sees it, the queue simply
        // marks failed and advances. No false-positive dedup trip downstream.
        const now = new Date().toISOString();
        state.status = 'failed';
        state.exit_reason = 'watchdog_timeout';
        state.last_error = `no ack within ${Math.round(elapsed / 1000)}s`;
        state.completed_at = now;
        console.warn(`[Orchestrator] Watchdog fired for ${row.id}/${state.agent} — no ack`);
        writeDistress(row, state, 'warning');

        await advanceQueue(row, states, {});
    }
}

// ── Distress + ntfy ───────────────────────────────────────────

function writeDistress(row: DispatchRow, state: RecipientState, severity: 'warning' | 'severe'): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        const entry = {
            ts: new Date().toISOString(),
            conv: row.conversation_id,
            dispatch: row.id,
            agent: state.agent,
            reason: state.last_error || state.exit_reason || 'unknown',
            exit_reason: state.exit_reason,
            severity,
        };
        fs.appendFileSync(DISTRESS_LOG, JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error('[Orchestrator] Failed to write distress:', (err as Error).message);
    }
}

async function handleAllFailed(row: DispatchRow, states: RecipientState[]): Promise<void> {
    writeDistress(row, states[states.length - 1], 'severe');

    // Post system notice to thread (reserved for all-failed case only)
    try {
        const msgId = crypto.randomUUID();
        const content = `[System] No agent was able to respond (dispatch ${row.id}). Engineering notified. Re-prompt to retry.`;
        db.prepare(`
            INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
            VALUES (?, ?, 'system', ?, ?)
        `).run(msgId, row.conversation_id, content, new Date().toISOString());
    } catch (err) {
        console.error('[Orchestrator] Failed to post all-failed notice:', (err as Error).message);
    }

    // ntfy push
    const topic = ntfyTopic();
    if (topic) {
        try {
            execFileSync('curl', [
                '-s',
                '-d', `Dispatch ${row.id} all-failed on conv ${row.conversation_id}`,
                '-H', 'Title: Jemma all-failed',
                '-H', 'Priority: high',
                `https://ntfy.sh/${topic}`,
            ], { timeout: 10000, stdio: 'ignore' });
        } catch { /* best effort */ }
    }
}

// ── Ack watcher ───────────────────────────────────────────────

export function startAckWatcher(): void {
    fs.mkdirSync(SIGNALS_DIR, { recursive: true });

    console.log(`[Orchestrator] Watching ${SIGNALS_DIR} for jemma-ack-*`);

    let processing = false;
    fs.watch(SIGNALS_DIR, async (_event, filename) => {
        if (!filename || !filename.startsWith('jemma-ack-')) return;
        if (processing) return;
        processing = true;

        // Small delay to let the file finish writing
        await new Promise(r => setTimeout(r, 200));

        try {
            const filepath = path.join(SIGNALS_DIR, filename);
            if (!fs.existsSync(filepath)) return;

            const raw = fs.readFileSync(filepath, 'utf8');
            let ack: AckPayload;
            try {
                ack = JSON.parse(raw) as AckPayload;
            } catch (err) {
                console.warn(`[Orchestrator] Unparseable ack file ${filename}: ${(err as Error).message}`);
                try { fs.unlinkSync(filepath); } catch { /* best effort */ }
                return;
            }
            try { fs.unlinkSync(filepath); } catch { /* best effort */ }

            await handleAck(ack);
        } catch (err) {
            console.error('[Orchestrator] Ack watcher error:', (err as Error).message);
        } finally {
            processing = false;
        }
    });

    // Watchdog poll
    setInterval(() => {
        checkWatchdogs().catch(err =>
            console.error('[Orchestrator] Watchdog poll error:', (err as Error).message)
        );
    }, WATCHDOG_POLL_MS);

    // Startup sweep — reconcile any dispatches that completed while orchestrator was down
    checkWatchdogs().catch(err => console.error('[Orchestrator] Startup sweep error:', (err as Error).message));
}

