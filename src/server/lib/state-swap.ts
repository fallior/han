/**
 * state-swap.ts — the P3d Unit-2b atomic DB+state swap: the Ring-2 ceremony's LAST ACT
 * (thread mqz3wev0; Option A ruled mrgi9dsd; gate list mrh9apbl; Tenshi's A–F mrmwuxvx;
 * Jim's boot-gate polarities mrmxwrnw; DEC-102: the swap happens only after the ring).
 *
 * THE MOVE-SET INVARIANT (Tenshi A — the Trusting-Trust invariant at the swap boundary):
 * the swap moves EXACTLY signed-declaration ∩ ceremony-rendered ∩ re-hash-covered. The
 * move-set derives from the migration declarations in the CHECKED-OUT SIGNED TREE — never
 * from staging-manifest.json, which is written by the very run it would govern (an unsigned,
 * same-user-writable file: a Henry VIII clause wearing a receipt's clothes — Casey. The
 * standing question, asked of every read below: WHO CAN WRITE THE THING THIS READS?).
 * Any file in staging outside the derived set → fail-closed abort (verifyStagingSet).
 *
 * THE COMMIT POINT (Tenshi B, ruled): authored trees swap FIRST, the DB rename LAST — the
 * DB rename IS the point of no return. Recovery is thereby unambiguous: dangling swap-start
 * with the live DB still OLD → roll BACK (restore trees from the retained pre-copies);
 * live DB NEW → roll FORWARD (every tree preceded it by construction; only swap-done
 * remains). The hazard state — a new DB beside half-old trees — is unreachable.
 *
 * THE JOURNAL (gate 1) is ledger ops `swap-start`/`swap-done` in update-ledger.jsonl.
 * Gate 4: the journal LOCATES, never trusts — recovery re-verifies every restore against
 * the recorded render-time hashes and the DEC-069 pre-copies before acting; ambiguity HALTs.
 *
 * STAGING LIFECYCLE (gate 6 + Casey's disposal-schedule form — decided here, in advance,
 * in writing, never by a future operator at the moment a disk fills):
 *   - staging is born 0700 under $HAN_HOME/staging/update-<ts>/ (an OTHER-user control on a
 *     SAME-user threat model — Tenshi E: the real mitigations are the short window and that
 *     staging duplicates an already-same-user-readable exposure; 0700 is worth doing and is
 *     not a confidentiality wall — named, not dressed);
 *   - decline/abort → quarantine-clean move to $HAN_HOME/archives/staging/ (never rm);
 *   - THE SCHEDULE: every non-current staging dir archives at the next han-update run
 *     (sweepStaleStaging); archives are retained indefinitely (DEC-069) — any future pruning
 *     is a DEC-level decision by the named authority, never custodial discretion.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface SwapHashes {
    /** tree (relative to $HAN_HOME) → deterministic tree-hash of the STAGED copy. */
    staged: Record<string, string>;
    /** tree → tree-hash of the LIVE tree at ceremony-render time (absent tree = hash of empty). */
    live: Record<string, string>;
    /** sha256 of the staged DB file at render time. */
    stagedDb: string;
}

export interface SwapPlan {
    hanHome: string;
    stagingDir: string;
    /** Absolute path of the live gradient.db. */
    dbLive: string;
    /** The AUTHORITATIVE move-set: union of `touchesState` from the checked-out signed
     *  tree's pending-migration declarations (Tenshi A). Relative-to-$HAN_HOME tree paths. */
    moveSet: string[];
    ledgerPath: string;
    /** The schema version the staged DB carries (recovery's roll-forward witness). */
    schemaTo: number;
    /** Run timestamp (ISO, colon/dot-stripped) — names the pre-copies, run-scopes recovery. */
    ts: string;
}

const sha256 = (b: Buffer | string): string => crypto.createHash('sha256').update(b).digest('hex');

// ── deterministic tree hashing (the two-sided re-hash's unit) ──────────────────────────────

