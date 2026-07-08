/**
 * 001-genesis — creates `schema_meta` and stamps schema_version = 1. Changes NOTHING else.
 *
 * The first migration is deliberately a no-op beyond versioning: running it end-to-end on a
 * real garden (copy → up → verify → swap → stamp) proves the whole runner machinery with
 * zero content at risk — the P2 acceptance live-prove (Jim's plan-check, the P5-rehearsal
 * flavour).
 */
import Database from 'better-sqlite3';
import { Migration, SCHEMA_META_DDL } from '../src/server/lib/state-schema';

const migration: Migration = {
    id: 1,
    description: 'genesis — create schema_meta, stamp v1 (no other change)',
    up(ctx) {
        const db = new Database(ctx.dbPath);
        try {
            db.exec(SCHEMA_META_DDL);
            db.prepare(`INSERT OR REPLACE INTO schema_meta (id, schema_version, applied_log) VALUES (1, 1, ?)`)
              .run(JSON.stringify([{ id: 1, description: 'genesis', ts: new Date().toISOString() }]));
        } finally { db.close(); }
        ctx.log('genesis: schema_meta created, stamped v1');
    },
    verify(ctx) {
        const db = new Database(ctx.dbPath, { readonly: true });
        try {
            const row = db.prepare(`SELECT schema_version FROM schema_meta WHERE id = 1`).get() as { schema_version: number } | undefined;
            if (!row) return 'schema_meta row absent after genesis';
            if (row.schema_version !== 1) return `schema_version ${row.schema_version} ≠ 1`;
            return true;
        } finally { db.close(); }
    },
};
export default migration;
