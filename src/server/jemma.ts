#!/usr/bin/env npx tsx
/**
 * Jemma — Discord Message Dispatcher Service
 *
 * Connects to Discord Gateway via WebSocket, classifies incoming messages using
 * Gemma/Qwen (local Ollama), and routes them to appropriate recipients:
 * Jim (Claude supervisor), Leo (Claude Code agent), Darron (human), or external teams.
 *
 * Runs as a systemd user service (jemma.service).
 *
 * Setup:
 *   1. Copy service file to systemd user directory:
 *      cp scripts/jemma.service ~/.config/systemd/user/
 *   2. Reload systemd daemon:
 *      systemctl --user daemon-reload
 *   3. Enable service to start on login:
 *      systemctl --user enable jemma.service
 *   4. Start the service:
 *      systemctl --user start jemma.service
 *   5. Monitor logs in real-time:
 *      journalctl --user -u jemma -f
 *
 * Usage (direct):
 *   npx tsx src/server/jemma.ts
 *
 * Service management:
 *   systemctl --user status jemma       — Check service status
 *   systemctl --user restart jemma      — Restart service
 *   systemctl --user stop jemma         — Stop service
 *   systemctl --user disable jemma      — Disable on login
 *   journalctl --user -u jemma -n 50    — View last 50 log lines
 */

import WebSocket from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import { ensureSingleInstance } from './lib/pid-guard';
import { ensureChannelWebhooks } from './services/discord';
import { getPersonas, getPersona, getAgentPersonas, getMentionPatterns, getDeliveryConfig, type Persona } from './services/village.js';

// Allow self-signed TLS cert for localhost server connection
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ── Configuration ─────────────────────────────────────────────────

const HOME = process.env.HOME || '/home/darron';
const HAN_DIR = path.join(HOME, '.han');
const CONFIG_PATH = path.join(HAN_DIR, 'config.json');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const DOWNLOADS_DIR = path.join(HAN_DIR, 'downloads', 'discord');
const HEALTH_FILE = path.join(HEALTH_DIR, 'jemma-health.json');
const LAST_SEEN_FILE = path.join(HEALTH_DIR, 'jemma-last-seen.json');

const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';

const SERVER_URL = 'https://localhost:3847';
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_JITTER_MS = 1000; // 1s jitter on heartbeat interval

interface Config {
  discord?: {
    bot_token?: string;
    server_id?: string;
    channels?: Record<string, string>;
    webhooks?: Record<string, string>;
    username_map?: Record<string, string>;
    primaryPersonas?: string[];  // If set, only handle messages for these recipients
  };
  sevn?: {
    wake_endpoint?: string;
    wake_bearer_token?: string;
  };
  six?: {
    wake_endpoint?: string;
    wake_bearer_token?: string;
  };
  ntfy_topic?: string;
}

interface GatewayMessage {
  op: number;
  t?: string;
  s?: number;
  d?: any;
}

interface ClassificationResult {
  recipient: string; // 'jim' | 'leo' | 'darron' | 'sevn' | 'six' | 'ignore'
  confidence: number;
  reasoning: string;
}

// ── State ─────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatInterval: number = 0;
let lastSequence: number | null = null;
let sessionId: string | null = null;
let lastGatewayEventTimestamp: number | null = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelays = [1000, 2000, 4000, 8000, 30000]; // exponential backoff
const startedAt = Date.now();

// Track last seen message ID per channel for reconciliation
const lastSeenMessageId: Record<string, string> = {};

// Track processed message IDs to avoid re-classification (rolling window)
const processedMessageIds = new Set<string>();
const MAX_PROCESSED_IDS = 500;

// Track recent messages for admin UI
const recentMessages: Array<{
  timestamp: string;
  author: string;
  channel: string;
  message: string;
  recipient: string;
  confidence: number;
}> = [];

// Track remote agent health (tailnet-aware delivery)
const remoteAgentStatus: Record<string, { online: boolean; lastChecked: number; lastOnline: number }> = {};
const REMOTE_HEALTH_INTERVAL_MS = 60_000; // check every 60s
const PENDING_MESSAGES_DIR = path.join(HAN_DIR, 'health', 'jemma-pending');

// Track delivery statistics
const deliveryStats: Record<string, number> = {
  jim: 0,
  leo: 0,
  darron: 0,
  sevn: 0,
  six: 0,
  ignored: 0,
};

// ── Utilities ─────────────────────────────────────────────────────

function loadConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.error('[Jemma] Failed to load config');
    return {};
  }
}

function ensureDirectories(): void {
  for (const dir of [SIGNALS_DIR, HEALTH_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function loadLastSeen(): void {
  try {
    if (fs.existsSync(LAST_SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(LAST_SEEN_FILE, 'utf-8'));
      Object.assign(lastSeenMessageId, data);
      console.log(`[Jemma] Loaded lastSeenMessageId for ${Object.keys(data).length} channels`);
    }
  } catch (err) {
    console.warn('[Jemma] Failed to load lastSeenMessageId:', (err as Error).message);
  }
}

function saveLastSeen(): void {
  try {
    fs.writeFileSync(LAST_SEEN_FILE, JSON.stringify(lastSeenMessageId, null, 2));
  } catch (err) {
    console.warn('[Jemma] Failed to save lastSeenMessageId:', (err as Error).message);
  }
}

function writeHealthFile(status: 'ok' | 'error', lastError?: string): void {
  try {
    const health = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      lastGatewayEvent: lastGatewayEventTimestamp
        ? new Date(lastGatewayEventTimestamp).toISOString()
        : null,
      status,
      lastError: lastError || null,
      uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
      gatewayConnected: ws !== null && ws.readyState === WebSocket.OPEN,
    };
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2));
  } catch (err) {
    console.error('[Jemma] Failed to write health file:', (err as Error).message);
  }
}

