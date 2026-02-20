import { Router, Request, Response } from 'express';
import { db, conversationStmts, conversationMessageStmts } from '../db';
import { generateId } from '../services/planning';
import { broadcast } from '../ws';
import { runSupervisorCycle } from '../services/supervisor';

const router = Router();

const listWithCounts = db.prepare(`
    SELECT c.*, COUNT(cm.id) as message_count
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

        // Wake supervisor to respond (fire and forget, only for human messages)
        if (finalRole === 'human') {
            runSupervisorCycle().catch(() => {});
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

export default router;
