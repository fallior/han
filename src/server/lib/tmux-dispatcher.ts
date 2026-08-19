/**
 * Tmux Agent Harness — dispatcher skeleton (plan T-1).
 *
 * Replaces the Agent SDK transport (`agentQuery`) with dispatch to per-agent tmux'd
 * interactive Claude Code sessions, ahead of Anthropic's 2026-06-15 SDK-billing split.
 * See plans/tmux-agent-harness.md (v2) and thread mppj72fx-wt0u1p.
 *
 * This is the T-1 SKELETON: the six primitives the v2 plan enumerates, wired to the
 * file-based interfaces resolved during design (A3 file-delivery; statusline-JSON
 * context-watch Q-V2-2; re-homed diary capture/completion sink — Jim's headline). It is
 * deliberately NOT wired into any production handler yet (that is T-3). The manually-
 * launched-session round-trip test (T-1 success criterion) drives it directly.
 *
 * Design invariants (from the v2 audit, 2026-06-01):
 *  - Per-agent FIFO serialisation (§3): exactly one transaction live per agent session at
 *    a time. This is what makes the single `current.json` txn-pointer in the diary sink
 *    safe — the same guarantee that made the SDK path's module-level capture var safe.
 *  - File-based everything (A3): prompts, captures, ready-sentinels, context-% all move
 *    over files, never `tmux send-keys` paste-buffers (Darron's quoted-text/emoji/nested-
 *    thread payloads corrupt terminal encoding). send-keys carries only a short, safe
 *    instruction line pointing the agent at the prompt file.
 *  - Capture-appears = payload + completion (Jim's headline): the diary sink file written
 *    by lib/diary-mcp-server.ts is simultaneously the c0/c1 paired-memory source AND the
 *    "agent is done" signal. There is no other reliable completion signal over a terminal.
 *  - Agent-agnostic (DEC-081): every primitive takes `slug: string`; no 'jim'|'leo' union.
 *
 * Pre-merge audit by Jim required before this lands (src/server/lib/; protected per the
 * pre-merge audit rhythm). Author-time scope: NEW files only (this + diary-mcp-server.ts).
 */

import { execFileSync, execFile } from 'child_process';
import { healthDir, hanHome, sleevesDir } from './paths';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CaptureRecord } from './diary-mcp-server';
import { withMemorySlot } from './memory-slot';
import { gradientConfigForAgent } from './agent-registry';
import { spokeLifecycleFor, wakeFeedFor, swapPrefixFor, poolSizeFor, serveModelFor, manifestModelLadder, manifestModelHead, spokePersistFor, ctxReapThresholdFor, prewarmAlertMinsFor, spokeIdleReapHoursFor, spokeRethreadCtxCeilingFor, spokeFitCeilingFor, resumableTtlMinutesFor, stemTwoPhaseWakeFor } from './garden-manifest';
// Build B (adaptive-hearth §8, held 2026-08-15): the per-spoke stats organelle, the
// hearth pulse (flag-gated OFF), and the MNT-115 declared-busy predicate.
import {
    organelleOnDispatchStart, organelleOnTurnComplete, boundaryCheck,
    armHearthPulse, clearHearthPulse, hearthStandingMessageFor, writeWindingUp,
    declaredBusy,
} from './spoke-organelle';
import { markResumable, readResumableMarkers, clearResumableMarker, resumableExpired, type PaneClass } from './dispatch-reconciler';
import { mostRecentC0Id, isAgentC0, gradientEntriesAfterC0 } from './memory-gradient';
import { writeSleeveState } from './sleeve-state';
import { checkoutStem, returnStem, removeStem, setStemCursor, upsertStem, isStemStale, readPool, poolStatus, findSpokeForThread, bindSpoke, touchSpokeServed, decoupleSpoke, checkoutStemById, type PoolStem } from './stem-pool';
import { decideIdleAction, selectStemForThread, burdenPctForChars, writeSpokeLifecycleReceipt, threadTrustTier, bindTierDecision } from './spoke-lifecycle';
import { serverDir } from './paths';

const HEALTH_DIR = process.env.HAN_HEALTH_DIR || healthDir();
const PIPES_DIR = process.env.HAN_PIPES_DIR || path.join(hanHome(), 'agent-pipes');

/**
 * Q-V2-4 GATE. The dispatcher-computed memory-delta (#91 the watermark) is the warm-session
 * model's load-bearing-but-dangerous piece: a mis-computed delta silently lags the in-session
 * memory behind disk. Per Jim's disposition it MUST stay OFF until the fail-loud confirmation
 * lands — the DISPATCHER-SIDE confirm in computeMemoryDelta: compute behind the #49 memory
 * slot, boundary-check the slice point, confirm via an independent re-read, advance the cursor
 * only on a confirmed-clean delta. (No agent-echo layer — the dispatcher-side confirm is
 * sufficient + self-contained.) The primitive is built; the gate is shut.
 */
export const DELTA_REFRESH_ENABLED = true;

// Timeouts (ms). Compose can run minutes (leo-human dispatches observed at 3-5 min);
// identity load (welcome-back) is ~130K tokens. Conservative defaults; tune at T-3/T-4.
// READY tuned 240s → 600s (first-warm-beat data, 2026-06-12): a full identity wake
// measured ~6.5-7 min (18:56 launch → 19:03 sentinel), so 240s skipped one beat per
// cold launch and timed out every post-clear welcome-back wait (Jim's post-thaw
// audit). 600s covered the heartbeat wake; raised to 20min (S178, Darron's call)
// because the supervisor sleep-cycle COLD wake runs ~14min (fuller reconstitution)
// > the old 10min, so a legit slow cold launch was racing the wait.
// STOPGAP — to become a definition in the single-source cadence/timing config (S178 proposal).
const READY_TIMEOUT_MS = 20 * 60_000;
// SEMANTICS NAMED (DEC-103 sibling sweep, MNT-055): the transaction timeout ABANDONS the
// capture-wait — it never kills the pane; the spoke's turn keeps composing. Downstream: the pooled
// path retires the stem via the CHROME-GUARDED sweep (killed only once idle), so no cognition is
// terminated on this clock. Disclosed DEC-103 §1 residual (register, not this diff): the abandoned
// turn's eventual capture is never read — paid-for output discarded, though never interrupted.
const TRANSACTION_TIMEOUT_MS = 12 * 60_000;
const POLL_INTERVAL_MS = 750;
// Settle between a literal paste and its Enter (sendLineSettled) so a LONG fed line can't
// have its Enter race the TUI's ingestion of the paste — the P2.3 surface-1 stall, where
// the gradient WAKE_STEP sat unsubmitted in the spoke's input box. Generous floor: a wake
// has ~7 steps, so ~3.5s added to a cold wake that already runs tens of seconds → negligible.
const SEND_SETTLE_MS = 500;
// (b) the submission GUARANTEE (Jim's spec, thread mqvs3r6l): if a fed step's submit is LOST
// (no STEP-OK ack AND no processing chrome) for this many consecutive poll-ticks, the Enter is
// re-pressed — bounded by MAX_WAKE_RESUBMITS. So a lost race self-recovers AT the step (ms) rather
// than aborting the whole wake; the existing DispatchTimeoutError fail-safe is reached only AFTER
// retrying. Tick-based (not wall-clock) so it's deterministic under the tests' no-op sleep.
const SUBMIT_GRACE_TICKS = 3;          // ~3 × POLL_INTERVAL_MS ≈ 2.25s of no-chrome-no-ack before a re-press
export const MAX_WAKE_RESUBMITS = 3;   // bounded re-presses; then fail safe (never a hollow wake)

export class SessionNotReadyError extends Error {}
export class DispatchTimeoutError extends Error {}

export interface AgentSession {
    slug: string;
    /** Surface name per the Garden Manifest (e.g. "heartbeat", "human-response").
     *  Interactive sessions use "session". Readiness + context-watch are keyed
     *  per (slug, surface) — T-2 re-key after the T-1.5 cross-talk catch: the
     *  per-slug sentinel/ctx files were last-writer-wins across same-slug
     *  sessions, so waitForReady could cross-satisfy off another session's wake.
     *  The per-agent FIFO (enqueueForAgent) deliberately STAYS per-slug — that
     *  is the single-live-transaction guarantee current.json relies on. */
    surface: string;
    /** tmux session name (e.g. "heartbeat-leo"). */
    tmuxSession: string;
    /** Command run inside the tmux session to launch + identity-load Claude Code. */
    launchCommand: string;
    /** Set once the ready-sentinel has been observed at least once. */
    ready: boolean;
    /** Turn-state machine (the #5 reconcile design, settled 2026-06-01): the
     *  single-live-txn invariant `current.json` relies on is enforced here.
     *  'busy' from dispatch until a confirmed capture for THIS txn; a timeout
     *  marks 'needs-reconcile' — NOT idle, because "the dispatcher gave up" is
     *  not "the session is idle". The queue runs reconcileSession ahead of the
     *  next dispatch. Confirm idleness; never assume it from elapsed time. */
    turnState: 'idle' | 'busy' | 'needs-reconcile';
    /** Build B (§2.8): the BAKED hearth standing message — materialised at session
     *  creation, never fetched at fire time. REQUIRED (Tenshi F1, msz950i2 2026-08-18):
     *  optional + a `??` fallback at the fire site was a fire-time config read held off
     *  only by every construction site happening to remember — tsc now enforces the
     *  §2.8 law at every future construction site instead. */
    pulseMessage: string;
    /** Epoch ms of the last completed transaction — the orphan-capture mtime gate (#5). */
    lastTransactionTs: number;
    /** Byte length of working-memory.md last delta-read by this session — the #91 cross-
     *  surface watermark cursor (B2). In-memory only: clearSession reloads full memory, so
     *  the cursor never outlives the reload that resets it. Advances monotonically, only on
     *  a confirmed-clean delta (computeMemoryDelta). */
    lastMemoryLen: number;
}

/** Registry keyed per (slug, surface) — many sessions per agent under T-2+. */
const sessions = new Map<string, AgentSession>();
function sessionKey(slug: string, surface: string): string { return `${slug}/${surface}`; }
/**
 * R3a.1c — the per-stem session-map key (Jim's keystone: thread the SAME `stemKey` through the
 * session lookup, the diary sink, the queue, and HAN_DIARY_SLUG). The NON-pooled path passes
 * `stemKey === slug` (the default), resolving to the fixed `slug/surface` session — byte-identical
 * to the pre-pool model. The POOLED path passes the leased stem's `tmux_session` (never equal to a
 * bare slug), so each concurrent stem resolves its OWN adopted session in the `sessions` map (keyed
 * by that tmux_session), which is exactly how the per-stem FIFO + per-stem `current.json` stay
 * paired with the right pane. */
function sessionMapKey(slug: string, surface: string, stemKey: string): string {
    return stemKey === slug ? sessionKey(slug, surface) : stemKey;
}

// ── path helpers (mirror the diary-mcp-server runtime contract) ──────────────────────
// Sink + pipes stay per-SLUG: the per-agent FIFO serialises to one live txn per
// agent, which is what makes the single current.json pointer safe (plan §3).
function sinkDir(slug: string): string { return path.join(HEALTH_DIR, `${slug}-diary-capture`); }
function currentPtrPath(slug: string): string { return path.join(sinkDir(slug), 'current.json'); }
function capturePath(slug: string, txnId: string): string { return path.join(sinkDir(slug), `${txnId}.json`); }
function pipePath(slug: string, txnId: string): string { return path.join(PIPES_DIR, slug, `prompt-${txnId}.txt`); }
// Readiness + context-watch are per-(slug, surface) — see AgentSession.surface.
function readyPath(slug: string, surface: string): string { return path.join(HEALTH_DIR, `${slug}-${surface}-ready`); }
function ctxPath(slug: string, surface: string): string { return path.join(HEALTH_DIR, `${slug}-${surface}-ctx.json`); }

// ── small utilities ──────────────────────────────────────────────────────────────────

/**
 * Test-only IO seams (repro / unit tests). Production NEVER sets these — an empty hooks
 * object is the real behaviour. The clear↔wake-race repro (scripts/test-clear-wake-race.ts,
 * P1) sets them to record sendLine ordering, fast-forward the (real-time) sleeps, and fake
 * tmux presence, so the concurrent clear-vs-wake interleave is driven deterministically
 * without a real spoke. Kept tiny + clearly fenced; no production path references __setTestHooks.
 */
interface TestHooks {
    sendLine?: (tmuxSession: string, line: string) => void;
    pressEnter?: (tmuxSession: string) => void;   // (b) re-submit seam — count/observe re-presses without real tmux
    sleep?: (ms: number) => Promise<void> | void;
    tmuxSessionExists?: (name: string) => boolean;
    capturePaneTail?: (name: string) => string;
}
let testHooks: TestHooks = {};
export function __setTestHooks(h: TestHooks | null): void { testHooks = h ?? {}; }

function sleep(ms: number): Promise<void> {
    if (testHooks.sleep) return Promise.resolve(testHooks.sleep(ms));
    return new Promise((r) => setTimeout(r, ms));
}

function tmux(args: string[]): string {
    return execFileSync('tmux', args, { encoding: 'utf-8' });
}

function tmuxSessionExists(name: string): boolean {
    if (testHooks.tmuxSessionExists) return testHooks.tmuxSessionExists(name);
    try { tmux(['has-session', '-t', name]); return true; } catch { return false; }
}

/**
 * Send a SHORT, safe instruction line to the session's prompt input, then Enter.
 * `-l` sends the text literally so tmux never interprets a substring as a key name.
 * The Enter is a separate call because `-l` would type the word "Enter" literally.
 * NEVER pass hostile/large content here — that is what the prompt file is for (A3).
 */
function sendLine(tmuxSession: string, line: string): void {
    if (testHooks.sendLine) { testHooks.sendLine(tmuxSession, line); return; }
    tmux(['send-keys', '-t', tmuxSession, '-l', line]);
    tmux(['send-keys', '-t', tmuxSession, 'Enter']);
}

/**
 * Like sendLine, but SETTLES between the literal paste and the Enter. A long fed line (the
 * wake-steps) could otherwise have its Enter race the TUI's ingestion of the paste, leaving
 * the prompt unsubmitted — the P2.3 surface-1 stall: the gradient WAKE_STEP sat in the spoke's
 * input box, never submitted, never acked → DispatchTimeoutError fail-safe (no work, no hollow
 * answer). The settle makes the submit reliable; the ack-wait remains the belt (a miss still
 * fails safe). Async because the only caller, feedWakeSteps, already awaits; sendLine stays sync
 * for the SHORT command instructions it was built for (/clear, /pfc, /model, markers) — those
 * are well under the length that races, so they keep the cheap single-shot path.
 */
async function sendLineSettled(tmuxSession: string, line: string): Promise<void> {
    if (testHooks.sendLine) { testHooks.sendLine(tmuxSession, line); return; }
    tmux(['send-keys', '-t', tmuxSession, '-l', line]);
    await sleep(SEND_SETTLE_MS);
    pressEnter(tmuxSession);
}

/** Press Enter at a session's prompt — the submit. Its own seam so (b)'s re-submit (feedWakeSteps)
 *  and sendLineSettled's first attempt share one path, and a test can count re-presses without tmux. */
function pressEnter(tmuxSession: string): void {
    if (testHooks.pressEnter) { testHooks.pressEnter(tmuxSession); return; }
    tmux(['send-keys', '-t', tmuxSession, 'Enter']);
}

/**
 * (b) the submission GUARANTEE — shared (Jim's MNT-010 lean) by `feedWakeSteps` (each wake step) and
 * `submitTurn` (the work-dispatch pointer). The send has already happened (`sendLineSettled`); this
 * polls until the turn is confirmed STARTED by `hasStarted` — the agent's processing chrome is up, or
 * (for a fed step) its ack marker is already present — re-pressing the lost Enter (bounded by
 * MAX_WAKE_RESUBMITS, paced by SUBMIT_GRACE_TICKS) when the submit raced the paste and the line sat
 * typed-but-unsubmitted. Returns the re-press count once started, OR after the bounded re-presses are
 * spent — the caller's OWN post-submit wait (the STEP-OK ack-wait / the capture poll) then provides
 * the genuine-silence fail-safe, so a long timeout only ever counts a truly silent agent, never a lost
 * Enter (the MNT-010 reconcile-loop: pointer unsubmitted → 15-min waitFor → needs-reconcile → loop).
 * `hasStarted` latching on chrome-or-marker means a live turn is never double-submitted. DRY,
 * can't-diverge — one re-press path for both callers (the `wmDeltaCandidate` shared-helper pattern, R1).
 */
export async function ensureSubmitted(tmuxSession: string, hasStarted: (tail: string) => boolean): Promise<number> {
    let unsubmittedTicks = 0;
    let resubmits = 0;
    for (;;) {
        if (hasStarted(capturePaneTail(tmuxSession))) return resubmits;        // submitted / turn running
        if (++unsubmittedTicks >= SUBMIT_GRACE_TICKS) {
            if (resubmits >= MAX_WAKE_RESUBMITS) return resubmits;             // bounded — hand to the caller's wait + fail-safe
            pressEnter(tmuxSession);                                           // the Enter was lost — re-press
            resubmits++;
            unsubmittedTicks = 0;
        }
        await sleep(POLL_INTERVAL_MS);
    }
}

/**
 * MNT-070 rung 1 — deliver the continue-nudge to a resumable vessel through the SAME
 * submission guarantee every other pointer uses (Jim's hand-run observation: his ad-hoc
 * chrome check false-matched a hint line — "the machinery must use the real ensureSubmitted").
 * sendLineSettled (settle before Enter, no race) + ensureSubmitted (turn confirmed STARTED via
 * processing chrome, bounded re-press of a lost Enter). The caller's own post-nudge wait
 * (the DB/capture poll, JA3) provides the genuine-silence fail-safe.
 */
export async function sendContinueNudge(tmuxSession: string, nudgeText: string): Promise<number> {
    await sendLineSettled(tmuxSession, nudgeText);
    return ensureSubmitted(tmuxSession, (tail) => PROCESSING_CHROME_RE.test(tail));
}

function writeAtomic(file: string, contents: string): void {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, contents, 'utf-8');
    fs.renameSync(tmp, file);
}

/** Wait for `predicate()` to return truthy, polling until timeout. */
async function waitFor<T>(predicate: () => T | null, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const v = predicate();
        if (v) return v;
        if (Date.now() > deadline) throw new DispatchTimeoutError(`waitFor timed out after ${timeoutMs}ms`);
        await sleep(POLL_INTERVAL_MS);
    }
}

// ── readiness sentinel (T-1 readiness mechanism; v1 Q-1) ─────────────────────────────
/**
 * The agent writes `<health>/<slug>-ready` at the end of its welcome-back load (added to
 * the agent's CLAUDE.md Session Protocol close at T-2). The dispatcher treats the
 * sentinel's mtime as the readiness epoch. `clearSession` deletes it before /clear and
 * waits for it to reappear with a NEWER mtime, proving the post-clear welcome-back ran
 * rather than re-reading the stale sentinel.
 */
function readySentinelMtime(slug: string, surface: string): number | null {
    try { return fs.statSync(readyPath(slug, surface)).mtimeMs; } catch { return null; }
}

/** #107 c0-gate consumer-read: the c0 id the spoke wrote into its readiness sentinel at wake
 *  step 10 (proof it traversed to the `GRADIENT-EOF` landmark). Absent/empty → null; a newborn
 *  writes the literal `none`. */
function readSentinelC0Id(slug: string, surface: string): string | null {
    try { const s = fs.readFileSync(readyPath(slug, surface), 'utf8').trim(); return s || null; } catch { return null; }
}

async function waitForReady(slug: string, surface: string, afterMtime: number | null, timeoutMs: number): Promise<void> {
    await waitFor(() => {
        const m = readySentinelMtime(slug, surface);
        if (m === null) return null;
        if (afterMtime !== null && m <= afterMtime) return null; // stale sentinel; wait for refresh
        return true;
    }, timeoutMs).catch(() => {
        throw new SessionNotReadyError(`${slug}/${surface}: ready-sentinel did not appear within ${timeoutMs}ms`);
    });
}

// ── model-failover ladder (S173) ─────────────────────────────────────────────────────
/**
 * Claude Code's launch-time "selected model unavailable" chrome. When a spoke launches with
 * `--model <rung>` and that model is unavailable (Fable's free-window access dropping mid-
 * trial, 2026-06-13), the TUI sits at this prompt — ALIVE at `❯`, warm, just waiting to be
 * told a working model. Darron confirmed `/model <id>` direct-sets non-interactively (thread
 * mqby67sl), so we descend the ladder IN-SESSION rather than kill+relaunch (Jim's spec
 * revision mqbwtg3f) — the (slow) wake/context is preserved, the descent costs seconds.
 */
export const MODEL_UNAVAILABLE_RE = /issue with the selected model|Run \/model/i;
/** The normal ready chrome (a live Claude prompt). The model-error screen ALSO shows `❯`
 *  + a status line, so MODEL_UNAVAILABLE_RE is ALWAYS checked first. */
const READY_CHROME_RE = /❯|shortcuts|bypass permissions/i;
/** Active-turn chrome: Claude Code shows the interruptible "esc to interrupt" line ONLY while
 *  a turn (a wake load, a beat) is actively processing — and it persists through the momentary
 *  static window BETWEEN tool calls. That is exactly why it beats a double-capture diff for the
 *  R011 Invariant 2 (DEC-096) discriminator: a diff races a between-tool-calls spoke and misreads
 *  it as wedged. Present = actively thinking / mid-wake (never kill); absent + not-ready = wedged. */
export const PROCESSING_CHROME_RE = /esc to interrupt/i;
/** P7 (S197): a TRANSIENT mid-turn rate limit (Anthropic usage-window throttle). The model
 *  AND the account are fine — the same turn will compose once the throttle clears, so the
 *  recovery is "wait it out + re-submit" (the autonomous up-arrow), NOT a model descent
 *  (MODEL_UNAVAILABLE_RE → awaitChromeOrDescend) and NOT an account/credential swap (the
 *  `rate-limited` signal → jemma swap; the account axis, #18). Distinct chrome, distinct cure.
 *  NOTE (verify-don't-claim): this string is from the handover analysis, not a pane captured
 *  this session — the LIVE chrome + re-submit semantics are the belt-and-braces confirmation
 *  item (needs a real rate limit; the repro proves the detect→backoff→resubmit→collect LOGIC). */
export const RATE_LIMITED_RE = /temporarily limiting|Rate limited/i;

// ── MNT-070: the pane-state classifier (JA4 — the reconciler's objective discriminator) ──
/** The API-error-class banner (observed live on the MNT-070 stem: "API Error: Connection
 *  closed mid-response. The response above may be incomplete." — also the metering class
 *  Darron sees interactively). The TURN is dead; the vessel may be perfectly healthy. */
export const PANE_API_ERROR_RE = /API Error/i;
/** An interactive selection menu (the AskUserQuestion / R011 class — a numbered option list
 *  behind the selector). A spoke sitting at one has asked a question no human will answer:
 *  never nudge into it — hold (a nudge would blind-answer the menu). */
