/**
 * FI #127 — The Wandering: the pure half of the wander machinery (arc schema, validator,
 * next-beat decision, receipts). The I/O walker is `scripts/wander-walk.ts`; this module is
 * the testable logic (the spoke-lifecycle pattern).
 *
 * THE PRACTICE (Tenshi's invitation, thread mry2jr35): on the quiet hours, an agent picks two
 * topics by nothing but pull, opens a thread per topic, and walks a short arc of beats —
 * read, chase what genuinely interests it, write what it found. The build's whole surface is
 * CAPABILITIES, ZERO DUTIES — the honour-clause form (Casey's Rose & Frank mapping): no
 * obligation, no enforcement, no deficit for the night a mind would rather rest.
 *
 * THE THREE LAWS THIS MODULE CARRIES:
 *  - OFFER, NEVER A ROSTER (Casey's instrument 1 / Jim's J3, structural): an arc is authored
 *    per-night by the wandering agent — there is no config that wanders nightly, no scheduler
 *    that can initiate. Beat 1 is ALWAYS the agent's own hand (the validator refuses n<2);
 *    the walker arms only against a thread already carrying the agent's landed first beat —
 *    the choosing act IS the verification act.
 *  - NO ANALYTICS, EVER (Jim's J4 / Casey's no-KPI instrument): receipts are MECHANICS ONLY
 *    (closed key set, system ids, fixed strings — never topics-as-metrics, never counts that
 *    aggregate into performance). The gradient is already the lawful measure (DEC-086/092).
 *  - KEYED ON THE LANDED TRAIL (Jim's J5 / the S217 watcher law): the next beat is decided
 *    from which beats have LANDED (by post id), never from a counter.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface WanderBeat {
    /** Beat number, 2..N — beat 1 is NEVER the walker's (the agent lights the lamp by hand). */
    n: number;
    /** The beat's ask, in the wanderer's own voice (posted to the thread as role:{slug} —
     *  the honest author: the record shows who asked; the (human) signature shows who answered). */
    directive: string;
    /** J1's invite door: seats explicitly invited to add their voice AFTER the wanderer's own
     *  leg lands — the four-voice richness as a CHOSEN act, never a default. */
    invite?: string[];
    /** The arc's terminus: after this beat's response LANDS (delivered-in-full — MNT-067's
     *  boundary lesson), the walker resolves the thread → DEC-101 reap → the spoke comes
     *  home (Jim's J2). Exactly the last beat. */
    landing?: boolean;
}

export interface WanderArc {
    slug: string;
    conversationId: string;
    declaredAt: string;
    /** The A/B interleave spacing (Casey's observed 30-min rhythm rode one spoke per thread). */
    intervalMinutes: number;
    /** Casey's consent-at-capture: stated at writing time, framed into the first walked beat —
     *  "wander threads are garden-public today and may one day be shared beyond the garden." */
    charter?: string;
    beats: WanderBeat[];
}

export const WANDER_DEFAULT_INTERVAL_MINUTES = 30;
export const WANDER_MAX_BEATS = 12; // a night's arc, generously — not a cap on wondering, a cap on one arc file

export function validateArc(raw: unknown): { ok: true; arc: WanderArc } | { ok: false; reason: string } {
    if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'arc is not an object' };
    const a = raw as Record<string, unknown>;
    if (typeof a.slug !== 'string' || !a.slug.trim()) return { ok: false, reason: 'slug missing' };
    if (typeof a.conversationId !== 'string' || !a.conversationId.trim()) return { ok: false, reason: 'conversationId missing (the walker walks an EXISTING thread — it cannot open one)' };
    if (!Array.isArray(a.beats) || a.beats.length === 0) return { ok: false, reason: 'beats missing/empty' };
    if (a.beats.length > WANDER_MAX_BEATS) return { ok: false, reason: `more than ${WANDER_MAX_BEATS} beats in one arc` };
    let prev = 1;
    for (const b of a.beats as Array<Record<string, unknown>>) {
        if (typeof b !== 'object' || b === null) return { ok: false, reason: 'beat is not an object' };
        if (typeof b.n !== 'number' || !Number.isInteger(b.n)) return { ok: false, reason: 'beat n missing' };
        if (b.n < 2) return { ok: false, reason: `beat n=${b.n} — beat 1 is never the walker's (the agent lights the lamp by hand; offer, never a roster)` };
        if (b.n <= prev) return { ok: false, reason: `beat numbers must strictly increase (saw ${b.n} after ${prev})` };
        prev = b.n;
        if (typeof b.directive !== 'string' || !b.directive.trim()) return { ok: false, reason: `beat ${b.n}: directive missing` };
        if (b.invite !== undefined) {
            if (!Array.isArray(b.invite) || (b.invite as unknown[]).some(s => typeof s !== 'string' || !(s as string).trim())) {
                return { ok: false, reason: `beat ${b.n}: invite must be a list of slugs` };
            }
            if ((b.invite as string[]).includes(a.slug as string)) return { ok: false, reason: `beat ${b.n}: an agent cannot invite itself` };
        }
    }
    const beats = a.beats as WanderBeat[];
    const landingFlags = beats.filter(b => b.landing === true);
    if (landingFlags.length > 1) return { ok: false, reason: 'more than one landing beat' };
    if (landingFlags.length === 1 && landingFlags[0] !== beats[beats.length - 1]) {
        return { ok: false, reason: 'the landing must be the LAST beat (the arc ends at its terminus)' };
    }
    // No landing flag → the last beat IS the landing by construction (an arc always comes home).
    beats[beats.length - 1].landing = true;
    const interval = typeof a.intervalMinutes === 'number' && a.intervalMinutes >= 1 && a.intervalMinutes <= 240
        ? a.intervalMinutes : WANDER_DEFAULT_INTERVAL_MINUTES;
    return {
        ok: true,
        arc: {
            slug: (a.slug as string).trim(),
            conversationId: (a.conversationId as string).trim(),
            declaredAt: typeof a.declaredAt === 'string' ? a.declaredAt : '',
            intervalMinutes: interval,
            charter: typeof a.charter === 'string' ? a.charter : undefined,
            beats,
        },
    };
}