function updateMessageLog(message: any, recipient: string, confidence: number): void {
  try {
    const attachmentCount = message.attachments?.length || 0;
    recentMessages.unshift({
      timestamp: new Date().toISOString(),
      author: message.author.username,
      channel: message.channel_id,
      message: message.content || '',
      attachments: attachmentCount > 0 ? message.attachments.map((a: any) => a.filename) : undefined,
      recipient,
      confidence,
    });

    // Keep only last 100 messages
    if (recentMessages.length > 100) {
      recentMessages.pop();
    }

    // Write to file for persistence
    const messagesFile = path.join(HEALTH_DIR, 'jemma-messages.json');
    fs.writeFileSync(messagesFile, JSON.stringify({ recent: recentMessages }, null, 2));
  } catch (err) {
    console.error('[Jemma] Failed to update message log:', (err as Error).message);
  }
}

function updateDeliveryStats(recipient: string): void {
  try {
    if (recipient in deliveryStats) {
      deliveryStats[recipient]++;
    }

    // Write to file for persistence
    const statsFile = path.join(HEALTH_DIR, 'jemma-stats.json');
    fs.writeFileSync(statsFile, JSON.stringify({ delivery_stats: deliveryStats }, null, 2));
  } catch (err) {
    console.error('[Jemma] Failed to update delivery stats:', (err as Error).message);
  }
}

// ── Attachment handling ──────────────────────────────────────────

interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  content_type?: string;
}

/**
 * Format attachment metadata into a text summary for inclusion in messages.
 * Returns empty string if no attachments.
 */
function formatAttachments(attachments: DiscordAttachment[]): string {
  if (!attachments || attachments.length === 0) return '';
  const lines = attachments.map(a => {
    const sizeKB = Math.round(a.size / 1024);
    const type = a.content_type || 'unknown type';
    return `  - ${a.filename} (${type}, ${sizeKB}KB)`;
  });
  return '\n[Attachments]\n' + lines.join('\n');
}

/**
 * Download attachments from Discord CDN to ~/.han/downloads/discord/.
 * Returns array of local file paths for successfully downloaded files.
 */
async function downloadAttachments(attachments: DiscordAttachment[], channelName: string): Promise<string[]> {
  if (!attachments || attachments.length === 0) return [];

  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  const downloaded: string[] = [];

  for (const att of attachments) {
    try {
      // Sanitise filename — prefix with channel and date for uniqueness
      const date = new Date().toISOString().split('T')[0];
      const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const localName = `${date}_${channelName}_${safeName}`;
      const localPath = path.join(DOWNLOADS_DIR, localName);

      // Skip if already downloaded (idempotent)
      if (fs.existsSync(localPath)) {
        downloaded.push(localPath);
        continue;
      }

      const res = await fetch(att.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        console.warn(`[Jemma] Failed to download ${att.filename}: HTTP ${res.status}`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(localPath, buffer);
      downloaded.push(localPath);
      console.log(`[Jemma] Downloaded attachment: ${att.filename} → ${localPath} (${Math.round(buffer.length / 1024)}KB)`);
    } catch (err) {
      console.warn(`[Jemma] Failed to download ${att.filename}:`, (err as Error).message);
    }
  }

  return downloaded;
}

function resolveChannelName(channelId: string): string {
  const config = loadConfig();
  const idToName = Object.entries(config.discord?.channels || {}).reduce(
    (acc, [name, id]) => ({ ...acc, [id as string]: name }),
    {} as Record<string, string>
  );
  return idToName[channelId] || channelId;
}

function buildClassificationPrompt(message: any): string {
  const config = loadConfig();
  const channelName = resolveChannelName(message.channel_id);
  const channelDisplay = channelName !== message.channel_id
    ? `#${channelName} (${message.channel_id})`
    : message.channel_id;

  const realName = config.discord?.username_map?.[message.author.username];
  const authorDisplay = realName
    ? `${realName} (@${message.author.username})`
    : message.author.username;

  const attachmentInfo = formatAttachments(message.attachments || []);

  // Build recipient list and rules dynamically from persona registry
  const personas = getPersonas();
  const recipientNames = personas.map(p => p.name).join('|') + '|ignore';
  const rules = personas
    .filter(p => p.classification_hint)
    .map(p => `- ${p.display_name}: ${p.classification_hint}`)
    .join('\n');
  const agentChannelNames = personas.filter(p => p.kind === 'agent').map(p => p.name).join(', ');

  return `Classify this Discord message and determine the recipient.

Message Content: "${message.content}"${attachmentInfo}
Author: ${authorDisplay}${message.author.bot ? ' (BOT)' : ''}
Channel: ${channelDisplay}

Respond with JSON only:
{
  "recipient": "${recipientNames}",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Rules:
- Ignore: bot messages, empty messages
${rules}
- Channel defaults: messages in an agent's named channel (e.g. #${agentChannelNames.split(', ').slice(0, 3).join(', #')}) default to that agent — unless another recipient is explicitly mentioned by name
- Real names are provided in the Author field — use them for better context when classifying`;
}

async function classifyWithHaikuSDK(prompt: string): Promise<ClassificationResult> {
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  const q = agentQuery({
    prompt,
    options: {
      model: 'claude-haiku-4-5-20251001',
      maxTurns: 1,
      cwd: HAN_DIR,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env: cleanEnv,
      persistSession: false,
      tools: [],
    },
  });

  let resultText = '';
  for await (const event of q) {
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text') resultText += block.text;
      }
    }
  }

  const text = resultText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const result = JSON.parse(text);
  return {
    recipient: result.recipient || 'ignore',
    confidence: result.confidence || 0,
    reasoning: result.reasoning || 'Classification uncertain',
  };
}

