/**
 * state-schema.ts — the engine's declaration of the state shape it expects (P2 of the
 * live-garden update pipeline, S218; thread mqz3wev0; Jim's plan-check mrahm1y7-era design).
 *
 * TWO version surfaces, one contract:
 *   - `EXPECTED_SCHEMA_VERSION` — the gradient.db schema this engine build expects. The DB
 *     carries its actual version in the single-row `schema_meta` table (absent table = v0,
 *     the pre-P2 state). `han-migrate` closes the gap: pending = (current, EXPECTED].
 *   - `EXPECTED_FORMAT_VERSIONS` — the memory-FILE formats (the MNT-023 heading-repair was a
 *     file migration done by hand; this gives that class a version). The garden carries its
 *     actuals in `$HAN_HOME/state-meta.json` (absent = all v1, today's formats).
 *
 * The migration FRAMEWORK's law (DEC-069 at the framework layer): forward-only; NO down()
 * migrations (a down IS destroy-and-reconstruct — the byte-exact pre-copy is the rollback);
 * every up() transforms / supersedes / quarantines — never DROPs, never DELETEs.
 */

/** The gradient.db schema version this engine expects. Bump ONLY with a matching
 *  migrations/NNN-*.ts that closes the gap non-destructively. */
export const EXPECTED_SCHEMA_VERSION = 1;

/** The memory-file format versions this engine expects. */
export const EXPECTED_FORMAT_VERSIONS: Record<string, number> = {
    workingMemoryPair: 1,   // the DEC-085 c0/c1 pair + WM-BOUNDARY marker grammar
    feltMoments: 1,         // numbered-entry prose
    identityManifest: 1,    // the DEC-083 signed-manifest format
};

/** The single-row version table's DDL — created by migration 001 (genesis). */
export const SCHEMA_META_DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    applied_log TEXT NOT NULL DEFAULT '[]'
)`;

export interface MigrationCtx {
    /** Absolute path to THE COPY of gradient.db (never the live DB). */
    dbPath: string;
    /** Absolute path to the copy-dir of any memory trees this migration touches (empty for
     *  DB-only migrations; the runner populates it per the migration's `touchesState`). */
    stateDir: string | null;
    log: (msg: string) => void;
}

export interface Migration {
    /** The version this migration RESULTS IN (001-genesis → 1). Strictly ordered, no gaps. */
    id: number;
    description: string;
    /** Memory trees (relative to $HAN_HOME) this migration transforms; the runner copies them
     *  first and swaps them with the DB atomically. Empty/omitted = DB-only. */
    touchesState?: string[];
    /** Runs against the COPY only. Non-destructive: transform/supersede/quarantine — never
     *  DROP/DELETE (DEC-069). Throwing aborts the whole run; the live state is untouched. */
    up(ctx: MigrationCtx): void | Promise<void>;
    /** Verifies the copy post-up. Return true, or a string describing the failure (which
     *  aborts the run, live state untouched). */
    verify(ctx: MigrationCtx): boolean | string | Promise<boolean | string>;
}
