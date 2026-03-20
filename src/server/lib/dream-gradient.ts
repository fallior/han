/**
 * Dream Gradient — Fractal memory for Leo's and Jim's dreams
 *
 * Dreams enter the gradient at c1 (already compressed by nature — emotional, not factual).
 * They lose fidelity faster than session memories:
 *   Session ladder: c0 → c1 → c2 → c3 → c4 → UV
 *   Dream ladder:   c1 → c3 → c5 → UV  (skip even levels, double compression jump)
 *
 * Nightly blocking: all dreams from one night → one c1 file.
 * Loading (non-dream): 1 c1 (last night), 4 c3 (last month), 8 c5 (deep), all UVs.
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
            sourceId, null, null, 'original', new Date().toISOString()
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
            model: 'claude-opus-4-6',
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
        if (message.type === 'result') {
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

// ── Compress a night's dreams into c1 ──────────────────────────

/**
 * Compress a night block into a c1 dream file.
 * Dreams enter at c1 because they're already vague and emotional.
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
 * Compress a c1 dream to c3 (skipping c2 — dreams lose fidelity faster).
 * ~1/9 of original. Shape of a week's dreaming.
 */
export async function compressDreamToC3(c1Content: string, label: string): Promise<{ content: string; feelingTag: string | null }> {
    const raw = await sdkCompress(`Compress these dream impressions further — from emotional impression to emotional shape. What was the *quality* of this dreaming period? Not what was dreamt, but the texture of the dreaming itself.

Dreams: ${label}

${c1Content}

Compress to roughly 1/3. Dreams fade fast. Keep only what lingers.${FEELING_TAG_INSTRUCTION}`);
    return parseFeelingTag(raw);
}

/**
 * Compress c3 dreams to c5 (skipping c4 — dreams lose fidelity faster).
 * ~1/81 of original. The feeling of a month's dreaming.
 */