/** Walk a tree, return sorted relpath entries with content hashes. Absent root = empty. */
function treeEntries(root: string): Array<{ rel: string; hash: string }> {
    const out: Array<{ rel: string; hash: string }> = [];
    const walk = (dir: string): void => {
        let names: string[];
        try { names = fs.readdirSync(dir).sort(); } catch { return; }
        for (const n of names) {
            const p = path.join(dir, n);
            const st = fs.lstatSync(p);
            if (st.isDirectory()) walk(p);
            else if (st.isFile()) out.push({ rel: path.relative(root, p), hash: sha256(fs.readFileSync(p)) });
            // symlinks/other: hash the link target string so a swapped-in symlink can't hide
            else if (st.isSymbolicLink()) out.push({ rel: path.relative(root, p), hash: sha256(`symlink:${fs.readlinkSync(p)}`) });
        }
    };
    walk(root);
    return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** One hash for a whole tree: sha256 over `relpath<NUL>contenthash` lines (the NUL written as the \u0000 ESCAPE, never a literal byte - the MNT-026/P3c lesson: a trust-critical file must not carry the control-byte class it exists to defend against), sorted. */
export function hashTree(root: string): string {
    return sha256(treeEntries(root).map((e) => `${e.rel}\u0000${e.hash}`).join('\n'));
}

/** Capture both sides at ceremony-render time (gate 2's baseline). */
export function captureSwapHashes(plan: SwapPlan): SwapHashes {
    const staged: Record<string, string> = {};
    const live: Record<string, string> = {};
    for (const tree of plan.moveSet) {
        staged[tree] = hashTree(path.join(plan.stagingDir, tree));
        live[tree] = hashTree(path.join(plan.hanHome, tree));
    }
    return { staged, live, stagedDb: sha256(fs.readFileSync(path.join(plan.stagingDir, path.basename(plan.dbLive)))) };
}

// ── the move-set boundary (Tenshi A) ────────────────────────────────────────────────────────

/** Staging may contain ONLY: the declared trees, the DB copy (+sidecars), and the receipt
 *  (staging-manifest.json — read for legibility, trusted for nothing). Anything else is an
 *  undeclared change no human eye ever saw → fail-closed. */
export function verifyStagingSet(stagingDir: string, moveSet: string[], dbBasename: string):
    { ok: true } | { ok: false; extras: string[] } {
    const allowedTop = new Set([dbBasename, `${dbBasename}-wal`, `${dbBasename}-shm`, 'staging-manifest.json']);
    const extras: string[] = [];
    const rootOf = (rel: string): string => rel.split(path.sep)[0];
    const inMoveSet = (rel: string): boolean =>
        moveSet.some((t) => rel === t || rel.startsWith(t + path.sep));
    const walk = (dir: string): void => {
        for (const n of fs.readdirSync(dir)) {
            const p = path.join(dir, n);
            const rel = path.relative(stagingDir, p);
            if (fs.lstatSync(p).isDirectory()) {
                // a directory is fine if it's a prefix of (or inside) a declared tree
                if (inMoveSet(rel) || moveSet.some((t) => t.startsWith(rel + path.sep) || t === rel)) walk(p);
                else extras.push(rel + path.sep);
            } else if (!inMoveSet(rel) && !allowedTop.has(rootOf(rel))) extras.push(rel);
        }
    };
    walk(stagingDir);
    return extras.length ? { ok: false, extras } : { ok: true };
}

/** Gate 7b: a staging dir nested inside a declared tree would swap itself — refuse legibly. */
export function assertStagingNotNested(stagingDir: string, moveSet: string[], hanHome: string): string | null {
    const stagingReal = path.resolve(stagingDir);
    for (const tree of moveSet) {
        const treeAbs = path.resolve(hanHome, tree);
        if (stagingReal === treeAbs || stagingReal.startsWith(treeAbs + path.sep)) {
            return `staging dir ${stagingDir} is nested inside declared tree '${tree}' — the swap would move its own staging; choose a staging path outside every declared tree`;
        }
    }
    return null;
}

// ── the ledger journal (gate 1) + the boot gate (Tenshi C, Jim's polarities) ───────────────

function ledgerAppend(ledgerPath: string, entry: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

export type DanglingSwapState =
    | { state: 'genesis-clean'; detail: string }   // polarity (i): absent ledger — no swap has ever run
    | { state: 'clean'; detail: string }
    | { state: 'dangling'; detail: string; entry: Record<string, unknown> }
    | { state: 'corrupt'; detail: string };        // polarity (ii): unreadable/corrupt — HALT legibly

/**
 * The boot-gate read (Tenshi C): is there a swap-start with no matching swap-done?
 * Jim's two polarities, both named: an ABSENT ledger is the genesis carve-out (a fresh
 * garden must not halt on a file that doesn't exist yet); an UNREADABLE or CORRUPT ledger
 * HALTs — a corrupt trust-root journal is the moment you want a human, not a guess.
 * Strictness note: THIS reader treats a malformed line as corrupt (fail-closed) — unlike
 * the advisory readers (quarantinedTags etc.) which skip; a skipped line here could hide
 * the very swap-start the gate exists to find.
 *
 * BACKWARD-BOUNDED SCAN (Tenshi's post-land hardenings 1+2, mrn4e2jk): the ledger is
 * append-only and unrotated, and this gate runs at EVERY wake — a forward full-file scan
 * makes the hottest path in the system cost O(total-update-history), forever. So: scan
 * from EOF backward, collecting swap-done/swap-recovered ids, and stop at the FIRST
 * swap-start met (the LATEST start — its closers always sit after it in the file, i.e.
 * before it in this scan). That start closed → clean; unclosed → dangling. The latest
 * start is authoritative because swaps are serialized (stepApply refuses to start over a
 * dangling one) — and unlike a bare last-op-wins read, the ID-MATCHED close means an
 * interleaved history (…start-A, start-B, done-A…) still reads B as DANGLING, never
 * masked by A's completion (hardening 2, self-sufficient rather than invariant-trusting).
 * Honest bound on the strictness: corruption detection now covers the scanned tail
 * (EOF back to the latest swap-start, the authoritative region); a malformed line in
 * ancient history BEYOND the last swap is no longer parsed — that is the bounded-cost
 * trade, chosen deliberately (the region that decides the verdict is always parsed).
 */
export function checkDanglingSwap(ledgerPath: string): DanglingSwapState {
    if (!fs.existsSync(ledgerPath)) return { state: 'genesis-clean', detail: 'no update ledger — no swap has ever run (genesis carve-out)' };
    let raw: string;
    try { raw = fs.readFileSync(ledgerPath, 'utf8'); }
    catch (e) { return { state: 'corrupt', detail: `update ledger unreadable: ${(e as Error).message}` }; }
    const lines = raw.trim().split('\n');
    const closed = new Set<string>();
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].trim()) continue;
        let e: Record<string, unknown>;
        try { e = JSON.parse(lines[i]); }
        catch { return { state: 'corrupt', detail: `update ledger line ${i + 1} is not valid JSON — fail-closed (a malformed line could hide a swap-start)` }; }
        if ((e.op === 'swap-done' || e.op === 'swap-recovered') && typeof e.swapId === 'string') closed.add(e.swapId);
        if (e.op === 'swap-start') {
            if (typeof e.swapId === 'string' && closed.has(e.swapId)) return { state: 'clean', detail: 'latest swap completed cleanly' };
            return { state: 'dangling', detail: `swap ${String(e.swapId)} started ${String(e.ts)} and never completed — the garden may be HALF-SWAPPED; run 'han update --recover' before any wake`, entry: e };
        }
    }
    return { state: 'clean', detail: 'no dangling swap' };
}