async function classifyWithOllama(prompt: string): Promise<ClassificationResult> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: 'json',
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}`);

  const data = await res.json();
  const result = JSON.parse(data.response);
  return {
    recipient: result.recipient || 'ignore',
    confidence: result.confidence || 0,
    reasoning: result.reasoning || 'Classification uncertain',
  };
}

async function callLLMForClassification(message: any): Promise<ClassificationResult> {
  const prompt = buildClassificationPrompt(message);

  // Try Haiku via Agent SDK first, fall back to local Gemma (Ollama)
  try {
    const result = await classifyWithHaikuSDK(prompt);
    console.log('[Jemma] Classified via Haiku SDK');
    return result;
  } catch (err) {
    console.warn('[Jemma] Haiku SDK classification failed:', (err as Error).message);
  }

  try {
    const result = await classifyWithOllama(prompt);
    console.log('[Jemma] Classified via Ollama (fallback)');
    return result;
  } catch (err) {
    console.warn('[Jemma] Ollama classification failed:', (err as Error).message);
    return {
      recipient: 'ignore',
      confidence: 0,
      reasoning: 'All classification backends failed — defaulting to ignore',
    };
  }
}

async function deliverToJim(message: any, classification: ClassificationResult, channelName: string): Promise<void> {
  try {
    const payload = {
      recipient: 'jim',
      message: message._enrichedContent || message.content,
      channel: message.channel_id,
      channelName,
      author: message.author.username,
      classification_confidence: classification.confidence,
    };

    const res = await fetch(`${SERVER_URL}/api/jemma/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    console.log(`[Jemma] Delivered to Jim (#${channelName} — ${message.author.username}: ${(message.content || '').slice(0, 40)}...)`);
  } catch (err) {
    console.warn('[Jemma] Failed to deliver to Jim via server, writing signal file');
    try {
      const signalData = JSON.stringify({
        source: 'discord',
        recipient: 'jim',
        channelId: message.channel_id,
        channelName,
        author: message.author.username,
        content: message._enrichedContent || message.content,
        timestamp: message.timestamp,
      });
      fs.writeFileSync(path.join(SIGNALS_DIR, 'jim-wake'), signalData);
      fs.writeFileSync(path.join(SIGNALS_DIR, 'jim-human-wake'), signalData);
    } catch (fileErr) {
      console.error('[Jemma] Failed to write Jim signal files:', (fileErr as Error).message);
    }
  }
}

async function deliverToLeo(message: any, classification: ClassificationResult, channelName: string): Promise<void> {
  try {
    const enrichedContent = message._enrichedContent || message.content;
    const signalData = JSON.stringify({
      source: 'discord',
      recipient: 'leo',
      channelId: message.channel_id,
      channelName,
      author: message.author.username,
      mentionedAt: message.timestamp,
      messagePreview: enrichedContent.slice(0, 500),
    });

    fs.writeFileSync(path.join(SIGNALS_DIR, 'leo-wake'), signalData);
    fs.writeFileSync(path.join(SIGNALS_DIR, 'leo-human-wake'), signalData);

    console.log(`[Jemma] Woke Leo (#${channelName} — ${message.author.username}: ${(message.content || '').slice(0, 40)}...)`);
  } catch (err) {
    console.error('[Jemma] Failed to write Leo signal files:', (err as Error).message);
  }
}

function deliverToDarron(message: any, classification: ClassificationResult, channelName: string): void {
  try {
    const config = loadConfig();
    if (!config.ntfy_topic) return;

    const contentPreview = (message._enrichedContent || message.content || '').slice(0, 100);
    const ntfyMsg = `#${channelName} — ${message.author.username}: ${contentPreview}`;
    execFileSync('curl', [
      '-s',
      '-d', ntfyMsg,
      '-H', 'Title: Discord Message',
      `https://ntfy.sh/${config.ntfy_topic}`
    ], {
      timeout: 5000,
      stdio: 'ignore'
    });

    console.log(`[Jemma] Notified Darron (#${channelName} — ${message.author.username})`);
  } catch (err) {
    console.warn('[Jemma] Failed to notify Darron:', (err as Error).message);
  }
}

// ── Tailnet-Aware Remote Delivery ─────────────────────────────────

async function probeRemoteAgent(agentName: string): Promise<boolean> {
  const config = loadConfig();
  const agentConfig = (config as any)[agentName];
  const endpoint = agentConfig?.wake_endpoint;
  if (!endpoint) return false;

  try {
    // Probe the base URL (strip the path, just check if the host responds)
    const url = new URL(endpoint);
    const healthUrl = `${url.protocol}//${url.host}/api/supervisor/status`;
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkRemoteAgents(): Promise<void> {
  const remoteAgents = getPersonas().filter(p => p.delivery === 'remote').map(p => p.name);
  for (const agent of remoteAgents) {
    const wasOnline = remoteAgentStatus[agent]?.online ?? false;
    const online = await probeRemoteAgent(agent);
    remoteAgentStatus[agent] = {
      online,
      lastChecked: Date.now(),
      lastOnline: online ? Date.now() : (remoteAgentStatus[agent]?.lastOnline ?? 0),
    };

    if (online && !wasOnline) {
      console.log(`[Jemma] ${agent} came online — draining pending messages`);
      await drainPendingMessages(agent);
    } else if (!online && wasOnline) {
      console.log(`[Jemma] ${agent} went offline — messages will be queued`);
    }
  }
}

function queuePendingMessage(agent: string, message: any, classification: ClassificationResult, channelName: string): void {
  try {
    fs.mkdirSync(PENDING_MESSAGES_DIR, { recursive: true });
    const filename = `${agent}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const data = {
      agent,
      channelName,
      author: message.author.username,
      content: message._enrichedContent || message.content,
      timestamp: message.timestamp,
      confidence: classification.confidence,
      queuedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(PENDING_MESSAGES_DIR, filename), JSON.stringify(data));
    console.log(`[Jemma] Queued message for ${agent} (offline): ${filename}`);
  } catch (err) {
    console.error(`[Jemma] Failed to queue message for ${agent}:`, (err as Error).message);
  }
}

async function drainPendingMessages(agent: string): Promise<void> {
  try {
    if (!fs.existsSync(PENDING_MESSAGES_DIR)) return;
    const files = fs.readdirSync(PENDING_MESSAGES_DIR)
      .filter(f => f.startsWith(`${agent}-`) && f.endsWith('.json'))
      .sort(); // chronological by timestamp in filename

    if (files.length === 0) return;

    console.log(`[Jemma] Draining ${files.length} pending messages for ${agent}`);
    const config = loadConfig();
    const agentConfig = (config as any)[agent];
    const endpoint = agentConfig?.wake_endpoint;
    const token = agentConfig?.wake_bearer_token;

    if (!endpoint || !token) return;

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(PENDING_MESSAGES_DIR, file), 'utf-8'));
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: `Discord #${data.channelName}: ${data.author} — ${data.content}`,
            mode: 'now',
            channelName: data.channelName,
            queuedAt: data.queuedAt,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          fs.unlinkSync(path.join(PENDING_MESSAGES_DIR, file));
          console.log(`[Jemma] Delivered queued message to ${agent}: ${file}`);
        } else {
          console.warn(`[Jemma] Failed to deliver queued message to ${agent}: ${res.status}`);
          break; // stop draining if delivery fails — agent may have gone offline again
        }
      } catch (err) {
        console.warn(`[Jemma] Error draining ${file}:`, (err as Error).message);
        break;
      }
    }
  } catch (err) {
    console.error(`[Jemma] Failed to drain pending messages for ${agent}:`, (err as Error).message);
  }
}

