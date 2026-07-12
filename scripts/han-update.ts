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

// ── the apply flow (steps 2–8) ─────────────────────────────────────────────────────────────
async function stepApply(): Promise<void> {
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
    // The typed dispatch (Tenshi #2): fatality is IN THE TYPE. The P3d enforceFreshnessExpiry
    // flag gates ONLY kind==='expired' — it can never reach a 'fatal' outcome by construction.
    if (f.kind === 'fatal') fail(`freshness: ${f.detail}`);
    log(`freshness: ${f.status} — ${f.detail}`);
    log(`target ${target} verified → ${hash}`);
    const priorHash = git(['rev-parse', 'HEAD']);
    ledgerAppend({ op: 'apply-start', target, hash, prior: priorHash, deployed, freshness: f.status, freshness_latest: f.latest ?? null, rollback: !!ROLLBACK });

    const applyStartMs = Date.now(); // run-scoping for rollback's DB-restore (see rollback())

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
    // FAIL-CLOSED GUARD: the runner's state-copy leg (MigrationCtx.stateDir mechanics) lands at
    // P3d; until it exists, a state-touching migration has NO lawful way to run — abort +
    // rollback rather than let one execute with nowhere to put its changes. Remove this guard
    // when P3d wires stateDir (the ceremony below is already built for that day).
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
    if (declarations.length > 0) {
        await rollback(priorHash,
            `pending migration(s) declare touchesState (${declarations.map((d) => `#${d.migrationId}`).join(', ')}) but the runner's ` +
            `state-copy leg is not built until P3d — refusing whole (fail-closed; DEC-102 Ring 2: an authored-state ` +
            `migration must run on copies the ceremony can inspect, and that machinery does not exist yet)`, applyStartMs);
        return;
    }

    // step 5 — migrate (every han-migrate gate live: downgrade axes, umask, checkpoint, fd-guard, sidecars)
    try {
        execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
            [path.join(REPO, 'scripts', 'han-migrate.ts'), '--apply', ...(SCRATCH ? ['--force', '--skip-smoke'] : [])],
            { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit',
              env: { ...process.env, HAN_HOME: HOME_DIR, HAN_DB_PATH: path.join(HOME_DIR, 'gradient.db'), HAN_REPO: REPO, NODE_PATH: path.join(REPO, 'src', 'server', 'node_modules') } });
    } catch { await rollback(priorHash, 'han-migrate failed', applyStartMs); return; }

    // ── step 6 — DEC-102 RING 2: the AUTHORSHIP SPLIT + semantic-diff ceremony (P3c), INSIDE
    // the quiesce. 6a: AUTHORED identity — any undeclared change aborts + rolls back; a
    // declared change (touchesState, typed) triggers the ceremony: the semantic diff, the
    // designed visible freeze, the gardener's ring. 6b: template-GENERATED files auto-re-sign
    // (transitively release-signed under Ring 1) with pre/post hashes ledgered UNCONDITIONALLY
    // (detection-under-prevention). The swap already happened at step 5 for the DB — authored
    // FILES have no state-leg until P3d, so 6a today is the live safety NET (any mutation of
    // authored identity by ANY mechanism during the update window is caught here).
    if (preSnapshot) {
        const r2 = await import('../src/server/lib/ring2-ceremony');
        const post = r2.snapshotAuthoredAt(preSnapshot.residents);
        const deltas = r2.compareAuthored(preSnapshot.snap, post);
        const verdict = r2.ring2Verdict(deltas, declarations);
        if (verdict.kind === 'unchanged') {
            log(`Ring-2 6a: authored identity UNCHANGED (${preSnapshot.snap.artefacts.length} artefacts verified)`);
            ledgerAppend({ op: 'ring2-authored', verdict: 'unchanged', artefacts: preSnapshot.snap.artefacts.length });
        } else if (verdict.kind === 'abort-undeclared') {
            ledgerAppend({ op: 'ring2-authored', verdict: 'ABORT-undeclared', changed: verdict.deltas.map((d) => `${d.resident}:${d.name}`) });
            // restore the authored files FROM THE SNAPSHOT before the rollback — without this
            // the poison survives on disk and the next wake's auto-resign would launder it.
            for (const note of r2.restoreAuthored(verdict.deltas)) { log(`Ring-2 restore: ${note}`); ledgerAppend({ op: 'ring2-restore', note }); }
            await rollback(priorHash, `UNDECLARED authored-identity change (DEC-102 Ring 2): ${verdict.deltas.map((d) => `${d.resident}:${d.name}`).join(', ')}`, applyStartMs);
            return;
        } else {
            // The ceremony — unreachable until P3d's state leg (the pre-flight refuses declared
            // migrations), built and red-suite-proven for the day it opens.
            const doc = r2.renderCeremonyDocument(verdict.deltas, declarations, verdict.redFlag);
            ledgerAppend({ op: 'ring2-ceremony-open', digest: doc.digest, redFlag: verdict.redFlag, changed: verdict.deltas.map((d) => `${d.resident}:${d.name}`), findings: doc.findings.length });
            const decision = await r2.ceremonyDecision(doc, { signalsDir: path.join(HOME_DIR, 'signals') });
            ledgerAppend({ op: 'ring2-ceremony-verdict', digest: doc.digest, decision });
            if (decision !== 'approved') {
                for (const note of r2.restoreAuthored(verdict.deltas)) { log(`Ring-2 restore: ${note}`); ledgerAppend({ op: 'ring2-restore', note }); }
                await rollback(priorHash, `ceremony DECLINED by the gardener (digest ${doc.digest.slice(0, 12)}) — the post stays re-deliverable`, applyStartMs);
                return;
            }
            log(`Ring-2 ceremony APPROVED (digest ${doc.digest.slice(0, 12)}) — proceeding`);
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
        } catch { await rollback(priorHash, 're-sign chain failed', applyStartMs); return; }
    }

    // step 7 — restart + health
    if (SCRATCH) { log('scratch: restart/health legs SKIPPED — DISCLOSED'); }
    else {
        execSync(`bash ${path.join(REPO, 'scripts', 'install-restart-hooks.sh')}`, { stdio: 'inherit' }); // A2's update-time re-materialise
        execSync(`bash ${path.join(REPO, 'scripts', 'restart-all-services.sh')} 2>/dev/null || true`, { stdio: 'inherit' });
        const healthy = await healthGate();
        if (!healthy) { await rollback(priorHash, 'health gate failed', applyStartMs); return; }
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
async function rollback(priorHash: string, why: string, applyStartMs: number): Promise<void> {
    log(`ROLLBACK (${why})`);
    ledgerAppend({ op: 'rollback-start', prior: priorHash, why });
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

(async () => { if (CHECK) stepCheck(); else await stepApply(); })();
