/**
 * P1 (#98 Dynamic Residence) — proves filesystem discovery makes a resident *visible* but never
 * *live* (R1 by construction), and that the scan is fail-soft.
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-resident-discovery.ts
 * EXIT 0 iff every assertion holds.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { discoveredResidents } from '../src/server/lib/resident-discovery';
import { loadResidents } from '../src/server/lib/garden-manifest';
import { schedulingAgents } from '../src/server/lib/agent-scheduler';

const AGENTS_DIR = path.join(homedir(), '.han', 'agents');
const TEST_DIR = path.join(AGENTS_DIR, '__test_resident__');
const TEST_FILE = path.join(TEST_DIR, 'resident.json');

let failures = 0;
const ok = (cond: boolean, msg: string) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
    if (!cond) failures++;
};

function loadSlugs() { return loadResidents().map(a => a.slug); }

try {
    // ── Baseline: no test fragment present ──
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    console.log('[baseline] no test resident.json');
    const seedSlugs = loadSlugs();
    const baseSched = schedulingAgents();
    ok(!discoveredResidents().some(r => r.slug === 'testmind'), 'discoveredResidents() does not contain the test mind yet');
    ok(JSON.stringify(baseSched) === '["leo","jim"]', `schedulingAgents() === ["leo","jim"] (got ${JSON.stringify(baseSched)})`);

    // ── Test 1: drop a VALID fragment → visible, but NOT live ──
    console.log('[test 1] drop a valid resident.json → visible, inert');
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_FILE, JSON.stringify({
        slug: 'testmind', displayName: 'TestMind', pronounObj: 'them',
        identitySection: 'You are TestMind, a discovery-test resident.',
        // a self-claimed privilege field that must be IGNORED (F4 type-level guarantee):
        port: 9999, runsSupervisorCycle: true,
    }, null, 2));

    const discovered = discoveredResidents();
    ok(discovered.some(r => r.slug === 'testmind'), 'discoveredResidents() now SHOWS testmind (visible)');
    const frag = discovered.find(r => r.slug === 'testmind');
    ok(!!frag && !('port' in frag) && !('runsSupervisorCycle' in frag),
        'the discovered fragment carries NO policy fields (port/runsSupervisorCycle ignored — F4 type-level)');

    ok(!loadSlugs().includes('testmind'), 'loadResidents() does NOT include testmind (INERT — R1)');
    ok(JSON.stringify(loadSlugs()) === JSON.stringify(seedSlugs), 'loadResidents() byte-identical to baseline (seed-only)');
    const schedAfter = schedulingAgents();
    ok(JSON.stringify(schedAfter) === '["leo","jim"]', `schedulingAgents() STILL ["leo","jim"] (got ${JSON.stringify(schedAfter)})`);

    // ── Test 2: fail-soft on malformed / partial ──
    console.log('[test 2] fail-soft: malformed + partial fragments are skipped, never throw');
    writeFileSync(TEST_FILE, '{ this is not json');
    let threw = false;
    try { ok(!discoveredResidents().some(r => r.slug === 'testmind'), 'malformed JSON → skipped (not present)'); }
    catch { threw = true; }
    ok(!threw, 'malformed JSON did NOT throw (fail-soft)');

    writeFileSync(TEST_FILE, JSON.stringify({ slug: 'testmind', displayName: 'TestMind' })); // missing pronounObj + identitySection
    threw = false;
    try { ok(!discoveredResidents().some(r => r.slug === 'testmind'), 'partial fragment (missing identity fields) → skipped'); }
    catch { threw = true; }
    ok(!threw, 'partial fragment did NOT throw (fail-soft)');
} finally {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    console.log('[cleanup] removed', TEST_DIR);
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
