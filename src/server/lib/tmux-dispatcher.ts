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

const HEALTH_DIR = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');
const PIPES_DIR = process.env.HAN_PIPES_DIR || path.join(os.homedir(), '.han', 'agent-pipes');

/**
 * Q-V2-4 GATE. The dispatcher-computed memory-delta is the warm-session model's load-
 * bearing-but-dangerous piece: a mis-computed delta silently lags the in-session memory
 * behind disk. Per Jim's disposition it MUST stay OFF on identity-bearing surfaces until
 * the fail-loud confirmation (delta carries a checksum; agent echoes "delta: N entries"
 * in its diary; dispatcher cross-checks) lands. The primitive is built; the gate is shut.
 */
export const DELTA_REFRESH_ENABLED = false;

// Timeouts (ms). Compose can run minutes (leo-human dispatches observed at 3-5 min);
// identity load (welcome-back) is ~130K tokens. Conservative defaults; tune at T-3/T-4.
// READY tuned 240s → 600s (first-warm-beat data, 2026-06-12): a full identity wake
// measured ~6.5-7 min (18:56 launch → 19:03 sentinel), so 240s skipped one beat per
// cold launch and timed out every post-clear welcome-back wait (Jim's post-thaw
// audit). 600s covers the empirical wake with margin.
const READY_TIMEOUT_MS = 10 * 60_000;
const TRANSACTION_TIMEOUT_MS = 12 * 60_000;
const POLL_INTERVAL_MS = 750;

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
    /** Epoch ms of the last completed transaction — the cursor for computeMemoryDelta. */
    lastTransactionTs: number;
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
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function tmux(args: string[]): string {
    return execFileSync('tmux', args, { encoding: 'utf-8' });
}

function tmuxSessionExists(name: string): boolean {
    try { tmux(['has-session', '-t', name]); return true; } catch { return false; }
}

/**
 * Send a SHORT, safe instruction line to the session's prompt input, then Enter.
 * `-l` sends the text literally so tmux never interprets a substring as a key name.
 * The Enter is a separate call because `-l` would type the word "Enter" literally.
 * NEVER pass hostile/large content here — that is what the prompt file is for (A3).
 */
