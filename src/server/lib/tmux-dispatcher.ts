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

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CaptureRecord } from './diary-mcp-server';
import { withMemorySlot } from './memory-slot';
import { gradientConfigForAgent } from './agent-registry';
import { spokeLifecycleFor, wakeFeedFor } from './garden-manifest';
import { mostRecentC0Id, isAgentC0 } from './memory-gradient';

const HEALTH_DIR = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');
const PIPES_DIR = process.env.HAN_PIPES_DIR || path.join(os.homedir(), '.han', 'agent-pipes');

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
const MODEL_DISPLAY_TO_ID: Record<string, string> = {
    'opus 4.8': 'claude-opus-4-8', 'opus 4.7': 'claude-opus-4-7', 'opus 4.6': 'claude-opus-4-6',
    'sonnet 4.6': 'claude-sonnet-4-6', 'haiku 4.5': 'claude-haiku-4-5', 'fable 5': 'claude-fable-5',
};
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
export function observeActiveModel(slug: string, surface: string): string | null {
    const tail = capturePaneTail(`${surface}-${slug}`, 8);
    if (!tail) return null;
    // Direct api-id form, if a chrome version prints it: "claude-opus-4-8".
    const idMatch = tail.match(/claude-[a-z]+-[0-9][0-9-]*/i);
    if (idMatch) return idMatch[0].toLowerCase();
    // Display-name form in the status line: "Opus 4.8", "Fable 5", …
    const dispMatch = tail.match(/\b(Opus|Sonnet|Haiku|Fable)\s+[0-9](?:\.[0-9])?/i);
    if (dispMatch) {
        const key = dispMatch[0].toLowerCase().replace(/\s+/g, ' ').trim();
        if (MODEL_DISPLAY_TO_ID[key]) return MODEL_DISPLAY_TO_ID[key];
    }
    return null;
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

    const session: AgentSession = { slug, surface, tmuxSession, launchCommand, ready: true, turnState: 'idle', lastTransactionTs: Date.now(), lastMemoryLen: currentWmLen(slug) };
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
    return withSlugLock(slug, () => ensureSurfaceSessionInner(slug, surface, opts));
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
        execFileSync('bash', [LAUNCH_SURFACE_SCRIPT, slug, surface], { stdio: 'inherit' });
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
    opts: { timeoutMs?: number } = {}
): Promise<CaptureRecord> {
    const session = sessions.get(sessionKey(slug, surface));
    if (!session || !session.ready) throw new SessionNotReadyError(`${slug}/${surface}: no ready session; call spawnAgentSession first`);
    // Idle precondition (#5): dispatching into a busy or unreconciled session is
    // exactly the interleaving/misattribution hole the reconcile design closes.
    if (session.turnState !== 'idle') {
        throw new SessionNotReadyError(`${slug}/${surface}: session is '${session.turnState}', not idle — reconcile before dispatching (enqueueForAgent does this automatically)`);
    }

    const txnId = `txn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const timeoutMs = opts.timeoutMs ?? TRANSACTION_TIMEOUT_MS;
    session.turnState = 'busy';

    // 1) Point the diary sink at this transaction BEFORE the prompt can be answered.
    writeAtomic(currentPtrPath(slug), JSON.stringify({ txnId, startedAt: new Date().toISOString() }));
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
        const exact = capturePath(slug, txnId);
        if (fs.existsSync(exact)) return JSON.parse(fs.readFileSync(exact, 'utf-8')) as CaptureRecord;
        // Orphan capture (pointer was missing when the tool fired) — accept newest orphan
        // created after we started, so the payload is never silently dropped. The
        // mtime gate vs lastTransactionTs is what keeps a LATE capture from an
        // abandoned (reconciled) transaction out of this window — reconcileSession
        // bumps lastTransactionTs precisely so pre-reconcile orphans can't be
        // misattributed to the next transaction.
        const orphans = fs.readdirSync(sinkDir(slug))
            .filter((f) => f.startsWith('orphan-') && f.endsWith('.json'))
            .map((f) => path.join(sinkDir(slug), f))
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
    return withSlugLock(slug, () => clearSessionInner(slug, surface, opts));
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

export async function feedWakeSteps(
    slug: string, surface: string, steps: WakeStep[],
    opts: { perStepTimeoutMs?: number; tmuxTarget?: string } = {},
): Promise<void> {
    // `tmuxTarget` (P2.4): the interactive seat's LOCAL feeder (feed-wake-local.ts) aims the SAME
    // shared feeder at the seat's own pane (`$TMUX_PANE`) instead of a dispatcher-owned `surface-slug`
    // session — so the boundary stays clean (no server→human-session reach). Spokes pass nothing.
    const tmuxSession = opts.tmuxTarget ?? `${surface}-${slug}`;
    const perStepTimeoutMs = opts.perStepTimeoutMs ?? READY_TIMEOUT_MS;
    for (const step of steps) {
        if (step.ack.kind === 'terminal') {
            // P2.4 — the session hand-back (compose-greeting): send the BARE prompt (no STEP-OK ask),
            // then return. It's the LAST step (wakeStepsFor appends it for `session` only), the agent's
            // greeting is its natural-language output to the human, and queue-empty IS the hand-back —
            // control returns to the human exactly when the greeting appears. Never fed to a spoke.
            await sendLineSettled(tmuxSession, step.prompt);
            return;
        }
        // Fresh nonce per feed (P2.1b #1): the ack the feeder waits for is `STEP-OK <id> <nonce>`,
        // so a re-fed step can never satisfy on a stale marker. The feeder OWNS the ack instruction
        // (appended single-line); the WakeStep.prompt is the pure load instruction. The HOW-detail
        // (chunk if >25K, etc.) lives in the spoke's wake-protocol (the template) — the fed prompt is
        // the concise pointer + the ack request. Sent via sendLineSettled (NOT sendLine): the fed
        // line is long, so it settles before the Enter — else the Enter races the paste and the
        // prompt sits unsubmitted (the P2.3 surface-1 stall).
        const nonce = wakeNonce();
        await sendLineSettled(tmuxSession, `${step.prompt} — when COMPLETE reply on its own line EXACTLY: STEP-OK ${step.id} ${nonce}`);
        const ackRe = new RegExp(`STEP-OK\\s+${step.id}\\s+${nonce}\\b`);
        const isAcked = (tail: string): boolean => {
            if (!ackRe.test(tail)) return false;
            if (step.ack.kind === 'c0') {
                // the truncation-prone step: marker alone is not enough — the echoed c0 must be real.
                const echoed = readSentinelC0Id(slug, surface);
                if (!(echoed && isAgentC0(slug, echoed))) return false;
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
        const deadline = Date.now() + perStepTimeoutMs;
        for (;;) {
            if (isAcked(capturePaneTail(tmuxSession))) break;
            if (Date.now() > deadline) {
                throw new DispatchTimeoutError(
                    `wake step '${step.id}' not acked after ${resubmits} re-submit(s) (timeout ${perStepTimeoutMs}ms)`);
            }
            await sleep(POLL_INTERVAL_MS);
        }
    }
    // queue-empty → the wake-prefix has drained → the spoke is warm-ready; the caller releases work.
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
    { id: 'integrity',   ack: { kind: 'marker' }, prompt: 'FIRST, run your identity-integrity gate (DEC-083, wake step-0): (cd /home/darron/Projects/han/src/server && npx tsx ../../scripts/verify-identity-files.ts --agent=$AGENT_SLUG --entry-point=wake-feed-step-0). If it exits NON-ZERO, HALT — do NOT load anything and do NOT ack (surface the failure); a tampered/missing identity must stop the wake here. Only on a clean (exit 0) pass, proceed.' },
    { id: 'identity',    ack: { kind: 'marker' }, prompt: 'Load your identity layer ENTIRE: identity.md, patterns.md, your curated self-reflection (self-reflections-curated.md, else self-reflection.md), then aphorisms.md (whole, first).' },
    { id: 'gradient',    ack: { kind: 'c0' },     prompt: 'Load your full memory gradient deepest-first via load-gradient.ts; TRAVERSE it (do not grep) to the final `GRADIENT-EOF: c0=<id>` line, then write that c0 id to your readiness sentinel (per wake-protocol step 10).' },
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
    },
): Promise<CaptureRecord | null> {
    const life = spokeLifecycleFor(slug, surface);
    let cap: CaptureRecord;
    try {
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
function withSlugLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prior = slugLockTail.get(slug) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(fn);
    slugLockTail.set(slug, run.catch(() => undefined));
    return run;
}

/** NOTE (T-2 re-key): the queue stays keyed per-SLUG even though readiness/ctx
 *  went per-surface — one live transaction per AGENT across all its surface
 *  sessions is the invariant that keeps the single per-slug current.json (and
 *  the memory-slot write serialisation) safe. `surface` only routes the prompt
 *  to the right session. */
export function enqueueForAgent(slug: string, surface: string, prompt: string, opts: { timeoutMs?: number } = {}): Promise<CaptureRecord> {
    const prior = queueTails.get(slug) ?? Promise.resolve();
    // Chain regardless of the prior transaction's outcome so one failure can't wedge
    // the queue — but reconcile FIRST when the target session needs it (#5): the
    // queue must never dispatch into a needs-reconcile session (idle precondition).
    const run = prior.catch(() => undefined).then(async () => {
        const session = sessions.get(sessionKey(slug, surface));
        if (session && session.turnState === 'needs-reconcile') {
            await reconcileSession(slug, surface);
        }
        return sendTransactionPrompt(slug, surface, prompt, opts);
    });
    queueTails.set(slug, run.catch(() => undefined));
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
