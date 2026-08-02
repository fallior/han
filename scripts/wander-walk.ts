/**
 * FI #127 — The Wandering: the arc-walker. Spawned DETACHED by the wandering agent itself
 * (the feed-wake-local pattern); walks an agent-authored arc over an EXISTING thread; dies
 * with the arc. Usage:
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/wander-walk.ts <arc.json>
 *
 * J3 IS STRUCTURAL HERE, three ways (Jim's fold; suite source-pins all three):
 *   1. input = an existing thread + an agent-authored arc file (argv) — no discovery, no config;
 *   2. this file contains NO thread-create call — the walker cannot open a thread, so a
 *      nightly-wander roster key cannot exist and "voluntary" cannot decay by config drift
 *      (the suite repo-greps for the forbidden key, which this comment names only obliquely
 *      — quoting the literal would trip the pin, the MNT-026 quotation lesson);
 *   3. it REFUSES to arm unless the thread already carries the agent's own landed first beat —
 *      the choosing act IS the verification act (Casey's verify-beat-one, Jim's composition).
 *
 * DEC-103 / J5: the per-beat timeout bounds the WAIT (dispatchToSpoke's chrome-aware deadline
 * — no clock ever kills a live compose, R011); a stuck beat is held-alert + LOUD EXIT, never a
 * re-fire (the MNT-049 double-drive family stays dead); progress keys on the LANDED trail
 * derived from the thread itself, never a counter. A dead walker = an offer that lapsed — the
 * agent may relight or rest; nothing re-arms it.
 *
 * J2: after the LANDING beat's response has LANDED (delivered-in-full), the walker resolves
 * the thread → DEC-101 reap → the bound spoke comes home.
 */
import * as fs from 'fs';
import { validateArc, nextBeat, landedBeatsFromThread, directiveContent, writeWanderReceipt, readWanderEventsFor, recoverySpent, type WanderArc, type WanderBeat, type WanderEvent } from '../src/server/lib/wander';
import { buildPrompt } from '../src/server/lib/prompt-builder';
import { dispatchToSpoke, paneClassForSession, sendContinueNudge, postNtfyAlert } from '../src/server/lib/tmux-dispatcher';
import { reconcileDecision, continueNudgeText, clearResumableMarker } from '../src/server/lib/dispatch-reconciler';
import { findSpokeForThread } from '../src/server/lib/stem-pool';
import { manifestModelLadder, conversationRoleFor, humanResponderTxnTimeoutMs, communityPort } from '../src/server/lib/garden-manifest';
import { gradientConfigForAgent } from '../src/server/lib/agent-registry';
import { appendPairedMemory } from '../src/server/lib/memory-paired-writer';
import { localStampSeconds } from '../src/server/lib/garden-time'; // DEC-105 P2: record headers speak local

function displayName(slug: string): string { return gradientConfigForAgent(slug).displayName; }

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0'; // self-signed local API

const HUMAN_SURFACE = 'human-response';

function api(path: string): string { return `https://localhost:${communityPort()}/api${path}`; }

async function fetchThread(conversationId: string): Promise<{ title: string; messages: Array<{ id: string; role: string; content: string; created_at: string }> } | null> {
    const res = await fetch(api(`/conversations/${conversationId}`));
    if (!res.ok) return null;
    const d = await res.json() as Record<string, unknown>;
    const conv = (d.conversation ?? d) as Record<string, unknown>;
    const messages = (d.messages ?? conv.messages ?? []) as Array<{ id: string; role: string; content: string; created_at: string }>;
    return { title: String(conv.title ?? ''), messages };
}

async function postAsAgent(conversationId: string, roleLabel: string, content: string): Promise<{ id: string; created_at: string } | null> {
    const res = await fetch(api(`/conversations/${conversationId}/messages`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleLabel, content }),
    });
    if (!res.ok) return null;
    const d = await res.json() as Record<string, unknown>;
    const m = (d.message ?? d) as Record<string, unknown>;
    return m.id ? { id: String(m.id), created_at: String(m.created_at ?? '') } : null;
}

