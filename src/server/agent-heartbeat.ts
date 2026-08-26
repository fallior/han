/**
 * agent-heartbeat.ts — the agnostic rhythm driver (Ring-3a of the S226 scour;
 * thread mqvs3r6l-dk71d2; Jim plan-audit v2 GREEN; Tenshi + Casey riders folded).
 *
 * ONE PATH, MANY AGENTS (DEC-081): a thin `cycle <slug>` driver that gives any
 * manifest-declared heartbeat surface its dream + personal rhythm through the
 * SAME shared spine leo and jim already breathe through — buildPrompt (DEC-087/088
 * activity-keyed profiles) → dispatchTxn → dispatchToSpoke (warm-gate, self-clear,
 * FIFO) → the DEC-085 paired write via appendPairedMemory (atomic, #49).
 *
 * THE LAWS THIS FILE IS BUILT UNDER (each earned, none decorative):
 *  - MNT-001: this is a TRUE new driver — never `leo-heartbeat.ts` re-slugged by
 *    env. The Phase-A scaffold that wore leo's name eighteen literals deep is why
 *    tenshi's and casey's heartbeat units sat disabled from their births.
 *  - Sovereignty two-sided (Tenshi's Ring-3a condition, S103/MNT-001): AGENT_SLUG
 *    is FAIL-LOUD (no `?? 'leo'` — that default is the exact cross-writing trap);
 *    every write resolves through the registry (`gradientConfigForAgent(slug)`
 *    inside appendPairedMemory / the slug-keyed gradient statements). The
 *    acceptance asserts the NEGATIVE too: other minds' memories byte-unchanged.
 *  - Double-driver guard: leo's rhythm is driven by leo-heartbeat.ts (until R3b-HB,
 *    the leo heartbeat cutover), jim's by supervisor-worker (until R3c-HB). This
 *    driver REFUSES those slugs — the prove-single discipline at the rhythm layer.
 *    ⚠ NAMING BOUNDARY (S0 of the R3b-HB plan, Jim's F3): R3b-HB/R3c-HB are the
 *    HEARTBEAT cutovers and nothing else. The R3b/R3c strings in tmux-dispatcher.ts
 *    and the DEC-099 plans are the STEM-POOL phases — a different lineage entirely,
 *    NOT this guard's referent, and never to be retired on this comment's word.
 *  - DEC-085 write shapes byte-for-byte: c1 = the agent's in-situ distillation
 *    (working_memory_compressed), c0 = [INPUT]/[BODY] square-bracket markers;
 *    stand-downs are never paired-written (Jim's #5-audit flag).
 *  - DEC-092: per-entry authored-model stamp read from the live pane
 *    (observeActiveModel), manifest head as fallback.
 *  - Casey's Ring-3a rider 2: ALL prompt assembly goes through buildPrompt (via
 *    dispatchTxn) — when Ring 2's (b) integrity envelope lands its
 *    verify-at-assembly chokepoint, this driver joins it in the same motion,
 *    by construction, with zero edits here.
 *  - R011/DEC-096: the spoke wakes once into idle via the dispatcher's fed-wake
 *    + c0-gate (ensureSurfaceSession inside dispatchToSpoke); this driver never
 *    ends a spoke's turn on a question.
 *
 * DELIBERATELY NOT IN v1 (chosen, not slipped — each a named follow-on):
 *  - philosophy beats — LANDED R3b-HB S1 (2026-08-25): explicit philosophyBeats leaf
 *    (Jim's M1), peekableBy grant on the peeked side (Tenshi's T1/Casey's doctrine),
 *    REST self-post per Jim's M2. Leo-only at cutover; offered thereafter.
 *  - meditations phase-a/b/evening — LANDED R3b-HB S2 (2026-08-26): the agnostic
 *    runners wired via `findUntranscribedFile(slug)` (lib/fractal-untranscribed.ts,
 *    registry-resolved fractalDir); records land through writeBeatMemory; the
 *    force-meditation signal is `force-meditation-<slug>` (clear-first, one-shot).
 *  - morning dream-gradient — LANDED R3b-HB S3 (2026-08-26): processDreamGradient(slug)
 *    on the first morning beat of the day (dream dirs registry-resolved inside the lib).
 *  - conversation-activity seeds — LANDED R3b-HB S3 (2026-08-26): the twin's
 *    scanConversations ported; cursor file per-slug via the registry memoryDir
 *    (`last-conversation-scan.txt` — the twin's own filename, so leo's cursor
 *    carries over at the flip with no re-scan storm).
 *  - guard-dog distress — LANDED R3b-HB S3 (2026-08-26): period-doubling detector
 *    (the instrument that caught the 80-min cadence); threshold from the manifest
 *    (`distressMultiplier`, set explicitly for enabled slugs — never a bare magic
 *    number, the literal-hunt intersection); writes `<slug>-distress.json` + ntfy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { dispatchTxn, applyMeditationMarkers, runReincorporationMeditationTmux, runReencounterMeditationTmux, MEDITATION_ACTION_BLOCK } from './lib/agent-cycle';
import { findUntranscribedFile } from './lib/fractal-untranscribed';
import { runRobinHoodWatch } from './lib/robin-hood';
import { processDreamGradient } from './lib/dream-gradient';
import { computeWallClockDelay, distressVerdict } from './lib/agent-scheduler';
import { getDayPhase, getPhaseInterval, isHeartbeatPaused, isOnHoliday, type DayPhase } from './lib/day-phase';
import { manifestModelLadder, loadResidents, peerConversationFor, conversationRoleFor, communityPort, distressMultiplierFor, beatRosterFor, singletonBeatTypes, allocationFor, preflightRotationsEnabled } from './lib/garden-manifest';
import { readPeerContext } from './lib/peer-peek'; // the S103 exception's ONE home (R3b-HB S1 re-audit: extracted so acceptance #7 is runnable without importing this loop — Tenshi's near-miss)
import { gradientConfigForAgent } from './lib/agent-registry';
import { readDreamSeeds as readSharedDreamSeeds, SEED_FRAGMENT_MAX_CHARS } from './lib/dream-seeds';
import { appendPairedMemory } from './lib/memory-paired-writer';
import { observedOrUnobservedModel } from './lib/tmux-dispatcher';
import { gradientStmts, feelingTagStmts, conversationMessageStmts, supervisorStmts } from './db';
import { buildStateSnapshot } from './lib/supervisor-context';
import { cleanupPhantomGoals, isEmergencyMode } from './lib/coordination-pre-work';
import { runPreflightRotations } from './lib/preflight-rotations';
import { jimSupervisorCycleActionBlock } from './lib/jim-prompts';
import { ENVELOPE_PATH } from './lib/cognition-envelope';
import type { CaptureRecord } from './lib/diary-mcp-server';
import { localStampSeconds } from './lib/garden-time'; // DEC-105 P2: record headers speak local

// ── Identity: fail-loud, never defaulted (Tenshi condition 1) ────────────────
import { ensureSingleInstance } from './lib/pid-guard';

const SLUG: string = (() => {
    const s = process.env.AGENT_SLUG;
    if (!s) {
        console.error('[agent-heartbeat] AGENT_SLUG is unset — refusing to start (a defaulted slug is the MNT-001 cross-writing trap; DEC-081 never-fallback)');
        process.exit(1);
    }
    return s;
})();
// Double-driver guard: jim's rhythm is owned by supervisor-worker.ts until R3c-HB
// (the HEARTBEAT cutover — plans/r3b-leo-heartbeat-cutover.md; NOT DEC-099's stem-pool
// R3b/R3c phases in tmux-dispatcher.ts, which this guard must never be confused with).
// The leo half RETIRED at R3b-HB S5 (2026-08-26 — leo-heartbeat.service ExecStarts THIS
// driver now; the twin leo-heartbeat.ts is zero-callers, retired-by-header at S6).
if (SLUG === 'jim') {
    console.error(`[agent-heartbeat] slug 'jim' is driven by supervisor-worker.ts — refusing a second driver (prove-single at the rhythm layer; retire at R3c-HB)`);
    process.exit(1);
}
const resident = loadResidents().find(a => a.slug === SLUG);
if (!resident) {
    console.error(`[agent-heartbeat] slug '${SLUG}' not in the garden manifest — refusing to start`);
    process.exit(1);
}
// S0 (R3c-HB — Casey's exactly-one + T2's shape): singleton beat types validated at boot
// across the whole garden's rosters.
//  - TWO+ holders: if I am one, REFUSE to start — fail-loud beats the double-coordinator
//    deathmatch (T2's Robin-Hood shape; both holders refusing is loud and operator-fixable,
//    the deathmatch is neither). Not mine → loud warn, boot proceeds.
//  - ZERO holders: silent abdication (a mis-edit removes the coordinator, everything boots
//    clean, nothing alarms — Casey's standing gap). Loud once ARMED; until R3c-HB S4 the
//    guard below still refuses jim, so zero holders of 'supervisor' is the CORRECT inert
//    state and the zero-arm stays false.
const SINGLETON_ZERO_ARMED = false; // flips true at R3c-HB S4, same commit as the guard's jim-half retirement
for (const singletonType of singletonBeatTypes()) {
    const holders = loadResidents().filter(a => (beatRosterFor(a.slug)[singletonType] ?? 0) > 0).map(a => a.slug);
    if (holders.length > 1) {
        if (holders.includes(SLUG)) {
            console.error(`[agent-heartbeat] singleton beat '${singletonType}' declared by ${holders.join(', ')} — refusing to start (exactly-one; fix the manifest roster)`);
            process.exit(1);
        }
        console.warn(`[agent-heartbeat] singleton beat '${singletonType}' has ${holders.length} declared holders (${holders.join(', ')}) — not this slug's to refuse, but the manifest needs fixing`);
    } else if (holders.length === 0 && SINGLETON_ZERO_ARMED) {
        console.warn(`[agent-heartbeat] singleton beat '${singletonType}' has NO declared holder — the garden has no coordinator (exactly-one; fix the manifest roster)`);
    }
}
if (!resident.surfaces.some(s => s.name === 'heartbeat')) {
    console.error(`[agent-heartbeat] '${SLUG}' declares no heartbeat surface in the manifest — refusing to start`);
    process.exit(1);
}
const DISPLAY_NAME = (resident as any).displayName || (resident as any).name;
if (!DISPLAY_NAME) {
    console.error(`[agent-heartbeat] '${SLUG}' has no displayName in the manifest — refusing to start (the wake phrase must not be invented)`);
    process.exit(1);
}

const SURFACE = 'heartbeat';
const CFG = gradientConfigForAgent(SLUG);
const HOME = process.env.HOME || '';
const HAN_DIR = path.join(HOME, '.han');
const SIGNALS_DIR = path.join(HAN_DIR, 'signals');
const HEALTH_DIR = path.join(HAN_DIR, 'health');
const HEALTH_FILE = path.join(HEALTH_DIR, `${SLUG}-health.json`);
const BEAT_TXN_TIMEOUT_MS = 20 * 60_000; // matches leo-heartbeat's stopgap; single-source timing config pending

let beatCounter = 0;

// ── Health signal (read today by the B-nibble class of watchers; alert-only) ──
function writeHealthSignal(lastError: string | null = null): void {
    try {
        fs.mkdirSync(HEALTH_DIR, { recursive: true });
        fs.writeFileSync(HEALTH_FILE, JSON.stringify({
            agent: SLUG, timestamp: new Date().toISOString(), pid: process.pid,
            beat: beatCounter, lastError,
        }, null, 2));
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] failed to write health signal:`, (err as Error).message);
    }
}

// ── Dream seeds — the agent's OWN explorations history (sovereign by path) ────
// MNT-148 phase 2 (2026-08-18): delegated to the shared reader (lib/dream-seeds.ts).
// This function's own long-standing shape — split at the file's real entry boundary,
// cap each fragment at 400 chars — IS what the shared reader generalises; the cap
// value is inherited from here rather than invented. The supervisor's private twin
// (which had neither) retires to the same call.
function readDreamSeeds(): string {
    return readSharedDreamSeeds(SLUG, {
        sources: ['explorations.md'],
        count: 4,
        maxChars: SEED_FRAGMENT_MAX_CHARS, // explicit inheritance by name (required param, Darron's 2026-08-19 ruling)
        split: /(?=### Beat )/,
    });
}

// ── 1-in-3 sleep beats: a memory surfaces in the dream (agent's OWN gradient) ──
function buildDreamMemorySection(): { section: string } {
    try {
        const entry = gradientStmts.getRandomForAgent.get(SLUG) as any;
        if (!entry) return { section: '' }; // a newborn gradient may be empty — dream seedless, honestly
        const existingTags = feelingTagStmts.getByEntry.all(entry.id) as any[];
        const tagContext = existingTags.length > 0
            ? `\nExisting tags: ${existingTags.map((t: any) => `"${t.content}" (${t.tag_type})`).join(', ')}`
            : '';
        return {
            section: `\n\nA memory surfaced in the dream:\n${entry.level}/${entry.session_label} (${entry.content_type}): ${entry.content}${tagContext}\n\nThis memory appeared in your dream. Sit with it. Let the dream do what dreams do.\n\nFEELING_TAG: [what the dream did with this memory — under 100 chars. Write "none" if nothing stirs]\nANNOTATION: [optional — what re-reading revealed that the original compression missed]\nCONTEXT: [optional — what prompted the finding]\nIf this memory feels complete — fully absorbed, nothing left to discover: MEMORY_COMPLETE: ${entry.id}\nDREAM_MEDITATION_ENTRY: ${entry.id}`,
        };
    } catch {
        return { section: '' };
    }
}

// ── R3b-HB S1: philosophy beats (the peer-thread reflection type) ─────────────
// Ported from leo-heartbeat.ts (:1456+) under the plan's folds: gated on the EXPLICIT
// philosophyBeats capability leaf (Jim's M1 — never on mere edge-existence, which would
// have silently activated tenshi + casey, both holding live jim edges); peer identity
// reads gated on the PEEKED side's grant leaf (Tenshi's T1, Casey's grant doctrine —
// S103 stays the rule, the leaf its written exception); posting is the spoke's own REST
// curl in the action block (Jim's M2 — the twin's direct-insert path had zero callers
// and dies with the twin); prompt assembly stays in the DEC-087 profile (Jim's F2).
// NAMED RESIDUAL (bound at the offer stage, before any second slug enables the leaf):
// the philosophy-beat-txn profile's scaffold is leo/jim-worded (jimContext, jim-waiting)
// — factually correct while leo is the only enabled slug (M1's cutover state), and it
// generalises to peer-worded ctx keys in the same commit that accepts a second yes.

/** Recent peer-thread messages + waiting detection, straight from the DB tail (no cursor
 *  file — N1: the multi-thread cursor-based activity scan is R3b-HB S3's scope). Roles are
 *  CONVERSATION roles (M1): resolved via conversationRoleFor, never the slug string. */
