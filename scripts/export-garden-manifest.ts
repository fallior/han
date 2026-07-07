#!/usr/bin/env tsx
/**
 * export-garden-manifest.ts — P1's one-shot exporter (S218).
 *
 * Serialises the CURRENT in-code GARDEN_MANIFEST + AGENT_ALLOCATION literals into the
 * garden's own config file (`$HAN_HOME/garden-manifest.json`) — the F2 extraction: after
 * this, the engine LOADS the garden's config instead of compiling our garden into itself.
 *
 * Two portability transforms (inverted exactly by the loader):
 *   1. each surface's `model` ladder ARRAY → the ladder NAME (`ladder: "FABLE_LADDER"`) —
 *      the garden owns WHICH ladder each surface uses; the engine owns ladder CONTENTS
 *      (model economics stay engine-updatable). FAILS LOUD if a surface's array matches
 *      no registry ladder (forcing named ladders — true of every surface today).
 *   2. allocation `memoryDir` → `memoryDirRel` (relative to $HAN_HOME) — jim's root-special
 *      path becomes the explicit rel "memory", everyone else "memory/<slug>".
 *
 *   cd src/server && npx tsx ../../scripts/export-garden-manifest.ts [--out <path>]
 */
import { writeFileSync, renameSync } from 'fs';
import * as path from 'path';
import { GARDEN_MANIFEST, allocationFor, loadResidents, LADDER_REGISTRY } from '../src/server/lib/garden-manifest';
import { hanHome } from '../src/server/lib/paths';

const outArg = process.argv.indexOf('--out');
const outPath = outArg >= 0 ? process.argv[outArg + 1] : path.join(hanHome(), 'garden-manifest.json');

function ladderName(model: string[]): string {
    for (const [name, arr] of Object.entries(LADDER_REGISTRY)) {
        if (arr.length === model.length && arr.every((m, i) => m === model[i])) return name;
    }
    throw new Error(`export: surface ladder ${JSON.stringify(model)} matches no registry ladder (${Object.keys(LADDER_REGISTRY).join(', ')}) — name it in the registry first`);
}

const home = hanHome();
function relToHanHome(p: string): string {
    if (!p.startsWith(home + path.sep) && p !== home) throw new Error(`export: memoryDir '${p}' is not under $HAN_HOME '${home}'`);
    return p === home ? '' : path.relative(home, p);
}

const agents = GARDEN_MANIFEST.agents.map((a) => ({
    ...a,
    surfaces: a.surfaces.map(({ model, ...rest }) => ({ ...rest, ladder: ladderName(model) })),
}));

const allocations: Record<string, { memoryDirRel: string }> = {};
for (const a of loadResidents()) {
    const alloc = allocationFor(a.slug);
    if (alloc?.memoryDir) allocations[a.slug] = { memoryDirRel: relToHanHome(alloc.memoryDir) };
}

const out = {
    manifestVersion: GARDEN_MANIFEST.manifestVersion,
    spokeLifecycle: GARDEN_MANIFEST.spokeLifecycle,
    project: GARDEN_MANIFEST.project,
    user: GARDEN_MANIFEST.user,
    agents,
    allocations,
};

const tmp = `${outPath}.tmp-export`;
writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
renameSync(tmp, outPath); // atomic — a reader never sees a half-written config
console.log(`exported garden config → ${outPath} (${agents.length} agents, ${Object.keys(allocations).length} allocations)`);
