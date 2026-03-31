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

// ── Directories ──────────────────────────────────────────────

const SIGNALS_DIR = path.join(process.env.HOME || '', '.han', 'signals');
const HEALTH_DIR = path.join(HAN_DIR, 'health');

(() => {
    fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    fs.mkdirSync(HEALTH_DIR, { recursive: true });
})();

// ── Helpers ──────────────────────────────────────────────────

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
    recipient: 'jim' | 'leo' | 'darron';
    message: string;
    author: string;
    classification_confidence: number;
    channel?: string;
    channelName?: string;
    conversationId?: string;
    discussionType?: string;
    reasoning?: string;
    conversation_id?: string;  // Alias for conversationId (backward compat)
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
 */
export function deliverMessage(req: DeliveryRequest): DeliveryResult {
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
    } = req;

    const effectiveSource = source === 'admin' ? 'admin' : 'discord';
    const effectiveConvId = adminConversationId || conversation_id;

    console.log(`[Jemma] Delivering: source=${effectiveSource} recipient=${recipient} author=${author}${reasoning ? ` reason="${reasoning}"` : ''}`);

    let delivered = false;

    if (recipient === 'jim') {
        try {
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

            // Write signal file to wake Jim/Human only.
            // jim-wake (supervisor) is NOT signalled — conversation responses are
            // Jim/Human's job. The supervisor's respond_conversation action is a
            // duplicate path that caused double-responses (diagnosed S103).
            const jimSignalData = {
                source: effectiveSource,
                conversationId: convId,
                author,
                ...(channel ? { channel } : {}),
                ...(discussionType ? { discussionType } : {}),
                confidence: classification_confidence,
                mentionedAt: new Date().toISOString()
            };
            writeSignalFile('jim-human-wake', jimSignalData);

            delivered = true;
        } catch (err: any) {
            console.error('[Jemma] Error routing to Jim:', err.message);
        }
    } else if (recipient === 'leo') {
        try {
            // Leo/Human only — leo-wake (heartbeat) not signalled for conversations.
            // Heartbeat Leo has a system prompt boundary forbidding conversation responses.
            const leoSignalData = {
                source: effectiveSource,
                ...(effectiveConvId ? { conversationId: effectiveConvId } : {}),
                ...(channel ? { channelId: channel } : {}),
                ...(discussionType ? { discussionType } : {}),
                author,
                messagePreview: message.substring(0, 200),
                confidence: classification_confidence,
                mentionedAt: new Date().toISOString()
            };
            writeSignalFile('leo-human-wake', leoSignalData);

            delivered = true;
        } catch (err: any) {
            console.error('[Jemma] Error routing to Leo:', err.message);
        }
    } else if (recipient === 'darron') {
        try {
            const preview = message.length > 100 ? message.substring(0, 100) + '...' : message;
            const title = effectiveSource === 'discord'
                ? `Discord: ${author} in #${channel}`
                : `Admin: ${author}${discussionType ? ` in ${discussionType}` : ''}`;
            sendNtfyNotification(title, preview);

            delivered = true;
        } catch (err: any) {
            console.error('[Jemma] Error routing to Darron:', err.message);
        }
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