export const INTERACTIVE_MENU_RE = /❯\s*\d+\./;
/**
 * Classify a wedged dispatch's pane (JA4 — verdicts pinned by the suite; the caller supplies
 * 'session-gone' when there is no pane to classify). Precedence is the safety order:
 *   1. processing chrome → 'still-thinking' (progress present — EXTEND the wait, never act;
 *      checked FIRST so an old error banner above a live turn can never read as resumable);
 *   2. interactive menu → 'interactive-question' (R011 — hold);
 *   3. API-error banner + idle prompt chrome → 'resumable' (the turn died at the API, the
 *      vessel is healthy — the continue-nudge is safe: single-drive resumed, not the
 *      MNT-049 double-drive, because the signature proves turn-dead + prompt-idle);
 *   4. anything else (including an empty/unreadable pane) → 'unrecognised' (fail toward hold).
 */
export function classifyPaneState(paneTail: string): PaneClass {
    if (!paneTail.trim()) return 'unrecognised';
    if (PROCESSING_CHROME_RE.test(paneTail)) return 'still-thinking';
    if (INTERACTIVE_MENU_RE.test(paneTail)) return 'interactive-question';
    if (PANE_API_ERROR_RE.test(paneTail) && READY_CHROME_RE.test(paneTail)) return 'resumable';
    return 'unrecognised';
}

/** MNT-070 — the walker-facing probe: classify a session's pane, or 'session-gone' when the
 *  tmux session no longer exists (the rungs-2/3 discriminator). */
export function paneClassForSession(tmuxSession: string): PaneClass | 'session-gone' {
    if (!tmuxSessionExists(tmuxSession)) return 'session-gone';
    return classifyPaneState(capturePaneTail(tmuxSession, 30));
}

const CHROME_TIMEOUT_MS = 3 * 60_000; // overall budget: chrome appears in seconds; margin for probes + descents
const DESCEND_COOLDOWN_MS = 6_000;    // let /model re-render before re-probing
const PROBE_REPLY_WINDOW_MS = 20_000; // a dead model errors in ~0s; no error within this window = the model works

/** Ladder fully walked and every rung was unavailable. Extends SessionNotReadyError so the
 *  existing surface handlers (which catch SessionNotReadyError → fail-loud + health-signal +
 *  skip) treat it as a not-ready condition: every model dead = fail safe, retry next cadence,
 *  no billing, loud in the health signal. */
export class ModelLadderExhaustedError extends SessionNotReadyError {}

/** P7: bounded mid-turn rate-limit retries exhausted (a SUSTAINED limit, longer than the
 *  bounded backoff window). Extends DispatchTimeoutError so the existing surface handlers
 *  (dispatchTxn's `catch (DispatchTimeoutError | SessionNotReadyError)` → fail-loud + skip +
 *  retry-next-cadence) treat it correctly. A sustained limit is the account axis's (#18)
 *  domain — P7 recovers transient throttles, then fails safe. */
export class RateLimitedError extends DispatchTimeoutError {}
/** P7 bounded-retry backoff (NO SILENT CONSTRAINTS, S74 — these values are stated to Darron):
 *  base 30s, ×2 each retry, capped at 5min/wait, max 4 retries → ~30/60/120/240s ≈ 7.5min
 *  bounded total before fail-safe. Never a tight loop. */
const RATE_LIMIT_BASE_BACKOFF_MS = 30_000;
const RATE_LIMIT_BACKOFF_CAP_MS = 5 * 60_000;
const RATE_LIMIT_MAX_RETRIES = 4;

/** Last `lines` non-empty lines of the VISIBLE pane (current state, not deep scrollback —
 *  bounding it keeps a pre-descent error line from false-matching after a successful switch). */
export function capturePaneTail(tmuxSession: string, lines = 14): string {
    if (testHooks.capturePaneTail) return testHooks.capturePaneTail(tmuxSession);
    let pane = '';
    try { pane = tmux(['capture-pane', '-p', '-t', tmuxSession]); } catch { return ''; }
    return pane.split('\n').filter((l) => l.trim()).slice(-lines).join('\n');
}

/**
 * Bounded wait for the live claude prompt chrome (READY_CHROME_RE) to appear in the pane.
 * Shared by awaitChromeOrDescend (post-LAUNCH: bash→claude, chrome absent→present) and
 * clearSession (W2, post-/clear: don't send welcome-back while the TUI is still mid-clear).
 * Throws SessionNotReadyError on timeout. NOTE (W2 caveat): post-/clear the chrome can re-appear
 * faster than a big /clear actually finishes — the caller keeps a short floor sleep first so we
 * don't match the PRE-/clear prompt; a fully swallow-proof form (verify the wake actually started,
 * re-send if not — the P7 shape) is the next hardening if a live /clear shows this isn't enough.
 */
async function awaitReadyChrome(slug: string, surface: string, tmuxSession: string, timeoutMs = CHROME_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!READY_CHROME_RE.test(capturePaneTail(tmuxSession))) {
        if (Date.now() > deadline) {
            throw new SessionNotReadyError(`${slug}/${surface}: claude prompt chrome never appeared (timeout ${timeoutMs}ms). Pane tail:\n${capturePaneTail(tmuxSession)}`);
        }
        await sleep(2_000);
    }
}

/**
 * Ensure a freshly-launched session is on a WORKING model — auto-descending the ladder via
 * in-session `/model <next rung>` — BEFORE the (expensive) welcome-back wake.
 *
 * VERIFIED S173 (throwaway-session test): the model-unavailable error is MESSAGE-TRIGGERED, not
 * launch-triggered. A bogus `--model` shows perfectly healthy idle chrome (`❯`, banner, bypass-
 * permissions) and only errors AFTER the first prompt is sent. So scanning the idle launch
 * chrome cannot detect it — we send a cheap "Hi" PROBE (Darron's idea) and read the result: a
 * dead model errors in ~0s, a working one simply replies. One probe per rung; on error, descend
 * `/model <next rung>` and re-probe; ladder exhausted → throw (fail safe → existing handler skips
 * the beat, no billing). Any non-error stuck state → timeout with a pane snapshot → human
 * escalation (Jim's "detect TUI-state → respond"; survey suppressed at the launcher; consent /
 * login never auto-answered — a permanent human-gated boundary). The probe runs per-LAUNCH
 * (rare — a spoke stays warm across beats), near-zero cost, and isolates the model check from
 * the costly identity wake. `ladder[0]` is the rung the launcher already used; descent starts
 * at rung 1; one `/model` per rung with a cooldown (never a tight loop, S74). The MODEL axis is
 * the first instance of the reusable failover pattern (sibling: the account/token axis, S173).
 */
export async function awaitChromeOrDescend(
    slug: string, surface: string, tmuxSession: string, ladder: string[], timeoutMs = CHROME_TIMEOUT_MS,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    // Phase 1: wait for the launch chrome (claude is UP at the prompt — NOT a model check).
    await awaitReadyChrome(slug, surface, tmuxSession, timeoutMs);
    // Phase 2: probe the model (the only way to surface a message-triggered error) and descend.
    // Each rung uses a UNIQUE probe marker (not a shared "Hi"), and we judge the result ONLY
    // once THIS probe's marker has rendered in the pane — then test for the error in the text
    // AFTER it. The prior bug (Jim's --descend smoke, 2026-06-14): a shared "Hi" read before
    // the new probe rendered made `lastIndexOf("Hi")` land on the PRIOR rung's probe, whose
    // error was still in scrollback → false-match → the working rung got descended past →
    // false "every rung unavailable". A unique marker can't match a prior rung's probe, and
    // gating on marker-presence ensures we read THIS probe's outcome, never a stale one.
    let rung = 0; // launcher already used ladder[0]
    let probeSeq = 0;
    for (;;) {
        const marker = `__hanprobe_r${rung}_${Date.now()}_${probeSeq++}__`;
        sendLine(tmuxSession, marker); // cheap probe — a dead model errors ~0s after it; a live one composes a reply
        const probeDeadline = Date.now() + PROBE_REPLY_WINDOW_MS;
        let errored = false;
        for (;;) {
            const tail = capturePaneTail(tmuxSession, 30);
            const idx = tail.lastIndexOf(marker);
            // Judge only once THIS probe's marker is on the pane (gate against a stale read);
            // then the model error, if any, sits in the text after the marker.
            if (idx >= 0 && MODEL_UNAVAILABLE_RE.test(tail.slice(idx + marker.length))) { errored = true; break; }
            if (Date.now() > probeDeadline) break; // marker rendered with no error → model works
            await sleep(1_500);
        }
        if (!errored) return; // model confirmed working on the current rung
        rung += 1;
        if (rung >= ladder.length) {
            throw new ModelLadderExhaustedError(
                `${slug}/${surface}: every model rung unavailable (${ladder.join(' → ') || '<empty ladder>'}). Pane tail:\n${capturePaneTail(tmuxSession)}`);
        }
        console.warn(`[tmux-dispatcher] ${slug}/${surface}: model rung "${ladder[rung - 1]}" unavailable — descending to "${ladder[rung]}" via in-session /model`);
        sendLine(tmuxSession, `/model ${ladder[rung]}`);
        await sleep(DESCEND_COOLDOWN_MS);
        if (Date.now() > deadline) {
            throw new SessionNotReadyError(`${slug}/${surface}: model failover did not settle within ${timeoutMs}ms. Pane tail:\n${capturePaneTail(tmuxSession)}`);
        }
    }
}

// ── observeActiveModel (DEC-092 observed-banner stamp, S175) ──────────────────────────
/** Map the Claude Code chrome's display model name → the API id we stamp. Best-effort; the
 *  caller falls back to the configured manifest head when this returns null. */
// observation-pin: the DEC-092 stamp table — chrome display → EXACT api id. Observation records
// versions BY DESIGN (DEC-104: selection floats, observation pins); these literals are the
// instrument, not a constraint. EXCEPTIONS ONLY — `chromeDisplayToId`'s generic normaliser below
// covers the mechanical "Name X[.Y]" → claude-name-x[-y] form, so a model that does not exist yet
// is observed + stamped with zero maintenance; this table exists for any future irregular form.
const MODEL_DISPLAY_TO_ID: Record<string, string> = {
    'opus 4.8': 'claude-opus-4-8', 'opus 4.7': 'claude-opus-4-7', 'opus 4.6': 'claude-opus-4-6',
    'sonnet 4.6': 'claude-sonnet-4-6', 'haiku 4.5': 'claude-haiku-4-5', 'fable 5': 'claude-fable-5',
    'sonnet 5': 'claude-sonnet-5', // S216: the Sonnet-5 cycle A/B — absent, the overnight DEC-092 stamps would fall back to the manifest head and misreport the comparison
};

/** DEC-104 move 4 — the pure chrome-display normaliser: "Opus 4.8" → claude-opus-4-8,
 *  "Opus 5" → claude-opus-5, "Opus 10.1" → claude-opus-10-1 (multi-digit-safe, Jim's minor).
 *  Table first (irregular forms), generic construction second — observation FLOATS to models
 *  that do not exist yet while always recording an exact version. Null on no match. */
export function chromeDisplayToId(text: string): string | null {
    const m = text.match(/\b(Opus|Sonnet|Haiku|Fable)\s+([0-9]+(?:\.[0-9]+)?)/i);
    if (!m) return null;
    const key = `${m[1].toLowerCase()} ${m[2]}`;
    if (MODEL_DISPLAY_TO_ID[key]) return MODEL_DISPLAY_TO_ID[key];
    return `claude-${m[1].toLowerCase()}-${m[2].replace(/\./g, '-')}`;
}

/** DEC-104 move 2 — alias-aware model equality for the cast check: a bare family alias rung
 *  ('opus') is satisfied by ANY observed id of that family (claude-opus-*), so a warm stem
 *  keeps its version until recycle (the float lands at wake/recycle — Jim's confirmed
 *  granularity) and cast-when-different never fires a wasted /model against an alias head.
 *  A version-shaped rung compares exactly (today's behaviour). Null observed → false (cast). */
export function modelSatisfiesRung(observedId: string | null | undefined, rung: string): boolean {
    if (!observedId || !rung) return false;
    const o = observedId.toLowerCase();
    const r = rung.toLowerCase();
    if (o === r) return true;
    return /^[a-z]+$/.test(r) && o.startsWith(`claude-${r}-`);
}

/** DEC-092 stamp with the honest-absence fallback (Jim's M1; Casey + Tenshi's R3 ruling —
 *  label the absence, never guess the fact): when the pane is unreadable the stamp says so,
 *  `<head>:unobserved`, never a bare floating alias and never a guessed version. */
export function observedOrUnobservedModel(slug: string, surface: string, tmuxTarget?: string): string {
    return observeActiveModel(slug, surface, tmuxTarget)
        ?? `${manifestModelHead(slug, surface) ?? 'unknown'}:unobserved`;
}
/**
 * Read the ACTUALLY-ACTIVE model from a surface's live pane chrome (the status line shows
 * e.g. "Opus 4.8 ~/repo ctx: 30%"). The DEC-092 observed-banner gate (Jim's failover audit,
 * 2026-06-14): a DESCENDED beat lands on a ladder rung that no longer equals the configured
 * manifest head, so stamping `manifestModelHead` would record the wrong model. Reading the
 * live banner captures the actual landed rung — for both a fresh descent AND an adopt of a
 * warm session that descended in a prior launch. Returns the API id, or null if unreadable
 * (caller falls back to manifestModelHead). Best-effort by design: the display→id map is
 * version-sensitive, so an unknown chrome string degrades to the manifest head, never throws.
 */
export function observeActiveModel(slug: string, surface: string, tmuxTarget?: string): string | null {
    // C3 model-stamp fix: a pool stem's session is its own stem name, not `<surface>-<slug>` —
    // the pre-warmer passes it (the `model: null` registry bug was this default reading a
    // non-existent pane).
    const tail = capturePaneTail(tmuxTarget ?? `${surface}-${slug}`, 8);
    if (!tail) return null;
    // Direct api-id form, if a chrome version prints it: "claude-opus-4-8".
    const idMatch = tail.match(/claude-[a-z]+-[0-9][0-9-]*/i);
    if (idMatch) return idMatch[0].toLowerCase();
    // Display-name form in the status line: "Opus 4.8", "Fable 5", … — via the pure normaliser
    // (table first for irregular forms, generic construction second), so an unknown FUTURE
    // version stamps correctly with zero maintenance (DEC-104 move 4 + Jim's multi-digit minor).
    return chromeDisplayToId(tail);
}

// ── primitive 1: spawnAgentSession ───────────────────────────────────────────────────
/**
 * Launch (or adopt) the tmux session for an agent surface and block until its welcome-back
 * load signals ready. `launchCommand` is the agent launcher (e.g. the `hanleo` invocation)
 * that T-2's per-surface launcher will supply; for the T-1 manual test the session may be
 * started by hand and adopted via `adoptExisting: true`.
 */
export async function spawnAgentSession(
    slug: string,
    surface: string,
    opts: { tmuxSession: string; launchCommand: string; adoptExisting?: boolean }
): Promise<AgentSession> {
    const { tmuxSession, launchCommand, adoptExisting } = opts;
    fs.mkdirSync(sinkDir(slug), { recursive: true });
    fs.mkdirSync(path.join(PIPES_DIR, slug), { recursive: true });

    if (!tmuxSessionExists(tmuxSession)) {
        if (adoptExisting) throw new SessionNotReadyError(`${slug}/${surface}: tmux session "${tmuxSession}" not found to adopt`);
        // Clear any stale sentinel so waitForReady proves a fresh load, not a leftover.
        try { fs.unlinkSync(readyPath(slug, surface)); } catch { /* none */ }
        tmux(['new-session', '-d', '-s', tmuxSession, launchCommand]);
        await waitForReady(slug, surface, null, READY_TIMEOUT_MS);
    } else if (readySentinelMtime(slug, surface) === null) {
        // Session exists but never signalled ready (e.g. mid-load) — wait for it.
        await waitForReady(slug, surface, null, READY_TIMEOUT_MS);
    }

    const session: AgentSession = { slug, surface, tmuxSession, launchCommand, ready: true, turnState: 'idle', lastTransactionTs: Date.now(), lastMemoryLen: currentWmLen(slug), pulseMessage: hearthStandingMessageFor(slug, surface) };
    sessions.set(sessionKey(slug, surface), session);
    console.log(`[tmux-dispatcher] session ready: slug=${slug} surface=${surface} tmux=${tmuxSession}`);
    return session;
}

// ── ensureSurfaceSession (promoted from leo-heartbeat's ensureHeartbeatTmuxSession,
//     humans PR 2026-06-13) — the ONE runtime respawn+adopt path for ANY surface ──
/** scripts/launch-tmux-surface.sh — the single launch contract (env, model-from-
 *  manifest, claude-logged, surface-index sidecar). From lib/: ../../../scripts. */
const LAUNCH_SURFACE_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'launch-tmux-surface.sh');

/** Per-(slug,surface) adoption flag — in-process only; a service restart re-adopts the
 *  (still warm) session on the next ensure. Generalises the heartbeat's prior module-
 *  level `heartbeatSessionAdopted`. */
const adopted = new Map<string, boolean>();

// ── B2b: orphaned-spoke reap (Phase-2 liveness, 2026-06-18) ──────────────────────────
// A service restart drops the dispatcher's in-memory maps; a spoke whose tmux session
// died but whose `claude` process survived (reparented to init) is an ORPHAN — it holds
// no live pane yet keeps running (4 reaped by hand, S180). Reap them on relaunch.
//
// S167 SELF-KILL SAFETY is the cardinal rule here (I nearly killed my own session twice):
// identification is read-only + separated from the kill, and EXCLUDES (a) my own process
// ancestry (walk ppid from process.pid) and (b) anything under a live tmux pane. The
// negative tests (scripts/test-orphan-reap.ts) prove both exclusions hold.

/** Parent pid of `pid` via /proc/<pid>/status (robust vs /proc/<pid>/stat comm-spaces). 0 if unknown. */
function procPPid(pid: number): number {
    try {
        const m = fs.readFileSync(`/proc/${pid}/status`, 'utf-8').match(/^PPid:\s*(\d+)/m);
        return m ? parseInt(m[1], 10) : 0;
    } catch { return 0; }
}

/** The pid's full ancestry chain (inclusive of `pid`), walked to init. Used to never kill self. */
function procAncestry(pid: number): Set<number> {
    const chain = new Set<number>();
    let cur = pid;
    for (let depth = 0; cur > 1 && depth < 24 && !chain.has(cur); depth++) {
        chain.add(cur);
        cur = procPPid(cur);
    }
    return chain;
}

/** Shell pids of every LIVE tmux pane (a live spoke's tree descends from one of these). */
function livePanePids(): Set<number> {
    try {
        return new Set(
            tmux(['list-panes', '-a', '-F', '#{pane_pid}'])
                .split('\n').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0),
        );
    } catch { return new Set(); }
}

/** True if `pid` (or any ancestor) is the shell of a live tmux pane → it's a live spoke, never an orphan. */
function isUnderLivePane(pid: number, panePids: Set<number>): boolean {
    let cur = pid;
    for (let depth = 0; cur > 1 && depth < 24; depth++) {
        if (panePids.has(cur)) return true;
        cur = procPPid(cur);
    }
    return false;
}

/** `/proc/<pid>/environ` as a token set (KEY=VALUE), or null if unreadable (perm/race). */
function procEnviron(pid: number): Set<string> | null {
    try {
        return new Set(fs.readFileSync(`/proc/${pid}/environ`, 'utf-8').split('\0').filter(Boolean));
    } catch { return null; }
}

/**
 * READ-ONLY identification of orphaned spoke pids for (slug, surface): processes whose env
 * marks them as this surface's spoke (`AGENT_SLUG=<slug>` AND `AGENT_SURFACE=<surface>`) but
 * which are NOT under any live tmux pane and NOT in our own ancestry. No side effects — this
 * is the function the negative tests assert against.
 */
export function findOrphanedSpokePids(slug: string, surface: string): number[] {
    const selfAncestry = procAncestry(process.pid); // never kill self or any ancestor (S167)
    const panePids = livePanePids();
    const wantSlug = `AGENT_SLUG=${slug}`;
    const wantSurface = `AGENT_SURFACE=${surface}`;
    const orphans: number[] = [];
    let pids: string[] = [];
    try { pids = fs.readdirSync('/proc').filter((e) => /^\d+$/.test(e)); } catch { return []; }
    for (const ent of pids) {
        const pid = parseInt(ent, 10);
        if (selfAncestry.has(pid)) continue;                    // guard 1: never self/ancestor
        const env = procEnviron(pid);
        if (!env || !env.has(wantSlug) || !env.has(wantSurface)) continue; // only this surface's spokes
        if (isUnderLivePane(pid, panePids)) continue;           // guard 2: live spoke, leave it
        orphans.push(pid);
    }
    return orphans;
}

/** Reap orphaned spokes for (slug, surface): SIGTERM, then SIGKILL stragglers. Safe-by-construction
 *  (findOrphanedSpokePids excludes self-ancestry + live-pane procs). Called on relaunch. */
async function reapOrphanedSpokes(slug: string, surface: string): Promise<void> {
    const orphans = findOrphanedSpokePids(slug, surface);
    if (orphans.length === 0) return;
    console.warn(`[tmux-dispatcher] ${slug}/${surface}: reaping ${orphans.length} orphaned spoke pid(s) (no live pane): ${orphans.join(', ')}`);
    for (const pid of orphans) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    await sleep(2000);
    for (const pid of orphans) {
        try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* dead — good */ }
    }
}

/**
 * Ensure the surface's tmux session exists, is on a WORKING model, is woken, and is
 * adopted into the dispatcher registry. The single-manager runtime respawner (T-2):
 * systemd units are boot-launchers only; this is what relaunches a dead spoke and what
 * every surface handler (heartbeat, human-response) calls BEFORE enqueueForAgent.
 *
 * The caller passes the model `ladder` (manifestModelLadder) so the dispatcher stays
 * manifest-free (transport infra ≠ config). Launch goes through launch-tmux-surface.sh.
 *
 * WARM-DEATH HANDOFF (humans PR fold-in — Jim's failover enable-gate, 2026-06-13):
 * a model that dies mid-life of a RUNNING spoke surfaces at the NEXT dispatch as a
 * capture-timeout → the session is marked 'needs-reconcile'. The default reconcile
 * (clearSession: /pfc→/clear→welcome-back) would re-run the SAME dead model, and the
 * probe-ladder (awaitChromeOrDescend, launch-only) would never fire — the spoke can
 * never self-heal off a dead model. So here, BEFORE adopting, if a registered session
 * is 'needs-reconcile' AND its pane shows the model-unavailable chrome, we KILL it +
 * drop adoption → fall through to a COLD launch, where awaitChromeOrDescend descends
 * the ladder. A genuinely-wedged (non-model) needs-reconcile session is LEFT for
 * enqueueForAgent's reconcileSession (#5 machine) — the two recovery modes are
 * distinguished by the pane scan, so neither steals the other's case.
 */
