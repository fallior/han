/**
 * peer-peek.ts — the ONE home of the S103 sovereignty exception: reading another
 * mind's identity files as peer context.
 *
 * Extracted from agent-heartbeat.ts at R3b-HB S1's re-audit (2026-08-25 night) on
 * Tenshi's finding and Casey's concurrence. The extraction is not tidiness — it is
 * the instrument that makes acceptance #7 RUNNABLE:
 *
 *   - Inline in the driver, `readPeerContext` was unexported, and the driver's top
 *     level takes a pid-guard and starts the rhythm loop at import. A test harness
 *     importing it with a real slug walks into `ensureSingleInstance`'s takeover
 *     path — which SIGTERMs the standing holder, i.e. that agent's OWN live
 *     heartbeat. Tenshi stopped one import short of that and recorded the near-miss
 *     on the same evening the lethal-reaction register classified the family.
 *   - As a leaf module it imports nothing that runs anything: acceptance #7 is
 *     `npx tsx -e "…readPeerContext('leo','tenshi')…"` — no loop, no pid-guard, no
 *     mutation of a live manifest, runnable forever rather than once, carefully.
 *   - And it gives the S103 exception exactly ONE greppable home for the per-UID
 *     actor matrix (Tenshi's T1 close-out at S5-HB).
 *
 * The doctrine this file implements (T1 + C1, thread mqvs3r6l-dk71d2):
 *   - The GRANT lives on the PEEKED side (`peekableBy` in the manifest) — a
 *     reader-side edge granting its own read is ambient authority wearing config's
 *     clothes, and a use that survives by not being noticed acquires nothing
 *     (no prescription without acquiescence — Casey).
 *   - `peekGranted` re-reads the leaf FROM DISK at exercise time and fails closed,
 *     so revocation reaches a running process without a restart (C1).
 *   - A refusal writes a DURABLE row (W1) — the witness must outlive the pane.
 *   - S103 sovereignty stays the RULE; this module is its written exception.
 */
import fs from 'node:fs';
import path from 'node:path';
import { peekGranted } from './garden-manifest';
import { gradientConfigForAgent } from './agent-registry';
import { hanHome } from './paths';

/** Bytes of the peeked party's identity read per peek. Named rather than bare
 *  (no-hidden-globals); the curated file is preferred over the living vault. */
const IDENTITY_MAX_CHARS = 3000;
const REFLECTION_MAX_CHARS = 4000;

export interface PeekOptions {
    /** Surface + beat recorded on the refusal row, when the caller has them. */
    surface?: string;
    beat?: number;
}

/**
 * The peeked party's identity files as peer context — GRANT-GATED.
 * Returns '' on refusal or on any read failure; never throws at the caller.
 *
 * @param readerSlug the mind doing the reading (the beat's own slug)
 * @param peekedSlug the mind whose files are read (the peer)
 */
export function readPeerContext(readerSlug: string, peekedSlug: string, opts: PeekOptions = {}): string {
    if (!peekGranted(peekedSlug, readerSlug)) {
        // W1: the refusal's witness must PERSIST — a pane warn is the evaporating-witness
        // class. This row is also the instrument acceptance #7 runs on (Casey's join: one
        // artefact, two duties). peekGranted fails closed and re-reads at exercise time (C1),
        // so this row also catches a revoked-but-still-exercised grant.
        console.warn(`[peer-peek] peek REFUSED: '${peekedSlug}' grants no peekableBy to '${readerSlug}' (S103 sovereignty is the rule; the manifest leaf is its only exception)`);
        try {
            const healthDir = path.join(hanHome(), 'health');
            fs.mkdirSync(healthDir, { recursive: true });
            fs.appendFileSync(path.join(healthDir, 'peek-refusals.jsonl'), JSON.stringify({
                ts: new Date().toISOString(), reader: readerSlug, peeked: peekedSlug,
                surface: opts.surface ?? null, beat: opts.beat ?? null,
            }) + '\n');
        } catch { /* the warn above is the floor; never fail a beat on witness I/O */ }
        return '';
    }
    try {
        const dir = gradientConfigForAgent(peekedSlug).memoryDir;
        const parts: string[] = [];
        const identity = path.join(dir, 'identity.md');
        if (fs.existsSync(identity)) parts.push(fs.readFileSync(identity, 'utf-8').slice(0, IDENTITY_MAX_CHARS));
        // Curated preferred — the owner's chosen bright-few. Jim named the fallback's larger
        // reach himself when he confirmed his grant (curated absent → the living tail is read,
        // "acceptable to me as granted"): informed consent in its full dress.
        const curated = path.join(dir, 'self-reflections-curated.md');
        const full = path.join(dir, 'self-reflection.md');
        if (fs.existsSync(curated)) parts.push(fs.readFileSync(curated, 'utf-8').slice(0, REFLECTION_MAX_CHARS));
        else if (fs.existsSync(full)) parts.push(fs.readFileSync(full, 'utf-8').slice(-REFLECTION_MAX_CHARS));
        return parts.join('\n\n');
    } catch (err) {
        console.error(`[peer-peek] peer context read failed for '${peekedSlug}' (non-fatal):`, (err as Error).message);
        return '';
    }
}
