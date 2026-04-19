/**
 * Voice Integration API — TTS, STT, Listen Counter, Loops
 * Phase 1: OpenAI TTS + Whisper STT + conversation loop playback
 * Spec: Jim (S125, "Whisper as a Voice" thread)
 * S126: Chunking for long messages, disk caching, better error handling
 */

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { HAN_DIR } from '../db';
import { loadConfig } from '../services/planning';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const router = Router();

// ── Cache setup ────────────────────────────────────────────

const VOICE_CACHE_DIR = path.join(HAN_DIR, 'voice-cache');
if (!fs.existsSync(VOICE_CACHE_DIR)) {
    fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
}

function cacheKey(text: string, voice: string, model: string): string {
    const hash = crypto.createHash('sha256').update(`${model}:${voice}:${text}`).digest('hex');
    return hash;
}

function getCachePath(key: string): string {
    // Two-level directory structure to avoid too many files in one dir
    const dir = path.join(VOICE_CACHE_DIR, key.slice(0, 2));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${key}.mp3`);
}

function readCache(key: string): Buffer | null {
    const cachePath = getCachePath(key);
    if (fs.existsSync(cachePath)) {
        return fs.readFileSync(cachePath);
    }
    return null;
}

function writeCache(key: string, data: Buffer): void {
    const cachePath = getCachePath(key);
    fs.writeFileSync(cachePath, data);
}

// ── Config helpers ──────────────────────────────────────────

function getApiKey(): string {
    const key = process.env.OPENAI_API_KEY || loadConfig()?.openaiApiKey;
    if (!key) throw new Error('No OpenAI API key configured — add openaiApiKey to ~/.han/config.json');
    return key;
}

function getVoiceForRole(role: string): string {
    const config = loadConfig();
    const voiceMap = config?.voiceMap || {};
    const defaultVoice = config?.defaultVoice || 'alloy';
    return voiceMap[role] || defaultVoice;
}

function getTtsModel(): string {
    return loadConfig()?.ttsModel || 'tts-1';
}

/** Strip markdown for cleaner TTS output */
function stripMarkdown(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, '')       // fenced code blocks (before inline)
        .replace(/`{1,3}[^`]*`{1,3}/g, '')   // inline code
        .replace(/^#{1,6}\s+/gm, '')         // headers
        .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
        .replace(/\*(.+?)\*/g, '$1')         // italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text only
        .replace(/^\s*[-*+]\s+/gm, '')        // list markers
        .replace(/^\s*\d+\.\s+/gm, '')        // numbered lists
        .replace(/\|/g, '')                    // table chars
        .replace(/^---+$/gm, '')              // horizontal rules
        .replace(/^\s*>/gm, '')               // blockquotes
        .replace(/\n{3,}/g, '\n\n')           // collapse excess newlines
        .trim();
}

// ── Text chunking ──────────────────────────────────────────

const TTS_CHAR_LIMIT = 4096;

/**
 * Split text into chunks that fit within OpenAI's TTS character limit.
 * Splits at sentence boundaries (. ! ? followed by space/newline) where possible,
 * falls back to paragraph breaks, then hard-splits at the limit.
 */
function chunkText(text: string): string[] {
    if (text.length <= TTS_CHAR_LIMIT) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= TTS_CHAR_LIMIT) {
            chunks.push(remaining);
            break;
        }

        // Try to find a sentence boundary within the limit
        let splitAt = -1;
        const searchRange = remaining.slice(0, TTS_CHAR_LIMIT);

        // Prefer paragraph break
        const lastPara = searchRange.lastIndexOf('\n\n');
        if (lastPara > TTS_CHAR_LIMIT * 0.3) {
            splitAt = lastPara + 2;
        } else {
            // Find last sentence end (. ! ? followed by space or newline)
            const sentenceEnd = /[.!?][\s\n]/g;
            let match;
            while ((match = sentenceEnd.exec(searchRange)) !== null) {
                if (match.index + 2 <= TTS_CHAR_LIMIT) {
                    splitAt = match.index + 2;
                }
            }
        }

        // Fallback: split at last space
        if (splitAt <= 0) {
            const lastSpace = searchRange.lastIndexOf(' ');
            if (lastSpace > TTS_CHAR_LIMIT * 0.5) {
                splitAt = lastSpace + 1;
            } else {
                // Hard split
                splitAt = TTS_CHAR_LIMIT;
            }
        }

        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    return chunks.filter(c => c.length > 0);
}

// ── Core TTS function (with caching) ──────────────────────

async function generateTts(text: string, voice: string, model: string): Promise<Buffer> {
    const key = cacheKey(text, voice, model);
    const cached = readCache(key);
    if (cached) {
        return cached;
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getApiKey()}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            input: text,
            voice,
            response_format: 'mp3'
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI TTS error (${response.status}): ${err}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeCache(key, buffer);
    return buffer;
}

