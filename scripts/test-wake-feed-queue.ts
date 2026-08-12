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
import { writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { feedWakeSteps, ensureSubmitted, WAKE_STEPS, MAX_WAKE_RESUBMITS, __setTestHooks, DispatchTimeoutError, wakeAckRegex, phaseWakeSteps, PHASE1_WAKE_IDS, writeWakeManifest, readWakeManifest, wakeManifestPath, phase1MarkerPath, twoPhaseOwedButLost, computeWakeDeltaSteps, knownWakeStores, type WakeManifest, type WakeStep } from '../src/server/lib/tmux-dispatcher';
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
    // MNT-098 suite repair: the feeder line gained backtick-wrapping + a "(without the backticks)"
    // suffix at the S218 T1 ackRe hardening — the old end-anchored form stopped matching and the
    // whole suite became un-runnable (a silent gate==parser drift in the suite's own mirror).
    // Match the marker wherever it sits; exclude the closing backtick from the nonce.
    const m = line.match(/STEP-OK\s+([^\s`]+)\s+([^\s`]+)/);
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
    // MNT-098 — the self-run protocol's first-prompt unflushed-swap check must live in the fed wake
    // too (the P2.1b relocation dropped it; a jammed flush ran 4 days undetected because the fed
    // queue never looked). It sits AFTER the gradient and BEFORE working-mem, so a flushable
    // backlog merges before the pair is read; the over-cap polarity is surface-never-dump.
    const si = WAKE_STEPS.findIndex((s) => s.id === 'swap-check');
    const wi = WAKE_STEPS.findIndex((s) => s.id === 'working-mem');
    ok(si >= 0 && wi > si && si > gi, 'swap-check step exists, after the gradient, BEFORE working-mem (MNT-098 — the dropped self-run step, restored)');
    ok(WAKE_STEPS[si].prompt.includes('wm-flush.ts') && WAKE_STEPS[si].prompt.includes('wm-flush-errors.jsonl'), 'swap-check cites the real flush script + the alert artefact (gate==parser family: the step and the hook point at one mechanism)');
    ok(/do NOT dump/.test(WAKE_STEPS[si].prompt) && WAKE_STEPS[si].prompt.includes('backlog-over-cap'), 'over-cap polarity is SURFACE, never dump (F3/DEC-103 preserved in the step itself)');
    // M1 (Jim) + Tenshi's clause: the THIRD outcome — the flush itself fails — must carry an
    // instruction (bounded retry, surface like over-cap), keyed on the ALERT TAIL not the exit
    // code alone (a piped hand-run launders the exit; wm-flush-errors.jsonl cannot be laundered).
    ok(WAKE_STEPS[si].prompt.includes('flush-failed') && /do NOT retry more than once/.test(WAKE_STEPS[si].prompt) && /RE-CHECK the alert tail/i.test(WAKE_STEPS[si].prompt),
        'flush-fail outcome instructed: alert-tail re-check + bounded retry + surface (M1 + the laundered-exit clause — the polarity table is complete)');

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

    // ── MNT-010 (b) extended to the WORK-dispatch: the SHARED `ensureSubmitted` proven on the
    // submitTurn shape (chrome predicate — there is no STEP-OK ack on a work turn). Tests 6-8 cover
    // the feedWakeSteps shape (ack-or-chrome predicate); these cover submitTurn's (chrome only). The
    // submitTurn fail-safe itself (DispatchTimeoutError → needs-reconcile) is the EXISTING
    // waitForCaptureWithRateLimitRetry path, covered by test-rate-limit-retry.ts.
    console.log('[9] (b) ensureSubmitted (work-dispatch / chrome predicate) — a LOST submit self-recovers on a re-press');
    let presses9 = 0;
    __setTestHooks({ sleep: () => {}, pressEnter: () => { presses9++; }, capturePaneTail: () => presses9 >= 1 ? 'esc to interrupt' : '' });
    const rc9 = await ensureSubmitted('sess', (tail) => /esc to interrupt/i.test(tail));
    ok(presses9 >= 1 && presses9 <= MAX_WAKE_RESUBMITS && rc9 === presses9, `lost work-dispatch submit → bounded re-press (${presses9}) → turn started (the MNT-010 fix)`);

    console.log('[10] (b) ensureSubmitted never starts → exactly MAX re-presses, then hands to the caller fail-safe');
    let presses10 = 0;
    __setTestHooks({ sleep: () => {}, pressEnter: () => { presses10++; }, capturePaneTail: () => '' });
    const rc10 = await ensureSubmitted('sess', (tail) => /esc to interrupt/i.test(tail));
    ok(presses10 === MAX_WAKE_RESUBMITS && rc10 === MAX_WAKE_RESUBMITS, `never-starts → bounded to exactly MAX_WAKE_RESUBMITS (${presses10}); caller's capture-waitFor then fail-safes (needs-reconcile, only after genuinely trying)`);

    console.log('[11] (b) ensureSubmitted — turn already running (chrome up) → 0 re-press (never double-submit a live work turn)');
    let presses11 = 0;
    __setTestHooks({ sleep: () => {}, pressEnter: () => { presses11++; }, capturePaneTail: () => 'esc to interrupt' });
    const rc11 = await ensureSubmitted('sess', (tail) => /esc to interrupt/i.test(tail));
    ok(presses11 === 0 && rc11 === 0, 'turn already running → ensureSubmitted returns immediately, no re-press');

    // ── Phase A (spoke-model-init-consolidation, 2026-08-11) — the two-phase-wake extensions ────
    console.log('[12] Phase A: cursor ack — cursorAskIds asks for <bytes>; onAck captures the digits');
    let nonce12 = '', cursor12: string | null = 'unset', ask12 = '';
    __setTestHooks({
        sleep: () => {}, pressEnter: () => {},
        sendLine: (_s, line) => { const a = parseAck(line); if (a) nonce12 = a.nonce; ask12 = line; },
        capturePaneTail: () => `STEP-OK felt ${nonce12} 287808`,
    });
    await feedWakeSteps(SLUG, SURFACE, [{ id: 'felt', prompt: 'load felt whole', ack: { kind: 'marker' } }],
        { perStepTimeoutMs: 5000, cursorAskIds: ['felt'], onAck: (_s, c) => { cursor12 = c; } });
    ok(cursor12 === '287808', `onAck captured the echoed byte cursor (${cursor12})`);
    ok(ask12.includes('<bytes>') && ask12.includes('wc -c'), 'the cursor ask names <bytes> + wc -c (the spoke echoes what it ACTUALLY loaded)');

    console.log('[13] Phase A: a cursorless ack still satisfies a cursor-asked step (degrade path, null cursor)');
    let nonce13 = '', cursor13: string | null = 'unset';
    __setTestHooks({
        sleep: () => {}, pressEnter: () => {},
        sendLine: (_s, line) => { const a = parseAck(line); if (a) nonce13 = a.nonce; },
        capturePaneTail: () => `STEP-OK felt ${nonce13}`,
    });
    await feedWakeSteps(SLUG, SURFACE, [{ id: 'felt', prompt: 'load felt whole', ack: { kind: 'marker' } }],
        { perStepTimeoutMs: 5000, cursorAskIds: ['felt'], onAck: (_s, c) => { cursor13 = c; } });
    ok(cursor13 === null, 'ack without the third token → onAck(null) — the caller degrades to its pre-feed stat (duplication-safe)');

    console.log('[14] Phase A: V1 echo-fuzz — the widened regex never matches the instruction\'s own wrapped echo');
    const fuzzId = 'felt', fuzzNonce = 'k3x9fuzz';
    const fuzzRe = wakeAckRegex(fuzzId, fuzzNonce);
    const instructionPlain = `load felt-moments.md WHOLE — when COMPLETE reply on its own line EXACTLY: \`STEP-OK ${fuzzId} ${fuzzNonce}\` (without the backticks)`;
    const instructionCursor = `load felt-moments.md WHOLE — when COMPLETE reply on its own line EXACTLY: \`STEP-OK ${fuzzId} ${fuzzNonce} <bytes>\` where <bytes> is the file's byte size you actually loaded (from wc -c; without the backticks)`;
    let falseMatches = 0;
    for (const instr of [instructionPlain, instructionCursor]) {
        for (let width = 20; width <= 220; width++) {
            const wrapped = (instr.match(new RegExp(`.{1,${width}}`, 'g')) ?? []).join('\n');
            if (fuzzRe.test(wrapped)) falseMatches++;
        }
    }
    ok(falseMatches === 0, `0 false echo-matches across widths 20–220 × both ask variants (was ${falseMatches})`);
    ok(fuzzRe.test(`STEP-OK ${fuzzId} ${fuzzNonce} 12345`) && fuzzRe.test(`● STEP-OK ${fuzzId} ${fuzzNonce}`), 'the genuine bare replies (with and without cursor, with bullet) still match');
    ok(!fuzzRe.test(`STEP-OK ${fuzzId} ${fuzzNonce} <bytes>`), 'the literal <bytes> placeholder can never satisfy the digits-only cursor group');

    console.log('[15] Phase A: beforeStep \'defer\' stops the feed — deferred steps returned, never fed');
    const steps15: WakeStep[] = [
        { id: 'identity', prompt: 'load identity', ack: { kind: 'marker' } },
        { id: 'gradient15', prompt: 'load gradient', ack: { kind: 'marker' } },
        { id: 'felt15', prompt: 'load felt', ack: { kind: 'marker' } },
    ];
    const sent15: string[] = []; let nonce15 = '';
    __setTestHooks({
        sleep: () => {}, pressEnter: () => {},
        sendLine: (_s, line) => { const a = parseAck(line); if (a) { sent15.push(a.id); nonce15 = a.nonce; } },
        capturePaneTail: () => `STEP-OK ${sent15[sent15.length - 1]} ${nonce15}`,
    });
    const r15 = await feedWakeSteps(SLUG, SURFACE, steps15, {
        perStepTimeoutMs: 5000,
        beforeStep: (s) => (s.id === 'gradient15' ? 'defer' : 'feed'), // ceiling hits at the gradient
    });
    ok(JSON.stringify(sent15) === JSON.stringify(['identity']), 'the feed stopped AT the deferred step — nothing after it was fed');
    ok(JSON.stringify(r15.fed) === JSON.stringify(['identity']) && JSON.stringify(r15.deferred) === JSON.stringify(['gradient15', 'felt15']),
        `return shape carries the migration truth: fed=[${r15.fed}] deferred=[${r15.deferred}] (the manifest records these as phase-2 whole-loads)`);

    console.log('[16] Phase A: the volatility split is a VIEW of WAKE_STEPS — every id exactly once, order preserved');
    const { phase1, phase2 } = phaseWakeSteps();
    ok(JSON.stringify([...phase1, ...phase2].map(s => s.id).sort()) === JSON.stringify(WAKE_STEPS.map(s => s.id).sort()),
        'phase1 ∪ phase2 = WAKE_STEPS exactly (no duplicate, no orphan — one source of step truth)');
    ok(JSON.stringify(phase1.map(s => s.id)) === JSON.stringify([...PHASE1_WAKE_IDS].filter(id => WAKE_STEPS.some(s => s.id === id))),
        'phase 1 = the stable self (integrity, identity, gradient, felt) in wake order');
    ok(phase1.some(s => s.ack.kind === 'c0') && !phase2.some(s => s.ack.kind === 'c0'), 'the c0-gate lives in phase 1 (the warm receipt carries the gradient landmark)');

    // ── Pre-flip cure batch (2026-08-11, Tenshi mso7cgc9/mso8hjjx + Casey msohxz4y) ─────────────
    const STEM = 'curetest-stem-1';
    const manifestP = wakeManifestPath(SLUG, STEM);
    const markerP = phase1MarkerPath(SLUG, STEM);
    const cleanCure = () => { for (const p of [manifestP, `${manifestP}.tmp`, markerP]) { try { rmSync(p); } catch { /* none */ } } };
    const baseManifest: WakeManifest = { stem_session: STEM, slug: SLUG, surface: SURFACE, phase1_completed_at: new Date().toISOString(), phase2_completed_at: null, entries: [] };

    console.log('[17] F1: the out-of-band marker discriminates pre-flag from certificate-lost; the write is atomic');
    cleanCure();
    ok(!twoPhaseOwedButLost(SLUG, STEM), 'no manifest + no marker → nothing owed (a pre-flag stem is not a fault)');
    writeFileSync(markerP, new Date().toISOString() + '\n');
    ok(twoPhaseOwedButLost(SLUG, STEM), 'marker WITHOUT manifest → phase 2 owed, certificate lost (the branch that must defer-and-alert, never serve)');
    writeWakeManifest(baseManifest);
    ok(!twoPhaseOwedButLost(SLUG, STEM) && readWakeManifest(SLUG, STEM) !== null, 'marker + readable manifest → not lost (the normal path)');
    ok(!existsSync(`${manifestP}.tmp`), 'atomic write leaves no .tmp behind (temp-then-rename)');
    writeFileSync(manifestP, '{ torn-not-json');
    ok(twoPhaseOwedButLost(SLUG, STEM), 'marker + TORN manifest → owed-but-lost (a torn certificate never reads as nothing-owed)');
    cleanCure();

    console.log('[18] F2: a forged manifest store can never reach an instruction; known stores resolve via the registry');
    const evil = `/tmp/evil'; rm -rf $HOME; echo '`;
    const { identityFiles, feltPath } = knownWakeStores(SLUG);
    const forged: WakeManifest = { ...baseManifest, entries: [
        { store: evil, phase: 1, cursor: { kind: 'offset', value: '10' }, loaded_at: new Date().toISOString() },
        { store: evil, phase: 1, cursor: { kind: 'mtime', value: '123' }, loaded_at: new Date().toISOString() },
        { store: identityFiles[0], phase: 1, cursor: { kind: 'mtime', value: 'stale-mtime-forces-delta' }, loaded_at: new Date().toISOString() },
    ] };
    const steps18 = computeWakeDeltaSteps(SLUG, forged);
    ok(steps18.every(s => !s.prompt.includes('/tmp/evil') && !s.prompt.includes('rm -rf')), 'no emitted prompt carries any byte of the forged store string (unrepresentable, not filtered)');
    ok(steps18.some(s => s.prompt.includes(identityFiles[0])), 'the legitimate entry still resolves — and its prompt path is the REGISTRY copy');

    console.log('[19] felt-shrink guard: an offset cursor beyond EOF → whole reload, never a void tail');
    const shrunk: WakeManifest = { ...baseManifest, entries: [
        { store: feltPath, phase: 1, cursor: { kind: 'offset', value: String(Number.MAX_SAFE_INTEGER) }, loaded_at: new Date().toISOString() },
    ] };
    const steps19 = computeWakeDeltaSteps(SLUG, shrunk);
    ok(steps19.length === 1 && /WHOLE/.test(steps19[0].prompt) && !/tail -c/.test(steps19[0].prompt), 'shrunk file (cursor > size) → re-read WHOLE instruction, no tail command (the offset licence ended)');

    console.log('[20] F3: checkout writes NO shared per-surface sentinel (the cross-satisfy class is struck at source)');
    const src20 = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/server/lib/tmux-dispatcher.ts'), 'utf-8');
    const body20 = src20.slice(src20.indexOf('async function completeTwoPhaseWake'), src20.indexOf('async function wakeViaFeedOrTrigger'));
    ok(body20.length > 0 && !body20.includes('writeFileSync(readyPath('), 'completeTwoPhaseWake contains no readyPath write (source assertion; the live proof is the gate live-fire)');
    ok(body20.includes('phase2_completed_at: new Date().toISOString()'), 'the serve-ready signal is the session-keyed manifest stamp');

    cleanCure();
    clearSentinel();
    __setTestHooks(null);
    console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); clearSentinel(); __setTestHooks(null); process.exit(1); });
