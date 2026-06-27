/**
 * Phase-2 P2.1/P2.1b (thread mqun1to5) — proves the wake-feed queue primitive `feedWakeSteps`
 * and the canonical `WAKE_STEPS`:
 *   1. steps fed in ORDER, one at a time;
 *   2. ack-before-next — the next step is NEVER fed until the current step's `STEP-OK <id> <nonce>`
 *      ack appears (the queue IS the gate); the nonce is fresh per feed (P2.1b #1 — a re-fed step
 *      can never match a stale marker);
 *   3. the gradient step's OBJECTIVE ack — marker alone is not enough; the echoed sentinel c0 must
 *      be a real c0 of the agent (isAgentC0, Phase-1 reused);
 *   4. fail-safe — a step that never acks → DispatchTimeoutError (no infinite wait, no work);
 *   5. WAKE_STEPS is the WHOLE wake (felt-moments + WM pair AFTER the gradient), one c0-ack step.
 *
 * Driven entirely by test hooks — no real spoke. Run:
 *   cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-wake-feed-queue.ts
 * EXIT 0 iff every assertion holds.
 */
import * as os from 'os';
import * as path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { feedWakeSteps, WAKE_STEPS, MAX_WAKE_RESUBMITS, __setTestHooks, DispatchTimeoutError, type WakeStep } from '../src/server/lib/tmux-dispatcher';
import { mostRecentC0Id } from '../src/server/lib/memory-gradient';

let failures = 0;
const ok = (c: boolean, m: string) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const SLUG = 'leo', SURFACE = 'wakefeedtest';
const sentinel = path.join(os.homedir(), '.han', 'health', `${SLUG}-${SURFACE}-ready`);
const writeSentinel = (id: string) => writeFileSync(sentinel, id + '\n');
const clearSentinel = () => { try { rmSync(sentinel); } catch { /* none */ } };

// The feeder OWNS the ack instruction now: it appends `... STEP-OK <id> <nonce>` to each step's
// prompt with a fresh nonce. The test parses that off the sent line and echoes it back — exactly
// what a real spoke does (emit the requested marker), so the test mirrors the live protocol.
const parseAck = (line: string): { id: string; nonce: string } | null => {
    const m = line.match(/STEP-OK\s+(\S+)\s+(\S+)\s*$/);
    return m ? { id: m[1], nonce: m[2] } : null;
};