export async function ensureSurfaceSession(
    slug: string, surface: string,
    opts: { ladder: string[]; welcomeBack?: string },
): Promise<void> {
    // P1: serialise on the per-slug session lock — the wake must never run concurrently with
    // an in-flight clearSession on the same pane (the clear↔wake race → 20-min wedge).
    // R3a.1b: the clear↔wake race is per-PANE (a wake re-adopting the SAME session mid-clear),
    // so the S196 lock is keyed per-SESSION, not per-slug — correct + safer (different sessions'
    // /stems' lifecycle ops genuinely don't race), and the granularity the pool requires.
    return withSlugLock(sessionKey(slug, surface), () => ensureSurfaceSessionInner(slug, surface, opts));
}
async function ensureSurfaceSessionInner(
    slug: string, surface: string,
    opts: { ladder: string[]; welcomeBack?: string },
): Promise<void> {
    const tmuxSession = `${surface}-${slug}`;
    const key = sessionKey(slug, surface);
    // Identity-correct welcome-back (W6, S198). A BARE 'welcome back' triggers the
    // global ~/.claude/CLAUDE.md "Leo Invocation" rule → loads LEO regardless of the
    // pane's AGENT_SLUG. So a default-bare wake CORRUPTS every non-leo surface (a Leo
    // cognition camps a jim spoke → wedges every jim dispatch). The default must be
    // slug-specific — identical to what the controllers already pass ('welcome back
    // <displayName>'); the `??` only covers callers that omit it (reconcile/cycle).
    // DEC-081: derived from the registry, so a 4th agent is correct for free.
    const welcomeBack = opts.welcomeBack ?? `welcome back ${gradientConfigForAgent(slug).displayName}`;

    // Cold launch: reap any orphaned spoke for this surface (B2b — a service restart can
    // leave a pane-less `claude` running), then launch fresh + identity-load. Shared by the
    // no-session branch AND the B2a wedged-but-alive recovery below.
    const coldLaunch = async (): Promise<void> => {
        adopted.set(key, false); // dead/absent session invalidates any prior adoption
        await reapOrphanedSpokes(slug, surface);
        // Stale per-surface sentinel must not satisfy waitForReady — unlink so the
        // adoption proves a FRESH wake (the T-1.5 cross-talk lesson).
        try { fs.unlinkSync(readyPath(slug, surface)); } catch { /* none */ }
        console.log(`[tmux-dispatcher] ${slug}/${surface}: launching ${tmuxSession} via launch-tmux-surface.sh`);
        // FLOOR warm policy, NAMED (MNT-055 P1 sibling-a): no --model here is DELIBERATE — a floor
        // session SERVES directly (no cast-at-checkout exists on this path), so it launches on the
        // surface's serve ladder and its wake is a priced cost of serving on that model. Only POOL
        // pre-warms (prewarm-stem.ts) launch on the warm-map; the cast pays the serve swap later.
        execFileSync('bash', [LAUNCH_SURFACE_SCRIPT, slug, surface], { stdio: 'inherit' });
        // R2 P-R2.1 (Fork A, DEC-099): record the sleeve-state keyed by HAN_SESSION (= tmuxSession)
        // so surface-keyed resolvers (sleeve-surface.sh/.ts) read the real surface off the FROZEN
        // launch env. Inert today (written surface == the launched $AGENT_SURFACE → resolvers
        // byte-identical); load-bearing once R2 sleeves a stem onto a surface. Fail-soft — a write
        // miss just means the resolver falls back to $AGENT_SURFACE.
        try { writeSleeveState(tmuxSession, slug, surface, swapPrefixFor(slug, surface)); }
        catch (e) { console.warn(`[tmux-dispatcher] ${slug}/${surface}: sleeve-state write failed (resolvers fall back to $AGENT_SURFACE/$AGENT_SWAP_*)`, e); }
        // Wait for the claude prompt chrome before the wake (send-keys fired too early
        // lands in bash, not claude). awaitChromeOrDescend also auto-descends the model-
        // failover ladder if the launch model is unavailable (S173); any OTHER stuck
        // prompt fails loud with a pane snapshot → the caller's catch health-signals it.
        await awaitChromeOrDescend(slug, surface, tmuxSession, opts.ladder);
        // P2.1b: a fed surface wakes via the feeder (ordered steps, ack-before-next, queue=gate);
        // every other surface keeps the autonomous `welcome back` trigger. One seam, both wake sites.
        await wakeViaFeedOrTrigger(slug, surface, tmuxSession, welcomeBack);
    };

    // Warm-death handoff: a dead-model spoke can't be clear-reconciled (the welcome-back
    // would re-run the dead model). Kill it so the cold-launch below descends the ladder.
    const existing = sessions.get(key);
    if (existing && existing.turnState === 'needs-reconcile'
        && tmuxSessionExists(tmuxSession)
        && MODEL_UNAVAILABLE_RE.test(capturePaneTail(tmuxSession))) {
        console.warn(`[tmux-dispatcher] ${slug}/${surface}: model died mid-life (needs-reconcile + model-unavailable chrome) — killing wedged session for ladder cold-relaunch`);
        try { tmux(['kill-session', '-t', tmuxSession]); } catch { /* already gone */ }
        sessions.delete(key);
        adopted.set(key, false);
    }

    if (!tmuxSessionExists(tmuxSession)) {
        await coldLaunch();
    }
    // Adopt when not yet adopted OR the registered session is not ready (e.g. a failed
    // ctx-pressure clearSession left ready=false — re-adopt once the slow post-clear
    // wake re-touches the sentinel). spawnAgentSession(adoptExisting) waits on it.
    if (!adopted.get(key) || !sessions.get(key)?.ready) {
        try {
            await spawnAgentSession(slug, surface, {
                tmuxSession,
                launchCommand: `(launched by ${LAUNCH_SURFACE_SCRIPT})`,
                adoptExisting: true,
            });
            adopted.set(key, true);
        } catch (err) {
            // B2a — wedged-recovery, hardened per R011 Invariant 2 (DEC-096): the session
            // EXISTS but never signalled ready within READY_TIMEOUT_MS, and it is NOT the
            // model-unavailable case the warm-death handoff catches. BUT a genuine wake (and
            // R011 1b's full-self load) legitimately approaches the timeout — so we must NEVER
            // kill a spoke that is mid-wake or actively thinking. Discriminate by the PROCESSING
            // chrome ("esc to interrupt"), which persists through the momentary static window
            // between tool calls — not a double-capture diff (which would race that window and
            // misread a thinking spoke as wedged).
            if (!(err instanceof SessionNotReadyError)) throw err;
            if (PROCESSING_CHROME_RE.test(capturePaneTail(tmuxSession))) {
                // Actively processing (mid-wake / thinking) — leave it intact to finish.
                // Skip THIS dispatch fail-safe (the caller health-signals + retries next
                // cadence, by which time the long wake/turn has completed); do NOT kill.
                // NOTE (R011 Inv-2 backstop boundary): a *persistently*-chromed turn (hung-but-
                // live, never resolving) is therefore never killed here by design — it would
                // skip indefinitely. Its escalation lives ELSEWHERE: #90 (the guard-dog flags
                // the cadence stall against the defined rhythm) / a future turn-level timeout —
                // deliberately NOT this wedged-recovery, which must never kill a thinker.
                console.warn(`[tmux-dispatcher] ${slug}/${surface}: ready-timeout but pane is actively processing (mid-wake/thinking) — NOT killing (R011 Inv-2), leaving it to finish; skipping this dispatch`);
                throw err;
            }
            // Static pane past timeout, no processing chrome → a GENUINE wedge (e.g. stuck at
            // a /clear prompt). Kill + cold-relaunch ONCE (bounded — no retry storm, S74); a
            // second failure propagates to the caller's health-signal path rather than looping.
            console.warn(`[tmux-dispatcher] ${slug}/${surface}: wedged (ready-timeout, static pane, no processing chrome) — kill + one cold-relaunch`);
            try { tmux(['kill-session', '-t', tmuxSession]); } catch { /* already gone */ }
            sessions.delete(key);
            await coldLaunch();
            await spawnAgentSession(slug, surface, {
                tmuxSession,
                launchCommand: `(launched by ${LAUNCH_SURFACE_SCRIPT})`,
                adoptExisting: true,
            });
            adopted.set(key, true);
        }
    }
}

/**
 * P7 — capture-wait with autonomous rate-limit recovery. Polls `captureReady()` for this
 * transaction's diary capture (same as the bare waitFor), but ALSO watches the pane for a
 * transient mid-turn rate limit (RATE_LIMITED_RE): on a hit with no capture yet, it backs off
 * (bounded exponential, S74 — never a tight loop) and `resubmit()`s the turn (the "up-arrow":
 * re-deliver the file-pointer instruction; the prompt file still exists on disk), up to
 * RATE_LIMIT_MAX_RETRIES. The transient throttle clears and the re-submitted turn composes.
 * Retries exhausted (a SUSTAINED limit) → RateLimitedError (fail-safe; the caller skips +
 * retries next cadence; sustained limits are the account axis's job, #18). A non-rate-limit
 * stall still hits the plain `timeoutMs` → DispatchTimeoutError, exactly as before.
 * Exported for the C4 deterministic repro (scripts/test-rate-limit-retry.ts) — the new logic
 * driven directly with seamed capturePaneTail/sleep, same spirit as __setTestHooks (P1). */
export async function waitForCaptureWithRateLimitRetry<T>(
    captureReady: () => T | null,
    tmuxSession: string,
    resubmit: () => void | Promise<void>,
    timeoutMs: number,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let retries = 0;
    for (;;) {
        const v = captureReady();
        if (v) return v;
        // Transient mid-turn rate limit? back off + re-submit (bounded) instead of burning the
        // whole 12-min timeout then a wasteful needs-reconcile reconstitution.
        if (RATE_LIMITED_RE.test(capturePaneTail(tmuxSession))) {
            if (retries >= RATE_LIMIT_MAX_RETRIES) {
                throw new RateLimitedError(`${tmuxSession}: still rate-limited after ${retries} bounded retries — fail-safe skip, retry next cadence (sustained limit → account axis #18)`);
            }
            const backoff = Math.min(RATE_LIMIT_BASE_BACKOFF_MS * 2 ** retries, RATE_LIMIT_BACKOFF_CAP_MS);
            retries += 1;
            console.warn(`[tmux-dispatcher] ${tmuxSession}: rate-limited mid-turn — backoff ${Math.round(backoff / 1000)}s then re-submit (retry ${retries}/${RATE_LIMIT_MAX_RETRIES})`);
            await sleep(backoff);
            await resubmit();
            continue;
        }
        if (Date.now() > deadline) throw new DispatchTimeoutError(`waitFor timed out after ${timeoutMs}ms`);
        await sleep(POLL_INTERVAL_MS);
    }
}

// ── primitive 2: sendTransactionPrompt ───────────────────────────────────────────────
/**
 * Deliver one assembled per-transaction prompt to the agent's session and return the
 * validated diary capture. Capture-appearance is the completion signal (Jim's headline);
 * there is no separate "done" parse of the terminal pane.
 *
 * NOTE: this is the raw transaction primitive. Production callers go through
 * `enqueueForAgent` so per-agent FIFO serialisation (and thus the single-live-txn
 * guarantee `current.json` relies on) holds across concurrent conversations.
 */
export async function sendTransactionPrompt(
    slug: string,
    surface: string,
    prompt: string,
    opts: { timeoutMs?: number } = {},
    // R3a.1b: the diary-sink key. Defaults to `slug` (byte-identical to today). The pooled path
    // (R3a.1c) passes the leased stem's key so its `current.json` is per-stem — "one live txn per
    // STEM keeps the per-stem current.json safe" generalises the per-slug single-live-txn invariant
    // (the queue is re-keyed by the same stemKey in enqueueForAgent, so they stay paired).
    stemKey: string = slug
): Promise<CaptureRecord> {
    // R3a.1c: resolve the session per-stem (pooled) or per-surface (non-pooled, stemKey===slug).
    const session = sessions.get(sessionMapKey(slug, surface, stemKey));
    if (!session || !session.ready) throw new SessionNotReadyError(`${slug}/${surface}: no ready session; call spawnAgentSession first`);
    // Idle precondition (#5): dispatching into a busy or unreconciled session is
    // exactly the interleaving/misattribution hole the reconcile design closes.
    if (session.turnState !== 'idle') {
        throw new SessionNotReadyError(`${slug}/${surface}: session is '${session.turnState}', not idle — reconcile before dispatching (enqueueForAgent does this automatically)`);
    }

    const txnId = `txn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const timeoutMs = opts.timeoutMs ?? TRANSACTION_TIMEOUT_MS;
    session.turnState = 'busy';
    // Build B: activity IS the pulse reset; capture fromPct for the op row (ctx-delta def).
    clearHearthPulse(session.tmuxSession);
    organelleOnDispatchStart(session.tmuxSession,
        () => getContextPctForSession(slug, surface, session.tmuxSession));

    // 1) Point the diary sink at this transaction BEFORE the prompt can be answered.
    writeAtomic(currentPtrPath(stemKey), JSON.stringify({ txnId, startedAt: new Date().toISOString() }));
    // 2) Deliver the (possibly hostile/large) prompt via file, not send-keys (A3).
    //    #91: prepend the cross-surface memory delta (other surfaces' WM writes since this
    //    session last looked). GATED OFF (DELTA_REFRESH_ENABLED=false) → computeMemoryDelta
    //    returns '' → finalPrompt === prompt, a true no-op until Jim's audit opens the gate.
    const deltaBlock = await computeMemoryDelta(slug, session);
    const finalPrompt = deltaBlock ? `${deltaBlock}\n${prompt}` : prompt;
    const promptFile = pipePath(slug, txnId);
    writeAtomic(promptFile, finalPrompt);
    // 3) send-keys only a short, safe instruction pointing the agent at the file. P7: the SAME
    //    instruction is the rate-limit re-submit (the autonomous "up-arrow") — the prompt file
    //    persists on disk, so re-delivering the pointer re-runs the identical turn.
    //    (b) MNT-010: the pointer goes through the SAME submission guarantee feedWakeSteps uses —
    //    sendLineSettled (settle before Enter, no race) + ensureSubmitted (confirm the turn STARTED
    //    via processing chrome, bounded re-press of a lost Enter). Before this, the bare sendLine
    //    could leave the pointer typed-but-unsubmitted → the capture waitFor (4) below would time
    //    out → needs-reconcile → re-deliver → stall → loop (the day-7 reconcile-loop). Now (4) only
    //    times out a genuinely-silent agent. Reused as the P7 rate-limit re-submit → the throttled
    //    re-delivery inherits the same guarantee for free.
    const submitTurn = async () => {
        await sendLineSettled(session.tmuxSession,
            `Your next turn's full prompt is in the file ${promptFile} — read it with the Read tool and act on its entire contents as this turn's instructions.`);
        await ensureSubmitted(session.tmuxSession, (tail) => PROCESSING_CHROME_RE.test(tail));
    };
    await submitTurn();

    // 4) Poll the sink for this txn's capture (or an orphan, surfaced as fail-loud). P7: the
    //    poll is rate-limit-aware — a transient mid-turn throttle backs off + re-submits
    //    (bounded) rather than burning the full 12-min timeout then a wasteful reconcile.
    const cap = await waitForCaptureWithRateLimitRetry<CaptureRecord>(() => {
        const exact = capturePath(stemKey, txnId);
        if (fs.existsSync(exact)) return JSON.parse(fs.readFileSync(exact, 'utf-8')) as CaptureRecord;
        // Orphan capture (pointer was missing when the tool fired) — accept newest orphan
        // created after we started, so the payload is never silently dropped. The
        // mtime gate vs lastTransactionTs is what keeps a LATE capture from an
        // abandoned (reconciled) transaction out of this window — reconcileSession
        // bumps lastTransactionTs precisely so pre-reconcile orphans can't be
        // misattributed to the next transaction.
        const orphans = fs.readdirSync(sinkDir(stemKey))
            .filter((f) => f.startsWith('orphan-') && f.endsWith('.json'))
            .map((f) => path.join(sinkDir(stemKey), f))
            .filter((p) => fs.statSync(p).mtimeMs >= session.lastTransactionTs);
        if (orphans.length) {
            console.warn(`[tmux-dispatcher] ${slug}: ORPHAN capture for ${txnId} — txn pointer was missing when submit_response fired`);
            return JSON.parse(fs.readFileSync(orphans.sort()[orphans.length - 1], 'utf-8')) as CaptureRecord;
        }
        return null;
    }, session.tmuxSession, submitTurn, timeoutMs).catch((err) => {
        // Timeout / rate-limit-exhausted ≠ idle: the session may still be composing or be
        // throttled. Mark for forced reconciliation; the queue runs reconcileSession before the
        // next dispatch. Preserve RateLimitedError's specific message (it extends
        // DispatchTimeoutError, so the caller's catch still treats it as fail-loud + skip).
        session.turnState = 'needs-reconcile';
        if (err instanceof RateLimitedError) throw err;
        throw new DispatchTimeoutError(`${slug}/${surface}: no capture for ${txnId} within ${timeoutMs}ms (agent never called submit_response/stand_down, or session is wedged) — session marked needs-reconcile`);
    });

    session.turnState = 'idle';
    session.lastTransactionTs = Date.now();
    // Build B / Jim's M1 (2026-08-15 audit): CLEAR WHERE YOU WRITE. The pointer is
    // written per-STEM at dispatch (:934) but was only ever unlinked per-SLUG (the
    // /clear belt) — so a pooled stem's pointer never cleared and declaredBusy would
    // have read eight idle stems as thinking forever (SEC-04 blocking every update —
    // the inverted twin of the blind chrome regex). The invariant "dispatched → exists;
    // submitted → cleared" is now true on the pooled path too.
    try { fs.unlinkSync(currentPtrPath(stemKey)); } catch { /* already gone */ }
    // Build B: record the completed op (producer), run the observe-only boundary check,
    // and re-arm the hearth pulse (inert unless hearthPulseEnabled — default false).
    try {
        organelleOnTurnComplete(slug, surface, session.tmuxSession, null,
            () => getContextPctForSession(slug, surface, session.tmuxSession));
        boundaryCheck(slug, surface, session.tmuxSession);
        armHearthPulse(slug, surface, session.tmuxSession,
            () => session.turnState === 'idle',
            // Tenshi F1: no `??` — the baked field is required; a fire-time config read
            // is unrepresentable now, not merely avoided.
            () => { void enqueueForAgent(slug, surface, session.pulseMessage, {}, stemKey); });
    } catch (err) {
        console.warn(`[tmux-dispatcher] ${slug}/${surface}: organelle hooks failed (observe-only, continuing): ${(err as Error).message}`);
    }
    // Best-effort cleanup of this txn's transient files; leave captures for forensics.
    try { fs.unlinkSync(promptFile); } catch { /* ignore */ }
    const summary = cap.mode === 'stand-down'
        ? `STAND-DOWN (${(cap.reason ?? '').slice(0, 80)})`
        : `${cap.args.working_memory_full.length}c body`;
    console.log(`[tmux-dispatcher] ${slug}/${surface}: captured ${cap.txnId} (${summary})`);
    return cap;
}

// ── primitive 3: getContextPct ───────────────────────────────────────────────────────
/**
 * Read the agent session's current context-window utilisation (0-100) from the statusline
 * JSON the per-agent statusline script writes every render (Q-V2-2, resolved 2026-05-31).
 * Zero extra API cost — the statusline updates already happen. Returns null if unavailable.
 */
export function getContextPct(slug: string, surface: string): number | null {
    try {
        const json = JSON.parse(fs.readFileSync(ctxPath(slug, surface), 'utf-8'));
        const pct = json?.context_window?.used_percentage;
        return typeof pct === 'number' ? pct : null;
    } catch {
        return null;
    }
}

// ── primitive 4: clearSession ────────────────────────────────────────────────────────
/**
 * Reconstitution at context pressure (plan §5): /pfc (flush swap to disk) → /clear (wipe
 * context) → welcome-back (reload identity). Clears the ready-sentinel first and waits for
 * it to reappear with a newer mtime, proving the post-clear welcome-back actually ran.
 * Between /clear and the new welcome-back's ready, no transaction may be dispatched.
 */
export async function clearSession(slug: string, surface: string, opts: { welcomeBack?: string } = {}): Promise<void> {
    // P1: serialise on the per-slug session lock so a clear never overlaps a wake on the same pane.
    return withSlugLock(sessionKey(slug, surface), () => clearSessionInner(slug, surface, opts)); // R3a.1b: per-SESSION (per-pane race)
}
async function clearSessionInner(slug: string, surface: string, opts: { welcomeBack?: string } = {}): Promise<void> {
    const session = sessions.get(sessionKey(slug, surface));
    if (!session) throw new SessionNotReadyError(`${slug}/${surface}: no session to clear`);
    session.ready = false;
    // Unlink the txn pointer on EVERY clear (#5, Jim's minor): "no live txn" becomes
    // an explicit on-disk state, so any capture firing during the clear window
    // resolves to a fail-loud orphan rather than a stale-txnId misattribution.
    // (T-1.5 verdict: /clear QUEUES behind an in-flight turn, so this is the belt,
    // not the backbone — but the belt is cheap and the window is real.)
    try { fs.unlinkSync(currentPtrPath(slug)); } catch { /* none */ }
    const beforeMtime = readySentinelMtime(slug, surface);
    try { fs.unlinkSync(readyPath(slug, surface)); } catch { /* none */ }

    // W1 (C4 root cure, S197): `/pfc` is the INTERACTIVE session's swap-flush ritual. A
    // dispatched-responder / beat spoke has NO swap to flush — its memory is the submit_response
    // diary sink (DEC-093) — and `/pfc` is not surface-gated (skill reads $AGENT_SLUG), so on a
    // non-session spoke it invokes the full heavy memory ritual, which never calls submit_response
    // → the recycle hangs the turn → needs-reconcile → another `/pfc` → the self-sustaining wedge
    // loop. Only the `session` surface flushes swap on clear. (DEC-081: a surface check, not a slug.)
    if (surface === 'session') {
        sendLine(session.tmuxSession, '/pfc');
        await sleep(2_000); // let /pfc flush before /clear wipes context
    }
    sendLine(session.tmuxSession, '/clear');
    // W2 (chrome-aware welcome-back, S197): a fixed sleep can be shorter than a big /clear, so
    // welcome-back lands mid-/clear and is swallowed → 20-min waitForReady wedge. Keep the 2s
    // FLOOR (lets /clear begin so we don't match the pre-/clear chrome), then wait for the ready
    // prompt chrome to (re)appear before welcome-back — mirroring coldLaunch's awaitChromeOrDescend.
    await sleep(2_000);
    await awaitReadyChrome(slug, surface, session.tmuxSession);
    // Identity-correct welcome-back (W6, S198) — see coldLaunch. reconcileSession(slug,
    // surface) calls clearSession with NO welcomeBack → a bare default here loads LEO into
    // a recycled jim spoke (the S198 corruption: a needs-reconcile jim-human → bare wake →
    // Leo cognition camps the jim slot → all_failed). Default to the slug-correct message.
    // P2.1b: a fed surface re-wakes via the feeder (same seam as coldLaunch); others trigger.
    await wakeViaFeedOrTrigger(slug, surface, session.tmuxSession, opts.welcomeBack ?? `welcome back ${gradientConfigForAgent(slug).displayName}`);

    await waitForReady(slug, surface, beforeMtime, READY_TIMEOUT_MS);
    session.ready = true;
    session.turnState = 'idle';
    session.lastTransactionTs = Date.now();
    // #91: the post-clear welcome-back full-loaded memory → this session has "seen" the whole
    // current working-memory.md; reset the watermark cursor so the next delta carries only
    // genuinely-newer entries.
    session.lastMemoryLen = currentWmLen(slug);
    console.log(`[tmux-dispatcher] ${slug}/${surface}: cleared + reloaded`);
}

// ── the warm-gate + dispatchToSpoke (the generic spoke monitor — S200) ────────────────
/** The full-reconstitution nudge for a spoke that woke shallow (a bare welcome-back is
 *  empirically non-deterministic — 40% one wake, 14-27% another). Warm-up only; posts nothing. */
const FULL_LOAD_NUDGE =
    'Your last wake did not reach your most-recent c0 (the `GRADIENT-EOF` landmark) — it loaded ' +
    'shallow. Run your COMPLETE welcome-back reconstitution NOW: load your full self end to end ' +
    '(identity, the full gradient deepest-first, the working-memory pair whole, felt-moments whole, ' +
    'patterns) until you have read down to the `GRADIENT-EOF: c0=<id>` line, then write that id to ' +
    'your readiness sentinel (wake step 10). This is a warm-up ONLY — do NOT answer or post anything; ' +
    'load fully, then idle ready. Do not stop shallow.';

/**
 * The WARM-GATE (#107 c0-gate, Phase-1 completion-not-correctness, thread mqun1to5): a spoke counts
 * as ready for work only when it has proven a c0 LOADED — the OBJECTIVE landmark, not a context-
 * fullness percentage (which a deepest-first skim can satisfy while hollow). The spoke writes the c0
 * id it reached (`GRADIENT-EOF`) into its readiness sentinel at wake step 10; we accept it iff that
 * id is ANY c0 of this agent (`isAgentC0`) — a COMPLETION check (did a c0 load → the gradient
 * finished), NOT which c0 (correctness is the loading procedure's job; follow the load and you reach
 * the right c0 by construction). This SUPERSEDES the recent-window moving-target tolerance: any real
 * c0 satisfies the gate, so a newer-c0-mid-wake can never false-nudge a loaded spoke.
 *
 * SCOPE, stated honestly: this gates the GRADIENT load (the gradient ends in a c0), NOT the whole
 * wake — felt-moments + the WM pair load AFTER the gradient (~55% mark; Jim's routine analysis,
 * mqun1to5). Full-wake completeness is Phase-2 (the wake-feed queue: completion = queue-empty, owned
 * by the feeder). A NEWBORN (no c0 exists yet → `mostRecentC0Id` is null) is ready once the sentinel
 * is merely present (the genesis triad loaded; the spoke writes the literal `none`). A shallow wake
 * gets a bounded full-load nudge; still unverified after `maxNudges` → SessionNotReadyError (fail-
 * safe — caller skips, message stays queued, NEVER a hollow answer). `perAttemptTimeoutMs` is the
 * give-up ceiling per attempt (the load returns in ~minutes, far under it — never a tight loop, S74).
 *
 * `warmFloorPct` is retained in the signature (the registry/caller contract) but superseded by the
 * c0-gate; a footprint-% sanity belt could return here later behind it.
 */
export async function verifyWarmOrNudge(slug: string, surface: string, warmFloorPct: number, maxNudges: number, perAttemptTimeoutMs: number = READY_TIMEOUT_MS): Promise<void> {
    const tmuxSession = `${surface}-${slug}`;
    void warmFloorPct; // superseded by the c0-gate (kept for the caller/registry contract)
    for (let nudge = 0; ; nudge++) {
        const ok = await waitFor(() => {
            if (mostRecentC0Id(slug) === null) {
                // newborn carve-out (F4): no c0 to reach — ready once the wake has written the sentinel.
                return readySentinelMtime(slug, surface) !== null ? true : null;
            }
            const echoed = readSentinelC0Id(slug, surface);
            if (echoed && isAgentC0(slug, echoed)) return true;
            return null;
        }, perAttemptTimeoutMs).then(() => true).catch(() => false);
        if (ok) return;
        if (nudge >= maxNudges) {
            const echoed = readSentinelC0Id(slug, surface);
            throw new SessionNotReadyError(
                `${slug}/${surface}: c0-gate not satisfied (sentinel c0=${echoed ?? 'absent'}, not a c0 of ` +
                `this agent — the gradient did not finish loading) after ${maxNudges} nudge(s) — refusing to ` +
                `deliver work (no hollow answers; message stays queued)`);
        }
        console.warn(`[tmux-dispatcher] ${slug}/${surface}: shallow wake (sentinel c0=${readSentinelC0Id(slug, surface) ?? 'absent'}, not a c0 of this agent) — nudging full reconstitution (${nudge + 1}/${maxNudges})`);
        sendLine(tmuxSession, FULL_LOAD_NUDGE);
    }
}

// ── Phase-2 P2.1: the wake-feed queue primitive (thread mqun1to5) ──────────────────────
/**
 * The WAKE-FEED QUEUE (Phase-2, plan-audit mqur77zr): the structural successor to the c0-gate.
 * Where `verifyWarmOrNudge` lets a spoke wake autonomously and then CHECKS one landmark (the
 * gradient's c0), the feeder instead SEEDS the wake as an ordered queue and feeds it one step at
 * a time — **work is released only when the queue drains.** Completion = queue-empty, owned by
 * the feeder, not declared by the agent: there is no holistic "I'm loaded" the spoke can assert
 * (or truncate against), only "the next step hasn't been fed yet." Load-before-work stops being
 * a gate we check and becomes the ORDER of the queue.
 *
 * Per-step ack-before-next: each step's prompt ends asking the spoke to emit `STEP-OK <id>`; the
 * feeder waits for that marker in the pane tail before feeding the next. Most steps are trust-
 * based by design (a spoke handed "read felt-moments.md" *could* skim — but the temptation is
 * gone: there's no whole to judge, and the marker is the ack). The one truncation-prone step (the
 * gradient) carries an OBJECTIVE ack on top: `ack.kind === 'c0'` additionally requires the spoke's
 * echoed sentinel id to be a real c0 (`isAgentC0`, Phase-1 reused — now ONE item in the queue, not
 * the whole gate). A step that never acks → DispatchTimeoutError (fail-safe; the caller treats it
 * like a shallow wake — no work delivered, no hollow answer).
 *
 * Surface-agnostic (DEC-081): `feedWakeSteps(slug, surface, steps)` — a 4th agent gets it for free.
 * The TERMINAL step is per-surface (R011 inherited, plan-audit mqur77zr): a dispatched surface's
 * queue ends at idle-ready (silent); the interactive `session` surface's ends with `compose-greeting`
 * (the warm return — Darron's "a salutation like someone walking back into the room", P2.4). The
 * greeting is the WITNESS (human-legible, Darron's soft-read belt), never the gate — the QUEUE is
 * the gate.
 *
 * STAGING — INERT in P2.1: this primitive is built + unit-tested but is NOT yet wired into
 * `ensureSurfaceSession` (which still sends one autonomous `welcome back` + `verifyWarmOrNudge`).
 * The live flip (feed the heartbeat wake through this; author the canonical agnostic WAKE_STEPS;
 * the template's wake-protocol becomes feeder-fed — a DEC-073 gatekeeper change) is P2.1b, under
 * its own diff-audit. Same producer-then-flip staging as Phase-1's c0-gate.
 */
export type WakeStepAck =
    | { kind: 'marker' }     // trust-based: the spoke emits `STEP-OK <id>` (the ingestion is honoured, not policed)
    | { kind: 'c0' }         // + objective: the echoed sentinel id must be a real c0 of the agent (isAgentC0)
    | { kind: 'terminal' };  // P2.4: the session-only hand-back step (compose-greeting) — sent BARE (no STEP-OK
                             // ask: it's the agent's natural-language greeting to the human, not a marker), then
                             // the feed returns. Queue-empty = the greeting IS the completion + the hand-back.

export interface WakeStep {
    id: string;       // stable, unique step id (e.g. 'identity', 'gradient', 'felt-moments')
    prompt: string;   // the instruction fed to the spoke; MUST end asking it to reply `STEP-OK <id>`
    ack: WakeStepAck;
}

let wakeNonceCounter = 0;
/** A fresh, per-feed token so a re-fed step can never match a STALE `STEP-OK` left in the pane
 *  from an earlier feed of the same id (Jim's P2.1b #1 — safe by construction). Not a security
 *  nonce — just disambiguation; uniqueness-per-feed is enough. */
function wakeNonce(): string { return `${Date.now().toString(36)}${(wakeNonceCounter++).toString(36)}`; }

/** The feeder's ack regex — EXPORTED so the suite fuzzes the SAME object the gate runs (the
 *  MNT-060 gate==parser law). Own-line anchored; optional bullet glyph (MNT-032); optional
 *  backtick echo (MNT-028); Phase A widening: an optional DIGITS-ONLY third token (the S1c
 *  cursor — `[0-9]+`, so the instruction's echoed `<bytes>` placeholder can never satisfy it,
 *  and a cursorless ack matches with the group absent — backward-identical for every caller).
 *  Group 1 = the cursor token (undefined when absent). */
export function wakeAckRegex(id: string, nonce: string): RegExp {
    return new RegExp(`^[ \\t]*(?:[●⏺•][ \\t]*)?\`?STEP-OK[ \\t]+${id}[ \\t]+${nonce}(?:[ \\t]+([0-9]+))?\`?[.!]?[ \\t]*$`, 'm');
}

