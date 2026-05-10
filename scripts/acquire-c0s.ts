#!/usr/bin/env tsx
/**
 * scripts/acquire-c0s.ts
 *
 * Plan v8 Step 4 — Pre-replay c0 acquisition.
 *
 * Walks an agent's raw memory source directory on disk and inserts each
 * per-event file as a c0 entry in gradient_entries. Run once per agent
 * before the replay engine fires; idempotent (skips files whose label is
 * already represented as a c0 in DB).
 *
 * Usage:
 *   npx tsx scripts/acquire-c0s.ts --agent=jim          # dry-run (default)
 *   npx tsx scripts/acquire-c0s.ts --agent=jim --apply  # actually insert
 *   npx tsx scripts/acquire-c0s.ts --agent=leo
 *   npx tsx scripts/acquire-c0s.ts --agent=leo --apply
 *
 * Sovereignty: the agent argument controls which agent's data is touched.
 * Each agent runs the script with their own --agent= value. The script
 * never crosses agents.
 *
 * What it does NOT do:
 *   - Compress anything (that's the replay engine's job — Step 5).
 *   - Touch existing entries (only INSERTs new c0s).
 *   - Run if the cascade is paused — wait, actually it does run. The
 *     pause signal blocks bump cascading; c0 INSERT is the entry point,
 *     the raw data capture, which we always preserve. Per Darron's
 *     standing instruction.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { gradientConfigForAgent, registeredAgentSlugs } from '../src/server/lib/agent-registry';

// Phase A Batch 4 (S155, 2026-05-10): widened agent type to string;
// path config rebased on AGENT_GRADIENT_CONFIG (sourceDir + sourceFileFilter
// come from registry); script-specific acquisition-shape fields (content_type,
// dedupe, preference) stay in ACQUISITION_SHAPE keyed by slug. Agents not
// registered in ACQUISITION_SHAPE fall back to working-memory defaults.

interface AgentConfig {
    agent: string;
    sourceDir: string;
    contentType: string;
    /** Returns true if this filename should be considered as a c0 candidate. */
    fileFilter: (filename: string) => boolean;
    /** Returns the label to store on the c0 row (typically filename without .md). */
    deriveLabel: (filename: string) => string;
    /** Returns the ISO timestamp to use as created_at, or null to skip the file. */
    deriveCreatedAt: (filename: string, filepath: string) => string | null;
    /** Optional dedupe key — files with the same key collapse to one. */
    dedupeKey?: (filename: string) => string;
    /** When dedupe is needed, higher score wins. */
    preferenceScore?: (filename: string) => number;
}

function deriveDateFromFilename(filename: string): string | null {
    const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;
    // Use start-of-day as the creation timestamp. The replay engine uses
    // these to sort chronologically; sub-day ordering will fall back to
    // alphabetical ordering, which mostly matches creation order anyway.
    return `${match[1]}T00:00:00.000Z`;
}

function deriveDateFromContent(filepath: string): string | null {
    // Read first ~12 lines and look for a YYYY-MM-DD pattern.
    // Common patterns: "Session 60 (2026-03-04, morning)", "Session 127 — 2026-04-17 to 2026-04-18", etc.
    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const head = content.split('\n').slice(0, 12).join('\n');
        const match = head.match(/(\d{4}-\d{2}-\d{2})/);
        if (!match) return null;
        return `${match[1]}T00:00:00.000Z`;
    } catch {
        return null;
    }
}

function deriveDateFromMtime(filepath: string): string | null {
    // Last-resort fallback. mtime reflects when the file was last written —
    // close enough for our purposes when no explicit date is available.
    try {
        const stat = fs.statSync(filepath);
        return stat.mtime.toISOString();
    } catch {
        return null;
    }
}

/**
 * Composite date derivation: try filename, then file content, then mtime.
 * Returns ISO timestamp or null if nothing works.
 */
function deriveDateChain(filename: string, filepath: string): { iso: string | null; source: string } {
    const fromFilename = deriveDateFromFilename(filename);
    if (fromFilename) return { iso: fromFilename, source: 'filename' };

    const fromContent = deriveDateFromContent(filepath);
    if (fromContent) return { iso: fromContent, source: 'content' };

    const fromMtime = deriveDateFromMtime(filepath);
    if (fromMtime) return { iso: fromMtime, source: 'mtime (fallback)' };

    return { iso: null, source: 'none' };
}

