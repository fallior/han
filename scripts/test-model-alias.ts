/**
 * DEC-104 suite — model-alias float: selection floats, observation pins.
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-model-alias.ts
 *
 * Pins (thread ms8nsb1i — Jim's plan-audit M1/G1 + minors; Tenshi R1–R5; Casey Gaps A/B):
 *  - modelSatisfiesRung: alias↔family match (multi-digit safe), exact-id rungs exact, the
 *    guard-switch path (observed opus vs 'fable' rung STILL casts — Tenshi R5, covered not assumed).
 *  - chromeDisplayToId: table forms, GENERIC future forms ("Opus 5", "Opus 10.1"), non-model → null.
 *  - The honest-absence stamp: the five DEC-092 stamp sites use observedOrUnobservedModel —
 *    never `?? manifestModelHead` (a bare floating alias) on the unobserved path (Jim M1).
 *  - R1 / Gap B — THE UNWRITEABLE CUFF: no version-shaped selection literal anywhere in
 *    src/ + scripts/ outside the reasoned allow-list; allow-listed files must carry their
 *    inline `observation-pin:` provenance (Tenshi R2 — the exception ledger is explicit).
 *  - Ladders are alias-only (the manifest's selection layer carries no version shapes).
 */
import * as fs from 'fs';
import * as path from 'path';
import { modelSatisfiesRung, chromeDisplayToId } from '../src/server/lib/tmux-dispatcher';
import { manifestModelLadder } from '../src/server/lib/garden-manifest';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

const repoRoot = path.join(__dirname, '..');

