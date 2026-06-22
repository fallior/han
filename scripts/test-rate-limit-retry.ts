/**
 * P7 deterministic repro — autonomous rate-limit recovery (C4 gate, S197).
 *
 * The gap: `sendTransactionPrompt`'s capture-wait was rate-limit-BLIND — it only polled for the
 * diary capture. A transient mid-turn Anthropic rate limit produces no capture, so the wait
 * burned the full 12-min timeout → `needs-reconcile` → a wasteful full reconstitution, and the
 * turn was LOST (and could re-hit the limit at reconcile → amplify).
 *
 * P7 makes the capture-wait rate-limit-aware: detect RATE_LIMITED_RE in the pane → bounded
 * exponential backoff → re-submit the turn (the "autonomous up-arrow") → collect the capture
 * once the throttle clears. Retries exhausted (sustained limit) → RateLimitedError (fail-safe).
 *
 * Both ways, ONE scenario (Jim's C4 bar): the pane shows the rate-limit chrome until the turn is
 * RE-SUBMITTED, and the capture appears only after a re-submit.
 *  - RED (pre-P7 = a bare rate-limit-blind capture poll, reconstructed verbatim from the old
 *    code): never re-submits → the capture never appears → DispatchTimeout (the turn is lost).
 *  - GREEN (P7 = the REAL exported `waitForCaptureWithRateLimitRetry`): detects the limit, backs
 *    off, re-submits, collects the capture → returns it.
 * Exit 0 iff RED-without-fix AND GREEN-with-fix both hold; else exit 3. Deterministic via seamed
 * capturePaneTail + instant sleeps. Run: npx tsx scripts/test-rate-limit-retry.ts
 *
 * NOTE (verify-don't-claim): the scenario MODELS "a rate-limited turn produces no capture until
 * the throttle clears AND the turn is re-submitted." Whether the live Claude Code TUI needs a
 * re-submit or auto-retries when the limit lifts is the belt-and-braces confirmation item (needs
 * a real rate limit). The repro proves the detect → backoff → re-submit → collect LOGIC.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ratelimit-'));
process.env.HAN_HEALTH_DIR = TMP;
process.env.HAN_PIPES_DIR = path.join(TMP, 'pipes');

const TMUX = 'human-response-reproslug';
const RATE_LIMIT_CHROME = 'Claude usage limit reached — temporarily limiting requests. Retry shortly.';
const NORMAL_CHROME = '❯ composing…';

/** One scenario, reusable by both paths: the pane is rate-limited until the turn is re-submitted;
 *  the (fake) capture appears only AFTER a re-submit. */
function makeScenario() {
    let resubmits = 0;
    return {
        onResubmit: () => { resubmits += 1; },
        capturePaneTail: () => (resubmits === 0 ? RATE_LIMIT_CHROME : NORMAL_CHROME),
        captureReady: () => (resubmits >= 1 ? ({ txnId: 'txn-repro', mode: 'curated' } as unknown) : null),
        get resubmits() { return resubmits; },
    };
}

/** The PRE-P7 behaviour, reconstructed verbatim: a plain capture poll, rate-limit-blind. */
async function barePoll(captureReady: () => unknown, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const v = captureReady();
        if (v) return v;
        if (Date.now() > deadline) throw new Error('DispatchTimeout (bare poll, rate-limit-blind)');
        await sleep(5);
    }
}

async function main(): Promise<void> {
    const d = await import('../src/server/lib/tmux-dispatcher');
    const instantSleep = (_ms: number): Promise<void> => new Promise((r) => setTimeout(r, 1));

    // ── RED: the pre-P7 bare poll loses the rate-limited turn ──
    const redScene = makeScenario();
    let redLost = false;
    try {
        await barePoll(redScene.captureReady, 200, instantSleep);
    } catch {
        redLost = redScene.resubmits === 0; // never re-submitted → capture never appeared → turn lost
    }

    // ── GREEN: the real P7 helper detects → backs off → re-submits → collects ──
    const greenScene = makeScenario();
    d.__setTestHooks({ sleep: instantSleep, capturePaneTail: () => greenScene.capturePaneTail() });
    let greenCap: unknown = null;
    let greenErr: Error | null = null;
    try {
        greenCap = await d.waitForCaptureWithRateLimitRetry(
            greenScene.captureReady, TMUX, greenScene.onResubmit, 60_000,
        );
    } catch (e) { greenErr = e as Error; }
    d.__setTestHooks(null);

    console.log(`\n[repro] RED  (pre-P7 bare poll): ${redLost ? 'turn LOST (no re-submit → capture never appeared)' : 'unexpectedly recovered'}`);
    console.log(`[repro] GREEN (P7 helper): re-submits=${greenScene.resubmits}, capture=${greenCap ? 'COLLECTED' : 'none'}${greenErr ? `, err=${greenErr.message}` : ''}`);

    const greenOk = !!greenCap && greenScene.resubmits >= 1 && !greenErr;

    // ── SUSTAINED: a limit that never clears must FAIL SAFE (bounded), never hang (S74) ──
    let sustainedResubmits = 0;
    d.__setTestHooks({ sleep: instantSleep, capturePaneTail: () => RATE_LIMIT_CHROME }); // always rate-limited
    let sustainedErr: Error | null = null;
    try {
        await d.waitForCaptureWithRateLimitRetry(
            () => null, TMUX, () => { sustainedResubmits += 1; }, 60_000,
        );
    } catch (e) { sustainedErr = e as Error; }
    d.__setTestHooks(null);
    const failedSafe = sustainedErr instanceof d.RateLimitedError && sustainedResubmits === 4; // RATE_LIMIT_MAX_RETRIES
    console.log(`[repro] SUSTAINED (limit never clears): ${failedSafe ? `FAIL-SAFE after ${sustainedResubmits} bounded retries → RateLimitedError (no hang, no token black hole)` : `UNEXPECTED (err=${sustainedErr?.constructor?.name ?? 'none'}, retries=${sustainedResubmits})`}`);

    if (redLost && greenOk && failedSafe) {
        console.log('\n✅ C4 SATISFIED — pre-P7 loses the rate-limited turn; P7 recovers a transient limit (detect → backoff → re-submit → collect) and FAILS SAFE on a sustained one (bounded retries → RateLimitedError).');
        process.exit(0);
    }
    console.log('\n❌ C4 NOT satisfied (RED, GREEN, or SUSTAINED did not hold as expected).');
    process.exit(3);
}

main().catch((e) => { console.error('[repro] harness error:', e); process.exit(2); });