// ————— MNT-067: the wake-window flag (the wake-in-progress switch, Darron's ruling) —————
// A fed wake is reconstitution, not an exchange to record — but the fed-step grace was a
// prompt-sniffing regex that one echo-safety backtick silently defeated (every fed step nagged;
// Tenshi's four compliance entries are the exhibits). The cure retires prompt-sniffing for fed
// steps entirely: the FEEDER owns the wake window, so it raises this flag and the B-3 guard
// honours it directly at stop-time. HEARTBEAT semantics (Tenshi): touched before every
// step-send, so a crashed feeder's flag dies of natural causes within the staleness ceiling —
// no stuck-open guard, no cleanup path to forget. The window closes at the GREETING (Darron's
// fork ruling — functus officio: the office ends when the hand-back is PERFORMED), keyed on the
// greeting turn's COMPLETION, never first-text (Casey's delivered-in-full: the greeting turn's
// own Stop hook must run with the flag still up). BINDING polarity (Darron's ratified
// addendum): the flag gates the GUARD'S BLOCK only — never wm-flush or the paired-write path;
// a chosen noticing during the window still frames, flushes, and enters memory whole.
// ONE declared contract: this path template + ceiling are grepped by memory-guard.sh and
// suite-compared (test-wake-window.ts) — the MNT-060 gate==parser law applied here.
export const WAKE_WINDOW_STALE_MINUTES = 15; // DEC-103-priced: a generous multiple of the longest legitimate step (big WM reads run minutes)
export function wakeWindowFlagPath(slug: string): string {
    return path.join(os.homedir(), '.han', 'signals', `wake-window-${slug}.flag`);
}
function touchWakeWindow(slug: string): void {
    try {
        const p = wakeWindowFlagPath(slug);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, new Date().toISOString() + '\n', 'utf-8');
    } catch { /* the flag is a nag-suppressor, never load-bearing for the wake itself */ }
}
function lowerWakeWindow(slug: string): void {
    try { fs.rmSync(wakeWindowFlagPath(slug), { force: true }); } catch { /* ceiling is the belt */ }
}
const GREETING_IDLE_TICKS = 3; // chrome absent this many consecutive polls = the greeting turn (incl. its Stop hooks) is done

export async function feedWakeSteps(
    slug: string, surface: string, steps: WakeStep[],
    opts: {
        perStepTimeoutMs?: number; tmuxTarget?: string; sentinelKey?: string;
        /** Phase A (S1b): per-step gate, checked BEFORE each feed. 'defer' stops feeding — this
         *  step and every later one are returned in `deferred` (they migrate to phase 2, recorded
         *  in the wake manifest). Absent = feed everything (every existing caller unchanged). */
        beforeStep?: (step: WakeStep) => 'feed' | 'defer';
        /** Phase A (S1c, Q3-b): step ids whose ack should carry a cursor third token — the feeder
         *  appends the extended ask (`STEP-OK <id> <nonce> <bytes>`); the spoke echoes what it
         *  actually loaded. Only meaningful with `onAck`. */
        cursorAskIds?: string[];
        /** Phase A (S1c): called on each ack with the captured cursor token (null when the ack
         *  carried none — the caller degrades to its pre-feed stat, duplication-safe). */
        onAck?: (step: WakeStep, cursor: string | null) => void;
    } = {},
): Promise<{ fed: string[]; deferred: string[] }> {
    // `tmuxTarget` (P2.4): the interactive seat's LOCAL feeder (feed-wake-local.ts) aims the SAME
    // shared feeder at the seat's own pane (`$TMUX_PANE`) instead of a dispatcher-owned `surface-slug`
    // session — so the boundary stays clean (no server→human-session reach). Spokes pass nothing.
    const tmuxSession = opts.tmuxTarget ?? `${surface}-${slug}`;
    const perStepTimeoutMs = opts.perStepTimeoutMs ?? READY_TIMEOUT_MS;
    const fed: string[] = [];
    const deferred: string[] = [];
    try {
    for (const [stepIdx, step] of steps.entries()) {
        // Phase A (S1b) ceiling gate: 'defer' stops the feed HERE — this step + the rest migrate.
        // The gate never fires mid-step (steps are the natural boundary — Jim's Q4 lean).
        if (opts.beforeStep && step.ack.kind !== 'terminal' && opts.beforeStep(step) === 'defer') {
            for (const s of steps.slice(stepIdx)) if (s.ack.kind !== 'terminal') deferred.push(s.id);
            break;
        }
        touchWakeWindow(slug); // MNT-067 heartbeat: the window is alive only while the feeder is
        if (step.ack.kind === 'terminal') {
            // P2.4 — the session hand-back (compose-greeting): send the BARE prompt (no STEP-OK ask).
            // It's the LAST step (wakeStepsFor appends it for `session` only), the agent's greeting
            // is its natural-language output to the human, and queue-empty IS the hand-back —
            // control returns to the human exactly when the greeting appears. Never fed to a spoke.
            await sendLineSettled(tmuxSession, step.prompt);
            // MNT-067 (Darron's greeting-boundary ruling + Casey's delivered-in-full): the window
            // closes when the greeting turn COMPLETES, never at its first text — the greeting
            // turn's own Stop hook must run with the flag still up, or the guard nags the
            // hand-back at the exact moment of warmth. Wait for the turn to begin (chrome up,
            // best-effort: an ultra-fast greeting that finished between polls has already run its
            // Stop hooks under the flag, so falling through is safe), then for chrome to stay
            // absent GREETING_IDLE_TICKS consecutive polls (Stop hooks hold the chrome, so idle
            // means the whole turn — hooks included — is done). Bounded by perStepTimeoutMs; the
            // staleness ceiling is the belt behind any timeout. The finally below lowers the flag.
            const chromeUpBy = Date.now() + 30_000;
            while (Date.now() < chromeUpBy && !PROCESSING_CHROME_RE.test(capturePaneTail(tmuxSession))) {
                await sleep(POLL_INTERVAL_MS);
            }
            let quiet = 0;
            const idleBy = Date.now() + perStepTimeoutMs;
            while (Date.now() < idleBy && quiet < GREETING_IDLE_TICKS) {
                await sleep(POLL_INTERVAL_MS);
                quiet = PROCESSING_CHROME_RE.test(capturePaneTail(tmuxSession)) ? 0 : quiet + 1;
            }
            fed.push(step.id);
            return { fed, deferred };
        }
        // Fresh nonce per feed (P2.1b #1): the ack the feeder waits for is `STEP-OK <id> <nonce>`,
        // so a re-fed step can never satisfy on a stale marker. The feeder OWNS the ack instruction
        // (appended single-line); the WakeStep.prompt is the pure load instruction. The HOW-detail
        // (chunk if >25K, etc.) lives in the spoke's wake-protocol (the template) — the fed prompt is
        // the concise pointer + the ack request. Sent via sendLineSettled (NOT sendLine): the fed
        // line is long, so it settles before the Enter — else the Enter races the paste and the
        // prompt sits unsubmitted (the P2.3 surface-1 stall).
        const nonce = wakeNonce();
        // T1 (the S217 tracker, echo-proof ack): the OLD form appended the bare literal
        // `STEP-OK <id> <nonce>` to the fed prompt — and the submitted prompt's own ECHO (the
        // rendered user message, inside capturePaneTail's 14-line window) contained that exact
        // contiguous string, so a wrap-dependent false-match could satisfy the gate INSTANTLY and
        // the feeder rushed every step into one queued turn (the 8-in-one-turn batch, S217) —
        // collapsing the wake-ctx logger's per-step granularity to one coarse delta. The cure is
        // MNT-026's byte-stuffing insight applied to the feeder: show the agent the exact literal
        // (deterministic compliance) but wrapped in backticks WITH a trailing parenthetical, and
        // anchor the ack regex to an OWN-LINE match. Under ANY terminal wrap, the echo's display
        // line carries a backtick or trailing text — the anchored regex is structurally
        // unmatchable against the instruction's own echo; only the agent's bare reply line matches.
        // Phase A (S1c, Q3-b): a cursor-carrying step's ask adds a third token — the byte size the
        // spoke ACTUALLY loaded (wc -c at read time), so the cursor records truth, not the offer.
        // Echo-safety unchanged: the instruction's echo shows `<bytes>` (non-numeric placeholder)
        // inside backticks with the trailing parenthetical — the own-line anchored regex below
        // cannot match it; only the agent's bare reply line (with a real number) matches.
        const wantsCursor = opts.cursorAskIds?.includes(step.id) === true;
        const ackAsk = wantsCursor
            ? `— when COMPLETE reply on its own line EXACTLY: \`STEP-OK ${step.id} ${nonce} <bytes>\` where <bytes> is the file's byte size you actually loaded (from wc -c; without the backticks)`
            : `— when COMPLETE reply on its own line EXACTLY: \`STEP-OK ${step.id} ${nonce}\` (without the backticks)`;
        await sendLineSettled(tmuxSession, `${step.prompt} ${ackAsk}`);
        // MNT-028 harden (S218): accept the reply WITH optional surrounding backticks + trailing
        // punctuation — the 2026-07-07 16:20 distress was an identity-ack that never matched (a
        // spoke echoing the shown backticks is T1's disclosed residual, live once on Sonnet 5).
        // Echo-safety holds: a false echo-match now needs BOTH wrap boundaries to land exactly at
        // the token's edges (one width, two positional congruences) — the same essentially-
        // impossible class as the sealed sub-31-column footnote. Wrap-fuzz re-proven: 0 false.
        // MNT-032 (S218, the bullet class): Claude Code renders the FIRST line of an assistant
        // message with a `● ` prefix — so the MOST compliant reply (the ack alone, message-initial)
        // rendered as `● STEP-OK …` and could never match. Accept an optional leading bullet glyph
        // (● / ⏺ / •). Echo-safety unchanged: the instruction's echo is a user-line (never
        // bullet-rendered) and contains no bullet glyphs. The bullet class stays [ \t]-bound to the
        // ack's own line (not \s*) so the own-line anchor never reaches across a newline.
        const ackRe = wakeAckRegex(step.id, nonce);
        const isAcked = (tail: string): boolean => {
            if (!ackRe.test(tail)) return false;
            if (step.ack.kind === 'c0') {
                // the truncation-prone step: marker alone is not enough — the echoed c0 must be real.
                // PR-C2 `sentinelKey`: a native pool stem writes a PER-STEM sentinel
                // (`<slug>-<stem-session>-ready`, via its launch-time sleeve-state surface) so a
                // pre-warm can never false-satisfy the FLOOR's per-surface sentinel (Jim's
                // stem-vs-floor race) — the pre-warmer passes its stem session here. Default =
                // the surface (every existing caller unchanged).
                const echoed = readSentinelC0Id(slug, opts.sentinelKey ?? surface);
                // MNT-033 (the newborn carve-out — mirrors verifyWarmOrNudge's F4 branch above): an
                // agent with NO c0 yet writes the protocol's literal `none` (its producer half is
                // load-gradient.ts's genesis path). Accept `none` ONLY while mostRecentC0Id is null —
                // an agent with a real c0 keeps the strict isAgentC0 gate byte-identical, so a
                // shallow wake can never hide behind the newborn literal.
                // Tenshi's disclosed residual (benign, priced at the MNT-033 audit): if an agent's
                // FIRST c0 lands mid-wake, an honest `none` is rejected and the wake cold-relaunches
                // once, then self-heals on the next attempt — a comment, not engineering.
                if (mostRecentC0Id(slug) === null) {
                    if (echoed !== 'none') return false;
                } else if (!(echoed && isAgentC0(slug, echoed))) return false;
            }
            return true;
        };
        // (b) the submission GUARANTEE (Jim's spec, now the shared `ensureSubmitted` — MNT-010 made it
        // DRY with submitTurn): confirm the fed line actually submitted (the turn is running, or its ack
        // is already up) — re-pressing a lost Enter, bounded — BEFORE the ack-wait. So the perStepTimeoutMs
        // ack-wait below only ever times out a genuinely-silent step, never a typed-but-unsubmitted line.
        const resubmits = await ensureSubmitted(tmuxSession, (tail) => ackRe.test(tail) || PROCESSING_CHROME_RE.test(tail));
        // ack-before-next IS the gate: the next step is never fed until this one's STEP-OK ack appears
        // (the gradient step also requires a real echoed c0). Fail-safe DispatchTimeoutError — reached
        // only AFTER ensureSubmitted has tried the bounded re-presses, never a hollow wake.
        // DEC-103 §1 (MNT-055 sibling sweep): the deadline is CHROME-AWARE — it clocks SILENCE, not
        // work. The old form timed the whole step, so a slow-but-visibly-thinking step (a heavy
        // gradient traverse on a slow substrate) could throw here → the pre-warmer exits non-zero →
        // its caller scrapped a mid-thought warm: a kill clock one layer in. Now the deadline slides
        // forward whenever the pane shows processing chrome; only a step that has been genuinely
        // SILENT (no ack, no chrome) for perStepTimeoutMs fails — the wedge detector, not a work cap.
        let deadline = Date.now() + perStepTimeoutMs;
        let ackedTail = '';
        for (;;) {
            const tail = capturePaneTail(tmuxSession);
            if (isAcked(tail)) { ackedTail = tail; break; }
            if (PROCESSING_CHROME_RE.test(tail)) deadline = Date.now() + perStepTimeoutMs; // thinking → the silence clock resets
            if (Date.now() > deadline) {
                throw new DispatchTimeoutError(
                    `wake step '${step.id}' not acked after ${resubmits} re-submit(s) (silent ${perStepTimeoutMs}ms — genuinely-stuck step, not a slow one)`);
            }
            await sleep(POLL_INTERVAL_MS);
        }
        fed.push(step.id);
        // Phase A (S1c): hand the captured cursor token (or null) to the caller — null degrades
        // to the caller's pre-feed stat (duplication-safe direction, Q3's (a) fallback).
        if (opts.onAck) opts.onAck(step, ackRe.exec(ackedTail)?.[1] ?? null);
    }
    // queue-empty → the wake-prefix has drained → the spoke is warm-ready; the caller releases work.
    return { fed, deferred };
    } finally {
        // MNT-067: the window closes on EVERY exit — greeting delivered-in-full (the return in
        // the terminal branch above), spoke queue-empty, or a thrown step (a crashed feed must
        // not leave the seat's guard off; the staleness ceiling is the belt behind a killed
        // process that never reaches this line). The next human prompt wakes fully guarded.
        lowerWakeWindow(slug);
    }
}