async function deliverToRemoteAgent(agent: string, message: any, classification: ClassificationResult, channelName: string): Promise<void> {
  const config = loadConfig();
  const agentConfig = (config as any)[agent];
  const endpoint = agentConfig?.wake_endpoint;
  const token = agentConfig?.wake_bearer_token;

  if (!endpoint || !token) {
    console.warn(`[Jemma] ${agent} endpoint or token not configured`);
    return;
  }

  // Check if agent is online (use cached status, probe runs on interval)
  const status = remoteAgentStatus[agent];
  if (status && !status.online) {
    queuePendingMessage(agent, message, classification, channelName);
    return;
  }

  // Attempt delivery
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: `Discord #${channelName}: ${message.author.username} — ${message._enrichedContent || message.content}`,
        mode: 'now',
        channelName,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`${agent} returned ${res.status}`);
    }

    console.log(`[Jemma] Routed to ${agent} (#${channelName} — ${message.author.username})`);
  } catch (err) {
    console.warn(`[Jemma] Failed to route to ${agent} (${(err as Error).message}) — queueing`);
    // Mark as offline and queue
    remoteAgentStatus[agent] = {
      online: false,
      lastChecked: Date.now(),
      lastOnline: remoteAgentStatus[agent]?.lastOnline ?? 0,
    };
    queuePendingMessage(agent, message, classification, channelName);
  }
}

async function deliverToSevn(message: any, classification: ClassificationResult, channelName: string): Promise<void> {
  await deliverToRemoteAgent('sevn', message, classification, channelName);
}

async function deliverToSix(message: any, classification: ClassificationResult, channelName: string): Promise<void> {
  await deliverToRemoteAgent('six', message, classification, channelName);
}

/**
 * Generic persona delivery — routes based on persona.delivery type from the registry.
 * Replaces the per-agent deliverToX functions for routing decisions.
 * The specific deliverToX functions remain as implementation helpers.
 */
