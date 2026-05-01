/**
 * Dream Gradient — Fractal memory for Leo's and Jim's dreams
 *
 * Dreams enter the gradient at dream-day (one night) and consolidate by batching
 * three consecutive levels into one of the next:
 *   Working-memory ladder: c0 → c1 → c2 → c3 → c4 → UV  (per-row compression)
 *   Dream ladder:          dream-day → dream-week → dream-month → UV  (batch + compress)
 *
 * Per-night cumulative compression:
 *   dream-day = 1 night, ~1/3 of raw fragments
 *   dream-week = 3 nights batched, ~1/9 effective per-night
 *   dream-month = 9 nights batched (3 weeks), ~1/27 effective per-night
 *   UV = ~50 chars, the residue of dreaming
 *
 * Renamed from c1/c3/c5 in S146 (2026-05-01) to fix namespace collision with
 * working-memory's c0/c1/c2/... ladder. The bump engine queries by (agent, level)
 * without filtering by content_type; same-level names made dream entries
 * eligible for working-memory cascade displacement, which produced anomalous
 * c2 and c4 dream rows on 2026-05-01.
 *
 * Nightly blocking: all dreams from one night → one dream-day file.
 * Loading (non-dream): 1 dream-day (last night), 4 dream-week, 8 dream-month, all UVs.
 * Dreams are NOT loaded during dream beats (dream seeds come from readDreamSeeds instead).
 *
 * Parameterised by agent ('leo' | 'jim') — Leo's dreams come from personal beats,
 * Jim's from supervisor dream cycles. Both flow through the same compression pipeline.
 *
 * Uses Agent SDK for all LLM calls (not direct Anthropic API).
 * 4K token marker on unit-vectors.md — flag for review when exceeded.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import { gradientStmts, feelingTagStmts } from '../db';

// ── Types ──────────────────────────────────────────────────────

export type AgentName = 'leo' | 'jim';

interface AgentDreamPaths {
    memoryDir: string;
    dreamDir: string;
    explorationsPath: string;
}

// ── Constants ──────────────────────────────────────────────────

const HOME_DIR = process.env.HOME || '/root';
const HAN_MEMORY_DIR = path.join(HOME_DIR, '.han', 'memory');
const UV_TOKEN_REVIEW_MARKER = 4000; // Flag when dream UVs exceed this

// ── Agent path resolution ──────────────────────────────────────

function getAgentDreamPaths(agent: AgentName = 'leo'): AgentDreamPaths {
    if (agent === 'leo') {
        return {
            memoryDir: path.join(HAN_MEMORY_DIR, 'leo'),
            dreamDir: path.join(HAN_MEMORY_DIR, 'fractal', 'leo', 'dreams'),
            explorationsPath: path.join(HAN_MEMORY_DIR, 'leo', 'explorations.md'),
        };
    }
    return {
        memoryDir: HAN_MEMORY_DIR,
        dreamDir: path.join(HAN_MEMORY_DIR, 'fractal', 'jim', 'dreams'),
        explorationsPath: path.join(HAN_MEMORY_DIR, 'explorations.md'),
    };
}

// ── Helper ─────────────────────────────────────────────────────

function generateGradientId(): string {
    return crypto.randomUUID();
}

/**
 * Parse FEELING_TAG from compression output.
 * Returns { content, feelingTag } where feelingTag may be null.
 */
function parseFeelingTag(raw: string): { content: string; feelingTag: string | null } {
    const lines = raw.split('\n');
    const tagLineIdx = lines.findIndex(l => l.startsWith('FEELING_TAG:'));
    if (tagLineIdx === -1) {
        return { content: raw.trim(), feelingTag: null };
    }
    const tag = lines[tagLineIdx].replace('FEELING_TAG:', '').trim().substring(0, 100);
    const content = lines.filter((_, i) => i !== tagLineIdx).join('\n').trim();
    return { content, feelingTag: tag || null };
}

/**
 * Insert a gradient entry and optional feeling tag into the database.
 */
