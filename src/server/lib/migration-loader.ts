/**
 * migration-loader.ts — the ONE discovery + validation path for state migrations (P3c,
 * S220). Extracted so `han-migrate` (the runner) and `han-update` (the ceremony's
 * pre-flight, DEC-102 Ring 2) validate the SAME contract — a migration the runner would
 * accept is exactly the migration the ceremony reasons about, one path not two.
 *
 * Contract enforced here (state-schema.ts is the declaration; this is its gate):
 *   - files `NNN-*.ts`, each default-exporting a Migration with numeric id + up + verify;
 *   - ids strictly 1..N, no gaps;
 *   - P3c: `touchesState` non-empty ⇒ `stateChangeKind` REQUIRED and valid — an authored-
 *     state migration that does not declare its kind cannot be loaded at all, so the
 *     ceremony's content-preserving/schema-moving dispatch can never meet an undeclared
 *     kind (fail-closed at load, not at ceremony time).
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Migration } from './state-schema';

const KINDS = ['content-preserving', 'schema-moving'] as const;

/** Load + validate every migration in `dir` (absolute). Throws on any contract violation. */
export function loadMigrationsFrom(dir: string): Migration[] {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}-.*\.ts$/.test(f)).sort();
    const migs = files.map((f) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const m = require(path.join(dir, f)).default as Migration;
        if (!m || typeof m.id !== 'number' || !m.up || !m.verify) {
            throw new Error(`${f}: not a valid Migration export`);
        }
        if (m.touchesState && m.touchesState.length > 0) {
            if (!m.stateChangeKind || !KINDS.includes(m.stateChangeKind)) {
                throw new Error(
                    `${f}: declares touchesState but no valid stateChangeKind — an authored-state ` +
                    `migration MUST declare 'content-preserving' or 'schema-moving' (DEC-102 Ring 2; ` +
                    `the ceremony's dispatch is typed, never inferred)`,
                );
            }
        }
        return m;
    });
    migs.forEach((m, i) => {
        if (m.id !== i + 1) throw new Error(`migration ids must be 1..N with no gaps (found ${m.id} at position ${i + 1})`);
    });
    return migs;
}

/** The pending window: (current, expected]. */
export function pendingMigrations(dir: string, current: number, expected: number): Migration[] {
    return loadMigrationsFrom(dir).filter((m) => m.id > current && m.id <= expected);
}

/** The DB's current schema version (absent file or absent schema_meta table = v0 — the
 *  pre-P2 state). Read-only; lives here so every consumer answers "what version is this
 *  garden" through the same lens the loader answers "what migrations exist". */
export function currentSchemaVersion(dbPath: string): number {
    if (!fs.existsSync(dbPath)) return 0;
    const db = new Database(dbPath, { readonly: true });
    try {
        const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'`).get();
        if (!has) return 0;
        return (db.prepare(`SELECT schema_version FROM schema_meta WHERE id=1`).get() as { schema_version?: number } | undefined)?.schema_version ?? 0;
    } finally { db.close(); }
}