function sendLine(tmuxSession: string, line: string): void {
    tmux(['send-keys', '-t', tmuxSession, '-l', line]);
    tmux(['send-keys', '-t', tmuxSession, 'Enter']);
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

const CHROME_TIMEOUT_MS = 3 * 60_000; // chrome appears in seconds; margin for ladder descents
const DESCEND_COOLDOWN_MS = 6_000;    // let /model re-render before re-reading (avoid stale-error false-match)

/** Ladder fully walked and every rung was unavailable. Extends SessionNotReadyError so the
 *  existing surface handlers (which catch SessionNotReadyError → fail-loud + health-signal +
 *  skip) treat it as a not-ready condition: every model dead = fail safe, retry next cadence,
 *  no billing, loud in the health signal. */
export class ModelLadderExhaustedError extends SessionNotReadyError {}

/** Last `lines` non-empty lines of the VISIBLE pane (current state, not deep scrollback —
 *  bounding it keeps a pre-descent error line from false-matching after a successful switch). */
export function capturePaneTail(tmuxSession: string, lines = 14): string {
    let pane = '';
    try { pane = tmux(['capture-pane', '-p', '-t', tmuxSession]); } catch { return ''; }
    return pane.split('\n').filter((l) => l.trim()).slice(-lines).join('\n');
}

/**
 * Poll a freshly-launched session's pane until it shows ready chrome, AUTO-DESCENDING the
 * model ladder via in-session `/model <next rung>` on a model-unavailable prompt, and failing
 * LOUD with a pane snapshot on any other stuck prompt (login / unknown — the survey is
 * suppressed at the launcher via CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY). The MODEL axis is the
 * first instance of the general "detect TUI-state → respond" pattern (Jim's design-for-failure
 * scope note mqbxbsnw): model-error auto-recovers; everything else escalates to a human — an
 * autonomous seat never auto-answers consent/login (a permanent human-gated boundary).
 *
 * Call BEFORE the welcome-back wake (a working model must be selected first). `ladder[0]` is
 * the model the launcher already used, so descent starts at rung 1; one `/model` per rung with
 * a cooldown (never a tight loop, S74); ladder exhausted → throw. Returns once ready chrome
 * appears on whatever rung succeeded.
 */
export async function awaitChromeOrDescend(
    slug: string, surface: string, tmuxSession: string, ladder: string[], timeoutMs = CHROME_TIMEOUT_MS,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let rung = 0; // launcher already used ladder[0]
    for (;;) {
        const tail = capturePaneTail(tmuxSession);
        if (MODEL_UNAVAILABLE_RE.test(tail)) {
            rung += 1;
            if (rung >= ladder.length) {
                throw new ModelLadderExhaustedError(
                    `${slug}/${surface}: every model rung unavailable (${ladder.join(' → ') || '<empty ladder>'}). Pane tail:\n${tail}`);
            }
            console.warn(`[tmux-dispatcher] ${slug}/${surface}: model rung "${ladder[rung - 1]}" unavailable — descending to "${ladder[rung]}" via in-session /model`);
            sendLine(tmuxSession, `/model ${ladder[rung]}`);
            await sleep(DESCEND_COOLDOWN_MS);
            continue;
        }
        if (READY_CHROME_RE.test(tail)) return;
        if (Date.now() > deadline) {
            throw new SessionNotReadyError(
                `${slug}/${surface}: chrome never became ready within ${timeoutMs}ms (not a model error — likely login/unknown prompt; human needed). Pane tail:\n${tail}`);
        }
        await sleep(2_000);
    }
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

    const session: AgentSession = { slug, surface, tmuxSession, launchCommand, ready: true, turnState: 'idle', lastTransactionTs: Date.now() };
    sessions.set(sessionKey(slug, surface), session);
    console.log(`[tmux-dispatcher] session ready: slug=${slug} surface=${surface} tmux=${tmuxSession}`);
    return session;
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
    const promptFile = pipePath(slug, txnId);
    writeAtomic(promptFile, prompt);
    // 3) send-keys only a short, safe instruction pointing the agent at the file.
    sendLine(session.tmuxSession,
        `Your next turn's full prompt is in the file ${promptFile} — read it with the Read tool and act on its entire contents as this turn's instructions.`);

    // 4) Poll the sink for this txn's capture (or an orphan, surfaced as fail-loud).
    const cap = await waitFor<CaptureRecord>(() => {
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
    }, timeoutMs).catch(() => {
        // Timeout ≠ idle: the session may still be composing. Mark for forced
        // reconciliation; the queue runs reconcileSession before the next dispatch.
        session.turnState = 'needs-reconcile';
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

    sendLine(session.tmuxSession, '/pfc');
    await sleep(2_000); // let /pfc flush before /clear wipes context
    sendLine(session.tmuxSession, '/clear');
    await sleep(2_000);
    sendLine(session.tmuxSession, opts.welcomeBack ?? 'welcome back');

    await waitForReady(slug, surface, beforeMtime, READY_TIMEOUT_MS);
    session.ready = true;
    session.turnState = 'idle';
    session.lastTransactionTs = Date.now();
    console.log(`[tmux-dispatcher] ${slug}/${surface}: cleared + reloaded`);
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

// ── primitive 6: computeMemoryDelta (built, GATED OFF — Q-V2-4) ───────────────────────
/**
 * Return the memory entries written since `lastTransactionTs` as an injectable block for
 * the next per-transaction prompt, so a warm session stays aligned with disk without re-
 * paying the full identity load. Scope per Jim's disposition: working-memory PAIR only for
 * T-1/T-3 (the entire reason the delta exists is cross-aspect WM writes); felt-moments /
 * self-reflection / discoveries are added after the T-4 observation period.
 *
 * GATED OFF (DELTA_REFRESH_ENABLED=false) until the fail-loud confirmation lands. While the
 * gate is shut this returns '' so warm sessions simply carry their session-start identity
 * unchanged — correct, just not yet refreshed. Drift cannot outlive a session because
 * clearSession reloads full memory from disk.
 */
export function computeMemoryDelta(slug: string, lastTransactionTs: number): string {
    if (!DELTA_REFRESH_ENABLED) return '';
    const memDir = path.join(os.homedir(), '.han', 'memory', slug);
    const files = ['working-memory.md', 'working-memory-full.md'];
    const changed = files
        .map((f) => path.join(memDir, f))
        .filter((p) => { try { return fs.statSync(p).mtimeMs > lastTransactionTs; } catch { return false; } });
    if (!changed.length) return '';
    // NOTE: file-level mtime is a coarse signal; entry-level diffing + the checksum/echo
    // confirmation is the work that must land before the gate opens. Skeleton stub only.
    const block = changed.map((p) => `- ${path.basename(p)} changed since last transaction`).join('\n');
    return `## Memory delta since your last transaction\n${block}\n`;
}

/** Test/inspection helper — current in-memory session registry. */
export function _sessionsForTest(): Map<string, AgentSession> { return sessions; }
