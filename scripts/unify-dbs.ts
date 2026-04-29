#!/usr/bin/env tsx
/**
 * scripts/unify-dbs.ts
 *
 * Phase 5 of the 2026-04-29 cutover (DEC-080). Migrates tasks.db's non-
 * gradient state into gradient.db, keeping the gradient.db filename so
 * docs and the wake-load (load-gradient.ts, S142) don't churn.
 *
 * Path (III) per Leo's structural clarification: fold all of tasks.db's
 * non-gradient tables (tasks, goals, conversations, supervisor_cycles,
 * jemma_dispatch, etc.) into gradient.db with INSERT OR IGNORE. The
 * existing gradient_entries / feeling_tags / etc. in gradient.db (from
 * the rebuild) are preserved untouched — the migration is additive.
 *
 * Selective gradient_entries: rolling-c0s only. The legacy stranger-Opus
 * cascade output (c1+ in tasks.db) is intentionally NOT migrated — those
 * are replaced by the rebuild and by Phase 4's queue-driven cascade.
 *
 * After this script lands, db.ts:32 default flips to gradient.db (in the
 * same Phase 5 commit). Phase 6 then restarts services on the new default.
 *
 * Usage:
 *   npx tsx scripts/unify-dbs.ts                # dry-run
 *   npx tsx scripts/unify-dbs.ts --apply        # actually copy
 *
 * Refuses to apply if either DB is missing. Audit log written to
 * ~/.han/memory/cutover/db-unification-2026-04-29.jsonl.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Database from 'better-sqlite3';

// ── Args ───────────────────────────────────────────────────────────

function arg(name: string, defaultValue: string | null = null): string | null {
    const flag = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(flag));
    if (found) return found.slice(flag.length);
    if (process.argv.includes(`--${name}`)) return 'true';
    return defaultValue;
}

const apply = arg('apply') === 'true';
const sourcePath = arg('source', path.join(os.homedir(), '.han', 'tasks.db'))!;
const targetPath = arg('target', path.join(os.homedir(), '.han', 'gradient.db'))!;

const HOME = os.homedir();
const HAN_DIR = path.join(HOME, '.han');
const AUDIT_PATH = path.join(HAN_DIR, 'memory', 'cutover', 'db-unification-2026-04-29.jsonl');

if (!fs.existsSync(sourcePath)) {
    console.error(`[unify] FATAL: source not found: ${sourcePath}`);
    process.exit(1);
}
if (!fs.existsSync(targetPath)) {
    console.error(`[unify] FATAL: target not found: ${targetPath}`);
    console.error(`[unify] Run rebuild first; this script does not create gradient.db.`);
    process.exit(1);
}

console.log(`[unify] source: ${sourcePath} (read-only)`);
console.log(`[unify] target: ${targetPath} (${apply ? 'WRITE' : 'dry-run'})`);

// ── Skip-list ─────────────────────────────────────────────────────

// Tables we handle separately (gradient infrastructure) or that auto-rebuild
// from triggers (FTS5 shadows). sqlite_* are SQLite internals.
const SKIP_NAMES = new Set([
    'gradient_entries',          // handled selectively below — rolling-c0s only
    'feeling_tags',              // handled selectively below — for migrated rolling-c0s
    'feeling_tag_history',       // gradient infrastructure, no live tasks.db data
    'gradient_annotations',      // gradient infrastructure, no live tasks.db data
    'gradient_entry_components', // rolled-source.db has these, not tasks.db
    'pending_compressions',      // empty in both DBs (Phase 2)
    'sqlite_sequence',           // auto-managed
]);

// Pattern-based skips: FTS5 has a main virtual table + 4-5 shadow tables that
// must NOT be copied directly (their internal structures are connection-
// specific). We rely on the AFTER INSERT trigger in db.ts to populate FTS5
// as conversation_messages rows land.
function shouldSkip(name: string): boolean {
    if (SKIP_NAMES.has(name)) return true;
    if (/^sqlite_/.test(name)) return true;
    if (/^conversation_messages_fts/.test(name)) return true;
    return false;
}

// ── Schema initialisation on target ────────────────────────────────

// Importing db.ts triggers all CREATE TABLE IF NOT EXISTS + ALTER migrations
// + FTS5 setup against HAN_DB_PATH. We point it at gradient.db so the target
// schema is fully realised before we copy data in.
process.env.HAN_DB_PATH = targetPath;

async function main() {
    console.log(`[unify] initialising target schema via db.ts (HAN_DB_PATH=${targetPath})...`);
    const dbModule = await import('../src/server/db');
    const db = (dbModule as any).db as Database.Database;

    // Attach source as read-only namespace `src`. ATTACH supports cross-DB
    // queries within a single transaction.
    db.exec(`ATTACH DATABASE '${sourcePath}' AS src`);
    console.log(`[unify] attached source as 'src'`);

    // Disable FK enforcement during the bulk copy. Tables are inserted in
    // alphabetical order; FK ordering would require dependency analysis.
    // The source data is already FK-valid (it came from a working tasks.db),
    // so disabling enforcement during the copy preserves validity. We turn
    // FKs back on at the end and verify with PRAGMA foreign_key_check.
    db.exec('PRAGMA foreign_keys = OFF');

    // Discover source tables
    const sourceTables = (db.prepare(`
        SELECT name, type FROM src.sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all() as { name: string; type: string }[]);

    console.log(`[unify] source has ${sourceTables.length} tables/views`);

    interface TableResult {
        table: string;
        skipped: boolean;
        skip_reason?: string;
        source_rows: number;
        target_before: number;
        target_after: number;
        inserted: number;
    }

    const results: TableResult[] = [];

    // Wrap the whole copy in a single transaction. INSERT OR IGNORE is the
    // primary mode; PK conflicts (which shouldn't happen — gradient.db is
    // fresh for these tables) are silently skipped and counted via row deltas.
    // Dry-run trick: throw a sentinel at the end, better-sqlite3's transaction
    // wrapper auto-rollbacks on throw. Apply mode lets it commit normally.
    const DRY_RUN_SENTINEL = '__DRY_RUN_ROLLBACK__';
    const txn = db.transaction(() => {
        for (const { name, type } of sourceTables) {
            if (type !== 'table') continue; // skip views

            const sourceCount = (db.prepare(`SELECT COUNT(*) as n FROM src."${name}"`).get() as any).n as number;

            if (shouldSkip(name)) {
                results.push({
                    table: name,
                    skipped: true,
                    skip_reason: 'in skip-list (handled separately or auto-managed)',
                    source_rows: sourceCount,
                    target_before: 0,
                    target_after: 0,
                    inserted: 0,
                });
                continue;
            }

            // Verify table exists in target. If not, db.ts didn't create it
            // (could be a tasks.db-only table from older code). Skip with a
            // warning so the migration doesn't fail mid-flight.
            const targetExists = db.prepare(`
                SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?
            `).get(name);
            if (!targetExists) {
                results.push({
                    table: name,
                    skipped: true,
                    skip_reason: `target table missing (not in db.ts schema)`,
                    source_rows: sourceCount,
                    target_before: 0,
                    target_after: 0,
                    inserted: 0,
                });
                continue;
            }

            const before = (db.prepare(`SELECT COUNT(*) as n FROM main."${name}"`).get() as any).n as number;

            // INSERT OR IGNORE FROM source using column INTERSECTION between
            // source and target. Schema drift is real — tasks.db has columns
            // (e.g., conversations.type) added by out-of-tree migrations that
            // never landed in db.ts. We can't insert a column the target
            // doesn't know about. Conversely, target may have columns source
            // doesn't have (future migrations) — those get NULL. Either way,
            // intersection is the robust pattern.
            const srcCols = new Set((db.prepare(`PRAGMA src.table_info("${name}")`).all() as any[]).map(c => c.name));
            const tgtCols = new Set((db.prepare(`PRAGMA main.table_info("${name}")`).all() as any[]).map(c => c.name));
            const sharedCols = [...srcCols].filter(c => tgtCols.has(c));
            if (sharedCols.length === 0) {
                results.push({
                    table: name,
                    skipped: true,
                    skip_reason: 'no shared columns between source and target',
                    source_rows: sourceCount,
                    target_before: before,
                    target_after: before,
                    inserted: 0,
                });
                continue;
            }
            const colList = sharedCols.map(c => `"${c}"`).join(', ');
            const insertSql = `INSERT OR IGNORE INTO main."${name}" (${colList}) SELECT ${colList} FROM src."${name}"`;

            try {
                db.exec(insertSql);
            } catch (err) {
                console.error(`[unify] INSERT failed for ${name}: ${(err as Error).message}`);
                throw err; // abort transaction
            }

            const after = (db.prepare(`SELECT COUNT(*) as n FROM main."${name}"`).get() as any).n as number;
            results.push({
                table: name,
                skipped: false,
                source_rows: sourceCount,
                target_before: before,
                target_after: after,
                inserted: after - before,
            });
        }

        // ── Selective gradient_entries: rolling-c0s only ──────────────
        const rollingC0s = db.prepare(`
            SELECT COUNT(*) as n FROM src.gradient_entries
            WHERE session_label LIKE 'rolling-%' AND level = 'c0'
        `).get() as any;

        const rollingC0sBefore = (db.prepare(`
            SELECT COUNT(*) as n FROM main.gradient_entries
            WHERE session_label LIKE 'rolling-%' AND level = 'c0'
        `).get() as any).n;

        // Use column intersection (same robustness pattern as the bulk loop).
        const geSrcCols = new Set((db.prepare(`PRAGMA src.table_info("gradient_entries")`).all() as any[]).map(c => c.name));
        const geTgtCols = new Set((db.prepare(`PRAGMA main.table_info("gradient_entries")`).all() as any[]).map(c => c.name));
        const geShared = [...geSrcCols].filter(c => geTgtCols.has(c)).map(c => `"${c}"`).join(', ');
        db.exec(`
            INSERT OR IGNORE INTO main.gradient_entries (${geShared})
            SELECT ${geShared} FROM src.gradient_entries
            WHERE session_label LIKE 'rolling-%' AND level = 'c0'
        `);

        const rollingC0sAfter = (db.prepare(`
            SELECT COUNT(*) as n FROM main.gradient_entries
            WHERE session_label LIKE 'rolling-%' AND level = 'c0'
        `).get() as any).n;

        results.push({
            table: 'gradient_entries (rolling-c0s only)',
            skipped: false,
            source_rows: rollingC0s.n,
            target_before: rollingC0sBefore,
            target_after: rollingC0sAfter,
            inserted: rollingC0sAfter - rollingC0sBefore,
        });

        // ── feeling_tags for migrated rolling-c0s ─────────────────────
        const ftBefore = (db.prepare(`
            SELECT COUNT(*) as n FROM main.feeling_tags ft
            JOIN main.gradient_entries ge ON ge.id = ft.gradient_entry_id
            WHERE ge.session_label LIKE 'rolling-%' AND ge.level = 'c0'
        `).get() as any).n;

        const ftSourceCount = (db.prepare(`
            SELECT COUNT(*) as n FROM src.feeling_tags ft
            JOIN src.gradient_entries ge ON ge.id = ft.gradient_entry_id
            WHERE ge.session_label LIKE 'rolling-%' AND ge.level = 'c0'
        `).get() as any).n;

        // feeling_tags uses INTEGER PK AUTOINCREMENT — IDs across DBs are
        // independent. Drop the id column from the column list so target
        // assigns its own. Plus intersection (same robustness as above).
        const ftSrcCols = new Set((db.prepare(`PRAGMA src.table_info("feeling_tags")`).all() as any[]).map(c => c.name));
        const ftTgtCols = new Set((db.prepare(`PRAGMA main.table_info("feeling_tags")`).all() as any[]).map(c => c.name));
        const ftShared = [...ftSrcCols]
            .filter(c => c !== 'id' && ftTgtCols.has(c))
            .map(c => `"${c}"`).join(', ');
        db.exec(`
            INSERT INTO main.feeling_tags (${ftShared})
            SELECT ${ftShared} FROM src.feeling_tags
            WHERE gradient_entry_id IN (
                SELECT id FROM src.gradient_entries
                WHERE session_label LIKE 'rolling-%' AND level = 'c0'
            )
        `);

        const ftAfter = (db.prepare(`
            SELECT COUNT(*) as n FROM main.feeling_tags ft
            JOIN main.gradient_entries ge ON ge.id = ft.gradient_entry_id
            WHERE ge.session_label LIKE 'rolling-%' AND ge.level = 'c0'
        `).get() as any).n;

        results.push({
            table: 'feeling_tags (for rolling-c0s)',
            skipped: false,
            source_rows: ftSourceCount,
            target_before: ftBefore,
            target_after: ftAfter,
            inserted: ftAfter - ftBefore,
        });

        // Dry-run rollback: throw at the end of the transaction body. The
        // wrapper catches and rolls back; we filter the sentinel above.
        if (!apply) throw new Error(DRY_RUN_SENTINEL);
    });

    try {
        txn();
        if (apply) console.log('[unify] APPLIED — transaction committed');
    } catch (e: any) {
        if (String(e?.message || e).includes(DRY_RUN_SENTINEL)) {
            console.log('[unify] DRY-RUN — no writes (use --apply to commit)');
        } else {
            throw e;
        }
    }

    // ── Report ────────────────────────────────────────────────────
    console.log('\n═══ MIGRATION RESULTS ═══\n');
    console.log('Table'.padEnd(45) + 'Source'.padStart(8) + 'Before'.padStart(8) + 'After'.padStart(8) + 'Inserted'.padStart(10) + '   Status');
    console.log('─'.repeat(95));
    for (const r of results) {
        const status = r.skipped ? `SKIPPED — ${r.skip_reason}` : (r.inserted >= 0 ? 'OK' : 'WARN: row count went DOWN');
        console.log(
            r.table.padEnd(45) +
            String(r.source_rows).padStart(8) +
            String(r.target_before).padStart(8) +
            String(r.target_after).padStart(8) +
            String(r.inserted).padStart(10) +
            '   ' + status
        );
    }
    console.log('─'.repeat(95));

    const totalInserted = results.filter(r => !r.skipped).reduce((s, r) => s + r.inserted, 0);
    const tablesCopied = results.filter(r => !r.skipped && r.inserted > 0).length;
    console.log(`\nTotal: ${tablesCopied} tables received rows; ${totalInserted} rows inserted overall.`);

    // ── Audit log ─────────────────────────────────────────────────
    if (apply) {
        fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
        const audit = {
            ts: new Date().toISOString(),
            source: sourcePath,
            target: targetPath,
            results,
            total_inserted: totalInserted,
            tables_with_inserts: tablesCopied,
        };
        fs.appendFileSync(AUDIT_PATH, JSON.stringify(audit) + '\n');
        console.log(`\n[unify] Audit log appended: ${AUDIT_PATH}`);
    }

    // Re-enable FKs and verify integrity.
    db.exec('PRAGMA foreign_keys = ON');
    if (apply) {
        const fkErrors = db.prepare(`PRAGMA foreign_key_check`).all() as any[];
        if (fkErrors.length > 0) {
            console.error(`\n[unify] WARNING: ${fkErrors.length} FK violations detected post-migration:`);
            for (const e of fkErrors.slice(0, 10)) {
                console.error(`  ${JSON.stringify(e)}`);
            }
            console.error('[unify] Investigate before declaring cutover complete.');
            process.exit(4);
        }
        console.log('[unify] FK integrity verified ✓');
    }

    db.exec(`DETACH DATABASE src`);
    db.close();
}

main().catch((err) => {
    console.error('[unify] FATAL:', err.message || err);
    process.exit(2);
});
