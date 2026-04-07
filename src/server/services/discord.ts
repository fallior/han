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
    attachments?: { filename: string; url: string; content_type?: string; size: number }[];
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
        return messages.map(m => {
            const attachments = (m.attachments || []).map((a: any) => ({
                filename: a.filename,
                url: a.url,
                content_type: a.content_type,
                size: a.size,
            }));
            // Append attachment summary to content so agents see it in context
            let content = m.content || '';
            if (attachments.length > 0) {
                const attSummary = attachments.map((a: any) =>
                    `  - ${a.filename} (${a.content_type || 'unknown'}, ${Math.round(a.size / 1024)}KB)`
                ).join('\n');
                content += `\n[Attachments]\n${attSummary}`;
            }
            return {
                author: m.author?.username || 'unknown',
                content,
                timestamp: m.timestamp,
                attachments: attachments.length > 0 ? attachments : undefined,
            };
        });
    } catch (err) {
        console.error('[Discord] Context fetch error:', (err as Error).message);
        return [];
    }
}

// ── Webhook Auto-Provisioning ─────────────────────────────────

const PERSONAS = ['leo', 'jim', 'jemma'] as const;

/**
 * Fetch a Discord channel's name via the REST API.
 */
async function fetchChannelName(channelId: string, botToken: string): Promise<string | null> {
    try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
            headers: { 'Authorization': `Bot ${botToken}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            console.error(`[Discord] Failed to fetch channel ${channelId}: ${res.status}`);
            return null;
        }
        const ch = await res.json() as any;
        return ch.name || null;
    } catch (err) {
        console.error('[Discord] Channel name fetch error:', (err as Error).message);
        return null;
    }
}

/**
 * Create a Discord webhook for a persona in a channel.
 */
async function createWebhook(channelId: string, persona: string, botToken: string): Promise<string | null> {
    const displayName = persona.charAt(0).toUpperCase() + persona.slice(1);
    try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: displayName }),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            console.error(`[Discord] Failed to create webhook for ${persona} in ${channelId}: ${res.status}`);
            return null;
        }
        const wh = await res.json() as any;
        return `https://discord.com/api/webhooks/${wh.id}/${wh.token}`;
    } catch (err) {
        console.error(`[Discord] Webhook creation error for ${persona}:`, (err as Error).message);
        return null;
    }
}

/**
 * Save the full config back to disk.
 */
function saveConfig(config: any): void {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Ensure a Discord channel is registered in config with webhooks for all personas.
 * If the channel ID is unknown, fetches its name from Discord. If any persona is
 * missing a webhook for this channel, creates one. Updates config.json in place.
 *
 * Called by Jemma dispatch before signalling agents, so by the time an agent wakes
 * up to respond, the webhook is already there.
 */
export async function ensureChannelWebhooks(channelId: string): Promise<string | null> {
    const fullConfig = (() => {
        try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
        catch { return {}; }
    })();

    const discord = fullConfig.discord || {};
    const channels: Record<string, string> = discord.channels || {};
    const webhooks: Record<string, Record<string, string>> = discord.webhooks || {};
    const botToken = discord.bot_token;

    if (!botToken) {
        console.warn('[Discord] No bot_token — cannot auto-provision webhooks');
        return null;
    }

    // Check if channel is already mapped
    let channelName: string | null = null;
    for (const [name, id] of Object.entries(channels)) {
        if (id === channelId) { channelName = name; break; }
    }

    // Fetch channel name from Discord if not in config
    if (!channelName) {
        channelName = await fetchChannelName(channelId, botToken);
        if (!channelName) {
            console.error(`[Discord] Cannot resolve channel ${channelId} — auto-provision failed`);
            return null;
        }
        channels[channelName] = channelId;
        console.log(`[Discord] Auto-registered channel: ${channelName} = ${channelId}`);
    }

    // Ensure webhooks exist for all personas
    let configChanged = !channels[channelName] || channels[channelName] !== channelId;
    for (const persona of PERSONAS) {
        if (!webhooks[persona]) webhooks[persona] = {};
        if (webhooks[persona][channelName]) continue;

        const url = await createWebhook(channelId, persona, botToken);
        if (url) {
            webhooks[persona][channelName] = url;
            configChanged = true;
            console.log(`[Discord] Auto-created webhook: ${persona}/${channelName}`);
        }
    }

    // Save if anything changed
    if (configChanged) {
        discord.channels = channels;
        discord.webhooks = webhooks;
        fullConfig.discord = discord;
        saveConfig(fullConfig);
        console.log(`[Discord] Config updated with channel ${channelName} and webhooks`);
    }

    return channelName;
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
