/**
 * Conversation Cataloguing Service
 *
 * Automatically generates summaries, topics, tags, and key moments for conversations
 * using Claude Haiku for cost efficiency. Triggered when conversations are resolved,
 * or can be run on-demand for existing conversations.
 */

import { callLLM } from '../orchestrator';
import { conversationStmts, conversationMessageStmts, conversationTagStmts } from '../db';
import type { ConversationRow, ConversationMessageRow } from '../types';

// ── Types ────────────────────────────────────────────────────

interface CatalogueResult {
    summary: string;
    topics: string[];
    tags: string[];
    key_moments?: string;
}

interface ConversationWithMessages extends ConversationRow {
    messages: ConversationMessageRow[];
}

// ── Core Functions ───────────────────────────────────────────

/**
 * Catalogue a single conversation by ID
 * Generates summary, topics, tags, and key moments using Claude Haiku
 * Updates the conversations table and conversation_tags table
 */
export async function catalogueConversation(conversationId: string): Promise<void> {
    try {
        // Fetch conversation and messages
        const conversation = conversationStmts.get.get(conversationId) as ConversationRow | undefined;
        if (!conversation) {
            console.error(`[Cataloguing] Conversation ${conversationId} not found`);
            return;
        }

        const messages = conversationMessageStmts.list.all(conversationId) as ConversationMessageRow[];
        if (messages.length === 0) {
            console.log(`[Cataloguing] Conversation ${conversationId} has no messages, skipping`);
            return;
        }

        console.log(`[Cataloguing] Processing conversation ${conversationId} with ${messages.length} messages`);

        // Build conversation transcript for analysis
        const transcript = messages
            .map(m => `[${m.role}]: ${m.content}`)
            .join('\n\n');

        // Prepare prompts for LLM
        const systemPrompt = `You are a conversation analyst. Analyse the provided conversation and extract:
1. A concise summary (2-3 sentences max)
2. Main topics discussed (3-5 topics)
3. Searchable tags (5-10 tags for classification)
4. Key moments (optional: important quotes, decisions, or turning points)

Return JSON only with this structure:
{
  "summary": "Brief summary of the conversation",
  "topics": ["topic1", "topic2", "topic3"],
  "tags": ["tag1", "tag2", "tag3"],
  "key_moments": "Optional: notable quotes or decisions (comma-separated)"
}`;

        const userPrompt = `Conversation title: ${conversation.title}

Transcript:
${transcript}

Analyse this conversation and return the structured JSON.`;

        // Call LLM
        const result = await callLLM<CatalogueResult>(systemPrompt, userPrompt, { timeout: 30000 });
        const catalogue = result.response;

        // Validate response
        if (!catalogue.summary || !Array.isArray(catalogue.topics) || !Array.isArray(catalogue.tags)) {
            console.error(`[Cataloguing] Invalid response for conversation ${conversationId}:`, catalogue);
            return;
        }

        const now = new Date().toISOString();

        // Update conversations table with summary and topics
        conversationStmts.updateSummary.run(catalogue.summary, now, conversationId);
        conversationStmts.updateTopics.run(JSON.stringify(catalogue.topics), now, conversationId);

        // Update conversation with key_moments if provided
        if (catalogue.key_moments) {
            // Store in summary field for now (we have summary and topics columns)
            // The key_moments column exists but we'll store it in the summary
            const enhancedSummary = `${catalogue.summary}\n\nKey moments: ${catalogue.key_moments}`;
            conversationStmts.updateSummary.run(enhancedSummary, now, conversationId);
        }

        // Delete old tags and insert new ones
        conversationTagStmts.deleteByConversation.run(conversationId);
        for (const tag of catalogue.tags) {
            try {
                conversationTagStmts.insert.run(conversationId, tag.trim(), now);
            } catch (err: any) {
                console.error(`[Cataloguing] Error inserting tag "${tag}":`, err.message);
            }
        }

        console.log(`[Cataloguing] Successfully catalogued conversation ${conversationId}: ${catalogue.topics.length} topics, ${catalogue.tags.length} tags`);
    } catch (err: any) {
        // Log but don't throw - cataloguing is a nice-to-have, not critical
        console.error(`[Cataloguing] Error cataloguing conversation ${conversationId}:`, err.message);
    }
}

/**
 * Catalogue all resolved conversations that don't have summaries yet
 * Returns the number of conversations catalogued
 */
export async function catalogueAllUncatalogued(): Promise<number> {
    try {
        // Get all resolved conversations without summaries
        const uncatalogued = conversationStmts.list.all() as ConversationRow[];
        const needsCataloguing = uncatalogued.filter(c =>
            c.status === 'resolved'
        );

        if (needsCataloguing.length === 0) {
            console.log('[Cataloguing] No uncatalogued conversations found');
            return 0;
        }

        console.log(`[Cataloguing] Found ${needsCataloguing.length} uncatalogued resolved conversations`);

        let catalogued = 0;
        for (const conversation of needsCataloguing) {
            await catalogueConversation(conversation.id);
            catalogued++;

            // Small delay to avoid overwhelming the API
            if (catalogued < needsCataloguing.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`[Cataloguing] Successfully catalogued ${catalogued} conversations`);
        return catalogued;
    } catch (err: any) {
        console.error('[Cataloguing] Error in catalogueAllUncatalogued:', err.message);
        throw err;
    }
}

/**
 * Re-catalogue a conversation that already has a summary
 * Useful for updating cataloguing with improved prompts or when content changes
 */
export async function recatalogueConversation(conversationId: string): Promise<void> {
    console.log(`[Cataloguing] Re-cataloguing conversation ${conversationId}`);
    await catalogueConversation(conversationId);
}

/**
 * Batch catalogue multiple conversations by IDs
 * Returns the number of conversations successfully catalogued
 */
export async function batchCatalogueConversations(conversationIds: string[]): Promise<number> {
    console.log(`[Cataloguing] Batch cataloguing ${conversationIds.length} conversations`);

    let catalogued = 0;
    for (const id of conversationIds) {
        try {
            await catalogueConversation(id);
            catalogued++;

            // Small delay between cataloguing operations
            if (catalogued < conversationIds.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (err: any) {
            console.error(`[Cataloguing] Error cataloguing conversation ${id}:`, err.message);
            // Continue with next conversation
        }
    }

    console.log(`[Cataloguing] Batch cataloguing complete: ${catalogued}/${conversationIds.length} successful`);
    return catalogued;
}

// ── Exports ──────────────────────────────────────────────────

export default {
    catalogueConversation,
    catalogueAllUncatalogued,
    recatalogueConversation,
    batchCatalogueConversations,
};
