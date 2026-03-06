# Jim Discord Reply Path and Admin UI Dispatch Resilience — 2026-03-04

**Author**: Claude (autonomous)
**Goal**: mmbyq8s5-29nq05
**Tasks**: mmbysstx-yny9xz, mmbyssu6-pogdr7
**Cost**: $0.74 (Sonnet)

## Summary

Fixed two surgical bugs in Jim's communication infrastructure:

1. **Discord reply path**: Jim's `respond_conversation` action was passing numeric channel IDs directly to `postToDiscord()`, causing webhook lookup failures. Now correctly resolves channel ID to channel name before posting.

2. **Admin UI dispatch resilience**: Refactor 6eb66be centralised ALL human message dispatch through Jemma's admin WebSocket, creating single point of failure. Added lightweight jim-wake signal fallback that writes directly to filesystem without calling `runSupervisorCycle()`.

Both fixes are minimal surgical changes that restore critical functionality without introducing complexity.

## What Was Built

### 1. Discord Reply Path Fix (supervisor-worker.ts)

**Problem**:
- Conversation title format: `"Discord: {author} in #{channelId}"`
- Code extracted channel ID via regex: `/#(\S+)/`
- Passed ID directly to `postToDiscord('jim', channelId, content)`
- `postToDiscord()` looks up `webhooks[persona][channelName]`
- Lookup failed: key should be `'jim'` not `'1478239128654053427'`

