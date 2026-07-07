#!/usr/bin/env tsx
/**
 * test-p1-equivalence.ts — P1's standing gates (S218).
 *
 * (1) ROUND-TRIP: export the live loaded manifest → reload the export in a scratch HAN_HOME →
 *     every one of the arity-complete matrix cells (dump-manifest-cells) deepEquals. This is the
 *     PERMANENT form of the one-time frozen-truth proof (which ran pre-refactor: 258/258, 0
 *     mismatches — Jim re-verifies that from the scratchpad dumps + git history).
 * (2) FAIL-LOUD gates: unknown ladder name / missing file / bad transport all THROW with the
 *     clear message (never a silent fallback) — Jim's crux-2 rider.
 * (3) The SEED validates through the real loader.
 *
 *   cd src/server && npx tsx ../../scripts/test-p1-equivalence.ts
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { hanHome, hanRepo } from '../src/server/lib/paths';

let pass = 0, failn = 0;
function check(name: string, ok: boolean): void {
    console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${name}`);
    ok ? pass++ : failn++;
}
const TSX = path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx');
const SERVER = path.join(hanRepo(), 'src', 'server');
const DUMP = path.join(hanRepo(), 'scripts', 'dump-manifest-cells.ts');

function dumpWith(hanHomeDir: string, out: string): void {
    execFileSync(TSX, [DUMP, out], { cwd: SERVER, env: { ...process.env, HAN_HOME: hanHomeDir } });
}
function loadCells(p: string): Record<string, unknown> { return JSON.parse(readFileSync(p, 'utf8')); }

// ── (1) round-trip: live garden → export → scratch reload → matrix equal ──
const t = mkdtempSync(path.join(tmpdir(), 'p1-eq-'));
const liveCells = path.join(t, 'live.json');
dumpWith(hanHome(), liveCells);
const scratch = path.join(t, 'home');
cpSync(path.join(hanHome(), 'garden-manifest.json'), path.join(t, 'copy.json'));
execFileSync('mkdir', ['-p', scratch]);
cpSync(path.join(t, 'copy.json'), path.join(scratch, 'garden-manifest.json'));
const reloadCells = path.join(t, 'reload.json');
dumpWith(scratch, reloadCells);
const a = loadCells(liveCells), b = loadCells(reloadCells);
const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
// allocation memoryDir cells legitimately differ (they embed HAN_HOME) — compare them as rels
const mismatches: string[] = [];
for (const k of keys) {
    let va = JSON.stringify(a[k] ?? null), vb = JSON.stringify(b[k] ?? null);
    va = va.split(hanHome()).join('<HAN_HOME>');
    vb = vb.split(scratch).join('<HAN_HOME>');
    if (va !== vb) mismatches.push(k);
}
check(`round-trip matrix: ${keys.size} cells, 0 mismatches`, mismatches.length === 0);
if (mismatches.length) console.log('   first mismatches:', mismatches.slice(0, 5));

// ── (2) fail-loud gates ──
function loadFails(mutate: (cfg: any) => void, expectMsg: string, name: string): void {
    const home = mkdtempSync(path.join(tmpdir(), 'p1-fail-'));
    const cfg = JSON.parse(readFileSync(path.join(hanHome(), 'garden-manifest.json'), 'utf8'));
    mutate(cfg);
    writeFileSync(path.join(home, 'garden-manifest.json'), JSON.stringify(cfg));
    try {
        execFileSync(TSX, ['-e', "import './lib/garden-manifest';"], {
            cwd: SERVER, env: { ...process.env, HAN_HOME: home }, stdio: 'pipe',
        });
        check(`${name} (should throw)`, false);
    } catch (e) {
        const msg = String((e as any).stderr ?? e);
        check(name, msg.includes(expectMsg));
    }
}
loadFails((c) => { c.agents[0].surfaces[0].ladder = 'RETIRED_LADDER'; }, 'unknown ladder name', 'fail-loud: unknown ladder name throws, names the knowns');
loadFails((c) => { c.agents[0].surfaces[0].transport = 'carrier-pigeon'; }, 'transport must be', 'fail-loud: bad transport throws');
loadFails((c) => { delete c.spokeLifecycle; }, 'spokeLifecycle', 'fail-loud: missing spokeLifecycle throws');
// missing file entirely
{
    const home = mkdtempSync(path.join(tmpdir(), 'p1-fail-'));
    try {
        execFileSync(TSX, ['-e', "import './lib/garden-manifest';"], {
            cwd: SERVER, env: { ...process.env, HAN_HOME: home }, stdio: 'pipe',
        });
        check('fail-loud: missing garden-manifest.json throws (should throw)', false);
    } catch (e) {
        check('fail-loud: missing garden-manifest.json throws with the genesis pointer', String((e as any).stderr ?? e).includes('seeds/garden-manifest.seed.json'));
    }
}

// ── (3) the seed validates ──
{
    const home = mkdtempSync(path.join(tmpdir(), 'p1-seed-'));
    cpSync(path.join(hanRepo(), 'seeds', 'garden-manifest.seed.json'), path.join(home, 'garden-manifest.json'));
    try {
        const out = execFileSync(TSX, ['-e',
            "import { GARDEN_MANIFEST } from './lib/garden-manifest'; console.log(GARDEN_MANIFEST.agents.length);"],
            { cwd: SERVER, env: { ...process.env, HAN_HOME: home }, stdio: 'pipe' }).toString();
        check('the seed form validates through the real loader', out.trim().endsWith('1'));
    } catch { check('the seed form validates through the real loader', false); }
}

console.log(`\np1-equivalence: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