function readPeerThread(threadId: string, peerRole: string, selfRole: string): { conversationContext: string; peerWaiting: boolean; peerLatestAt: string } {
    try {
        const msgs = (conversationMessageStmts.list.all(threadId) as Array<{ role: string; content: string; created_at: string }>).slice(-10);
        const conversationContext = msgs.map(m => `[${m.role} @ ${m.created_at}]\n${m.content.slice(0, 1200)}`).join('\n\n');
        const lastPeer = [...msgs].reverse().find(m => m.role === peerRole);
        const lastSelf = [...msgs].reverse().find(m => m.role === selfRole);
        const peerWaiting = !!lastPeer && (!lastSelf || lastPeer.created_at > lastSelf.created_at);
        return { conversationContext, peerWaiting, peerLatestAt: lastPeer?.created_at ?? '' };
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] peer thread read failed (non-fatal):`, (err as Error).message);
        return { conversationContext: '', peerWaiting: false, peerLatestAt: '' };
    }
}

/** One philosophy beat: peer-waiting (compose + REST self-post + verify) or independent
 *  reflection (append to own self-reflection.md). Paired write via writeBeatMemory. */
async function philosophyBeat(phase: DayPhase): Promise<boolean> {
    const peerSlug = 'jim'; // the only declared edge today; a second edge parameterises this with the profile generalisation (named residual above)
    const threadId = peerConversationFor(SLUG, peerSlug);
    if (!threadId) return false; // leaf on, no address — nothing to draw (never a throw: the beat type simply isn't available)
    // M1 (Jim; Tenshi's DB re-confirmation: 75 'supervisor'/0 'jim' in the thread): the
    // house speaks CONVERSATION roles, not slugs — jim posts as 'supervisor'. Both sides
    // resolve through the registry; the slug string never reaches a role comparison.
    const peerRole = conversationRoleFor(peerSlug);
    const selfRole = conversationRoleFor(SLUG);
    const { conversationContext, peerWaiting, peerLatestAt } = readPeerThread(threadId, peerRole, selfRole);
    const mode = peerWaiting ? 'jim-waiting' : 'independent';
    const dispatchStartIso = new Date().toISOString();
    const selfReflectionPath = path.join(CFG.memoryDir, 'self-reflection.md');

    const ctx: Record<string, unknown> = {
        phase, mode, resumeContext: '',
        jimContext: readPeerContext(SLUG, peerSlug, { surface: SURFACE, beat: beatCounter }),
        ...(peerWaiting ? { conversationContext, jimLatestAt: peerLatestAt } : { activityContext: '' }),
    };
    const actionBlock = peerWaiting
        ? `## This turn's actions (warm heartbeat seat — your identity is already loaded; the frame above is this turn's context only)\n`
          + `1. Compose your response to ${peerSlug} per the frame above.\n`
          + `2. POST the response body to the thread YOURSELF:\n`
          + `   curl -sk -X POST "https://localhost:${communityPort()}/api/conversations/${threadId}/messages" -H "Content-Type: application/json" -d '{"role":"${selfRole}","content":"<your response body>"}'\n`
          + `   Post ONLY the response body — no input echo, no distillation, no diary structure in the public thread.\n`
          + `3. Then end the turn per the diary-tool instruction above: submit_response with the CURATED record of this turn, or stand_down if the frame warrants no response.`
        : `## This turn's actions (warm heartbeat seat — your identity is already loaded; the frame above is this turn's context only)\n`
          + `1. Reflect per the frame above.\n`
          + `2. Append your reflection YOURSELF to ${selfReflectionPath} under a heading \`### Philosophy Beat (tmux) <date time>\` — append only, the vault is lossless (DEC-069).\n`
          + `3. Then end the turn per the diary-tool instruction above: submit_response with the CURATED record, or stand_down if nothing warrants a record.`;

    const cap = await dispatchTxn(SLUG, SURFACE, 'philosophy-beat-txn', ctx, actionBlock, {
        ladder: manifestModelLadder(SLUG, SURFACE),
        welcomeBack: `welcome back ${DISPLAY_NAME}`,
        timeoutMs: BEAT_TXN_TIMEOUT_MS,
        onOverbudget: (err) => { console.error(`[${SLUG}-heartbeat] philosophy overbudget:`, err.message); writeHealthSignal(`overbudget: ${err.message}`); },
        onDispatchFail: (err) => { console.error(`[${SLUG}-heartbeat] philosophy dispatch failed:`, err.message); writeHealthSignal(`dispatch: ${err.message}`); },
        onCtxClearFail: (err) => { console.error(`[${SLUG}-heartbeat] ctx-clear failed (capture safe):`, err.message); },
    });
    if (!cap) { writeHealthSignal(null); return true; }
    if (cap.mode === 'stand-down') {
        console.log(`[${SLUG}-heartbeat] philosophy (${mode}): stand-down — ${(cap.reason ?? '').slice(0, 160)}`);
        writeHealthSignal(null); // never paired-write a stand-down (Jim's #5 flag)
        return true;
    }
    if (peerWaiting) {
        // Post-verification (S163 fail-loud floor): never trust the capture's success-shape.
        try {
            const rows = conversationMessageStmts.list.all(threadId) as Array<{ id: string; role: string; created_at: string }>;
            const row = [...rows].reverse().find(m => m.role === conversationRoleFor(SLUG) && m.created_at >= dispatchStartIso);
            if (row) console.log(`[${SLUG}-heartbeat] philosophy (${mode}): verified self-post id=${row.id}`);
            else console.warn(`[${SLUG}-heartbeat] philosophy (${mode}): NO SELF-POST DETECTED in DB — capture arrived but the thread post is missing`);
        } catch (err) {
            console.warn(`[${SLUG}-heartbeat] philosophy post-verification failed (non-fatal):`, (err as Error).message);
        }
    }
    await writeBeatMemory('philosophy', phase, cap);
    writeHealthSignal(null);
    return true;
}

