import fs from 'fs';
import path from 'path';
import os from 'os';
import { db, proposalStmts } from '../db';

function generateId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Parse key: value fields from a structured marker block.
 */
function parseMarkerFields(block: string): Record<string, string> {
    const fields: Record<string, string> = {};
    let currentKey: string | null = null;
    for (const line of block.split('\n')) {
        const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1].toLowerCase();
            fields[currentKey] = kvMatch[2].trim();
        } else if (currentKey && line.trim()) {
            fields[currentKey] += ' ' + line.trim();
        }
    }
    return fields;
}

/**
 * Extract [LEARNING]...[/LEARNING] blocks from task result text.
 */
export function extractProposedLearnings(resultText: string) {
    if (!resultText) return [];
    const blocks: Array<{
        severity: string;
        tech: string;
        problem: string;
        root_cause: string;
        solution: string;
        raw: string;
    }> = [];
    const regex = /\[LEARNING\]\s*\n([\s\S]*?)\[\/LEARNING\]/g;
    let match;
    while ((match = regex.exec(resultText)) !== null) {
        const fields = parseMarkerFields(match[1]);
        if (fields.problem && fields.solution) {
            blocks.push({
                severity: (fields.severity || 'MEDIUM').toUpperCase(),
                tech: fields.tech || '',
                problem: fields.problem,
                root_cause: fields.root_cause || '',
                solution: fields.solution,
                raw: match[0]
            });
        }
    }
    return blocks;
}

/**
 * Extract [DECISION]...[/DECISION] blocks from task result text.
 */
export function extractProposedDecisions(resultText: string) {
    if (!resultText) return [];
    const blocks: Array<{
        title: string;
        context: string;
        options: string;
        decision: string;
        consequences: string;
        raw: string;
    }> = [];
    const regex = /\[DECISION\]\s*\n([\s\S]*?)\[\/DECISION\]/g;
    let match;
    while ((match = regex.exec(resultText)) !== null) {
        const fields = parseMarkerFields(match[1]);
        if (fields.title && fields.decision) {
            blocks.push({
                title: fields.title,
                context: fields.context || '',
                options: fields.options || '',
                decision: fields.decision,
                consequences: fields.consequences || '',
                raw: match[0]
            });
        }
    }
    return blocks;
}

/**
 * Map tech stack to a learning category directory name.
 */
export function determineLearningCategory(techList: string[]): string {
    const categoryMap: Record<string, string> = {
        'javascript': 'javascript', 'typescript': 'javascript', 'node.js': 'javascript',
        'react': 'javascript', 'express': 'javascript',
        'cloudflare': 'cloudflare', 'workers': 'cloudflare', 'd1': 'cloudflare',
        'drizzle': 'drizzle', 'drizzle orm': 'drizzle',
        'tanstack': 'tanstack', 'bun': 'bun', 'sqlite': 'javascript',
        'claude agent sdk': 'claude-agent-sdk',
    };
    for (const tech of techList) {
        const key = tech.toLowerCase();
        if (categoryMap[key]) return categoryMap[key];
    }
    return techList[0]
        ? techList[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : 'general';
}

/**
 * Read a file or return empty string on failure.
 */
function readFileOrEmpty(filepath: string, maxChars = 5000): string {
    try {
        if (!fs.existsSync(filepath)) return '';
        return fs.readFileSync(filepath, 'utf8').slice(0, maxChars);
    } catch { return ''; }
}

/**
 * Write an approved learning to ~/Projects/_learnings/ and update INDEX.md.
 */
export function writeLearning(data: { severity: string; tech: string; problem: string; root_cause: string; solution: string }, projectPath: string): string {
    const learningsDir = path.join(os.homedir(), 'Projects', '_learnings');
    const indexPath = path.join(learningsDir, 'INDEX.md');
    const indexContent = readFileOrEmpty(indexPath, 50000);

    // Calculate next learning ID
    const idMatches = [...indexContent.matchAll(/\bL(\d+)\b/g)];
    const maxNum = idMatches.reduce((max, m) => Math.max(max, parseInt(m[1], 10)), 0);
    const nextId = `L${String(maxNum + 1).padStart(3, '0')}`;

    // Determine category directory
    const techList = data.tech.split(',').map(t => t.trim()).filter(Boolean);
    const category = determineLearningCategory(techList);
    const categoryDir = path.join(learningsDir, category);
    if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });

    // Create filename
    const safeName = data.problem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const filePath = path.join(categoryDir, `${safeName}.md`);
    const relPath = `${category}/${safeName}.md`;
    const projectName = path.basename(projectPath);
    const today = new Date().toISOString().slice(0, 10);

    // Write learning file
    const content = `# ${nextId}: ${data.problem.slice(0, 80)}

**Severity:** ${data.severity}
**Tech Stack:** ${data.tech}
**Discovered:** ${today} in ${projectName} (automated task)

## Problem

${data.problem}

## Root Cause

${data.root_cause || 'Not identified'}

## Solution

${data.solution}

## References

- Captured automatically by Hortus Arbor Nostra automator
`;
    fs.writeFileSync(filePath, content);

    // Update INDEX.md — add to "Index by ID" table
    let updated = indexContent;
    const idTableEnd = updated.match(/(\| L\d+ \|[^\n]+\n)(\n---)/);
    if (idTableEnd) {
        const newRow = `| ${nextId} | ${data.severity} | [${relPath}](${relPath}) | ${data.problem.slice(0, 80)} |\n`;
        updated = updated.replace(idTableEnd[0], idTableEnd[1] + newRow + idTableEnd[2]);
    }

    // Add to "Index by Tech Stack" section
    for (const tech of techList) {
        const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sectionRegex = new RegExp(`(### [^\\n]*${escaped}[^\\n]*\\n)`, 'i');
        const sectionMatch = updated.match(sectionRegex);
        if (sectionMatch) {
            const afterHeader = updated.indexOf(sectionMatch[0]) + sectionMatch[0].length;
            const rest = updated.slice(afterHeader);
            const nextHeading = rest.search(/\n###? /);
            const insertAt = nextHeading >= 0 ? afterHeader + nextHeading : afterHeader + rest.length;
            const entry = `- **${nextId}** (${data.severity}): ${data.problem.slice(0, 80)}\n`;
            updated = updated.slice(0, insertAt) + entry + updated.slice(insertAt);
            break;
        }
    }

    fs.writeFileSync(indexPath, updated);
    console.log(`[Proposals] Learning ${nextId} written to ${filePath}`);
    return filePath;
}

