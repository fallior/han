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
 *  - meditations phase-a/b/evening (the agnostic runners exist in agent-cycle.ts;
 *    wiring them needs the per-agent untranscribed-file finders — R3b-HB S2);
 *  - morning dream-gradient processing (needs per-agent dream dirs — R3b-HB S3);
 *  - general conversation-activity seeds (leo's scanConversations cursor is seat-local;
 *    S1 ports only the PEER-thread scan the philosophy beat needs — the multi-thread
 *    activity seed folds to R3b-HB S3 with the reason recorded in the plan).
 */

import fs from 'node:fs';
import path from 'node:path';
import { dispatchTxn, applyMeditationMarkers } from './lib/agent-cycle';
import { computeWallClockDelay } from './lib/agent-scheduler';
import { getDayPhase, isHeartbeatPaused, type DayPhase } from './lib/day-phase';
import { manifestModelLadder, loadResidents, peerConversationFor, philosophyBeatsEnabled, peekGranted, conversationRoleFor, communityPort } from './lib/garden-manifest';
import { gradientConfigForAgent } from './lib/agent-registry';
import { readDreamSeeds as readSharedDreamSeeds, SEED_FRAGMENT_MAX_CHARS } from './lib/dream-seeds';
import { appendPairedMemory } from './lib/memory-paired-writer';
import { observedOrUnobservedModel } from './lib/tmux-dispatcher';
import { gradientStmts, feelingTagStmts, conversationMessageStmts } from './db';
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
// Double-driver guard: these slugs' rhythms are owned elsewhere until R3b-HB/R3c-HB
// (the HEARTBEAT cutovers — plans/r3b-leo-heartbeat-cutover.md; NOT DEC-099's stem-pool
// R3b/R3c phases in tmux-dispatcher.ts, which this guard must never be confused with).
// The leo half retires at R3b-HB S5 (the unit flip); the jim half at R3c-HB.
if (SLUG === 'leo' || SLUG === 'jim') {
    console.error(`[agent-heartbeat] slug '${SLUG}' is driven by its own module (leo-heartbeat.ts / supervisor-worker.ts) — refusing a second driver (prove-single at the rhythm layer; retire per-half at R3b-HB S5 / R3c-HB)`);
    process.exit(1);
}
const resident = loadResidents().find(a => a.slug === SLUG);
if (!resident) {
    console.error(`[agent-heartbeat] slug '${SLUG}' not in the garden manifest — refusing to start`);
    process.exit(1);
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

/** The peeked party's identity files as peer context — GRANT-GATED (T1). Curated
 *  preferred (the owner's chosen bright-few); refuses loudly without the leaf. */
function readPeerContext(peerSlug: string): string {
    if (!peekGranted(peerSlug, SLUG)) {
        // W1 (Tenshi): the refusal's witness must PERSIST — a pane warn is the evaporating-
        // witness class. This jsonl row is also the instrument acceptance #7 runs on (Casey's
        // join: one artefact, two duties). peekGranted re-reads the leaf at exercise time and
        // fails closed (C1), so this row also catches a revoked-but-still-exercised grant.
        console.warn(`[${SLUG}-heartbeat] peek REFUSED: '${peerSlug}' grants no peekableBy to '${SLUG}' (S103 sovereignty is the rule; the manifest leaf is its only exception)`);
        try {
            fs.appendFileSync(path.join(HEALTH_DIR, 'peek-refusals.jsonl'), JSON.stringify({
                ts: new Date().toISOString(), reader: SLUG, peeked: peerSlug,
                surface: SURFACE, beat: beatCounter,
            }) + '\n');
        } catch { /* the warn above is the floor; never fail the beat on witness I/O */ }
        return '';
    }
    try {
        const peerCfg = gradientConfigForAgent(peerSlug);
        const dir = peerCfg.memoryDir;
        const parts: string[] = [];
        const identity = path.join(dir, 'identity.md');
        if (fs.existsSync(identity)) parts.push(fs.readFileSync(identity, 'utf-8').slice(0, 3000));
        const curated = path.join(dir, 'self-reflections-curated.md');
        const full = path.join(dir, 'self-reflection.md');
        if (fs.existsSync(curated)) parts.push(fs.readFileSync(curated, 'utf-8').slice(0, 4000));
        else if (fs.existsSync(full)) parts.push(fs.readFileSync(full, 'utf-8').slice(-4000));
        return parts.join('\n\n');
    } catch (err) {
        console.error(`[${SLUG}-heartbeat] peer context read failed (non-fatal):`, (err as Error).message);
        return '';
    }
}

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
        jimContext: readPeerContext(peerSlug),
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
async function beat(): Promise<void> {
    beatCounter++;
    const phase: DayPhase = getDayPhase();
    const isDream = phase === 'sleep';
    // R3b-HB S1: philosophy beats draw on waking beats when the EXPLICIT leaf is on
    // (Jim's M1 — leo-only at cutover; tenshi/casey unset until each accepts the offer).
    // Cadence mirrors the twin's rotation in spirit: alternate philosophy/personal by
    // beat parity on waking phases; dreams stay dreams. Peer-waiting is detected inside
    // philosophyBeat and takes priority within the philosophy turn itself.
    // M3 (Jim; Tenshi's twin-line re-confirmation + grant-scope point; Casey's licence
    // footing): cadence is PORT PARITY with the twin's nextBeatType (:1350) — WORK phase
    // only, 1-in-3 — because a cutover changes the driver, never the rhythm, and the peek
    // grant was given at the twin's exercise rate. Retuning is Darron's beat-roster design
    // (the weighted-roster ruling folded into the plan), priced with the grant's owner in
    // the room.
    if (phase === 'work' && philosophyBeatsEnabled(SLUG) && beatCounter % 3 === 1) {
        console.log(`[${SLUG}-heartbeat] beat #${beatCounter} (${phase}/philosophy — leaf-enabled)`);
        const drawn = await philosophyBeat(phase);
        if (drawn) return; // no address (no peer edge) falls through to a personal beat
    }
    const beatType = isDream ? 'dream' : 'personal';
    const profile = isDream ? 'dream-beat-txn' : 'personal-beat-txn';
    console.log(`[${SLUG}-heartbeat] beat #${beatCounter} (${phase}/${beatType})`);

    const dreamMemory = isDream && Math.random() < 0.33 ? buildDreamMemorySection() : { section: '' };
    const ctx: Record<string, unknown> = {
        phase,
        activitySeed: '',
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

function scheduleNext(): void {
    const delay = computeWallClockDelay(SLUG);
    setTimeout(async () => {
        try {
            if (envelopeHold && envelopeMtimeMs() === envelopeHold.envMtimeMs) {
                console.log(`[${SLUG}-heartbeat] lane HELD since ${envelopeHold.alertedAt} — cognition envelope failed verification; re-sign to release (alert-and-hold, DEC-103)`);
            } else if (envelopeHold) {
                console.log(`[${SLUG}-heartbeat] envelope changed on disk — releasing the held lane and retrying`);
                envelopeHold = null;
                await beat();
            } else if (isHeartbeatPaused(SLUG)) {
                console.log(`[${SLUG}-heartbeat] paused (signal) — skipping beat`);
            } else if (isCliBusy()) {
                console.log(`[${SLUG}-heartbeat] cli-busy-${SLUG} fresh — yielding this beat (Gary model)`);
            } else {
                await beat();
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

console.log(`[${SLUG}-heartbeat] agnostic rhythm driver up (Ring-3a) — slug=${SLUG}, memoryDir=${CFG.memoryDir}, surface=${SURFACE}`);
writeHealthSignal(null);
scheduleNext();
