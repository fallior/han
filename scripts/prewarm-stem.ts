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
import { feedWakeSteps, wakeStepsFor, awaitChromeOrDescend, observeActiveModel, currentWmCharLen, phaseWakeSteps, writeWakeManifest, getContextPctForSession, PHASE1_WAKE_IDS, type WakeManifestEntry, type WakeStep } from '../src/server/lib/tmux-dispatcher';
import { stemWarmLadder, swapPrefixFor, stemTwoPhaseWakeFor, stemPhase1CeilingPctFor } from '../src/server/lib/garden-manifest';
import { writeSleeveState } from '../src/server/lib/sleeve-state';
import { gradientConfigForAgent } from '../src/server/lib/agent-registry';
import { existsSync, statSync } from 'node:fs';

const slug = process.argv[2];
if (!slug) {
    console.error('usage: prewarm-stem.ts <slug> [--pool --session <name>]   (DEC-099 stem-sleeve)');
    process.exit(2);
}

// R3a.1c-ii POOL MODE (`--pool --session <name>`): warm one of N pool stems under a DISTINCT tmux
// session (the dispatcher's pool-manager owns the session name + the pool registry — single-writer,
// Jim's cond-3). In pool mode this script LAUNCHES + WARMS + EMITS the stem's metadata JSON to
// stdout (marker-delimited) and does NOT write `pool-<slug>.json` cross-process; the dispatcher
// (`prewarmAndRegister`) parses the metadata + `upsertStem`s it. Default (no flags) = R1: warm the
// single `session-<slug>` stem + write `stem-<slug>.json` (the attach source-of-truth), unchanged.
const POOL = process.argv.includes('--pool');
const sessionArgIdx = process.argv.indexOf('--session');
const SESSION_OVERRIDE = sessionArgIdx >= 0 ? process.argv[sessionArgIdx + 1] : '';
if (POOL && !SESSION_OVERRIDE) {
    console.error('prewarm-stem: --pool requires --session <name> (the dispatcher assigns the unique stem session)');
    process.exit(2);
}
// PR-C2 (native-per-surface pools): pool stems are born AS their surface. --surface names it
// (default 'session' — R1's attach-stem path unchanged).
const surfaceArgIdx = process.argv.indexOf('--surface');
const SURFACE = surfaceArgIdx >= 0 ? (process.argv[surfaceArgIdx + 1] || 'session') : 'session';
const tmuxSession = POOL ? SESSION_OVERRIDE : `${SURFACE}-${slug}`; // pool: the assigned unique name
const HOME = process.env.HOME!;
const HEALTH = `${HOME}/.han/health`;
// The readiness sentinel. PR-C2: pool stems get a PER-STEM sentinel (`<slug>-<stem-session>-ready`)
// via the launch-time sleeve-state below — so a pre-warm can NEVER touch the FLOOR's per-surface
// sentinel (`<slug>-<surface>-ready`, the file the floor cold-launch's waitForReady keys on —
// Jim's stem-vs-floor race, closed here) and concurrent pre-warms can't collide (B4 retired).
// R1 (non-pool) keeps the session sentinel unchanged.
const SENTINEL = POOL ? `${HEALTH}/${slug}-${SESSION_OVERRIDE}-ready` : `${HEALTH}/${slug}-${SURFACE}-ready`;
const REGISTRY = `${HEALTH}/stem-${slug}.json`;        // R1 single-stem registry (attach source-of-truth)

const here = path.dirname(fileURLToPath(import.meta.url));
const LAUNCH = path.join(here, 'launch-tmux-surface.sh');