// Acquisition-shape fields per agent (script-specific; not in agent-registry
// because contentType + dedupe semantics are particular to this script's
// acquisition path). sourceDir + sourceFileFilter come from agent-registry
// per DEC-081 — single-source-of-truth for paths.
//
// Agents not in ACQUISITION_SHAPE default to working-memory shape (no dedupe).
// To add a new agent's acquisition shape, register the agent first
// (agent-registry.ts) THEN add an entry here.
interface AcquisitionShape {
    contentType: string;
    dedupeKey?: (filename: string) => string;
    preferenceScore?: (filename: string) => number;
}

const ACQUISITION_SHAPE: Record<string, AcquisitionShape> = {
    jim: {
        contentType: 'session',
    },
    leo: {
        contentType: 'working-memory',
        // session-NN-YYYY-MM-DD.md and session-NN-full-YYYY-MM-DD.md → same key
        dedupeKey: (f) => f.replace(/-full-/, '-').replace(/\.md$/, ''),
        preferenceScore: (f) => f.includes('-full-') ? 100 : 0,
    },
};

const DEFAULT_ACQUISITION_SHAPE: AcquisitionShape = {
    contentType: 'working-memory',
};

function buildConfigForAgent(agent: string): AgentConfig {
    const registry = gradientConfigForAgent(agent);
    const shape = ACQUISITION_SHAPE[agent] ?? DEFAULT_ACQUISITION_SHAPE;
    return {
        agent,
        sourceDir: registry.sourceDir,
        contentType: shape.contentType,
        fileFilter: registry.sourceFileFilter,
        deriveLabel: (f) => registry.sourceFileBaseName(f),
        deriveCreatedAt: (f, fp) => deriveDateChain(f, fp).iso,
        dedupeKey: shape.dedupeKey,
        preferenceScore: shape.preferenceScore,
    };
}

