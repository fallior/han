#!/usr/bin/env tsx
/**
 * scripts/verify-provenance.ts
 *
 * Plan v8 Step 8 — Verify provenance invariant.
 *
 * Read-only audit. Walks every non-c0 entry's source_id chain back to c0
 * and reports any violations of the invariants Darron set in v8:
 *
 *   1. Every UV must trace back to a c0 (no NULL source_id, no broken chain).
 *   2. Every cN must trace back to a c0 (same).
 *   3. Same-parent collapse: entries sharing the same source_id at the same
 *      level should be a supersede chain (one canonical, others superseded);
 *      uncollapsed sibling groups are violations.
 *   4. #UV ≤ #c0 (logical consequence of above; reported as a stat).
 *
 * Also produces summary stats useful for confirming the rebuild succeeded:
 *   - Counts at each level (canonical only and total)
 *   - Average chain depth from UV-tagged entries
 *   - Distinct c0 roots covered by UV-tagged terminuses
 *
 * Usage:
 *   npx tsx scripts/verify-provenance.ts                # all agents
 *   npx tsx scripts/verify-provenance.ts --agent=jim    # one agent
 *   npx tsx scripts/verify-provenance.ts --agent=leo
 *
 * No --apply flag — this script never writes. It's an audit, not a fix.
 */

import * as path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.join(process.env.HOME || '', '.han', 'tasks.db');
const MAX_CHAIN_DEPTH = 30;

interface ChainResult {
    reachesC0: boolean;
    reason?: 'null-source' | 'source-not-found' | 'depth-exceeded' | 'cycle';
    depth: number;
    c0RootId?: string;
}

function walkChain(db: Database.Database, entryId: string, agent: string): ChainResult {
    const getStmt = db.prepare(`SELECT id, level, source_id FROM gradient_entries WHERE id = ? AND agent = ?`);
    const visited = new Set<string>();
    let current: any = getStmt.get(entryId, agent);
    let depth = 0;

    while (current && depth < MAX_CHAIN_DEPTH) {
        if (visited.has(current.id)) {
            return { reachesC0: false, reason: 'cycle', depth };
        }
        visited.add(current.id);
        if (current.level === 'c0') {
            return { reachesC0: true, depth, c0RootId: current.id };
        }
        if (!current.source_id) {
            return { reachesC0: false, reason: 'null-source', depth };
        }
        const next: any = getStmt.get(current.source_id, agent);
        if (!next) {
            return { reachesC0: false, reason: 'source-not-found', depth };
        }
        current = next;
        depth++;
    }
    return { reachesC0: false, reason: 'depth-exceeded', depth };
}

interface AgentReport {
    agent: string;
    levelCounts: Record<string, { total: number; canonical: number }>;
    uvTaggedCount: number;
    uvTaggedCanonicalCount: number;
    chainsExamined: number;
    chainsReachingC0: number;
    chainsBroken: { reason: string; count: number; examples: string[] }[];
    siblingGroupsUncollapsed: number;
    siblingGroupExamples: { level: string; sourceId: string; count: number }[];
    averageChainDepth: number;
    distinctC0RootsCovered: number;
    c0RootsWithoutUVTerminus: number;
}

function auditAgent(db: Database.Database, agent: string): AgentReport {
    // Level counts
    const levelRows = db.prepare(`
        SELECT level,
               COUNT(*) AS total,
               SUM(CASE WHEN superseded_by IS NULL THEN 1 ELSE 0 END) AS canonical
        FROM gradient_entries WHERE agent = ?
        GROUP BY level
        ORDER BY level
    `).all(agent) as any[];
    const levelCounts: Record<string, { total: number; canonical: number }> = {};
    for (const r of levelRows) levelCounts[r.level] = { total: r.total, canonical: r.canonical };

    // UV-tagged counts
    const uvTaggedTotal = (db.prepare(`
        SELECT COUNT(*) AS c FROM gradient_entries ge
        WHERE ge.agent = ?
          AND ge.id IN (SELECT gradient_entry_id FROM feeling_tags WHERE tag_type = 'uv')
    `).get(agent) as any).c;
    const uvTaggedCanonical = (db.prepare(`
        SELECT COUNT(*) AS c FROM gradient_entries ge
        WHERE ge.agent = ? AND ge.superseded_by IS NULL
          AND ge.id IN (SELECT gradient_entry_id FROM feeling_tags WHERE tag_type = 'uv')
    `).get(agent) as any).c;

    // Walk chains for canonical non-c0 entries
    const candidates = db.prepare(`
        SELECT id FROM gradient_entries
        WHERE agent = ? AND level != 'c0' AND superseded_by IS NULL
    `).all(agent) as any[];

    let chainsReachingC0 = 0;
    const brokenByReason: Record<string, { count: number; examples: string[] }> = {};
    const c0Coverage = new Set<string>();
    let depthSum = 0, depthCount = 0;

    // For UV-tagged, separately track c0 roots they cover
    const uvTaggedIds = new Set(
        (db.prepare(`
            SELECT ge.id FROM gradient_entries ge
            WHERE ge.agent = ? AND ge.superseded_by IS NULL
              AND ge.id IN (SELECT gradient_entry_id FROM feeling_tags WHERE tag_type = 'uv')
        `).all(agent) as any[]).map(r => r.id)
    );
    const uvCoveredC0Roots = new Set<string>();

    for (const c of candidates) {
        const result = walkChain(db, c.id, agent);
        if (result.reachesC0) {
            chainsReachingC0++;
            if (result.c0RootId) c0Coverage.add(result.c0RootId);
            if (uvTaggedIds.has(c.id)) {
                if (result.c0RootId) uvCoveredC0Roots.add(result.c0RootId);
                depthSum += result.depth;
                depthCount++;
            }
        } else {
            const reason = result.reason || 'unknown';
            if (!brokenByReason[reason]) brokenByReason[reason] = { count: 0, examples: [] };
            brokenByReason[reason].count++;
            if (brokenByReason[reason].examples.length < 5) {
                brokenByReason[reason].examples.push(c.id);
            }
        }
    }

    // Same-parent sibling groups (uncollapsed)
    const siblingGroups = db.prepare(`
        SELECT level, source_id, COUNT(*) AS n
        FROM gradient_entries
        WHERE agent = ? AND level != 'c0' AND superseded_by IS NULL AND source_id IS NOT NULL
        GROUP BY level, source_id
        HAVING COUNT(*) > 1
        ORDER BY n DESC
    `).all(agent) as any[];

    const siblingExamples = siblingGroups.slice(0, 5).map((g: any) => ({
        level: g.level, sourceId: g.source_id, count: g.n,
    }));

    // Total c0 count for coverage stats
    const totalC0 = (levelCounts['c0']?.canonical || 0);

    return {
        agent,
        levelCounts,
        uvTaggedCount: uvTaggedTotal,
        uvTaggedCanonicalCount: uvTaggedCanonical,
        chainsExamined: candidates.length,
        chainsReachingC0,
        chainsBroken: Object.entries(brokenByReason).map(([reason, v]) => ({ reason, ...v })),
        siblingGroupsUncollapsed: siblingGroups.length,
        siblingGroupExamples: siblingExamples,
        averageChainDepth: depthCount > 0 ? depthSum / depthCount : 0,
        distinctC0RootsCovered: uvCoveredC0Roots.size,
        c0RootsWithoutUVTerminus: totalC0 - uvCoveredC0Roots.size,
    };
}