async function main(): Promise<void> {
    // Clear any stale `<slug>-session-ready` BEFORE launch — else the feeder's c0-ack (which accepts
    // any valid c0 of the agent, not a fresh one) could pass off a leftover (e.g. a live `han` seat's
    // sentinel) without the STEM having actually written its own. Clearing makes the ack prove the
    // stem's fresh traversal-to-EOF. (The clobber of a live seat's sentinel is benign — fork-3:
    // the stem-registry is the attach source-of-truth; pool-of-1 replaces, doesn't parallel.)
    try { unlinkSync(SENTINEL); } catch { /* absent = fine */ }

    // 1) launch the stem via the shared contract (--stem bypasses only the launchable-surface check).
    //    Pool mode passes --session-name so the stem gets its own distinct tmux session.
    // MNT-055 P1 (the root of the Fable leak): LAUNCH on the warm-map head. Without --model,
    // launch-tmux-surface.sh takes the SURFACE's serve ladder (launch-tmux-surface.sh:103) — so when
    // human-response's serve model flipped to Fable, every pre-warm fed its ENTIRE wake on Fable.
    // stemWarmLadder governs all three warm phases now: launch (here), chrome-descend (step 2), and
    // the DEC-101 cast-at-checkout swaps to the serve model only when a real dispatch pays for it.
    // Applies to BOTH modes per DEC-101 ("stems wake on sonnet"): an R1 attach-stem also warms on
    // the warm-map — disclosed: R1 has no cast-at-attach, so an attached human converses on the warm
    // model until a /model swap (acceptable: R1 is the dormant single-stem path; named for the audit).
    const warmModel = stemWarmLadder(slug, SURFACE)[0];
    const launchArgs = POOL ? [LAUNCH, slug, SURFACE, '--stem', '--model', warmModel, '--session-name', tmuxSession]
                            : [LAUNCH, slug, SURFACE, '--stem', '--model', warmModel];
    console.log(`[prewarm] launching stem '${tmuxSession}' via launch-tmux-surface.sh --stem …`);
    execFileSync('bash', launchArgs, { stdio: 'inherit' });

    if (POOL) {
        // PR-C2 per-stem sentinel keying: the spoke's wake step-10 resolves its sentinel name via
        // the sleeve-state surface (the P-R2.2c resolver: sleeve.surface || $AGENT_SURFACE) — so
        // writing sleeve-state{surface: <stem-session>} BEFORE the wake is fed makes the stem write
        // `<slug>-<stem-session>-ready`, never the floor's `<slug>-<surface>-ready`. swapPrefix
        // stays the REAL surface's (the stem behaves as its surface everywhere except the sentinel
        // name). The wake only runs when fed, so this write always precedes step-10.
        writeSleeveState(tmuxSession, slug, tmuxSession, swapPrefixFor(slug, SURFACE));
    }

    // 2) wait for claude chrome (bash→claude ready; auto-descends the model if the launch model is
    //    dead) — the failover ladder derived the same single-source way the dispatcher does
    // DEC-101 warm-map (MNT-054): warm on the sonnet-headed warm ladder, NOT the surface's serve
    // ladder — the serve model is cast on at checkout (dispatchToPooledStem). Warming on the serve
    // ladder is what let a depleted Fable hang the prewarm (MNT-42); the warm-map never touches Fable.
    await awaitChromeOrDescend(slug, SURFACE, tmuxSession, stemWarmLadder(slug, SURFACE));

    // 3) feed the wake, GREET-LESS. Phase A (S1b, pool mode + flag on): PHASE 1 ONLY — the stable
    //    self (integrity → identity → gradient → felt) on the warm model, ceiling-gated per step;
    //    the volatile tail + deltas are fed at checkout post-cast (completeTwoPhaseWake). Flag off
    //    (or non-pool): the WHOLE self, byte-identical to the pre-Phase-A behaviour.
    const twoPhase = POOL && stemTwoPhaseWakeFor(slug, SURFACE);
    if (twoPhase) {
        const { phase1 } = phaseWakeSteps();
        const ceiling = stemPhase1CeilingPctFor(slug, SURFACE);
        const reg = gradientConfigForAgent(slug);
        const memDir = reg.memoryDir;
        const feltPath = path.join(memDir, 'felt-moments.md');
        const preStat = (p: string): string => { try { return String(statSync(p).size); } catch { return '0'; } };
        const feltPreFeedSize = preStat(feltPath); // Q3 (a) degrade: recorded BEFORE the step is fed — errs toward re-delivery
        let feltCursor: string | null = null;
        const result = await feedWakeSteps(slug, SURFACE, phase1, {
            tmuxTarget: tmuxSession,
            sentinelKey: tmuxSession,
            // M1 (Jim's must-fix): a NULL ctx read is fail-safe = ceiling-reached — the sidecar
            // not being wired must migrate steps to phase 2, never feed blind past the window.
            beforeStep: (step: WakeStep) => {
                if (step.id === 'integrity' || step.id === 'identity') return 'feed'; // the floor: identity always phase-1 (tiny)
                const pct = getContextPctForSession(slug, SURFACE, tmuxSession);
                return (pct === null || pct >= ceiling) ? 'defer' : 'feed';
            },
            cursorAskIds: ['felt'],
            onAck: (step: WakeStep, cursor: string | null) => { if (step.id === 'felt') feltCursor = cursor; },
        });
        // S1c — the wake manifest: what phase 1 actually loaded, with cursors the checkout reads.
        const identityFiles = [
            path.join(memDir, 'identity.md'), path.join(memDir, 'patterns.md'),
            existsSync(path.join(memDir, 'self-reflections-curated.md'))
                ? path.join(memDir, 'self-reflections-curated.md') : path.join(memDir, 'self-reflection.md'),
            path.join(reg.fractalDir, 'aphorisms.md'),
        ];
        const nowIso = new Date().toISOString();
        const entries: WakeManifestEntry[] = [];
        for (const id of PHASE1_WAKE_IDS) {
            if (result.deferred.includes(id)) { entries.push({ store: id, phase: 2, cursor: null, loaded_at: nowIso }); continue; }
            if (id === 'identity') for (const f of identityFiles) entries.push({ store: f, phase: 1, cursor: { kind: 'mtime', value: preStat(f) === '0' ? '0' : String(statSync(f).mtimeMs) }, loaded_at: nowIso });
            else if (id === 'gradient') entries.push({ store: 'gradient', phase: 1, cursor: { kind: 'c0', value: (() => { try { return readFileSync(SENTINEL, 'utf8').trim(); } catch { return 'none'; } })() }, loaded_at: nowIso });
            else if (id === 'felt') entries.push({ store: feltPath, phase: 1, cursor: { kind: 'offset', value: feltCursor ?? feltPreFeedSize }, loaded_at: nowIso });
            // 'integrity' carries no store — a gate, not a load.
        }
        writeWakeManifest({ stem_session: tmuxSession, slug, surface: SURFACE, phase1_completed_at: nowIso, phase2_completed_at: null, entries });
        if (result.deferred.length > 0) console.log(`[prewarm] two-phase: ceiling deferred ${result.deferred.join(', ')} to phase 2 (recorded in the wake manifest)`);
    } else {
        // Flag off / non-pool: the WHOLE self, unchanged — completion = queue-empty = warm; the
        // gradient step traverses to GRADIENT-EOF and writes the reached c0 to the sentinel.
        await feedWakeSteps(slug, SURFACE, wakeStepsFor(slug, SURFACE, { greet: false }), {
            tmuxTarget: tmuxSession,
            // PR-C2: the c0-ack reads the stem's PER-STEM sentinel in pool mode (see SENTINEL above).
            ...(POOL ? { sentinelKey: tmuxSession } : {}),
        });
    }

    // 4) the warm stem's metadata. `wm_cursor` is the working-memory.md CHAR length at pre-warm (the
    //    #91 freshen cursor — deltaSinceCursor compares content.length, so CHARS not statSync bytes).
    //    Phase A: under two-phase, a ceiling/M1-deferred gradient step leaves NO per-stem sentinel —
    //    the c0 arrives at checkout (the deferred step re-fed by completeTwoPhaseWake). `deferred`
    //    is legible in logs; PoolStem.c0 has no functional consumer (log-only, verified 2026-08-11).
    const c0 = (() => { try { return readFileSync(SENTINEL, 'utf8').trim(); } catch { if (twoPhase) return 'deferred'; throw new Error(`prewarm: sentinel ${SENTINEL} unreadable after a full wake feed`); } })();
    const nowIso = new Date().toISOString();
    const model = observeActiveModel(slug, SURFACE, tmuxSession); // C3 model-stamp fix: read the STEM's own pane (the `${surface}-${slug}` default was a wrong/absent pane in pool mode → the model:null bug)
    const wmCursor = currentWmCharLen(slug);

    if (POOL) {
        // Pool mode: EMIT the stem metadata for the dispatcher to `upsertStem` (single-writer,
        // cond-3). Marker-delimited so the dispatcher parses it cleanly out of the launch-log noise.
        // Shape = the PoolStem the dispatcher's stem-pool registry expects (state assigned by the
        // dispatcher on upsert). Does NOT write pool-<slug>.json (the pre-warmer never writes it).
        const meta = {
            stem_id: tmuxSession,      // F-b: the per-stem key IS the tmux session name
            tmux_session: tmuxSession,
            c0,
            wm_cursor: wmCursor,
            cursor_set_ts: nowIso,
            model,
            warm_at: nowIso,
        };
        console.log(`[prewarm] pool stem WARM: ${tmuxSession}  c0=${c0}  (emitting metadata for the dispatcher)`);
        // The parse marker the dispatcher greps for.
        process.stdout.write(`\nPREWARM_STEM_META ${JSON.stringify(meta)}\n`);
        return;
    }

    // R1 mode (unchanged): write the single-stem registry — the attach source-of-truth.
    const registry = { slug, surface: SURFACE, tmux_session: tmuxSession, c0, wm_len: wmCursor, model, warm_at: nowIso };
    writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n');
    console.log(`[prewarm] stem WARM: ${tmuxSession}  c0=${c0}  → ${REGISTRY}`);
}

main().catch((e) => { console.error('[prewarm-stem]', e && (e as Error).message ? (e as Error).message : e); process.exit(1); });
