/**
 * cognition-envelope-setup.ts — the suite's scratch world, in its OWN module
 * so its side-effects (the env-driven paths) run BEFORE the envelope modules
 * load. esbuild hoists `import` statements above in-module statements in BOTH
 * output formats, so env wiring inside the test file runs too late — the
 * first run of this suite proved it by writing a v99 test envelope onto the
 * LIVE sidecar path (quarantined; zero impact — E1 inert). Import this module
 * FIRST: import order among imports is preserved.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cog-env-test-'));
export const MANIFEST_PATH = path.join(SCRATCH, 'garden-manifest.json');
export const TEST_ENVELOPE_PATH = path.join(SCRATCH, 'garden-manifest.envelope.json');
process.env.HAN_GARDEN_MANIFEST = MANIFEST_PATH;
process.env.HAN_COGNITION_ENVELOPE = TEST_ENVELOPE_PATH;

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
export const TEST_PUBLIC_KEY = publicKey;
export const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
export const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY_DIR = path.join(SCRATCH, 'keys');
fs.mkdirSync(KEY_DIR, { recursive: true });
export const KEY_PATHS = {
    privateKeyPath: path.join(KEY_DIR, 'garden-signing.key'),
    publicKeyPath: path.join(KEY_DIR, 'garden-signing.pub'),
};
fs.writeFileSync(KEY_PATHS.privateKeyPath, PRIV_PEM);
fs.writeFileSync(KEY_PATHS.publicKeyPath, PUB_PEM);

export const baseManifest = () => ({
    manifestVersion: 3,
    user: { name: 'Testa', pronounSubj: 'She', pronounObj: 'her', location: 'Scratchville (UTC+10)' },
    agents: [
        { slug: 'alpha', displayName: 'Alpha', identitySection: 'You are **Alpha** — the first test mind.' },
        { slug: 'beta', displayName: 'Beta', identitySection: 'You are **Beta** — the second test mind.' },
    ],
});
export const writeManifest = (m: any) => fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
writeManifest(baseManifest());