/** DEC-103 alert-and-hold, now LOUD (MNT-069's cure): the held receipt gains a reader —
 *  ntfy fires so a stalled lamp shows up on a phone, not only on deliberate inspection. */
function hold(arc: WanderArc, beat: number | undefined, detail: string,
    kind: 'held-alert' | 'recovery-failed-held' = 'held-alert'): never {
    writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind, beat, detail });
    postNtfyAlert(
        `${arc.slug}'s wander held (${kind}${beat !== undefined ? `, beat ${beat}` : ''}): ${detail.slice(0, 160)} — thread ${arc.conversationId}`,
        'Wander held (alert-and-hold, never re-fire)');
    console.error(`[wander-walk] HELD (alert, never re-fire): ${detail}`);
    process.exit(1);
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

/** The landed-leg lookup (shared by the compose path and the reconciler's rung-0 DB check —
 *  JA3's law lives here: a landed post IS success, capture or no capture). */
function findLandedLeg(
    messages: Array<{ id: string; role: string; content: string; created_at: string }> | undefined,
    roleLabel: string, cutoffIso: string, cutoffId: string,
): { id: string } | null {
    const landedMsg = messages?.filter(m =>
        m.role === roleLabel && m.id !== cutoffId && m.created_at >= cutoffIso
        && !m.content.startsWith('🌌 Wander beat ')).pop();
    return landedMsg ? { id: landedMsg.id } : null;
}

/** One compose leg: dispatch the seat's warm spoke, then verify a landed post AFTER the given
 *  cutoff (derived from the artefact — the directive's created_at — never typed from memory).
 *  Failures are DISTINGUISHED (MNT-070): a genuine stand-down must never reach the reconciler
 *  (content-refusal never recovers, J5), while a dispatch failure/timeout is exactly what it
 *  diagnoses. */
async function composeAndVerify(
    arc: WanderArc, composeSlug: string, title: string, cutoffIso: string, cutoffId: string,
    ctx: Record<string, unknown>, beatN: number,
): Promise<{ id: string } | { failure: 'dispatch' | 'stand-down' | 'no-landed-post' }> {
    const roleLabel = conversationRoleFor(composeSlug);
    const built = buildPrompt(composeSlug, 'wander-beat-txn', { ...ctx, roleLabel, title, conversationId: arc.conversationId, slug: composeSlug });
    const prompt = `${built.systemPrompt}\n\n${built.userPrompt}`;
    const cap = await dispatchToSpoke(composeSlug, HUMAN_SURFACE, prompt, {
        ladder: manifestModelLadder(composeSlug, HUMAN_SURFACE),
        welcomeBack: `welcome back ${displayName(composeSlug)}`,
        timeoutMs: humanResponderTxnTimeoutMs(composeSlug),
        conversationId: arc.conversationId,
        onDispatchFail: (err) => console.error(`[wander-walk] dispatch failed (${composeSlug}): ${err.message}`),
    });
    if (cap === null) return { failure: 'dispatch' };
    if (cap.mode === 'stand-down') return { failure: 'stand-down' };
    // The landed leg: the seat's role-labelled post strictly after the directive (id-distinct).
    const thread = await fetchThread(arc.conversationId);
    const landedMsg = findLandedLeg(thread?.messages, roleLabel, cutoffIso, cutoffId);
    if (!landedMsg) return { failure: 'no-landed-post' };
    // The keepsake path — the leg enters the composer's own memory (same section shape as the
    // human seat's; the walker writes it because there is no controller here).
    try {
        const args = cap.args as { working_memory_full?: string; working_memory_compressed?: string; input_quotes?: string };
        if (args?.working_memory_full && args?.working_memory_compressed) {
            const header = `### Wander beat ${beatN} — "${title}" (${localStampSeconds()})`; // DEC-105 P2: the keepsake header speaks local (receipts stay UTC)
            await appendPairedMemory(composeSlug,
                `${header}\n[INPUT]\n${args.input_quotes ?? ''}\n\n[BODY]\n${args.working_memory_full}`,
                `${header}\n${args.working_memory_compressed}`,
                { source: 'wander-beat' });
        }
    } catch (err) {
        console.warn(`[wander-walk] paired-memory write failed (${composeSlug}): ${(err as Error).message} — the leg is safe in the thread`);
    }
    return { id: landedMsg.id };
}

