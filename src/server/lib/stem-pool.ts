/**
 * stem-pool.ts — the warm-stem pool registry (PR-R3a.1a, DEC-099 R3).
 *
 * Generalises R1's single-stem `stem-<slug>.json` (prewarm-stem.ts) to a pool of N warm stems
 * per agent — the substrate for the head-of-line cure (MNT-009 / BUG-001): a dispatch checks out
 * a FREE stem instead of targeting one fixed surface session, so a busy stem never blocks a
 * queued dispatch. Fork leans settled by Jim's plan-audit: registry is a FILE (F-a — survives the
 * #74 restart-bounce, inspectable); the per-stem key is the `tmux_session` / HAN_SESSION (F-b —
 * survives pool re-indexing). PR-C2 (MNT-009 completion): pools are per (slug, SURFACE) —
 * `~/.han/pool/pool-<slug>-<surface>.json` — because stems are NATIVE-per-surface now (born as
 * their surface, no sleeve; independent demand profiles per surface).
 *
 * SCOPE — INERT. This module is the registry DATA + operations ONLY. It does NOT create stems,
 * does NOT wire into the dispatcher, does NOT do IO beyond the registry file. R3a.1b re-keys the
 * per-slug dispatch state per-stem; R3a.1c wires `checkoutStem` into `dispatchToSpoke` (behind a
 * per-surface `pooled` flag) and the pre-warmer populates the pool; R3a.1d adds the 24h sweep.
 *
 * CONCURRENCY. The dispatcher is a single Node process, so checkout/return/upsert/remove are
 * SYNCHRONOUS read-modify-write (readFileSync → mutate → atomic write) with NO await between the
 * read and the write — so two async dispatches in the same process cannot interleave a
 * double-lease. Cross-process writers (the pre-warmer replenishing a stem) use the same atomic
 * write-temp-rename, and each op re-reads fresh, so a concurrently-added stem is simply seen on
 * the next checkout. (The shared-WM write concurrency the pool introduces is guarded separately
 * by the atomic memory-slot — PR-R3a.0.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { poolDir as defaultPoolDir } from './paths';

// DEC-101 persist-as-spoke: 'free' = waiting in the pool; 'leased' = the atomic single-writer grab
// during checkout (transient); 'spoke' = bound to a conversation, serving it across turns until reaped.
export type StemState = 'free' | 'leased' | 'spoke';

export interface PoolStem {
    /** The per-stem key = the stem's tmux session name (HAN_SESSION). F-b. */
    stem_id: string;
    tmux_session: string;
    state: StemState;
    /** The reached GRADIENT-EOF c0 the stem wrote at pre-warm — its readiness proof (the 5th
     *  re-key point: a `free` stem is by-definition ready, so pooled dispatch targets its session
     *  directly and never waits on the shared per-surface sentinel). */
    c0: string;
    /** #91 char-cursor: `working-memory.md` char length at warm/refresh (deltaSinceCursor input). */
    wm_cursor: number;
    /** When `wm_cursor` was set — the freshness-check compares this against the latest rotation. */
    cursor_set_ts: string;
    model: string;
    warm_at: string;
    leased_at?: string;
    /** DEC-101: the conversation this stem is bound to as a spoke (set on bindSpoke). A spoke serves
     *  only its own thread until reaped; used by findSpokeForThread to route a thread's dispatches. */
    conversation_id?: string;
    /** DEC-101: when the stem was bound to its thread (spoke birth) — for LRU/dormancy (future). */
    bound_at?: string;
}

export interface Pool {
    slug: string;
    surface: string;
    stems: PoolStem[];
}

export interface PoolStatus {
    /** DEC-101: WAITING stems only (state==='free') — what replenishPool targets (bound spokes must
     *  NOT count toward the pool, else the first checkout stalls replenish forever, Jim gate 1). */
    free: number;
    leased: number;
    /** DEC-101: stems bound to a conversation as spokes (state==='spoke'). */
    spokes: number;
    total: number;
}

function poolDir(): string {
    return process.env.HAN_POOL_DIR || defaultPoolDir();
}

export function poolPath(slug: string, surface: string): string {
    return path.join(poolDir(), `pool-${slug}-${surface}.json`);
}

/** Read the pool. A missing or malformed registry reads as an empty pool (never throws). */
export function readPool(slug: string, surface: string): Pool {
    try {
        const data = JSON.parse(fs.readFileSync(poolPath(slug, surface), 'utf8'));
        if (data && typeof data === 'object' && Array.isArray(data.stems)) {
            return { slug, surface, stems: data.stems as PoolStem[] };
        }
    } catch { /* absent / malformed → empty pool */ }
    return { slug, surface, stems: [] };
}

/** Persist the pool atomically (write-temp-rename — a reader never sees a half-written file). */
export function writePool(slug: string, surface: string, pool: Pool): void {
    const dir = poolDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const target = poolPath(slug, surface);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(pool, null, 2) + '\n');
    fs.renameSync(tmp, target);
}

