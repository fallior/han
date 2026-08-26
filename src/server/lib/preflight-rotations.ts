/**
 * preflight-rotations.ts — R3c-HB S2: the coordinator's pre-beat file hygiene, as a
 * manifest-LEAFED capability (never a slug branch — DEC-081).
 *
 * Ported from supervisor-worker.ts `runJimPreflightRotations` (:673-710, Jim's F6-1):
 * identity gate (DEC-083 surface preserved), then rollingWindowRotate on felt-moments +
 * self-reflection so the prompt builder reads bounded files. Writer-side per DEC-085 +
 * W6-4; the working-memory pair's rotation stays wm-sensor's (rollingWindowRotatePaired)
 * and is NOT touched here.
 *
 * WHY A LEAF AND NOT A UNIFORM BEHAVIOUR (the S2 grounding's finding, named): the
 * per-agent memory MODELS genuinely differ. Jim's files run rolling windows (his F6-1 +
 * the F9 overflow scar — self-reflection at tighter 20K windows for exactly that reason).
 * Leo's felt-moments runs the VAULT + CURATED model (FM #118 → the 2026-08-26 curation
 * arc; the full file is the never-rotated vault, the curated file is the wake load) —
 * wiring a uniform rotation would FIGHT that design. So: `preflightRotations` on the
 * heartbeat surface, declared AND set for jim alone; anyone else's yes is a manifest
 * edit made with their memory model in the room.
 *
 * (The R3b flip finding this grounding surfaced, filed separately: leo's TWIN carried a
 * live felt-moments rotation at flip time (leo-heartbeat.ts:2177→:1720) which the flip
 * dropped silently. Whether the drop is the curation design converging or a regression
 * is Darron's ruling — see the journal row.)
 */
import path from 'node:path';
import { rollingWindowRotate } from './memory-gradient';
import { gateIdentityOrThrow } from './identity-signing';
import { gradientConfigForAgent } from './agent-registry';
import { loadResidents } from './garden-manifest';
import { hanHome } from './paths';
import fs from 'node:fs';

function memoryConfig(): any {
    try { return JSON.parse(fs.readFileSync(path.join(hanHome(), 'config.json'), 'utf8')).memory || {}; } catch { return {}; }
}

/** Pre-beat file-level rotations for `slug` — felt-moments + self-reflection bounded
 *  before the builder reads them. Caller gates on the manifest leaf. */
export function runPreflightRotations(slug: string, log: (msg: string) => void = console.log): void {
    gateIdentityOrThrow(slug, 'agent-heartbeat');

    const displayName = loadResidents().find(a => a.slug === slug)?.displayName || slug;
    const memoryDir = gradientConfigForAgent(slug).memoryDir;
    const memConfig = memoryConfig();
    const headSize = memConfig.rollingWindowHead || 51200;
    const tailSize = memConfig.rollingWindowTail || 51200;
    try {
        const fmResult = rollingWindowRotate(
            path.join(memoryDir, 'felt-moments.md'),
            `# ${displayName} — Felt Moments\n\n> Older entries compressed into fractal gradient. Nothing is lost.\n`,
            headSize, tailSize,
            slug, 'felt-moments',
        );
        if (fmResult.rotated) {
            log(`[preflight] felt-moments rolling window (${slug}): archived ${fmResult.entriesArchived}, kept ${fmResult.entriesKept}, c0=${fmResult.c0EntryId}`);
        }

        // Self-reflection: tighter windows (Jim's F9 overflow scar, 2026-04-20 — growth
        // to 86KB choked the load; 20K+20K keeps the head's identity-structural sections).
        const srHeadSize = memConfig.selfReflectionHead || 20480;
        const srTailSize = memConfig.selfReflectionTail || 20480;
        const srResult = rollingWindowRotate(
            path.join(memoryDir, 'self-reflection.md'),
            `# ${displayName} — Self-Reflection\n\n> Older reflections compressed into fractal gradient. Nothing is lost.\n`,
            srHeadSize, srTailSize,
            slug, 'self-reflection',
        );
        if (srResult.rotated) {
            log(`[preflight] self-reflection rolling window (${slug}): archived ${srResult.entriesArchived}, kept ${srResult.entriesKept}, c0=${srResult.c0EntryId}`);
        }
    } catch (e) { console.error(`[preflight] rotation error (${slug}): ${e}`); }
}
