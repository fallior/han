/**
 * Jemma Delivery Route
 * Handles Discord message delivery from Jemma service
 */

import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { conversationStmts, conversationMessageStmts, CLAUDE_REMOTE_DIR } from '../db';
import { broadcast } from '../ws';
import { generateId } from '../services/planning';

const router = Router();

// ── Directories ──────────────────────────────────────────────

const SIGNALS_DIR = path.join(process.env.HOME || '', '.claude-remote', 'signals');
const HEALTH_DIR = path.join(CLAUDE_REMOTE_DIR, 'health');

(() => {
    fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    fs.mkdirSync(HEALTH_DIR, { recursive: true });
})();

// ── Helpers ──────────────────────────────────────────────────

/**
 * Check if request is from localhost only
 */
function isLocalhost(req: Request): boolean {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Load config to get ntfy topic
 */
function loadConfig(): any {
    try {
        const cfgPath = path.join(process.env.HOME || '', '.claude-remote', 'config.json');
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch {
        return {};
    }
}

/**
 * Send notification via ntfy.sh to Darron
 */
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
        // Best effort — don't fail the request
    }
}

/**
 * Write a signal file for Jim or Leo wake-up
 */
function writeSignalFile(signalName: string, data?: Record<string, unknown>): void {
    const timestamp = Date.now();
    const filename = `${signalName}-${timestamp}`;
    const filepath = path.join(SIGNALS_DIR, filename);

    if (data) {
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    } else {
        fs.writeFileSync(filepath, '');
    }
}

// ── Route: POST /api/jemma/deliver ──────────────────────────

/**
 * POST /deliver
 * Accepts classified Discord messages from Jemma and routes to recipient
 *
 * Body:
 * {
 *   recipient: 'jim' | 'leo' | 'darron',
 *   message: string,
 *   channel: string,
 *   author: string,
 *   classification_confidence: number (0-1),
 *   conversation_id?: string (for jim/leo routing)
 * }
 */
router.post('/deliver', (req: Request, res: Response) => {
    try {
        // Localhost check
        if (!isLocalhost(req)) {
            return res.status(403).json({
                success: false,
                error: 'Jemma delivery is localhost-only'
            });
        }

        const {
            recipient,
            message,
            channel,
            author,
            classification_confidence,
            conversation_id
        } = req.body;

        // Validation
        if (!recipient || !message || !channel || !author || classification_confidence === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: recipient, message, channel, author, classification_confidence'
            });
        }

        if (!['jim', 'leo', 'darron'].includes(recipient)) {
            return res.status(400).json({
                success: false,
                error: 'recipient must be jim, leo, or darron'
            });
        }

        if (typeof classification_confidence !== 'number' || classification_confidence < 0 || classification_confidence > 1) {
            return res.status(400).json({
                success: false,
                error: 'classification_confidence must be a number between 0 and 1'
            });
        }

        // Route based on recipient
        let delivered = false;

        if (recipient === 'jim') {
            // Create or get conversation for Jim
            try {
                let convId = conversation_id;

                if (!convId) {
                    // Create new conversation if none specified
                    convId = generateId();
                    const now = new Date().toISOString();
                    conversationStmts.insertWithType.run(
                        convId,
                        `Discord: ${author} in #${channel}`,
                        'open',
                        now,
                        now,
                        'discord'
                    );
                }

                // Insert message into conversation
                const msgId = generateId();
                const now = new Date().toISOString();
                conversationMessageStmts.insert.run(msgId, convId, 'discord', message, now);

                // Write signal file to wake Jim
                writeSignalFile('jim-wake-discord', {
                    conversationId: convId,
                    author,
                    channel,
                    confidence: classification_confidence,
                    mentionedAt: new Date().toISOString()
                });

                delivered = true;
            } catch (err: any) {
                console.error('[Jemma] Error routing to Jim:', err.message);
            }
        } else if (recipient === 'leo') {
            // Write signal file to wake Leo
            try {
                writeSignalFile('leo-wake-discord', {
                    author,
                    channel,
                    message: message.substring(0, 200), // Preview
                    confidence: classification_confidence,
                    mentionedAt: new Date().toISOString()
                });

                delivered = true;
            } catch (err: any) {
                console.error('[Jemma] Error routing to Leo:', err.message);
            }
        } else if (recipient === 'darron') {
            // Send ntfy notification to Darron
            try {
                const preview = message.length > 100 ? message.substring(0, 100) + '...' : message;
                sendNtfyNotification(
                    `Discord: ${author} in #${channel}`,
                    preview
                );

                delivered = true;
            } catch (err: any) {
                console.error('[Jemma] Error routing to Darron:', err.message);
            }
        }

        // Broadcast via WebSocket for live Admin UI updates
        try {
            broadcast({
                type: 'jemma_delivery',
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

        res.json({
            success: true,
            recipient,
            delivered,
            message: `Routed to ${recipient}`
        });
    } catch (err: any) {
        console.error('[Jemma] Delivery error:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ── Route: GET /api/jemma/status ────────────────────────────

/**
 * GET /status
 * Returns Jemma service health status, recent messages, and delivery statistics
 */
router.get('/status', (req: Request, res: Response) => {
    try {
        const healthFile = path.join(HEALTH_DIR, 'jemma-health.json');
        const messagesFile = path.join(HEALTH_DIR, 'jemma-messages.json');
        const statsFile = path.join(HEALTH_DIR, 'jemma-stats.json');

        let health: any = {};
        let recentMessages: any[] = [];
        let deliveryStats: Record<string, number> = {};

        if (fs.existsSync(healthFile)) {
            health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
        }

        if (fs.existsSync(messagesFile)) {
            try {
                const messagesData = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
                recentMessages = messagesData.recent || [];
            } catch {
                // Ignore parse errors
            }
        }

        if (fs.existsSync(statsFile)) {
            try {
                const statsData = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
                deliveryStats = statsData.delivery_stats || {};
            } catch {
                // Ignore parse errors
            }
        }

        res.json({
            success: true,
            status: health.gatewayConnected ? 'connected' : 'disconnected',
            uptime_seconds: health.uptimeMinutes ? health.uptimeMinutes * 60 : 0,
            last_reconciliation: health.lastBeat || null,
            recent_messages: recentMessages,
            delivery_stats: deliveryStats,
            ...health
        });
    } catch (err: any) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

export default router;
