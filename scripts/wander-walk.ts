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
import { validateArc, nextBeat, landedBeatsFromThread, directiveContent, writeWanderReceipt, type WanderArc, type WanderBeat } from '../src/server/lib/wander';
import { buildPrompt } from '../src/server/lib/prompt-builder';
import { dispatchToSpoke } from '../src/server/lib/tmux-dispatcher';
import { manifestModelLadder, conversationRoleFor, humanResponderTxnTimeoutMs, communityPort } from '../src/server/lib/garden-manifest';
import { gradientConfigForAgent } from '../src/server/lib/agent-registry';
import { appendPairedMemory } from '../src/server/lib/memory-paired-writer';

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

function hold(arc: WanderArc, beat: number | undefined, detail: string): never {
    writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'held-alert', beat, detail });
    console.error(`[wander-walk] HELD (alert, never re-fire): ${detail}`);
    process.exit(1);
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

/** One compose leg: dispatch the seat's warm spoke, then verify a landed post AFTER the given
 *  cutoff (derived from the artefact — the directive's created_at — never typed from memory). */
async function composeAndVerify(
    arc: WanderArc, composeSlug: string, title: string, cutoffIso: string, cutoffId: string,
    ctx: Record<string, unknown>, beatN: number,
): Promise<{ id: string } | null> {
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
    if (cap === null || cap.mode === 'stand-down') return null;
    // The landed leg: the seat's role-labelled post strictly after the directive (id-distinct).
    const thread = await fetchThread(arc.conversationId);
    const landedMsg = thread?.messages.filter(m =>
        m.role === roleLabel && m.id !== cutoffId && m.created_at >= cutoffIso
        && !m.content.startsWith('🌌 Wander beat ')).pop();
    if (!landedMsg) return null;
    // The keepsake path — the leg enters the composer's own memory (same section shape as the
    // human seat's; the walker writes it because there is no controller here).
    try {
        const args = cap.args as { working_memory_full?: string; working_memory_compressed?: string; input_quotes?: string };
        if (args?.working_memory_full && args?.working_memory_compressed) {
            const header = `### Wander beat ${beatN} — "${title}" (${new Date().toISOString()})`;
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

        const landedLeg = await composeAndVerify(arc, arc.slug, now.title, directive.created_at, directive.id,
            { beatDirective: beat.directive, charter: isFirstWalked ? arc.charter : undefined }, beat.n);
        if (!landedLeg) hold(arc, beat.n, `beat ${beat.n} did not land (dispatch failed, stood down, or no post found) — alert-and-hold, never re-fire`);
        writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'beat-landed', beat: beat.n, post_id: landedLeg.id });

        // J1's invite door — after the wanderer's own leg lands, invited seats add their voices.
        for (const invitee of beat.invite ?? []) {
            const inviteLanded = await composeAndVerify(arc, invitee, now.title, directive.created_at, directive.id,
                { invitedBy: displayName(arc.slug) }, beat.n);
            if (inviteLanded) {
                writeWanderReceipt({ ts: new Date().toISOString(), slug: arc.slug, conversationId: arc.conversationId, kind: 'invite-landed', beat: beat.n, post_id: inviteLanded.id, detail: invitee });
            } else {
                console.warn(`[wander-walk] invite to ${invitee} did not land on beat ${beat.n} — an invitation declined is not a failure; continuing`);
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
