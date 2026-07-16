#!/usr/bin/env tsx
/**
 * han-update.ts — the live-garden update tool, P3b core (S219; design: plans/han-update-p3-design.md;
 * ruling: DEC-102; audits: Jim mrea6bjn + Tenshi mrea9qc0, both GREEN).
 *
 *   han update [--to <tag>] [--check] [--rollback <tag>]
 *
 * THE INVARIANT (DEC-102, Tenshi's words): "An update changes a mind only when a human
 * signature and a human's eyes both say so, over a diff neither the attacker nor the noise
 * can hide in."
 *
 * P3b landed steps 0–5 + 7–8; P3c (S220) lands step 6 — the DEC-102 Ring-2 AUTHORSHIP SPLIT
 * (authored identity: undeclared change → abort+rollback; declared → the semantic-diff
 * ceremony inside the quiesce, lib/ring2-ceremony.ts) + the TYPED freshness dispatch
 * (fatal-vs-advisory in the type — Tenshi's P3b #2). A state-touching migration is REFUSED
 * pre-flight until P3d's state-copy leg exists (fail-closed). There is NO --force flag on
 * this tool, by design (SEC-04): every gate passes or the update aborts whole.
 *
 * --scratch <dir> is TEST-ONLY (documented, like han-migrate's --skip-smoke): points the
 * tool at a scratch repo/garden and swaps the service/health legs for scratch-honest
 * no-ops so the flow can be end-to-end proven without touching the live garden.
 */
import { execFileSync, execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hanHome, hanRepo } from '../src/server/lib/paths';

const argvRest = process.argv.slice(2);
const CHECK = argvRest.includes('--check');
const TO = argvRest.includes('--to') ? argvRest[argvRest.indexOf('--to') + 1] : null;
const ROLLBACK = argvRest.includes('--rollback') ? argvRest[argvRest.indexOf('--rollback') + 1] : null;
const SCRATCH = argvRest.includes('--scratch') ? argvRest[argvRest.indexOf('--scratch') + 1] : null;
// P3d: the ONLY way to (re)apply a tag a rollback abandoned — an explicit, per-tag operator
// override, so no "update to newest" habit can silently walk back into a known-bad release.
const FORCE_QUARANTINED = argvRest.includes('--force-quarantined') ? argvRest[argvRest.indexOf('--force-quarantined') + 1] : null;
// 2b: directed recovery of a dangling swap (gate 3's operational door). The boot gate
// (verify-identity-files.ts) HALTs wakes and names this flag; it is also run automatically
// at the top of every apply (a new update never starts over a half-swapped garden).
const RECOVER = argvRest.includes('--recover');

// The --scratch belt (Jim's non-blocker + Tenshi #4): a TEST affordance must never reach
// production — refuse a scratch garden home resolving to the real HAN home; explicit-ARG-only
// by construction (argv, never an env var a shell could leak in).
// P3c sharpening (declared, both halves): (1) compare against the box's DEFAULT garden home
// (~/.han), not the env-resolved hanHome() — a manifest-carrying scratch E2E NECESSARILY
// aligns HAN_HOME to the scratch home (the dynamic imports read it), and the P3b env-aware
// compare refused exactly that legitimate shape; (2) compare REALPATHS — `<scratch>/han` can
// never literally equal a path whose basename is `.han` (the P3b compare was structurally
// unable to fire against the real home at all); the actual route to production is a symlink,
// and realpath follows it. Named residual: a live garden at a CUSTOM HAN_HOME colliding with
// an env-aligned scratch is not detectable here (SEC-09 isolation-gate territory).
if (SCRATCH) {
    const realOrResolved = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    if (realOrResolved(path.join(SCRATCH, 'han')) === realOrResolved(path.join(os.homedir(), '.han'))) {
        console.error('[han-update] ABORT: --scratch resolves to the REAL HAN home — refusing (test affordance, production-proof)');
        process.exit(1);
    }
}
const REPO = SCRATCH ? path.join(SCRATCH, 'repo') : hanRepo();
const HOME_DIR = SCRATCH ? path.join(SCRATCH, 'han') : hanHome();
const LEDGER = path.join(HOME_DIR, 'health', 'update-ledger.jsonl');
const log = (m: string) => console.log(`[han-update] ${m}`);
const fail = (m: string): never => { console.error(`[han-update] ABORT: ${m}`); process.exit(1); };

