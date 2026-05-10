/**
 * Identity-file signing — Phase A.5 (DEC-083).
 *
 * Cryptographic protection for the identity-load-bearing files at session-start.
 * Per the threat model §1: prevent silent acceptance of unauthorised modifications
 * to an agent's identity files between sessions.
 *
 * **Signing scheme**: Ed25519 (curve25519). Native to node:crypto since v15;
 * no third-party dependencies. 64-byte signatures, 32-byte public keys, no
 * parameter choices that could be misconfigured.
 *
 * **Manifest format**: JSON canonicalised via JCS (RFC 8785) before signing
 * so re-serialisation differences cannot produce silent verification failures.
 *
 * **Custody (v0)**: server-resident at `~/.han/credentials/han-signing-key.pem`
 * mode 600. The threat model for v0 is *operational accident, not adversarial
 * server compromise* (per the threat-model preamble — "highly trusting and
 * trustworthy environment"). When the trust boundary widens at federation,
 * the signing-key path is parameterised so PKCS#11 / KMS / hardware-token
 * implementations slot in behind the same `--key=<source>` argument with no
 * code changes.
 *
 * **Re-signing workflow (iii — Darron's call)**: at session-start, verify; on
 * file-content-only diff auto-resign and proceed; on file-added/removed halt
 * with receipt. Auto-resign events log to `~/.han/health/identity-resign.jsonl`;
 * frequency-spike escalation via ntfy when configured.
 *
 * **What this protects against**: tampering with identity-load-bearing files
 * at rest. **What this does NOT protect against**: encryption-at-rest (threat §2),
 * conversation-edge auth (threat §3), the working-memory-full / working-memory
 * pair (high-churn; gap acknowledged in threat-model addendum), gradient_entries
 * row tampering (deferred follow-on).
 *
 * **The auto-resign wrinkle**: option (iii) auto-resigns over content-only edits,
 * which means a malicious content edit between sessions would be silently
 * legitimised. This is the threat-model trade-off — for v0's operational-accident
 * threat we accept it because (i) creates worse operational pain (silent boot-halt
 * on forgotten re-signs) and (ii) inverts the protection entirely. Mitigation:
 * every auto-resign event is logged + ntfy-escalated when frequency exceeds
 * baseline. The operator sees auto-resigns happen.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gradientConfigForAgent } from './agent-registry';
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
}

export const IDENTITY_FILES: ReadonlyArray<IdentityFileSpec> = [
    { name: 'identity.md',       location: 'memoryDir' },
    { name: 'patterns.md',       location: 'memoryDir' },
    { name: 'aphorisms.md',      location: 'fractalDir' },
    { name: 'felt-moments.md',   location: 'memoryDir' },
    { name: 'self-reflection.md', location: 'memoryDir' },
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
 * Resolve the absolute path of each identity file for the named agent.
 * Throws if the agent slug is not registered.
 */
