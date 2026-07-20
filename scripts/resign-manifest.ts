#!/usr/bin/env npx tsx
/**
 * resign-manifest.ts — the Cognition-Integrity Envelope's OPERATOR ceremony
 * (E1; Tenshi's condition 5: ZERO agent cognition in this path — a standalone
 * node script, so a wedged garden always has a printed way in that does not
 * require the mind the gate is holding).
 *
 * Usage (from ~/Projects/han/src/server):
 *   npx tsx ../../scripts/resign-manifest.ts             # re-sign: render delta → WYSIWYS confirm → sign
 *   npx tsx ../../scripts/resign-manifest.ts --init      # adopt: first signing + latch markers into ALL signed sets
 *   npx tsx ../../scripts/resign-manifest.ts --retire    # the lawful exit (Casey 2, ruling (a)): unlatch ALL, receipted
 *   npx tsx ../../scripts/resign-manifest.ts --yes-digest=<hex>   # non-interactive confirm — must equal the rendered digest
 *
 * WYSIWYS (Casey 1, folded): the digest shown in the render is the exact
 * pre-image that gets signed; signEnvelope refuses if the manifest changed
 * between render and keypress. The confirmation TYPES the digest prefix, so
 * the yes is bound to the notice.
 *
 * THE DELTA-RENDER IS A P3c SURFACE (Tenshi 1, folded — acceptance item #7):
 * the leaves rendered here are exactly the free-text strings a poison lives
 * in, so this renderer runs the same adversarial battery as the Ring-2
 * ceremony, over the RAW member-leaf strings (never a diff tool's label):
 *   - NUL / C0-C1 control characters → loud banner + localized hexdump
 *     (never a silent render, never "0 changed");
 *   - every suspect codepoint on a changed leaf named (ring2-ceremony's
 *     scanSuspectCodepoints: homoglyph classes, zero-widths, bidi controls);
 *   - confusable-fold comparison — a change that VANISHES under confusable
 *     folding is flagged as a probable homoglyph swap, the exact blinding
 *     class;
 *   - values compared as raw strings: a reorder/multiset trick cannot render
 *     as "unchanged" because equality is byte equality on the canonical form.
 *
 * Every ceremony (sign/init/retire) appends a receipt to
 * ~/.han/health/cognition-envelope-ceremonies.jsonl (Casey 2's "receipted").
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import {
    ENVELOPE_PATH, GARDEN_MANIFEST_PATH,
    canonicalPreImage, preImageDigest, readEnvelope, resolveMemberPath, envelopeAdopted,
} from '../src/server/lib/cognition-envelope';
import { signEnvelope, writeEnvelope, setAdoptionMarkers, defaultMemberPaths, batteryReport } from '../src/server/lib/cognition-envelope-sign';

const HOME = process.env.HOME || '';
const RECEIPTS = path.join(HOME, '.han', 'health', 'cognition-envelope-ceremonies.jsonl');

const args = process.argv.slice(2);
const MODE = args.includes('--init') ? 'init' : args.includes('--retire') ? 'retire' : 'sign';
const YES_DIGEST = args.find(a => a.startsWith('--yes-digest='))?.slice('--yes-digest='.length);

function receipt(action: string, extra: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(RECEIPTS), { recursive: true });
    fs.appendFileSync(RECEIPTS, JSON.stringify({ ts: new Date().toISOString(), action, ...extra }) + '\n');
}

export function renderDelta(manifest: any, memberPaths: string[]): { rendered: string; digest: string; changed: number; flags: number } {
    const prior = readEnvelope();
    const priorValues: Record<string, string> = {};
    // The prior envelope holds only the digest — prior VALUES come from re-resolving
    // against the manifest as-signed; absent that history, delta is old-digest vs new.
    // We render every member leaf with its battery; "changed" is digest-level truth.
    const out: string[] = [];
    let flagCount = 0;
    out.push(`═══ Cognition-Envelope ceremony — ${new Date().toISOString()} ═══`);
    out.push(`Manifest: ${GARDEN_MANIFEST_PATH}`);
    out.push(`Members (${memberPaths.length}):`);
    for (const p of memberPaths) {
        const v = resolveMemberPath(manifest, p);
        const flags = batteryReport(p, priorValues[p] ?? null, v);
        flagCount += flags.length;
        out.push(`\n── ${p} (${v.length} chars) ──`);
        out.push(v.split('\n').map(l => `    ${l}`).join('\n'));
        for (const f of flags) out.push(f);
    }
    const preImage = canonicalPreImage(manifest, memberPaths);
    const digest = preImageDigest(preImage);
    out.push(`\nPrior envelope: ${prior ? `${prior.digest.slice(0, 16)}… (signed ${prior.signedAt}, v${prior.formatVersion})` : '(none — first signing)'}`);
    out.push(`THIS pre-image digest: ${digest}`);
    const changed = prior && prior.digest === digest ? 0 : 1;
    if (prior && changed === 0) out.push(`No change against the prior envelope — re-signing is a no-op (identical digest).`);
    if (flagCount > 0) out.push(`\n🔴 ${flagCount} battery flag(s) above — READ THEM before confirming. A blinded re-sign is the laundering step this ceremony exists to prevent.`);
    return { rendered: out.join('\n'), digest, changed, flags: flagCount };
}

async function confirmDigest(digest: string): Promise<boolean> {
    if (YES_DIGEST) {
        if (YES_DIGEST === digest || digest.startsWith(YES_DIGEST)) return true;
        console.error(`--yes-digest does not match the rendered digest (WYSIWYS: the yes must bind the notice). Rendered: ${digest}`);
        return false;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise(res => rl.question(`\nType the first 8 hex of the digest to sign (or anything else to abort): `, res));
    rl.close();
    return answer.trim().toLowerCase() === digest.slice(0, 8);
}

async function main(): Promise<void> {
    if (MODE === 'retire') {
        // The lawful exit — Casey's door with a handle.
        const touched = setAdoptionMarkers(false);
        if (fs.existsSync(ENVELOPE_PATH)) {
            fs.renameSync(ENVELOPE_PATH, ENVELOPE_PATH + `.retired-${Date.now()}`);
        }
        receipt('retire', { unlatched: touched });
        console.log(`Envelope RETIRED: latch cleared on [${touched.join(', ')}]; sidecar archived (never deleted — DEC-069). Receipted.`);
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(GARDEN_MANIFEST_PATH, 'utf8'));
    const members = readEnvelope()?.memberPaths ?? defaultMemberPaths(manifest);
    const { rendered, digest, flags } = renderDelta(manifest, members);
    console.log(rendered);

    if (!(await confirmDigest(digest))) {
        console.log('Aborted — nothing signed.');
        receipt('abort', { digest, flags });
        process.exit(1);
    }

    // WYSIWYS: sign EXACTLY the rendered pre-image; signEnvelope re-derives and
    // refuses if the manifest moved between render and keypress.
    const env = signEnvelope(manifest, members, digest);
    writeEnvelope(env);

    if (MODE === 'init' && !envelopeAdopted()) {
        const touched = setAdoptionMarkers(true);
        console.log(`Adoption latch written into signed sets: [${touched.join(', ')}] (any marker = enforced garden-wide, fail-closed union).`);
    }
    receipt(MODE, { digest, keyId: env.keyId, members: members.length, flags });
    console.log(`Envelope ${MODE === 'init' ? 'ADOPTED + signed' : 'signed'}: ${ENVELOPE_PATH} (digest ${digest.slice(0, 16)}…, ${members.length} members). Receipted.`);
}

// Entry guard: the battery + renderer are import-testable (acceptance item #7);
// the ceremony itself runs only when invoked as the script.
if (process.argv[1] && process.argv[1].includes('resign-manifest')) {
    main().catch(err => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