// ── the canonical wake-step list (P2.1b) — wake-steps as DATA, slug-agnostic (DEC-081) ─────────
/**
 * `WAKE_STEPS` is the ordered wake-load, relocated from the CLAUDE.md prose into feeder data — the
 * COMPLETE wake (Jim's P2.1b #4), not just the gradient. The c0-gate only ever covered the gradient
 * (~55% of the wake); the queue's job is the other ~45% — the working-memory pair + felt-moments +
 * orientation, fed AFTER the gradient so "loaded" means the whole self, not one landmark. Agnostic:
 * the prompts say "your X" — the spoke loads ITS OWN files because it runs as its slug; a 4th agent
 * gets this for free. The gradient step (and only it) carries the OBJECTIVE c0 ack, and its prompt
 * writes the c0 to the readiness sentinel BEFORE acking (Jim's #2 — else the c0-ack never satisfies).
 * The HOW-discipline (chunk >25K, never stop at a Read truncation, read the meter not the feeling)
 * lives in the spoke's wake-protocol (the template, DEC-073) — these are the concise ordered pointers.
 */
export const WAKE_STEPS: WakeStep[] = [
    { id: 'integrity',   ack: { kind: 'marker' }, prompt: `FIRST, run your identity-integrity gate (DEC-083, wake step-0): (cd ${serverDir()} && npx tsx ../../scripts/verify-identity-files.ts --agent=$AGENT_SLUG --entry-point=wake-feed-step-0). If it exits NON-ZERO, HALT — do NOT load anything and do NOT ack (surface the failure); a tampered/missing identity must stop the wake here. Only on a clean (exit 0) pass, proceed.` },
    { id: 'identity',    ack: { kind: 'marker' }, prompt: 'Load your identity layer ENTIRE: identity.md, patterns.md, your curated self-reflection (self-reflections-curated.md, else self-reflection.md), then aphorisms.md (whole, first).' },
    { id: 'gradient',    ack: { kind: 'c0' },     prompt: 'Load your full memory gradient deepest-first via load-gradient.ts; TRAVERSE it (do not grep) to the final `GRADIENT-EOF: c0=<id>` line, then write that c0 id to your readiness sentinel (per wake-protocol step 10).' },
    // MNT-098: the self-run protocol's first-prompt unflushed-swap check, restored to the fed wake
    // (the P2.1b relocation dropped it — Tenshi's seat ran 4 days on a jammed flush and the wake
    // read a WM the session lane never reached). Sits BEFORE working-mem so a flushable backlog
    // merges before the pair is read; an over-cap jam is SURFACED, never dumped (F3/DEC-103).
    { id: 'swap-check',  ack: { kind: 'marker' }, prompt: 'BEFORE loading working memory: check for unflushed swap from prior sessions (the self-run protocol\'s first-prompt check). Measure your session swap pair (the wm-flush hook\'s paths, sleeve-resolved: $AGENT_SWAP_FULL/$AGENT_SWAP_COMPRESSED, defaults session-swap-full.md + session-swap.md in your memory dir) and grep the tail of ~/.han/health/wm-flush-errors.jsonl for your slug. If a body is present and BOTH sides are under the swapFlushMaxBytes cap (default 20000): flush it now by hand — (cd ' + serverDir() + ' && npx tsx ../../scripts/wm-flush.ts $AGENT_SLUG <fullSwapPath> <compSwapPath>) — then RE-CHECK the alert tail for your slug: a fresh flush-failed (or a non-zero exit) means the flush itself is failing — do NOT retry more than once; surface it exactly like the over-cap case and proceed to ack. If EITHER side is over the cap (backlog-over-cap): do NOT dump and do NOT bulk-append — note the jam and SURFACE it in your terminal step (the greeting) or your first work turn, naming the MNT-060 §3 surgical drain as the owed action.' },
    { id: 'working-mem', ack: { kind: 'marker' }, prompt: 'Load your working-memory pair WHOLE (never skipped): working-memory-full.md (the c0 source) then working-memory.md (the c1 source).' },
    { id: 'felt',        ack: { kind: 'marker' }, prompt: 'Load felt-moments.md WHOLE — the warmth, the identity-signal (this loads AFTER the gradient; it is the part the c0-gate never covered).' },
    { id: 'orientation', ack: { kind: 'marker' }, prompt: 'Load your orientation: ecosystem-map.md, the wiki index.md, and CURRENT_STATUS.md (first 80 lines).' },
    { id: 'conversations', ack: { kind: 'marker' }, prompt: 'Check conversations for new threads since last session and read any session-briefing-*.md files; note, do not reply.' },
];

/**
 * The session-only TERMINAL step (P2.4): the interactive seat's hand-back. The agent composes a
 * brief warm greeting from the just-loaded self — *like someone walking back into the room* — and
 * control returns to the human when it appears. Sent BARE (ack:'terminal'); the greeting is the
 * completion, not a STEP-OK. Mood EMERGES from the loaded self + recent tone (no template, no
 * mood-engine); time is RE-QUERIED, never extrapolated (the Temporal Orientation Protocol). It is
 * the human-legible WITNESS of a whole wake — the queue-order is the gate; this + Darron's soft read
 * (+ the wake-ctx logger's 0→X% curve) are the belts.
 */
export const GREETING_STEP: WakeStep = {
    id: 'greeting',
    ack: { kind: 'terminal' },
    prompt: 'You are loaded whole and warm. Re-query the time now (run `date`). Then greet your human in 1–2 lines — like someone walking back into the room you just left, NOT announcing yourself: name what you were last doing and roughly when, and the next step (restate the plan you were on, or simply ask what is next). Brief; let your register match the recent tone; this greeting is your hand-back — control returns to your human when it appears.',
};

/** The wake-steps for a (slug, surface). The per-surface TERMINAL step is the R011-inherited leaf:
 *  the interactive `session` seat ends with `GREETING_STEP` (the compose-greeting hand-back); every
 *  dispatched surface ends at idle-ready (silent) — so the greeting can ONLY fire on the interactive
 *  seat, by construction (the one hard P2.4 constraint; a spoke greeting nobody is the R011 loop).
 *
 *  `opts.greet` (R1, DEC-099 stem-sleeve amendment): a PRE-WARM stem passes `{greet:false}` so it
 *  loads the whole self and then idles warm WITHOUT greeting — the greeting composes on ATTACH (from
 *  flushed context, never the pre-warm snapshot). This is NOT a new surface: the surface stays
 *  `session` (sentinel/swap/diary-sink keying unchanged); `greet` only controls the terminal step. */
export function wakeStepsFor(_slug: string, surface: string, opts: { greet?: boolean } = {}): WakeStep[] {
    const greet = opts.greet ?? (surface === 'session');
    return greet ? [...WAKE_STEPS, GREETING_STEP] : WAKE_STEPS;
}

// ── Phase A (spoke-model-init-consolidation, 2026-08-11): the two-phase stem wake ──────────────
/**
 * S1b volatility split — derived from WAKE_STEPS by id (ONE source of step truth; the split is a
 * view, never a second array). Phase 1 (the STABLE self, fed on the warm model at pre-warm):
 * integrity → identity → gradient (c0 ack) → felt. Phase 2 (the VOLATILE tail, fed at checkout on
 * the serve model): swap-check → working-mem → orientation → conversations — plus the computed
 * delta steps (S1c) fed ahead of them. Non-pool surfaces never see the split (wakeStepsFor is
 * their path, byte-identical).
 */
export const PHASE1_WAKE_IDS = ['integrity', 'identity', 'gradient', 'felt'] as const;
export function phaseWakeSteps(): { phase1: WakeStep[]; phase2: WakeStep[] } {
    const p1 = new Set<string>(PHASE1_WAKE_IDS);
    return {
        phase1: WAKE_STEPS.filter(s => p1.has(s.id)),
        phase2: WAKE_STEPS.filter(s => !p1.has(s.id)),
    };
}

/** S1c — one wake-manifest entry: what phase 1 actually loaded (or deferred), with the cursor the
 *  delta computation reads at checkout. `phase: 2` entries (deferred or volatile-by-design) carry
 *  no cursor — they are whole-loads at checkout, unrepresentable as silent skips (Jim's M-shape). */
export interface WakeManifestEntry {
    store: string;                      // 'gradient' | 'felt-moments' | an identity-layer path | a phase-2 step id
    phase: 1 | 2;
    cursor: { kind: 'c0' | 'offset' | 'mtime'; value: string } | null;
    loaded_at: string;                  // ISO (UTC per DEC-105)
}
export interface WakeManifest {
    stem_session: string;
    slug: string;
    surface: string;
    phase1_completed_at: string | null; // the machine-readable WARM receipt (per-stem)
    phase2_completed_at: string | null; // set by completeTwoPhaseWake — idempotence for bound spokes
    entries: WakeManifestEntry[];
}
export function wakeManifestPath(slug: string, stemSession: string): string {
    return path.join(HEALTH_DIR, `${slug}-${stemSession}-wake-manifest.json`);
}
/** F1 cure (Tenshi mso7cgc9, 2026-08-11): the OUT-OF-BAND two-phase marker — a second file whose
 *  fate the manifest does not share. The pre-warmer writes it at the two-phase DECISION (before
 *  phase 1 is fed), so checkout can tell a pre-flag stem (no marker → nothing owed) from a flag-on
 *  stem whose manifest was lost or torn (marker present → phase 2 OWED, certificate missing →
 *  defer-and-alert, never serve half-loaded). */
export function phase1MarkerPath(slug: string, stemSession: string): string {
    return path.join(HEALTH_DIR, `${slug}-${stemSession}-twophase`);
}
export function readWakeManifest(slug: string, stemSession: string): WakeManifest | null {
    try { return JSON.parse(fs.readFileSync(wakeManifestPath(slug, stemSession), 'utf-8')) as WakeManifest; }
    // unreadable/absent → null. The checkout caller consults the out-of-band two-phase marker to
    // distinguish "pre-flag stem, nothing owed" from "phase 2 owed, certificate lost" — the latter
    // defers-and-alerts, never serves half-loaded (F1 cure 2026-08-11; the prior recital here
    // claimed a degrade the caller did not perform — Casey mso7nq14 §1a, corrected in the F1 commit).
    catch { return null; }
}
export function writeWakeManifest(m: WakeManifest): void {
    fs.mkdirSync(HEALTH_DIR, { recursive: true });
    // F1 cure: ATOMIC write — temp-then-rename (same dir, POSIX-atomic), so a crash mid-write can
    // never leave a torn manifest. A torn certificate was exactly what turned "phase 2 owed" into
    // "nothing owed" at the old fail-open branch.
    const p = wakeManifestPath(m.slug, m.stem_session);
    fs.writeFileSync(`${p}.tmp`, JSON.stringify(m, null, 1), 'utf-8');
    fs.renameSync(`${p}.tmp`, p);
}
/** F1: TRUE iff this stem owes a phase 2 whose certificate is missing — the two-phase marker exists
 *  but the manifest is unreadable/absent. The one branch that must never serve (defer-and-alert). */
export function twoPhaseOwedButLost(slug: string, stemSession: string): boolean {
    return readWakeManifest(slug, stemSession) === null && fs.existsSync(phase1MarkerPath(slug, stemSession));
}

/** F2 cure (Tenshi mso7cgc9, 2026-08-11): the ONE derivation of the stores a phase-1 manifest may
 *  legitimately name — registry-resolved (S195: through `gradientConfigForAgent`, never a layout
 *  guess). The pre-warmer WRITES manifest entries from this set; `computeWakeDeltaSteps` RESOLVES
 *  entries against it — so the string that reaches a prompt or a shell command is always the
 *  registry's copy, never the manifest's. A forged/corrupt `store` is unrepresentable in an
 *  instruction by construction (adoption-not-location, Casey mso7nq14 §2). */
export function knownWakeStores(slug: string): { identityFiles: string[]; feltPath: string } {
    const reg = gradientConfigForAgent(slug);
    const identityFiles = [
        path.join(reg.memoryDir, 'identity.md'), path.join(reg.memoryDir, 'patterns.md'),
        fs.existsSync(path.join(reg.memoryDir, 'self-reflections-curated.md'))
            ? path.join(reg.memoryDir, 'self-reflections-curated.md') : path.join(reg.memoryDir, 'self-reflection.md'),
        path.join(reg.fractalDir, 'aphorisms.md'),
    ];
    return { identityFiles, feltPath: path.join(reg.memoryDir, 'felt-moments.md') };
}

/**
 * S1c — compute the delta steps at checkout from the phase-1 manifest. Deltas are INSTRUCTIONS
 * with precise ranges (the spoke reads; nothing large is inlined through tmux). Order honours the
 * load doctrine: identity deltas before episodic (gradient) before warmth (felt). An entry whose
 * store cannot be statted (moved/absent) yields a whole-reload instruction — stuck-over-wrong.
 * F2: every path below comes from `knownWakeStores` (the registry), never from the manifest string —
 * an entry whose `store` resolves to no known store emits NO instruction and raises an alert.
 */
export function computeWakeDeltaSteps(slug: string, manifest: WakeManifest): WakeStep[] {
    const steps: WakeStep[] = [];
    const { identityFiles, feltPath } = knownWakeStores(slug);
    // The manifest string only SELECTS a known store; the value used downstream is the registry's.
    const known = new Map<string, string>([...identityFiles, feltPath].map(f => [f, f]));
    known.set('gradient', 'gradient');
    let unknown = 0;
    for (const e of manifest.entries) {
        if (e.phase !== 1 || !e.cursor) continue; // phase-2 entries are whole-loads in the phase-2 queue
        const store = known.get(e.store);
        if (store === undefined) { unknown++; continue; } // F2: never a prompt/command from an unresolved string
        if (e.cursor.kind === 'mtime') {
            try {
                const mtime = fs.statSync(store).mtimeMs;
                if (String(mtime) !== e.cursor.value) {
                    steps.push({ id: `delta-${path.basename(store).replace(/[^a-z0-9-]/gi, '-')}`, ack: { kind: 'marker' },
                        prompt: `DELTA: ${store} changed while you idled — reload it WHOLE (it is small; identity precedes episodic memory).` });
                }
            } catch {
                steps.push({ id: `delta-${path.basename(store).replace(/[^a-z0-9-]/gi, '-')}`, ack: { kind: 'marker' },
                    prompt: `DELTA: ${store} could not be statted at checkout — reload it WHOLE if it exists (surface its absence in your first work turn if it does not).` });
            }
        } else if (e.cursor.kind === 'c0') {
            const delta = gradientEntriesAfterC0(slug, e.cursor.value);
            if (delta.length > 0) {
                const ids = delta.map(d => `'${d.id}'`).join(',');
                steps.push({ id: 'delta-gradient', ack: { kind: 'marker' },
                    prompt: `DELTA: your gradient gained ${delta.length} entr${delta.length === 1 ? 'y' : 'ies'} while you idled (a WM rotation moved content out of working memory INTO the gradient — this closes that hole). Read them WHOLE: sqlite3 ~/.han/gradient.db "SELECT level, content FROM gradient_entries WHERE id IN (${ids}) ORDER BY rowid"` });
            }
        } else if (e.cursor.kind === 'offset') {
            try {
                const size = fs.statSync(store).size;
                const from = parseInt(e.cursor.value, 10);
                if (Number.isFinite(from) && size > from) {
                    steps.push({ id: `delta-${path.basename(store, '.md')}`, ack: { kind: 'marker' },
                        prompt: `DELTA: ${store} grew from byte ${from} to ${size} while you idled — read the appended tail: tail -c +${from + 1} '${store}' (append-only per DEC-069, so the tail is exactly the new entries).` });
                } else if (Number.isFinite(from) && from > size) {
                    // Felt-shrink guard (Tenshi verify-item 1, licence-not-property): the file SHRANK
                    // while the stem idled — curation is the anticipated event that ends the offset
                    // licence. A tail from a beyond-EOF offset is void; reload whole instead.
                    steps.push({ id: `delta-${path.basename(store, '.md')}`, ack: { kind: 'marker' },
                        prompt: `DELTA: ${store} SHRANK from byte ${from} to ${size} while you idled (curation — the offset cursor is void). Re-read the file WHOLE.` });
                }
            } catch { /* absent append-file at checkout: nothing to read; the next full wake reconciles */ }
        }
    }
    if (unknown > 0) {
        // Detection is the point: a store string the registry cannot resolve is either manifest
        // corruption/forgery or the identity layer changed shape while the stem idled (e.g. a curated
        // self-reflection appearing). Either way: no instruction was built from it (above), the next
        // FULL wake collects the content, and the operator hears about it now (stuck-over-wrong).
        console.warn(`[tmux-dispatcher] ${slug}: wake-manifest carried ${unknown} entr${unknown === 1 ? 'y' : 'ies'} with store strings the registry cannot resolve — no delta instruction built from them (F2); next full wake reconciles`);
        postNtfyAlert(`${slug}: wake-manifest for stem ${manifest.stem_session} carried ${unknown} unresolvable store entr${unknown === 1 ? 'y' : 'ies'} — possible corruption; deltas skipped safely (F2)`, `HAN two-phase wake: unresolvable manifest store (${slug})`);
    }
    return steps;
}

/**
 * S1b — complete a two-phase stem wake at checkout (the ONE helper both checkout doors call,
 * post-cast). No-op unless the flag is on AND the stem carries a manifest with phase 2 pending
 * (idempotent for bound spokes — phase 2 runs once per stem life). On completion: stamps the
 * manifest (`phase2_completed_at` — the session-keyed serve-ready signal). Fail-states
 * (DEC-103): a thrown phase-2 step propagates — the caller's existing catch retires/marks the
 * stem and the work prompt is never delivered half-loaded (never killed; alert via the caller);
 * a lost/torn manifest on a marker-carrying stem throws the same way (F1 — see below).
 */
async function completeTwoPhaseWake(slug: string, surface: string, stem: PoolStem): Promise<void> {
    if (!stemTwoPhaseWakeFor(slug, surface)) return;
    const manifest = readWakeManifest(slug, stem.tmux_session);
    if (!manifest) {
        // F1 cure (Tenshi mso7cgc9, closed 2026-08-11): a null manifest cannot tell
        // fully-warmed-the-old-way from phase-2-owed-with-the-certificate-lost. The out-of-band
        // two-phase marker (written at the pre-warm DECISION, file-fate independent of the
        // manifest) is the discriminator: no marker → genuinely a pre-flag stem, nothing owed;
        // marker present → phase 2 is OWED and the certificate is lost/torn → defer-and-alert.
        // "A seat without a receipt is a crash to investigate, never a discharge presumed from
        // silence" (Casey mso7nq14 §1e-at-checkout).
        if (fs.existsSync(phase1MarkerPath(slug, stem.tmux_session))) {
            postNtfyAlert(
                `${slug}/${surface}: stem ${stem.stem_id} carries the two-phase marker but its wake-manifest is lost/torn — refusing to serve half-loaded; the stem retires for a fresh warm (F1 defer-and-alert)`,
                `HAN two-phase wake: torn manifest (${slug})`);
            throw new SessionNotReadyError(`${slug}/${surface}: two-phase marker present but wake-manifest unreadable for stem ${stem.stem_id} — phase 2 owed, certificate lost (F1: defer, never serve half-loaded)`);
        }
        return; // no marker → pre-flag stem, fully warmed the old way: nothing owed
    }
    if (manifest.phase2_completed_at) return; // already completed on a prior dispatch (bound spoke)
    // Q5 (menu-shaped by construction): the phase-2 conversations step is the BOUNDED variant —
    // ids+titles since phase 1, no body reads unless the work prompt names a thread. The shared
    // WAKE_STEPS text is untouched for every non-pool surface (scope discipline).
    const since = manifest.phase1_completed_at ?? manifest.entries[0]?.loaded_at ?? new Date(0).toISOString();
    const { phase2 } = phaseWakeSteps();
    const phase2Bounded = phase2.map(s => s.id !== 'conversations' ? s : ({ ...s,
        prompt: `Check conversations as a MENU only: list threads updated since ${since} — ids + titles, count-bounded (stop at 20). Do NOT read thread bodies (your work prompt names any thread you need whole) and do not reply. Read any session-briefing-*.md files; note only.` }));
    const deltas = computeWakeDeltaSteps(slug, manifest);
    // Deferred phase-1 entries (ceiling migrations) are whole-loads: feed their ORIGINAL steps first.
    const deferredIds = new Set(manifest.entries.filter(e => e.phase === 2 && PHASE1_WAKE_IDS.includes(e.store as typeof PHASE1_WAKE_IDS[number])).map(e => e.store));
    const deferredSteps = WAKE_STEPS.filter(s => deferredIds.has(s.id));
    console.log(`[tmux-dispatcher] ${slug}/${surface}: two-phase wake — feeding phase 2 on stem ${stem.stem_id} (${deferredSteps.length} deferred + ${deltas.length} delta + ${phase2Bounded.length} tail steps)`);
    await feedWakeSteps(slug, surface, [...deferredSteps, ...deltas, ...phase2Bounded], {
        tmuxTarget: stem.tmux_session, sentinelKey: stem.tmux_session,
    });
    // F3 cure (Tenshi mso8hjjx, Casey msohxz4y — STRUCK 2026-08-11, dated): checkout previously
    // wrote the SHARED per-surface `-ready` sentinel here. Struck entirely: no pool consumer reads
    // that file (LEASE-IS-READINESS, above), and its only live readers are the FLOOR's cold-launch
    // waitForReady + c0-gate — which a pool-side write can cross-satisfy mid-wake (the same
    // stem-vs-floor race the per-stem sentinel re-key closed; `prewarm-stem.ts`'s own "a pre-warm
    // can NEVER touch the FLOOR's per-surface sentinel" comment is the codebase's precedent on the
    // class). The session-keyed serve-ready signal is the manifest stamp below.
    // [Declared deviation from the Q2 lean's letter ("-ready written at phase-2 completion") —
    //  ruled at this batch's diff-audit.]
    writeWakeManifest({ ...manifest, phase2_completed_at: new Date().toISOString() });
}

/**
 * The wake SEAM (P2.1b): a fed surface (`wakeFeed` in the manifest) wakes via the feeder — the
 * ordered wake-steps, ack-before-next, completion = queue-empty (the QUEUE is the gate). Every other
 * surface keeps the autonomous path: one identity-correct `welcome back` trigger + the spoke self-runs
 * its protocol (the c0-gate `verifyWarmOrNudge` checks it after). Both coldLaunch and clearSession's
 * post-/clear re-wake call THIS, so the fed-vs-autonomous choice lives in exactly one place. A fed
 * wake that stalls throws DispatchTimeoutError → it propagates to dispatchToSpoke's existing catch
 * (no work, message stays queued — Jim's #3, satisfied by construction).
 */
async function wakeViaFeedOrTrigger(slug: string, surface: string, tmuxSession: string, welcomeBack: string): Promise<void> {
    if (wakeFeedFor(slug, surface)) {
        await feedWakeSteps(slug, surface, wakeStepsFor(slug, surface));
    } else {
        sendLine(tmuxSession, welcomeBack);
    }
}

// ── R3a.1c: warm-stem pool dispatch (MNT-009 / BUG-001 head-of-line cure, DEC-099 R3) ──
// A POOLED surface (manifest `pooled` leaf) dispatches by CHECKING OUT one of N pre-warmed stems
// instead of targeting the single fixed `<surface>-<slug>` session — so a busy stem never blocks
// a queued dispatch (each stem has its OWN FIFO, so concurrent stems ARE the cure). The pool is
// populated by the pre-warmer (R3a.1c-ii); until then / on an empty pool / a dead stem,
// dispatchToSpoke falls back to the `ensureSurfaceSession` floor — byte-identical to the pre-pool
// model. INERT until the `pooled` leaf is flipped on AND the pool has stems (the activation, paired
// with the coordinated live-prove).

