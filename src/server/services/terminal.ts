import { execFileSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { HAN_DIR, PENDING_DIR } from '../db';

/**
 * List all active tmux sessions on the host.
 */
export function listActiveSessions(): string[] {
    try {
        const output = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return output.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Pick the tmux session this server mirrors.
 *
 * HAN_SESSION is our construct — set by agent-server-watchdog when an
 * agent-server (hanjim, hanleo, etc.) is launched, so each agent-server
 * is pinned to its own tmux. We honour it directly instead of guessing
 * by name prefix. If HAN_SESSION isn't set (e.g. systemd-managed
 * han-server), fall back to the first session tmux returns.
 */
export function getActiveSession(): string | null {
    const sessions = listActiveSessions();
    const pinned = process.env.HAN_SESSION;
    if (pinned && sessions.includes(pinned)) {
        return pinned;
    }
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

// Smart terminal log — uses tmux diff semantics to record only meaningful changes
// Old file (terminal-log.txt) kept as archive. New file records cleanly.
const TERMINAL_LOG = path.join(HAN_DIR, 'terminal-log-v2.txt');
let prevCapture: string[] = [];
let lastTimestamp = 0;
const TIMESTAMP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Action verb pattern — these overwrite in-place but we want to capture them.
// Includes in-progress verbs (Percolating...) and completion verbs (Worked for 2m).
// The final "Worked for" line with token counts is the keeper; minor duplication
// from in-progress verbs is acceptable — dedup later if needed.
const ACTION_VERB_RE = /^\s*[✻✶✽⠋⠙⠹●◉]\s*(Worked|Cooked|Churned|Brewed|Shimmied|Calculated|Percolated|Baked|Crunched|Toiled|Crafted|Polished|Simmered|Contemplated|Meditated|Marinated|Choreographed|Percolating|Shimmying|Brewing|Choreographing|Simmering|Polishing|Contemplating|Meditating|Marinating|Toiling|Crafting|Working|Cooking|Churning|Calculating|Mulling|Reasoning)/i;

// Noise patterns — never write these to the log
const NOISE_RE = [
    /^\s*[⏵⏴].*bypass permissions/,           // permission mode indicator
    /^\s*esc to interrupt\s*$/,                 // hint
    /^\s*shift\+tab to cycle\s*$/,              // hint
    /^[\s│─┌┐└┘├┤┬┴┼╔╗╚╝║═▐▛▜▝▘]+$/,         // box-drawing only
    /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*$/,                  // lone spinner chars
];

function isNoise(line: string): boolean {
    return NOISE_RE.some(re => re.test(line));
}

export function appendToLog(content: string): void {
    try {
        const lines = content.split('\n');
        const now = Date.now();

        // First capture — write everything (minus noise), this is session start
        if (prevCapture.length === 0) {
            let output = `\n--- ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} ---\n`;
            lastTimestamp = now;
            for (const line of lines) {
                if (!isNoise(line)) output += line + '\n';
            }
            fs.appendFileSync(TERMINAL_LOG, output);
            prevCapture = lines.slice();
            return;
        }

        // Compare only the LAST LINE of the previous capture against the current
        // capture. Find where that line appears in the current content — everything
        // after it is new. This is simple and robust:
        //   - When the terminal scrolls, old last line is now higher up, new content below
        //   - When in-place overwrite happens, old last line is still there (or replaced)
        //
        // The last non-empty line of prev is the anchor. If we can't find it,
        // this is a major screen change (compaction) — write everything new.

        const toWrite: string[] = [];

        // Find last non-empty line from previous capture as our anchor
        let anchor = '';
        for (let i = prevCapture.length - 1; i >= 0; i--) {
            if (prevCapture[i].trim() !== '') {
                anchor = prevCapture[i];
                break;
            }
        }

        if (!anchor) {
            // Previous was all empty — write everything
            for (const line of lines) {
                if (!isNoise(line) && line.trim() !== '') toWrite.push(line);
            }
        } else {
            // Find the anchor in current capture (search from the end)
            let anchorIdx = -1;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i] === anchor) {
                    anchorIdx = i;
                    break;
                }
            }

            if (anchorIdx >= 0) {
                // Found anchor — new content is everything after it
                for (let i = anchorIdx + 1; i < lines.length; i++) {
                    if (!isNoise(lines[i]) && lines[i].trim() !== '') {
                        toWrite.push(lines[i]);
                    }
                }

                // Check the line AT anchorIdx — if it changed (anchor was the
                // second-to-last line and the last line changed in place), check
                // for action verbs in lines near the bottom that differ from prev
                const prevLastIdx = prevCapture.length - 1;
                const checkFrom = Math.max(0, anchorIdx - 5);
                const checkTo = Math.min(anchorIdx, prevCapture.length);
                for (let i = checkFrom; i < checkTo; i++) {
                    const prevLine = prevCapture[prevCapture.length - (anchorIdx - i) - 1];
                    if (prevLine && lines[i] !== prevLine && ACTION_VERB_RE.test(lines[i])) {
                        toWrite.push(lines[i]);
                    }
                }
            } else {
                // Anchor not found — major screen change (compaction/context refresh).
                // Write all new non-noise content.
                toWrite.push('─── context refreshed ───');
                for (const line of lines) {
                    if (!isNoise(line) && line.trim() !== '') {
                        toWrite.push(line);
                    }
                }
            }
        }

        if (toWrite.length === 0) {
            prevCapture = lines.slice();
            return;
        }

        let output = '';

        // Timestamp every 5 minutes
        if (now - lastTimestamp >= TIMESTAMP_INTERVAL) {
            output += `\n--- ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} ---\n`;
            lastTimestamp = now;
        }

        output += toWrite.join('\n') + '\n';
        fs.appendFileSync(TERMINAL_LOG, output);
        prevCapture = lines.slice();
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