/**
 * Append an approved decision to the project's DECISIONS.md.
 */
export function writeDecision(data: { title: string; context: string; options: string; decision: string; consequences: string }, projectPath: string): string {
    const decisionsPath = path.join(projectPath, 'claude-context', 'DECISIONS.md');
    const content = readFileOrEmpty(decisionsPath, 100000);

    // Calculate next DEC number
    const decMatches = [...content.matchAll(/DEC-(\d+)/g)];
    const maxDec = decMatches.reduce((max, m) => Math.max(max, parseInt(m[1], 10)), 0);
    const nextNum = String(maxDec + 1).padStart(3, '0');
    const decId = `DEC-${nextNum}`;
    const today = new Date().toISOString().slice(0, 10);

    // Build decision entry
    const entry = `\n### ${decId}: ${data.title}

**Date**: ${today}
**Author**: Hortus Arbor Nostra (automated)
**Status**: Accepted

#### Context

${data.context}

#### Options Considered

${data.options}

#### Decision

${data.decision}

#### Consequences

${data.consequences}

---
`;

    let updated = content;

    // Add to Decision Index table
    const indexRow = `| ${decId} | ${data.title} | Accepted | ${today} |`;
    const indexTableEnd = updated.match(/(\| DEC-\d+ \|[^\n]+\n)(\n---)/);
    if (indexTableEnd) {
        updated = updated.replace(indexTableEnd[0], indexTableEnd[1] + indexRow + '\n' + indexTableEnd[2]);
    }

    // Insert entry before "## Template" section
    const templateIdx = updated.indexOf('## Template');
    if (templateIdx >= 0) {
        updated = updated.slice(0, templateIdx) + entry + '\n' + updated.slice(templateIdx);
    } else {
        updated += entry;
    }

    fs.writeFileSync(decisionsPath, updated);
    console.log(`[Proposals] Decision ${decId} written to ${decisionsPath}`);
    return decisionsPath;
}

/**
 * Extract and store knowledge proposals from task result text.
 */
export function extractAndStoreProposals(taskId: string, resultText: string, projectPath: string): number {
    const learnings = extractProposedLearnings(resultText);
    const decisions = extractProposedDecisions(resultText);
    const now = new Date().toISOString();

    for (const l of learnings) {
        const id = generateId();
        proposalStmts.insert.run(
            id, taskId, projectPath, 'learning', 'pending',
            l.problem.slice(0, 100), l.raw, JSON.stringify(l), now
        );
        console.log(`[Proposals] Learning extracted from task ${taskId}: ${l.problem.slice(0, 60)}`);
    }

    for (const d of decisions) {
        const id = generateId();
        proposalStmts.insert.run(
            id, taskId, projectPath, 'decision', 'pending',
            d.title, d.raw, JSON.stringify(d), now
        );
        console.log(`[Proposals] Decision extracted from task ${taskId}: ${d.title}`);
    }

    const total = learnings.length + decisions.length;
    return total;
}
