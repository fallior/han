/**
 * Tailscale API Service
 * Programmatic management of the tailnet via the Tailscale v2 API.
 * Docs: https://tailscale.com/api
 */

import fs from 'node:fs';
import path from 'node:path';

const HAN_DIR = path.join(process.env.HOME || '', '.han');
const CONFIG_PATH = path.join(HAN_DIR, 'config.json');

// ── Config ──────────────────────────────────────────────────

interface TailscaleConfig {
    api_key: string;
    tailnet: string;
}

function loadTailscaleConfig(): TailscaleConfig {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const ts = config.tailscale;
    if (!ts?.api_key || !ts?.tailnet) {
        throw new Error('Tailscale config missing — add tailscale.api_key and tailscale.tailnet to ~/.han/config.json');
    }
    return ts;
}

// ── HTTP helpers ────────────────────────────────────────────

const BASE_URL = 'https://api.tailscale.com/api/v2';

async function tsFetch(path: string, options: RequestInit = {}): Promise<any> {
    const config = loadTailscaleConfig();
    const authHeader = 'Basic ' + Buffer.from(config.api_key + ':').toString('base64');

    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Tailscale API ${res.status}: ${body}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : {};
}

// ── Device management ───────────────────────────────────────

export async function listDevices(): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/devices`);
}

export async function getDevice(deviceId: string): Promise<any> {
    return tsFetch(`/device/${deviceId}`);
}

export async function deleteDevice(deviceId: string): Promise<void> {
    await tsFetch(`/device/${deviceId}`, { method: 'DELETE' });
}

export async function authoriseDevice(deviceId: string): Promise<void> {
    await tsFetch(`/device/${deviceId}/authorized`, {
        method: 'POST',
        body: JSON.stringify({ authorized: true }),
    });
}

// ── User invitations ────────────────────────────────────────

export async function inviteUser(email: string): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/user-invites`, {
        method: 'POST',
        body: JSON.stringify({
            role: 'member',
            email,
        }),
    });
}

export async function listUserInvites(): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/user-invites`);
}

// ── Device sharing (share node with external tailnet) ───────

export async function shareDevice(deviceId: string): Promise<any> {
    return tsFetch(`/device/${deviceId}/device-invites`, {
        method: 'POST',
        body: JSON.stringify({
            multiUse: false,
            allowExitNode: false,
        }),
    });
}

// ── Auth keys (pre-authenticated keys for new devices) ──────

export async function createAuthKey(options: {
    reusable?: boolean;
    ephemeral?: boolean;
    preauthorized?: boolean;
    description?: string;
    tags?: string[];
    expiry?: number;
} = {}): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/keys`, {
        method: 'POST',
        body: JSON.stringify({
            capabilities: {
                devices: {
                    create: {
                        reusable: options.reusable ?? false,
                        ephemeral: options.ephemeral ?? false,
                        preauthorized: options.preauthorized ?? true,
                        tags: options.tags ?? [],
                    },
                },
            },
            expirySeconds: options.expiry ?? 86400,
            description: options.description ?? 'Created by HAN',
        }),
    });
}

export async function listAuthKeys(): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/keys`);
}

// ── ACLs ────────────────────────────────────────────────────

export async function getACLs(): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/acl`);
}

export async function updateACLs(acl: object): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/acl`, {
        method: 'POST',
        body: JSON.stringify(acl),
    });
}

// ── DNS ─────────────────────────────────────────────────────

export async function getDNSNameservers(): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/dns/nameservers`);
}

export async function getDNSPreferences(): Promise<any> {
    const config = loadTailscaleConfig();
    return tsFetch(`/tailnet/${config.tailnet}/dns/preferences`);
}
