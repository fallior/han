#!/usr/bin/env tsx
/**
 * han-migrate.ts — the state-migration runner (P2 of the update pipeline, S218).
 *
 * pending = (current schema_version, EXPECTED_SCHEMA_VERSION] → COPY gradient.db (online-safe
 * via better-sqlite3 .backup()) → run each migration's up() ON THE COPY → its verify() + the
 * generic integrity sweep → ATOMIC SWAP (live → gradient.db.pre-v<N>-<ts>, the DEC-069
 * rollback artifact; copy → live) → stamp → retention (keep newest 2 pre-copies; older MOVE
 * to $HAN_HOME/archives/db — never delete).
 *
 * THE QUIESCE GATE (fork-4, lean (a) — CHECK, never trust): refuses to run unless the
 * supervisor is paused at its owner AND wm-sensor is inactive AND no rotation lock is held.
 * `--force` overrides, loudly. `--dry-run` (the default) does everything except the swap.
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/han-migrate.ts [--apply] [--force]
 */
import Database from 'better-sqlite3';
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { hanHome, hanRepo } from '../src/server/lib/paths';
import { EXPECTED_SCHEMA_VERSION, EXPECTED_FORMAT_VERSIONS, Migration } from '../src/server/lib/state-schema';
// SEC-06 (Tenshi's audit, S219): the quiesce owner + port derive from the manifest —
// never a hardcoded 3848/"jim" (the roster-copy class; on any other garden the hardcode
// either aborts every migration or, with --force, proceeds ungated). The import is LAZY
// (inside quiesceGate): garden-manifest fail-loud-loads $HAN_HOME/garden-manifest.json at
// module eval, and a garden without one (a scratch/test garden) must surface through the
// gate's problems list — forceable, consistent — never an import-time crash.

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
// test-only: the scratch-DB suite skips the per-resident load-gradient smoke (an empty scratch
// garden has no gradient to load); the REAL acceptance always runs it (never pass this live).
const SKIP_SMOKE = process.argv.includes('--skip-smoke');
const log = (m: string) => console.log(`[han-migrate] ${m}`);

const DB_LIVE = process.env.HAN_DB_PATH || path.join(hanHome(), 'gradient.db');

function fail(msg: string): never { console.error(`[han-migrate] ABORT: ${msg}`); process.exit(1); }

// ── the quiesce gate: CHECK, never trust ─────────────────────────────────
function quiesceGate(): void {
    const problems: string[] = [];
    // SEC-06: resolve the supervisor-cycle OWNER (slug + port) from the manifest, lazily.
    let owner: { slug: string } | undefined;
    let ownerPort: number | undefined;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const gm = require('../src/server/lib/garden-manifest');
        owner = gm.loadResidents().find((a: { slug: string }) => gm.runsSupervisorCycle(a.slug));
        ownerPort = owner ? gm.allocationFor(owner.slug)?.port : undefined;
    } catch (e) {
        problems.push(`cannot load the garden manifest (${(e as Error).message.slice(0, 100)})`);
    }
    if (!owner || !ownerPort) {
        problems.push('no supervisor-cycle owner resolvable from the manifest — cannot verify quiesce');
    } else {
        try {
            const st = JSON.parse(execSync(
                `curl -sk https://localhost:${ownerPort}/api/supervisor/status`, { timeout: 10_000 }).toString());
            if (st.paused !== true) problems.push(`supervisor NOT paused (pause at the owner: POST ${ownerPort} /api/supervisor/pause)`);
        } catch { problems.push(`cannot read supervisor status at ${ownerPort} (is ${owner.slug}'s server up?)`); }
    }
    try {
        const active = execSync('systemctl --user is-active wm-sensor.service || true').toString().trim();
        if (active === 'active') problems.push('wm-sensor is ACTIVE (systemctl --user stop wm-sensor)');
    } catch { /* systemctl absent → cannot verify */ problems.push('cannot query wm-sensor state'); }
    const locks = fs.readdirSync(path.join(hanHome(), 'signals')).filter((f) => f.startsWith('wm-sensor-') && f.endsWith('-active'));
    if (locks.length) problems.push(`rotation lock(s) held: ${locks.join(', ')}`);
    if (problems.length) {
        if (FORCE) { problems.forEach((p) => log(`⚠ FORCED past: ${p}`)); return; }
        fail(`quiesce gate:\n  - ${problems.join('\n  - ')}\n(--force overrides, loudly — the DEC-080 lesson says don't)`);
    }
    log('quiesce gate: clear (supervisor paused, sensor stopped, no rotation locks)');
}