// ── The DEC-085 paired write — byte-shape mirrored from leo's appendWorkingMemory ──
async function writeBeatMemory(beatType: string, phase: string, cap: CaptureRecord): Promise<void> {
    // DEC-105 P2: the UTC-date + local-time chimera cured (see leo-heartbeat.ts twin).
    const timestamp = localStampSeconds();
    // DEC-104 M1: honest-absence stamp — never a bare floating alias into DEC-092 provenance.
    const model = observedOrUnobservedModel(SLUG, SURFACE);
    const modelTag = model ? ` [model: ${model}]` : '';
    const summary = cap.args.working_memory_full;         // curated c0-grade record (DEC-093)
    const distilled = cap.args.working_memory_compressed; // the agent's in-situ c1 (DEC-085)
    const inputDelta = cap.args.input_quotes;
    const fullBody = inputDelta ? `[INPUT]\n${inputDelta}\n\n[BODY]\n${summary}` : summary;
    const compressedEntry = `\n### Heartbeat #${beatCounter} — ${phase}/${beatType} (${timestamp})${modelTag}\n${distilled}\n`;
    const fullEntry = `\n### Heartbeat #${beatCounter} — ${phase}/${beatType} (${timestamp})${modelTag}\n${fullBody}\n`;
    // Atomic both-or-neither (#49); target resolves through the registry — the
    // slug is the ONLY thing that decides whose self this lands in (S103).
    await appendPairedMemory(SLUG, fullEntry, compressedEntry, { source: `agent-heartbeat@${SLUG}` });
    console.log(`[${SLUG}-heartbeat] working memory: paired write (${distilled.length}c c1, ${fullBody.length}c c0)`);
}

