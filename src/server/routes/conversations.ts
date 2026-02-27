import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, conversationStmts, conversationMessageStmts } from '../db';
import { generateId } from '../services/planning';
import { broadcast } from '../ws';
import { runSupervisorCycle, isOpusSlotBusy } from '../services/supervisor';
import { catalogueConversation, catalogueAllUncatalogued } from '../services/cataloguing';
import { callLLM } from '../orchestrator';

// ── Mention detection ────────────────────────────────────────
const LEO_MENTION = /\b(hey\s+leo|@leo|leo[,:])\b/i;
const JIM_MENTION = /\b(hey\s+jim|@jim|jim[,:])\b/i;
const SIGNALS_DIR = path.join(process.env.HOME || '', '.claude-remote', 'signals');
fs.mkdirSync(SIGNALS_DIR, { recursive: true });

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
 * GET /grouped -- List conversations grouped by temporal period
 * Returns: { periods: { 'today': { count, conversations }, 'this_week': {...}, ... } }
 */
router.get('/grouped', (req: Request, res: Response) => {
    try {
        const conversations = listWithCounts.all() as any[];
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

        const groups: Record<string, any[]> = {
            today: [],
            this_week: [],
            last_week: [],
            this_month: [],
            older: []
        };

        for (const conv of conversations) {
            const convDate = new Date(conv.updated_at);
            const convDateOnly = new Date(convDate.getFullYear(), convDate.getMonth(), convDate.getDate());

            if (convDateOnly.getTime() === today.getTime()) {
                groups.today.push(conv);
            } else if (convDateOnly.getTime() >= weekAgo.getTime()) {
                groups.this_week.push(conv);
            } else if (convDateOnly.getTime() >= twoWeeksAgo.getTime()) {
                groups.last_week.push(conv);
            } else if (convDateOnly.getTime() >= monthAgo.getTime()) {
                groups.this_month.push(conv);
            } else {
                groups.older.push(conv);
            }
        }

        const periods = {
            today: { count: groups.today.length, label: 'Today', conversations: groups.today },
            this_week: { count: groups.this_week.length, label: 'This Week', conversations: groups.this_week },
            last_week: { count: groups.last_week.length, label: 'Last Week', conversations: groups.last_week },
            this_month: { count: groups.this_month.length, label: 'This Month', conversations: groups.this_month },
            older: { count: groups.older.length, label: 'Older', conversations: groups.older }
        };

        res.json({ success: true, periods });
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

        // FTS5 search query with snippet highlighting
        const searchStmt = db.prepare(`
            SELECT
                fts.id,
                cm.conversation_id,
                cm.role,
                cm.content,
                cm.created_at,
                c.title as conversation_title,
                c.status as conversation_status,
                snippet(conversation_messages_fts, 2, '<mark>', '</mark>', '...', 32) as snippet
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
                    snippet: match.snippet,
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

        // Jim-wake signal when Opus is busy
        if (finalRole === 'human' && isOpusSlotBusy()) {
            try {
                const signalFile = path.join(SIGNALS_DIR, `jim-wake-${Date.now()}`);
                fs.writeFileSync(signalFile, JSON.stringify({
                    conversationId: req.params.id,
                    messageId,
                    timestamp: now,
                    reason: 'human_message_while_opus_busy'
                }));
                console.log(`[Conversations] Jim wake signal written: Opus busy when human message arrived`);
            } catch (err: any) {
                console.error(`[Conversations] Failed to write jim-wake signal: ${err.message}`);
            }
        }

        // Detect mentions and write signal files
        if (LEO_MENTION.test(content)) {
            try {
                const signalFile = path.join(SIGNALS_DIR, `leo-wake-${req.params.id}`);
                fs.writeFileSync(signalFile, JSON.stringify({
                    conversationId: req.params.id,
                    mentionedAt: now,
                    messagePreview: content.slice(0, 200),
                }));
                console.log(`[Mention] Leo mentioned in ${req.params.id} — signal written`);
            } catch (err: any) {
                console.error(`[Mention] Failed to write Leo signal: ${err.message}`);
            }
        }

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
 * Triggers automatic cataloguing (fire and forget)
 */
router.post('/:id/resolve', (req: Request<{ id: string }>, res: Response) => {
    try {
        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const now = new Date().toISOString();
        conversationStmts.updateStatus.run('resolved', now, req.params.id);

        const updated = conversationStmts.get.get(req.params.id);
        res.json({ success: true, conversation: updated });

        // Trigger cataloguing in background (fire and forget)
        catalogueConversation(req.params.id).catch(err =>
            console.error(`[Routes] Error cataloguing conversation ${req.params.id}:`, err.message)
        );
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
 * POST /:id/catalogue -- Manually trigger cataloguing for a conversation
 */
router.post('/:id/catalogue', (req: Request<{ id: string }>, res: Response) => {
    try {
        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        res.json({ success: true, message: 'Cataloguing triggered' });

        // Trigger cataloguing in background (fire and forget)
        catalogueConversation(req.params.id).catch(err =>
            console.error(`[Routes] Error cataloguing conversation ${req.params.id}:`, err.message)
        );
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /recatalogue-all -- Re-catalogue all uncatalogued resolved conversations (admin only)
 * Useful for backfilling summaries after schema changes or prompt improvements
 */
router.post('/recatalogue-all', async (req: Request, res: Response) => {
    try {
        // TODO: Add authentication check for admin-only access
        // For now, this endpoint is available to anyone with access to the API

        res.json({ success: true, message: 'Recataloguing started' });

        // Run cataloguing in background (fire and forget)
        catalogueAllUncatalogued()
            .then(count => {
                console.log(`[Routes] Recatalogued ${count} conversations`);
            })
            .catch(err =>
                console.error('[Routes] Error in recatalogue-all:', err.message)
            );
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /search/semantic -- AI-powered semantic search across conversations
 * Body:
 *   - query: search query (required)
 *   - limit: max results (default 10, max 50)
 */
router.post('/search/semantic', async (req: Request, res: Response) => {
    try {
        const { query, limit = 10 } = req.body;

        if (!query || typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({ success: false, error: 'query is required' });
        }

        const resultLimit = Math.min(parseInt(String(limit), 10) || 10, 50);

        // Fetch all conversations that have summaries (catalogued conversations)
        const cataloguedConversations = db.prepare(`
            SELECT id, title, summary, topics
            FROM conversations
            WHERE summary IS NOT NULL
            ORDER BY updated_at DESC
        `).all() as Array<{ id: string; title: string; summary: string | null; topics: string | null }>;

        if (cataloguedConversations.length === 0) {
            return res.json({
                success: true,
                results: [],
                query,
                count: 0,
                message: 'No catalogued conversations found. Run cataloguing first.'
            });
        }

        // Build prompt for Claude Haiku to rank conversations by semantic relevance
        const systemPrompt = `You are a conversation search assistant. Given a user query and a list of conversations with their summaries, rank the conversations by semantic relevance to the query.

Return a JSON array of conversation IDs ranked by relevance (most relevant first), with a relevance score (0-100) and a brief reasoning for each match.

Format: [{"conversation_id": "...", "relevance_score": 95, "reasoning": "..."}, ...]

Only include conversations that are actually relevant to the query. If no conversations match, return an empty array.`;

        const conversationList = cataloguedConversations.map((c, idx) => {
            const topics = c.topics ? JSON.parse(c.topics) : [];
            return `${idx + 1}. ID: ${c.id}
   Title: ${c.title}
   Summary: ${c.summary || 'No summary'}
   Topics: ${topics.join(', ') || 'None'}`;
        }).join('\n\n');

        const userPrompt = `User query: "${query}"

Conversations to rank:

${conversationList}

Return JSON array of relevant conversations ranked by relevance.`;

        // Call LLM to get ranked results
        let rankedResults: Array<{ conversation_id: string; relevance_score: number; reasoning: string }>;
        try {
            const llmResult = await callLLM<Array<{ conversation_id: string; relevance_score: number; reasoning: string }>>(
                systemPrompt,
                userPrompt,
                { timeout: 30000 }
            );
            rankedResults = Array.isArray(llmResult.response) ? llmResult.response : [];
        } catch (llmErr: any) {
            console.error('[Routes] Semantic search LLM call failed:', llmErr.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to perform semantic search',
                details: llmErr.message
            });
        }

        // Limit results
        const topResults = rankedResults.slice(0, resultLimit);

        // Fetch full conversation details and messages for top results
        const results = topResults.map(result => {
            const conversation = conversationStmts.get.get(result.conversation_id);
            if (!conversation) return null;

            const messages = conversationMessageStmts.list.all(result.conversation_id);

            return {
                conversation_id: conversation.id,
                conversation_title: conversation.title,
                conversation_status: conversation.status,
                summary: conversation.summary,
                topics: conversation.topics ? JSON.parse(conversation.topics) : [],
                relevance_score: result.relevance_score,
                relevance_reason: result.reasoning,
                messages,
                created_at: conversation.created_at,
                updated_at: conversation.updated_at
            };
        }).filter(r => r !== null);

        res.json({
            success: true,
            results,
            query,
            count: results.length
        });
    } catch (err: any) {
        console.error('[Routes] Semantic search error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
