/**
 * cognition-envelope.ts — PURE VERIFY side of the (b) Cognition-Integrity
 * Envelope (E1; thread mqvs3r6l-dk71d2: design mrqzxhkl, Jim's audit mrrrrf91
 * GREEN, Casey mrsudv2r, Tenshi mrsufa60; Darron's (b) ruling — the manifest
 * will travel, so the fields that author a prompt sit inside an integrity
 * envelope, same trust family as the memory-bank self).
 *
 * WHAT IS SIGNED — the canonical extract (F1: extract, not whole-file): a
 * deterministic pre-image `{formatVersion, memberPaths[], values{}}` where
 * memberPaths is INSIDE the pre-image (membership cannot be silently trimmed
 * — Jim's condition 1) and values are the RESOLVED leaves (they span the
 * `gardener ?? user` alias — Casey's discipline: the VALUE that serves is the
 * value that is sealed). Nothing host-shaped enters the pre-image — no paths,
 * no locale, no timestamps (P5's doors closed by construction); `signedAt` /
 * `keyId` are sidecar metadata outside the digest.
 *
 * WHERE IT VERIFIES — `verifiedCognitionLeaf(path)`, THE seam: every
 * cognition-shaping consumer (specFor's manifest path, beat-prompts'
 * identityCoreFor, Ring-2's gardener injection) resolves member leaves only
 * through here. E1 is INERT — nothing calls the seam yet; consumers flip in
 * E2 (Ring 2's commit-family).
 *
 * NO CACHE — deliberately (Tenshi's premise-check, condition folded 2026-07-20):
 * the measured verify cost is microseconds against a seconds-long assembly
 * (see tests/cognition-envelope.test.ts, the measurement is IN the suite), so
 * the mtime cache bought nothing and carried the one `touch -d` residual the
 * design had. Verify runs on every resolution; the residual surface is deleted
 * rather than documented.
 *
 * PURITY (Jim's condition 3, structural): this module contains NO signing
 * code and never imports the signing module. The acceptance suite greps for
 * that (the import gate). A process that can re-sign what it reads has no
 * signature at all — recovery is `scripts/resign-manifest.ts`, gatekeeper
 * hands, zero agent cognition in its path (Tenshi's condition 5).
 *
 * FAIL BEHAVIOUR (Jim's condition 4, DEC-103): verification failure throws
 * `CognitionEnvelopeError`; each surface maps it — human-response → message
 * stays queued + one ntfy; heartbeat/cycle → skip beat, alert once, hold the
 * lane; interactive → halt injection, print the receipt. Alert-and-hold,
 * never inject-anyway, never retry-storm. The thrown error carries the
 * printed way in.
 *
 * LATCH (F3 ruling (i), fail-closed union): adoption is recorded as
 * `cognition_envelope_adopted: true` inside the DEC-083-signed per-agent
 * identity manifests (carried across resigns by identity-manifest-core).
 * ANY agent's marker present ⇒ the garden is enforced; a missing envelope on
 * an enforced garden fails CLOSED. A genesis garden (no markers) serves
 * leaves unverified with a once-per-boot log — until `resign-manifest --init`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSignedManifestAt, DEFAULT_KEY_PATHS } from './identity-manifest-core';
import { canonicalise } from './jcs';
import { gradientConfigForAgent, registeredAgentSlugs } from './agent-registry';

const HOME = process.env.HOME || '';
export const GARDEN_MANIFEST_PATH = process.env.HAN_GARDEN_MANIFEST || path.join(HOME, '.han', 'garden-manifest.json');
export const ENVELOPE_PATH = process.env.HAN_COGNITION_ENVELOPE || path.join(HOME, '.han', 'garden-manifest.envelope.json');

export const ENVELOPE_FORMAT_VERSION = 1;

/** The fixed member-path grammar (F5 ruling): small, named, nothing to get wrong. */
const AGENT_PATH_RE = /^agents\[([a-z0-9_-]+)\]\.identitySection$/;
const GARDENER_PATH_RE = /^gardener\.(name|pronounSubj|pronounObj|location|personaKey|conversationRole)$/;

export interface CognitionEnvelope {
    formatVersion: number;
    memberPaths: string[];
    digest: string;      // sha256 hex of the canonical pre-image
    signature: string;   // base64, over the canonical pre-image bytes
    signedAt: string;    // metadata — OUTSIDE the pre-image
    keyId: string;       // metadata — OUTSIDE the pre-image
}

