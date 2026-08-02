// test-garden-time.ts — DEC-105 gates (store UTC, speak local).
//
// G1 (blocking, Jim's audit): buildPrompt output carries the standing local-time
//    orientation block for EVERY dispatched profile — no surface is ever clockless
//    again, by construction.
// G2 (blocking, Tenshi + Jim F3): the store layer is unwriteable-to-localise —
//    (a) the one grandfathered local-parsed-back pair (services/terminal.ts marker ↔
//        terminal-search.ts parseAuMarker) is NAMED and consistency-pinned;
//    (b) garden-time may only be imported by a reasoned allow-list (the DEC-104
//        cuff style: a new render-site is a conscious, named addition here);
//    (c) date-keyed artefact names stay UTC-days (the H1 ruling as traced —
//        memory-gradient's rolling keys derive from toISOString().slice(0, 10)).
// H3 (Casey): DST-correct abbreviations from Intl across a DST zone (Sydney:
//    AEDT in January, AEST in July), a DST-less zone (Brisbane: AEST always),
//    and the fail-closed fallbacks (garbage zone → UTC honestly labelled;
//    unset zone → UTC with the no-timezone-set label).
//
// Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-garden-time.ts

import {
    localStamp, localStampSeconds, localDate, resolveZone, renderOrientationLine, orientationBlock,
} from '../src/server/lib/garden-time';
import { parseAuMarker } from '../src/server/lib/terminal-search';
import { buildPrompt, PROFILES } from '../src/server/lib/prompt-builder';
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── H3: the zone pins ────────────────────────────────────────────────────────
console.log('\nH3 — zone rendering pins');

const janUtc = '2026-01-15T12:00:00Z'; // Sydney is AEDT (UTC+11): 11:00 PM; Brisbane AEST (+10): 10:00 PM
const julUtc = '2026-07-15T12:00:00Z'; // Sydney is AEST (+10): 10:00 PM

const sydJan = localStamp(janUtc, 'Australia/Sydney');
check('Sydney in January renders AEDT (DST-correct abbreviation)', sydJan.includes('AEDT'), sydJan);
check('Sydney in January converts to 11:00 PM', sydJan.includes('11:00 PM'), sydJan);

const sydJul = localStamp(julUtc, 'Australia/Sydney');
check('Sydney in July renders AEST (the fold-back)', sydJul.includes('AEST') && !sydJul.includes('AEDT'), sydJul);

const brisJan = localStamp(janUtc, 'Australia/Brisbane');
check('Brisbane in January renders AEST (no DST, ever)', brisJan.includes('AEST'), brisJan);
check('Brisbane converts 12:00Z to 10:00 PM', brisJan.includes('10:00 PM'), brisJan);
check('Brisbane stamp shape', /^Thu 15 Jan 2026, 10:00 PM AEST$/.test(brisJan), brisJan);

const garbage = resolveZone('Not/AZone');
check('garbage zone fails CLOSED to UTC', garbage.zone === 'UTC' && garbage.fallback === true);
const garbageStamp = localStamp(janUtc, 'Not/AZone');
check('garbage-zone render carries the honest label', garbageStamp.includes("invalid zone 'Not/AZone'"), garbageStamp);

const unset = renderOrientationLine(new Date(janUtc), undefined, false);
check('unset-zone orientation says so honestly', unset.includes('no garden timezone set — times are UTC'), unset);
check('unset-zone orientation renders UTC time', unset.includes('12:00 PM UTC') || unset.includes('12:00 pm UTC'.toUpperCase()), unset);

const withLoc = renderOrientationLine(new Date(janUtc), 'Australia/Brisbane', true, 'Mackay, Queensland, Australia (UTC+10)');
check('configured orientation names the place', withLoc.includes('Mackay') && withLoc.includes('AEST'), withLoc);

const ld = localDate(janUtc, 'Australia/Brisbane');
check('localDate names the zone (never a naked day)', ld === '2026-01-15 (AEST)', ld);

// ── G1: every dispatched profile carries the watch ───────────────────────────
console.log('\nG1 — orientation block in every profile (the no-surface-clockless pin)');

const blockMarker = 'Local time now:';
const lawMarker = 'DEC-105';
const bp = orientationBlock();
check('orientationBlock carries the line + the law', bp.includes(blockMarker) && bp.includes(lawMarker));

const profileNames = Object.keys(PROFILES);
check('profile registry is non-trivial', profileNames.length >= 20, `${profileNames.length} profiles`);
let clockless: string[] = [];
for (const name of profileNames) {
    // Slug choice mirrors production ownership loosely: jim for the supervisor/cycle
    // family, leo otherwise. The injection is profile-independent — any slug proves it.
    const slug = /jim|supervisor|cycle/.test(name) ? 'jim' : 'leo';
    // The human-response/wander txn scaffolds REQUIRE roleLabel (no silent leo-default,
    // DEC-081) — supply the minimal honest ctx the way their controllers do.
    const ctx = { roleLabel: 'leo' };
    try {
        const built = buildPrompt(slug, name, ctx);
        if (!built.systemPrompt.includes(blockMarker)) clockless.push(name);
    } catch (e) {
        clockless.push(`${name} (threw: ${(e as Error).message.slice(0, 80)})`);
    }
}
check('every profile\'s built prompt carries the orientation block', clockless.length === 0,
    clockless.length ? `clockless: ${clockless.join(', ')}` : undefined);

