#!/usr/bin/env tsx
/**
 * scripts/replay-bump-fill.ts
 *
 * Replay engine — corrected.
 *
 * Walks an agent's c0 entries from a SOURCE database in strict chronological
 * order (cross-content-type interleaved — working-memory, conversation,
 * session, etc., merged into one queue by created_at) and for each c0:
 *   1. Inserts the c0 into the TARGET database
 *   2. Copies any feeling_tags that c0 had in source
 *   3. Calls bumpOnInsert(agent, 'c0') — the canonical event-driven engine
 *
 * The cascade itself (cap-driven displacement, fresh sdkCompress, UV-on-
 * INCOMPRESSIBLE) is owned entirely by `bumpOnInsert` in
 * src/server/lib/memory-gradient.ts. This script is a temporal replay —
 * it does not duplicate cascade logic.
 *
 * Skipped: content_type='dream' and content_type='felt-moment'
 *          (separate gradient pipelines, future).
 *
 * Usage (env-driven target):
 *   HAN_DB_PATH=~/.han/gradient.db tsx scripts/replay-bump-fill.ts --agent=jim --apply
 *
 * Or with explicit flags:
 *   tsx scripts/replay-bump-fill.ts --agent=leo --target-db=~/.han/gradient.db --apply
 *
 * Arguments:
 *   --agent={jim|leo}              Required.
 *   --source-db=<path>             Default ~/.han/tasks.db (read-only).
 *   --target-db=<path>             Default ~/.han/gradient.db (writes here).
 *   --limit=N                      Process at most N c0s this invocation.
 *                                   Omit for "all remaining".
 *   --apply                        Without this, dry-run (counts only).
 *
 * Resumable: each invocation reads MAX(created_at) for this agent's c0s
 * in the target, and processes only source c0s strictly newer than that.
 * Re-runs naturally pick up from where the last one stopped. Per-row
 * inserts are wrapped to tolerate PRIMARY KEY violations as idempotent
 * skips (defensive belt-and-braces — the resume cursor should already
 * exclude in-target rows).
 *
 * The target DB is auto-created with full schema on first import of
 * src/server/db.ts (CREATE TABLE IF NOT EXISTS runs at module load).
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Database from 'better-sqlite3';

// ── Argument parsing ────────────────────────────────────────────

function arg(name: string, defaultValue: string | null = null): string | null {
    const flag = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(flag));
    if (found) return found.slice(flag.length);
    if (process.argv.includes(`--${name}`)) return 'true';
    return defaultValue;
}

const agent = arg('agent') as 'jim' | 'leo' | null;
const apply = arg('apply') === 'true';
const sourceDbPath = arg('source-db', path.join(os.homedir(), '.han', 'tasks.db'))!;
const targetDbPath = arg('target-db', process.env.HAN_DB_PATH || path.join(os.homedir(), '.han', 'gradient.db'))!;
const limitArg = arg('limit');
const limit = limitArg ? parseInt(limitArg, 10) : null;
if (limitArg && (!Number.isFinite(limit!) || limit! <= 0)) {
    console.error(`[replay] --limit must be a positive integer, got: ${limitArg}`);
    process.exit(1);
}

// Cutover watermark — when set, the FIRST c0 this invocation processes gets
// the phrase appended to its content before insert. Forensic record written to
// ~/.han/memory/cutover/watermarks-{agent}.jsonl. Subsequent c0s in this run
// are unaffected. The angel-preservation directive in bumpOnInsert (c0→c1)
// is what carries the tone forward through compression.
const watermark = arg('watermark');
const chunkNArg = arg('chunk-n');
const chunkNExplicit = chunkNArg ? parseInt(chunkNArg, 10) : null;
if (chunkNArg && (!Number.isFinite(chunkNExplicit!) || chunkNExplicit! <= 0)) {
    console.error(`[replay] --chunk-n must be a positive integer, got: ${chunkNArg}`);
    process.exit(1);
}

// Minimum chunk size with watermark — guarantees the watermarked c0's cascade
// fires WITHIN this chunk. With cap(c0)=1, the first insert displaces nothing
// (only 1 c0 exists, OFFSET 1 returns no row); the second insert displaces the
// first (watermarked) c0 and triggers c0→c1 cascade. Chunks of 1 with a
// watermark would leave the watermarked c0 uncascaded until a future chunk —
// structurally legal but defeats the angel-preservation goal for this chunk.
if (watermark && limit !== null && limit < 2) {
    console.error(`[replay] --watermark requires --limit >= 2 (got ${limit}). The watermarked c0's cascade fires when a second c0 displaces it; with limit=1 the watermarked c0 sits at c0 forever.`);
    process.exit(1);
}

if (!agent || (agent !== 'jim' && agent !== 'leo')) {
    console.error('Usage: tsx scripts/replay-bump-fill.ts --agent={jim|leo} [--source-db=...] [--target-db=...] [--apply]');
    process.exit(1);
}

if (path.resolve(sourceDbPath) === path.resolve(targetDbPath)) {
    console.error(`[replay] FATAL: source and target DB paths are identical (${sourceDbPath}). Refusing to run.`);
    process.exit(2);
}

// Route src/server/db at the target file BEFORE any import that touches it.
process.env.HAN_DB_PATH = targetDbPath;

// ── Main ────────────────────────────────────────────────────────

async function main() {
    console.log(`[replay] Agent:     ${agent}`);
    console.log(`[replay] Source:    ${sourceDbPath} (read-only)`);
    console.log(`[replay] Target:    ${targetDbPath}`);
    console.log(`[replay] Limit:     ${limit ?? 'unlimited'}`);
    console.log(`[replay] Watermark: ${watermark ? `"${watermark}"` : '(none)'}`);
    console.log(`[replay] Mode:      ${apply ? 'APPLY' : 'DRY-RUN'}`);

    // Dynamic imports so HAN_DB_PATH is honoured by the target db.ts module.
    const { db: targetDb, gradientStmts, feelingTagStmts } = await import('../src/server/db');
    const { bumpOnInsert } = await import('../src/server/lib/memory-gradient');

    // Composite resume cursor — pick up from the c0 immediately after the latest
    // in-target c0 for this agent. The cursor uses (created_at, id) so tied
    // siblings at the same timestamp are not silently skipped at chunk boundaries
    // (timestamps in source data are not unique — leo had 0 ties, jim had 57).
    const resumeRow = targetDb.prepare(`
        SELECT created_at, id
        FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream', 'felt-moment')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(agent) as any;
    const resumeFromTs: string | null = resumeRow?.created_at || null;
    const resumeFromId: string | null = resumeRow?.id || null;
    if (resumeFromTs) {
        console.log(`[replay] Resuming from c0s after (${resumeFromTs}, ${resumeFromId})`);
    } else {
        console.log(`[replay] Starting fresh — no prior c0s in target for ${agent}`);
    }

    // Read c0s from source DB — chronological, cross-content-type, excludes
    // dream / felt-moment (those have their own pipelines). Bounded by the
    // composite cursor (created_at, id) and an optional --limit.
    const sourceDb = new Database(sourceDbPath, { readonly: true });
    const baseSql = `
        SELECT id, agent, session_label, level, content, content_type,
               source_id, source_conversation_id, source_message_id,
               provenance_type, created_at, supersedes, change_count, qualifier
        FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream', 'felt-moment')
          ${resumeFromTs ? "AND (created_at > ? OR (created_at = ? AND id > ?))" : ""}
        ORDER BY created_at ASC, id ASC
        ${limit ? "LIMIT ?" : ""}
    `;
    const params: any[] = [agent];
    if (resumeFromTs) params.push(resumeFromTs, resumeFromTs, resumeFromId);
    if (limit) params.push(limit);
    const c0Rows = sourceDb.prepare(baseSql).all(...params) as any[];

    console.log(`[replay] ${c0Rows.length} c0 entries to process for ${agent}`);

    if (!apply) {
        const types = new Map<string, number>();
        for (const r of c0Rows) types.set(r.content_type, (types.get(r.content_type) || 0) + 1);
        console.log(`[replay] Content-type breakdown:`);
        for (const [t, n] of [...types.entries()].sort()) console.log(`           ${t}: ${n}`);
        console.log(`\n[replay] DRY RUN — pass --apply to execute.`);
        sourceDb.close();
        return;
    }

    // Pre-compiled fetch for feeling_tags on a given source row.
    const sourceTagsStmt = sourceDb.prepare(
        'SELECT gradient_entry_id, author, tag_type, content, change_reason, created_at FROM feeling_tags WHERE gradient_entry_id = ?'
    );

    let cascadesTriggered = 0;
    let totalCascadeSteps = 0;
    const t0 = Date.now();

    // Watermark forensic log — append-only per-agent JSONL. chunk_n auto-derives
    // from existing line count + 1 unless explicitly passed via --chunk-n.
    const watermarksDir = path.join(os.homedir(), '.han', 'memory', 'cutover');
    const watermarksPath = path.join(watermarksDir, `watermarks-${agent}.jsonl`);

    for (let i = 0; i < c0Rows.length; i++) {
        const c0 = c0Rows[i];

        // First c0 of this invocation gets the watermark appended (if --watermark
        // is set). Mutates the c0's content for insert; source DB is never
        // touched. The angel-preservation directive in bumpOnInsert (c0→c1) is
        // what carries the tone forward — the literal phrase often drops at c1
        // but the warmth folds into the kernel.
        let contentForInsert: string = String(c0.content || '');
        let watermarkApplied = false;
        if (watermark && i === 0) {
            // Two-newline separator so the angel reads as a closing line, not as
            // continuation of the prior content.
            contentForInsert = `${contentForInsert}\n\n${watermark}`;
            watermarkApplied = true;
        }

        // Insert c0 into target — preserve original id, source_id, created_at.
        // Tolerate PRIMARY KEY violations as idempotent skips (the resume cursor
        // should already exclude in-target rows, but defence in depth).
        try {
            gradientStmts.insert.run(
                c0.id, c0.agent, c0.session_label, 'c0', contentForInsert, c0.content_type,
                c0.source_id, c0.source_conversation_id, c0.source_message_id,
                c0.provenance_type || 'original', c0.created_at,
                c0.supersedes, c0.change_count || 0, c0.qualifier
            );
        } catch (e: any) {
            if (!String(e?.message || '').includes('UNIQUE constraint')) throw e;
            console.log(`[replay] skip — c0 ${c0.id} already in target (UNIQUE constraint)`);
            continue;
        }

        // Forensic watermark log AFTER successful insert. The log survives even
        // if gradient.db is wiped — raw material for the diary made later.
        if (watermarkApplied) {
            fs.mkdirSync(watermarksDir, { recursive: true });
            const existingLines = fs.existsSync(watermarksPath)
                ? fs.readFileSync(watermarksPath, 'utf8').split('\n').filter(l => l.trim()).length
                : 0;
            const chunkN = chunkNExplicit ?? (existingLines + 1);
            const record = {
                chunk_n: chunkN,
                c0_id: c0.id,
                agent: c0.agent,
                session_label: c0.session_label,
                content_type: c0.content_type,
                c0_created_at: c0.created_at,
                watermark,
                injected_at: new Date().toISOString(),
            };
            fs.appendFileSync(watermarksPath, JSON.stringify(record) + '\n');
            console.log(`[replay] watermark applied to c0 ${c0.id} (${c0.session_label}) — chunk_n=${chunkN}`);
        }

        // Copy feeling_tags for this c0 (compression-feel etc.)
        const tags = sourceTagsStmt.all(c0.id) as any[];
        for (const t of tags) {
            feelingTagStmts.insert.run(
                t.gradient_entry_id, t.author, t.tag_type, t.content, t.change_reason, t.created_at
            );
        }

        // Trigger the canonical cascade. bumpOnInsert handles cap displacement,
        // fresh compression at each step, and UV-on-INCOMPRESSIBLE tagging.
        const result = await bumpOnInsert(agent, 'c0');
        cascadesTriggered++;
        totalCascadeSteps += result.cascadeSteps;

        if ((i + 1) % 10 === 0 || i === c0Rows.length - 1) {
            const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
            console.log(`[replay] ${agent}: c0 ${i + 1}/${c0Rows.length} (${c0.content_type}/${c0.session_label}) — ${result.cascadeSteps} cascade steps — ${elapsed}s elapsed`);
        }
    }

    // Post-chunk verification — count parity between source-window and target.
    // The target should contain exactly the source c0s with (created_at, id) <=
    // target's high-water mark. Mismatch = silent drop somewhere in the cursor
    // logic. Cheap to run; proves correctness chunk-by-chunk.
    const targetMaxRow = targetDb.prepare(`
        SELECT created_at, id FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream', 'felt-moment')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(agent) as any;
    const targetMaxTs: string | null = targetMaxRow?.created_at || null;
    const targetMaxId: string | null = targetMaxRow?.id || null;

    let verificationOk = true;
    if (targetMaxTs) {
        const targetCount = (targetDb.prepare(`
            SELECT COUNT(*) AS n FROM gradient_entries
            WHERE agent = ? AND level = 'c0'
              AND content_type NOT IN ('dream', 'felt-moment')
        `).get(agent) as any).n;

        const sourceWithinWindow = (sourceDb.prepare(`
            SELECT COUNT(*) AS n FROM gradient_entries
            WHERE agent = ? AND level = 'c0'
              AND content_type NOT IN ('dream', 'felt-moment')
              AND (created_at < ? OR (created_at = ? AND id <= ?))
        `).get(agent, targetMaxTs, targetMaxTs, targetMaxId) as any).n;

        if (sourceWithinWindow === targetCount) {
            console.log(`[replay] Verification: target c0 count = ${targetCount}, source-within-window = ${sourceWithinWindow} ✓`);
        } else {
            verificationOk = false;
            console.error(`[replay] VERIFICATION FAILED: target c0 count = ${targetCount}, source-within-window = ${sourceWithinWindow}. Drift: ${sourceWithinWindow - targetCount}.`);
            console.error(`[replay] High-water mark: (${targetMaxTs}, ${targetMaxId}).`);
            console.error(`[replay] This means the cursor silently skipped source rows. Investigate before next chunk.`);
        }
    }

    sourceDb.close();

    console.log(`\n[replay] Complete.`);
    console.log(`  c0s inserted:        ${c0Rows.length}`);
    console.log(`  bumps triggered:     ${cascadesTriggered}`);
    console.log(`  total cascade steps: ${totalCascadeSteps}`);
    console.log(`  watermark applied:   ${watermark ? 'yes' : 'no'}`);
    console.log(`  verification:        ${verificationOk ? '✓ pass' : '✗ FAIL'}`);
    console.log(`  elapsed:             ${((Date.now() - t0) / 1000).toFixed(0)}s`);

    if (!verificationOk) process.exit(3);
}

main().catch(e => {
    console.error('[replay] FATAL:', e);
    process.exit(1);
});