// ── the swap itself ─────────────────────────────────────────────────────────────────────────

export interface SwapAsserts {
    /** Tenshi D: re-verify the quiesce AT THE MOMENT IT MATTERS (wm-sensor inactive + no
     *  rotation locks), not just that step 3 ran. Injectable so scratch suites can supply a
     *  scratch-honest no-op — the live caller passes the real check. */
    assertQuiesced: () => string | null;
}

const preCopyName = (liveAbs: string, ts: string): string => `${liveAbs}.pre-swap-${ts}`;

/**
 * Execute the approved swap. Caller holds the freeze; the ceremony has approved; hashes
 * were captured at render time. Order (Tenshi B, ruled): journal → re-hash both sides →
 * per-tree device assert → trees (live→pre-copy, staged→live) → DB LAST (the commit
 * point) → swap-done. Throws on any gate failure BEFORE the first rename; a throw after
 * renames began leaves a dangling journal for directed recovery.
 */
export function executeSwap(plan: SwapPlan, atRender: SwapHashes, asserts: SwapAsserts, log: (m: string) => void): void {
    const swapId = `swap-${plan.ts}`;
    // Tenshi D — the quiesce, re-asserted at the moment that matters.
    const quiesceProblem = asserts.assertQuiesced();
    if (quiesceProblem) throw new Error(`swap-time quiesce re-assert FAILED: ${quiesceProblem}`);
    // Gate 2 — the two-sided re-hash: staged AND live byte-unchanged since the ceremony
    // rendered pre→post. Nothing may touch either side between the ring and the swap.
    const now = captureSwapHashes(plan);
    for (const tree of plan.moveSet) {
        if (now.staged[tree] !== atRender.staged[tree]) throw new Error(`staged tree '${tree}' CHANGED since the ceremony rendered it — refusing to swap what no human eye approved (gate 2)`);
        if (now.live[tree] !== atRender.live[tree]) throw new Error(`LIVE tree '${tree}' changed since the ceremony rendered pre→post — a writer is loose inside the quiesce; refusing (gate 2)`);
    }
    if (now.stagedDb !== atRender.stagedDb) throw new Error('staged DB changed since the ceremony rendered — refusing (gate 2)');
    // Tenshi A — nothing outside the approved set may ride.
    const setCheck = verifyStagingSet(plan.stagingDir, plan.moveSet, path.basename(plan.dbLive));
    if (!setCheck.ok) throw new Error(`staging holds files OUTSIDE the signed move-set: ${setCheck.extras.join(', ')} — an undeclared change no human eye ever saw (fail-closed)`);
    // Gate 5 — per-tree device assert, at the renames it protects (Tenshi F1 pedigree).
    const dev = (p: string): number => fs.statSync(p).dev;
    const stagingDev = dev(plan.stagingDir);
    for (const tree of plan.moveSet) {
        const liveParent = path.dirname(path.join(plan.hanHome, tree));
        fs.mkdirSync(liveParent, { recursive: true });
        if (dev(liveParent) !== stagingDev) throw new Error(`tree '${tree}': live parent ${liveParent} is on a different filesystem than staging — rename-atomicity dies cross-device; refusing (gate 5)`);
    }
    // Gate 1 — the journal. Records the render-time hashes so recovery VERIFIES, never trusts.
    ledgerAppend(plan.ledgerPath, {
        op: 'swap-start', swapId, schemaTo: plan.schemaTo, stagingDir: plan.stagingDir,
        moveSet: plan.moveSet, liveHashes: atRender.live, stagedHashes: atRender.staged, tsToken: plan.ts,
    });
    // Trees first (Tenshi B) — live → pre-copy (DEC-069 retained), staged → live.
    for (const tree of plan.moveSet) {
        const liveAbs = path.join(plan.hanHome, tree);
        const stagedAbs = path.join(plan.stagingDir, tree);
        if (fs.existsSync(liveAbs)) fs.renameSync(liveAbs, preCopyName(liveAbs, plan.ts));
        fs.renameSync(stagedAbs, liveAbs);
        log(`swapped tree '${tree}' (live retained as ${path.basename(preCopyName(liveAbs, plan.ts))})`);
    }
    // The DB — LAST: this rename is the point of no return (Tenshi B, ruled). Mirrors
    // han-migrate's proven mechanics: pre-copy + sidecar re-pair + explicit 0600.
    const dbPre = `${plan.dbLive}.pre-v${plan.schemaTo}-${plan.ts}`;
    fs.renameSync(plan.dbLive, dbPre);
    for (const side of ['-wal', '-shm']) {
        if (fs.existsSync(plan.dbLive + side)) fs.renameSync(plan.dbLive + side, dbPre + side);
    }
    fs.chmodSync(dbPre, 0o600);
    fs.renameSync(path.join(plan.stagingDir, path.basename(plan.dbLive)), plan.dbLive);
    log(`swapped DB (COMMIT POINT crossed): live → ${path.basename(dbPre)}; staged → live; now v${plan.schemaTo}`);
    ledgerAppend(plan.ledgerPath, { op: 'swap-done', swapId, schemaTo: plan.schemaTo });
}

