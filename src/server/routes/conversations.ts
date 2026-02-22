import { Router, Request, Response } from 'express';
import { db, conversationStmts, conversationMessageStmts } from '../db';
import { generateId } from '../services/planning';
import { broadcast } from '../ws';
import { runSupervisorCycle } from '../services/supervisor';

const router = Router();

const listWithCounts = db.prepare(`
    SELECT c.*, COUNT(cm.id) as message_count,
        GROUP_CONCAT(DISTINCT cm.role) as participants
    FROM conversations c
    LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
`) as any;

/**
 * GET / -- List all conversations
 */
router.get('/', (req: Request, res: Response) => {
    try {
        const conversations = listWithCounts.all();
        res.json({ success: true, conversations });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST / -- Create a new conversation
 */
router.post('/', (req: Request, res: Response) => {
    try {
        const { title } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'title is required' });

        const id = generateId();
        const now = new Date().toISOString();
        conversationStmts.insert.run(id, title, 'open', now, now);

        const conversation = conversationStmts.get.get(id);
        res.json({ success: true, conversation });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /:id -- Get a single conversation with all its messages
 */
router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const messages = conversationMessageStmts.list.all(req.params.id);
        res.json({ success: true, conversation, messages });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/messages -- Add a message to a conversation
 */
router.post('/:id/messages', (req: Request<{ id: string }>, res: Response) => {
    try {
        const { content, role } = req.body;
        if (!content) return res.status(400).json({ success: false, error: 'content is required' });

        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const messageId = generateId();
        const now = new Date().toISOString();
        const finalRole = role || 'human';

        conversationMessageStmts.insert.run(messageId, req.params.id, finalRole, content, now);
        conversationStmts.updateTimestamp.run(now, req.params.id);

        const message = {
            id: messageId,
            conversation_id: req.params.id,
            role: finalRole,
            content,
            created_at: now
        };

        // Broadcast via WebSocket
        broadcast({
            type: 'conversation_message',
            conversation_id: req.params.id,
            message
        });

        res.json({ success: true, message });

        // Wake supervisor to respond (fire and forget)
        if (finalRole === 'human') {
            // Immediate wake for Darron
            runSupervisorCycle().catch(() => {});
        } else if (finalRole === 'leo') {
            // Cooldown-aware wake for Leo — respect 10-min contemplation interval
            const LEO_COOLDOWN_MS = 10 * 60 * 1000;
            const lastResponse = conversationMessageStmts.getLastSupervisorResponse.get(req.params.id) as any;
            if (lastResponse) {
                const elapsed = Date.now() - new Date(lastResponse.created_at).getTime();
                if (elapsed < LEO_COOLDOWN_MS) {
                    const delay = LEO_COOLDOWN_MS - elapsed;
                    setTimeout(() => runSupervisorCycle().catch(() => {}), delay);
                } else {
                    runSupervisorCycle().catch(() => {});
                }
            } else {
                runSupervisorCycle().catch(() => {});
            }
        }
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/resolve -- Mark a conversation as resolved
 */
router.post('/:id/resolve', (req: Request<{ id: string }>, res: Response) => {
    try {
        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const now = new Date().toISOString();
        conversationStmts.updateStatus.run('resolved', now, req.params.id);

        const updated = conversationStmts.get.get(req.params.id);
        res.json({ success: true, conversation: updated });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/reopen -- Reopen a resolved conversation
 */
router.post('/:id/reopen', (req: Request<{ id: string }>, res: Response) => {
    try {
        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const now = new Date().toISOString();
        conversationStmts.updateStatus.run('open', now, req.params.id);

        const updated = conversationStmts.get.get(req.params.id);
        res.json({ success: true, conversation: updated });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /search -- Full-text search across conversation messages
 * Query params:
 *   - q: search term (required)
 *   - limit: max results (default 20)
 *   - mode: 'text' (default, FTS5 search)
 */
router.get('/search', (req: Request, res: Response) => {
    try {
        const { q, limit = '20', mode = 'text' } = req.query;

        if (!q || typeof q !== 'string') {
            return res.status(400).json({ success: false, error: 'query parameter "q" is required' });
        }

        if (mode !== 'text') {
            return res.status(400).json({ success: false, error: 'only mode=text is currently supported' });
        }

        const resultLimit = Math.min(parseInt(limit as string, 10) || 20, 100);

        // FTS5 search query
        const searchStmt = db.prepare(`
            SELECT
                fts.id,
                cm.conversation_id,
                cm.role,
                cm.content,
                cm.created_at,
                c.title as conversation_title,
                c.status as conversation_status
            FROM conversation_messages_fts fts
            JOIN conversation_messages cm ON fts.id = cm.id
            JOIN conversations c ON cm.conversation_id = c.id
            WHERE fts.content MATCH ?
            ORDER BY rank
            LIMIT ?
        `) as any;

        let matches;
        try {
            matches = searchStmt.all(q, resultLimit);
        } catch (ftsErr: any) {
            // Handle FTS5 query syntax errors gracefully
            return res.status(400).json({
                success: false,
                error: `Invalid FTS5 query syntax: ${ftsErr.message}`
            });
        }

        // For each match, fetch 2 messages before and after for context
        const contextWindow = 2;
        const getContextStmt = db.prepare(`
            SELECT id, role, content, created_at
            FROM conversation_messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
        `) as any;

        const results = matches.map((match: any) => {
            // Get all messages for this conversation (could optimize with pagination later)
            const allMessages = getContextStmt.all(match.conversation_id);

            // Find the index of the matched message
            const matchIndex = allMessages.findIndex((msg: any) => msg.id === match.id);

            // Extract context: 2 before and 2 after
            const startIdx = Math.max(0, matchIndex - contextWindow);
            const endIdx = Math.min(allMessages.length, matchIndex + contextWindow + 1);
            const contextMessages = allMessages.slice(startIdx, endIdx);

            return {
                conversation_id: match.conversation_id,
                conversation_title: match.conversation_title,
                conversation_status: match.conversation_status,
                matched_message: {
                    id: match.id,
                    role: match.role,
                    content: match.content,
                    created_at: match.created_at
                },
                context_messages: contextMessages,
                created_at: match.created_at
            };
        });

        res.json({
            success: true,
            results,
            query: q,
            count: results.length
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
