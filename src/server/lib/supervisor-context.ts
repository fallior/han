/**
 * supervisor-context.ts — R3c-HB S1: the supervisor beat's CONTEXT-PROVIDER special
 * treatment, as a lib LEAF.
 *
 * Ported from supervisor-worker.ts:717-897 (`buildStateSnapshot`, 181 lines — the state no
 * other beat loads: running/pending tasks, active goals, recent completions/failures,
 * proposals, pending conversations, costs, portfolio, the idle-exploration nudge). The
 * worker keeps its own copy until the R3c flip retires it (S4/S5) — this leaf is ADDITIVE
 * with zero callers at extraction (the R3b build-and-hold rhythm; the driver wires it at
 * S1 proper).
 *
 * What changed at the port (each named — every port is an audit of the thing ported):
 *  - SLUG-PARAMETERISED (DEC-081): the worker's three `TODO Phase-3` markers
 *    (:814/:815/:846 — SELF_ROLE, scanRoles, getPersona all jim-hardcoded) are DISCHARGED
 *    here: `conversationRoleFor(slug)` / `conversationRolesExcept(slug)` /
 *    `getPersona(slug)`. The 4th agent's coordinator gets this for free.
 *  - DEC-105: the worker stamped `(UTC+10)` as a literal beside an ISO-Z time — a
 *    hardcoded zone claim that is false for any other garden (and for this one, half the
 *    year's readers). The leaf stamps UTC honestly and names the garden zone from the
 *    manifest.
 *  - Shared db statements (db.ts exports) instead of the worker's fork-local copies; the
 *    three inline prepares stay inline against the shared `db` handle.
 *  - `PROJECTS_DIR` resolves through hanHome() (the S195 lesson: never bake one agent's
 *    layout; project memory is a SHARED tree, not a per-slug one).
 *
 * 'human' stays EXPLICIT in scanRoles — it is not an agent conversationRole; deriving it
 * away would blind the scan to Darron (Jim's original blocking checkpoint, kept verbatim).
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, taskStmts, proposalStmts, supervisorStmts, portfolioStmts, conversationMessageStmts } from '../db';
import { conversationRolesExcept, conversationRoleFor, displayNameForRole, gardenTimezone } from './garden-manifest';
import { getPersona, getMentionPatterns } from '../services/village';
import { hanHome } from './paths';

const PEER_RESPONSE_COOLDOWN_MS = 10 * 60 * 1000;

function loadHanConfig(): any {
    try { return JSON.parse(fs.readFileSync(path.join(hanHome(), 'config.json'), 'utf8')); } catch { return {}; }
}

/** The coordinator beat's state snapshot — garden-wide operational state, slug-parameterised. */
export function buildStateSnapshot(slug: string): string {
    const parts: string[] = [];
    const now = new Date();
    const selfRole = conversationRoleFor(slug);

    parts.push(`## Current Time\n${now.toISOString()} (UTC; garden zone: ${gardenTimezone()})`);

    // Running tasks
    try {
        const running = taskStmts.listByStatus.all('running') as any[];
        const slotConfig = loadHanConfig().supervisor || {};
        const totalSlots = slotConfig.max_agent_slots || 8;
        const reserveSlots = slotConfig.reserve_slots || 2;
        const normalCap = totalSlots - reserveSlots;
        parts.push(`## Running Tasks (${running.length}/${totalSlots} slots, ${normalCap} normal + ${reserveSlots} reserve)`);
        if (running.length === 0) {
            parts.push('No tasks currently running.');
        } else {
            for (const t of running) {
                const project = t.project_path?.split('/').pop() || '?';
                parts.push(`- [${t.id}] ${t.title} (${t.model}, project: ${project}, started: ${t.started_at})`);
            }
        }
    } catch { parts.push('## Running Tasks\nUnable to query.'); }

    // Pending tasks (top 10)
    try {
        const pending = taskStmts.listByStatus.all('pending') as any[];
        parts.push(`## Pending Tasks (${pending.length} total)`);
        for (const t of pending.slice(0, 10)) {
            const project = t.project_path?.split('/').pop() || '?';
            const deps = t.depends_on ? ` [blocked by: ${t.depends_on}]` : '';
            parts.push(`- [${t.id}] ${t.title} (priority: ${t.priority}, model: ${t.model}, project: ${project})${deps}`);
        }
        if (pending.length > 10) parts.push(`  ... and ${pending.length - 10} more`);
    } catch { parts.push('## Pending Tasks\nUnable to query.'); }

    // Active goals
    try {
        const goals = db.prepare(
            "SELECT * FROM goals WHERE status IN ('active', 'decomposing', 'planning') ORDER BY created_at DESC"
        ).all() as any[];
        parts.push(`## Active Goals (${goals.length})`);
        for (const g of goals) {
            const project = g.project_path?.split('/').pop() || '?';
            const desc = g.description?.slice(0, 80) || '?';
            parts.push(`- [${g.id}] ${desc} — ${g.tasks_completed}/${g.task_count} done, ${g.tasks_failed} failed, $${(g.total_cost_usd || 0).toFixed(4)} (project: ${project})`);
        }
    } catch { parts.push('## Active Goals\nUnable to query.'); }

    // Recent completions (last 2 hours)
    try {
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        const recent = db.prepare(
            "SELECT * FROM tasks WHERE status IN ('done', 'failed') AND completed_at > ? ORDER BY completed_at DESC LIMIT 10"
        ).all(twoHoursAgo) as any[];
        if (recent.length > 0) {
            parts.push(`## Recent Completions (last 2h)`);
            for (const t of recent) {
                const icon = t.status === 'done' ? 'OK' : 'FAIL';
                parts.push(`- ${icon}: ${t.title} ($${(t.cost_usd || 0).toFixed(4)}, ${t.model})`);
            }
        }
    } catch { /* skip */ }

    // Recent failures needing attention
    try {
        const recentFailed = db.prepare(
            "SELECT * FROM tasks WHERE status = 'failed' AND retry_count >= 3 ORDER BY completed_at DESC LIMIT 5"
        ).all() as any[];
        if (recentFailed.length > 0) {
            parts.push(`## Failures Exhausted Retries`);
            for (const f of recentFailed) {
                parts.push(`- [${f.id}] ${f.title}: ${(f.error || '').slice(0, 100)} (retries: ${f.retry_count})`);
            }
        }
    } catch { /* skip */ }

    // Pending proposals
    try {
        const proposals = proposalStmts.listByStatus.all('pending') as any[];
        if (proposals.length > 0) {
            parts.push(`## Pending Knowledge Proposals (${proposals.length})`);
            for (const p of proposals.slice(0, 5)) {
                parts.push(`- [${p.type}] ${p.title}`);
            }
        }
    } catch { /* skip */ }

    // Pending conversations — 'human' explicit (never derived away: not an agent role;
    // losing it would blind the scan to Darron). Peers registry-derived; self excluded.
    try {
        const scanRoles = ['human', ...conversationRolesExcept(slug)];
        const rolePlaceholders = scanRoles.map(() => '?').join(', ');
        const pendingConversations = db.prepare(`
            SELECT DISTINCT c.id, c.title, cm.role as sender_role, cm.content, cm.created_at
            FROM conversations c
            JOIN conversation_messages cm ON c.id = cm.conversation_id
            WHERE c.status = 'open'
            AND (c.discussion_type IS NULL OR (c.discussion_type NOT LIKE '%-question' AND c.discussion_type NOT LIKE '%-postulate'))
            AND cm.role IN (${rolePlaceholders})
            AND NOT EXISTS (
                SELECT 1 FROM conversation_messages cm2
                WHERE cm2.conversation_id = c.id
                AND cm2.role = ?
                AND cm2.created_at > cm.created_at
            )
            ORDER BY cm.created_at DESC
        `).all(...scanRoles, selfRole) as any[];

        const filteredConversations = pendingConversations.filter((conv: any) => {
            if (conv.sender_role === 'human') return true; // humans never wait on a peer cooldown
            const lastResponse = conversationMessageStmts.getLastResponseByRole.get(conv.id, selfRole) as any;
            if (!lastResponse) return true;
            return (Date.now() - new Date(lastResponse.created_at).getTime()) >= PEER_RESPONSE_COOLDOWN_MS;
        });

        if (filteredConversations.length > 0) {
            parts.push(`## Pending Conversations (${filteredConversations.length})`);
            const selfPersona = getPersona(slug);
            const mentionRes = selfPersona ? getMentionPatterns(selfPersona).map(p => new RegExp(p, 'i')) : [];
            for (const conv of filteredConversations.slice(0, 5)) {
                const sender = displayNameForRole(conv.sender_role);
                const msgPreview = (conv.content || '').slice(0, 200).replace(/\n/g, ' ');
                const timestamp = conv.created_at?.split('T')[0] || '?';
                const mentioned = mentionRes.some(re => re.test(conv.content || '')) ? ' [MENTIONED BY NAME — respond promptly]' : '';
                parts.push(`- [${conv.id}] ${conv.title} (from ${sender}): "${msgPreview}..." (posted: ${timestamp})${mentioned}`);
            }
            if (filteredConversations.length > 5) parts.push(`  ... and ${filteredConversations.length - 5} more`);
        }
    } catch { /* skip */ }

    // Coordinator cost tracking
    try {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const costRow = supervisorStmts.getCostSince.get(todayStart) as any;
        const todayCost = costRow?.total || 0;
        parts.push(`## Supervisor Costs\n- Today: $${todayCost.toFixed(4)}`);
    } catch { /* skip */ }

    // Portfolio overview
    try {
        const projects = portfolioStmts.list.all() as any[];
        if (projects.length > 0) {
            const projectsDir = path.join(hanHome(), 'memory', 'projects');
            parts.push(`## Portfolio (${projects.length} projects)`);
            for (const p of projects) {
                const memFile = path.join(projectsDir, `${p.name}.md`);
                const hasMemory = fs.existsSync(memFile);
                const memSize = hasMemory ? fs.statSync(memFile).size : 0;
                const depth = memSize < 200 ? 'SHALLOW' : memSize < 800 ? 'BASIC' : 'DEEP';
                parts.push(`- **${p.name}** (${p.lifecycle || 'active'}): path=${p.path}, knowledge=${depth} (${memSize} bytes)`);
            }
        }
    } catch { /* skip */ }

    // Suggest exploration when idle
    try {
        const running = (taskStmts.listByStatus.all('running') as any[]).length;
        const pending = (taskStmts.listByStatus.all('pending') as any[]).length;
        if (running === 0 && pending <= 2) {
            parts.push(`## Exploration Opportunity`);
            parts.push(`System is idle — this is a good time to explore projects and deepen your knowledge.`);
            parts.push(`Use your Read/Glob/Grep/Bash tools to examine project codebases.`);
            parts.push(`Focus on projects with SHALLOW or BASIC knowledge depth.`);
            parts.push(`Key files to look for: CLAUDE.md, ARCHITECTURE.md, package.json, README.md, src/ structure.`);
            parts.push(`After exploring, use update_memory to enrich the relevant projects/*.md file.`);
        }
    } catch { /* skip */ }

    return parts.join('\n\n');
}
