#!/usr/bin/env tsx
/**
 * test-han-migrate.ts — P2's standing suite. Runs the REAL runner against a SCRATCH garden
 * (HAN_HOME + HAN_DB_PATH both scratch; --force bypasses the live quiesce gate; --skip-smoke
 * because a scratch garden has no gradient). The genesis-on-the-REAL-garden acceptance is the
 * separate live-prove (quiesced, no force, full smoke).
 */
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { mkdtempSync, existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { hanRepo } from '../src/server/lib/paths';

let pass = 0, failn = 0;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${n}`); ok ? pass++ : failn++; };
const TSX = path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx');
const RUNNER = path.join(hanRepo(), 'scripts', 'han-migrate.ts');

function scratchGarden(): { home: string; db: string } {
    const home = mkdtempSync(path.join(tmpdir(), 'hm-'));
    mkdirSync(path.join(home, 'signals'), { recursive: true });
    const db = path.join(home, 'gradient.db');
    const d = new Database(db);
    d.exec(`CREATE TABLE gradient_entries (id TEXT PRIMARY KEY, agent TEXT, level TEXT, content TEXT);
            CREATE TABLE feeling_tags (id INTEGER PRIMARY KEY, gradient_entry_id TEXT, content TEXT);`);
    d.prepare(`INSERT INTO gradient_entries VALUES ('e1','leo','c0','a memory')`).run();
    d.prepare(`INSERT INTO feeling_tags (gradient_entry_id, content) VALUES ('e1','warm')`).run();
    d.close();
    return { home, db };
}
function run(home: string, db: string, args: string[]): { out: string; code: number } {
    try {
        const out = execFileSync(TSX, [RUNNER, ...args], {
            cwd: path.join(hanRepo(), 'src', 'server'),
            env: { ...process.env, HAN_HOME: home, HAN_DB_PATH: db, NODE_PATH: path.join(hanRepo(), 'src', 'server', 'node_modules') }, stdio: 'pipe',
        }).toString();
        return { out, code: 0 };
    } catch (e: any) { return { out: String(e.stdout ?? '') + String(e.stderr ?? ''), code: e.status ?? 1 }; }
}

// 1) dry-run: copy verified, live untouched, NOT stamped
{
    const { home, db } = scratchGarden();
    const r = run(home, db, ['--force', '--skip-smoke']);
    check('dry-run exits 0', r.code === 0);
    check('dry-run reports copy verified + live untouched', r.out.includes('DRY-RUN COMPLETE'));
    const d = new Database(db, { readonly: true });
    const has = d.prepare(`SELECT name FROM sqlite_master WHERE name='schema_meta'`).get();
    d.close();
    check('dry-run: live DB has NO schema_meta (untouched)', !has);
}
// 2) apply: swap + stamp + pre-copy + state-meta
{
    const { home, db } = scratchGarden();
    const r = run(home, db, ['--apply', '--force', '--skip-smoke']);
    check('apply exits 0', r.code === 0);
    const d = new Database(db, { readonly: true });
    const v = (d.prepare(`SELECT schema_version FROM schema_meta WHERE id=1`).get() as any)?.schema_version;
    const rows = (d.prepare(`SELECT COUNT(*) c FROM gradient_entries`).get() as any).c;
    d.close();
    check('apply: live stamped v1', v === 1);
    check('apply: memory rows intact (non-destructive)', rows === 1);
    check('apply: pre-copy rollback artifact exists', readdirSync(path.dirname(db)).some((f) => f.includes('.pre-v1-')));
    check('apply: state-meta.json written', existsSync(path.join(home, 'state-meta.json')));
    // idempotence: second run = nothing to do
    const r2 = run(home, db, ['--apply', '--force', '--skip-smoke']);
    check('second run: nothing to do', r2.out.includes('nothing to do'));
}
// 3) the quiesce gate REFUSES without --force when a rotation lock is held
{
    const { home, db } = scratchGarden();
    writeFileSync(path.join(home, 'signals', 'wm-sensor-leo-active'), 'x');
    const r = run(home, db, ['--skip-smoke']);
    check('quiesce gate: refuses on a held rotation lock (no --force)', r.code !== 0 && r.out.includes('rotation lock'));
}
// 4) a failing verify aborts with the live DB untouched
{
    const { home, db } = scratchGarden();
    // sabotage: a migrations dir with a failing verify, via HAN_REPO pointing at a scratch repo clone-lite
    const fakeRepo = mkdtempSync(path.join(tmpdir(), 'hm-repo-'));
    mkdirSync(path.join(fakeRepo, 'migrations'), { recursive: true });
    writeFileSync(path.join(fakeRepo, 'migrations', '001-bad.ts'),
        `const m = { id: 1, description: 'bad', up() {/*noop*/}, verify() { return 'deliberate failure'; } }; export default m;`);
    const r = (() => { try {
        const out = execFileSync(TSX, [RUNNER, '--apply', '--force', '--skip-smoke'], {
            cwd: path.join(hanRepo(), 'src', 'server'),
            env: { ...process.env, HAN_HOME: home, HAN_DB_PATH: db, HAN_REPO: fakeRepo, NODE_PATH: path.join(hanRepo(), 'src', 'server', 'node_modules') }, stdio: 'pipe' }).toString();
        return { out, code: 0 };
    } catch (e: any) { return { out: String(e.stdout ?? '') + String(e.stderr ?? ''), code: e.status ?? 1 }; } })();
    check('failing verify aborts non-zero naming the failure', r.code !== 0 && r.out.includes('deliberate failure'));
    const d = new Database(db, { readonly: true });
    const has = d.prepare(`SELECT name FROM sqlite_master WHERE name='schema_meta'`).get();
    d.close();
    check('failing verify: live DB untouched', !has);
}

// 5) downgrade/replay guard (Jim's state-half catch, S219): engine OLDER than the DB must
//    ABORT non-zero — never "nothing to do" success — and --force must NOT bypass it
//    (the lawful reverse is an explicit signed rollback, not a flag).
{
    const { home, db } = scratchGarden();
    const d = new Database(db);
    d.exec(`CREATE TABLE schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, applied_log TEXT NOT NULL DEFAULT '[]')`);
    d.prepare(`INSERT INTO schema_meta (id, schema_version) VALUES (1, 99)`).run();
    d.close();
    const r = run(home, db, ['--force', '--skip-smoke']);
    check('downgrade guard: engine older than schema → non-zero abort (even with --force)',
        r.code !== 0 && r.out.includes('engine older than state'));
}
// 6) SEC-10 (Tenshi, S219): the FORMAT-axis monotonicity twin — a formatVersions key NEWER
//    than the engine's EXPECTED_FORMAT_VERSIONS must abort.
{
    const { home, db } = scratchGarden();
    writeFileSync(path.join(home, 'state-meta.json'), JSON.stringify({ formatVersions: { workingMemoryPair: 99 } }));
    const r = run(home, db, ['--force', '--skip-smoke']);
    check('SEC-10: authored-file format newer than engine → non-zero abort',
        r.code !== 0 && r.out.includes(`format 'workingMemoryPair'`));
}
// 7) SEC-10: a format KEY unknown to this engine (engine older than state) must abort too.
{
    const { home, db } = scratchGarden();
    writeFileSync(path.join(home, 'state-meta.json'), JSON.stringify({ formatVersions: { mysteryBlob: 1 } }));
    const r = run(home, db, ['--force', '--skip-smoke']);
    check('SEC-10: unknown format key → non-zero abort',
        r.code !== 0 && r.out.includes(`'mysteryBlob' unknown to this engine`));
}

// 8) Fold-2 (SEC-08 confidentiality): a successful dry-run leaves NO .migrating-* copy behind.
{
    const { home, db } = scratchGarden();
    const r = run(home, db, ['--force', '--skip-smoke']);
    const leftovers = readdirSync(path.dirname(db)).filter((f) => f.includes('.migrating-'));
    check('fold-2: successful dry-run removes its working copy', r.code === 0 && leftovers.length === 0);
}
// 9) Fold-2: apply → the rollback pre-copy AND the swapped-in live DB are mode 0600.
{
    const { home, db } = scratchGarden();
    const r = run(home, db, ['--apply', '--force', '--skip-smoke']);
    const dir = path.dirname(db);
    const preName = readdirSync(dir).find((f) => f.includes('.pre-v'));
    const mode = (p: string) => statSync(p).mode & 0o777;
    check('fold-2: pre-copy exists and is 0600', r.code === 0 && !!preName && mode(path.join(dir, preName)) === 0o600);
    check('fold-2: swapped-in live DB is 0600 (born under umask)', mode(db) === 0o600);
}

console.log(`\nhan-migrate: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