async function deliverToPersona(persona: Persona, message: any, classification: ClassificationResult, channelName: string): Promise<void> {
  switch (persona.delivery) {
    case 'signal': {
      const config = getDeliveryConfig(persona);
      const signals: string[] = config.wake_signals || [`${persona.name}-wake`, `${persona.name}-human-wake`];
      const signalData = JSON.stringify({
        source: 'discord',
        recipient: persona.name,
        channelId: message.channel_id,
        channelName,
        author: message.author.username,
        mentionedAt: message.timestamp,
        messagePreview: (message._enrichedContent || message.content || '').slice(0, 500),
      });
      for (const signal of signals) {
        try {
          fs.writeFileSync(path.join(SIGNALS_DIR, signal), signalData);
        } catch (err) {
          console.error(`[Jemma] Failed to write signal ${signal}:`, (err as Error).message);
        }
      }
      console.log(`[Jemma] Woke ${persona.display_name} via signal (#${channelName} — ${message.author.username}: ${(message.content || '').slice(0, 40)}...)`);
      break;
    }
    case 'http_local': {
      // Try HTTP first (like deliverToJim), fall back to signal files
      try {
        const delivConfig = getDeliveryConfig(persona);
        const serverUrl = delivConfig.server_url || SERVER_URL;
        const payload = {
          recipient: persona.name,
          message: message._enrichedContent || message.content,
          channel: message.channel_id,
          channelName,
          author: message.author.username,
          classification_confidence: classification.confidence,
        };
        const res = await fetch(`${serverUrl}/api/jemma/deliver`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        console.log(`[Jemma] Delivered to ${persona.display_name} via HTTP (#${channelName} — ${message.author.username}: ${(message.content || '').slice(0, 40)}...)`);
      } catch {
        // Fallback to signal files
        const fallbackSignals: string[] = getDeliveryConfig(persona).fallback_signals || [`${persona.name}-wake`, `${persona.name}-human-wake`];
        const signalData = JSON.stringify({
          source: 'discord',
          recipient: persona.name,
          channelId: message.channel_id,
          channelName,
          author: message.author.username,
          content: message._enrichedContent || message.content,
          timestamp: message.timestamp,
        });
        for (const signal of fallbackSignals) {
          try {
            fs.writeFileSync(path.join(SIGNALS_DIR, signal), signalData);
          } catch (err) {
            console.error(`[Jemma] Failed to write fallback signal ${signal}:`, (err as Error).message);
          }
        }
        console.warn(`[Jemma] HTTP delivery to ${persona.display_name} failed, wrote signal files`);
      }
      break;
    }
    case 'remote': {
      await deliverToRemoteAgent(persona.name, message, classification, channelName);
      break;
    }
    case 'ntfy': {
      deliverToDarron(message, classification, channelName);
      break;
    }
    case 'none':
    default:
      // Gateways and undeliverable personas — log only
      console.log(`[Jemma] No delivery mechanism for ${persona.display_name} (${persona.delivery})`);
      break;
  }
}

async function routeMessage(message: any): Promise<void> {
  // Ignore own messages
  if (message.author.bot) {
    return;
  }

  // Ignore empty messages (but not attachment-only messages)
  const hasAttachments = message.attachments && message.attachments.length > 0;
  if ((!message.content || message.content.trim().length === 0) && !hasAttachments) {
    return;
  }

  // Skip already-processed messages
  if (processedMessageIds.has(message.id)) {
    return;
  }

  // Track this message as processed (rolling window)
  processedMessageIds.add(message.id);
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const oldest = processedMessageIds.values().next().value;
    if (oldest) processedMessageIds.delete(oldest);
  }

  // Auto-provision channel mapping + webhooks for unknown channels on first message
  await ensureChannelWebhooks(message.channel_id);

  const classification = await callLLMForClassification(message);
  const channelName = resolveChannelName(message.channel_id);
  const recipient = classification.recipient.toLowerCase();
  console.log(`[Jemma] Routed to ${recipient} (confidence: ${classification.confidence}, reason: ${classification.reasoning})`);

  // Primary persona filtering — if configured, only handle messages for our personas.
  // This prevents contention when multiple Jemma instances share the same Discord server.
  // han-Jemma handles jim/leo/tenshi/darron, mikes-han-Jemma handles six/sevn/casey.
  const config = loadConfig();
  const primaryPersonas: string[] | undefined = config.discord?.primaryPersonas;
  if (primaryPersonas && !primaryPersonas.includes(recipient)) {
    console.log(`[Jemma] ${recipient} not in primaryPersonas [${primaryPersonas.join(',')}] — skipping`);
    return;
  }

  // Download attachments and enrich message content
  const attachments: DiscordAttachment[] = message.attachments || [];
  let downloadedPaths: string[] = [];
  if (attachments.length > 0) {
    downloadedPaths = await downloadAttachments(attachments, channelName);
    // Append attachment info to message content so agents see it
    const attachmentSuffix = formatAttachments(attachments);
    const pathInfo = downloadedPaths.length > 0
      ? '\n[Downloaded to]\n' + downloadedPaths.map(p => `  - ${p}`).join('\n')
      : '';
    message._enrichedContent = (message.content || '') + attachmentSuffix + pathInfo;
  } else {
    message._enrichedContent = message.content || '';
  }

  // Update tracking
  updateMessageLog(message, recipient, classification.confidence);
  updateDeliveryStats(recipient);

  // Determine channel owner — messages in named agent channels always notify that agent
  // Dynamic: channel name matches any registered agent persona
  const agentPersonas = getAgentPersonas();
  const agentNames = agentPersonas.map(p => p.name);
  const channelOwner = agentNames.includes(channelName) ? channelName : null;

  // Primary delivery — route to the classified recipient via persona registry
  const recipientPersona = getPersona(recipient);
  if (recipientPersona && recipientPersona.active && recipient !== 'ignore') {
    await deliverToPersona(recipientPersona, message, classification, channelName);
  }

  // If the message is in an agent's channel but was routed elsewhere, also notify the channel owner
  if (channelOwner && channelOwner !== recipient) {
    const ownerPersona = getPersona(channelOwner);
    if (ownerPersona && ownerPersona.active) {
      console.log(`[Jemma] Also notifying channel owner ${channelOwner} (message in #${channelName}, routed to ${recipient})`);
      await deliverToPersona(ownerPersona, message, classification, channelName);
    }
  }

  // If the message mentions an agent by name, wake them too.
  // Darron often addresses multiple agents in one message — "Leo do X, Jim what do you think?"
  const content = (message.content || '').toLowerCase();
  const alreadyNotified = new Set([recipient, channelOwner].filter(Boolean));

  for (const persona of agentPersonas) {
    if (alreadyNotified.has(persona.name)) continue;

    const patterns = getMentionPatterns(persona);
    if (patterns.length === 0) continue;

    const mentioned = patterns.some(pattern => {
      try {
        return new RegExp(pattern, 'i').test(content);
      } catch { return false; }
    });

    if (mentioned) {
      console.log(`[Jemma] Message also mentions ${persona.display_name} — waking`);
      await deliverToPersona(persona, message, classification, channelName);
      alreadyNotified.add(persona.name);
    }
  }
}

async function reconcileMessages(): Promise<void> {
  const config = loadConfig();
  const channels = config.discord?.channels || {};

  console.log('[Jemma] Running reconciliation poll...');

  for (const [name, channelId] of Object.entries(channels)) {
    try {
      const afterId = lastSeenMessageId[channelId] || '0';
      const url = `https://discord.com/api/v10/channels/${channelId}/messages?after=${afterId}&limit=100`;

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bot ${config.discord?.bot_token}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        console.warn(`[Jemma] Failed to fetch messages from ${name}: ${res.status}`);
        continue;
      }

      const messages: any[] = await res.json();
      if (messages.length > 0) {
        // Update last seen ID (messages[0] is newest, Discord returns reverse chronological)
        lastSeenMessageId[channelId] = messages[0].id;
        saveLastSeen();

        // Only route messages we haven't already processed (routeMessage handles dedup)
        let newCount = 0;
        for (const msg of messages) {
          if (!processedMessageIds.has(msg.id)) {
            await routeMessage(msg);
            newCount++;
          }
        }

        if (newCount > 0) {
          console.log(`[Jemma] Reconciliation: ${newCount} new messages from #${name}`);
        }
      }
    } catch (err) {
      console.warn(`[Jemma] Reconciliation error for #${name}:`, (err as Error).message);
    }
  }
  console.log('[Jemma] Reconciliation complete');
  writeHealthFile('ok');
}

