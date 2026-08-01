#!/usr/bin/env npx tsx
/**
 * Human Responder — Conversation Follow-Through Agent (slug-agnostic)
 *
 * ONE PATH, MANY AGENTS (DEC-081 / S176). Collapses the former leo-human.ts +
 * jim-human.ts twins (a flat governing-law violation: per-agent files born
 * 2026-03-06, pre-law, carried across the #66 migration unretired) into a single
 * AGENT_SLUG-parameterised controller. Every resident with a `human-response`
 * surface gets a conversation + Discord responder for free — a 4th agent (casey)
 * inherits it with no new file.
 *
 * Dispatches through `dispatchToSpoke` (the generic spoke monitor, P1 / e14e2ef):
 * the human seat now SELF-CLEARS at the registry threshold (clean /clear →
 * welcome-back, NEVER harness compaction — the S200 wedge root) and WARM-GATES
 * (never a hollow answer). The per-surface CONTENT lives here (buildPrompt +
 * response handling); the lifecycle lives below in dispatchToSpoke — Jim's F1 seam.
 *
 * Per-agent leaves ALL derive from the registry (no hardcoded slug):
 *   displayName / memoryDir  ← gradientConfigForAgent(slug)  (jim-at-root handled)
 *   conversationRole         ← conversationRoleFor(slug)       (leo→'leo', jim→'supervisor')
 *   swapPrefix               ← swapPrefixFor(slug, 'human-response')  ('human-swap' / 'jim-human-swap')
 *   model ladder             ← manifestModelLadder(slug, 'human-response')
 *   txn timeout              ← humanResponderTxnTimeoutMs(slug)  (registry leaf — no hidden global)
 *   commitment scanner       ← humanResponderCommitmentScan(slug)  (capability leaf, default off; leo-only)
 *   addressed-gate           ← addressedToOtherResponderOnly(slug, text)  (registry name-aliases)
 *
 * Separation of concerns (per agent):
 *   - Session <Name>: hands-on in the terminal
 *   - Heartbeat <Name>: philosophy + personal beats (inner world)
 *   - Human Responder (this): conversation responses + Discord (outward-facing)
 */

import Database from 'better-sqlite3';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveChannelName, fetchDiscordContext, postToDiscord } from './services/discord';
import { appendPairedMemory } from './lib/memory-paired-writer';
import { ensureSingleInstance } from './lib/pid-guard';
import { buildPrompt, PromptOverbudgetError } from './lib/prompt-builder';
import { maySpeakFailurePreamble } from './lib/dispatch-reconcile';
// dispatchToSpoke = the generic spoke monitor (DEC-094 transport; P1/e14e2ef). It wraps
// ensureSurfaceSession + the warm-gate + enqueue + the ctx-pressure self-clear, and swallows
// DispatchTimeoutError|SessionNotReadyError into a null return + onDispatchFail (no hollow
// answers). Zero live agentQuery on this surface (the #66 / DEC-094 endgame for human-response).
import { dispatchToSpoke, startPoolManager, reapThreadSpoke } from './lib/tmux-dispatcher';
import {
    manifestModelLadder, conversationRoleFor, swapPrefixFor,
    humanResponderTxnTimeoutMs, humanResponderCommitmentScan, addressedToOtherResponderOnly,
    poolSizeFor,
    communityPort,
} from './lib/garden-manifest';
import { wakeQueueDir, claimWakeFiles, pickNextEligible } from './lib/wake-queue';
import { gradientConfigForAgent } from './lib/agent-registry';
import type { CaptureRecord } from './lib/diary-mcp-server';

// ── Slug + derived identity (fail-loud, DEC-081 — NO default identity) ─────────

const AGENT_SLUG = process.env.AGENT_SLUG;
if (!AGENT_SLUG) {
    console.error('[human-responder] FATAL: AGENT_SLUG unset — a responder must be launched with its slug (DEC-081: no slug → no identity → fail loud, never a silent default).');
    process.exit(1);
}
const SLUG: string = AGENT_SLUG;
const gcfg = gradientConfigForAgent(SLUG);            // throws on an unknown slug (R1)
const DISPLAY_NAME = gcfg.displayName;
const MEMORY_DIR = gcfg.memoryDir;                    // jim lives at root — the registry handles it
const CONVERSATION_ROLE = conversationRoleFor(SLUG);  // leo→'leo', jim→'supervisor'
const LOG = `[${DISPLAY_NAME}/Human]`;

// ── Config ────────────────────────────────────────────────────