// ── directed recovery (gates 3+4; the boot gate's cure) ────────────────────────────────────

/** Reads schema_version without better-sqlite3 (recovery must not depend on the server's
 *  node_modules being intact mid-crash): sqlite3 CLI. An ABSENT schema_meta table = v0 (the
 *  legitimate pre-P2 state — han-migrate's currentVersion() semantics, kept identical here);
 *  any OTHER failure → null (ambiguous → the caller HALTs). */
function schemaVersionVia(dbPath: string, sqlite3Bin = 'sqlite3'): number | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { execFileSync } = require('child_process');
        const out = execFileSync(sqlite3Bin, [dbPath, 'SELECT schema_version FROM schema_meta WHERE id=1'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
        return out === '' ? 0 : Number(out);
    } catch (e) {
        const stderr = String((e as { stderr?: Buffer }).stderr ?? '');
        if (/no such table:\s*schema_meta/i.test(stderr)) return 0; // pre-migration DB — a real, old state
        return null;
    }
}

/**
 * Recover a dangling swap. Direction from the COMMIT POINT (Tenshi B):
 *   live DB exists at schemaTo         → roll FORWARD: only swap-done remains.
 *   live DB exists below schemaTo      → roll BACK: restore trees from pre-copies.
 *   live DB absent, DB pre-copy exists → roll BACK: restore DB from pre-copy, then trees.
 * Gate 4: every restore is VERIFIED against the journal's recorded render-time hashes
 * before acting; any mismatch or ambiguity HALTs for a human (fail-closed) — the journal
 * locates, the hashes and pre-copies decide.
 */
