#!/usr/bin/env npx tsx
/**
 * P4b seeder proof — the genesis writer + the config-independent (extract-and-delegate) signing core.
 * Run: npx tsx scripts/test-seeder.ts   (exit 0 = all pass)
 *
 * Asserts: (1) the five required identity files are written to the correct dirs (aphorisms → fractalDir,
 * the rest → memoryDir; self-reflection.md = the empty-vault header); (2) ROUND-TRIP — the manifest
 * `signIdentityFilesAt` produced verifies via the STANDARD `verifySignature` + `diffAgainstManifestAt`
 * (no format divergence between the `*At` core and the existing entry points); (3) tamper is detected;
 * (4) FAIL-LOUD — an unallocated resident throws; a missing required file throws.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedResident, exampleGenesisSeed } from '../src/server/lib/resident-seeding';
import {
    readSignedManifestAt, verifySignature, diffAgainstManifestAt, buildManifestAt,
} from '../src/server/lib/identity-signing';

let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

// ── temp garden keypair (isolated from the real one) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seeder-test-'));
const memoryDir = path.join(tmp, 'memory');
const fractalDir = path.join(tmp, 'fractal');
const privPath = path.join(tmp, 'key.pem');
const pubPath = path.join(tmp, 'pub.pem');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(privPath, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
const pubPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
fs.writeFileSync(pubPath, pubPem);
const keyPaths = { privateKeyPath: privPath, publicKeyPath: pubPath };

try {
    const seed = exampleGenesisSeed('testmind', 'Testmind');

    console.log('[1] seed writes the five required identity files to the correct dirs');
    const result = seedResident(seed, { dirs: { memoryDir, fractalDir }, keyPaths });
    ok(fs.existsSync(path.join(memoryDir, 'identity.md')), 'identity.md → memoryDir');
    ok(fs.existsSync(path.join(memoryDir, 'patterns.md')), 'patterns.md → memoryDir');
    ok(fs.existsSync(path.join(fractalDir, 'aphorisms.md')), 'aphorisms.md → fractalDir (the location catch)');
    ok(fs.existsSync(path.join(memoryDir, 'felt-moments.md')), 'felt-moments.md → memoryDir (the founding welcome)');
    const sr = fs.readFileSync(path.join(memoryDir, 'self-reflection.md'), 'utf8');
    ok(sr.includes('empty at genesis') && sr.includes('Testmind'), 'self-reflection.md = the empty-vault header (fills by living)');
    ok(result.signed.manifest.files.length === 5, `signed manifest covers the 5 required files (got ${result.signed.manifest.files.length})`);

    console.log('\n[2] ROUND-TRIP — the *At manifest verifies via the STANDARD verify path (no format divergence)');
    const onDisk = readSignedManifestAt(memoryDir);
    ok(onDisk !== null, 'readSignedManifestAt returns the persisted manifest');
    ok(verifySignature(onDisk!, pubPem) === true, 'verifySignature(signed, gardenPubkey) === true');
    const diff = diffAgainstManifestAt(memoryDir, fractalDir, onDisk!.manifest);
    ok(diff.changed.length === 0 && diff.added.length === 0 && diff.removed.length === 0, 'diffAgainstManifestAt: no changed/added/removed (files match the manifest)');

    console.log('\n[3] tamper is detected');
    fs.appendFileSync(path.join(memoryDir, 'identity.md'), '\nTAMPER\n');
    const diff2 = diffAgainstManifestAt(memoryDir, fractalDir, onDisk!.manifest);
    ok(diff2.changed.some(p => p.endsWith('identity.md')), 'a post-sign edit to identity.md shows as changed');

    console.log('\n[4] FAIL-LOUD');
    let threwUnalloc = false;
    try { seedResident(exampleGenesisSeed('nobody-unallocated', 'Nobody')); } catch { threwUnalloc = true; }
    ok(threwUnalloc, 'seeding an UNALLOCATED resident (no dirs override) throws');

    // missing required file: remove patterns.md, re-build → throws
    fs.unlinkSync(path.join(memoryDir, 'patterns.md'));
    let threwMissing = false;
    try {
        const keyPem = fs.readFileSync(privPath, 'utf8');
        buildManifestAt('testmind', memoryDir, fractalDir, keyPem);
    } catch { threwMissing = true; }
    ok(threwMissing, 'a missing REQUIRED identity file (patterns.md) throws at manifest-build (no silent unsigned gap)');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed === 0 ? '\n✅ ALL PASS — seeder writes genesis + signs config-independent; round-trip + fail-loud hold.' : `\n❌ ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