const HOME = process.env.HOME || os.homedir();
const HAN_DIR = path.join(HOME, '.han');
// Phase 5 followup: honour HAN_DB_PATH override; default gradient.db per DEC-080 (db.ts:32 pattern).
const DB_PATH = process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const AGENT_HUMAN_DIR = path.join(HAN_DIR, 'agents', DISPLAY_NAME, 'Human');

const HUMAN_SURFACE = 'human-response';
const HEALTH_FILE = path.join(HEALTH_DIR, `${SLUG}-human-health.json`);
const SWAP_PREFIX = swapPrefixFor(SLUG, HUMAN_SURFACE);            // 'human-swap' / 'jim-human-swap'
const SWAP_FILE = path.join(MEMORY_DIR, `${SWAP_PREFIX}.md`);
const SWAP_FULL_FILE = path.join(MEMORY_DIR, `${SWAP_PREFIX}-full.md`);

const SIGNAL_NAME = `${SLUG}-human-wake`;
// Local cadence constants (pre-existing; not the dispatcher knobs). Follow-on no-hidden-globals
// candidates alongside the txn timeout already migrated to the registry — left local here to keep
// the collapse scoped to what Jim's P2 audit named.
const COMMITMENT_SCAN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const HEALTH_WRITE_INTERVAL_MS = 5 * 60 * 1000;     // 5 minutes

const HUMAN_TXN_TIMEOUT_MS = humanResponderTxnTimeoutMs(SLUG);        // registry leaf (no hidden global)
const COMMITMENT_SCAN_ENABLED = humanResponderCommitmentScan(SLUG);  // capability leaf (default off; leo:on)
const WELCOME_BACK = `welcome back ${DISPLAY_NAME}`;

let responseCount = 0;
const startedAt = Date.now();

// ── Ensure directories ────────────────────────────────────────

function ensureDirectories(): void {
    for (const dir of [MEMORY_DIR, SIGNALS_DIR, HEALTH_DIR, AGENT_HUMAN_DIR]) {
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
    const id = `${SLUG}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, CONVERSATION_ROLE, content, now);
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    // Notify the main server (3847) to broadcast — single path to prevent React double-render
    // (signal-file backup removed S103: two broadcasts duplicated in admin despite ID dedup).
    notifyServer(conversationId, id, CONVERSATION_ROLE, content, now);
    return id;
}

/** Notify the main server to broadcast this message via WebSocket to admin clients. */
function notifyServer(conversationId: string, messageId: string, role: string, content: string, createdAt: string): void {
    const body = JSON.stringify({ conversation_id: conversationId, message_id: messageId, role, content, created_at: createdAt });
    const req = https.request({
        hostname: '127.0.0.1',
        port: communityPort(), // Ring 2 leaf — the community-convergence port (was a literal; Mike's box differs)
        path: '/api/conversations/internal/broadcast',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: false,
    }, (res) => {
        if (res.statusCode !== 200) console.log(`${LOG} Broadcast notify returned ${res.statusCode}`);
        res.resume();
    });
    req.on('error', (err) => console.log(`${LOG} Broadcast notify failed: ${err.message}`));
    req.end(body);
}

// ── Memory ────────────────────────────────────────────────────

/**
 * PR-C3 (Jim's flag-(b) ruling): flush ONE dispatch's capture fields STRAIGHT to the atomic
 * paired-write — no shared swap-buffer round-trip. Under C1's concurrent dispatches the old
 * buffer path raced (A reads → B appends → A resets ⇒ B's paired content destroyed) and even
 * slot-wrapped it would MERGE concurrent captures into one blurred write. Per-dispatch args
 * eliminate loss AND blur. DEC-085-adjacent TRANSPORT change only — the write SHAPE is
 * untouched (Mechanism-A capture fields → the atomic `appendPairedMemory` pair, #49
 * both-or-neither preserved).
 */
async function flushCapturePairedMemory(compressed: string, full: string): Promise<void> {
    const c = compressed.trim(), f = full.trim();
    if (!c && !f) return;
    if (!c || !f) {
        // #49: asymmetric content must never write one side — skip-and-log (fail-loud).
        console.warn(`${LOG} Asymmetric capture memory; skipping paired flush (compressed=${c.length}c, full=${f.length}c).`);
        return;
    }
    try {
        await appendPairedMemory(SLUG, '\n' + f + '\n', '\n' + c + '\n', { source: `${SLUG}-human-flush` });
        console.log(`${LOG} Paired memory flushed (per-dispatch, ${c.length}c/${f.length}f chars)`);
    } catch (err) {
        // Fail-loud, never half-write; the capture file in the per-stem sink remains the forensic copy.
        console.error(`${LOG} Per-dispatch paired flush FAILED (capture retained in sink): ${(err as Error).message}`);
    }
}

/** LEGACY startup drain only (PR-C3): nothing writes the shared swap buffer on this seat any
 *  more (captures flush per-dispatch above) — this sweeps pre-C3 residue / a crash's leftovers
 *  once at boot, then the buffer stays empty. */
async function flushSwapToWorkingMemory(): Promise<void> {
    const compressed = fs.readFileSync(SWAP_FILE, 'utf-8').trim();
    const full = fs.readFileSync(SWAP_FULL_FILE, 'utf-8').trim();

    if (!compressed && !full) return;

    // #49 (S153): asymmetric swap content is the drift mode the atomic paired-write helper exists
    // to prevent. Detect upstream and preserve swap state for retry rather than writing one side.
    if (!compressed || !full) {
        console.warn(
            `${LOG} Asymmetric swap content; skipping flush ` +
            `(compressed=${compressed.length}c, full=${full.length}c). ` +
            `Swap preserved for retry. #53 drift signal will fire next fs.watch event.`,
        );
        return;
    }

    try {
        await appendPairedMemory(
            SLUG,
            '\n' + full + '\n',
            '\n' + compressed + '\n',
            { source: `${SLUG}-human-flush` },
        );
        console.log(`${LOG} Flushed swap → working memory (${compressed.length}c/${full.length}f chars)`);
        fs.writeFileSync(SWAP_FILE, '');
        fs.writeFileSync(SWAP_FULL_FILE, '');
    } catch (err) {
        console.error(`${LOG} Flush failed; swap preserved for retry: ${(err as Error).message}`);
        // Swap NOT cleared — next call retries naturally.
    }
}

