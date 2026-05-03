/**
 * Jemma Dispatch Service
 * Unified signal delivery for all message routing — Discord AND admin UI.
 * Used by both the /api/jemma/deliver HTTP route and conversations.ts directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { db, conversationStmts, conversationMessageStmts, HAN_DIR } from '../db';
import { broadcast } from '../ws';
import { generateId } from './planning';
import { ensureChannelWebhooks } from './discord';
import { getPersona, getDeliveryConfig } from './village.js';

// ── Directories ──────────────────────────────────────────────

const SIGNALS_DIR = path.join(process.env.HOME || '', '.han', 'signals');
const HEALTH_DIR = path.join(HAN_DIR, 'health');

(() => {
    fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    fs.mkdirSync(HEALTH_DIR, { recursive: true });
})();

// ── Helpers ──────────────────────────────────────────────────

/**
 * Write a wake-signal file. Per DEC-080 (One-Write-Site Discipline) this is the
 * SOLE writer of `~/.han/signals/{agent}-human-wake` files anywhere in the
 * codebase. Any other call to `fs.writeFileSync(...wake...)` under `src/server/`
 * is a bug — file an issue. Audit:
 *
 *     grep -nE 'writeFileSync.*wake' src/server/
 *
 * Should return exactly one match (this function). Note: `ws-broadcast` and
 * `jemma-ack-*` signals are NOT wake signals — they're WebSocket broadcasts and
 * orchestrator acks respectively; those have their own writers and audit paths.
 */
function writeSignalFile(signalName: string, data?: Record<string, unknown>): void {
    const filepath = path.join(SIGNALS_DIR, signalName);
    if (data) {
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    } else {
        fs.writeFileSync(filepath, '');
    }
}

