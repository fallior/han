/**
 * W1 deterministic repro — clearSession must NOT send `/pfc` to non-`session` (diary-sink) spokes
 * (C4 root cure, S197). And W2 — welcome-back waits for the ready chrome (awaitReadyChrome).
 *
 * C4 (Jim's root): `/pfc` is not surface-gated (skill reads $AGENT_SLUG), and clearSession sent it
 * unconditionally → a dispatched-responder spoke ran the heavy interactive memory ritual → hung →
 * needs-reconcile → another `/pfc` → self-sustaining wedge loop. W1 gates `/pfc` to `surface==='session'`.
 *
 * This drives the REAL clearSession for two surfaces with the IO seamed (no real spoke):
 *   - surface 'human-response' (diary-sink) → sendLine sequence MUST be ['/clear','welcome back…'] (NO /pfc).
 *   - surface 'session' (interactive)       → sequence MUST be ['/pfc','/clear','welcome back…'].
 * capturePaneTail is seamed to the ready chrome so W2's awaitReadyChrome returns; the harness writes
 * a fresh ready-sentinel to release waitForReady. Exit 0 = gate correct; exit 3 = wrong. Deterministic.
 * Run: npx tsx scripts/test-clear-pfc-gate.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pfcgate-'));
process.env.HAN_HEALTH_DIR = TMP;
process.env.HAN_PIPES_DIR = path.join(TMP, 'pipes');

const SLUG = 'reproslug';
const READY_CHROME = '❯  shortcuts · bypass permissions on';

async function main(): Promise<void> {
    const d = await import('../src/server/lib/tmux-dispatcher');
    const sent: string[] = [];
    d.__setTestHooks({
        sendLine: (_s, line) => sent.push(line),
        sleep: () => new Promise((r) => setTimeout(r, 1)),
        tmuxSessionExists: () => true,                 // session "exists" → no coldLaunch/awaitChromeOrDescend
        capturePaneTail: () => READY_CHROME,           // W2: ready chrome present → awaitReadyChrome returns
    });

    const readyPath = (surface: string): string => path.join(TMP, `${SLUG}-${surface}-ready`);
    const writeSentinel = (surface: string): void => fs.writeFileSync(readyPath(surface), String(Date.now()));

    async function recycleSeq(surface: string): Promise<string[]> {
        writeSentinel(surface);
        await d.ensureSurfaceSession(SLUG, surface, { ladder: [], welcomeBack: `welcome back ${surface}` });
        sent.length = 0; // ignore the wake's sends; record only the clear sequence
        const release = setTimeout(() => writeSentinel(surface), 30); // newer sentinel releases waitForReady
        await d.clearSession(SLUG, surface, { welcomeBack: `welcome back ${surface}` });
        clearTimeout(release);
        return [...sent];
    }

    const human = await recycleSeq('human-response');
    const session = await recycleSeq('session');
    d.__setTestHooks(null);

    const humanHasPfc = human.some((l) => l.trim() === '/pfc');
    const sessionHasPfc = session.some((l) => l.trim() === '/pfc');
    const humanWelcomed = human.some((l) => l.startsWith('welcome back'));
    const sessionWelcomed = session.some((l) => l.startsWith('welcome back'));

    console.log(`\n[repro] human-response clear sequence: ${JSON.stringify(human)}`);
    console.log(`[repro] session        clear sequence: ${JSON.stringify(session)}`);

    const ok = !humanHasPfc && humanWelcomed && sessionHasPfc && sessionWelcomed;
    if (ok) {
        console.log('\n✅ W1 GATE CORRECT — /pfc sent ONLY for the session surface; responder recycles /clear→welcome-back (no ritual). W2: welcome-back sent after the ready chrome.');
        process.exit(0);
    }
    console.log(`\n❌ W1 GATE WRONG — humanHasPfc=${humanHasPfc} (want false), sessionHasPfc=${sessionHasPfc} (want true), welcomed h/s=${humanWelcomed}/${sessionWelcomed}.`);
    process.exit(3);
}

main().catch((e) => { console.error('[repro] harness error:', e); process.exit(2); });
