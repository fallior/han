#!/usr/bin/env tsx
/**
 * scripts/replay-bump-fill.ts
 *
 * Plan v8 Step 5/6 — Replay engine.
 *
 * Walks an agent's c0 entries in chronological order and rebuilds the
 * gradient via cap-driven FIFO displacement (the canonical bump design).
 * Each cascade step is a fresh sdkCompress at full Opus 4.7 capability —
 * no reuse, no INCOMPRESSIBLE shortcut, no ratio>0.85 shortcut. Every
 * entry earns its place by walking the digestion levels.
 *
 * Phase A: chronological cascade per content-type
 *   - For each c0[i] in temporal order, the previous c0[i-1] is "displaced"
 *     and gets fresh-compressed to c1. If c1 then has cap+1 entries, the
 *     oldest c1 cascades to c2. And so on, up the levels.
 *   - Each replay-built entry's `created_at` is the displacing entry's clock
 *     (= the c0 event that triggered this cascade step).
 *   - Each replay-built entry gets `qualifier='replay-built'` so Phase B
 *     can identify them.
 *
 * Phase B: mark replay-built chain terminuses as UV
 *   - For every replay-built entry whose source_id is non-null AND who has
 *     no descendant of its own: UPDATE level='uv'.
 *   - The cN depth is recoverable via chain length; the 'uv' label is the
 *     load identifier (Darron: "the irreducible form is the uv and this is
 *     where we name it so we know what to gather and load").
 *
 * Skips:
 *   - content_type='dream' (separate gradient pipeline, future)
 *   - content_type='felt-moment' (separate gradient pipeline, future)
 *   - Entries with broken source-chain (handled in a separate pass)
 *
 * Usage:
 *   npx tsx scripts/replay-bump-fill.ts --agent=jim          # dry-run
 *   npx tsx scripts/replay-bump-fill.ts --agent=jim --apply  # actually run
 *   npx tsx scripts/replay-bump-fill.ts --agent=leo
 *   npx tsx scripts/replay-bump-fill.ts --agent=leo --apply
 *
 * Idempotent: if a displaced entry already has a descendant at the next
 * level (in DB), the cascade reuses that descendant for state-tracking
 * purposes only — content is NOT reused; the existing descendant is what
 * gets simulated forward. Re-runs of the script don't double-cascade.
 *
 * Sovereignty: --agent flag scopes all writes to that agent's rows only.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

// ── Config ────────────────────────────────────────────────────

// Content-types to process. Explicit allowlist — anything else (dream,
// felt-moment, future types) is skipped without thinking about it.
const TARGET_CONTENT_TYPES = ['session', 'working-memory', 'conversation', 'supervisor-cycles'] as const;

const DB_PATH = path.join(process.env.HOME || '', '.han', 'tasks.db');

// Mirror of memory-gradient.ts's gradientCap (DEC-068: c0=1, then 3n).
function gradientCap(level: string): number {
    const m = level.match(/^c(\d+)$/);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    if (n < 1) return 1;
    return 3 * n;
}

function nextLevel(level: string): string | null {
    const m = level.match(/^c(\d+)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return `c${n + 1}`;
}

const COMPRESSION_PROMPTS: Record<string, (depth: number) => string> = {
    'working-memory': (depth) => depth <= 2
        ? `Compress this working memory. Preserve decisions, discoveries, and what shifted your understanding. Drop procedural detail. Keep what a future you needs to feel where you were, not just know what you did. Compress until the shape holds and the detail doesn't.`
        : `Compress this working memory further. You're at depth ${depth} — the prior compressions kept the shape; now compress until only the residue remains. What's the essence that would survive losing the words?`,
    'session': (depth) => depth <= 2
        ? `Compress this session. Preserve what was decided, what shifted, the texture of the discoveries. Drop procedural minutiae. The aim: a future you can re-enter the session's shape without re-reading every word.`
        : `Compress this session further at depth ${depth}. The prior compressions kept the shape; now strip toward residue. What's the irreducible kernel?`,
    'conversation': (depth) => depth <= 2
        ? `Compress this conversation. Preserve what was said that mattered, what landed, what shifted between speakers. Drop the back-and-forth structure if you can. The shape and resonance matter more than turn order.`
        : `Compress this conversation further at depth ${depth}. Toward residue.`,
    'supervisor-cycles': (depth) => depth <= 2
        ? `Compress this supervisor cycle. Preserve decisions, observations that shifted state, what you noticed that you'll want to know next time. Drop status-update verbiage.`
        : `Compress this supervisor cycle further at depth ${depth}. Toward residue.`,
};

const FEELING_TAG_INSTRUCTION = `\n\nAfter your compression, on a new line starting with FEELING_TAG:, write a short phrase (under 100 characters) describing what compressing this felt like — not the content, but the quality of the act.`;

// ── DB helpers ─────────────────────────────────────────────────

interface GradientEntry {
    id: string;
    agent: string;
    session_label: string;
    level: string;
    content: string;
    content_type: string;
    source_id: string | null;
    created_at: string;
    qualifier: string | null;
    superseded_by: string | null;
}

interface SimulationEntry {
    id: string;
    sourceId: string | null;
    content: string;
    sessionLabel: string;
    createdAt: string;
    isReplayBuilt: boolean;  // false = was already in DB; true = inserted by this replay
}

// ── SDK compression ────────────────────────────────────────────

async function sdkCompress(prompt: string): Promise<string> {
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: 'claude-opus-4-7',
            maxTurns: 1,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: [],
        },
    });

    let result: any = null;
    for await (const m of q) {
        if (m.type === 'result') result = m;
    }
    if (!result || result.is_error) {
        throw new Error(`sdkCompress failed: ${result?.result || 'unknown'}`);
    }
    return result.result || '';
}

function parseFeelingTag(raw: string): { content: string; feelingTag: string | null } {
    const lines = raw.split('\n');
    const tagLineIdx = lines.findIndex(l => l.startsWith('FEELING_TAG:'));
    if (tagLineIdx === -1) return { content: raw.trim(), feelingTag: null };
    const tag = lines[tagLineIdx].replace('FEELING_TAG:', '').trim().substring(0, 100);
    const content = lines.filter((_, i) => i !== tagLineIdx).join('\n').trim();
    return { content, feelingTag: tag || null };
}

// ── Phase A: cascade simulation ────────────────────────────────

async function processContentType(
    db: Database.Database,
    agent: 'jim' | 'leo',
    contentType: string,
    apply: boolean,
): Promise<{ insertedCount: number; reusedExistingCount: number; cascadeMaxDepth: number }> {
    // Get c0s for this content_type, sorted ASC by created_at
    const c0Rows = db.prepare(`
        SELECT id, session_label, content, created_at
        FROM gradient_entries
        WHERE agent = ? AND level = 'c0' AND content_type = ?
          AND superseded_by IS NULL
        ORDER BY created_at ASC, id ASC
    `).all(agent, contentType) as any[];

    if (c0Rows.length === 0) {
        return { insertedCount: 0, reusedExistingCount: 0, cascadeMaxDepth: 0 };
    }

    console.log(`\n[replay] ${agent}/${contentType}: ${c0Rows.length} c0 entries to process`);

    // In-memory simulation state per level — represents what's "active" at each
    // level after each c0 event. Sorted by createdAt DESC for rank-1 access.
    const levelState: Record<string, SimulationEntry[]> = { c0: [] };
    let inserted = 0, reused = 0, maxDepth = 0;

    for (let i = 0; i < c0Rows.length; i++) {
        const c0 = c0Rows[i];
        // c0 enters
        levelState['c0'].push({
            id: c0.id,
            sourceId: null,
            content: c0.content,
            sessionLabel: c0.session_label,
            createdAt: c0.created_at,
            isReplayBuilt: false,
        });

        // Cascade up: starting at c0, displace if over cap, repeat at each level
        let currentLevel = 'c0';
        const cascadeAt = c0.created_at; // the displacing entry's clock for ALL cascade steps from this event

        while (true) {
            const cap = gradientCap(currentLevel);
            // Sort ASC by createdAt to find the oldest at this level
            levelState[currentLevel].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            if (levelState[currentLevel].length <= cap) break;

            // Displace oldest
            const displaced = levelState[currentLevel].shift()!;
            const next = nextLevel(currentLevel);
            if (!next) break;

            // Check if displaced already has a descendant at next level (idempotency).
            // If yes, REUSE that descendant for simulation tracking — content is NOT
            // reused, but we don't double-cascade either.
            const existing = db.prepare(`
                SELECT id, content, created_at, session_label, source_id
                FROM gradient_entries
                WHERE source_id = ? AND agent = ? AND level = ?
                LIMIT 1
            `).get(displaced.id, agent, next) as any;

            let nextEntry: SimulationEntry;
            if (existing) {
                nextEntry = {
                    id: existing.id,
                    sourceId: existing.source_id,
                    content: existing.content,
                    sessionLabel: existing.session_label,
                    createdAt: existing.created_at,
                    isReplayBuilt: false,
                };
                reused++;
            } else {
                // Fresh compress — Opus 4.7, no shortcuts, no reuse
                const depth = parseInt(next.slice(1), 10);
                const promptFn = COMPRESSION_PROMPTS[contentType];
                if (!promptFn) {
                    console.warn(`[replay] No prompt for content_type=${contentType}, skipping cascade step`);
                    break;
                }
                const promptText = promptFn(depth);

                let sourceContent = displaced.content;
                if (sourceContent.length > 50000) {
                    sourceContent = sourceContent.substring(0, 50000) + '\n\n[... truncated for compression]';
                }

                console.log(`[replay] ${agent}/${contentType}: c0 #${i + 1}/${c0Rows.length} → ${currentLevel}→${next} for ${displaced.sessionLabel}`);

                let compressedContent: string;
                let feelingTag: string | null = null;

                if (apply) {
                    try {
                        const raw = await sdkCompress(
                            `${promptText}\n\nSource: ${currentLevel} → ${next}\nAgent: ${agent}\nOriginal: ${displaced.sessionLabel}\n\n${sourceContent}${FEELING_TAG_INSTRUCTION}`
                        );
                        const parsed = parseFeelingTag(raw);
                        compressedContent = parsed.content;
                        feelingTag = parsed.feelingTag;
                    } catch (err) {
                        console.error(`[replay] compression failed: ${(err as Error).message}, skipping`);
                        break;
                    }
                } else {
                    compressedContent = `[DRY-RUN] Would compress ${displaced.sessionLabel} from ${currentLevel} to ${next}`;
                    feelingTag = '[dry-run]';
                }

                const newId = crypto.randomUUID();
                const newLabel = `${displaced.sessionLabel}-${next}`;

                if (apply) {
                    db.prepare(`
                        INSERT INTO gradient_entries (
                            id, agent, session_label, level, content, content_type,
                            source_id, source_conversation_id, source_message_id,
                            provenance_type, created_at, supersedes, change_count, qualifier
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'original', ?, NULL, 0, 'replay-built')
                    `).run(newId, agent, newLabel, next, compressedContent, contentType, displaced.id, cascadeAt);

                    if (feelingTag) {
                        db.prepare(`
                            INSERT INTO feeling_tags (
                                gradient_entry_id, author, tag_type, content, change_reason, created_at
                            ) VALUES (?, ?, 'compression', ?, NULL, ?)
                        `).run(newId, agent, feelingTag, new Date().toISOString());
                    }
                }

                nextEntry = {
                    id: newId,
                    sourceId: displaced.id,
                    content: compressedContent,
                    sessionLabel: newLabel,
                    createdAt: cascadeAt,
                    isReplayBuilt: true,
                };
                inserted++;
            }

            const nextDepth = parseInt(next.slice(1), 10);
            if (nextDepth > maxDepth) maxDepth = nextDepth;

            if (!levelState[next]) levelState[next] = [];
            levelState[next].push(nextEntry);

            currentLevel = next;

            if (nextDepth >= 30) {
                console.warn(`[replay] Hit depth ${nextDepth}, stopping cascade as safety`);
                break;
            }
        }
    }

    return { insertedCount: inserted, reusedExistingCount: reused, cascadeMaxDepth: maxDepth };
}

// ── Phase B: mark chain terminuses as UV ───────────────────────

function markReplayLeavesAsUV(db: Database.Database, agent: 'jim' | 'leo', apply: boolean): number {
    // Replay-built entries that:
    //   - Have a source_id (so they're compressions, not c0 roots)
    //   - Are not yet superseded
    //   - Have NO descendants in gradient_entries (this is the chain terminus)
    // ...get level='uv' (the irreducible form of that chain).
    const candidates = db.prepare(`
        SELECT id, level, session_label
        FROM gradient_entries
        WHERE agent = ?
          AND qualifier = 'replay-built'
          AND superseded_by IS NULL
          AND source_id IS NOT NULL
          AND id NOT IN (
            SELECT source_id FROM gradient_entries
            WHERE source_id IS NOT NULL AND agent = ?
          )
    `).all(agent, agent) as any[];

    console.log(`\n[replay] Phase B: ${candidates.length} replay-built leaves to mark as UV`);

    if (!apply) {
        console.log(`[replay] DRY RUN — would mark ${candidates.length} entries level='uv'`);
        for (const c of candidates.slice(0, 5)) {
            console.log(`  ${c.id} (was ${c.level}) → ${c.session_label}`);
        }
        if (candidates.length > 5) console.log(`  ... and ${candidates.length - 5} more`);
        return 0;
    }

    const updateStmt = db.prepare(`UPDATE gradient_entries SET level = 'uv' WHERE id = ?`);
    let updated = 0;
    db.exec('BEGIN');
    try {
        for (const c of candidates) {
            updateStmt.run(c.id);
            updated++;
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
    return updated;
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const agentArg = args.find(a => a.startsWith('--agent='))?.split('=')[1];
    const apply = args.includes('--apply');

    if (agentArg !== 'jim' && agentArg !== 'leo') {
        console.error('Usage: tsx scripts/replay-bump-fill.ts --agent=<jim|leo> [--apply]');
        process.exit(1);
    }

    const agent = agentArg as 'jim' | 'leo';
    const db = new Database(DB_PATH);

    console.log(`[replay] Agent: ${agent}`);
    console.log(`[replay] Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`[replay] Content-types: ${TARGET_CONTENT_TYPES.join(', ')}`);

    // Phase A: cascade per content-type
    let totalInserted = 0, totalReused = 0, deepestCascade = 0;
    for (const ct of TARGET_CONTENT_TYPES) {
        const r = await processContentType(db, agent, ct, apply);
        totalInserted += r.insertedCount;
        totalReused += r.reusedExistingCount;
        if (r.cascadeMaxDepth > deepestCascade) deepestCascade = r.cascadeMaxDepth;
    }

    console.log(`\n[replay] Phase A complete:`);
    console.log(`  Cascade compressions ${apply ? 'inserted' : 'simulated'}: ${totalInserted}`);
    console.log(`  Existing descendants reused (idempotency): ${totalReused}`);
    console.log(`  Deepest cascade level: c${deepestCascade}`);

    // Phase B: mark terminuses as UV
    const uvMarked = markReplayLeavesAsUV(db, agent, apply);
    console.log(`\n[replay] Phase B complete:`);
    console.log(`  UVs ${apply ? 'marked' : 'would-mark'}: ${uvMarked}`);

    if (!apply) {
        console.log(`\n[replay] DRY RUN — pass --apply to execute. Note: compression calls cost ~$0.20 worst case per chain.`);
    }
}

main().catch(e => { console.error('[replay] FATAL:', e); process.exit(1); });
