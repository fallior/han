/**
 * Recover Conversation C0s
 *
 * For every conversation in the DB that has messages but no gradient_entries c0,
 * formats the full conversation as a readable document and inserts it as a c0
 * gradient entry for the relevant agents (leo and/or jim, based on who participated).
 *
 * Usage: npx tsx src/scripts/recover-conversation-c0s.ts
 *        npx tsx src/scripts/recover-conversation-c0s.ts --dry-run
 *        npx tsx src/scripts/recover-conversation-c0s.ts --conversation-id <id>
 */

import { randomUUID } from 'crypto';
import { db, gradientStmts } from '../server/db';

const isDryRun = process.argv.includes('--dry-run');
const targetConvId = process.argv.includes('--conversation-id')
    ? process.argv[process.argv.indexOf('--conversation-id') + 1]
    : null;

interface Conversation {
    id: string;
    title: string;
    discussion_type: string;
    created_at: string;
    status: string;
}

interface Message {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: string;
}

function getConversationsNeedingC0(): Conversation[] {
    const query = targetConvId
        ? `SELECT DISTINCT c.id, c.title, c.discussion_type, c.created_at, c.status
           FROM conversations c
           JOIN conversation_messages m ON c.id = m.conversation_id
           WHERE c.id = ?
           AND NOT EXISTS (
               SELECT 1 FROM gradient_entries ge
               WHERE ge.source_conversation_id = c.id AND ge.level = 'c0'
           )`
        : `SELECT c.id, c.title, c.discussion_type, c.created_at, c.status
           FROM conversations c
           WHERE EXISTS (
               SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id
           )
           AND NOT EXISTS (
               SELECT 1 FROM gradient_entries ge
               WHERE ge.source_conversation_id = c.id AND ge.level = 'c0'
           )
           ORDER BY c.created_at DESC`;

    return targetConvId
        ? (db.prepare(query).all(targetConvId) as Conversation[])
        : (db.prepare(query).all() as Conversation[]);
}

function getMessages(conversationId: string): Message[] {
    return db.prepare(
        'SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId) as Message[];
}

function formatConversationAsC0(conv: Conversation, messages: Message[]): string {
    const roleLabel = (role: string) => {
        if (role === 'leo') return 'Leo';
        if (role === 'supervisor') return 'Jim';
        if (role === 'human') return 'Darron';
        if (role === 'assistant') return 'Claude';
        return role;
    };

    const lines: string[] = [
        `# Conversation: ${conv.title}`,
        `> ID: ${conv.id} | Type: ${conv.discussion_type} | Created: ${conv.created_at}`,
        `> Messages: ${messages.length} | Status: ${conv.status}`,
        '',
    ];

    for (const msg of messages) {
        lines.push(`## ${roleLabel(msg.role)} (${msg.created_at.slice(0, 16)})`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    return lines.join('\n');
}

function detectParticipants(messages: Message[]): Set<'leo' | 'jim'> {
    const participants = new Set<'leo' | 'jim'>();
    for (const msg of messages) {
        if (msg.role === 'leo') participants.add('leo');
        if (msg.role === 'supervisor') participants.add('jim');
        if (msg.role === 'human') {
            participants.add('leo');
            participants.add('jim');
        }
    }
    if (participants.size === 0) {
        participants.add('leo');
        participants.add('jim');
    }
    return participants;
}

async function main() {
    console.log(`Conversation C0 Recovery${isDryRun ? ' (DRY RUN)' : ''}`);

    const conversations = getConversationsNeedingC0();
    console.log(`Found ${conversations.length} conversations without c0 entries\n`);

    let processed = 0;
    let skipped = 0;

    for (const conv of conversations) {
        const messages = getMessages(conv.id);

        if (messages.length === 0) {
            console.log(`  SKIP ${conv.id.slice(0, 12)} "${conv.title.slice(0, 50)}" — no messages`);
            skipped++;
            continue;
        }

        // Skip Discord bot noise (low signal, 3 or fewer messages in general threads)
        const isDiscordNoise = conv.title.startsWith('Discord:') && messages.length <= 3;
        if (isDiscordNoise) {
            console.log(`  SKIP ${conv.id.slice(0, 12)} "${conv.title.slice(0, 50)}" — Discord noise`);
            skipped++;
            continue;
        }

        const participants = detectParticipants(messages);
        const content = formatConversationAsC0(conv, messages);
        const firstMessageId = messages[0].id;
        const sessionLabel = `conv-${conv.id}`;

        console.log(`  ${isDryRun ? 'WOULD INSERT' : 'INSERT'} ${conv.id.slice(0, 12)} "${conv.title.slice(0, 50)}" (${messages.length} msgs, agents: ${[...participants].join(',')})`);

        if (!isDryRun) {
            for (const agent of participants) {
                const entryId = randomUUID();
                const now = new Date().toISOString();
                // INSERT: id, agent, session_label, level, content, content_type,
                //         source_id, source_conversation_id, source_message_id,
                //         provenance_type, created_at, supersedes, change_count, qualifier
                gradientStmts.insert.run(
                    entryId, agent, sessionLabel, 'c0', content, 'conversation',
                    null, conv.id, firstMessageId,
                    'reconstituted', now, null, 0, null
                );
                console.log(`    → ${agent}: ${entryId.slice(0, 12)}`);
            }
        }

        processed++;
    }

    console.log(`\nDone. ${processed} conversations processed, ${skipped} skipped.`);
    if (isDryRun) console.log('(dry run — nothing written)');
}

main().catch(e => { console.error(e); process.exit(1); });