/** Is the /tmp wander-leg file fresh for THIS beat (mtime at/after the directive)? The seat
 *  itself remains the verifier of whose leg it is (the recovery frame demands it) — the mtime
 *  window only gates whether re-delivery is worth offering. */
function legFileFresh(roleLabel: string, cutoffIso: string): string | null {
    const p = `/tmp/wander-leg-${roleLabel}.txt`;
    try {
        const cutoff = Date.parse(cutoffIso);
        return fs.statSync(p).mtimeMs >= cutoff ? p : null;
    } catch { return null; }
}

const EXTEND_POLL_MS = 60_000;      // still-thinking → re-diagnose every minute (progress present, wait)
const NUDGE_POLL_MS = 15_000;       // post-nudge: poll the thread for the landed leg

/**
 * MNT-070 — the RECONCILER (rungs, Darron's shape + Jim's GREEN folds): called INSTEAD of an
 * immediate hold when a beat's compose failed at the dispatch layer. Diagnose-then-branch:
 *   rung 0 — the DB first (JA3): the post landed and only the capture died → recovered-landed.
 *   rung 1 — continue-nudge the SAME resumable vessel (the amended primary; JA1 belt in-text).
 *   rung 2 — session gone, /tmp leg survives → fresh stem verifies + posts its OWN leg.
 *   rung 3 — session gone, nothing composed → ONE re-dispatch of the beat on a fresh stem.
 *   rung 4 — everything else → hold, LOUD. ONE recovery per beat ever ('recovery-attempt'
 *   written BEFORE acting — the receipt-trail counter). Returns the landed leg or never
 *   (every failure path holds and exits).
 */