// ── Health ─────────────────────────────────────────────────────

function writeHealth(lastError: string | null = null): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        fs.writeFileSync(HEALTH_FILE, JSON.stringify({
            agent: `${SLUG}-human`,
            pid: process.pid,
            timestamp: new Date().toISOString(),
            status: lastError ? 'error' : 'ok',
            lastError,
            responses: responseCount,
            uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
        }, null, 2));
    } catch { /* best effort */ }
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
    // Phase 1 orchestration (DEC-077 follow-on). Written by jemma-dispatch.ts. Spec:
    // services/jemma-orchestrator.ts header.
    // - dispatchId present → write ~/.han/signals/jemma-ack-{id} at end (done/stood_down/failed)
    //   so the orchestrator can advance its queue.
    // - priorAgentFailed present → surface in the prompt as default-on acknowledgment.
    dispatchId?: string;
    priorAgentFailed?: { agent: string; reason: string; exit_reason: string };
}

/**
 * Write the orchestrator ack after we've finished processing (posted, stood down, or exhausted
 * retries). No-op when dispatchId is absent (backward-compat with non-orchestrated wake paths).
 */
function writeJemmaAck(
    dispatchId: string | undefined,
    agent: string,
    status: 'done' | 'failed' | 'stood_down',
    opts: { reason?: string; compose_duration_ms?: number; final_attempt_count?: number } = {},
): void {
    if (!dispatchId) return;
    try {
        const ackFile = path.join(SIGNALS_DIR, `jemma-ack-${dispatchId}`);
        fs.writeFileSync(ackFile, JSON.stringify({
            dispatchId,
            agent,
            status,
            reason: opts.reason,
            final_attempt_count: opts.final_attempt_count ?? 1,
            compose_duration_ms: opts.compose_duration_ms,
            ack_written_at: new Date().toISOString(),
        }));
    } catch (err) {
        console.error(`${LOG} Failed to write jemma-ack for ${dispatchId}:`, (err as Error).message);
    }
}

/**
 * S151: progress-aware watchdog support. While composing, emit a 'composing' heartbeat ack every
 * intervalMs so the orchestrator's watchdog reads our last_progress_at and doesn't fire prematurely
 * on a long compose. Returns a `stop()` the caller MUST invoke when compose completes (else the
 * timer leaks — a phantom 'composing' ack stream).
 */
function getComposeHeartbeatIntervalMs(): number {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(HAN_DIR, 'config.json'), 'utf8'));
        const v = cfg?.agents?.compose_heartbeat_interval_ms;
        if (typeof v === 'number' && v > 0) return v;
    } catch { /* fall through */ }
    return 30000;
}

function startHeartbeatAcks(dispatchId: string | undefined, agent: string): { stop: () => void } {
    if (!dispatchId) return { stop: () => { /* noop */ } };
    let seq = 0;
    const intervalMs = getComposeHeartbeatIntervalMs();
    const timer = setInterval(() => {
        seq++;
        try {
            const ackFile = path.join(SIGNALS_DIR, `jemma-ack-${dispatchId}-hb-${seq}`);
            fs.writeFileSync(ackFile, JSON.stringify({
                dispatchId,
                agent,
                status: 'composing',
                heartbeat_seq: seq,
                ack_written_at: new Date().toISOString(),
            }));
        } catch (err) {
            console.error(`${LOG} Failed to write heartbeat ack ${seq} for ${dispatchId}:`, (err as Error).message);
        }
    }, intervalMs);
    return { stop: () => clearInterval(timer) };
}