export function recoverDanglingSwap(hanHome: string, dbLive: string, ledgerPath: string, log: (m: string) => void): 'rolled-forward' | 'rolled-back' {
    const check = checkDanglingSwap(ledgerPath);
    if (check.state !== 'dangling') throw new Error(`nothing to recover: ${check.detail}`);
    const e = check.entry as { swapId: string; schemaTo: number; moveSet: string[]; liveHashes: Record<string, string>; tsToken: string; stagingDir: string };
    const dbExists = fs.existsSync(dbLive);
    const v = dbExists ? schemaVersionVia(dbLive) : null;
    if (dbExists && v === null) throw new Error('cannot read the live DB schema_version — ambiguous recovery direction; HALT for a human (fail-closed)');
    if (dbExists && v !== null && v >= e.schemaTo) {
        // Forward: the commit point was crossed; every tree preceded the DB by construction.
        ledgerAppend(ledgerPath, { op: 'swap-done', swapId: e.swapId, schemaTo: e.schemaTo, recovered: true });
        log(`recovery: live DB already at v${v} ≥ v${e.schemaTo} — rolled FORWARD (swap-done appended)`);
        return 'rolled-forward';
    }
    // Backward: restore any renamed trees from their pre-copies, verified first (gate 4).
    for (const tree of e.moveSet) {
        const liveAbs = path.join(hanHome, tree);
        const pre = preCopyName(liveAbs, e.tsToken);
        if (!fs.existsSync(pre)) { log(`recovery: tree '${tree}' has no pre-copy — its rename never happened; leaving as-is`); continue; }
        const preHash = hashTree(pre);
        if (preHash !== e.liveHashes[tree]) {
            throw new Error(`recovery: pre-copy for '${tree}' does NOT match the journal's recorded live hash — refusing to restore unverified bytes over live; HALT for a human (gate 4)`);
        }
        if (fs.existsSync(liveAbs)) fs.renameSync(liveAbs, `${liveAbs}.swap-aborted-${Date.now()}`); // keep, never delete (DEC-069)
        fs.renameSync(pre, liveAbs);
        log(`recovery: tree '${tree}' restored from its verified pre-copy`);
    }
    if (!dbExists) {
        const dbPre = `${dbLive}.pre-v${e.schemaTo}-${e.tsToken}`;
        if (!fs.existsSync(dbPre)) throw new Error('recovery: live DB absent AND its pre-copy missing — HALT for a human (fail-closed)');
        fs.renameSync(dbPre, dbLive);
        for (const side of ['-wal', '-shm']) { if (fs.existsSync(dbPre + side)) fs.renameSync(dbPre + side, dbLive + side); }
        log('recovery: live DB restored from its pre-copy (crash was between the two DB renames)');
    }
    ledgerAppend(ledgerPath, { op: 'swap-recovered', swapId: e.swapId, direction: 'rollback' });
    log('recovery: rolled BACK — the old world is whole (pre-copies verified before every restore)');
    return 'rolled-back';
}

