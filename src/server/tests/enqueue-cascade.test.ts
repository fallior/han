#!/usr/bin/env node
/**
 * Tests for `enqueueCascadeForDisplacedAt` — the consolidated cascade-enqueue
 * helper introduced in S150 PR3 (voice-first thread `mor4o3r3-jvdjv1`).
 *
 * Replaces the previous duplicate `enqueueCascadeIfNeeded` in
 * `scripts/process-pending-compression.ts` and the inline body of
 * `bumpOnInsert` (which now wraps this helper).
 *
 * Tests use an in-memory SQLite via `better-sqlite3 :memory:` — fully isolated
 * from `~/.han/gradient.db`. Schema mirrors the production DDL for the two
 * tables the helper touches: `gradient_entries` and `pending_compressions`.
 *
 * Per Jim's pre-merge audit: 9 cases the merged helper must pass identically
 * to both prior implementations.
 */

import test from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';

// Route the singleton DB at a temp file BEFORE importing memory-gradient.ts.
// The helper takes its own `db` param, but importing the module loads db.ts
// which would otherwise touch ~/.han/gradient.db.
const TEST_TMP = path.join(os.tmpdir(), `han-enqueue-test-${Date.now()}.db`);
process.env.HAN_DB_PATH = TEST_TMP;

import { enqueueCascadeForDisplacedAt } from '../lib/memory-gradient';

// ── Schema setup ──────────────────────────────────────────────

function makeTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');

    // Mirror production DDL for the two tables the helper touches. Kept
    // minimal — only columns referenced by the helper or its filters.
    db.exec(`
        CREATE TABLE gradient_entries (
            id TEXT PRIMARY KEY,
            agent TEXT NOT NULL,
            session_label TEXT,
            level TEXT NOT NULL,
            content TEXT,
            content_type TEXT,
            source_id TEXT,
            superseded_by TEXT,
            cascade_halted_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_ge_agent_level ON gradient_entries(agent, level);
        CREATE INDEX idx_ge_source ON gradient_entries(source_id);

        CREATE TABLE pending_compressions (
            id TEXT PRIMARY KEY,
            agent TEXT NOT NULL,
            source_id TEXT NOT NULL,
            from_level TEXT NOT NULL,
            to_level TEXT NOT NULL,
            enqueued_at TEXT NOT NULL,
            claimed_at TEXT,
            claimed_by TEXT,
            completed_at TEXT,
            UNIQUE(agent, source_id, from_level)
        );
    `);
    return db;
}

