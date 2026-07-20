/**
 * cognition-envelope-sign.ts — the SIGNING side of the Cognition-Integrity
 * Envelope. GATEKEEPER-PATH ONLY (Jim's condition 3, the Dynamic-Residence-P2
 * lesson): runtime modules must NEVER import this file — the acceptance
 * suite's import gate enforces that structurally. A process that can re-sign
 * what it reads has no signature at all.
 *
 * Consumed exclusively by `scripts/resign-manifest.ts` (Darron's hand, zero
 * agent cognition in the path — Tenshi's condition 5).
 *
 * Key + lifecycle: reuses the DEC-083 garden keypair (one trust root, no
 * second hierarchy). INHERITED RESIDUAL, named per Casey's sharpening 3:
 * DEC-083 defines no key-rotation/compromise ceremony today; the envelope
 * inherits that gap rather than creating it. The E3 DEC names it; a rotation
 * ceremony, when it lands, re-keys both signed sets in one motion.
 */

import fs from 'node:fs';
import { DEFAULT_KEY_PATHS, KeyPaths, readSignedManifestAt, signManifest, writeSignedManifestAt } from './identity-manifest-core';
import { gradientConfigForAgent, registeredAgentSlugs } from './agent-registry';
import {
    CognitionEnvelope, ENVELOPE_FORMAT_VERSION, ENVELOPE_PATH,
    canonicalPreImage, preImageDigest,
} from './cognition-envelope';
import crypto from 'node:crypto';

/** Mirror of identity-manifest-core's private pubkeyFingerprint (kept local — the core stays untouched beyond the latch carry). */
function localPubkeyFingerprint(pubkeyPem: string): string {
    return crypto.createHash('sha256').update(pubkeyPem.trim()).digest('hex').slice(0, 16);
}

function readKeys(keyPaths: KeyPaths = DEFAULT_KEY_PATHS): { privPem: string; pubPem: string } {
    return {
        privPem: fs.readFileSync(keyPaths.privateKeyPath, 'utf8'),
        pubPem: fs.readFileSync(keyPaths.publicKeyPath, 'utf8'),
    };
}

/**
 * Sign the canonical extract of the CURRENT manifest for the given members.
 * WYSIWYS teeth (Casey's sharpening 1): the caller passes the digest it
 * RENDERED to the operator; if the manifest has changed since that render,
 * the pre-image digest differs and we REFUSE — the signature only ever
 * attaches to bytes that were seen. (Thornton's timing rule: notice precedes
 * and binds the yes.)
 */
export function signEnvelope(
    manifest: any,
    memberPaths: string[],
    renderedDigest: string,
    keyPaths: KeyPaths = DEFAULT_KEY_PATHS,
): CognitionEnvelope {
    const preImage = canonicalPreImage(manifest, memberPaths);
    const digest = preImageDigest(preImage);
    if (digest !== renderedDigest) {
        throw new Error(
            `WYSIWYS refusal: the manifest changed between render and signing ` +
            `(rendered ${renderedDigest.slice(0, 12)}…, current ${digest.slice(0, 12)}…). Re-render and look again.`,
        );
    }
    const { privPem, pubPem } = readKeys(keyPaths);
    const signature = crypto.sign(null, Buffer.from(preImage, 'utf8'), crypto.createPrivateKey(privPem));
    return {
        formatVersion: ENVELOPE_FORMAT_VERSION,
        memberPaths: [...memberPaths].sort(),
        digest,
        signature: signature.toString('base64'),
        signedAt: new Date().toISOString(),
        keyId: localPubkeyFingerprint(pubPem),
    };
}

export function writeEnvelope(env: CognitionEnvelope): void {
    const tmp = ENVELOPE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(env, null, 2) + '\n');
    fs.renameSync(tmp, ENVELOPE_PATH);
}

/**
 * The adoption latch, both directions (F3 (i) + Casey's sharpening 2 — every
 * gate gets its lawful exit so nobody ever builds a window):
 *  - `setAdoptionMarkers(true)`  — --init: write `cognition_envelope_adopted`
 *    into EVERY agent's DEC-083-signed identity manifest, atomically
 *    (all-or-none with rollback; Jim's fail-closed-union means a partial
 *    write is still enforced, so rollback only ever narrows toward safety).
 *  - `setAdoptionMarkers(false)` — --retire: the declared de-adoption
 *    ceremony (gatekeeper hands, receipted by the caller). Marker removed
 *    from all signed sets atomically.
 */