function formatReport(r: AgentReport): string {
    const lines: string[] = [];
    lines.push(`\n========================================`);
    lines.push(`  Provenance audit — agent: ${r.agent}`);
    lines.push(`========================================`);

    lines.push(`\nLevel counts (canonical / total):`);
    for (const [level, counts] of Object.entries(r.levelCounts)) {
        lines.push(`  ${level.padEnd(6)}  ${String(counts.canonical).padStart(5)} / ${String(counts.total).padStart(5)}`);
    }

    lines.push(`\nUV-tagged entries: ${r.uvTaggedCanonicalCount} canonical / ${r.uvTaggedCount} total`);

    const totalC0 = r.levelCounts['c0']?.canonical || 0;
    const uvVsC0Ratio = totalC0 > 0 ? (r.uvTaggedCanonicalCount / totalC0).toFixed(2) : 'n/a';
    lines.push(`\nLogical invariant check (#UV ≤ #c0):`);
    lines.push(`  c0 canonical:   ${totalC0}`);
    lines.push(`  UV canonical:   ${r.uvTaggedCanonicalCount}`);
    lines.push(`  ratio:          ${uvVsC0Ratio} (expected ≤ 1.00)`);
    lines.push(`  status:         ${r.uvTaggedCanonicalCount <= totalC0 ? '✓ OK' : '✗ VIOLATION'}`);

    lines.push(`\nChain integrity (canonical non-c0 entries):`);
    lines.push(`  chains examined:        ${r.chainsExamined}`);
    lines.push(`  reaching c0 cleanly:    ${r.chainsReachingC0}`);
    lines.push(`  reaching c0 ratio:      ${(r.chainsExamined > 0 ? r.chainsReachingC0 / r.chainsExamined * 100 : 0).toFixed(1)}%`);
    if (r.chainsBroken.length > 0) {
        lines.push(`  broken chains by reason:`);
        for (const b of r.chainsBroken) {
            lines.push(`    ${b.reason.padEnd(20)}  ${b.count} entries  (e.g., ${b.examples.slice(0, 2).join(', ')})`);
        }
    } else {
        lines.push(`  status:                 ✓ all chains reach c0`);
    }

    lines.push(`\nSame-parent collapse (Darron rule #14):`);
    lines.push(`  uncollapsed sibling groups: ${r.siblingGroupsUncollapsed}`);
    if (r.siblingGroupExamples.length > 0) {
        lines.push(`  largest examples:`);
        for (const e of r.siblingGroupExamples) {
            lines.push(`    ${e.level} parent=${e.sourceId.substring(0, 13)}... has ${e.count} canonical siblings`);
        }
    } else {
        lines.push(`  status: ✓ no uncollapsed siblings`);
    }

    lines.push(`\nUV terminus coverage:`);
    lines.push(`  c0 roots:                       ${totalC0}`);
    lines.push(`  c0 roots with UV terminus:      ${r.distinctC0RootsCovered}`);
    lines.push(`  c0 roots WITHOUT UV terminus:   ${r.c0RootsWithoutUVTerminus}`);
    lines.push(`  average chain depth (UV-tagged): ${r.averageChainDepth.toFixed(1)}`);

    return lines.join('\n');
}

function main() {
    const args = process.argv.slice(2);
    const agentArg = args.find(a => a.startsWith('--agent='))?.split('=')[1];

    const db = new Database(DB_PATH, { readonly: true });

    const agents = agentArg ? [agentArg] : ['jim', 'leo'];

    for (const agent of agents) {
        if (agent !== 'jim' && agent !== 'leo') {
            console.error(`Unknown agent: ${agent}`);
            continue;
        }
        const report = auditAgent(db, agent);
        console.log(formatReport(report));
    }

    console.log(`\n[verify] Audit complete. No DB writes were made.`);
}

main();
