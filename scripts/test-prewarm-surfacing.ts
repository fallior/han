/**
 * test-prewarm-surfacing.ts — the DEC-103 §3 detector-rule probe (MNT-055 P0-final).
 *
 * Fires the REAL surfacing side-timer (`startPrewarmSurfacingTimer`) with an artificially tiny
 * threshold and watches it alert through the REAL ntfy wire — proving the alert fires rather than
 * assuming it (Jim's audit gate: "probe it with an artificially slow feed, not assumed"). The
 * probe threshold (0.05 min = 3s) stands in for the slow feed; the code path from timer → message
 * format → postNtfyAlert → curl → ntfy.sh is the production path, byte-identical.
 *
 * COST + fail-state (DEC-103 §2): posts TWO real notifications to Darron's ntfy topic (the
 * threshold alert + one doubling re-alert), clearly labelled with the probe session name — then
 * cancels, proving the cancel path too. Worst case: two phone glances. It launches NOTHING (no
 * stem, no claude); the timer is the unit under test.
 *
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-prewarm-surfacing.ts
 */
import { startPrewarmSurfacingTimer } from '../src/server/lib/tmux-dispatcher';

async function main(): Promise<void> {
    const PROBE_MINS = 0.05; // 3s — the artificially-slow-feed stand-in
    console.log(`[probe] arming the surfacing timer at ${PROBE_MINS * 60}s (expect alert ~3s, doubling re-alert ~6s, then cancel)`);
    const cancel = startPrewarmSurfacingTimer('leo', 'surfacing-probe', 'PROBE-no-such-session', PROBE_MINS);
    // Window long enough for the threshold alert (3s) + the doubling re-alert (6s), then cancel —
    // a third alert (12s) must NOT arrive after cancel.
    await new Promise((r) => setTimeout(r, 8_000));
    cancel();
    console.log('[probe] cancelled at 8s — watch the console above for TWO "surfacing alert posted" lines,');
    console.log('[probe] the phone for two "Pre-warm running long (DEC-103 surfacing)" notifications,');
    console.log('[probe] and confirm NO third alert appears after this line (the cancel path).');
    await new Promise((r) => setTimeout(r, 7_000)); // would-be third-alert window (12s mark)
    console.log('[probe] done — if no third alert printed above, cancel held.');
}

main().catch((e) => { console.error('[probe]', e); process.exit(1); });