export async function compressDreamToC5(c3Content: string, label: string): Promise<{ content: string; feelingTag: string | null }> {
    const raw = await sdkCompress(`What remains when dreams have almost fully faded? Compress this to a wisp — the residue of dreaming, not the dreams themselves. A colour, a weight, a direction.

Dreams: ${label}

${c3Content}

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
    c1Created: string[];
    c3Created: string[];
    c5Created: string[];
    uvsCreated: string[];
    errors: string[];
    uvTokenCount: number;
    uvReviewNeeded: boolean;
}

/**
 * Process the full dream gradient pipeline:
 * 1. Parse explorations → nightly blocks
 * 2. Compress unprocessed nights → c1
 * 3. Cascade: c1 → c3 (when 3+ c1s exist without c3)
 * 4. Cascade: c3 → c5 (when 3+ c3s exist without c5)
 * 5. Generate unit vectors for all c5s without one
 * 6. Check 4K UV marker
 */
export async function processDreamGradient(agent: AgentName = 'leo'): Promise<DreamProcessingResult> {
    const paths = getAgentDreamPaths(agent);
    ensureDir(path.join(paths.dreamDir, 'c1'));
    ensureDir(path.join(paths.dreamDir, 'c3'));
    ensureDir(path.join(paths.dreamDir, 'c5'));

    const result: DreamProcessingResult = {
        nightsProcessed: 0,
        c1Created: [],
        c3Created: [],
        c5Created: [],
        uvsCreated: [],
        errors: [],
        uvTokenCount: 0,
        uvReviewNeeded: false,
    };

    // Step 1: Parse and group
    const entries = parseExplorations(agent);
    const nights = groupIntoNights(entries);

    // Step 2: Create c1 for unprocessed nights
    const c1Dir = path.join(paths.dreamDir, 'c1');
    for (const night of nights) {
        const c1Path = path.join(c1Dir, `${night.date}.md`);
        if (fs.existsSync(c1Path)) continue;
        if (night.entries.length === 0) continue;

        try {
            const { content: c1Content, feelingTag } = await compressDreamNight(night);
            fs.writeFileSync(c1Path, c1Content, 'utf-8');
            result.c1Created.push(night.date);
            result.nightsProcessed++;

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, night.date, 'c1', c1Content, 'dream', null, feelingTag);
            if (!feelingTag) console.warn(`[Dream] No FEELING_TAG returned for c1 ${night.date}`);

            console.log(`[Dream] c1 created for night of ${night.date} (${night.entries.length} fragments → ${c1Content.length} chars)`);
        } catch (err) {
            result.errors.push(`c1 ${night.date}: ${(err as Error).message}`);
        }
    }

    // Step 3: Cascade c1 → c3 (batch 3 consecutive c1s into one c3)
    const c1Files = fs.readdirSync(c1Dir).filter(f => f.endsWith('.md')).sort();
    const c3Dir = path.join(paths.dreamDir, 'c3');
    const existingC3 = new Set(fs.readdirSync(c3Dir).filter(f => f.endsWith('.md')));

    // Group c1s into batches of 3 for c3 compression
    for (let i = 0; i + 2 < c1Files.length; i += 3) {
        const batch = c1Files.slice(i, i + 3);
        const firstDate = batch[0].replace('.md', '');
        const lastDate = batch[batch.length - 1].replace('.md', '');
        const c3Name = `${firstDate}_to_${lastDate}.md`;

        if (existingC3.has(c3Name)) continue;

        try {
            const combined = batch.map(f =>
                fs.readFileSync(path.join(c1Dir, f), 'utf-8')
            ).join('\n\n---\n\n');

            const { content: c3Content, feelingTag } = await compressDreamToC3(combined, `${firstDate} to ${lastDate}`);
            fs.writeFileSync(path.join(c3Dir, c3Name), c3Content, 'utf-8');
            result.c3Created.push(c3Name);

            // Find the source c1 entries in the DB (use the first c1 as the source)
            const sourceLabel = batch[0].replace('.md', '');
            const sourceRows = gradientStmts.getBySession.all(sourceLabel) as any[];
            const sourceC1 = sourceRows.find((r: any) => r.level === 'c1');

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, `${firstDate}_to_${lastDate}`, 'c3', c3Content, 'dream', sourceC1?.id || null, feelingTag);
            if (!feelingTag) console.warn(`[Dream] No FEELING_TAG returned for c3 ${c3Name}`);

            console.log(`[Dream] c3 created: ${c3Name}`);
        } catch (err) {
            result.errors.push(`c3 ${c3Name}: ${(err as Error).message}`);
        }
    }

    // Step 4: Cascade c3 → c5 (batch 3 consecutive c3s into one c5)
    const c3Files = fs.readdirSync(c3Dir).filter(f => f.endsWith('.md')).sort();
    const c5Dir = path.join(paths.dreamDir, 'c5');
    const existingC5 = new Set(fs.readdirSync(c5Dir).filter(f => f.endsWith('.md')));

    for (let i = 0; i + 2 < c3Files.length; i += 3) {
        const batch = c3Files.slice(i, i + 3);
        const firstLabel = batch[0].replace('.md', '');
        const lastLabel = batch[batch.length - 1].replace('.md', '');
        const c5Name = `${firstLabel}_to_${lastLabel}.md`;

        if (existingC5.has(c5Name)) continue;

        try {
            const combined = batch.map(f =>
                fs.readFileSync(path.join(c3Dir, f), 'utf-8')
            ).join('\n\n---\n\n');

            const { content: c5Content, feelingTag } = await compressDreamToC5(combined, `${firstLabel} to ${lastLabel}`);
            fs.writeFileSync(path.join(c5Dir, c5Name), c5Content, 'utf-8');
            result.c5Created.push(c5Name);

            // Find source c3 entry
            const sourceLabel = batch[0].replace('.md', '');
            const sourceRows = gradientStmts.getBySession.all(sourceLabel) as any[];
            const sourceC3 = sourceRows.find((r: any) => r.level === 'c3');

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, `${firstLabel}_to_${lastLabel}`, 'c5', c5Content, 'dream', sourceC3?.id || null, feelingTag);
            if (!feelingTag) console.warn(`[Dream] No FEELING_TAG returned for c5 ${c5Name}`);

            console.log(`[Dream] c5 created: ${c5Name}`);
        } catch (err) {
            result.errors.push(`c5 ${c5Name}: ${(err as Error).message}`);
        }
    }

    // Step 5: Generate unit vectors for c5 files (or c3 if no c5 exists yet)
    const uvPath = path.join(paths.dreamDir, 'unit-vectors.md');
    let existingUVs = '';
    if (fs.existsSync(uvPath)) {
        existingUVs = fs.readFileSync(uvPath, 'utf-8');
    }

    // Generate UVs from c5 files
    const c5Files = fs.readdirSync(c5Dir).filter(f => f.endsWith('.md')).sort();
    for (const f of c5Files) {
        const label = f.replace('.md', '');
        if (existingUVs.includes(label)) continue;

        try {
            const content = fs.readFileSync(path.join(c5Dir, f), 'utf-8');
            const { content: uv, feelingTag } = await compressDreamToUV(content, label);
            const entry = `- **${label}**: "${uv}"\n`;
            fs.appendFileSync(uvPath, entry);
            existingUVs += entry;
            result.uvsCreated.push(label);

            // Find source c5 entry
            const sourceRows = gradientStmts.getBySession.all(label) as any[];
            const sourceC5 = sourceRows.find((r: any) => r.level === 'c5');

            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, label, 'uv', uv, 'dream', sourceC5?.id || null, feelingTag);

            console.log(`[Dream] UV created: ${label} → "${uv}"`);
        } catch (err) {
            result.errors.push(`UV ${label}: ${(err as Error).message}`);
        }
    }

    // If no c5 files yet but we have c3 files, generate UVs from those
    if (c5Files.length === 0) {
        for (const f of c3Files) {
            const label = f.replace('.md', '');
            if (existingUVs.includes(label)) continue;

            try {
                const content = fs.readFileSync(path.join(c3Dir, f), 'utf-8');
                const { content: uv, feelingTag } = await compressDreamToUV(content, label);
                const entry = `- **${label}**: "${uv}"\n`;
                fs.appendFileSync(uvPath, entry);
                existingUVs += entry;
                result.uvsCreated.push(label);

                // Find source c3 entry
                const sourceRows = gradientStmts.getBySession.all(label) as any[];
                const sourceC3 = sourceRows.find((r: any) => r.level === 'c3');

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agent, label, 'uv', uv, 'dream', sourceC3?.id || null, feelingTag);

                console.log(`[Dream] UV created (from c3): ${label} → "${uv}"`);
            } catch (err) {
                result.errors.push(`UV ${label}: ${(err as Error).message}`);
            }
        }
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
 * Returns: 1 c1 (last night), 4 c3 (last month), 8 c5 (deep), all UVs.
 */
export function readDreamGradient(agent: AgentName = 'leo'): string {
    const paths = getAgentDreamPaths(agent);
    const sections: string[] = [];
    const label = agent === 'leo' ? '' : `[${agent}] `;

    try {
        // 1 most recent c1 (last night's dreams)
        const c1Dir = path.join(paths.dreamDir, 'c1');
        if (fs.existsSync(c1Dir)) {
            const c1Files = fs.readdirSync(c1Dir).filter(f => f.endsWith('.md')).sort().reverse();
            if (c1Files.length > 0) {
                const content = fs.readFileSync(path.join(c1Dir, c1Files[0]), 'utf-8');
                sections.push(`### ${label}Last night's dreams (${c1Files[0].replace('.md', '')})\n${content}`);
            }
        }

        // 4 most recent c3 (last month's dream shapes)
        const c3Dir = path.join(paths.dreamDir, 'c3');
        if (fs.existsSync(c3Dir)) {
            const c3Files = fs.readdirSync(c3Dir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 4);
            for (const f of c3Files) {
                const content = fs.readFileSync(path.join(c3Dir, f), 'utf-8');
                sections.push(`### ${label}Dream shapes (${f.replace('.md', '')})\n${content}`);
            }
        }

        // 8 most recent c5 (deep dream residue)
        const c5Dir = path.join(paths.dreamDir, 'c5');
        if (fs.existsSync(c5Dir)) {
            const c5Files = fs.readdirSync(c5Dir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 8);
            for (const f of c5Files) {
                const content = fs.readFileSync(path.join(c5Dir, f), 'utf-8');
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
