/**
 * dream-seeds.ts — the ONE dream-seed reader, for every agent.
 *
 * MNT-148 phase 2 (2026-08-18, Leo-build / Jim-audit / Darron's word). The garden had two
 * readers doing one job: the agnostic `readDreamSeeds()` in `agent-heartbeat.ts` (which
 * split on its file's real heading and capped each fragment at 400 chars) and a
 * jim-specific `readJimDreamSeeds()` in `supervisor-worker.ts` (which split on a heading
 * level its files do not use, and capped nothing). The twin drifted as the files grew:
 * felt-moments.md reached 471KB with ZERO `## ` headings, so its "snippet" pool collapsed
 * to whole books and a 2-fragment draw carried ~130K est-tokens into a 120K budget —
 * Jim's dream cycles skipped, intermittently, for days.
 *
 * The lesson is DEC-081's, not the regex's: **the supervisor was not different because
 * supervision is different — it kept a private copy of a shared job.** So the cure is one
 * reader every surface calls, resolved through the registry (which knows jim lives at
 * memory root and everyone else under `memory/<slug>` — never `path.join(dir, slug)`,
 * the S195 trap), heading-level agnostic by construction rather than by luck, and capped
 * per fragment with the unit in the identifier (MNT-144: a count is blind to size).
 *
 * The test that shaped it: **would a fourth agent's supervisor get this for free?** Yes —
 * a new resident needs no code, only a registry entry it already has.
 */

import * as fs from 'fs';
import * as path from 'path';
import { gradientConfigForAgent } from './agent-registry';

/** Per-fragment ceiling in CHARS (unit named, MNT-144). Inherited from the agnostic
 *  reader's long-standing `.slice(0, 400)` — a value already measured in practice
 *  rather than invented for this file. */
export const SEED_FRAGMENT_MAX_CHARS = 400;

/** Split at h2 OR h3 boundaries. Heading-level agnostic ON PURPOSE: a memory file's
 *  heading habit must never again decide whether the pool is entries or whole books. */
const HEADING_SPLIT = /(?=^#{2,3} )/m;

export interface DreamSeedOptions {
    /** Files under the agent's memory dir to draw waking snippets from.
     *  Contained to that dir at read time (resolve+verify — `..` cannot escape). */
    sources: string[];
    /** How many fragments to return. */
    count: number;
    /** Per-fragment ceiling in CHARS — REQUIRED, so the record can tell "chose a value"
     *  from "never thought about it" (Casey's distinguishability point, Darron's ruling
     *  2026-08-18). A caller with no opinion of its own passes SEED_FRAGMENT_MAX_CHARS
     *  BY NAME — explicit inheritance, never silent. */
    maxChars: number;
    /** Optional split override for files with their own entry grammar
     *  (e.g. explorations.md's `### Beat ` / `### Dream N`). */
    split?: RegExp;
}

/** Fisher-Yates — scattered, not chronological (dreams are chaotic random-seed acts). */
function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Read `count` random capped fragments from an agent's own memory files.
 * Sovereign by construction, two halves (Tenshi's F1 audit, 2026-08-18): the SLUG half —
 * the memory dir comes from the agent's own registry config, and an unknown slug throws →
 * empty (an allowlist, not a path fragment); and the SOURCES half — each file is resolved
 * and verified contained under that dir, so `../<other>/…` cannot escape (made
 * unrepresentable rather than documented against). Callers pass self (S103 — the trust
 * model, unchanged). Fail-soft: a missing or non-contained file is skipped; any error
 * yields an empty list, never a throw.
 */
export function readDreamSeedFragments(slug: string, opts: DreamSeedOptions): string[] {
    const { maxChars } = opts;
    const split = opts.split ?? HEADING_SPLIT;
    const fragments: string[] = [];
    try {
        const memDir = path.resolve(gradientConfigForAgent(slug).memoryDir);
        for (const file of opts.sources) {
            const p = path.resolve(memDir, file);
            if (!p.startsWith(memDir + path.sep)) continue; // containment (F1): `..`/absolute never escape
            if (!fs.existsSync(p)) continue;
            const chunks = fs.readFileSync(p, 'utf-8')
                .split(split)
                .filter((c) => c.trim().length > 50)
                .map((c) => {
                    const t = c.trim(); // trim BEFORE the length test (Jim note 1 — symmetric branches)
                    return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
                });
            fragments.push(...chunks);
        }
    } catch {
        return [];
    }
    return shuffle(fragments).slice(0, opts.count);
}

/** The joined form most callers want. Empty string when there is nothing to draw —
 *  a newborn with no explorations dreams seedless, honestly (never a fabricated seed). */
export function readDreamSeeds(slug: string, opts: DreamSeedOptions): string {
    return readDreamSeedFragments(slug, opts).join('\n\n---\n\n');
}
