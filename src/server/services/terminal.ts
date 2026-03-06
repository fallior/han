import { execFileSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { HAN_DIR, PENDING_DIR } from '../db';

/**
 * List all active han tmux sessions
 */
export function listActiveSessions(): string[] {
    try {
        const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return output.trim().split('\n')
            .filter(s => s.startsWith('han'))
            .filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Get the first active han session (or null)
 */
export function getActiveSession(): string | null {
    const sessions = listActiveSessions();
    return sessions.length > 0 ? sessions[0] : null;
}

/**
 * Capture terminal content from a tmux session (plain text, no ANSI, full scrollback)
 */
export function captureTerminal(session: string): { content: string; session: string } | null {
    try {
        const content = execFileSync('tmux', [
            'capture-pane', '-t', session, '-p', '-S', '-'
        ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 });
        return { content, session };
    } catch {
        return null;
    }
}

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
               .replace(/\x1b\][^\x07]*\x07/g, '')
               .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Capture full scrollback from a tmux session (entire history)
 */
export function captureFullScrollback(session: string): string | null {
    try {
        const content = execFileSync('tmux', [
            'capture-pane', '-t', session, '-p', '-S', '-'
        ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 });
        return content;
    } catch {
        return null;
    }
}

/**
 * Format session content as markdown for export
 */
export function formatExport(content: string, session: string): string {
    const timestamp = new Date().toISOString();
    const clean = stripAnsi(content).replace(/\s+$/, '');

    return `# Claude Code Session Export\n\n` +
           `**Session**: ${session}\n` +
           `**Exported**: ${timestamp}\n\n` +
           `---\n\n` +
           '```\n' + clean + '\n```\n';
}

// Append-only terminal log with timestamps
const TERMINAL_LOG = path.join(HAN_DIR, 'terminal-log.txt');
let lastLoggedLines: string[] = [];
let lastTimestamp = 0;
const TIMESTAMP_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function appendToLog(content: string): void {
    try {
        const lines = content.split('\n');
        const now = Date.now();

        // Find new lines by matching the tail of lastLoggedLines against lines
        let newStart = 0;
        if (lastLoggedLines.length > 0) {
            // Find where lastLoggedLines ends within current content
            const lastFew = lastLoggedLines.slice(-20);
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i] === lastFew[lastFew.length - 1]) {
                    // Check if the preceding lines match too
                    let match = true;
                    for (let j = 1; j < lastFew.length && i - j >= 0; j++) {
                        if (lines[i - j] !== lastFew[lastFew.length - 1 - j]) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        newStart = i + 1;
                        break;
                    }
                }
            }
        }

        if (newStart >= lines.length && lastLoggedLines.length > 0) return; // nothing new

        const newLines = lastLoggedLines.length === 0 ? lines : lines.slice(newStart);
        if (newLines.length === 0) return;

        let output = '';

        // Add timestamp every 5 minutes
        if (now - lastTimestamp >= TIMESTAMP_INTERVAL) {
            output += `\n--- ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} ---\n`;
            lastTimestamp = now;
        }

        output += newLines.join('\n') + '\n';
        fs.appendFileSync(TERMINAL_LOG, output);
        lastLoggedLines = lines;
    } catch { /* best effort */ }
}

interface Prompt {
    tmux_session?: string;
    terminal_content?: string;
    [key: string]: unknown;
}

/**
 * Read all pending prompts with live terminal content
 */
export function readPendingPrompts(): Prompt[] {
    const prompts: Prompt[] = [];

    if (!fs.existsSync(PENDING_DIR)) return prompts;

    const files = fs.readdirSync(PENDING_DIR)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Newest first

    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(PENDING_DIR, file), 'utf8');
            const prompt: Prompt = JSON.parse(content);

            // Capture tmux pane content to get the actual prompt with options
            if (prompt.tmux_session) {
                try {
                    const paneContent = execFileSync('tmux', [
                        'capture-pane', '-t', prompt.tmux_session, '-p', '-e'
                    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                    prompt.terminal_content = paneContent;
                } catch {
                    // tmux session may not exist
                }
            }

            prompts.push(prompt);
        } catch (err: any) {
            console.error(`Error reading prompt file ${file}:`, err.message);
        }
    }

    return prompts;
}

// Track last broadcast content for diffing
let lastBroadcastContent = '';

export function getLastBroadcastContent(): string {
    return lastBroadcastContent;
}

export function setLastBroadcastContent(content: string): void {
    lastBroadcastContent = content;
}
