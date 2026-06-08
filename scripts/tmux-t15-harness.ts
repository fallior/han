/**
 * T-1.5 round-trip harness — drives lib/tmux-dispatcher.ts against a real, hand-launched
 * tmux'd Claude Code session (the plan's "adopt existing" path). This is the test-runner
 * the v2 plan + Jim's audit flagged as "build fresh"; the dispatcher itself is T-1.
 *
 * It does NOT spawn the billed session — you launch that by hand (e.g. `hanleo`, which
 * sets AGENT_SLUG, forwards it via tmux -e, runs welcome-back → writes the ready-sentinel,
 * and registers han-diary via the repo .mcp.json). The harness then ADOPTS that session and
 * drives round-trips, so running the harness is cheap; the billed cost is the session +
 * the per-round-trip turns it processes.
 *
 * Usage (run from src/server so NODE_PATH resolves the MCP SDK):
 *   cd src/server && npx tsx ../../scripts/tmux-t15-harness.ts --tmux=<session-name> --preflight
 *   cd src/server && npx tsx ../../scripts/tmux-t15-harness.ts --tmux=<session-name> --rounds=10
 *   cd src/server && npx tsx ../../scripts/tmux-t15-harness.ts --tmux=<session-name> --abort-test
 *
 * Modes:
 *   --preflight   Cheap wiring pre-check (NO billed turns): tmux session exists, ready-sentinel
 *                 present, sink dir resolves to <slug>-diary-capture, ctx-% readable. This is the
 *                 Jim-mandated check before spending any billed round-trip (confirms the diary
 *                 server resolved the slug — the ${AGENT_SLUG} open question — and the statusline
 *                 ctx-writer works).
 *   --rounds=N    Run N billed round-trips (default 10). Each sends a trivial test prompt that
 *                 instructs the agent to call mcp__han-diary__submit_response, and times the
 *                 capture. Reports per-round latency + a pass/fail summary.
 *   --abort-test  THE T-1.5 gate: start a transaction, send /clear via send-keys mid-compose,
 *                 observe whether the in-flight capture still arrives (queued) or never does
 *                 (interrupted). Decides whether current.json-unlink is backbone or belt.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
    spawnAgentSession,
    sendTransactionPrompt,
    getContextPct,
} from '../src/server/lib/tmux-dispatcher';

const HEALTH_DIR = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');

function arg(name: string, def?: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    if (hit) return hit.split('=').slice(1).join('=');
    return process.argv.includes(`--${name}`) ? '' : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const SLUG = arg('slug', 'leo')!;
const TMUX = arg('tmux');
const ROUNDS = parseInt(arg('rounds', '10')!, 10);
const sinkDir = path.join(HEALTH_DIR, `${SLUG}-diary-capture`);
const readyPath = path.join(HEALTH_DIR, `${SLUG}-ready`);

function log(msg: string) { console.log(`[t15] ${msg}`); }

/** A trivial test prompt: do a tiny task, then submit the diary so the capture (= completion) fires. */
function testPrompt(n: number): string {
    return [
        `T-1.5 HARNESS ROUND-TRIP #${n}. This is a transport test, not real work.`,
        `Do exactly this: compute ${n} + ${n} and note the result, then call the`,
        `mcp__han-diary__submit_response tool EXACTLY ONCE to complete your turn, with:`,
        `  working_memory_full: "harness round #${n}: ${n}+${n}=${n * 2}. transport ok."`,
        `  working_memory_compressed: "T-1.5 transport round ${n} — answered ${n}+${n}=${n * 2}; this is a harness round-trip proving the prompt-file→send-keys→submit_response→capture loop, not substantive work."`,
        `  input_quotes: "T-1.5 HARNESS ROUND-TRIP #${n}"`,
        `Do NOT write any other memory or post anywhere. The tool call IS your completion.`,
    ].join('\n');
}

function preflight(): number {
    log(`PREFLIGHT (no billed turns) — slug=${SLUG} tmux=${TMUX ?? '<unset>'}`);
    let problems = 0;
    const ok = (label: string, cond: boolean, detail = '') => {
        log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
        if (!cond) problems++;
    };

    // 1. tmux session exists?
    let sessionExists = false;
    try { execFileSync('tmux', ['has-session', '-t', TMUX ?? '']); sessionExists = true; } catch { /* no */ }
    ok('tmux session exists', !!TMUX && sessionExists, TMUX ? `"${TMUX}"` : 'pass --tmux=<name>');

    // 2. ready-sentinel present (welcome-back completed)?
    let readyMtime: number | null = null;
    try { readyMtime = fs.statSync(readyPath).mtimeMs; } catch { /* none */ }
    ok('ready-sentinel present', readyMtime !== null, readyMtime ? `${readyPath} @ ${new Date(readyMtime).toISOString()}` : `${readyPath} MISSING (welcome-back not done / step 10 not run)`);

    // 3. sink dir resolves to the RIGHT slug (the ${AGENT_SLUG} open question) — the diary
    //    server mkdirs it at launch. A literal "${AGENT_SLUG}-diary-capture" would mean
    //    expansion failed AND the fallback didn't resolve.
    const sinkExists = fs.existsSync(sinkDir);
    ok('diary sink dir resolved', sinkExists, sinkExists ? sinkDir : `${sinkDir} not created — diary server may not have started or slug unresolved`);
    const literalSink = path.join(HEALTH_DIR, '${AGENT_SLUG}-diary-capture');
    ok('no unexpanded-literal sink', !fs.existsSync(literalSink), fs.existsSync(literalSink) ? `FOUND ${literalSink} — \${AGENT_SLUG} did NOT expand and fallback failed` : 'clean');

    // 4. ctx-% readable (statusline ctx-writer working)?
    const pct = getContextPct(SLUG);
    ok('statusline ctx-% readable', pct !== null, pct !== null ? `${pct}%` : `${SLUG}-ctx.json missing/unparseable — statusline writer not active`);

    log(problems === 0 ? 'PREFLIGHT GREEN — wiring looks good; safe to run billed round-trips.' : `PREFLIGHT: ${problems} problem(s) — fix before spending billed round-trips.`);
    return problems === 0 ? 0 : 1;
}

