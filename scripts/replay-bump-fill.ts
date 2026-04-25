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
 *   --apply                        Without this, dry-run (counts only).
 *
 * Idempotency: if the target DB already contains entries for this agent,
 * the script aborts. Re-running against a fresh DB is safe; partial reruns
 * require manual intervention.
 *
 * The target DB is auto-created with full schema on first import of
 * src/server/db.ts (CREATE TABLE IF NOT EXISTS runs at module load).
 */

import * as path from 'path';
import * as os from 'os';
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
    console.log(`[replay] Agent: ${agent}`);
    console.log(`[replay] Source: ${sourceDbPath} (read-only)`);
    console.log(`[replay] Target: ${targetDbPath}`);
    console.log(`[replay] Mode:   ${apply ? 'APPLY' : 'DRY-RUN'}`);

    // Dynamic imports so HAN_DB_PATH is honoured by the target db.ts module.
    const { db: targetDb, gradientStmts, feelingTagStmts } = await import('../src/server/db');
    const { bumpOnInsert } = await import('../src/server/lib/memory-gradient');

    // Idempotency guard — refuse to write into a target that already has rows
    // for this agent. Per-agent so jim and leo replays can share a target DB.
    const existing = (targetDb.prepare(
        'SELECT COUNT(*) AS n FROM gradient_entries WHERE agent = ?'
    ).get(agent) as any).n as number;
    if (existing > 0 && apply) {
        console.error(`[replay] FATAL: target DB already has ${existing} rows for agent='${agent}'. Aborting.`);
        process.exit(3);
    }

    // Read c0s from source DB — chronological, cross-content-type, excludes
    // dream / felt-moment (those have their own pipelines).
    const sourceDb = new Database(sourceDbPath, { readonly: true });
    const c0Rows = sourceDb.prepare(`
        SELECT id, agent, session_label, level, content, content_type,
               source_id, source_conversation_id, source_message_id,
               provenance_type, created_at, supersedes, change_count, qualifier
        FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream', 'felt-moment')
        ORDER BY created_at ASC, id ASC
    `).all(agent) as any[];

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

    for (let i = 0; i < c0Rows.length; i++) {
        const c0 = c0Rows[i];

        // Insert c0 into target — preserve original id, source_id, created_at.
        gradientStmts.insert.run(
            c0.id, c0.agent, c0.session_label, 'c0', c0.content, c0.content_type,
            c0.source_id, c0.source_conversation_id, c0.source_message_id,
            c0.provenance_type || 'original', c0.created_at,
            c0.supersedes, c0.change_count || 0, c0.qualifier
        );

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

    sourceDb.close();

    console.log(`\n[replay] Complete.`);
    console.log(`  c0s inserted:        ${c0Rows.length}`);
    console.log(`  bumps triggered:     ${cascadesTriggered}`);
    console.log(`  total cascade steps: ${totalCascadeSteps}`);
    console.log(`  elapsed:             ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch(e => {
    console.error('[replay] FATAL:', e);
    process.exit(1);
});