async function main(): Promise<void> {
    console.log('— modelSatisfiesRung (DEC-104 move 2 — the alias-aware cast check) —');
    {
        check("observed family version satisfies its bare alias rung", modelSatisfiesRung('claude-opus-4-8', 'opus'));
        check("float: a FUTURE family version satisfies the same alias (multi-digit safe)", modelSatisfiesRung('claude-opus-10-2', 'opus'));
        check("R5 guard-switch (Tenshi): observed opus does NOT satisfy a 'fable' rung — casts back", !modelSatisfiesRung('claude-opus-4-8', 'fable'));
        check("family mismatch never satisfies", !modelSatisfiesRung('claude-sonnet-5', 'opus'));
        check("exact-id rung matches exactly", modelSatisfiesRung('claude-fable-5', 'claude-fable-5'));
        check("exact-id rung refuses a different version", !modelSatisfiesRung('claude-fable-5', 'claude-fable-4'));
        check("null/empty observed → false (cast — fail toward casting, never toward skipping)", !modelSatisfiesRung(null, 'opus') && !modelSatisfiesRung('', 'opus'));
        check("bare alias observed (a stamp that slipped) never satisfies as a family", !modelSatisfiesRung('opus', 'fable'));
    }

    console.log('— chromeDisplayToId (DEC-104 move 4 — observation floats, always pins a version) —');
    {
        check("table form: 'Opus 4.8' → claude-opus-4-8", chromeDisplayToId('✳ Opus 4.8 ~/repo ctx: 30%') === 'claude-opus-4-8');
        check("GENERIC future form: 'Opus 5' → claude-opus-5 (zero-maintenance float)", chromeDisplayToId('Opus 5 · ready') === 'claude-opus-5');
        check("multi-digit future form: 'Opus 10.1' → claude-opus-10-1 (Jim's minor)", chromeDisplayToId('Opus 10.1') === 'claude-opus-10-1');
        check("'Fable 5' → claude-fable-5 (table)", chromeDisplayToId('Fable 5') === 'claude-fable-5');
        check("'Sonnet 4.6' → claude-sonnet-4-6", chromeDisplayToId('sonnet 4.6') === 'claude-sonnet-4-6');
        check("non-model text → null (caller's honest-absence path takes over)", chromeDisplayToId('no model here 5') === null && chromeDisplayToId('') === null);
    }

    console.log('— the OBSERVATION-SIDE gate (M1 completed repo-wide; Tenshi/Jim — the R1 twin: observation cannot go version-less) —');
    {
        // The companion to the unwriteable cuff below: R1 makes "selection never pins" structural;
        // THIS makes "observation always pins a version" structural. The proof it was needed:
        // two stamp sites (supervisor-worker) survived the five-site M1 list — a careful human's
        // eye slipped, and only structure doesn't (the two missed sites are the living demo).
        const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '_archive') return [];
            const p = path.join(dir, e.name);
            return e.isDirectory() ? walk(p) : (e.isFile() && e.name.endsWith('.ts') ? [p] : []);
        });
        const srcFiles = walk(path.join(repoRoot, 'src'));
        const bareFallbackRe = /observeActiveModel\([^)]*\)\s*\?\?/;
        const offenders = srcFiles.filter(f => {
            const rel = path.relative(repoRoot, f);
            if (rel === 'src/server/lib/tmux-dispatcher.ts') return false; // the ONE lawful ??-site: observedOrUnobservedModel itself
            return bareFallbackRe.test(fs.readFileSync(f, 'utf-8'));
        }).map(f => path.relative(repoRoot, f));
        check('NO bare observeActiveModel-?? fallback anywhere in src/ (every stamp routes through observedOrUnobservedModel)',
            offenders.length === 0, offenders.join(', '));
        const stampUsers = srcFiles.map(f => (fs.readFileSync(f, 'utf-8').match(/observedOrUnobservedModel\(/g) ?? []).length).reduce((a, b) => a + b, 0);
        check('the DEC-092 stamp sites use observedOrUnobservedModel (≥7 sites: 5 heartbeat + 2 supervisor-worker)', stampUsers >= 7, `found ${stampUsers}`);
        const dispatcher = fs.readFileSync(path.join(repoRoot, 'src/server/lib/tmux-dispatcher.ts'), 'utf-8');
        check("the fallback stamps ':unobserved' — the absence labelled in the record", dispatcher.includes(':unobserved`'));
    }

    console.log('— selection ladders are alias-only (the manifest layer) —');
    {
        // A version-shaped model string: constructed, never written literally (the MNT-026 lesson —
        // this suite must not itself trip the gate it enforces).
        const versionShape = new RegExp('claude-' + '(opus|sonnet|haiku|fable)-[0-9]', 'i');
        const surfaces: Array<[string, string]> = [
            ['leo', 'human-response'], ['jim', 'human-response'], ['leo', 'heartbeat'],
            ['jim', 'supervisor-cycle'], ['jim', 'compression'], ['leo', 'session'],
        ];
        let clean = true;
        for (const [slug, surface] of surfaces) {
            const ladder = manifestModelLadder(slug, surface);
            if (ladder.some(r => versionShape.test(r))) { clean = false; check(`ladder ${slug}/${surface} is alias-only`, false, ladder.join(',')); }
        }
        if (clean) check('every resolved ladder is alias-only (no version shapes in selection)', true);
    }

    console.log('— R1 / Gap B: THE UNWRITEABLE CUFF (Tenshi + Casey — the deal, enforced at commit-time) —');
    {
        // Version-shaped model literal on a CODE line (comments stripped) outside the reasoned
        // allow-list = an unauthored pin → RED, naming the offender. The allow-list is the
        // provenance ledger: every entry must carry its inline observation-pin reason (R2).
        const versionShape = new RegExp('claude-' + '(opus|sonnet|haiku|fable)-[0-9]', 'i');
        const ALLOW: Record<string, string> = {
            // file (repo-relative) → why a version literal may live there
            'src/server/lib/tmux-dispatcher.ts': 'DEC-092 stamp table + display normaliser (observation)',
            'scripts/wake-reconcile.ts': 'measured token-rates keyed by observed ids (measurement)',
            'scripts/test-stem-pool.ts': 'synthetic observed fixture (test)',
            'scripts/warm-death-smoke.ts': 'synthetic observed fixture (test)',
        };
        const SELF = 'scripts/test-model-alias.ts';
        const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '_archive') return [];
            const p = path.join(dir, e.name);
            return e.isDirectory() ? walk(p) : (e.isFile() && e.name.endsWith('.ts') ? [p] : []);
        });
        const files = [...walk(path.join(repoRoot, 'src')), ...walk(path.join(repoRoot, 'scripts'))];
        const offenders: string[] = [];
        for (const f of files) {
            const rel = path.relative(repoRoot, f);
            if (rel === SELF || ALLOW[rel]) continue;
            const code = fs.readFileSync(f, 'utf-8').split('\n')
                .map(l => l.replace(/\/\/.*$/, ''))                       // strip line comments
                .filter(l => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('/*')); }) // strip block-comment lines
                .join('\n');
            if (versionShape.test(code)) offenders.push(rel);
        }
        check('no unauthored version pin anywhere in src/ + scripts/ (use the alias, or carry an observation-pin in an allowed site)',
            offenders.length === 0, offenders.join(', '));
        for (const [rel, why] of Object.entries(ALLOW)) {
            const src = fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
            check(`allow-list provenance present: ${rel} (${why})`, src.includes('observation-pin:'));
        }
    }

    console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