async function roundTrips(): Promise<number> {
    if (!TMUX) { log('ERROR: --tmux=<session-name> required'); return 1; }
    log(`Adopting session "${TMUX}" (slug=${SLUG})…`);
    await spawnAgentSession(SLUG, { tmuxSession: TMUX, launchCommand: '', adoptExisting: true });

    const latencies: number[] = [];
    let failures = 0;
    for (let i = 1; i <= ROUNDS; i++) {
        const t0 = Date.now();
        try {
            const cap = await sendTransactionPrompt(SLUG, testPrompt(i));
            const ms = Date.now() - t0;
            latencies.push(ms);
            const okShape = cap.working_memory_full.length > 0 && cap.working_memory_compressed.length >= 50;
            log(`round ${i}/${ROUNDS}: ${(ms / 1000).toFixed(1)}s — capture ${okShape ? 'OK' : 'SHAPE-WARN'} (${cap.working_memory_full.length}c body)`);
            const ctx = getContextPct(SLUG);
            if (ctx !== null) log(`  ctx now ${ctx}%`);
        } catch (err) {
            failures++;
            log(`round ${i}/${ROUNDS}: FAILED — ${(err as Error).message}`);
        }
    }
    const ok = ROUNDS - failures;
    const avg = latencies.length ? (latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(1) : 'n/a';
    log(`SUMMARY: ${ok}/${ROUNDS} round-trips OK, avg ${avg}s${failures ? ` — ${failures} FAILED` : ''}`);
    return failures === 0 ? 0 : 1;
}

/**
 * Abort-vs-queue probe (the T-1.5 gate). Start a transaction, wait briefly so the agent is
 * mid-compose, then send a raw /clear via send-keys. Observe: does the capture for the
 * in-flight txn still arrive (the /clear QUEUED behind the turn) or never (it INTERRUPTED)?
 *   - capture arrives  → /clear queues → current.json-unlink is a BELT (defence-in-depth).
 *   - capture never    → /clear interrupts → current.json-unlink is the BACKBONE of reconcile.
 */
async function abortTest(): Promise<number> {
    if (!TMUX) { log('ERROR: --tmux=<session-name> required'); return 1; }
    log(`ABORT-VS-QUEUE PROBE on "${TMUX}" — start a txn, send /clear mid-compose, watch the capture.`);
    await spawnAgentSession(SLUG, { tmuxSession: TMUX, launchCommand: '', adoptExisting: true });

    const before = fs.existsSync(sinkDir) ? fs.readdirSync(sinkDir).filter((f) => f.endsWith('.json')).length : 0;
    const txn = sendTransactionPrompt(SLUG, testPrompt(999), { timeoutMs: 90_000 })
        .then((cap) => ({ outcome: 'CAPTURE_ARRIVED', cap }))
        .catch((e) => ({ outcome: 'NO_CAPTURE', err: (e as Error).message }));

    // give the agent a few seconds to begin composing, then interrupt with /clear
    await new Promise((r) => setTimeout(r, 6_000));
    log('sending raw /clear mid-compose…');
    execFileSync('tmux', ['send-keys', '-t', TMUX, '-l', '/clear']);
    execFileSync('tmux', ['send-keys', '-t', TMUX, 'Enter']);

    const result = await txn;
    const after = fs.existsSync(sinkDir) ? fs.readdirSync(sinkDir).filter((f) => f.endsWith('.json')).length : 0;
    log(`RESULT: ${result.outcome} (sink files ${before}→${after})`);
    if (result.outcome === 'CAPTURE_ARRIVED') {
        log('→ /clear QUEUED behind the turn. current.json-unlink is a BELT (the turn completed first).');
    } else {
        log('→ /clear INTERRUPTED the turn (no capture). current.json-unlink is the BACKBONE of reconcile.');
    }
    log('NOTE: session may now be mid-/clear — re-launch/welcome-back before reusing it.');
    return 0;
}

async function main(): Promise<void> {
    let code = 0;
    if (has('preflight')) code = preflight();
    else if (has('abort-test')) code = await abortTest();
    else code = await roundTrips();
    process.exit(code);
}

main().catch((e) => { console.error('[t15] FATAL:', e); process.exit(1); });
