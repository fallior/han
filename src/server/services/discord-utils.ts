/**
 * Discord Utilities — Webhook posting and config helpers
 */

import fs from 'node:fs';
import path from 'node:path';

interface DiscordConfig {
    discord?: {
        bot_token?: string;
        server_id?: string;
        channels?: Record<string, string>;
        webhooks?: Record<string, string>;
        username_map?: Record<string, string>;
    };
}

const CLAUDE_REMOTE_DIR = process.env.CLAUDE_REMOTE_DIR || path.join(process.env.HOME || '', '.claude-remote');
const CONFIG_PATH = path.join(CLAUDE_REMOTE_DIR, 'config.json');

/**
 * Load Discord config from ~/.claude-remote/config.json
 */
export function loadDiscordConfig(): DiscordConfig {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return {};
        }
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return {};
    }
}

/**
 * Resolve channelId to channelName using config
 * Config structure: channels: { '#channel-name': 'channel-id-string' }
 * So we reverse it: given a channelId, find the channel name
 */
export function resolveChannelName(channelId: string): string | null {
    const config = loadDiscordConfig();
    const channels = config.discord?.channels || {};

    for (const [name, id] of Object.entries(channels)) {
        if (id === channelId) {
            // Strip '#' if present
            return name.startsWith('#') ? name.slice(1) : name;
        }
    }

    return null;
}

/**
 * Post message to Discord via webhook
 *
 * Handles:
 * - 2000-character Discord message limit (splits long messages)
 * - Retry logic with exponential backoff
 * - Role prefix formatting (e.g., "jim: message")
 */
export async function postToDiscord(
    role: string,
    channelName: string,
    content: string,
    maxRetries: number = 2
): Promise<boolean> {
    const config = loadDiscordConfig();
    const webhooks = config.discord?.webhooks || {};
    const webhookUrl = webhooks[channelName];

    if (!webhookUrl) {
        console.warn(`[Discord] No webhook configured for #${channelName}`);
        return false;
    }

    // Split content into 2000-character chunks (Discord limit)
    const chunks: string[] = [];
    const rolePrefix = role ? `**${role}**: ` : '';
    const maxContentLength = 2000 - rolePrefix.length;

    if (content.length <= maxContentLength) {
        chunks.push(rolePrefix + content);
    } else {
        let remaining = content;
        while (remaining.length > 0) {
            const chunk = remaining.slice(0, maxContentLength);
            chunks.push(rolePrefix + chunk);
            remaining = remaining.slice(maxContentLength);
        }
    }

    // Post each chunk with retry logic
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: chunk }),
                });

                if (!response.ok) {
                    throw new Error(`Discord API returned ${response.status}: ${response.statusText}`);
                }

                // Success
                break;
            } catch (err) {
                lastError = err as Error;
                if (attempt < maxRetries) {
                    // Exponential backoff: 1s, 2s, 4s
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(
                        `[Discord] Failed to post chunk ${i + 1}/${chunks.length} after ${maxRetries + 1} attempts: ${lastError.message}`
                    );
                    return false;
                }
            }
        }
    }

    return true;
}