**Solution**:
```typescript
// supervisor-worker.ts line 32 — add import
import { postToDiscord, resolveChannelName } from './discord';

// Lines 932-945 — resolve before posting
const titleMatch = conversation.title?.match(/#(\S+)/);
if (titleMatch && titleMatch[1]) {
    const channelName = resolveChannelName(titleMatch[1]);
    if (!channelName) {
        log(`[Worker] Cannot resolve channel ID ${titleMatch[1]} — skipping Discord post`);
    } else {
        const posted = await postToDiscord('jim', channelName, action.response_content);
        if (posted) {
            log(`[Worker] Posted Jim response to Discord #${channelName}`);
        } else {
            log(`[Worker] Failed to post to Discord #${channelName}`);
        }
    }
}
```

**Key details**:
- Import `resolveChannelName` from existing `./discord` module
- Call `resolveChannelName(titleMatch[1])` to convert ID → name
- Guard against null return (unknown channel ID) — log and skip instead of crash
- Existing Discord post logic unchanged, just receives correct channel name now

### 2. Admin UI Dispatch Resilience (conversations.ts)

**Problem**:
- Refactor 6eb66be removed ALL dispatch logic for human messages
- Relied entirely on Jemma's admin WebSocket client listening for broadcasts
- When Jemma's WS drops: human messages sit unprocessed until 20-min scheduled cycle
- Original over-responding problem prevented calling `runSupervisorCycle()` directly

**Solution**:
```typescript
// conversations.ts lines 302-317 — lightweight signal fallback
if (finalRole === 'human') {
    // Lightweight fallback: write jim-wake signal so Jim wakes
    // even if Jemma's admin WebSocket is down.
    // Do NOT call runSupervisorCycle() directly — that caused over-responding.
    try {
        const signalFile = path.join(SIGNALS_DIR, 'jim-wake');
        fs.writeFileSync(signalFile, JSON.stringify({
            conversationId: req.params.id,
            messageId,
            timestamp: now,
            reason: 'human_message_fallback'
        }));
    } catch (err: any) {
        console.error(`[Conversations] Failed to write jim-wake signal: ${err.message}`);
    }
}
```

**Key details**:
- After storing message + broadcasting to WebSocket (primary path via Jemma)
- Write jim-wake signal file directly to `~/.han/signals/`
- Signal contains conversation ID, message ID, timestamp, and reason
- Does NOT call `runSupervisorCycle()` (that was the original problem)
- Jim's deferred cycle pattern will see signal via fs.watch and wake immediately
- Try/catch wrapper prevents signal write failures from breaking message storage

## Why These Fixes Matter

### Discord Reply Path
Without this fix, every Jim response to Discord conversations failed silently. Jim would analyse the conversation, decide to respond, save the response to the database, but the Discord webhook POST would fail with "channel not found". Discord users would never see Jim's replies.

Now: Jim → Discord communication loop works end-to-end.

### Admin UI Resilience
The Jemma centralisation (6eb66be) was correct for preventing over-responding, but created a single point of failure. If Jemma's WebSocket connection dropped (network blip, process restart, etc), human messages would be invisible to Jim until the next scheduled cycle (up to 20 minutes).

This fallback preserves Jemma's centralisation benefits (no duplicate dispatch, clean separation of concerns) while ensuring Jim always wakes for human messages even if Jemma is down.

The key insight: Writing a signal file is safe (idempotent, no side effects), unlike calling `runSupervisorCycle()` directly (which was spawning multiple cycles).

## Code Changes

### Modified Files

**src/server/services/supervisor-worker.ts**:
- Line 32: Added `resolveChannelName` to import from `./discord`
- Lines 932-945: Wrapped Discord post in channel name resolution guard
- Net change: +2 lines import, +6 lines guard logic

**src/server/routes/conversations.ts**:
- Lines 302-317: Added jim-wake signal fallback for human messages
- Net change: +14 lines (signal write + try/catch)

### Commits

1. `47ce93f` — fix: Fix resolveChannelName in supervisor-worker.ts Discord reply path
2. `150a180` — feat: Add jim-wake signal fallback for human messages in conversations.ts
3. `bd2d039` — fix: Remove unresolved merge conflict markers from conversations.ts

## Testing

### Discord Reply Path
**Test**: Post message to #jim Discord channel → Jemma classifies → creates conversation → Jim responds → verify Discord webhook receives correct channel name

**Verification**:
- Conversation title: `"Discord: fallior in #1478239128654053427"`
- `resolveChannelName('1478239128654053427')` returns `'jim'`
- `postToDiscord('jim', 'jim', content)` succeeds
- Webhook lookup: `webhooks['jim']['jim']` finds correct URL
- Discord channel receives Jim's response

### Admin UI Resilience
**Test 1**: Jemma WebSocket connected (primary path)
- Human posts to Workshop → conversations.ts broadcasts → Jemma classifies → writes jim-wake signal
- Jim wakes via Jemma's signal

**Test 2**: Jemma WebSocket disconnected (fallback path)
- Human posts to Workshop → conversations.ts broadcasts (no listener) → fallback writes jim-wake signal
- Jim wakes via fallback signal

**Test 3**: Jemma never started (edge case)
- Human posts to Workshop → conversations.ts fallback writes jim-wake signal immediately
- Jim wakes via fallback signal

All three scenarios now work correctly.

## Next Steps

None — both fixes are complete and minimal. The two communication paths (Discord and admin UI) are now resilient with appropriate fallbacks.

## Architectural Notes

### Signal File Pattern
The jim-wake signal file pattern is used throughout the codebase:
- Deferred cycle pattern (cli-free triggers jim-wake)
- Admin UI fallback (human message triggers jim-wake)
- Leo message cooldown (delayed jim-wake after contemplation period)

This fix aligns with existing patterns rather than introducing new mechanisms.

### Channel Name Resolution
The `resolveChannelName()` function is part of the Discord utils module and handles the bidirectional mapping:
- **Forward**: `#channel-name` → numeric ID (for Discord API calls)
- **Reverse**: numeric ID → `#channel-name` (for webhook lookups)

The conversation title stores the numeric ID (stable, doesn't change if channel renamed), but webhook config keys use the channel name (human-readable, easier to configure).

This fix simply ensures the reverse lookup happens before the webhook lookup.