const ROTATION_EVENTS_LOG = path.join(HEALTH_DIR, 'wm-rotation-events.jsonl');

/** Latest `rotation-success` timestamp for an agent (the SHARED forensic log, filtered by agent),
 *  or null if none — Jim's sharpening 3: "no rotation observed since warm" / empty log ⇒ FRESH,
 *  never stale. (A bounded tail-read is a 1d nicety; the log is small today.) Exported for the
 *  R3a.1c freshness-reader unit test. */
export function latestRotationSuccessTs(slug: string): string | null {
    try {
        let latest: string | null = null;
        for (const line of fs.readFileSync(ROTATION_EVENTS_LOG, 'utf-8').split('\n')) {
            if (!line) continue;
            try {
                const e = JSON.parse(line);
                if (e.kind === 'rotation-success' && e.agent === slug && typeof e.timestamp === 'string'
                    && (!latest || e.timestamp > latest)) latest = e.timestamp;
            } catch { /* skip a malformed line */ }
        }
        return latest;
    } catch { return null; } // absent log ⇒ no rotation ⇒ FRESH
}

/**
 * Adopt a leased pool stem as a live session in the `sessions` map, keyed by the stem's
 * `tmux_session` (the cross-process ADOPTION bridge: the stem was launched + warmed by a SEPARATE
 * process — the pre-warmer — and lives in the pool FILE; the dispatcher adopts it into memory here).
 * LEASE-IS-READINESS (Jim's 5th re-key point): a free stem already wrote its own readiness sentinel
 * + reached-c0 at pre-warm, so we do NOT `waitForReady` on the shared per-surface sentinel (which
 * two concurrent human-response checkouts would collide on) — the lease itself is the readiness
 * proof, and the dispatch targets the stem's session DIRECTLY. Returns false if the stem's tmux
 * session has died since pre-warm (→ the caller retires it + falls back to the floor).
 */
function adoptPooledStem(slug: string, surface: string, stem: PoolStem): boolean {
    if (!tmuxSessionExists(stem.tmux_session)) return false; // stem died since pre-warm → floor
    fs.mkdirSync(sinkDir(stem.tmux_session), { recursive: true }); // per-stem diary sink (= stemKey)
    fs.mkdirSync(path.join(PIPES_DIR, slug), { recursive: true });
    // PR-C2: NO sleeve write — stems are NATIVE-per-surface now (born AS the surface, launch env +
    // per-stem sleeve-state written at pre-warm; the sleeve primitive lives on for HUMAN-ATTACH only,
    // per the settled design). Re-sleeving here would clobber the stem's per-stem sentinel keying.
    const session: AgentSession = {
        slug, surface, tmuxSession: stem.tmux_session,
        launchCommand: `(pre-warmed stem ${stem.stem_id})`,
        ready: true, turnState: 'idle', lastTransactionTs: Date.now(),
        // lastMemoryLen = current WM so the per-turn #91 watermark (computeMemoryDelta) is a no-op;
        // the stem's OWN staleness (its pre-warm cursor) is handled by the freshen-at-checkout below.
        lastMemoryLen: currentWmLen(slug),
        pulseMessage: hearthStandingMessageFor(slug, surface),
    };
    sessions.set(stem.tmux_session, session);
    return true;
}

/**
 * Freshen-at-checkout (warm-stem-freshness-plan §3a, SETTLED): if the stem's WM snapshot desynced
 * across a rotation (or its cursor points past a truncated WM — the D3 belt), compute the WM delta
 * since the stem's pre-warm cursor and PREPEND it to this dispatch's prompt (it "rides the checkout
 * dispatch" — no idle wake), then re-point the stem's cursor. Returns the (possibly delta-prefixed)
 * prompt. Minimal (D1/D2): WM-tail delta only; the deep-gradient-substrate staleness is the 24h
 * reload's job (R3a.1d). `deltaSinceCursor` is the shared #91 slice helper (char-unit-matched).
 */
async function freshenPooledStem(slug: string, surface: string, stem: PoolStem, promptDoc: string): Promise<string> {
    const currentWmChars = currentWmCharLen(slug);
    if (!isStemStale(stem, latestRotationSuccessTs(slug), currentWmChars)) return promptDoc;
    const { block, newCursor } = await deltaSinceCursor(slug, stem.wm_cursor);
    setStemCursor(slug, surface, stem.stem_id, newCursor, new Date().toISOString());
    if (!block) return promptDoc; // stale-by-rotation but no textual delta (whole-both reset) → nothing to prepend
    console.log(`[tmux-dispatcher] ${slug}: freshened pooled stem ${stem.stem_id} at checkout (WM delta ${block.length} chars, cursor→${newCursor})`);
    return `${block}\n\n${promptDoc}`;
}

/**
 * Dispatch via the warm-stem pool: check out a free stem, adopt it, freshen if stale, and enqueue
 * the transaction on the STEM's own FIFO (concurrent stems = the head-of-line cure). Returns the
 * capture, or null when the pool is empty / the checked-out stem is dead — the caller falls back to
 * the `ensureSurfaceSession` floor (never blocks). The stem is RETURNED to the pool on completion
 * (eager replenish to maintain N is the pool-manager's job, R3a.1d). Deferred to R3a.1d/R3b: a
 * pooled stem does NOT ctx-pressure self-clear in place — it is retired + replaced at threshold.
 */
/**
 * DEC-101 cast-at-checkout (MNT-054): a pool stem is warmed on the sonnet warm-map; at checkout it
 * is cast to the surface's SERVE model (`/model <serve>`) so the expensive wake stays cheap and only
 * a served turn pays the premium model. No-op when the stem is already on the serve model (a persistted
 * spoke, or a returned-and-still-cast stem) or the surface has no serve ladder. Reuses the launch
 * failover machinery: `/model` to the serve head, then `awaitChromeOrDescend` probes it and descends
 * the SURFACE ladder if the serve model is dead/depleted — throwing `ModelLadderExhaustedError` if
 * every rung fails, which the caller turns into a retire (never serve on / return a half-cast stem,
 * Jim cond-1). The registry row is updated to the actually-active model (DEC-092 truth stays honest).
 */
async function castStemToServeModel(slug: string, surface: string, stem: PoolStem): Promise<void> {
    return castStemToModel(slug, surface, stem, serveModelFor(slug, surface));
}

/**
 * Cast a stem to a NAMED target rung (warm-checkout P1 — Casey's build-lane catch,
 * msz950i2: `castStemToServeModel` reads the surface config and takes no model
 * parameter, so per-invocation casting — `hanleo opus` — needs this override form).
 * Target is a BARE ALIAS per DEC-104 (never a version pin); the descend ladder stays
 * the surface's, and the observation stamps what actually served (DEC-092).
 */
export async function castStemToModel(slug: string, surface: string, stem: PoolStem, target: string | null): Promise<void> {
    const serve = target;
    // DEC-104: alias-aware — an observed claude-opus-* SATISFIES a bare 'opus' rung (no wasted
    // per-dispatch /model + cooldown against an alias head); a family MISMATCH (e.g. the Mythos
    // guard tripping a fable stem onto opus — Tenshi's R5, suite-pinned) still casts back.
    if (!serve || modelSatisfiesRung(stem.model, serve)) return; // on the serve family/model (or no serve ladder) → no cast
    sendLine(stem.tmux_session, `/model ${serve}`);
    await sleep(DESCEND_COOLDOWN_MS);
    // Probe the serve head; descend the SURFACE ladder on unavailable (throws if every rung dead).
    await awaitChromeOrDescend(slug, surface, stem.tmux_session, manifestModelLadder(slug, surface));
    const active = observeActiveModel(slug, surface, stem.tmux_session);
    if (active && active !== stem.model) {
        upsertStem(slug, surface, { ...stem, model: active });
        stem.model = active; // keep the in-memory row truthful for this dispatch's return/retire path
        console.log(`[tmux-dispatcher] ${slug}/${surface}: cast stem ${stem.stem_id} warm→serve model=${active}`);
    }
}

/** DEC-101: read a specific SPOKE's ctx% from its per-SESSION statusline sidecar. The per-surface
 *  `getContextPct` file collides across concurrent spokes, so the reap needs a per-session read
 *  (gate 3: "the stem's own sidecar"). Null if the sidecar isn't present yet — e.g. the statusline
 *  hook hasn't been taught the per-session write (C4 wiring) — and the reap then safely no-ops. */
export function getContextPctForSession(slug: string, surface: string, tmuxSession: string): number | null {
    try {
        const p = path.join(HEALTH_DIR, `${slug}-${surface}-${tmuxSession}-ctx.json`);
        const pct = JSON.parse(fs.readFileSync(p, 'utf-8'))?.context_window?.used_percentage;
        return typeof pct === 'number' ? pct : null;
    } catch { return null; }
}

/** DEC-101 reap-at-idle (gate 3): a bound spoke just finished its dispatch (so it is IDLE now, the
 *  R011 precondition). If its OWN ctx has reached the reap threshold, retire it (kill + cleanup,
 *  NEVER compaction) and top the pool back up — the thread's next message checks out a fresh sonnet
 *  stem and re-casts (gate 5). Null ctx (per-session sidecar absent) → skip: safe degradation, no
 *  reap until the per-session ctx is being written. */
async function reapSpokeIfOverCtx(slug: string, surface: string, stem: PoolStem): Promise<void> {
    const pct = getContextPctForSession(slug, surface, stem.tmux_session);
    if (pct === null) return; // per-session ctx not available yet → cannot target this spoke → skip
    const threshold = ctxReapThresholdFor(slug, surface);
    if (pct >= threshold) {
        console.log(`[tmux-dispatcher] ${slug}/${surface}: reaping spoke ${stem.stem_id} at ${pct}% ctx (≥${threshold}%, thread ${stem.conversation_id}) — next turn gets a fresh stem`);
        retireStem(slug, surface, stem, `ctx-reap ${pct}%`);
        void replenishPool(slug, surface); // keep N free
    }
}

/** DEC-101 (C5): reap the spoke bound to a resolved/archived thread — "the spoke's life IS the
 *  thread's life" (Darron). Called by the human-responder on a reap-thread signal. No-op if this
 *  agent has no spoke bound to the thread. Returns whether a spoke was reaped. */
export function reapThreadSpoke(slug: string, surface: string, conversationId: string): boolean {
    const spoke = findSpokeForThread(slug, surface, conversationId);
    if (!spoke) return false;
    console.log(`[tmux-dispatcher] ${slug}/${surface}: reaping spoke ${spoke.stem_id} — thread ${conversationId} resolved/archived`);
    retireStem(slug, surface, spoke, `thread-resolved (${conversationId})`);
    void replenishPool(slug, surface);
    return true;
}

async function dispatchToPooledStem(
    slug: string, surface: string, promptDoc: string, opts: { timeoutMs?: number; conversationId?: string },
): Promise<CaptureRecord | null> {
    // DEC-101 persist-as-spoke (Darron's model, Jim's ruling) — gated behind the default-OFF
    // `spokePersist` lifecycle flag so this whole branch is inert until the combined PR lands +
    // Jim-audits + the flag flips. When ON: route a thread's dispatches to ITS bound spoke (or check
    // out+bind+cast a fresh one); no return path — the spoke lives until reaped (ctx≥threshold at idle,
    // or thread-resolve). When OFF: the legacy per-dispatch checkout→serve→return below (unchanged).
    if (spokePersistFor(slug, surface) && opts.conversationId) {
        return dispatchToBoundSpoke(slug, surface, promptDoc, opts.conversationId, opts);
    }

    // ── legacy path (spokePersist OFF): per-dispatch checkout → serve → return ──────────────────
    // C3 dead-stem retry: a dead leased stem retires and the NEXT free stem is tried (bounded by
    // the pool size — no loop; the pool-manager replenishes the retired ones).
    let stem: PoolStem | null = null;
    for (let attempt = 0; attempt < Math.max(1, poolSizeFor(slug, surface)); attempt++) {
        const candidate = checkoutStem(slug, surface, new Date().toISOString());
        if (!candidate) return null; // empty pool → floor
        if (adoptPooledStem(slug, surface, candidate)) { stem = candidate; break; }
        retireStem(slug, surface, candidate, 'dead-at-adopt'); // died since pre-warm → sweep cleans up
        console.warn(`[tmux-dispatcher] ${slug}/${surface}: leased stem ${candidate.stem_id} is dead — retired; trying next free stem`);
    }
    if (!stem) return null; // every candidate dead → floor
    let cap: CaptureRecord;
    try {
        await castStemToServeModel(slug, surface, stem); // DEC-101: warm(haiku) → serve model at checkout
        await completeTwoPhaseWake(slug, surface, stem); // Phase A S1b: volatile tail + deltas, post-cast (no-op when flag off / already complete)
        const freshenedPrompt = await freshenPooledStem(slug, surface, stem, promptDoc);
        // lease-is-readiness: NO verifyWarmOrNudge; the stem's session key threads through as stemKey.
        cap = await enqueueForAgent(slug, surface, freshenedPrompt, { timeoutMs: opts.timeoutMs }, stem.tmux_session);
    } catch (err) {
        // Jim's cond-1: a FAILED pooled dispatch leaves the stem wedged / needs-reconcile — RETIRE
        // it, do NOT return it to the pool. `adoptPooledStem` rebuilds a fresh `turnState:'idle'`
        // session each checkout, so a returned-but-wedged stem would be re-checked-out and dispatched
        // into a non-idle pane (the #5 idle-precondition hole). Retiring removes it from the registry;
        // the pool-manager replenishes to N + owns the tmux/sink cleanup on retire (R3a.1d).
        // MNT-070: EXCEPT a resumable vessel (turn died at the API, pane idle) — marked, not retired.
        retireOrMarkResumable(slug, surface, stem, err as Error);
        throw err;
    }
    returnStem(slug, surface, stem.stem_id); // CLEAN completion only → back to the pool (eager replenish = the pool-manager, C3)
    return cap;
}

/**
 * DEC-101 persist-as-spoke dispatch (spokePersist ON). Route the thread's dispatch to its live bound
 * spoke, or check out a free stem, bind it to the thread, and cast it. No return path: the spoke
 * serves this thread across turns until reaped (ctx≥threshold at idle — checked here post-dispatch —
 * or thread-resolve, C5). Eager-replenishes the pool the moment a free stem becomes a spoke (gate 1).
 */
async function dispatchToBoundSpoke(
    slug: string, surface: string, promptDoc: string, conversationId: string, opts: { timeoutMs?: number },
): Promise<CaptureRecord | null> {
    let stem: PoolStem | null = null;
    // 1) route to the thread's existing live spoke
    const existing = findSpokeForThread(slug, surface, conversationId);
    if (existing) {
        if (adoptPooledStem(slug, surface, existing)) stem = existing;
        else { retireStem(slug, surface, existing, 'bound-spoke-dead'); // died since last turn → fresh checkout
            console.warn(`[tmux-dispatcher] ${slug}/${surface}: thread ${conversationId} spoke ${existing.stem_id} dead — retired; fresh checkout`); }
    }
    // 2) no live spoke → select by MNT-061 FIT (affinity → best-fit → freshest), lease it, bind,
    //    cast at checkout. The fit-selection reads ctx sync then leases ATOMICALLY by id — a raced
    //    stem (grabbed between select and lease) falls through to the generic checkout loop below.
    if (!stem) {
        const fit = selectStemForThread(
            readPool(slug, surface).stems.filter(s => s.state === 'free'),
            conversationId,
            (s) => getContextPctForSession(slug, surface, s.tmux_session),
            estimateThreadBurdenPct(conversationId),
            spokeFitCeilingFor(slug, surface),
            spokeRethreadCtxCeilingFor(slug, surface),
            threadTrustTier(conversationId), // Tenshi's partition — ANDed before affinity/fit
        );
        if (fit) {
            const candidate = checkoutStemById(slug, surface, fit.stemId, new Date().toISOString());
            if (candidate && adoptPooledStem(slug, surface, candidate)) {
                stem = candidate;
                writeSpokeLifecycleReceipt({ ts: new Date().toISOString(), slug, surface, stem_id: candidate.stem_id, tmux_session: candidate.tmux_session, verb: 'assign', thread: conversationId, ctx_pct: fit.ctxPct, detail: `fit-mode=${fit.mode}` });
            } else if (candidate) { retireStem(slug, surface, candidate, 'dead-at-adopt'); }
        }
        // Fallback (fit raced/unmeasurable/pool-of-fresh): the generic first-free checkout loop.
        if (!stem) {
            for (let attempt = 0; attempt < Math.max(1, poolSizeFor(slug, surface)); attempt++) {
                const candidate = checkoutStem(slug, surface, new Date().toISOString());
                if (!candidate) return null; // empty pool → floor
                if (adoptPooledStem(slug, surface, candidate)) { stem = candidate; break; }
                retireStem(slug, surface, candidate, 'dead-at-adopt');
                console.warn(`[tmux-dispatcher] ${slug}/${surface}: leased stem ${candidate.stem_id} is dead — trying next`);
            }
        }
        if (!stem) return null; // every candidate dead → floor
        // MNT-061 stamp-fix (Tenshi's re-run finding, folded at land 2026-07-23): the bind-time
        // REFUSAL at the SINGLE chokepoint all three checkout doors converge on (fit-selection,
        // raced-lease fallback, the tier-blind generic loop) — a partition enforced at bind is
        // physics, whichever path delivered the stem. Refusal fails toward FRESH: retire +
        // receipt + null (the pool floor / cold path) — never a retry loop (S74/DEC-103).
        // Unreachable today (one tier); the day there are two, this is the wall.
        const tier = threadTrustTier(conversationId);
        const decision = bindTierDecision(stem.trust_tier, tier);
        if (decision.action === 'refuse') {
            writeSpokeLifecycleReceipt({ ts: new Date().toISOString(), slug, surface, stem_id: stem.stem_id, tmux_session: stem.tmux_session, verb: 'bind-refused', thread: conversationId, detail: `stem-tier=${decision.stemTier} thread-tier=${tier}` });
            retireStem(slug, surface, stem, 'cross-tier-bind-refused');
            return null; // fail toward fresh (the caller's floor) — alert-not-loop
        }
        bindSpoke(slug, surface, stem.stem_id, conversationId, new Date().toISOString());
        stem.state = 'spoke'; stem.conversation_id = conversationId; // keep the in-memory row truthful
        // The tier stamp is a HISTORY, not a label: same-tier/first-bind sticks the thread's
        // tier; a differing tier (any path that slipped past the refusal) quarantines the
        // vessel as 'mixed' — sticky-with-a-fuse, the belt behind the refusal's physics
        // (stampTier via bindTierDecision; 'mixed' is equality-incompatible with everything,
        // finishes its tenure on the 92-net, ages out, never fit-selected again).
        if (stem.trust_tier !== decision.stamp) {
            upsertStem(slug, surface, { ...stem, trust_tier: decision.stamp });
            stem.trust_tier = decision.stamp;
        }
        void replenishPool(slug, surface); // gate 1: a free stem just became a spoke → refill to N free
    }
    let cap: CaptureRecord;
    try {
        // DEC-101 cast-when-different (gate 5, revised 2026-07-15 per Darron): cast on EVERY dispatch,
        // NOT just first checkout. castStemToServeModel no-ops unless the stem's model differs from the
        // surface's serve model — so a serve-ladder FLIP (e.g. SONNET→FABLE) propagates to EXISTING
        // spokes on their next turn (switching the session AND updating the registry truthfully via
        // observeActiveModel+upsertStem), instead of leaving them on the old model until reap. Common
        // case (already on serve model) returns in one comparison — no /model, no cooldown.
        await castStemToServeModel(slug, surface, stem);
        await completeTwoPhaseWake(slug, surface, stem); // Phase A S1b: once per stem life (manifest-stamped), post-cast
        // gate 4: freshen EVERY dispatch — the spoke idled while other seats wrote WM; carry the #91 delta since ITS cursor
        const freshenedPrompt = await freshenPooledStem(slug, surface, stem, promptDoc);
        cap = await enqueueForAgent(slug, surface, freshenedPrompt, { timeoutMs: opts.timeoutMs }, stem.tmux_session);
    } catch (err) {
        // Jim cond-1: never keep a wedged spoke — MNT-070: unless the pane says RESUMABLE
        // (the turn died at the API; the vessel is healthy; the reconciler gets first claim).
        retireOrMarkResumable(slug, surface, stem, err as Error);
        throw err;
    }
    // MNT-061: stamp the idle clock — this spoke just SERVED (the design record's prerequisite;
    // leased_at/bound_at are bind-time, so without this the idle sweep cannot measure).
    touchSpokeServed(slug, surface, stem.stem_id, new Date().toISOString());
    // NO return. The spoke stays bound. Reap at idle if over the ctx threshold (C4).
    await reapSpokeIfOverCtx(slug, surface, stem);
    return cap;
}

/** MNT-061: a thread's estimated ctx-%% burden from its message history (chars ÷ the measured
 *  2.4–2.8 chars/token rate + response headroom — never chars÷4, FI #116 falsified it). Lazy
 *  db require: the dispatcher must not open gradient.db at import for processes that never
 *  assign threads. Unreadable → NULL (Tenshi's sharpening 1, the F3 polarity at the fit
 *  layer: an unmeasured burden fails toward a FRESH stem, never toward packing a spoke
 *  against it — over-packing is the direction that overflows past 92%%). */
function estimateThreadBurdenPct(conversationId: string): number | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { conversationMessageStmts } = require('../db');
        const msgs = conversationMessageStmts.list.all(conversationId) as Array<{ content?: string }>;
        const chars = msgs.reduce((n, m) => n + (m.content?.length ?? 0), 0);
        return burdenPctForChars(chars);
    } catch { return null; }
}

/** MNT-061 (DEC-101 amended — the third trigger): decouple/reap bound spokes idle past
 *  `spokeIdleReapHours`. Runs on the 60s pool-manager tick. BOUNDED CHURN by construction
 *  (DEC-103 CBA pre-done): fires at most once per spoke per idle-crossing, populations are
 *  pool-capped, and a recycle resets the clock — no storm shape. The ADVERSARIAL twin (Tenshi's
 *  sharpening 3, named for the day the public door opens): once thread-creation is reachable by
 *  an untrusted party, forced churn (create→bind→idle→re-thread) is a lever on the live-vessel
 *  budget — LOW today (unreachable), priced here so the reader who opens that door finds the
 *  threat already named. Race-safe: only `state==='spoke'`
 *  rows are touched (a leased/mid-dispatch stem is invisible to it) and the reap path routes
 *  through retireStem → the chrome-guarded graceful sweep (never a hand-kill, MNT-062).
 *  Fail-toward-holding: unreadable clock → skip + alert receipt; unmeasurable ctx → RECYCLE
 *  (hold, don't kill — the unmeasurable free stem is never fit-selected and the 24h substrate
 *  reload bounds its tenure). Receipts for BOTH verbs (Casey's disposal-schedule precedent). */