// ── migrations discovery ─────────────────────────────────────────────────
function loadMigrations(): Migration[] {
    const dir = path.join(hanRepo(), 'migrations');
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}-.*\.ts$/.test(f)).sort();
    const migs = files.map((f) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const m = require(path.join(dir, f)).default as Migration;
        if (!m || typeof m.id !== 'number' || !m.up || !m.verify) fail(`${f}: not a valid Migration export`);
        return m;
    });
    migs.forEach((m, i) => { if (m.id !== i + 1) fail(`migration ids must be 1..N with no gaps (found ${m.id} at position ${i + 1})`); });
    return migs;
}

function currentVersion(dbPath: string): number {
    const db = new Database(dbPath, { readonly: true });
    try {
        const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'`).get();
        if (!has) return 0;
        return (db.prepare(`SELECT schema_version FROM schema_meta WHERE id=1`).get() as any)?.schema_version ?? 0;
    } finally { db.close(); }
}

// ── the generic integrity sweep ──────────────────────────────────────────
const MEMORY_TABLES = ['gradient_entries', 'feeling_tags', 'conversations', 'conversation_messages'];
function tableCounts(dbPath: string): Record<string, number> {
    const db = new Database(dbPath, { readonly: true });
    try {
        const out: Record<string, number> = {};
        for (const t of MEMORY_TABLES) {
            try { out[t] = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c; } catch { /* absent table */ }
        }
        return out;
    } finally { db.close(); }
}
function integritySweep(copyPath: string, pre: Record<string, number>): void {
    const db = new Database(copyPath, { readonly: true });
    try {
        const ic = (db.prepare('PRAGMA integrity_check').get() as any);
        const verdict = ic[Object.keys(ic)[0]];
        if (verdict !== 'ok') fail(`integrity_check: ${verdict}`);
    } finally { db.close(); }
    const post = tableCounts(copyPath);
    for (const [t, n] of Object.entries(pre)) {
        if ((post[t] ?? 0) < n) fail(`non-destructive violated: ${t} shrank ${n} → ${post[t] ?? 0}`);
    }
    log(`integrity sweep: ok (counts: ${Object.entries(post).map(([t, n]) => `${t}=${n}`).join(' ')})`);
    // the load-gradient smoke per resident, against the COPY
    if (SKIP_SMOKE) { log('load-gradient smoke: SKIPPED (--skip-smoke, test-only)'); return; }
    const slugs = JSON.parse(execFileSync(
        path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx'),
        ['-e', "import { loadResidents } from './lib/garden-manifest'; console.log(JSON.stringify(loadResidents().filter(a=>a.active).map(a=>a.slug)));"],
        { cwd: path.join(hanRepo(), 'src', 'server') }).toString().trim().split('\n').pop()!);
    for (const slug of slugs) {
        const out = execFileSync(
            path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx'),
            [path.join(hanRepo(), 'scripts', 'load-gradient.ts'), slug],
            { cwd: path.join(hanRepo(), 'src', 'server'), env: { ...process.env, HAN_DB_PATH: copyPath }, maxBuffer: 64 * 1024 * 1024 }).toString();
        if (!out.includes('GRADIENT-EOF')) fail(`load-gradient smoke (${slug}): no GRADIENT-EOF on the copy`);
    }
    log(`load-gradient smoke: ok for ${slugs.join(', ')}`);
}

