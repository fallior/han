#!/usr/bin/env tsx
/**
 * test-state-copy.ts — the standing suite for the P3d STATE-COPY LEG foundation in han-migrate
 * (Option A, Jim's fork ruling): the structural WALL + the --stage-only staging mechanism.
 *
 *   1. THE WALL (Jim's ratified invariant): a standalone han-migrate run REFUSES a migration
 *      declaring `touchesState` — fail-closed, NOT --force-bypassable. An authored-state
 *      migration runs ONLY via `han update` (the ceremony's lawful door).
 *   2. --stage-only: copies the DB + every declared authored tree into the staging dir, runs the
 *      migration against those COPIES, verifies, writes a staging manifest, and does NOT swap —
 *      LIVE authored files are byte-unchanged (the swap is the ceremony's last act, in han update).
 *   3. same-filesystem rider (Jim rider-1): a staging dir on a different device is refused
 *      (rename-atomicity requires same-device).
 *
 * The han-update swap-orchestration over the staging (ceremony → atomic DB+state swap + journal
 * + recovery-before-wake) is the leg's second unit; its E2E rides the P3d scratch-garden acceptance.
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-state-copy.ts
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { hanRepo } from '../src/server/lib/paths';

let pass = 0, failn = 0;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${n}`); ok ? pass++ : failn++; };
const sh = (cmd: string) => execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// ── build a scratch world: a repo with a touchesState migration + a scratch HAN_HOME ──────────
const S = mkdtempSync(path.join(tmpdir(), 'statecopy-'));
mkdirSync(path.join(S, 'repo', 'migrations'), { recursive: true });
mkdirSync(path.join(S, 'repo', 'src'), { recursive: true });
mkdirSync(path.join(S, 'han', 'memory', 'testa'), { recursive: true });
mkdirSync(path.join(S, 'han', 'signals'), { recursive: true });
symlinkSync(path.join(hanRepo(), 'src', 'server'), path.join(S, 'repo', 'src', 'server'));
symlinkSync(path.join(hanRepo(), 'src', 'server', 'node_modules'), path.join(S, 'repo', 'node_modules'));
writeFileSync(path.join(S, 'repo', 'package.json'), '{"type":"commonjs"}\n');
writeFileSync(path.join(S, 'repo', 'migrations', '001-genesis.ts'), `
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Migration, SCHEMA_META_DDL } from '../src/server/lib/state-schema';
const migration: Migration = {
    id: 1,
    description: 'genesis + a DECLARED authored-state touch (state-copy fixture)',
    touchesState: ['memory/testa'],
    stateChangeKind: 'content-preserving',
    up(ctx) {
        const db = new Database(ctx.dbPath);
        try { db.exec(SCHEMA_META_DDL); db.prepare(\`INSERT OR REPLACE INTO schema_meta (id,schema_version,applied_log) VALUES (1,1,?)\`).run(JSON.stringify([{id:1,ts:'t'}])); } finally { db.close(); }
        if (ctx.stateDir) fs.writeFileSync(path.join(ctx.stateDir, 'memory/testa/identity.md'), '# Test A\\nStaged edit.\\n');
    },
    verify(ctx) { const db=new Database(ctx.dbPath,{readonly:true}); try { return (db.prepare(\`SELECT schema_version FROM schema_meta WHERE id=1\`).get() as any)?.schema_version===1||'bad'; } finally { db.close(); } },
};
export default migration;
`);
writeFileSync(path.join(S, 'han', 'memory', 'testa', 'identity.md'), '# Test A\n');
sh(`sqlite3 ${S}/han/gradient.db "CREATE TABLE IF NOT EXISTS gradient_entries (id TEXT);"`);

const migrate = (args: string): string => {
    const env = `HAN_HOME=${S}/han HAN_DB_PATH=${S}/han/gradient.db HAN_REPO=${S}/repo NODE_PATH=${path.join(hanRepo(), 'src', 'server', 'node_modules')}`;
    try {
        return execFileSync('bash', ['-c', `${env} ${path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx')} ${path.join(hanRepo(), 'scripts', 'han-migrate.ts')} ${args}`],
            { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    } catch (e: any) { return String(e.stdout ?? '') + String(e.stderr ?? ''); }
};

// 1) THE WALL — standalone --apply on a touchesState migration is refused, not --force-bypassable
{
    const out = migrate('--apply --force --skip-smoke');
    check('WALL: standalone --apply on a touchesState migration ABORTS (structural)', /ABORT: pending migration\(s\) declare touchesState/.test(out));
    check('WALL: the refusal names it not --force-bypassable', /not --force-bypassable/.test(out));
    check('WALL: LIVE identity.md untouched (wall blocks before any work)', readFileSync(path.join(S, 'han', 'memory', 'testa', 'identity.md'), 'utf8') === '# Test A\n');
}

// 2) --stage-only stages DB + tree, migrates the COPY, writes a manifest, does NOT swap
{
    rmSync(path.join(S, 'han', 'staging'), { recursive: true, force: true });
    const out = migrate(`--stage-only ${S}/han/staging --force --skip-smoke`);
    check('STAGE-ONLY completes without a swap', /STAGE-ONLY COMPLETE/.test(out) && /NO swap/.test(out));
    check('STAGE-ONLY: the staged tree carries the migrated edit', existsSync(path.join(S, 'han', 'staging', 'memory', 'testa', 'identity.md')) &&
        readFileSync(path.join(S, 'han', 'staging', 'memory', 'testa', 'identity.md'), 'utf8').includes('Staged edit'));
    check('STAGE-ONLY: LIVE identity.md is byte-UNCHANGED (no swap happened)', readFileSync(path.join(S, 'han', 'memory', 'testa', 'identity.md'), 'utf8') === '# Test A\n');
    const man = JSON.parse(readFileSync(path.join(S, 'han', 'staging', 'staging-manifest.json'), 'utf8'));
    check('STAGE-ONLY: the manifest names the state trees + the staged DB', man.stateTrees.includes('memory/testa') && existsSync(man.dbCopy));
    check('STAGE-ONLY: the manifest carries the migration stateChangeKind (for the ceremony dispatch)', man.migrations[0].stateChangeKind === 'content-preserving');
}

// 3) same-filesystem rider — a staging dir on a different device is refused
//    (/dev/shm is a distinct tmpfs on this box; if it isn't a different device the assert is a no-op,
//    so gate the check on the devices actually differing to avoid a false failure on odd mounts.)
{
    let differentDevAvailable = false;
    try { differentDevAvailable = sh(`stat -c %d ${S}`).trim() !== sh(`stat -c %d /dev/shm`).trim(); } catch { /* no /dev/shm */ }
    if (differentDevAvailable) {
        const alt = sh(`mktemp -d /dev/shm/statecopy-alt-XXXX`).trim();
        const out = migrate(`--stage-only ${alt} --force --skip-smoke`);
        check('RIDER-1: a staging dir on a DIFFERENT filesystem is refused (rename-atomicity)', /different filesystem/i.test(out) || /same-device/i.test(out));
        sh(`rm -rf ${alt}`);
    } else {
        console.log('  — RIDER-1 same-fs check skipped (no distinct-device tmpdir available here)');
    }
}

rmSync(S, { recursive: true, force: true });
console.log(`\nstate-copy foundation: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