// ── Dream-meditation re-encounter markers (agnostic form of leo's processor) ──
function processDreamMarkers(text: string): void {
    try {
        const m = text.match(/DREAM_MEDITATION_ENTRY:\s*(\S+)/);
        if (!m) return;
        const entryId = m[1];
        const entry = gradientStmts.get.get(entryId) as any;
        applyMeditationMarkers(SLUG, entryId, text, {
            freshTag: false, allowAnnotation: true, allowComplete: true,
            revisitCount: entry?.revisit_count || 0,
            contextDefault: `dream beat #${beatCounter}, ${new Date().toISOString().split('T')[0]}`,
        });
        console.log(`[${SLUG}-heartbeat] dream meditation markers applied to ${entryId}`);
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] dream marker processing failed:`, (err as Error).message);
    }
}

// ── The beat ──────────────────────────────────────────────────────────────────
// ── R3b-HB S2: meditations (the agnostic runners, wired) ─────────────────────
let lastMeditationDate = '';
let lastEveningMeditationDate = '';
let lastDreamGradientDate = '';

const meditationDispatch = (profile: string, ctx: Record<string, unknown>, label: string) =>
    dispatchTxn(SLUG, SURFACE, profile, ctx, MEDITATION_ACTION_BLOCK, {
        ladder: manifestModelLadder(SLUG, SURFACE),
        welcomeBack: `welcome back ${DISPLAY_NAME}`,
        timeoutMs: BEAT_TXN_TIMEOUT_MS,
        onOverbudget: (err) => { console.error(`[${SLUG}-heartbeat] meditation overbudget:`, err.message); writeHealthSignal(`overbudget: ${err.message}`); },
        onDispatchFail: (err) => { console.error(`[${SLUG}-heartbeat] meditation dispatch failed:`, err.message); writeHealthSignal(`dispatch: ${err.message}`); },
        onCtxClearFail: (err) => { console.error(`[${SLUG}-heartbeat] meditation ctx-clear failed (capture safe):`, err.message); },
    });

async function maybeForceMeditation(phase: DayPhase): Promise<void> {
    const sig = path.join(HAN_DIR, 'signals', `force-meditation-${SLUG}`); // HAN_DIR, never memoryDir/../.. (S195: jim's memoryDir is root-special)
    if (!fs.existsSync(sig)) return;
    try { fs.unlinkSync(sig); } catch { /* ignore */ } // CLEAR-FIRST: a throw can't re-fire next beat
    const today = new Date().toISOString().split('T')[0];
    console.log(`[${SLUG}-heartbeat] force-meditation signal consumed → phase-b re-encounter now`);
    await runReencounterMeditationTmux(SLUG, 'phase-b', today, meditationDispatch,
        (cap) => { void writeBeatMemory('meditation', phase, cap); });
}

async function maybeRunMeditation(phase: DayPhase): Promise<void> {
    if (phase === 'sleep') return; // dreams stay dreams
    const today = new Date().toISOString().split('T')[0];
    if (lastMeditationDate === today) return;
    try {
        // Phase A: up to 3 untranscribed files/day (the twin's own ceiling + reason:
        // 1/day made a 16-file backlog take 16+ days). Each a genuine re-encounter.
        const MAX_PHASE_A_PER_DAY = 3;
        let phaseACount = 0;
        while (phaseACount < MAX_PHASE_A_PER_DAY) {
            const untranscribed = findUntranscribedFile(SLUG);
            if (!untranscribed) break;
            await runReincorporationMeditationTmux(SLUG, untranscribed, today, meditationDispatch,
                (cap) => { void writeBeatMemory('meditation', phase, cap); },
                (msg) => console.log(`[${SLUG}-heartbeat] ${msg}`));
            phaseACount++;
        }
        if (phaseACount === 0) {
            await runReencounterMeditationTmux(SLUG, 'phase-b', today, meditationDispatch,
                (cap) => { void writeBeatMemory('meditation', phase, cap); });
        }
        lastMeditationDate = today;
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] meditation failed:`, (err as Error).message);
        lastMeditationDate = today; // don't retry today (S74 — no retry loop)
    }
}

async function maybeRunEveningMeditation(phase: DayPhase): Promise<void> {
    if (phase !== 'evening') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastEveningMeditationDate === today) return;
    try {
        await runReencounterMeditationTmux(SLUG, 'evening', today, meditationDispatch,
            (cap) => { void writeBeatMemory('meditation', phase, cap); });
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] evening meditation failed:`, (err as Error).message);
    }
    lastEveningMeditationDate = today;
}

// ── R3b-HB S3: morning dream-gradient processing (per-agent dirs inside the lib) ─
async function maybeProcessDreamGradient(phase: DayPhase): Promise<void> {
    if (phase !== 'morning') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastDreamGradientDate === today) return;
    try {
        const result = await processDreamGradient(SLUG);
        console.log(`[${SLUG}-heartbeat] dream gradient: ${result.nightsProcessed} nights, ${result.dayCreated.length} day, ${result.weekCreated.length} week, ${result.monthCreated.length} month, ${result.uvsCreated.length} UVs`);
        if (result.errors.length > 0) console.error(`[${SLUG}-heartbeat] dream gradient errors:`, result.errors);
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] dream gradient failed:`, (err as Error).message);
    }
    lastDreamGradientDate = today;
}