async function reconcileBeat(
    arc: WanderArc, title: string, beat: WanderBeat,
    directive: { id: string; created_at: string }, ctx: Record<string, unknown>,
): Promise<{ id: string }> {
    const roleLabel = conversationRoleFor(arc.slug);
    const rec = (kind: WanderEvent['kind'], detail: string): void =>
        writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind, beat: beat.n, detail });

    for (;;) {
        // rung 0 — the DB first (cheapest, and the happy-surprise case; also JA3's law).
        const thread = await fetchThread(arc.conversationId);
        const landed = findLandedLeg(thread?.messages, roleLabel, directive.created_at, directive.id);
        if (landed) {
            rec('recovered-landed', 'post landed; only the capture died — no re-anything');
            console.log(`[wander-walk] RECONCILED beat ${beat.n}: the leg had already landed (${landed.id})`);
            return landed;
        }
        // The diagnosis inputs, read from their authoritative sources.
        const spoke = findSpokeForThread(arc.slug, HUMAN_SURFACE, arc.conversationId);
        const pane = spoke ? paneClassForSession(spoke.tmux_session) : 'session-gone';
        const legPath = legFileFresh(roleLabel, directive.created_at);
        const spent = recoverySpent(readWanderEventsFor(arc.conversationId), beat.n);
        const verdict = reconcileDecision({
            standDown: false, // a stand-down never reaches the reconciler (the caller holds first)
            recoverySpent: spent, dbPostLanded: false, pane, legFileFresh: legPath !== null,
        });
        console.log(`[wander-walk] reconcile beat ${beat.n}: pane=${pane} leg=${legPath ? 'fresh' : 'none'} spent=${spent} → ${verdict}`);

        if (verdict === 'extend') { // JA4: progress present — extend the wait, then re-diagnose from the top
            await sleep(EXTEND_POLL_MS);
            continue;
        }
        if (verdict === 'hold') {
            hold(arc, beat.n, `reconcile → hold (pane=${pane}, recovery ${spent ? 'already spent' : 'not applicable'})`);
        }
        if (verdict === 'resume-same-spoke') {
            rec('recovery-attempt', 'rung1-resume-same-spoke');
            await sendContinueNudge(spoke!.tmux_session, continueNudgeText(arc.conversationId, beat.n));
            // JA3 — the post-nudge wait polls the THREAD (a landed post IS success; the capture,
            // if it arrives, is a receipt-noted nicety the keepsake path can't safely rebuild).
            const deadline = Date.now() + humanResponderTxnTimeoutMs(arc.slug);
            while (Date.now() < deadline) {
                const now = await fetchThread(arc.conversationId);
                const leg = findLandedLeg(now?.messages, roleLabel, directive.created_at, directive.id);
                if (leg) {
                    clearResumableMarker(spoke!.tmux_session); // claimed — the TTL stands down
                    rec('resumed-same-spoke', `leg posted by the vessel's own hand (${leg.id})`);
                    console.log(`[wander-walk] RECONCILED beat ${beat.n}: resumed same spoke, leg ${leg.id}`);
                    return leg;
                }
                await sleep(NUDGE_POLL_MS);
            }
            hold(arc, beat.n, 'rung 1 (continue-nudge) did not land a leg within the window', 'recovery-failed-held');
        }
        if (verdict === 'redeliver-leg') {
            rec('recovery-attempt', 'rung2-redeliver-leg');
            const r = await composeAndVerify(arc, arc.slug, title, directive.created_at, directive.id,
                { ...ctx, recoveredLegPath: legPath }, beat.n);
            const leg = 'id' in r ? r
                : findLandedLeg((await fetchThread(arc.conversationId))?.messages, roleLabel, directive.created_at, directive.id); // JA3 belt
            if (leg) {
                rec('recovered-posted', `recovered leg verified + posted by the seat (${leg.id})`);
                console.log(`[wander-walk] RECONCILED beat ${beat.n}: recovered leg posted (${leg.id})`);
                return leg;
            }
            hold(arc, beat.n, 'rung 2 (leg re-delivery) did not land a leg', 'recovery-failed-held');
        }
        // verdict === 'redispatch-beat' — rung 3: genuine re-prompt of lost work, once.
        rec('recovery-attempt', 'rung3-redispatch-beat');
        const r = await composeAndVerify(arc, arc.slug, title, directive.created_at, directive.id, ctx, beat.n);
        const leg = 'id' in r ? r
            : findLandedLeg((await fetchThread(arc.conversationId))?.messages, roleLabel, directive.created_at, directive.id); // JA3 belt
        if (leg) {
            rec('re-dispatched', `beat re-dispatched on a fresh stem; leg ${leg.id}`);
            console.log(`[wander-walk] RECONCILED beat ${beat.n}: re-dispatched, leg ${leg.id}`);
            return leg;
        }
        hold(arc, beat.n, 'rung 3 (fresh-stem re-dispatch) did not land a leg', 'recovery-failed-held');
    }
}