/**
 * Generate TTS for text of any length — chunks if needed, concatenates, caches.
 * The full concatenated result is also cached under the full-text key.
 */
async function generateTtsChunked(fullText: string, voice: string, model: string): Promise<Buffer> {
    // Check cache for the full text first
    const fullKey = cacheKey(fullText, voice, model);
    const fullCached = readCache(fullKey);
    if (fullCached) return fullCached;

    const chunks = chunkText(fullText);

    if (chunks.length === 1) {
        return generateTts(chunks[0], voice, model);
    }

    // Generate all chunks (sequentially to avoid rate limits)
    const audioBuffers: Buffer[] = [];
    for (const chunk of chunks) {
        const buffer = await generateTts(chunk, voice, model);
        audioBuffers.push(buffer);
    }

    const concatenated = Buffer.concat(audioBuffers);
    // Cache the concatenated result under the full-text key
    writeCache(fullKey, concatenated);
    return concatenated;
}

// ── Prepared statements ─────────────────────────────────────

const markListened = db.prepare(
    'UPDATE conversation_messages SET listen_count = listen_count + 1 WHERE id = ?'
);
const getMessage = db.prepare(
    'SELECT * FROM conversation_messages WHERE id = ?'
);
const getConversationMessages = db.prepare(
    'SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC'
);
const getLatestActiveConversation = db.prepare(
    'SELECT conversation_id FROM conversation_messages ORDER BY created_at DESC LIMIT 1'
);

// ── TTS: Text to Speech ─────────────────────────────────────

router.post('/tts', async (req: Request, res: Response) => {
    try {
        const { text, voice, role, model } = req.body;

        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'text is required' });
        }

        const resolvedVoice = voice || (role ? getVoiceForRole(role) : getVoiceForRole('human'));
        const resolvedModel = model || getTtsModel();
        const cleanText = stripMarkdown(text);

        if (!cleanText) {
            return res.status(400).json({ error: 'text is empty after markdown stripping' });
        }

        const buffer = await generateTtsChunked(cleanText, resolvedVoice, resolvedModel);

        res.set('Content-Type', 'audio/mpeg');
        res.set('Content-Length', String(buffer.length));
        res.send(buffer);
    } catch (err) {
        console.error('[Voice/TTS] Error:', err);
        res.status(500).json({ error: 'TTS failed', detail: (err as Error).message });
    }
});

// ── TTS for a specific message by ID (cacheable, serves stored audio) ──

