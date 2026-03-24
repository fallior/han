/**
 * Jemma Delivery Route
 * HTTP interface for Jemma's unified dispatch service.
 * Discord gateway calls this endpoint; admin UI calls deliverMessage() directly.
 */

import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { deliverMessage, deliveryStatsFile, HEALTH_DIR } from '../services/jemma-dispatch';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────

function isLocalhost(req: Request): boolean {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ── Route: POST /api/jemma/deliver ──────────────────────────

/**
 * POST /deliver
 * HTTP interface for the unified dispatch service.
 * Used by the external Jemma Discord gateway (jemma.ts service).
 * Admin UI dispatch uses deliverMessage() directly — no HTTP round-trip.
 */
router.post('/deliver', (req: Request, res: Response) => {
    try {
        if (!isLocalhost(req)) {
            return res.status(403).json({
                success: false,
                error: 'Jemma delivery is localhost-only'
            });
        }

        const {
            source = 'discord',
            recipient,
            message,
            channel,
            channelName,
            author,
            classification_confidence,
            conversation_id,
            conversationId,
            discussionType,
            reasoning,
        } = req.body;

        // Validation
        if (!recipient || !message || !author || classification_confidence === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: recipient, message, author, classification_confidence'
            });
        }

        if (source === 'discord' && !channel) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field for discord source: channel'
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

        const result = deliverMessage({
            source: source === 'admin' ? 'admin' : 'discord',
            recipient,
            message,
            author,
            classification_confidence,
            channel,
            channelName,
            conversationId: conversationId || conversation_id,
            discussionType,
            reasoning,
        });

        res.json({
            ...result,
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

        // Unified delivery log (covers both Discord and admin dispatches)
        let deliveryLog: any = {};
        if (fs.existsSync(deliveryStatsFile)) {
            try {
                deliveryLog = JSON.parse(fs.readFileSync(deliveryStatsFile, 'utf8'));
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
            delivery_log: deliveryLog,
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
