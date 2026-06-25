/**
 * Identity-manifest CORE — the config-independent half of identity signing (DEC-083).
 *
 * **Why this module exists (the leaf).** The signing primitives split in two:
 *   - **slug-keyed** wrappers (`buildManifest`, `signIdentityFiles`, `gateIdentityOrThrow`, …) resolve
 *     dirs via `gradientConfigForAgent` → they live in `identity-signing.ts`, which imports
 *     `agent-registry`.
 *   - **config-independent** cores (`*At` + `verifySignature` + `signManifest` + `isSeededAt`) take
 *     EXPLICIT dirs → they live HERE and import NO `agent-registry`.
 *
 * The split is load-bearing for #98 Dynamic Residence: `garden-manifest.loadResidents()`'s P4b-ii
 * seeded-gate, and `resident-discovery`, both need these primitives — but if they reached them through
 * `identity-signing.ts` (→ `agent-registry` → `garden-manifest`) that would close a cycle on the seam
 * everything reads. Putting the config-independent half in a leaf that imports no `agent-registry`
 * makes the cycle **structurally impossible** (`garden-manifest → this leaf → ∅`), not merely avoided
 * by a fragile invariant (Jim's P4b-ii plan-audit, Darron's call: option (b) — delete the fragility).
 * `identity-signing.ts` re-exports everything here, so existing importers are unaffected.
 *
 * See `identity-signing.ts` for the scheme/custody/threat-model docstring — this is the same Ed25519 +
 * JCS (RFC 8785) machinery, just the half that needs no agent registry.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { canonicalise } from './jcs';

const HOME = os.homedir();
const HAN_DIR = path.join(HOME, '.han');

/**
 * Identity-load-bearing files per threat model §1. The list is fixed in code;
 * changes to this list are settled-decision changes (require a new DEC entry).
 *
 * Each entry maps to a file path resolved against the agent's memoryDir or
 * fractalDir (aphorisms lives under fractalDir; the rest under memoryDir).
 */
export interface IdentityFileSpec {
    name: string;
    location: 'memoryDir' | 'fractalDir';
    /** When true, the file is signed only if present on disk — for files an agent
     *  may or may not have authored yet (e.g. the curated loaded-self). Required
     *  files (optional falsy) still throw if missing. */
    optional?: boolean;
}

export const IDENTITY_FILES: ReadonlyArray<IdentityFileSpec> = [
    { name: 'identity.md',       location: 'memoryDir' },
    { name: 'patterns.md',       location: 'memoryDir' },
    { name: 'aphorisms.md',      location: 'fractalDir' },
    { name: 'felt-moments.md',   location: 'memoryDir' },
    // The curated loaded-self for felt-moments (plans/flat-file-curation-plan.md):
    // the bright few loaded at wake. Signed when present (optional/agent-agnostic),
    // same as the curated self-reflection. The vault stays the high-churn write target.
    { name: 'felt-moments-curated.md', location: 'memoryDir', optional: true },
    { name: 'self-reflection.md', location: 'memoryDir' },
    // The curated loaded-self (DEC-085 / "one mind, one channel"): the file that
    // actually reconstitutes the agent at wake. Signed when present so the loaded
    // self is tamper-evident, not only the (now unloaded, high-churn) vault.
    // Agent-agnostic: optional, so agents who haven't authored one yet sign cleanly.
    // (DEC-083 amendment, 2026-06-02 — see plans/commit-punchlist-2026-06-02.md.)
    { name: 'self-reflections-curated.md', location: 'memoryDir', optional: true },
];

export interface ManifestFileEntry {
    path: string;          // absolute path on disk
    sha256: string;        // hex digest
    size_bytes: number;
}

/**
 * Manifest is JCS-canonicalised before signing (RFC 8785).
 * Field-value scope is locked to ASCII-printable strings + numbers + arrays of same;
 * no Unicode surrogate-pair handling required for v0 because no field accepts
 * arbitrary user-supplied text (agent slugs, ISO timestamps, hex hashes, absolute
 * paths, key fingerprints — all ASCII by construction). If extending the manifest
 * with user-text fields post-v1, the JCS canonicaliser at lib/jcs.ts handles
 * surrogate pairs per RFC 8785 §3.2.2.2 (UTF-16 sort order); but the interface's
 * design intent is that no such field exists. See DEC-083 for the rationale.
 */
export interface IdentityManifest {
    agent: string;
    agent_id: string;       // forward-compat for future re-keying independent of slug
    signed_at: string;      // ISO 8601
    signing_key_id: string; // sha256 fingerprint of the pubkey (first 16 hex chars)
    files: ManifestFileEntry[];
}