router.get('/tts/:messageId', async (req: Request, res: Response) => {
    try {
        const { messageId } = req.params;
        const msg = getMessage.get(messageId) as any;
        if (!msg) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const voice = getVoiceForRole(msg.role);
        const model = getTtsModel();
        const cleanText = stripMarkdown(msg.content);

        if (!cleanText) {
            return res.status(400).json({ error: 'Message has no speakable text' });
        }

        const buffer = await generateTtsChunked(cleanText, voice, model);

        res.set('Content-Type', 'audio/mpeg');
        res.set('Content-Length', String(buffer.length));
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (err) {
        console.error('[Voice/TTS] Error:', err);
        res.status(500).json({ error: 'TTS failed', detail: (err as Error).message });
    }
});

// ── STT: Speech to Text ─────────────────────────────────────

router.post('/stt', async (req: Request, res: Response) => {
    try {
        const audioBuffer = req.body as Buffer;

        if (!audioBuffer || audioBuffer.length === 0) {
            return res.status(400).json({ error: 'No audio data provided' });
        }

        const formData = new FormData();
        formData.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'recording.webm');
        formData.append('model', 'whisper-1');
        formData.append('language', req.query.language as string || 'en');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getApiKey()}`
            },
            body: formData
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[Voice/STT] OpenAI error:', err);
            return res.status(502).json({ error: 'STT transcription failed', detail: err });
        }

        const result = await response.json() as { text: string };
        res.json({ text: result.text });
    } catch (err) {
        console.error('[Voice/STT] Error:', err);
        res.status(500).json({ error: 'STT failed', detail: (err as Error).message });
    }
});

// ── Listen Counter ──────────────────────────────────────────

router.patch('/listened/:messageId', (req: Request, res: Response) => {
    const { messageId } = req.params;
    const msg = getMessage.get(messageId) as any;
    if (!msg) {
        return res.status(404).json({ error: 'Message not found' });
    }
    markListened.run(messageId);
    const updated = getMessage.get(messageId) as any;
    res.json({ messageId, listen_count: updated.listen_count });
});

// ── Loops (old simple boundary detection — replaced by DB-backed version below) ──
// Removed in S127 Phase 1b. Loop endpoints now use conversation_loops table.

// ── Unread as concatenated audio (Siri-friendly) ────────────

router.get('/unread/:conversationId', async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const loops = parseInt(req.query.loops as string) || 1;

    const messages = getConversationMessages.all(conversationId) as any[];
    if (messages.length === 0) {
        return res.status(204).json({ message: 'No messages' });
    }

    // Find loop boundaries
    const boundaries: number[] = [];
    messages.forEach((msg, idx) => {
        if (msg.role === 'human') boundaries.push(idx);
    });

    const startBoundary = Math.max(0, boundaries.length - loops);
    const loopStartIdx = boundaries[startBoundary] ?? 0;
    const unreadMessages = messages.slice(loopStartIdx)
        .filter(m => m.role !== 'human' && (m.listen_count || 0) === 0);

    if (unreadMessages.length === 0) {
        return res.status(204).json({ message: 'No unread messages' });
    }

    try {
        const audioBuffers: Buffer[] = [];

        for (const msg of unreadMessages) {
            const voice = getVoiceForRole(msg.role);
            const model = getTtsModel();
            const cleanText = stripMarkdown(msg.content);

            if (!cleanText) continue;

            try {
                const buffer = await generateTtsChunked(cleanText, voice, model);
                audioBuffers.push(buffer);
            } catch (err) {
                console.error(`[Voice/Unread] TTS failed for message ${msg.id}:`, err);
                // Continue with remaining messages
            }
        }

        if (audioBuffers.length === 0) {
            return res.status(204).json({ message: 'No audio generated' });
        }

        // Mark all as listened (Siri can't call back)
        for (const msg of unreadMessages) {
            markListened.run(msg.id);
        }

        const concatenated = Buffer.concat(audioBuffers);
        res.set('Content-Type', 'audio/mpeg');
        res.set('Content-Disposition', 'attachment; filename="han-unread.mp3"');
        res.set('Content-Length', String(concatenated.length));
        res.send(concatenated);
    } catch (err) {
        console.error('[Voice/Unread] Error:', err);
        res.status(500).json({ error: 'Failed to generate unread audio', detail: (err as Error).message });
    }
});

// ── Active conversation (for Siri shortcuts) ────────────────

router.get('/active', (_req: Request, res: Response) => {
    const latest = getLatestActiveConversation.get() as any;
    if (!latest) {
        return res.status(404).json({ error: 'No conversations found' });
    }
    res.json({ conversationId: latest.conversation_id });
});

// ── Cache stats (for admin/debugging) ───────────────────────

router.get('/cache/stats', (_req: Request, res: Response) => {
    let totalFiles = 0;
    let totalBytes = 0;

    try {
        const subdirs = fs.readdirSync(VOICE_CACHE_DIR);
        for (const sub of subdirs) {
            const subPath = path.join(VOICE_CACHE_DIR, sub);
            if (fs.statSync(subPath).isDirectory()) {
                const files = fs.readdirSync(subPath);
                totalFiles += files.length;
                for (const f of files) {
                    totalBytes += fs.statSync(path.join(subPath, f)).size;
                }
            }
        }
    } catch { /* empty cache */ }

    res.json({
        cachedFiles: totalFiles,
        totalSizeMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
        cacheDir: VOICE_CACHE_DIR
    });
});

// ── Voice config endpoints ────────────────────────────────────

router.get('/config', (_req: Request, res: Response) => {
    const config = loadConfig() || {};
    res.json({
        autoGenerateVoice: config.autoGenerateVoice !== false, // default: true
        autoTagModel: config.autoTagModel || 'gpt-4o-mini',
    });
});

router.patch('/config', (req: Request, res: Response) => {
    try {
        const configPath = path.join(HAN_DIR, 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        if (req.body.autoGenerateVoice !== undefined) {
            config.autoGenerateVoice = req.body.autoGenerateVoice;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        res.json({ success: true, autoGenerateVoice: config.autoGenerateVoice !== false });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Loop endpoints (Phase 1b, S127) ───────────────────────────

import { conversationLoopStmts, conversationMessageStmts as convMsgStmts } from '../db';

// Get all loops for a conversation
router.get('/loops/:conversationId', (req: Request, res: Response) => {
    try {
        const loops = conversationLoopStmts.getByConversation.all(req.params.conversationId) as any[];

        // Enrich with listen status
        const enriched = loops.map((loop: any) => {
            // Get messages in this loop (between this human msg and next)
            const allLoops = loops;
            const idx = allLoops.findIndex((l: any) => l.id === loop.id);
            const nextLoop = allLoops[idx + 1];

            let msgs: any[];
            if (nextLoop) {
                msgs = db.prepare(
                    `SELECT id, role, listen_count FROM conversation_messages
                     WHERE conversation_id = ? AND role != 'human'
                     AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                     AND created_at < (SELECT created_at FROM conversation_messages WHERE id = ?)
                     ORDER BY created_at ASC`
                ).all(loop.conversation_id, loop.human_message_id, nextLoop.human_message_id) as any[];
            } else {
                msgs = db.prepare(
                    `SELECT id, role, listen_count FROM conversation_messages
                     WHERE conversation_id = ? AND role != 'human'
                     AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                     ORDER BY created_at ASC`
                ).all(loop.conversation_id, loop.human_message_id) as any[];
            }

            const unlistenedCount = msgs.filter(m => (m.listen_count || 0) === 0).length;

            return {
                ...loop,
                message_count: msgs.length,
                unlistened_count: unlistenedCount,
                all_listened: msgs.length > 0 && unlistenedCount === 0,
            };
        });

        res.json({ loops: enriched });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Get messages for a specific loop
router.get('/loops/:conversationId/:loopId/messages', (req: Request, res: Response) => {
    try {
        const loop = conversationLoopStmts.getById.get(req.params.loopId) as any;
        if (!loop) return res.status(404).json({ error: 'Loop not found' });

        const allLoops = conversationLoopStmts.getByConversation.all(loop.conversation_id) as any[];
        const idx = allLoops.findIndex((l: any) => l.id === loop.id);
        const nextLoop = allLoops[idx + 1];

        let msgs: any[];
        if (nextLoop) {
            msgs = db.prepare(
                `SELECT * FROM conversation_messages
                 WHERE conversation_id = ? AND role != 'human'
                 AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                 AND created_at < (SELECT created_at FROM conversation_messages WHERE id = ?)
                 ORDER BY created_at ASC`
            ).all(loop.conversation_id, loop.human_message_id, nextLoop.human_message_id) as any[];
        } else {
            msgs = db.prepare(
                `SELECT * FROM conversation_messages
                 WHERE conversation_id = ? AND role != 'human'
                 AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                 ORDER BY created_at ASC`
            ).all(loop.conversation_id, loop.human_message_id) as any[];
        }

        res.json({ loop, messages: msgs });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Update loop tag (inline edit)
router.patch('/loops/:loopId', (req: Request, res: Response) => {
    try {
        const { tag } = req.body;
        conversationLoopStmts.updateTag.run(tag, req.params.loopId);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── Auto-generation hooks (called from conversations.ts) ──────

/**
 * Auto-generate TTS for an agent message (fire-and-forget from message post).
 * Generates and caches the audio so TTM playback is instant.
 */
export async function autoGenerateTts(messageId: string, conversationId: string): Promise<void> {
    const config = loadConfig();
    if (config?.autoGenerateVoice === false) return; // default: on

    const msg = getMessage.get(messageId) as any;
    if (!msg) return;

    const voice = getVoiceForRole(msg.role);
    const model = getTtsModel();
    const cleanText = stripMarkdown(msg.content);
    if (!cleanText) return;

    console.log(`[Voice] Auto-generating TTS for message ${messageId} (${msg.role}, ${cleanText.length} chars)`);
    await generateTtsChunked(cleanText, voice, model);
    console.log(`[Voice] Auto-generation complete for ${messageId}`);

    // Increment message_count on the current loop
    try {
        const loop = conversationLoopStmts.getLatest.get(conversationId) as any;
        if (loop) conversationLoopStmts.incrementMessageCount.run(loop.id);
    } catch { /* best effort */ }
}

/**
 * Auto-tag a loop via LLM (fire-and-forget from message post).
 * Summarises Darron's message in <10 words as a topic label.
 */
export async function autoTagLoop(loopId: string, humanMessageContent: string): Promise<void> {
    try {
        const apiKey = getApiKey();
        const config = loadConfig();
        const model = config?.autoTagModel || 'gpt-4o-mini';

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a topic labeller. Given a message, produce a topic label of 10 words or fewer. Return ONLY the label, no quotes, no punctuation at the end.'
                    },
                    {
                        role: 'user',
                        content: humanMessageContent.slice(0, 500)
                    }
                ],
                max_tokens: 30,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            console.error(`[Voice] Auto-tag API failed: ${response.status}`);
            return;
        }

        const data = await response.json() as any;
        const tag = data.choices?.[0]?.message?.content?.trim();
        if (tag) {
            conversationLoopStmts.updateTag.run(tag, loopId);
            console.log(`[Voice] Auto-tagged loop ${loopId}: "${tag}"`);
        }
    } catch (err: any) {
        console.error(`[Voice] Auto-tag error: ${err.message}`);
    }
}

export default router;