function readSignal(): SignalData | null {
    const signalPath = path.join(SIGNALS_DIR, SIGNAL_NAME);
    try {
        if (!fs.existsSync(signalPath)) return null;
        const data = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
        fs.unlinkSync(signalPath); // consume immediately
        return data;
    } catch {
        try { fs.unlinkSync(signalPath); } catch { /* already gone */ }
        return null;
    }
}

// ── Response: forwarders ──────────────────────────────────────
// The SDK (agentQuery) cognition path was retired at the T-7 close of the #66 tmux migration
// (DEC-094, zero-agentQuery-cognition). tmux warm-session via dispatchToSpoke is the sole transport.

async function respondToConversation(db: Database.Database, conversationId: string, signal?: SignalData): Promise<void> {
    return respondToConversationViaTmux(db, conversationId, signal);
}

async function respondToDiscord(signal: SignalData): Promise<void> {
    return respondToDiscordViaTmux(signal);
}

// ── Response: tmux warm-session transport (via the generic spoke monitor) ─────

/**
 * The conversation path. The spoke (human-response-<slug>) FETCHES the thread itself (locator
 * scaffold), applies the self-recognition + already-responded + distinct-angle gates against live
 * state, self-posts via curl, and ends with submit_response (diary) or stand_down. We mirror the
 * cascade: stand-down → ack stood_down (NEVER paired-write — an empty c0/c1 pair is an identity-layer
 * bug, Jim's flag); diary → per-dispatch paired flush (PR-C3, flushCapturePairedMemory) + post-verification → ack done / SILENT-POST-FAILURE warn.
 */