export class CognitionEnvelopeError extends Error {
    constructor(
        public readonly reason:
            | 'missing-envelope' | 'bad-signature' | 'digest-mismatch'
            | 'unsupported-version' | 'missing-member' | 'bad-path' | 'missing-pubkey',
        detail: string,
    ) {
        super(
            `CognitionEnvelope ${reason}: ${detail}\n` +
            `  The way in (zero agent cognition in its path):\n` +
            `    cd ~/Projects/han/src/server && npx tsx ../../scripts/resign-manifest.ts\n` +
            `  Surfaces must ALERT-AND-HOLD on this error (DEC-103) — never inject-anyway, never retry-storm.`,
        );
        this.name = 'CognitionEnvelopeError';
    }
}

let fallbackLoggedThisBoot = false;
let unadoptedLoggedThisBoot = false;

/** Read + parse the garden manifest fresh (a few KB; the verify is measured-cheap). */
function readGardenManifest(): any {
    return JSON.parse(fs.readFileSync(GARDEN_MANIFEST_PATH, 'utf8'));
}

/**
 * Resolve one member path against the manifest object. The gardener block
 * spans the legacy `user` alias (read both, write canonical, LOG ONCE when
 * the fallback serves — Casey's transitional-provision discipline).
 */
export function resolveMemberPath(manifest: any, memberPath: string): string {
    const agentMatch = memberPath.match(AGENT_PATH_RE);
    if (agentMatch) {
        const slug = agentMatch[1];
        const agents: any[] = Array.isArray(manifest.agents) ? manifest.agents : Object.values(manifest.agents ?? {});
        const agent = agents.find(a => a?.slug === slug);
        const v = agent?.identitySection;
        if (typeof v !== 'string' || !v.trim()) {
            throw new CognitionEnvelopeError('missing-member', `no identitySection for '${slug}' in ${GARDEN_MANIFEST_PATH}`);
        }
        return v;
    }
    const gardenerMatch = memberPath.match(GARDENER_PATH_RE);
    if (gardenerMatch) {
        const field = gardenerMatch[1];
        let block = manifest.gardener;
        if (block === undefined && manifest.user !== undefined) {
            block = manifest.user; // legacy alias — honoured on read, never written
            if (!fallbackLoggedThisBoot) {
                fallbackLoggedThisBoot = true;
                console.log(`[cognition-envelope] gardener resolved from legacy 'user' key (transitional alias) — announce-once per boot`);
            }
        }
        const v = block?.[field];
        if (typeof v !== 'string' || !v.trim()) {
            throw new CognitionEnvelopeError('missing-member', `gardener.${field} absent (gardener ?? user ?? throw — a nameless garden halts, it never becomes anyone's by default)`);
        }
        return v;
    }
    throw new CognitionEnvelopeError('bad-path', `'${memberPath}' is outside the fixed member-path grammar`);
}

/**
 * The canonical pre-image: deterministic, host-free. String values are
 * NFC-normalised; paths sorted; serialisation via the same JCS canonicaliser
 * the DEC-083 manifests use. Pure function of (version, paths, values).
 */
export function canonicalPreImage(manifest: any, memberPaths: string[], formatVersion: number = ENVELOPE_FORMAT_VERSION): string {
    const sorted = [...memberPaths].sort();
    const values: Record<string, string> = {};
    for (const p of sorted) {
        values[p] = resolveMemberPath(manifest, p).normalize('NFC');
    }
    return canonicalise({ formatVersion, memberPaths: sorted, values } as any);
}

export function preImageDigest(preImage: string): string {
    return crypto.createHash('sha256').update(preImage, 'utf8').digest('hex');
}

function readGardenPubkey(): string {
    const p = DEFAULT_KEY_PATHS.publicKeyPath;
    if (!fs.existsSync(p)) throw new CognitionEnvelopeError('missing-pubkey', `garden public key not found at ${p}`);
    return fs.readFileSync(p, 'utf8');
}

/** Version table (condition 2 + Tenshi's 6): prior versions verify forever; dropped versions fail LOUD. */
type Verifier = (env: CognitionEnvelope, manifest: any, pubkeyPem: string) => void;

