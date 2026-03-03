/**
 * Bearer Token Authentication Middleware
 * Protects /api/* and /admin routes with optional localhost bypass
 */

import { Router, Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';

// ── Helpers ──────────────────────────────────────────────────

/**
 * Check if request is from localhost
 */
function isLocalhost(req: Request): boolean {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Load config to get server_auth_token
 */
function loadConfig(): any {
    try {
        const cfgPath = path.join(process.env.HOME || '', '.claude-remote', 'config.json');
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch {
        return {};
    }
}

// ── Middleware ───────────────────────────────────────────────

/**
 * Bearer token authentication middleware
 * - Localhost (127.0.0.1, ::1, ::ffff:127.0.0.1) bypass auth entirely
 * - Non-localhost requires valid Bearer token from Authorization header
 * - If server_auth_token not set in config, auth is disabled (allow all)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Localhost always passes
    if (isLocalhost(req)) {
        next();
        return;
    }

    // Load config and check if auth is enabled
    const config = loadConfig();
    const serverToken = config.server_auth_token;

    // If no token configured, auth is disabled
    if (!serverToken) {
        next();
        return;
    }

    // Get Authorization header
    const authHeader = req.headers.authorization;

    // Check for missing or malformed header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            success: false,
            error: 'Missing or invalid Authorization header',
        });
        return;
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // Check token against config
    if (token !== serverToken) {
        res.status(401).json({
            success: false,
            error: 'Unauthorized',
        });
        return;
    }

    // Token is valid, proceed
    next();
}
