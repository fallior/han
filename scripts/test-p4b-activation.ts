/**
 * P4b-ii (#98 Dynamic Residence) — the activation flip. Proves a synthetic resident is INERT at each
 * missing lifecycle gate and becomes ACTIVE only when ALL FOUR hold:
 *   discovered (P1) ∧ admitted (P2) ∧ allocated (allocationFor) ∧ seeded (isSeededAt).
 * Then: tampering a genesis file UN-SEEDS it (revokes activation), and removing the allocation revokes
 * it — the never-wakeable mind is structurally impossible, and activation can't outlive its gates.
 *
 * Re-evaluation within one process uses `__resetResidentCacheForTests()` (production is process-stable —
 * a newly-seeded resident activates on the next restart, Fork 2) and `__set/__deleteTestAllocationForTests`
 * (the operator-authored AGENT_ALLOCATION is a const; tests inject a fixture allocation, `allocationFor`
 * itself byte-unchanged). DEFAULT_KEY_PATHS is imported from `identity-signing` to also guard the leaf
 * re-export.
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-p4b-activation.ts
 * EXIT 0 iff every assertion holds.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { admitResident } from '../src/server/lib/resident-discovery';
import { DEFAULT_KEY_PATHS } from '../src/server/lib/identity-signing'; // via the leaf re-export
import { readFileSync } from 'fs';
import {
    loadResidents, allocationFor,
    __resetResidentCacheForTests, __setTestAllocationForTests, __deleteTestAllocationForTests,
    type AgentAllocation,
} from '../src/server/lib/garden-manifest';
import { seedResident, exampleGenesisSeed } from '../src/server/lib/resident-seeding';
import { registeredAgentSlugs } from '../src/server/lib/agent-registry';

const SLUG = '__p4bii__';
const NAME = 'P4bTest';
const AGENTS_DIR = path.join(homedir(), '.han', 'agents');
const DIR = path.join(AGENTS_DIR, SLUG);
const JSON_PATH = path.join(DIR, 'resident.json');
const MEM_DIR = path.join(DIR, 'memory');               // the test allocation's memoryDir
const FRACTAL_DIR = path.join(homedir(), '.han', 'memory', 'fractal', SLUG); // what seedResident + activatedNetNew derive
const TEST_LOG = path.join(homedir(), '.han', 'health', '__test_p4bii_admissions__.jsonl');

let failures = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

/** Re-evaluate the activation union from scratch, then ask: is SLUG active (in loadResidents)? */
function isActive(): boolean {
    __resetResidentCacheForTests();
    return loadResidents().some((a) => a.slug === SLUG);
}
function activeManifest() {
    __resetResidentCacheForTests();
    return loadResidents().find((a) => a.slug === SLUG);
}

const TEST_ALLOC: AgentAllocation = { surfaces: [], memoryDir: MEM_DIR };

function cleanup() {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
    if (existsSync(FRACTAL_DIR)) rmSync(FRACTAL_DIR, { recursive: true, force: true });
    if (existsSync(TEST_LOG)) rmSync(TEST_LOG, { force: true });
    __deleteTestAllocationForTests(SLUG);
    __resetResidentCacheForTests();
}

function writeFragment(identitySection: string) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(JSON_PATH, JSON.stringify(
        { slug: SLUG, displayName: NAME, pronounObj: 'them', identitySection }, null, 2));
}

try {
    cleanup();
    const gardenPriv = readFileSync(DEFAULT_KEY_PATHS.privateKeyPath, 'utf8');
    const seedSlugsAtBoot = loadResidents().map((a) => a.slug); // seed-only (fixtures not staged yet)

    // ── 1. discovered ONLY → inert ──
    console.log('[1] discovered only (resident.json, no admit/alloc/seed)');
    writeFragment('You are P4bTest, a synthetic resident.');
    ok(!isActive(), 'NOT active — discovered but not admitted/allocated/seeded');

    // ── 2. + admitted → still inert ──
    console.log('[2] + admitted (garden-signed)');
    admitResident(SLUG, gardenPriv, TEST_LOG);
    ok(!isActive(), 'NOT active — admitted but not allocated/seeded');

    // ── 3. + allocated → still inert (not seeded) ──
    console.log('[3] + allocated (operator grant)');
    __setTestAllocationForTests(SLUG, TEST_ALLOC);
    ok(allocationFor(SLUG)?.memoryDir === MEM_DIR, 'allocationFor now returns the test allocation');
    ok(!isActive(), 'NOT active — allocated but not seeded (genesis manifest absent)');

    // ── 4. + seeded → ACTIVE (all four gates hold) ──
    console.log('[4] + seeded (genesis engine) → ACTIVE');
    seedResident(exampleGenesisSeed(SLUG, NAME)); // reads allocationFor(SLUG).memoryDir = MEM_DIR; aphorisms → FRACTAL_DIR
    ok(isActive(), 'ACTIVE — all four gates hold (discovered ∧ admitted ∧ allocated ∧ seeded)');
    const m = activeManifest();
    ok(!!m && m.active === true, 'activated manifest has active:true');
    ok(!!m && m.memoryDir === MEM_DIR, 'memoryDir comes from the ALLOCATION (privilege half), not self-claimed');
    ok(!!m && m.surfaces === TEST_ALLOC.surfaces, 'surfaces come from the allocation (by-ref, F4)');
    ok(!!m && m.identitySection === 'You are P4bTest, a synthetic resident.', 'identitySection comes from the discovered FRAGMENT');
    // Order load-bearing: the seed roster stays first + in order, the net-new appends after.
    const roster = (__resetResidentCacheForTests(), loadResidents().map((a) => a.slug));
    ok(JSON.stringify(roster.slice(0, seedSlugsAtBoot.length)) === JSON.stringify(seedSlugsAtBoot),
        'seed roster unchanged + first (antiphase order preserved); net-new appended');
    ok(roster[roster.length - 1] === SLUG, 'the net-new resident appends LAST (discovery order)');
    // R1 by construction: AGENT_GRADIENT_CONFIG = Object.fromEntries(loadResidents().map(...)), so any
    // slug in loadResidents() AT BOOT is in registeredAgentSlugs (gradientConfigForAgent won't throw).
    // Proven via the seed slugs (the pipeline); a net-new resident rides the identical map on restart.
    ok(seedSlugsAtBoot.every((s) => registeredAgentSlugs().includes(s)),
        'R1 pipeline: every loadResidents() slug at boot is in registeredAgentSlugs (config covers the roster)');

    // ── 5. tamper a genesis file → UN-SEEDED → inert (changed file un-seeds) ──
    console.log('[5] tamper identity.md → un-seeded → inert');
    appendFileSync(path.join(MEM_DIR, 'identity.md'), '\nTAMPERED after signing.\n');
    ok(!isActive(), 'NOT active — a changed genesis file un-seeds (isSeededAt: changed===0 required)');

    // ── 6. re-seed → active again; then remove allocation → inert (allocated gate revocable) ──
    console.log('[6] re-seed → active; drop allocation → inert');
    seedResident(exampleGenesisSeed(SLUG, NAME)); // re-sign over current (tampered) content → seeded again
    ok(isActive(), 're-seeded → ACTIVE again');
    __deleteTestAllocationForTests(SLUG);
    ok(!isActive(), 'NOT active — allocation removed (the allocated gate revokes activation)');
} finally {
    cleanup();
    console.log('[cleanup] removed fixtures + test allocation + reset cache');
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