// ── G2a: the grandfathered writer/parser pair, consistency-pinned ────────────
console.log('\nG2a — the ONE legacy local-parsed-back site (terminal marker ↔ parseAuMarker)');

// The exact writer expression from services/terminal.ts / terminal-anchor-diff.ts.
const markerBody = new Date(1750000000000).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });
check('terminal marker still parses via parseAuMarker (pair intact)', parseAuMarker(markerBody) !== null, markerBody);
// NB: parseAuMarker constructs its Date in the BOX zone — the pair is correct only while
// box zone == garden zone (Jim F3). This pin guards FORMAT consistency; the zone coupling
// is documented at both sites and in garden-time.ts's header.

// ── G2b/G2c: the store layer is unwriteable-to-localise ──────────────────────
console.log('\nG2b — garden-time import allow-list (a render-site is a conscious addition)');

const SRC = path.join(__dirname, '..', 'src');
const ALLOWED_IMPORTERS = new Set([
    'server/lib/prompt-builder.ts',       // P1 — the DEC-087 chokepoint injection
    // DEC-105 P2 (2026-08-02, each a conscious addition): record headers speak local.
    'server/leo-heartbeat.ts',            // P2 — heartbeat record header (the chimera cured)
    'server/agent-heartbeat.ts',          // P2 — the agnostic twin's header (same chimera)
    'server/human-responder.ts',          // P2 — the Response-to section header
    'server/services/supervisor-worker.ts', // P2 — jim's cycle/dream record headers (chimera cured; the SDK shim's stamp stays byte-intact)
]);
function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist') out.push(...walk(p));
        else if (e.isFile() && p.endsWith('.ts')) out.push(p);
    }
    return out;
}
const offenders: string[] = [];
for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f).replace(/\\/g, '/');
    if (rel === 'server/lib/garden-time.ts') continue;
    const text = fs.readFileSync(f, 'utf8');
    if (/from ['"][^'"]*garden-time['"]/.test(text) && !ALLOWED_IMPORTERS.has(rel)) offenders.push(rel);
}
check('garden-time imported only by the allow-list', offenders.length === 0,
    offenders.length ? `add consciously or remove: ${offenders.join(', ')}` : undefined);

console.log('\nG2c — date-keyed artefact names stay UTC-days (the H1 ruling, pinned as traced)');
const mg = fs.readFileSync(path.join(SRC, 'server', 'lib', 'memory-gradient.ts'), 'utf8');
const rollingKeyDerivations = (mg.match(/toISOString\(\)\.slice\(0, 10\)/g) ?? []).length;
check('memory-gradient rolling keys derive from toISOString().slice(0, 10)', rollingKeyDerivations >= 2,
    `${rollingKeyDerivations} sites (H1: date-keyed names are UTC-days; the render layer says so when speaking them)`);

// ── P2: the record headers speak local (2026-08-02) ─────────────────────────
console.log('\nP2 — record headers speak local; the chimera is unwriteable');

const lss = localStampSeconds('2026-01-15T12:00:00Z', 'Australia/Brisbane');
check('localStampSeconds shape (seconds + zone named)', /^Thu 15 Jan 2026, 10:00:00 PM AEST$/.test(lss), lss);

const P2_SITES: Array<[string, RegExp]> = [
    ['server/leo-heartbeat.ts', /const timestamp = localStampSeconds\(\);/],
    ['server/agent-heartbeat.ts', /const timestamp = localStampSeconds\(\);/],
    ['server/human-responder.ts', /const timestamp = localStampSeconds\(\);/],
    ['server/services/supervisor-worker.ts', /const ts = localStampSeconds\(\);/],
];
for (const [rel, re] of P2_SITES) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    check(`${rel} stamps its record header from the shared clock`, re.test(text));
}
const walker = fs.readFileSync(path.join(__dirname, 'wander-walk.ts'), 'utf8');
check('wander-walk keepsake header uses the shared clock (receipts stay UTC)',
    /### Wander beat \$\{beatN\}[^\n]*localStampSeconds\(\)/.test(walker)
    && /writeWanderReceipt\(\{ ts: new Date\(\)\.toISOString\(\)/.test(walker));
// The UTC-date + local-time CHIMERA is unwriteable: the half-and-half stamp pattern
// (toISOString date glued to toTimeString clock) must never return to src/.
const chimeraOffenders: string[] = [];
for (const f of walk(SRC)) {
    const text = fs.readFileSync(f, 'utf8');
    if (/toISOString\(\)\.split\('T'\)\[0\][^\n]*\n?[^\n]*toTimeString/.test(text)) {
        chimeraOffenders.push(path.relative(SRC, f));
    }
}
check('the UTC-date+local-time chimera pattern is gone from src/ (unwriteable)',
    chimeraOffenders.length === 0, chimeraOffenders.join(', '));

// ── verdict ──────────────────────────────────────────────────────────────────
console.log(`\ngarden-time gates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