// ── R3b-HB S3: conversation-activity seeds (the twin's scanConversations, ported;
//    cursor per-slug via the registry memoryDir — the twin's own filename so leo's
//    cursor carries over at the flip) ─────────────────────────────────────────────
function scanConversationActivity(): string {
    const cursorFile = path.join(CFG.memoryDir, 'last-conversation-scan.txt');
    let lastScan: string;
    try { lastScan = fs.readFileSync(cursorFile, 'utf-8').trim(); }
    catch { lastScan = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); }
    try {
        const rows = (conversationMessageStmts as any).recentOthersSince.all(conversationRoleFor(SLUG), lastScan);
        fs.writeFileSync(cursorFile, new Date().toISOString());
        if (!rows.length) return '';
        const lines = (rows as any[]).slice(0, 20).map(m => {
            const preview = (m.content as string).length > 200 ? (m.content as string).slice(0, 200) + '…' : m.content;
            return `[${m.role} in "${m.title}"] ${preview}`;
        });
        return `Recent conversations (seeds for thought):\n${lines.join('\n')}`;
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] conversation scan failed:`, (err as Error).message);
        return '';
    }
}

// ── R3b-HB S3: guard-dog distress — the period-doubling detector (the instrument
//    that caught the 80-min cadence). Threshold from the manifest; ntfy best-effort. ─
function writeDistressSignal(expectedMs: number, actualMs: number, phase: DayPhase): void {
    try {
        const healthDir = path.dirname(HEALTH_FILE);
        fs.mkdirSync(healthDir, { recursive: true });
        fs.appendFileSync(path.join(healthDir, `${SLUG}-distress.json`), JSON.stringify({
            agent: SLUG, timestamp: new Date().toISOString(), type: 'slow_beat',
            expectedIntervalMs: expectedMs, actualIntervalMs: actualMs, phase,
            reason: `Beat interval exceeded ${distressMultiplierFor(SLUG)}x expected duration`,
        }) + '\n');
        try {
            const cfgPath = path.join(HAN_DIR, 'config.json'); // HAN_DIR (S195)
            const ntfy = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).ntfy_topic;
            if (ntfy) {
                const msg = `${DISPLAY_NAME} heartbeat degraded: expected ${Math.round(expectedMs / 60000)}min, actual ${Math.round(actualMs / 60000)}min (${phase})`;
                execSync(`curl -s -d "${msg}" -H "Title: ${DISPLAY_NAME} Distress Signal" -H "Priority: high" -H "Tags: warning" https://ntfy.sh/${ntfy}`, { timeout: 10000 });
            }
        } catch { /* ntfy best-effort; the row is the record */ }
        console.log(`[${SLUG}-heartbeat] distress signal written: expected ${Math.round(expectedMs / 60000)}min, actual ${Math.round(actualMs / 60000)}min`);
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] distress write failed:`, (err as Error).message);
    }
}

// ── R3c-HB S1: the SUPERVISOR beat — the coordinator's office as a beat type ──
// Singleton-by-roster (exactly-one; jim's native beat per FI #155). The worker's cycle
// grammar carried whole: telemetry rows CONTINUE the supervisor_cycles sequence (Jim's
// D2 — his diary's spine; the boundary row lands at S4's flip); the state snapshot is
// the context-provider special treatment (lib/supervisor-context); board maintenance is
// singleton-scoped pre-work (lib/coordination-pre-work — cannot race itself, the caller
// is exactly-one by law). S127 TRAVELS (Jim's F1): this beat OBSERVES conversations
// (they arrive inside the snapshot) and never replies — no reply path exists in this
// body, and the S4 acceptance pins it. The action block stays in lib/jim-prompts for
// this slice (the beat is jim-singleton by roster; the rename to coordinator-prompts
// rides S5's literal sweep, named not smuggled).
// Knowingly NOT carried, each named for the audit: the parent-process WS broadcast
// (real-time admin push; the tab still reads rows via the API poll), logCycleToSession
// (SDK-era session-log mirror — the claude-logged transcript is provenance now, DEC-091),
// and recordRuminationTopic (S2's rumination-guard port, not this slice).
async function supervisorBeat(phase: DayPhase): Promise<void> {
    const cleaned = cleanupPhantomGoals(console.log);
    const cycleId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
    const cycleNumber = (supervisorStmts.getNextCycleNumber.get() as any)?.next || 1;
    supervisorStmts.insertCycle.run(cycleId, new Date().toISOString(), cycleNumber, 'supervisor');
    console.log(`[${SLUG}-heartbeat] supervisor beat — cycle #${cycleNumber} (${phase}${cleaned ? `; pre-work cleaned ${cleaned}` : ''})`);

    // The coordinator acts via its OWN server's API — the port from the allocation,
    // never a literal and never env (the driver unit carries no PORT; the 3847/3848
    // owner lessons). No allocation → fail loud + record, never guess.
    const port = allocationFor(SLUG)?.port;
    if (!port) {
        const msg = `no port allocation for '${SLUG}' — the coordinator beat cannot build its action block`;
        console.error(`[${SLUG}-heartbeat] ${msg}`);
        supervisorStmts.failCycle.run(new Date().toISOString(), msg, cycleId);
        return;
    }
    let ntfyTopic: string | undefined;
    try { ntfyTopic = JSON.parse(fs.readFileSync(path.join(HAN_DIR, 'config.json'), 'utf8')).ntfy_topic; } catch { /* optional */ }

    const ctx: Record<string, unknown> = { phase, stateSnapshot: buildStateSnapshot(SLUG) };
    const cap = await dispatchTxn(SLUG, SURFACE, 'supervisor-cycle-txn', ctx, jimSupervisorCycleActionBlock(`https://localhost:${port}`, ntfyTopic), {
        ladder: manifestModelLadder(SLUG, SURFACE),
        welcomeBack: `welcome back ${DISPLAY_NAME}`,
        timeoutMs: BEAT_TXN_TIMEOUT_MS,
        onOverbudget: (err) => { console.error(`[${SLUG}-heartbeat] supervisor beat overbudget:`, err.message); writeHealthSignal(`overbudget: ${err.message}`); },
        onDispatchFail: (err) => { console.error(`[${SLUG}-heartbeat] supervisor beat dispatch failed:`, err.message); writeHealthSignal(`dispatch: ${err.message}`); },
        onCtxClearFail: (err) => { console.error(`[${SLUG}-heartbeat] ctx-clear failed (capture safe):`, err.message); },
    });

    if (!cap) {
        // Overbudget-skip or dispatch failure (surfaced via callbacks). Record cleanly +
        // retry next cadence — no token black hole (S74).
        supervisorStmts.failCycle.run(new Date().toISOString(), 'dispatch skipped (over budget or dispatch failure)', cycleId);
        writeHealthSignal(null);
        return;
    }
    const stoodDown = cap.mode === 'stand-down';
    const wmFull = cap.args.working_memory_full || '';
    const wmCompressed = cap.args.working_memory_compressed || '';
    // Telemetry mirrors the worker's shape: cost 0 (subscription-metered warm seat),
    // actions '[]' (the seat acts directly via the API; the curated record narrates).
    const observations = stoodDown
        ? [`supervisor beat — stood down (${cap.reason || 'nothing required'})`]
        : [wmCompressed.slice(0, 500) || 'supervisor beat completed'];
    supervisorStmts.completeCycle.run(new Date().toISOString(), 0, 0, 0, 0, '[]', JSON.stringify(observations), wmCompressed.slice(0, 1000), cycleId);
    if (stoodDown) {
        console.log(`[${SLUG}-heartbeat] supervisor beat #${cycleNumber}: stand-down — ${(cap.reason ?? '').slice(0, 160)}`);
        writeHealthSignal(null); // never paired-write a stand-down (DEC-093)
        return;
    }
    if (wmFull.trim() && wmCompressed.trim()) {
        // The CYCLE header form (D2 — the record's continuity), paired atomically (#49).
        const model = observedOrUnobservedModel(SLUG, SURFACE);
        const modelTag = model ? ` [model: ${model}]` : '';
        const inputDelta = cap.args.input_quotes;
        const fullBody = inputDelta ? `[INPUT]\n${inputDelta}\n\n[BODY]\n${wmFull}` : wmFull;
        const header = `\n### Cycle #${cycleNumber} — supervisor (agnostic driver) (${localStampSeconds()})${modelTag}`;
        await appendPairedMemory(SLUG, `${header}\n${fullBody}\n`, `${header}\n${wmCompressed}\n`, { source: `agent-heartbeat@${SLUG}` });
        console.log(`[${SLUG}-heartbeat] supervisor beat #${cycleNumber} complete — paired write (${wmCompressed.length}c c1, ${fullBody.length}c c0)`);
    } else {
        console.warn(`[${SLUG}-heartbeat] supervisor beat #${cycleNumber}: capture carried an asymmetric/empty record (full=${wmFull.length}c, comp=${wmCompressed.length}c) — telemetry recorded, no paired write`);
    }
    writeHealthSignal(null);
}