async function main() {
    console.log('[1] steps fed in order + ack-before-next (the queue is the gate), with fresh nonces');
    const steps: WakeStep[] = [
        { id: 'identity', prompt: 'load identity+patterns', ack: { kind: 'marker' } },
        { id: 'wmpair',   prompt: 'load the WM pair whole', ack: { kind: 'marker' } },
        { id: 'felt',     prompt: 'load felt-moments whole', ack: { kind: 'marker' } },
    ];
    const sent: string[] = [];
    const nonceOf: Record<string, string> = {};
    const withheld: Record<string, number> = {};
    let gatingViolation = false;
    __setTestHooks({
        sleep: () => {},
        pressEnter: () => {},
        sendLine: (_s, line) => { const a = parseAck(line); if (a) { sent.push(a.id); nonceOf[a.id] = a.nonce; } },
        capturePaneTail: () => {
            const cur = sent[sent.length - 1];               // the step most recently fed
            withheld[cur] = (withheld[cur] ?? 0) + 1;
            if (withheld[cur] <= 2) {                          // withhold the ack twice → force the feeder to wait
                const idx = steps.findIndex((x) => x.id === cur);
                if (sent.length !== idx + 1) gatingViolation = true; // a later step was fed before this one acked
                return '';                                     // no marker yet
            }
            return `STEP-OK ${cur} ${nonceOf[cur]}`;            // now ack — with the SAME nonce the feeder sent
        },
    });
    await feedWakeSteps(SLUG, SURFACE, steps, { perStepTimeoutMs: 5000 });
    ok(JSON.stringify(sent) === JSON.stringify(['identity', 'wmpair', 'felt']), 'all 3 steps fed in order');
    ok(!gatingViolation, 'ack-before-next held — no step fed while the prior was un-acked');
    ok(new Set(Object.values(nonceOf)).size === 3, 'a distinct fresh nonce per step-feed');

    console.log('[2] a STALE marker (right id, wrong/old nonce) does NOT satisfy');
    let staleThrew = false;
    __setTestHooks({ sleep: () => {}, pressEnter: () => {}, sendLine: () => {}, capturePaneTail: () => 'STEP-OK identity stale-old-nonce' });
    try { await feedWakeSteps(SLUG, SURFACE, [{ id: 'identity', prompt: 'load identity', ack: { kind: 'marker' } }], { perStepTimeoutMs: 300 }); }
    catch (e) { staleThrew = e instanceof DispatchTimeoutError; }
    ok(staleThrew, 'marker with a STALE nonce → not accepted → DispatchTimeoutError (the nonce closes the re-feed window)');

    console.log('[3] the gradient step — marker + an OBJECTIVE real c0 (isAgentC0)');
    const realC0 = mostRecentC0Id('leo');
    ok(!!realC0, 'have a real leo c0 to echo');
    const gradStep: WakeStep[] = [{ id: 'gradient', prompt: 'load the gradient to GRADIENT-EOF', ack: { kind: 'c0' } }];
    let gradNonce = '';
    writeSentinel(realC0!);
    __setTestHooks({ sleep: () => {}, pressEnter: () => {}, sendLine: (_s, line) => { const a = parseAck(line); if (a) gradNonce = a.nonce; }, capturePaneTail: () => `STEP-OK gradient ${gradNonce}` });
    await feedWakeSteps(SLUG, SURFACE, gradStep, { perStepTimeoutMs: 5000 });
    ok(true, 'gradient step accepts: marker (fresh nonce) present AND sentinel carries a real c0');

    writeSentinel('bogus-not-a-real-c0');
    let threwBogus = false;
    __setTestHooks({ sleep: () => {}, pressEnter: () => {}, sendLine: (_s, line) => { const a = parseAck(line); if (a) gradNonce = a.nonce; }, capturePaneTail: () => `STEP-OK gradient ${gradNonce}` });
    try { await feedWakeSteps(SLUG, SURFACE, gradStep, { perStepTimeoutMs: 300 }); }
    catch (e) { threwBogus = e instanceof DispatchTimeoutError; }
    ok(threwBogus, 'gradient step with marker but BOGUS c0 → does NOT ack → DispatchTimeoutError (the objective check bites)');

    console.log('[4] fail-safe — a step that never acks');
    __setTestHooks({ sleep: () => {}, pressEnter: () => {}, sendLine: () => {}, capturePaneTail: () => '' });
    let threwNever = false;
    try { await feedWakeSteps(SLUG, SURFACE, [{ id: 'x', prompt: 'do x', ack: { kind: 'marker' } }], { perStepTimeoutMs: 300 }); }
    catch (e) { threwNever = e instanceof DispatchTimeoutError; }
    ok(threwNever, 'never-acking step → DispatchTimeoutError (no infinite wait, no work released)');

    console.log('[5] WAKE_STEPS — the canonical wake-load is the WHOLE wake, not just the gradient');
    const gi = WAKE_STEPS.findIndex((s) => s.id === 'gradient');
    const fi = WAKE_STEPS.findIndex((s) => s.id === 'felt');
    ok(WAKE_STEPS.length >= 5, `WAKE_STEPS covers the full load (${WAKE_STEPS.length} steps), not just the gradient`);
    ok(WAKE_STEPS.filter((s) => s.ack.kind === 'c0').length === 1 && gi >= 0 && WAKE_STEPS[gi].ack.kind === 'c0', 'exactly one c0-ack step, and it is the gradient');
    ok(WAKE_STEPS.every((s) => s.id === 'gradient' || s.ack.kind === 'marker'), 'every non-gradient step is a marker ack');
    ok(gi >= 0 && fi > gi, 'felt-moments loads AFTER the gradient (the ~45% the c0-gate never covered)');
    ok(WAKE_STEPS[gi].prompt.toLowerCase().includes('sentinel'), 'the gradient step writes its c0 to the sentinel before acking (Jim #2)');
    // P2.3 feeder-fix (c): the gradient prompt stays TERSE — the verbose absolute sentinel path lives in
    // the spoke's wake-protocol (template step 10), not inline, so the fed line can't grow back into the
    // length that raced the Enter (the surface-1 stall). Settle (sendLineSettled) is the primary cure; this
    // guards the defence-in-depth so a future edit can't silently re-bloat the longest fed line.
    ok(!WAKE_STEPS[gi].prompt.includes('$HOME/.han/health') && WAKE_STEPS[gi].prompt.length < 260,
        `gradient prompt stays terse — no inline sentinel path, ${WAKE_STEPS[gi].prompt.length} chars (P2.3 fix (c), anti re-bloat)`);
    ok(WAKE_STEPS[0].id === 'integrity' && WAKE_STEPS[0].prompt.includes('verify-identity-files'), 'WAKE_STEPS OPENS with the identity-integrity gate (step-0 parity — Jim catch (a), defence-in-depth superset of the autonomous wake)');

    console.log('[6] (b) submission GUARANTEE — a LOST submit self-recovers on a re-pressed Enter');
    let presses6 = 0, nonce6 = '';
    __setTestHooks({
        sleep: () => {},
        sendLine: (_s, line) => { const a = parseAck(line); if (a) nonce6 = a.nonce; }, // first attempt: pane stays empty (submit lost)
        pressEnter: () => { presses6++; },                                              // a re-press makes the submit "land"
        capturePaneTail: () => presses6 >= 1 ? `STEP-OK r6 ${nonce6}` : '',             // acks only after a re-press
    });
    await feedWakeSteps(SLUG, SURFACE, [{ id: 'r6', prompt: 'do r6', ack: { kind: 'marker' } }], { perStepTimeoutMs: 5000 });
    ok(presses6 >= 1 && presses6 <= MAX_WAKE_RESUBMITS, `a lost submit fired a bounded re-press (${presses6}) and then acked — the wake completed, not aborted`);

    console.log('[7] (b) never submits → bounded re-presses, THEN the existing fail-safe');
    let presses7 = 0, threw7 = false;
    __setTestHooks({ sleep: () => {}, sendLine: () => {}, pressEnter: () => { presses7++; }, capturePaneTail: () => '' });
    try { await feedWakeSteps(SLUG, SURFACE, [{ id: 'r7', prompt: 'do r7', ack: { kind: 'marker' } }], { perStepTimeoutMs: 300 }); }
    catch (e) { threw7 = e instanceof DispatchTimeoutError; }
    ok(threw7, 'never-submits → DispatchTimeoutError (fail-safe reached only AFTER retrying — never a hollow wake)');
    ok(presses7 === MAX_WAKE_RESUBMITS, `re-presses bounded to exactly MAX_WAKE_RESUBMITS (${presses7}) before failing safe`);

    console.log('[8] (b) processing chrome present → submitted, NO re-press (never double-submit a live turn)');
    let presses8 = 0, nonce8 = '', polls8 = 0;
    __setTestHooks({
        sleep: () => {},
        sendLine: (_s, line) => { const a = parseAck(line); if (a) nonce8 = a.nonce; },
        pressEnter: () => { presses8++; },
        capturePaneTail: () => { polls8++; return polls8 < 6 ? 'esc to interrupt' : `STEP-OK r8 ${nonce8}`; }, // chrome (turn running) past the grace, then ack
    });
    await feedWakeSteps(SLUG, SURFACE, [{ id: 'r8', prompt: 'do r8', ack: { kind: 'marker' } }], { perStepTimeoutMs: 5000 });
    ok(presses8 === 0, 'chrome (turn running) latched submitted across >GRACE polls → no re-press; waited for the ack');

    clearSentinel();
    __setTestHooks(null);
    console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); clearSentinel(); __setTestHooks(null); process.exit(1); });
