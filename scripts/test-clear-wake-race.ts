/**
 * P1 deterministic repro — the clear↔wake race (C4 gate, S196).
 *
 * The bug: `ensureSurfaceSession` (the wake) runs OUTSIDE the per-slug FIFO, so it can
 * run concurrently with an in-flight `clearSession` (the ctx-pressure / reconcile clear)
 * on the SAME session. While the clear has set ready=false and is mid `/pfc→/clear→
 * welcome-back`, the concurrent wake sees `!ready`, re-adopts, and `spawnAgentSession`
 * REPLACES the session object in the registry — so the clear finalises an orphaned object
 * and the welcome-back / ready-sentinel ownership is lost (→ the 20-min wedge we saw on
 * leo @13:03 and jim @21:38).
 *
 * This repro drives the REAL clearSession + ensureSurfaceSession concurrently, with the IO
 * seamed (no real spoke), and detects the overlap as **session-object divergence**: the
 * registry's session after the race must be the SAME object the clear finalised. WITHOUT the
 * fix the wake re-creates it (divergence = RACE). WITH the fix (wake+clear serialised on the
 * per-slug lock) the wake queues behind the clear → no re-create → no divergence.
 *
 * Deterministic: seamed sleeps yield instantly; the sentinel is written by the harness to
 * release both waits at a controlled point. Exit 0 = serialised (fixed); exit 3 = race
 * reproduced (unfixed). Run: npx tsx scripts/test-clear-wake-race.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'clearwake-'));
process.env.HAN_HEALTH_DIR = TMP;
process.env.HAN_PIPES_DIR = path.join(TMP, 'pipes');

const SLUG = 'reproslug';
const SURFACE = 'human-response';
const KEY = `${SLUG}/${SURFACE}`;
const TMUX = `${SURFACE}-${SLUG}`;
const readyPath = path.join(TMP, `${SLUG}-${SURFACE}-ready`);

function writeSentinel(): void { fs.writeFileSync(readyPath, String(Date.now())); }

async function main(): Promise<void> {
    const d = await import('../src/server/lib/tmux-dispatcher');

    const sent: string[] = [];
    d.__setTestHooks({
        sendLine: (_s, line) => sent.push(line),     // record, no real tmux
        sleep: () => new Promise((r) => setTimeout(r, 1)), // ~instant, but yields the MACRO-
                                                           // task queue so the release timer fires
                                                           // (a microtask would starve setTimeout)
        tmuxSessionExists: () => true,               // session "exists" (no cold launch)
    });

    // Setup: register a ready session via the real ensureSurfaceSession (sets `adopted`).
    writeSentinel();
    await d.ensureSurfaceSession(SLUG, SURFACE, { ladder: [], welcomeBack: 'welcome back' });
    const before = d._sessionsForTest().get(KEY);
    if (!before) throw new Error('setup failed: no session registered');

    // ── The race: a clearSession in-flight + a concurrent ensureSurfaceSession ──
    // Release both waitForReady()s shortly after they start (a fresh, newer sentinel).
    const release = setTimeout(writeSentinel, 60);

    const clearP = d.clearSession(SLUG, SURFACE, { welcomeBack: 'welcome back' });
    // start the wake a microtask later, so clearSession has already set ready=false
    const wakeP = Promise.resolve().then(() =>
        d.ensureSurfaceSession(SLUG, SURFACE, { ladder: [], welcomeBack: 'welcome back' }),
    );
    await Promise.allSettled([clearP, wakeP]);
    clearTimeout(release);

    const after = d._sessionsForTest().get(KEY);
    const diverged = after !== before;   // a new object ⇒ the wake re-created it mid-clear

    console.log(`\n[repro] sendLine sequence: ${JSON.stringify(sent)}`);
    console.log(`[repro] session object after race ${diverged ? 'DIVERGED (new object)' : 'unchanged'}`);

    if (diverged) {
        console.log('\n❌ RACE REPRODUCED — ensureSurfaceSession re-created the session while');
        console.log('   clearSession was in-flight (ready=false). The clear finalised an orphaned');
        console.log('   object; the registry holds the wake\'s object. Wake + clear are NOT');
        console.log('   mutually excluded → the welcome-back/ready ownership is lost (the wedge).');
        process.exit(3);
    }
    console.log('\n✅ SERIALISED — the wake did not run concurrently with the clear (no divergence).');
    process.exit(0);
}

main().catch((e) => { console.error('[repro] harness error:', e); process.exit(2); });
