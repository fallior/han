import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { CONTEXTS_DIR, BRIDGE_HISTORY } from '../db';
import { logBridgeEvent } from '../db';
import { getActiveSession, captureFullScrollback, stripAnsi, formatExport } from '../services/terminal';

const { execFile } = require('child_process');

const router = Router();

/**
 * GET /api/bridge/export -- Export terminal scrollback as markdown
 */
router.get('/api/bridge/export', (req: Request, res: Response) => {
    try {
        const session = getActiveSession();
        if (!session) {
            return res.status(400).json({ success: false, error: 'No active tmux session' });
        }

        const content = captureFullScrollback(session);
        if (!content) {
            return res.status(500).json({ success: false, error: 'Failed to capture terminal' });
        }

        const markdown = formatExport(content, session);

        // Auto-save to file
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const filename = `export-${id}.md`;
        const filepath = path.join(CONTEXTS_DIR, filename);
        fs.writeFileSync(filepath, markdown);

        const inject = req.query.inject === 'true';
        if (inject) {
            const cmd = `Read this context file — it contains the exported session: ${filepath}`;
            execFile('tmux', ['send-keys', '-t', session, '-l', cmd], (err: any) => {
                if (!err) {
                    execFile('tmux', ['send-keys', '-t', session, 'Enter']);
                }
            });
        }

        const clean = stripAnsi(content).replace(/\s+$/, '');
        const lineCount = clean.split('\n').length;

        logBridgeEvent('export', `Export (${lineCount} lines)`, { filename, session, lineCount });

        res.json({ success: true, filename, path: filepath, lineCount, injected: inject, content: markdown });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/bridge/import -- Import context from phone
 */
router.post('/api/bridge/import', (req: Request, res: Response) => {
    try {
        const { content, label, inject } = req.body;

        if (!content) {
            return res.status(400).json({ success: false, error: 'Missing content' });
        }

        // Save context file
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const filename = `${id}.md`;
        const filepath = path.join(CONTEXTS_DIR, filename);
        fs.writeFileSync(filepath, content);

        const entry = logBridgeEvent('import', label || 'Imported context', { filename });

        // Optionally inject a read command into Claude Code
        if (inject) {
            const session = getActiveSession();
            if (session) {
                const cmd = `Read this context file and follow the instructions: ${filepath}`;
                execFile('tmux', ['send-keys', '-t', session, '-l', cmd], (err: any) => {
                    if (!err) {
                        execFile('tmux', ['send-keys', '-t', session, 'Enter']);
                    }
                });
            }
        }

        res.json({ success: true, id: entry.id, filename, path: filepath });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/bridge/contexts -- List saved context files
 */
router.get('/api/bridge/contexts', (req: Request, res: Response) => {
    try {
        if (!fs.existsSync(CONTEXTS_DIR)) {
            return res.json({ success: true, contexts: [] });
        }

        const files = fs.readdirSync(CONTEXTS_DIR)
            .filter((f: string) => f.endsWith('.md'))
            .sort((a: string, b: string) => b.localeCompare(a));

        const contexts = files.map((f: string) => {
            const filepath = path.join(CONTEXTS_DIR, f);
            const stat = fs.statSync(filepath);
            const content = fs.readFileSync(filepath, 'utf8');
            return {
                filename: f,
                size: stat.size,
                created: stat.birthtime.toISOString(),
                preview: content.substring(0, 200)
            };
        });

        res.json({ success: true, contexts });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/bridge/contexts/:id -- Get a specific context file
 */
router.get('/api/bridge/contexts/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const filepath = path.join(CONTEXTS_DIR, path.basename(req.params.id));
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ success: false, error: 'Context not found' });
        }
        const content = fs.readFileSync(filepath, 'utf8');
        res.json({ success: true, content, filename: req.params.id });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/bridge/contexts/:id -- Delete a context file
 */
router.delete('/api/bridge/contexts/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const filepath = path.join(CONTEXTS_DIR, path.basename(req.params.id));
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ success: false, error: 'Context not found' });
        }
        fs.unlinkSync(filepath);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/bridge/handoff -- Structured handoff: combine task + context + inject
 */
router.post('/api/bridge/handoff', (req: Request, res: Response) => {
    try {
        const { task, context, workingDir } = req.body;

        if (!task) {
            return res.status(400).json({ success: false, error: 'Missing task description' });
        }

        // Build handoff prompt
        let prompt = task;
        if (context) {
            prompt += '\n\n## Context\n\n' + context;
        }
        if (workingDir) {
            prompt += '\n\nWorking directory: ' + workingDir;
        }

        // Save as context file
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const filename = `handoff-${id}.md`;
        const filepath = path.join(CONTEXTS_DIR, filename);
        fs.writeFileSync(filepath, prompt);

        logBridgeEvent('handoff', 'Handoff: ' + task.substring(0, 50), { filename });

        // Inject into Claude Code
        const session = getActiveSession();
        if (session) {
            const cmd = `Read this context file and follow the instructions: ${filepath}`;
            execFile('tmux', ['send-keys', '-t', session, '-l', cmd], (err: any) => {
                if (!err) {
                    execFile('tmux', ['send-keys', '-t', session, 'Enter']);
                }
            });
            res.json({ success: true, filename, injected: true });
        } else {
            res.json({ success: true, filename, injected: false, note: 'No active session — context saved for later' });
        }
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/bridge/history -- Bridge history: all import/export events
 */
router.get('/api/bridge/history', (req: Request, res: Response) => {
    try {
        if (!fs.existsSync(BRIDGE_HISTORY)) {
            return res.json({ success: true, history: [] });
        }
        const history = JSON.parse(fs.readFileSync(BRIDGE_HISTORY, 'utf8'));
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        res.json({ success: true, history: history.slice(0, limit) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
