/**
 * fractal-untranscribed.ts — R3b-HB S2: the per-agent untranscribed-file finder,
 * generalised from the twin's `findUntranscribedFiles` (leo-heartbeat.ts:1855-1998)
 * exactly as the cutover plan's PORT row specifies. A LEAF: reads the fractal tree
 * + gradient statements, runs nothing, dispatches nothing.
 *
 * ONE PATH, MANY AGENTS (DEC-081): the agent dir resolves through the REGISTRY
 * (`gradientConfigForAgent(slug).fractalDir` — uniform for ALL agents incl. jim,
 * per the registry's own doc), never `path.join(base, slug)` composed here
 * (the S195 root-special trap: a slug in the expression is not agnosticism;
 * resolution through the shared registry is).
 *
 * Ported lessons kept verbatim in place:
 *  - `/-c\d+$/` two-digit strip (S178: c10-c18 flat-files that never matched a DB
 *    label reincorporated perpetually — a 118-file phase-a backlog).
 *  - `session_label?.` null-guard (2026-06-20): a tagless entry reads as
 *    not-in-cascade — a no-match, never a crash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gradientConfigForAgent } from './agent-registry';
import { gradientStmts } from '../db';

export interface UntranscribedFile {
    filePath: string;
    agent: string;
    level: string;
    contentType: string;
    label: string;
}

export function findUntranscribedFile(slug: string): UntranscribedFile | null {
    const agentDir = gradientConfigForAgent(slug).fractalDir;
    if (!fs.existsSync(agentDir)) return null;

    // Session gradient files (dynamically discovered cN/ directories)
    const sessionLevelDirs = fs.readdirSync(agentDir).filter(d => /^c\d+$/.test(d));
    for (const level of sessionLevelDirs) {
        const levelDir = path.join(agentDir, level);
        if (!fs.existsSync(levelDir)) continue;
        for (const file of fs.readdirSync(levelDir).filter(f => f.endsWith('.md'))) {
            // \d+ not \d — two-digit levels (c10–c18) must strip too (S178).
            const label = file.replace('.md', '').replace(/-c\d+$/, '');
            const existing = (gradientStmts.getBySession.all(label) as any[])
                .filter((r: any) => r.agent === slug);
            if (existing.length === 0) {
                const allEntries = gradientStmts.getByAgent.all(slug) as any[];
                // ?. null-guard: tagless entry = not-in-cascade, never a crash (2026-06-20).
                const inCascade = allEntries.some((r: any) => r.session_label?.includes(label));
                if (!inCascade) {
                    return { filePath: path.join(levelDir, file), agent: slug, level, contentType: 'session', label };
                }
            }
        }
    }

    // Dream gradient files (dreams/dream-day/, dream-week/, dream-month/)
    for (const level of ['dream-day', 'dream-week', 'dream-month']) {
        const levelDir = path.join(agentDir, 'dreams', level);
        if (!fs.existsSync(levelDir)) continue;
        for (const file of fs.readdirSync(levelDir).filter(f => f.endsWith('.md'))) {
            const label = file.replace('.md', '');
            const existing = (gradientStmts.getBySession.all(label) as any[])
                .filter((r: any) => r.agent === slug && r.content_type === 'dream');
            if (existing.length === 0) {
                return { filePath: path.join(levelDir, file), agent: slug, level, contentType: 'dream', label };
            }
        }
    }

    // Memory-file gradient files (felt-moments/cN/, working-memory/cN/)
    for (const contentType of ['felt-moments', 'working-memory']) {
        const contentDir = path.join(agentDir, contentType);
        const memLevelDirs = fs.existsSync(contentDir) ? fs.readdirSync(contentDir).filter(d => /^c\d+$/.test(d)) : [];
        for (const level of memLevelDirs) {
            const levelDir = path.join(contentDir, level);
            if (!fs.existsSync(levelDir)) continue;
            for (const file of fs.readdirSync(levelDir).filter(f => f.endsWith('.md'))) {
                const label = `${contentType}/${file.replace('.md', '')}`;
                const existing = (gradientStmts.getBySession.all(label) as any[])
                    .filter((r: any) => r.agent === slug);
                if (existing.length === 0) {
                    return {
                        filePath: path.join(levelDir, file), agent: slug, level,
                        contentType: contentType === 'felt-moments' ? 'felt-moment' : 'working-memory',
                        label,
                    };
                }
            }
        }
    }

    // Unit vectors (session, then dreams) — same line grammar as the twin.
    for (const [uvFile, isDream] of [['unit-vectors.md', false], [path.join('dreams', 'unit-vectors.md'), true]] as [string, boolean][]) {
        const uvPath = path.join(agentDir, uvFile);
        if (!fs.existsSync(uvPath)) continue;
        const uvLines = fs.readFileSync(uvPath, 'utf8').split('\n').filter(l => l.startsWith('- **'));
        for (const line of uvLines) {
            const match = line.match(/\*\*(.+?)\*\*:\s*"(.+?)"/);
            if (!match) continue;
            const uvLabel = match[1];
            const existing = (gradientStmts.getBySession.all(uvLabel) as any[])
                .filter((r: any) => r.agent === slug && r.level === 'uv' && (!isDream || r.content_type === 'dream'));
            if (existing.length === 0) {
                return { filePath: uvPath, agent: slug, level: 'uv', contentType: isDream ? 'dream' : 'session', label: uvLabel };
            }
        }
    }

    return null; // All files transcribed — Phase A complete for this agent
}