/**
 * Restore THIS RUN's swapped trees during han-update's rollback (the state half of the
 * run-scoped restore — a health-gate or re-sign failure AFTER a completed swap must put the
 * old trees back beside the old DB). Finds the run's swap-start by swapId; per tree: verify
 * the pre-copy against the journal's recorded render-time live hash (gate 4), quarantine the
 * current live (never delete — DEC-069), restore. No swap-start under this id = the swap
 * never began = nothing to do (the run-scope lesson: never restore another run's copies).
 */
export function rollbackSwappedTrees(hanHome: string, ledgerPath: string, swapId: string, log: (m: string) => void): string[] {
    const notes: string[] = [];
    if (!fs.existsSync(ledgerPath)) return notes;
    let entry: { moveSet: string[]; liveHashes: Record<string, string>; tsToken: string } | null = null;
    for (const line of fs.readFileSync(ledgerPath, 'utf8').trim().split('\n')) {
        try { const e = JSON.parse(line); if (e.op === 'swap-start' && e.swapId === swapId) entry = e; } catch { /* advisory read */ }
    }
    if (!entry) return notes;
    for (const tree of entry.moveSet) {
        const liveAbs = path.join(hanHome, tree);
        const pre = preCopyName(liveAbs, entry.tsToken);
        if (!fs.existsSync(pre)) continue; // this tree never renamed (or already restored)
        if (hashTree(pre) !== entry.liveHashes[tree]) {
            throw new Error(`rollback: pre-copy for '${tree}' does not match the journal's recorded live hash — refusing to restore unverified bytes (gate 4)`);
        }
        if (fs.existsSync(liveAbs)) fs.renameSync(liveAbs, `${liveAbs}.rolledback-${Date.now()}`); // keep, never delete (DEC-069)
        fs.renameSync(pre, liveAbs);
        const note = `tree '${tree}' restored from its verified pre-copy (run ${swapId})`;
        notes.push(note); log(`rollback: ${note}`);
    }
    return notes;
}

// ── staging lifecycle (gate 6 + F + the schedule) ──────────────────────────────────────────

/** Quarantine-clean discard: staging moves to $HAN_HOME/archives/staging/, never rm (F). */
export function discardStaging(stagingDir: string, hanHome: string, reason: string, log: (m: string) => void): void {
    if (!fs.existsSync(stagingDir)) return;
    // Gate 7a: an EMPTY refused staging dir is just removed — nothing in it to retain.
    if (fs.readdirSync(stagingDir).length === 0) { fs.rmdirSync(stagingDir); log(`staging removed (empty, ${reason})`); return; }
    const archiveDir = path.join(hanHome, 'archives', 'staging');
    fs.mkdirSync(archiveDir, { recursive: true });
    const dst = path.join(archiveDir, `${path.basename(stagingDir)}-${reason.replace(/[^a-z0-9-]/gi, '_').slice(0, 40)}`);
    fs.renameSync(stagingDir, dst);
    log(`staging quarantine-archived → ${dst} (${reason}; DEC-069 — never rm)`);
}

/** THE SCHEDULE (Casey's disposal-schedule form): every non-current staging dir archives at
 *  the next run. A crash's staging survives the dangling-swap recovery first (the boot gate
 *  runs before any new update starts), so by the time this sweep sees it, it is dead. */
export function sweepStaleStaging(hanHome: string, currentStagingDir: string | null, log: (m: string) => void): void {
    const stagingRoot = path.join(hanHome, 'staging');
    if (!fs.existsSync(stagingRoot)) return;
    for (const n of fs.readdirSync(stagingRoot)) {
        const p = path.join(stagingRoot, n);
        if (currentStagingDir && path.resolve(p) === path.resolve(currentStagingDir)) continue;
        if (!n.startsWith('update-')) continue;
        discardStaging(p, hanHome, 'stale-sweep', log);
    }
}
