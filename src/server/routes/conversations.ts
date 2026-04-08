import { Router, Request, Response } from 'express';
import { db, conversationStmts, conversationMessageStmts } from '../db';
import { generateId } from '../services/planning';
import { broadcast } from '../ws';
import { runSupervisorCycle } from '../services/supervisor';
import { catalogueConversation, catalogueAllUncatalogued } from '../services/cataloguing';
import { callLLM } from '../orchestrator';
import { deliverMessage } from '../services/jemma-dispatch';
const router = Router();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';

// ── Addressee Classification ─────────────────────────────────────
//
// Uses Gemma (local Ollama) to determine who is being addressed in a
// human message. Handles nicknames (Jimmy → Jim), context ("tell Jim
// what you think" → both), and ambiguity ("hey everyone" → both).
// Falls back to tab-based routing + simple regex if Ollama is down.

interface AddresseeResult {
    jim: boolean;
    leo: boolean;
    reasoning: string;
}

async function classifyAddressee(content: string, discussionType: string): Promise<AddresseeResult> {
    const isJimTab = discussionType === 'jim-request' || discussionType === 'jim-report';
    const isLeoTab = discussionType === 'leo-question' || discussionType === 'leo-postulate';
    const isDarronTab = discussionType === 'darron-thought' || discussionType === 'darron-musing';

    // Darron's personal tabs always wake both agents — his thoughts are for both colleagues
    if (isDarronTab) {
        console.log(`[Conversations] Darron tab (${discussionType}) — waking both Jim and Leo`);
        return { jim: true, leo: true, reasoning: 'darron-tab: always both' };
    }

    try {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt: `You route messages to team members. The team: Jim (also Jimmy), Leo (also Leonhard).

Thread type: "${discussionType}"
Message: "${content.slice(0, 500)}"

Who is being ASKED TO RESPOND? Set true for each person who should reply.

IMPORTANT:
- "Jim and Leo, ..." or "Hey Jim and Hey Leo" → BOTH true (addressing the group)
- "Jimmy" → jim true
- "Leo, what do you think" → leo true
- Talking ABOUT someone's past work without asking them → false
- If no one is clearly addressed, default: ${isJimTab ? 'jim' : isLeoTab ? 'leo' : 'both'}

JSON only: {"jim": true/false, "leo": true/false, "reasoning": "brief"}`,
                stream: false,
                format: 'json',
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) throw new Error(`Ollama ${res.status}`);

        const data = await res.json() as any;
        const result = JSON.parse(data.response);
        console.log(`[Conversations] Gemma addressee: jim=${result.jim} leo=${result.leo} — ${result.reasoning}`);
        return {
            jim: !!result.jim,
            leo: !!result.leo,
            reasoning: result.reasoning || '',
        };
    } catch (err: any) {
        // Fallback: tab-based routing + simple name matching
        console.warn(`[Conversations] Gemma classification failed (${err.message}), using fallback`);
        const mentionsJim = /\b(jim|jimmy)\b/i.test(content);
        const mentionsLeo = /\b(leo|leonhard)\b/i.test(content);
        return {
            jim: isJimTab || mentionsJim || (!isLeoTab && !isJimTab),
            leo: isLeoTab || mentionsLeo || (!isLeoTab && !isJimTab),
            reasoning: 'fallback: regex + tab routing',
        };
    }
}

/**
 * Classify the addressee of a human message and dispatch through Jemma.
 * Runs async — the HTTP response has already been sent. Fire-and-forget.
 * All signal writing, logging, and stats go through Jemma's unified dispatch.
 */
function classifyAndDispatch(
    conversationId: string,
    messageId: string,
    content: string,
    discussionType: string,
    timestamp: string,
): void {
    console.log(`[Conversations] Classifying addressee for message in ${discussionType} thread`);
    classifyAddressee(content, discussionType).then(async ({ jim, leo, reasoning }) => {
        const recipients: Array<'jim' | 'leo'> = [];
        if (jim) recipients.push('jim');
        if (leo) recipients.push('leo');

        for (const recipient of recipients) {
            try {
                await deliverMessage({
                    source: 'admin',
                    recipient,
                    message: content,
                    conversationId,
                    discussionType,
                    author: 'darron',
                    classification_confidence: 1.0,
                    reasoning,
                });
            } catch (err: any) {
                console.error(`[Conversations] Jemma delivery failed for ${recipient}: ${err.message}`);
            }
        }
    }).catch(err => {
        console.error(`[Conversations] Classification dispatch error: ${err.message}`);
    });
}

const listWithCounts = db.prepare(`
    SELECT c.*, COUNT(cm.id) as message_count,
        GROUP_CONCAT(DISTINCT cm.role) as participants
    FROM conversations c
    LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
`) as any;

const listWithCountsByType = db.prepare(`
    SELECT c.*, COUNT(cm.id) as message_count,
        GROUP_CONCAT(DISTINCT cm.role) as participants
    FROM conversations c
    LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
    WHERE c.discussion_type = ?
    GROUP BY c.id
    ORDER BY c.updated_at DESC
`) as any;

/**
 * GET / -- List all conversations
 * Query params: ?type=memory (filters by discussion_type), ?include_archived=true (includes archived)
 */