// ── Discord Gateway Protocol ──────────────────────────────────────

function sendHeartbeat(): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload: GatewayMessage = {
      op: 1, // Heartbeat opcode
      d: lastSequence,
    };
    ws.send(JSON.stringify(payload));
  }
}

function startHeartbeat(interval: number): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  heartbeatInterval = interval;
  sendHeartbeat(); // Send immediately
  heartbeatTimer = setInterval(sendHeartbeat, interval - HEARTBEAT_JITTER_MS);
  console.log(`[Jemma] Heartbeat started (interval: ${interval}ms)`);
}

function sendIdentify(): void {
  const config = loadConfig();
  const payload: GatewayMessage = {
    op: 2, // Identify opcode
    d: {
      token: config.discord?.bot_token,
      intents: (1 << 15) | (1 << 9) | (1 << 0), // MESSAGE_CONTENT | GUILD_MESSAGES | GUILDS
      properties: {
        os: 'linux',
        browser: 'jemma',
        device: 'jemma',
      },
    },
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    console.log('[Jemma] IDENTIFY sent');
  }
}

function sendResume(): void {
  const config = loadConfig();
  const payload: GatewayMessage = {
    op: 6, // Resume opcode
    d: {
      token: config.discord?.bot_token,
      session_id: sessionId,
      seq: lastSequence,
    },
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    console.log('[Jemma] RESUME sent');
  }
}

async function handleGatewayMessage(data: GatewayMessage): Promise<void> {
  // Debug: log all gateway events
  if (data.op === 0) {
    console.log(`[Jemma] DISPATCH event: ${data.t} (seq: ${data.s})`);
  } else if (data.op !== 11) { // Don't log heartbeat ACKs
    console.log(`[Jemma] Gateway op: ${data.op}`);
  }

  // Update sequence number
  if (data.s !== null && data.s !== undefined) {
    lastSequence = data.s;
  }

  switch (data.op) {
    case 10: // Hello
      {
        const helloData = data.d || {};
        const interval = helloData.heartbeat_interval || 45000;
        console.log(`[Jemma] HELLO received (heartbeat interval: ${interval}ms)`);
        startHeartbeat(interval);
        sendIdentify();
      }
      break;

    case 0: // Dispatch
      {
        lastGatewayEventTimestamp = Date.now();

        if (data.t === 'READY') {
          sessionId = data.d?.session_id;
          console.log(`[Jemma] READY received, session: ${sessionId?.slice(0, 8)}...`);
          writeHealthFile('ok');
        } else if (data.t === 'MESSAGE_CREATE') {
          const message = data.d;
          console.log(
            `[Jemma] MESSAGE from @${message.author.username} in #${message.channel_id}: ${(message.content || '').slice(0, 50)}${message.attachments?.length ? ` [+${message.attachments.length} attachment(s)]` : ''}...`
          );
          await routeMessage(message);
          writeHealthFile('ok');
        }
      }
      break;

    case 9: // Invalid Session
      {
        const canResume = data.d !== false;
        console.log(`[Jemma] INVALID_SESSION (resumable: ${canResume})`);
        if (!canResume) {
          sessionId = null;
          lastSequence = null;
          console.log('[Jemma] Resumable flag false, will IDENTIFY on reconnect');
        }
        // Close and reconnect
        if (ws) ws.close(1000);
      }
      break;

    case 11: // Heartbeat ACK
      // Expected response to heartbeat
      break;

    default:
      // Ignore other opcodes
      break;
  }
}

function connect(): void {
  if (ws) {
    ws.removeAllListeners();
    ws.close();
  }

  console.log(`[Jemma] Connecting to Discord Gateway... (attempt ${reconnectAttempts + 1})`);

  ws = new WebSocket(DISCORD_GATEWAY);

  ws.on('open', () => {
    console.log('[Jemma] WebSocket connected');
    reconnectAttempts = 0;
  });

  ws.on('message', async (data: Buffer) => {
    try {
      const message: GatewayMessage = JSON.parse(data.toString());
      await handleGatewayMessage(message);
    } catch (err) {
      console.error('[Jemma] Failed to handle gateway message:', (err as Error).message);
    }
  });

  ws.on('error', (err) => {
    console.error('[Jemma] WebSocket error:', err.message);
    writeHealthFile('error', err.message);
  });

  ws.on('close', (code: number, reason: string) => {
    console.log(`[Jemma] WebSocket closed (code: ${code}, reason: ${reason})`);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Fatal Discord close codes — retrying will never succeed
    const fatalCodes: Record<number, string> = {
      4004: 'Authentication failed (invalid token)',
      4010: 'Invalid shard',
      4011: 'Sharding required',
      4012: 'Invalid API version',
      4013: 'Invalid intents',
      4014: 'Disallowed intent (enable in Developer Portal)',
    };

    if (fatalCodes[code]) {
      console.error(`[Jemma] FATAL: ${fatalCodes[code]} (code ${code}). Will not reconnect.`);
      writeHealthFile('error', `Fatal Discord error: ${fatalCodes[code]} (code ${code})`);
      process.exit(1);  // Let systemd restart — but the fix is in the Developer Portal, not code
    }

    // Non-fatal: reconnect with exponential backoff
    if (reconnectAttempts < maxReconnectAttempts) {
      // Reset session state on codes that invalidate the session
      if (code === 4007 || code === 4009) {
        sessionId = null;
        lastSequence = null;
        console.log(`[Jemma] Session invalidated (code ${code}), will IDENTIFY on reconnect`);
      }

      const delay = reconnectDelays[Math.min(reconnectAttempts, reconnectDelays.length - 1)];
      console.log(`[Jemma] Reconnecting in ${delay}ms...`);
      setTimeout(connect, delay);
      reconnectAttempts++;
    } else {
      console.error('[Jemma] Max reconnection attempts exceeded');
      writeHealthFile('error', 'Max reconnection attempts exceeded');
      process.exit(1);  // Let systemd restart fresh
    }
  });
}

