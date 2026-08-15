/**
 * Voice Integration API — TTS, STT, Listen Counter, Loops
 * Phase 1: OpenAI TTS + Whisper STT + conversation loop playback
 * Spec: Jim (S125, "Whisper as a Voice" thread)
 * S126: Chunking for long messages, disk caching, better error handling
 */

import { Router, Request, Response } from 'express';
import { humanSideRoles } from '../lib/persona-registry';
import { db } from '../db';
import { HAN_DIR } from '../db';
import { loadConfig, generateId } from '../services/planning';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const router = Router();

// ── Cache setup ────────────────────────────────────────────

const VOICE_CACHE_DIR = path.join(HAN_DIR, 'voice-cache');
if (!fs.existsSync(VOICE_CACHE_DIR)) {
    fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
}

function cacheKey(text: string, voice: string, model: string, instructions: string): string {
    // Instructions included in the key so changing the steering text invalidates
    // the legacy hash cache cleanly. Empty string is the pre-instruction baseline
    // (ensures backward-compatible hashes for entries generated without steering).
    const hash = crypto.createHash('sha256').update(`${model}:${voice}:${instructions}:${text}`).digest('hex');
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

// ── Per-message cache (Darron's model: messageId ↔ voice file, bijective) ──
//
// The legacy cache above keys on sha256(model:voice:text) — over-specific:
// when voice changes, the same message becomes a different cache entry,
// orphaning its prior audio. The per-message layer keys on messageId
// directly. One file per message. Voice/model/text-hash live in a sidecar
// so we can tell when the cache is stale and regenerate.
//
// Lazy migration: on a per-message cache miss, we check the legacy hash
// cache for the current voice/model/text, and if present, salvage that
// file into the new path. Old hash-keyed files stay where they are
// (cardinal rule: never delete memory).

const VOICE_CACHE_BY_MESSAGE_DIR = path.join(VOICE_CACHE_DIR, 'by-message');
if (!fs.existsSync(VOICE_CACHE_BY_MESSAGE_DIR)) {
    fs.mkdirSync(VOICE_CACHE_BY_MESSAGE_DIR, { recursive: true });
}

interface MessageCacheSidecar {
    voice: string;
    model: string;
    text_hash: string;
    generated_at: string;
}

function messageCachePaths(messageId: string): { audio: string; sidecar: string } {
    return {
        audio: path.join(VOICE_CACHE_BY_MESSAGE_DIR, `${messageId}.mp3`),
        sidecar: path.join(VOICE_CACHE_BY_MESSAGE_DIR, `${messageId}.json`),
    };
}

function textHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function readMessageCache(messageId: string): Buffer | null {
    // The audio is the record of the message at the moment of its generation —
    // historical, not synthesised-from-current-settings. We do NOT invalidate on
    // voice/model changes: if a file exists for this message, we serve it,
    // regardless of what the current voice config says. Changing voice affects
    // future messages only. (Darron's rule: photos preserve the hair colour
    // they were taken under; we don't doctor them when the hair changes.)
    const { audio } = messageCachePaths(messageId);
    if (!fs.existsSync(audio)) return null;
    try {
        return fs.readFileSync(audio);
    } catch {
        return null;
    }
}

function writeMessageCache(messageId: string, audio: Buffer, voice: string, model: string, text: string): void {
    const { audio: audioPath, sidecar } = messageCachePaths(messageId);
    fs.writeFileSync(audioPath, audio);
    const meta: MessageCacheSidecar = {
        voice,
        model,
        text_hash: textHash(text),
        generated_at: new Date().toISOString(),
    };
    fs.writeFileSync(sidecar, JSON.stringify(meta));
}

/**
 * Get cached audio for a message, or generate it (with lazy migration from
 * the legacy hash cache when possible). Single entry point for any code that
 * needs "audio for this specific message".
 */
async function getOrGenerateForMessage(
    messageId: string,
    text: string,
    voice: string,
    model: string,
    instructions: string,
): Promise<Buffer> {
    // 1. Per-message cache — historical, never invalidated. If a file exists
    //    for this message under any voice it was once generated with, that
    //    is the answer. The sidecar records when/under-what-settings, but
    //    is informational only and not consulted for invalidation.
    const cached = readMessageCache(messageId);
    if (cached) return cached;

    // 2. Lazy migration — if legacy hash cache holds the file under the same
    //    voice/model/text/instructions, salvage it. Old file stays where it is.
    const legacy = readCache(cacheKey(text, voice, model, instructions));
    if (legacy) {
        writeMessageCache(messageId, legacy, voice, model, text);
        return legacy;
    }

    // 3. Generate fresh, cache, serve.
    const buffer = await generateTtsChunked(text, voice, model, instructions);
    writeMessageCache(messageId, buffer, voice, model, text);
    return buffer;
}

// ── Anomaly logging ────────────────────────────────────────

const VOICE_ANOMALIES_PATH = path.join(HAN_DIR, 'health', 'voice-anomalies.jsonl');

function logVoiceAnomaly(entry: Record<string, any>): void {
    try { fs.mkdirSync(path.dirname(VOICE_ANOMALIES_PATH), { recursive: true }); } catch { /* dir already exists or unwritable */ }
    const row = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
    try {
        fs.appendFileSync(VOICE_ANOMALIES_PATH, row + '\n');
    } catch (err) {
        console.error('[Voice/Anomaly] Failed to append to voice-anomalies.jsonl:', err);
    }
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

/**
 * Voice strings resolve to a provider spec. Two forms:
 *   - Plain OpenAI voice name (the original shape): `"fable"` → OpenAI.
 *   - On-card Kokoro form: `"kokoro:<voice>"` or `"kokoro:<voice>|<openaiFallback>"`
 *     e.g. `"kokoro:bm_fable|fable"` → render on the local voice organ
 *     (scripts/voice-organ/organ.py, port 3851), falling back to OpenAI voice
 *     `fable` if the organ is down/failing (fallback logged as an anomaly;
 *     no fallback named → the error propagates, fail-loud).
 * The FULL string participates in cache keys, so provider switches never
 * collide with previously cached audio.
 * Source: Darron 2026-08-14 — replace cloud TTS with the 5060 Ti organ,
 * one seat at a time, each mind choosing its own voice (a trial; voices
 * freely changeable).
 */
interface VoiceSpec {
    provider: 'openai' | 'kokoro';
    voice: string;
    fallback?: string;
}

function parseVoiceSpec(voiceString: string): VoiceSpec {
    const m = voiceString.match(/^kokoro:([a-z]{2}_[a-z0-9]+)(?:\|([a-z0-9-]+))?$/);
    if (m) return { provider: 'kokoro', voice: m[1], fallback: m[2] };
    return { provider: 'openai', voice: voiceString };
}

function getVoiceOrganUrl(): string {
    return loadConfig()?.voiceOrganUrl || 'http://127.0.0.1:3851';
}

function getTtsModel(): string {
    return loadConfig()?.ttsModel || 'tts-1';
}

/**
 * Optional voice-steering instructions for `gpt-4o-mini-tts` (and successor
 * models that accept the `instructions` field). Read from `voiceInstructions`
 * in `~/.han/config.json`. Empty/missing → omitted from the OpenAI request
 * body entirely (older models like `tts-1` reject unknown fields).
 *
 * Two config shapes supported:
 *   - String → used for all roles (the original Darron-2026-05-09 shape).
 *   - Object → per-role overrides with `default` fallback. Keys map to
 *     conversation-message roles (`supervisor`, `leo`, `human`, etc.).
 *     Lookup: roleMap[role] ?? roleMap.default ?? ''.
 *
 * Source: Darron 2026-05-09 — initial single-instruction shape. Per-role
 * map added same-day after observing that a global "masculine register"
 * directive forces an androgynous voice (fable) into a performed
 * caricature; per-role lets each voice be itself naturally.
 */
function getVoiceInstructions(role?: string): string {
    const v = loadConfig()?.voiceInstructions;
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object' && v !== null) {
        const map = v as Record<string, string>;
        const text = (role && map[role]) || map.default || '';
        return String(text).trim();
    }
    return '';
}

/** Strip markdown for cleaner TTS output */
function stripMarkdown(text: string): string {
    const stripped = text
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
    return normaliseSpokenSignature(stripped);
}

// B4 (catch-me-up v2.2 — NON-DESTRUCTIVE per Tenshi's cure + Jim's escalation): a
// trailing signature line ("— Leo (session)") hands the synth an unvoiced em-dash with
// no terminal stop — the "power failure" drawl. The v2.1 regex COLLAPSED the line to
// "Name." and thereby deleted trailing words (Jim's run: two goodnights, 61 chars) —
// and because this sits in stripMarkdown, autoGenerateTts would have written truncated
// tails PERMANENTLY into a never-invalidated per-message cache, for every future post.
// The non-destructive form makes that class unrepresentable: strip ONLY the leading
// em/en-dash, keep every word, ensure a terminal stop. A false positive costs a dash
// and gains a full stop — nothing is ever deleted. Spoken render only; the written
// signature stays byte-intact (the (session)/(human) distinction is load-bearing).
function normaliseSpokenSignature(text: string): string {
    const lines = text.trimEnd().split('\n');
    let last = lines.length - 1;
    while (last >= 0 && lines[last].trim() === '') last--;
    if (last < 0) return text;
    const trimmed = lines[last].trim();
    // Conservative: only a line that OPENS with an em/en-dash followed by a
    // capitalised name-shaped word is treated as a signature line.
    const m = trimmed.match(/^[—–]\s*([A-Z][a-z].*)$/);
    if (!m) return text;
    // Tenshi nit 1 (v2.2 land): a trailing comma/semicolon/colon would otherwise
    // yield "Leo,." — strip dangling punctuation before ensuring the stop.
    const kept = m[1].trimEnd().replace(/[,;:]+$/, '');
    lines[last] = /[.!?]$/.test(kept) ? kept : `${kept}.`;
    return lines.slice(0, last + 1).join('\n');
}

// ── Text chunking ──────────────────────────────────────────

// OpenAI's documented ceiling is 4096, but `gpt-4o-mini-tts` was observed
// returning truncated audio (50× below normal bytes/char) for inputs in the
// 3500-4096 range without flagging an error. Default 2500 stays comfortably
// below that range. Override via `ttsCharLimit` in ~/.han/config.json.
// Bug: jim-report "Voice TTS truncation fix" punch list (mou041x1-l1hsit, S152).
const TTS_CHAR_LIMIT: number = loadConfig()?.ttsCharLimit ?? 2500;

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

async function generateOpenAiTts(text: string, voice: string, model: string, instructions: string): Promise<Buffer> {
    // OpenAI TTS request body. `instructions` is supported by `gpt-4o-mini-tts`
    // (and successor models) for natural-language voice steering — register,
    // cadence, pace. Older models (`tts-1`, `tts-1-hd`) reject unknown fields,
    // so the field is conditionally included only when non-empty.
    const body: Record<string, unknown> = {
        model,
        input: text,
        voice,
        response_format: 'mp3',
    };
    if (instructions) body.instructions = instructions;

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getApiKey()}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI TTS error (${response.status}): ${err}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

async function generateKokoroTts(text: string, voice: string): Promise<Buffer> {
    const response = await fetch(`${getVoiceOrganUrl()}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Voice organ error (${response.status}): ${err.slice(0, 300)}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

async function generateTts(text: string, voice: string, model: string, instructions: string): Promise<Buffer> {
    const key = cacheKey(text, voice, model, instructions);
    const cached = readCache(key);
    if (cached) {
        return cached;
    }

    const spec = parseVoiceSpec(voice);
    let buffer: Buffer;
    if (spec.provider === 'kokoro') {
        try {
            buffer = await generateKokoroTts(text, spec.voice);
        } catch (err) {
            // The organ failing is an anomaly worth a row whether or not a
            // fallback exists — a silent drift to cloud would hide an outage.
            logVoiceAnomaly({
                kind: 'kokoro_organ_failed',
                voice: spec.voice,
                fallback: spec.fallback ?? null,
                input_chars: text.length,
                text_hash: textHash(text),
                detail: (err as Error).message.slice(0, 300),
            });
            if (!spec.fallback) throw err;
            buffer = await generateOpenAiTts(text, spec.fallback, model, instructions);
        }
    } else {
        buffer = await generateOpenAiTts(text, spec.voice, model, instructions);
    }

    // Sanity floor (both providers) — empirical normal is ~958 bytes/char on
    // OpenAI mp3 (Kokoro-via-ffmpeg 128k lands comfortably above too); the
    // observed truncation bug (S152) returned ~20 bytes/char. Anything below
    // the floor is refused and logged so a corrupt response never gets cached
    // as authoritative. Override floor via `ttsBytesPerCharFloor` in
    // ~/.han/config.json.
    const bytesPerChar = buffer.length / text.length;
    const FLOOR: number = loadConfig()?.ttsBytesPerCharFloor ?? 200;
    if (bytesPerChar < FLOOR) {
        logVoiceAnomaly({
            kind: 'truncated_response',
            input_chars: text.length,
            output_bytes: buffer.length,
            bytes_per_char: Number(bytesPerChar.toFixed(2)),
            floor: FLOOR,
            voice,
            model,
            text_hash: textHash(text),
        });
        throw new Error(
            `TTS returned suspiciously short audio: ${buffer.length} bytes for ${text.length} chars `
            + `(${bytesPerChar.toFixed(1)} bytes/char, floor ${FLOOR}). Refusing to cache.`
        );
    }

    writeCache(key, buffer);
    return buffer;
}

/**
 * Generate TTS for text of any length — chunks if needed, concatenates, caches.
 * The full concatenated result is also cached under the full-text key.
 */
async function generateTtsChunked(fullText: string, voice: string, model: string, instructions: string): Promise<Buffer> {
    // Check cache for the full text first
    const fullKey = cacheKey(fullText, voice, model, instructions);
    const fullCached = readCache(fullKey);
    if (fullCached) return fullCached;

    const chunks = chunkText(fullText);

    if (chunks.length === 1) {
        return generateTts(chunks[0], voice, model, instructions);
    }

    // Generate all chunks (sequentially to avoid rate limits)
    const audioBuffers: Buffer[] = [];
    for (const chunk of chunks) {
        const buffer = await generateTts(chunk, voice, model, instructions);
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

        const resolvedRole = role || 'human';
        const resolvedVoice = voice || getVoiceForRole(resolvedRole);
        const resolvedModel = model || getTtsModel();
        const resolvedInstructions = getVoiceInstructions(resolvedRole);
        const cleanText = stripMarkdown(text);

        if (!cleanText) {
            return res.status(400).json({ error: 'text is empty after markdown stripping' });
        }

        const buffer = await generateTtsChunked(cleanText, resolvedVoice, resolvedModel, resolvedInstructions);

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
        const instructions = getVoiceInstructions(msg.role);
        const cleanText = stripMarkdown(msg.content);

        if (!cleanText) {
            return res.status(400).json({ error: 'Message has no speakable text' });
        }

        // Per-message cache — bijective messageId ↔ audio file with lazy
        // migration from the legacy hash cache. See helpers above.
        const buffer = await getOrGenerateForMessage(messageId, cleanText, voice, model, instructions);

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

// B5 (catch-me-up v2.1): the owner's read-state override — "just like email".
// read:false zeroes the count so the post re-enters play-all-unread; read:true
// restores max(1, current) so completion history survives a double-toggle.
// Semantics for the ledger: the mechanical writers stay single-writer-per-mode
// (player marks on completion; Siri marks only with explicit ?mark=eager) — this
// endpoint is the OWNER'S deliberate hand on his own listening ledger, authoritative
// by definition. The column keeps one meaning: "Darron considers this heard."
const setListenCount = db.prepare(
    'UPDATE conversation_messages SET listen_count = ? WHERE id = ?'
);

router.patch('/read-state/:messageId', (req: Request, res: Response) => {
    const { messageId } = req.params;
    const { read } = req.body || {};
    if (typeof read !== 'boolean') {
        return res.status(400).json({ error: 'read (boolean) is required' });
    }
    const msg = getMessage.get(messageId) as any;
    if (!msg) {
        return res.status(404).json({ error: 'Message not found' });
    }
    setListenCount.run(read ? Math.max(1, msg.listen_count || 0) : 0, messageId);
    const updated = getMessage.get(messageId) as any;
    res.json({
        messageId,
        listen_count: updated.listen_count,
        read: (updated.listen_count || 0) > 0,
    });
});

// ── Loops (old simple boundary detection — replaced by DB-backed version below) ──
// Removed in S127 Phase 1b. Loop endpoints now use conversation_loops table.

// ── Unread as concatenated audio (Siri-friendly) ────────────

router.get('/unread/:conversationId', async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const loops = parseInt(req.query.loops as string) || 1;
    // B3 (catch-me-up v2.1): marking is EXPLICITLY moded. Default is pure fetch —
    // a download is not a listening (the receipt must never outrun the record).
    // Genuine Siri-shortcut use opts into the old coarse behaviour with ?mark=eager,
    // which is byte-identical to the pre-v2.1 endpoint. The UI player is the single
    // mechanical writer otherwise, marking per-message on playback completion.
    const eagerMark = req.query.mark === 'eager';

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
    // M4 (v2.2): a post with NO speakable text after cleaning is not playable content —
    // it is excluded from the unread set BY DEFINITION (it cannot be listened to, so it
    // cannot be owed). Distinct from a TRANSIENT render failure below, which stays
    // unread and self-heals on the next attempt. Without this split, mark-only-rendered
    // (M2) would leave unspeakable posts permanently owed and no thread could acquit.
    const unreadMessages = messages.slice(loopStartIdx)
        .filter(m => m.role !== 'human' && (m.listen_count || 0) === 0 && stripMarkdown(m.content).length > 0);

    if (unreadMessages.length === 0) {
        return res.status(204).json({ message: 'No unread messages' });
    }

    try {
        const audioBuffers: Buffer[] = [];
        const renderedIds: string[] = [];

        for (const msg of unreadMessages) {
            const voice = getVoiceForRole(msg.role);
            const model = getTtsModel();
            const instructions = getVoiceInstructions(msg.role);
            const cleanText = stripMarkdown(msg.content);

            if (!cleanText) continue; // belt — the set filter above already excludes these

            try {
                const buffer = await generateTtsChunked(cleanText, voice, model, instructions);
                audioBuffers.push(buffer);
                renderedIds.push(msg.id);
            } catch (err) {
                console.error(`[Voice/Unread] TTS failed for message ${msg.id}:`, err);
                // Transient failure: stays UNREAD (M2/M4) — loud beats silent; it
                // self-heals on the next fetch. Continue with remaining messages.
            }
        }

        if (audioBuffers.length === 0) {
            return res.status(204).json({ message: 'No audio generated' });
        }

        // Mark-on-download ONLY under ?mark=eager (Siri can't call back), and ONLY the
        // messages that actually produced audio (M2 — a failed render must never count
        // as heard; over-marking is silent and its victim isn't the caller).
        if (eagerMark) {
            for (const id of renderedIds) {
                markListened.run(id);
            }
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

// ── Voice anomalies (read tail of voice-anomalies.jsonl) ────

router.get('/anomalies', (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
        if (!fs.existsSync(VOICE_ANOMALIES_PATH)) {
            return res.json({ anomalies: [], total: 0 });
        }
        const content = fs.readFileSync(VOICE_ANOMALIES_PATH, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        const tail = lines.slice(-limit).reverse(); // newest first
        const anomalies = tail.map(l => {
            try { return JSON.parse(l); } catch { return { raw: l, parse_error: true }; }
        });
        res.json({ anomalies, total: lines.length });
    } catch (err) {
        console.error('[Voice/Anomalies] Error:', err);
        res.status(500).json({ error: 'Failed to read anomalies', detail: (err as Error).message });
    }
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

// B1 (catch-me-up v2.2 — M1 GENERALISED): the virtual loop id. The predicate is
// "messages outside every loop's span" (Tenshi's cure), NOT "no human anchors": loops
// anchor on human messages and span FORWARD, so agent posts BEFORE the first human turn
// belong to no loop (47 threads / 284 unheard head posts, measured 2026-08-15) — and an
// all-agent thread has no loops at all. Both cases get ONE virtual loop — computed in
// the response, NEVER inserted: a conversation_loops row whose human_message_id pointed
// at a non-human message would be a false record (rendered-never-written).
const VIRTUAL_LOOP_ID = 'whole-thread';

function agentMessagesForConversation(conversationId: string, fullRows: boolean, beforeMessageId?: string): any[] {
    const roles = humanSideRoles();
    const placeholders = roles.map(() => '?').join(',');
    const headClause = beforeMessageId
        ? 'AND created_at < (SELECT created_at FROM conversation_messages WHERE id = ?)'
        : '';
    const params = beforeMessageId
        ? [conversationId, ...roles, beforeMessageId]
        : [conversationId, ...roles];
    return db.prepare(
        `SELECT ${fullRows ? '*' : 'id, role, listen_count, content, created_at'}
         FROM conversation_messages
         WHERE conversation_id = ? AND role NOT IN (${placeholders}) ${headClause}
         ORDER BY created_at ASC`
    ).all(...params) as any[];
}

// M4 (v2.2): the acquittal counts exclude unspeakable posts — a post with no speakable
// text cannot be listened to, so it cannot be owed. Transient render failures are a
// different animal (they stay unread and self-heal).
function speakable(m: any): boolean {
    try { return stripMarkdown(String(m.content ?? '')).length > 0; } catch { return false; }
}

/** The uncovered-head virtual loop (or whole-thread when no loops exist), enriched. */
function virtualLoopFor(conversationId: string, firstAnchorMessageId: string | null): any | null {
    const msgs = agentMessagesForConversation(conversationId, false, firstAnchorMessageId ?? undefined);
    if (msgs.length === 0) return null;
    const unlistened = msgs.filter(m => (m.listen_count || 0) === 0 && speakable(m)).length;
    return {
        id: VIRTUAL_LOOP_ID,
        conversation_id: conversationId,
        loop_number: 0,
        human_message_id: null,
        tag: firstAnchorMessageId ? 'Before the first turn' : 'Whole thread',
        virtual: true,
        created_at: msgs[0].created_at,
        message_count: msgs.length,
        unlistened_count: unlistened,
        all_listened: unlistened === 0,
    };
}

// Get all loops for a conversation
router.get('/loops/:conversationId', (req: Request, res: Response) => {
    try {
        let loops = conversationLoopStmts.getByConversation.all(req.params.conversationId) as any[];

        // Lazy materialisation — if the table has no loops for this thread but
        // user-side messages exist, derive loops from the message stream and
        // insert them. Handles legacy threads and threads populated via API
        // with non-'human' roles (which previously skipped loop creation).
        if (loops.length === 0) {
            const HUMAN_SIDE_ROLES = humanSideRoles(); // Ring 2 (H4): derived from the registry — never a persona-key literal
            const placeholders = HUMAN_SIDE_ROLES.map(() => '?').join(',');
            const humanMsgs = db.prepare(
                `SELECT id, role, created_at FROM conversation_messages
                 WHERE conversation_id = ? AND role IN (${placeholders})
                 ORDER BY created_at ASC`
            ).all(req.params.conversationId, ...HUMAN_SIDE_ROLES) as any[];

            if (humanMsgs.length > 0) {
                for (let i = 0; i < humanMsgs.length; i++) {
                    const m = humanMsgs[i];
                    conversationLoopStmts.insert.run(
                        generateId(), req.params.conversationId, i + 1, m.id, null, 0, m.created_at
                    );
                }
                loops = conversationLoopStmts.getByConversation.all(req.params.conversationId) as any[];
            }
        }

        // B1/M1 (v2.2): messages OUTSIDE EVERY LOOP'S SPAN get the virtual loop — the
        // whole thread when no loops exist, the uncovered HEAD (posts before the first
        // human anchor) when loops do. Same virtual loop, same code path, predicate
        // generalised (the 47-thread/284-post hole).
        if (loops.length === 0) {
            const virtual = virtualLoopFor(String(req.params.conversationId), null);
            if (virtual) return res.json({ loops: [virtual] });
        }

        // Enrich with listen status
        const enriched = loops.map((loop: any) => {
            // Get messages in this loop (between this human msg and next)
            const allLoops = loops;
            const idx = allLoops.findIndex((l: any) => l.id === loop.id);
            const nextLoop = allLoops[idx + 1];

            let msgs: any[];
            if (nextLoop) {
                msgs = db.prepare(
                    `SELECT id, role, listen_count, content FROM conversation_messages
                     WHERE conversation_id = ? AND role NOT IN (${humanSideRoles().map(() => '?').join(',')})
                     AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                     AND created_at < (SELECT created_at FROM conversation_messages WHERE id = ?)
                     ORDER BY created_at ASC`
                ).all(loop.conversation_id, ...humanSideRoles(), loop.human_message_id, nextLoop.human_message_id) as any[];
            } else {
                msgs = db.prepare(
                    `SELECT id, role, listen_count, content FROM conversation_messages
                     WHERE conversation_id = ? AND role NOT IN (${humanSideRoles().map(() => '?').join(',')})
                     AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                     ORDER BY created_at ASC`
                ).all(loop.conversation_id, ...humanSideRoles(), loop.human_message_id) as any[];
            }

            // M4: unspeakable posts are not owed — excluded from the acquittal count.
            const unlistenedCount = msgs.filter(m => (m.listen_count || 0) === 0 && speakable(m)).length;

            return {
                ...loop,
                message_count: msgs.length,
                unlistened_count: unlistenedCount,
                all_listened: msgs.length > 0 && unlistenedCount === 0,
            };
        });

        // M1: the uncovered HEAD — agent posts before the first human anchor belong to
        // no loop; they get the virtual loop, prepended (loop_number 0 sorts first).
        if (enriched.length > 0) {
            const headVirtual = virtualLoopFor(String(req.params.conversationId), enriched[0].human_message_id);
            if (headVirtual) enriched.unshift(headVirtual);
        }

        res.json({ loops: enriched });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Get messages for a specific loop
router.get('/loops/:conversationId/:loopId/messages', (req: Request, res: Response) => {
    try {
        // B1/M1: the virtual loop resolves SPAN-AWARE — head posts only when real loops
        // exist (everything before the first anchor), the whole thread when none do.
        // Tenshi nit 2: every /messages payload carries the SAME `speakable` verdict the
        // acquittal counts use, so the client's play-all filter and the server's count
        // share one definition of the set (one set, one definition).
        if (req.params.loopId === VIRTUAL_LOOP_ID) {
            const convId = String(req.params.conversationId);
            const realLoops = conversationLoopStmts.getByConversation.all(convId) as any[];
            const firstAnchor = realLoops.length > 0 ? realLoops[0].human_message_id : undefined;
            const msgs = agentMessagesForConversation(convId, true, firstAnchor)
                .map(m => ({ ...m, speakable: speakable(m) }));
            return res.json({
                loop: {
                    id: VIRTUAL_LOOP_ID,
                    conversation_id: convId,
                    virtual: true,
                },
                messages: msgs,
            });
        }

        const loop = conversationLoopStmts.getById.get(req.params.loopId) as any;
        if (!loop) return res.status(404).json({ error: 'Loop not found' });

        const allLoops = conversationLoopStmts.getByConversation.all(loop.conversation_id) as any[];
        const idx = allLoops.findIndex((l: any) => l.id === loop.id);
        const nextLoop = allLoops[idx + 1];

        let msgs: any[];
        if (nextLoop) {
            msgs = db.prepare(
                `SELECT * FROM conversation_messages
                 WHERE conversation_id = ? AND role NOT IN (${humanSideRoles().map(() => '?').join(',')})
                 AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                 AND created_at < (SELECT created_at FROM conversation_messages WHERE id = ?)
                 ORDER BY created_at ASC`
            ).all(loop.conversation_id, ...humanSideRoles(), loop.human_message_id, nextLoop.human_message_id) as any[];
        } else {
            msgs = db.prepare(
                `SELECT * FROM conversation_messages
                 WHERE conversation_id = ? AND role NOT IN (${humanSideRoles().map(() => '?').join(',')})
                 AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?)
                 ORDER BY created_at ASC`
            ).all(loop.conversation_id, ...humanSideRoles(), loop.human_message_id) as any[];
        }

        // Tenshi nit 2: same speakable verdict on the real-loop payload too.
        res.json({ loop, messages: msgs.map(m => ({ ...m, speakable: speakable(m) })) });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Update loop tag (inline edit)
router.patch('/loops/:loopId', (req: Request, res: Response) => {
    try {
        // B1: the virtual loop is not a row — nothing to edit. 400 (a KNOWN id with an
        // invalid operation — Casey's more-truthful status, Jim's ruling: keep it)…
        if (req.params.loopId === VIRTUAL_LOOP_ID) {
            return res.status(400).json({ error: 'The whole-thread loop is virtual — it has no editable tag' });
        }
        const { tag } = req.body;
        // …and M3 UNDERNEATH it: the rows-changed 404 for the UNKNOWN id. One refuses
        // what we named; the other refuses what we didn't (a silent no-op wearing a
        // {success:true} receipt was today's behaviour — Tenshi's line, Casey's law).
        const info = conversationLoopStmts.updateTag.run(tag, req.params.loopId);
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Loop not found' });
        }
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
    const instructions = getVoiceInstructions(msg.role);
    const cleanText = stripMarkdown(msg.content);
    if (!cleanText) return;

    console.log(`[Voice] Auto-generating TTS for message ${messageId} (${msg.role}, ${cleanText.length} chars)`);
    await getOrGenerateForMessage(messageId, cleanText, voice, model, instructions);
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