async function respondToConversationViaTmux(db: Database.Database, conversationId: string, signal?: SignalData): Promise<void> {
    const title = getConversationTitle(db, conversationId);
    const dispatchId = signal?.dispatchId;
    const priorAgentFailed = signal?.priorAgentFailed;
    const composeStartMs = Date.now();
    const recentMessages = getRecentMessages(db, conversationId, 60).reverse();

    if (recentMessages.length === 0) {
        console.log(`${LOG} (tmux) No messages in "${title}" — skipping`);
        writeJemmaAck(dispatchId, SLUG, 'stood_down', { reason: 'no_messages', compose_duration_ms: Date.now() - composeStartMs });
        return;
    }
    // addressed-to-another-responder pre-gate (cheap; avoids waking the spoke for a msg that names
    // only a peer agent, not me). Registry-derived (name-aliases) — a 4th responder joins for free.
    const lastHumanMsg = recentMessages.filter(m => m.role === 'human').pop();
    if (lastHumanMsg && addressedToOtherResponderOnly(SLUG, lastHumanMsg.content)) {
        console.log(`${LOG} (tmux) Message addressed to another agent only in "${title}" — standing down`);
        writeJemmaAck(dispatchId, SLUG, 'stood_down', { reason: 'addressed_to_other_agent', compose_duration_ms: Date.now() - composeStartMs });
        return;
    }

    // MNT-075 F1c (Jim's fold): the delivery-time re-check. The label was made at
    // watchdog time; the record may have changed since (both live instances were
    // slow composes whose posts landed AFTER the label — 79s/19s). Re-consult the
    // record NOW, at prompt-build, and speak the preamble only on CONFIRMED absence
    // since the triggering message. No anchor / unreadable record → silence (G4).
    // This narrows the race from minutes to seconds; the irreducible residual
    // (a post landing mid-compose) is R3's — the spoke's own thread read.
    let vettedPriorFailed = priorAgentFailed;
    if (priorAgentFailed) {
        const since = signal?.mentionedAt;
        const speak = !!since && maySpeakFailurePreamble(conversationId, priorAgentFailed.agent, since);
        if (!speak) {
            console.log(`${LOG} (tmux) MNT-075 F1c: suppressing prior-failed preamble for ${priorAgentFailed.agent} — post found since the triggering message, or absence not confirmable`);
            vettedPriorFailed = undefined;
        }
    }

    // LOCATOR txn prompt — the spoke fetches the thread itself (no embedded tail).
    let txnPrompt: string;
    try {
        const built = buildPrompt(SLUG, 'human-response-txn', {
            source: 'conversation', title, conversationId,
            roleLabel: CONVERSATION_ROLE, priorAgentFailed: vettedPriorFailed,
        });
        txnPrompt = `${built.systemPrompt}\n\n${built.userPrompt}`;
        console.log(`${LOG} (tmux) human-response-txn: ~${built.meta.est_total_tokens_chars_div_4} tokens (memory suppressed: ${built.meta.memory_chars} chars)`);
    } catch (err) {
        if (err instanceof PromptOverbudgetError) {
            console.log(`${LOG} (tmux) Prompt over budget for "${title}" — skipping`);
            writeJemmaAck(dispatchId, SLUG, 'failed', { reason: 'prompt-build-overbudget', compose_duration_ms: Date.now() - composeStartMs });
            return;
        }
        throw err;
    }

    // Heartbeat-acks keep the orchestrator watchdog patient across the (possibly multi-minute) cold
    // wake + per-slug queue wait + the post-capture self-clear (which dispatchToSpoke runs before it
    // returns) — so heartbeat.stop() lands AFTER dispatchToSpoke, spanning the /clear→welcome-back.
    const heartbeat = startHeartbeatAcks(dispatchId, SLUG);
    const dispatchStartMs = Date.now();
    let cap: CaptureRecord | null;
    try {
        cap = await dispatchToSpoke(SLUG, HUMAN_SURFACE, txnPrompt, {
            ladder: manifestModelLadder(SLUG, HUMAN_SURFACE),
            welcomeBack: WELCOME_BACK,
            timeoutMs: HUMAN_TXN_TIMEOUT_MS,
            conversationId, // DEC-101: bind/route this thread's spoke (persist-as-spoke, flag-gated)
            // Per-site fail closure: the conversation path HAS an orchestrator ack channel.
            onDispatchFail: (err) => {
                heartbeat.stop();
                console.error(`${LOG} (tmux) dispatch failed for "${title}" — ${err.message}`);
                writeJemmaAck(dispatchId, SLUG, 'failed', { reason: `tmux-dispatch: ${err.message}`, compose_duration_ms: Date.now() - composeStartMs });
            },
        });
    } catch (err) {
        // Unexpected (non-dispatch) error — dispatchToSpoke re-throws anything that isn't a
        // DispatchTimeout/SessionNotReady. Stop the heartbeat (no phantom 'composing' acks) and
        // re-throw to the signal handler (which writes health).
        heartbeat.stop();
        throw err;
    }
    if (cap === null) return; // dispatch fail-safe — onDispatchFail already stopped + acked
    heartbeat.stop();
    console.log(`${LOG} (tmux) "${title}": capture in ${Math.round((Date.now() - dispatchStartMs) / 1000)}s (queue+wake+compose+selfclear), mode=${cap.mode ?? 'diary'}`);

    // STAND-DOWN: never paired-write (an empty c0/c1 pair is an identity-layer bug, Jim's flag).
    if (cap.mode === 'stand-down') {
        console.log(`${LOG} (tmux) Stood down for "${title}" — ${(cap.reason ?? '').slice(0, 200)}`);
        writeJemmaAck(dispatchId, SLUG, 'stood_down', { reason: `tmux_standdown: ${(cap.reason ?? '').slice(0, 160)}`, compose_duration_ms: Date.now() - composeStartMs });
        return;
    }

    // diary → paired swap-write + post-verification (the spoke self-posted via curl).
    responseCount++;
    const composeStartIso = new Date(composeStartMs).toISOString();
    const postRow = db.prepare(`
        SELECT id FROM conversation_messages
        WHERE conversation_id = ? AND role = ? AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1
    `).get(conversationId, CONVERSATION_ROLE, composeStartIso) as { id: string } | undefined;
    const postRef = postRow ? `verified post id=${postRow.id}` : `NO CURL-POST DETECTED in DB`;
    const timestamp = new Date().toISOString();
    const sectionHeader = `### Response to "${title}" (${timestamp})`;
    const compressedSwap = `${sectionHeader}\n${cap.args.working_memory_compressed}`;
    const fullSwap = `${sectionHeader}\n[INPUT]\n${cap.args.input_quotes}\n\n[BODY]\n${cap.args.working_memory_full}`;
    await flushCapturePairedMemory(compressedSwap, fullSwap); // PR-C3: per-dispatch, no shared buffer
    const memText = `paired memory: ${cap.args.working_memory_full.length}c body + ${cap.args.input_quotes.length}c input + ${cap.args.working_memory_compressed.length}c c1`;
    if (postRow) {
        console.log(`${LOG} (tmux) Self-posted via curl for "${title}" — ${postRef} (${memText})`);
    } else {
        console.warn(`${LOG} (tmux) SILENT POST FAILURE for "${title}" — diary captured but ${postRef}. Thread will be silent. (${memText} written for forensic record)`);
    }
    writeJemmaAck(dispatchId, SLUG, 'done', { compose_duration_ms: Date.now() - composeStartMs });
}