function loadConfig(): any {
    try {
        const cfgPath = path.join(process.env.HOME || '', '.han', 'config.json');
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch {
        return {};
    }
}

function sendNtfyNotification(title: string, message: string): void {
    const config = loadConfig();
    if (!config.ntfy_topic) return;

    try {
        const body = `${title}\n${message}`;
        execFileSync('curl', [
            '-s',
            '-d', body,
            '-H', `Title: ${title}`,
            '-H', 'Priority: high',
            '-H', 'Tags: jemma,discord',
            `https://ntfy.sh/${config.ntfy_topic}`
        ], { timeout: 10000, stdio: 'ignore' });
    } catch {
        // Best effort
    }
}

// ── Delivery Stats ──────────────────────────────────────────

const deliveryStatsFile = path.join(HEALTH_DIR, 'jemma-delivery-log.json');

function logDelivery(source: 'discord' | 'admin', recipient: string, delivered: boolean): void {
    try {
        let log: any = { deliveries: [], by_source: {} };
        if (fs.existsSync(deliveryStatsFile)) {
            log = JSON.parse(fs.readFileSync(deliveryStatsFile, 'utf8'));
        }

        log.deliveries = log.deliveries || [];
        log.deliveries.push({
            source,
            recipient,
            delivered,
            timestamp: new Date().toISOString(),
        });
        if (log.deliveries.length > 200) {
            log.deliveries = log.deliveries.slice(-200);
        }

        if (!log.by_source) log.by_source = {};
        if (!log.by_source[source]) log.by_source[source] = {};
        log.by_source[source][recipient] = (log.by_source[source][recipient] || 0) + 1;

        fs.writeFileSync(deliveryStatsFile, JSON.stringify(log, null, 2));
    } catch (err: any) {
        console.error('[Jemma] Failed to log delivery:', err.message);
    }
}

// ── Prepared statement ──────────────────────────────────────

const findOpenDiscordConv = db.prepare(
    `SELECT id FROM conversations WHERE discussion_type = 'discord' AND status = 'open' AND title LIKE ? ORDER BY updated_at DESC LIMIT 1`
);

// ── Main delivery function ──────────────────────────────────

export interface DeliveryRequest {
    source: 'discord' | 'admin';
    recipient: string;
    message: string;
    author: string;
    classification_confidence: number;
    channel?: string;
    channelName?: string;
    conversationId?: string;
    discussionType?: string;
    reasoning?: string;
    conversation_id?: string;  // Alias for conversationId (backward compat)
    // Orchestration (Phase 1, DEC-077 follow-on): when present, the agent
    // writes ~/.han/signals/jemma-ack-{dispatchId} after posting/standing-down.
    // Absent → backward-compat behaviour (agent runs, no ack written).
    // Wake signal payload format documented in jemma-orchestrator.ts header.
    dispatchId?: string;
    priorAgentFailed?: { agent: string; reason: string; exit_reason: string };
}

export interface DeliveryResult {
    success: boolean;
    source: string;
    recipient: string;
    delivered: boolean;
}

/**
 * Deliver a classified message to the appropriate agent.
 * Called directly by conversations.ts (admin) and via HTTP by jemma.ts (Discord).
 *
 * For Discord sources, auto-provisions channel mappings and webhooks for all
 * personas before dispatching — so agents always have a webhook to post with.
 */
export async function deliverMessage(req: DeliveryRequest): Promise<DeliveryResult> {
    const {
        source,
        recipient,
        message,
        author,
        classification_confidence,
        channel,
        channelName,
        conversationId: adminConversationId,
        discussionType,
        reasoning,
        conversation_id,
        dispatchId,
        priorAgentFailed,
    } = req;

    const effectiveSource = source === 'admin' ? 'admin' : 'discord';
    const effectiveConvId = adminConversationId || conversation_id;

    console.log(`[Jemma] Delivering: source=${effectiveSource} recipient=${recipient} author=${author}${reasoning ? ` reason="${reasoning}"` : ''}`);

    // Auto-provision webhooks for new Discord channels
    if (effectiveSource === 'discord' && channel) {
        try {
            const resolvedName = await ensureChannelWebhooks(channel);
            if (resolvedName) {
                console.log(`[Jemma] Channel ${channel} ready as "${resolvedName}" — webhooks ensured`);
            }
        } catch (err: any) {
            console.warn(`[Jemma] Webhook auto-provision failed (non-fatal): ${err.message}`);
        }
    }

    let delivered = false;

    // Look up persona from registry for delivery routing
    const persona = getPersona(recipient);
    const deliveryType = persona?.delivery || 'signal';
    const delivConfig = persona ? getDeliveryConfig(persona) : {};

    try {
        // For agents with signal or http_local delivery: handle Discord conversation creation
        if (deliveryType === 'signal' || deliveryType === 'http_local') {
            let convId = effectiveConvId;

            // Discord: create/find conversation. Admin: conversation already exists.
            if (effectiveSource === 'discord' && !convId) {
                const existing = findOpenDiscordConv.get(`%#${channel}%`) as { id: string } | undefined;
                if (existing) {
                    convId = existing.id;
                } else {
                    convId = generateId();
                    const now = new Date().toISOString();
                    conversationStmts.insertWithType.run(
                        convId,
                        `Discord: ${author} in #${channelName || channel} (${channel})`,
                        'open',
                        now,
                        now,
                        'discord'
                    );
                }
            }

            // Insert message into conversation (Discord only — admin already inserted it)
            if (effectiveSource === 'discord' && convId) {
                const msgId = generateId();
                const now = new Date().toISOString();
                conversationMessageStmts.insert.run(msgId, convId, 'human', message, now);
                conversationStmts.updateTimestamp.run(now, convId);
            }

            // Write signal file — use {name}-human-wake from delivery_config, or default
            const wakeSignals: string[] = delivConfig.wake_signals || delivConfig.fallback_signals || [`${recipient}-human-wake`];
            // For conversation dispatch, only write the human-wake signal (not the heartbeat/supervisor wake)
            // to prevent duplicate responses. The human-wake agent handles conversations.
            const humanWakeSignal = wakeSignals.find(s => s.includes('human-wake')) || wakeSignals[0];
            // Wake payload schema (read site: leo-human.ts / jim-human.ts SignalData interface).
            // `dispatchId` + `priorAgentFailed` are the Phase 1 orchestration fields — when
            // dispatchId is present, the agent must write ~/.han/signals/jemma-ack-{id}
            // after posting/standing-down. See jemma-orchestrator.ts header comment.
            const signalData = {
                source: effectiveSource,
                ...(convId ? { conversationId: convId } : {}),
                ...(channel ? { channel, channelId: channel } : {}),
                ...(discussionType ? { discussionType } : {}),
                author,
                messagePreview: message.substring(0, 200),
                confidence: classification_confidence,
                mentionedAt: new Date().toISOString(),
                ...(dispatchId ? { dispatchId } : {}),
                ...(priorAgentFailed ? { priorAgentFailed } : {}),
            };
            writeSignalFile(humanWakeSignal, signalData);

            delivered = true;
        } else if (deliveryType === 'ntfy') {
            const preview = message.length > 100 ? message.substring(0, 100) + '...' : message;
            const title = effectiveSource === 'discord'
                ? `Discord: ${author} in #${channel}`
                : `Admin: ${author}${discussionType ? ` in ${discussionType}` : ''}`;
            sendNtfyNotification(title, preview);

            delivered = true;
        } else {
            console.log(`[Jemma] No dispatch delivery for ${recipient} (delivery type: ${deliveryType})`);
        }
    } catch (err: any) {
        console.error(`[Jemma] Error routing to ${recipient}:`, err.message);
    }

    // Log delivery for audit trail
    logDelivery(effectiveSource, recipient, delivered);

    // Broadcast via WebSocket for live Admin UI updates
    try {
        broadcast({
            type: 'jemma_delivery',
            source: effectiveSource,
            recipient,
            channel,
            author,
            message_preview: message.substring(0, 100),
            classification_confidence,
            delivered,
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        console.error('[Jemma] Error broadcasting:', err.message);
    }

    return {
        success: true,
        source: effectiveSource,
        recipient,
        delivered,
    };
}

// Export stats file path for the status endpoint
export { deliveryStatsFile, SIGNALS_DIR, HEALTH_DIR };