export function identityFilePaths(agent: string): { spec: IdentityFileSpec; absPath: string }[] {
    const cfg = gradientConfigForAgent(agent);
    return IDENTITY_FILES.map(spec => {
        const dir = spec.location === 'memoryDir' ? cfg.memoryDir : cfg.fractalDir;
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

/**
 * Build a manifest by scanning the agent's identity files and computing hashes.
 * Throws if any identity file is missing — signing requires the full set.
 */
export function buildManifest(agent: string, signingKeyPem: string): IdentityManifest {
    const pubkeyPem = crypto.createPublicKey(signingKeyPem).export({ format: 'pem', type: 'spki' }).toString();
    const files: ManifestFileEntry[] = [];
    for (const { spec, absPath } of identityFilePaths(agent)) {
        if (!fs.existsSync(absPath)) {
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

/**
 * Persist a signed manifest to the agent's memoryDir as paired files:
 *   - identity-manifest.json (the manifest body, pretty-printed for readability)
 *   - identity-manifest.sig  (the base64 signature)
 *
 * Note: the SIGNATURE is over the JCS-canonicalised form, not the pretty-printed
 * file. Verification re-canonicalises the parsed manifest before checking.
 */
export function writeSignedManifest(agent: string, signed: SignedManifest): void {
    const cfg = gradientConfigForAgent(agent);
    fs.writeFileSync(
        path.join(cfg.memoryDir, 'identity-manifest.json'),
        JSON.stringify(signed.manifest, null, 2) + '\n',
        'utf8',
    );
    fs.writeFileSync(
        path.join(cfg.memoryDir, 'identity-manifest.sig'),
        signed.signature + '\n',
        'utf8',
    );
}

/**
 * Read a signed manifest from the agent's memoryDir. Returns null if either
 * file is missing.
 */
export function readSignedManifest(agent: string): SignedManifest | null {
    const cfg = gradientConfigForAgent(agent);
    const manifestPath = path.join(cfg.memoryDir, 'identity-manifest.json');
    const sigPath = path.join(cfg.memoryDir, 'identity-manifest.sig');
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

/**
 * Sign-and-write a fresh manifest for the agent. The full ceremony.
 *
 * @returns the SignedManifest that was persisted
 */
export function signIdentityFiles(agent: string, keyPaths: KeyPaths = DEFAULT_KEY_PATHS): SignedManifest {
    const signingKeyPem = loadKey(keyPaths.privateKeyPath);
    const manifest = buildManifest(agent, signingKeyPem);
    const signed = signManifest(manifest, signingKeyPem);
    writeSignedManifest(agent, signed);
    return signed;
}

/**
 * Diff the current state of identity files on disk against the signed manifest.
 * Returns three lists: changed (in manifest, hash differs), added (on disk
 * but not in manifest), removed (in manifest but missing on disk).
 *
 * "Added" and "removed" are STRUCTURAL changes per (iii) — they mean the file
 * set itself has changed. "Changed" is a CONTENT-only edit.
 */
export function diffAgainstManifest(agent: string, manifest: IdentityManifest): {
    changed: string[];
    added: string[];
    removed: string[];
} {
    const expected = new Map(manifest.files.map(f => [f.path, f.sha256]));
    const onDisk = new Map<string, string>();
    for (const { absPath } of identityFilePaths(agent)) {
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

const HEALTH_DIR = path.join(HAN_DIR, 'health');
const INTEGRITY_FAILURES_PATH = path.join(HEALTH_DIR, 'integrity-failures.jsonl');
const IDENTITY_RESIGN_PATH = path.join(HEALTH_DIR, 'identity-resign.jsonl');

interface IntegrityFailureEntry {
    timestamp: string;
    agent: string;
    entry_point: string;
    failure_kind:
        | 'missing_manifest'
        | 'missing_pubkey'
        | 'signature_invalid'
        | 'file_missing'
        | 'file_added'
        | 'file_hash_mismatch';
    file_path?: string;
    detail?: string;
}

interface IdentityResignEntry {
    timestamp: string;
    agent: string;
    entry_point: string;
    changed_files: string[];
}

function ensureHealthDir(): void {
    if (!fs.existsSync(HEALTH_DIR)) fs.mkdirSync(HEALTH_DIR, { recursive: true });
}

function logIntegrityFailure(entry: IntegrityFailureEntry): void {
    ensureHealthDir();
    fs.appendFileSync(INTEGRITY_FAILURES_PATH, JSON.stringify(entry) + '\n', 'utf8');
}

function logIdentityResign(entry: IdentityResignEntry): void {
    ensureHealthDir();
    fs.appendFileSync(IDENTITY_RESIGN_PATH, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Frequency-spike check: how many resigns for this agent in the last `windowMs`.
 * Returns the count. Caller decides whether to ntfy based on baseline.
 */
export function recentResignCount(agent: string, windowMs: number): number {
    if (!fs.existsSync(IDENTITY_RESIGN_PATH)) return 0;
    const now = Date.now();
    const lines = fs.readFileSync(IDENTITY_RESIGN_PATH, 'utf8').split('\n').filter(Boolean);
    let count = 0;
    for (const line of lines) {
        try {
            const entry = JSON.parse(line) as IdentityResignEntry;
            if (entry.agent !== agent) continue;
            const t = new Date(entry.timestamp).getTime();
            if (now - t <= windowMs) count++;
        } catch { /* skip malformed */ }
    }
    return count;
}

/**
 * The session-start gate — option (iii) verify-and-resign.
 *
 * Behaviour:
 *   1. Read manifest + pubkey. Missing either → halt with receipt.
 *   2. Verify signature. Invalid → halt with receipt.
 *   3. Diff files on disk against manifest:
 *      - All match → outcome: 'verified'. Caller proceeds with identity load.
 *      - Files added or removed → STRUCTURAL change. Halt with receipt.
 *        Outcome: 'structural-change'. Caller refuses to start session.
 *      - Files in manifest changed (content-only edit) → AUTO-RESIGN. Build
 *        fresh manifest, sign, write. Log to identity-resign.jsonl. Outcome:
 *        'resigned'. Caller proceeds with identity load.
 *
 * The caller is expected to surface the outcome to the operator (printout +
 * exit code from a CLI wrapper, or ntfy alert from a long-running service).
 */
export function verifyAndResign(
    agent: string,
    entryPoint: string,
    keyPaths: KeyPaths = DEFAULT_KEY_PATHS,
): VerifyOutcome {
    const timestamp = new Date().toISOString();
    if (!fs.existsSync(keyPaths.publicKeyPath)) {
        logIntegrityFailure({ timestamp, agent, entry_point: entryPoint, failure_kind: 'missing_pubkey' });
        return { kind: 'missing-pubkey' };
    }
    const signed = readSignedManifest(agent);
    if (!signed) {
        logIntegrityFailure({ timestamp, agent, entry_point: entryPoint, failure_kind: 'missing_manifest' });
        return { kind: 'missing-manifest' };
    }
    const pubkeyPem = fs.readFileSync(keyPaths.publicKeyPath, 'utf8');
    if (!verifySignature(signed, pubkeyPem)) {
        logIntegrityFailure({ timestamp, agent, entry_point: entryPoint, failure_kind: 'signature_invalid' });
        return { kind: 'invalid-signature' };
    }
    const diff = diffAgainstManifest(agent, signed.manifest);
    if (diff.removed.length > 0 || diff.added.length > 0) {
        for (const p of diff.removed) {
            logIntegrityFailure({ timestamp, agent, entry_point: entryPoint, failure_kind: 'file_missing', file_path: p });
        }
        for (const p of diff.added) {
            logIntegrityFailure({ timestamp, agent, entry_point: entryPoint, failure_kind: 'file_added', file_path: p });
        }
        return { kind: 'structural-change', addedFiles: diff.added, removedFiles: diff.removed };
    }
    if (diff.changed.length > 0) {
        // (iii) auto-resign: file set unchanged, content-only edits → re-sign and proceed.
        signIdentityFiles(agent, keyPaths);
        logIdentityResign({ timestamp, agent, entry_point: entryPoint, changed_files: diff.changed });
        return { kind: 'resigned', changedFiles: diff.changed };
    }
    return { kind: 'verified' };
}

/**
 * Convenience wrapper for service entry-points: verify-and-resign with
 * throw-on-halt semantics. Use at the top of readLeoMemory/readJimMemory and
 * similar identity-load entry points.
 *
 * Returns silently on 'verified' or 'resigned' (auto-resign is invisible to
 * the caller — the point of (iii)). Throws on any halt outcome with a
 * receipt-pointer message; caller decides whether to skip the invocation,
 * abort the service, or surface the error.
 */
export function gateIdentityOrThrow(agent: string, entryPoint: string, keyPaths: KeyPaths = DEFAULT_KEY_PATHS): void {
    const outcome = verifyAndResign(agent, entryPoint, keyPaths);
    switch (outcome.kind) {
        case 'verified':
        case 'resigned':
            return;
        case 'structural-change':
            throw new Error(
                `Identity gate halted: structural change for agent '${agent}' ` +
                `(added=${outcome.addedFiles.length} removed=${outcome.removedFiles.length}). ` +
                `Receipt at ~/.han/health/integrity-failures.jsonl. Re-sign manually if intentional.`,
            );
        case 'invalid-signature':
            throw new Error(`Identity gate halted: signature INVALID for agent '${agent}'. Receipt at ~/.han/health/integrity-failures.jsonl.`);
        case 'missing-manifest':
            throw new Error(`Identity gate halted: no signed manifest for agent '${agent}'. Run sign-identity-files.ts --agent=${agent}.`);
        case 'missing-pubkey':
            throw new Error(`Identity gate halted: signing-pubkey not found at ${keyPaths.publicKeyPath}.`);
    }
}

/**
 * Generate a fresh Ed25519 keypair and write the PEM files.
 * Private key mode 600; public key mode 644.
 */
export function generateKeypair(keyPaths: KeyPaths = DEFAULT_KEY_PATHS): void {
    const credDir = path.dirname(keyPaths.privateKeyPath);
    if (!fs.existsSync(credDir)) fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(keyPaths.privateKeyPath)) {
        throw new Error(`Refusing to overwrite existing key at ${keyPaths.privateKeyPath}. Move it aside first.`);
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const pubPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    fs.writeFileSync(keyPaths.privateKeyPath, privPem, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(keyPaths.publicKeyPath, pubPem, { encoding: 'utf8', mode: 0o644 });
}
