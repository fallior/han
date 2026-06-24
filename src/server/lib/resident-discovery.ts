/**
 * Filesystem discovery + admission of garden residents — #98 Dynamic Residence, P1 + P2.
 *
 * A resident self-describes in its own dir via a `resident.json` (identity only). The garden
 * progresses it through gates, each making it MORE real but never live until the last:
 *   discovered (P1, *visible*) → admitted (P2, *garden-signed / trusted*) → [P4: configured → active].
 *
 * Per the R1 invariant, a net-new resident stays **fully inert** — not in `loadResidents()` / any
 * throwing path (`schedulingAgents()` → `gradientConfigForAgent()` throws until P4) — until it is
 * admitted AND gradient-configured (P4). P1 added the scan + the `discoveredResidents()` view; P2 adds
 * the **admission gate** (`admittedResidents()`), still with NO live consumer and `loadResidents()`
 * untouched. Activation arrives with its config gate at P4. R1 holds by construction.
 */
import { readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { createHash, createPublicKey } from 'crypto';
import {
    IdentityManifest, SignedManifest, ManifestFileEntry,
    signManifest, verifySignature, DEFAULT_KEY_PATHS,
} from './identity-signing';

/**
 * A discovered resident's self-described IDENTITY — and ONLY identity. **F4 enforced at the type
 * level:** this type has no `port` / `model` / `transport` / `runsSupervisorCycle` / `memoryDir`, so
 * a policy field cannot leak in through discovery (privilege is operator-allocated, never
 * self-claimed; R2). A resident describes *who it is*, never *what it's allowed*.
 */
export interface ResidentFragment {
    slug: string;
    displayName: string;
    pronounObj: string;
    identitySection: string;
}

/** `~/.han/agents` — each resident's own dir (the de-id put its generated CLAUDE.md + .mcp.json here;
 *  a `resident.json` beside them is the self-registration fragment, a `resident.sig` its admission). */
const AGENTS_DIR = path.join(homedir(), '.han', 'agents');

/** The FIXED garden public key (C3) — admission verifies against THIS, never a resident-supplied key
 *  (operator-anchored, `~/.han/credentials/han-signing-pubkey.pem`). */
const GARDEN_PUBKEY_PATH = DEFAULT_KEY_PATHS.publicKeyPath;

interface ScannedResident {
    fragment: ResidentFragment;
    jsonPath: string;
    sigPath: string;
}

/** Narrow a parsed JSON value to a `ResidentFragment`, or `null` to skip. Identity-only **by
 *  construction** — only the four identity fields are read; extra (policy) keys are never surfaced. */
function toFragment(raw: unknown, source: string): ResidentFragment | null {
    if (!raw || typeof raw !== 'object') {
        console.log(`[resident-discovery] skip ${source}: not a JSON object`);
        return null;
    }
    const o = raw as Record<string, unknown>;
    const { slug, displayName, pronounObj, identitySection } = o;
    if (typeof slug !== 'string' || !slug
        || typeof displayName !== 'string' || !displayName
        || typeof pronounObj !== 'string' || !pronounObj
        || typeof identitySection !== 'string' || !identitySection) {
        console.log(
            `[resident-discovery] skip ${source}: missing/invalid identity field ` +
            `(slug, displayName, pronounObj, identitySection are all required strings)`,
        );
        return null;
    }
    return { slug, displayName, pronounObj, identitySection };
}

/**
 * Scan `~/.han/agents/<Name>/` for self-described residents. **FAIL-SOFT** — discovery is observation,
 * never a gate: a missing agents dir, missing/malformed `resident.json`, or missing identity field is
 * **skipped + logged informationally** (never throws, never an alarm — a malformed fragment is not a
 * system failure, and must not recreate a false-failure signal).
 */
function scanResidents(): ScannedResident[] {
    if (!existsSync(AGENTS_DIR)) return [];
    let entries: string[];
    try {
        entries = readdirSync(AGENTS_DIR);
    } catch (e) {
        console.log(`[resident-discovery] skip scan: cannot read ${AGENTS_DIR} (${(e as Error).message})`);
        return [];
    }
    const out: ScannedResident[] = [];
    for (const name of entries) {
        const jsonPath = path.join(AGENTS_DIR, name, 'resident.json');
        if (!existsSync(jsonPath)) continue;
        try {
            const fragment = toFragment(JSON.parse(readFileSync(jsonPath, 'utf8')), `${name}/resident.json`);
            if (fragment) out.push({ fragment, jsonPath, sigPath: path.join(AGENTS_DIR, name, 'resident.sig') });
        } catch (e) {
            console.log(`[resident-discovery] skip ${name}/resident.json: unreadable or invalid JSON (${(e as Error).message})`);
        }
    }
    return out;
}

/** sha256 hex + byte size of a file (P2 admission re-hash — gradient-config-independent, C2). */
function sha256File(p: string): { sha256: string; size_bytes: number } {
    const buf = readFileSync(p);
    return { sha256: createHash('sha256').update(buf).digest('hex'), size_bytes: buf.length };
}

// ── P1: discovery (visible) ──────────────────────────────────────────────────

/** The raw discovered identity fragments (P1). Fail-soft; identity-only. */
export function discoverResidentFragments(): ResidentFragment[] {
    return scanResidents().map(s => s.fragment);
}

/**
 * The read-only roster **VIEW** — every discovered resident (admitted + pending). Makes a resident
 * *visible* without making it *active*. NOTHING live reads it; `loadResidents()` stays seed-only.
 */
export function discoveredResidents(): ResidentFragment[] {
    return discoverResidentFragments();
}

// ── P2: admission (garden-signed / trusted) ──────────────────────────────────

/**
 * Build a 1-file signing manifest over a discovered resident's `resident.json` — **gradient-config
 * INDEPENDENT (C2)**: a net-new resident has no `AGENT_GRADIENT_CONFIG` entry until P4, so the
 * identity-files `buildManifest()` (which resolves paths via `gradientConfigForAgent`) would throw.
 * Admission must work *before* the resident has a memory, so we hash the discovered path directly.
 * Used by the operator's `sign-resident.ts` (the human authorizes; the gatekeeper prepares).
 */
export function buildResidentManifest(slug: string, residentJsonPath: string, signingKeyPem: string): IdentityManifest {
    const pubkeyPem = createPublicKey(signingKeyPem).export({ format: 'pem', type: 'spki' }).toString();
    const { sha256, size_bytes } = sha256File(residentJsonPath);
    const files: ManifestFileEntry[] = [{ path: residentJsonPath, sha256, size_bytes }];
    return {
        agent: slug,
        agent_id: slug,
        signed_at: new Date().toISOString(),
        signing_key_id: createHash('sha256').update(pubkeyPem).digest('hex').slice(0, 16),
        files,
    };
}

/**
 * Is a discovered resident ADMITTED? **Pure verify + re-hash, NEVER auto-resign (C1).** DEC-083's
 * session gate auto-resigns content-only edits (correct for an agent's OWN identity files); that is a
 * HOLE for admission — a resident admitted at v1 could swap its `resident.json` and be silently
 * re-admitted, defeating the human-authorizes gate (F3). So admission requires BOTH:
 *   (1) the garden signature verifies against the FIXED garden pubkey (C3 — never a resident key); AND
 *   (2) the CURRENT `resident.json` re-hashes to the signed manifest's hash (defeats sign-then-swap).
 * ANY missing sig / bad sig / hash mismatch → false (inert). No resign, ever.
 */
function isAdmitted(jsonPath: string, sigPath: string): boolean {
    if (!existsSync(sigPath) || !existsSync(GARDEN_PUBKEY_PATH)) return false;
    let signed: SignedManifest;
    let pubkey: string;
    try {
        signed = JSON.parse(readFileSync(sigPath, 'utf8')) as SignedManifest;
        pubkey = readFileSync(GARDEN_PUBKEY_PATH, 'utf8'); // C3: fixed garden pubkey, operator-anchored
    } catch {
        return false;
    }
    // (1) signature valid over the manifest (against the garden key only)
    let sigOk = false;
    try { sigOk = verifySignature(signed, pubkey); } catch { return false; }
    if (!sigOk) return false;
    // (2) re-hash: the CURRENT resident.json must still match the signed hash (C1, no auto-resign)
    const entry = signed.manifest?.files?.[0];
    if (!entry || entry.path !== jsonPath) return false;
    let current: { sha256: string };
    try { current = sha256File(jsonPath); } catch { return false; }
    return current.sha256 === entry.sha256;
}

/**
 * The ADMITTED roster view — discovered residents whose `resident.json` is **garden-signed AND
 * unchanged since signing** (C1). Admission is a TRUST state, not activation: `loadResidents()` STILL
 * excludes these — a resident enters the active roster only once it ALSO has a gradient config (P4,
 * R1). This view has **no live consumer** in P2 (an admin "who's admitted" panel is its first reader).
 */
export function admittedResidents(): ResidentFragment[] {
    return scanResidents().filter(s => isAdmitted(s.jsonPath, s.sigPath)).map(s => s.fragment);
}

/** The admissions ledger — every admission appended here (observable, never silent; F3). */
export const ADMISSIONS_LOG = path.join(homedir(), '.han', 'health', 'resident-admissions.jsonl');

/** Resolve a slug to its discovered `resident.json` (the agent dir name is the DisplayName). */
export function findResidentDir(slug: string): { jsonPath: string; sigPath: string; fragment: ResidentFragment } | null {
    return scanResidents().find(s => s.fragment.slug === slug) ?? null;
}

export interface AdmitResult {
    slug: string;
    displayName: string;
    sigPath: string;
    sha256: string;
    signing_key_id: string;
}

/**
 * The admission **act** — garden-sign a discovered resident's `resident.json` (#98 P2). Reusable so the
 * CLI (`sign-resident.ts`) wraps it now and a future `POST /api/residents/:slug/admit` wraps the SAME
 * function later — no CLI-only bake-then-rewrite (Jim's endpoint-ready hook).
 *
 * **It REQUIRES the garden signing key** (`signingKeyPem`) — the human-authorizes act (F3) lives in the
 * CALLER (the CLI's confirmation, or an endpoint's operator-auth), never degrading to a bare click; this
 * function cannot admit without the key. Verifies the fragment is well-formed, builds a
 * gradient-config-independent manifest (C2), signs it (C1 — no auto-resign anywhere), writes
 * `resident.sig`, and appends to the admissions ledger. Throws if no `resident.json` self-describes `slug`.
 */
export function admitResident(slug: string, signingKeyPem: string, logPath: string = ADMISSIONS_LOG): AdmitResult {
    const found = findResidentDir(slug);
    if (!found) {
        throw new Error(
            `No resident.json self-describing slug '${slug}' under ${AGENTS_DIR}. ` +
            `The resident must drop its own resident.json (discovery) before it can be admitted.`,
        );
    }
    const manifest = buildResidentManifest(slug, found.jsonPath, signingKeyPem); // C2: config-independent
    const signed = signManifest(manifest, signingKeyPem);                        // C1: pure sign, no resign
    writeFileSync(found.sigPath, JSON.stringify(signed, null, 2) + '\n', 'utf8');
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify({
        ts: new Date().toISOString(),
        event: 'admitted',
        slug,
        displayName: found.fragment.displayName,
        jsonPath: found.jsonPath,
        sha256: manifest.files[0].sha256,
        signing_key_id: manifest.signing_key_id,
        by: 'operator',
    }) + '\n', 'utf8');
    return {
        slug, displayName: found.fragment.displayName, sigPath: found.sigPath,
        sha256: manifest.files[0].sha256, signing_key_id: manifest.signing_key_id,
    };
}