/**
 * The Discord path. Discord history is not fetchable by the spoke via the conversation API, so the
 * controller fetches + EMBEDS it (the txn scaffold's DELIVERY OVERRIDE — the controller posts the
 * reply; the spoke does not curl). The spoke ends with submit_response (the reply body) or stand_down.
 */
async function respondToDiscordViaTmux(signal: SignalData): Promise<void> {
    const channelId = signal.channelId || signal.channel || signal.conversationId || '';
    const channelName = signal.channelName || resolveChannelName(channelId);
    if (!channelName) {
        console.error(`${LOG} (tmux) Cannot resolve channel ${channelId} — skipping Discord`);
        return;
    }
    const dispatchId = signal.dispatchId;
    console.log(`${LOG} (tmux) Discord #${channelName} (from ${signal.author || 'unknown'})`);

    const discordMessages = await fetchDiscordContext(channelId, 60);
    const contextBlock = discordMessages.length > 0
        ? discordMessages.reverse().map(m => `[${m.author}] (${m.timestamp}):\n${m.content}`).join('\n\n')
        : `${signal.author || 'Someone'}: ${signal.messagePreview || '(no preview)'}`;

    let txnPrompt: string;
    try {
        const built = buildPrompt(SLUG, 'human-response-txn', {
            source: 'discord', channelName, conversationContext: contextBlock, roleLabel: CONVERSATION_ROLE,
        });
        txnPrompt = `${built.systemPrompt}\n\n${built.userPrompt}`;
        console.log(`${LOG} (tmux) human-response-txn (discord): ~${built.meta.est_total_tokens_chars_div_4} tokens`);
    } catch (err) {
        if (err instanceof PromptOverbudgetError) { console.log(`${LOG} (tmux) Discord prompt over budget for #${channelName} — skipping`); return; }
        throw err;
    }

    const heartbeat = startHeartbeatAcks(dispatchId, SLUG);
    let cap: CaptureRecord | null;
    try {
        cap = await dispatchToSpoke(SLUG, HUMAN_SURFACE, txnPrompt, {
            ladder: manifestModelLadder(SLUG, HUMAN_SURFACE),
            welcomeBack: WELCOME_BACK,
            timeoutMs: HUMAN_TXN_TIMEOUT_MS,
            // Per-site fail closure: the Discord path has NO orchestrator ack channel (no dispatchId
            // ack at this surface) — stop the heartbeat only; do NOT writeJemmaAck (would be phantom).
            onDispatchFail: (err) => {
                heartbeat.stop();
                console.error(`${LOG} (tmux) Discord dispatch failed #${channelName} — ${err.message}`);
            },
        });
    } catch (err) {
        heartbeat.stop();
        throw err;
    }
    if (cap === null) return; // dispatch fail-safe — onDispatchFail already stopped
    heartbeat.stop();

    if (cap.mode === 'stand-down') {
        console.log(`${LOG} (tmux) Stood down on Discord #${channelName} — ${(cap.reason ?? '').slice(0, 200)}`);
        return;
    }
    const body = cap.args.working_memory_full.trim();
    if (body.length > 5) {
        const posted = await postToDiscord(SLUG, channelName, body);
        if (posted) {
            responseCount++;
            console.log(`${LOG} (tmux) Posted to Discord #${channelName} (${body.length} chars)`);
            try {
                const ddb = getDb();
                const convId = signal.conversationId || '';
                if (convId) postMessage(ddb, convId, body);
                ddb.close();
            } catch (err) { console.warn(`${LOG} (tmux) Failed to record Discord response in DB:`, (err as Error).message); }
            const timestamp = new Date().toISOString();
            const sectionHeader = `### Discord #${channelName} (${timestamp})`;
            await flushCapturePairedMemory(`${sectionHeader}\n${cap.args.working_memory_compressed}`, `${sectionHeader}\n[INPUT]\n${cap.args.input_quotes}\n\n[BODY]\n${cap.args.working_memory_full}`); // PR-C3
        } else {
            console.error(`${LOG} (tmux) Failed to post to Discord #${channelName}`);
        }
    }
}

// ── Commitment scanner (capability leaf — registry-gated, default off; leo:on) ─