const git = (args: string[]): string =>
    execFileSync('git', ['-C', REPO, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
// BYTE-EXACT variant — for content a signature covers. git() trims, and a stripped trailing
// newline breaks ssh-keygen -Y verify (the CRLF lesson's cousin: the diff you sign is bytes).
const gitRaw = (args: string[]): Buffer =>
    execFileSync('git', ['-C', REPO, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

// ── the ledger (append-only; joined to the off-box snapshot chain per SEC-12/Tenshi#4) ────
function ledgerAppend(entry: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}
function ledgerHighWater(): string | null {
    try {
        const lines = fs.readFileSync(LEDGER, 'utf8').trim().split('\n');
        let hw: string | null = null;
        for (const l of lines) {
            try { const e = JSON.parse(l); if (e.freshness_latest && (!hw || e.freshness_latest > hw)) hw = e.freshness_latest; } catch { /* skip */ }
        }
        return hw;
    } catch { return null; }
}

// ── the rollback-QUARANTINE set (P3d, Tenshi finding-1) ────────────────────────────────────
// Two correct mechanisms (rollback + the replay-backward high-water) don't share ONE fact:
// *this version was REJECTED*. After a rollback, `--check` and the freshness verdict both point
// the operator straight back at the tag they deliberately rolled back FROM (it's still the
// highest signed tag on the mirror, still genuinely signed), and nothing refuses a re-apply of
// it. So the tool would advise — and allow — re-installing a KNOWN-BAD release. The cure: a
// rollback records the abandoned tag here; `--check` annotates it; apply REFUSES it without an
// explicit `--force-quarantined <tag>`. The set is a ledger projection (append-only op records
// quarantine/unquarantine), so it inherits the ledger's off-box tamper-evidence witness.
function quarantinedTags(): Map<string, string> {  // tag → the ISO date it was quarantined (latest wins)
    const q = new Map<string, string>();
    try {
        for (const l of fs.readFileSync(LEDGER, 'utf8').trim().split('\n')) {
            try {
                const e = JSON.parse(l);
                if (e.op === 'quarantine' && e.tag) q.set(e.tag, e.ts ?? '');
                if (e.op === 'unquarantine' && e.tag) q.delete(e.tag);
            } catch { /* skip malformed */ }
        }
    } catch { /* no ledger yet */ }
    return q;
}

// ── version ordering (vYYYY.MM.DD[.n] — lexicographic within the scheme) ──────────────────
function isReleaseTag(t: string): boolean { return /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(t); }
function cmpTag(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** The DEPLOYED version, read from GIT STATE — never the local ledger (Tenshi's refinement:
 *  the ledger is a local unsigned file a box-compromise can edit; the checked-out tag is the
 *  harder-to-fake witness). Returns null on a garden that has never deployed a release tag
 *  (running from tip — our own garden today). */
function deployedVersionFromGit(): string | null {
    try {
        const t = git(['describe', '--tags', '--exact-match', 'HEAD']);
        return isReleaseTag(t) ? t : null;
    } catch { return null; }
}

// ── step 0: resolve + verify + freshness ──────────────────────────────────────────────────
function newestSignedTag(): { tag: string; hash: string } | null {
    const tags = git(['tag', '-l']).split('\n').filter(isReleaseTag).sort(cmpTag).reverse();
    for (const t of tags) {
        try {
            const hash = execFileSync(path.join(hanRepo(), 'scripts', 'verify-release-tag.sh'), [t, REPO],
                { env: { ...process.env, HAN_HOME: HOME_DIR }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
            return { tag: t, hash };
        } catch { /* unsigned/unverifiable tag → not a release candidate; keep looking */ }
    }
    return null;
}

interface Freshness { latest_version: string; released_at: string; expires_at: string; prev_version?: string }

/**
 * THE TYPED FRESHNESS DISPATCH (P3c, Tenshi's P3b #2 — structural, not documented): the
 * fatal-vs-advisory split lives in the TYPE, so softening F1 requires deliberately editing
 * a typed dispatch, never relaxing a boolean nobody notices.
 *   - kind 'fatal'   → BAD-SIGNATURE / REPLAYED / UNVERIFIABLE-PIN: a detected attack (or a
 *     trust root we cannot consult) — hard-abort, NEVER flag- or force-bypassable.
 *   - kind 'expired' → the ONLY outcome the P3d `update.enforceFreshnessExpiry` flag will
 *     gate (F2's availability calibration). The flag governs EXPIRY alone — P5 asserts a
 *     REPLAYED freshness aborts with the flag OFF.
 *   - kind 'ok' / 'absent' → advisory reporting.
 */
type FreshnessOutcome =
    | { kind: 'fatal'; status: 'BAD-SIGNATURE' | 'REPLAYED' | 'unverifiable'; latest?: string; detail: string }
    | { kind: 'expired'; status: 'expired'; latest: string; detail: string }
    | { kind: 'ok'; status: 'ok'; latest: string; detail: string }
    | { kind: 'absent'; status: 'absent'; latest?: undefined; detail: string };

/** Verify freshness.json from the mirror's default branch against the pinned root
 *  (ssh-keygen -Y verify, detached .sig). Expiry ADVISORY today (the enforceFreshnessExpiry
 *  flag, default off, arms hard-expiry at the lattice — SEC-12 part 3). */
function freshnessVerdict(): FreshnessOutcome {
    let raw: Buffer, sig: Buffer;
    try {
        raw = gitRaw(['show', 'origin/main:freshness.json']);
        sig = gitRaw(['show', 'origin/main:freshness.json.sig']);
    } catch {
        return { kind: 'absent', status: 'absent', detail: 'no freshness metadata published yet — SEC-12 detection inactive until the first ceremony-signed freshness' };
    }
    const pin = path.join(HOME_DIR, 'credentials', 'release-allowed-signers');
    if (!fs.existsSync(pin)) {
        // Fail-closed by TYPE (was advisory-shaped in P3b; unreachable in apply — step 0's tag
        // verify already aborts on a missing pin — but the type now says what the text said).
        return { kind: 'fatal', status: 'unverifiable', detail: 'pinned root missing — fail-closed (no freshness trust without the pin)' };
    }
    const tmp = fs.mkdtempSync('/tmp/han-fresh-');
    try {
        fs.writeFileSync(path.join(tmp, 'f.json'), raw);
        fs.writeFileSync(path.join(tmp, 'f.json.sig'), sig);
        execFileSync('ssh-keygen', ['-Y', 'verify', '-f', pin, '-I', 'han-release', '-n', 'file',
            '-s', path.join(tmp, 'f.json.sig')], { input: raw, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
        return { kind: 'fatal', status: 'BAD-SIGNATURE', detail: 'freshness.json signature FAILED against the pinned root — treat the mirror as hostile' };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    const f = JSON.parse(raw.toString()) as Freshness;
    // F1 (Tenshi) + the bootstrap floor (Jim): the high-water is max(ledger-high, DEPLOYED-from-git) —
    // a garden cannot legitimately be told the newest release is older than the version it runs.
    const floor = [ledgerHighWater(), deployedVersionFromGit()].filter(Boolean).sort(cmpTag).pop() ?? null;
    if (floor && cmpTag(f.latest_version, floor) < 0) {
        return { kind: 'fatal', status: 'REPLAYED', latest: f.latest_version, detail: `freshness latest_version ${f.latest_version} is BELOW the high-water ${floor} — a stale-but-signed freshness is a replay of the detector (F1); refused` };
    }
    const expired = new Date(f.expires_at).getTime() < Date.now();
    if (expired) {
        return { kind: 'expired', status: 'expired', latest: f.latest_version, detail: `latest=${f.latest_version} released=${f.released_at} expires=${f.expires_at} (EXPIRED — mirror may be stale/withholding; advisory while the flag is off; F2: arming is a security-vs-availability calibration)` };
    }
    return { kind: 'ok', status: 'ok', latest: f.latest_version, detail: `latest=${f.latest_version} released=${f.released_at} expires=${f.expires_at}` };
}

function stepCheck(): void {
    log('--check (the standing freeze detector — the withholding-in-place interim per SEC-12)');
    try { git(['fetch', '--tags', '--quiet', 'origin']); } catch { log('⚠ fetch failed — reporting from local state'); }
    const deployed = deployedVersionFromGit();
    log(`deployed (git state): ${deployed ?? '(no release tag — running from tip)'}`);
    const newest = newestSignedTag();
    log(`newest SIGNED tag on the mirror: ${newest ? `${newest.tag} → ${newest.hash.slice(0, 12)}` : '(none verifiable)'}`);
    const f = freshnessVerdict();
    log(`freshness: ${f.status} — ${f.detail}`);
    const quarantined = quarantinedTags();
    if (newest && quarantined.has(newest.tag)) {
        log(`⚠ the newest signed tag ${newest.tag} is QUARANTINED — rolled back on ${quarantined.get(newest.tag)}; a re-apply needs --force-quarantined ${newest.tag} (P3d, Tenshi finding-1)`);
    } else if (deployed && newest && cmpTag(newest.tag, deployed) > 0) log(`⇒ you are BEHIND: ${deployed} → ${newest.tag} available`);
    else if (newest) log('⇒ up to date with the newest signed release the mirror offers');
    if (quarantined.size) log(`quarantined tag(s): ${[...quarantined.keys()].join(', ')}`);
    // The staleness heuristic — the one detector that works against a PERFECT withholder
    // (a frozen mirror cannot fake the passage of time — Tenshi's three-layer shape).
    if (deployed) {
        const m = deployed.match(/^v(\d{4})\.(\d{2})\.(\d{2})/);
        if (m) {
            const days = Math.floor((Date.now() - new Date(`${m[1]}-${m[2]}-${m[3]}`).getTime()) / 86_400_000);
            log(`staleness: deployed release is ${days} day(s) old — judge against the garden's real (irregular) cadence`);
        }
    }
    ledgerAppend({ op: 'check', deployed, newest: newest?.tag ?? null, freshness: f.status, freshness_latest: f.latest ?? null });
}

// ── 2b: the dangling-swap gate + directed recovery (gates 1/3/4; Tenshi B/C) ───────────────
async function stepRecover(): Promise<void> {
    const { checkDanglingSwap, recoverDanglingSwap } = await import('../src/server/lib/state-swap');
    const st = checkDanglingSwap(LEDGER);
    if (st.state === 'clean' || st.state === 'genesis-clean') { log(`--recover: ${st.detail}`); return; }
    if (st.state === 'corrupt') fail(`--recover cannot proceed: ${st.detail} — curate the ledger by hand (fail-closed; a corrupt trust-root journal wants a human)`);
    const direction = recoverDanglingSwap(HOME_DIR, path.join(HOME_DIR, 'gradient.db'), LEDGER, log);
    log(`RECOVERY COMPLETE — ${direction}. Wakes are unblocked; re-run the update whenever ready.`);
}

// ── the apply flow (steps 2–8) ─────────────────────────────────────────────────────────────
async function stepApply(): Promise<void> {
    // 2b pre-gate: a new update never starts over a dangling swap (gate 3, the tool-side half;
    // the boot half lives in verify-identity-files.ts). Jim's polarities: absent ledger =
    // genesis-clean = proceed; corrupt = HALT legibly.
    {
        const { checkDanglingSwap, sweepStaleStaging } = await import('../src/server/lib/state-swap');
        const st = checkDanglingSwap(LEDGER);
        if (st.state === 'dangling') fail(`${st.detail}`);
        if (st.state === 'corrupt') fail(`${st.detail} — curate the ledger by hand (fail-closed)`);
        // THE SCHEDULE (gate 6 + Casey's disposal-schedule form): stale staging archives now,
        // in advance, by the written rule — never by custodial discretion at a full disk.
        sweepStaleStaging(HOME_DIR, null, log);
    }
    // step 0 — resolve + verify
    try { git(['fetch', '--tags', '--quiet', 'origin']); } catch { if (!SCRATCH) fail('cannot fetch the mirror'); }
    const deployed = deployedVersionFromGit();
    const target = ROLLBACK ?? TO ?? newestSignedTag()?.tag ?? null;
    if (!target) fail('no verifiable signed release tag found on the mirror');
    const hash = (() => {
        try {
            return execFileSync(path.join(hanRepo(), 'scripts', 'verify-release-tag.sh'), [target!, REPO],
                { env: { ...process.env, HAN_HOME: HOME_DIR }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
        } catch { return fail(`tag '${target}' failed signature verification against the pinned root`); }
    })();
    // Downgrade rejection at the channel layer — the floor is GIT STATE (deployed), never the
    // ledger alone; --rollback is the ONLY lawful reverse (explicit, still signature-verified).
    if (!ROLLBACK && deployed && cmpTag(target!, deployed) <= 0) {
        fail(`target ${target} does not order above deployed ${deployed} — downgrade refused (a validly-signed OLD tag is a replay weapon); explicit --rollback is the only lawful reverse`);
    }
    // P3d QUARANTINE gate (Tenshi finding-1): a forward apply of a tag a rollback abandoned is
    // refused — it is genuinely signed and may be the newest, so nothing else stops the operator
    // (or an "update to newest" habit) walking back into the known-bad release. Only an explicit
    // per-tag --force-quarantined <tag> overrides. (A --rollback is exempt: it IS the lawful
    // reverse, and re-quarantines below.)
    const quarantined = quarantinedTags();
    if (!ROLLBACK && quarantined.has(target!) && FORCE_QUARANTINED !== target) {
        fail(`target ${target} was ROLLED BACK on ${quarantined.get(target!)} — refusing to re-apply a quarantined (known-bad) release; ` +
            `re-apply deliberately with --force-quarantined ${target} if that rollback is no longer valid`);
    }
    // Manual rollback quarantines the version it abandons (the bad one being left behind).
    // Timing note (Jim+Tenshi P3d audit): this fires at apply-start, BEFORE the rollback work
    // completes — so if the rollback itself then failed, the still-deployed tag stays
    // quarantined. That is the SAFE fail-direction (one deliberate --force-quarantined cures it),
    // never the dangerous one (a bad tag left un-quarantined). And the override is one-shot by
    // construction: --force-quarantined clears the mark, but a re-failed apply re-quarantines it
    // from its own apply-start — a single deliberate act, never a standing whitelist.
    if (ROLLBACK && deployed && deployed !== target) {
        ledgerAppend({ op: 'quarantine', tag: deployed, reason: `rolled back to ${target}` });
        log(`quarantined ${deployed} (rolled back FROM it) — a future forward-apply of it needs --force-quarantined`);
    }
    // A deliberate re-apply of a quarantined tag clears its quarantine (the operator has ruled).
    if (FORCE_QUARANTINED && FORCE_QUARANTINED === target && quarantined.has(target!)) {
        ledgerAppend({ op: 'unquarantine', tag: target, reason: 'operator --force-quarantined re-apply' });
        log(`⚠ FORCED past quarantine on ${target} (operator override) — quarantine cleared`);
    }
    const f = freshnessVerdict();
    // The typed dispatch (Tenshi #2): fatality is IN THE TYPE. The 2b enforceFreshnessExpiry
    // flag gates ONLY kind==='expired' — it can never reach a 'fatal' outcome by construction
    // (P5 standing case: REPLAYED aborts with the flag OFF — the flag governs expiry alone).
    if (f.kind === 'fatal') fail(`freshness: ${f.detail}`);
    if (f.kind === 'expired' && !SCRATCH) {
        // 2b (SEC-12 part 3, armed): default-OFF manifest flag; when ON, a genuinely-expired
        // freshness aborts — and the message names the FLAG and the CADENCE cause, so an F2
        // self-DoS (a healthy-but-quiet garden outrunning its own max-age) is legible and
        // curable in one read (Jim's rider b).
        const { updateConfig } = await import('../src/server/lib/garden-manifest');
        const uc = updateConfig();
        if (uc.enforceFreshnessExpiry) {
            fail(`freshness EXPIRED and update.enforceFreshnessExpiry=true — ${f.detail}. ` +
                `Either the mirror is stale/withholding (the SEC-12 attack this flag exists to catch) OR the release ` +
                `cadence outran freshnessMaxAgeDays=${uc.freshnessMaxAgeDays} (F2 — a healthy-but-quiet garden self-DoS). ` +
                `If the garden is simply quiet: publish a fresh freshness.json, or raise update.freshnessMaxAgeDays, ` +
                `or set update.enforceFreshnessExpiry=false in garden-manifest.json.`);
        }
    }
    log(`freshness: ${f.status} — ${f.detail}`);
    log(`target ${target} verified → ${hash}`);
    const priorHash = git(['rev-parse', 'HEAD']);
    ledgerAppend({ op: 'apply-start', target, hash, prior: priorHash, deployed, freshness: f.status, freshness_latest: f.latest ?? null, rollback: !!ROLLBACK });

    const applyStartMs = Date.now(); // run-scoping for rollback's DB-restore (see rollback())
    // 2b: the run token — names this run's staging dir, tree pre-copies and swap journal id.
    // Derived FROM applyStartMs so the rollback's run-scope filter (`t >= applyStartMs`)
    // includes the pre-copies this token names (the P3c preCopyRunMs lesson, kept true).
    const runTs = new Date(applyStartMs).toISOString().replace(/[:.]/g, '-');

    // steps 2–3 — quiesce + drain + stop + fuser-zero
    if (SCRATCH) {
        log('scratch: quiesce/drain/stop legs SKIPPED (no live garden) — DISCLOSED test-only');
    } else {
        const { gardenServiceSet } = await import('../src/server/lib/service-enumerator');
        const { drainSpokes } = await import('../src/server/lib/spoke-drain');
        const gm = await import('../src/server/lib/garden-manifest');
        const owner = gm.loadResidents().find((a: { slug: string }) => gm.runsSupervisorCycle(a.slug));
        const port = owner ? gm.allocationFor(owner.slug)?.port : undefined;
        if (!owner || !port) fail('no supervisor owner resolvable from the manifest');
        execSync(`curl -sk -X POST https://localhost:${port}/api/supervisor/pause -H "Content-Type: application/json" -d '{"paused":true}'`);
        log(`supervisor paused at its owner (${owner.slug}:${port})`);
        const drain = await drainSpokes(10 * 60_000);
        if (!drain.ok) fail(`drain FAILED — still busy: ${drain.busy.join(', ')} (the drain succeeds or the update aborts; there is no force)`);
        log(`drained: ${drain.watched.length} sessions still for 2 polls (${Math.round(drain.waitedMs / 1000)}s)`);
        const svc = gardenServiceSet();
        execSync(`systemctl --user stop ${svc.allSystemdUnits.join(' ')}`);
        for (const s of svc.agentServers) execSync(`"${path.join(hanRepo(), 'scripts', 'restart-agent-server.sh')}" ${s} --stop-only 2>/dev/null || true`);
        log(`stopped: ${svc.allSystemdUnits.length} units + ${svc.agentServers.length} servers signalled`);
        // THE INVARIANT (Tenshi A1, verbatim by ruling): the enumerator is CONVENIENCE; fuser-zero
        // is the SAFETY. Drain proves minds are AT REST; fuser proves the DB is RELEASED — idle
        // chrome is not fd-release. A future "optimisation" that trusts the enumerated set and
        // drops this check silently re-opens SEC-11.
        const dbLive = path.join(HOME_DIR, 'gradient.db');
        let holders: string | null = null;
        try { holders = execSync(`fuser ${dbLive} 2>/dev/null`).toString().trim(); }
        catch (e) { const st = (e as { status?: unknown }).status; if (typeof st === 'number' && st > 0) holders = ''; }
        if (holders === null) fail('cannot verify open handles (fuser unavailable) — fail-closed');
        if (holders) fail(`live DB has OPEN HANDLES (pids:${holders}) — a swap under open fds split-brains writers (SEC-11)`);
        log('fuser-zero: the DB is RELEASED');
    }

    // ── Ring-2 PRE-SNAPSHOT (P3c): authored-identity content, captured while the garden is
    // frozen (post-drain, pre-mutation) — the baseline the post-migrate compare reads against.
    // Runs whenever THIS home carries a garden manifest AND the process env agrees (hanHome()
    // === HOME_DIR — always true live; true in scratch when the harness sets HAN_HOME, which
    // is how the E2E drives it). Otherwise disclosed-skipped (a bare scratch world has no
    // residents to protect).
    const ring2Enabled = fs.existsSync(path.join(HOME_DIR, 'garden-manifest.json'))
        && path.resolve(hanHome()) === path.resolve(HOME_DIR);
    const preSnapshot = await (async () => {
        if (!ring2Enabled) { log('Ring-2 snapshot: SKIPPED — no garden manifest at this home (DISCLOSED; scratch worlds without residents)'); return null; }
        const { snapshotAuthoredAt } = await import('../src/server/lib/ring2-ceremony');
        const gm = await import('../src/server/lib/garden-manifest');
        // Dirs from the operator-authored ALLOCATION (jim-at-root safe — the S195 lesson);
        // fractal is uniform `memory/fractal/<slug>` under THIS home (agent-registry's HAN_DIR
        // is homedir-hard, unusable for scratch — observed, flagged, not changed here).
        const residents = gm.loadResidents().map((a: { slug: string; identitySection?: string }) => ({
            slug: a.slug,
            memoryDir: gm.allocationFor(a.slug)?.memoryDir ?? path.join(HOME_DIR, 'memory', a.slug),
            fractalDir: path.join(HOME_DIR, 'memory', 'fractal', a.slug),
            identitySection: a.identitySection ?? null,
        }));
        const snap = snapshotAuthoredAt(residents);
        log(`Ring-2 snapshot: ${snap.artefacts.length} authored artefacts across ${residents.length} resident(s)`);
        return { snap, residents };
    })();

    // step 4 — checkout by hash (never a ref) + npm ci iff the lockfile moved
    const lockBefore = (() => { try { return git(['rev-parse', 'HEAD:package-lock.json']); } catch { return ''; } })();
    git(['checkout', '--quiet', hash]);
    log(`checked out ${hash} (by hash — never a ref)`);
    const lockAfter = (() => { try { return git(['rev-parse', 'HEAD:package-lock.json']); } catch { return ''; } })();
    if (lockBefore !== lockAfter) {
        log('lockfile moved → npm ci (the signed tree pins the dependency set; Tenshi #3 residual: pinned install-scripts still execute — vendor/prebuild is the named cure)');
        if (!SCRATCH) execSync('npm ci', { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit' });
        else log('scratch: npm ci SKIPPED — DISCLOSED');
    } else log('lockfile unchanged → npm ci skipped');

    // ── Ring-2 pre-flight (P3c, DEC-102): read the pending migrations' AUTHORSHIP declarations
    // from the tree that will actually run — the NEW tree, post-checkout (the deployed tree's
    // migrations are not the ones step 5 executes). The shared loader (lib/migration-loader)
    // enforces the same contract han-migrate enforces — touchesState ⇒ a valid stateChangeKind —
    // so the ceremony can never meet an untyped change.
    // 2b: this is ALSO the move-set's authoritative source (Tenshi A) — the declarations come
    // from the checked-out SIGNED tree, so deriving the swap's move-set here (and only here)
    // is what makes staging-manifest.json a receipt rather than an authority. The standing
    // question, answered (Casey's Henry VIII discipline): who can write the thing this reads?
    // — only a release signer.
    const declarations = await (async () => {
        try {
            const { pendingMigrations, currentSchemaVersion } = await import('../src/server/lib/migration-loader');
            const { EXPECTED_SCHEMA_VERSION } = await import('../src/server/lib/state-schema');
            const current = currentSchemaVersion(path.join(HOME_DIR, 'gradient.db'));
            return pendingMigrations(path.join(REPO, 'migrations'), current, EXPECTED_SCHEMA_VERSION)
                .filter((m) => m.touchesState && m.touchesState.length > 0)
                .map((m) => ({ migrationId: m.id, description: m.description, touchesState: m.touchesState!, stateChangeKind: m.stateChangeKind! }));
        } catch (e) { await rollback(priorHash, `Ring-2 pre-flight failed: ${(e as Error).message}`, applyStartMs); return null; }
    })();
    if (declarations === null) return;
    // 2b (the lawful door, Option A): a state-touching run STAGES — han-migrate --stage-only
    // copies the DB + declared trees, migrates the COPIES, verifies, and stops. The ceremony
    // inspects the staged changes; the swap is the ring's last act. A DB-only run keeps
    // today's --apply path byte-identical.
    const moveSet = [...new Set(declarations.flatMap((d) => d.touchesState))];
    let stagingDir: string | null = null;
    if (declarations.length > 0) {
        const { assertStagingNotNested } = await import('../src/server/lib/state-swap');
        stagingDir = path.join(HOME_DIR, 'staging', `update-${runTs}`);
        // gate 7b: a staging dir nested inside a declared tree would swap itself — refuse legibly.
        const nested = assertStagingNotNested(stagingDir, moveSet, HOME_DIR);
        if (nested) { await rollback(priorHash, nested, applyStartMs); return; }
        // gate 6: staging holds cleartext identity copies — an exposure window, not housekeeping.
        // 0700 explicitly (mkdir's mode is umask-subject). Honesty (Tenshi E): 0700 is an
        // OTHER-user control on a SAME-user threat model — the real mitigations are the short
        // window and that staging duplicates an already-same-user-readable exposure.
        fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
        fs.chmodSync(stagingDir, 0o700);
    }

    // step 5 — migrate (every han-migrate gate live: downgrade axes, umask, checkpoint, fd-guard,
    // sidecars). 2b: --stage-only when authored state is declared; --apply (unchanged) when not.
    try {
        execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
            [path.join(REPO, 'scripts', 'han-migrate.ts'),
             ...(stagingDir ? ['--stage-only', stagingDir] : ['--apply']),
             ...(SCRATCH ? ['--force', '--skip-smoke'] : [])],
            { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit',
              env: { ...process.env, HAN_HOME: HOME_DIR, HAN_DB_PATH: path.join(HOME_DIR, 'gradient.db'), HAN_REPO: REPO, NODE_PATH: path.join(REPO, 'src', 'server', 'node_modules') } });
    } catch {
        if (stagingDir) { const { discardStaging } = await import('../src/server/lib/state-swap'); discardStaging(stagingDir, HOME_DIR, 'migrate-failed', log); }
        await rollback(priorHash, 'han-migrate failed', applyStartMs); return;
    }

    // ── step 6 — DEC-102 RING 2: the AUTHORSHIP SPLIT + semantic-diff ceremony (P3c+2b),
    // INSIDE the quiesce. 6a-live: the safety NET — the LIVE authored identity must be
    // byte-unchanged through the window regardless of mode (with 2b's staging, NOTHING
    // lawfully writes live before the swap; any live delta = a rogue writer → restore+abort).
    // 6a-staged (2b): the ceremony proper — pre=LIVE, post=STAGED; the gardener's ring
    // approves the staged changes, and approval IS the swap trigger (DEC-102 by construction).
    // 6b: template-GENERATED files auto-re-sign, pre/post hashes ledgered UNCONDITIONALLY.
    if (stagingDir && !preSnapshot) {
        // A declared-state migration with no Ring-2 residents to ceremony over has no lawful
        // approver — fail-closed (a bare scratch world without a manifest cannot ring).
        const { discardStaging } = await import('../src/server/lib/state-swap');
        discardStaging(stagingDir, HOME_DIR, 'no-ring2-home', log);
        await rollback(priorHash, 'declared-state migration but no garden manifest at this home — the Ring-2 ceremony has no residents to protect and no gardener to ring (fail-closed)', applyStartMs);
        return;
    }
    if (preSnapshot) {
        const r2 = await import('../src/server/lib/ring2-ceremony');
        const swap = await import('../src/server/lib/state-swap');
        // 6a-live — the net (all modes): live authored identity must not have moved.
        const postLive = r2.snapshotAuthoredAt(preSnapshot.residents);
        const liveDeltas = r2.compareAuthored(preSnapshot.snap, postLive);
        if (liveDeltas.length > 0) {
            ledgerAppend({ op: 'ring2-authored', verdict: 'ABORT-undeclared', changed: liveDeltas.map((d) => `${d.resident}:${d.name}`) });
            // restore the authored files FROM THE SNAPSHOT before the rollback — without this
            // the poison survives on disk and the next wake's auto-resign would launder it.
            for (const note of r2.restoreAuthored(liveDeltas)) { log(`Ring-2 restore: ${note}`); ledgerAppend({ op: 'ring2-restore', note }); }
            if (stagingDir) swap.discardStaging(stagingDir, HOME_DIR, 'live-mutated-in-window', log);
            await rollback(priorHash, `UNDECLARED live authored-identity change during the update window (DEC-102 Ring 2): ${liveDeltas.map((d) => `${d.resident}:${d.name}`).join(', ')}`, applyStartMs);
            return;
        }
        log(`Ring-2 6a: live authored identity UNCHANGED through the window (${preSnapshot.snap.artefacts.length} artefacts verified)`);
        ledgerAppend({ op: 'ring2-authored', verdict: 'unchanged', artefacts: preSnapshot.snap.artefacts.length });

        // 6a-staged (2b) — the ceremony over pre=LIVE / post=STAGED, then the approved swap.
        if (stagingDir) {
            const { EXPECTED_SCHEMA_VERSION } = await import('../src/server/lib/state-schema');
            // The staged post-view: live snapshot re-read through staging for every artefact
            // whose path falls under a declared tree (the rest are live-and-unchanged, proven
            // by the net above). Artefact granularity, no ring2-ceremony.ts change needed.
            const postStaged = r2.snapshotAuthoredAt(preSnapshot.residents);
            const sha256hex = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
            for (const a of postStaged.artefacts) {
                if (!a.absPath) continue;
                const rel = path.relative(HOME_DIR, a.absPath);
                if (!moveSet.some((t) => rel === t || rel.startsWith(t + path.sep))) continue;
                let content: string | null = null;
                try { content = fs.readFileSync(path.join(stagingDir, rel), 'utf8'); } catch { /* absent in staging */ }
                a.content = content; a.sha256 = content === null ? null : sha256hex(content);
            }
            const stagedDeltas = r2.compareAuthored(preSnapshot.snap, postStaged);
            // ── P5 ENUMERATION-SEAM FIX (Tenshi mrnd1cqj, Jim GREEN mrndq9k5): the verdict must
            // see the WHOLE declared-tree move-set, not the fixed IDENTITY_FILES enumeration —
            // else a "content-preserving" migration rides non-identity poison (working-memory,
            // the gradient's own c0/c1 sources) to live through the auto-pass, unrendered.
            // The exclusion set is the EXACT rel-paths the ceremony already rendered, from the
            // snapshot artefacts' real absPaths (fold-1: never basenames — a fractal identity.md
            // one directory deeper is NOT excluded). Computed at VERDICT time (pre-migration
            // live vs post-migration staged); captureSwapHashes below stays the ring→swap
            // TOCTOU integrity leg — different purpose, deliberately not conflated.
            const renderedRels = new Set<string>();
            for (const a of [...preSnapshot.snap.artefacts, ...postStaged.artefacts]) {
                if (a.absPath) renderedRels.add(path.relative(HOME_DIR, a.absPath));
            }
            const nonIdentity: import('../src/server/lib/ring2-ceremony').AuthoredDelta[] = [];
            for (const tree of moveSet) {
                const treeDeltas = swap.declaredTreeFileDeltas(stagingDir, HOME_DIR, tree, renderedRels);
                if (treeDeltas.length) nonIdentity.push(...r2.nonIdentityTreeDeltas(tree, treeDeltas));
            }
            if (nonIdentity.length) log(`Ring-2 6a-staged: ${nonIdentity.length} NON-IDENTITY file(s) under declared tree(s) differ — escalating to the ceremony (P5: rendered-set == swapped-set)`);
            const mergedDeltas = [...stagedDeltas, ...nonIdentity];
            const verdict = r2.ring2Verdict(mergedDeltas, declarations);
            const plan = {
                hanHome: HOME_DIR, stagingDir, dbLive: path.join(HOME_DIR, 'gradient.db'),
                moveSet, ledgerPath: LEDGER, schemaTo: EXPECTED_SCHEMA_VERSION, ts: runTs,
            };
            // Tenshi D: the swap-time quiesce re-assert — the real check live, a disclosed
            // no-op in scratch (no systemd there to ask).
            const assertQuiesced = SCRATCH ? (() => null) : ((): string | null => {
                try {
                    const active = execSync('systemctl --user is-active wm-sensor.service || true').toString().trim();
                    if (active === 'active') return 'wm-sensor is ACTIVE (it writes the very files being swapped — MNT-057 is the live proof)';
                } catch { return 'cannot query wm-sensor state (fail-closed)'; }
                // Jim's land-note 1 (mrmz0xyd): a missing signals/ dir must read as un-verifiable
                // (fail-closed message), not throw raw into the swap-failure path.
                try {
                    const locks = fs.readdirSync(path.join(HOME_DIR, 'signals')).filter((f) => f.startsWith('wm-sensor-') && f.endsWith('-active'));
                    return locks.length ? `rotation lock(s) held: ${locks.join(', ')}` : null;
                } catch { return 'cannot read the signals dir for rotation locks (fail-closed)'; }
            });
            let approvedDigest: string | null = null;
            if (verdict.kind === 'unchanged') {
                // The ONLY auto-pass (DEC-102, semantics NARROWED by the P5 fix): it now fires
                // only when the WHOLE declared tree is byte-identical staged↔live (identity AND
                // non-identity files — the merged delta set is empty). The swap still moves the
                // DB, governed by the schema/verify/DB-rehash legs.
                log('Ring-2 6a-staged: declared migration, whole declared tree(s) byte-identical — content-preserving auto-pass (DEC-102, P5-narrowed)');
                ledgerAppend({ op: 'ring2-staged', verdict: 'unchanged-autopass', declarations: declarations.map((d) => d.migrationId) });
            } else {
                // declarations.length > 0 ⇒ verdict.kind === 'ceremony' (abort-undeclared is
                // structurally unreachable here; the undeclared class is the net above + the
                // move-set wall inside executeSwap).
                const v = verdict as { kind: 'ceremony'; deltas: import('../src/server/lib/ring2-ceremony').AuthoredDelta[]; redFlag: boolean };
                const doc = r2.renderCeremonyDocument(v.deltas, declarations, v.redFlag);
                ledgerAppend({ op: 'ring2-ceremony-open', digest: doc.digest, redFlag: v.redFlag, changed: v.deltas.map((d) => `${d.resident}:${d.name}`), findings: doc.findings.length });
                const decision = await r2.ceremonyDecision(doc, { signalsDir: path.join(HOME_DIR, 'signals') });
                ledgerAppend({ op: 'ring2-ceremony-verdict', digest: doc.digest, decision });
                if (decision !== 'approved') {
                    // Decline: NOTHING was swapped — live is untouched by construction; the
                    // whole "rollback" is discard-staging + prior checkout (Option A's gift).
                    swap.discardStaging(stagingDir, HOME_DIR, 'ceremony-declined', log);
                    await rollback(priorHash, `ceremony DECLINED by the gardener (digest ${doc.digest.slice(0, 12)}) — nothing was swapped; the post stays re-deliverable`, applyStartMs);
                    return;
                }
                approvedDigest = doc.digest;
                log(`Ring-2 ceremony APPROVED (digest ${doc.digest.slice(0, 12)}) — the ring IS the swap trigger`);
            }
            // Gate 2's baseline: hashes captured NOW — after the rendering/approval, before the
            // swap — so nothing can touch either side between the ring and the renames.
            const atRender = swap.captureSwapHashes(plan);
            try {
                swap.executeSwap(plan, atRender, { assertQuiesced }, log);
                ledgerAppend({ op: 'state-swap-complete', swapId: `swap-${runTs}`, approvedDigest, trees: moveSet.length });
            } catch (e) {
                // A throw BEFORE the first rename = clean abort. A throw after = dangling
                // journal → run the directed recovery HERE (gate 3's tool-side half), so the
                // garden is whole before the rollback restarts anything.
                log(`swap FAILED: ${(e as Error).message}`);
                const st = swap.checkDanglingSwap(LEDGER);
                if (st.state === 'dangling') {
                    try { swap.recoverDanglingSwap(HOME_DIR, plan.dbLive, LEDGER, log); }
                    catch (re) { fail(`swap failed AND recovery failed: ${(re as Error).message} — OPERATOR ATTENTION (han update --recover after curing the cause)`); }
                }
                swap.discardStaging(stagingDir, HOME_DIR, 'swap-failed', log);
                await rollback(priorHash, `state swap failed: ${(e as Error).message}`, applyStartMs, runTs);
                return;
            }
        }
    } else log('Ring-2 6a: SKIPPED — no snapshot (DISCLOSED above)');

    // 6b — the GENERATED class: regenerate + auto-re-sign, pre/post hashes ledgered per file.
    if (SCRATCH) log('scratch: re-sign chain SKIPPED — DISCLOSED');
    else {
        try {
            const gm = await import('../src/server/lib/garden-manifest');
            const { agentsDir } = await import('../src/server/lib/paths');
            const sha = (p: string): string | null => {
                try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
            };
            for (const a of gm.loadResidents().filter((r: { active?: boolean }) => r.active)) {
                const dir = path.join(agentsDir(), a.displayName);
                const generated = [path.join(dir, 'CLAUDE.md'), path.join(dir, '.mcp.json')];
                const pre = generated.map(sha);
                execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
                    [path.join(REPO, 'scripts', 'generate-agent-claude-md.ts'), a.slug],
                    { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit' });
                execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
                    [path.join(REPO, 'scripts', 'sign-identity-files.ts'), `--agent=${a.slug}`],
                    { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit' });
                generated.forEach((g, i) => {
                    const postH = sha(g);
                    ledgerAppend({ op: 'ring2-generated-resign', resident: a.slug, file: path.basename(g), pre: pre[i], post: postH, changed: pre[i] !== postH });
                });
            }
        } catch { await rollback(priorHash, 're-sign chain failed', applyStartMs, runTs); return; }
    }

    // step 7 — restart + health
    if (SCRATCH) { log('scratch: restart/health legs SKIPPED — DISCLOSED'); }
    else {
        execSync(`bash ${path.join(REPO, 'scripts', 'install-restart-hooks.sh')}`, { stdio: 'inherit' }); // A2's update-time re-materialise
        execSync(`bash ${path.join(REPO, 'scripts', 'restart-all-services.sh')} 2>/dev/null || true`, { stdio: 'inherit' });
        const healthy = await healthGate();
        if (!healthy) { await rollback(priorHash, 'health gate failed', applyStartMs, runTs); return; }
    }
    ledgerAppend({ op: 'apply-done', target, hash, freshness_latest: f.latest ?? null });
    log(`UPDATE COMPLETE → ${target} (${hash.slice(0, 12)})`);
}

async function healthGate(): Promise<boolean> {
    const gm = await import('../src/server/lib/garden-manifest');
    for (const a of gm.loadResidents().filter((r: { active?: boolean }) => r.active)) {
        const port = gm.allocationFor(a.slug)?.port;
        if (!port) continue;
        try {
            const code = execSync(`curl -sk -o /dev/null -w '%{http_code}' --retry 5 --retry-delay 3 https://localhost:${port}/api/analytics`).toString().trim();
            if (code !== '200') { log(`health: ${a.slug}:${port} → ${code}`); return false; }
        } catch { log(`health: ${a.slug}:${port} unreachable`); return false; }
    }
    log('health gate: all resident servers 200');
    return true;
}

/** step 8 — rollback: prior hash → DB pre-copy restore → RE-SIGN LAST + IDEMPOTENT → restart.
 *
 *  RUN-SCOPED RESTORE (P3c fix, declared for audit): restore ONLY a pre-copy CREATED BY THIS
 *  RUN (mtime ≥ applyStartMs). The P3b form restored the newest pre-copy unconditionally —
 *  but han-migrate creates its pre-copy only AT THE SWAP, so an abort BEFORE the swap (migrate
 *  failed early; the new Ring-2 pre-flight refusal) left the live DB intact while a pre-copy
 *  from a PREVIOUS successful update still sat newest on disk: restoring it would have
 *  silently regressed the garden's memory to that older moment. (The displaced live file was
 *  kept per DEC-069, so recoverable — but a garden quietly booting on a stale DB is exactly
 *  the class this tool exists to prevent.) No same-run pre-copy = the swap never happened =
 *  the live DB is already correct. */
async function rollback(priorHash: string, why: string, applyStartMs: number, runTs?: string): Promise<void> {
    log(`ROLLBACK (${why})`);
    ledgerAppend({ op: 'rollback-start', prior: priorHash, why });
    // 2b: if THIS RUN's state swap completed (or partially ran) before the failure, restore the
    // swapped trees from their verified pre-copies first — the state half of the run-scoped
    // restore. Verified against the journal's recorded render-time hashes (gate 4); a tree
    // whose pre-copy fails verification HALTs inside the helper rather than restore blind.
    if (runTs) {
        try {
            const { rollbackSwappedTrees } = await import('../src/server/lib/state-swap');
            for (const note of rollbackSwappedTrees(HOME_DIR, LEDGER, `swap-${runTs}`, log)) ledgerAppend({ op: 'rollback-tree', note });
        } catch (e) { fail(`tree rollback FAILED: ${(e as Error).message} — OPERATOR ATTENTION (pre-copies are on disk; verify by hand)`); }
    }
    // P3d QUARANTINE (Tenshi finding-1): an AUTO-rollback abandons the target it was applying —
    // quarantine it so a later forward-apply of that failed tag needs an explicit override. Read
    // the run's target from its own apply-start (a manual --rollback's forward target is exempt —
    // it's the good one; manual rollback quarantines the abandoned deployed version up in stepApply).
    try {
        const lines = fs.readFileSync(LEDGER, 'utf8').trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const e = JSON.parse(lines[i]);
            if (e.op === 'apply-start') { if (!e.rollback && e.target) { ledgerAppend({ op: 'quarantine', tag: e.target, reason: `auto-rollback: ${why}` }); log(`quarantined ${e.target} (its apply failed) — a re-apply needs --force-quarantined`); } break; }
        }
    } catch { /* no ledger / unreadable — the quarantine is best-effort belt on the rollback itself */ }
    git(['checkout', '--quiet', priorHash]);
    const dir = HOME_DIR;
    // Run-scoping reads the RUN TIMESTAMP han-migrate embeds in the pre-copy's NAME — never
    // the file mtime (the pre-copy is the RENAMED old live file; rename preserves the old
    // mtime, which predates this run by construction — caught live at the P3c E2E).
    const preCopyRunMs = (f: string): number | null => {
        const m = f.match(/\.pre-v\d+-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
        return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
    };
    const pres = fs.readdirSync(dir)
        .filter((f) => f.startsWith('gradient.db.pre-v') && !f.endsWith('-wal') && !f.endsWith('-shm'))
        .filter((f) => { const t = preCopyRunMs(f); return t !== null && t >= applyStartMs; })
        .sort().reverse();
    if (pres.length) {
        const live = path.join(dir, 'gradient.db');
        if (fs.existsSync(live)) fs.renameSync(live, path.join(dir, `gradient.db.rolledback-${Date.now()}`)); // keep, never delete (DEC-069)
        fs.copyFileSync(path.join(dir, pres[0]), live); fs.chmodSync(live, 0o600);
        log(`DB restored from ${pres[0]} (this run's pre-copy IS the rollback)`);
    } else log('no pre-copy FROM THIS RUN — the swap never happened; live DB already correct, left as-is');
    if (!SCRATCH) {
        // re-sign LAST and idempotent (SEC-08's non-atomicity half) — safe to re-run from any crash.
        try {
            const gm = await import('../src/server/lib/garden-manifest');
            for (const a of gm.loadResidents().filter((r: { active?: boolean }) => r.active)) {
                execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
                    [path.join(REPO, 'scripts', 'generate-agent-claude-md.ts'), a.slug], { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit' });
                execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
                    [path.join(REPO, 'scripts', 'sign-identity-files.ts'), `--agent=${a.slug}`], { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit' });
            }
        } catch { log('⚠ rollback re-sign failed — RE-RUN this rollback (idempotent by design); integrity gates will hold wakes meanwhile'); }
        execSync(`bash ${path.join(REPO, 'scripts', 'restart-all-services.sh')} 2>/dev/null || true`);
        const ok = await healthGate();
        ledgerAppend({ op: 'rollback-done', prior: priorHash, healthy: ok });
        if (!ok) fail('rollback completed but health gate still failing — OPERATOR ATTENTION REQUIRED');
    } else ledgerAppend({ op: 'rollback-done', prior: priorHash, scratch: true });
    log('ROLLBACK COMPLETE — reported loudly, never silent');
}

(async () => { if (RECOVER) await stepRecover(); else if (CHECK) stepCheck(); else await stepApply(); })();
