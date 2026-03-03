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
import { execSync } from 'node:child_process';

// ── Configuration ─────────────────────────────────────────────────

const HOME = process.env.HOME || '/home/darron';
const CLAUDE_REMOTE_DIR = path.join(HOME, '.claude-remote');
const CONFIG_PATH = path.join(CLAUDE_REMOTE_DIR, 'config.json');
const SIGNALS_DIR = path.join(CLAUDE_REMOTE_DIR, 'signals');
const HEALTH_DIR = path.join(CLAUDE_REMOTE_DIR, 'health');
const HEALTH_FILE = path.join(HEALTH_DIR, 'jemma-health.json');

const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';

const SERVER_URL = 'http://localhost:3847';
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_JITTER_MS = 1000; // 1s jitter on heartbeat interval

interface Config {
  discord?: {
    bot_token?: string;
    server_id?: string;
    channels?: Record<string, string>;
    webhooks?: Record<string, string>;
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

// Track recent messages for admin UI
const recentMessages: Array<{
  timestamp: string;
  author: string;
  channel: string;
  message: string;
  recipient: string;
  confidence: number;
}> = [];

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

function writeHealthFile(status: 'ok' | 'error', lastError?: string): void {
  try {
    const health = {
      pid: process.pid,
      lastBeat: new Date().toISOString(),
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
    recentMessages.unshift({
      timestamp: new Date().toISOString(),
      author: message.author.username,
      channel: message.channel_id,
      message: message.content,
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

async function callLLMForClassification(message: any): Promise<ClassificationResult> {
  try {
    const prompt = `Classify this Discord message and determine the recipient.

Message Content: "${message.content}"
Author: ${message.author.username}${message.author.bot ? ' (BOT)' : ''}
Channel: ${message.channel_id}

Respond with JSON only:
{
  "recipient": "jim|leo|darron|sevn|six|ignore",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Rules:
- Ignore: bot messages, empty messages
- Jim: direct mentions of Jim, technical/system topics
- Leo: direct mentions of Leo, code review/implementation
- Darron: direct mentions of Darron, or general discussion
- Sevn: mentions Sevn or team context
- Six: mentions Six or specific external work`;

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Ollama ${res.status}`);
    }

    const data = await res.json();
    const result = JSON.parse(data.response);
    return {
      recipient: result.recipient || 'ignore',
      confidence: result.confidence || 0,
      reasoning: result.reasoning || 'Classification uncertain',
    };
  } catch (err) {
    console.warn('[Jemma] Classification failed:', (err as Error).message);
    // Default to ignore on classification failure
    return {
      recipient: 'ignore',
      confidence: 0,
      reasoning: 'Classification error — defaulting to ignore',
    };
  }
}

async function deliverToJim(message: any, classification: ClassificationResult): Promise<void> {
  try {
    const payload = {
      recipient: 'jim',
      message: message.content,
      channel: message.channel_id,
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

    console.log(`[Jemma] Delivered to Jim (${message.author.username}: ${message.content.slice(0, 40)}...)`);
  } catch (err) {
    console.warn('[Jemma] Failed to deliver to Jim via server, writing signal file');
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const signalPath = path.join(SIGNALS_DIR, `jim-wake-discord-${timestamp}`);
      fs.writeFileSync(signalPath, JSON.stringify({
        source: 'discord',
        author: message.author.username,
        content: message.content,
        timestamp: message.timestamp,
      }));
    } catch (fileErr) {
      console.error('[Jemma] Failed to write Jim signal file:', (fileErr as Error).message);
    }
  }
}

async function deliverToLeo(message: any, classification: ClassificationResult): Promise<void> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const signalPath = path.join(SIGNALS_DIR, `leo-wake-discord-${timestamp}`);

    fs.writeFileSync(signalPath, JSON.stringify({
      conversationId: message.channel_id,
      mentionedAt: message.timestamp,
      messagePreview: message.content.slice(0, 100),
    }));

    console.log(`[Jemma] Woke Leo (${message.author.username}: ${message.content.slice(0, 40)}...)`);
  } catch (err) {
    console.error('[Jemma] Failed to write Leo signal file:', (err as Error).message);
  }
}

function deliverToDarron(message: any, classification: ClassificationResult): void {
  try {
    const config = loadConfig();
    if (!config.ntfy_topic) return;

    const ntfyMsg = `Discord — ${message.author.username}: ${message.content.slice(0, 100)}`;
    execSync(`curl -s -d "${ntfyMsg}" -H "Title: Discord Message" https://ntfy.sh/${config.ntfy_topic}`, {
      timeout: 5000,
    });

    console.log(`[Jemma] Notified Darron (${message.author.username})`);
  } catch (err) {
    console.warn('[Jemma] Failed to notify Darron:', (err as Error).message);
  }
}

async function deliverToSevn(message: any, classification: ClassificationResult): Promise<void> {
  try {
    const config = loadConfig();
    const endpoint = config.sevn?.wake_endpoint;
    const token = config.sevn?.wake_bearer_token;

    if (!endpoint || !token) {
      console.warn('[Jemma] Sevn endpoint or token not configured');
      return;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: `Discord: ${message.author.username} — ${message.content}`,
        mode: 'now',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Sevn returned ${res.status}`);
    }

    console.log(`[Jemma] Routed to Sevn (${message.author.username})`);
  } catch (err) {
    console.warn('[Jemma] Failed to route to Sevn:', (err as Error).message);
  }
}

async function deliverToSix(message: any, classification: ClassificationResult): Promise<void> {
  try {
    const config = loadConfig();
    const endpoint = config.six?.wake_endpoint;
    const token = config.six?.wake_bearer_token;

    if (!endpoint || !token) {
      console.warn('[Jemma] Six endpoint or token not configured');
      return;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: `Discord: ${message.author.username} — ${message.content}`,
        mode: 'now',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Six returned ${res.status}`);
    }

    console.log(`[Jemma] Routed to Six (${message.author.username})`);
  } catch (err) {
    console.warn('[Jemma] Failed to route to Six:', (err as Error).message);
  }
}

async function routeMessage(message: any): Promise<void> {
  // Ignore own messages
  if (message.author.bot) {
    return;
  }

  // Ignore empty messages
  if (!message.content || message.content.trim().length === 0) {
    return;
  }

  const classification = await callLLMForClassification(message);

  if (classification.confidence < 0.3) {
    console.log(`[Jemma] Low confidence classification (${classification.confidence}), ignoring`);
    return;
  }

  const recipient = classification.recipient;

  // Update tracking
  updateMessageLog(message, recipient, classification.confidence);
  updateDeliveryStats(recipient);

  switch (recipient) {
    case 'jim':
      await deliverToJim(message, classification);
      break;
    case 'leo':
      await deliverToLeo(message, classification);
      break;
    case 'darron':
      deliverToDarron(message, classification);
      break;
    case 'sevn':
      await deliverToSevn(message, classification);
      break;
    case 'six':
      await deliverToSix(message, classification);
      break;
    case 'ignore':
    default:
      // Silently ignore
      break;
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
        // Update last seen ID
        lastSeenMessageId[channelId] = messages[messages.length - 1].id;

        // Process messages
        for (const msg of messages) {
          const msgTime = new Date(msg.timestamp).getTime();
          if (!lastGatewayEventTimestamp || msgTime > lastGatewayEventTimestamp) {
            await routeMessage(msg);
          }
        }

        console.log(`[Jemma] Reconciliation: processed ${messages.length} messages from #${name}`);
      }
    } catch (err) {
      console.warn(`[Jemma] Reconciliation error for #${name}:`, (err as Error).message);
    }
  }
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
            `[Jemma] MESSAGE from @${message.author.username} in #${message.channel_id}: ${message.content.slice(0, 50)}...`
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

    // Reconnect with exponential backoff
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = reconnectDelays[Math.min(reconnectAttempts, reconnectDelays.length - 1)];
      console.log(`[Jemma] Reconnecting in ${delay}ms...`);
      setTimeout(connect, delay);
      reconnectAttempts++;
    } else {
      console.error('[Jemma] Max reconnection attempts exceeded');
      writeHealthFile('error', 'Max reconnection attempts exceeded');
    }
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
  writeHealthFile('ok');
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDirectories();
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

  // Start Discord connection
  connect();

  // Start reconciliation poll
  setInterval(reconcileMessages, RECONCILIATION_INTERVAL_MS);

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