export interface SignedManifest {
    manifest: IdentityManifest;
    signature: string;      // base64
}

export type VerifyOutcome =
    | { kind: 'verified' }
    | { kind: 'resigned'; changedFiles: string[] }
    | { kind: 'structural-change'; addedFiles: string[]; removedFiles: string[] }
    | { kind: 'invalid-signature' }
    | { kind: 'missing-manifest' }
    | { kind: 'missing-pubkey' };

/**
 * Config-independent CORE — resolve the identity-file paths from EXPLICIT dirs. A pre-activation
 * resident (discovered → admitted → allocated → SEEDED → activate) isn't in `gradientConfig` yet,
 * so the slug-keyed resolvers throw; the seeder (sign) and P4b-ii's seeded-gate (verify) need this
 * one. The slug-keyed `identityFilePaths` delegates here — ONE implementation, no divergence (Jim's
 * extract-and-delegate, not a parallel copy).
 */
export function identityFilePathsAt(memoryDir: string, fractalDir: string): { spec: IdentityFileSpec; absPath: string }[] {
    return IDENTITY_FILES.map(spec => {
        const dir = spec.location === 'memoryDir' ? memoryDir : fractalDir;
        return { spec, absPath: path.join(dir, spec.name) };
    });
}

function sha256File(filePath: string): { sha256: string; size_bytes: number } {
    const buf = fs.readFileSync(filePath);
    return {
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        size_bytes: buf.length,
    };
}

function pubkeyFingerprint(pubkeyPem: string): string {
    return crypto.createHash('sha256').update(pubkeyPem).digest('hex').slice(0, 16);
}

/** Config-independent CORE (explicit dirs). `buildManifest` delegates here. */
export function buildManifestAt(agent: string, memoryDir: string, fractalDir: string, signingKeyPem: string): IdentityManifest {
    const pubkeyPem = crypto.createPublicKey(signingKeyPem).export({ format: 'pem', type: 'spki' }).toString();
    const files: ManifestFileEntry[] = [];
    for (const { spec, absPath } of identityFilePathsAt(memoryDir, fractalDir)) {
        if (!fs.existsSync(absPath)) {
            if (spec.optional) continue; // optional file not authored yet — sign cleanly without it
            throw new Error(`Identity file missing — cannot sign manifest for '${agent}': ${spec.name} at ${absPath}`);
        }
        const { sha256, size_bytes } = sha256File(absPath);
        files.push({ path: absPath, sha256, size_bytes });
    }
    return {
        agent,
        agent_id: agent,
        signed_at: new Date().toISOString(),
        signing_key_id: pubkeyFingerprint(pubkeyPem),
        files,
    };
}

/**
 * Sign a manifest with the given private key. Returns the SignedManifest object.
 * The manifest is JCS-canonicalised before signing so verification is byte-stable
 * across implementations.
 */
export function signManifest(manifest: IdentityManifest, signingKeyPem: string): SignedManifest {
    const canonical = canonicalise(manifest as unknown as Parameters<typeof canonicalise>[0]);
    const privateKey = crypto.createPrivateKey(signingKeyPem);
    const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);
    return { manifest, signature: signature.toString('base64') };
}

/**
 * Verify a signed manifest's signature against the public key. Returns true
 * if signature is valid for the canonicalised manifest.
 */
export function verifySignature(signed: SignedManifest, pubkeyPem: string): boolean {
    const canonical = canonicalise(signed.manifest as unknown as Parameters<typeof canonicalise>[0]);
    const publicKey = crypto.createPublicKey(pubkeyPem);
    return crypto.verify(
        null,
        Buffer.from(canonical, 'utf8'),
        publicKey,
        Buffer.from(signed.signature, 'base64'),
    );
}

/** Config-independent CORE (explicit memoryDir). `writeSignedManifest` delegates here. */
export function writeSignedManifestAt(memoryDir: string, signed: SignedManifest): void {
    fs.writeFileSync(
        path.join(memoryDir, 'identity-manifest.json'),
        JSON.stringify(signed.manifest, null, 2) + '\n',
        'utf8',
    );
    fs.writeFileSync(
        path.join(memoryDir, 'identity-manifest.sig'),
        signed.signature + '\n',
        'utf8',
    );
}

/** Config-independent CORE (explicit memoryDir) — the verify side of the seeded-gate (P4b-ii reads a
 *  pre-activation resident's manifest here). `readSignedManifest` delegates. */
