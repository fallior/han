import fs from 'fs';
import path from 'path';
import os from 'os';
import { db, taskStmts, goalStmts, portfolioStmts, memoryStmts } from '../db';

/**
 * Read a file or return empty string on failure.
 */
export function readFileOrEmpty(filepath: string, maxChars = 5000): string {
    try {
        if (!fs.existsSync(filepath)) return '';
        return fs.readFileSync(filepath, 'utf8').slice(0, maxChars);
    } catch { return ''; }
}

/**
 * Read project context files (CLAUDE.md, CURRENT_STATUS.md, README.md)
 */
export function readProjectContext(projectPath: string): string {
    const files = ['CLAUDE.md', 'CURRENT_STATUS.md', 'README.md'];
    let context = '';

    for (const file of files) {
        const filepath = path.join(projectPath, file);
        if (fs.existsSync(filepath)) {
            try {
                const content = fs.readFileSync(filepath, 'utf8');
                context += `\n## ${file}\n\n${content.slice(0, 5000)}\n`;
            } catch {
                // Skip unreadable files
            }
        }
    }

    return context || 'No project context files found.';
}

/**
 * Extract settled decisions from DECISIONS.md markdown content.
 */
export function extractSettledDecisions(markdown: string): string[] {
    if (!markdown) return [];
    const sections = markdown.split(/(?=### DEC-)/);
    return sections.filter(s =>
        /\*\*Status\*\*:\s*(Settled|Accepted)/i.test(s)
    ).map(s => s.trim());
}

/**
 * Detect the tech stack of a project from package.json and CLAUDE.md.
 */
export function detectProjectTechStack(projectPath: string): string[] {
    const techSet = new Set<string>();
    const depMap: Record<string, string[]> = {
        'express': ['Express', 'Node.js'],
        'better-sqlite3': ['SQLite'],
        '@types/bun': ['Bun'],
        '@anthropic-ai/claude-agent-sdk': ['Claude Agent SDK'],
        'react': ['React'],
        'react-dom': ['React'],
        'drizzle-orm': ['Drizzle ORM'],
        'ws': ['WebSocket'],
        'hono': ['Bun'],
        'elysia': ['Bun'],
    };
    const pkgPaths = [
        path.join(projectPath, 'package.json'),
        path.join(projectPath, 'src', 'server', 'package.json'),
    ];
    for (const pkgPath of pkgPaths) {
        try {
            if (!fs.existsSync(pkgPath)) continue;
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            techSet.add('JavaScript');
            for (const dep of Object.keys(allDeps)) {
                if (depMap[dep]) depMap[dep].forEach(t => techSet.add(t));
                if (dep.startsWith('@tanstack/')) techSet.add('TanStack');
                if (dep.startsWith('@cloudflare/')) techSet.add('Cloudflare Workers');
            }
            if (pkg.engines?.bun) techSet.add('Bun');
        } catch { /* skip */ }
    }
    const claudeMd = readFileOrEmpty(path.join(projectPath, 'CLAUDE.md'), 2000);
    const stackMatch = claudeMd.match(/\*\*Stack\*\*:\s*(.+)/);
    if (stackMatch) {
        stackMatch[1].split(/\s*\+\s*/).forEach(t => techSet.add(t.trim()));
    }
    return [...techSet];
}

/**
 * Get relevant cross-project learnings based on tech stack.
 */
export function getRelevantLearnings(techStack: string[]): Array<{ id: string; severity: string; summary: string; content: string | null }> {
    if (!techStack.length) return [];
    const indexPath = path.join(os.homedir(), 'Projects', '_learnings', 'INDEX.md');
    const indexContent = readFileOrEmpty(indexPath, 10000);
    if (!indexContent) return [];

    const techSectionMatch = indexContent.match(/## Index by Tech Stack\s*\n([\s\S]*?)(?=\n## |$)/);
    if (!techSectionMatch) return [];

    const techSection = techSectionMatch[1];
    const learnings: Array<{ id: string; severity: string; summary: string; content: string | null }> = [];
    const hasJs = techStack.some(t => /javascript|typescript|node|express|react|bun/i.test(t));
    const categories = techSection.split(/(?=### )/);

    for (const category of categories) {
        const headerMatch = category.match(/^### (.+)/);
        if (!headerMatch) continue;
        const categoryName = headerMatch[1].trim();
        const isMatch = techStack.some(tech =>
            categoryName.toLowerCase().includes(tech.toLowerCase()) ||
            tech.toLowerCase().includes(categoryName.toLowerCase().split(' / ')[0])
        ) || (hasJs && /javascript|typescript/i.test(categoryName));
        if (!isMatch) continue;

        const entryRegex = /- \*\*(L\d+)\*\* \((\w+)\): (.+)/g;
        let match;
        while ((match = entryRegex.exec(category)) !== null) {
            const [, id, severity, summary] = match;
            if (severity === 'LOW') continue;
            let content: string | null = null;
            if (severity === 'HIGH') {
                const idTableMatch = indexContent.match(new RegExp(`\\| ${id} \\| \\w+ \\| \\[.+?\\]\\((.+?)\\)`));
                if (idTableMatch) {
                    const learningPath = path.join(os.homedir(), 'Projects', '_learnings', idTableMatch[1]);
                    content = readFileOrEmpty(learningPath, 500);
                }
            }
            learnings.push({ id, severity, summary, content });
        }
    }

    const seen = new Set<string>();
    return learnings.filter(l => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
    })
    .sort((a, b) => (a.severity === 'HIGH' ? 0 : 1) - (b.severity === 'HIGH' ? 0 : 1))
    .slice(0, 10);
}

/**
 * Get recent failure patterns for a project from project_memory.
 * Deduplicates by normalised error text, returns top 5 by frequency.
 */
export function getRecentFailures(projectPath: string): Array<{ error: string; count: number; lastSeen: string; models: string[] }> {
    try {
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        const failures = db.prepare(
            'SELECT error_summary, model_used, task_type, created_at FROM project_memory WHERE project_path = ? AND success = 0 AND error_summary IS NOT NULL AND created_at > ? ORDER BY created_at DESC'
        ).all(projectPath, cutoff) as Array<{ error_summary: string; model_used: string; task_type: string; created_at: string }>;

        if (!failures.length) return [];

        const patterns: Record<string, { error: string; count: number; lastSeen: string; models: Set<string> }> = {};
        for (const f of failures) {
            const normalised = f.error_summary.slice(0, 100).toLowerCase()
                .replace(/[0-9a-f]{6,}/g, '...')
                .replace(/\d+/g, 'N')
                .trim();
            if (!patterns[normalised]) {
                patterns[normalised] = { error: f.error_summary.slice(0, 200), count: 0, lastSeen: f.created_at, models: new Set() };
            }
            patterns[normalised].count++;
            patterns[normalised].models.add(f.model_used);
        }

        return Object.values(patterns)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(p => ({ ...p, models: [...p.models] }));
    } catch { return []; }
}

/**
 * Get aggregate stats for all projects (tasks and goals).
 */
function getAllProjectStats(): Record<string, {
    tasks_total: number; tasks_completed: number; tasks_failed: number;
    tasks_running: number; tasks_pending: number; total_cost_usd: number;
    goals_total: number; goals_completed: number;
}> {
    const taskRows = db.prepare(`
        SELECT project_path,
            COUNT(*) as tasks_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as tasks_completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as tasks_failed,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as tasks_running,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as tasks_pending,
            COALESCE(SUM(cost_usd), 0) as total_cost_usd
        FROM tasks GROUP BY project_path
    `).all() as Array<{
        project_path: string; tasks_total: number; tasks_completed: number;
        tasks_failed: number; tasks_running: number; tasks_pending: number; total_cost_usd: number;
    }>;

    const goalRows = db.prepare(`
        SELECT project_path,
            COUNT(*) as goals_total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as goals_completed
        FROM goals GROUP BY project_path
    `).all() as Array<{ project_path: string; goals_total: number; goals_completed: number }>;

    const stats: Record<string, {
        tasks_total: number; tasks_completed: number; tasks_failed: number;
        tasks_running: number; tasks_pending: number; total_cost_usd: number;
        goals_total: number; goals_completed: number;
    }> = {};
    for (const r of taskRows) {
        stats[r.project_path] = {
            tasks_total: r.tasks_total, tasks_completed: r.tasks_completed,
            tasks_failed: r.tasks_failed, tasks_running: r.tasks_running,
            tasks_pending: r.tasks_pending, total_cost_usd: r.total_cost_usd,
            goals_total: 0, goals_completed: 0,
        };
    }
    for (const r of goalRows) {
        if (!stats[r.project_path]) {
            stats[r.project_path] = {
                tasks_total: 0, tasks_completed: 0, tasks_failed: 0,
                tasks_running: 0, tasks_pending: 0, total_cost_usd: 0,
                goals_total: 0, goals_completed: 0,
            };
        }
        stats[r.project_path].goals_total = r.goals_total;
        stats[r.project_path].goals_completed = r.goals_completed;
    }
    return stats;
}

/**
 * Get a summary of all projects in the ecosystem.
 */
export function getEcosystemSummary(): string {
    try {
        const projects = portfolioStmts.list.all() as Array<{
            name: string; path: string; lifecycle: string; description: string;
            ports: string | null; throttled: number; priority: number;
        }>;
        if (!projects.length) return '';
        const allStats = getAllProjectStats();
        return projects.map(p => {
            // Port summary — show web/api ports only for brevity
            let portTag = '';
            if (p.ports) {
                try {
                    const ports = typeof p.ports === 'string' ? JSON.parse(p.ports) : p.ports;
                    const portParts: string[] = [];
                    for (const [key, val] of Object.entries(ports)) {
                        const shortKey = key.replace(/.*\./, '').replace(/_port$/, '');
                        if (['web', 'api', 'port'].includes(shortKey)) {
                            portParts.push(`${shortKey}:${val}`);
                        }
                    }
                    if (portParts.length) portTag = ` [${portParts.join(', ')}]`;
                } catch {}
            }
            // Task queue state
            const stats = allStats[p.path] || {} as any;
            const queueParts: string[] = [];
            if (stats.tasks_running) queueParts.push(`${stats.tasks_running} running`);
            if (stats.tasks_pending) queueParts.push(`${stats.tasks_pending} pending`);
            if (stats.tasks_completed) queueParts.push(`${stats.tasks_completed} done`);
            const queueTag = queueParts.length ? ` (${queueParts.join(', ')})` : '';
            // Flags
            let flags = '';
            if (p.throttled) flags += ' [THROTTLED]';
            if (p.priority !== 5) flags += ` [priority: ${p.priority}]`;
            const desc = (p.description || '').slice(0, 60);
            return `- **${p.name}** (${p.lifecycle})${portTag}${queueTag}: ${desc}${flags}`;
        }).join('\n');
    } catch { return ''; }
}

/**
 * Build full context string for an autonomous task.
 */
export function buildTaskContext(projectPath: string, goalContext?: string, taskTitle?: string): string {
    const parts: string[] = [];

    parts.push(`## Autonomous Agent Context

You are an autonomous agent in Darron's development ecosystem.
- **Author:** Darron — Mackay, Queensland, Australia (UTC+10)
- **Conventions:** British English spelling, semantic commits (feat:, fix:, docs:, refactor:)
- **Execution mode:** Running via Claude Agent SDK — no human in the loop
- **Git:** Changes committed automatically on success, rolled back on failure
- Do NOT use plan mode (EnterPlanMode) — implement directly`);

    const claudeMd = readFileOrEmpty(path.join(projectPath, 'CLAUDE.md'), 6000);
    if (claudeMd) parts.push(`\n## Project Instructions\n\n${claudeMd}`);

    const status = readFileOrEmpty(path.join(projectPath, 'claude-context', 'CURRENT_STATUS.md'), 3000);
    if (status) parts.push(`\n## Current Project Status\n\n${status}`);

    const decisionsRaw = readFileOrEmpty(path.join(projectPath, 'claude-context', 'DECISIONS.md'), 8000);
    const settled = extractSettledDecisions(decisionsRaw);
    if (settled.length > 0) {
        const decisionsText = settled.slice(0, 5).join('\n\n---\n\n').slice(0, 2000);
        parts.push(`\n## Settled Architecture Decisions\n\nThese decisions are FINAL. Do NOT change without explicit user discussion.\n\n${decisionsText}`);
    }

    const techStack = detectProjectTechStack(projectPath);
    const learnings = getRelevantLearnings(techStack);
    if (learnings.length > 0) {
        let learningsText = '\n## Critical Cross-Project Learnings\n\n';
        for (const l of learnings) {
            if (l.severity === 'HIGH' && l.content) {
                learningsText += `### ${l.id} (HIGH): ${l.summary}\n\n${l.content}\n\n`;
            } else {
                learningsText += `- **${l.id}** (${l.severity}): ${l.summary}\n`;
            }
        }
        parts.push(learningsText);
    }

    const failures = getRecentFailures(projectPath);
    if (failures.length > 0) {
        let pitfallsText = '\n## Known Pitfalls (Recent Failures)\n\nPrevious tasks on this project hit these errors. Avoid repeating them:\n';
        for (const f of failures) {
            pitfallsText += `- **${f.error.slice(0, 120)}** (${f.count}x, last: ${f.lastSeen.slice(0, 10)})\n`;
        }
        parts.push(pitfallsText);
    }

    const ecosystem = getEcosystemSummary();
    if (ecosystem) parts.push(`\n## Development Ecosystem\n\nSister projects in this ecosystem:\n${ecosystem}\n\nNote: Tasks can depend on task IDs from any project/goal via \`depends_on\`. Port numbers shown above are allocated centrally — avoid conflicts when configuring services.`);

    if (goalContext) parts.push(`\n## Goal Context\n\nThis task is part of a larger goal:\n${goalContext.slice(0, 1000)}`);

    // DocAssist: inject documentation-specific instructions for docs tasks
    if (taskTitle && taskTitle.toLowerCase().startsWith('docs:')) {
        parts.push(`\n## Documentation Task Instructions

You are updating project documentation to reflect work that was just completed.

**Critical rules:**
- Read ALL existing claude-context/ files before updating
- Preserve existing style and conventions — append, don't replace
- Use British English throughout
- Record decisions with full ADR format (see DECISIONS.md for examples)
- Create session notes with author "Claude (autonomous)"
- Verify ARCHITECTURE.md reflects actual code structure, not planned structure
- Check git log to understand what was actually built

**Priority order:**
1. CURRENT_STATUS.md (always update)
2. Session note in claude-context/session-notes/ (always create)
3. DECISIONS.md (if significant choices were made)
4. ARCHITECTURE.md (if structure changed)
5. CLAUDE.md (if stage or stack changed)

See docs/docassist.md for the complete protocol.`);
    }

    parts.push(`\n## Knowledge Capture

If you encounter something worth capturing during this task, output structured markers in your final response:

For reusable lessons (bugs, gotchas, patterns):
[LEARNING]
severity: HIGH|MEDIUM|LOW
tech: Comma, Separated, Technologies
problem: What went wrong or was confusing
root_cause: Why it happened
solution: How to fix or avoid it
[/LEARNING]

For architecture/design choices:
[DECISION]
title: Short decision title
context: What prompted this choice
options: Brief options considered
decision: What was chosen and why
consequences: What this means going forward
[/DECISION]

Only flag genuinely reusable cross-project insights — not routine implementation steps.`);

    return parts.join('\n');
}
