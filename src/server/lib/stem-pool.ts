/**
 * stem-pool.ts — the warm-stem pool registry (PR-R3a.1a, DEC-099 R3).
 *
 * Generalises R1's single-stem `stem-<slug>.json` (prewarm-stem.ts) to a pool of N warm stems
 * per agent — the substrate for the head-of-line cure (MNT-009 / BUG-001): a dispatch checks out
 * a FREE stem instead of targeting one fixed surface session, so a busy stem never blocks a
 * queued dispatch. Fork leans settled by Jim's plan-audit: registry is a FILE at
 * `~/.han/pool/pool-<slug>.json` (F-a — survives the #74 restart-bounce, inspectable); the
 * per-stem key is the `tmux_session` / HAN_SESSION (F-b — survives pool re-indexing).
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

export type StemState = 'free' | 'leased';

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
}

export interface Pool {
    slug: string;
    stems: PoolStem[];
}

export interface PoolStatus {
    free: number;
    leased: number;
    total: number;
}

function poolDir(): string {
    return process.env.HAN_POOL_DIR || path.join(process.env.HOME || '/home/darron', '.han', 'pool');
}

export function poolPath(slug: string): string {
    return path.join(poolDir(), `pool-${slug}.json`);
}

/** Read the pool. A missing or malformed registry reads as an empty pool (never throws). */
export function readPool(slug: string): Pool {
    try {
        const data = JSON.parse(fs.readFileSync(poolPath(slug), 'utf8'));
        if (data && typeof data === 'object' && Array.isArray(data.stems)) {
            return { slug, stems: data.stems as PoolStem[] };
        }
    } catch { /* absent / malformed → empty pool */ }
    return { slug, stems: [] };
}

/** Persist the pool atomically (write-temp-rename — a reader never sees a half-written file). */
export function writePool(slug: string, pool: Pool): void {
    const dir = poolDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const target = poolPath(slug);
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
export function checkoutStem(slug: string, nowIso: string): PoolStem | null {
    const pool = readPool(slug);
    const stem = pool.stems.find(s => s.state === 'free');
    if (!stem) return null;
    stem.state = 'leased';
    stem.leased_at = nowIso;
    writePool(slug, pool);
    return { ...stem };
}

/** Return a leased stem to the pool (mark `free`). No-op if the stem is unknown. */
export function returnStem(slug: string, stemId: string): void {
    const pool = readPool(slug);
    const stem = pool.stems.find(s => s.stem_id === stemId);
    if (!stem) return;
    stem.state = 'free';
    delete stem.leased_at;
    writePool(slug, pool);
}

/** Add or replace a stem (by stem_id) — pre-warm / replenish / post-freshen cursor update. */
export function upsertStem(slug: string, stem: PoolStem): void {
    const pool = readPool(slug);
    const i = pool.stems.findIndex(s => s.stem_id === stem.stem_id);
    if (i >= 0) pool.stems[i] = stem; else pool.stems.push(stem);
    writePool(slug, pool);
}

/** Remove a stem (retire — the convergent backstop / 24h sweep). No-op if unknown. */
export function removeStem(slug: string, stemId: string): void {
    const pool = readPool(slug);
    const next = pool.stems.filter(s => s.stem_id !== stemId);
    if (next.length !== pool.stems.length) writePool(slug, { slug, stems: next });
}

/** Update a stem's #91 cursor after a checkout-time freshen (mark it fresh again). */
export function setStemCursor(slug: string, stemId: string, wmCursor: number, cursorSetTs: string): void {
    const pool = readPool(slug);
    const stem = pool.stems.find(s => s.stem_id === stemId);
    if (!stem) return;
    stem.wm_cursor = wmCursor;
    stem.cursor_set_ts = cursorSetTs;
    writePool(slug, pool);
}

export function poolStatus(slug: string): PoolStatus {
    const pool = readPool(slug);
    const leased = pool.stems.filter(s => s.state === 'leased').length;
    return { free: pool.stems.length - leased, leased, total: pool.stems.length };
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