function verifyV1(env: CognitionEnvelope, manifest: any, pubkeyPem: string): void {
    const preImage = canonicalPreImage(manifest, env.memberPaths, env.formatVersion);
    const digest = preImageDigest(preImage);
    if (digest !== env.digest) {
        throw new CognitionEnvelopeError('digest-mismatch',
            `the cognition-shaping leaves have changed since the last signing (signed ${env.signedAt}). ` +
            `Expected ${env.digest.slice(0, 12)}…, current ${digest.slice(0, 12)}…`);
    }
    const publicKey = crypto.createPublicKey(pubkeyPem);
    const ok = crypto.verify(null, Buffer.from(preImage, 'utf8'), publicKey, Buffer.from(env.signature, 'base64'));
    if (!ok) throw new CognitionEnvelopeError('bad-signature', `signature does not verify with the garden key (keyId ${env.keyId})`);
}

const VERIFIERS: Record<number, Verifier> = {
    1: verifyV1,
};

/**
 * The enforcement latch (F3 (i), Jim's fail-closed-union sharpening): ANY
 * agent's DEC-083-signed identity manifest carrying the adoption marker ⇒
 * the whole garden is enforced. The marker rides a signed surface that is
 * already verified at every wake and launcher pre-flight; deleting the
 * envelope sidecar on an enforced garden fails CLOSED.
 */
export function envelopeAdopted(): boolean {
    let slugs: string[];
    try { slugs = registeredAgentSlugs(); } catch { return false; }
    for (const slug of slugs) {
        try {
            const cfg = gradientConfigForAgent(slug);
            const signed = readSignedManifestAt(cfg.memoryDir);
            if ((signed?.manifest as any)?.cognition_envelope_adopted === true) return true;
        } catch { /* an unreadable manifest never unlatches the union */ }
    }
    return false;
}

export function readEnvelope(): CognitionEnvelope | null {
    if (!fs.existsSync(ENVELOPE_PATH)) return null;
    return JSON.parse(fs.readFileSync(ENVELOPE_PATH, 'utf8')) as CognitionEnvelope;
}

/**
 * Full verification: envelope present, version honoured, digest + signature
 * good against the manifest. THE SERVE MUST BIND THE VERIFY (Tenshi's E1
 * catch, mrsvagxn — the verify-side twin of WYSIWYS): callers that go on to
 * SERVE a leaf must pass the manifest OBJECT they will serve from, so the
 * bytes whose signature is checked are, by construction, the bytes returned.
 * The exhibit tendered is the exhibit examined (Casey's naming, mrsvfl57).
 * Parameterless form retained for standalone checks that serve nothing.
 */
export function verifyCognitionEnvelope(manifest?: any): void {
    const env = readEnvelope();
    if (!env) {
        throw new CognitionEnvelopeError('missing-envelope',
            `${ENVELOPE_PATH} absent on an envelope-enforced garden (the adoption latch rides the signed identity manifests — deleting the sidecar fails closed, by design)`);
    }
    const verifier = VERIFIERS[env.formatVersion];
    if (!verifier) {
        throw new CognitionEnvelopeError('unsupported-version',
            `envelope formatVersion ${env.formatVersion} is not supported by this engine (supported: ${Object.keys(VERIFIERS).join(', ')}). ` +
            `Re-sign at the current format.`);
    }
    verifier(env, manifest ?? readGardenManifest(), readGardenPubkey());
}

/**
 * THE SEAM — every cognition-shaping consumer reads member leaves through
 * here (E2 flips them on). Unadopted garden: serve unverified with a
 * once-per-boot honest log. Adopted garden: verify EVERY resolution (no
 * cache — see header), fail closed with the way-in printed.
 */
export function verifiedCognitionLeaf(memberPath: string): string {
    // ONE read. The same object is verified and served — the double-read
    // (verify B, serve A) closed per Tenshi's catch, before any consumer
    // flips on (E2 gate #1). Never-borrow composes through this seam: an
    // absent/empty member THROWS (missing-member) and the surface holds its
    // lane — the codified form of the first-night refusals (MNT-059).
    const manifest = readGardenManifest();
    if (!envelopeAdopted()) {
        if (!unadoptedLoggedThisBoot) {
            unadoptedLoggedThisBoot = true;
            console.log(`[cognition-envelope] garden has not adopted the envelope — cognition leaves served UNVERIFIED (run resign-manifest --init to adopt); announce-once per boot`);
        }
        return resolveMemberPath(manifest, memberPath);
    }
    verifyCognitionEnvelope(manifest);
    return resolveMemberPath(manifest, memberPath);
}

/** Test hook (suite only): reset the once-per-boot logs. */
export function __resetOncePerBootLogs(): void {
    fallbackLoggedThisBoot = false;
    unadoptedLoggedThisBoot = false;
}