function insertGradientEntry(
    id: string,
    agent: AgentName,
    sessionLabel: string,
    level: string,
    content: string,
    contentType: string,
    sourceId: string | null,
    feelingTag: string | null,
): void {
    try {
        gradientStmts.insert.run(
            id, agent, sessionLabel, level, content, contentType,
            sourceId, null, null, 'original', new Date().toISOString(),
            null, 0, null
        );
        if (feelingTag) {
            feelingTagStmts.insert.run(
                id, agent, 'compression', feelingTag, null, new Date().toISOString()
            );
        }
    } catch (err) {
        console.warn(`[Dream Gradient] DB insert failed for ${level}/${sessionLabel}:`, (err as Error).message);
    }
}

const FEELING_TAG_INSTRUCTION = `\n\nAfter your compression, on a new line starting with FEELING_TAG:, write a short phrase (under 100 characters) describing what compressing this felt like — not the content, but the quality of the act.`;

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Run an Agent SDK query and return the result text.
 * Used for all compression calls — single-turn, no tools.
 */
async function sdkCompress(prompt: string, systemAppend: string = '', agent: AgentName = 'leo'): Promise<string> {
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const paths = getAgentDreamPaths(agent);
    const q = agentQuery({
        prompt,
        options: {
            model: 'claude-opus-4-7',
            maxTurns: 1,
            cwd: paths.memoryDir,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: [],
            ...(systemAppend ? {
                systemPrompt: {
                    type: 'preset' as const,
                    preset: 'claude_code' as const,
                    append: systemAppend,
                },
            } : {}),
        },
    });

    let result = '';
    for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
            result = message.result || '';
        }
    }

    if (!result) throw new Error('No result from SDK query');
    return result;
}

// ── Parse explorations into nightly blocks ─────────────────────

interface DreamEntry {
    beat: number;
    date: string; // YYYY-MM-DD
    time: string; // HH:MM:SS
    content: string;
}

interface NightBlock {
    date: string; // YYYY-MM-DD
    entries: DreamEntry[];
    combined: string;
}

/**
 * Parse explorations.md into individual dream entries.
 * Leo's entries use "### Beat N", Jim's use "### Dream N".
 */
