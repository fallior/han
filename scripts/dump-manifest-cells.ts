#!/usr/bin/env tsx
/**
 * dump-manifest-cells.ts — P1's frozen-truth dump (S218; Jim's crux-1 arity-complete matrix).
 *
 * Enumerates EVERY manifest accessor cell (all five arities, per the P1 build-notes in
 * plans/live-garden-update-plan.md) and writes them to a fixture JSON. Run BEFORE the
 * extraction refactor (the frozen truth), then test-p1-equivalence.ts re-reads every cell
 * through the extracted loader and deepEquals against this fixture — zero tolerance.
 *
 *   cd src/server && npx tsx ../../scripts/dump-manifest-cells.ts <out.json>
 */
import { writeFileSync } from 'fs';
import {
    loadResidents, allocationFor, spokeLifecycleFor, wakeFeedFor, surfaceEnabledFor,
    poolSizeFor, manifestModelHead, manifestModelLadder, manifestTransport, swapPrefixFor,
    conversationRoleFor, agentNameAliases, humanResponderPeers, humanResponderTxnTimeoutMs,
    humanResponderCommitmentScan, runsSupervisorCycle, conversationRolesExcept,
    peerConversationFor, displayNameForRole, slugForConversationRole, SHARED_SURFACES,
    GARDEN_MANIFEST, addressedToOtherResponderOnly,
} from '../src/server/lib/garden-manifest';

const out = process.argv[2];
if (!out) { console.error('usage: dump-manifest-cells.ts <out.json>'); process.exit(2); }

// The behavioural fixture texts (addressedToOtherResponderOnly) — fixed, representative.
const TEXTS = [
    'hey Leo can you look at this', 'Jim please check the cycle', 'Leo and Jim both — thoughts?',
    'morning chaps', 'Leonhard my friend, a question', 'jimmy old boy, the numbers please',
    'no name mentioned at all',
];

const cells: Record<string, unknown> = {};
const residents = loadResidents();
const slugs = residents.map((a) => a.slug);
const roles = ['human', 'supervisor', ...slugs];

// garden-wide
cells['roster|order'] = slugs;
cells['shared-surfaces|keys'] = Object.keys(SHARED_SURFACES);
cells['identity|project'] = GARDEN_MANIFEST.project;
cells['identity|user'] = GARDEN_MANIFEST.user;
cells['garden|manifestVersion'] = GARDEN_MANIFEST.manifestVersion;
cells['garden|spokeLifecycle'] = GARDEN_MANIFEST.spokeLifecycle;

for (const a of residents) {
    const s = a.slug;
    // per-slug ×8 (+ the full AgentManifest object itself for total coverage)
    cells[`agent|${s}|manifest`] = a;
    cells[`allocationFor|${s}`] = allocationFor(s) ?? null;
    cells[`conversationRoleFor|${s}`] = conversationRoleFor(s);
    cells[`agentNameAliases|${s}`] = agentNameAliases(s);
    cells[`humanResponderPeers|${s}`] = humanResponderPeers(s);
    cells[`humanResponderTxnTimeoutMs|${s}`] = humanResponderTxnTimeoutMs(s);
    cells[`humanResponderCommitmentScan|${s}`] = humanResponderCommitmentScan(s);
    cells[`runsSupervisorCycle|${s}`] = runsSupervisorCycle(s);
    cells[`conversationRolesExcept|${s}`] = conversationRolesExcept(s);
    // (slug, peer) — the pair arity, full matrix
    for (const p of slugs) cells[`peerConversationFor|${s}|${p}`] = peerConversationFor(s, p) ?? null;
    // (slug, surface) ×8 — every surface named on the agent + a probe of an absent one
    for (const surf of [...a.surfaces.map((x) => x.name), '__absent-surface__']) {
        const k = `${s}|${surf}`;
        cells[`spokeLifecycleFor|${k}`] = spokeLifecycleFor(s, surf);
        cells[`wakeFeedFor|${k}`] = wakeFeedFor(s, surf);
        cells[`surfaceEnabledFor|${k}`] = surfaceEnabledFor(s, surf);
        cells[`poolSizeFor|${k}`] = poolSizeFor(s, surf);
        cells[`manifestModelHead|${k}`] = manifestModelHead(s, surf);
        cells[`manifestModelLadder|${k}`] = manifestModelLadder(s, surf);
        cells[`manifestTransport|${k}`] = manifestTransport(s, surf);
        cells[`swapPrefixFor|${k}`] = swapPrefixFor(s, surf);
    }
    // behavioural — fixed text fixtures
    for (let i = 0; i < TEXTS.length; i++) {
        cells[`addressedToOtherResponderOnly|${s}|t${i}`] = addressedToOtherResponderOnly(s, TEXTS[i]);
    }
}
// role-keyed ×2
for (const r of roles) {
    cells[`displayNameForRole|${r}`] = displayNameForRole(r);
    cells[`slugForConversationRole|${r}`] = slugForConversationRole(r) ?? null;
}

writeFileSync(out, JSON.stringify(cells, null, 1));
console.log(`dumped ${Object.keys(cells).length} cells → ${out}`);
