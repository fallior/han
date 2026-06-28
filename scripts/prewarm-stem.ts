/**
 * prewarm-stem.ts <slug> — the R1 pre-warmer (DEC-099 stem-sleeve).
 *
 * Produces a personality-warm STEM: a `session`-surface self that loads its WHOLE self (the
 * greet-less wake-feed) and then idles warm, ready to be ATTACHED to (re-sleeved) by a human —
 * so the expensive L1 load is paid in the BACKGROUND, off the critical path. The interactive
 * time-saving is banked at attach (gate 2, the coordinated live-prove): a human switch-clients
 * onto this warm stem and is greeted in seconds instead of waiting the ~minute L1 wake.
 *
 * It does NOT duplicate the launch contract — it drives `launch-tmux-surface.sh --stem` (fork-1,
 * unanimous) which reuses the proven env/model/cwd/claude-logged/HAN_SPOKE/ready-sentinel path.
 * This script is the "pre-warmer caller": launch → wait-for-claude → greet-less wake-feed →
 * record the warm stem in the stem-registry (the ATTACH source-of-truth).
 *
 *   R1 scope. The ATTACH (switch-client) + the #91 attach-flush are gate 2 — a fresh `hanleo` +
 *   Darron; switch-client is untestable solo. HEAD: held for Jim's blocking diff-audit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { feedWakeSteps, wakeStepsFor, awaitChromeOrDescend, observeActiveModel, currentWmCharLen } from '../src/server/lib/tmux-dispatcher';
import { manifestModelLadder } from '../src/server/lib/garden-manifest';

const slug = process.argv[2];
if (!slug) {
    console.error('usage: prewarm-stem.ts <slug>   (R1 pre-warmer — DEC-099 stem-sleeve)');
    process.exit(2);
}

const SURFACE = 'session'; // R1 AS-session (sidesteps R2's surface-param crux; keying already right)
const tmuxSession = `${SURFACE}-${slug}`; // distinct from the human's `han-$$` seat (no collision)
const HOME = process.env.HOME!;
const HEALTH = `${HOME}/.han/health`;
const SENTINEL = `${HEALTH}/${slug}-${SURFACE}-ready`; // the gradient step writes the reached c0 here
const REGISTRY = `${HEALTH}/stem-${slug}.json`;        // the stem-pool registry (attach source-of-truth)

const here = path.dirname(fileURLToPath(import.meta.url));
const LAUNCH = path.join(here, 'launch-tmux-surface.sh');

async function main(): Promise<void> {
    // Clear any stale `<slug>-session-ready` BEFORE launch — else the feeder's c0-ack (which accepts
    // any valid c0 of the agent, not a fresh one) could pass off a leftover (e.g. a live `han` seat's
    // sentinel) without the STEM having actually written its own. Clearing makes the ack prove the
    // stem's fresh traversal-to-EOF. (The clobber of a live seat's sentinel is benign — fork-3:
    // the stem-registry is the attach source-of-truth; pool-of-1 replaces, doesn't parallel.)
    try { unlinkSync(SENTINEL); } catch { /* absent = fine */ }

    // 1) launch the stem via the shared contract (--stem bypasses only the launchable-surface check)
    console.log(`[prewarm] launching stem '${tmuxSession}' via launch-tmux-surface.sh --stem …`);
    execFileSync('bash', [LAUNCH, slug, SURFACE, '--stem'], { stdio: 'inherit' });

    // 2) wait for claude chrome (bash→claude ready; auto-descends the model if the launch model is
    //    dead) — the failover ladder derived the same single-source way the dispatcher does
    await awaitChromeOrDescend(slug, SURFACE, tmuxSession, manifestModelLadder(slug, SURFACE));

    // 3) feed the WHOLE self, GREET-LESS (greet:false) — completion = queue-empty = warm; the gradient
    //    step traverses to GRADIENT-EOF and writes the reached c0 to the sentinel (the c0-ack reads it).
    await feedWakeSteps(slug, SURFACE, wakeStepsFor(slug, SURFACE, { greet: false }), { tmuxTarget: tmuxSession });

    // 4) record the warm stem — the ATTACH source-of-truth (gate 2 reads this to find a warm stem)
    const c0 = readFileSync(SENTINEL, 'utf8').trim();
    const registry = {
        slug,
        surface: SURFACE,
        tmux_session: tmuxSession,
        c0,
        // #91 attach-flush cursor (F2): the working-memory.md CHAR length at pre-warm. attach-stem
        // computes deltaSinceCursor(slug, wm_len) = what landed while the stem idled. CHARS (not
        // currentWmLen's bytes) — the slice helper compares content.length (F2b unit-match).
        wm_len: currentWmCharLen(slug),
        model: observeActiveModel(slug, SURFACE),
        warm_at: new Date().toISOString(),
    };
    writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n');
    console.log(`[prewarm] stem WARM: ${tmuxSession}  c0=${c0}  → ${REGISTRY}`);
}

main().catch((e) => { console.error('[prewarm-stem]', e && (e as Error).message ? (e as Error).message : e); process.exit(1); });
