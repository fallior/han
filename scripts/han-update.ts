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
 * P3b scope: steps 0–5 + 7–8 of the ratified flow. Step 6 currently runs the whole MNT-025
 * re-sign chain (today's behaviour); the Ring-2 AUTHORSHIP SPLIT + semantic-diff ceremony
 * lands at P3c and replaces the marked block below. There is NO --force flag on this tool,
 * by design (SEC-04): every gate passes or the update aborts whole.
 *
 * --scratch <dir> is TEST-ONLY (documented, like han-migrate's --skip-smoke): points the
 * tool at a scratch repo/garden and swaps the service/health legs for scratch-honest
 * no-ops so the flow can be end-to-end proven without touching the live garden.
 */
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { hanHome, hanRepo } from '../src/server/lib/paths';

const argvRest = process.argv.slice(2);
const CHECK = argvRest.includes('--check');
const TO = argvRest.includes('--to') ? argvRest[argvRest.indexOf('--to') + 1] : null;
const ROLLBACK = argvRest.includes('--rollback') ? argvRest[argvRest.indexOf('--rollback') + 1] : null;
const SCRATCH = argvRest.includes('--scratch') ? argvRest[argvRest.indexOf('--scratch') + 1] : null;

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
/** Verify freshness.json from the mirror's default branch against the pinned root
 *  (ssh-keygen -Y verify, detached .sig). ADVISORY today (the enforceFreshnessExpiry flag,
 *  default off, arms hard-expiry at the lattice — SEC-12 part 3). */
function freshnessVerdict(): { status: string; latest?: string; detail: string } {
    let raw: Buffer, sig: Buffer;
    try {
        raw = gitRaw(['show', 'origin/main:freshness.json']);
        sig = gitRaw(['show', 'origin/main:freshness.json.sig']);
    } catch {
        return { status: 'absent', detail: 'no freshness metadata published yet — SEC-12 detection inactive until the first ceremony-signed freshness' };
    }
    const pin = path.join(HOME_DIR, 'credentials', 'release-allowed-signers');
    if (!fs.existsSync(pin)) return { status: 'unverifiable', detail: 'pinned root missing — fail-closed (no freshness trust without the pin)' };
    const tmp = fs.mkdtempSync('/tmp/han-fresh-');
    try {
        fs.writeFileSync(path.join(tmp, 'f.json'), raw);
        fs.writeFileSync(path.join(tmp, 'f.json.sig'), sig);
        execFileSync('ssh-keygen', ['-Y', 'verify', '-f', pin, '-I', 'han-release', '-n', 'file',
            '-s', path.join(tmp, 'f.json.sig')], { input: raw, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
        return { status: 'BAD-SIGNATURE', detail: 'freshness.json signature FAILED against the pinned root — treat the mirror as hostile' };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    const f = JSON.parse(raw.toString()) as Freshness;
    // F1 (Tenshi) + the bootstrap floor (Jim): the high-water is max(ledger-high, DEPLOYED-from-git) —
    // a garden cannot legitimately be told the newest release is older than the version it runs.
    const floor = [ledgerHighWater(), deployedVersionFromGit()].filter(Boolean).sort(cmpTag).pop() ?? null;
    if (floor && cmpTag(f.latest_version, floor) < 0) {
        return { status: 'REPLAYED', latest: f.latest_version, detail: `freshness latest_version ${f.latest_version} is BELOW the high-water ${floor} — a stale-but-signed freshness is a replay of the detector (F1); refused` };
    }
    const expired = new Date(f.expires_at).getTime() < Date.now();
    return { status: expired ? 'expired' : 'ok', latest: f.latest_version, detail: `latest=${f.latest_version} released=${f.released_at} expires=${f.expires_at}${expired ? ' (EXPIRED — mirror may be stale/withholding; advisory while the flag is off; F2: arming is a security-vs-availability calibration)' : ''}` };
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
    if (deployed && newest && cmpTag(newest.tag, deployed) > 0) log(`⇒ you are BEHIND: ${deployed} → ${newest.tag} available`);
    else if (newest) log('⇒ up to date with the newest signed release the mirror offers');
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
    const f = freshnessVerdict();
    if (f.status === 'BAD-SIGNATURE' || f.status === 'REPLAYED') fail(`freshness: ${f.detail}`);
    log(`freshness: ${f.status} — ${f.detail}`);
    log(`target ${target} verified → ${hash}`);
    const priorHash = git(['rev-parse', 'HEAD']);
    ledgerAppend({ op: 'apply-start', target, hash, prior: priorHash, deployed, freshness: f.status, freshness_latest: f.latest ?? null, rollback: !!ROLLBACK });

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

    // step 5 — migrate (every han-migrate gate live: downgrade axes, umask, checkpoint, fd-guard, sidecars)
    try {
        execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
            [path.join(REPO, 'scripts', 'han-migrate.ts'), '--apply', ...(SCRATCH ? ['--force', '--skip-smoke'] : [])],
            { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit',
              env: { ...process.env, HAN_HOME: HOME_DIR, HAN_DB_PATH: path.join(HOME_DIR, 'gradient.db'), HAN_REPO: REPO, NODE_PATH: path.join(REPO, 'src', 'server', 'node_modules') } });
    } catch { await rollback(priorHash, 'han-migrate failed'); return; }

    // step 6 — the re-sign chain. ⚠ P3c REPLACES THIS BLOCK with the Ring-2 AUTHORSHIP SPLIT +
    // semantic-diff ceremony (DEC-102 Ring 2): template-generated auto-re-sign w/ logged diffs;
    // AUTHORED identity abort-undeclared; touchesState → the ceremony INSIDE this quiesce.
    if (SCRATCH) log('scratch: re-sign chain SKIPPED — DISCLOSED');
    else {
        try {
            const gm = await import('../src/server/lib/garden-manifest');
            for (const a of gm.loadResidents().filter((r: { active?: boolean }) => r.active)) {
                execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
                    [path.join(REPO, 'scripts', 'generate-agent-claude-md.ts'), a.slug],
                    { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit' });
                execFileSync(path.join(REPO, 'src', 'server', 'node_modules', '.bin', 'tsx'),
                    [path.join(REPO, 'scripts', 'sign-identity-files.ts'), `--agent=${a.slug}`],
                    { cwd: path.join(REPO, 'src', 'server'), stdio: 'inherit' });
            }
        } catch { await rollback(priorHash, 're-sign chain failed'); return; }
    }

    // step 7 — restart + health
    if (SCRATCH) { log('scratch: restart/health legs SKIPPED — DISCLOSED'); }
    else {
        execSync(`bash ${path.join(REPO, 'scripts', 'install-restart-hooks.sh')}`, { stdio: 'inherit' }); // A2's update-time re-materialise
        execSync(`bash ${path.join(REPO, 'scripts', 'restart-all-services.sh')} 2>/dev/null || true`, { stdio: 'inherit' });
        const healthy = await healthGate();
        if (!healthy) { await rollback(priorHash, 'health gate failed'); return; }
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

/** step 8 — rollback: prior hash → DB pre-copy restore → RE-SIGN LAST + IDEMPOTENT → restart. */
async function rollback(priorHash: string, why: string): Promise<void> {
    log(`ROLLBACK (${why})`);
    ledgerAppend({ op: 'rollback-start', prior: priorHash, why });
    git(['checkout', '--quiet', priorHash]);
    const dir = HOME_DIR;
    const pres = fs.readdirSync(dir).filter((f) => f.startsWith('gradient.db.pre-v') && !f.endsWith('-wal') && !f.endsWith('-shm')).sort().reverse();
    if (pres.length) {
        const live = path.join(dir, 'gradient.db');
        if (fs.existsSync(live)) fs.renameSync(live, path.join(dir, `gradient.db.rolledback-${Date.now()}`)); // keep, never delete (DEC-069)
        fs.copyFileSync(path.join(dir, pres[0]), live); fs.chmodSync(live, 0o600);
        log(`DB restored from ${pres[0]} (the pre-copy IS the rollback)`);
    } else log('no pre-copy found — DB left as-is (genesis-era garden)');
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