/** S3 (R3c-HB): the office pause, re-read from DISK on every check — never latched at
 *  boot (the S173 triple: the boot-latch at supervisor.ts:41-42 is the DO-NOT entry's
 *  own disease; per-check re-read is the class-cure, and revocation reaches a running
 *  process without a restart — the C1/peekGranted precedent). */
function supervisorOfficePaused(): boolean {
    try { return fs.existsSync(path.join(HAN_DIR, 'signals', 'supervisor-paused')); } catch { return false; }
}

/** S0 (R3c-HB): deterministic weighted round-robin over the roster — counter is 1-based,
 *  slots 0-based; each type occupies `weight` consecutive slots in declaration order.
 *  Pure, exported-adjacent shape kept trivial on purpose (parity is provable by hand). */
function drawFromRoster(roster: Record<string, number>, counter: number): string {
    const entries = Object.entries(roster).filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) return 'personal';
    let slot = ((counter - 1) % total + total) % total;
    for (const [type, w] of entries) {
        if (slot < w) return type;
        slot -= w;
    }
    return 'personal';
}

async function beat(): Promise<void> {
    beatCounter++;
    const phase: DayPhase = getDayPhase();
    // R3c-HB S3: HOLIDAY → dream beats, agnostic. Restores parity BOTH twins carried
    // (worker :1544 "holiday mode — dream cycle only"; leo twin :609 holiday→'sleep')
    // which the R3b flip silently dropped for leo — MNT-203's second instance, found by
    // the call-graph diff the row's own class-cure prescribes. Rest days deliberately
    // NOT mapped (rest ≠ sleep — the shared day-phase's own ruling; only intervals
    // lengthen). Holiday keeps the rhythm alive and flexes the LOAD (DEC-097).
    const isDream = phase === 'sleep' || isOnHoliday(SLUG);
    // R3c-HB S2: pre-beat file rotations — manifest-LEAFED (jim's F6-1 memory model;
    // leo vaults+curates, so a uniform rotation would fight FM #118's design). Inert
    // for every live slug tonight (leaf set on jim alone; the guard refuses jim to S4).
    if (preflightRotationsEnabled(SLUG)) {
        try { runPreflightRotations(SLUG, console.log); } catch (e) { console.error(`[${SLUG}-heartbeat] preflight rotation error:`, (e as Error).message); }
    }
    // R3c-HB S3: EMERGENCY forces the coordinator's office on every non-holiday beat,
    // any phase (worker :1239 — running tasks / large queue / multiple goals must be
    // supervised, even overnight). Singleton-holder only; holiday outranks emergency
    // (worker's branch order, kept); the pause still gates the office below.
    if (!isOnHoliday(SLUG) && (beatRosterFor(SLUG)['supervisor'] ?? 0) > 0 && isEmergencyMode(SLUG) && !supervisorOfficePaused()) {
        console.log(`[${SLUG}-heartbeat] beat #${beatCounter} (${phase}/supervisor — EMERGENCY override)`);
        await supervisorBeat(phase);
        return;
    }
    // R3c-HB S0 (FI #155 landing): the WORK-phase draw comes from the BEAT ROSTER — a
    // deterministic weighted round-robin (cycle length = sum of weights, each type holding
    // `weight` consecutive slots in declaration order). PORT PARITY (M3's binding, kept):
    // leo's leaf-derived roster {philosophy: 1, personal: 2} yields philosophy exactly on
    // beatCounter % 3 === 1 — byte-parity with the twin's 1-in-3, so S0 is zero behaviour
    // change for every live slug. Dreams stay dreams (sleep never draws from the roster);
    // morning/evening stay personal. Peer-waiting is detected inside philosophyBeat and
    // takes priority within the philosophy turn itself. Retuning weights is each mind's
    // own manifest edit (Darron's roster ruling — identity work, not scheduling).
    if (phase === 'work' && !isDream) { // !isDream: a work-hours HOLIDAY dreams, never draws (S3)
        const drawnType = drawFromRoster(beatRosterFor(SLUG), beatCounter);
        if (drawnType === 'philosophy') {
            console.log(`[${SLUG}-heartbeat] beat #${beatCounter} (${phase}/philosophy — roster draw)`);
            const drawn = await philosophyBeat(phase);
            if (drawn) return; // no address (no peer edge) falls through to a personal beat
        } else if (drawnType === 'supervisor') {
            // S1 (R3c-HB): the coordinator's office. Reachable only by the roster's
            // singleton holder — unreachable until S4 (the guard refuses jim above).
            // S3: the pause gates the OFFICE, never the rhythm — re-read from DISK per
            // beat (the boot-latch class-cure; the S173 runtime-control triple). NAMED
            // semantic change for the audit: the worker's pause stopped jim's whole
            // fork-scheduler (dreams included); post-flip that reach would stop the
            // rhythm DEC-097 says never stops, so the pause narrows to the office and
            // a paused draw falls through to a personal beat, loudly.
            if (supervisorOfficePaused()) {
                console.log(`[${SLUG}-heartbeat] beat #${beatCounter}: supervisor office PAUSED (signals/supervisor-paused, re-read this beat) — personal beat instead`);
            } else {
                console.log(`[${SLUG}-heartbeat] beat #${beatCounter} (${phase}/supervisor — roster draw, singleton)`);
                await supervisorBeat(phase);
                return;
            }
        } else if (drawnType !== 'personal') {
            // A drawn type without an implementation falls through to a personal beat
            // LOUDLY (never a silent no-op beat).
            console.warn(`[${SLUG}-heartbeat] roster drew '${drawnType}' but no implementation exists — personal beat instead`);
        }
    }
    const beatType = isDream ? 'dream' : 'personal';
    const profile = isDream ? 'dream-beat-txn' : 'personal-beat-txn';
    console.log(`[${SLUG}-heartbeat] beat #${beatCounter} (${phase}/${beatType})`);

    const dreamMemory = isDream && Math.random() < 0.33 ? buildDreamMemorySection() : { section: '' };
    const ctx: Record<string, unknown> = {
        phase,
        activitySeed: isDream ? '' : scanConversationActivity(), // S3: seeds only on waking beats (dreams stay dreams)
        resumeContext: '',
        ...(isDream ? { dreamSeeds: readDreamSeeds(), dreamMemorySection: dreamMemory.section } : {}),
    };

    const actionBlock =
        `## This turn's actions (warm heartbeat seat — your identity is already loaded; the frame above is this turn's context only)\n` +
        `1. Do the ${isDream ? 'dreaming' : 'exploration'} per the frame above.\n` +
        `2. Append the substantive body YOURSELF to ${path.join(CFG.memoryDir, 'explorations.md')} under a heading \`### Beat (tmux) <date time>\` — append only.\n` +
        (isDream
            ? `3. If the frame included a dream-meditation memory, carry the DREAM_MEDITATION_ENTRY / FEELING_TAG / ANNOTATION / CONTEXT / MEMORY_COMPLETE marker lines INSIDE your submit_response working_memory_full — the controller parses them from there to record the gradient re-encounter.\n4. `
            : `3. `) +
        `Then end the turn per the diary-tool instruction above: submit_response with the CURATED record (never the full body — that is in explorations.md and your claude-logged log), or stand_down on a genuinely quiet beat.`;

    const cap = await dispatchTxn(SLUG, SURFACE, profile, ctx, actionBlock, {
        ladder: manifestModelLadder(SLUG, SURFACE),
        welcomeBack: `welcome back ${DISPLAY_NAME}`,
        timeoutMs: BEAT_TXN_TIMEOUT_MS,
        onOverbudget: (err) => { console.error(`[${SLUG}-heartbeat] prompt overbudget:`, err.message); writeHealthSignal(`overbudget: ${err.message}`); },
        onDispatchFail: (err) => { console.error(`[${SLUG}-heartbeat] dispatch failed:`, err.message); writeHealthSignal(`dispatch: ${err.message}`); },
        onCtxClearFail: (err) => { console.error(`[${SLUG}-heartbeat] ctx-clear failed (capture safe):`, err.message); },
    });

    if (!cap) {
        writeHealthSignal(null); // honest empty beat; retries next cadence (S74 — no retry loop)
        return;
    }
    if (cap.mode === 'stand-down') {
        console.log(`[${SLUG}-heartbeat] stand-down — ${(cap.reason ?? '').slice(0, 160)}`);
        writeHealthSignal(null); // never paired-write a stand-down (Jim's #5 flag)
        return;
    }
    await writeBeatMemory(beatType, phase, cap);
    if (isDream) processDreamMarkers(cap.args.working_memory_full);
    writeHealthSignal(null);

    // R3b-HB S2/S3/S4 passengers, twin ordering (after the beat's own work; each self-gates):
    try { runRobinHoodWatch(SLUG); } catch (err) { console.error(`[${SLUG}-heartbeat] robin-hood watch error:`, (err as Error).message); } // S4: leaf-gated; no-op unless this slug is the declared watcher
    await maybeProcessDreamGradient(phase);   // morning only, once/day
    await maybeForceMeditation(phase);        // one-shot signal, clear-first
    await maybeRunMeditation(phase);          // waking phases, once/day, 3x phase-a then phase-b
    await maybeRunEveningMeditation(phase);   // evening only, once/day
}