// ── main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    // Fold-2 (Jim's SEC-08 confidentiality half; Tenshi's refinement, S219): umask BEFORE any
    // copy exists, not chmod-after — backup() writes the whole DB into the file over seconds,
    // and a chmod-after leaves that window world-readable. Under umask every copy class
    // (.migrating-*, the swapped-in live, archives, state-meta) is born 0600 — including the
    // FAILURE path's retained forensic copy, which a chmod-on-success would miss.
    process.umask(0o077);
    const current = currentVersion(DB_LIVE);
    // Downgrade/replay guard, STATE half (Jim's catch, S219 — the SEC-01 replay weapon's
    // state-layer face): an engine OLDER than the DB must ABORT loudly, never exit
    // "nothing to do" success. Explicit signed rollback is the only lawful reverse.
    if (current > EXPECTED_SCHEMA_VERSION) {
        fail(`engine older than state: schema_version v${current} > expected v${EXPECTED_SCHEMA_VERSION} — ` +
            `refusing to run (downgrade/replay guard; explicit signed rollback is the only lawful reverse)`);
    }
    // SEC-10 (Tenshi, S219): the FORMAT axis twin — per-key monotonicity over the authored-file
    // formats. state-meta.json's formatVersions govern the cloth (WM pair, felt-moments, the
    // identity manifest); an engine that doesn't understand a format must never run against it.
    const smGuardPath = path.join(hanHome(), 'state-meta.json');
    if (fs.existsSync(smGuardPath)) {
        const sm = JSON.parse(fs.readFileSync(smGuardPath, 'utf8'));
        for (const [k, v] of Object.entries((sm.formatVersions ?? {}) as Record<string, number>)) {
            const known = (EXPECTED_FORMAT_VERSIONS as Record<string, number>)[k];
            if (known === undefined) {
                fail(`state format '${k}' unknown to this engine (engine older than state) — refusing to run (SEC-10)`);
            }
            if (v > known) {
                fail(`engine older than state on format '${k}': v${v} > expected v${known} — ` +
                    `refusing to run (SEC-10; explicit signed rollback is the only lawful reverse)`);
            }
        }
    }
    const migs = loadMigrations().filter((m) => m.id > current && m.id <= EXPECTED_SCHEMA_VERSION);
    log(`current=v${current} expected=v${EXPECTED_SCHEMA_VERSION} pending=${migs.length} mode=${APPLY ? 'APPLY' : 'dry-run'}`);
    if (!migs.length) { log('nothing to do'); return; }
    quiesceGate();

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const copyPath = `${DB_LIVE}.migrating-${ts}`;
    const pre = tableCounts(DB_LIVE);
    const live = new Database(DB_LIVE, { readonly: true });
    try {
        // better-sqlite3 online backup — WAL-aware, safe against a live DB; promise-based
        await live.backup(copyPath);
    } finally { live.close(); }
    log(`copied → ${path.basename(copyPath)} (${fs.statSync(copyPath).size} bytes)`);

    for (const m of migs) {
        log(`running ${String(m.id).padStart(3, '0')} — ${m.description}`);
        const ctx = { dbPath: copyPath, stateDir: null, log };
        await m.up(ctx);
        const verdict = await m.verify(ctx);
        if (verdict !== true) fail(`verify(${m.id}): ${verdict}`);
        // authoritative stamp on the copy (001 creates the table; the runner keeps the log)
        const db = new Database(copyPath);
        try {
            db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id=1), schema_version INTEGER NOT NULL, applied_log TEXT NOT NULL DEFAULT '[]')`);
            const row = db.prepare('SELECT applied_log FROM schema_meta WHERE id=1').get() as any;
            const logArr = row ? JSON.parse(row.applied_log) : [];
            if (!logArr.some((e: any) => e.id === m.id)) logArr.push({ id: m.id, description: m.description, ts: new Date().toISOString() });
            db.prepare('INSERT OR REPLACE INTO schema_meta (id, schema_version, applied_log) VALUES (1, ?, ?)')
              .run(m.id, JSON.stringify(logArr));
        } finally { db.close(); }
    }
    integritySweep(copyPath, pre);

    // S219 genesis live-prove lesson #1: the stamp lives in the COPY's WAL until checkpointed —
    // a rename-swap moves only the main file, so the copy must be made SELF-CONTAINED first.
    // TRUNCATE folds every frame into the main file and empties the sidecars.
    {
        const db = new Database(copyPath);
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
        for (const side of ['-wal', '-shm']) {
            const p = copyPath + side;
            if (fs.existsSync(p) && fs.statSync(p).size === 0) fs.unlinkSync(p);
        }
    }

    if (!APPLY) {
        // Fold-2: a SUCCESSFUL dry-run leaves nothing behind — the verified copy is deleted
        // (it was scratch, never memory-canon; DEC-069 untouched). A FAILED run exits via
        // fail() above and deliberately RETAINS its copy for forensics — born 0600 by umask.
        fs.unlinkSync(copyPath);
        log(`DRY-RUN COMPLETE — copy verified + removed; live untouched. Re-run with --apply to swap.`);
        return;
    }
    // S219 genesis live-prove lesson #2: NEVER swap under open handles. A long-running process
    // holding a better-sqlite3 fd keeps writing the OLD inode after the rename — a silent
    // split-brain (2 UVs + 2 feeling-tags diverged in ~90s at the genesis prove, hand-recovered).
    // fuser exit 0 = in use → ABORT naming the holders. NOT --force-bypassable (the same class
    // as the downgrade guards: the lawful path is stopping the services, not a flag).
    {
        let holders: string | null = null; // null = could not verify
        try {
            holders = execSync(`fuser ${DB_LIVE} 2>/dev/null`).toString().trim(); // exit 0 → in use
        } catch (e) {
            const status = (e as { status?: unknown }).status;
            if (typeof status === 'number' && status > 0) holders = ''; // clean "not in use"
        }
        if (holders === null) fail('cannot verify open handles on the live DB (fuser unavailable/failed) — refusing to swap (fail-closed)');
        if (holders) {
            fail(`live DB has OPEN HANDLES (pids:${holders}) — stop the DB-writing services before --apply; ` +
                `a swap under open fds split-brains writers onto the old inode (S219 genesis lesson)`);
        }
    }
    // atomic swap + retention
    const preCopy = `${DB_LIVE}.pre-v${EXPECTED_SCHEMA_VERSION}-${ts}`;
    fs.renameSync(DB_LIVE, preCopy);
    // S219 lesson #3: the LIVE db's sidecars belong to the OLD inode — re-pair them with their
    // true owner (the pre-copy) so the new live never starts beside a stale WAL/shm (which
    // poisons readers into resolving the old generation — the "v0 after apply" symptom).
    for (const side of ['-wal', '-shm']) {
        const p = DB_LIVE + side;
        if (fs.existsSync(p)) fs.renameSync(p, preCopy + side);
    }
    // Fold-2: rename PRESERVES the old live file's mode (644 today — the SEC-09 source-mode
    // issue), so the rollback pre-copy needs an explicit 0600; the swapped-in live (the copy)
    // was born 0600 under the umask — the first apply hardens the live DB as a side-effect.
    fs.chmodSync(preCopy, 0o600);
    fs.renameSync(copyPath, DB_LIVE);
    log(`SWAPPED: live → ${path.basename(preCopy)} (the rollback); copy → live; now v${EXPECTED_SCHEMA_VERSION}`);
    // state-meta.json formats (first write = today's v1s)
    const smPath = path.join(hanHome(), 'state-meta.json');
    if (!fs.existsSync(smPath)) {
        fs.writeFileSync(smPath, JSON.stringify({ formatVersions: EXPECTED_FORMAT_VERSIONS }, null, 2) + '\n');
        log('state-meta.json written (formatVersions v1)');
    }
    // retention: keep newest 2 pre-copies; archive older (move, never delete — DEC-069).
    // Sidecars (-wal/-shm, re-paired at the swap) are NOT pre-copies — exclude them from the
    // count (else they push the real pre-copy over the keep-2 line — the S219 suite catch) and
    // move them WITH their owner when it archives.
    const dir = path.dirname(DB_LIVE);
    const pres = fs.readdirSync(dir)
        .filter((f) => f.startsWith(path.basename(DB_LIVE) + '.pre-v') && !f.endsWith('-wal') && !f.endsWith('-shm'))
        .sort().reverse();
    const archiveDir = path.join(hanHome(), 'archives', 'db');
    for (const old of pres.slice(2)) {
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(path.join(dir, old), path.join(archiveDir, old));
        for (const side of ['-wal', '-shm']) {
            if (fs.existsSync(path.join(dir, old + side))) fs.renameSync(path.join(dir, old + side), path.join(archiveDir, old + side));
        }
        log(`retention: archived ${old} (+sidecars if any) → archives/db/`);
    }
}

main().catch((e) => fail((e as Error).message));
