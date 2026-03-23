# Jemma Unified Dispatch — Plan

> Session 99 plan. Darron's direction: Jemma is the single dispatcher for ALL message routing —
> Discord AND admin UI. One classification engine, one routing brain, one audit trail.
> Current state: two separate dispatch paths (Jemma for Discord, classifyAndDispatch in
> conversations.ts for admin UI). This plan unifies them.

---

## Origin

Darron asked whether posting in Dreamer Darron > Thoughts wakes both agents. The investigation
revealed two independent dispatch paths — Jemma handles Discord, `classifyAndDispatch` in
`conversations.ts` handles admin UI. Both use Gemma (Ollama) for classification but with
different code, different logging, different signal shapes. Darron's correction: "Jemma should
already handle all dispatch on the HAN system and Discord."

## What Exists Today

### Discord path (Jemma → deliver)
1. `jemma.ts` connects to Discord Gateway via WebSocket
2. Incoming messages classified via Ollama (`gemma3:4b`)
3. Delivery via `POST /api/jemma/deliver` which:
   - Creates/finds conversation in DB (for Jim)
   - Writes wake signal files (`jim-wake`, `jim-human-wake`, `leo-wake`, `leo-human-wake`)
   - Sends ntfy notification (for Darron)
   - Broadcasts via WebSocket for admin UI
4. Stats tracked in `jemma-stats.json`, messages in `jemma-messages.json`
5. All decisions logged to console

### Admin UI path (classifyAndDispatch)
1. Human posts message via `POST /api/conversations/:id/messages`
2. If `role === 'human'`, fires `classifyAndDispatch()` (fire-and-forget)
3. `classifyAddressee()` calls Ollama with the same `gemma3:4b`
4. Writes wake signals directly to `~/.han/signals/`
5. No delivery stats, no audit trail, no Jemma awareness
6. Special case: Darron tabs (`darron-thought`, `darron-musing`) bypass classification — always both

### The gap
- Two Gemma classifiers doing the same job
- Admin UI dispatch has no logging, no stats, no audit trail
- Jemma doesn't know about admin UI messages
- No single place to see "who was woken and why"

## What We're Building

Jemma as the single dispatch authority. Admin UI messages route through Jemma's delivery
endpoint, giving us:
1. **One classification engine** — Jemma's Ollama classification handles both sources
2. **One audit trail** — all dispatch decisions logged through Jemma stats
3. **One routing brain** — special rules (Darron tabs = both, Jim tabs = Jim default, etc.) in one place
4. **Admin UI awareness** — Jemma's status page shows both Discord and admin messages

## Implementation

### Step 1: Extend `/api/jemma/deliver` for admin UI messages

Add a `source` field to the delivery payload:
```typescript
{
  source: 'discord' | 'admin',  // NEW
  recipient: 'jim' | 'leo' | 'darron' | 'both',
  message: string,
  channel?: string,              // Discord channel ID (Discord only)
  channelName?: string,          // Discord channel name (Discord only)
  conversationId?: string,       // Admin conversation ID (admin only)
  discussionType?: string,       // Admin discussion type (admin only)
  author: string,
  classification_confidence: number,
}
```

For `source: 'admin'`, the deliver route:
- Does NOT create a new conversation (already exists)
- Writes the same wake signal files
- Logs to the same stats/messages tracking
- Broadcasts via WebSocket

### Step 2: Add classification to Jemma service

Move `classifyAddressee()` from `conversations.ts` into Jemma's delivery route (or a shared
module). The classification happens at delivery time, not at post time. This way:
- Discord: Jemma classifies → delivers → signals
- Admin: conversations.ts posts to Jemma → Jemma classifies → delivers → signals

OR simpler: keep classification in `conversations.ts` but route the result through Jemma:
- `classifyAndDispatch` calls `classifyAddressee` as before
- Instead of writing signals directly, POSTs to `/api/jemma/deliver` with the result
- Jemma handles all signal writing, logging, stats

### Step 3: Replace `classifyAndDispatch` signal writing

```typescript
// BEFORE (conversations.ts)
function classifyAndDispatch(...) {
    classifyAddressee(content, discussionType).then(({ jim, leo }) => {
        if (jim) fs.writeFileSync(SIGNALS_DIR + '/jim-wake', ...);
        if (leo) fs.writeFileSync(SIGNALS_DIR + '/leo-human-wake', ...);
    });
}

// AFTER
function classifyAndDispatch(...) {
    classifyAddressee(content, discussionType).then(({ jim, leo, reasoning }) => {
        const recipients = [];
        if (jim) recipients.push('jim');
        if (leo) recipients.push('leo');

        for (const recipient of recipients) {
            fetch('https://localhost:3847/api/jemma/deliver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: 'admin',
                    recipient,
                    message: content,
                    conversationId,
                    discussionType,
                    author: 'darron',
                    classification_confidence: 1.0,
                }),
            }).catch(err => console.error('[Conversations] Jemma delivery failed:', err));
        }
    });
}
```

### Step 4: Update Jemma stats to track source

Extend `deliveryStats` to distinguish sources:
```json
{
  "jim": 45,
  "leo": 32,
  "darron": 12,
  "by_source": {
    "discord": { "jim": 30, "leo": 20, "darron": 10 },
    "admin": { "jim": 15, "leo": 12, "darron": 2 }
  }
}
```

### Step 5: Update Jemma status page

The Workshop > Jemma > Messages tab shows recent messages. Extend to show admin UI dispatches
alongside Discord ones, distinguished by source.

## Key Files

| File | Change |
|------|--------|
| `src/server/routes/conversations.ts` | Replace signal writing with Jemma delivery call |
| `src/server/routes/jemma.ts` | Extend `/deliver` for `source: 'admin'`, update stats |
| `src/server/jemma.ts` | No change (Discord path unchanged) |
| `docs/HAN-ECOSYSTEM-COMPLETE.md` | Update Jemma section |

## Design Decisions

- **Classification stays in conversations.ts** — Gemma is fast and local, no need to add a
  network hop for classification. Only the delivery/signalling routes through Jemma.
- **Darron tabs still bypass classification** — `isDarronTab` check stays, but the delivery
  still goes through Jemma for logging/audit.
- **No breaking changes to Discord path** — Jemma's Discord handling is unchanged. We're
  adding a second input source, not refactoring the first.

## Cost

- Zero API cost (Jemma delivery is local HTTP + file writes)
- Minor latency: one extra localhost HTTP call per admin message (~1ms)

---

*Plan written by Leo (Session 99). Ready for implementation next session.*