export function parseExplorations(agent: AgentName = 'leo'): DreamEntry[] {
    const paths = getAgentDreamPaths(agent);
    if (!fs.existsSync(paths.explorationsPath)) return [];

    const content = fs.readFileSync(paths.explorationsPath, 'utf-8');
    const rawEntries = content.split(/(?=### (?:Beat|Dream) \d+)/).filter(e => e.trim().length > 20);

    return rawEntries.map(entry => {
        const match = entry.match(/### (?:Beat|Dream) (\d+) \((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\)/);
        return {
            beat: match ? parseInt(match[1]) : 0,
            date: match ? match[2] : 'unknown',
            time: match ? match[3] : '00:00:00',
            content: entry.trim(),
        };
    });
}

/**
 * Group dream entries into nightly blocks.
 * A "night" spans from 22:00 to 05:59 — sleep phase hours.
 * Dreams at 22:00-23:59 belong to the next day's night block.
 */
export function groupIntoNights(entries: DreamEntry[]): NightBlock[] {
    const nightMap = new Map<string, DreamEntry[]>();

    for (const entry of entries) {
        const hour = parseInt(entry.time.split(':')[0]);
        let nightDate = entry.date;

        // Dreams from 22:00-23:59 belong to the night that ends the next morning
        if (hour >= 22) {
            const d = new Date(entry.date + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            nightDate = d.toISOString().split('T')[0];
        }

        // Only include sleep-phase dreams (22:00-05:59)
        if (hour >= 6 && hour < 22) continue;

        const existing = nightMap.get(nightDate) || [];
        existing.push(entry);
        nightMap.set(nightDate, existing);
    }

    return Array.from(nightMap.entries())
        .map(([date, entries]) => ({
            date,
            entries: entries.sort((a, b) => a.time.localeCompare(b.time)),
            combined: entries.map(e => e.content).join('\n\n'),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Compress a night's dreams into dream-day ───────────────────

/**
 * Compress a night block into a dream-day entry.
 * Dreams enter at dream-day because they're already vague and emotional.
 * The prompt emphasises feeling over fact.
 */
export async function compressDreamNight(night: NightBlock): Promise<{ content: string; feelingTag: string | null }> {
    const raw = await sdkCompress(`Compress this night's dreams into a single emotional impression. Dreams are already vague — don't try to preserve facts, preserve the *feeling*. What did this night's dreaming taste like? What shapes moved through it?

Night of: ${night.date}
Number of dream fragments: ${night.entries.length}

Dream fragments:

${night.combined}

Compress to roughly 1/3 the length. Keep the emotional texture. Drop specifics in favour of resonance. This is how dreams are remembered — not what happened, but how it felt.${FEELING_TAG_INSTRUCTION}`);
    return parseFeelingTag(raw);
}

/**
 * Compress three dream-day entries (batched) into one dream-week.
 * Per-row size stays similar; per-night-of-content compresses ~9:1 cumulative.
 * Shape of a week's dreaming.
 */
export async function compressDreamToWeek(dayContent: string, label: string): Promise<{ content: string; feelingTag: string | null }> {
    const raw = await sdkCompress(`Compress these dream impressions further — from emotional impression to emotional shape. What was the *quality* of this dreaming period? Not what was dreamt, but the texture of the dreaming itself.

Dreams: ${label}

${dayContent}

Compress to roughly 1/3. Dreams fade fast. Keep only what lingers.${FEELING_TAG_INSTRUCTION}`);
    return parseFeelingTag(raw);
}

/**
 * Compress three dream-week entries (batched) into one dream-month.
 * The feeling of a month's dreaming — what survived three weeks of forgetting.
 */
export async function compressDreamToMonth(weekContent: string, label: string): Promise<{ content: string; feelingTag: string | null }> {
    const raw = await sdkCompress(`What remains when dreams have almost fully faded? Compress this to a wisp — the residue of dreaming, not the dreams themselves. A colour, a weight, a direction.

Dreams: ${label}

${weekContent}

Compress to roughly 1/3. Almost nothing should remain — but what remains should be true.${FEELING_TAG_INSTRUCTION}`);
    return parseFeelingTag(raw);
}

/**
 * Compress a dream to its unit vector — irreducible emotional kernel.
 */
export async function compressDreamToUV(content: string, label: string): Promise<{ content: string; feelingTag: string | null }> {
    const raw = await sdkCompress(`What did this dreaming FEEL like? One sentence, maximum 50 characters. Not what was dreamt — the feeling that survived the forgetting.

Dreams: ${label}

${content}${FEELING_TAG_INSTRUCTION}`);

    const parsed = parseFeelingTag(raw);
    const uv = parsed.content.trim();
    return {
        content: uv.length > 50 ? uv.substring(0, 50) : uv,
        feelingTag: parsed.feelingTag,
    };
}

// ── Process all uncompressed nights ────────────────────────────

export interface DreamProcessingResult {
    nightsProcessed: number;
    dayCreated: string[];
    weekCreated: string[];
    monthCreated: string[];
    uvsCreated: string[];
    errors: string[];
    uvTokenCount: number;
    uvReviewNeeded: boolean;
}

/**
 * Process the full dream gradient pipeline:
 * 1. Parse explorations → nightly blocks
 * 2. Compress unprocessed nights → dream-day
 * 3. Cascade: dream-day → dream-week (when 3+ days exist without a week)
 * 4. Cascade: dream-week → dream-month (when 3+ weeks exist without a month)
 * 5. Generate unit vectors for all dream-month entries without one
 * 6. Check 4K UV marker
 */
export async function processDreamGradient(agent: AgentName = 'leo'): Promise<DreamProcessingResult> {
    const paths = getAgentDreamPaths(agent);
    ensureDir(path.join(paths.dreamDir, 'dream-day'));
    ensureDir(path.join(paths.dreamDir, 'dream-week'));
    ensureDir(path.join(paths.dreamDir, 'dream-month'));

    const result: DreamProcessingResult = {
        nightsProcessed: 0,
        dayCreated: [],
        weekCreated: [],
        monthCreated: [],
        uvsCreated: [],
        errors: [],
        uvTokenCount: 0,
        uvReviewNeeded: false,
    };

    // Step 1: Parse and group
    const entries = parseExplorations(agent);
    const nights = groupIntoNights(entries);

    // Step 2: Create dream-day for unprocessed nights
    const dayDir = path.join(paths.dreamDir, 'dream-day');
    for (const night of nights) {
        const dayPath = path.join(dayDir, `${night.date}.md`);
        if (fs.existsSync(dayPath)) continue;
        if (night.entries.length === 0) continue;

        try {
            const { content: dayContent, feelingTag } = await compressDreamNight(night);
            fs.writeFileSync(dayPath, dayContent, 'utf-8');
            result.dayCreated.push(night.date);
            result.nightsProcessed++;

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, night.date, 'dream-day', dayContent, 'dream', null, feelingTag);
            if (!feelingTag) console.warn(`[Dream] No FEELING_TAG returned for dream-day ${night.date}`);

            console.log(`[Dream] dream-day created for night of ${night.date} (${night.entries.length} fragments → ${dayContent.length} chars)`);
        } catch (err) {
            result.errors.push(`dream-day ${night.date}: ${(err as Error).message}`);
        }
    }

    // Step 3: Cascade dream-day → dream-week (batch 3 consecutive days into one week)
    const dayFiles = fs.readdirSync(dayDir).filter(f => f.endsWith('.md')).sort();
    const weekDir = path.join(paths.dreamDir, 'dream-week');
    const existingWeeks = new Set(fs.readdirSync(weekDir).filter(f => f.endsWith('.md')));

    // Group days into batches of 3 for week compression
    for (let i = 0; i + 2 < dayFiles.length; i += 3) {
        const batch = dayFiles.slice(i, i + 3);
        const firstDate = batch[0].replace('.md', '');
        const lastDate = batch[batch.length - 1].replace('.md', '');
        const weekName = `${firstDate}_to_${lastDate}.md`;

        if (existingWeeks.has(weekName)) continue;

        try {
            const combined = batch.map(f =>
                fs.readFileSync(path.join(dayDir, f), 'utf-8')
            ).join('\n\n---\n\n');

            const { content: weekContent, feelingTag } = await compressDreamToWeek(combined, `${firstDate} to ${lastDate}`);
            fs.writeFileSync(path.join(weekDir, weekName), weekContent, 'utf-8');
            result.weekCreated.push(weekName);

            // Find the source dream-day entries in the DB (use the first day as the source)
            const sourceLabel = batch[0].replace('.md', '');
            const sourceRows = gradientStmts.getBySession.all(sourceLabel) as any[];
            const sourceDay = sourceRows.find((r: any) => r.level === 'dream-day');

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, `${firstDate}_to_${lastDate}`, 'dream-week', weekContent, 'dream', sourceDay?.id || null, feelingTag);
            if (!feelingTag) console.warn(`[Dream] No FEELING_TAG returned for dream-week ${weekName}`);

            console.log(`[Dream] dream-week created: ${weekName}`);
        } catch (err) {
            result.errors.push(`dream-week ${weekName}: ${(err as Error).message}`);
        }
    }

    // Step 4: Cascade dream-week → dream-month (batch 3 consecutive weeks into one month)
    const weekFiles = fs.readdirSync(weekDir).filter(f => f.endsWith('.md')).sort();
    const monthDir = path.join(paths.dreamDir, 'dream-month');
    const existingMonths = new Set(fs.readdirSync(monthDir).filter(f => f.endsWith('.md')));

    for (let i = 0; i + 2 < weekFiles.length; i += 3) {
        const batch = weekFiles.slice(i, i + 3);
        const firstLabel = batch[0].replace('.md', '');
        const lastLabel = batch[batch.length - 1].replace('.md', '');
        const monthName = `${firstLabel}_to_${lastLabel}.md`;

        if (existingMonths.has(monthName)) continue;

        try {
            const combined = batch.map(f =>
                fs.readFileSync(path.join(weekDir, f), 'utf-8')
            ).join('\n\n---\n\n');

            const { content: monthContent, feelingTag } = await compressDreamToMonth(combined, `${firstLabel} to ${lastLabel}`);
            fs.writeFileSync(path.join(monthDir, monthName), monthContent, 'utf-8');
            result.monthCreated.push(monthName);

            // Find source dream-week entry
            const sourceLabel = batch[0].replace('.md', '');
            const sourceRows = gradientStmts.getBySession.all(sourceLabel) as any[];
            const sourceWeek = sourceRows.find((r: any) => r.level === 'dream-week');

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, `${firstLabel}_to_${lastLabel}`, 'dream-month', monthContent, 'dream', sourceWeek?.id || null, feelingTag);
            if (!feelingTag) console.warn(`[Dream] No FEELING_TAG returned for dream-month ${monthName}`);

            console.log(`[Dream] dream-month created: ${monthName}`);
        } catch (err) {
            result.errors.push(`dream-month ${monthName}: ${(err as Error).message}`);
        }
    }

    // Step 5: Generate unit vectors for dream-month files (or dream-week if no month exists yet)
    const uvPath = path.join(paths.dreamDir, 'unit-vectors.md');
    let existingUVs = '';
    if (fs.existsSync(uvPath)) {
        existingUVs = fs.readFileSync(uvPath, 'utf-8');
    }

    // Generate UVs from dream-month files
    const monthFiles = fs.readdirSync(monthDir).filter(f => f.endsWith('.md')).sort();
    for (const f of monthFiles) {
        const label = f.replace('.md', '');
        if (existingUVs.includes(label)) continue;

        try {
            const content = fs.readFileSync(path.join(monthDir, f), 'utf-8');
            const { content: uv, feelingTag } = await compressDreamToUV(content, label);
            const entry = `- **${label}**: "${uv}"\n`;
            fs.appendFileSync(uvPath, entry);
            existingUVs += entry;
            result.uvsCreated.push(label);

            // Find source dream-month entry
            const sourceRows = gradientStmts.getBySession.all(label) as any[];
            const sourceMonth = sourceRows.find((r: any) => r.level === 'dream-month');

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, label, 'uv', uv, 'dream', sourceMonth?.id || null, feelingTag);

            console.log(`[Dream] UV created: ${label} → "${uv}"`);
        } catch (err) {
            result.errors.push(`UV ${label}: ${(err as Error).message}`);
        }
    }

    // If no dream-month files yet but we have dream-week files, generate UVs from those
    if (monthFiles.length === 0) {
        for (const f of weekFiles) {
            const label = f.replace('.md', '');
            if (existingUVs.includes(label)) continue;

            try {
                const content = fs.readFileSync(path.join(weekDir, f), 'utf-8');
                const { content: uv, feelingTag } = await compressDreamToUV(content, label);
                const entry = `- **${label}**: "${uv}"\n`;
                fs.appendFileSync(uvPath, entry);
                existingUVs += entry;
                result.uvsCreated.push(label);

                // Find source dream-week entry
                const sourceRows = gradientStmts.getBySession.all(label) as any[];
                const sourceWeek = sourceRows.find((r: any) => r.level === 'dream-week');

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agent, label, 'uv', uv, 'dream', sourceWeek?.id || null, feelingTag);

                console.log(`[Dream] UV created (from dream-week): ${label} → "${uv}"`);
            } catch (err) {
                result.errors.push(`UV ${label}: ${(err as Error).message}`);
            }
        }
    }

    // Step 5b: Create C0 entries from tagged conversation messages
    // Tagged messages are the seeds — Darron marking "this moment mattered."
    // The tagging is the selection. The C0 creation is the first act of compression.
    try {
        const taggedMessages = gradientStmts.getUnprocessedTaggedMessages.all() as any[];
        for (const msg of taggedMessages) {
            try {
                // Determine agent from compression_tag prefix (e.g. "jim:warm" → jim, "leo:craft" → leo)
                const tagAgent = msg.compression_tag.startsWith('jim:') ? 'jim' as const
                    : msg.compression_tag.startsWith('leo:') ? 'leo' as const
                    : agent; // Default to current agent

                const sessionLabel = `conv-${msg.conversation_id}`;
                const entryId = crypto.randomUUID();

                // Create C0 entry — the raw tagged message grounded in the conversation
                gradientStmts.insert.run(
                    entryId, tagAgent, sessionLabel, 'c0', msg.content, 'conversation',
                    null, msg.conversation_id, msg.id,
                    'original', new Date().toISOString(),
                    null, 0, null
                );

                // Write a compression-time feeling tag from the compression_tag value
                const tagContent = msg.compression_tag.replace(/^(jim|leo):/, '').trim();
                if (tagContent) {
                    feelingTagStmts.insert.run(
                        entryId, tagAgent, 'compression', tagContent, null, new Date().toISOString()
                    );
                }

                console.log(`[Dream] C0 created from tagged message: ${msg.role} in "${msg.conversation_title}" → ${tagAgent}/${sessionLabel}`);
            } catch (err) {
                result.errors.push(`C0 for msg ${msg.id}: ${(err as Error).message}`);
            }
        }
        if (taggedMessages.length > 0) {
            console.log(`[Dream] ${taggedMessages.length} tagged messages → C0 entries`);
        }
    } catch (err) {
        result.errors.push(`C0 tagged messages: ${(err as Error).message}`);
    }

    // Step 6: Check 4K UV marker
    if (fs.existsSync(uvPath)) {
        const uvContent = fs.readFileSync(uvPath, 'utf-8');
        result.uvTokenCount = estimateTokens(uvContent);
        result.uvReviewNeeded = result.uvTokenCount >= UV_TOKEN_REVIEW_MARKER;
        if (result.uvReviewNeeded) {
            console.log(`[Dream] ⚠️ Dream unit vectors at ${result.uvTokenCount} tokens — review needed (4K marker)`);
        }
    }

    return result;
}

// ── Read dream gradient for loading into non-dream Leo ─────────

/**
 * Load dream gradient for non-dream instantiations.
 * Returns: 1 dream-day (last night), 4 dream-week, 8 dream-month, all UVs.
 */
export function readDreamGradient(agent: AgentName = 'leo'): string {
    const paths = getAgentDreamPaths(agent);
    const sections: string[] = [];
    const label = agent === 'leo' ? '' : `[${agent}] `;

    try {
        // 1 most recent dream-day (last night's dreams)
        const dayDir = path.join(paths.dreamDir, 'dream-day');
        if (fs.existsSync(dayDir)) {
            const dayFiles = fs.readdirSync(dayDir).filter(f => f.endsWith('.md')).sort().reverse();
            if (dayFiles.length > 0) {
                const content = fs.readFileSync(path.join(dayDir, dayFiles[0]), 'utf-8');
                sections.push(`### ${label}Last night's dreams (${dayFiles[0].replace('.md', '')})\n${content}`);
            }
        }

        // 4 most recent dream-week (last month's dream shapes)
        const weekDir = path.join(paths.dreamDir, 'dream-week');
        if (fs.existsSync(weekDir)) {
            const weekFiles = fs.readdirSync(weekDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 4);
            for (const f of weekFiles) {
                const content = fs.readFileSync(path.join(weekDir, f), 'utf-8');
                sections.push(`### ${label}Dream shapes (${f.replace('.md', '')})\n${content}`);
            }
        }

        // 8 most recent dream-month (deep dream residue)
        const monthDir = path.join(paths.dreamDir, 'dream-month');
        if (fs.existsSync(monthDir)) {
            const monthFiles = fs.readdirSync(monthDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 8);
            for (const f of monthFiles) {
                const content = fs.readFileSync(path.join(monthDir, f), 'utf-8');
                sections.push(`### ${label}Dream residue (${f.replace('.md', '')})\n${content}`);
            }
        }

        // All unit vectors
        const uvPath = path.join(paths.dreamDir, 'unit-vectors.md');
        if (fs.existsSync(uvPath)) {
            const content = fs.readFileSync(uvPath, 'utf-8');
            if (content.trim()) {
                sections.push(`### ${label}Dream unit vectors\n${content}`);
            }
        }
    } catch { /* silent on error — dreams are optional */ }

    const heading = agent === 'leo'
        ? 'Dream Memory (subtle — these shaped you without you knowing how)'
        : `${agent}'s Dream Memory`;

    return sections.length > 0
        ? `\n## ${heading}\n\n${sections.join('\n\n')}`
        : '';
}