/**
 * Atomically check out a FREE stem: mark it `leased` and persist, returning it. Returns null when
 * no stem is free (the caller falls back to `ensureSurfaceSession` — the empty-pool floor). The
 * read→mutate→write is synchronous, so concurrent async dispatches in one process cannot both
 * lease the same stem.
 */
export function checkoutStem(slug: string, surface: string, nowIso: string): PoolStem | null {
    const pool = readPool(slug, surface);
    const stem = pool.stems.find(s => s.state === 'free');
    if (!stem) return null;
    stem.state = 'leased';
    stem.leased_at = nowIso;
    writePool(slug, surface, pool);
    return { ...stem };
}

/** Return a leased stem to the pool (mark `free`). No-op if the stem is unknown.
 *  DEC-101: NOT used by the persist-as-spoke pooled flow (a checked-out stem becomes a spoke and is
 *  retired, never returned). Retained for the non-persist path / rollback + tests. */
export function returnStem(slug: string, surface: string, stemId: string): void {
    const pool = readPool(slug, surface);
    const stem = pool.stems.find(s => s.stem_id === stemId);
    if (!stem) return;
    stem.state = 'free';
    delete stem.leased_at;
    delete stem.conversation_id;
    delete stem.bound_at;
    writePool(slug, surface, pool);
}

/** DEC-101: bind a just-leased stem to a conversation as a spoke (leased → spoke). No-op if unknown.
 *  The spoke thereafter serves ONLY this thread (findSpokeForThread routes to it) until reaped. */
export function bindSpoke(slug: string, surface: string, stemId: string, conversationId: string, nowIso: string): void {
    const pool = readPool(slug, surface);
    const stem = pool.stems.find(s => s.stem_id === stemId);
    if (!stem) return;
    stem.state = 'spoke';
    stem.conversation_id = conversationId;
    stem.bound_at = nowIso;
    delete stem.leased_at;
    writePool(slug, surface, pool);
}

/** DEC-101: the live spoke bound to this thread, or null. The affinity map IS the registry (file-backed,
 *  so it survives a controller restart). Returns a copy; the caller verifies the tmux session is alive. */
export function findSpokeForThread(slug: string, surface: string, conversationId: string): PoolStem | null {
    const pool = readPool(slug, surface);
    const stem = pool.stems.find(s => s.state === 'spoke' && s.conversation_id === conversationId);
    return stem ? { ...stem } : null;
}

/** Add or replace a stem (by stem_id) — pre-warm / replenish / post-freshen cursor update. */
export function upsertStem(slug: string, surface: string, stem: PoolStem): void {
    const pool = readPool(slug, surface);
    const i = pool.stems.findIndex(s => s.stem_id === stem.stem_id);
    if (i >= 0) pool.stems[i] = stem; else pool.stems.push(stem);
    writePool(slug, surface, pool);
}

/** Remove a stem (retire — the convergent backstop / 24h sweep). No-op if unknown. */
export function removeStem(slug: string, surface: string, stemId: string): void {
    const pool = readPool(slug, surface);
    const next = pool.stems.filter(s => s.stem_id !== stemId);
    if (next.length !== pool.stems.length) writePool(slug, surface, { slug, surface, stems: next });
}

/** Update a stem's #91 cursor after a checkout-time freshen (mark it fresh again). */
export function setStemCursor(slug: string, surface: string, stemId: string, wmCursor: number, cursorSetTs: string): void {
    const pool = readPool(slug, surface);
    const stem = pool.stems.find(s => s.stem_id === stemId);
    if (!stem) return;
    stem.wm_cursor = wmCursor;
    stem.cursor_set_ts = cursorSetTs;
    writePool(slug, surface, pool);
}

export function poolStatus(slug: string, surface: string): PoolStatus {
    const pool = readPool(slug, surface);
    const free = pool.stems.filter(s => s.state === 'free').length;
    const leased = pool.stems.filter(s => s.state === 'leased').length;
    const spokes = pool.stems.filter(s => s.state === 'spoke').length;
    return { free, leased, spokes, total: pool.stems.length };
}

/**
 * Freshness logic (pure — the IO of reading rotation-events + current WM length stays in the
 * checkout flow, R3a.1c). A stem is stale when:
 *  - its #91 cursor points PAST the current (possibly-truncated) WM — the D3 belt catching any
 *    non-rotation truncation; OR
 *  - a rotation happened AFTER the stem's cursor was set (the cursor desynced across the slice).
 * Sharpening 3: "no rotation observed since warm" / an empty rotation log ⇒ FRESH (the first
 * organic kept>0 rotation may still be pending, so a sparse log must not read as stale).
 */
export function isStemStale(stem: PoolStem, latestRotationTs: string | null, currentWmLen: number): boolean {
    if (stem.wm_cursor > currentWmLen) return true;
    if (!latestRotationTs) return false;
    return new Date(latestRotationTs).getTime() > new Date(stem.cursor_set_ts).getTime();
}