// ── Admin UI WebSocket Client ─────────────────────────────────────
// Connects to Hortus Arbor Nostra server's WebSocket, listens for human messages
// in admin UI conversations, classifies, and writes appropriate signals.
// Same dispatch pattern as Discord — Jemma is the single dispatcher.

let adminWs: WebSocket | null = null;
let adminReconnectTimer: NodeJS.Timeout | null = null;

function dispatchAdminMessage(
  _recipient: string,
  conversationId: string,
  messageId: string,
  content: string,
  timestamp: string,
  discussionType: string | null
): void {
  const localAgents = getPersonas().filter(p => p.kind === 'agent' && p.is_local && p.active);
  const contentLower = (content || '').toLowerCase();

  // Determine which persona "owns" this discussion type (e.g. 'jim-request' → jim)
  let tabOwner: string | null = null;
  if (discussionType) {
    const ownerPersona = localAgents.find(p => {
      const tabs = getMentionPatterns(p); // reuse for tab prefix matching
      return discussionType.startsWith(p.name + '-');
    });
    tabOwner = ownerPersona?.name || null;

    // Also check human personas (darron-thought, mike-thought → wake all agents)
    const humanPersonas = getPersonas().filter(p => p.kind === 'human' && p.active);
    const isHumanTab = humanPersonas.some(p => discussionType.startsWith(p.name + '-'));
    if (isHumanTab) tabOwner = null; // null = wake all (same as general)
  }

  for (const persona of localAgents) {
    // Tab owner → that agent only. Name mention → that agent. General/untyped → all local agents.
    const isTabOwner = tabOwner === persona.name;
    const patterns = getMentionPatterns(persona);
    const isMentioned = patterns.some(pat => {
      try { return new RegExp(pat, 'i').test(contentLower); }
      catch { return false; }
    });
    // Also check simple @name and "hey name" patterns
    const simpleMatch = new RegExp(`\\b(hey\\s+${persona.name}|@${persona.name}|${persona.name}[,:])\\b`, 'i').test(content);

    const shouldWake = isTabOwner || isMentioned || simpleMatch || tabOwner === null;
    if (!shouldWake) continue;

    const delivConfig = getDeliveryConfig(persona);
    const signals: string[] = delivConfig.wake_signals || delivConfig.fallback_signals || [`${persona.name}-wake`, `${persona.name}-human-wake`];

    const signalData = JSON.stringify({
      source: 'admin',
      conversationId,
      messageId,
      mentionedAt: timestamp,
      messagePreview: content.slice(0, 200),
      reason: 'admin_ui_dispatch',
    });

    for (const signal of signals) {
      try {
        fs.writeFileSync(path.join(SIGNALS_DIR, signal), signalData);
      } catch (err) {
        console.error(`[Jemma] Failed to write admin signal ${signal}:`, (err as Error).message);
      }
    }
    console.log(`[Jemma] Admin dispatch → ${persona.display_name} (${discussionType || 'general'}: ${content.slice(0, 40)})`);
  }
}

function connectAdminWs(): void {
  if (adminWs) {
    adminWs.removeAllListeners();
    adminWs.close();
  }

  const wsUrl = SERVER_URL.replace('https://', 'wss://') + '/ws';
  adminWs = new WebSocket(wsUrl);

  adminWs.on('open', () => {
    console.log('[Jemma] Admin WebSocket connected');
  });

  adminWs.on('ping', () => {
    adminWs?.pong();
  });

  adminWs.on('message', (data: Buffer) => {
    try {
      const event = JSON.parse(data.toString());
      console.log(`[Jemma] Admin WS event: ${event.type}`);
      // NOTE: Admin conversation messages are dispatched by conversations.ts directly
      // via classifyAndDispatch(). Jemma does NOT re-dispatch them — that caused
      // duplicate agent responses (two signals written for the same message). S127 fix.
    } catch (err) {
      console.error('[Jemma] Admin WS message error:', (err as Error).message);
    }
  });

  adminWs.on('error', (err) => {
    // Silent — reconnect handles it
  });

  adminWs.on('close', () => {
    // Reconnect after 5 seconds
    adminReconnectTimer = setTimeout(connectAdminWs, 5000);
  });
}

// ── Shutdown ──────────────────────────────────────────────────────

function handleShutdown(): void {
  console.log('[Jemma] Shutting down gracefully...');
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  if (ws) {
    ws.close(1000, 'Service shutdown');
  }
  if (adminWs) {
    adminWs.close(1000, 'Service shutdown');
  }
  if (adminReconnectTimer) {
    clearTimeout(adminReconnectTimer);
  }
  saveLastSeen();
  writeHealthFile('ok');
  // Exit with 143 (128 + 15 = SIGTERM) so systemd Restart=always knows this was
  // a signal death, not a clean "I'm done" exit. Same as main server.
  process.exit(143);
}

// ── Credential Swap (rate-limit failover) ─────────────────────────

const CREDENTIAL_SWAP_INTERVAL_MS = 30 * 1000; // 30 seconds
const CREDENTIAL_SWAP_LOG = path.join(HEALTH_DIR, 'credential-swaps.jsonl');

