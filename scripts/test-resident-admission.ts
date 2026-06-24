/**
 * P2 (#98 Dynamic Residence) — proves the admission gate via the reusable `admitResident()` act:
 * a garden-signed resident is *admitted*, the C1 sign-then-swap attack is defeated, a non-garden key
 * is rejected, and admission is trust not activation (`loadResidents()` still excludes — R1).
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-resident-admission.ts
 * EXIT 0 iff every assertion holds.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { generateKeyPairSync } from 'crypto';
import {
    discoveredResidents, admittedResidents, admitResident,
} from '../src/server/lib/resident-discovery';
import { DEFAULT_KEY_PATHS } from '../src/server/lib/identity-signing';
import { loadResidents } from '../src/server/lib/garden-manifest';
import { schedulingAgents } from '../src/server/lib/agent-scheduler';

const AGENTS_DIR = path.join(homedir(), '.han', 'agents');
const DIR = path.join(AGENTS_DIR, '__test_admit__');
const JSON_PATH = path.join(DIR, 'resident.json');
const TEST_LOG = path.join(homedir(), '.han', 'health', '__test_admissions__.jsonl');
const SLUG = 'testadmit';

let failures = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };
const isAdmitted = () => admittedResidents().some(r => r.slug === SLUG);
const isDiscovered = () => discoveredResidents().some(r => r.slug === SLUG);

function writeFragment(identitySection: string) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(JSON_PATH, JSON.stringify(
        { slug: SLUG, displayName: 'TestAdmit', pronounObj: 'them', identitySection }, null, 2));
}

try {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
    if (existsSync(TEST_LOG)) rmSync(TEST_LOG, { force: true });
    const gardenPriv = readFileSync(DEFAULT_KEY_PATHS.privateKeyPath, 'utf8');

    // ── 1. unsigned → discovered but NOT admitted ──
    console.log('[1] unsigned resident.json');
    writeFragment('You are TestAdmit, v1.');
    ok(isDiscovered(), 'discovered (visible) ✓');
    ok(!isAdmitted(), 'NOT admitted (no resident.sig) — inert');

    // ── 2. admitResident() with the garden key → admitted (C2: un-configured slug, no throw; F3 act) ──
    console.log('[2] admitResident() with the garden key');
    const res = admitResident(SLUG, gardenPriv, TEST_LOG);
    ok(isAdmitted(), 'admitted after admitResident() (C2 builder worked for un-configured slug)');
    ok(existsSync(TEST_LOG) && readFileSync(TEST_LOG, 'utf8').includes('"event":"admitted"'),
        'admission LOGGED to the ledger (F3 observability)');
    ok(res.slug === SLUG && !!res.sha256, 'admitResident() returns the result (endpoint-ready)');

    // ── 3. C1 SIGN-THEN-SWAP attack → admission REVOKED (no auto-resign) ── (the headline)
    console.log('[3] C1 sign-then-swap: modify resident.json AFTER admitting');
    writeFragment('You are TestAdmit, v2 — SWAPPED after admission.'); // sig still over v1's hash
    ok(isDiscovered(), 'still discovered (the file is valid) ✓');
    ok(!isAdmitted(), 'NOT admitted — hash mismatch rejects the swap (C1: pure verify + re-hash, no auto-resign)');

    // ── 4. C3 wrong-key admission → NOT admitted ──
    console.log('[4] C3 wrong-key');
    writeFragment('You are TestAdmit, v3.');
    const { privateKey } = generateKeyPairSync('ed25519');
    admitResident(SLUG, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), TEST_LOG);
    ok(!isAdmitted(), 'NOT admitted — signed by a non-garden key (verify against the fixed garden pubkey, C3)');

    // ── 5. R1: an admitted resident is STILL not in loadResidents()/schedulingAgents() ──
    console.log('[5] R1: admission ≠ activation');
    admitResident(SLUG, gardenPriv, TEST_LOG); // re-admit cleanly (v3 garden-signed)
    ok(isAdmitted(), 're-admitted (v3 garden-signed)');
    ok(!loadResidents().some(a => a.slug === SLUG), 'loadResidents() STILL excludes the admitted resident (R1 — needs P4 config)');
    ok(JSON.stringify(schedulingAgents()) === '["leo","jim"]', `schedulingAgents() unchanged ${JSON.stringify(schedulingAgents())}`);
} finally {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
    if (existsSync(TEST_LOG)) rmSync(TEST_LOG, { force: true });
    console.log('[cleanup] removed', DIR, '+ test log');
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