async function scanUnfulfilledCommitments(): Promise<void> {
    const db = getDb();
    try {
        // Find conversations where this agent acknowledged but never posted a substantive response.
        const ackMessages = db.prepare(`
            SELECT cm.conversation_id, cm.content, cm.created_at, c.title
            FROM conversation_messages cm
            JOIN conversations c ON cm.conversation_id = c.id
            WHERE cm.role = ?
            AND cm.content LIKE '%think about that%'
            AND cm.created_at > datetime('now', '-2 hours')
            AND c.status = 'open'
        `).all(CONVERSATION_ROLE) as Array<{ conversation_id: string; content: string; created_at: string; title: string }>;

        for (const ack of ackMessages) {
            const followUp = db.prepare(`
                SELECT id FROM conversation_messages
                WHERE conversation_id = ?
                AND role = ?
                AND created_at > ?
                AND content NOT LIKE '%think about that%'
                AND length(content) > 50
                LIMIT 1
            `).get(ack.conversation_id, CONVERSATION_ROLE, ack.created_at) as any;

            if (!followUp) {
                const ackAge = Date.now() - new Date(ack.created_at).getTime();
                if (ackAge > 15 * 60 * 1000) { // 15+ minutes since ack
                    console.log(`${LOG} Unfulfilled commitment in "${ack.title}" — responding now`);
                    await respondToConversation(db, ack.conversation_id);
                }
            }
        }
    } catch (err) {
        console.error(`${LOG} Commitment scan error:`, (err as Error).message);
    } finally {
        db.close();
    }
}

// ── Process signal ────────────────────────────────────────────

async function processSignal(signal: SignalData): Promise<void> {
    console.log(`${LOG} Signal: source=${signal.source}, conv=${signal.conversationId}, channel=${signal.channelId || signal.channel}`);

    const isDiscord = signal.source === 'discord';

    if (isDiscord) {
        await respondToDiscord(signal);
    } else if (signal.conversationId) {
        const db = getDb();
        try {
            await respondToConversation(db, signal.conversationId, signal);
        } finally {
            db.close();
        }
    }

    // PR-C3: the per-dispatch paired flush happens AT the capture sites (flushCapturePairedMemory)
    // — no shared-buffer flush here (the old read→append→reset raced under C1's concurrency).
}

// ── Main loop ─────────────────────────────────────────────────