/**
 * Check for rate-limited signal and swap Claude credentials.
 * Only activates when 2+ credential files exist (.credentials-[a-z].json).
 * Pure Node.js — no LLM needed.
 */
function checkAndSwapCredentials(): void {
  const signalPath = path.join(SIGNALS_DIR, 'rate-limited');
  if (!fs.existsSync(signalPath)) return;

  // S131 DEC-077 — scheduled rotation pause for shared-account windows.
  // During a partner's firm window (e.g., Mike using the shared icloud
  // account Fri 06:00 → Sun 18:00), this machine's rotation-paused signal
  // is set by cron. While paused, rate-limit rotation is held off so we
  // don't drain the partner's tokens. The rate-limited signal is left in
  // place — the moment the pause lifts (partner's window ends), the next
  // 30-second poll swaps as intended.
  const pausePath = path.join(SIGNALS_DIR, 'rotation-paused');
  if (fs.existsSync(pausePath)) {
    console.log('[Jemma] Rate-limit signal received but rotation is paused — signal held until pause lifts');
    return;
  }

  const credDir = path.join(HOME, '.claude');
  const credPath = path.join(credDir, '.credentials.json');

  // Find all alternate credential files (.credentials-a.json, .credentials-b.json, etc.)
  let files: string[];
  try {
    files = fs.readdirSync(credDir)
      .filter(f => /^\.credentials-[a-z]\.json$/.test(f))
      .sort();
  } catch {
    return; // Can't read credential directory
  }

  // Safety: only swap when 2+ credential files exist
  if (files.length < 2) {
    // Remove stale signal — no backup to swap to
    try { fs.unlinkSync(signalPath); } catch { /* best effort */ }
    console.log('[Jemma] Rate-limited signal received but only 1 credential file — clearing signal');
    return;
  }

  // Read current live credentials
  let currentContent: string;
  try {
    currentContent = fs.readFileSync(credPath, 'utf-8');
  } catch {
    return; // Can't read live credentials
  }

  // Find which credential file matches current, pick next in round-robin
  const currentIndex = files.findIndex(f => {
    try {
      return fs.readFileSync(path.join(credDir, f), 'utf-8') === currentContent;
    } catch {
      return false;
    }
  });
  const nextIndex = (currentIndex + 1) % files.length;
  const nextFile = files[nextIndex];

  // Perform the swap
  try {
    const nextContent = fs.readFileSync(path.join(credDir, nextFile), 'utf-8');
    fs.writeFileSync(credPath, nextContent);
    fs.unlinkSync(signalPath);
  } catch (err) {
    console.error('[Jemma] Credential swap failed:', (err as Error).message);
    return;
  }

  // Log the swap for usage analytics
  const entry = {
    timestamp: new Date().toISOString(),
    from: currentIndex >= 0 ? files[currentIndex] : 'unknown',
    to: nextFile,
    accountCount: files.length,
  };
  try {
    fs.appendFileSync(CREDENTIAL_SWAP_LOG, JSON.stringify(entry) + '\n');
  } catch { /* best effort */ }

  console.log(`[Jemma] Swapped credentials: ${entry.from} → ${nextFile} (${files.length} accounts available)`);
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pidGuard = ensureSingleInstance('jemma');
  process.on('exit', () => pidGuard.cleanup());

  ensureDirectories();
  loadLastSeen();
  writeHealthFile('ok');

  console.log(`
╔════════════════════════════════════════════════════════╗
║       Jemma — Discord Message Dispatcher v1.0        ║
╠════════════════════════════════════════════════════════╣
║  Gateway:      ${DISCORD_GATEWAY}
║  Ollama:       ${OLLAMA_URL}
║  Model:        ${OLLAMA_MODEL}
║  Health file:  ${HEALTH_FILE}
║  Reconcile:    every 5 minutes
╠════════════════════════════════════════════════════════╣
║  Recipients:   Jim, Leo, Darron, Sevn, Six
║  Shutdown:     SIGTERM/SIGINT (graceful)
╚════════════════════════════════════════════════════════╝
`);

  // Warm up Gemma — preload model so first real classification isn't a cold start
  console.log('[Jemma] Warming up Gemma...');
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: 'Respond with just: {"recipient":"ignore","confidence":1.0,"reasoning":"warmup"}',
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(30000),
    });
    console.log('[Jemma] Gemma warm-up complete');
  } catch (err) {
    console.warn('[Jemma] Gemma warm-up failed:', (err as Error).message);
  }

  // Start Discord connection
  connect();

  // Start admin UI WebSocket client
  connectAdminWs();

  // Start reconciliation poll
  setInterval(reconcileMessages, RECONCILIATION_INTERVAL_MS);

  // Start remote agent health monitoring (tailnet-aware delivery)
  fs.mkdirSync(PENDING_MESSAGES_DIR, { recursive: true });
  checkRemoteAgents(); // initial probe
  setInterval(checkRemoteAgents, REMOTE_HEALTH_INTERVAL_MS);
  console.log('[Jemma] Remote agent health monitor active (60s interval)');

  // Warn if primaryPersonas not configured
  const cfg = loadConfig();
  if (!cfg.discord?.primaryPersonas) {
    console.warn('[Jemma] WARNING: discord.primaryPersonas not set — handling ALL recipients. Set this to prevent double-delivery with other Jemma instances.');
  }

  // Start credential swap watcher (rate-limit failover)
  setInterval(checkAndSwapCredentials, CREDENTIAL_SWAP_INTERVAL_MS);
  console.log('[Jemma] Credential swap watcher active (30s interval)');

  // Graceful shutdown
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  // Keep process alive
  await new Promise(() => {
    // Never resolves — process runs until shutdown signal
  });
}

main().catch((err) => {
  console.error('[Jemma] Fatal error:', err);
  writeHealthFile('error', err.message);
  process.exit(1);
});