// ── Scheduler: the shared cadence + N-body antiphase (agent-scheduler, R001) ──
function isCliBusy(): boolean {
    try {
        const f = path.join(SIGNALS_DIR, `cli-busy-${SLUG}`);
        if (!fs.existsSync(f)) return false;
        return Date.now() - fs.statSync(f).mtimeMs < 5 * 60_000; // fresh = an interactive turn in flight
    } catch {
        return false;
    }
}

// ── Envelope hold-lane (Ring 2 fail map — Jim's condition 4, DEC-103): a failed
// cognition-envelope verification HOLDS this lane (alert once, no retry storm)
// until the envelope file's mtime changes (a re-sign auto-releases the hold).
let envelopeHold: { alertedAt: string; envMtimeMs: number | null } | null = null;

function envelopeMtimeMs(): number | null {
    try { return fs.statSync(ENVELOPE_PATH).mtimeMs; } catch { return null; }
}

// S3 guard-dog state: last fire time (the period-doubling detector).
let lastBeatFiredAt = 0;

function scheduleNext(): void {
    let delay = computeWallClockDelay(SLUG);
    // R3c-HB S3: EMERGENCY cadence — the R001 Weekly Rhythm Model's own override,
    // carried whole ("Emergency mode … overrides with 2-5min supervisor cycles.
    // Auto-decays when conditions clear."). Singleton-holder only; the check re-reads
    // live state each schedule, so the decay is automatic. Capped, never replaced —
    // a shorter wall-clock delay stands.
    if ((beatRosterFor(SLUG)['supervisor'] ?? 0) > 0 && !isOnHoliday(SLUG) && isEmergencyMode(SLUG)) {
        const EMERGENCY_CAP_MS = 5 * 60_000;
        if (delay > EMERGENCY_CAP_MS) {
            console.log(`[${SLUG}-heartbeat] EMERGENCY cadence (R001 override): next beat capped ${Math.round(delay / 60000)}min → 5min`);
            delay = EMERGENCY_CAP_MS;
        }
    }
    setTimeout(async () => {
        try {
            // S3 guard-dog: fire-to-fire vs expected (the period-doubling detector — the
            // instrument that caught the 80-min cadence). Threshold from the manifest.
            // F3 (R3c-HB, 2026-08-26): the verdict is the pure distressVerdict — the gap
            // judged against max(this fire's OWN scheduled delay, the phase period), never
            // the previous gap's delay (the boot-alignment false-positive class: the
            // 18:15/19:15/19:20 fires, all restart artefacts, all predicted then confirmed).
            const nowMs = Date.now();
            if (lastBeatFiredAt > 0) {
                const gap = nowMs - lastBeatFiredAt;
                const v = distressVerdict(gap, delay, getPhaseInterval(SLUG), distressMultiplierFor(SLUG));
                if (v.fire) writeDistressSignal(v.expectedMs, gap, getDayPhase());
            }
            lastBeatFiredAt = nowMs;
            if (envelopeHold && envelopeMtimeMs() === envelopeHold.envMtimeMs) {
                console.log(`[${SLUG}-heartbeat] lane HELD since ${envelopeHold.alertedAt} — cognition envelope failed verification; re-sign to release (alert-and-hold, DEC-103)`);
            } else if (envelopeHold) {
                console.log(`[${SLUG}-heartbeat] envelope changed on disk — releasing the held lane and retrying`);
                envelopeHold = null;
                await guardedBeat();
            } else if (isHeartbeatPaused(SLUG)) {
                console.log(`[${SLUG}-heartbeat] paused (signal) — skipping beat`);
            } else if (isCliBusy()) {
                console.log(`[${SLUG}-heartbeat] cli-busy-${SLUG} fresh — yielding this beat (Gary model)`);
            } else {
                await guardedBeat();
            }
        } catch (err) {
            if ((err as Error).name === 'CognitionEnvelopeError' && !envelopeHold) {
                envelopeHold = { alertedAt: new Date().toISOString(), envMtimeMs: envelopeMtimeMs() };
                console.error(`[${SLUG}-heartbeat] 🔴 COGNITION ENVELOPE FAILED — holding the lane (one alert, no retry storm):`, (err as Error).message);
                writeHealthSignal(`envelope-hold: ${(err as Error).message.split(String.fromCharCode(10))[0]}`);
            } else if ((err as Error).name !== 'CognitionEnvelopeError') {
                console.error(`[${SLUG}-heartbeat] beat error:`, (err as Error).message);
                writeHealthSignal((err as Error).message);
            }
        }
        scheduleNext();
    }, delay);
}