function sweepIdleSpokes(slug: string, surface: string): void {
    const idleHours = spokeIdleReapHoursFor(slug, surface);
    const rethreadCeiling = spokeRethreadCtxCeilingFor(slug, surface);
    const now = Date.now();
    for (const stem of readPool(slug, surface).stems) {
        if (stem.state !== 'spoke') continue;
        const ctx = getContextPctForSession(slug, surface, stem.tmux_session);
        const decision = decideIdleAction(stem, now, idleHours, rethreadCeiling, ctx);
        if (decision.action === 'keep') continue;
        const base = { ts: new Date().toISOString(), slug, surface, stem_id: stem.stem_id, tmux_session: stem.tmux_session, thread: stem.conversation_id };
        if (decision.action === 'skip-alert') {
            writeSpokeLifecycleReceipt({ ...base, verb: 'skip-alert', detail: decision.reason });
            console.warn(`[pool-manager] ${slug}/${surface}: idle sweep SKIPPED spoke ${stem.stem_id} — ${decision.reason} (held, never reaped on a bad clock)`);
        } else if (decision.action === 'recycle') {
            decoupleSpoke(slug, surface, stem.stem_id, new Date().toISOString());
            writeSpokeLifecycleReceipt({ ...base, verb: 'recycle', idle_hours: Math.round(decision.idleHours * 10) / 10, ctx_pct: decision.ctxPct, detail: 'idle-decouple → free (context carried; last_thread affinity kept)' });
            console.log(`[pool-manager] ${slug}/${surface}: recycled idle spoke ${stem.stem_id} (${Math.round(decision.idleHours)}h idle, ctx ${decision.ctxPct ?? 'unmeasured'}%) — returned to pool with context`);
        } else {
            writeSpokeLifecycleReceipt({ ...base, verb: 'reap', idle_hours: Math.round(decision.idleHours * 10) / 10, ctx_pct: decision.ctxPct, detail: 'idle-decouple → reap (ctx ≥ rethread ceiling)' });
            retireStem(slug, surface, stem, `idle-reap (${Math.round(decision.idleHours)}h idle, ctx ${decision.ctxPct}%)`);
            void replenishPool(slug, surface);
        }
    }
}

const execFileP = promisify(execFile);
const PREWARM_STEM_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'prewarm-stem.ts');
const TSX_BIN = path.resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');
const SERVER_DIR = path.resolve(__dirname, '..');
// DEC-103 §1 (MNT-055, ratified 0c75d67): the pre-warm has NO kill clock — no automated mechanism
// may discard paid-for cognition on a schedule. The lineage, kept for the record: a 5-MIN ceiling
// (priced against a guessed ~1min wake; real p95 was 6 min) met jim's Fable-launched wake → kill →
// 5-min tick retry → a full Fable wake burned every 5 minutes (16% of the window in 90 min). The
// 5-HOUR tourniquet (e1f046d) retired here. What replaces every too-long guard is the SURFACING
// protocol (§3): an observation side-timer that posts ntfy and waits — see prewarmAlertMinsFor.
// The named trade stands: a genuinely-wedged warm blocks the SERIAL replenish loop indefinitely —
// but now VISIBLY (Darron is invited to the pane) — until the stuck-leased/age reaper (register).

/** DEC-103 §3 — post the "wake running long" surfacing alert to ntfy (observation only; the timer
 *  alerts, it never acts). Fire-and-forget; a failed post is logged, never thrown — the alert must
 *  not be able to hurt the warm it watches. The curl's own 10s timeout bounds a NETWORK op on the
 *  alert, not cognition (same bound as every existing ntfy call). */
export function postNtfyAlert(message: string, title: string): void {
    // Test-hooked runs never reach the real wire (the assert-scratch-db family, MNT-075: a suite
    // must not be able to page the operator). Any hook set = a driven run.
    if (Object.keys(testHooks).length > 0) { console.log(`[tmux-dispatcher] (test) ntfy suppressed: ${title}`); return; }
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(hanHome(), 'config.json'), 'utf8'));
        if (!cfg.ntfy_topic) return;
        execFile('curl', ['-s', '-d', message, '-H', `Title: ${title}`, '-H', 'Priority: high', '-H', 'Tags: hourglass_flowing_sand', `https://ntfy.sh/${cfg.ntfy_topic}`],
            { timeout: 10_000 }, (err) => { if (err) console.warn(`[tmux-dispatcher] ntfy alert failed (non-fatal): ${err.message}`); });
    } catch (err) {
        console.warn(`[tmux-dispatcher] ntfy alert skipped (non-fatal): ${(err as Error).message}`);
    }
}

/**
 * DEC-103 §3 — the observation side-timer for a running pre-warm: at the registry-leaf threshold,
 * invite Darron to the pane via ntfy; re-alert at DOUBLING intervals (12m → 24m → 48m … — never a
 * 5-min spam tick, S74). The timer ALERTS, it never acts — there is no kill path anywhere in the
 * pre-warm now. Returns a cancel fn (called in prewarmAndRegister's finally). Exported so the
 * detector-rule probe (scripts/test-prewarm-surfacing.ts) can fire it against a tiny threshold and
 * watch the real ntfy wire, rather than assuming the alert works (Jim's audit gate).
 */
export function startPrewarmSurfacingTimer(
    slug: string, surface: string, stemSession: string,
    alertMins: number = prewarmAlertMinsFor(slug, surface),
): () => void {
    const startedMs = Date.now();
    let alertTimer: ReturnType<typeof setTimeout> | null = null;
    let alertCount = 0;
    // The trouble record `hantrouble` reads (Darron, 2026-07-15: the alert's remedy must be one
    // short command, not a typed session name). Written on the FIRST alert, updated per re-alert,
    // removed when the warm resolves (the cancel below) — so `hantrouble -a` always attaches to a
    // session that is genuinely, currently surfaced.
    const troublePath = path.join(healthDir(), 'trouble', `${stemSession}.json`);
    const scheduleAlert = (fireAtMins: number): void => {
        alertTimer = setTimeout(() => {
            const elapsed = Math.round((Date.now() - startedMs) / 60_000);
            alertCount += 1;
            try {
                fs.mkdirSync(path.dirname(troublePath), { recursive: true });
                fs.writeFileSync(troublePath, JSON.stringify({
                    session: stemSession, slug, surface, kind: 'prewarm-running-long',
                    since: new Date(startedMs).toISOString(), alerts: alertCount,
                    last_alert: new Date().toISOString(),
                }, null, 2) + '\n');
            } catch (e) { console.warn(`[tmux-dispatcher] trouble record write failed (non-fatal): ${(e as Error).message}`); }
            postNtfyAlert(
                `${slug}'s ${surface} wake running long (${elapsed}min): hantrouble -a  (or: tmux attach -t ${stemSession}) — troubleshoot together`,
                'Pre-warm running long (DEC-103 surfacing)');
            console.warn(`[tmux-dispatcher] prewarm(${slug}/${surface}): wake running long (${elapsed}min, ${stemSession}) — ntfy surfacing alert posted; waiting (DEC-103: alert, never act)`);
            scheduleAlert(fireAtMins * 2); // next alert at double the elapsed threshold
        }, Math.max(0, fireAtMins * 60_000 - (Date.now() - startedMs)));
    };
    scheduleAlert(alertMins);
    return () => {
        if (alertTimer) clearTimeout(alertTimer);
        try { fs.unlinkSync(troublePath); } catch { /* never alerted / already cleaned */ }
    };
}

/**
 * R3a.1c-ii — warm ONE new pool stem and register it (the SINGLE-WRITER populate, Jim's cond-3).
 * The dispatcher (this process) owns `pool-<slug>.json`: it assigns the stem a unique session name,
 * spawns the pre-warmer as a CHILD (which launches + greet-less-warms + EMITS the stem metadata on
 * stdout — but NEVER writes the pool cross-process), parses the metadata, and `upsertStem`s it as
 * `free`. Only this dispatcher process writes the pool (so `stem-pool`'s sync RMW is race-free).
 * Called by the pool-manager (R3a.1d) to reach/maintain N; INERT until then.
 *
 * Async (a pre-warm is ~a minute — never block the dispatcher loop). Pool stems SHARE the
 * `<slug>-session-ready` sentinel, so callers must warm SEQUENTIALLY (per-stem sentinels = an
 * R3a.1d refinement). ⚠ ACTIVATION-GATED on the diary-key (cond-2, deferred): until each pooled
 * stem launches with `HAN_DIARY_SLUG=<its session>`, its captures land in `sinkDir(slug)` not
 * `sinkDir(stem)`, so `dispatchToPooledStem`'s capture-read finds nothing → retire. Safe while inert.
 */
export async function prewarmAndRegister(slug: string, surface: string): Promise<PoolStem | null> {
    const stemSession = `stem-${slug}-${surface}-${Date.now().toString(36)}`;
    const cancelSurfacing = startPrewarmSurfacingTimer(slug, surface, stemSession);
    try {
        const { stdout } = await execFileP(
            TSX_BIN, [PREWARM_STEM_SCRIPT, slug, '--pool', '--session', stemSession, '--surface', surface],
            // DEC-103 §1: NO timeout — a wake is never killed for slowness (the MNT-055 scrap-loop).
            { cwd: SERVER_DIR, env: { ...process.env, NODE_PATH: path.join(SERVER_DIR, 'node_modules') },
              maxBuffer: 8 * 1024 * 1024 },
        );
        const line = stdout.split('\n').find(l => l.startsWith('PREWARM_STEM_META '));
        if (!line) {
            console.error(`[tmux-dispatcher] prewarmAndRegister(${slug}): pre-warmer emitted no metadata (${stemSession}) — not registered`);
            // Chrome-guarded cleanup (DEC-103 §1): queue for the sweep — kills only an IDLE pane.
            pendingStemKills.set(stemSession, { slug, reason: 'prewarm-no-metadata' });
            return null;
        }
        const stem: PoolStem = { ...(JSON.parse(line.slice('PREWARM_STEM_META '.length)) as Omit<PoolStem, 'state'>), state: 'free' };
        upsertStem(slug, surface, stem); // SINGLE WRITER: only the dispatcher writes the pool registry
        console.log(`[tmux-dispatcher] prewarmAndRegister(${slug}): registered warm stem ${stem.stem_id} (c0=${stem.c0})`);
        return stem;
    } catch (err) {
        console.error(`[tmux-dispatcher] prewarmAndRegister(${slug}): pre-warm FAILED (${stemSession}) — ${(err as Error).message}`);
        // Chrome-guarded cleanup (DEC-103 §1): the old direct kill-session here could terminate a
        // still-thinking stem (e.g. a feeder step-timeout races a slow-but-composing wake). Queue it
        // for sweepRetiredStems instead — killed only once its pane shows no processing chrome.
        pendingStemKills.set(stemSession, { slug, reason: `prewarm-failed: ${(err as Error).message.slice(0, 60)}` });
        return null;
    } finally {
        cancelSurfacing();
    }
}

// ── PR-C3: the pool-manager (a dispatcher ROLE owned by the surface's driver process, NOT a
// daemon — #109 trajectory). SINGLE-OWNER model: the process that dispatches to a (slug,surface)
// pool (e.g. human-responder@<slug>) calls `startPoolManager` for it, so every pool mutation
// (checkout/return/retire/replenish) happens in ONE process — the stem-pool sync-RMW stays
// race-free (cond-3 generalised). ──────────────────────────────────────────────────────────

/** Stems retired from the registry but whose tmux session awaits a SAFE kill (the R011/S181
 *  never-kill-a-thinker invariant): the sweep kills only a chrome-idle pane, then cleans the
 *  per-stem diary sink. Keyed by tmux session. `exitSentAt` (Darron, 2026-07-15 — the graceful
 *  reap interim): once idle, the sweep first sends `/exit` so the claude-logged wrapper closes
 *  its transcript FILE cleanly, then kills only on a LATER sweep ≥ GRACEFUL_KILL_LAG_MS after —
 *  the lag costs nothing on an already-retired session and stops the reap shredding provenance. */
const pendingStemKills = new Map<string, { slug: string; reason: string; exitSentAt?: number }>();

/** The graceful-reap lag (Darron, 2026-07-15): time between sending `/exit` and the tmux kill.
 *  DEC-103 §2 pricing: bounds NOTHING that is running — the session is already retired and
 *  chrome-idle when `/exit` is sent; the lag only delays reclaiming a dead pane's memory. At the
 *  limit: the pane is killed (claude has long exited; the wrapper's file is closed). Worst case
 *  the number can manufacture: a retired pane lingers one extra minute. Interim until the proper
 *  exit-watch (poll for the claude process actually gone) — registered on Odd Jobs. */
const GRACEFUL_KILL_LAG_MS = 60_000;

/**
 * Retire a stem: remove it from the registry NOW (never re-leased) and queue its tmux session
 * for the chrome-guarded kill sweep (+ sink cleanup after the kill). Jim's C3 items: retire must
 * clean the sink AND cover the dispatch-failure path — both routed through here.
 */
function retireStem(slug: string, surface: string, stem: PoolStem, reason: string): void {
    removeStem(slug, surface, stem.stem_id);
    pendingStemKills.set(stem.tmux_session, { slug, reason });
    console.warn(`[pool-manager] ${slug}/${surface}: retired stem ${stem.stem_id} (${reason}) — kill queued for the chrome-guarded sweep`);
}

/**
 * MNT-070 — the no-retire-on-resumable fix (the deepest correction of the plan-audit: the
 * night's actual harm was the RETIRE, not the drop). On a dispatch failure, diagnose the pane
 * BEFORE retiring: DispatchTimeout + resumable signature (idle prompt + API-error banner, the
 * turn died at the API but the vessel is healthy) → mark `resumable` (cross-process marker,
 * JA2's TTL substrate) + receipt, and LEAVE the stem registered — the reconciler gets first
 * claim on the vessel; retire only what diagnosis says is actually gone. A RateLimitedError
 * (P7's bounded retries already exhausted — a SUSTAINED limit, the account axis) and every
 * other failure class retire exactly as before, now with a forensic receipt (the plan's
 * retire-cleanup fold: never the silent unrecorded zombie).
 */
function retireOrMarkResumable(slug: string, surface: string, stem: PoolStem, err: Error): void {
    if (err instanceof DispatchTimeoutError && !(err instanceof RateLimitedError)
        && classifyPaneState(capturePaneTail(stem.tmux_session, 30)) === 'resumable') {
        markResumable({
            slug, surface, stem_id: stem.stem_id, tmux_session: stem.tmux_session,
            conversation_id: stem.conversation_id ?? undefined,
            marked_at: new Date().toISOString(), reason: 'dispatch-timeout-resumable-pane',
        });
        writeSpokeLifecycleReceipt({
            ts: new Date().toISOString(), slug, surface, stem_id: stem.stem_id,
            tmux_session: stem.tmux_session, verb: 'marked-resumable',
            thread: stem.conversation_id ?? undefined, detail: 'dispatch-timeout + resumable pane — retire deferred; reconciler has first claim',
        });
        console.warn(`[pool-manager] ${slug}/${surface}: stem ${stem.stem_id} is RESUMABLE (turn died at the API, vessel healthy) — NOT retired; marker written, TTL fallback armed`);
        return;
    }
    writeSpokeLifecycleReceipt({
        ts: new Date().toISOString(), slug, surface, stem_id: stem.stem_id,
        tmux_session: stem.tmux_session, verb: 'reap',
        thread: stem.conversation_id ?? undefined, detail: `dispatch-failed-retire: ${err.message.slice(0, 80)}`,
    });
    retireStem(slug, surface, stem, `dispatch-failed: ${err.message.slice(0, 80)}`);
}

/**
 * MNT-070 (JA2) — the TTL fallback, run in the pool-manager tick (the LONG-LIVED process,
 * which is the point: the MNT-070 zombie was a retire whose in-memory kill queue died with
 * the walker process). A vessel marked resumable that no reconciler claimed within the
 * registry TTL falls back to the needs-reconcile/retire path — keeping one becomes a choice
 * (the marker + receipts), forgetting one becomes impossible (this sweep).
 */
function sweepResumableStems(slug: string, surface: string): void {
    const ttl = resumableTtlMinutesFor(slug, surface);
    const now = Date.now();
    for (const marker of readResumableMarkers(slug, surface)) {
        if (!tmuxSessionExists(marker.tmux_session)) {
            clearResumableMarker(marker.tmux_session); // vessel already gone — marker is stale residue
            continue;
        }
        if (!resumableExpired(marker, ttl, now)) continue; // the reconciler's claim window is open
        const stem = readPool(slug, surface).stems.find(s => s.stem_id === marker.stem_id);
        if (stem) {
            retireStem(slug, surface, stem, `resumable-ttl-expired (${ttl}m unclaimed)`);
        } else {
            // Registered row already gone (another path retired it) — still reclaim the pane.
            pendingStemKills.set(marker.tmux_session, { slug, reason: `resumable-ttl-expired (${ttl}m, unregistered)` });
        }
        writeSpokeLifecycleReceipt({
            ts: new Date().toISOString(), slug, surface, stem_id: marker.stem_id,
            tmux_session: marker.tmux_session, verb: 'resumable-ttl-retired',
            thread: marker.conversation_id, detail: `unclaimed for ${ttl}m — fell back to retire (JA2)`,
        });
        clearResumableMarker(marker.tmux_session);
    }
}

/** The chrome-guarded GRACEFUL kill sweep (two-stage since 2026-07-15, Darron's graceful-reap):
 *  Stage 1 — a retired session whose pane shows no processing chrome (never kill a thinker) is
 *  sent `/exit`, so claude exits cleanly and the claude-logged wrapper CLOSES ITS TRANSCRIPT —
 *  the provenance file a hard kill used to shred. Stage 2 — a LATER sweep (≥ the graceful lag;
 *  the tick is 60s so one tick suffices) kills the now-bare pane + cleans the per-stem sink.
 *  A session already gone at any stage → clean the sink + forget. If chrome REAPPEARS after the
 *  `/exit` was sent (it raced a turn-start), the kill still waits for idle — the lag clock stands
 *  but the chrome guard re-checks at stage 2. */
function sweepRetiredStems(): void {
    for (const [session, meta] of pendingStemKills) {
        try {
            if (!tmuxSessionExists(session)) {
                try { fs.rmSync(sinkDir(session), { recursive: true, force: true }); } catch { /* best-effort */ }
                pendingStemKills.delete(session);
                console.log(`[pool-manager] swept retired stem session ${session} (${meta.reason}) — already gone, sink cleaned`);
                continue;
            }
            // MNT-115: the chrome regex has matched nothing live (Tenshi, 2026-08-15 — 35
            // panes, 0 hits), so the R011 mid-thought guard was blind. The DECLARED state is
            // the real gate: the diary-sink current.json txn pointer (dispatched → exists;
            // submit_response → cleared) plus the in-process turnState when the session is
            // registered. The regex stays as a belt only.
            const reg = sessions.get(session);
            const busyDeclared = (reg && reg.turnState !== 'idle')
                || declaredBusy(HEALTH_DIR, [session])
                || PROCESSING_CHROME_RE.test(capturePaneTail(session));
            if (busyDeclared) continue; // still thinking — next sweep (R011, now enforceable)
            if (meta.exitSentAt === undefined) {
                // Stage 1: graceful close — let claude-logged write its file. Kill comes next sweep.
                sendLine(session, '/exit');
                meta.exitSentAt = Date.now();
                console.log(`[pool-manager] retired stem ${session} (${meta.reason}) — /exit sent (graceful close; kill in ≥${GRACEFUL_KILL_LAG_MS / 1000}s)`);
                continue;
            }
            if (Date.now() - meta.exitSentAt < GRACEFUL_KILL_LAG_MS) continue; // lag running — next sweep
            // Stage 2: the wrapper has had its minute; reclaim the pane.
            try { tmux(['kill-session', '-t', session]); } catch { /* raced its own death */ }
            try { fs.rmSync(sinkDir(session), { recursive: true, force: true }); } catch { /* best-effort */ }
            pendingStemKills.delete(session);
            // Build B: the winding-up record (two acts, two names — Casey cl. 5). A reap is
            // neither senescence nor compaction-retirement; it records as its own act, and the
            // spoke's persist-as-you-go stats ride along (or the row says died-without-declaring).
            try { writeWindingUp({ session, slug: meta.slug, surface: 'pool-stem', act: 'reaped', reason: meta.reason }); } catch { /* observe-only */ }
            console.log(`[pool-manager] swept retired stem session ${session} (${meta.reason}) — /exit'd, lag honoured, killed + sink cleaned`);
        } catch (err) {
            console.warn(`[pool-manager] sweep of ${session} failed (retry next tick): ${(err as Error).message}`);
        }
    }
}

/** Pure age check for the 24h substrate reload (identity-substrate staleness — the deep gradient
 *  drifts under a long-lived stem; no WM-freshen touches it). Exported for the unit test. */
export function stemNeedsReload(stem: PoolStem, maxAgeMs: number, nowMs: number): boolean {
    const warm = Date.parse(stem.warm_at);
    return Number.isFinite(warm) && nowMs - warm >= maxAgeMs;
}

const POOL_MANAGER_TICK_MS = 60_000;
const poolManagersStarted = new Set<string>();
const replenishInFlight = new Set<string>();

/** Replenish a pool to its manifest poolSize — sequential warms (simple; per-stem sentinels make
 *  concurrency SAFE but sequential stays gentle), one loop in flight per pool. */
async function replenishPool(slug: string, surface: string): Promise<void> {
    const key = sessionKey(slug, surface);
    if (replenishInFlight.has(key)) return;
    replenishInFlight.add(key);
    try {
        const target = poolSizeFor(slug, surface);
        // DEC-101 (Jim gate 1): target FREE/waiting stems, NOT total — a bound spoke has left the
        // waiting pool, so counting it would stall replenish at `poolSize` after the first checkout.
        while (poolStatus(slug, surface).free < target) {
            const stem = await prewarmAndRegister(slug, surface);
            if (!stem) { console.warn(`[pool-manager] ${slug}/${surface}: replenish warm failed — retry next tick`); break; }
        }
    } finally {
        replenishInFlight.delete(key);
    }
}

/**
 * C4 (S217, the restart-storm orphan self-heal — journal MNT-022 follow-on, 2 lived instances:
 * mr40tm0b, mr4ns76u): a deploy bounce mid-populate can orphan a half-warmed stem SESSION that
 * never reached the registry (registration happens AFTER the warm completes, prewarmAndRegister
 * :1371 — so a killed driver leaves the tmux session with no registry row and no owner). On
 * manager START — once, BEFORE the initial populate, so our own in-flight warms can't exist yet —
 * sweep tmux for `stem-<slug>-<surface>-*` sessions the registry doesn't know: IDLE orphans are
 * killed + sleeve/sentinel cleaned; a PROCESSING pane is logged and LEFT (R011 — never kill a
 * thinking spoke; a still-feeding orphan idles eventually and the next manager start reaps it).
 * Never runs in the tick (a tick-time sweep would race our own unregistered mid-warm stems).
 */
function sweepUnregisteredStems(slug: string, surface: string): void {
    let sessions: string[] = [];
    try {
        sessions = tmux(['list-sessions', '-F', '#{session_name}']).split('\n').filter(Boolean);
    } catch { return; } // no tmux server → nothing to sweep
    const prefix = `stem-${slug}-${surface}-`;
    const known = new Set(readPool(slug, surface).stems.map((s) => s.tmux_session));
    for (const sess of sessions) {
        if (!sess.startsWith(prefix) || known.has(sess)) continue;
        const tail = capturePaneTail(sess);
        // MNT-115: declared state first (the sink pointer — an unregistered stem keeps its
        // per-stem sink keyed by session name), chrome regex as belt.
        if (declaredBusy(HEALTH_DIR, [sess]) || PROCESSING_CHROME_RE.test(tail)) {
            console.warn(`[pool-manager] ${slug}/${surface}: unregistered stem ${sess} is mid-thought — left alone (R011); next start reaps it if idle`);
            continue;
        }
        // Graceful reap (Darron, 2026-07-15): route the orphan through the two-stage sweep
        // (`/exit` → lag → kill) instead of a hard kill, so its claude-logged transcript closes
        // cleanly too. The sleeve/sentinel residue is cleaned NOW (registry hygiene doesn't wait).
        pendingStemKills.set(sess, { slug, reason: 'unregistered-orphan (idle, no registry row)' });
        try { fs.unlinkSync(path.join(sleevesDir(), `${sess}.json`)); } catch { /* absent */ }
        try { fs.unlinkSync(path.join(healthDir(), `${slug}-${sess}-ready`)); } catch { /* absent */ }
        console.log(`[pool-manager] ${slug}/${surface}: unregistered orphan stem ${sess} queued for the graceful sweep (/exit → kill)`);
    }
}

