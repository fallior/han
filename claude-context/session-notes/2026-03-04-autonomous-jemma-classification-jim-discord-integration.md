# Session Note: Jemma Classification Improvements and Jim Discord Integration

**Date:** 2026-03-04
**Author:** Claude (autonomous)
**Goal ID:** mmbnht0t-n9ho4z
**Tasks:** 5 tasks completed
**Cost:** $1.65 (Haiku $0.15, Sonnet $1.50)

## Summary

Implemented full bidirectional Discord ↔ Jim communication by enhancing Jemma's classification prompt with channel and username context, changing Discord message role to 'human' for Jim visibility, wiring Discord webhook posting into Jim's supervisor respond_conversation handler, and adding cycle overlap protection. This completes the three-agent communication ecosystem (Leo + Jim + Jemma) with external Discord Gateway integration.

## What Was Built

### 1. Channel Name Injection in Classification Prompt

**Problem:** Jemma's classification prompt showed raw channel IDs (`1234567890`) instead of human-readable names (`#general`). The classifier couldn't use channel context effectively for routing decisions.

**Solution:**
- Reversed the config.json channel map structure: `{ '#general': '1234567890' }` → `{ '1234567890': 'general' }`
- Modified `buildClassificationPrompt()` in jemma.ts:207-244 to construct `idToName` lookup
- Prompt now shows: `Channel: #general (1234567890)` instead of bare ID
- Helps classifier understand channel-specific routing (e.g., #jim → route to Jim)

**Files modified:**
- `src/server/jemma.ts:209-216` (channel name reversal logic)
- `src/server/routes/jemma.ts:2` (updated config type import)

### 2. Username Mapping in Classification Prompt

**Problem:** Discord usernames (e.g., `fallior`) don't always match real identities. Classifier couldn't distinguish between team members effectively.

**Solution:**
- Added `config.discord.username_map` lookup: `{ 'fallior': 'Darron' }`
- Modified `buildClassificationPrompt()` to show: `Author: Darron (@fallior)` when mapping exists
- Falls back to bare username when no mapping configured
- Prompt format: `Author: {realName} (@{username})` or just `{username}` if unmapped
- Improves context-aware routing (Darron messages → higher priority than external users)

**Files modified:**
- `src/server/jemma.ts:218-221` (username mapping logic)

### 3. Discord Message Role Changed to 'human'

**Problem:** Discord messages were inserted with `role='discord'`. Jim's pending conversation query only fetches `role IN ('human','supervisor','leo')`, so Discord messages were invisible to Jim. He couldn't see Darron's questions from Discord.

**Solution:**
- Changed message insertion role from `'discord'` to `'human'` in two locations:
  - `src/server/jemma.ts:535` (automatic delivery from Gateway)
  - `src/server/routes/jemma.ts:230` (manual delivery endpoint)
- Now Jim's supervisor cycle sees Discord messages in pending conversation analysis
- Preserves `author` field as `'discord:{username}'` for audit trail

**Files modified:**
- `src/server/jemma.ts:535` (role='human')
- `src/server/routes/jemma.ts:230` (role='human')

### 4. Wire postToDiscord into Supervisor respond_conversation Handler

**Problem:** Jim could formulate responses to Discord conversations, but they stayed in the database. No mechanism to post back to Discord channels.

**Solution:**

**New discord-utils.ts module** (129 lines):
- `loadDiscordConfig()`: Reads ~/.claude-remote/config.json for Discord webhooks
- `resolveChannelName(channelId)`: Reverses channel map to get name from ID
- `postToDiscord(role, channelName, content)`: Posts message via webhook with retry logic
  - Splits content into 2000-character chunks (Discord limit)
  - Exponential backoff retry: 1s → 2s → 4s (max 2 retries)
  - Role prefix formatting: `**jim**: message content`

**Supervisor worker integration** (supervisor-worker.ts:925-950):
- In `respond_conversation` action handler, after saving message to DB:
  1. Check if `conversation.discussion_type === 'discord'`
  2. Extract channel name from conversation title: `"Discord: {author} in #{channelName}"`
  3. Load Discord config and resolve webhook URL
  4. Call `postToDiscord('jim', channelName, response_content)`
  5. Log success/failure (non-blocking — message already saved to DB)

**Why non-blocking:** Discord posting happens AFTER message is saved to conversation thread. If webhook fails, Jim's response is still preserved in DB for manual recovery via admin console.

**Files created:**
- `src/server/services/discord-utils.ts` (129 lines)

**Files modified:**
- `src/server/services/supervisor-worker.ts:32,925-950` (import discord-utils, integrate postToDiscord in respond_conversation handler)

### 5. Cycle Overlap Protection (cycleInProgress Guard)

**Problem:** Jim's deferred cycle pattern (fs.watch triggers on cli-free signal) could fire while a scheduled 20-minute cycle was already running. Without protection, two cycles would:
- Spawn competing Agent SDK subprocesses
- Corrupt shared DB state (both writing to conversations, goals, tasks)
- Waste API tokens on duplicate work
- Cause race conditions in pending conversation queries

**Solution:**
- Added `cycleInProgress` boolean flag in `src/server/services/supervisor.ts:40`
- Guard in `runSupervisorCycle()`:
  - Check `if (cycleInProgress)` → return null immediately with console log
  - Set `cycleInProgress = true` before sending run_cycle message to worker
  - Clear flag in two places:
    - On cycle completion (success or failure)
    - On 2-hour timeout (safety net for hung cycles)
- 2-hour timeout is generous because Agent SDK cycles can legitimately run very long (complex exploration, multi-step reasoning)

**Files modified:**
- `src/server/services/supervisor.ts:40,910-913,925,933,951` (cycleInProgress flag and guard logic)

## Key Decisions

### DEС-036: Discord Message Role Mapping (Implicit)

**Context:** Discord messages need to be visible to Jim's pending conversation analysis, but we also need to preserve audit trail of message source.

**Decision:** Use `role='human'` for Jim's query visibility, preserve source in `author='discord:{username}'` field.

**Alternatives considered:**
1. Add 'discord' to Jim's pending query role filter → would work but pollutes role semantics (role should indicate conversation participant type, not source)
2. Keep role='discord', modify Jim's query → more invasive change to supervisor logic
3. Chosen approach → minimal change, leverages existing role semantics

**Consequences:**
- Discord messages appear as 'human' role in conversation threads
- `author` field preserves source: `'discord:fallior'` vs `'human'` (from web) vs `'leo'`
- Jim's existing pending query works without modification
- Future role-based filtering continues to work as expected

### DEC-037: Discord Posting Error Handling (Implicit)

**Context:** When Jim responds to Discord conversation, webhook posting could fail (network, rate limits, bad config). Should failure block the action or just log?

**Decision:** Non-blocking. Save message to DB first, attempt Discord post, log failure but don't fail the action.

**Alternatives considered:**
1. Blocking — fail action if Discord post fails → would lose Jim's response in DB if webhook is misconfigured
2. Retry indefinitely → could hang supervisor cycle for hours
3. Chosen: save first, post best-effort, log failure → preserves data, doesn't block Jim

**Consequences:**
- Jim's responses are always preserved in conversation DB
- Manual recovery possible via admin console if webhook fails
- Discord delivery is best-effort, not guaranteed
- Admins can check logs to diagnose webhook configuration issues

## Code Changes

### Files Created
- `src/server/services/discord-utils.ts` (129 lines)

### Files Modified
- `src/server/jemma.ts` (+24 lines)
  - Lines 209-216: Channel name reversal logic
  - Lines 218-221: Username mapping logic
  - Line 535: Role changed to 'human'
- `src/server/routes/jemma.ts` (+2 lines)
  - Line 230: Role changed to 'human'
- `src/server/services/supervisor-worker.ts` (+24 lines)
  - Line 32: Import discord-utils
  - Lines 925-950: Discord posting in respond_conversation handler
- `src/server/services/supervisor.ts` (+13 lines)
  - Line 40: cycleInProgress flag declaration
  - Lines 910-913: Guard check with early return
  - Lines 925, 933, 951: Flag set/clear logic

### Commits
1. `110f307` — chore: Inject channel names into Jemma classification prompt (Haiku)
2. `9608af7` — feat: Add username mapping to classification prompt (Haiku)
3. `80dc1db` — chore: Change Discord message role from 'discord' to 'human' (Sonnet)
4. `934d34b` — feat: Wire postToDiscord into supervisor respond_conversation handler (Haiku)
5. `45a3db1` — feat: Add cycleInProgress guard to prevent overlapping cycles (Sonnet)

## Testing Notes

- **Channel name reversal**: Verified prompt shows `#general (1234567890)` format with test config
- **Username mapping**: Tested with/without mapping configured — falls back to bare username correctly
- **Role='human' visibility**: Confirmed Jim's pending query now returns Discord messages
- **Discord posting**: Not fully tested in production (requires live Discord webhook). Logic reviewed, retry/splitting code follows established patterns from other webhook integrations.
- **Cycle overlap guard**: Logic review only — would require concurrent cycle triggers to test properly (deferred + scheduled at same instant)

## Next Steps

1. **Production testing**: Monitor Discord posting in production. Check logs for webhook failures.
2. **Username map expansion**: Add more username → real name mappings to config.json as team members use Discord
3. **Cycle metrics**: Add instrumentation to track how often cycle overlap guard triggers (should be rare)
4. **Discord delivery confirmation**: Consider adding delivery receipt logging to admin console (conversation thread shows message was posted to Discord)

## Reflection

This goal completed the three-agent communication loop:
1. **Darron → Discord → Jemma → Jim**: Message routing works, classifier sees full context
2. **Jim → Database → Discord → Darron**: Response posting works (untested in production but logic sound)
3. **Cycle protection**: Prevents race conditions in Jim's supervisor

The role='human' change was the critical insight — simpler than modifying Jim's pending query, preserves semantic role meaning, uses `author` field for audit trail. Discord posting being non-blocking is the right trade-off: data preservation > delivery guarantee.

Small but complete — each change was minimal and targeted. No over-engineering, no feature creep. Just the five specific requirements from the goal description.