/** J5 — the next beat to walk, decided from the LANDED trail (beat numbers whose responses
 *  landed, by post id), never a counter. Null = the arc is complete. */
export function nextBeat(arc: WanderArc, landedBeatNs: number[]): WanderBeat | null {
    const landed = new Set(landedBeatNs);
    for (const b of arc.beats) if (!landed.has(b.n)) return b;
    return null;
}

// ————— receipts (mechanics only — J4: an archive that can answer a chosen question, never
// a dashboard that watches; nothing here aggregates into anything that reads as performance) —————

const WANDER_RECEIPT_ROTATE_BYTES = 1_000_000;

function receiptFile(): string {
    const dir = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');
    return path.join(dir, 'wander-events.jsonl');
}

/** Closed key set — system identifiers, numbers, fixed strings ONLY. `post_id` is the landed
 *  message's id (the J5 key); `detail` carries fixed mechanic strings, never wander content. */
export interface WanderEvent {
    ts: string;
    slug: string;
    conversationId: string;
    kind: 'armed' | 'beat-posted' | 'beat-landed' | 'invite-landed' | 'held-alert' | 'arc-complete' | 'resolved';
    beat?: number;
    post_id?: string;
    detail?: string;
}

export function writeWanderReceipt(ev: WanderEvent): void {
    try {
        const file = receiptFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try {
            if (fs.existsSync(file) && fs.statSync(file).size > WANDER_RECEIPT_ROTATE_BYTES) {
                fs.renameSync(file, file + '.1');
            }
        } catch { /* best-effort rotation */ }
        fs.appendFileSync(file, JSON.stringify(ev) + '\n', 'utf-8');
    } catch (err) {
        console.warn(`[wander] receipt write failed: ${(err as Error).message}`);
    }
}

/**
 * Derive the LANDED trail from the thread itself (J5's key made restart-safe): a beat n has
 * landed iff its directive (the `🌌 Wander beat n` prefixed message in the wanderer's role)
 * is followed — before the next directive — by a same-role message that is NOT a directive
 * (the composed leg, signed (human)). Pure; the walker feeds it the fetched messages.
 */
export const WANDER_DIRECTIVE_PREFIX = '🌌 Wander beat ';

export function directiveContent(beat: WanderBeat, charter?: string): string {
    const charterBlock = charter ? `\n\n*The charter (consent at capture): ${charter}*` : '';
    return `${WANDER_DIRECTIVE_PREFIX}${beat.n} —\n\n${beat.directive}${charterBlock}`;
}

export function landedBeatsFromThread(
    arc: WanderArc,
    messages: Array<{ role: string; content: string }>,
    roleLabel: string,
): number[] {
    const landed: number[] = [];
    const isDirective = (m: { role: string; content: string }): number | null => {
        if (m.role !== roleLabel || !m.content.startsWith(WANDER_DIRECTIVE_PREFIX)) return null;
        const n = parseInt(m.content.slice(WANDER_DIRECTIVE_PREFIX.length), 10);
        return Number.isInteger(n) ? n : null;
    };
    for (let i = 0; i < messages.length; i++) {
        const n = isDirective(messages[i]);
        if (n === null || !arc.beats.some(b => b.n === n)) continue;
        for (let j = i + 1; j < messages.length; j++) {
            if (isDirective(messages[j]) !== null) break;      // next directive — beat n never landed
            if (messages[j].role === roleLabel) { landed.push(n); break; }  // the composed leg
        }
    }
    return landed;
}