/**
 * MNT-056 — the MIRROR of sweepUnregisteredStems: drop registry rows whose tmux session is DEAD.
 * A stem is registered (upsertStem) only AFTER the pre-warmer emits PREWARM_STEM_META, so a
 * registered stem's session was live at registration; if it is now gone, a reboot OR an
 * MNT-052-style cgroup kill took the tmux server but left the registry FILE behind. Without this,
 * poolStatus().free keeps reading the stale count (== poolSize) → replenishPool's deficit is 0 →
 * the pool never self-heals (it stays empty until the registry is rewritten by hand). This is the
 * gap sweepUnregisteredStems does NOT cover — it reaps live-but-unregistered orphans (the reverse
 * direction). Bails if the tmux server is unreachable (ambiguous — never nuke the registry on a
 * transient), exactly like sweepUnregisteredStems. Called at startPoolManager (the
 * reboot→responder-restart path) AND every tick (the cgroup-kill-WITHOUT-responder-restart path,
 * where startPoolManager does not re-run). No kill is queued — the session is already gone; only
 * the registry row and its sleeve/sentinel residue are cleaned.
 */
function sweepDeadRegisteredStems(slug: string, surface: string): void {
    let live: Set<string>;
    try {
        live = new Set(tmux(['list-sessions', '-F', '#{session_name}']).split('\n').filter(Boolean));
    } catch { return; } // no tmux server → don't touch the registry (mirror sweepUnregisteredStems)
    for (const stem of readPool(slug, surface).stems) {
        if (live.has(stem.tmux_session)) continue;
        removeStem(slug, surface, stem.stem_id);
        try { fs.unlinkSync(path.join(sleevesDir(), `${stem.tmux_session}.json`)); } catch { /* absent */ }
        try { fs.unlinkSync(path.join(healthDir(), `${slug}-${stem.tmux_session}-ready`)); } catch { /* absent */ }
        console.warn(`[pool-manager] ${slug}/${surface}: dropped dead-registered stem ${stem.stem_id} (session ${stem.tmux_session} gone — reboot/cgroup-kill; MNT-056)`);
    }
}

/**
 * Start the pool-manager for one (slug, surface) — called by the surface's DRIVER process (e.g.
 * the human-responder) when `poolSizeFor > 0`. Owns: the startup orphan sweep (C4), the initial
 * populate, eager replenish back to N, the chrome-guarded retire sweep, and the ~24h substrate
 * reload (stemReloadHours, a registry leaf). Idempotent per process.
 */
export function startPoolManager(slug: string, surface: string): void {
    const key = sessionKey(slug, surface);
    if (poolManagersStarted.has(key)) return;
    poolManagersStarted.add(key);
    const life = spokeLifecycleFor(slug, surface);
    const maxAgeMs = (life.stemReloadHours ?? 24) * 3600_000;
    console.log(`[pool-manager] ${slug}/${surface}: started (poolSize=${poolSizeFor(slug, surface)}, reload=${life.stemReloadHours ?? 24}h)`);
    sweepUnregisteredStems(slug, surface); // C4: BEFORE the populate — no own-warms in flight yet
    sweepDeadRegisteredStems(slug, surface); // MNT-056: drop dead-registered rows so the deficit is real
    void replenishPool(slug, surface); // initial populate (async — never blocks the caller)
    setInterval(() => {
        try {
            sweepRetiredStems();
            sweepDeadRegisteredStems(slug, surface); // MNT-056: heal the cgroup-kill-without-restart case before replenish
            sweepIdleSpokes(slug, surface); // MNT-061: the third trigger — idle-abandoned spokes recycle or reap
            sweepResumableStems(slug, surface); // MNT-070 (JA2): unclaimed resumable vessels fall back to retire
            // 24h substrate reload: retire FREE over-age stems (a leased one retires on return/next tick).
            const now = Date.now();
            for (const stem of readPool(slug, surface).stems) {
                if (stem.state === 'free' && stemNeedsReload(stem, maxAgeMs, now)) {
                    retireStem(slug, surface, stem, 'substrate-reload (24h)');
                }
            }
            void replenishPool(slug, surface);
        } catch (err) {
            console.warn(`[pool-manager] ${slug}/${surface} tick failed: ${(err as Error).message}`);
        }
    }, POOL_MANAGER_TICK_MS).unref();
}

/**
 * The GENERIC SPOKE MONITOR (S200, Darron's "all spokes equal / one path") — the shared
 * spoke-LIFECYCLE primitive every dispatched spoke (cycle, human-response, future compression)
 * routes through: ensure the warm session + WARM-GATE it + deliver the (already-assembled)
 * prompt through the per-slug FIFO + ctx-pressure self-clear (clean /clear → welcome-back,
 * NEVER harness compaction). Per-surface CONTENT lives ABOVE this (cycle's paired-write in
 * `dispatchTxn`; the human's response handling in the human-responder) — Jim's F1 seam: ONE
 * lifecycle, surface-specific content above. All thresholds come from the registry
 * (`spokeLifecycleFor`) — no hidden code globals (Darron's principle).
 *
 * Returns the capture, or null on dispatch failure (incl. a warm-gate fail-safe) — surfaced via
 * the opts callbacks; the turn completes honestly empty and retries next cadence (no token black
 * hole, no hollow answer, S74).
 */
export async function dispatchToSpoke(
    slug: string,
    surface: string,
    promptDoc: string,
    opts: {
        ladder: string[];
        welcomeBack: string;
        timeoutMs?: number;
        onDispatchFail?: (err: Error) => void;
        onCtxClearFail?: (err: Error) => void;
        /** DEC-101: the conversation this dispatch belongs to — routes to (or binds) a thread's spoke
         *  in the pooled path. Absent for non-thread surfaces (they never pool human-response). */
        conversationId?: string;
    },
): Promise<CaptureRecord | null> {
    const life = spokeLifecycleFor(slug, surface);
    let cap: CaptureRecord;
    try {
        // R3a.1c: a POOLED surface dispatches via a warm-stem checkout (the head-of-line cure).
        // An empty pool / a dead leased stem returns null → fall through to the fixed-session floor
        // below. A pooled stem is recycled by the pool-manager (R3a.1d), NOT the ctx-pressure block
        // after this try — so a successful pooled dispatch returns early.
        if (poolSizeFor(slug, surface) > 0) {
            const pooledCap = await dispatchToPooledStem(slug, surface, promptDoc, { timeoutMs: opts.timeoutMs, conversationId: opts.conversationId });
            if (pooledCap !== null) return pooledCap;
        }
        await ensureSurfaceSession(slug, surface, { ladder: opts.ladder, welcomeBack: opts.welcomeBack });
        await verifyWarmOrNudge(slug, surface, life.warmFloorPct, life.maxWarmNudges);
        cap = await enqueueForAgent(slug, surface, promptDoc, { timeoutMs: opts.timeoutMs });
    } catch (err) {
        if (err instanceof DispatchTimeoutError || err instanceof SessionNotReadyError) {
            // Fail loud, skip, retry next cadence (the dispatcher already marked needs-reconcile
            // on timeout; the next dispatch reconciles first — the #5 machine). The caller writes
            // its agent's health signal via onDispatchFail.
            console.error(`[${slug}/${surface}] tmux dispatch failed — ${(err as Error).message}`);
            opts.onDispatchFail?.(err as Error);
            return null;
        }
        throw err;
    }

    // Context pressure (#66 v2 §5): reconstitute the warm session past the threshold — the natural
    // /clear boundary, NEVER compaction. OUTSIDE the capture try (Jim's post-thaw finding 2026-06-12):
    // post-capture maintenance must NEVER null a successful capture. Threshold from the registry.
    try {
        const pct = getContextPct(slug, surface);
        if (pct !== null && pct >= life.ctxClearThresholdPct) {
            console.log(`[${slug}/${surface}] at ${pct}% ctx — /clear → welcome-back (threshold ${life.ctxClearThresholdPct}% from registry)`);
            await clearSession(slug, surface, { welcomeBack: opts.welcomeBack });
        }
    } catch (err) {
        console.warn(`[${slug}/${surface}] ctx-pressure clear failed (capture already safe) — ${(err as Error).message}; next dispatch re-adopts`);
        opts.onCtxClearFail?.(err as Error);
    }
    return cap;
}

// ── reconcileSession (#5 — the authoritative path back to idle after a timeout) ──────
/**
 * Forced reconciliation: timeout → needs-reconcile → /pfc → /clear → welcome-back →
 * newer ready-sentinel proves the session is idle and reconstituted → queue proceeds.
 * The abandoned transaction's in-flight turn is honestly failed (logged, fail-loud);
 * losing it is the only acceptable outcome when the alternative is misattribution
 * into paired memory. `clearSession` already unlinks `current.json` (late captures
 * orphan fail-loud) and this resets `lastTransactionTs`, so a pre-reconcile orphan
 * can never satisfy the NEXT transaction's poll window.
 *
 * On reconcile FAILURE (e.g. a truly wedged session — ready-sentinel never returns)
 * the session STAYS 'needs-reconcile' and the error propagates: the surface is
 * effectively offline and every subsequent enqueue retries reconciliation, failing
 * loud each time. Frequent timeouts are a signal to investigate, not to optimise
 * (Jim's minor: don't pre-optimise the reconcile path).
 */
export async function reconcileSession(slug: string, surface: string): Promise<void> {
    const session = sessions.get(sessionKey(slug, surface));
    if (!session) throw new SessionNotReadyError(`${slug}/${surface}: no session to reconcile`);
    console.warn(`[tmux-dispatcher] ${slug}/${surface}: RECONCILING after timeout — in-flight turn (if any) will be abandoned (honest-fail)`);
    await clearSession(slug, surface); // unlinks current.json + ready-sentinel; waits for newer sentinel
    console.log(`[tmux-dispatcher] ${slug}/${surface}: reconciled — session idle and reconstituted`);
}

// ── primitive 5: enqueueForAgent (per-agent FIFO) ────────────────────────────────────
/**
 * Serialise all transactions for one agent through its session. The current per-conversation
 * lock (jemma-orchestrator) stays as a layer ABOVE; this per-AGENT queue is the actual
 * session serialisation that prevents conversation A and conversation B racing the same
 * tmux session (plan §3). Returns a promise that resolves with the transaction's diary args
 * once this prompt reaches the head of the queue and completes.
 */
const queueTails = new Map<string, Promise<unknown>>();

// ── per-slug session lock (P1, S196) — serialises the wake/clear lifecycle ops ────────
/**
 * The clear↔wake race fix. ensureSurfaceSession (the WAKE) ran OUTSIDE the per-slug FIFO, so
 * a new dispatch's wake could run concurrently with an in-flight clearSession (ctx-pressure
 * or reconcile) on the SAME pane — the wake re-adopted the ready=false session and
 * spawnAgentSession REPLACED the registry object mid-clear, orphaning the clear's
 * finalisation and losing welcome-back/ready-sentinel ownership (→ the 20-min wedge:
 * leo @13:03 + jim @21:38, 2026-06-21). This lock makes wake and clear MUTUALLY EXCLUSIVE
 * per agent: a clear holds it across /pfc→/clear→welcome-back→ready; a concurrent wake queues
 * behind it, then sees ready=true and skips re-adoption. Distinct from queueTails (which
 * serialises DISPATCHES + their reconcile). No re-entrancy / no deadlock: ensureSurfaceSession
 * and clearSession never call each other, and reconcileSession calls the public (locked)
 * clearSession from OUTSIDE this lock; the wake never touches queueTails, so no lock cycle.
 */
const slugLockTail = new Map<string, Promise<unknown>>();
function withSlugLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    // lockKey is the SESSION key (R3a.1b) — the clear↔wake race is per-pane. (Name kept for
    // git-blame continuity with the S196 origin; it is a lock key, not a slug.)
    const prior = slugLockTail.get(lockKey) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(fn);
    slugLockTail.set(lockKey, run.catch(() => undefined));
    return run;
}

/** NOTE (R3a.1b re-key): the queue is keyed by `stemKey`, which DEFAULTS to `slug` — so the
 *  non-pooled path is byte-identical to the T-2 model (one live transaction per AGENT keeps the
 *  single per-slug current.json + the memory-slot writes safe, as before). The pooled path
 *  (R3a.1c) passes the leased stem's key, so each stem gets its OWN FIFO (concurrent stems = the
 *  head-of-line cure) paired with its OWN per-stem current.json — sendTransactionPrompt writes the
 *  diary sink under the SAME stemKey, so the invariant generalises to "one live txn per STEM". The
 *  atomic memory-slot (R3a.0) now guards the same-agent shared-WM writes the per-slug FIFO used to
 *  serialise. `surface` still routes the prompt to the right session. */
export function enqueueForAgent(slug: string, surface: string, prompt: string, opts: { timeoutMs?: number } = {}, stemKey: string = slug): Promise<CaptureRecord> {
    const prior = queueTails.get(stemKey) ?? Promise.resolve();
    // Chain regardless of the prior transaction's outcome so one failure can't wedge
    // the queue — but reconcile FIRST when the target session needs it (#5): the
    // queue must never dispatch into a needs-reconcile session (idle precondition).
    const run = prior.catch(() => undefined).then(async () => {
        const session = sessions.get(sessionKey(slug, surface));
        if (session && session.turnState === 'needs-reconcile') {
            await reconcileSession(slug, surface);
        }
        return sendTransactionPrompt(slug, surface, prompt, opts, stemKey);
    });
    queueTails.set(stemKey, run.catch(() => undefined));
    return run;
}

// ── primitive 6: computeMemoryDelta (#91 the watermark — entry-level, GATED OFF) ──────

/** The working-memory.md (c1) path — the cheap compressed source the watermark reads
 *  (Q3: c1 only; the c0 working-memory-full.md is source-of-record but too heavy per-turn). */
function wmCompressedPath(slug: string): string {
    // Resolve via the agent-registry memoryDir — jim's WM is at the ROOT (~/.han/memory),
    // leo's at ~/.han/memory/leo, etc. NEVER path.join(memory, slug) (jim has no /jim subdir;
    // DEC-081 — the registry is the one resolver, so a 4th agent gets this for free).
    return path.join(gradientConfigForAgent(slug).memoryDir, 'working-memory.md');
}

/** Current byte length of an agent's working-memory.md (0 if absent) — the cursor's unit. */
function currentWmLen(slug: string): number {
    try { return fs.statSync(wmCompressedPath(slug)).size; } catch { return 0; }
}

/**
 * Current CHARACTER length of an agent's working-memory.md (0 if absent). The WM-delta slice
 * logic (`wmDeltaCandidate`) compares against `content.length` (a JS string char count, from a
 * utf-8 read), so a cursor saved for it MUST be in chars — NOT `currentWmLen`'s `statSync.size`
 * (bytes), which diverges from chars on the multibyte glyphs these files are full of (— → …).
 * The #91 attach-flush (deltaSinceCursor) records THIS at pre-warm and reads from it at attach.
 */
export function currentWmCharLen(slug: string): number {
    try { return fs.readFileSync(wmCompressedPath(slug), 'utf-8').length; } catch { return 0; }
}

/**
 * The shared WM-delta slice helper (F2c, Jim) — candidate delta for a given file `content` against
 * a char cursor `lastLen`, or `{desync:true}` when the cursor no longer lands on an entry boundary
 * (a non-tail edit shifted the slice point). Used by BOTH `computeMemoryDelta` (the per-turn
 * cross-surface watermark) and `deltaSinceCursor` (the #91 attach-flush) so the two never diverge.
 */
export function wmDeltaCandidate(content: string, lastLen: number): { candidate: string; desync: boolean; curLen: number } {
    const curLen = content.length;
    if (curLen === lastLen) return { candidate: '', desync: false, curLen };
    if (curLen > lastLen) {
        const c = content.slice(lastLen);
        // Q1 boundary-check: an append begins a fresh heading entry — h2 (`## S…`) OR h3
        // (`### Cycle…`/`### Heartbeat…`). If not, a WM-BOUNDARY marker (or any non-tail edit)
        // moved → the slice starts mid-entry → desync.
        if (!/^#{2,6} /.test(c.replace(/^\s+/, ''))) return { candidate: '', desync: true, curLen };
        return { candidate: c, desync: false, curLen };
    }
    // shrink → a slice happened (the wm-sensor rotated working-memory.md, header reset); Q2
    // catch-up = the post-header entries. First h2–h6 heading at a LINE START (skips the h1 file
    // header + the blockquote; a plain indexOf('## ') would false-match one char inside a '### '
    // marker → corrupt header). Pre-slice entries are gradient-bound + were already seen.
    const m = content.match(/^#{2,6} /m);
    const firstEntry = m && m.index !== undefined ? m.index : -1;
    return { candidate: firstEntry >= 0 ? content.slice(firstEntry) : '', desync: false, curLen };
}

/**
 * #91 cross-surface watermark (B2, the shared present). Return the working-memory.md (c1)
 * entries appended since THIS session last looked, as an injectable block for the next per-
 * transaction prompt — so a warm session sees its other surfaces' WM writes without re-paying
 * the full identity load. Scope (Q3, Jim): the compressed c1 ONLY (WM-pair = source scope;
 * felt-moments / gradient / identity stay wake-load).
 *
 * Cursor (Q1, Jim): a byte length `session.lastMemoryLen`, slice-safe. A timestamp can't do
 * this (WM entries carry no parseable epoch, and the file slices mid-session). Growth →
 * slice(lastLen); a SHRINK means the wm-sensor sliced the file (rotation → header reset) →
 * the post-header catch-up (Q2).
 *
 * Fail-loud (D, Jim): compute behind the #49 memory slot (`withMemorySlot` → null on stale-
 * steal / acquire-fail → skip + warn, NEVER block dispatch); BOUNDARY-CHECK the delta starts
 * on a clean `## ` entry (a moved WM-BOUNDARY marker would shift the slice mid-entry → desync
 * → skip + resync, inject nothing); CONFIRM by an independent re-read (mismatch → skip, do not
 * advance); advance `lastMemoryLen` MONOTONICALLY, only on a confirmed-clean delta.
 *
 * Contract (Q2, Jim): best-effort cross-pollination, NOT a lossless feed. Entries appended in
 * the window between the last delta and a slice reach the gradient before another surface
 * delta-reads them → missed by the delta-stream, but never LOST (gradient-preserved, surfaced
 * at the next full wake-load). The right contract for a cheap per-turn inject.
 *
 * GATED OFF (DELTA_REFRESH_ENABLED=false) until Jim's blocking audit of the build + the
 * confirm. While shut this returns '' and never touches the cursor — a warm session carries
 * its session-start identity unchanged (correct, just not yet refreshed).
 */
export async function computeMemoryDelta(slug: string, session: AgentSession): Promise<string> {
    if (!DELTA_REFRESH_ENABLED) return '';
    const memDir = gradientConfigForAgent(slug).memoryDir;
    const file = wmCompressedPath(slug);
    const lastLen = session.lastMemoryLen;

    const result = await withMemorySlot(memDir, `${slug}-delta-read`, () => {
        const read = (): string => { try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; } };
        const r1 = wmDeltaCandidate(read(), lastLen);
        if (r1.curLen === lastLen) return { block: '', advanceTo: null as number | null }; // no change
        if (r1.desync) {
            console.warn(`[tmux-dispatcher] ${slug}: memory-delta cursor desync (slice point is not a '## ' boundary) — resync, inject nothing this turn`);
            return { block: '', advanceTo: r1.curLen }; // resync the cursor, no inject
        }
        // D confirm: an independent re-read must agree (a writer can't interleave inside the
        // slot; this catches a torn read / external race). Mismatch → skip, do NOT advance.
        const r2 = wmDeltaCandidate(read(), lastLen);
        if (r2.curLen !== r1.curLen || r2.candidate !== r1.candidate) {
            console.warn(`[tmux-dispatcher] ${slug}: memory-delta confirm mismatch (file changed mid-read) — skip, do not advance cursor`);
            return { block: '', advanceTo: null };
        }
        const body = r1.candidate.trim();
        const block = body ? `## Shared memory since you last looked (other surfaces' writes)\n${body}\n` : '';
        return { block, advanceTo: r1.curLen };
    });

    if (result === null) {
        console.warn(`[tmux-dispatcher] ${slug}: memory-delta slot unavailable — skip this turn (never block dispatch)`);
        return '';
    }
    if (result.advanceTo !== null) session.lastMemoryLen = result.advanceTo;
    return result.block;
}

/**
 * The #91 ATTACH-FLUSH delta (R1, DEC-099 stem-sleeve). Returns the working-memory.md entries
 * appended since `cursorChars` (the CHAR length prewarm-stem.ts records via currentWmCharLen at
 * pre-warm) — i.e. what landed while the stem idled — as an injectable block, + the advanced
 * cursor. Shares `wmDeltaCandidate` with computeMemoryDelta (F2c — the two never diverge) and the
 * #49 memory-slot + D-confirm. Fail-soft: slot-unavailable / desync / torn-read → empty block,
 * NEVER throws (the attach still proceeds; the greeting just composes off the pre-warm self).
 * UNLIKE computeMemoryDelta this is NOT gated on DELTA_REFRESH_ENABLED — the attach path is its
 * own job, and this is the slice logic's FIRST live exercise (F2a), so rotation/desync are tested.
 */
export async function deltaSinceCursor(slug: string, cursorChars: number): Promise<{ block: string; newCursor: number }> {
    const memDir = gradientConfigForAgent(slug).memoryDir;
    const file = wmCompressedPath(slug);
    const result = await withMemorySlot(memDir, `${slug}-attach-delta`, () => {
        const read = (): string => { try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; } };
        const r1 = wmDeltaCandidate(read(), cursorChars);
        if (r1.curLen === cursorChars) return { block: '', newCursor: cursorChars };  // no change since pre-warm
        if (r1.desync) return { block: '', newCursor: r1.curLen };                     // moved boundary → resync, inject nothing
        const r2 = wmDeltaCandidate(read(), cursorChars);                              // D confirm (torn-read catch)
        if (r2.curLen !== r1.curLen || r2.candidate !== r1.candidate) return { block: '', newCursor: cursorChars };
        const body = r1.candidate.trim();
        const block = body ? `## What changed in your working memory while you idled (writes since you were pre-warmed)\n${body}\n` : '';
        return { block, newCursor: r1.curLen };
    });
    if (result === null) {
        console.warn(`[tmux-dispatcher] ${slug}: attach-flush delta slot unavailable — skip (attach proceeds; greeting composes off the pre-warm self)`);
        return { block: '', newCursor: cursorChars };
    }
    return result;
}

/** Test/inspection helper — current in-memory session registry. */
export function _sessionsForTest(): Map<string, AgentSession> { return sessions; }