async function main(): Promise<void> {
    const arcPath = process.argv[2];
    if (!arcPath) { console.error('usage: wander-walk.ts <arc.json>'); process.exit(1); }
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(arcPath, 'utf-8')); }
    catch (err) { console.error(`[wander-walk] cannot read arc: ${(err as Error).message}`); process.exit(1); }
    const v = validateArc(raw);
    if (!v.ok) { console.error(`[wander-walk] arc invalid: ${v.reason}`); process.exit(1); }
    const arc = v.arc;
    const roleLabel = conversationRoleFor(arc.slug);

    // J3 gate 3 — refuse to arm without the agent's own landed first beat.
    const thread = await fetchThread(arc.conversationId);
    if (!thread) hold(arc, undefined, `thread ${arc.conversationId} not fetchable — the walker walks an EXISTING thread only`);
    const ownPosts = thread.messages.filter(m => m.role === roleLabel);
    if (ownPosts.length === 0) {
        console.error(`[wander-walk] REFUSING TO ARM: no landed first beat by ${arc.slug} in ${arc.conversationId} — the choosing act is the verification act (light the lamp by hand, then walk).`);
        process.exit(1);
    }
    writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'armed', detail: `beats=${arc.beats.map(b => b.n).join(',')} interval=${arc.intervalMinutes}m` });

    let firstWalkedBeat = true;
    for (;;) {
        const now = await fetchThread(arc.conversationId);
        if (!now) hold(arc, undefined, 'thread became unfetchable mid-arc');
        const landed = landedBeatsFromThread(arc, now.messages, roleLabel);
        const beat: WanderBeat | null = nextBeat(arc, landed);
        if (beat === null) break; // all landed — fall through to the landing close below

        await sleep(arc.intervalMinutes * 60_000);

        // The directive, honest-authored: the record shows who asked. The charter (Casey's
        // consent-at-capture) rides the FIRST walked beat only — stated once, at writing time.
        const isFirstWalked = firstWalkedBeat;
        firstWalkedBeat = false;
        const directive = await postAsAgent(arc.conversationId, roleLabel, directiveContent(beat, isFirstWalked ? arc.charter : undefined));
        if (!directive) hold(arc, beat.n, `directive post failed for beat ${beat.n}`);
        writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'beat-posted', beat: beat.n, post_id: directive.id });

        const beatCtx = { beatDirective: beat.directive, charter: isFirstWalked ? arc.charter : undefined };
        const first = await composeAndVerify(arc, arc.slug, now.title, directive.created_at, directive.id, beatCtx, beat.n);
        let landedLeg: { id: string };
        if ('id' in first) {
            landedLeg = first;
        } else if (first.failure === 'stand-down') {
            // Content-refusal NEVER recovers (J5) — the reconciler is for transport wedges only.
            hold(arc, beat.n, `beat ${beat.n} stood down — content-refusal never reconciles; alert-and-hold, never re-fire`);
        } else {
            // MNT-070: RECONCILE before holding — diagnose-then-branch, one bounded recovery,
            // every terminal state still DEC-103's alert-and-hold (now LOUD).
            landedLeg = await reconcileBeat(arc, now.title, beat, directive, beatCtx);
        }
        writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'beat-landed', beat: beat.n, post_id: landedLeg.id });

        // J1's invite door — after the wanderer's own leg lands, invited seats add their voices.
        for (const invitee of beat.invite ?? []) {
            const inviteLanded = await composeAndVerify(arc, invitee, now.title, directive.created_at, directive.id,
                { invitedBy: displayName(arc.slug) }, beat.n);
            if ('id' in inviteLanded) {
                writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'invite-landed', beat: beat.n, post_id: inviteLanded.id, detail: invitee });
            } else {
                console.warn(`[wander-walk] invite to ${invitee} did not land on beat ${beat.n} (${inviteLanded.failure}) — an invitation declined is not a failure; continuing`);
            }
        }
    }

    // J2 — the landing landed; the arc comes home: resolve → DEC-101 reap → spoke returns.
    const res = await fetch(api(`/conversations/${arc.conversationId}/resolve`), { method: 'POST' });
    writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'resolved', detail: res.ok ? 'ok' : `resolve http ${res.status}` });
    writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'arc-complete' });
    console.log(`[wander-walk] arc complete — ${arc.beats.length} beats walked, thread resolved, the spoke comes home.`);
}

main().catch((err) => { console.error('[wander-walk] unexpected:', err); process.exit(1); });