router.get('/', (req: Request, res: Response) => {
    try {
        const type = req.query.type as string | undefined;
        const includeArchived = req.query.include_archived === 'true';
        let conversations = type
            ? listWithCountsByType.all(type)
            : listWithCounts.all().filter((c: any) => !c.discussion_type || c.discussion_type === 'general');

        // Filter out archived conversations unless explicitly requested
        if (!includeArchived) {
            conversations = conversations.filter((c: any) => !c.archived_at);
        }

        res.json({ success: true, conversations });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST / -- Create a new conversation
 * Body: { title, discussion_type? } — discussion_type defaults to 'general'
 */
router.post('/', (req: Request, res: Response) => {
    try {
        const { title, discussion_type } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'title is required' });

        const type = discussion_type || 'general';

        // Dedup: if a thread with the same title and type was created in the last 60s, return it
        const cutoff = new Date(Date.now() - 60000).toISOString();
        const existing = db.prepare(
            `SELECT id FROM conversations WHERE title = ? AND discussion_type = ? AND created_at > ? LIMIT 1`
        ).get(title, type, cutoff) as { id: string } | undefined;

        if (existing) {
            const conversation = conversationStmts.get.get(existing.id);
            return res.json({ success: true, conversation, deduplicated: true });
        }

        const id = generateId();
        const now = new Date().toISOString();
        conversationStmts.insertWithType.run(id, title, 'open', now, now, type);

        const conversation = conversationStmts.get.get(id);

        // Broadcast so React clients update their thread lists
        broadcast({
            type: 'conversation_created',
            conversation,
            discussion_type: type,
        });

        res.json({ success: true, conversation });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /grouped -- List conversations grouped by temporal period
 * Query params: ?type=memory (filters by discussion_type), ?include_archived=true (includes archived)
 * Returns: { periods: { 'today': { count, conversations }, 'this_week': {...}, ... } }
 */
router.get('/grouped', (req: Request, res: Response) => {
    try {
        const type = req.query.type as string | undefined;
        const includeArchived = req.query.include_archived === 'true';
        let conversations = type
            ? listWithCountsByType.all(type) as any[]
            : (listWithCounts.all() as any[]).filter((c: any) => !c.discussion_type || c.discussion_type === 'general');

        // Filter out archived conversations unless explicitly requested
        if (!includeArchived) {
            conversations = conversations.filter((c: any) => !c.archived_at);
        }

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
        const { q, limit = '20', mode = 'text', type } = req.query;

        if (!q || typeof q !== 'string') {
            return res.status(400).json({ success: false, error: 'query parameter "q" is required' });
        }

        if (mode !== 'text') {
            return res.status(400).json({ success: false, error: 'only mode=text is currently supported' });
        }

        const resultLimit = Math.min(parseInt(limit as string, 10) || 20, 100);

        // FTS5 search query with snippet highlighting, optionally filtered by discussion_type
        const typeFilter = type ? `AND (c.discussion_type = ?)` : `AND (c.discussion_type IS NULL OR c.discussion_type = 'general')`;
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
            ${typeFilter}
            ORDER BY rank
            LIMIT ?
        `) as any;

        let matches;
        try {
            matches = type
                ? searchStmt.all(q, type, resultLimit)
                : searchStmt.all(q, resultLimit);
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

        // Auto-reactivate archived conversation on new message
        if (conversation.archived_at) {
            conversationStmts.unarchive.run(now, req.params.id);
        }

        const message = {
            id: messageId,
            conversation_id: req.params.id,
            role: finalRole,
            content,
            created_at: now
        };

        // Broadcast via WebSocket
        const discussionType = (conversation as any).discussion_type || 'general';
        broadcast({
            type: 'conversation_message',
            conversation_id: req.params.id,
            discussion_type: discussionType,
            message
        });

        res.json({ success: true, message });

        // Dispatch for human messages — classify addressee via Gemma (Ollama),
        // then wake the appropriate agents. Falls back to tab-based + regex if Ollama is down.
        if (finalRole === 'human') {
            classifyAndDispatch(req.params.id, messageId, content, discussionType, now);
        }

        if (finalRole === 'leo') {
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
 * PATCH /:id -- Update conversation title
 * Body: { title }
 */
router.patch('/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
        const { title } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'title is required' });

        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const now = new Date().toISOString();
        conversationStmts.updateTitle.run(title, now, req.params.id);

        const updated = conversationStmts.get.get(req.params.id);
        res.json({ success: true, conversation: updated });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/archive -- Archive a conversation
 */
router.post('/:id/archive', (req: Request<{ id: string }>, res: Response) => {
    try {
        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const now = new Date().toISOString();
        conversationStmts.archive.run(now, now, req.params.id);

        const updated = conversationStmts.get.get(req.params.id);
        res.json({ success: true, conversation: updated });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /:id/unarchive -- Unarchive a conversation
 */
router.post('/:id/unarchive', (req: Request<{ id: string }>, res: Response) => {
    try {
        const conversation = conversationStmts.get.get(req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });

        const now = new Date().toISOString();
        conversationStmts.unarchive.run(now, req.params.id);

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

/**
 * POST /internal/broadcast -- Internal endpoint for cross-process WebSocket broadcasts.
 * Used by jim-human and leo-human (separate processes) to notify admin UI of new messages.
 * Localhost-only (auth middleware already bypasses localhost).
 */
router.post('/internal/broadcast', (req: Request, res: Response) => {
    try {
        const { conversation_id, message_id, role, content, created_at } = req.body;
        if (!conversation_id || !message_id) {
            return res.status(400).json({ success: false, error: 'conversation_id and message_id required' });
        }

        const conversation = conversationStmts.get.get(conversation_id) as any;
        const discussionType = conversation?.discussion_type || 'general';

        broadcast({
            type: 'conversation_message',
            conversation_id,
            discussion_type: discussionType,
            message: {
                id: message_id,
                conversation_id,
                role: role || 'supervisor',
                content: content || '',
                created_at: created_at || new Date().toISOString(),
            }
        });

        res.json({ success: true });
    } catch (err: any) {
        console.error('[Routes] Internal broadcast error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
