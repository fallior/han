/**
 * Discord Utility Module — Shared by Leo, Jim, and Jemma
 *
 * Provides channel ID ↔ name resolution, Discord message context fetching,
 * and webhook posting for all agents. Each agent has their own set of webhooks
 * for every channel, so they can post anywhere under their own name.
 *
 * Config structure (in ~/.han/config.json → discord):
 *   channels:  { "general": "1478...", "leo": "1478...", ... }
 *   webhooks:  { "leo": { "general": "url", ... }, "jim": { ... }, "jemma": { ... } }
 */

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.join(process.env.HOME || '/home/darron', '.han', 'config.json');

interface DiscordConfig {
    bot_token?: string;
    server_id?: string;
    channels?: Record<string, string>;
    webhooks?: Record<string, Record<string, string>>;
}

interface DiscordMessage {
    author: string;
    content: string;
    timestamp: string;
}

// ── Config ────────────────────────────────────────────────────

export function loadDiscordConfig(): DiscordConfig {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        return config.discord || {};
    } catch {
        console.error('[Discord] Failed to load config from', CONFIG_PATH);
        return {};
    }
}

// ── Channel Resolution ────────────────────────────────────────

/**
 * Resolve a Discord channel ID to its human-readable name.
 * Reverses the config.discord.channels map (name → ID) to find the name for a given ID.
 */
export function resolveChannelName(channelId: string): string | null {
    const config = loadDiscordConfig();
    const channels = config.channels || {};
    for (const [name, id] of Object.entries(channels)) {
        if (id === channelId) return name;
    }
    return null;
}

/**
 * Resolve a channel name to its Discord channel ID.
 */
export function resolveChannelId(channelName: string): string | null {
    const config = loadDiscordConfig();
    return config.channels?.[channelName] || null;
}

// ── Discord Context Fetching ──────────────────────────────────

/**
 * Fetch recent messages from a Discord channel via the REST API.
 * Uses the bot token from config. Returns newest-first.
 */
export async function fetchDiscordContext(channelId: string, limit: number = 10): Promise<DiscordMessage[]> {
    const config = loadDiscordConfig();
    const botToken = config.bot_token;
    if (!botToken) {
        console.warn('[Discord] No bot_token in config — cannot fetch context');
        return [];
    }

    try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
            headers: { 'Authorization': `Bot ${botToken}` },
            signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
            console.error(`[Discord] Failed to fetch channel ${channelId}: ${res.status}`);
            return [];
        }

        const messages = await res.json() as any[];
        return messages.map(m => ({
            author: m.author?.username || 'unknown',
            content: m.content || '',
            timestamp: m.timestamp,
        }));
    } catch (err) {
        console.error('[Discord] Context fetch error:', (err as Error).message);
        return [];
    }
}

// ── Webhook Posting ───────────────────────────────────────────

/**
 * Split a message into chunks that respect Discord's 2000-char limit.
 * Splits at natural boundaries: double newline > newline > sentence > space > hard cut.
 */
function splitMessage(content: string, maxLen: number = 2000): string[] {
    if (content.length <= maxLen) return [content];

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        let splitAt = -1;
        const window = remaining.slice(0, maxLen);

        // Try splitting at double newline
        const doubleNl = window.lastIndexOf('\n\n');
        if (doubleNl > maxLen * 0.3) { splitAt = doubleNl; }

        // Try newline
        if (splitAt === -1) {
            const nl = window.lastIndexOf('\n');
            if (nl > maxLen * 0.3) { splitAt = nl; }
        }

        // Try sentence boundary
        if (splitAt === -1) {
            const sentence = window.lastIndexOf('. ');
            if (sentence > maxLen * 0.3) { splitAt = sentence + 1; }
        }

        // Try space
        if (splitAt === -1) {
            const space = window.lastIndexOf(' ');
            if (space > maxLen * 0.3) { splitAt = space; }
        }

        // Hard cut
        if (splitAt === -1) { splitAt = maxLen; }

        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
}

/**
 * Post a message to Discord via a webhook. Posts under the agent's own name.
 * Handles 2000-char splitting and single retry on failure.
 *
 * @param persona - Agent name: 'leo', 'jim', or 'jemma'
 * @param channelName - Channel name (e.g. 'general', 'leo', 'jim')
 * @param content - Message content
 * @returns true if all chunks posted successfully
 */
export async function postToDiscord(persona: string, channelName: string, content: string): Promise<boolean> {
    const config = loadDiscordConfig();
    const webhookUrl = config.webhooks?.[persona]?.[channelName];

    if (!webhookUrl) {
        console.error(`[Discord] No webhook for ${persona}/${channelName}`);
        return false;
    }

    const displayName = persona.charAt(0).toUpperCase() + persona.slice(1);
    const chunks = splitMessage(content);

    for (const chunk of chunks) {
        const success = await postWebhookWithRetry(webhookUrl, displayName, chunk);
        if (!success) return false;

        // Brief pause between chunks to maintain order
        if (chunks.length > 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    return true;
}

/**
 * POST to a Discord webhook with a single retry on failure.
 */
async function postWebhookWithRetry(webhookUrl: string, username: string, content: string): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, content }),
                signal: AbortSignal.timeout(10000),
            });

            if (res.ok || res.status === 204) return true;

            // Rate limited — wait and retry
            if (res.status === 429) {
                const retryAfter = Number(res.headers.get('retry-after') || '2');
                console.warn(`[Discord] Rate limited, waiting ${retryAfter}s...`);
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue;
            }

            console.error(`[Discord] Webhook POST failed: ${res.status} ${res.statusText}`);
        } catch (err) {
            console.error(`[Discord] Webhook POST error (attempt ${attempt + 1}):`, (err as Error).message);
        }
    }

    return false;
}