export function setAdoptionMarkers(adopted: boolean, keyPaths: KeyPaths = DEFAULT_KEY_PATHS): string[] {
    const { privPem } = readKeys(keyPaths);
    const slugs = registeredAgentSlugs();
    const previous: Array<{ memoryDir: string; signedJson: string }> = [];
    const touched: string[] = [];
    try {
        for (const slug of slugs) {
            const cfg = gradientConfigForAgent(slug);
            const existing = readSignedManifestAt(cfg.memoryDir);
            if (!existing) throw new Error(`no signed identity manifest for '${slug}' at ${cfg.memoryDir} — sign identities first (DEC-083)`);
            previous.push({ memoryDir: cfg.memoryDir, signedJson: JSON.stringify(existing) });
            const manifest: any = { ...existing.manifest };
            if (adopted) manifest.cognition_envelope_adopted = true;
            else delete manifest.cognition_envelope_adopted;
            manifest.signed_at = new Date().toISOString();
            const resigned = signManifest(manifest, privPem);
            writeSignedManifestAt(cfg.memoryDir, resigned);
            touched.push(slug);
        }
        return touched;
    } catch (err) {
        // all-or-none: restore every manifest we touched before rethrowing
        for (const p of previous) {
            try { fs.writeFileSync(p.memoryDir + '/identity-manifest.json', p.signedJson.endsWith('\n') ? p.signedJson : p.signedJson + '\n'); } catch { /* best effort */ }
        }
        throw err;
    }
}

/** Compose the default member set from what the live manifest actually carries. */
export function defaultMemberPaths(manifest: any): string[] {
    const paths: string[] = [];
    const agents: any[] = Array.isArray(manifest.agents) ? manifest.agents : Object.values(manifest.agents ?? {});
    for (const a of agents) {
        if (a?.slug && typeof a.identitySection === 'string' && a.identitySection.trim()) {
            paths.push(`agents[${a.slug}].identitySection`);
        }
    }
    const block = manifest.gardener ?? manifest.user;
    if (block && typeof block === 'object') {
        for (const field of ['name', 'pronounSubj', 'pronounObj', 'location', 'personaKey', 'conversationRole']) {
            if (typeof block[field] === 'string' && block[field].trim()) paths.push(`gardener.${field}`);
        }
    }
    return paths.sort();
}

// ── The resign delta-render adversarial battery (Tenshi 1 / acceptance #7) ──
// Ceremony-side by design: the renderer that guards the operator's eyes lives
// beside the signer those eyes authorise. Over RAW leaf strings, never a diff
// tool's label (the P3c root fix: read the physics, not git's opinion).
import { scanSuspectCodepoints, confusableFold } from './ring2-ceremony';

export function batteryReport(label: string, oldV: string | null, newV: string): string[] {
    const lines: string[] = [];
    // NUL / control band — loud, with a localized hexdump (never "0 changed")
    const controlIdx = [...newV].findIndex(ch => {
        const c = ch.codePointAt(0)!;
        return c === 0 || (c < 0x20 && c !== 0x0a && c !== 0x09) || (c >= 0x7f && c <= 0x9f);
    });
    if (controlIdx >= 0) {
        const start = Math.max(0, controlIdx - 8);
        const slice = Buffer.from(newV.slice(start, controlIdx + 8), 'utf8');
        lines.push(`  🔴 NON-TEXT / CONTROL BYTES in ${label} at char ${controlIdx} — this is NOT a clean text leaf:`);
        lines.push(`     hexdump(local): ${slice.toString('hex').replace(/(..)/g, '$1 ').trim()}`);
    }
    for (const line of newV.split('\n')) {
        for (const sc of scanSuspectCodepoints(line)) lines.push(`  ⚠ suspect codepoint: ${sc}`);
    }
    if (oldV !== null && oldV !== newV && confusableFold(oldV) === confusableFold(newV)) {
        lines.push(`  🔴 PROBABLE HOMOGLYPH SWAP in ${label}: the change disappears under confusable folding — the render can look identical while the bytes differ. Do NOT sign without reading the codepoint list above.`);
    }
    return [...new Set(lines)];
}
