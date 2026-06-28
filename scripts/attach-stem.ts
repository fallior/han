/**
 * attach-stem.ts <slug> — the R1 re-sleeve attach command (DEC-099 stem-sleeve, #91 attach-flush).
 *
 * Re-sleeves a human onto a pre-warmed stem instead of cold-waking: find the warm stem, inject the
 * immediate context that landed while it idled (the #91 attach-flush), compose a CURRENT greeting,
 * then hand the terminal over. The expensive L1 was pre-paid in the background → the human lands in
 * a warm, current Leo in seconds, not the ~minute cold wake.
 *
 * Flow (F1/F2/F4ii/F5, Jim's plan-audit GREEN):
 *   1. read stem-<slug>.json; VALID = present + `tmux has-session` + warm_at fresh (gross-stale →
 *      cold-launch fallback). [F1 — NOT the retired recentC0Ids; wall-clock freshness.]
 *   2. flush = deltaSinceCursor(slug, reg.wm_len)  [#91, F2]  + a "newer c0 rolled" note  [F5].
 *   3. feed [flush-step (if any), GREETING_STEP] to the stem via the proven feeder — WHILE the stem
 *      still has 0 clients, so the memory-guard EXEMPTS these reconstitution turns (Jim's guard
 *      catch, handled by SEQUENCING, not the slug-shared wake_grace which would collide with a live
 *      session). The greeting composes FROM the flushed (current) self, never the stale snapshot.
 *   4. wait for the greeting to finish composing (still 0 clients = exempt).
 *   5. `tmux attach-session` — hand the terminal to the human, who lands on the current greeting.
 *
 * R1 scope: the dedicated path (F4ii) — proves the re-sleeve before folding into hanleo (F4i). The
 * cold-launch fallback here is a message+exit (manual); the seamless attach-or-cold-launch wiring
 * into hanleo is the post-R1 follow-on. Retire/replenish/pool = R3; transcript-tail = F3 follow-on.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
    feedWakeSteps, GREETING_STEP, deltaSinceCursor,
    capturePaneTail, PROCESSING_CHROME_RE, type WakeStep,
} from '../src/server/lib/tmux-dispatcher';
import { mostRecentC0Id } from '../src/server/lib/memory-gradient';

const slug = process.argv[2];
if (!slug) {
    console.error('usage: attach-stem.ts <slug>   (R1 re-sleeve attach — DEC-099)');
    process.exit(2);
}

const HOME = process.env.HOME!;
const REGISTRY = `${HOME}/.han/health/stem-${slug}.json`;
const MAX_STEM_AGE_MS = 6 * 60 * 60_000; // gross-stale threshold (R1 local const; → registry leaf at R3, no-hidden-globals)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait for the stem to go idle (greeting composed) — no processing chrome for 2 consecutive ticks.
 *  Runs while the stem has 0 clients, so these turns are guard-exempt; we attach only once idle. */
async function waitForIdle(target: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let idle = 0;
    while (Date.now() < deadline) {
        let busy = true;
        try { busy = PROCESSING_CHROME_RE.test(capturePaneTail(target)); } catch { busy = false; }
        if (!busy) { if (++idle >= 2) return; } else { idle = 0; }
        await sleep(750);
    }
    // timeout → attach anyway (the greeting may be slow; better to hand over than hang)
}

function coldFallback(reason: string): never {
    console.error(`[attach-stem] no warm stem (${reason}) — cold-start instead:  hanleo`);
    process.exit(1); // R1: manual fallback. F4(i) folds attach-or-cold-launch into hanleo post-R1.
}

async function main(): Promise<void> {
    // 1) F1 — warm-stem validity (registry + live session + wall-clock freshness; fails to cold)
    let reg: { tmux_session?: string; wm_len?: number; c0?: string; warm_at?: string };
    try { reg = JSON.parse(readFileSync(REGISTRY, 'utf-8')); }
    catch { return coldFallback('no stem registry'); }

    const session = reg.tmux_session;
    if (!session) return coldFallback('registry has no tmux_session');
    try { execFileSync('tmux', ['has-session', '-t', session], { stdio: 'ignore' }); }
    catch { return coldFallback(`tmux session '${session}' is gone`); }
    const ageMs = reg.warm_at ? Date.now() - Date.parse(reg.warm_at) : Infinity;
    if (!(ageMs < MAX_STEM_AGE_MS)) return coldFallback(`stem is gross-stale (${Math.round(ageMs / 60000)}min old)`);

    // 2) F2 — the #91 attach-flush delta (what landed while it idled) + F5 — a "newer c0" note
    const cursor = typeof reg.wm_len === 'number' ? reg.wm_len : 0;
    const { block } = await deltaSinceCursor(slug, cursor);
    const newest = mostRecentC0Id(slug);
    const c0Note = (newest && reg.c0 && newest !== reg.c0)
        ? `\n> Note: a newer c0 (\`${newest}\`) has rolled since you were pre-warmed — your loaded gradient is one behind; the delta above carries its content (a full catch-up is a later concern).\n`
        : '';
    const flush = (block + c0Note).trim();

    // 3) feed [flush?, greeting] while clients=0 → guard EXEMPTS these turns (sequencing, not wake_grace)
    const steps: WakeStep[] = [];
    if (flush) {
        steps.push({
            id: 'attach-flush',
            ack: { kind: 'marker' },
            prompt: `[Re-sleeve — immediate context. A human is attaching to you (a pre-warmed stem). Ingest what changed while you idled, so your greeting is CURRENT:]\n${flush}`,
        });
    }
    steps.push(GREETING_STEP); // terminal — composes the greeting from the now-flushed (current) self
    console.log(`[attach-stem] re-sleeving onto ${session} (flush: ${flush ? `${flush.length} chars` : 'none — nothing changed since pre-warm'})`);
    await feedWakeSteps(slug, 'session', steps, { tmuxTarget: session });

    // 4) wait for the greeting to finish composing — still 0 clients (exempt)
    await waitForIdle(session);

    // 5) hand the terminal to the human — they land on the current greeting (clients 0→1: guard flips
    //    to GUARDED for the now-live session, AFTER the reconstitution turns already completed exempt)
    console.log(`[attach-stem] attaching your terminal to ${session} …`);
    execFileSync('tmux', ['attach-session', '-t', session], { stdio: 'inherit' });
}

main().catch((e) => { console.error('[attach-stem]', e && (e as Error).message ? (e as Error).message : e); process.exit(1); });