export function readSignedManifestAt(memoryDir: string): SignedManifest | null {
    const manifestPath = path.join(memoryDir, 'identity-manifest.json');
    const sigPath = path.join(memoryDir, 'identity-manifest.sig');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(sigPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as IdentityManifest;
    const signature = fs.readFileSync(sigPath, 'utf8').trim();
    return { manifest, signature };
}

export interface KeyPaths {
    privateKeyPath: string;
    publicKeyPath: string;
}

export const DEFAULT_KEY_PATHS: KeyPaths = {
    privateKeyPath: path.join(HAN_DIR, 'credentials', 'han-signing-key.pem'),
    publicKeyPath: path.join(HAN_DIR, 'credentials', 'han-signing-pubkey.pem'),
};

function loadKey(keyPath: string): string {
    if (!fs.existsSync(keyPath)) {
        throw new Error(`Signing key not found at ${keyPath}. Generate one via scripts/sign-identity-files.ts --generate-keypair.`);
    }
    return fs.readFileSync(keyPath, 'utf8');
}

/** Config-independent CORE (explicit dirs) — the seeder's sign ceremony for a pre-activation resident.
 *  `signIdentityFiles` delegates here. */
export function signIdentityFilesAt(agent: string, memoryDir: string, fractalDir: string, keyPaths: KeyPaths = DEFAULT_KEY_PATHS): SignedManifest {
    const signingKeyPem = loadKey(keyPaths.privateKeyPath);
    const manifest = buildManifestAt(agent, memoryDir, fractalDir, signingKeyPem);
    const signed = signManifest(manifest, signingKeyPem);
    writeSignedManifestAt(memoryDir, signed);
    return signed;
}

/** Config-independent CORE (explicit dirs) — the re-hash for P4b-ii's seeded-gate on a pre-activation
 *  resident. `diffAgainstManifest` delegates here. */
export function diffAgainstManifestAt(memoryDir: string, fractalDir: string, manifest: IdentityManifest): {
    changed: string[];
    added: string[];
    removed: string[];
} {
    const expected = new Map(manifest.files.map(f => [f.path, f.sha256]));
    const onDisk = new Map<string, string>();
    for (const { absPath } of identityFilePathsAt(memoryDir, fractalDir)) {
        if (fs.existsSync(absPath)) {
            onDisk.set(absPath, sha256File(absPath).sha256);
        }
    }
    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    for (const [p, sha] of onDisk) {
        if (!expected.has(p)) added.push(p);
        else if (expected.get(p) !== sha) changed.push(p);
    }
    for (const [p] of expected) {
        if (!onDisk.has(p)) removed.push(p);
    }
    return { changed, added, removed };
}

/**
 * P4b-ii seeded-gate (config-independent): has a net-new resident been SEEDED — does it have a
 * garden-signed identity-manifest over its genesis files, intact? A pre-activation resident has no
 * `gradientConfig`, so this reads EXPLICIT dirs (the allocated `memoryDir` + the derived `fractalDir`).
 * "Seeded" means ALL of:
 *   (1) a signed manifest exists at `memoryDir` (`readSignedManifestAt` non-null); AND
 *   (2) it verifies against the FIXED garden pubkey — never a resident-supplied key (mirrors
 *       admission's C3); AND
 *   (3) the manifest's files are present + unchanged on disk (`changed === 0 && removed === 0`).
 *
 * **`added` is deliberately NOT checked** (Jim's P4b-ii plan-audit): a resident that GROWS post-seed —
 * a curated self-reflection or felt-moments-curated.md appears — must NOT lose seeded-status; growth
 * by living is the whole point (DEC-085). Only a CHANGED or REMOVED genesis file un-seeds it (which is
 * a real integrity problem that correctly gates activation). Pure read + verify — never resigns
 * (mirrors admission's C1 no-auto-resign).
 */
export function isSeededAt(memoryDir: string, fractalDir: string, keyPaths: KeyPaths = DEFAULT_KEY_PATHS): boolean {
    const signed = readSignedManifestAt(memoryDir);
    if (!signed) return false;
    if (!fs.existsSync(keyPaths.publicKeyPath)) return false;
    let pubkeyPem: string;
    try { pubkeyPem = fs.readFileSync(keyPaths.publicKeyPath, 'utf8'); } catch { return false; }
    let sigOk = false;
    try { sigOk = verifySignature(signed, pubkeyPem); } catch { return false; }
    if (!sigOk) return false;
    const diff = diffAgainstManifestAt(memoryDir, fractalDir, signed.manifest);
    return diff.changed.length === 0 && diff.removed.length === 0;
}
