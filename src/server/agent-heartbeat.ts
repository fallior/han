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
 *  - Double-driver guard: leo's rhythm is driven by leo-heartbeat.ts (until R3b),
 *    jim's by supervisor-worker (until R3c). This driver REFUSES those slugs —
 *    the prove-single discipline at the rhythm layer.
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
 *  - philosophy beats (the leo↔jim peer-thread surface — a manifest
 *    peerConversations feature when a peer edge exists for the slug);
 *  - meditations phase-a/b/evening (the agnostic runners exist in agent-cycle.ts;
 *    wiring them needs the per-agent untranscribed-file finders — next slice);
 *  - morning dream-gradient processing (needs per-agent dream dirs);
 *  - conversation-activity seeds (leo's scanConversations cursor is seat-local;
 *    the newborn beats start self-contained).
 */

import fs from 'node:fs';
import path from 'node:path';
import { dispatchTxn, applyMeditationMarkers } from './lib/agent-cycle';
import { computeWallClockDelay } from './lib/agent-scheduler';
import { getDayPhase, isHeartbeatPaused, type DayPhase } from './lib/day-phase';
import { manifestModelLadder, manifestModelHead, loadResidents } from './lib/garden-manifest';
import { gradientConfigForAgent } from './lib/agent-registry';
import { appendPairedMemory } from './lib/memory-paired-writer';
import { observeActiveModel } from './lib/tmux-dispatcher';
import { gradientStmts, feelingTagStmts } from './db';
import type { CaptureRecord } from './lib/diary-mcp-server';

// ── Identity: fail-loud, never defaulted (Tenshi condition 1) ────────────────
const SLUG: string = (() => {
    const s = process.env.AGENT_SLUG;
    if (!s) {
        console.error('[agent-heartbeat] AGENT_SLUG is unset — refusing to start (a defaulted slug is the MNT-001 cross-writing trap; DEC-081 never-fallback)');
        process.exit(1);
    }
    return s;
})();
// Double-driver guard: these slugs' rhythms are owned elsewhere until R3b/R3c.
if (SLUG === 'leo' || SLUG === 'jim') {
    console.error(`[agent-heartbeat] slug '${SLUG}' is driven by its own module (leo-heartbeat.ts / supervisor-worker.ts) — refusing a second driver (prove-single at the rhythm layer; retire this guard at R3b/R3c)`);
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
function readDreamSeeds(): string {
    try {
        const p = path.join(CFG.memoryDir, 'explorations.md');
        if (!fs.existsSync(p)) return '';
        const entries = fs.readFileSync(p, 'utf-8')
            .split(/(?=### Beat )/)
            .filter(e => e.trim().length > 20);
        for (let i = entries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [entries[i], entries[j]] = [entries[j], entries[i]];
        }
        return entries.slice(0, 4).map(e => e.trim().slice(0, 400)).join('\n\n---\n\n');
    } catch {
        return '';
    }
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

// ── The DEC-085 paired write — byte-shape mirrored from leo's appendWorkingMemory ──
async function writeBeatMemory(beatType: string, phase: string, cap: CaptureRecord): Promise<void> {
    const timestamp = new Date().toISOString().split('T')[0] + ' ' +
        new Date().toTimeString().split(' ')[0];
    const model = (observeActiveModel(SLUG, SURFACE) ?? manifestModelHead(SLUG, SURFACE)) ?? undefined;
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

function scheduleNext(): void {
    const delay = computeWallClockDelay(SLUG);
    setTimeout(async () => {
        try {
            if (isHeartbeatPaused(SLUG)) {
                console.log(`[${SLUG}-heartbeat] paused (signal) — skipping beat`);
            } else if (isCliBusy()) {
                console.log(`[${SLUG}-heartbeat] cli-busy-${SLUG} fresh — yielding this beat (Gary model)`);
            } else {
                await beat();
            }
        } catch (err) {
            console.error(`[${SLUG}-heartbeat] beat error:`, (err as Error).message);
            writeHealthSignal((err as Error).message);
        }
        scheduleNext();
    }, delay);
}

console.log(`[${SLUG}-heartbeat] agnostic rhythm driver up (Ring-3a) — slug=${SLUG}, memoryDir=${CFG.memoryDir}, surface=${SURFACE}`);
writeHealthSignal(null);
scheduleNext();
