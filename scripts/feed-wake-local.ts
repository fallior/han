/**
 * feed-wake-local.ts <slug> <tmux-pane-target>
 *
 * The interactive seat's LOCAL wake feeder (P2.4a). The `/wake` skill spawns this **detached**
 * (`setsid`) so it SURVIVES the skill's turn ending (Jim catch #1), then it WAITS for the seat to go
 * idle — the skill turn fully ended, no processing chrome (Jim catch #2, the reentrancy cure) — and
 * aims the SHARED `feedWakeSteps` at the seat's OWN pane (`$TMUX_PANE`, Jim catch #3). Same proven
 * (a)+(c)+(b) feeder, same ack-before-next, same `isAgentC0` gradient ack, plus the session-only
 * terminal `compose-greeting` step. No server involvement — the seat feeds ITSELF; the boundary the
 * human launcher keeps (the interactive seat is the human's) stays clean.
 *
 *   spawned by ~/.claude/skills/wake — never run by hand on a live working session (it drives the wake)
 */
import { feedWakeSteps, wakeStepsFor, capturePaneTail, PROCESSING_CHROME_RE } from '../src/server/lib/tmux-dispatcher';

const [slug, pane] = process.argv.slice(2);
if (!slug || !pane) {
    console.error('usage: feed-wake-local.ts <slug> <tmux-pane-target>  (spawned by the /wake skill)');
    process.exit(2);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Don't send step-1 until the seat is idle (the skill's spawning turn has fully ended — no
 * processing chrome) for two consecutive ticks; else the first send interleaves with the skill
 * turn's own output. Reuses the same `PROCESSING_CHROME_RE` the (b) submitted-latch uses.
 */
async function waitForIdle(target: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let idleStreak = 0;
    while (Date.now() < deadline) {
        let busy = true;
        try { busy = PROCESSING_CHROME_RE.test(capturePaneTail(target)); } catch { busy = false; }
        if (!busy) { if (++idleStreak >= 2) return; } else { idleStreak = 0; }
        await sleep(750);
    }
    // timeout → proceed anyway (fail-toward-feeding: a stuck-busy seat is better fed than left cold)
}

async function main(): Promise<void> {
    await waitForIdle(pane);
    await feedWakeSteps(slug, 'session', wakeStepsFor(slug, 'session'), { tmuxTarget: pane });
}

main().catch((e) => { console.error('[feed-wake-local]', e && (e as Error).message ? (e as Error).message : e); process.exit(1); });