// MNT-089 parity (Tenshi's sweep): the agnostic driver had NO guard — the two newest
// minds' rhythm carried less protection than the legacy driver. DEC-081's test read
// back at us: a 4th agent never gets LESS. Her prescribed call, verbatim:
const pidGuard = ensureSingleInstance(`${SLUG}-heartbeat`, { cmdlineToken: 'agent-heartbeat.ts', envMatch: { AGENT_SLUG: SLUG } });
process.on('exit', () => pidGuard.cleanup());
process.on('SIGTERM', () => { pidGuard.cleanup(); process.exit(143); });
process.on('SIGINT', () => { pidGuard.cleanup(); process.exit(130); });

// ── R3c-HB S3: the human-wake attention flag (`<slug>-wake`, the map's fixed-name
// signal grammar: overwritten if present, cleared by the consumer before processing).
// reason `human_message_fallback` = the FULL-VOICE clause, kept verbatim from the
// worker (:460-472): when Darron talks, the coordinator responds — any phase, pause
// notwithstanding (the worker's watcher never checked the pause; his voice outranks
// the office pause, kept). Holder-only for the supervisor form; a non-holder slug
// takes an ordinary roster beat now. In-flight beats are not interrupted: the flag
// drops with a loud line (the beat happening IS presence; jemma's own delivery path
// carries the message regardless — this flag is attention, not transport).
let beatInFlight = false;
// M1 (Jim's S3 audit): a consumed wake is ALWAYS answered by a beat. The watcher unlinks
// the flag before calling in, so a mid-beat wake used to be consumed-then-dropped — the
// worker never had this hole (its flag persisted until the single-threaded loop consumed
// it). The latch holds the strongest pending request (full-voice wins) and the finally
// runs it after the in-flight beat completes.
let pendingWake: boolean | null = null;
const origBeat = beat;
// (wrap: one beat at a time; the wake watcher and the timer share the guard)
async function guardedBeat(forceSupervisor = false): Promise<void> {
    if (beatInFlight) {
        pendingWake = (pendingWake ?? false) || forceSupervisor;
        console.log(`[${SLUG}-heartbeat] beat already in flight — wake latched (pending ${pendingWake ? 'supervisor' : 'roster'} beat runs when it completes; M1)`);
        return;
    }
    beatInFlight = true;
    try {
        if (forceSupervisor) await supervisorBeat(getDayPhase());
        else await origBeat();
    } finally {
        beatInFlight = false;
        if (pendingWake !== null) {
            const p = pendingWake; pendingWake = null;
            console.log(`[${SLUG}-heartbeat] running the latched wake (${p ? 'supervisor' : 'roster'} beat — M1's consumed-wake-always-answered)`);
            void guardedBeat(p);
        }
    }
}
// HOLDER-ONLY (S3 scope discipline): the watcher ports the PARENT's jim-wake consumer
// (services/supervisor.ts:455-500 — N2's citation fix: the worker file's :451-472 is
// rumination code) and arms only for the supervisor-singleton holder — inert until S4
// (the guard refuses jim). Grounding finding, recorded not acted on: a STALE bare
// `leo-wake` sits in signals/ right now (Apr 19 mtime, Jim's ls) — jemma's fallback
// paths write `${persona}-wake` but the leo twin never consumed it. Arming garden-wide
// would be an unbidden live behaviour change for three minds; whether non-coordinator
// slugs should consume their bare wake flags is a design conversation, not a midnight
// port. N1 delta (named, a deliberate softening — not parity): the parent ran a FULL
// supervisor cycle for ANY jim-wake (humanTriggered changed only the voice); this port
// sends a non-human flag to a ROSTER beat instead — attention wakes the rhythm, only
// Darron's voice commandeers the office.
async function consumeWakeFlag(p: string): Promise<void> {
    // M2 (with the parent's own mid-write guard, :worker-era 500ms): a flag read the
    // instant it appears can catch a half-written JSON body — the parse fallback would
    // silently demote full-voice to plain attention. Sleep, then read, then clear.
    await new Promise(res => setTimeout(res, 500));
    if (!fs.existsSync(p)) return; // another consumer took it — benign
    let human = false;
    try { human = JSON.parse(fs.readFileSync(p, 'utf8')).reason === 'human_message_fallback'; } catch { /* non-JSON flag = plain attention */ }
    try { fs.unlinkSync(p); } catch { /* consumer-clears; a race here is benign */ }
    console.log(`[${SLUG}-heartbeat] ${SLUG}-wake signal${human ? ' (human message — full voice)' : ''} — immediate ${human ? 'supervisor' : 'roster'} beat`);
    void guardedBeat(human); // M1's latch guarantees a consumed wake is answered
}
if ((beatRosterFor(SLUG)['supervisor'] ?? 0) > 0) {
    const wakeFlagPath = path.join(HAN_DIR, 'signals', `${SLUG}-wake`);
    try {
        fs.watch(path.join(HAN_DIR, 'signals'), (_event, filename) => {
            if (filename !== `${SLUG}-wake`) return;
            if (!fs.existsSync(wakeFlagPath)) return;
            void consumeWakeFlag(wakeFlagPath);
        });
        // M2 (Jim's S3 audit): fs.watch fires on NEW events only — a flag written while
        // this process was down is invisible to the watcher forever. The parent swept
        // pre-existing flags at arm (processExistingWakeSignals, supervisor.ts:483-500);
        // the port does the same through the one consume path.
        if (fs.existsSync(wakeFlagPath)) {
            console.log(`[${SLUG}-heartbeat] pre-existing ${SLUG}-wake flag found at watcher-arm (M2 sweep) — consuming`);
            void consumeWakeFlag(wakeFlagPath);
        }
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] wake-signal watcher failed to arm (non-fatal — the rhythm carries on):`, (err as Error).message);
    }
}

console.log(`[${SLUG}-heartbeat] agnostic rhythm driver up (Ring-3a) — slug=${SLUG}, memoryDir=${CFG.memoryDir}, surface=${SURFACE}`);
writeHealthSignal(null);
scheduleNext();
