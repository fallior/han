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
 *
 * **Module split (DEC-083, #98 P4b-ii — Jim's plan-audit / Darron's call (b)).** The
 * config-independent half — the `*At` cores, `signManifest`, `verifySignature`, the manifest types,
 * `IDENTITY_FILES`, the key paths, and `isSeededAt` — lives in `identity-manifest-core.ts`, a LEAF that
 * imports no `agent-registry`. This file holds the **slug-keyed** wrappers (which resolve dirs via
 * `gradientConfigForAgent`) + the verify-and-resign gate, and **re-exports** the leaf so importers of
 * `./identity-signing` are unaffected. Why: `garden-manifest.loadResidents()`'s seeded-gate and
 * `resident-discovery` reach the core primitives via the leaf, so `garden-manifest → leaf` closes no
 * cycle (it would, through here → `agent-registry` → `garden-manifest`). The split deletes the cycle
 * structurally rather than relying on a fragile "only-touches-config-independent-fns" invariant.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gradientConfigForAgent } from './agent-registry';
import {
    DEFAULT_KEY_PATHS,
    identityFilePathsAt, buildManifestAt, writeSignedManifestAt, readSignedManifestAt,
    signIdentityFilesAt, diffAgainstManifestAt, verifySignature,
} from './identity-manifest-core';
import type {
    IdentityFileSpec, IdentityManifest, SignedManifest, VerifyOutcome, KeyPaths,
} from './identity-manifest-core';

// Re-export the config-independent core so existing importers of './identity-signing' stay unchanged
// (the leaf split is internal — the DEC-083 surface behaviour is byte-identical). The cycle-sensitive
// consumers (garden-manifest's seeded-gate, resident-discovery) import from the LEAF directly, never
// through here, to keep the would-be import cycle structurally closed.
export * from './identity-manifest-core';

const HOME = os.homedir();
const HAN_DIR = path.join(HOME, '.han');

// ── Slug-keyed wrappers — resolve dirs via gradientConfigForAgent, then delegate to the *At cores.
//    ONE implementation per operation (Jim's extract-and-delegate); no parallel copy can diverge. ──

export function identityFilePaths(agent: string): { spec: IdentityFileSpec; absPath: string }[] {
    const cfg = gradientConfigForAgent(agent);
    return identityFilePathsAt(cfg.memoryDir, cfg.fractalDir);
}

export function buildManifest(agent: string, signingKeyPem: string): IdentityManifest {
    const cfg = gradientConfigForAgent(agent);
    return buildManifestAt(agent, cfg.memoryDir, cfg.fractalDir, signingKeyPem);
}

export function writeSignedManifest(agent: string, signed: SignedManifest): void {
    writeSignedManifestAt(gradientConfigForAgent(agent).memoryDir, signed);
}

export function readSignedManifest(agent: string): SignedManifest | null {
    return readSignedManifestAt(gradientConfigForAgent(agent).memoryDir);
}

export function signIdentityFiles(agent: string, keyPaths: KeyPaths = DEFAULT_KEY_PATHS): SignedManifest {
    const cfg = gradientConfigForAgent(agent);
    return signIdentityFilesAt(agent, cfg.memoryDir, cfg.fractalDir, keyPaths);
}

export function diffAgainstManifest(agent: string, manifest: IdentityManifest): {
    changed: string[];
    added: string[];
    removed: string[];
} {
    const cfg = gradientConfigForAgent(agent);
    return diffAgainstManifestAt(cfg.memoryDir, cfg.fractalDir, manifest);
}

// ── Integrity-failure / resign logging + the session-start verify-and-resign gate (slug-keyed) ──

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