function main() {
    const args = process.argv.slice(2);
    const agentArg = args.find(a => a.startsWith('--agent='))?.split('=')[1];
    const apply = args.includes('--apply');

    // Phase A Batch 4 (S155, 2026-05-10): validate agent against registry
    // per DEC-081 agent-agnostic discipline.
    const validSlugs = registeredAgentSlugs();
    if (!agentArg || !validSlugs.includes(agentArg)) {
        if (validSlugs.length === 0) {
            console.error(`Usage: tsx scripts/acquire-c0s.ts --agent=<slug> [--apply]`);
            console.error(`No agents registered in agent-registry.ts. Cannot proceed.`);
        } else {
            console.error(`Usage: tsx scripts/acquire-c0s.ts --agent=<${validSlugs.join('|')}> [--apply]`);
            console.error(`  Default mode: dry-run (no DB writes). Pass --apply to execute.`);
            if (agentArg) console.error(`Unknown agent slug: '${agentArg}'. Registered: ${validSlugs.join(', ')}`);
        }
        process.exit(1);
    }

    const config = buildConfigForAgent(agentArg);
    // Phase A Batch 4 (S155, 2026-05-10): mirrors db.ts:37 pattern. Post-cutover
    // (DEC-080 Phase 5, 2026-04-29) the canonical store is gradient.db; HAN_DB_PATH
    // override supports diagnostics against checkpoint snapshots.
    const dbPath = process.env.HAN_DB_PATH || path.join(process.env.HOME || '', '.han', 'gradient.db');
    const db = new Database(dbPath);

    if (!fs.existsSync(config.sourceDir)) {
        console.error(`[acquire-c0s] Source directory not found: ${config.sourceDir}`);
        process.exit(1);
    }

    let files = fs.readdirSync(config.sourceDir).filter(config.fileFilter).sort();
    console.log(`[acquire-c0s] Agent: ${config.agent}`);
    console.log(`[acquire-c0s] Source: ${config.sourceDir}`);
    console.log(`[acquire-c0s] Content-type: ${config.contentType}`);
    console.log(`[acquire-c0s] Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`[acquire-c0s] Candidate files after filter: ${files.length}`);

    // Per-config dedupe (Leo's full-vs-abbreviated, primarily)
    if (config.dedupeKey && config.preferenceScore) {
        const groups = new Map<string, string>();
        const scores = new Map<string, number>();
        for (const f of files) {
            const key = config.dedupeKey(f);
            const score = config.preferenceScore(f);
            const prevScore = scores.get(key) ?? -Infinity;
            if (score > prevScore) {
                groups.set(key, f);
                scores.set(key, score);
            }
        }
        const deduped = Array.from(groups.values()).sort();
        const dropped = files.length - deduped.length;
        if (dropped > 0) {
            console.log(`[acquire-c0s] Dedupe: dropped ${dropped} files in favour of higher-score variants (e.g., '-full-' over abbreviated)`);
        }
        files = deduped;
    }

    // Existing c0s for this agent + content_type to avoid duplicate inserts
    const existing = new Set(
        (db.prepare(`SELECT session_label FROM gradient_entries WHERE agent = ? AND level = 'c0' AND content_type = ?`)
            .all(config.agent, config.contentType) as any[])
            .map(r => r.session_label)
    );

    const toInsert: Array<{file: string, label: string, createdAt: string, content: string}> = [];
    const skipped: Array<{file: string, reason: string}> = [];

    for (const file of files) {
        const filepath = path.join(config.sourceDir, file);
        const label = config.deriveLabel(file);
        const createdAt = config.deriveCreatedAt(file, filepath);

        if (!createdAt) { skipped.push({file, reason: 'no derivable date'}); continue; }
        if (existing.has(label)) { skipped.push({file, reason: 'already in DB as c0'}); continue; }

        let content: string;
        try {
            content = fs.readFileSync(filepath, 'utf-8');
        } catch (err) {
            skipped.push({file, reason: `read error: ${(err as Error).message}`});
            continue;
        }

        if (content.trim().length < 50) {
            skipped.push({file, reason: 'empty or near-empty file'});
            continue;
        }

        toInsert.push({file, label, createdAt, content});
    }

    console.log(`\n[acquire-c0s] To insert: ${toInsert.length} c0 entries`);
    console.log(`[acquire-c0s] To skip:   ${skipped.length} files`);

    console.log('\n--- Sample (first 8 of to-insert) ---');
    for (const item of toInsert.slice(0, 8)) {
        console.log(`  ${item.file} → label=${item.label} → created_at=${item.createdAt} (${item.content.length} bytes)`);
    }
    if (toInsert.length > 8) {
        console.log(`  ... and ${toInsert.length - 8} more`);
    }

    console.log('\n--- Skip reasons (first 10) ---');
    for (const s of skipped.slice(0, 10)) {
        console.log(`  ${s.file} — ${s.reason}`);
    }
    if (skipped.length > 10) {
        console.log(`  ... and ${skipped.length - 10} more`);
    }

    if (!apply) {
        console.log('\n[acquire-c0s] DRY RUN — pass --apply to execute the inserts.');
        return;
    }

    console.log('\n[acquire-c0s] Applying inserts (transactional)...');
    const insertStmt = db.prepare(`
        INSERT INTO gradient_entries (
            id, agent, session_label, level, content, content_type,
            source_id, source_conversation_id, source_message_id,
            provenance_type, created_at, supersedes, change_count, qualifier
        ) VALUES (?, ?, ?, 'c0', ?, ?, NULL, NULL, NULL, 'original', ?, NULL, 0, NULL)
    `);

    let inserted = 0;
    db.exec('BEGIN');
    try {
        for (const item of toInsert) {
            const id = crypto.randomUUID();
            insertStmt.run(id, config.agent, item.label, item.content, config.contentType, item.createdAt);
            inserted++;
        }
        db.exec('COMMIT');
        console.log(`[acquire-c0s] Inserted ${inserted} c0 entries for ${config.agent}.`);
    } catch (err) {
        db.exec('ROLLBACK');
        console.error('[acquire-c0s] Insert failed, transaction rolled back:', (err as Error).message);
        process.exit(1);
    }
}

main();