let entryCounter = 0;
function insertEntry(db: Database.Database, params: {
    agent: string;
    level: string;
    sourceId?: string | null;
    supersededBy?: string | null;
    cascadeHaltedAt?: string | null;
    createdAt?: string;
}): string {
    const id = `entry-${++entryCounter}`;
    db.prepare(`
        INSERT INTO gradient_entries
            (id, agent, session_label, level, content, content_type,
             source_id, superseded_by, cascade_halted_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, params.agent, `label-${id}`, params.level,
        `content-${id}`, 'working-memory',
        params.sourceId ?? null,
        params.supersededBy ?? null,
        params.cascadeHaltedAt ?? null,
        params.createdAt ?? new Date().toISOString(),
    );
    return id;
}

function pendingCount(db: Database.Database, agent: string): number {
    return (db.prepare(`SELECT COUNT(*) as n FROM pending_compressions WHERE agent = ?`).get(agent) as any).n;
}

// ── 9 cases per Jim's pre-merge audit ─────────────────────────

test('case 1: level has slots (rank=cap+1 doesn\'t exist) — return null, no row', () => {
    const db = makeTestDb();
    // c1's cap is 3 (per DEC-068: c{n>=1}=3n). With 0 entries, no rank=4.
    const r = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.strictEqual(r.pendingId, null);
    assert.match(r.reason, /level has slots/);
    assert.strictEqual(pendingCount(db, 'leo'), 0);
});

test('case 2: cascade-paused signal present — return null, no row', () => {
    const db = makeTestDb();
    // Create the signal file BEFORE the call.
    const sigDir = path.join(process.env.HOME || '', '.han', 'signals');
    fs.mkdirSync(sigDir, { recursive: true });
    const sigPath = path.join(sigDir, 'cascade-paused');
    fs.writeFileSync(sigPath, '');
    try {
        // Set up displacement so the only reason for null would be cascade-paused
        for (let i = 0; i < 4; i++) insertEntry(db, { agent: 'leo', level: 'c1' });
        const r = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
        assert.strictEqual(r.pendingId, null);
        assert.strictEqual(r.reason, 'cascade-paused');
        assert.strictEqual(pendingCount(db, 'leo'), 0);
    } finally {
        fs.unlinkSync(sigPath);
    }
});

test('case 3: no further level (uv input) — return null, no row', () => {
    const db = makeTestDb();
    insertEntry(db, { agent: 'leo', level: 'uv' });
    insertEntry(db, { agent: 'leo', level: 'uv' });
    const r = enqueueCascadeForDisplacedAt(db, 'leo', 'uv');
    assert.strictEqual(r.pendingId, null);
    assert.match(r.reason, /no further level/);
    assert.strictEqual(pendingCount(db, 'leo'), 0);
});

test('case 4: already cascaded (descendant exists) — return null, no row', () => {
    const db = makeTestDb();
    // c1 cap = 3; create 4 entries to displace one
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
        ids.push(insertEntry(db, {
            agent: 'leo', level: 'c1',
            createdAt: new Date(Date.now() - (4 - i) * 1000).toISOString(),
        }));
    }
    // The displaced one (rank=4 by created_at DESC) is the OLDEST = ids[0]
    // Give it a descendant at c2
    insertEntry(db, { agent: 'leo', level: 'c2', sourceId: ids[0] });

    const r = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.strictEqual(r.pendingId, null);
    assert.match(r.reason, /already cascaded/);
    assert.strictEqual(pendingCount(db, 'leo'), 0);
});

test('case 5: clean displacement — return new pendingId, exactly one row', () => {
    const db = makeTestDb();
    for (let i = 0; i < 4; i++) {
        insertEntry(db, {
            agent: 'leo', level: 'c1',
            createdAt: new Date(Date.now() - (4 - i) * 1000).toISOString(),
        });
    }
    const r = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.ok(r.pendingId);
    assert.match(r.reason, /enqueued/);
    assert.strictEqual(pendingCount(db, 'leo'), 1);

    const row = db.prepare(`SELECT * FROM pending_compressions WHERE agent = 'leo'`).get() as any;
    assert.strictEqual(row.from_level, 'c1');
    assert.strictEqual(row.to_level, 'c2');
});

test('case 6: UNIQUE conflict on second call — return null, no NEW row (Drift A fix)', () => {
    const db = makeTestDb();
    for (let i = 0; i < 4; i++) {
        insertEntry(db, {
            agent: 'leo', level: 'c1',
            createdAt: new Date(Date.now() - (4 - i) * 1000).toISOString(),
        });
    }
    // First call enqueues
    const first = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.ok(first.pendingId);
    assert.strictEqual(pendingCount(db, 'leo'), 1);

    // Second call with same state — UNIQUE conflict, must return null
    const second = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.strictEqual(second.pendingId, null, 'must return null on UNIQUE rejection');
    assert.match(second.reason, /already cascaded|already enqueued/);
    assert.strictEqual(pendingCount(db, 'leo'), 1, 'must not have added a new row');
});

test('case 7: superseded source skipped by displacement query', () => {
    const db = makeTestDb();
    // 4 entries at c1; mark the OLDEST (would-be-displaced) as superseded
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
        ids.push(insertEntry(db, {
            agent: 'leo', level: 'c1',
            createdAt: new Date(Date.now() - (4 - i) * 1000).toISOString(),
        }));
    }
    db.prepare(`UPDATE gradient_entries SET superseded_by = 'whatever' WHERE id = ?`).run(ids[0]);

    // After superseding, only 3 live entries — no displacement, no enqueue.
    const r = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.strictEqual(r.pendingId, null);
    assert.match(r.reason, /level has slots/);
    assert.strictEqual(pendingCount(db, 'leo'), 0);
});

test('case 8: cascade_halted_at source skipped by displacement query', () => {
    const db = makeTestDb();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
        ids.push(insertEntry(db, {
            agent: 'leo', level: 'c1',
            createdAt: new Date(Date.now() - (4 - i) * 1000).toISOString(),
        }));
    }
    // Mark the would-be-displaced (oldest) as UV-halted
    db.prepare(`UPDATE gradient_entries SET cascade_halted_at = 'c1' WHERE id = ?`).run(ids[0]);

    const r = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.strictEqual(r.pendingId, null);
    assert.match(r.reason, /level has slots/);
    assert.strictEqual(pendingCount(db, 'leo'), 0);
});

test('case 9: idempotency — two consecutive calls with no DB change, second returns null', () => {
    // This is similar to case 6 but emphasises the *idempotency* contract
    // independently of the UNIQUE-conflict mechanism. After the first call
    // adds a pending row, the displaced source has not yet been processed
    // (no descendant at the next level), but the UNIQUE constraint catches
    // the re-enqueue attempt.
    const db = makeTestDb();
    for (let i = 0; i < 4; i++) {
        insertEntry(db, {
            agent: 'leo', level: 'c1',
            createdAt: new Date(Date.now() - (4 - i) * 1000).toISOString(),
        });
    }
    const first = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    const second = enqueueCascadeForDisplacedAt(db, 'leo', 'c1');
    assert.ok(first.pendingId);
    assert.strictEqual(second.pendingId, null);
    assert.strictEqual(pendingCount(db, 'leo'), 1, 'idempotent — exactly one row regardless of call count');
});

// ── Cleanup ──────────────────────────────────────────────────

test.after(() => {
    try { fs.unlinkSync(TEST_TMP); } catch { /* may not exist */ }
});