async function main(): Promise<void> {
    const pidGuard = ensureSingleInstance(`${SLUG}-human`);
    process.on('exit', () => pidGuard.cleanup());

    console.log(`${LOG} Starting (PID ${process.pid}, slug=${SLUG}, role=${CONVERSATION_ROLE}, commitmentScan=${COMMITMENT_SCAN_ENABLED})`);
    ensureDirectories();
    writeHealth();

    // PR-C3: drain any LEGACY swap-buffer residue once at boot (pre-C3 code / a crash mid-write) —
    // captures now flush per-dispatch (flushCapturePairedMemory), so nothing writes the buffer live.
    try { await flushSwapToWorkingMemory(); } catch (err) {
        console.error(`${LOG} Startup legacy swap drain failed (residue preserved):`, (err as Error).message);
    }

    // PR-C3: this driver process OWNS its surface's warm-stem pool (single-writer, cond-3) —
    // populate + replenish + chrome-guarded retire sweep + the 24h substrate reload. No-op when
    // poolSize is unset (the floor model, today's behaviour).
    if (poolSizeFor(SLUG, HUMAN_SURFACE) > 0) startPoolManager(SLUG, HUMAN_SURFACE);

    // Health writer interval
    setInterval(() => writeHealth(), HEALTH_WRITE_INTERVAL_MS);

    // Commitment scanner — registry-gated capability (leo-only today; off by default for every
    // other agent). A pure collapse must NOT universalise a Leo-only capability (Jim's P2-a).
    if (COMMITMENT_SCAN_ENABLED) {
        setInterval(() => scanUnfulfilledCommitments().catch(err =>
            console.error(`${LOG} Commitment scan error:`, err.message)
        ), COMMITMENT_SCAN_INTERVAL_MS);
        console.log(`${LOG} Commitment scanner enabled (every ${COMMITMENT_SCAN_INTERVAL_MS / 60000}min)`);
    }

    // ── PR-C1 (MNT-009 completion): the durable wake QUEUE + bounded concurrent dispatch ──────
    // Replaces the single-flag file + `processing` guard, which serialised the controller to one
    // dispatch at a time and DROPPED a wake arriving mid-processing (the S212 live-prove finding).
    // The orchestrator was always designed for concurrent different-thread dispatches (DEC-079's
    // per-conversation locks) — this RESTORES that intent at the controller:
    //  - jemma writes one queue FILE per dispatch (`<signal>.d/<ms>-<dispatchId>.json`, temp+rename)
    //    → no overwrite-drop by construction; unclaimed files survive a controller restart.
    //  - claim = read+unlink (subsumes the old guard's inotify double-event dedupe: the second
    //    event finds no file). No settle-delay needed on the queue path (temp+rename = atomic).
    //  - the semaphore bound = poolSizeFor(slug, surface) || 1 — the SAME leaf that sizes the warm
    //    pool, so dispatch concurrency and pool capacity can never drift. Unset ⇒ 1 ⇒ exactly
    //    today's one-at-a-time behaviour (C1 is behaviour-preserving until a poolSize is set).
    //  - per-CONVERSATION exclusivity: a wake for an in-flight conversation stays queued (defer,
    //    not drop — the deferred turn self-corrects: the spoke reads the live thread and stands
    //    down if already answered). Different conversations dispatch concurrently.
    const QUEUE_DIR = wakeQueueDir(SIGNALS_DIR, SIGNAL_NAME);
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    const pendingWakes: SignalData[] = [];
    const inFlightConversations = new Set<string>();
    let activeDispatches = 0;
    const maxConcurrent = (): number => poolSizeFor(SLUG, HUMAN_SURFACE) || 1;

    const runOne = (signal: SignalData): void => {
        const conv = signal.conversationId;
        if (conv) inFlightConversations.add(conv);
        activeDispatches++;
        void processSignal(signal)
            .then(() => writeHealth())
            .catch(err => {
                console.error(`${LOG} Signal processing error:`, (err as Error).message);
                writeHealth((err as Error).message);
            })
            .finally(() => {
                activeDispatches--;
                if (conv) inFlightConversations.delete(conv);
                pump();
            });
    };

    const pump = (): void => {
        while (activeDispatches < maxConcurrent()) {
            const i = pickNextEligible(pendingWakes, inFlightConversations);
            if (i < 0) return;
            runOne(pendingWakes.splice(i, 1)[0]);
        }
    };

    const drainQueue = (): void => {
        // Queue dir first (the canonical path)…
        for (const w of claimWakeFiles<SignalData>(SIGNALS_DIR, SIGNAL_NAME)) pendingWakes.push(w);
        // …then the LEGACY flat file (F4 both-read window — a wake written mid-deploy by a
        // pre-C1 server is never stranded; retire this read once the fleet is on C1).
        const legacy = readSignal();
        if (legacy) pendingWakes.push(legacy);
        pump();
    };

    console.log(`${LOG} Watching ${QUEUE_DIR} (wake queue) + legacy ${SIGNAL_NAME} (maxConcurrent=${maxConcurrent()})`);
    // Startup sweep: unclaimed queue files from before a restart + any legacy flat wake.
    drainQueue();
    // Watch the queue dir for new wake files (inotify on the dir itself — files created inside a
    // subdirectory do NOT fire events on the parent watch).
    fs.watch(QUEUE_DIR, () => drainQueue());
    // Legacy flat-file watch (both-read window). The 500ms settle stays ONLY here: the flat write
    // is non-atomic; the queue path needs none (temp+rename).
    fs.watch(SIGNALS_DIR, async (event, filename) => {
        if (filename !== SIGNAL_NAME) return;
        await new Promise(r => setTimeout(r, 500));
        drainQueue();
    });

    // DEC-101 (C5): thread-resolve reap. The server drops `<slug>-reap-thread/<conversation_id>` when
    // a thread resolves/archives; reap THIS agent's spoke bound to that thread (no-op if it has none).
    // A spoke's life IS its thread's life (Darron). Inert while spokePersist is OFF (no spokes exist).
    const REAP_DIR = path.join(SIGNALS_DIR, `${SLUG}-reap-thread`);
    try { fs.mkdirSync(REAP_DIR, { recursive: true }); } catch { /* exists */ }
    const drainReaps = (): void => {
        let files: string[]; try { files = fs.readdirSync(REAP_DIR); } catch { return; }
        for (const f of files) {
            if (f.startsWith('.')) continue;
            try { reapThreadSpoke(SLUG, HUMAN_SURFACE, f); } // filename = conversation_id
            catch (err) { console.warn(`${LOG} reap-thread ${f} failed: ${(err as Error).message}`); }
            try { fs.unlinkSync(path.join(REAP_DIR, f)); } catch { /* already gone */ }
        }
    };
    drainReaps(); // startup sweep: reaps queued before a restart
    fs.watch(REAP_DIR, () => drainReaps());

    // DEC-079: fs.watch+poll race retired. With one-write-site discipline (DEC-080) and the
    // startup sweep above, missed inotify events self-heal at the next event or restart; if one
    // ever slips, the message stays in the thread and Darron sees the missing response —
    // failure-visible by design.

    // Keep process alive
    await new Promise(() => {});
}

main().catch(err => {
    console.error(`${LOG} Fatal:`, err);
    process.exit(1);
});
